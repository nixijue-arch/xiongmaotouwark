import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { X, Upload, Sparkles, Check, ChevronDown, ChevronUp, Undo2, Redo2 } from 'lucide-react';
import { translations } from '@/context/translations';
import { ALL_PANDAS, getLivePandaFaceOffset } from '@/data/materials';
import { PandaCanvas } from '@/components/pandacanvas';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (dataUrl: string) => void;
  language: 'zh' | 'en';
}

// ============================================================
// 算法 helpers (module-level, no React state)
// ============================================================
const FACE_OVAL_INDICES = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288,
  397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136,
  172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
];
const KP = { TOP: 10, CHIN: 152, RIGHT: 234, LEFT: 454 };
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

// 单例 mediapipe landmarker
let _landmarker: any = null;
let _landmarkerPromise: Promise<any> | null = null;
async function getLandmarker(): Promise<any> {
  if (_landmarker) return _landmarker;
  if (_landmarkerPromise) return _landmarkerPromise;
  _landmarkerPromise = (async () => {
    // CDN ES module 动态加载 — 用变量包字符串避免 TS2307（URL string literal 解析失败）
    // /* @vite-ignore */ 让 vite 不尝试 transform 外部 URL
    const mediapipeUrl: string = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/vision_bundle.mjs';
    const dynImport = (u: string): Promise<any> => import(/* @vite-ignore */ u);
    const mod = await dynImport(mediapipeUrl);
    const vision = await mod.FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm'
    );
    const opts: any = {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
      runningMode: 'IMAGE', numFaces: 1, outputFaceBlendshapes: false,
    };
    try {
      _landmarker = await mod.FaceLandmarker.createFromOptions(vision, opts);
    } catch {
      opts.baseOptions.delegate = 'CPU';
      _landmarker = await mod.FaceLandmarker.createFromOptions(vision, opts);
    }
    return _landmarker;
  })();
  return _landmarkerPromise;
}

interface Point { x: number; y: number; }
interface Item {
  id: string;
  name: string;
  image: HTMLImageElement;
  landmarks: any[];
  maskHandles: Point[];     // 36 个 normalized handles
  outputCanvas?: HTMLCanvasElement;
  features?: any;
  recommended?: { preset: string; reason: string };
}

interface Params {
  headExpand: number; foreheadExt: number; chinExt: number;
  feather: number; alphaCut: number;
  trimDark: number; trimThr: number;
  autoNorm: boolean;
  blackPoint: number; whitePoint: number; gamma: number;
  contrast: number; edgeStrength: number; saturation: number;
  quantize: boolean; jpegLofi: boolean; jpegQ: number; blur: number;
  size: number;
  purify?: number;            // 0-100, master "净化" slider, SSOT for L2 effective values
}

const PRESETS: Record<string, Params> = {
  // 经典温和：保留较多细节，适合中等亮度暗调照片
  'ground-truth': { headExpand: -2, foreheadExt: -12, chinExt: 0, feather: 0, alphaCut: 200, trimDark: 50, trimThr: 60, autoNorm: true, blackPoint: 30, whitePoint: 225, gamma: 1.05, contrast: 20, edgeStrength: 0, saturation: 0, quantize: false, jpegLofi: false, jpegQ: 35, blur: 0, size: 1024, purify: 0 },
  // 高调亮白：熊猫头表情包的"标准美学" — 少纹理 / 神似 / 更白
  // 比经典更激进的 white clip + 黑场提升 + 更高对比, 让肤色平整 / 接近水墨白
  'high-key':     { headExpand: -2, foreheadExt: -12, chinExt: 0, feather: 0, alphaCut: 200, trimDark: 65, trimThr: 72, autoNorm: true, blackPoint: 72, whitePoint: 182, gamma: 0.80, contrast: 40, edgeStrength: 0, saturation: 0, quantize: false, jpegLofi: false, jpegQ: 35, blur: 0, size: 1024, purify: 0 },
  // 低保真做旧：JPEG 损伤 + 轻模糊, 适合本身低光 / 噪点多的图
  'lofi':         { headExpand: -2, foreheadExt: -12, chinExt: 0, feather: 0, alphaCut: 200, trimDark: 50, trimThr: 60, autoNorm: true, blackPoint: 40, whitePoint: 215, gamma: 1.0,  contrast: 15, edgeStrength: 0, saturation: 0, quantize: false, jpegLofi: true,  jpegQ: 25, blur: 1, size: 1024, purify: 0 },
  // 极致黑白：高对比抠线条, 适合本身就有强烈明暗反差的图
  'hi-contrast':  { headExpand: -2, foreheadExt: -12, chinExt: 0, feather: 0, alphaCut: 200, trimDark: 50, trimThr: 60, autoNorm: true, blackPoint: 70, whitePoint: 190, gamma: 0.7,  contrast: 60, edgeStrength: 60, saturation: 0, quantize: false, jpegLofi: false, jpegQ: 35, blur: 0, size: 1024, purify: 0 },
};

// ============================================================
// Master "净化" mapping — purify (0-100) → 4 个 L2 effective 参数 (SSOT)
// 各 effective 值=0 时, 对应的 L2 pixel pass 整体短路 (processFace 内 gate)
// ============================================================
interface EffectiveParams {
  feather: number;             // 0-24 px, edge alpha falloff radius
  midToneFade: number;         // 0-65, gaussian-weighted alpha fade for lum∈[~90,200]
  detailSuppress: number;      // 0-80, edge-aware blur strength
  darkenAlphaStrength: number; // 0-80, dark→transparent strength
  darkenLumThr: number;        // luma threshold below which alpha fades (固定)
}

function deriveEffective(purify: number | undefined): EffectiveParams {
  const m = Math.max(0, Math.min(100, purify ?? 0)) / 100;
  return {
    feather: Math.round(m * 24),
    midToneFade: Math.round(m * 65),
    detailSuppress: Math.round(m * 80),
    darkenAlphaStrength: Math.round(m * 80),
    darkenLumThr: 75,
  };
}

