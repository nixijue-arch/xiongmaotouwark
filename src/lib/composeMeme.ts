// composeMeme — canvas-based panda + face 合成（v4 — bbox crop + 等比例输出）
//
// 核心问题（用户多轮反馈解决）：
//   1. <img> 双 overlay 方案：face 白边 cover panda 黑廓
//   2. v1 white-mask：描边款 panda（透明脸区）face 完全消失
//   3. v2 face-mask "非暗-opaque"：face 撑满 faceOffset 矩形，旋转后漏角
//   4. v3 ellipse + dark-out：解决漏角，但 panda 在画布里"忽大忽小"，因为不同 panda PNG
//      包含不同程度的 whitespace padding，object-fit:contain 把 padding 算进去
//   5. v4 (本版本): bbox crop —— 检测 panda alpha>50 的 bbox，输出画布尺寸 = bbox 比例
//      panda 内容总是填满输出画布，不再"忽大忽小"；caption 在 DOM 里 flex 紧贴下方
//
// 渲染管线 v4:
//   a. detect panda content bbox in native PNG (alpha>50)
//   b. output canvas size = bbox 比例 缩放到 max=size
//   c. draw cropped panda (bbox region) → fills output canvas
//   d. faceOffset 350-coord → native pixel → cropped canvas pixel 三步换算
//   e. face into temp canvas at face position (with rotation/flip)
//   f. ellipse mask (constrains face to oval inside faceOffset)
//   g. destination-out + dark-opaque mask (preserves sunglasses/signs)
//   h. composite face onto cropped panda
//
// Contributed by PandaHead (https://pandahead.fun · github.com/jokkibtc/panda)

const _imgCache = new Map<string, Promise<HTMLImageElement>>();

export function loadImage(src: string): Promise<HTMLImageElement> {
  const hit = _imgCache.get(src);
  if (hit) return hit;
  const p = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => {
      _imgCache.delete(src);
      reject(new Error(`loadImage fail: ${src}`));
    };
    img.src = src;
  });
  _imgCache.set(src, p);
  return p;
}

export type Bbox = [number, number, number, number]; // [x1, y1, x2, y2]

const _bboxCache = new Map<string, Bbox>();

// 把 face PNG 按 alpha>50 的 bbox 抠出来 → 紧凑 dataURL, 加上 padding 防边缘 alpha-clip
// 编辑器加 face 元素时用 — 元素尺寸 = bbox 而不是 naturalWidth 含的大量透明 padding
// 这样 face 在 panda anchor 里精确就位, 不会因为 PNG 含 padding 撑得过大
export async function bboxCropImage(src: string, padPx = 4): Promise<{ dataUrl: string; w: number; h: number }> {
  const img = await loadImage(src);
  const [x1, y1, x2, y2] = getContentBbox(img);
  const cw = Math.max(1, x2 - x1);
  const ch = Math.max(1, y2 - y1);
  const c = document.createElement('canvas');
  c.width = cw + padPx * 2;
  c.height = ch + padPx * 2;
  c.getContext('2d')!.drawImage(img, x1, y1, cw, ch, padPx, padPx, cw, ch);
  return { dataUrl: c.toDataURL('image/png'), w: c.width, h: c.height };
}

// 检测 PNG 内 alpha>thresh 像素的 bounding box
// 共用给 panda（去 whitespace padding）和 face（找五官 content bbox 当 content_center）
// 借鉴 PandaHead build_assets.py 的 detect_content_center 思路：用户手截 face 常 crop 不居中，
// 必须算实际像素聚类中心而不是几何中心，否则五官会偏移
export function getContentBbox(img: HTMLImageElement, alphaThresh = 50): Bbox {
  const key = `${img.src}|${alphaThresh}`;
  const cached = _bboxCache.get(key);
  if (cached) return cached;
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  // 性能: 先按 max 512 缩小到一个工作 canvas, 再扫像素
  // 1024+ 的原图扫 1M+ 像素要 50-200ms, 缩到 ≤512 后扫 ≤262K 像素仅 5-20ms
  // bbox 精度按缩放比例反推, 对 anchor 对齐够用 (允许 ±2px 误差)
  const MAX_SCAN = 512;
  const scanScale = Math.min(1, MAX_SCAN / Math.max(W, H));
  const SW = Math.max(1, Math.round(W * scanScale));
  const SH = Math.max(1, Math.round(H * scanScale));
  const c = document.createElement('canvas');
  c.width = SW;
  c.height = SH;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('canvas 2d ctx unavailable');
  ctx.drawImage(img, 0, 0, SW, SH);
  const data = ctx.getImageData(0, 0, SW, SH).data;
  let x1 = SW;
  let y1 = SH;
  let x2 = -1;
  let y2 = -1;
  for (let y = 0; y < SH; y++) {
    const rowBase = y * SW * 4;
    for (let x = 0; x < SW; x++) {
      const a = data[rowBase + x * 4 + 3];
      if (a > alphaThresh) {
        if (x < x1) x1 = x;
        if (y < y1) y1 = y;
        if (x > x2) x2 = x;
        if (y > y2) y2 = y;
      }
    }
  }
  // 缩放还原到原图坐标系
  const inv = 1 / scanScale;
  const bbox: Bbox = x2 < 0
    ? [0, 0, W, H]
    : [Math.floor(x1 * inv), Math.floor(y1 * inv), Math.min(W, Math.ceil((x2 + 1) * inv)), Math.min(H, Math.ceil((y2 + 1) * inv))];
  _bboxCache.set(key, bbox);
  return bbox;
}

