// animcore.ts — 纯渲染核心 (从 animatemode.tsx P0 抽取)
// 零 React / 零 audioEngine 依赖. 视频编辑器 + GIF 板块共享.
// 含: 类型 / GIF 解码 (gifuct-js 动态 import) / FX 引擎 / renderExportFrame 合成器 / 字幕绘制
// P0 新增: GifFrameEdit + LoopMotion + MotionDelta 类型; gifFrameAt 接 edit; renderExportFrame 接 motionAt.

export type TrackType = 'image' | 'caption' | 'fx' | 'tts' | 'bgm';
// 已有微动效 (作用范围: clip 内部 micro-FX) + 场景运镜 (作用整 clip duration, 大幅 pan/zoom) + 移动 (跨首尾帧 tween)
export type ImageFx =
  | 'none'
  // 微动效 (短促入场感)
  | 'shake' | 'zoom' | 'flash' | 'fade-in' | 'fade-out' | 'slide-l' | 'slide-r' | 'bounce' | 'spin' | 'pulse' | 'glitch'
  // 场景运镜 (持续整 clip, 大幅 pan/zoom)
  | 'pan-l' | 'pan-r' | 'pan-u' | 'pan-d' | 'zoom-in' | 'zoom-out' | 'ken-burns'
  // 移动 (lerp clip.transform → clip.endTransform; 首尾帧 tween)
  | 'move';
export type AspectId = '16:9' | '9:16' | '1:1';

export interface Transform { x: number; y: number; scale: number; rotation: number; flipX: boolean; }
export const DEFAULT_TRANSFORM: Transform = { x: 0, y: 0, scale: 1, rotation: 0, flipX: false };

export interface BaseClip { id: string; trackId: TrackType; lane: number; start: number; end: number; }
// kind?: 'scene' — 场景背景图 (全屏 cover, 跟普通 image 短边 60% contain 区分)
// endTransform — 'move' 特效用首尾帧 tween. lerp clip.transform → endTransform 按 t/duration
// 脸跟壳绑定: boundTo = 此 face 绑定的 shell(熊猫头) clip id; faceLocal = 绑定时 face 相对 shell 渲染框的局部位姿 (dxN/dyN 按 shell 半宽归一, scaleRatio=face/shell, rotation=相对角). face 渲染时 = shell 实时框(transform+loopMotion) ∘ faceLocal + face 自身 loopMotion.
export interface FaceLocal { dxN: number; dyN: number; scaleRatio: number; rotation: number; }
export interface BoundFaceBox { cx: number; cy: number; iw: number; ih: number; rotation: number; flipX: boolean; scaleX?: number; /* 动态水平镜像 (壳flip×脸flip), 默认 1 */ }
export interface ImageClip extends BaseClip { trackId: 'image'; src: string; label: string; caption?: string; fx: ImageFx; transform?: Transform; endTransform?: Transform; kind?: 'scene'; gifEdit?: GifFrameEdit; loopMotion?: LoopMotion; boundTo?: string; faceLocal?: FaceLocal; blend?: 'multiply'; role?: 'shell' | 'face' | 'scene' | 'image'; shellPandaId?: string; xfadeIn?: number; xfadeOut?: number; /* 变脸溶解: 窗口首/尾秒数内 alpha 渐变 (相邻脸时段重叠 → 交叉溶解); 硬切则不设 */ }
export interface CaptionTransform { x: number; y: number; }
export const DEFAULT_CAPTION_TRANSFORM: CaptionTransform = { x: 0, y: 35 };
// 'meme' = 白字 + 黑描边 (跟编辑器对齐, meme 经典款); 'panel' = 白底黑框; 'bar' = 黑底白字
export type CaptionStyle = 'meme' | 'panel' | 'bar';
export const DEFAULT_CAPTION_STYLE: CaptionStyle = 'meme';
// v23-k Phase A: entranceFx — 字幕入场动效 (沙雕动画核心, 加入场感)
export type CaptionEntranceFx = 'none' | 'fade' | 'pop' | 'slam' | 'typewriter';
export interface CaptionClip extends BaseClip { trackId: 'caption'; text: string; fontSize?: number; color?: string; style?: CaptionStyle; transform?: CaptionTransform; linkedTTSId?: string /* v23-e: caption ⇌ tts 1:1 双向 link, caption.start/end/text 改 → tts 自动同步 */; entranceFx?: CaptionEntranceFx; entranceDuration?: number; }
// v23-e: TTSClip + linkedCaptionId (双向 link) + playbackRate (clip 级倍速 0.5-3.0, 优先于 voice 级)
// v23-k: audioDuration (原始 audio 时长, resize 时自动算 rate fit)
export interface TTSClip extends BaseClip { trackId: 'tts'; text: string; voice: string; audioSrc?: string; audioDuration?: number; genFailed?: boolean; audioEngine?: 'youdao' | 'baidu'; linkedCaptionId?: string; playbackRate?: number; }
export interface BGMClip extends BaseClip { trackId: 'bgm'; bgmId: string; name: string; volume: number; }
// 特效独立轨 — 可绑定到某 image clip 或全局生效 (targetClipId 空)
// 跟 ImageClip.fx 同时存在: FXClip 优先, 旧 image.fx 是 fallback
// v23-h: 'move' 用 startTransform/endTransform · v23-j (phase 2): 其他 FX 也接参数
// strength: 强度 0-3 倍 (默认 1) — shake/flash/pulse/glitch/pan/slide
// zoomFrom/zoomTo: zoom-in/out 起始/结束 scale (默认 1.0/1.25)
// spinTurns: spin 圈数 (默认 1)
// 老 image.fx='move' + image.endTransform 仍兼容渲染 (fallback path)
export interface FXClip extends BaseClip {
  trackId: 'fx';
  fx: ImageFx;
  targetClipId?: string;
  startTransform?: Transform;
  endTransform?: Transform;
  strength?: number;
  zoomFrom?: number;
  zoomTo?: number;
  spinTurns?: number;
}
export type Clip = ImageClip | CaptionClip | TTSClip | BGMClip | FXClip;
export type LaneCount = Record<TrackType, number>;
// v23-l: 项目模式 — 视频 (有声 + 长时长 + MP4) / GIF (无声 + 短时长 + 直出 GIF + 社媒尺寸预设)
export type ProjectMode = 'video' | 'gif';