function tracePolygonPath(ctx: CanvasRenderingContext2D, points: Point[], scale = 1, offX = 0, offY = 0, tension = 0.5) {
  const n = points.length;
  if (n < 3) {
    points.forEach((p, i) => {
      const x = p.x * scale + offX, y = p.y * scale + offY;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    return;
  }
  const pts = points.map(p => ({ x: p.x * scale + offX, y: p.y * scale + offY }));
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    const cp1x = p1.x + (p2.x - p0.x) * tension / 6;
    const cp1y = p1.y + (p2.y - p0.y) * tension / 6;
    const cp2x = p2.x - (p3.x - p1.x) * tension / 6;
    const cp2y = p2.y - (p3.y - p1.y) * tension / 6;
    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
  }
}

function boxBlur1D(src: Uint8ClampedArray, w: number, h: number, r: number): Uint8ClampedArray {
  const tmp = new Uint8ClampedArray(w * h);
  const out = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let x = -r; x <= r; x++) sum += src[y * w + Math.max(0, Math.min(w - 1, x))];
    const div = 2 * r + 1;
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = sum / div;
      const xR = Math.min(w - 1, x + r + 1), xL = Math.max(0, x - r);
      sum += src[y * w + xR] - src[y * w + xL];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) sum += tmp[Math.max(0, Math.min(h - 1, y)) * w + x];
    const div = 2 * r + 1;
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / div;
      const yD = Math.min(h - 1, y + r + 1), yU = Math.max(0, y - r);
      sum += tmp[yD * w + x] - tmp[yU * w + x];
    }
  }
  return out;
}

// 分析 face polygon 内 luma 特征
function analyzeFace(image: HTMLImageElement, maskHandles: Point[]): any {
  const iw = image.naturalWidth, ih = image.naturalHeight;
  const poly = maskHandles.map(h => ({ x: h.x * iw, y: h.y * ih }));
  const cx = poly.reduce((s, p) => s + p.x, 0) / poly.length;
  const cy = poly.reduce((s, p) => s + p.y, 0) / poly.length;
  const tight = poly.map(p => ({ x: cx + (p.x - cx) * 0.85, y: cy + (p.y - cy) * 0.85 }));
  const xs = tight.map(p => p.x), ys = tight.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const sw = maxX - minX, sh = maxY - minY;
  const tmp = document.createElement('canvas');
  tmp.width = 100; tmp.height = 100;
  const tctx = tmp.getContext('2d')!;
  tctx.save();
  tctx.beginPath();
  const tightT = tight.map(p => ({ x: (p.x - minX) / sw * 100, y: (p.y - minY) / sh * 100 }));
  tracePolygonPath(tctx, tightT);
  tctx.closePath();
  tctx.clip();
  tctx.drawImage(image, minX, minY, sw, sh, 0, 0, 100, 100);
  tctx.restore();
  const data = tctx.getImageData(0, 0, 100, 100).data;
  let sum = 0, sum2 = 0, dark = 0, light = 0, n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 200) continue;
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    sum += lum; sum2 += lum * lum;
    if (lum < 70) dark++;
    if (lum > 200) light++;
    n++;
  }
  if (n === 0) return { mean: 128, std: 50, darkRatio: 0, lightRatio: 0 };
  const mean = sum / n;
  const std = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
  return { mean, std, darkRatio: dark / n, lightRatio: light / n };
}

function autoRoute(f: any): { preset: string; reason: string } {
  // 路由偏向"高调亮白"作为默认 — 熊猫头表情包美学就是少纹理 + 神似 + 更白
  // 之前 ground-truth 是 fallback, 导致大多数正常打光的照片得不到最贴近熊猫头风格的处理
  const { mean, std, darkRatio } = f;
  const cv = std / Math.max(1, mean);

  // 极强光影 (明显的硬阴影 + 大量暗块) → 极致黑白才能 capture
  if (std > 78 && darkRatio > 0.28) {
    return { preset: 'hi-contrast', reason: `强光影 (std=${std.toFixed(0)}, 暗 ${(darkRatio * 100).toFixed(0)}%) → 极致黑白` };
  }
  // 真正的低光照（夜景 / 室内黯淡）→ 低保真做旧能"裱救"颗粒感
  if (mean < 95 && darkRatio > 0.40) {
    return { preset: 'lofi', reason: `低光 (mean=${mean.toFixed(0)}) → 低保真做旧` };
  }
  // 整体偏暗 (但还有结构) → 经典温和保留更多细节
  if (mean < 118 || darkRatio > 0.38) {
    return { preset: 'ground-truth', reason: `暗调 (mean=${mean.toFixed(0)}, 暗 ${(darkRatio * 100).toFixed(0)}%) → 经典温和` };
  }
  // 默认推荐：高调亮白 — 熊猫头表情包标准美学
  return { preset: 'high-key', reason: `亮调 (mean=${mean.toFixed(0)}, cv=${cv.toFixed(2)}) → 高调亮白（熊猫头风格）` };
}