const _darkMaskCache = new Map<string, HTMLCanvasElement>();

// panda 暗-opaque pixel mask in CROPPED canvas coordinates
// cache by src + crop bbox + output dimensions
// destination-out 用：从 face 减去这些像素，保留 panda 黑廓/墨镜/暗道具
function getPandaDarkMaskCropped(
  panda: HTMLImageElement,
  bbox: Bbox,
  Wout: number,
  Hout: number,
): HTMLCanvasElement {
  const key = `${panda.src}|${bbox.join(',')}|${Wout}x${Hout}`;
  const cached = _darkMaskCache.get(key);
  if (cached) return cached;
  const c = document.createElement('canvas');
  c.width = Wout;
  c.height = Hout;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('canvas 2d ctx unavailable');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const [bx1, by1, bx2, by2] = bbox;
  ctx.drawImage(panda, bx1, by1, bx2 - bx1, by2 - by1, 0, 0, Wout, Hout);
  const data = ctx.getImageData(0, 0, Wout, Hout);
  const arr = data.data;
  for (let i = 0; i < arr.length; i += 4) {
    const r = arr[i];
    const g = arr[i + 1];
    const b = arr[i + 2];
    const a = arr[i + 3];
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    const isDarkOpaque = a > 200 && luma < 80;
    arr[i] = 0;
    arr[i + 1] = 0;
    arr[i + 2] = 0;
    arr[i + 3] = isDarkOpaque ? 255 : 0;
  }
  ctx.putImageData(data, 0, 0);
  _darkMaskCache.set(key, c);
  return c;
}

export interface ComposeOpts {
  panda: HTMLImageElement;
  face: HTMLImageElement;
  faceOffset: { x: number; y: number; w: number; h: number }; // 350-coord space (align_panda.py)
  rotation?: number; // degrees
  flipX?: boolean;
  size?: number; // max output dim (proportional output may be Wout=size, Hout<size 或反之)
  faceFill?: number; // face content bbox 占 anchor 的比例，default 0.95
}