// v24: GIF 社媒预设 (尺寸 + 时长 + fps). 业界标准化 — 微信表情严格 ≤500KB ≤3s, TG ≤256KB,
// 朋友圈 ≤2MB, X ≤15MB. 全局上限 15s (业界通用 GIF 最长). 老 ID 'wechat'/'x'/'tg'/'custom' 保留向后兼容.
export type GifPresetId = 'wechat' | 'moments' | 'tg' | 'quick-share' | 'x' | 'custom';
export interface GifPreset {
  id: GifPresetId;
  label: string;
  width: number;
  height: number;
  fps: number;
  defaultDuration: number; // s
  maxDuration: number;
  note: string;
}
// 按"质量/体积"直接命名 (旧的微信/朋友圈/TG/X 平台名其实只是尺寸不同, 精简成 3 档 + 自定义).
// fps: 小巧 20 控体积; 标准/高清 25 = 整数 cs 延时无漂移, 接近预览流畅度. 编码加抖动+超采样, 见 gifloop.
export const GIF_PRESETS: GifPreset[] = [
  { id: 'wechat',      label: '小巧 · 省流', width: 240, height: 240, fps: 20, defaultDuration: 2.5, maxDuration: 10, note: '体积最小 · 240² · 表情包/省流量' },
  { id: 'quick-share', label: '标准 · 推荐', width: 360, height: 360, fps: 25, defaultDuration: 4,   maxDuration: 10, note: '清晰与体积平衡 · 360² · 通用分享 (推荐)' },
  { id: 'x',           label: '高清',        width: 480, height: 480, fps: 25, defaultDuration: 5,   maxDuration: 10, note: '更清晰, 体积较大 · 480²' },
  { id: 'custom',      label: '自定义',      width: 480, height: 360, fps: 25, defaultDuration: 5,   maxDuration: 10, note: '自由尺寸 · 上限 10s' },
];
// 旧预设 ID 向后兼容: 朋友圈(400²)→标准(360²), TG(512²)→高清(480²) — 老草稿无质量崩塌, 不落回 240².
const GIF_PRESET_REMAP: Partial<Record<GifPresetId, GifPresetId>> = { moments: 'quick-share', tg: 'x' };
export function resolveGifPreset(id?: GifPresetId): GifPreset {
  const rid = id ? (GIF_PRESET_REMAP[id] ?? id) : 'quick-share';
  return GIF_PRESETS.find(p => p.id === rid) ?? GIF_PRESETS[0];
}
export const GIF_MAX_DURATION = 10; // s, GIF 总上限 (用户定 10s; 时间轴满宽=0..10s, 10s 在最右)
export const GIF_MIN_DURATION = 1;

export interface ProjectState {
  clips: Clip[];
  lanes: LaneCount;
  duration: number;
  mode?: ProjectMode;       // 'video' (默认) / 'gif'. optional 兼容旧 project
  gifPresetId?: GifPresetId; // 仅 gif 模式有效
}

// ============ P0: GIF 循环编辑器共享类型 ============
// 导入 GIF 的帧级非破坏微调 (裁首尾帧 / 反转 / 调速 / 单 clip 乒乓). gifFrameAt 取帧时套用.
export interface GifFrameEdit {
  trimStartFrame: number;    // 含, 默认 0
  trimEndFrame: number;      // 不含, 默认帧数
  reverse: boolean;
  speed: number;             // 1=原速, 2=快一倍, 0.5=半速 (缩放有效 delay)
  perClipBoomerang: boolean; // 该主体在自己 trim 范围内乒乓
}
// 循环安全动作 — 相位锁定归一化 u=(t/D)mod1 + 整数周期 → f(0)==f(1) 必然闭环.
// (区别于 computeFx 的 shake/pulse: 那些锁 enterT, t=D 不归零). loopMotionDelta 在 gifloop.ts 算.
export type LoopMotionKind = 'none' | 'bob' | 'shimmy' | 'sway' | 'breathe' | 'pulseLoop' | 'spin360' | 'float' | 'bounce' | 'orbit'
  // v25: 更"动"的鬼畜系 — hop 来回横跳 / wobble 果冻晃 / jitter 疯狂抖(intensify) / punch 怼脸放大 / swing 钟摆荡
  | 'hop' | 'wobble' | 'jitter' | 'punch' | 'swing'
  // flip: 水平镜像翻转来回 (绕竖轴翻牌, 替代用户手动"切分+倒放"; 幅度=翻多狠, 速度=翻多快)
  | 'flip'
  | 'customMove';
// customMove: A = clip.transform, B = to. 引擎乒乓 A→B→A (首尾无缝). clip.fx 保持 'none' 防与 move-FX lerp 双叠加.
export interface LoopMotion { kind: LoopMotionKind; amp: number; cycles: number; to?: Transform; }
// renderExportFrame 的 motionAt 回调返回值 — 叠加在 clip transform 之上. dScaleX 可选 (默认 1; <0 = 水平镜像翻转)
export interface MotionDelta { dx: number; dy: number; dScale: number; dRot: number; dScaleX?: number; }

export function clamp(v: number, min: number, max: number) { return Math.max(min, Math.min(max, v)); }

// 在时间 t 计算 image clip 实际应渲染的 transform
//   - 没 endTransform + 不是 move fx → 直接返回 clip.transform
//   - 有 endTransform 且 effective fx 是 'move' → lerp clip.transform → endTransform 按 t/duration
// effectiveFx 通常已经 resolve 过 (FX track 优先 + image.fx fallback)
// 当 fx 不是 move 时不 lerp (即使设了 endTransform), 让用户能"录终态"暂留待用
export function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
// v23-h: 接受 effectiveFxFor 完整返回值, 优先用 FX 'move' clip 的 startTransform/endTransform
// fallback: 老 image.fx='move' + image.endTransform (兼容旧 project)
export function computeLiveTransform(c: ImageClip, t: number, eff: { fx: ImageFx; fxClip: FXClip | null; fxStart: number; fxDur: number }): Transform {
  const tr = c.transform ?? DEFAULT_TRANSFORM;
  // v23-h 新路径: FX 'move' clip 持 transforms
  if (eff.fx === 'move' && eff.fxClip?.startTransform && eff.fxClip?.endTransform) {
    const dur = Math.max(0.001, eff.fxClip.end - eff.fxClip.start);
    const p = clamp((t - eff.fxClip.start) / dur, 0, 1);
    const st = eff.fxClip.startTransform;
    const et = eff.fxClip.endTransform;
    return {
      x: lerp(st.x, et.x, p),
      y: lerp(st.y, et.y, p),
      scale: lerp(st.scale, et.scale, p),
      rotation: lerp(st.rotation, et.rotation, p),
      flipX: p < 0.5 ? st.flipX : et.flipX,
    };
  }
  // 老路径兼容: image.fx='move' + image.endTransform
  if (!c.endTransform || eff.fx !== 'move') return tr;
  const dur = Math.max(0.001, c.end - c.start);
  const p = clamp((t - c.start) / dur, 0, 1);
  const et = c.endTransform;
  return {
    x: lerp(tr.x, et.x, p),
    y: lerp(tr.y, et.y, p),
    scale: lerp(tr.scale, et.scale, p),
    rotation: lerp(tr.rotation, et.rotation, p),
    flipX: p < 0.5 ? tr.flipX : et.flipX,
  };
}