// 主处理函数：mask polygon + 风格化 + 暗边修剪 + 白底
function processFace(image: HTMLImageElement, maskHandles: Point[], landmarks: any[], params: Params): HTMLCanvasElement {
  const iw = image.naturalWidth, ih = image.naturalHeight;
  const polygon = maskHandles.map(h => ({ x: h.x * iw, y: h.y * ih }));
  const cx = polygon.reduce((s, p) => s + p.x, 0) / polygon.length;
  const cy = polygon.reduce((s, p) => s + p.y, 0) / polygon.length;
  const top = landmarks[KP.TOP], chin = landmarks[KP.CHIN];
  const upX = (top.x - chin.x) * iw, upY = (top.y - chin.y) * ih;
  const faceH = Math.hypot(upX, upY) || 1;
  const upUnitX = upX / faceH, upUnitY = upY / faceH;
  const radial = 1 + params.headExpand / 100;
  const foreheadBoost = (params.foreheadExt / 100) * faceH;
  const chinBoost = (params.chinExt / 100) * faceH;

  const expanded = polygon.map(p => {
    const dx = p.x - cx, dy = p.y - cy;
    const len = Math.hypot(dx, dy) || 1;
    let nx = cx + dx * radial, ny = cy + dy * radial;
    const align = (dx * upUnitX + dy * upUnitY) / len;
    if (align > 0.2) {
      const k = (align - 0.2) / 0.8;
      nx += upUnitX * foreheadBoost * k;
      ny += upUnitY * foreheadBoost * k;
    } else if (align < -0.2) {
      const k = (-align - 0.2) / 0.8;
      nx -= upUnitX * chinBoost * k;
      ny -= upUnitY * chinBoost * k;
    }
    return { x: nx, y: ny };
  });

  const out = params.size;
  const xs = expanded.map(p => p.x), ys = expanded.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const bw = maxX - minX, bh = maxY - minY;
  const scale = (out * 0.88) / Math.max(bw, bh);
  const cxOut = (minX + maxX) / 2, cyOut = (minY + maxY) / 2;
  const offX = out / 2 - cxOut * scale;
  const offY = out / 2 - cyOut * scale;

  const canvas = document.createElement('canvas');
  canvas.width = out; canvas.height = out;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.save();
  ctx.beginPath();
  tracePolygonPath(ctx, expanded, scale, offX, offY);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(image, offX, offY, iw * scale, ih * scale);
  ctx.restore();

  // alpha 硬阈值
  let imgData = ctx.getImageData(0, 0, out, out);
  let data = imgData.data;
  const cutThr = params.alphaCut;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < cutThr) data[i + 3] = 0;
  }

  // 饱和度
  if (params.saturation < 100) {
    const amount = params.saturation / 100;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 250) continue;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      data[i] = r * amount + lum * (1 - amount);
      data[i + 1] = g * amount + lum * (1 - amount);
      data[i + 2] = b * amount + lum * (1 - amount);
    }
  }

  // autoNormalize
  if (params.autoNorm) {
    const hist = new Uint32Array(256);
    let total = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 200) continue;
      const lum = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) | 0;
      hist[lum]++; total++;
    }
    if (total > 0) {
      const lowT = total * 0.01, highT = total * 0.99;
      let cum = 0, lowV = 0, highV = 255, foundLow = false;
      for (let i = 0; i < 256; i++) {
        cum += hist[i];
        if (!foundLow && cum >= lowT) { lowV = i; foundLow = true; }
        if (cum >= highT) { highV = i; break; }
      }
      if (highV > lowV) {
        const range = highV - lowV;
        const lut = new Uint8ClampedArray(256);
        for (let i = 0; i < 256; i++) lut[i] = Math.max(0, Math.min(255, Math.round((i - lowV) / range * 255)));
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 250) continue;
          data[i] = lut[data[i]]; data[i + 1] = lut[data[i + 1]]; data[i + 2] = lut[data[i + 2]];
        }
      }
    }
  }

  // Levels
  {
    const range = params.whitePoint - params.blackPoint;
    if (range > 0) {
      const lut = new Uint8ClampedArray(256);
      for (let i = 0; i < 256; i++) {
        let v = (i - params.blackPoint) / range;
        v = Math.max(0, Math.min(1, v));
        v = Math.pow(v, 1 / params.gamma);
        lut[i] = Math.round(v * 255);
      }
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 250) continue;
        data[i] = lut[data[i]]; data[i + 1] = lut[data[i + 1]]; data[i + 2] = lut[data[i + 2]];
      }
    }
  }

  // contrast
  if (params.contrast !== 0) {
    const factor = (259 * (params.contrast + 255)) / (255 * (259 - params.contrast));
    const lut = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++) lut[i] = Math.max(0, Math.min(255, Math.round(factor * (i - 128) + 128)));
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 250) continue;
      data[i] = lut[data[i]]; data[i + 1] = lut[data[i + 1]]; data[i + 2] = lut[data[i + 2]];
    }
  }

  // 4 级量化
  if (params.quantize) {
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 250) continue;
      for (let c = 0; c < 3; c++) {
        const v = data[i + c];
        data[i + c] = v < 64 ? 0 : v < 128 ? 85 : v < 192 ? 170 : 255;
      }
    }
  }

  ctx.putImageData(imgData, 0, 0);

  // 暗边修剪
  if (params.trimDark > 0) {
    const w = out, h = out;
    const orig = ctx.getImageData(0, 0, w, h);
    const d2 = orig.data;
    const alphaIn = new Uint8ClampedArray(w * h);
    for (let i = 0; i < w * h; i++) alphaIn[i] = d2[i * 4 + 3] > 200 ? 255 : 0;
    const blurred = boxBlur1D(alphaIn, w, h, 25);
    const strength = params.trimDark / 100;
    for (let i = 0; i < w * h; i++) {
      const di = i * 4;
      if (d2[di + 3] < 200) continue;
      const lum = 0.299 * d2[di] + 0.587 * d2[di + 1] + 0.114 * d2[di + 2];
      if (lum >= params.trimThr) continue;
      const edgeProx = blurred[i] / 255;
      if (edgeProx > 0.92) continue;
      const proxFactor = Math.max(0, 1 - edgeProx / 0.92);
      const darkFactor = 1 - lum / params.trimThr;
      const fade = strength * proxFactor * darkFactor;
      d2[di + 3] = Math.round(d2[di + 3] * (1 - fade));
    }
    ctx.putImageData(orig, 0, 0);
  }

  // 不再 fillUnderneath 白底 — 输出透明 PNG（face 椭圆外保持 alpha=0）
  // 之前 fillUnderneath 把 polygon 外强制填白 → 套到 panda 头出现白色矩形
  // 用户希望 face 周围全透明，让 panda 黑廓自然显示
  // 副作用：trimDarkBorder 后边缘半透明像素直接显示为半透明（在 panda 白头上几乎看不到差别）
  return canvas;
}