export function composeMemeCanvas(opts: ComposeOpts): HTMLCanvasElement {
  const { panda, face, faceOffset, rotation = 0, flipX = false, size = 1024, faceFill = 0.95 } = opts;

  // 1. 检测 panda 实际内容 bbox（去 whitespace）
  const bbox = getContentBbox(panda);
  const [bx1, by1, bx2, by2] = bbox;
  const BW = bx2 - bx1;
  const BH = by2 - by1;

  // 2. 输出画布：bbox 比例缩放到 max dim = size
  const outScale = Math.min(size / BW, size / BH);
  const Wout = Math.max(1, Math.round(BW * outScale));
  const Hout = Math.max(1, Math.round(BH * outScale));

  const main = document.createElement('canvas');
  main.width = Wout;
  main.height = Hout;
  const mctx = main.getContext('2d');
  if (!mctx) throw new Error('canvas 2d ctx unavailable');
  mctx.imageSmoothingEnabled = true;
  mctx.imageSmoothingQuality = 'high';

  // 3. 画 cropped panda — 覆盖整个输出画布
  mctx.drawImage(panda, bx1, by1, BW, BH, 0, 0, Wout, Hout);

  // 4. faceOffset 三步换算: 350-coord → native pixel → cropped canvas pixel
  //    align_panda.py: x_350 = native_x * scale_orig + pad_x_orig
  //    where scale_orig = min(350/NW, 350/NH), pad = letterbox padding
  //    反推 native: native_x = (x_350 - pad_x_orig) / scale_orig
  //    再到 cropped: crop_x = (native_x - bx1) * outScale
  const NW = panda.naturalWidth;
  const NH = panda.naturalHeight;
  const scaleOrig = Math.min(350 / NW, 350 / NH);
  const padXOrig = (350 - NW * scaleOrig) / 2;
  const padYOrig = (350 - NH * scaleOrig) / 2;

  const nfx1 = (faceOffset.x - padXOrig) / scaleOrig;
  const nfy1 = (faceOffset.y - padYOrig) / scaleOrig;
  const nfw = faceOffset.w / scaleOrig;
  const nfh = faceOffset.h / scaleOrig;

  const fox = (nfx1 - bx1) * outScale;
  const foy = (nfy1 - by1) * outScale;
  const fow = nfw * outScale;
  const foh = nfh * outScale;

  // 5. face 画到临时 canvas (rotation/flip 围绕 face content 中心)
  //
  // 关键 SOP（feedback_engineering.md "Face content_center 对齐"）：
  //   pmw face PNG 经 flood-fill 透明化后，PNG 整体尺寸含大量透明 padding
  //   → 用 face.naturalWidth/Height 算 scale 五官只占 fow×foh 的小子区域 → 视觉上太小
  //   → 用几何中心对齐五官也会偏移
  // 修法（仿 PandaHead drawFaceLayer + content_center 预存机制的 runtime 版）：
  //   a) 算 face content bbox (alpha>50 边界) — 五官实际占的区域
  //   b) scale = min(fow/contentW, foh/contentH) * FACE_FILL → 五官填满 faceOffset
  //   c) content bbox 中心代替几何中心做 drawImage 偏移 → 五官居中
  // faceFill = 0.95 默认（已有 ellipse mask 边缘平滑，比 PandaHead 0.92 紧一点）
  // 校准工具可传不同值调五官饱满度
  const fc = document.createElement('canvas');
  fc.width = Wout;
  fc.height = Hout;
  const fctx = fc.getContext('2d');
  if (!fctx) throw new Error('canvas 2d ctx unavailable');
  fctx.imageSmoothingEnabled = true;
  fctx.imageSmoothingQuality = 'high';

  const FW = face.naturalWidth;
  const FH = face.naturalHeight;
  const faceBbox = getContentBbox(face);
  const fcw = Math.max(1, faceBbox[2] - faceBbox[0]); // face content 实际宽
  const fch = Math.max(1, faceBbox[3] - faceBbox[1]); // face content 实际高
  const faceScale = Math.min(fow / fcw, foh / fch) * faceFill;
  const drawFw = FW * faceScale;
  const drawFh = FH * faceScale;
  // content center 在缩放后 PNG 坐标系里
  const ccX = ((faceBbox[0] + faceBbox[2]) / 2) * faceScale;
  const ccY = ((faceBbox[1] + faceBbox[3]) / 2) * faceScale;

  fctx.save();
  fctx.translate(fox + fow / 2, foy + foh / 2);
  if (rotation) fctx.rotate((rotation * Math.PI) / 180);
  if (flipX) fctx.scale(-1, 1);
  // 用 content center 偏移而不是几何中心 — 把五官中心对齐到 anchor 中心
  fctx.drawImage(face, -ccX, -ccY, drawFw, drawFh);
  fctx.restore();

  // 6. 双 mask 裁 face：
  //    a) ellipse: face 限制在 faceOffset 椭圆内 — 防 rect 角漏出（rotation 时尤其重要）
  //    b) destination-out + dark mask: 减 panda 黑廓/墨镜/暗道具 — 保留它们盖在 face 上
  fctx.globalCompositeOperation = 'destination-in';
  fctx.beginPath();
  fctx.ellipse(fox + fow / 2, foy + foh / 2, fow / 2, foh / 2, 0, 0, Math.PI * 2);
  fctx.fillStyle = '#fff';
  fctx.fill();
  fctx.globalCompositeOperation = 'destination-out';
  const dmask = getPandaDarkMaskCropped(panda, bbox, Wout, Hout);
  fctx.drawImage(dmask, 0, 0);
  fctx.globalCompositeOperation = 'source-over';

  // 7. composite face onto cropped panda
  mctx.drawImage(fc, 0, 0);
  return main;
}

export interface ComposeMemeArgs {
  pandaSrc: string;
  faceSrc: string;
  faceOffset: { x: number; y: number; w: number; h: number };
  rotation?: number;
  flipX?: boolean;
  size?: number;
  faceFill?: number;
}

// 性能优化:
//   1. LRU cache 已合成结果 → 重复 panda+face 组合即刻返回 (random combo 二轮起步)
//   2. canvas.toBlob + URL.createObjectURL 取代 canvas.toDataURL
//      toDataURL 是同步 PNG 编码, 1024×1024 阻塞主线程 200-500ms = 用户感觉"卡住"
//      toBlob 异步, 编码不阻塞 UI; objectURL 比 base64 dataURL 短 10倍, img 加载更快
//   3. PandaCanvas + QuickMode 把 size 从默认 1024 降到 512 给 preview
//      4× 减少编码字节数 = 4× 提速 (下载/复制时单独传 size=1024 拿高清)
const _composedCache = new Map<string, string>();
const COMPOSED_CACHE_LIMIT = 100;

