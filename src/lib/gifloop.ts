// gifloop.ts — GIF 循环引擎 (P1: normal + boomerang). 纯逻辑, 在 animcore 合成器之上加
// "时间重映射 + 帧序列 + 循环安全动作". crossfade / 多变体 / onion-skin 见 P2.
import {
  renderExportFrame, loadMedia, clamp, resolveGifPreset, GIF_MAX_DURATION, DEFAULT_TRANSFORM,
  type Clip, type ImageClip, type GifPresetId, type MediaAsset, type LoopMotion, type MotionDelta, type Transform, type FaceLocal, type BoundFaceBox,
} from '@/lib/animcore';

export type GifLoopMode = 'normal' | 'boomerang' | 'reverse' | 'rewind' | 'crossfade';
export interface GifLoopConfig {
  mode: GifLoopMode;
  crossfadeSec: number;   // 仅 crossfade 用 (P2)
  loopCount: number;      // 导出烘焙循环数, 默认 1 (gif.js repeat:0 已无限循环)
  onionSkin: boolean;     // 预览首帧叠尾帧 (P2)
  showSeamScore: boolean; // 预览循环质量
}
export const DEFAULT_LOOP_CONFIG: GifLoopConfig = {
  mode: 'normal', crossfadeSec: 0.25, loopCount: 1, onionSkin: false, showSeamScore: true,
};

// GIF 项目 — 独立于视频 ProjectState. 无 tts/bgm. clips 全是 [0,duration] 全幅图层 (无时间轴).
export interface GifProject {
  kind: 'gif-project';
  version: 1;
  clips: Clip[];                                   // 仅 'image' | 'caption' (P1)
  lanes: { image: number; caption: number; fx: number };
  duration: number;                                // s, <= GIF_MAX_DURATION
  preset: GifPresetId;
  loop: GifLoopConfig;
}

const TWO_PI = Math.PI * 2;
const ZERO_DELTA: MotionDelta = { dx: 0, dy: 0, dScale: 1, dRot: 0 };

// 连续播放位置 → 显示时间. boomerang 乒乓 0→D→0 (数学无缝).
export function loopTimeMap(playPos: number, D: number, mode: GifLoopMode): number {
  if (D <= 0) return 0;
  if (mode === 'boomerang') {
    const period = 2 * D;
    const p = ((playPos % period) + period) % period;
    return p <= D ? p : 2 * D - p;
  }
  if (mode === 'reverse') {
    // 整段倒着放: 显示时间从 D→0 循环
    return D - (((playPos % D) + D) % D);
  }
  if (mode === 'rewind') {
    // 正放 D + 急速倒带 rewindD (回开头), 强"卡带"节奏
    const rewindD = D * 0.28;
    const period = D + rewindD;
    const p = ((playPos % period) + period) % period;
    return p < D ? p : D * (1 - (p - D) / rewindD);
  }
  return ((playPos % D) + D) % D;
}

export interface LoopFrameSpec { t: number; blendWith?: number; blendAlpha?: number; }

// 导出帧时间序列. P1: normal + boomerang (端点不重复). crossfade 见 P2.
export function buildExportFrameTimes(D: number, fps: number, config: GifLoopConfig): LoopFrameSpec[] {
  const dt = 1 / fps;
  const n = Math.max(1, Math.round(D * fps));
  const out: LoopFrameSpec[] = [];
  if (config.mode === 'boomerang' && n > 2) {
    for (let i = 0; i < n; i++) out.push({ t: i * dt });        // 正放 0..(n-1)dt
    for (let i = n - 2; i >= 1; i--) out.push({ t: i * dt });   // 倒放, 跳过两端
    return out;
  }
  if (config.mode === 'crossfade' && n > 2) {
    const xf = clamp(config.crossfadeSec, dt, D * 0.4);
    const tailStart = D - xf;
    for (let i = 0; i < n; i++) {
      const t = i * dt;
      if (t >= tailStart) out.push({ t, blendWith: t - tailStart, blendAlpha: (t - tailStart) / xf });  // 尾段溶进开头
      else out.push({ t });
    }
    return out;
  }
  if (config.mode === 'reverse') {
    for (let i = n - 1; i >= 0; i--) out.push({ t: i * dt });     // 整段倒放
    return out;
  }
  if (config.mode === 'rewind' && n > 2) {
    for (let i = 0; i < n; i++) out.push({ t: i * dt });          // 正放
    for (let i = n - 1; i >= 0; i -= 3) out.push({ t: i * dt });  // 急退: 抽 1/3 帧 (同 delay 显得快)
    return out;
  }
  for (let i = 0; i < n; i++) out.push({ t: i * dt });           // normal
  return out;
}