// ============================================================
// React component
// ============================================================
export function SmartExtractModal({ isOpen, onClose, onConfirm, language }: Props) {
  const t = (k: string) => (translations[language] as any)[k] || k;

  const [items, setItems] = useState<Item[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [autoMode, setAutoMode] = useState(true);
  // 默认 high-key — 熊猫头表情包风格（少纹理 + 神似 + 更白）
  const [currentPreset, setCurrentPreset] = useState<string>('high-key');
  const [recommendReason, setRecommendReason] = useState<string>('');
  const [params, setParams] = useState<Params>(PRESETS['high-key']);
  const [loadingModel, setLoadingModel] = useState(false);
  const [error, setError] = useState<string>('');
  const [processing, setProcessing] = useState(false);
  // Panda preview — 用 PandaCanvas 而不是手动 canvas draw, 这样和 QuickMode / Collection
  // 共享同一套 composeMeme 锚点对齐 (bbox crop + content_center)
  const [pandaHeadId, setPandaHeadId] = useState<string>('panda-01');
  const [faceRotation, setFaceRotation] = useState(0);
  const [faceFlipX, setFaceFlipX] = useState(false);
  const [faceFill, setFaceFill] = useState(0.92);
  const [faceDataUrl, setFaceDataUrl] = useState<string>('');
  // polygon 拖拽
  const [draggingHandle, setDraggingHandle] = useState(-1);

  const outputPreviewRef = useRef<HTMLCanvasElement>(null);
  const originalCanvasRef = useRef<HTMLCanvasElement>(null);
  const currentPanda = useMemo(() => ALL_PANDAS.find(p => p.id === pandaHeadId) || ALL_PANDAS[0], [pandaHeadId]);

  // History stack (undo/redo)
  interface Snapshot { params: Params; currentPreset: string; itemHandles: { id: string; handles: Point[] }[]; activeId: string | null; }
  const historyRef = useRef<{ stack: Snapshot[]; idx: number }>({ stack: [], idx: -1 });
  const [, forceRerender] = useState(0);
  const updateHistoryUI = () => forceRerender(n => n + 1);
  const pushingFromHistoryRef = useRef(false);
  const historyTimerRef = useRef<number | null>(null);

  const activeItem = items.find(it => it.id === activeId);

  const snapshot = useCallback((): Snapshot => ({
    params: { ...params },
    currentPreset,
    itemHandles: items.map(it => ({ id: it.id, handles: it.maskHandles.map(h => ({ ...h })) })),
    activeId,
  }), [params, currentPreset, items, activeId]);

  const pushHistory = useCallback((immediate = false) => {
    if (pushingFromHistoryRef.current) return;
    if (historyTimerRef.current) clearTimeout(historyTimerRef.current);
    const doPush = () => {
      const h = historyRef.current;
      h.stack = h.stack.slice(0, h.idx + 1);
      h.stack.push(snapshot());
      if (h.stack.length > 50) h.stack.shift();
      h.idx = h.stack.length - 1;
      updateHistoryUI();
    };
    if (immediate) doPush();
    else historyTimerRef.current = window.setTimeout(doPush, 400);
  }, [snapshot]);

  const applySnapshot = (snap: Snapshot) => {
    pushingFromHistoryRef.current = true;
    setParams({ ...snap.params });
    setCurrentPreset(snap.currentPreset);
    setItems(prev => prev.map(it => {
      const f = snap.itemHandles.find(x => x.id === it.id);
      return f ? { ...it, maskHandles: f.handles.map(h => ({ ...h })) } : it;
    }));
    setActiveId(snap.activeId);
    setTimeout(() => { pushingFromHistoryRef.current = false; }, 0);
    updateHistoryUI();
  };
  const undo = () => {
    const h = historyRef.current;
    if (h.idx <= 0) return;
    h.idx--;
    applySnapshot(h.stack[h.idx]);
  };
  const redo = () => {
    const h = historyRef.current;
    if (h.idx >= h.stack.length - 1) return;
    h.idx++;
    applySnapshot(h.stack[h.idx]);
  };

  // 全局 Ctrl+Z 监听
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName) && (target as HTMLInputElement).type !== 'range' && (target as HTMLInputElement).type !== 'checkbox') return;
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault(); undo();
      } else if ((e.ctrlKey || e.metaKey) && ((e.shiftKey && (e.key === 'z' || e.key === 'Z')) || e.key === 'y' || e.key === 'Y')) {
        e.preventDefault(); redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen]);

  // 预热 mediapipe
  useEffect(() => {
    if (!isOpen || _landmarker) return;
    setLoadingModel(true);
    getLandmarker().catch(e => setError('模型加载失败: ' + e.message)).finally(() => setLoadingModel(false));
  }, [isOpen]);

  const handleFiles = useCallback(async (files: File[]) => {
    setError('');
    const lm = await getLandmarker();
    for (const file of files) {
      const url = URL.createObjectURL(file);
      const img: HTMLImageElement = await new Promise((resolve, reject) => {
        const i = new Image(); i.crossOrigin = 'anonymous';
        i.onload = () => resolve(i); i.onerror = reject; i.src = url;
      });
      const result = lm.detect(img);
      if (!result.faceLandmarks || result.faceLandmarks.length === 0) {
        setError(`${file.name}: 未检测到人脸`);
        continue;
      }
      const landmarks = result.faceLandmarks[0];
      const handles: Point[] = FACE_OVAL_INDICES.map(idx => ({ x: landmarks[idx].x, y: landmarks[idx].y }));
      const features = analyzeFace(img, handles);
      const recommended = autoRoute(features);

      const id = crypto.randomUUID();
      const item: Item = {
        id, name: file.name, image: img, landmarks,
        maskHandles: handles, features, recommended,
      };
      setItems(prev => [...prev, item]);
      setActiveId(id);
      if (autoMode && recommended.preset !== currentPreset) {
        setCurrentPreset(recommended.preset);
        setParams({ ...PRESETS[recommended.preset] });
      }
      setRecommendReason(recommended.reason);
    }
    pushHistory(true);
  }, [autoMode, currentPreset, pushHistory]);

  // active item / params 变化时重渲染输出 + 同步生成 face dataURL 给 PandaCanvas 用
  useEffect(() => {
    if (!activeItem) return;
    setProcessing(true);
    const id = requestAnimationFrame(() => {
      try {
        const out = processFace(activeItem.image, activeItem.maskHandles, activeItem.landmarks, params);
        setItems(prev => prev.map(it => it.id === activeItem.id ? { ...it, outputCanvas: out } : it));
        if (outputPreviewRef.current) {
          const c = outputPreviewRef.current;
          c.width = 320; c.height = 320;
          c.getContext('2d')!.drawImage(out, 0, 0, 320, 320);
        }
        // 也存 dataURL 给 PandaCanvas 套熊猫头预览用（与 QuickMode 共享 composeMeme 锚点对齐）
        try { setFaceDataUrl(out.toDataURL('image/png')); } catch { /* ignore */ }
        // 原图 + overlay
        drawOriginalWithOverlay(activeItem);
      } catch (e: any) {
        setError(e.message || String(e));
      } finally {
        setProcessing(false);
      }
    });
    return () => cancelAnimationFrame(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, params, activeItem?.maskHandles]);

  // 原图 + face polygon overlay
  function drawOriginalWithOverlay(item: Item) {
    const canvas = originalCanvasRef.current;
    if (!canvas) return;
    const img = item.image;
    const iw = img.naturalWidth, ih = img.naturalHeight;
    const maxDim = 640;
    const ds = Math.min(maxDim / iw, maxDim / ih, 1);
    const cw = Math.round(iw * ds), ch = Math.round(ih * ds);
    canvas.width = cw; canvas.height = ch;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0, cw, ch);
    // 圆滑 face polygon (橙色)
    ctx.strokeStyle = 'rgba(245, 197, 106, 0.9)';
    ctx.lineWidth = Math.max(2, cw / 400);
    ctx.beginPath();
    tracePolygonPath(ctx, item.maskHandles.map(h => ({ x: h.x * cw, y: h.y * ch })));
    ctx.closePath();
    ctx.stroke();
    // 拖动中的 handle hint
    if (draggingHandle >= 0 && item.maskHandles[draggingHandle]) {
      const h = item.maskHandles[draggingHandle];
      const x = h.x * cw, y = h.y * ch;
      const r = Math.max(6, cw / 80);
      ctx.fillStyle = '#E97B7B';
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
    }
  }

  // 原图 cell pointer events (polygon 拖拽)
  const onOriginalPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!activeItem) return;
    const cell = e.currentTarget;
    const canvas = originalCanvasRef.current;
    if (!canvas) return;
    const r = cell.getBoundingClientRect();
    const cw = canvas.width, ch = canvas.height;
    const cellRatio = r.width / r.height;
    const canvasRatio = cw / ch;
    let dispW, dispH, offX, offY;
    if (canvasRatio > cellRatio) { dispW = r.width; dispH = r.width / canvasRatio; offX = 0; offY = (r.height - dispH) / 2; }
    else { dispH = r.height; dispW = r.height * canvasRatio; offX = (r.width - dispW) / 2; offY = 0; }
    const mx = e.clientX - r.left - offX, my = e.clientY - r.top - offY;
    if (mx < 0 || mx > dispW || my < 0 || my > dispH) return;
    const nx = mx / dispW, ny = my / dispH;

    let nearestI = -1, nearestD = Infinity;
    activeItem.maskHandles.forEach((h, i) => {
      const d = Math.hypot(h.x - nx, h.y - ny);
      if (d < 0.04 && d < nearestD) { nearestI = i; nearestD = d; }
    });
    if (nearestI < 0 && activeItem.maskHandles.length < 64) {
      // 找最近 edge 插入新点
      const handles = activeItem.maskHandles;
      let bestSeg = -1, bestD = Infinity;
      for (let i = 0; i < handles.length; i++) {
        const a = handles[i], b = handles[(i + 1) % handles.length];
        const dx = b.x - a.x, dy = b.y - a.y;
        const len2 = dx * dx + dy * dy;
        if (len2 === 0) continue;
        let tt = ((nx - a.x) * dx + (ny - a.y) * dy) / len2;
        tt = Math.max(0, Math.min(1, tt));
        const px = a.x + dx * tt, py = a.y + dy * tt;
        const d = Math.hypot(nx - px, ny - py);
        if (d < 0.05 && d < bestD) { bestSeg = i; bestD = d; }
      }
      if (bestSeg >= 0) {
        const newHandles = [...activeItem.maskHandles];
        newHandles.splice(bestSeg + 1, 0, { x: nx, y: ny });
        setItems(prev => prev.map(it => it.id === activeItem.id ? { ...it, maskHandles: newHandles } : it));
        nearestI = bestSeg + 1;
      }
    }
    if (nearestI >= 0) {
      setDraggingHandle(nearestI);
      (cell as HTMLDivElement).setPointerCapture(e.pointerId);
      e.preventDefault();
    }
  };
  const onOriginalPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (draggingHandle < 0 || !activeItem) return;
    const cell = e.currentTarget;
    const canvas = originalCanvasRef.current;
    if (!canvas) return;
    const r = cell.getBoundingClientRect();
    const cw = canvas.width, ch = canvas.height;
    const cellRatio = r.width / r.height;
    const canvasRatio = cw / ch;
    let dispW, dispH, offX, offY;
    if (canvasRatio > cellRatio) { dispW = r.width; dispH = r.width / canvasRatio; offX = 0; offY = (r.height - dispH) / 2; }
    else { dispH = r.height; dispW = r.height * canvasRatio; offX = (r.width - dispW) / 2; offY = 0; }
    const mx = e.clientX - r.left - offX, my = e.clientY - r.top - offY;
    const nx = Math.max(0, Math.min(1, mx / dispW));
    const ny = Math.max(0, Math.min(1, my / dispH));
    setItems(prev => prev.map(it => {
      if (it.id !== activeItem.id) return it;
      const nh = [...it.maskHandles];
      nh[draggingHandle] = { x: nx, y: ny };
      return { ...it, maskHandles: nh };
    }));
  };
  const onOriginalPointerUp = () => {
    if (draggingHandle >= 0) { setDraggingHandle(-1); pushHistory(true); }
  };
  const onOriginalDblClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!activeItem || activeItem.maskHandles.length <= 8) return;
    const cell = e.currentTarget;
    const canvas = originalCanvasRef.current;
    if (!canvas) return;
    const r = cell.getBoundingClientRect();
    const cw = canvas.width, ch = canvas.height;
    const cellRatio = r.width / r.height;
    const canvasRatio = cw / ch;
    let dispW, dispH, offX, offY;
    if (canvasRatio > cellRatio) { dispW = r.width; dispH = r.width / canvasRatio; offX = 0; offY = (r.height - dispH) / 2; }
    else { dispH = r.height; dispW = r.height * canvasRatio; offX = (r.width - dispW) / 2; offY = 0; }
    const mx = e.clientX - r.left - offX, my = e.clientY - r.top - offY;
    const nx = mx / dispW, ny = my / dispH;
    let nearest = -1, nd = Infinity;
    activeItem.maskHandles.forEach((h, i) => {
      const d = Math.hypot(h.x - nx, h.y - ny);
      if (d < 0.04 && d < nd) { nearest = i; nd = d; }
    });
    if (nearest >= 0) {
      const nh = activeItem.maskHandles.filter((_, i) => i !== nearest);
      setItems(prev => prev.map(it => it.id === activeItem.id ? { ...it, maskHandles: nh } : it));
      pushHistory(true);
    }
  };

  // 预设切换
  const applyPreset = (preset: string) => {
    setCurrentPreset(preset);
    setParams({ ...PRESETS[preset] });
    setAutoMode(false);
    pushHistory(true);
  };

  // 重置 mask handles
  const resetHandles = () => {
    if (!activeItem) return;
    const handles = FACE_OVAL_INDICES.map(idx => ({ x: activeItem.landmarks[idx].x, y: activeItem.landmarks[idx].y }));
    setItems(prev => prev.map(it => it.id === activeItem.id ? { ...it, maskHandles: handles } : it));
    pushHistory(true);
  };

  // 滑块变化 → 自动 push history
  const setParam = <K extends keyof Params>(key: K, value: Params[K]) => {
    setParams(p => ({ ...p, [key]: value }));
    pushHistory();
  };

  const handleConfirm = () => {
    if (!activeItem?.outputCanvas) return;
    onConfirm(activeItem.outputCanvas.toDataURL('image/png'));
    handleClose();
  };
  const handleClose = () => {
    setItems([]); setActiveId(null); setError(''); setRecommendReason('');
    setAdvanced(false); setCurrentPreset('high-key'); setParams(PRESETS['high-key']);
    setFaceDataUrl('');
    historyRef.current = { stack: [], idx: -1 };
    onClose();
  };

  if (!isOpen) return null;

  const canUndo = historyRef.current.idx > 0;
  const canRedo = historyRef.current.idx < historyRef.current.stack.length - 1;

  // ===== Render =====
  return (
    <div className="fixed inset-0 z-[2001] flex items-center justify-center p-2" style={{ backgroundColor: 'rgba(10, 53, 109, 0.6)' }} onClick={handleClose}>
      <div className="relative w-full max-w-5xl rounded-2xl p-5 max-h-[96vh] overflow-y-auto"
           style={{ background: 'linear-gradient(180deg, #fffdf7 0%, #f7f1e3 100%)', border: '3px solid #0a4e97', boxShadow: '0 8px 24px rgba(7, 48, 95, 0.22)' }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Sparkles size={20} style={{ color: '#1767c7' }} />
            <h2 className="text-lg font-bold" style={{ color: '#0a356d' }}>{t('smartExtractTitle')}</h2>
            <span className="text-xs hidden sm:inline" style={{ color: '#456' }}>· {t('smartExtractHint')}</span>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={undo} disabled={!canUndo} title="撤销 (Ctrl+Z)"
              className="p-1.5 rounded disabled:opacity-30 disabled:cursor-not-allowed"
              style={{ color: '#0a356d' }}>
              <Undo2 size={16} />
            </button>
            <button onClick={redo} disabled={!canRedo} title="重做 (Ctrl+Shift+Z)"
              className="p-1.5 rounded disabled:opacity-30 disabled:cursor-not-allowed"
              style={{ color: '#0a356d' }}>
              <Redo2 size={16} />
            </button>
            <button onClick={handleClose} className="p-1.5 rounded" style={{ color: '#0a356d' }}>
              <X size={18} />
            </button>
          </div>
        </div>

        {loadingModel && (
          <div className="mb-3 p-2 rounded text-xs" style={{ background: 'linear-gradient(180deg, #ddf5e8 0%, #c6ecd9 100%)', border: '1.5px solid #0a8552', color: '#0a5c39', fontWeight: 600 }}>
            <span className="inline-block w-3 h-3 mr-2 border-2 border-green-700 border-r-transparent rounded-full animate-spin align-middle" />
            {t('smartExtractLoading')}
          </div>
        )}
        {error && (
          <div className="mb-3 p-2 rounded text-xs" style={{ background: 'linear-gradient(180deg, #fbe1e1 0%, #f6cbcb 100%)', border: '1.5px solid #a74040', color: '#8a2424', fontWeight: 600 }}>
            {error}
          </div>
        )}

        {/* Upload zone */}
        {items.length === 0 && !loadingModel && (
          <>
            <label className="block border-2 border-dashed rounded-xl py-8 px-6 text-center cursor-pointer transition-all hover:scale-[1.01]"
              style={{ borderColor: '#0a8552', background: 'linear-gradient(180deg, #fff 0%, #ddf5e8 100%)' }}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); const fs = Array.from(e.dataTransfer.files).filter(x => /^image\//.test(x.type)); if (fs.length) handleFiles(fs); }}>
              <Upload size={28} className="mx-auto mb-2" style={{ color: '#0a8552' }} />
              <div className="font-bold text-sm" style={{ color: '#0a356d' }}>{t('smartExtractUpload')}</div>
              <div className="text-[11px] mt-1" style={{ color: '#456', fontWeight: 500 }}>JPG / PNG / WebP · 拖拽 / 点击 · 可批量</div>
              <input type="file" accept="image/png,image/jpeg,image/jpg,image/webp" multiple className="hidden"
                onChange={e => { const fs = Array.from(e.target.files || []); if (fs.length) handleFiles(fs); (e.target as HTMLInputElement).value = ''; }} />
            </label>
            <div className="mt-3 p-3 rounded-lg text-[11px] leading-relaxed" style={{ background: 'linear-gradient(180deg, #dff0ff 0%, #d5ebff 100%)', border: '2px solid #0a4e97', color: '#0a356d' }}>
              <div className="font-bold mb-1" style={{ color: '#1767c7' }}>📌 几个小提醒</div>
              <div>· 尽量用 <b>正脸</b> 照片，效果最佳（侧脸 / 戴口罩可能识别不准）</div>
              <div>· 自动识别后可在原图上 <b>拖曲线</b> 改提取范围；<b>双击点</b> 删除多余控制点；任意空白处单击新增</div>
              <div>· 默认预设是<b>高调亮白</b>（熊猫头风格），效果不理想时再展开高级选项手动微调</div>
            </div>
          </>
        )}

        {/* Main preview area */}
        {activeItem && (
          <>
            {/* 3 列预览始终显示 — 原图 / 输出 face / 套熊猫头 */}
            <div className="grid gap-3 md:grid-cols-3 grid-cols-1">
              <div>
                <div className="flex items-center justify-between text-[11px] mb-1" style={{ color: '#456' }}>
                  <span style={{ fontWeight: 600 }}>原图 · 拖曲线 / 双击删点</span>
                  <button onClick={resetHandles} className="text-[10px] font-semibold" style={{ color: '#0a8552' }}>重置 mask</button>
                </div>
                <div
                  className="rounded-lg overflow-hidden aspect-square flex items-center justify-center select-none"
                  style={{ background: '#fff', border: '2px solid #0a4e97', cursor: draggingHandle >= 0 ? 'grabbing' : 'grab', touchAction: 'none' }}
                  onPointerDown={onOriginalPointerDown}
                  onPointerMove={onOriginalPointerMove}
                  onPointerUp={onOriginalPointerUp}
                  onPointerCancel={onOriginalPointerUp}
                  onDoubleClick={onOriginalDblClick}
                >
                  <canvas ref={originalCanvasRef} className="max-w-full max-h-full" />
                </div>
              </div>

              <div>
                <div className="text-[11px] mb-1" style={{ color: '#456', fontWeight: 600 }}>
                  输出 face {processing && <span style={{ color: '#0a8552' }}>· {t('smartExtractProcessing')}</span>}
                </div>
                <div className="rounded-lg overflow-hidden aspect-square flex items-center justify-center"
                  style={{ background: '#FFF', backgroundImage: 'repeating-conic-gradient(#F0F0F0 0% 25%, #FFF 0% 50%)', backgroundSize: '16px 16px', border: '2px solid #0a4e97' }}>
                  <canvas ref={outputPreviewRef} className="max-w-full max-h-full" />
                </div>
              </div>

              {/* 套熊猫头预览 — 用 PandaCanvas 共享 composeMeme 锚点对齐 (跟 QuickMode 完全一致) */}
              <div>
                <div className="text-[11px] mb-1" style={{ color: '#456', fontWeight: 600 }}>
                  套熊猫头预览
                  <span style={{ color: '#1767c7', marginLeft: 6, fontWeight: 500 }}>· {currentPanda.labelCn}</span>
                </div>
                <div className="rounded-lg overflow-hidden aspect-square flex items-center justify-center" style={{ background: '#FFF', border: '2px solid #0a4e97' }}>
                  {faceDataUrl ? (
                    <PandaCanvas
                      pandaSrc={currentPanda.src}
                      pandaId={currentPanda.id}
                      faceSrc={faceDataUrl}
                      faceOffset={getLivePandaFaceOffset(currentPanda)}
                      rotation={faceRotation}
                      flipX={faceFlipX}
                      faceFill={faceFill}
                      alt="套熊猫头预览"
                      style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                    />
                  ) : (
                    <span className="text-[11px]" style={{ color: '#aaa' }}>等待处理...</span>
                  )}
                </div>
              </div>
            </div>

            {/* Thumbnail strip (multiple images) */}
            {items.length > 1 && (
              <div className="flex gap-2 overflow-x-auto py-2 mt-2">
                {items.map(it => (
                  <button key={it.id} onClick={() => {
                    setActiveId(it.id);
                    if (it.recommended) setRecommendReason(it.recommended.reason);
                  }} className="flex-shrink-0 rounded-lg overflow-hidden border-2 w-12 h-12"
                    style={{ borderColor: it.id === activeId ? '#0a8552' : 'rgba(10,78,151,0.2)', background: '#fff' }}>
                    {it.outputCanvas
                      ? <canvas width={48} height={48} ref={(el) => { if (el) el.getContext('2d')!.drawImage(it.outputCanvas!, 0, 0, 48, 48); }} className="w-full h-full object-cover" />
                      : <img src={it.image.src} className="w-full h-full object-cover" alt="" />}
                  </button>
                ))}
              </div>
            )}

            {/* SIMPLE 模式参数 (3 sliders always visible) */}
            <div className="mt-3 space-y-1.5">
              <SliderRow label={t('smartExtractHeadExpand')} value={params.headExpand} min={-30} max={40}
                onChange={v => setParam('headExpand', v)} fmt={v => (v >= 0 ? '+' : '') + v + '%'} />
              <SliderRow label={t('smartExtractTrimDark')} value={params.trimDark} min={0} max={100}
                onChange={v => setParam('trimDark', v)} />
              <SliderRow label={t('smartExtractContrast')} value={params.contrast} min={0} max={100}
                onChange={v => setParam('contrast', v)} fmt={v => '+' + v} />
            </div>

            {/* ===== 预设 (always visible, above advanced) — about-arcade-btn 风格 ===== */}
            <div className="mt-3" style={{ background: '#fff', border: '2px solid #0a4e97', borderRadius: 12, padding: '8px 10px', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.55), 0 2px 6px rgba(7,48,95,0.10)' }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-bold" style={{ color: '#0a356d' }}>预设</span>
                <label className="flex items-center gap-1 text-[10px] cursor-pointer" style={{ color: '#0a356d', fontWeight: 600 }}>
                  <input type="checkbox" checked={autoMode} onChange={e => {
                    setAutoMode(e.target.checked);
                    if (e.target.checked && activeItem?.recommended && activeItem.recommended.preset !== currentPreset) {
                      applyPreset(activeItem.recommended.preset);
                      setAutoMode(true);
                    }
                  }} style={{ accentColor: '#0a4e97' }} /> 智能路由
                </label>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {(['high-key', 'ground-truth', 'lofi', 'hi-contrast'] as const).map(p => {
                  const isActive = currentPreset === p;
                  const isRecommended = activeItem?.recommended?.preset === p;
                  return (
                    <button key={p} onClick={() => applyPreset(p)}
                      className="about-arcade-btn relative"
                      style={isActive
                        ? { padding: '7px 8px', fontSize: 12, justifyContent: 'center', whiteSpace: 'nowrap' }
                        : { padding: '7px 8px', fontSize: 12, justifyContent: 'center', background: 'linear-gradient(180deg, #ffffff 0%, #e8f1fa 100%)', borderColor: '#0a4e97', color: '#0a356d', whiteSpace: 'nowrap' }}>
                      {p === 'ground-truth' ? '经典' : p === 'high-key' ? '高调亮白' : p === 'lofi' ? '低保真做旧' : '极致黑白'}
                      {isRecommended && (
                        <span style={{ position: 'absolute', top: -6, right: -4, background: 'linear-gradient(180deg, #34d4a1 0%, #10a87a 100%)', border: '1px solid #0a6e50', color: '#fff', fontSize: 9, padding: '1px 5px', borderRadius: 5, fontWeight: 700, boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }}>推荐</span>
                      )}
                    </button>
                  );
                })}
              </div>
              {recommendReason && <div className="text-[10px] mt-2" style={{ color: '#456' }}>智能：{recommendReason}</div>}
            </div>

            {/* ===== 熊猫头套壳 (always visible, above advanced) — 跟 LeftSidebar 选熊猫头风格一致 ===== */}
            <div className="mt-3" style={{ background: '#fff', border: '2px solid #0a4e97', borderRadius: 12, padding: '8px 10px', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.55), 0 2px 6px rgba(7,48,95,0.10)' }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-bold" style={{ color: '#0a356d' }}>熊猫头套壳</span>
                <span className="text-[10px]" style={{ color: '#456' }}>当前: {currentPanda.labelCn}</span>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {ALL_PANDAS.slice(0, 16).map(p => (
                  <button key={p.id} onClick={() => setPandaHeadId(p.id)}
                    className="flex-shrink-0 rounded-lg overflow-hidden"
                    title={p.labelCn}
                    style={{
                      width: 52, height: 52, padding: 2,
                      background: '#fff',
                      border: pandaHeadId === p.id ? '3px solid #1f92f8' : '2px solid rgba(10, 78, 151, 0.18)',
                      boxShadow: pandaHeadId === p.id ? '0 0 0 2px rgba(31,146,248,0.25), 0 2px 6px rgba(7,48,95,0.15)' : 'none',
                      cursor: 'pointer',
                    }}>
                    <img src={p.src} className="w-full h-full" style={{ objectFit: 'contain' }} alt={p.labelCn} draggable={false} />
                  </button>
                ))}
              </div>
            </div>

            {/* Advanced 展开按钮 — about-arcade-btn 蓝 gradient (跟整站一致) */}
            <button onClick={() => setAdvanced(a => !a)}
              className="about-arcade-btn"
              style={{ marginTop: 10, width: '100%', padding: '8px 12px', fontSize: 12, justifyContent: 'center', background: advanced ? 'linear-gradient(180deg, #34d4a1 0%, #10a87a 100%)' : undefined, borderColor: advanced ? '#0a6e50' : undefined }}>
              {advanced ? <><ChevronUp size={14} /> 收起高级选项</> : <><ChevronDown size={14} /> 展开高级选项</>}
            </button>

            {/* ADVANCED 面板 — 只放细节参数, 预设/熊猫头套壳已经在外面始终可见 */}
            {advanced && (
              <div className="mt-3 space-y-3 pt-3" style={{ borderTop: '1px dashed rgba(10, 78, 151, 0.3)' }}>
                {/* 抠图详细参数 */}
                <FieldGroup title="抠图">
                  <SliderRow label="额头延伸" value={params.foreheadExt} min={-30} max={40} onChange={v => setParam('foreheadExt', v)} fmt={v => (v >= 0 ? '+' : '') + v + '%'} />
                  <SliderRow label="下巴延伸" value={params.chinExt} min={-20} max={30} onChange={v => setParam('chinExt', v)} fmt={v => (v >= 0 ? '+' : '') + v + '%'} />
                  <SliderRow label="羽化" value={params.feather} min={0} max={40} onChange={v => setParam('feather', v)} fmt={v => v + 'px'} />
                  <SliderRow label="alpha 阈" value={params.alphaCut} min={0} max={254} onChange={v => setParam('alphaCut', v)} />
                  <SliderRow label="暗调阈值" value={params.trimThr} min={20} max={120} onChange={v => setParam('trimThr', v)} />
                </FieldGroup>

                {/* 风格化 */}
                <FieldGroup title="风格化">
                  <label className="flex items-center gap-2 text-[11px] cursor-pointer" style={{ color: '#0a356d', fontWeight: 500 }}>
                    <input type="checkbox" checked={params.autoNorm} onChange={e => setParam('autoNorm', e.target.checked)} style={{ accentColor: '#0a4e97' }} />
                    自动 normalize (histogram 拉伸)
                  </label>
                  <SliderRow label="黑场点" value={params.blackPoint} min={0} max={120} onChange={v => setParam('blackPoint', v)} />
                  <SliderRow label="白场点" value={params.whitePoint} min={135} max={255} onChange={v => setParam('whitePoint', v)} />
                  <SliderRow label="gamma" value={params.gamma} min={0.4} max={2.0} step={0.01} onChange={v => setParam('gamma', v)} fmt={v => v.toFixed(2)} />
                  <SliderRow label="线条强度" value={params.edgeStrength} min={0} max={200} onChange={v => setParam('edgeStrength', v)} />
                  <SliderRow label="饱和度" value={params.saturation} min={0} max={100} onChange={v => setParam('saturation', v)} fmt={v => v + '%'} />
                </FieldGroup>

                {/* 做旧 */}
                <FieldGroup title="做旧 (可选)">
                  <label className="flex items-center gap-2 text-[11px] cursor-pointer" style={{ color: '#0a356d', fontWeight: 500 }}>
                    <input type="checkbox" checked={params.quantize} onChange={e => setParam('quantize', e.target.checked)} style={{ accentColor: '#0a4e97' }} />
                    4 级量化
                  </label>
                  <label className="flex items-center gap-2 text-[11px] cursor-pointer" style={{ color: '#0a356d', fontWeight: 500 }}>
                    <input type="checkbox" checked={params.jpegLofi} onChange={e => setParam('jpegLofi', e.target.checked)} style={{ accentColor: '#0a4e97' }} />
                    JPEG 做旧
                  </label>
                  <SliderRow label="JPEG 质" value={params.jpegQ} min={10} max={90} onChange={v => setParam('jpegQ', v)} />
                  <SliderRow label="模糊" value={params.blur} min={0} max={30} onChange={v => setParam('blur', v)} fmt={v => v + 'px'} />
                </FieldGroup>

                {/* 套熊猫头预览参数 - 旋转/缩放/翻转 */}
                <FieldGroup title="预览微调">
                  <SliderRow label="旋转" value={faceRotation} min={-180} max={180} onChange={setFaceRotation} fmt={v => v + '°'} />
                  <SliderRow label="缩放" value={faceFill} min={0.5} max={1.3} step={0.01} onChange={setFaceFill} fmt={v => Math.round(v * 100) + '%'} />
                  <label className="flex items-center gap-2 text-[11px] cursor-pointer" style={{ color: '#0a356d', fontWeight: 500 }}>
                    <input type="checkbox" checked={faceFlipX} onChange={e => setFaceFlipX(e.target.checked)} style={{ accentColor: '#0a4e97' }} />
                    水平翻转
                  </label>
                </FieldGroup>
              </div>
            )}
          </>
        )}

        {/* Footer actions — about-arcade-btn 风格 */}
        <div className="mt-4 flex gap-2 justify-end">
          <button onClick={handleClose} className="about-arcade-btn" style={{ background: 'linear-gradient(180deg, #fff 0%, #e8e8e8 100%)', borderColor: '#888', color: '#0a356d', padding: '10px 16px', fontSize: 14 }}>
            {t('smartExtractCancel')}
          </button>
          <button onClick={handleConfirm} disabled={!activeItem?.outputCanvas || processing}
            className="about-arcade-btn disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ padding: '10px 16px', fontSize: 14 }}>
            <Check size={14} />
            {t('smartExtractConfirm')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Subcomponents
// ============================================================
function SliderRow({ label, value, min, max, step = 1, onChange, fmt = v => String(v) }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; fmt?: (v: number) => string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] flex-shrink-0" style={{ color: '#0a356d', fontWeight: 600, width: 72 }}>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="flex-1"
        style={{ accentColor: '#0a4e97' }} />
      <span className="text-[11px] font-mono flex-shrink-0 text-right" style={{ color: '#0a356d', fontWeight: 700, width: 48 }}>{fmt(value)}</span>
    </div>
  );
}

function FieldGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2" style={{ background: 'rgba(255, 255, 255, 0.6)', border: '1px solid rgba(10, 78, 151, 0.2)', borderRadius: 10, padding: '8px 12px' }}>
      <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: '#1767c7' }}>{title}</div>
      {children}
    </div>
  );
}