export async function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`load failed: ${src}`));
    img.crossOrigin = 'anonymous';
    img.src = src;
  });
}

// ============ GIF 真动画支持 (v23-l) ============
// 用 gifuct-js decode .gif → 多帧 canvas, render 时按 (t-clipStart) % gifDur 算当前帧.
// PreviewPane / PreviewModal 用 <img src> DOM 渲染 GIF 自带动画, 不需要 decoder.
// 仅 export pipeline (canvas-based drawImage) 需要 — 否则只画首帧.

export interface GifFrames {
  type: 'gif';
  width: number;
  height: number;
  frames: { canvas: HTMLCanvasElement; delayMs: number }[];
  totalDurMs: number;
}

export type MediaAsset = HTMLImageElement | GifFrames;

export function isGifFrames(m: MediaAsset | undefined | null): m is GifFrames {
  return !!m && (m as GifFrames).type === 'gif';
}

export function isGifSrc(src: string): boolean {
  if (!src) return false;
  if (src.startsWith('data:image/gif')) return true;
  const lower = src.toLowerCase();
  return lower.endsWith('.gif') || lower.includes('.gif?');
}

export async function loadGifFrames(src: string): Promise<GifFrames> {
  const { parseGIF, decompressFrames } = await import('gifuct-js');
  const resp = await fetch(src);
  if (!resp.ok) throw new Error(`gif fetch failed: ${resp.status}`);
  const buf = await resp.arrayBuffer();
  const parsed = parseGIF(buf);
  const decoded = decompressFrames(parsed, true);
  if (decoded.length === 0) throw new Error('gif empty');

  const W = parsed.lsd.width;
  const H = parsed.lsd.height;
  // 解码分辨率封顶: 渲染/预览最大只到 512 (最大 preset), 导入的大 GIF (可达 1080p) 没必要
  // 存全分辨率帧 (N 个全帧 canvas 几十~上百 MB). 合成仍在原生尺寸 (patch 是原生像素), 只把
  // 存进 frames 的成品帧缩到 ≤CAP. scale===1 (已 ≤512) 时零额外开销.
  const CAP = 512;
  const scale = Math.min(1, CAP / Math.max(W, H));
  const outW = Math.max(1, Math.round(W * scale));
  const outH = Math.max(1, Math.round(H * scale));
  const composed: { canvas: HTMLCanvasElement; delayMs: number }[] = [];

  // gifuct-js 帧数据是 patch (局部更新), 需按 disposalType 累积合成完整帧.
  // disposal: 0/1=保留前帧, 2=clear to bg, 3=restore prev (罕见, 简化 = 视为 1)
  // prev/comp/tmp = 复用的原生尺寸 scratch (合成必须原生, 否则 patch 错位), 循环后释放.
  const prev = document.createElement('canvas'); prev.width = W; prev.height = H;
  const prevCtx = prev.getContext('2d');
  const comp = document.createElement('canvas'); comp.width = W; comp.height = H;
  const compCtx = comp.getContext('2d');
  const tmp = document.createElement('canvas');
  const tmpCtx = tmp.getContext('2d');
  if (!prevCtx || !compCtx || !tmpCtx) throw new Error('canvas 2d unavailable');

  for (const f of decoded) {
    // 合成完整帧到 comp (原生尺寸)
    compCtx.clearRect(0, 0, W, H);
    compCtx.drawImage(prev, 0, 0);
    tmp.width = f.dims.width; tmp.height = f.dims.height;
    tmpCtx.putImageData(new ImageData(new Uint8ClampedArray(f.patch), f.dims.width, f.dims.height), 0, 0);
    compCtx.drawImage(tmp, f.dims.left, f.dims.top);

    // 存成品帧 (超过 CAP 则缩, 高质量插值)
    const frame = document.createElement('canvas');
    frame.width = outW; frame.height = outH;
    const fctx = frame.getContext('2d');
    if (!fctx) throw new Error('canvas 2d unavailable');
    if (scale < 1) { fctx.imageSmoothingEnabled = true; fctx.imageSmoothingQuality = 'high'; }
    fctx.drawImage(comp, 0, 0, outW, outH);
    composed.push({ canvas: frame, delayMs: Math.max(20, f.delay || 100) });

    // 更新 prev (从原生 comp; disposal 2 = 清空)
    prevCtx.clearRect(0, 0, W, H);
    if (f.disposalType !== 2) prevCtx.drawImage(comp, 0, 0);
  }
  // 释放 scratch backing store
  prev.width = 0; prev.height = 0; comp.width = 0; comp.height = 0; tmp.width = 0; tmp.height = 0;

  const totalDurMs = composed.reduce((s, f) => s + f.delayMs, 0);
  return { type: 'gif', width: outW, height: outH, frames: composed, totalDurMs };
}

export async function loadMedia(src: string): Promise<MediaAsset> {
  if (isGifSrc(src)) {
    try {
      return await loadGifFrames(src);
    } catch (e) {
      // gif decode 失败 fallback 走 <img> 加载 (至少首帧能显)
      console.warn('[gif] decode failed, fallback to <img>:', e);
      return await loadImage(src);
    }
  }
  return await loadImage(src);
}