// 预览用 — 某显示时间 t 的 spec (crossfade 尾段返回 blend 信息). normal/boomerang 直接 {t}.
// fps 传入跟导出对齐 (n<=2 不溶解 + xf 下限=1帧), 防"预览溶解但导出直放"的所见非所得.
export function loopSpecAt(t: number, D: number, config: GifLoopConfig, fps = 30): LoopFrameSpec {
  if (config.mode === 'crossfade' && D > 0) {
    const dt = 1 / fps;
    if (Math.max(1, Math.round(D * fps)) <= 2) return { t };  // 跟 buildExportFrameTimes 的 n>2 guard 一致
    const xf = clamp(config.crossfadeSec, dt, D * 0.4);        // 下限 dt 跟导出一致
    const tailStart = D - xf;
    if (t >= tailStart) return { t, blendWith: t - tailStart, blendAlpha: (t - tailStart) / xf };
  }
  return { t };
}

// 循环安全动作 — 相位锁 u=(t/D)mod1 + 整数周期 n → f(0)==f(1) 必然闭环.
// amp 归一化 (0~1.5 常用), 内部按动作种类换算成 px / 度 / 比例.
export function loopMotionDelta(m: LoopMotion | undefined, t: number, D: number, W: number, H: number = W, base?: Transform): MotionDelta {
  if (!m || m.kind === 'none' || D <= 0) return ZERO_DELTA;
  const u = (((t / D) % 1) + 1) % 1;
  const n = Math.max(1, Math.round(m.cycles));
  const A = m.amp;
  const ph = TWO_PI * n * u;
  switch (m.kind) {
    case 'bob':       return { dx: 0, dy: A * W * 0.06 * Math.sin(ph), dScale: 1, dRot: 0 };
    case 'shimmy':    return { dx: A * W * 0.06 * Math.sin(ph), dy: 0, dScale: 1, dRot: 0 };
    case 'sway':      return { dx: 0, dy: 0, dScale: 1, dRot: A * 12 * Math.sin(ph) };
    case 'breathe':   return { dx: 0, dy: 0, dScale: 1 + A * 0.12 * Math.sin(ph), dRot: 0 };
    case 'pulseLoop': return { dx: 0, dy: 0, dScale: 1 + A * 0.20 * (0.5 - 0.5 * Math.cos(ph)), dRot: 0 };
    case 'spin360':   return { dx: 0, dy: 0, dScale: 1, dRot: 360 * n * u };
    case 'float':     return { dx: A * W * 0.05 * Math.sin(ph), dy: A * W * 0.03 * Math.sin(2 * ph), dScale: 1, dRot: 0 };
    // 弹跳 — |sin| 触地反弹 (u=0 与 u末 都=0, 无缝)
    case 'bounce':    return { dx: 0, dy: -A * W * 0.09 * Math.abs(Math.sin(ph)), dScale: 1, dRot: 0 };
    // 圆周漂移 — (sin, cos-1) 绕一点转圈 (u=0/末 都回原点, 无缝)
    case 'orbit':     return { dx: A * W * 0.05 * Math.sin(ph), dy: A * W * 0.05 * (Math.cos(ph) - 1), dScale: 1, dRot: 0 };
    // v25 鬼畜系 — 都是 sin/cos/|sin| of 整数×ph, u=0/1 必闭环. 内部已 bake 较高频率, cycles=1 也"很动"
    case 'hop':       return { dx: A * W * 0.10 * Math.sin(ph), dy: -A * W * 0.05 * Math.abs(Math.sin(2 * ph)), dScale: 1, dRot: 0 };          // 来回横跳 + 小跳
    case 'wobble':    return { dx: 0, dy: 0, dScale: 1 + A * 0.05 * Math.sin(3 * ph), dRot: A * 10 * Math.sin(2 * ph) };                       // 果冻晃 (转+缩)
    case 'jitter':    return { dx: A * W * 0.028 * Math.sin(3 * ph), dy: A * W * 0.026 * Math.sin(4 * ph), dScale: 1, dRot: A * 3 * Math.sin(5 * ph) }; // 疯狂抖 intensify
    case 'punch':     return { dx: 0, dy: 0, dScale: 1 + A * 0.32 * (0.5 - 0.5 * Math.cos(ph)), dRot: 0 };                                     // 怼脸放大 (zoom in→out)
    case 'swing':     return { dx: A * W * 0.03 * Math.sin(ph), dy: 0, dScale: 1, dRot: A * 16 * Math.sin(ph) };                              // 钟摆荡
    case 'flip':      return { dx: 0, dy: 0, dScale: 1, dRot: 0, dScaleX: 1 - Math.min(1, A) * (1 - Math.cos(ph)) };                          // 水平镜像翻转 (绕竖轴翻牌; A=1 整翻 1→-1→1, A<1 半翻; u=0/1 都=1 闭环)
    // 自定义移动 A→B 乒乓 — w 三角波 0→1→0, 首尾 w=0 必无缝. A=base(clip.transform), B=m.to
    case 'customMove': {
      if (!m.to || !base) return ZERO_DELTA;
      // cycles(速度): 每循环往返 n 次 (三角波频率 n, u=0/1 必 w=0 闭环); amp(幅度): 缩放 A→B 位移 (1=到B, 1.5=过冲, 0.5=半程)
      const cu = (n * u) % 1;
      const w = (cu < 0.5 ? cu * 2 : (1 - cu) * 2) * A;
      return {
        dx: ((m.to.x - base.x) / 100) * W * w,
        dy: ((m.to.y - base.y) / 100) * H * w,
        dScale: 1 + ((m.to.scale / Math.max(0.01, base.scale)) - 1) * w,
        dRot: (m.to.rotation - base.rotation) * w,
      };
    }
    default:          return ZERO_DELTA;
  }
}

