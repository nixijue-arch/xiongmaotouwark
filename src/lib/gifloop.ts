// gifloop.ts — GIF 循环引擎 (P1: normal + boomerang). 纯逻辑, 在 animcore 合成器之上加
// "时间重映射 + 帧序列 + 循环安全动作". crossfade / 多变体 / onion-skin 见 P2.
import {
  renderExportFrame, loadMedia, clamp, GIF_PRESETS, GIF_MAX_DURATION,
  type Clip, type ImageClip, type GifPresetId, type MediaAsset, type LoopMotion, type MotionDelta,
} from '@/lib/animcore';

export type GifLoopMode = 'normal' | 'boomerang' | 'crossfade';
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
  for (let i = 0; i < n; i++) out.push({ t: i * dt });           // normal
  return out;
}

// 预览用 — 某显示时间 t 的 spec (crossfade 尾段返回 blend 信息). normal/boomerang 直接 {t}.
export function loopSpecAt(t: number, D: number, config: GifLoopConfig): LoopFrameSpec {
  if (config.mode === 'crossfade' && D > 0) {
    const xf = clamp(config.crossfadeSec, 0.01, D * 0.4);
    const tailStart = D - xf;
    if (t >= tailStart) return { t, blendWith: t - tailStart, blendAlpha: (t - tailStart) / xf };
  }
  return { t };
}

// 循环安全动作 — 相位锁 u=(t/D)mod1 + 整数周期 n → f(0)==f(1) 必然闭环.
// amp 归一化 (0~1.5 常用), 内部按动作种类换算成 px / 度 / 比例.
export function loopMotionDelta(m: LoopMotion | undefined, t: number, D: number, W: number): MotionDelta {
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
    default:          return ZERO_DELTA;
  }
}

// 给 renderExportFrame 的 motionAt resolver — 从每个 image clip 的 loopMotion 算 delta.
export function makeLoopMotionAt(D: number, W: number): (clip: ImageClip, t: number) => MotionDelta {
  return (clip, t) => loopMotionDelta(clip.loopMotion, t, D, W);
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
  scratch?: CanvasRenderingContext2D,   // crossfade 的 head 层 (alpha:true canvas)
): void {
  renderExportFrame(ctx, spec.t, project, W, H, cache, motionAt);
  if (spec.blendWith === undefined || spec.blendAlpha === undefined || !scratch) return;
  // crossfade: head 层渲到 scratch, 按 alpha 叠到主层
  renderExportFrame(scratch, spec.blendWith, project, W, H, cache, motionAt);
  ctx.save();
  ctx.globalAlpha = spec.blendAlpha;
  ctx.drawImage(scratch.canvas, 0, 0, W, H);
  ctx.restore();
}

// 循环质量 0(完美闭环)..100(差). 把首帧/尾帧下采样到 32×32 算 RGB 平均绝对差.
export function loopSeamScore(a: HTMLCanvasElement, b: HTMLCanvasElement): number {
  const S = 32;
  const ca = document.createElement('canvas'); ca.width = S; ca.height = S;
  const cb = document.createElement('canvas'); cb.width = S; cb.height = S;
  const xa = ca.getContext('2d');
  const xb = cb.getContext('2d');
  if (!xa || !xb) return 0;
  xa.drawImage(a, 0, 0, S, S);
  xb.drawImage(b, 0, 0, S, S);
  const da = xa.getImageData(0, 0, S, S).data;
  const db = xb.getImageData(0, 0, S, S).data;
  let sum = 0;
  for (let i = 0; i < da.length; i += 4) {
    sum += Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]);
  }
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
  const preset = GIF_PRESETS.find(p => p.id === project.preset) ?? GIF_PRESETS[0];
  const { width: W, height: H, fps } = preset;
  const D = Math.min(project.duration, GIF_MAX_DURATION, preset.maxDuration);

  const main = document.createElement('canvas'); main.width = W; main.height = H;
  const mctx = main.getContext('2d', { alpha: false });
  const scratch = document.createElement('canvas'); scratch.width = W; scratch.height = H;
  const sctx = scratch.getContext('2d', { alpha: true });   // crossfade head 层
  if (!mctx || !sctx) throw new Error('canvas 2d 不可用');

  const [{ default: GIF }, workerUrlMod] = await Promise.all([
    import('gif.js'),
    import('gif.js/dist/gif.worker.js?url'),
  ]);
  const gif = new GIF({ workers: 2, quality: 10, width: W, height: H, workerScript: (workerUrlMod as { default: string }).default, background: '#000000', repeat: 0 });

  const specs = buildExportFrameTimes(D, fps, { ...project.loop, mode });
  const delayMs = Math.round(1000 / fps);
  const motionAt = makeLoopMotionAt(D, W);
  for (let i = 0; i < specs.length; i++) {
    renderLoopFrame(mctx, specs[i], project, W, H, imgCache, motionAt, sctx);
    gif.addFrame(main, { copy: true, delay: delayMs });
    if (i % 4 === 0) onProgress(0.5 * (i / specs.length));
    if (i % 8 === 0) await new Promise(r => setTimeout(r, 0));
  }
  const blob = await new Promise<Blob>((resolve, reject) => {
    gif.on('finished', (b: Blob) => resolve(b));
    gif.on('progress', (p: number) => onProgress(0.5 + 0.5 * p));
    gif.on('abort', () => reject(new Error('GIF encode aborted')));
    gif.render();
  });
  return { blob, W, H, fps, frameCount: specs.length, durationSec: D };
}

export function downloadBlob(blob: Blob, name: string, ext = 'gif'): void {
  const safe = (name || '我的GIF').replace(/[\\/:*?"<>|]/g, '_').slice(0, 40);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `${safe}.${ext}`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// 导出当前 mode 的 GIF (normal / boomerang / crossfade) 并下载.
export async function exportGIFLoop(
  project: GifProject, name: string, onProgress: (p: number) => void,
): Promise<{ size: number; width: number; height: number; fps: number; frameCount: number; durationSec: number }> {
  const imgCache = await preloadImgCache(project);
  const r = await encodeGIFBlob(project, project.loop.mode, imgCache, onProgress);
  downloadBlob(r.blob, name);
  return { size: r.blob.size, width: r.W, height: r.H, fps: r.fps, frameCount: r.frameCount, durationSec: r.durationSec };
}

// 一键多变体: 串行渲 normal/boomerang/crossfade (共享 imgCache, 解码一次), 不自动下载.
export interface GifVariant { mode: GifLoopMode; blob: Blob; size: number; frameCount: number; }
export async function exportGIFVariants(project: GifProject, onProgress: (p: number) => void): Promise<GifVariant[]> {
  const imgCache = await preloadImgCache(project);
  const modes: GifLoopMode[] = ['normal', 'boomerang', 'crossfade'];
  const out: GifVariant[] = [];
  for (let i = 0; i < modes.length; i++) {
    const r = await encodeGIFBlob(project, modes[i], imgCache, p => onProgress((i + p) / modes.length));
    out.push({ mode: modes[i], blob: r.blob, size: r.blob.size, frameCount: r.frameCount });
  }
  return out;
}