export function gifFrameAt(g: GifFrames, t: number, clipStart: number, edit?: GifFrameEdit): HTMLCanvasElement {
  if (!edit) {
    // 默认路径 — 与抽取前字节级一致 (零行为变化)
    if (g.frames.length === 1 || g.totalDurMs <= 0) return g.frames[0].canvas;
    const localMs = (((t - clipStart) * 1000) % g.totalDurMs + g.totalDurMs) % g.totalDurMs;
    let acc = 0;
    for (const f of g.frames) {
      acc += f.delayMs;
      if (localMs < acc) return f.canvas;
    }
    return g.frames[g.frames.length - 1].canvas;
  }
  // P0: 帧级微调 (非破坏) — trim 子帧 / reverse / speed / 单 clip 乒乓. UI 在 P3 接.
  const start = clamp(Math.round(edit.trimStartFrame), 0, g.frames.length - 1);
  const end = clamp(Math.round(edit.trimEndFrame), start + 1, g.frames.length);
  const sub = g.frames.slice(start, end);
  if (sub.length === 1) return sub[0].canvas;
  const speed = Math.max(0.05, edit.speed || 1);
  const ordered = edit.reverse ? sub.slice().reverse() : sub;
  const subDurMs = ordered.reduce((s, f) => s + f.delayMs, 0) / speed;
  if (subDurMs <= 0) return ordered[0].canvas;
  let localMs: number;
  if (edit.perClipBoomerang) {
    const full = subDurMs * 2;
    const p = (((t - clipStart) * 1000) % full + full) % full;
    localMs = p < subDurMs ? p : full - p;
  } else {
    localMs = (((t - clipStart) * 1000) % subDurMs + subDurMs) % subDurMs;
  }
  let acc = 0;
  for (const f of ordered) {
    acc += f.delayMs / speed;
    if (localMs < acc) return f.canvas;
  }
  return ordered[ordered.length - 1].canvas;
}

export function mediaWH(m: MediaAsset): { w: number; h: number } {
  if (isGifFrames(m)) return { w: m.width, h: m.height };
  return { w: m.naturalWidth || m.width, h: m.naturalHeight || m.height };
}

export function drawableAt(m: MediaAsset, t: number, clipStart: number, edit?: GifFrameEdit): CanvasImageSource {
  if (isGifFrames(m)) return gifFrameAt(m, t, clipStart, edit);
  return m;
}

// 内容 bbox (alpha>阈值 的边界) 占整图的比例 {x,y,w,h} (0~1). 用于"绑定脸"椭圆裁切 — 透明化脸返回五官实际区域,
// 白底矩形脸/跨域脸返回整框 (内切椭圆仍裁掉矩形角). 缩到 128px 扫描 + WeakMap 缓存 (每脸一次).
const _bboxFracCache = new WeakMap<CanvasImageSource, { x: number; y: number; w: number; h: number }>();
const FULL_BBOX_FRAC = Object.freeze({ x: 0, y: 0, w: 1, h: 1 });  // 共享 fallback (冻结防调用方误改污染缓存)
export function contentBboxFrac(media: MediaAsset): { x: number; y: number; w: number; h: number } {
  const d = drawableAt(media, 0, 0);
  const cached = _bboxFracCache.get(d);
  if (cached) return cached;
  const { w: NW, h: NH } = mediaWH(media);
  let res = FULL_BBOX_FRAC;
  if (NW && NH) {
    const sc = Math.min(1, 128 / Math.max(NW, NH));
    const sw = Math.max(1, Math.round(NW * sc)), sh = Math.max(1, Math.round(NH * sc));
    const cv = document.createElement('canvas'); cv.width = sw; cv.height = sh;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    if (cx) {
      try {
        cx.drawImage(d, 0, 0, sw, sh);
        const data = cx.getImageData(0, 0, sw, sh).data;
        let x1 = sw, y1 = sh, x2 = -1, y2 = -1;
        for (let y = 0; y < sh; y++) {
          for (let x = 0; x < sw; x++) {
            if (data[(y * sw + x) * 4 + 3] > 24) {
              if (x < x1) x1 = x; if (x > x2) x2 = x;
              if (y < y1) y1 = y; if (y > y2) y2 = y;
            }
          }
        }
        if (x2 >= x1 && y2 >= y1) res = { x: x1 / sw, y: y1 / sh, w: (x2 - x1 + 1) / sw, h: (y2 - y1 + 1) / sh };
      } catch { /* 跨域 face (搜图) → tainted canvas, 退回整框椭圆 */ }
    }
    cv.width = cv.height = 0;   // 释放扫描画布 backing store (结果已进 WeakMap, 画布不必保留)
  }
  _bboxFracCache.set(d, res);
  return res;
}

// 决定某 image clip 在时间 t 实际应用的 fx 名:
// FX track 优先 — 找 active 的 FXClip, 若 targetClipId 匹配 / 为空 (全局) 都生效, 否则用 image.fx
export function effectiveFxFor(clip: ImageClip, t: number, allClips: Clip[]): { fx: ImageFx; fxStart: number; fxDur: number; fxClip: FXClip | null } {
  const fxClip = allClips.find(c =>
    c.trackId === 'fx' && t >= c.start && t < c.end && (!c.targetClipId || c.targetClipId === clip.id)
  ) as FXClip | undefined;
  if (fxClip) return { fx: fxClip.fx, fxStart: fxClip.start, fxDur: fxClip.end - fxClip.start, fxClip };
  return { fx: clip.fx, fxStart: clip.start, fxDur: clip.end - clip.start, fxClip: null };
}

// 计算 fx 在 t 时刻的具体 transform 偏移 / 缩放 / 旋转 / 透明度 / 滤镜
// 跟 export canvas render 同算法 → preview 跟 export 视觉一致, 也不依赖 CSS animation (避免漂移)
// move fx 的 transform tween 走 computeLiveTransform — 这里 FxApply 不重复处理
export interface FxApply { offsetX: number; offsetY: number; scaleMul: number; rotateAdd: number; alpha: number; filter: string; }
// easeInOutCubic — 让运镜更柔, 不死板线性
export function ease(p: number): number { return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; }
// v23-j (phase 2): FX clip 创建时按 fx 种类初始化默认 strength/zoom/spin 参数
export function initFXDefaults(fxClip: FXClip, targetTr: Transform): void {
  const fx = fxClip.fx;
  if (fx === 'move') {
    fxClip.startTransform = { ...targetTr };
    fxClip.endTransform = { ...targetTr };
  } else if (fx === 'zoom-in') {
    fxClip.zoomFrom = 1.0;
    fxClip.zoomTo = 1.25;
  } else if (fx === 'zoom-out') {
    fxClip.zoomFrom = 1.25;
    fxClip.zoomTo = 1.0;
  } else if (fx === 'zoom') {
    // 入场弹大: 从 0.3 缩放到 1.0
    fxClip.zoomFrom = 0.3;
  } else if (fx === 'spin') {
    fxClip.spinTurns = 1;
    fxClip.strength = 1;
  } else if (fx === 'pan-l' || fx === 'pan-r' || fx === 'pan-u' || fx === 'pan-d') {
    fxClip.strength = 1;
  } else if (fx === 'ken-burns') {
    fxClip.strength = 1;
  } else {
    // shake/flash/pulse/glitch/slide/bounce - 通用 strength 默认 1
    fxClip.strength = 1;
  }
}