// 给 renderExportFrame 的 motionAt resolver — 从每个 image clip 的 loopMotion 算 delta.
// H 用于非方形画板的垂直换算; customMove 取 clip.transform 作 A.
export function makeLoopMotionAt(D: number, W: number, H: number = W): (clip: ImageClip, t: number) => MotionDelta {
  return (clip, t) => loopMotionDelta(clip.loopMotion, t, D, W, H, clip.transform);
}

// 脸跟壳绑定 — 捕获 face 相对 shell 静态渲染框的局部位姿 (绑定瞬间, 不含 motion). 在 shell 未旋转坐标系下存偏移 → 之后施加 shell.rot 即可重旋.
export function captureFaceLocal(
  shellBox: { cx: number; cy: number; iw: number }, shellRot: number,
  faceBox: { cx: number; cy: number; iw: number }, faceRot: number,
): FaceLocal {
  const half = Math.max(1, shellBox.iw / 2);
  const dxW = faceBox.cx - shellBox.cx, dyW = faceBox.cy - shellBox.cy;
  const cos = Math.cos(-shellRot * Math.PI / 180), sin = Math.sin(-shellRot * Math.PI / 180);
  return {
    dxN: (dxW * cos - dyW * sin) / half,
    dyN: (dxW * sin + dyW * cos) / half,
    scaleRatio: faceBox.iw / Math.max(1, shellBox.iw),
    rotation: faceRot - shellRot,
  };
}