function makeComposedCacheKey(args: ComposeMemeArgs): string {
  return [
    args.pandaSrc, args.faceSrc,
    args.faceOffset.x, args.faceOffset.y, args.faceOffset.w, args.faceOffset.h,
    args.rotation ?? 0, args.flipX ? 1 : 0,
    args.size ?? 1024,
    args.faceFill ?? 0.95,
  ].join('|');
}

function canvasToBlobUrl(canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error('toBlob failed'));
      resolve(URL.createObjectURL(blob));
    }, 'image/png');
  });
}

export async function composeMeme(args: ComposeMemeArgs): Promise<string> {
  const cacheKey = makeComposedCacheKey(args);
  const cached = _composedCache.get(cacheKey);
  if (cached) {
    // LRU: 取出再 set 让它移到末尾 (Map 保 insertion order)
    _composedCache.delete(cacheKey);
    _composedCache.set(cacheKey, cached);
    return cached;
  }

  const [panda, face] = await Promise.all([loadImage(args.pandaSrc), loadImage(args.faceSrc)]);
  const c = composeMemeCanvas({
    panda,
    face,
    faceOffset: args.faceOffset,
    rotation: args.rotation,
    flipX: args.flipX,
    size: args.size,
    faceFill: args.faceFill,
  });
  const url = await canvasToBlobUrl(c);

  // LRU 淘汰最旧 (淘汰时不立刻 revoke, 因为可能还有 <img> 在用; 浏览器最终会 GC)
  if (_composedCache.size >= COMPOSED_CACHE_LIMIT) {
    const firstKey = _composedCache.keys().next().value;
    if (firstKey) _composedCache.delete(firstKey);
  }
  _composedCache.set(cacheKey, url);
  return url;
}

// 算 face 元素在编辑器（panda 占 350×350 box）里的实际位置 + 大小
// 用同 composeMemeCanvas 的 face content_center 公式，让编辑器里的 face 跟草图卡片视觉一致
// 编辑器画 panda 是 350×350，face 是独立 image 元素 — 用此函数算 face 元素的 x/y/width/height
export async function calcEditorFaceLayout(args: {
  pandaSrc: string;
  faceSrc: string;
  faceOffset350: { x: number; y: number; w: number; h: number };
  faceFill?: number;
  panda350OffsetX?: number; // panda 在编辑器 canvas 里的左上角 X (default 75，跟现有 panda x:75 一致)
  panda350OffsetY?: number; // default 50
}): Promise<{ x: number; y: number; width: number; height: number }> {
  const { pandaSrc, faceSrc, faceOffset350, faceFill = 0.95, panda350OffsetX = 75, panda350OffsetY = 50 } = args;
  const [, face] = await Promise.all([loadImage(pandaSrc), loadImage(faceSrc)]);
  const fbb = getContentBbox(face);
  const fcw = Math.max(1, fbb[2] - fbb[0]);
  const fch = Math.max(1, fbb[3] - fbb[1]);
  const fScale = Math.min(faceOffset350.w / fcw, faceOffset350.h / fch) * faceFill;
  const dispW = face.naturalWidth * fScale;
  const dispH = face.naturalHeight * fScale;
  const ccX = ((fbb[0] + fbb[2]) / 2) * fScale;
  const ccY = ((fbb[1] + fbb[3]) / 2) * fScale;
  // anchor 在编辑器画布坐标系 (350-coord + panda offset)
  const anchorCx = panda350OffsetX + faceOffset350.x + faceOffset350.w / 2;
  const anchorCy = panda350OffsetY + faceOffset350.y + faceOffset350.h / 2;
  return {
    x: Math.round(anchorCx - ccX),
    y: Math.round(anchorCy - ccY),
    width: Math.round(dispW),
    height: Math.round(dispH),
  };
}

export async function composeMemeBlob(args: ComposeMemeArgs): Promise<Blob> {
  const [panda, face] = await Promise.all([loadImage(args.pandaSrc), loadImage(args.faceSrc)]);
  const c = composeMemeCanvas({
    panda,
    face,
    faceOffset: args.faceOffset,
    rotation: args.rotation,
    flipX: args.flipX,
    size: args.size,
    faceFill: args.faceFill,
  });
  return new Promise<Blob>((resolve, reject) => {
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
  });
}

// 给校准工具用：直接把已加载的 image 喂进去，跳过 loadImage（同步获 native 尺寸）
export function composeMemeCanvasSync(opts: ComposeOpts): HTMLCanvasElement {
  return composeMemeCanvas(opts);
}