// v23-j (phase 2): computeFx 接 FXClip object — 用户调的 strength/zoomFrom/zoomTo/spinTurns 真生效
export function computeFx(fx: ImageFx, fxStart: number, fxDur: number, t: number, W: number, fxClip?: FXClip | null): FxApply {
  const out: FxApply = { offsetX: 0, offsetY: 0, scaleMul: 1, rotateAdd: 0, alpha: 1, filter: '' };
  if (fx === 'none' || fx === 'move') return out;
  const enterT = t - fxStart;
  const dur = Math.max(0.2, fxDur);
  const progress = Math.min(1, Math.max(0, enterT / dur));
  // v23-j: strength 默认 1.0, 用户可调 0~3 (0=不动, 1=默认, 3=超强)
  const k = fxClip?.strength ?? 1.0;
  const zoomFrom = fxClip?.zoomFrom ?? 1.0;
  const zoomTo = fxClip?.zoomTo ?? 1.25;
  const spinTurns = fxClip?.spinTurns ?? 1;
  if (fx === 'shake') {
    out.offsetX = Math.sin(enterT * 60) * 6 * k;
    out.offsetY = Math.cos(enterT * 60) * 4 * k;
  } else if (fx === 'zoom') {
    // 入场弹大 — zoomFrom (默认 0.3) → 1.0
    const fromScale = fxClip?.zoomFrom ?? 0.3;
    out.scaleMul = fromScale + (1 - fromScale) * Math.pow(progress, 0.7);
  } else if (fx === 'flash') {
    out.filter = `brightness(${1 + Math.max(0, Math.sin(enterT * Math.PI * 4)) * 1.5 * k})`;
  } else if (fx === 'fade-in') {
    out.alpha = Math.min(1, progress);
  } else if (fx === 'fade-out') {
    out.alpha = Math.max(0, 1 - progress);
  } else if (fx === 'slide-l') {
    out.offsetX = -W * k * (1 - Math.min(1, progress * 1.2));
  } else if (fx === 'slide-r') {
    out.offsetX = W * k * (1 - Math.min(1, progress * 1.2));
  } else if (fx === 'bounce') {
    out.offsetY = -Math.abs(Math.sin(progress * Math.PI * 2.5)) * 30 * k * (1 - progress);
  } else if (fx === 'spin') {
    out.rotateAdd = progress * 360 * spinTurns;
  } else if (fx === 'pulse') {
    out.scaleMul = 1 + 0.15 * k * Math.sin(progress * Math.PI * 4);
  } else if (fx === 'glitch') {
    const phase = Math.floor(enterT * 12) % 4;
    out.offsetX = (phase - 1.5) * 8 * k;
    out.filter = `brightness(${1 + Math.sin(enterT * 30) * 0.4 * k})`;
  }
  // 场景运镜 — pan/zoom — 用户可调强度 (panStrength 默认 1)
  else if (fx === 'pan-l') {
    out.offsetX = -W * 0.16 * k * ease(progress);
  } else if (fx === 'pan-r') {
    out.offsetX = W * 0.16 * k * ease(progress);
  } else if (fx === 'pan-u') {
    out.offsetY = -W * 0.10 * k * ease(progress);
  } else if (fx === 'pan-d') {
    out.offsetY = W * 0.10 * k * ease(progress);
  } else if (fx === 'zoom-in') {
    // 用 zoomFrom→zoomTo (默认 1.0→1.25), 用户可调极端
    out.scaleMul = zoomFrom + (zoomTo - zoomFrom) * ease(progress);
  } else if (fx === 'zoom-out') {
    // 用 zoomFrom→zoomTo (默认 1.25→1.0). 反向 — 用户 set zoomFrom=1.5, zoomTo=1 等
    const zFrom = fxClip?.zoomFrom ?? 1.25;
    const zTo = fxClip?.zoomTo ?? 1.0;
    out.scaleMul = zFrom + (zTo - zFrom) * ease(progress);
  } else if (fx === 'ken-burns') {
    out.scaleMul = 1 + 0.18 * k * ease(progress);
    out.offsetX = W * 0.08 * k * ease(progress);
  }
  return out;
}