// 绑定脸的世界渲染框 @t = shell 实时框(transform + shell loopMotion) ∘ faceLocal + face 自身 loopMotion. 预览+导出共用 → 不会分叉.
export function resolveBoundFaceBox(
  face: ImageClip, shell: ImageClip, t: number, D: number, W: number, H: number,
  shellNaturalW: number, shellNaturalH: number, faceNaturalW: number, faceNaturalH: number,
): BoundFaceBox {
  const loc = face.faceLocal ?? { dxN: 0, dyN: 0, scaleRatio: 1, rotation: 0 };
  const sTr = shell.transform ?? DEFAULT_TRANSFORM;
  const fTr = face.transform ?? DEFAULT_TRANSFORM;
  // 1. shell 实时框 (镜像 renderExportFrame 非 scene 框算法 + 0.85H 钳 + shell loopMotion)
  const baseSize = Math.min(W, H) * 0.6;
  let sIw = baseSize * sTr.scale;
  let sIh = (shellNaturalH / Math.max(1, shellNaturalW)) * sIw;
  const maxH = H * 0.85;
  if (sIh > maxH) { const k = maxH / sIh; sIw *= k; sIh *= k; }
  const sMd = loopMotionDelta(shell.loopMotion, t, D, W, H, sTr);
  sIw *= sMd.dScale;
  const sCx = W / 2 + (sTr.x / 100) * W + sMd.dx;
  const sCy = H / 2 + (sTr.y / 100) * H + sMd.dy;
  const sRot = sTr.rotation + sMd.dRot;
  // 2. face 世界位姿 = shell 框 ∘ faceLocal (偏移按 shell 半宽 + 旋到 shell 角)
  const half = sIw / 2;
  const rad = sRot * Math.PI / 180, cos = Math.cos(rad), sin = Math.sin(rad);
  let fCx = sCx + (loc.dxN * cos - loc.dyN * sin) * half;
  let fCy = sCy + (loc.dxN * sin + loc.dyN * cos) * half;
  let fIw = sIw * loc.scaleRatio;
  let fIh = fIw * (faceNaturalH / Math.max(1, faceNaturalW));
  if (fIh > H * 0.85) { const fk = (H * 0.85) / fIh; fIw *= fk; fIh *= fk; }   // 跟非绑定渲染的 0.85H 钳一致 (修解绑跳变 + 预览/导出一致)
  let fRot = sRot + loc.rotation;
  // 3. face 自身 loopMotion (局部加, dx/dy 旋到世界)
  const fMd = loopMotionDelta(face.loopMotion, t, D, W, H, fTr);
  fIw *= fMd.dScale; fIh *= fMd.dScale;
  fCx += fMd.dx * cos - fMd.dy * sin;
  fCy += fMd.dx * sin + fMd.dy * cos;
  fRot += fMd.dRot;
  return { cx: fCx, cy: fCy, iw: fIw, ih: fIh, rotation: fRot, flipX: fTr.flipX };
}

export function makeBoundFaceAt(D: number, W: number, H: number) {
  return (face: ImageClip, shell: ImageClip, t: number, sNW: number, sNH: number, fNW: number, fNH: number): BoundFaceBox =>
    resolveBoundFaceBox(face, shell, t, D, W, H, sNW, sNH, fNW, fNH);
}

// 渲染一帧 (P1 无 crossfade — 直接合成器 + motionAt). spec.blendWith 留给 P2.
export function renderLoopFrame(
  ctx: CanvasRenderingContext2D,
  spec: LoopFrameSpec,
  project: GifProject,
  W: number,
  H: number,
  cache: Map<string, MediaAsset>,
  motionAt?: (clip: ImageClip, t: number) => MotionDelta,
  scratch?: CanvasRenderingContext2D,   // crossfade 的 head 层
  bgColor: string = '#ffffff',          // GIF 画板默认白 (跟视频预览画板一致). 白底 crossfade 仍正确 (溶解透过白)
  boundFaceAt?: (face: ImageClip, shell: ImageClip, t: number, sNW: number, sNH: number, fNW: number, fNH: number) => BoundFaceBox,  // 绑定脸跟壳
): void {
  if (spec.blendWith === undefined || spec.blendAlpha === undefined || !scratch) {
    renderExportFrame(ctx, spec.t, project, W, H, cache, motionAt, bgColor, 'all', boundFaceAt);   // 非 crossfade: 整帧 (含字幕)
    return;
  }
  // crossfade: 只混"图层"(尾段溶进开头), 字幕单独在顶层画一次 — 防溶解时字幕重影 (双帧各画一次字幕)
  renderExportFrame(ctx, spec.t, project, W, H, cache, motionAt, bgColor, 'images', boundFaceAt);           // 主(尾)帧图层
  renderExportFrame(scratch, spec.blendWith, project, W, H, cache, motionAt, bgColor, 'images', boundFaceAt); // 头帧图层 → scratch
  ctx.save();
  ctx.globalAlpha = spec.blendAlpha;
  ctx.drawImage(scratch.canvas, 0, 0, W, H);
  ctx.restore();
  renderExportFrame(ctx, spec.t, project, W, H, cache, motionAt, bgColor, 'captions');         // 字幕只画一次, 顶层不参与溶解
}

// 循环质量 0(完美闭环)..100(差). 把首帧/尾帧下采样到 32×32 算 RGB 平均绝对差.
export function loopSeamScore(a: HTMLCanvasElement, b: HTMLCanvasElement): number {
  const S = 32;
  const ca = document.createElement('canvas'); ca.width = S; ca.height = S;
  const cb = document.createElement('canvas'); cb.width = S; cb.height = S;
  const xa = ca.getContext('2d');
  const xb = cb.getContext('2d');
  const release = () => { ca.width = ca.height = 0; cb.width = cb.height = 0; };   // 释放 backing store (每次编辑都调, 防累积)
  if (!xa || !xb) { release(); return 0; }
  xa.drawImage(a, 0, 0, S, S);
  xb.drawImage(b, 0, 0, S, S);
  const da = xa.getImageData(0, 0, S, S).data;
  const db = xb.getImageData(0, 0, S, S).data;
  let sum = 0;
  for (let i = 0; i < da.length; i += 4) {
    sum += Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]);
  }
  release();
  return Math.round((sum / (S * S * 3) / 255) * 100);
}

// 预加载所有 image 到 cache (含 GIF decode). 多变体共享, 解码一次.
async function preloadImgCache(project: GifProject): Promise<Map<string, MediaAsset>> {
  const srcs = Array.from(new Set(project.clips.filter(c => c.trackId === 'image').map(c => (c as ImageClip).src)));
  const cache = new Map<string, MediaAsset>();
  await Promise.all(srcs.map(async src => { try { cache.set(src, await loadMedia(src)); } catch { /* skip */ } }));
  return cache;
}