export function renderExportFrame(
  ctx: CanvasRenderingContext2D,
  t: number,
  project: { clips: Clip[] },   // P0: 收窄到只读 clips → ProjectState / GifProject 都可直接传
  W: number,
  H: number,
  imgCache: Map<string, MediaAsset>,
  motionAt?: (clip: ImageClip, t: number) => MotionDelta,  // P0: 循环安全动作注入 (gifmode 用; video 不传 = 行为不变)
  bgColor: string = '#000000',  // 画板底色. video 默认黑; GIF 传白 (#fff) 跟视频预览画板一致
  layer: 'all' | 'images' | 'captions' = 'all',  // crossfade 只混图层不混字幕 → 字幕单独画一次 (修溶解字幕重影, 预览+导出)
  boundFaceAt?: (face: ImageClip, shell: ImageClip, t: number, sNW: number, sNH: number, fNW: number, fNH: number) => BoundFaceBox,  // 绑定脸跟壳 (gifmode 注入; video 不传 = 无绑定, 行为不变)
) {
  if (layer !== 'captions') {
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, W, H);
  }
  // v23-i: 删 scene 强制最底 — 用户痛点 "改 lane 没变化". 纯按 lane 排 (lane 大 = 底层, lane 0 = 顶层)
  // scene 仍按 lane 排, 但 cover 全屏性质保留. 想让 scene 当背景 → 把 scene 放高 lane (e.g. lane 1+)
  const active = (project.clips.filter(c => c.trackId === 'image' && t >= c.start && t < c.end) as ImageClip[])
    .sort((a, b) => b.lane - a.lane);

  for (let idx = 0; layer !== 'captions' && idx < active.length; idx++) {
    const c = active[idx];
    const media = imgCache.get(c.src);
    if (!media) continue;
    const { w: naturalW, h: naturalH } = mediaWH(media);
    // 绑定脸: 从 shell 实时框 ∘ faceLocal 推导 (跟 shell 移动/旋转/缩放 + 自身 loopMotion), 不走 fx/motionAt. shell 按 id 在全 clips 找 (不限 active/lane).
    if (c.boundTo && boundFaceAt) {
      const shell = project.clips.find(s => s.id === c.boundTo && s.trackId === 'image') as ImageClip | undefined;
      const sMedia = shell ? imgCache.get(shell.src) : undefined;
      if (shell && sMedia) {
        const sWH = mediaWH(sMedia);
        const bf = boundFaceAt(c, shell, t, sWH.w, sWH.h, naturalW, naturalH);
        ctx.save();
        // 变脸 (face-cycle) 溶解: 窗口边缘按 xfadeIn/Out 渐变 alpha (相邻脸时段重叠 → 交叉溶解; 硬切无 xfade)
        let cyA = 1;
        if (c.xfadeIn && t - c.start < c.xfadeIn) cyA *= Math.max(0, (t - c.start) / c.xfadeIn);
        if (c.xfadeOut && c.end - t < c.xfadeOut) cyA *= Math.max(0, (c.end - t) / c.xfadeOut);
        if (cyA < 1) ctx.globalAlpha = cyA;
        if (c.blend === 'multiply') ctx.globalCompositeOperation = 'multiply';  // 不透明壳方案: 脸在上 multiply (脸盖白底, 壳黑特征透出)
        ctx.translate(bf.cx, bf.cy);
        ctx.rotate(bf.rotation * Math.PI / 180);
        ctx.scale((bf.flipX ? -1 : 1) * (bf.scaleX ?? 1), 1);   // 静态 flipX × 动态翻转(壳flip×脸flip) → 脸跟壳一起翻
        // 椭圆裁切 (跟编辑器 composeMemeCanvas 的 destination-in ellipse 一致): 按脸内容 bbox 内切椭圆,
        // 裁掉脸矩形角 / 白边溢出到壳的透明区 (修"face 太大盖到壳"). 1.04 微放防削到五官边缘.
        {
          const fbb = contentBboxFrac(media);
          const eRx = (fbb.w / 2) * bf.iw * 1.04, eRy = (fbb.h / 2) * bf.ih * 1.04;
          const eCx = (fbb.x + fbb.w / 2 - 0.5) * bf.iw, eCy = (fbb.y + fbb.h / 2 - 0.5) * bf.ih;
          ctx.beginPath();
          ctx.ellipse(eCx, eCy, eRx, eRy, 0, 0, Math.PI * 2);
          ctx.clip();
        }
        ctx.drawImage(drawableAt(media, t, c.start, c.gifEdit), -bf.iw / 2, -bf.ih / 2, bf.iw, bf.ih);
        ctx.restore();
        continue;
      }
    }
    const eff = effectiveFxFor(c, t, project.clips);
    const tr = computeLiveTransform(c, t, eff);
    const isScene = c.kind === 'scene';
    let iw: number, ih: number;
    if (isScene) {
      const coverR = Math.max(W / naturalW, H / naturalH);
      iw = naturalW * coverR * tr.scale;
      ih = naturalH * coverR * tr.scale;
    } else {
      // 删"副图自动缩"baseScale 机制 — 永远 1.0. 多 image 叠加时用户自己 transform.scale 调
      const baseSize = Math.min(W, H) * 0.6;
      const r = baseSize / naturalW;
      const maxRenderH = H * 0.85;
      iw = naturalW * r * tr.scale;
      ih = naturalH * r * tr.scale;
      if (ih > maxRenderH) {
        const shrink = maxRenderH / ih;
        iw *= shrink;
        ih *= shrink;
      }
    }
    const cx = W / 2 + (tr.x / 100) * W;
    const cy = H / 2 + (tr.y / 100) * H;

    const fxA = computeFx(eff.fx, eff.fxStart, eff.fxDur, t, W, eff.fxClip);
    iw *= fxA.scaleMul;
    ih *= fxA.scaleMul;
    // P0: 循环安全动作 (motionAt 注入). video 编辑器不传 → md=null → 完全不影响.
    const md = motionAt ? motionAt(c, t) : null;
    if (md) { iw *= md.dScale; ih *= md.dScale; }

    ctx.save();
    ctx.globalAlpha = fxA.alpha;
    if (c.blend === 'multiply') ctx.globalCompositeOperation = 'multiply';  // 配套壳叠在脸上 (白内部×脸=脸透出, 黑特征如墨镜×脸=黑盖住), 跟编辑器一致
    if (fxA.filter) ctx.filter = fxA.filter;
    ctx.translate(cx + fxA.offsetX + (md ? md.dx : 0), cy + fxA.offsetY + (md ? md.dy : 0));
    ctx.rotate((tr.rotation + fxA.rotateAdd + (md ? md.dRot : 0)) * Math.PI / 180);
    ctx.scale((tr.flipX ? -1 : 1) * (md?.dScaleX ?? 1), 1);   // 静态 flipX × 动态翻转动作 (flip motion)
    // GIF: 按 (t-clipStart) % gifDur 取当前帧 (+gifEdit 帧级微调); 静图: HTMLImageElement 自身
    ctx.drawImage(drawableAt(media, t, c.start, c.gifEdit), -iw / 2, -ih / 2, iw, ih);
    ctx.restore();
  }

  if (layer === 'images') return;   // images-only (crossfade 混层): 字幕由调用方单独画一次, 防重影
  // caption: 优先 caption track active clip, fallback image.caption
  // 渲染所有 active caption clips (按 transform 位置), 单 caption fallback 走 image.caption
  const top = active[active.length - 1];
  const activeCaps = project.clips.filter(c => c.trackId === 'caption' && t >= c.start && t < c.end) as CaptionClip[];
  if (activeCaps.length === 0 && top?.caption) {
    drawCaption(ctx, top.caption, W, H, undefined, undefined, undefined, DEFAULT_CAPTION_TRANSFORM);
  } else {
    for (const cap of activeCaps) {
      // v23-k: 加入场动效 — typewriter 截字 / fade pop slam 动画
      const ent = computeCaptionEntrance(cap, t);
      drawCaption(ctx, ent.visibleText, W, H, cap.fontSize, cap.color, cap.style ?? DEFAULT_CAPTION_STYLE, cap.transform ?? DEFAULT_CAPTION_TRANSFORM, { opacity: ent.opacity, scale: ent.scale }, cap.text);
    }
  }
  // 仅没录音 + 没 active caption 的 TTS 才烧字幕
  // (有 caption 时不重复; 有 audioSrc 时进真音轨不烧)
  const activeTTS = project.clips.find(c => c.trackId === 'tts' && t >= c.start && t < c.end) as TTSClip | undefined;
  if (activeTTS?.text && !activeTTS.audioSrc && activeCaps.length === 0) {
    drawCaption(
      ctx, activeTTS.text, W, H,
      Math.max(24, Math.round(W * 0.028)),
      '#ffffff', 'bar',
      { x: 0, y: -38 },
    );
  }
}