// 编码一个 mode 的 GIF blob (不下载). 复用 gif.js worker (动态 import 保 tree-shake).
async function encodeGIFBlob(
  project: GifProject, mode: GifLoopMode, imgCache: Map<string, MediaAsset>, onProgress: (p: number) => void,
): Promise<{ blob: Blob; W: number; H: number; fps: number; frameCount: number; durationSec: number }> {
  const preset = resolveGifPreset(project.preset);
  const { width: W, height: H, fps } = preset;
  const D = Math.min(project.duration, GIF_MAX_DURATION, preset.maxDuration);

  // 超采样: 小尺寸渲 2× 再缩 → 边缘/字幕/人脸抗锯齿更顺 (大尺寸不必, 省内存/时间)
  // 手机端轻量: 关 2× 超采样 (省 4× 像素内存/时间, 防低端机崩) + 少 worker
  const _lite = typeof matchMedia !== 'undefined' && matchMedia('(max-width: 768px)').matches;
  const SS = (W <= 512 && !_lite) ? 2 : 1;
  const RW = W * SS, RH = H * SS;
  // 编码画布 = 目标尺寸 (gif.js 按此编码输出)
  const main = document.createElement('canvas'); main.width = W; main.height = H;
  const mctx = main.getContext('2d', { alpha: false });
  if (!mctx) throw new Error('canvas 2d 不可用');
  mctx.imageSmoothingEnabled = true; mctx.imageSmoothingQuality = 'high';
  // 渲染画布 = 超采样尺寸 (SS=1 时即 main)
  let render = main, rctx = mctx;
  if (SS > 1) {
    render = document.createElement('canvas'); render.width = RW; render.height = RH;
    const rc = render.getContext('2d', { alpha: false });
    if (!rc) throw new Error('canvas 2d 不可用');
    rctx = rc;
  }
  // scratch (crossfade head 层) 仅溶解模式需要 — 其余模式不分配, 省一块 2× 画布内存
  let sctx: CanvasRenderingContext2D | undefined;
  if (mode === 'crossfade') {
    const scratch = document.createElement('canvas'); scratch.width = RW; scratch.height = RH;
    sctx = scratch.getContext('2d', { alpha: true }) ?? undefined;
  }

  const [{ default: GIF }, workerUrlMod] = await Promise.all([
    import('gif.js'),
    import('gif.js/dist/gif.worker.js?url'),
  ]);
  // 画质优化: quality 10→5 (NeuQuant 调色板更准) + FloydSteinberg 抖动 (人脸照片渐变更顺) + 白底 (跟画板一致) + 4 workers 抵消 quality 开销
  // 体积敏感预设(微信/朋友圈)用全局调色板 → 更小 + 消除帧间调色板闪烁(纯色背景 shimmer); 大预设(X 480²)保留每帧调色板求极致画质
  const gifOpts = { workers: _lite ? 2 : 4, quality: _lite ? 8 : 5, dither: 'FloydSteinberg-serpentine', width: W, height: H, workerScript: (workerUrlMod as { default: string }).default, background: '#ffffff', repeat: 0, globalPalette: preset.width <= 320 };   // 手机少 worker + 略降质换速度; 小尺寸全局调色板 (更小/消闪) 大尺寸每帧调色板求画质
  const gif = new GIF(gifOpts as ConstructorParameters<typeof GIF>[0]);

  const specs = buildExportFrameTimes(D, fps, { ...project.loop, mode });
  const delayMs = Math.round(100 / fps) * 10;  // 对齐 GIF 厘秒(cs)网格 → 各播放器渲染时序一致, 跟预览节奏对齐 (fps=25→40ms, 30→30ms)
  const motionAt = makeLoopMotionAt(D, RW, RH);  // 动作幅度按渲染尺寸 (2× 同步放大, 缩回后视觉一致)
  const boundFaceAt = makeBoundFaceAt(D, RW, RH);  // 绑定脸跟壳 (导出与预览共用 resolver)
  let lastYield = performance.now();
  try {
    for (let i = 0; i < specs.length; i++) {
      renderLoopFrame(rctx, specs[i], project, RW, RH, imgCache, motionAt, sctx, '#ffffff', boundFaceAt);
      if (SS > 1) mctx.drawImage(render, 0, 0, W, H);  // 超采样缩回目标尺寸 (高质量插值)
      gif.addFrame(main, { copy: true, delay: delayMs });
      if (i % 4 === 0) onProgress(0.5 * (i / specs.length));
      // 时间片让出: 大画布单帧重, 累计 >16ms 才让出主线程 (不卡 UI, 又不过度 await)
      if (performance.now() - lastYield > 16) { await new Promise(r => setTimeout(r, 0)); lastYield = performance.now(); }
    }
    const blob = await new Promise<Blob>((resolve, reject) => {
      gif.on('finished', (b: Blob) => resolve(b));
      gif.on('progress', (p: number) => onProgress(0.5 + 0.5 * p));
      gif.on('abort', () => reject(new Error('GIF encode aborted')));
      gif.render();
    });
    return { blob, W, H, fps, frameCount: specs.length, durationSec: D };
  } finally {
    // 释放编码画布 backing store (成功/异常都释放; gif.js 已 copy 各帧, blob 独立于画布) — 降导出后峰值内存
    main.width = main.height = 0;
    if (render !== main) { render.width = render.height = 0; }
    if (sctx) { sctx.canvas.width = sctx.canvas.height = 0; }
  }
}

export function downloadBlob(blob: Blob, name: string, ext = 'gif'): void {
  const safe = (name || '我的GIF').replace(/[\\/:*?"<>|]/g, '_').slice(0, 40);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `${safe}.${ext}`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// 释放解码的 GIF 帧画布 (每个导入 GIF 可达几十 MB), 导出完立刻调用 → 帮 GC 回收, 降客户端峰值内存
function releaseImgCache(cache: Map<string, MediaAsset>): void {
  for (const m of cache.values()) {
    if (m.type === 'gif' && Array.isArray(m.frames)) {
      for (const f of m.frames) { f.canvas.width = 0; f.canvas.height = 0; }  // 0×0 立即释放 backing store
      m.frames.length = 0;
    }
  }
  cache.clear();
}

// 导出当前 mode 的 GIF (normal / boomerang / crossfade) 并下载.
export async function exportGIFLoop(
  project: GifProject, name: string, onProgress: (p: number) => void,
): Promise<{ size: number; width: number; height: number; fps: number; frameCount: number; durationSec: number }> {
  const imgCache = await preloadImgCache(project);
  try {
    const r = await encodeGIFBlob(project, project.loop.mode, imgCache, onProgress);
    downloadBlob(r.blob, name);
    return { size: r.blob.size, width: r.W, height: r.H, fps: r.fps, frameCount: r.frameCount, durationSec: r.durationSec };
  } finally {
    releaseImgCache(imgCache);
  }
}

// 一键多变体: 串行渲 normal/boomerang/crossfade (共享 imgCache, 解码一次), 不自动下载.
export interface GifVariant { mode: GifLoopMode; blob: Blob; size: number; frameCount: number; }
export async function exportGIFVariants(project: GifProject, onProgress: (p: number) => void): Promise<GifVariant[]> {
  const imgCache = await preloadImgCache(project);
  const modes: GifLoopMode[] = ['normal', 'boomerang', 'crossfade'];
  const out: GifVariant[] = [];
  try {
    for (let i = 0; i < modes.length; i++) {
      const r = await encodeGIFBlob(project, modes[i], imgCache, p => onProgress((i + p) / modes.length));
      out.push({ mode: modes[i], blob: r.blob, size: r.blob.size, frameCount: r.frameCount });
    }
    return out;
  } finally {
    releaseImgCache(imgCache);
  }
}

// 视频板块的 GIF 导出走这里 (统一编码器 — 同 quality5/dither/超采样/白底, 且自带 releaseImgCache).
// 视频 ProjectState 结构兼容 (clips + duration); 包成 normal 循环的 GifProject. 非 image/caption clip 被渲染器忽略。
export async function encodeGIFBlobFromProject(
  project: { clips: Clip[]; duration: number }, presetId: GifPresetId, onProgress: (p: number) => void,
): Promise<{ blob: Blob; W: number; H: number; fps: number; frameCount: number; durationSec: number }> {
  const gp: GifProject = {
    kind: 'gif-project', version: 1, preset: presetId, duration: project.duration,
    loop: { ...DEFAULT_LOOP_CONFIG }, lanes: { image: 1, caption: 1, fx: 1 }, clips: project.clips,
  };
  const imgCache = await preloadImgCache(gp);
  try {
    return await encodeGIFBlob(gp, 'normal', imgCache, onProgress);
  } finally {
    releaseImgCache(imgCache);
  }
}