// v23-k Phase A: 字幕入场动效 helper — 算出当前 t 时的 { opacity, scale, visibleText }
export function computeCaptionEntrance(
  c: { start: number; end: number; text: string; entranceFx?: CaptionEntranceFx; entranceDuration?: number },
  time: number,
): { opacity: number; scale: number; visibleText: string } {
  const fx = c.entranceFx ?? 'none';
  if (fx === 'none') return { opacity: 1, scale: 1, visibleText: c.text };
  const dur = Math.max(0.05, c.entranceDuration ?? (fx === 'typewriter' ? Math.min(c.end - c.start, c.text.length * 0.06) : 0.4));
  const p = Math.max(0, Math.min(1, (time - c.start) / dur));
  if (fx === 'fade') return { opacity: p, scale: 1, visibleText: c.text };
  if (fx === 'pop') {
    const easeOut = 1 - Math.pow(1 - p, 3);
    const overshoot = p < 1 ? easeOut * 1.1 - 0.1 * (1 - p) : 1;
    return { opacity: Math.min(1, p * 2), scale: overshoot, visibleText: c.text };
  }
  if (fx === 'slam') {
    const easeOut = 1 - Math.pow(1 - p, 4);
    const scale = 2 - easeOut * 1;
    return { opacity: Math.min(1, p * 2.5), scale, visibleText: c.text };
  }
  if (fx === 'typewriter') {
    const n = Math.max(1, Math.floor(p * c.text.length));
    return { opacity: 1, scale: 1, visibleText: c.text.slice(0, n) };
  }
  return { opacity: 1, scale: 1, visibleText: c.text };
}

// 按最大宽度换行 (该分行分行) — 硬换行 \n 优先, 再按宽度断 (中文无空格故逐字断, 跟浏览器 word-break 近似). 调用前须先设好 ctx.font.
function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  if (!text) return [''];
  const out: string[] = [];
  for (const seg of text.split('\n')) {
    let line = '';
    for (const ch of seg) {
      const test = line + ch;
      if (ctx.measureText(test).width > maxW && line) { out.push(line); line = ch; }
      else line = test;
    }
    out.push(line);
  }
  return out.length ? out : [''];
}

// 字幕自适应字号 (傻瓜式免调参):
//   ① 单行优先 — 量整段宽度, 求"一行能装下"的最大字号; 只有该字号低于可读下限(WRAP_FLOOR)才分行 (短文案不轻易换行).
//   ② 上下不超画板 — availH = 2·min(cy, H-cy) (按字幕 Y 位置算的对称可用高), 块高 ≤ availH → 居中绘制必在画板内.
//   ③ 0.97 宽度安全余量 — 防 DOM 比 canvas 量出多换一行.
// 视频+GIF 通用 (drawCaption 导出 + 预览 DOM 都调). offscreen 测量 + memo. availH 不传 = 全画板高 (旧行为).
const _capFitCache = new Map<string, { fontSize: number; lines: string[] }>();
let _capMeasureCtx: CanvasRenderingContext2D | null = null;
function capMeasureCtx(): CanvasRenderingContext2D | null {
  if (!_capMeasureCtx) { const c = document.createElement('canvas'); c.width = 16; c.height = 16; _capMeasureCtx = c.getContext('2d'); }
  return _capMeasureCtx;
}
const CAP_FONT_FAMILY = '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif';
const FIT_REF_FS = 100;   // 参考字号: 量一次整段宽度, 按比例换算各字号宽 (省得逐字号 measure)
export function fitCaptionLayout(text: string, W: number, H: number, style: CaptionStyle = 'meme', availH?: number): { fontSize: number; lines: string[] } {
  const t = text || '';
  const isBox = style === 'panel' || style === 'bar';   // 字幕条/面板 = 副标题感, 别太大
  const hb = Math.min(availH ?? H, H * (isBox ? 0.22 : 0.40));   // 高度预算 = min(位置可用高, 美观上限)
  const key = `${Math.round(W)}|${Math.round(H)}|${style}|${Math.round(hb)}|${t}`;
  const hit = _capFitCache.get(key);
  if (hit) return hit;
  const mc = capMeasureCtx();
  const widthBudget = W * (isBox ? 0.84 : 0.92) * 0.97;   // 左右接近边缘 (meme 92%) × 0.97 安全余量
  const FONT_MIN = Math.max(13, Math.round(W * 0.022));
  const FONT_MAX = Math.max(FONT_MIN, Math.round(Math.min(W * 0.46, H * (isBox ? 0.12 : 0.30))));
  const WRAP_FLOOR = Math.max(FONT_MIN + 4, Math.round(H * 0.075));   // 单行字号 ≥ 此才保单行; 否则太小 → 分行换更大字
  let res: { fontSize: number; lines: string[] } = { fontSize: FONT_MIN, lines: [t] };
  if (mc) {
    let done = false;
    // ① 单行优先 (无硬换行时): 整段宽 wRef → 单行最大字号 = min(撑满宽, 撑满高, 上限)
    if (!t.includes('\n')) {
      mc.font = `900 ${FIT_REF_FS}px ${CAP_FONT_FAMILY}`;
      const wRef = Math.max(1, mc.measureText(t).width);
      const oneLineFs = Math.floor(Math.min(FONT_MAX, (widthBudget / wRef) * FIT_REF_FS, hb / 1.38));   // 1.38 = 行高1.28 + 描边余量 (防粗描边顶出边界)
      if (t.length <= 1 || oneLineFs >= WRAP_FLOOR) { res = { fontSize: Math.max(FONT_MIN, oneLineFs), lines: [t] }; done = true; }
    }
    // ② 长文案 → 分行: 从高往下找最大且 (最宽行 ≤ budget 且 块高 ≤ hb) 的字号
    if (!done) {
      for (let fs = FONT_MAX; fs >= FONT_MIN; fs -= 2) {
        mc.font = `900 ${fs}px ${CAP_FONT_FAMILY}`;
        const lines = wrapLines(mc, t, widthBudget);
        const widest = lines.reduce((m, l) => Math.max(m, mc.measureText(l).width), 0);
        if (widest <= widthBudget && lines.length * fs * 1.38 <= hb) { res = { fontSize: fs, lines }; done = true; break; }   // 1.38: 含描边余量
      }
      if (!done) { mc.font = `900 ${FONT_MIN}px ${CAP_FONT_FAMILY}`; res = { fontSize: FONT_MIN, lines: wrapLines(mc, t, widthBudget) }; }   // 兜底: 最小字号也分行装
    }
  }
  if (_capFitCache.size > 240) { const k = _capFitCache.keys().next().value; if (k !== undefined) _capFitCache.delete(k); }
  _capFitCache.set(key, res);
  return res;
}
// 按字幕 Y 位置(% of stage)算对称可用高 px → 块居中绘制不超上/下边界
export function captionAvailH(yPercent: number, H: number): number {
  const cyFrac = Math.min(1, Math.max(0, 0.5 + yPercent / 100));
  return 2 * Math.min(cyFrac, 1 - cyFrac) * H;
}
// 仅取自适应字号 px (预览 DOM 用 — 跟导出按各自画宽算 → 比例一致 = 所见即所得)
export function fitCaptionFontPx(text: string, W: number, H: number, style: CaptionStyle = 'meme', availH?: number): number {
  return fitCaptionLayout(text || ' ', W, H, style, availH).fontSize;
}

export function drawCaption(
  ctx: CanvasRenderingContext2D,
  text: string,
  W: number,
  H: number,
  capFontSize: number | undefined,
  capColor: string | undefined,
  style: CaptionStyle = DEFAULT_CAPTION_STYLE,
  tr: CaptionTransform = DEFAULT_CAPTION_TRANSFORM,
  entranceState: { opacity: number; scale: number } = { opacity: 1, scale: 1 },
  fitText?: string,   // 自适应字号按"完整文案"算 (typewriter 逐字入场时 text 是部分 → 防字号逐帧跳变, 且导出≈预览)
): void {
  if (!text) return;
  if (entranceState.opacity <= 0.01) return;  // v23-k: 完全透明 skip 绘制
  // capFontSize 给了 = 手动 (1280-conv 缩放); 没给 = 自适应 (短文案超大撑边 / 长文案缩字+分行, 傻瓜式免调参)
  let fontSize: number;
  let lines: string[];
  if (capFontSize != null) {
    fontSize = Math.round(capFontSize * W / 1280);
    ctx.font = `900 ${fontSize}px "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif`;
    lines = wrapLines(ctx, text, W * 0.92);   // 该分行分行 (跟预览 pre-wrap 对齐 → 导出≈预览)
  } else {
    const fit = fitCaptionLayout(fitText ?? text, W, H, style, captionAvailH(tr.y, H));   // 字号按完整文案(稳定) + 按 Y 位置限高(不超上下边界)
    fontSize = fit.fontSize;
    ctx.font = `900 ${fontSize}px "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif`;
    // typewriter 等 text 是部分 → 在稳定字号下重排部分文案; 否则直接用 fit.lines
    lines = (fitText != null && fitText !== text) ? wrapLines(ctx, text, W * 0.92) : fit.lines;
  }
  // meme/bar 默认白字, panel 默认黑字
  const color = capColor ?? (style === 'panel' ? '#000000' : '#ffffff');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lineH = fontSize * 1.28;
  // transform.x/y 都是 % of stage, 跟预览 'left: 50+x%' 'top: 50+y%' 对齐
  const cx = W * (0.5 + tr.x / 100);
  const cy = H * (0.5 + tr.y / 100);
  const y0 = cy - ((lines.length - 1) / 2) * lineH;   // 多行垂直居中
  // v23-k: entranceState (opacity + scale)
  const needsXform = entranceState.opacity < 1 || Math.abs(entranceState.scale - 1) > 0.01;
  if (needsXform) {
    ctx.save();
    ctx.globalAlpha = entranceState.opacity;
    ctx.translate(cx, cy);
    ctx.scale(entranceState.scale, entranceState.scale);
    ctx.translate(-cx, -cy);
  }
  const widest = lines.reduce((m, l) => Math.max(m, ctx.measureText(l).width), 1);

  if (style === 'panel') {
    const padX = 16, padY = 8;
    const boxW = widest + padX * 2, boxH = lines.length * lineH + padY * 2;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(cx - boxW / 2, cy - boxH / 2, boxW, boxH);
    ctx.strokeStyle = '#000000'; ctx.lineWidth = 2;
    ctx.strokeRect(cx - boxW / 2, cy - boxH / 2, boxW, boxH);
    ctx.fillStyle = color;
    lines.forEach((ln, i) => ctx.fillText(ln, cx, y0 + i * lineH));
  } else if (style === 'bar') {
    const padX = 18, padY = 10;
    const boxW = widest + padX * 2, boxH = lines.length * lineH + padY * 2;
    ctx.fillStyle = 'rgba(0,0,0,0.78)';
    ctx.fillRect(cx - boxW / 2, cy - boxH / 2, boxW, boxH);
    ctx.fillStyle = color;
    lines.forEach((ln, i) => ctx.fillText(ln, cx, y0 + i * lineH));
  } else {
    // meme: 白字 + 粗黑描边 (更醒目 — 描边 0.18→0.22)
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(5, fontSize * 0.22);
    ctx.strokeStyle = '#000000';
    ctx.fillStyle = color;
    lines.forEach((ln, i) => { const ly = y0 + i * lineH; ctx.strokeText(ln, cx, ly); ctx.fillText(ln, cx, ly); });
  }
  if (needsXform) ctx.restore();
}

