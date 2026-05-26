// gifmode.tsx — GIF 循环编辑器 (融入 animate 的 "GIF 视图", 复用 am-* 外壳与视频视图高度一致)
// 范式: 循环优先. clips 全是 [0,duration] 全幅图层 (无时间轴), 循环本身取代时间轴.
// 复用 animcore 纯渲染核心 + gifloop 循环引擎. 绝不 import animatemode (避免拉起 audio 单例).
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Play, Pause, Download, Trash2, Upload, Loader2, FlipHorizontal, Type as TypeIcon, Eye, Layers, X, Image as ImageIcon, MessageSquare, Sparkles, FolderOpen, Search, ArrowLeftRight, Shuffle, Save, RotateCw, Undo2, Redo2 } from 'lucide-react';
import { toast } from 'sonner';
import { get as idbGet, set as idbSet } from 'idb-keyval';
import { ALL_PANDAS, ALL_FACES, getShellLayering, type Material } from '@/data/materials';
import { useIsMobile } from '@/hooks/usemediaquery';
import { useMeme, type DraftSlot } from '@/context/memecontext';
import { getEditorPandaBox, calcEditorFaceLayout } from '@/lib/composeMeme';
import { pickRandomText } from '@/data/quickModeTexts';
import {
  loadMedia, mediaWH, isGifSrc, isGifFrames, drawableAt, GIF_PRESETS, resolveGifPreset, GIF_MAX_DURATION, GIF_MIN_DURATION,
  fitCaptionFontPx, captionAvailH, contentBboxFrac, LOOP_MOTIONS, motionMeta,
  DEFAULT_TRANSFORM, DEFAULT_CAPTION_TRANSFORM,
  type MediaAsset, type Clip, type ImageClip, type CaptionClip, type Transform, type FaceLocal,
  type GifPresetId, type LoopMotionKind, type ProjectMode, type GifFrameEdit,
} from '@/lib/animcore';
import {
  type GifProject, type GifLoopMode, type GifVariant, DEFAULT_LOOP_CONFIG,
  loopTimeMap, loopSpecAt, renderLoopFrame, makeLoopMotionAt, makeBoundFaceAt, resolveBoundFaceBox, captureFaceLocal, loopMotionDelta, loopSeamScore, exportGIFLoop, exportGIFVariants, downloadBlob,
} from '@/lib/gifloop';
import { ComboTab, MaterialCardClip, MaterialSourceButtons, DraftCardClip, draftToLayers, CaptionQuickGen, CaptionPositionPresets, CaptionEmojiPicker, CaptionBatchImport, type DragPayload } from '@/lib/sharededitor';
import { fetchAsDataUrl } from '@/lib/networkImage';
import { showDialog } from '@/components/appdialog';
import { makeDraftThumb } from '@/lib/thumbutil';
import { Maximize2, FileDown, FileUp, FilePlus, ChevronDown, Scissors, Copy as CopyIcon, ChevronUp, Link2, Link2Off, Drama } from 'lucide-react';
import { useContextMenu, type ContextMenuItem } from '@/components/contextmenu';
import './gifmode.css';

const GIF_PROJECT_IDB_KEY = 'xiongmaotou.gifmode-current.v1';
const GIF_DRAFTS_IDB_KEY = 'xiongmaotou.gifmode-drafts.v1';
const GIF_DRAFT_MAX = 10;
const GIF_UPLOADS_IDB_KEY = 'xiongmaotou.gifmode-userpool.v1'; // GIF 自己的素材池 (上传/联网搜图/抠脸沉淀, 跟 video 数据隔离)
const GIF_UPLOAD_MAX = 60;
const GIF_UPLOAD_MAX_FILE_BYTES = 30 * 1024 * 1024;   // 单图 ≤30MB
const GIF_UPLOAD_MAX_DIM = 4096;                       // 尺寸 ≤4K (防超大图撑爆 IDB)
const GIF_UPLOAD_MAX_BYTES = 300 * 1024 * 1024;        // 池总 ≤300MB
// 字幕默认走自适应字号 (fitCaptionFontPx — 短文案超大撑边 / 长文案缩字分行); 用户拖滑块才转手动
const GIF_CAP_MAXCHARS = 14; // 随机字幕字数上限 (跟快速/编辑器同文案池 pickRandomText, 截到能一行装下)
const GIF_HISTORY_MAX = 50;  // 撤回栈深度 (跟视频 HISTORY_MAX 一致)
// 历史入栈 (模块级, 避开 useCallback 依赖搅动)
function gifPushHist(h: { past: GifProject[]; future: GifProject[] }, before: GifProject) {
  h.past.push(before);
  if (h.past.length > GIF_HISTORY_MAX) h.past.shift();
  h.future = [];
}
const uid = (p = 'g') => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

interface GifDraftSlot { id: string; name: string; updatedAt: number; project: GifProject; thumbSrc?: string; }

// LOOP_MOTIONS + motionMeta 已移到 animcore.ts (视频视图共用), 从那 import.

// 精简到 3 个最常用 + 导出与预览严格一致的: 直接/乒乓/溶解 (去掉 倒放/急退 — 较少用且观感复杂).
// 注: GifLoopMode 类型仍保留 reverse/rewind, loopTimeMap/buildExportFrameTimes 仍能处理 → 老 GIF 草稿不破坏, 只是不再新建.
const LOOP_MODES: { mode: GifLoopMode; short: string; hint: string }[] = [
  { mode: 'normal', short: '直接', hint: '正放循环 · 播完瞬间跳回开头 — 适合本身首尾闭环的动作 (内置动作都是)' },
  { mode: 'boomerang', short: '乒乓', hint: '正放→倒放来回 · 任何动作都首尾无缝, 时长翻倍 — 最稳, 导出一致' },
  { mode: 'crossfade', short: '溶解', hint: '尾段淡入开头 · 专治不闭环素材 (导入 GIF / 不对称动作) 的接缝跳变' },
];

// 算 image clip 在画板上的渲染框 (跟 animcore renderExportFrame 同公式) — 命中测试 / 选中描边 / A·B 手柄共用
function imageRenderBox(c: ImageClip, media: MediaAsset, W: number, H: number, trOverride?: Transform) {
  const { w: nW, h: nH } = mediaWH(media);
  const tr = trOverride ?? c.transform ?? DEFAULT_TRANSFORM;
  let iw: number, ih: number;
  if (c.kind === 'scene') {
    const r = Math.max(W / nW, H / nH); iw = nW * r * tr.scale; ih = nH * r * tr.scale;
  } else {
    const bs = Math.min(W, H) * 0.6; const r = bs / nW; const mh = H * 0.85;
    iw = nW * r * tr.scale; ih = nH * r * tr.scale;
    if (ih > mh) { const s = mh / ih; iw *= s; ih *= s; }
  }
  return { cx: W / 2 + (tr.x / 100) * W, cy: H / 2 + (tr.y / 100) * H, iw, ih };
}

// 配套自愈: 老配套(脸不透明叠壳上/无 blend, 盖住墨镜等壳特征)迁到编辑器式规则 — 壳顶层(lane 小)+multiply+role:shell,
// 脸底层+role:face. 渲染时白内部×脸=脸透出, 黑特征(墨镜)×脸=盖在脸上. 跑在 hydrate/import (老 IDB 项目自动修).
function normalizeCombo(p: GifProject): GifProject {
  const clips = p.clips.map(c => ({ ...c }));
  let changed = false;
  for (const c of clips) {
    if (c.trackId !== 'image') continue;
    const f = c as ImageClip;
    if (!f.boundTo) continue;
    const shell = clips.find(s => s.id === f.boundTo && s.trackId === 'image') as ImageClip | undefined;
    if (!shell) continue;
    // 按壳类型定方案 (跟编辑器 getShellLayering 一致). 老配套不存 shellPandaId → 按 label 反查 panda id.
    const pid = shell.shellPandaId ?? ALL_PANDAS.find(pp => pp.labelCn === shell.label)?.id;
    const lay = pid ? getShellLayering(pid) : { pandaZ: 5, faceZ: 1, pandaBlend: 'multiply' as const, faceBlend: 'normal' as const };
    const pandaOnTop = lay.pandaZ > lay.faceZ;
    const wantShellBlend = lay.pandaBlend === 'multiply' ? 'multiply' as const : undefined;
    const wantFaceBlend = lay.faceBlend === 'multiply' ? 'multiply' as const : undefined;
    const lo = Math.min(shell.lane, f.lane), hi = Math.max(shell.lane, f.lane);
    const shellLane = pandaOnTop ? lo : hi, faceLane = pandaOnTop ? hi : lo;
    if (shell.role !== 'shell') { shell.role = 'shell'; changed = true; }
    if (f.role !== 'face') { f.role = 'face'; changed = true; }
    if (shell.blend !== wantShellBlend) { shell.blend = wantShellBlend; changed = true; }
    if (f.blend !== wantFaceBlend) { f.blend = wantFaceBlend; changed = true; }
    if (shell.lane !== shellLane || f.lane !== faceLane) { shell.lane = shellLane; f.lane = faceLane; changed = true; }
    if (pid && shell.shellPandaId !== pid) { shell.shellPandaId = pid; changed = true; }
  }
  return changed ? { ...p, clips } : p;
}

// 时长变化时夹紧 clip [start,end] (全幅的跟随新时长; 部分的只夹上限) — 不再强制全部全幅, 让用户能在时间轴自定时段
function clampClipsToDuration(clips: Clip[], oldD: number, newD: number): Clip[] {
  const k = newD / Math.max(0.01, oldD);
  // 变脸组 (同一壳 ≥2 张绑定脸): 按比例缩放窗口 + xfade → 改时长后轮播节奏不破 (无缝/不闪)
  const faceCount = new Map<string, number>();
  for (const c of clips) { const b = (c as ImageClip).boundTo; if (c.trackId === 'image' && b) faceCount.set(b, (faceCount.get(b) ?? 0) + 1); }
  const cycleShells = new Set<string>(); faceCount.forEach((n, s) => { if (n >= 2) cycleShells.add(s); });
  return clips.map(c => {
    const ic = c as ImageClip;
    if (ic.boundTo && cycleShells.has(ic.boundTo)) {
      return { ...c,
        start: Math.max(0, c.start * k), end: Math.min(newD, c.end * k),
        xfadeIn: ic.xfadeIn != null ? ic.xfadeIn * k : undefined,
        xfadeOut: ic.xfadeOut != null ? ic.xfadeOut * k : undefined } as Clip;
    }
    const wasFull = c.start <= 0.001 && c.end >= oldD - 0.01;
    const end = wasFull ? newD : Math.min(c.end, newD);
    const start = Math.min(Math.max(0, c.start), Math.max(0, end - 0.1));
    return { ...c, start, end } as Clip;
  });
}

// 变脸 (face-cycle) 删一张脸后重排剩余脸时段, 消除循环里的空脸洞. 保留 dissolve/hard-cut 性质
// (任一兄弟有 xfade ⇒ dissolve) + 播放顺序 (按 start 排). M==1 → 单脸全幅清 xfade; M>=2 → 复用 applyFaceCycle 窗口数学.
function rewindowCycle(clips: Clip[], shellId: string, D: number): Clip[] {
  const faces = (clips.filter(c => c.trackId === 'image' && (c as ImageClip).boundTo === shellId) as ImageClip[])
    .slice().sort((a, b) => a.start - b.start);
  const M = faces.length;
  if (M === 0) return clips;
  const dissolve = M >= 2 && faces.some(f => f.xfadeIn != null || f.xfadeOut != null);
  const seg = D / M;
  const xf = dissolve ? Math.min(0.35, seg * 0.45) : 0;
  const win = new Map<string, { start: number; end: number; xfadeIn?: number; xfadeOut?: number }>();
  faces.forEach((f, i) => win.set(f.id, {
    start: i * seg,
    end: (i < M - 1) ? (i + 1) * seg + xf : D,
    xfadeIn: (dissolve && i > 0) ? xf : undefined,
    xfadeOut: (dissolve && i < M - 1) ? xf : undefined,
  }));
  return clips.map(c => { const w = win.get(c.id); return w ? ({ ...c, ...w } as Clip) : c; });
}

const clampN = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
// 时间轴吸附: 吸到其它 clip 端点 / 0 / D (tol 按像素阈值换算成秒). 跟视频 findSnapTime 同思路 (gifmode 不 import animatemode)
function gifSnapTime(raw: number, clips: Clip[], D: number, ignoreId: string | null, tolSec: number): { t: number; snapped: boolean } {
  const cands = [0, D];
  for (const c of clips) { if (c.id === ignoreId) continue; cands.push(c.start, c.end); }
  let best = raw, bestDx = tolSec, hit = false;
  for (const t of cands) {
    const d = Math.abs(t - raw);
    if (d < bestDx) { best = t; bestDx = d; hit = true; }
  }
  return { t: best, snapped: hit };
}

// 合并 gifEdit patch (带默认值) — 导入 GIF 帧级微调用
function normGifEdit(clip: ImageClip, total: number, patch: Partial<GifFrameEdit>): GifFrameEdit {
  const e = clip.gifEdit;
  return {
    trimStartFrame: e?.trimStartFrame ?? 0,
    trimEndFrame: e?.trimEndFrame ?? total,
    reverse: e?.reverse ?? false,
    speed: e?.speed ?? 1,
    perClipBoomerang: e?.perClipBoomerang ?? false,
    ...patch,
  };
}

function makeDefaultGifProject(): GifProject {
  const panda = ALL_PANDAS[7] ?? ALL_PANDAS[0];
  const preset = resolveGifPreset(); // 默认"标准" (推荐档)
  const dur = preset.defaultDuration;
  const clip: ImageClip = {
    id: uid('img'), trackId: 'image', lane: 0, start: 0, end: dur,
    src: panda.src, label: panda.labelCn, fx: 'none',
    transform: { ...DEFAULT_TRANSFORM }, loopMotion: { kind: 'bob', amp: 1, cycles: 1 },
  };
  return {
    kind: 'gif-project', version: 1,
    duration: dur, preset: preset.id,
    lanes: { image: 1, caption: 1, fx: 1 },
    loop: { ...DEFAULT_LOOP_CONFIG },
    clips: [clip],
  };
}

export function GifMode({ view, onSwitchView }: { view: ProjectMode; onSwitchView: (v: ProjectMode) => void }) {
  const isMobile = useIsMobile();
  const { draftSlots } = useMeme();
  const [project, setProject] = useState<GifProject>(() => makeDefaultGifProject());
  const [hydrated, setHydrated] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [seam, setSeam] = useState<number | null>(null);
  const [seg, setSeg] = useState<'asset' | 'caption' | 'fx'>('asset');
  const [gmSheet, setGmSheet] = useState<'left' | 'right' | null>(null);  // 移动端: 左/右栏变底部 sheet (CSS 重定位, 不搬 DOM)
  const [assetSub, setAssetSub] = useState<'combo' | 'panda' | 'face' | 'netsearch' | 'scene' | 'draft' | 'upload'>('combo');
  const [q, setQ] = useState('');
  const [scrubT, setScrubT] = useState(0);
  const [variantOpen, setVariantOpen] = useState(false);
  const [variants, setVariants] = useState<{ v: GifVariant; url: string }[] | null>(null);
  const [variantBusy, setVariantBusy] = useState(false);
  const [gifDrafts, setGifDrafts] = useState<GifDraftSlot[]>([]);
  const [draftPopOpen, setDraftPopOpen] = useState(false);
  const [gifUploads, setGifUploads] = useState<Material[]>([]); // GIF 素材池 (上传/搜图/抠脸沉淀, 隔离于 video)
  const gifUploadsRef = useRef<Material[]>([]);
  useEffect(() => { gifUploadsRef.current = gifUploads; }, [gifUploads]);
  const [gifUploadKind, setGifUploadKind] = useState<'general' | 'panda' | 'face' | 'scene'>('general'); // 上传归类 → 决定进哪个 subtab
  const [gifTbMore, setGifTbMore] = useState(false); // 手机端工具栏折叠/展开 (跟视频一致, 避免横向滚动)
  const uploadsLoadedRef = useRef(false); // 防"持久化在加载前跑→把池写空"竞态

  const cacheRef = useRef<Map<string, MediaAsset>>(new Map());
  const [cacheVer, setCacheVer] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const jsonInputRef = useRef<HTMLInputElement>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const [swapPop, setSwapPop] = useState<{ id: string; kind: 'panda' | 'face' } | null>(null);  // 点图层换素材弹窗
  const [swapQ, setSwapQ] = useState('');
  const [swapBusy, setSwapBusy] = useState(false);
  // 变脸 (face-cycle): 同一壳上多张脸依次轮播 (默认溶解过渡)
  const [cyclePop, setCyclePop] = useState<{ shellId: string; faceId: string } | null>(null);
  const [cycleSel, setCycleSel] = useState<string[]>([]);   // 选中脸 material id (顺序 = 播放顺序)
  const [cycleDissolve, setCycleDissolve] = useState(true);
  const [cycleQ, setCycleQ] = useState('');

  // rAF 用 ref 读最新值, 避免每次编辑都拆/重建动画循环
  const projectRef = useRef(project); projectRef.current = project;
  const playingRef = useRef(playing); playingRef.current = playing;
  const startRef = useRef(performance.now());
  const frozenRef = useRef(0);

  // ---- 撤回/重做: 防抖自动历史 (变化前入栈; 拖动期间不入, 由 endDrag 补一帧; 对各 mutation 零侵入) ----
  const historyRef = useRef<{ past: GifProject[]; future: GifProject[] }>({ past: [], future: [] });
  const [, setHistTick] = useState(0);
  const draggingRef = useRef(false);
  const histSnapRef = useRef<GifProject>(project);
  const skipHistRef = useRef(false);
  const histTimerRef = useRef<number | undefined>(undefined);
  const flushHist = useCallback(() => {
    window.clearTimeout(histTimerRef.current);
    if (!draggingRef.current && histSnapRef.current !== projectRef.current) {
      gifPushHist(historyRef.current, histSnapRef.current);
      histSnapRef.current = projectRef.current;
    }
  }, []);
  useEffect(() => {
    if (skipHistRef.current) { skipHistRef.current = false; histSnapRef.current = project; return; }
    if (draggingRef.current || histSnapRef.current === project) return;
    window.clearTimeout(histTimerRef.current);
    histTimerRef.current = window.setTimeout(() => {
      gifPushHist(historyRef.current, histSnapRef.current);
      histSnapRef.current = projectRef.current;
      setHistTick(t => t + 1);
    }, 250);
  }, [project]);
  // 拖动开始: 标记 dragging (期间不入历史) + 自注册 pointerup → 拖完补一帧 (调用方只需 beginDrag(), 无需管 onUp)
  const beginDrag = useCallback(() => {
    window.clearTimeout(histTimerRef.current);
    draggingRef.current = true;
    const onUp = () => {
      window.removeEventListener('pointerup', onUp);
      draggingRef.current = false;
      flushHist();
      setHistTick(t => t + 1);
    };
    window.addEventListener('pointerup', onUp);
  }, [flushHist]);
  const undo = useCallback(() => {
    flushHist();
    const prev = historyRef.current.past.pop();
    if (!prev) return;
    historyRef.current.future.push(projectRef.current);
    skipHistRef.current = true; histSnapRef.current = prev;
    setProject(prev); setSelectedId(null); setHistTick(t => t + 1);
  }, [flushHist]);
  const redo = useCallback(() => {
    flushHist();  // 跟 undo 对称: 先把在途编辑入栈 (会清 future) — 防 250ms 内"编辑后立刻 redo"误用 stale future
    const next = historyRef.current.future.pop();
    if (!next) return;
    historyRef.current.past.push(projectRef.current);
    skipHistRef.current = true; histSnapRef.current = next;
    setProject(next); setSelectedId(null); setHistTick(t => t + 1);
  }, [flushHist]);
  const canUndo = historyRef.current.past.length > 0;
  const canRedo = historyRef.current.future.length > 0;
  const clearAll = useCallback(async () => {
    if (projectRef.current.clips.length === 0) return;
    const { confirmed } = await showDialog({ title: '清空画板', message: `会清掉当前 ${projectRef.current.clips.length} 个图层 (已存草稿/导出的不受影响). 继续?`, variant: 'warning', confirmText: '清空', cancelText: '取消' });
    if (!confirmed) return;
    setProject(p => ({ ...p, clips: [] }));   // 自动历史捕获 → Ctrl+Z 可撤回
    setSelectedId(null);
    toast('已清空 · Ctrl+Z 撤回');
  }, []);
  // 画板放大 (fit) + DOM 编辑层 (跟视频 am-stage-img 一致) + 自定义移动 A/B
  const stageRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ w: 0, h: 0 });
  const fitRef = useRef(fit); fitRef.current = fit;
  const [customEdit, setCustomEdit] = useState(false);
  const [editingCaptionId, setEditingCaptionId] = useState<string | null>(null);
  // 每个 clip 一个 DOM 元素 (image=am-stage-img / caption=am-caption-stage); rAF 套动画 transform + 按时段显隐
  const overlayRefs = useRef<Map<string, HTMLElement | null>>(new Map());
  const cycleHintRef = useRef(false);   // 重叠层 click-cycle 一次性提示
  // 时间轴
  const playheadRef = useRef<HTMLDivElement>(null);
  const playheadHandleRef = useRef<HTMLDivElement>(null);
  const lanesRef = useRef<HTMLDivElement>(null);
  const [snapLine, setSnapLine] = useState<number | null>(null);
  const [resizeTip, setResizeTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const [tlDropActive, setTlDropActive] = useState(false);
  const [motionPop, setMotionPop] = useState<{ id: string; bottom: number; left: number } | null>(null); // 时间轴行→动效弹层 (锚在 chip 上方)
  const [lanesW, setLanesW] = useState(800);        // 时间轴轨道区实测宽 → pxPerSec 满宽适配 (0..10s 铺满)
  const pxPerSecRef = useRef(80);                   // rAF 读最新 pxPerSec 定位 playhead
  // 导入 GIF 的逐帧 canvas (rAF 按循环时间 + gifEdit 画当前帧, WYSIWYG)
  const gifCanvasRefs = useRef<Map<string, HTMLCanvasElement | null>>(new Map());
  const draftsLoadedRef = useRef(false);
  const layerDragId = useRef<string | null>(null);
  const [layerOverId, setLayerOverId] = useState<string | null>(null);

  const preset = useMemo(() => resolveGifPreset(project.preset), [project.preset]);
  const D = project.duration;
  const selected = project.clips.find(c => c.id === selectedId) ?? null;
  const imageClips = project.clips.filter(c => c.trackId === 'image') as ImageClip[];
  const captionClips = project.clips.filter(c => c.trackId === 'caption') as CaptionClip[];
  const tlClips: Clip[] = ([...imageClips].sort((a, b) => a.lane - b.lane) as Clip[]).concat(captionClips);
  const frameCount = Math.max(1, Math.round(D * preset.fps));
  const exportFrames = project.loop.mode === 'boomerang' ? Math.max(1, frameCount * 2 - 2) : frameCount;
  const effMax = Math.min(GIF_MAX_DURATION, preset.maxDuration);   // 时间轴满宽 = 0..effMax (10s), 10s 在最右
  const tlTicks = useMemo(() => { const a: number[] = []; for (let s = 0; s <= Math.floor(effMax); s++) a.push(s); return a; }, [effMax]);
  const loopInfo = LOOP_MODES.find(m => m.mode === project.loop.mode);
  const loopGlyph = project.loop.mode === 'boomerang' ? '⇄' : project.loop.mode === 'crossfade' ? '✦' : project.loop.mode === 'reverse' ? '◀' : project.loop.mode === 'rewind' ? '⏪' : '↻';
  // 满宽适配 max: zoom 1 = 0..10s 正好铺满 lanes (无横向空白, 10s 在最右); clip 等比 px (3s=30%); zoom>1 才滚动
  const pxPerSec = Math.max(8, (lanesW - 24) / effMax);   // 满宽适配: GIF (≤10s) 铺满, 留 24px 右边距给时长手柄+末尾标签 (否则 overflow:hidden 会剪掉可拖的手柄), 无横向滚动 (极简, 不缩放)
  pxPerSecRef.current = pxPerSec;
  const tlContentW = Math.round(effMax * pxPerSec);

  // hydrate
  useEffect(() => {
    let alive = true;
    idbGet<GifProject>(GIF_PROJECT_IDB_KEY).then(saved => {
      if (alive && saved && saved.kind === 'gif-project' && Array.isArray(saved.clips) && saved.clips.length) {
        skipHistRef.current = true;
        const migrated = normalizeCombo(saved);
        histSnapRef.current = migrated;
        setProject(migrated);
      }
      if (alive) setHydrated(true);
    }).catch(() => { if (alive) setHydrated(true); });
    return () => { alive = false; };
  }, []);

  // GIF 草稿 load (独立 IDB key)
  useEffect(() => {
    if (draftsLoadedRef.current) return;
    draftsLoadedRef.current = true;
    idbGet<GifDraftSlot[]>(GIF_DRAFTS_IDB_KEY).then(d => { if (Array.isArray(d)) setGifDrafts(d.slice(0, GIF_DRAFT_MAX)); }).catch(() => {});
    idbGet<Material[]>(GIF_UPLOADS_IDB_KEY).then(d => { if (Array.isArray(d)) setGifUploads(d.slice(0, GIF_UPLOAD_MAX)); }).catch(() => {}).finally(() => { uploadsLoadedRef.current = true; });
  }, []);

  // GIF 素材池持久化 — 必须等池加载完才允许写 (gate 在 uploadsLoadedRef, 不是 hydrated; 否则 project 先 hydrate→写空池)
  useEffect(() => {
    if (!uploadsLoadedRef.current) return;
    const t = window.setTimeout(() => { void idbSet(GIF_UPLOADS_IDB_KEY, gifUploads).catch(() => {}); }, 250);
    return () => window.clearTimeout(t);
  }, [gifUploads]);

  // 选中初始化 (hydrate 后选第一个 image)
  useEffect(() => {
    if (!selectedId && project.clips.length) {
      setSelectedId((project.clips.find(c => c.trackId === 'image') ?? project.clips[0]).id);
    }
  }, [project.clips, selectedId]);

  // persist (debounce)
  useEffect(() => {
    if (!hydrated) return;
    const t = window.setTimeout(() => { void idbSet(GIF_PROJECT_IDB_KEY, project).catch(() => {}); }, 250);
    return () => window.clearTimeout(t);
  }, [project, hydrated]);

  // 加载素材到 cache + 淘汰不再引用的 (GIF 帧很占内存, 防长 session randomize/import 无限增长)
  useEffect(() => {
    const live = new Set(imageClips.map(c => c.src));
    for (const key of [...cacheRef.current.keys()]) { if (!live.has(key)) cacheRef.current.delete(key); }
    let alive = true;
    Promise.all([...live].map(async src => {
      if (cacheRef.current.has(src)) return;
      try { const m = await loadMedia(src); if (alive) cacheRef.current.set(src, m); } catch { /* skip */ }
    })).then(() => { if (alive) setCacheVer(v => v + 1); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.clips]);

  // 实测时间轴轨道区宽 → pxPerSec 满宽适配 (0..10s 铺满; 窗口/面板 resize 跟随)
  useEffect(() => {
    const el = lanesRef.current; if (!el) return;
    const measure = () => setLanesW(el.clientWidth || 800);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // rAF 循环动画 — 直接驱动 DOM am-stage-img 的 CSS transform (跟视频 DOM 编辑模型一致, 无可见 canvas; 导出/评分走离屏 canvas)
  const lastFrameRef = useRef(new Map<string, HTMLCanvasElement>());  // 每 clip 上次画的帧 → 跳过重复 drawImage (暂停/低 fps 省 GPU)
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const p = projectRef.current;
      const pr = resolveGifPreset(p.preset);
      const w = pr.width, h = pr.height, dd = p.duration;
      const now = performance.now();
      const playPos = playingRef.current ? (now - startRef.current) / 1000 : frozenRef.current;
      const t = loopTimeMap(playPos, dd, p.loop.mode);
      const sx = (fitRef.current.w || w) / w, sy = (fitRef.current.h || h) / h;
      for (const c of p.clips) {
        const el = overlayRefs.current.get(c.id);
        if (!el) continue;
        const vis = t >= c.start && t < c.end; // 按时段显隐 (时间轴拖出来的 start/end 真生效)
        if (!vis) { el.style.display = 'none'; continue; }
        el.style.display = '';
        if (c.trackId === 'image') {
          const ic = c as ImageClip;
          let boundDone = false;
          if (ic.boundTo) {  // 绑定脸: 静态框=resolveBoundFaceBox(0), 每帧 transform = 相对 rest 的 delta → 跟随 shell 移动/旋转/缩放 + 自身 loopMotion
            const shell = p.clips.find(s => s.id === ic.boundTo && s.trackId === 'image') as ImageClip | undefined;
            const sm = shell ? cacheRef.current.get(shell.src) : undefined;
            const fm = cacheRef.current.get(ic.src);
            if (shell && sm && fm) {
              const sWH = mediaWH(sm), fWH = mediaWH(fm);
              const r0 = resolveBoundFaceBox(ic, shell, 0, dd, w, h, sWH.w, sWH.h, fWH.w, fWH.h);
              const rc = resolveBoundFaceBox(ic, shell, t, dd, w, h, sWH.w, sWH.h, fWH.w, fWH.h);
              if (Number.isFinite(rc.cx) && Number.isFinite(rc.cy) && Number.isFinite(rc.rotation) && Number.isFinite(r0.cx) && Number.isFinite(r0.cy) && r0.iw > 0) {
                const ds = Number.isFinite(rc.iw) ? rc.iw / r0.iw : 1;
                el.style.transform = `translate(${((rc.cx - r0.cx) * sx).toFixed(2)}px, ${((rc.cy - r0.cy) * sy).toFixed(2)}px) rotate(${rc.rotation.toFixed(2)}deg) scale(${(ds * (rc.scaleX ?? 1)).toFixed(4)}, ${ds.toFixed(4)})`;   // scaleX 含壳/脸翻转 → 脸跟壳一起翻 (静态 flipX 在内层 img)
                boundDone = true;
              }
            }
          }
          if (!boundDone) {
            const md = loopMotionDelta(ic.loopMotion, t, dd, w, h, ic.transform);
            const baseRot = ic.transform?.rotation ?? 0;
            el.style.transform = `translate(${(md.dx * sx).toFixed(2)}px, ${(md.dy * sy).toFixed(2)}px) rotate(${(baseRot + md.dRot).toFixed(2)}deg) scale(${(md.dScale * (md.dScaleX ?? 1)).toFixed(4)}, ${md.dScale.toFixed(4)})`;
          }
          // 变脸溶解: opacity 设在内层(带 mix-blend 的 img/canvas, el 首子) 而非外层 div — 防 opacity<1 隔离 blend → 正确交叉溶解
          const xfi = ic.xfadeIn ?? 0, xfo = ic.xfadeOut ?? 0;
          const inner = el.firstElementChild as HTMLElement | null;
          if (inner) {
            if (xfi || xfo) {
              let op = 1;
              if (xfi && t - ic.start < xfi) op = Math.max(0, (t - ic.start) / xfi);
              if (xfo && ic.end - t < xfo) op = Math.min(op, Math.max(0, (ic.end - t) / xfo));
              inner.style.opacity = op.toFixed(3);
            } else if (inner.style.opacity) inner.style.opacity = '';
          }
          // 导入 GIF: 当前帧 (按 gifEdit 反转/调速/裁帧) 画到 clip canvas — 跟循环 + 微调同步 (WYSIWYG)
          const gm = cacheRef.current.get(ic.src);
          if (gm && isGifFrames(gm)) {
            const cv = gifCanvasRefs.current.get(ic.id);
            const cx2 = cv?.getContext('2d');
            if (cv && cx2) {
              const fr = drawableAt(gm, t, ic.start, ic.gifEdit);
              if (lastFrameRef.current.get(ic.id) !== fr) {  // 同一帧不重画 (暂停/低 fps 时省 GPU)
                cx2.clearRect(0, 0, cv.width, cv.height);
                try { cx2.drawImage(fr, 0, 0, cv.width, cv.height); lastFrameRef.current.set(ic.id, fr); } catch { /* frame 尚未就绪 */ }
              }
            }
          }
        }
      }
      const phPx = (t * pxPerSecRef.current) + 'px';
      if (playheadRef.current) playheadRef.current.style.left = phPx;
      if (playheadHandleRef.current) playheadHandleRef.current.style.left = phPx;
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  // 循环质量评分
  useEffect(() => {
    if (!project.loop.showSeamScore) { setSeam(null); return; }
    if (project.loop.mode === 'boomerang') { setSeam(0); return; }
    const tid = window.setTimeout(() => {
      try {
        const w = preset.width, h = preset.height;
        const c0 = document.createElement('canvas'); c0.width = w; c0.height = h;
        const c1 = document.createElement('canvas'); c1.width = w; c1.height = h;
        const x0 = c0.getContext('2d', { alpha: false });
        const x1 = c1.getContext('2d', { alpha: false });
        if (!x0 || !x1) return;
        const motionAt = makeLoopMotionAt(D, w, h);
        const bfa = makeBoundFaceAt(D, w, h);
        renderLoopFrame(x0, { t: 0 }, project, w, h, cacheRef.current, motionAt, undefined, '#ffffff', bfa);
        renderLoopFrame(x1, { t: Math.max(0, D - 1 / preset.fps) }, project, w, h, cacheRef.current, motionAt, undefined, '#ffffff', bfa);
        setSeam(loopSeamScore(c0, c1));
        c0.width = c0.height = c1.width = c1.height = 0;   // 释放两块全尺寸 backing store (每次编辑都建一对, 否则 GC 压力, 审计 C2)
      } catch { /* ignore */ }
    }, 200);
    return () => window.clearTimeout(tid);
  }, [project, cacheVer, D, preset]);

  // 画板放大 — 测 stage 实际尺寸, 把画板等比放大铺满 (小尺寸 GIF 如 240² 也填满预览区)
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const recompute = () => {
      const rect = stage.getBoundingClientRect();
      const availW = Math.max(40, rect.width - 32);
      const availH = Math.max(40, rect.height - 32);
      const maxScale = 480 / Math.max(preset.width, preset.height); // 画板封顶 480px → 预览区留余量, 时间轴内容变高时画板不缩 (稳定不割裂)
      const scale = Math.min(availW / preset.width, availH / preset.height, maxScale);
      setFit({ w: Math.round(preset.width * scale), h: Math.round(preset.height * scale) });
    };
    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(stage);
    return () => ro.disconnect();
  }, [preset]);

  // ---- mutators ----
  const patchClip = useCallback((id: string, patch: Partial<ImageClip> | Partial<CaptionClip>) => {
    setProject(p => ({ ...p, clips: p.clips.map(c => (c.id === id ? ({ ...c, ...patch } as Clip) : c)) }));
  }, []);
  const patchTransform = useCallback((id: string, partial: Partial<Transform>) => {
    setProject(p => ({
      ...p,
      clips: p.clips.map(c => {
        if (c.id !== id || c.trackId !== 'image') return c;
        const cur = (c as ImageClip).transform ?? DEFAULT_TRANSFORM;
        return { ...c, transform: { ...cur, ...partial } } as Clip;
      }),
    }));
  }, []);

  // 素材卡片 / 配套单图 / 字幕工具 都 emit DragPayload → 这里建 clip (startAt: 点击=0 全幅; 拖入时间轴=落点时间)
  const addFromPayload = useCallback((payload: DragPayload, startAt = 0) => {
    if (payload.type === 'caption') {
      const id = uid('cap');
      setProject(p => {
        // 位置: 预设给的 captionTransform 优先; 否则按已有字幕数从底往上错开堆叠 (批量导入多行不重叠)
        const capCount = p.clips.filter(c => c.trackId === 'caption').length;
        const ty = payload.captionTransform?.y ?? Math.max(-36, 32 - capCount * 16);
        const tx = payload.captionTransform?.x ?? 0;
        return {
          ...p,
          clips: [...p.clips, {
            id, trackId: 'caption', lane: 0, start: startAt, end: p.duration,
            text: payload.text || '双击编辑文字', style: payload.captionStyle || 'meme',
            fontSize: payload.captionFontSize, color: payload.captionColor,   // 没给 = 自适应字号
            transform: { x: tx, y: ty },
          } as CaptionClip],
        };
      });
      setSelectedId(id);
      return;
    }
    if (!payload.src) return;
    const id = uid('img');
    setProject(p => {
      const clip: ImageClip = {
        id, trackId: 'image', lane: 0, start: startAt, end: p.duration,
        src: payload.src!, label: payload.label || '素材', fx: 'none',
        kind: payload.kind === 'scene' ? 'scene' : undefined,
        transform: { ...DEFAULT_TRANSFORM }, loopMotion: { kind: 'none', amp: 1, cycles: 1 },
      };
      const bumped = p.clips.map(c => (c.trackId === 'image' ? { ...c, lane: c.lane + 1 } as Clip : c));
      return { ...p, clips: [...bumped, clip] };
    });
    setSelectedId(id);
  }, []);

  // 配套 = panda + face 两个独立图层 (各可套不同循环动作). 用编辑器 face 布局算 face 位置, 映射到 GIF 画板
  const addCombo = useCallback(async (panda: Material, face: Material) => {
    try {
      const box = await getEditorPandaBox(panda.src, { fillShell: false, maxPx: 350 });
      const fl = await calcEditorFaceLayout({
        pandaSrc: panda.src, faceSrc: face.src, faceOffset350: panda.faceOffset,
        panda350OffsetX: box.x, panda350OffsetY: box.y, panda350W: box.w, panda350H: box.h,
      });
      // animcore 画 image: 宽 = min(W,H)*0.6*scale, 居中 (cx=W/2+x%/100*W). 编辑器 500 画布映射到画板:
      // K = baseSize/box.w (panda scale=1 占 baseSize); face 偏移按 (中心-250)*K, scale = faceW/pandaW
      const W = preset.width, H = preset.height;
      const baseSize = Math.min(W, H) * 0.6;
      const K = baseSize / box.w;
      // 填满画板: 让 panda 较长边占 ~90% 画板 (原 0.6=只占 60%, 留白太多). 宽 panda→1.5x; 高 panda 按高比缩防溢出裁切. 脸跟着缩放+移位
      const fillScale = 1.5 * Math.min(1, box.w / box.h);
      const fcx = fl.x + fl.width / 2, fcy = fl.y + fl.height / 2;
      const faceTransform: Transform = {
        ...DEFAULT_TRANSFORM,
        x: ((fcx - 250) * K) / W * 100 * fillScale,
        y: ((fcy - 250) * K) / H * 100 * fillScale,
        scale: (fl.width / box.w) * fillScale,
      };
      // 绑定脸跟壳 (默认绑定): 捕获 face 相对 shell 局部位姿 → shell 移动/旋转/缩放时脸自动跟随
      let _sIw = baseSize * fillScale; const _sIh = (box.h / box.w) * _sIw; if (_sIh > H * 0.85) _sIw *= (H * 0.85) / _sIh;
      const faceLocal = captureFaceLocal({ cx: W / 2, cy: H / 2, iw: _sIw }, 0, { cx: W / 2 + (faceTransform.x / 100) * W, cy: H / 2 + (faceTransform.y / 100) * H, iw: baseSize * faceTransform.scale }, 0);
      const pandaId = uid('img'), faceId = uid('img');
      // 图层方案按壳类型 (跟编辑器 getShellLayering 一致): 透明壳→壳在上 multiply(脸透出洞); 不透明壳→脸在上 multiply(脸盖白底, 壳黑特征透出)
      const lay = getShellLayering(panda.id);
      const pandaOnTop = lay.pandaZ > lay.faceZ;
      setProject(p => {
        const bumped = p.clips.map(c => (c.trackId === 'image' ? { ...c, lane: c.lane + 2 } as Clip : c));
        const pandaClip: ImageClip = {
          id: pandaId, trackId: 'image', lane: pandaOnTop ? 0 : 1, start: 0, end: p.duration,
          src: box.croppedSrc, label: panda.labelCn, fx: 'none', blend: lay.pandaBlend === 'multiply' ? 'multiply' : undefined, role: 'shell', shellPandaId: panda.id,
          transform: { ...DEFAULT_TRANSFORM, scale: fillScale }, loopMotion: { kind: 'none', amp: 1, cycles: 1 },
        };
        const faceClip: ImageClip = {
          id: faceId, trackId: 'image', lane: pandaOnTop ? 1 : 0, start: 0, end: p.duration,
          src: face.src, label: face.labelCn + '·脸', fx: 'none', blend: lay.faceBlend === 'multiply' ? 'multiply' : undefined,
          transform: faceTransform, loopMotion: { kind: 'none', amp: 1, cycles: 1 },
          boundTo: pandaId, faceLocal, role: 'face',
        };
        return { ...p, clips: [...bumped, pandaClip, faceClip] };
      });
      setSelectedId(faceId);
      toast.success(`已加 ${panda.labelCn}+${face.labelCn} · 两图层`);
    } catch {
      toast.error('配套合成失败');
    }
  }, [preset]);

  // 草图 (共享 meme 池) → 全幅图层 (+字幕)
  const addDraftToGif = useCallback(async (slot: DraftSlot) => {
    try {
      const { imgSrc, label, text } = await draftToLayers(slot);
      const imgId = uid('di');
      setProject(p => {
        const bumped = p.clips.map(c => (c.trackId === 'image' ? { ...c, lane: c.lane + 1 } as Clip : c));
        const newClips: Clip[] = [{
          id: imgId, trackId: 'image', lane: 0, start: 0, end: p.duration,
          src: imgSrc, label, fx: 'none', transform: { ...DEFAULT_TRANSFORM }, loopMotion: { kind: 'none', amp: 1, cycles: 1 },
        } as ImageClip];
        if (text) newClips.push({
          id: uid('dc'), trackId: 'caption', lane: 0, start: 0, end: p.duration,
          text, style: 'meme', transform: { ...DEFAULT_CAPTION_TRANSFORM },   // 自适应字号 (不写 fontSize)
        } as CaptionClip);
        return { ...p, clips: [...bumped, ...newClips] };
      });
      setSelectedId(imgId);
      toast.success(text ? '已加 画面 + 字幕' : '已加画面');
    } catch {
      toast.error('草图加入失败');
    }
  }, []);

  const matchQ = useCallback((m: Material) => {
    const k = q.trim().toLowerCase();
    if (!k) return true;
    return m.labelCn.toLowerCase().includes(k) || m.labelEn.toLowerCase().includes(k) || m.tags.some(t => t.toLowerCase().includes(k));
  }, [q]);

  const addCaption = useCallback(() => {
    const id = uid('cap');
    setProject(p => {
      const clip: CaptionClip = {
        id, trackId: 'caption', lane: 0, start: 0, end: p.duration,
        text: '双击编辑文字', style: 'meme', transform: { ...DEFAULT_CAPTION_TRANSFORM },   // 自适应字号
      };
      return { ...p, clips: [...p.clips, clip] };
    });
    setSelectedId(id);
  }, []);


  // 循环轨用: 给某图层设动作 (绑定); customMove 给每层一个相对自己的默认 B
  const setLayerMotion = useCallback((id: string, kind: LoopMotionKind) => {
    setProject(p => ({ ...p, clips: p.clips.map(c => {
      if (c.id !== id || c.trackId !== 'image') return c;
      const ic = c as ImageClip;
      const to = kind === 'customMove' ? (ic.loopMotion?.to ?? { ...(ic.transform ?? DEFAULT_TRANSFORM), x: Math.min(50, (ic.transform?.x ?? 0) + 24) }) : ic.loopMotion?.to;
      return { ...ic, loopMotion: { kind, amp: ic.loopMotion?.amp ?? 1, cycles: ic.loopMotion?.cycles ?? 1, to } } as Clip;
    }) }));
  }, []);
  // 把选中主体的动作套到所有图层 (customMove 各层从自己位置出发)
  const applyMotionToAll = useCallback(() => {
    if (!selected || selected.trackId !== 'image') { toast('先选一个图片主体'); return; }
    const m = (selected as ImageClip).loopMotion;
    if (!m || m.kind === 'none') { toast('先选一个有动作的主体'); return; }
    setProject(p => ({ ...p, clips: p.clips.map(c => {
      if (c.trackId !== 'image') return c;
      const ic = c as ImageClip;
      const to = m.kind === 'customMove' ? { ...(ic.transform ?? DEFAULT_TRANSFORM), x: Math.min(50, (ic.transform?.x ?? 0) + 24) } : undefined;
      return { ...ic, loopMotion: { kind: m.kind, amp: m.amp, cycles: m.cycles, to } } as Clip;
    }) }));
    toast.success(`「${LOOP_MOTIONS.find(x => x.kind === m.kind)?.label ?? (m.kind === 'customMove' ? '自定义移动' : m.kind)}」已套到全部图层`);
  }, [selected]);

  // ---- 时间轴 (视频 pxPerSec 模型: 1px=固定时长, 拖块/拖边=直接改时长, 横向滚动, 时长手柄) ----
  const tlMove = (e: React.PointerEvent, clip: Clip) => {
    if (e.button !== 0) return; e.preventDefault(); e.stopPropagation();
    if (clip.id !== selectedId) setSelectedId(clip.id);
    beginDrag();
    const dur = clip.end - clip.start, s0 = clip.start;
    const sx0 = e.clientX;
    const tol = 8 / pxPerSec; // 8px 吸附阈值 → 秒
    const onMove = (ev: PointerEvent) => {
      let ns = clampN(s0 + (ev.clientX - sx0) / pxPerSec, 0, D - dur);
      const snapS = gifSnapTime(ns, projectRef.current.clips, D, clip.id, tol);
      if (snapS.snapped) { ns = clampN(snapS.t, 0, D - dur); setSnapLine(snapS.t); }
      else {
        const snapE = gifSnapTime(ns + dur, projectRef.current.clips, D, clip.id, tol);
        if (snapE.snapped) { ns = clampN(snapE.t - dur, 0, D - dur); setSnapLine(snapE.t); }
        else setSnapLine(null);
      }
      const r = Math.round(ns * 100) / 100;
      patchClip(clip.id, { start: r, end: Math.round((r + dur) * 100) / 100 });
    };
    const onUp = () => { setSnapLine(null); window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp);
  };
  const tlResize = (e: React.PointerEvent, clip: Clip, edge: 'l' | 'r') => {
    if (e.button !== 0) return; e.preventDefault(); e.stopPropagation();
    if (clip.id !== selectedId) setSelectedId(clip.id);
    beginDrag();
    const s0 = clip.start, e0 = clip.end;
    const sx0 = e.clientX;
    const tol = 8 / pxPerSec;
    const onMove = (ev: PointerEvent) => {
      const dt = (ev.clientX - sx0) / pxPerSec;
      if (edge === 'l') {
        let ns = clampN(s0 + dt, 0, e0 - 0.1);
        const snap = gifSnapTime(ns, projectRef.current.clips, D, clip.id, tol);
        if (snap.snapped) { ns = clampN(snap.t, 0, e0 - 0.1); setSnapLine(snap.t); } else setSnapLine(null);
        patchClip(clip.id, { start: Math.round(ns * 100) / 100 });
        setResizeTip({ x: ev.clientX, y: ev.clientY, text: `${(e0 - ns).toFixed(1)}s` });
      } else {
        let ne = clampN(e0 + dt, s0 + 0.1, D);
        const snap = gifSnapTime(ne, projectRef.current.clips, D, clip.id, tol);
        if (snap.snapped) { ne = clampN(snap.t, s0 + 0.1, D); setSnapLine(snap.t); } else setSnapLine(null);
        patchClip(clip.id, { end: Math.round(ne * 100) / 100 });
        setResizeTip({ x: ev.clientX, y: ev.clientY, text: `${(ne - s0).toFixed(1)}s` });
      }
    };
    const onUp = () => { setSnapLine(null); setResizeTip(null); window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp);
  };
  const tlScrub = (e: React.PointerEvent) => {
    const wrap = lanesRef.current; if (!wrap) return;
    if (playing) setPlaying(false);
    const rect = wrap.getBoundingClientRect();
    const upd = (cx: number) => { const tt = clampN((cx - rect.left + wrap.scrollLeft) / pxPerSec, 0, D); frozenRef.current = tt; setScrubT(tt); };
    upd(e.clientX);
    const onMove = (ev: PointerEvent) => upd(ev.clientX);
    const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp);
  };
  // 拖右端手柄改循环时长 D (px → 秒, 跟视频一致)
  const tlDurationDrag = (e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ }
    beginDrag();
    const sx0 = e.clientX, startDur = D;
    const minDur = Math.max(GIF_MIN_DURATION, ...projectRef.current.clips.map(c => c.end));
    const maxDur = Math.min(GIF_MAX_DURATION, preset.maxDuration);
    const onMove = (ev: PointerEvent) => {
      const next = startDur + (ev.clientX - sx0) / pxPerSec;
      setDuration(Math.round(clampN(next, minDur, maxDur) * 2) / 2);
    };
    const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp);
  };
  // 素材拖入时间轴 → 落点 X = clip 起点
  const tlDragOver = (e: React.DragEvent) => { if (!e.dataTransfer.types.includes('application/x-meme')) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setTlDropActive(true); };
  const tlDrop = (e: React.DragEvent) => {
    e.preventDefault(); setTlDropActive(false);
    const raw = e.dataTransfer.getData('application/x-meme'); if (!raw) return;
    let payload: DragPayload; try { payload = JSON.parse(raw) as DragPayload; } catch { return; }
    if (payload.type === 'tts' || payload.type === 'bgm') { toast.warning('GIF 无声音'); return; }
    const wrap = lanesRef.current;
    const start = wrap ? clampN((e.clientX - wrap.getBoundingClientRect().left + wrap.scrollLeft) / pxPerSec, 0, Math.max(0, D - 0.3)) : 0;
    addFromPayload(payload, Math.round(start * 100) / 100);
  };

  const deleteClip = useCallback((id: string) => {
    setProject(p => {
      const del = p.clips.find(c => c.id === id) as ImageClip | undefined;
      let next = p.clips.filter(c => c.id !== id).map(c =>  // 删壳时清掉跟随它的脸的 boundTo (防悬挂引用)
        (c.trackId === 'image' && (c as ImageClip).boundTo === id) ? ({ ...c, boundTo: undefined, faceLocal: undefined } as Clip) : c);
      // 删的是变脸里的一张脸 → 重排剩余脸时段消除空脸洞 (剩 ≥1 才重排; 剩 1 张自动全幅)
      const shellId = del?.trackId === 'image' ? del.boundTo : undefined;
      if (shellId && next.some(c => c.trackId === 'image' && (c as ImageClip).boundTo === shellId)) {
        next = rewindowCycle(next, shellId, p.duration);
      }
      return { ...p, clips: next };
    });
    setSelectedId(prev => (prev === id ? null : prev));
  }, []);

  // ============ 右键菜单 + 切分/反转 (做动作) ============
  const ctxMenu = useContextMenu();
  // 切分: [start,end] → [start,t] + [t,end] (B 复制 src/transform/gifEdit/loopMotion). 全走 setProject = 自动 history
  const gifSplit = useCallback((id: string, t: number) => {
    setProject(p => {
      const c = p.clips.find(x => x.id === id); if (!c) return p;
      if (t <= c.start + 0.1 || t >= c.end - 0.1) return p;
      const base = { id: uid(c.trackId === 'image' ? 'img' : 'cap'), lane: c.lane, start: t, end: c.end };
      const b: Clip = c.trackId === 'image'
        ? ({ ...base, trackId: 'image', src: (c as ImageClip).src, label: (c as ImageClip).label, fx: (c as ImageClip).fx, kind: (c as ImageClip).kind,
            transform: { ...((c as ImageClip).transform ?? DEFAULT_TRANSFORM) },
            gifEdit: (c as ImageClip).gifEdit ? { ...(c as ImageClip).gifEdit! } : undefined,
            loopMotion: (c as ImageClip).loopMotion ? { ...(c as ImageClip).loopMotion! } : undefined,
            // 保留配套元数据 (切分后 B 段仍是合法的壳/脸, 绑定不丢; 只拆脸时两半都自动跟随整壳)
            boundTo: (c as ImageClip).boundTo, faceLocal: (c as ImageClip).faceLocal ? { ...(c as ImageClip).faceLocal! } : undefined,
            role: (c as ImageClip).role, blend: (c as ImageClip).blend, shellPandaId: (c as ImageClip).shellPandaId } as ImageClip)
        : ({ ...base, trackId: 'caption', text: (c as CaptionClip).text, fontSize: (c as CaptionClip).fontSize,
            color: (c as CaptionClip).color, style: (c as CaptionClip).style, transform: (c as CaptionClip).transform } as CaptionClip);
      return { ...p, clips: [...p.clips.map(x => x.id === id ? ({ ...x, end: t } as Clip) : x), b] };
    });
    toast.success('已切分为两段');
  }, []);
  // 来回动作: GIF 切分→后半帧倒放 (前进→后退); 静态图→customMove 自带 A→B→A 往返
  const loopBackAndForth = useCallback((id: string, t: number) => {
    const c = projectRef.current.clips.find(x => x.id === id);
    if (!c || c.trackId !== 'image') { toast('请先选画面图层'); return; }
    const ic = c as ImageClip;
    const gm = isGifSrc(ic.src) ? cacheRef.current.get(ic.src) : undefined;
    if (gm && isGifFrames(gm)) {
      const total = gm.frames.length;
      setProject(p => {
        const cc = p.clips.find(x => x.id === id) as ImageClip | undefined;
        if (!cc || t <= cc.start + 0.1 || t >= cc.end - 0.1) return p;
        const b: ImageClip = { id: uid('img'), trackId: 'image', lane: cc.lane, start: t, end: cc.end,
          src: cc.src, label: cc.label, fx: cc.fx, kind: cc.kind,
          transform: { ...(cc.transform ?? DEFAULT_TRANSFORM) },
          gifEdit: normGifEdit(cc, total, { reverse: !(cc.gifEdit?.reverse ?? false) }),
          loopMotion: cc.loopMotion ? { ...cc.loopMotion } : undefined };
        return { ...p, clips: [...p.clips.map(x => x.id === id ? ({ ...x, end: t } as Clip) : x), b] };
      });
      toast.success('来回动作 ✓ — 后半段倒放');
    } else {
      const baseT = ic.transform ?? DEFAULT_TRANSFORM;
      const to = ic.loopMotion?.to ?? { ...baseT, x: clampN(baseT.x + 24, -120, 120) };
      patchClip(id, { loopMotion: { kind: 'customMove', amp: ic.loopMotion?.amp ?? 1, cycles: ic.loopMotion?.cycles ?? 1, to } });
      setSelectedId(id); setCustomEdit(true);
      toast.success('来回动作 ✓ — 拖画板橙色 B 点设「移动到哪」');
    }
  }, [patchClip]);
  const duplicateClipGif = useCallback((id: string) => {
    setProject(p => {
      const c = p.clips.find(x => x.id === id); if (!c) return p;
      const dur = c.end - c.start;
      const ns = Math.max(0, Math.min(p.duration - dur, c.end));
      const base = { id: uid(c.trackId === 'image' ? 'img' : 'cap'), lane: c.lane, start: ns, end: ns + dur };
      const dup: Clip = c.trackId === 'image'
        ? ({ ...base, trackId: 'image', src: (c as ImageClip).src, label: (c as ImageClip).label, fx: (c as ImageClip).fx, kind: (c as ImageClip).kind,
            transform: { ...((c as ImageClip).transform ?? DEFAULT_TRANSFORM) },
            gifEdit: (c as ImageClip).gifEdit ? { ...(c as ImageClip).gifEdit! } : undefined,
            loopMotion: (c as ImageClip).loopMotion ? { ...(c as ImageClip).loopMotion! } : undefined } as ImageClip)
        : ({ ...base, trackId: 'caption', text: (c as CaptionClip).text, fontSize: (c as CaptionClip).fontSize,
            color: (c as CaptionClip).color, style: (c as CaptionClip).style, transform: (c as CaptionClip).transform } as CaptionClip);
      return { ...p, clips: [...p.clips, dup] };
    });
  }, []);
  const moveLayer = useCallback((id: string, dir: -1 | 1) => {
    setProject(p => {
      const c = p.clips.find(x => x.id === id); if (!c) return p;
      const group = p.clips.filter(x => x.trackId === c.trackId).slice().sort((a, b) => a.lane - b.lane);
      const i = group.findIndex(x => x.id === id); const j = i + dir;
      if (j < 0 || j >= group.length) return p;
      const re = group.slice(); const [m] = re.splice(i, 1); re.splice(j, 0, m);
      const laneById = new Map<string, number>(); re.forEach((x, k) => laneById.set(x.id, k));
      return { ...p, clips: p.clips.map(x => laneById.has(x.id) ? ({ ...x, lane: laneById.get(x.id)! } as Clip) : x) };
    });
  }, []);
  const buildGifClipMenu = useCallback((c: Clip): ContextMenuItem[] => {
    const cutT = clampN(loopTimeMap(scrubT, D, project.loop.mode), 0, D);
    const splitDisabled = cutT <= c.start + 0.1 || cutT >= c.end - 0.1;
    const isImg = c.trackId === 'image';
    const ic = isImg ? (c as ImageClip) : null;
    const gm = ic && isGifSrc(ic.src) ? cacheRef.current.get(ic.src) : undefined;
    const gifFrames = gm && isGifFrames(gm) ? gm : null;
    const total = gifFrames ? gifFrames.frames.length : 0;
    const lm = ic?.loopMotion;
    const group = project.clips.filter(x => x.trackId === c.trackId).slice().sort((a, b) => a.lane - b.lane);
    const idx = group.findIndex(x => x.id === c.id);
    const items: ContextMenuItem[] = [
      { id: 'split', label: '切分 (在游标处)', shortcut: 'S', icon: <Scissors size={12} />, disabled: splitDisabled, onClick: () => gifSplit(c.id, cutT) },
    ];
    if (isImg) items.push({ id: 'backforth', label: '来回动作 (切分 + 后半倒放)', icon: <ArrowLeftRight size={12} />, disabled: splitDisabled, onClick: () => loopBackAndForth(c.id, cutT) });
    items.push({ id: 'dup', label: '复制图层', icon: <CopyIcon size={12} />, onClick: () => duplicateClipGif(c.id) });
    items.push({ id: 'sep1', label: '', separator: true });
    items.push({ id: 'up', label: '上移一层 (更前)', icon: <ChevronUp size={12} />, disabled: idx <= 0, onClick: () => moveLayer(c.id, -1) });
    items.push({ id: 'down', label: '下移一层 (更后)', icon: <ChevronDown size={12} />, disabled: idx >= group.length - 1, onClick: () => moveLayer(c.id, 1) });
    if (ic) {
      items.push({ id: 'sep2', label: '', separator: true });
      items.push({ id: 'flipx', label: ic.transform?.flipX ? '取消水平镜像' : '水平镜像翻转', icon: <FlipHorizontal size={12} />, onClick: () => patchTransform(c.id, { flipX: !ic.transform?.flipX }) });
      if (gifFrames) {
        items.push({ id: 'gif-rev', label: (ic.gifEdit?.reverse ? '✓ ' : '') + '帧倒放 (反转 GIF)', onClick: () => patchClip(c.id, { gifEdit: normGifEdit(ic, total, { reverse: !ic.gifEdit?.reverse }) }) });
        items.push({ id: 'gif-boom', label: (ic.gifEdit?.perClipBoomerang ? '✓ ' : '') + '本帧乒乓 (来回播)', onClick: () => patchClip(c.id, { gifEdit: normGifEdit(ic, total, { perClipBoomerang: !ic.gifEdit?.perClipBoomerang }) }) });
      }
      items.push({ id: 'motion', label: '循环动作' + (lm && lm.kind !== 'none' ? ' · ' + motionMeta(lm.kind).label : ''), icon: <Sparkles size={12} />,
        submenu: LOOP_MOTIONS.map(m => ({ id: 'm-' + m.kind, label: m.emoji + ' ' + m.label + (lm?.kind === m.kind ? '  ✓' : ''), onClick: () => setLayerMotion(c.id, m.kind) })) });
    }
    if (c.trackId === 'caption') {
      items.push({ id: 'sep-cap', label: '', separator: true });
      items.push({ id: 'cap-edit', label: '编辑文字', icon: <TypeIcon size={12} />, onClick: () => { setSelectedId(c.id); setEditingCaptionId(c.id); } });
    }
    items.push({ id: 'sep3', label: '', separator: true });
    items.push({ id: 'copy-tc', label: '复制时间码', onClick: () => { const tc = `${c.start.toFixed(2)} → ${c.end.toFixed(2)}s (${(c.end - c.start).toFixed(2)}s)`; try { navigator.clipboard.writeText(tc); toast.success('已复制: ' + tc); } catch { toast.error('剪贴板不可用'); } } });
    items.push({ id: 'info', label: `📋 ${isImg ? '画面' : '字幕'} · L${c.lane + 1} · ${(c.end - c.start).toFixed(1)}s`, disabled: true });
    items.push({ id: 'sep4', label: '', separator: true });
    items.push({ id: 'del', label: '删除图层', shortcut: 'Del', danger: true, icon: <Trash2 size={12} />, onClick: () => deleteClip(c.id) });
    return items;
  }, [scrubT, D, project.loop.mode, project.clips, gifSplit, loopBackAndForth, duplicateClipGif, moveLayer, patchClip, patchTransform, setLayerMotion, deleteClip]);
  const onGifClipContextMenu = useCallback((e: React.MouseEvent, c: Clip) => {
    setSelectedId(c.id);
    ctxMenu.open(e, buildGifClipMenu(c));
  }, [ctxMenu, buildGifClipMenu]);
  // 空白处右键 (时间轴空白 / 画板空白) — 全局右键覆盖
  const buildGifEmptyMenu = useCallback((): ContextMenuItem[] => [
    { id: 'deselect', label: '取消选择', disabled: !selectedId, onClick: () => setSelectedId(null) },
    { id: 'add-cap', label: '加空白字幕', icon: <TypeIcon size={12} />, onClick: () => addCaption() },
    { id: 'sep', label: '', separator: true },
    { id: 'clear', label: '清空画板', danger: true, disabled: project.clips.length === 0, onClick: () => clearAll() },
  ], [selectedId, project.clips.length, addCaption, clearAll]);

  const setDuration = useCallback((d: number) => {
    const dd = Math.max(GIF_MIN_DURATION, Math.min(d, GIF_MAX_DURATION, preset.maxDuration));
    setProject(p => ({ ...p, duration: dd, clips: clampClipsToDuration(p.clips, p.duration, dd) }));
  }, [preset]);

  const setPresetId = useCallback((id: GifPresetId) => {
    const pr = resolveGifPreset(id);
    setProject(p => {
      const dd = Math.min(p.duration, pr.maxDuration, GIF_MAX_DURATION);
      return { ...p, preset: id, duration: dd, clips: clampClipsToDuration(p.clips, p.duration, dd) };
    });
  }, []);

  const setLoopMode = useCallback((mode: GifLoopMode) => {
    setProject(p => ({ ...p, loop: { ...p.loop, mode } }));
  }, []);

  const togglePlay = useCallback(() => {
    const now = performance.now();
    if (playing) { frozenRef.current = (now - startRef.current) / 1000; }
    else { startRef.current = now - frozenRef.current * 1000; }
    setPlaying(v => !v);
  }, [playing]);

  // 粘贴图片 (跟编辑器/视频视图一致): 截图二进制 或 图片 URL → 存进 GIF 素材池 (缓存) + 右上角 toast. 仅 GIF 视图.
  useEffect(() => {
    if (view !== 'gif') return;
    const addPasted = (dataUrl: string) => {
      const cur = gifUploadsRef.current;
      if (cur.length >= GIF_UPLOAD_MAX) { toast.error(`GIF 素材库已达 ${GIF_UPLOAD_MAX} 张上限`); return; }
      const usedBytes = cur.reduce((a, m) => a + (m.src?.length || 0), 0);
      if (usedBytes + dataUrl.length > GIF_UPLOAD_MAX_BYTES) { toast.error(`GIF 素材库存储已满 (${(GIF_UPLOAD_MAX_BYTES / 1024 / 1024).toFixed(0)}MB)`); return; }
      const mat: Material = { id: `paste-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, src: dataUrl, labelCn: '粘贴图', labelEn: 'Pasted', tags: [], tagsEn: [], faceOffset: { x: 100, y: 70, w: 250, h: 250 }, kind: 'upload' };
      setGifUploads(prev => [mat, ...prev].slice(0, GIF_UPLOAD_MAX));
      toast.success('✓ 已粘贴到 GIF 素材库「上传」分页 — 点缩略图加入');
    };
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const items = e.clipboardData?.items;
      if (!items || items.length === 0) return;
      for (const item of items) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const blob = item.getAsFile(); if (!blob) continue;
          e.preventDefault();
          const r = new FileReader();
          r.onload = () => addPasted(String(r.result || ''));
          r.readAsDataURL(blob);
          return;
        }
      }
      for (const item of items) {
        if (item.kind === 'string' && item.type === 'text/plain') {
          item.getAsString((raw) => {
            const url = raw.trim();
            if (!/^https?:\/\//i.test(url) || !/\.(jpe?g|png|gif|webp|bmp|avif)(\?|#|$)/i.test(url)) return;
            const tid = toast.loading('下载链接图片中…');
            fetchAsDataUrl(url).then(d => { toast.dismiss(tid); addPasted(d); }).catch(err => toast.error(`粘贴失败: ${(err as Error).message}`, { id: tid }));
          });
          return;
        }
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [view]);

  // GIF 自己的快捷键 (仅 GIF 视图, 跟视频彻底分开) — Space 播放/暂停循环
  useEffect(() => {
    if (view !== 'gif') return;
    const onKey = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement | null;
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); redo(); return; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) { e.preventDefault(); deleteClip(selectedId); return; }
      if ((e.key === 's' || e.key === 'S') && !mod && selectedId) { e.preventDefault(); const dd = projectRef.current.duration; const ct = clampN(loopTimeMap(frozenRef.current, dd, projectRef.current.loop.mode), 0, dd); gifSplit(selectedId, ct); return; }
      if (e.key === 'Escape') { e.preventDefault(); setSelectedId(null); return; }
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view, togglePlay, undo, redo, deleteClip, selectedId, gifSplit]);

  // DEV: 当前 GIF 项目 → TS 模板代码 (Ctrl+Shift+T, 跟视频 __dumpTemplate 对齐; window.__dumpGifTemplate)
  useEffect(() => {
    if (!import.meta.env.DEV || view !== 'gif') return;
    const dumpTemplate = () => {
      const p = projectRef.current;
      const tmpl = {
        kind: 'gif-project', preset: p.preset, duration: p.duration, lanes: p.lanes, loop: p.loop,
        clips: p.clips.map(c => {
          const cc = { ...c } as Record<string, unknown>;
          const s = (c as ImageClip).src;
          if (c.trackId === 'image' && typeof s === 'string' && s.startsWith('data:')) cc.src = '<dataURL>';
          return cc;
        }),
      };
      const code = `// GIF 模板 · ${new Date().toISOString().slice(0, 19).replace('T', ' ')}\nconst GIF_TEMPLATE = ${JSON.stringify(tmpl, null, 2)};`;
      // eslint-disable-next-line no-console
      console.log('📋 ===== GIF Template TS =====\n' + code);
      try { void navigator.clipboard.writeText(code); toast.success('📋 GIF 模板代码 → 剪贴板'); } catch { toast.success('📋 GIF 模板代码 → console'); }
    };
    const win = window as unknown as { __dumpGifTemplate?: () => void };
    win.__dumpGifTemplate = dumpTemplate;
    const onKey = (e: KeyboardEvent) => { if (e.ctrlKey && e.shiftKey && (e.code === 'KeyT' || e.key === 'T' || e.key === 't')) { e.preventDefault(); dumpTemplate(); } };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); delete win.__dumpGifTemplate; };
  }, [view]);

  // 上传文件 → 落入 gifUploads 素材池 (持久化 IDB, 可反复加入画板/删除), 而非一次性塞进画板.
  // 多图 + 体积/尺寸/数量/总量校验 (对齐视频 handleFile). 点卡片用 addFromPayload 加入画板.
  const handleGifFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []); e.target.value = '';
    if (files.length === 0) return;
    let added = 0, rejected = 0;
    let usedBytes = gifUploads.reduce((a, m) => a + (m.src?.length || 0), 0);
    for (const f of files) {
      if (gifUploads.length + added >= GIF_UPLOAD_MAX) { toast.error(`已达数量上限 ${GIF_UPLOAD_MAX} 张`); break; }
      if (f.size > GIF_UPLOAD_MAX_FILE_BYTES) { toast.error(`${f.name} 超过 30MB`); rejected++; continue; }
      try {
        const dataUrl = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result || '')); r.onerror = () => rej(new Error('read')); r.readAsDataURL(f); });
        const dims = await new Promise<{ w: number; h: number }>((res, rej) => { const im = new Image(); im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight }); im.onerror = () => rej(new Error('img')); im.src = dataUrl; });
        if (dims.w > GIF_UPLOAD_MAX_DIM || dims.h > GIF_UPLOAD_MAX_DIM) { toast.error(`${f.name} 尺寸超 ${GIF_UPLOAD_MAX_DIM}px`); rejected++; continue; }
        if (usedBytes + dataUrl.length > GIF_UPLOAD_MAX_BYTES) { toast.error('素材池存储已满 (300MB)'); rejected++; break; }
        usedBytes += dataUrl.length;
        const labelCn = f.name.split('.')[0].slice(0, 12) || `上传${added + 1}`;
        const tags = gifUploadKind === 'scene' ? ['上传', '场景'] : gifUploadKind === 'panda' ? ['上传', '熊猫'] : gifUploadKind === 'face' ? ['上传', '表情'] : ['上传'];
        const mat: Material = { id: uid('gu'), src: dataUrl, labelCn, labelEn: labelCn, tags, tagsEn: ['upload'], faceOffset: { x: 0, y: 0, w: 0, h: 0 }, kind: gifUploadKind };
        setGifUploads(prev => [mat, ...prev].slice(0, GIF_UPLOAD_MAX));
        added++;
      } catch { rejected++; }
    }
    if (added > 0) toast.success(`已上传 ${added} 张${rejected ? ` (${rejected} 拒绝)` : ''} · 点卡片加入画板`);
    else if (rejected > 0) toast.error('全部上传失败');
  };
  const handleClearGifUploads = async () => {
    const list = gifUploads.filter(u => (u.tags || []).includes('上传'));
    if (list.length === 0) return;
    const { confirmed } = await showDialog({ title: '清空上传素材', message: `清空全部 ${list.length} 张上传图? (搜图/抠脸的不动)`, destructive: true, confirmText: '清空', cancelText: '取消' });
    if (confirmed) { setGifUploads(prev => prev.filter(u => !(u.tags || []).includes('上传'))); toast.success('已清空上传素材'); }
  };

  const onExport = useCallback(async () => {
    if (exporting) return;
    setExporting(true);
    const tid = toast.loading('正在生成 GIF… 0%');
    try {
      const r = await exportGIFLoop(project, '熊猫头循环', p => {
        toast.loading(`${p < 0.5 ? '渲染帧' : '编码'} ${Math.round(p * 100)}%…`, { id: tid });
      });
      toast.success(`导出成功 · ${(r.size / 1024).toFixed(0)}KB · ${r.frameCount}帧 · ${r.width}×${r.height}`, { id: tid });
    } catch (e) {
      toast.error('导出失败: ' + (e instanceof Error ? e.message : '未知错误'), { id: tid });
    } finally {
      setExporting(false);
    }
  }, [project, exporting]);

  const openVariants = useCallback(async () => {
    if (variantBusy) return;
    setVariantBusy(true); setVariantOpen(true);
    setVariants(prev => { prev?.forEach(x => URL.revokeObjectURL(x.url)); return null; });  // 先回收上一批 blob URL 防泄漏
    const tid = toast.loading('生成三种变体… 0%');
    try {
      const vs = await exportGIFVariants(project, p => { toast.loading(`生成变体 ${Math.round(p * 100)}%…`, { id: tid }); });
      setVariants(vs.map(v => ({ v, url: URL.createObjectURL(v.blob) })));
      toast.success('三种变体已就绪', { id: tid });
    } catch (e) {
      toast.error('变体生成失败: ' + (e instanceof Error ? e.message : ''), { id: tid });
      setVariantOpen(false);
    } finally {
      setVariantBusy(false);
    }
  }, [project, variantBusy]);
  const closeVariants = useCallback(() => {
    setVariants(prev => { prev?.forEach(x => URL.revokeObjectURL(x.url)); return null; });
    setVariantOpen(false);
  }, []);
  // 卸载兜底: 开着对比变体直接切走视图时回收 3 个 blob URL
  const variantsRef = useRef(variants); variantsRef.current = variants;
  useEffect(() => () => { variantsRef.current?.forEach(x => URL.revokeObjectURL(x.url)); }, []);

  // ---- GIF 草稿 (独立 IDB, 不与 video/animate 草稿混) ----
  const persistGifDrafts = useCallback((next: GifDraftSlot[]) => {
    setGifDrafts(next);
    void idbSet(GIF_DRAFTS_IDB_KEY, next).catch(() => {});
  }, []);
  const saveGifDraft = useCallback(async () => {
    const firstImg = project.clips.find(c => c.trackId === 'image') as ImageClip | undefined;
    // 缩略图: 渲染配套首帧 (壳+脸+字幕合成) 而非只取首图 src — 修 GIF 草稿预览只有空壳没脸 (首图=壳, 漏绑定脸)
    let thumbSrc: string | undefined;
    try {
      const W = preset.width, H = preset.height;
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const cx2 = cv.getContext('2d');
      if (cx2) {
        renderLoopFrame(cx2, loopSpecAt(0, D, project.loop, preset.fps), project, W, H, cacheRef.current, makeLoopMotionAt(D, W, H), undefined, '#ffffff', makeBoundFaceAt(D, W, H));
        thumbSrc = await makeDraftThumb(cv.toDataURL('image/png'));
      }
      cv.width = cv.height = 0;
    } catch { /* 渲染失败 → 退回首图 src */ }
    if (!thumbSrc) thumbSrc = firstImg?.src ? await makeDraftThumb(firstImg.src) : undefined;  // 96px webp 缩略图 (省 IDB)
    const slot: GifDraftSlot = {
      id: uid('gd'), name: `GIF草稿${gifDrafts.length + 1}`, updatedAt: Date.now(),
      project: JSON.parse(JSON.stringify(project)) as GifProject, thumbSrc,
    };
    persistGifDrafts([slot, ...gifDrafts].slice(0, GIF_DRAFT_MAX));
    toast.success(`已保存为 ${slot.name}`);
  }, [project, gifDrafts, persistGifDrafts]);
  const loadGifDraft = useCallback((slot: GifDraftSlot) => {
    historyRef.current = { past: [], future: [] }; // 读草稿 = 全新项目, 清历史
    skipHistRef.current = true;
    setProject(slot.project);
    setSelectedId(slot.project.clips[0]?.id ?? null);
    setScrubT(0); frozenRef.current = 0; startRef.current = performance.now();
    setDraftPopOpen(false);
    setHistTick(t => t + 1);
    toast.success(`已读入 ${slot.name}`);
  }, []);
  const deleteGifDraft = useCallback((id: string) => {
    persistGifDrafts(gifDrafts.filter(s => s.id !== id));
  }, [gifDrafts, persistGifDrafts]);

  // ---- 基本模块 (对齐视频): 新建 / 导出·导入 JSON / 全屏预览 ----
  const newProject = useCallback(async () => {
    if (projectRef.current.clips.length > 0) {
      const { confirmed } = await showDialog({ title: '新建空白 GIF', message: '会清空当前画板 (已存草稿 / 导出过的文件不受影响). 继续?', variant: 'warning', confirmText: '新建', cancelText: '取消' });
      if (!confirmed) return;
    }
    historyRef.current = { past: [], future: [] };
    skipHistRef.current = true;
    setProject(makeDefaultGifProject());
    setSelectedId(null);
    setScrubT(0); frozenRef.current = 0; startRef.current = performance.now();
    setHistTick(t => t + 1);
    toast.success('已新建空白 GIF');
  }, []);
  const exportProjectJSON = useCallback(() => {
    try {
      const blob = new Blob([JSON.stringify(projectRef.current, null, 2)], { type: 'application/json' });
      downloadBlob(blob, 'gif项目-' + new Date().toISOString().slice(0, 10), 'json');
      toast.success('已导出项目 JSON');
    } catch (e) { toast.error('导出失败: ' + (e instanceof Error ? e.message : '')); }
  }, []);
  const importProjectJSON = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result || '')) as GifProject;
        if (data?.kind !== 'gif-project' || !Array.isArray(data.clips)) { toast.error('不是有效的 GIF 项目 JSON'); return; }
        // 容错: loop/duration/lanes/clips 缺失或非法 → 补默认 + 夹范围, 防外来 JSON 让渲染崩
        const pr = resolveGifPreset(data.preset);
        const dur = Number.isFinite(data.duration) ? Math.max(GIF_MIN_DURATION, Math.min(data.duration, GIF_MAX_DURATION, pr.maxDuration)) : pr.defaultDuration;
        const safe: GifProject = {
          kind: 'gif-project', version: 1, preset: pr.id, duration: dur,
          loop: { ...DEFAULT_LOOP_CONFIG, ...(data.loop || {}) },
          lanes: { image: data.lanes?.image ?? 1, caption: data.lanes?.caption ?? 1, fx: data.lanes?.fx ?? 1 },
          clips: (data.clips.filter(c => c && (c.trackId === 'image' || c.trackId === 'caption') && (c.trackId !== 'image' || !!(c as ImageClip).src)) as Clip[])
            .map(c => ({ ...c, start: Math.max(0, Math.min(Number.isFinite(c.start) ? c.start : 0, Math.max(0, dur - 0.1))), end: Math.max(0.1, Math.min(Number.isFinite(c.end) ? c.end : dur, dur)) } as Clip)),
        };
        // 清掉悬挂 boundTo (引用的壳没活下来 → 防绑定脸渲染异常)
        const liveIds = new Set(safe.clips.map(c => c.id));
        safe.clips = safe.clips.map(c => (c.trackId === 'image' && (c as ImageClip).boundTo && !liveIds.has((c as ImageClip).boundTo!)) ? ({ ...c, boundTo: undefined, faceLocal: undefined } as Clip) : c);
        historyRef.current = { past: [], future: [] };
        skipHistRef.current = true;
        setProject(normalizeCombo(safe));
        setSelectedId(safe.clips[0]?.id ?? null);
        setScrubT(0); frozenRef.current = 0; startRef.current = performance.now();
        setHistTick(t => t + 1);
        toast.success(`已导入项目 (${safe.clips.length} 层)`);
      } catch (e) { toast.error('JSON 解析失败: ' + (e instanceof Error ? e.message : '')); }
    };
    reader.readAsText(file);
  }, []);
  // 全屏预览 — 大 canvas rAF 渲染循环 (跟导出同 renderLoopFrame, 所见即所得)
  useEffect(() => {
    if (!previewOpen) return;
    const cv = previewCanvasRef.current; if (!cv) return;
    const pr0 = resolveGifPreset(projectRef.current.preset);
    cv.width = pr0.width; cv.height = pr0.height;
    const ctx = cv.getContext('2d', { alpha: false }); if (!ctx) return;
    const scratch = document.createElement('canvas'); scratch.width = pr0.width; scratch.height = pr0.height;
    const sctx = scratch.getContext('2d', { alpha: true }) ?? undefined;
    const t0 = performance.now();
    let raf = 0;
    const draw = () => {
      const p = projectRef.current;
      const pr = resolveGifPreset(p.preset);
      const D = p.duration;
      const t = loopTimeMap((performance.now() - t0) / 1000, D, p.loop.mode);
      renderLoopFrame(ctx, loopSpecAt(t, D, p.loop, pr.fps), p, pr.width, pr.height, cacheRef.current, makeLoopMotionAt(D, pr.width, pr.height), sctx, '#ffffff', makeBoundFaceAt(D, pr.width, pr.height));
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [previewOpen]);

  // ---- 一键随机: 随机 panda+face 两图层 + 随机字幕 + 脸随机循环动作 (身体不动, 清空重来, 无音轨) ----
  const gifRandomize = useCallback(async () => {
    if (projectRef.current.clips.length > 0) {
      const { confirmed } = await showDialog({ title: '随机生成', message: '会清空当前画板重新随机 (已存草稿/导出的不受影响). 继续?', variant: 'warning', confirmText: '随机', cancelText: '取消' });
      if (!confirmed) return;
    }
    const panda = ALL_PANDAS[Math.floor(Math.random() * ALL_PANDAS.length)];
    const face = ALL_FACES[Math.floor(Math.random() * ALL_FACES.length)];
    // 跟快速/编辑器同文案池 (pickRandomText), 但挑短的 (≤ GIF_CAP_MAXCHARS) 保证一行装下; 实在长就截断
    let cap = pickRandomText('zh', 'all') || '';
    for (let tries = 0; cap.length > GIF_CAP_MAXCHARS && tries < 6; tries++) cap = pickRandomText('zh', 'all') || cap;
    if (cap.length > GIF_CAP_MAXCHARS) cap = cap.slice(0, GIF_CAP_MAXCHARS);
    // 更丰富的随机: 脸动作从全集挑(含鬼畜系) + 随机幅度/周期; 身体 ~40% 也来个轻动作; 随机循环方式
    const rPick = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)];
    const faceMotions: LoopMotionKind[] = ['bob', 'shimmy', 'sway', 'breathe', 'pulseLoop', 'bounce', 'orbit', 'hop', 'wobble', 'jitter', 'punch', 'swing', 'flip'];
    const bodyMotions: LoopMotionKind[] = ['bob', 'sway', 'breathe', 'wobble', 'shimmy', 'float', 'bounce', 'pulseLoop'];  // 壳也必有动作 (去掉 none, 脸+壳都动)
    const rRange = (a: number, b: number) => Number((a + Math.random() * (b - a)).toFixed(2));
    const faceMotion = rPick(faceMotions);
    const bodyMotion = rPick(bodyMotions);
    const faceAmp = rRange(0.7, 2.0);            // 真随机幅度 (拉宽范围 → 每次明显不同: 0.7 轻微 ~ 2.0 夸张)
    const faceCycles = rPick([1, 2, 2, 3, 4]);   // 真随机速度 (1 慢 ~ 4 快)
    const bodyAmp = rRange(0.5, 1.5);
    const bodyCycles = rPick([1, 1, 2, 3]);
    const loopMode: GifLoopMode = (() => { const r = Math.random(); return r < 0.5 ? 'normal' : r < 0.82 ? 'boomerang' : 'crossfade'; })();   // 精简后只随机 3 种
    try {
      const box = await getEditorPandaBox(panda.src, { fillShell: false, maxPx: 350 });
      const fl = await calcEditorFaceLayout({
        pandaSrc: panda.src, faceSrc: face.src, faceOffset350: panda.faceOffset,
        panda350OffsetX: box.x, panda350OffsetY: box.y, panda350W: box.w, panda350H: box.h,
      });
      const W = preset.width, H = preset.height;
      const baseSize = Math.min(W, H) * 0.6; const K = baseSize / box.w;
      const fillScale = 1.5 * Math.min(1, box.w / box.h);  // 填满画板 (跟 addCombo 一致, 减留白)
      const fcx = fl.x + fl.width / 2, fcy = fl.y + fl.height / 2;
      const faceT: Transform = { ...DEFAULT_TRANSFORM, x: ((fcx - 250) * K) / W * 100 * fillScale, y: ((fcy - 250) * K) / H * 100 * fillScale, scale: (fl.width / box.w) * fillScale };
      let _sIwR = baseSize * fillScale; const _sIhR = (box.h / box.w) * _sIwR; if (_sIhR > H * 0.85) _sIwR *= (H * 0.85) / _sIhR;
      const faceLocalR = captureFaceLocal({ cx: W / 2, cy: H / 2, iw: _sIwR }, 0, { cx: W / 2 + (faceT.x / 100) * W, cy: H / 2 + (faceT.y / 100) * H, iw: baseSize * faceT.scale }, 0);
      const pid = uid('img'), fid = uid('img');
      const layR = getShellLayering(panda.id);
      const pandaOnTopR = layR.pandaZ > layR.faceZ;  // 透明壳→壳在上 multiply; 不透明壳→脸在上 multiply (跟编辑器一致)
      setProject(p => {
        const clips: Clip[] = [
          { id: pid, trackId: 'image', lane: pandaOnTopR ? 0 : 1, start: 0, end: p.duration, src: box.croppedSrc, label: panda.labelCn, fx: 'none', blend: layR.pandaBlend === 'multiply' ? 'multiply' : undefined, role: 'shell', shellPandaId: panda.id, transform: { ...DEFAULT_TRANSFORM, scale: fillScale }, loopMotion: { kind: bodyMotion, amp: bodyAmp, cycles: bodyCycles } } as ImageClip,
          { id: fid, trackId: 'image', lane: pandaOnTopR ? 1 : 0, start: 0, end: p.duration, src: face.src, label: face.labelCn + '·脸', fx: 'none', blend: layR.faceBlend === 'multiply' ? 'multiply' : undefined, transform: faceT, loopMotion: { kind: faceMotion, amp: faceAmp, cycles: faceCycles }, boundTo: pid, faceLocal: faceLocalR, role: 'face' } as ImageClip,
        ];
        if (cap) clips.push({ id: uid('cap'), trackId: 'caption', lane: 0, start: 0, end: p.duration, text: cap, style: 'meme', transform: { x: 0, y: 34 } } as CaptionClip);   // 自适应字号
        return { ...p, clips, loop: { ...p.loop, mode: loopMode } };
      });
      setSelectedId(fid);
      setCustomEdit(false);
      const ml = LOOP_MOTIONS.find(x => x.kind === faceMotion);
      const bl = LOOP_MOTIONS.find(x => x.kind === bodyMotion);
      toast.success(`随机生成 ✓ — 脸「${ml?.label ?? faceMotion}」+ 壳「${bl?.label ?? bodyMotion}」· ${LOOP_MODES.find(m => m.mode === loopMode)?.short ?? ''}循环`);
    } catch {
      toast.error('随机失败');
    }
  }, [preset]);

  // 脸跟壳 绑定/解绑 (默认绑定; 解绑时把当前世界位姿烘焙回 transform 防跳)
  const bindFace = useCallback((faceId: string) => {
    const p = projectRef.current;
    const face = p.clips.find(c => c.id === faceId && c.trackId === 'image') as ImageClip | undefined;
    if (!face) return;
    const others = p.clips.filter(c => c.trackId === 'image' && c.id !== faceId && (c as ImageClip).kind !== 'scene') as ImageClip[];
    if (others.length === 0) { toast('没有可绑定的熊猫头壳'); return; }
    // 壳候选 = role shell / blend multiply / 非·脸; 多个壳(切分后)时挑跟脸时段重叠最多的那段 → face_B 自动绑 shell_B
    const shellCands = others.filter(o => o.role === 'shell' || o.blend === 'multiply' || !(o.label ?? '').endsWith('·脸'));
    const cands = shellCands.length ? shellCands : others;
    const ov = (s: ImageClip) => Math.max(0, Math.min(face.end, s.end) - Math.max(face.start, s.start));
    const shell = cands.slice().sort((a, b) => ov(b) - ov(a) || b.lane - a.lane)[0];
    const sMedia = cacheRef.current.get(shell.src), fMedia = cacheRef.current.get(face.src);
    if (!sMedia || !fMedia) { toast('素材还在加载, 稍后再绑'); return; }
    const W = preset.width, H = preset.height;
    const sb = imageRenderBox(shell, sMedia, W, H), fb = imageRenderBox(face, fMedia, W, H);
    const faceLocal = captureFaceLocal({ cx: sb.cx, cy: sb.cy, iw: sb.iw }, shell.transform?.rotation ?? 0, { cx: fb.cx, cy: fb.cy, iw: fb.iw }, face.transform?.rotation ?? 0);
    setProject(pp => ({ ...pp, clips: pp.clips.map(c => c.id === faceId ? ({ ...c, boundTo: shell.id, faceLocal } as Clip) : c) }));
    toast.success('已绑定 — 表情跟随熊猫头壳');
  }, [preset]);
  const unbindFace = useCallback((faceId: string) => {
    const p = projectRef.current;
    const face = p.clips.find(c => c.id === faceId && c.trackId === 'image') as ImageClip | undefined;
    if (!face?.boundTo) return;
    const shell = p.clips.find(c => c.id === face.boundTo && c.trackId === 'image') as ImageClip | undefined;
    const sMedia = shell ? cacheRef.current.get(shell.src) : undefined, fMedia = cacheRef.current.get(face.src);
    let baked = face.transform ?? DEFAULT_TRANSFORM;
    if (shell && sMedia && fMedia) {
      const sWH = mediaWH(sMedia), fWH = mediaWH(fMedia);
      const fb = resolveBoundFaceBox(face, shell, 0, p.duration, preset.width, preset.height, sWH.w, sWH.h, fWH.w, fWH.h);
      const baseSize = Math.min(preset.width, preset.height) * 0.6;
      baked = { x: (fb.cx - preset.width / 2) / preset.width * 100, y: (fb.cy - preset.height / 2) / preset.height * 100, scale: fb.iw / baseSize, rotation: fb.rotation, flipX: fb.flipX };
    }
    setProject(pp => ({ ...pp, clips: pp.clips.map(c => c.id === faceId ? ({ ...c, transform: baked, boundTo: undefined, faceLocal: undefined } as Clip) : c) }));
    toast('已解绑 — 表情现在独立');
  }, [preset]);
  // 换素材: 点 shell/face 图层弹素材网格快速换 (保留位置/动作/绑定). 区分用 label '·脸' 后缀.
  const swapKind = (c: ImageClip): 'face' | 'panda' => (c.role === 'face' || c.boundTo) ? 'face' : (c.role === 'shell' || c.blend === 'multiply') ? 'panda' : (c.label ?? '').endsWith('·脸') ? 'face' : 'panda';  // role 优先 (稳定, 不靠 label)
  const swapFace = useCallback((id: string, face: Material) => {
    patchClip(id, { src: face.src, label: face.labelCn + '·脸' });  // face 即插即换, 绑定/位置不动
    toast.success(`已换表情 · ${face.labelCn}`);
    setSwapPop(null);
  }, []);
  const swapShell = useCallback(async (id: string, panda: Material) => {
    setSwapBusy(true);
    const tid = toast.loading('换熊猫头…');
    try {
      const box = await getEditorPandaBox(panda.src, { fillShell: false, maxPx: 350 });
      const W = preset.width, H = preset.height;
      const baseSize = Math.min(W, H) * 0.6, K = baseSize / box.w, fillScale = 1.5 * Math.min(1, box.w / box.h);
      let _sIw = baseSize * fillScale; const _sIh = (box.h / box.w) * _sIw; if (_sIh > H * 0.85) _sIw *= (H * 0.85) / _sIh;
      // 重算绑定脸到新熊猫头脸洞 (脸跟壳: 换壳后脸自动对齐新脸洞, 不用手动调)
      const faces = projectRef.current.clips.filter(c => c.trackId === 'image' && (c as ImageClip).boundTo === id) as ImageClip[];
      const upd = new Map<string, { transform: Transform; faceLocal: FaceLocal }>();
      for (const f of faces) {
        const fl = await calcEditorFaceLayout({ pandaSrc: panda.src, faceSrc: f.src, faceOffset350: panda.faceOffset, panda350OffsetX: box.x, panda350OffsetY: box.y, panda350W: box.w, panda350H: box.h });
        const fcx = fl.x + fl.width / 2, fcy = fl.y + fl.height / 2;
        const ft: Transform = { ...DEFAULT_TRANSFORM, x: ((fcx - 250) * K) / W * 100 * fillScale, y: ((fcy - 250) * K) / H * 100 * fillScale, scale: (fl.width / box.w) * fillScale };
        const faceLocal = captureFaceLocal({ cx: W / 2, cy: H / 2, iw: _sIw }, 0, { cx: W / 2 + (ft.x / 100) * W, cy: H / 2 + (ft.y / 100) * H, iw: baseSize * ft.scale }, 0);
        upd.set(f.id, { transform: ft, faceLocal });
      }
      setProject(pp => ({ ...pp, clips: pp.clips.map(c => {
        if (c.id === id) return { ...c, src: box.croppedSrc, label: panda.labelCn } as Clip;
        const u = upd.get(c.id);
        return u ? ({ ...c, transform: u.transform, faceLocal: u.faceLocal } as Clip) : c;
      }) }));
      toast.success(`已换熊猫头 · ${panda.labelCn}`, { id: tid });
      setSwapPop(null);
    } catch { toast.error('换熊猫头失败', { id: tid }); }
    finally { setSwapBusy(false); }
  }, [preset]);
  // 变脸: 打开多选弹窗 (从选中的脸 / 壳解析出 shell + 基础脸)
  const openFaceCycle = useCallback((clip: ImageClip) => {
    let face: ImageClip | undefined, shellId: string | undefined;
    if (clip.boundTo) { face = clip; shellId = clip.boundTo; }
    else { face = projectRef.current.clips.find(c => c.trackId === 'image' && (c as ImageClip).boundTo === clip.id) as ImageClip | undefined; shellId = clip.id; }
    if (!face || !shellId) { toast.error('先做一个配套 (熊猫头 + 表情) 才能变脸'); return; }
    setCyclePop({ shellId, faceId: face.id });
    const curMat = ALL_FACES.find(m => m.src === face!.src);
    setCycleSel(curMat ? [curMat.id] : []);
    setCycleDissolve(true); setCycleQ('');
  }, []);
  // 变脸: 生成 N 个绑定脸 (共享基础脸的 faceLocal/transform/lane/blend), 时段平分循环, 溶解则相邻重叠 + xfade
  const applyFaceCycle = useCallback((shellId: string, baseFaceId: string, faceMats: Material[], dissolve: boolean) => {
    const p0 = projectRef.current;
    const base = p0.clips.find(c => c.id === baseFaceId && c.trackId === 'image') as ImageClip | undefined;
    const shell = p0.clips.find(c => c.id === shellId && c.trackId === 'image') as ImageClip | undefined;
    if (!base || !shell || faceMats.length < 2) return;
    const D = p0.duration, N = faceMats.length, seg = D / N;
    const xf = dissolve ? Math.min(0.35, seg * 0.45) : 0;
    const baseFL = base.faceLocal ?? { dxN: 0, dyN: 0, scaleRatio: 1, rotation: 0 };
    const baseTr = base.transform ?? { ...DEFAULT_TRANSFORM };
    const cycleFaces: ImageClip[] = faceMats.map((m, i) => ({
      id: uid('fc'), trackId: 'image', lane: base.lane, start: i * seg, end: (i < N - 1) ? (i + 1) * seg + xf : D,
      src: m.src, label: m.labelCn + '·脸', fx: 'none', blend: base.blend,
      transform: { ...baseTr }, loopMotion: { kind: 'none', amp: 1, cycles: 1 },
      boundTo: shellId, faceLocal: { ...baseFL }, role: 'face',
      xfadeIn: (dissolve && i > 0) ? xf : undefined,
      xfadeOut: (dissolve && i < N - 1) ? xf : undefined,
    } as ImageClip));
    setProject(p => ({ ...p, clips: [...p.clips.filter(c => !(c.trackId === 'image' && (c as ImageClip).boundTo === shellId)), ...cycleFaces] }));
    setCyclePop(null); setSelectedId(cycleFaces[0].id);
    toast.success(`🎭 变脸 · ${N} 张表情${dissolve ? ' · 溶解过渡' : ' · 快切'}`);
  }, []);
  const selImg = selected && selected.trackId === 'image' ? (selected as ImageClip) : null;
  const selCap = selected && selected.trackId === 'caption' ? (selected as CaptionClip) : null;
  const tr = selImg?.transform ?? DEFAULT_TRANSFORM;
  const maxDur = Math.min(GIF_MAX_DURATION, preset.maxDuration);
  const selGifMedia = selImg && isGifSrc(selImg.src) ? cacheRef.current.get(selImg.src) : undefined;
  const selGifTotal = selGifMedia && isGifFrames(selGifMedia) ? selGifMedia.frames.length : 0;

  // ---- 画板编辑 (DOM 元素拖拽, 跟视频 startStageDrag / startCaptionDrag 同款数学; canvasSize → fit 显示尺寸) ----
  // 智能命中: elementsFromPoint 取点下图层栈(已按 z 上→下), 当前选中在栈里则选"下一层"(循环穿透), 否则选最顶.
  // 取代旧"点壳→重定向到脸"的位置启发式 — 大脸/重叠遮挡时也能逐次点到每一层 (Figma 式 click-cycle).
  // 点下命中的图层栈 (elementsFromPoint, z 上→下)
  const layerStackAt = (e: React.PointerEvent): string[] => {
    const stack: string[] = [];
    for (const el of document.elementsFromPoint(e.clientX, e.clientY)) {
      const box = (el as HTMLElement).closest?.('.am-stage-img') as HTMLElement | null;
      const id = box?.dataset.clipId;
      if (id && !stack.includes(id)) stack.push(id);
    }
    if (stack.length > 1 && !cycleHintRef.current) {
      cycleHintRef.current = true;
      try { if (!localStorage.getItem('xmw.layer.cyclehint')) { localStorage.setItem('xmw.layer.cyclehint', '1'); toast('💡 图层重叠: 选中后"再单击"切到下面的层; 想拖动直接按住拖即可 (拖的是当前选中层)', { duration: 5000 }); } } catch { /* ignore */ }
    }
    return stack;
  };
  const imgClipById = (id: string | undefined): ImageClip | null =>
    (id ? (projectRef.current.clips.find(c => c.id === id && c.trackId === 'image') as ImageClip | undefined) : undefined) ?? null;
  const startStageDrag = (e: React.PointerEvent, clip: ImageClip, kind: 'move' | 'scale' | 'rotate') => {
    if (e.button !== 0) return;
    // move: 选中层在点下 → 拖它(不切换, 修"想拖脸却切到壳"); 否则选+拖最顶层. 只有"纯单击没拖动"才循环切下一层 (Figma 式).
    let stack: string[] = [], selIdx = -1, target = clip;
    if (kind === 'move') {
      stack = layerStackAt(e);
      selIdx = selectedId ? stack.indexOf(selectedId) : -1;
      target = (selIdx >= 0 ? imgClipById(selectedId) : imgClipById(stack[0])) ?? clip;
    }
    e.preventDefault(); e.stopPropagation();
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ }
    if (target.id !== selectedId) setSelectedId(target.id);
    beginDrag();
    const startT = target.transform ?? DEFAULT_TRANSFORM;
    const startX = e.clientX, startY = e.clientY;
    const cw = fit.w || preset.width, ch = fit.h || preset.height;
    const _box = overlayRefs.current.get(target.id) ?? ((e.currentTarget as HTMLElement).closest('.am-stage-img') as HTMLElement | null);
    const _r = (_box ?? (e.currentTarget as HTMLElement)).getBoundingClientRect();
    const _ecx = _r.left + _r.width / 2, _ecy = _r.top + _r.height / 2;
    const _startAngle = Math.atan2(startY - _ecy, startX - _ecx) * 180 / Math.PI;
    // 绑定脸: 拖动/缩放/旋转 → 改 faceLocal 相对位姿 (仍跟随壳), 而非死改被 resolveBoundFaceBox 忽略的 transform.
    const _sm = target.boundTo ? cacheRef.current.get(imgClipById(target.boundTo)?.src ?? '') : undefined;
    const boundShell = target.boundTo && _sm ? imgClipById(target.boundTo) : null;
    const startLoc = target.faceLocal ?? { dxN: 0, dyN: 0, scaleRatio: 1, rotation: 0 };
    let _bHalf = 1, _bCos = 1, _bSin = 0;
    if (boundShell && _sm) {
      const sWH = mediaWH(_sm);
      const bs = Math.min(preset.width, preset.height) * 0.6;
      let sIw = bs * (boundShell.transform?.scale ?? 1);
      const sIh = (sWH.h / Math.max(1, sWH.w)) * sIw;
      if (sIh > preset.height * 0.85) sIw *= (preset.height * 0.85) / sIh;
      _bHalf = Math.max(1, sIw / 2);
      const sr = (boundShell.transform?.rotation ?? 0) * Math.PI / 180;
      _bCos = Math.cos(sr); _bSin = Math.sin(sr);
    }
    let moved = false;
    const onMove = (ev: PointerEvent) => {
      if (!moved && (Math.abs(ev.clientX - startX) > 4 || Math.abs(ev.clientY - startY) > 4)) moved = true;
      if (kind === 'move') {
        const dxPct = (ev.clientX - startX) / cw * 100;
        const dyPct = (ev.clientY - startY) / ch * 100;
        if (boundShell) {
          const dFx = (dxPct / 100) * preset.width, dFy = (dyPct / 100) * preset.height;   // 世界位移 → shell 未旋转帧 → 归一化半宽
          patchClip(target.id, { faceLocal: { ...startLoc, dxN: startLoc.dxN + (dFx * _bCos + dFy * _bSin) / _bHalf, dyN: startLoc.dyN + (-dFx * _bSin + dFy * _bCos) / _bHalf } });
        } else {
          patchTransform(target.id, { x: Math.max(-200, Math.min(200, startT.x + dxPct)), y: Math.max(-200, Math.min(200, startT.y + dyPct)) });
        }
      } else if (kind === 'scale') {
        const baseSize = Math.min(cw, ch) * 0.6;
        const drag = Math.max(ev.clientX - startX, ev.clientY - startY);
        if (boundShell) {
          patchClip(target.id, { faceLocal: { ...startLoc, scaleRatio: Math.max(0.1, Math.min(4, startLoc.scaleRatio + (drag * 1.5) / Math.max(1, baseSize))) } });
        } else {
          patchTransform(target.id, { scale: Math.max(0.2, Math.min(4, startT.scale + (drag * 2) / Math.max(1, baseSize))) });
        }
      } else {
        // 拖拽旋转 (Shift 锁 15°)
        const a = Math.atan2(ev.clientY - _ecy, ev.clientX - _ecx) * 180 / Math.PI;
        if (boundShell) {
          let dr = a - _startAngle; if (ev.shiftKey) dr = Math.round(dr / 15) * 15;
          patchClip(target.id, { faceLocal: { ...startLoc, rotation: startLoc.rotation + dr } });
        } else {
          let rot = startT.rotation + (a - _startAngle);
          if (ev.shiftKey) rot = Math.round(rot / 15) * 15;
          patchTransform(target.id, { rotation: Math.max(-180, Math.min(180, rot)) });
        }
      }
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp);
      // 纯单击(没拖动) + 选中层就在点下 + 有重叠 → 切到下一层(循环穿透); 拖动则不切, 拖的就是当前选中层
      if (kind === 'move' && !moved && selIdx >= 0 && stack.length > 1) setSelectedId(stack[(selIdx + 1) % stack.length]);
    };
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp);
  };
  const startCaptionDrag = (e: React.PointerEvent, clip: CaptionClip) => {
    if (e.button !== 0 || editingCaptionId === clip.id) return;
    e.preventDefault(); e.stopPropagation();
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ }
    if (clip.id !== selectedId) setSelectedId(clip.id);
    beginDrag();
    const startT = clip.transform ?? { x: 0, y: 35 };
    const startX = e.clientX, startY = e.clientY;
    const cw = fit.w || preset.width, ch = fit.h || preset.height;
    const onMove = (ev: PointerEvent) => {
      const dxPct = (ev.clientX - startX) / cw * 100;
      const dyPct = (ev.clientY - startY) / ch * 100;
      patchClip(clip.id, { transform: { x: Math.max(-50, Math.min(50, startT.x + dxPct)), y: Math.max(-50, Math.min(50, startT.y + dyPct)) } });
    };
    const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp);
  };
  // 字幕轮廓 SE 手柄拖拽改字号 (像拖图片一样缩放); 落到手动 fontSize(1280 空间), 从当前有效字号起算
  const startCaptionResize = (e: React.PointerEvent, clip: CaptionClip) => {
    if (e.button !== 0 || editingCaptionId === clip.id) return;
    e.preventDefault(); e.stopPropagation();
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ }
    if (clip.id !== selectedId) setSelectedId(clip.id);
    beginDrag();
    const dispW = fit.w || preset.width, dispH = fit.h || preset.height;
    const st = clip.style ?? 'meme', ty = clip.transform?.y ?? 35;
    // 起始字号 → 1280 空间 (手动直接用; 自适应先按显示像素反推, 保证接手不跳)
    const startFs = clip.fontSize != null
      ? clip.fontSize
      : fitCaptionFontPx(clip.text, dispW, dispH, st, captionAvailH(ty, dispH)) * 1280 / dispW;
    const startX = e.clientX, startY = e.clientY;
    const onMove = (ev: PointerEvent) => {
      const drag = Math.max(ev.clientX - startX, ev.clientY - startY);  // SE 手柄: 往右下放大
      const next = startFs + drag * (1280 / dispW) * 1.25;              // 显示像素 → 1280 空间 + 手感系数
      patchClip(clip.id, { fontSize: Math.round(Math.max(20, Math.min(360, next))) });
    };
    const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp);
  };
  // 自定义移动 A(base) / B(to) 圆点拖动
  const startMarker = (e: React.PointerEvent, which: 'a' | 'b') => {
    if (e.button !== 0 || !selImg) return;
    e.preventDefault(); e.stopPropagation();
    beginDrag();
    const id = selImg.id;
    const base = selImg.transform ?? DEFAULT_TRANSFORM;
    const start = which === 'a' ? base : (selImg.loopMotion?.to ?? { ...base });
    const sx0 = e.clientX, sy0 = e.clientY;
    const cw = fit.w || preset.width, ch = fit.h || preset.height;
    const onMove = (ev: PointerEvent) => {
      // 夹 ±48% → A/B 点始终留在画板内 (防 B 拖出画板被遮挡/抓不到)
      const nx = Math.max(-48, Math.min(48, Math.round((start.x + (ev.clientX - sx0) / cw * 100) * 10) / 10));
      const ny = Math.max(-48, Math.min(48, Math.round((start.y + (ev.clientY - sy0) / ch * 100) * 10) / 10));
      setProject(p => ({ ...p, clips: p.clips.map(c => {
        if (c.id !== id || c.trackId !== 'image') return c;
        const ic = c as ImageClip;
        if (which === 'a') return { ...ic, transform: { ...(ic.transform ?? DEFAULT_TRANSFORM), x: nx, y: ny } } as Clip;
        const curTo = ic.loopMotion?.to ?? { ...DEFAULT_TRANSFORM };
        return { ...ic, loopMotion: { kind: 'customMove', amp: ic.loopMotion?.amp ?? 1, cycles: ic.loopMotion?.cycles ?? 1, to: { ...curTo, x: nx, y: ny } } } as Clip;
      }) }));
    };
    const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp);
  };

  const swapAB = useCallback(() => {
    if (!selImg || selImg.loopMotion?.kind !== 'customMove' || !selImg.loopMotion.to) return;
    const base = selImg.transform ?? DEFAULT_TRANSFORM;
    const to = selImg.loopMotion.to;
    patchClip(selImg.id, { transform: { ...to }, loopMotion: { ...selImg.loopMotion, to: { ...base } } });
  }, [selImg, patchClip]);

  // 图层重排 (拖拽, 同类型内) — 列表上=顶层(前) = lane 0 (跟时间轴 + 渲染 lane0=前 一致, 符合直觉)
  const reorderLayer = useCallback((draggedId: string, targetId: string) => {
    setProject(p => {
      const dragged = p.clips.find(c => c.id === draggedId);
      const target = p.clips.find(c => c.id === targetId);
      if (!dragged || !target || dragged.trackId !== target.trackId || draggedId === targetId) return p;
      const group = p.clips.filter(c => c.trackId === dragged.trackId).slice().sort((a, b) => a.lane - b.lane); // ASC: index0 = lane0 = 顶层(前)
      const from = group.findIndex(c => c.id === draggedId);
      const to = group.findIndex(c => c.id === targetId);
      if (from < 0 || to < 0) return p;
      const reordered = group.slice();
      const [moved] = reordered.splice(from, 1);
      reordered.splice(to, 0, moved);
      const laneById = new Map<string, number>();
      reordered.forEach((c, i) => laneById.set(c.id, i)); // 列表第 i 个 → lane i (越上越前)
      return { ...p, clips: p.clips.map(c => (laneById.has(c.id) ? ({ ...c, lane: laneById.get(c.id)! } as Clip) : c)) };
    });
  }, []);

  // 自定义移动 A(起点=元素静止位) / B(终点) 圆点在画板上的显示坐标
  //   关键修 (2026-05-24): 绑定脸的渲染位 = resolveBoundFaceBox(壳+faceLocal), 不是 transform!
  //   旧版 A 画在 transform / B 画在 to (绝对坐标) → 跟绑定脸实际位置完全错位 ("不是AB点/反向").
  //   现在 A = 脸实际静止位 (绑定→bound rest @t0; 独立→transform), B = A + (to-transform) 位移向量 → 所见即所动.
  const markerPos = useMemo(() => {
    if (!selImg || !customEdit || selImg.loopMotion?.kind !== 'customMove' || !selImg.loopMotion.to) return null;
    const cw = fit.w || preset.width, ch = fit.h || preset.height;
    const sx = cw / preset.width, sy = ch / preset.height;
    const base = selImg.transform ?? DEFAULT_TRANSFORM;
    const to = selImg.loopMotion.to;
    // 起点 A = 元素静止渲染中心 (画布坐标)
    let restCx = preset.width / 2 + (base.x / 100) * preset.width;
    let restCy = preset.height / 2 + (base.y / 100) * preset.height;
    let isBound = false;
    if (selImg.boundTo) {
      const shellC = imageClips.find(s => s.id === selImg.boundTo);
      const sMediaC = shellC ? cacheRef.current.get(shellC.src) : undefined;
      const fMediaC = cacheRef.current.get(selImg.src);
      if (shellC && sMediaC && fMediaC) {
        const sWHc = mediaWH(sMediaC), fWHc = mediaWH(fMediaC);
        const fb0 = resolveBoundFaceBox(selImg, shellC, 0, project.duration, preset.width, preset.height, sWHc.w, sWHc.h, fWHc.w, fWHc.h);
        if (Number.isFinite(fb0.cx) && Number.isFinite(fb0.cy)) { restCx = fb0.cx; restCy = fb0.cy; isBound = true; }
      }
    }
    // 终点 B = 静止位 + (to - transform) 位移 (跟 loopMotionDelta customMove 的 dx/dy 一致)
    const dxC = ((to.x - base.x) / 100) * preset.width;
    const dyC = ((to.y - base.y) / 100) * preset.height;
    // 渲染位置再夹一层 (留 14px 边距), 即使数据异常 A/B 也不会跑出画板被遮挡
    const cl = (v: number, max: number) => Math.max(14, Math.min(max - 14, v));
    return {
      ax: cl(restCx * sx, cw),
      ay: cl(restCy * sy, ch),
      bx: cl((restCx + dxC) * sx, cw),
      by: cl((restCy + dyC) * sy, ch),
      isBound,
    };
  }, [selImg, customEdit, fit, preset, imageClips, project.duration]);

  return (
    <>
      {/* ===== 顶栏 — 复用 am-toolbar 蓝色 titlebar, 跟视频视图同一条 ===== */}
      <div className={'am-toolbar win7-titlebar gm-toolbar' + (gifTbMore ? ' is-expanded' : '')}>
        <div className="am-toolbar-name" data-mobile-hide>
          <span className="am-toolbar-name-ic">🔁</span>
          <span className="am-toolbar-name-text">GIF 循环</span>
        </div>
        {/* 视频/GIF 切换 — 跟视频视图 toolbar 同位置同款金色 toggle */}
        <div className="am-tb-mode" role="tablist" aria-label="输出模式">
          <button type="button" role="tab" aria-selected={view === 'video'}
            className={'am-tb-mode-btn' + (view === 'video' ? ' is-active' : '')}
            onClick={() => onSwitchView('video')} title="视频模式 — 含声音 + 长时长 + MP4">🎬 视频</button>
          <button type="button" role="tab" aria-selected={view === 'gif'}
            className={'am-tb-mode-btn' + (view === 'gif' ? ' is-active' : '')}
            onClick={() => onSwitchView('gif')} title="GIF 模式 — 无声 + 短时长 + 循环直出">🎞️ GIF</button>
        </div>
        <select className="gm-tb-select" value={project.preset} title="尺寸预设"
          onChange={e => setPresetId(e.target.value as GifPresetId)}>
          {GIF_PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        <label className="gm-tb-num" title={`时长 (上限 ${maxDur}s)`}>
          ⏱<input type="number" min={GIF_MIN_DURATION} max={maxDur} step={0.5}
            value={Number(D.toFixed(1))} onChange={e => setDuration(Number(e.target.value || '1'))} /><span>s</span>
        </label>
        {/* 撤回/重做 (新建/清空/保存 挪到右侧动作组, 跟视频前端位置对齐) */}
        <div className="gm-tb-histgroup">
          <button className="am-tb-btn" onClick={undo} disabled={!canUndo} title="撤回 (Ctrl+Z)"><Undo2 size={14} /></button>
          <button className="am-tb-btn" onClick={redo} disabled={!canRedo} title="重做 (Ctrl+Shift+Z / Ctrl+Y)"><Redo2 size={14} /></button>
        </div>
        <div className="am-toolbar-spacer" />
        <button className="am-tb-btn" onClick={newProject} title="新建空白 GIF"><FilePlus size={14} /> <span>新建</span></button>
        <button className="am-tb-btn" onClick={gifRandomize} title="随机熊猫头+表情+字幕+循环动作 (清空重来)">
          <Shuffle size={13} /> <span>随机</span>
        </button>
        <button className="am-tb-btn" onClick={clearAll} disabled={project.clips.length === 0} title="清空画板 (Ctrl+Z 可撤回)"><Trash2 size={14} /> <span>清空</span></button>
        <div className="am-tb-sep" data-mobile-hide />
        <button className="am-tb-btn" onClick={saveGifDraft} title="保存当前为新草稿"><Save size={13} /> <span>保存</span></button>
        <div className="gm-draftwrap">
          <button className={'am-tb-btn' + (draftPopOpen ? ' am-tb-btn-primary' : '')} onClick={() => setDraftPopOpen(o => !o)} title="GIF 草稿 — 存 / 读 当前作品">
            <FolderOpen size={13} /> <span>草稿{gifDrafts.length ? ` ${gifDrafts.length}` : ''}</span>
          </button>
          {draftPopOpen && (
            <>
              <div className="gm-pop-overlay" onClick={() => setDraftPopOpen(false)} />
              <div className="gm-draftpop">
                <button className="am-tb-btn am-tb-btn-primary gm-draftpop-save" onClick={saveGifDraft}><Save size={13} /> 保存当前为草稿</button>
                <div className="gm-draftpop-io">
                  <button className="am-tb-btn" onClick={exportProjectJSON} title="导出当前项目为 JSON 文件"><FileDown size={12} /> 导出 JSON</button>
                  <button className="am-tb-btn" onClick={() => jsonInputRef.current?.click()} title="从 JSON 文件导入项目"><FileUp size={12} /> 导入 JSON</button>
                </div>
                <input ref={jsonInputRef} type="file" accept="application/json,.json" hidden onChange={e => { const f = e.target.files?.[0]; if (f) importProjectJSON(f); e.currentTarget.value = ''; }} />
                {gifDrafts.length === 0 ? (
                  <div className="gm-empty" style={{ padding: '12px 6px', textAlign: 'center' }}>还没有 GIF 草稿</div>
                ) : (
                  <div className="gm-draftpop-list">
                    {gifDrafts.map(s => (
                      <div key={s.id} className="gm-draftpop-item">
                        {s.thumbSrc ? <img src={s.thumbSrc} alt={s.name} /> : <div className="gm-draftpop-blank">GIF</div>}
                        <button className="gm-draftpop-load" onClick={() => loadGifDraft(s)} title="读入此草稿">{s.name}</button>
                        <button className="gm-del" onClick={() => deleteGifDraft(s.id)} title="删除"><Trash2 size={12} /></button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
        <button className="am-tb-btn" onClick={() => setPreviewOpen(true)} title="全屏预览 — 大图看循环"><Maximize2 size={13} /> <span>预览</span></button>
        <button className="am-tb-btn" onClick={openVariants} disabled={variantBusy} title="渲染 直接/乒乓/溶解 三变体并排对比" data-mobile-hide>
          <Layers size={13} /> <span>对比变体</span>
        </button>
        <button className="am-tb-btn am-tb-more-toggle" onClick={() => setGifTbMore(v => !v)} title="更多功能">{gifTbMore ? '收起 ▲' : '⋯ 更多'}</button>
        <button className="am-tb-btn am-tb-btn-primary" onClick={onExport} disabled={exporting} title="渲染 + 下载 GIF">
          {exporting ? <Loader2 size={13} className="gm-spin" /> : <Download size={13} />} <span>{exporting ? '生成中' : '导出 GIF'}</span>
        </button>
      </div>

      {/* ===== 工作区 — 复用 am-workspace 网格 (左 340 / 预览 1fr / 右 300) ===== */}
      <div className={'am-workspace gm-workspace' + (isMobile ? ' gm-mobile' : '')}>
        {/* 左: segment tabs (素材/字幕/动效) — 跟视频左栏一致 (无 音乐/配音). 移动端 gm-pane-sheet 变底部 sheet */}
        <aside className={'gm-pane gm-pane-left' + (isMobile ? (gmSheet === 'left' ? ' gm-pane-sheet is-open' : ' gm-pane-sheet') : '')}>
          <div className="am-seg-bar gm-segbar">
            <button className={'am-seg-btn' + (seg === 'asset' ? ' is-active' : '')} type="button" onClick={() => setSeg('asset')}><span className="am-seg-ic"><ImageIcon size={14} /></span><span>素材</span></button>
            <button className={'am-seg-btn' + (seg === 'caption' ? ' is-active' : '')} type="button" onClick={() => setSeg('caption')}><span className="am-seg-ic"><MessageSquare size={14} /></span><span>字幕</span></button>
            <button className={'am-seg-btn' + (seg === 'fx' ? ' is-active' : '')} type="button" onClick={() => setSeg('fx')}><span className="am-seg-ic"><Sparkles size={14} /></span><span>动效</span></button>
          </div>

          {seg === 'asset' && (
            <>
              <div className="am-subtabs">
                {(['combo', 'panda', 'face', 'netsearch', 'scene', 'draft', 'upload'] as const).map(k => (
                  <button key={k} className={'am-subtab' + (assetSub === k ? ' is-active' : '')} onClick={() => setAssetSub(k)}>
                    {k === 'combo' ? '配套' : k === 'panda' ? '熊猫' : k === 'face' ? '表情' : k === 'netsearch' ? '联网搜' : k === 'scene' ? '场景' : k === 'draft' ? `草图${draftSlots.length ? ' ' + draftSlots.length : ''}` : '上传'}
                  </button>
                ))}
              </div>
              {assetSub !== 'combo' && assetSub !== 'draft' && assetSub !== 'upload' && (
                <div className="gm-search">
                  <Search size={12} color="#6682a4" />
                  <input value={q} placeholder="搜素材…" onChange={e => setQ(e.target.value)} />
                  {q && <button onClick={() => setQ('')} title="清空"><X size={11} /></button>}
                </div>
              )}
              <div className="gm-assetbody">
                {assetSub === 'combo' && <ComboTab onAdd={addFromPayload} onAddCombo={addCombo} />}
                {assetSub === 'panda' && (
                  <>
                    <MaterialSourceButtons kind="panda" onAdd={(m) => setGifUploads(prev => [m, ...prev].slice(0, GIF_UPLOAD_MAX))} />
                    <div className="sidebar-grid">
                      {gifUploads.filter(u => u.kind === 'panda' && !u.id.startsWith('network-')).filter(matchQ).map(m => <MaterialCardClip key={m.id} item={m} kind="panda" onQuickAdd={addFromPayload} onDelete={() => setGifUploads(prev => prev.filter(x => x.id !== m.id))} />)}
                      {ALL_PANDAS.filter(matchQ).map(m => <MaterialCardClip key={m.id} item={m} kind="panda" onQuickAdd={addFromPayload} />)}
                    </div>
                  </>
                )}
                {assetSub === 'face' && (
                  <>
                    <MaterialSourceButtons kind="face" onAdd={(m) => setGifUploads(prev => [m, ...prev].slice(0, GIF_UPLOAD_MAX))} />
                    <div className="sidebar-grid">
                      {gifUploads.filter(u => u.kind === 'face').filter(matchQ).map(m => <MaterialCardClip key={m.id} item={m} kind="face" onQuickAdd={addFromPayload} onDelete={() => setGifUploads(prev => prev.filter(x => x.id !== m.id))} />)}
                      {ALL_FACES.filter(matchQ).map(m => <MaterialCardClip key={m.id} item={m} kind="face" onQuickAdd={addFromPayload} />)}
                    </div>
                  </>
                )}
                {assetSub === 'netsearch' && (
                  <div className="gm-netsearch-tab">
                    <MaterialSourceButtons kind="panda" onAdd={(m) => setGifUploads(prev => [{ ...m, kind: 'panda' }, ...prev.filter(u => u.id !== m.id)].slice(0, GIF_UPLOAD_MAX))} />
                    <div className="gm-hint" style={{ marginTop: 8, lineHeight: 1.6 }}>
                      🌐 搜全网熊猫头梗图 → 点选即存进下方池子 → 再点缩略图加入时间轴 (完整梗图, 原样使用不二次合成)。<br />
                      弹窗底部「最近用过」全局保存最近 20 个; GIF 动图有 <b>GIF</b> 标记。
                    </div>
                    <div className="sidebar-grid" style={{ marginTop: 8 }}>
                      {gifUploads.filter(u => u.id.startsWith('network-')).filter(matchQ).map(m => <MaterialCardClip key={m.id} item={m} kind="panda" onQuickAdd={addFromPayload} onDelete={() => setGifUploads(prev => prev.filter(x => x.id !== m.id))} />)}
                      {gifUploads.filter(u => u.id.startsWith('network-')).length === 0 && <p className="am-empty-line">还没搜过 — 点上面「联网搜图」开始</p>}
                    </div>
                  </div>
                )}
                {assetSub === 'scene' && (() => {
                  const scenes = gifUploads.filter(u => u.kind === 'scene');
                  return scenes.length === 0 ? (
                    <div className="am-upload-zone" onClick={() => { setGifUploadKind('scene'); setAssetSub('upload'); }}>
                      <Upload size={22} strokeWidth={1.6} />
                      <div className="am-upload-ttl">场景 = 纯自定义</div>
                      <div className="am-upload-hint">点这里去「上传」传你自己的背景图 (自动归到场景)</div>
                    </div>
                  ) : (
                    <div className="sidebar-grid">
                      {scenes.filter(matchQ).map(m => <MaterialCardClip key={m.id} item={m} kind="scene" onQuickAdd={addFromPayload} onDelete={() => setGifUploads(prev => prev.filter(x => x.id !== m.id))} />)}
                    </div>
                  );
                })()}
                {assetSub === 'draft' && (
                  draftSlots.length === 0 ? (
                    <div className="gm-draft-empty">
                      <FolderOpen size={26} strokeWidth={1.5} />
                      <div>还没有草图</div>
                      <div className="gm-hint">去 编辑器 / 快速 做熊猫头, 保存后这里就有</div>
                    </div>
                  ) : (
                    <div className="sidebar-grid">
                      {draftSlots.map(s => <DraftCardClip key={s.id} slot={s} onAddDraftAsClips={addDraftToGif} />)}
                    </div>
                  )
                )}
                {assetSub === 'upload' && (() => {
                  const ups = gifUploads.filter(u => (u.tags || []).includes('上传'));   // 仅文件上传 (搜图/抠脸在熊猫/表情页)
                  const kindLbl = gifUploadKind === 'general' ? '通用图' : gifUploadKind === 'panda' ? '熊猫头' : gifUploadKind === 'face' ? '表情' : '场景';
                  return (
                    <>
                      <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden onChange={handleGifFiles} />
                      <div className="am-upload-kind-row">
                        <span className="am-upload-kind-label">导入为:</span>
                        {([{ k: 'general' as const, lbl: '通用图' }, { k: 'panda' as const, lbl: '熊猫头' }, { k: 'face' as const, lbl: '表情' }, { k: 'scene' as const, lbl: '场景' }]).map(opt => (
                          <button key={opt.k} type="button" className={'am-upload-kind-chip' + (gifUploadKind === opt.k ? ' is-active' : '')} onClick={() => setGifUploadKind(opt.k)}>{opt.lbl}</button>
                        ))}
                      </div>
                      {ups.length === 0 ? (
                        <div className="am-upload-zone" onClick={() => fileInputRef.current?.click()}>
                          <Upload size={22} strokeWidth={1.6} />
                          <div className="am-upload-ttl">点击上传图片</div>
                          <div className="am-upload-hint">单图 ≤30MB · 尺寸 ≤4096px · 共 {GIF_UPLOAD_MAX} 张</div>
                          <div className="am-upload-hint">存浏览器本地 · 跨刷新保留 · 可反复加入画板</div>
                        </div>
                      ) : (
                        <>
                          <div className="am-upload-quota">
                            <span><FolderOpen size={11} strokeWidth={2.2} /> {ups.length}/{GIF_UPLOAD_MAX} 张</span>
                            <button className="am-upload-clear-btn" onClick={handleClearGifUploads} type="button" title="清空上传"><Trash2 size={10} /></button>
                          </div>
                          <button className="am-upload-more" onClick={() => fileInputRef.current?.click()}><Upload size={12} /> <span>继续上传 (作为 {kindLbl})</span></button>
                          <div className="sidebar-grid">
                            {ups.filter(matchQ).map(m => (
                              <MaterialCardClip key={m.id} item={m} kind={m.kind === 'panda' ? 'panda' : m.kind === 'face' ? 'face' : m.kind === 'scene' ? 'scene' : undefined} onQuickAdd={addFromPayload} onDelete={() => setGifUploads(prev => prev.filter(x => x.id !== m.id))} />
                            ))}
                          </div>
                        </>
                      )}
                    </>
                  );
                })()}
              </div>
            </>
          )}

          {seg === 'caption' && (
            <div className="gm-assetbody">
              <button className="gm-addcap" onClick={addCaption}><TypeIcon size={14} /> 加空白字幕</button>
              <CaptionQuickGen onQuickAdd={addFromPayload} />
              <CaptionPositionPresets onQuickAdd={addFromPayload} />
              <CaptionEmojiPicker onQuickAdd={addFromPayload} />
              <CaptionBatchImport onQuickAdd={addFromPayload} onAddClipsBatch={() => { /* GIF 仅字幕走 onQuickAdd */ }} playhead={0} projectDuration={D} isGif />
            </div>
          )}

          {seg === 'fx' && (
            <div className="gm-assetbody">
              {/* 循环方式 — 从顶栏挪进来, 动效控件集中在此 (整段 GIF 怎么接回开头) */}
              <div className="gm-sec-title">循环方式 <span className="gm-hint">(整段怎么接回开头)</span></div>
              <div className="am-subtabs gm-loopmodes">
                {LOOP_MODES.map(m => (
                  <button key={m.mode} title={m.hint}
                    className={'am-subtab' + (project.loop.mode === m.mode ? ' is-active' : '')}
                    onClick={() => setLoopMode(m.mode)}>{m.short}</button>
                ))}
              </div>
              {project.loop.mode === 'crossfade' && (
                <label className="gm-fx-num" title="溶解时长">溶解时长
                  <input type="number" min={0.05} max={Math.max(0.1, D * 0.4)} step={0.05}
                    value={Number(project.loop.crossfadeSec.toFixed(2))}
                    onChange={e => setProject(p => ({ ...p, loop: { ...p.loop, crossfadeSec: Number(e.target.value || '0.05') } }))} /> s</label>
              )}
              <button className={'gm-motion gm-onionbtn' + (project.loop.onionSkin ? ' active' : '')}
                onClick={() => setProject(p => ({ ...p, loop: { ...p.loop, onionSkin: !p.loop.onionSkin } }))}>
                <span className="gm-motion-emoji"><Eye size={13} /></span>洋葱皮 · 看首尾对齐
              </button>
              <div className="gm-sec-title" style={{ marginTop: 12 }}>每层动作 <span className="gm-hint">{selImg ? '(给选中图层)' : imageClips.length ? '(给首个图层 · 点时间轴选其他)' : '(先加图层)'}</span></div>
              {(() => {
                const s = (selImg ?? imageClips[0]) as ImageClip | undefined;   // 没选中就默认首个图层 → 动效面板始终可见可用 (修"看不到区别")
                if (!s) return (
                  <div className="gm-fx-tlhint">
                    <span className="gm-fx-tlhint-ico">👆</span>
                    <div>先在<b>素材</b>加一个图层, 再来挑动作 (上下浮 / 摇摆 / 弹跳 / 鬼畜…)。</div>
                  </div>
                );
                const lm = s.loopMotion;
                const pick = (kind: LoopMotionKind) => { setLayerMotion(s.id, kind); if (!selectedId) setSelectedId(s.id); };
                return (
                  <>
                    <div className="gm-motionpop-grid">
                      {LOOP_MOTIONS.map(m => (
                        <button key={m.kind} type="button" title={m.label}
                          className={'gm-motionpop-btn' + (lm?.kind === m.kind ? ' active' : '')}
                          onClick={() => pick(m.kind)}>
                          <span className="gm-motionpop-emoji">{m.emoji}</span>{m.label}
                        </button>
                      ))}
                      <button type="button" title="自定义移动 A→B (画板拖两点)"
                        className={'gm-motionpop-btn gm-motionpop-custom' + (lm?.kind === 'customMove' ? ' active' : '')}
                        onClick={() => { setLayerMotion(s.id, 'customMove'); setSelectedId(s.id); setCustomEdit(true); }}>
                        <span className="gm-motionpop-emoji">🎯</span>自定义
                      </button>
                    </div>
                    {lm && lm.kind !== 'none' && (
                      <div className="gm-motionpop-sliders">
                        <label className="gm-fx-num">幅度<input type="range" min={0.2} max={2} step={0.05} value={lm.amp}
                          onChange={e => patchClip(s.id, { loopMotion: { ...lm, amp: parseFloat(e.target.value) } })} /><b>{lm.amp.toFixed(2)}</b></label>
                        <label className="gm-fx-num">速度<input type="range" min={1} max={8} step={1} value={lm.cycles}
                          onChange={e => patchClip(s.id, { loopMotion: { ...lm, cycles: parseInt(e.target.value) } })} /><b>{lm.cycles}x</b></label>
                      </div>
                    )}
                    {lm && lm.kind !== 'none' && (
                      <button type="button" className="am-tb-btn" style={{ width: '100%', marginTop: 6, justifyContent: 'center' }} onClick={applyMotionToAll}>动作 → 全部图层</button>
                    )}
                    <div className="gm-fx-tlhint" style={{ marginTop: 8 }}>
                      <span className="gm-fx-tlhint-ico">🫨</span>
                      <div>选好动作点 <b>▶ 播放</b> 看效果。每层<b>时间轴</b>也带<b>动效子轨</b>, 可单独给某层某时段设不同动作。</div>
                    </div>
                  </>
                );
              })()}
            </div>
          )}
        </aside>

        {/* 中: 预览 — 复用 am-preview-pane (白画板) */}
        <main className="am-preview-pane gm-preview">
          <div className="am-preview-head">
            <span className="am-preview-title">GIF 预览</span>
            {project.loop.showSeamScore && seam !== null && (
              <span className={`gm-seam${seam <= 6 ? ' good' : seam <= 18 ? ' ok' : ' bad'}`}>
                {project.loop.mode === 'boomerang' ? 'Boomerang · 首尾完美' : `循环顺滑度 ${Math.max(0, 100 - seam)}/100`}
              </span>
            )}
          </div>
          <div className="am-preview-stage" ref={stageRef}>
            {/* 跟视频一致: DOM 编辑舞台 (am-preview-canvas + am-stage-img/<img> + am-caption-stage), 非 canvas. 循环动画走 rAF CSS transform. */}
            <div className="am-preview-canvas gm-stage" style={{ width: fit.w || undefined, height: fit.h || undefined }}
              onPointerDown={e => { if (e.target === e.currentTarget) setSelectedId(null); }}
              onContextMenu={e => { if (e.target === e.currentTarget) { e.preventDefault(); ctxMenu.open(e, buildGifEmptyMenu()); } }}>
              {imageClips.slice().sort((a, b) => b.lane - a.lane).map(c => {
                const media = cacheRef.current.get(c.src);
                if (!media) return null;
                let b = imageRenderBox(c, media, preset.width, preset.height);
                if (c.boundTo) {  // 绑定脸: 静态框 = resolveBoundFaceBox(t=0) (跟随 shell 当前 transform); rAF 加每帧 delta
                  const shellC = imageClips.find(s => s.id === c.boundTo);
                  const sMediaC = shellC ? cacheRef.current.get(shellC.src) : undefined;
                  if (shellC && sMediaC) {
                    const sWHc = mediaWH(sMediaC), fWHc = mediaWH(media);
                    const fb0 = resolveBoundFaceBox(c, shellC, 0, project.duration, preset.width, preset.height, sWHc.w, sWHc.h, fWHc.w, fWHc.h);
                    if (Number.isFinite(fb0.cx) && Number.isFinite(fb0.iw) && fb0.iw > 0) b = { cx: fb0.cx, cy: fb0.cy, iw: fb0.iw, ih: fb0.ih };
                  }
                }
                const sx = (fit.w || preset.width) / preset.width, sy = (fit.h || preset.height) / preset.height;
                const isScene = c.kind === 'scene';
                // 绑定脸: 按内容 bbox 内切椭圆裁切 (跟编辑器/导出一致), 防脸矩形角/白边盖到壳透明区
                const faceClip = c.boundTo ? (() => { const fb = contentBboxFrac(media); return `ellipse(${(fb.w * 52).toFixed(1)}% ${(fb.h * 52).toFixed(1)}% at ${((fb.x + fb.w / 2) * 100).toFixed(1)}% ${((fb.y + fb.h / 2) * 100).toFixed(1)}%)`; })() : undefined;
                return (
                  <div key={c.id} data-clip-id={c.id} ref={el => { if (el) overlayRefs.current.set(c.id, el); else overlayRefs.current.delete(c.id); }}
                    className={'am-stage-img' + (c.id === selectedId ? ' is-selected' : '') + (isScene ? ' am-stage-scene' : '')}
                    style={{ left: (b.cx - b.iw / 2) * sx, top: (b.cy - b.ih / 2) * sy, width: b.iw * sx, height: b.ih * sy, cursor: c.id === selectedId ? 'move' : 'pointer', zIndex: 50 - c.lane }}
                    onPointerDown={e => startStageDrag(e, c, 'move')} onContextMenu={e => onGifClipContextMenu(e, c)} onDragStart={e => e.preventDefault()}>
                    {isGifSrc(c.src) ? (
                      <canvas ref={el => { if (el) gifCanvasRefs.current.set(c.id, el); else gifCanvasRefs.current.delete(c.id); }} width={mediaWH(media).w} height={mediaWH(media).h}
                        style={{ width: '100%', height: '100%', objectFit: isScene ? 'cover' : 'contain', display: 'block', transform: c.transform?.flipX ? 'scaleX(-1)' : undefined, mixBlendMode: c.blend === 'multiply' ? 'multiply' : undefined, clipPath: faceClip }} />
                    ) : (
                      <img src={c.src} alt={c.label} draggable={false}
                        style={{ width: '100%', height: '100%', objectFit: isScene ? 'cover' : 'contain', display: 'block', transform: c.transform?.flipX ? 'scaleX(-1)' : undefined, mixBlendMode: c.blend === 'multiply' ? 'multiply' : undefined, clipPath: faceClip }} />
                    )}
                    {c.id === selectedId && <>
                      <div className="am-stage-frame" />
                      <div className="am-stage-rotstem" />
                      <div className="am-stage-handle am-stage-handle-rot" onPointerDown={e => { e.stopPropagation(); startStageDrag(e, c, 'rotate'); }} title="拖动旋转 (Shift 锁 15°)"><RotateCw size={9} strokeWidth={2.6} /></div>
                      <div className="am-stage-handle am-stage-handle-se" onPointerDown={e => { e.stopPropagation(); startStageDrag(e, c, 'scale'); }} title="拖动缩放" />
                    </>}
                  </div>
                );
              })}
              {captionClips.map(c => {
                const tr = c.transform ?? { x: 0, y: 35 };
                const st = c.style ?? 'meme';
                const isEditing = c.id === editingCaptionId;
                // 有 fontSize = 手动 (1280-conv); 没有 = 自适应 (短超大/长缩字, 跟导出 drawCaption 同算法 → 所见即所得)
                const fontPx = c.fontSize != null
                  ? c.fontSize * (fit.w || preset.width) / 1280
                  : fitCaptionFontPx(c.text, fit.w || preset.width, fit.h || preset.height, st, captionAvailH(tr.y, fit.h || preset.height));
                const col = c.color ?? (st === 'panel' ? '#000' : '#fff');
                return (
                  <div key={c.id} ref={el => { if (el) overlayRefs.current.set(c.id, el); else overlayRefs.current.delete(c.id); }} className={`am-caption-stage am-caption-style-${st}` + (c.id === selectedId ? ' is-selected' : '') + (isEditing ? ' is-editing' : '')}
                    style={{ left: `${50 + tr.x}%`, top: `${50 + tr.y}%`, fontSize: fontPx, color: col, cursor: isEditing ? 'text' : (c.id === selectedId ? 'move' : 'pointer'), zIndex: 60 }}
                    onPointerDown={e => startCaptionDrag(e, c)}
                    onContextMenu={e => { if (!isEditing) onGifClipContextMenu(e, c); }}
                    onDoubleClick={e => { e.stopPropagation(); setEditingCaptionId(c.id); setSelectedId(c.id); }}>
                    {isEditing ? (
                      <textarea autoFocus wrap="off" rows={1} className="am-caption-edit" value={c.text}
                        onChange={e => patchClip(c.id, { text: e.target.value.replace(/\n/g, '') })}
                        onBlur={() => setEditingCaptionId(null)}
                        onKeyDown={e => { if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey)) { e.preventDefault(); setEditingCaptionId(null); } }}
                        onPointerDown={e => e.stopPropagation()}
                        style={{ fontSize: Math.min(fontPx, 48), color: col }} />
                    ) : (c.text || '空字幕')}
                    {c.id === selectedId && !isEditing && (
                      <div className="am-stage-handle am-stage-handle-se am-cap-handle-se"
                        onPointerDown={e => { e.stopPropagation(); startCaptionResize(e, c); }} title="拖动改字号" />
                    )}
                  </div>
                );
              })}
              {markerPos && (
                <>
                  <div className="gm-marker-line" style={{ left: markerPos.ax, top: markerPos.ay, width: Math.hypot(markerPos.bx - markerPos.ax, markerPos.by - markerPos.ay), transform: `rotate(${Math.atan2(markerPos.by - markerPos.ay, markerPos.bx - markerPos.ax)}rad)` }} />
                  <div className={'am-move-marker am-move-marker-a' + (markerPos.isBound ? ' is-anchor' : '')} style={{ left: markerPos.ax, top: markerPos.ay }}
                    onPointerDown={markerPos.isBound ? undefined : e => startMarker(e, 'a')}
                    title={markerPos.isBound ? '起点 A = 脸当前位置 (想改起点就直接拖脸本体)' : '起点 A — 拖动设置起始位置'}>A</div>
                  <div className="am-move-marker am-move-marker-b" style={{ left: markerPos.bx, top: markerPos.by }} onPointerDown={e => startMarker(e, 'b')} title="终点 B — 拖动设置「循环移动到哪」(画面会在 A↔B 间来回)">B</div>
                </>
              )}
            </div>
          </div>
          <div className="gm-transport">
            <button className="gm-play" onClick={togglePlay}>{playing ? <Pause size={18} /> : <Play size={18} />}</button>
            <input className="gm-scrub" type="range" min={0} max={D} step={1 / preset.fps} value={scrubT}
              title="拖动检查任意帧 (会暂停)"
              onChange={e => { const v = Number(e.target.value); setScrubT(v); frozenRef.current = v; if (playing) setPlaying(false); }} />
            <span className="gm-meta">{preset.width}×{preset.height} · {preset.fps}fps · ~{exportFrames}帧{project.loop.mode === 'boomerang' ? ' (乒乓)' : ''}</span>
          </div>
        </main>

        {/* 右: 图层 + 检视 — 对齐视频 LayerPanel / ImageProps / CaptionProps (am-* 同款) */}
        <aside className={'gm-pane gm-pane-right' + (isMobile ? (gmSheet === 'right' ? ' gm-pane-sheet is-open' : ' gm-pane-sheet') : '')}>
          <div className="gm-sec-title">图层 <span className="gm-hint">(拖动重排 · 上=顶层/前)</span></div>
          <div className="am-layer-list gm-layerlist">
            {project.clips.length === 0 && <div className="am-layer-empty">空 — 左侧加个主体</div>}
            {(['image', 'caption'] as const).map(type => {
              const group = project.clips.filter(c => c.trackId === type).slice().sort((a, b) => a.lane - b.lane); // ASC: 顶层(前)在上
              if (group.length === 0) return null;
              return (
                <div key={type} className="am-layer-group">
                  <div className={`am-layer-group-head am-layer-group-${type}`}>{type === 'image' ? '画面' : '字幕'}</div>
                  {group.map((c, idx) => (
                    <div key={c.id}
                      className={`am-layer-item am-layer-item-${type}${c.id === selectedId ? ' is-selected' : ''}${layerOverId === c.id ? ' is-drag-over' : ''}${type === 'image' && (c as ImageClip).boundTo ? ' is-bound' : ''}`}
                      onClick={() => setSelectedId(c.id)}
                      onContextMenu={e => onGifClipContextMenu(e, c)}
                      draggable
                      onDragStart={e => { layerDragId.current = c.id; e.dataTransfer.effectAllowed = 'move'; }}
                      onDragOver={e => { const d = project.clips.find(x => x.id === layerDragId.current); if (!d || d.trackId !== c.trackId || layerDragId.current === c.id) return; e.preventDefault(); setLayerOverId(c.id); }}
                      onDrop={e => { e.preventDefault(); const did = layerDragId.current; layerDragId.current = null; setLayerOverId(null); if (did && did !== c.id) reorderLayer(did, c.id); }}
                      onDragEnd={() => { layerDragId.current = null; setLayerOverId(null); }}>
                      <span className="am-layer-drag">⋮⋮</span>
                      {type === 'image'
                        ? <img src={(c as ImageClip).src} alt="" className="am-layer-thumb" />
                        : <span className="am-layer-icon"><TypeIcon size={14} strokeWidth={2} /></span>}
                      <div className="am-layer-meta">
                        <div className="am-layer-name">{type === 'image' ? ((c as ImageClip).label || '图层') : ((c as CaptionClip).text || '字幕')}</div>
                        <div className="am-layer-sub">{type === 'image' ? (() => { const ic = c as ImageClip; const role = ic.role ?? (ic.boundTo ? 'face' : ic.blend === 'multiply' ? 'shell' : ic.kind === 'scene' ? 'scene' : 'image'); return role === 'shell' ? '熊猫头壳' : role === 'face' ? '🔗 表情 · 跟随壳' : role === 'scene' ? '背景' : '图片'; })() : '字幕'}</div>
                      </div>
                      <button className="am-layer-move" disabled={idx <= 0} onClick={e => { e.stopPropagation(); moveLayer(c.id, -1); }} title="上移一层 (更前)"><ChevronUp size={12} /></button>
                      <button className="am-layer-move" disabled={idx >= group.length - 1} onClick={e => { e.stopPropagation(); moveLayer(c.id, 1); }} title="下移一层 (更后)"><ChevronDown size={12} /></button>
                      <button className="am-layer-del" onClick={e => { e.stopPropagation(); deleteClip(c.id); }} title="删除"><X size={10} /></button>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>

          <div className="gm-sec-title" style={{ marginTop: 10 }}>属性{selImg ? ' · 主体' : selCap ? ' · 字幕' : ''}</div>
          {selImg && (
            <div className="am-inspector-body">
              <Field label={`位置 · X ${tr.x.toFixed(0)}% / Y ${tr.y.toFixed(0)}%`}>
                <div className="am-row">
                  <NumberInput label="X%" value={tr.x} step={1} min={-60} max={60} onChange={v => patchTransform(selImg.id, { x: Math.max(-60, Math.min(60, v)) })} />
                  <NumberInput label="Y%" value={tr.y} step={1} min={-60} max={60} onChange={v => patchTransform(selImg.id, { y: Math.max(-60, Math.min(60, v)) })} />
                </div>
              </Field>
              <Field label={`缩放 · ${tr.scale.toFixed(2)}x`}>
                <input type="range" min={0.2} max={selImg.kind === 'scene' ? 6 : 4} step={0.05} value={tr.scale} className="am-range" onChange={e => patchTransform(selImg.id, { scale: parseFloat(e.target.value) })} />
              </Field>
              <Field label={`旋转 · ${Math.round(tr.rotation)}°`}>
                <div className="am-row am-row-tight">
                  <input type="range" min={-180} max={180} step={1} value={tr.rotation} className="am-range" onChange={e => patchTransform(selImg.id, { rotation: parseFloat(e.target.value) })} />
                  <button className="am-quick-btn am-quick-btn-mini" onClick={() => patchTransform(selImg.id, { rotation: 0 })} title="重置旋转"><RotateCw size={11} /></button>
                </div>
              </Field>
              <Field label="翻转">
                <button className={'am-chip' + (tr.flipX ? ' is-active' : '')} onClick={() => patchTransform(selImg.id, { flipX: !tr.flipX })} type="button"><FlipHorizontal size={12} /> 水平翻转</button>
              </Field>
              {selImg.kind !== 'scene' && (() => {
                const others = imageClips.filter(c => c.id !== selImg.id && c.kind !== 'scene');
                if (!selImg.boundTo && others.length === 0) return null;
                const bound = !!selImg.boundTo && others.some(c => c.id === selImg.boundTo);
                return (
                  <Field label="跟随熊猫头">
                    <button type="button" className={'am-chip' + (bound ? ' is-active' : '')}
                      title={bound ? '已绑定 — 移动/旋转/缩放熊猫头壳时表情自动跟随. 点击解绑' : '绑定到熊猫头壳 — 表情自动跟随壳的移动/旋转/缩放, 不用手动对齐'}
                      onClick={() => bound ? unbindFace(selImg.id) : bindFace(selImg.id)}>
                      {bound ? <Link2 size={12} /> : <Link2Off size={12} />} {bound ? '已跟随 · 点击解绑' : '跟随熊猫头'}
                    </button>
                  </Field>
                );
              })()}
              {selImg.kind !== 'scene' && (selImg.boundTo || imageClips.some(c => c.id !== selImg.id && (c as ImageClip).boundTo === selImg.id)) && (
                <Field label="变脸 · 多表情轮播">
                  <button type="button" className="am-chip" onClick={() => openFaceCycle(selImg)} title="选 2-6 张表情, 在循环里依次轮播 (默认溶解淡入淡出) — 变脸特效, 壳照常可做动作">
                    <Drama size={12} /> 做变脸
                  </button>
                </Field>
              )}
              <Field label="标签">
                <input className="am-input" value={selImg.label || ''} onChange={e => patchClip(selImg.id, { label: e.target.value })} placeholder="图层标签…" />
              </Field>
              {selImg.kind !== 'scene' && !isGifSrc(selImg.src) && (
                <Field label="换素材">
                  <button className="am-chip" type="button" onClick={() => setSwapPop({ id: selImg.id, kind: swapKind(selImg) })}>
                    <ArrowLeftRight size={12} /> 换{swapKind(selImg) === 'face' ? '表情' : '熊猫头'}
                  </button>
                </Field>
              )}
              <Field label={`时段 · ${selImg.start.toFixed(1)}–${selImg.end.toFixed(1)}s (时间轴可拖)`}>
                <div className="am-row">
                  <NumberInput label="起 s" value={selImg.start} step={0.1} min={0} max={D} onChange={v => patchClip(selImg.id, { start: Math.max(0, Math.min(v, selImg.end - 0.1)) })} />
                  <NumberInput label="止 s" value={selImg.end} step={0.1} min={0} max={D} onChange={v => patchClip(selImg.id, { end: Math.max(selImg.start + 0.1, Math.min(v, D)) })} />
                </div>
              </Field>
              {isGifSrc(selImg.src) && (
                <>
                  <div className="am-field-sublabel" style={{ padding: '4px 0', fontWeight: 700, color: '#0a356d' }}>🎞️ 导入 GIF · {selGifTotal} 帧 (微调实时预览)</div>
                  <div className="am-row am-row-tight">
                    <button type="button" className={'am-chip' + (selImg.gifEdit?.reverse ? ' is-active' : '')}
                      onClick={() => patchClip(selImg.id, { gifEdit: normGifEdit(selImg, selGifTotal, { reverse: !selImg.gifEdit?.reverse }) })}>倒放</button>
                    <button type="button" className={'am-chip' + (selImg.gifEdit?.perClipBoomerang ? ' is-active' : '')}
                      onClick={() => patchClip(selImg.id, { gifEdit: normGifEdit(selImg, selGifTotal, { perClipBoomerang: !selImg.gifEdit?.perClipBoomerang }) })}>乒乓</button>
                  </div>
                  <Field label={`速度 · ${(selImg.gifEdit?.speed ?? 1).toFixed(2)}x`}>
                    <input type="range" min={0.25} max={4} step={0.05} value={selImg.gifEdit?.speed ?? 1} className="am-range"
                      onChange={e => patchClip(selImg.id, { gifEdit: normGifEdit(selImg, selGifTotal, { speed: parseFloat(e.target.value) }) })} />
                  </Field>
                  {selGifTotal > 1 && (
                    <Field label={`裁帧 · ${selImg.gifEdit?.trimStartFrame ?? 0}–${selImg.gifEdit?.trimEndFrame ?? selGifTotal} / ${selGifTotal}`}>
                      <div className="am-row">
                        <NumberInput label="起帧" value={selImg.gifEdit?.trimStartFrame ?? 0} step={1} min={0} max={selGifTotal}
                          onChange={v => patchClip(selImg.id, { gifEdit: normGifEdit(selImg, selGifTotal, { trimStartFrame: Math.max(0, Math.min(v, (selImg.gifEdit?.trimEndFrame ?? selGifTotal) - 1)) }) })} />
                        <NumberInput label="止帧" value={selImg.gifEdit?.trimEndFrame ?? selGifTotal} step={1} min={0} max={selGifTotal}
                          onChange={v => patchClip(selImg.id, { gifEdit: normGifEdit(selImg, selGifTotal, { trimEndFrame: Math.max((selImg.gifEdit?.trimStartFrame ?? 0) + 1, Math.min(v, selGifTotal)) }) })} />
                      </div>
                    </Field>
                  )}
                </>
              )}
              {selImg.loopMotion && selImg.loopMotion.kind !== 'none' && selImg.loopMotion.kind !== 'customMove' && (
                <>
                  <Field label={`动作幅度 · ${selImg.loopMotion.amp.toFixed(2)}`}>
                    <input type="range" min={0} max={2} step={0.05} value={selImg.loopMotion.amp} className="am-range" onChange={e => patchClip(selImg.id, { loopMotion: { ...selImg.loopMotion!, amp: parseFloat(e.target.value) } })} />
                  </Field>
                  <Field label={`速度(周期) · ${selImg.loopMotion.cycles}x`}>
                    <input type="range" min={1} max={8} step={1} value={selImg.loopMotion.cycles} className="am-range" onChange={e => patchClip(selImg.id, { loopMotion: { ...selImg.loopMotion!, cycles: parseInt(e.target.value) } })} />
                  </Field>
                </>
              )}
              {selImg.loopMotion?.kind === 'customMove' && selImg.loopMotion.to && (
                <>
                  <div className="am-field-sublabel" style={{ padding: '4px 0' }}>🎯 自定义移动 — A=当前位置, 拖橙色 <b>B</b> 点设「移动到哪」(循环里 A↔B 来回)</div>
                  <label className="gm-toggle-row"><input type="checkbox" checked={customEdit} onChange={e => setCustomEdit(e.target.checked)} /> 显示 A / B 手柄</label>
                  <button className="am-chip" onClick={swapAB} type="button"><ArrowLeftRight size={12} /> 互换 A ↔ B</button>
                  <Field label={`B 缩放 · ${selImg.loopMotion.to.scale.toFixed(2)}x`}>
                    <input type="range" min={0.2} max={3} step={0.05} value={selImg.loopMotion.to.scale} className="am-range" onChange={e => patchClip(selImg.id, { loopMotion: { ...selImg.loopMotion!, to: { ...selImg.loopMotion!.to!, scale: parseFloat(e.target.value) } } })} />
                  </Field>
                  <Field label={`B 旋转 · ${Math.round(selImg.loopMotion.to.rotation)}°`}>
                    <input type="range" min={-180} max={180} step={1} value={selImg.loopMotion.to.rotation} className="am-range" onChange={e => patchClip(selImg.id, { loopMotion: { ...selImg.loopMotion!, to: { ...selImg.loopMotion!.to!, rotation: parseFloat(e.target.value) } } })} />
                  </Field>
                </>
              )}
            </div>
          )}
          {selCap && (
            <div className="am-inspector-body">
              <Field label="字幕文字">
                <textarea className="am-input am-textarea" value={selCap.text} maxLength={80} onChange={e => patchClip(selCap.id, { text: e.target.value })} placeholder="输入字幕…" />
              </Field>
              <Field label="样式">
                <div className="am-style-chips">
                  {([{ id: 'meme', l: 'Meme' }, { id: 'panel', l: '白板' }, { id: 'bar', l: '黑条' }] as const).map(s => (
                    <button key={s.id} type="button" className={`am-style-chip am-style-chip-${s.id}${(selCap.style ?? 'meme') === s.id ? ' is-active' : ''}`} onClick={() => patchClip(selCap.id, { style: s.id })}>
                      <span className={`am-style-preview am-style-preview-${s.id}`}>Aa</span><span className="am-style-label">{s.l}</span>
                    </button>
                  ))}
                </div>
              </Field>
              <Field label={`位置 · X ${(selCap.transform?.x ?? 0).toFixed(0)}% / Y ${(selCap.transform?.y ?? 35).toFixed(0)}%`}>
                <div className="am-row">
                  <NumberInput label="X%" value={selCap.transform?.x ?? 0} step={1} min={-50} max={50} onChange={v => patchClip(selCap.id, { transform: { x: Math.max(-50, Math.min(50, v)), y: selCap.transform?.y ?? 35 } })} />
                  <NumberInput label="Y%" value={selCap.transform?.y ?? 35} step={1} min={-50} max={50} onChange={v => patchClip(selCap.id, { transform: { x: selCap.transform?.x ?? 0, y: Math.max(-50, Math.min(50, v)) } })} />
                </div>
              </Field>
              <Field label={selCap.fontSize != null
                ? `字号 · ${Math.round(selCap.fontSize * preset.width / 1280)}px`
                : `字号 · 自动 (${fitCaptionFontPx(selCap.text, preset.width, preset.height, selCap.style ?? 'meme', captionAvailH(selCap.transform?.y ?? 35, preset.height))}px)`}>
                <div className="am-row" style={{ gap: 6, alignItems: 'center' }}>
                  <button type="button" className={'am-chip' + (selCap.fontSize == null ? ' is-active' : '')}
                    onClick={() => patchClip(selCap.id, { fontSize: undefined })} title="自适应字号 — 短文案超大撑边, 长文案缩字分行 (免手动调)">自动</button>
                  <input type="range" min={12} max={Math.round(preset.width * 0.4)} step={1}
                    value={selCap.fontSize != null ? Math.round(selCap.fontSize * preset.width / 1280) : fitCaptionFontPx(selCap.text, preset.width, preset.height, selCap.style ?? 'meme', captionAvailH(selCap.transform?.y ?? 35, preset.height))} className="am-range"
                    onChange={e => patchClip(selCap.id, { fontSize: Math.round(parseInt(e.target.value) * 1280 / preset.width) })} />
                </div>
              </Field>
              <Field label="颜色">
                <div className="am-chips">
                  {['#ffffff', '#000000', '#ff5e00', '#1f84df', '#00cc66', '#cb2a2a', '#ffbf22'].map(c => (
                    <button key={c} type="button" className={'am-chip am-chip-color' + ((selCap.color ?? '#ffffff').toLowerCase() === c ? ' is-active' : '')} style={{ background: c }} onClick={() => patchClip(selCap.id, { color: c })} title={c}>
                      {(selCap.color ?? '#ffffff').toLowerCase() === c && <span style={{ color: c === '#ffffff' ? '#000' : '#fff' }}>✓</span>}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label={`入场动效 · ${selCap.entranceFx ?? 'none'}`}>
                <div className="am-chips am-caption-entrance-chips">
                  {([{ id: 'none', n: '无' }, { id: 'fade', n: '淡入' }, { id: 'pop', n: '弹入' }, { id: 'slam', n: '砸字' }, { id: 'typewriter', n: '打字机' }] as const).map(o => (
                    <button key={o.id} type="button" className={'am-chip am-caption-entrance-chip' + ((selCap.entranceFx ?? 'none') === o.id ? ' is-active' : '')} onClick={() => patchClip(selCap.id, { entranceFx: o.id === 'none' ? undefined : o.id })}>{o.n}</button>
                  ))}
                </div>
              </Field>
              <Field label={`时段 · ${selCap.start.toFixed(1)}–${selCap.end.toFixed(1)}s (时间轴可拖)`}>
                <div className="am-row">
                  <NumberInput label="起 s" value={selCap.start} step={0.1} min={0} max={D} onChange={v => patchClip(selCap.id, { start: Math.max(0, Math.min(v, selCap.end - 0.1)) })} />
                  <NumberInput label="止 s" value={selCap.end} step={0.1} min={0} max={D} onChange={v => patchClip(selCap.id, { end: Math.max(selCap.start + 0.1, Math.min(v, D)) })} />
                </div>
              </Field>
            </div>
          )}
          {!selected && <div className="am-inspector-empty">选一个图层来编辑</div>}
        </aside>
      </div>

      {/* GIF 循环时间轴 — 复用视频 am-tl-* 外观+交互 (吸附/手柄tooltip/时长手柄/素材拖入), fit-all 不横向滚动 + 循环可视化 */}
      <div className="gm-timeline">
        <div className="gm-tl-head">
          <span className="gm-tl-title">🎞️ 循环时间轴 · {D.toFixed(1)}s <span className="gm-hint">拖块移位 · 拖两端改时长 · 拖右缘改循环长 · 空白定位</span></span>
          <div className="gm-tl-headright">
            <button className="am-tb-btn" title="快速加一对随机熊猫头+表情 (从素材库)" onClick={() => { const rp = ALL_PANDAS[Math.floor(Math.random() * ALL_PANDAS.length)]; const rf = ALL_FACES[Math.floor(Math.random() * ALL_FACES.length)]; void addCombo(rp, rf); }}><ImageIcon size={13} /> <span>＋加素材</span></button>
            {(() => {
              const sel = project.clips.find(c => c.id === selectedId);
              const cutT = clampN(loopTimeMap(scrubT, D, project.loop.mode), 0, D);
              const canSplit = !!sel && cutT > sel.start + 0.1 && cutT < sel.end - 0.1;
              return (
                <button className="am-tb-btn am-tb-btn-primary gm-tl-split-btn" disabled={!canSplit}
                  onClick={() => sel && gifSplit(sel.id, cutT)}
                  title={canSplit ? `在游标 ${cutT.toFixed(1)}s 处切分选中图层 (快捷键 S)` : '选中图层 + 把游标拖到它中间, 才能切分 (S)'}>
                  <Scissors size={13} /> <span>切分</span>
                </button>
              );
            })()}
            <button
              type="button"
              className={'gm-tl-loopbadge gm-loop-' + project.loop.mode}
              title={`循环方式: ${loopInfo?.short ?? ''} — 点击切换 · ${loopInfo?.hint ?? ''}`}
              onClick={() => {
                const idx = LOOP_MODES.findIndex(m => m.mode === project.loop.mode);
                const next = LOOP_MODES[(idx + 1) % LOOP_MODES.length];
                setLoopMode(next.mode);
                toast(`循环方式 → ${next.short} · ${next.hint}`, { duration: 2200 });
              }}>{loopGlyph} {loopInfo?.short} <span className="gm-tl-loopbadge-swap">⇄</span></button>
            <button className="am-tb-btn" onClick={applyMotionToAll} disabled={!selImg?.loopMotion || selImg.loopMotion.kind === 'none'} title="把选中主体的动作套到所有图层">动作 → 全部</button>
          </div>
        </div>
        <div className="gm-tl-body">
          <div className="gm-tl-labels">
            <div className="gm-tl-lhead" />
            {tlClips.length === 0 && <div className="gm-tl-empty">空 — 左侧加主体</div>}
            {tlClips.map(c => c.trackId === 'image' ? (
              <Fragment key={c.id}>
                <div className={'gm-tl-label' + (c.id === selectedId ? ' is-sel' : '')} onClick={() => setSelectedId(c.id)}>
                  <img className="gm-tl-thumb" src={(c as ImageClip).src} alt="" />
                  <span className="gm-tl-lname">{(c as ImageClip).label || '主体'}</span>
                </div>
                <div className="gm-tl-mlabel">└ 动效</div>
              </Fragment>
            ) : (
              <div key={c.id} className={'gm-tl-label' + (c.id === selectedId ? ' is-sel' : '')} onClick={() => setSelectedId(c.id)}>
                <span className="gm-tl-capic"><TypeIcon size={12} /></span><span className="gm-tl-lname">{(c as CaptionClip).text || '字幕'}</span>
              </div>
            ))}
          </div>
          {/* 视频 pxPerSec 模型: gm-tl-lanes = 横向滚动容器, gm-tl-content = D*pxPerSec 宽; clip/ruler/playhead 全 px 定位 */}
          <div className={'gm-tl-lanes' + (tlDropActive ? ' is-drop' : '')} ref={lanesRef} onPointerDown={tlScrub} onContextMenu={e => { e.preventDefault(); ctxMenu.open(e, buildGifEmptyMenu()); }} onDragOver={tlDragOver} onDragLeave={() => setTlDropActive(false)} onDrop={tlDrop}>
            <div className="gm-tl-content" style={{ width: tlContentW }}>
              <div className="am-tl-ruler">
                {tlTicks.map(s => (
                  <Fragment key={s}>
                    <div className={'am-tl-tick' + (s % 5 === 0 ? ' major' : '')} style={{ left: s * pxPerSec }} />
                    <div className="am-tl-tick-label" style={{ left: s * pxPerSec }}>{s}s</div>
                  </Fragment>
                ))}
                <span className={'gm-tl-seam gm-seam-' + project.loop.mode} title={`循环接缝 — ${loopInfo?.hint ?? ''}`} style={{ left: Math.max(0, D * pxPerSec - 18) }}>{loopGlyph}</span>
                <div ref={playheadHandleRef} className="am-tl-playhead-handle" title="拖动跳转" onPointerDown={e => { e.stopPropagation(); tlScrub(e); }} />
                <div className="gm-tl-durhandle" style={{ left: D * pxPerSec }} onPointerDown={tlDurationDrag} title={`拖动改循环时长 (当前 ${D.toFixed(1)}s · 上限 ${Math.min(GIF_MAX_DURATION, preset.maxDuration)}s)`}>
                  <span className="am-tl-duration-handle-bar" />
                </div>
              </div>
              {tlClips.map(c => c.trackId === 'image' ? (
                <Fragment key={c.id}>
                  <div className="am-tl-track" style={{ height: 40 }}>
                    <div onContextMenu={e => onGifClipContextMenu(e, c)} className={'am-tl-clip am-tl-clip-image' + (c.id === selectedId ? ' is-selected' : '')}
                      style={{ left: c.start * pxPerSec, width: Math.max(8, (c.end - c.start) * pxPerSec) }}
                      onPointerDown={e => tlMove(e, c)} title={`${c.start.toFixed(1)}–${c.end.toFixed(1)}s`}>
                      <div className="am-tl-handle am-tl-handle-l" onPointerDown={e => tlResize(e, c, 'l')} />
                      <span className="am-tl-clip-label">{(c.end - c.start).toFixed(1)}s</span>
                      <div className="am-tl-handle am-tl-handle-r" onPointerDown={e => tlResize(e, c, 'r')} />
                    </div>
                  </div>
                  {/* 该层专属动效子轨: 动作块 (整段循环), 点→弹层 */}
                  <div className="am-tl-track gm-tl-mtrack" style={{ height: 28 }}>
                    {(() => { const lm = (c as ImageClip).loopMotion; const mm = motionMeta(lm?.kind); const empty = !lm?.kind || lm.kind === 'none'; return (
                      <button className={'gm-tl-mblock' + (empty ? ' is-empty' : '') + (motionPop?.id === c.id ? ' is-open' : '')}
                        style={{ left: c.start * pxPerSec, width: Math.max(8, (c.end - c.start) * pxPerSec) }}
                        title="点设置这层的循环动作 · 幅度 · 速度"
                        onClick={e => { e.stopPropagation(); setSelectedId(c.id); const r = e.currentTarget.getBoundingClientRect(); setMotionPop(motionPop?.id === c.id ? null : { id: c.id, bottom: window.innerHeight - r.top + 6, left: Math.min(r.left, window.innerWidth - 248) }); }}>
                        <span className="gm-tl-mblock-emoji">{empty ? '＋' : mm.emoji}</span>
                        <span className="gm-tl-mblock-name">{empty ? '加动作' : mm.label}</span>
                        <ChevronDown size={10} />
                      </button>
                    ); })()}
                  </div>
                </Fragment>
              ) : (
                <div key={c.id} className="am-tl-track" style={{ height: 40 }}>
                  <div onContextMenu={e => onGifClipContextMenu(e, c)} className={'am-tl-clip am-tl-clip-caption' + (c.id === selectedId ? ' is-selected' : '')}
                    style={{ left: c.start * pxPerSec, width: Math.max(8, (c.end - c.start) * pxPerSec) }}
                    onPointerDown={e => tlMove(e, c)} title={`${c.start.toFixed(1)}–${c.end.toFixed(1)}s`}>
                    <div className="am-tl-handle am-tl-handle-l" onPointerDown={e => tlResize(e, c, 'l')} />
                    <span className="am-tl-clip-emoji"><TypeIcon size={11} /></span><span className="am-tl-clip-label">{(c as CaptionClip).text || '字幕'}</span>
                    <div className="am-tl-handle am-tl-handle-r" onPointerDown={e => tlResize(e, c, 'r')} />
                  </div>
                </div>
              ))}
              {snapLine !== null && <div className="am-tl-snap-line" style={{ left: snapLine * pxPerSec }} />}
              <div className="am-tl-playhead" ref={playheadRef} style={{ left: 0 }} />
            </div>
          </div>
        </div>
        {resizeTip && <div className="am-tl-resize-tip" style={{ left: resizeTip.x + 12, top: resizeTip.y - 28 }}>{resizeTip.text}</div>}
      </div>

      {/* 时间轴行 → 动效弹层 (Option A): 图标网格 + 幅度/速度 + 自定义; 锚在 chip 上方 (时间轴在底部→向上弹) */}
      {swapPop && (() => {
        const all = swapPop.kind === 'panda' ? ALL_PANDAS : ALL_FACES;
        const k = swapQ.trim().toLowerCase();
        const list = all.filter(m => !k || m.labelCn.toLowerCase().includes(k) || m.labelEn.toLowerCase().includes(k) || m.tags.some(tg => tg.toLowerCase().includes(k)));
        const cur = project.clips.find(c => c.id === swapPop.id) as ImageClip | undefined;
        return (
          <div className="am-combo-picker-overlay" onClick={() => !swapBusy && setSwapPop(null)}>
            <div className="am-combo-picker win7-panel" onClick={e => e.stopPropagation()}>
              <div className="am-combo-picker-head">
                <span>换{swapPop.kind === 'panda' ? '熊猫头' : '表情'} · 保留位置/动作{swapPop.kind === 'panda' ? '/绑定脸自动对齐' : ''} · {list.length}/{all.length}</span>
                <button className="am-popover-close" onClick={() => setSwapPop(null)} type="button"><X size={14} /></button>
              </div>
              <div className="am-combo-picker-search material-search-box">
                <Search size={12} color="#888" />
                <input autoFocus type="text" className="material-search-input" placeholder={`搜${swapPop.kind === 'panda' ? '熊猫头' : '表情'}…`} value={swapQ} onChange={e => setSwapQ(e.target.value)} />
              </div>
              <div className="am-combo-picker-grid">
                {list.map(m => (
                  <button key={m.id} type="button" disabled={swapBusy} className={'am-combo-picker-card' + (cur && m.src === cur.src ? ' is-active' : '')} onClick={() => swapPop.kind === 'panda' ? void swapShell(swapPop.id, m) : swapFace(swapPop.id, m)} title={m.labelCn}>
                    <img src={m.src} alt={m.labelCn} className="am-combo-picker-thumb" loading="lazy" draggable={false} />
                    <span className="am-combo-picker-name">{m.labelCn}</span>
                  </button>
                ))}
                {list.length === 0 && <div className="am-combo-picker-empty">无匹配 · 改关键词试试</div>}
              </div>
            </div>
          </div>
        );
      })()}
      {cyclePop && (() => {
        const k = cycleQ.trim().toLowerCase();
        const list = ALL_FACES.filter(m => !k || m.labelCn.toLowerCase().includes(k) || m.labelEn.toLowerCase().includes(k) || m.tags.some(tg => tg.toLowerCase().includes(k)));
        const selMats = cycleSel.map(id => ALL_FACES.find(m => m.id === id)).filter(Boolean) as Material[];
        const toggle = (id: string) => setCycleSel(s => s.includes(id) ? s.filter(x => x !== id) : (s.length >= 6 ? s : [...s, id]));
        return (
          <div className="am-combo-picker-overlay" onClick={() => setCyclePop(null)}>
            <div className="am-combo-picker win7-panel" onClick={e => e.stopPropagation()}>
              <div className="am-combo-picker-head">
                <span>🎭 变脸 · 选 2-6 张表情依次轮播 · 已选 {cycleSel.length}/6</span>
                <button className="am-popover-close" onClick={() => setCyclePop(null)} type="button"><X size={14} /></button>
              </div>
              <div className="am-combo-picker-search material-search-box">
                <Search size={12} color="#888" />
                <input autoFocus type="text" className="material-search-input" placeholder="搜表情…" value={cycleQ} onChange={e => setCycleQ(e.target.value)} />
              </div>
              <div className="am-combo-picker-grid">
                {list.map(m => {
                  const idx = cycleSel.indexOf(m.id);
                  return (
                    <button key={m.id} type="button" className={'am-combo-picker-card' + (idx >= 0 ? ' is-active' : '')} onClick={() => toggle(m.id)} title={m.labelCn}>
                      <img src={m.src} alt={m.labelCn} className="am-combo-picker-thumb" loading="lazy" draggable={false} />
                      <span className="am-combo-picker-name">{m.labelCn}</span>
                      {idx >= 0 && <span className="gm-cycle-badge">{idx + 1}</span>}
                    </button>
                  );
                })}
                {list.length === 0 && <div className="am-combo-picker-empty">无匹配 · 改关键词试试</div>}
              </div>
              <div className="am-combo-picker-foot">
                <button type="button" className={'am-chip' + (cycleDissolve ? ' is-active' : '')} onClick={() => setCycleDissolve(d => !d)} title="溶解 = 脸之间淡入淡出过渡; 关 = 直接快切(鬼畜)">
                  {cycleDissolve ? '✓ 溶解过渡' : '○ 硬切快换'}
                </button>
                <button type="button" className="gm-cycle-make" disabled={cycleSel.length < 2} onClick={() => applyFaceCycle(cyclePop.shellId, cyclePop.faceId, selMats, cycleDissolve)}>
                  生成变脸 · {cycleSel.length} 张
                </button>
              </div>
            </div>
          </div>
        );
      })()}
      {motionPop && (() => {
        const mc = project.clips.find(c => c.id === motionPop.id) as ImageClip | undefined;
        if (!mc || mc.trackId !== 'image') return null;
        const lm = mc.loopMotion ?? { kind: 'none' as LoopMotionKind, amp: 1, cycles: 1 };
        return (
          <>
            <div className="gm-pop-overlay" onPointerDown={() => setMotionPop(null)} />
            <div className="gm-motionpop" style={{ bottom: motionPop.bottom, left: motionPop.left }} onPointerDown={e => e.stopPropagation()}>
              <div className="gm-motionpop-head"><img className="gm-motionpop-thumb" src={mc.src} alt="" /><span className="gm-motionpop-head-name">{mc.label || '主体'} · 循环动作</span>{lm.kind !== 'none' && <button type="button" className="gm-motionpop-clear" title="清除这层动作" onClick={() => { setLayerMotion(motionPop.id, 'none'); setCustomEdit(false); }}><X size={12} /> 清除</button>}</div>
              <div className="gm-motionpop-grid">
                {LOOP_MOTIONS.map(m => (
                  <button key={m.kind} title={m.label}
                    className={'gm-motionpop-btn' + (lm.kind === m.kind ? ' active' : '')}
                    onClick={() => setLayerMotion(motionPop.id, m.kind)}>
                    <span className="gm-motionpop-emoji">{m.emoji}</span>{m.label}
                  </button>
                ))}
                <button title="自定义移动 A→B (画板拖两点)"
                  className={'gm-motionpop-btn gm-motionpop-custom' + (lm.kind === 'customMove' ? ' active' : '')}
                  onClick={() => { setLayerMotion(motionPop.id, 'customMove'); setSelectedId(motionPop.id); setCustomEdit(true); }}>
                  <span className="gm-motionpop-emoji">🎯</span>自定义
                </button>
              </div>
              {lm.kind !== 'none' && (
                <div className="gm-motionpop-sliders">
                  <label className="gm-fx-num">幅度<input type="range" min={0.2} max={2} step={0.05} value={lm.amp}
                    onChange={e => patchClip(motionPop.id, { loopMotion: { ...lm, amp: parseFloat(e.target.value) } })} /><b>{lm.amp.toFixed(2)}</b></label>
                  <label className="gm-fx-num">速度<input type="range" min={1} max={8} step={1} value={lm.cycles}
                    onChange={e => patchClip(motionPop.id, { loopMotion: { ...lm, cycles: parseInt(e.target.value) } })} /><b>{lm.cycles}x</b></label>
                </div>
              )}
              {lm.kind === 'customMove' && <div className="gm-motionpop-hint">🎯 画板上拖橙色 <b>B</b> 点设「移动到哪」(画面在 当前位↔B 来回); 想改起点直接拖元素本体</div>}
              {/* 动效分段: 在游标处把这层切两段 → 后半段可设另一个动作 (同层不同时段不同动效) */}
              {(() => {
                const cutT = clampN(loopTimeMap(scrubT, D, project.loop.mode), 0, D);
                const canSplit = cutT > mc.start + 0.1 && cutT < mc.end - 0.1;
                return (
                  <div className="gm-motionpop-foot">
                    <button type="button" className="gm-motionpop-split" disabled={!canSplit}
                      onClick={() => { gifSplit(motionPop.id, cutT); setMotionPop(null); }}
                      title={canSplit ? `在游标 ${cutT.toFixed(1)}s 处把这层切成两段` : '把顶部橙色游标拖到这层中间才能切'}>
                      <Scissors size={11} /> 切两段 · 各设动效
                    </button>
                    <span className="gm-motionpop-foot-tip">{canSplit ? '后半段点开设另一个动作 → 不同时段不同动效' : '想分时段套不同动效? 先把游标拖到这层中间'}</span>
                  </div>
                );
              })()}
            </div>
          </>
        );
      })()}

      {previewOpen && (
        <div className="gm-modal gm-preview-modal" onClick={() => setPreviewOpen(false)}>
          <div className="gm-preview-box" onClick={e => e.stopPropagation()}>
            <div className="gm-preview-head">
              <span>全屏预览 · {loopInfo?.short ?? ''}循环 · {D.toFixed(1)}s · {preset.label}</span>
              <button onClick={() => setPreviewOpen(false)}><X size={16} /></button>
            </div>
            <canvas ref={previewCanvasRef} className="gm-preview-canvas" />
            <div className="gm-preview-hint">循环播放中 · 点空白关闭</div>
          </div>
        </div>
      )}
      {variantOpen && (
        <div className="gm-modal" onClick={closeVariants}>
          <div className="gm-modal-box" onClick={e => e.stopPropagation()}>
            <div className="gm-modal-head">
              <span>三种循环变体 — 挑文件最小 / 最顺的下载</span>
              <button onClick={closeVariants}><X size={16} /></button>
            </div>
            {variantBusy && <div className="gm-empty" style={{ padding: 24 }}>生成中… (串行渲 3 个, 稍等)</div>}
            {variants && (
              <div className="gm-variant-grid">
                {variants.map(({ v, url }) => (
                  <div key={v.mode} className="gm-variant">
                    <img src={url} alt={v.mode} />
                    <div className="gm-variant-meta">
                      <b>{LOOP_MODES.find(m => m.mode === v.mode)?.short ?? v.mode}</b>
                      <span>{(v.size / 1024).toFixed(0)}KB · {v.frameCount}帧</span>
                    </div>
                    <button onClick={() => downloadBlob(v.blob, `熊猫头循环-${v.mode}`)}><Download size={13} /> 下载</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 移动端底部导航 (素材/字幕/动效 → 左栏 sheet 并切 seg; 编辑 → 右栏 sheet). 复用 am-mobile-* 样式 */}
      {isMobile && (
        <>
          {gmSheet && <div className="gm-sheet-backdrop" onClick={() => setGmSheet(null)} />}
          <div className="am-mobile-bottombar am-mobile-bottombar--5" role="tablist">
            <button type="button" className={'am-mb-tab' + (gmSheet === 'left' && seg === 'asset' ? ' is-active' : '')}
              onClick={() => { if (gmSheet === 'left' && seg === 'asset') setGmSheet(null); else { setSeg('asset'); setGmSheet('left'); } }}>
              <span className="am-mb-tab-ic"><ImageIcon size={18} /></span><span className="am-mb-tab-lbl">素材</span>
            </button>
            <button type="button" className={'am-mb-tab' + (gmSheet === 'left' && seg === 'caption' ? ' is-active' : '')}
              onClick={() => { if (gmSheet === 'left' && seg === 'caption') setGmSheet(null); else { setSeg('caption'); setGmSheet('left'); } }}>
              <span className="am-mb-tab-ic"><MessageSquare size={18} /></span><span className="am-mb-tab-lbl">字幕</span>
            </button>
            <button type="button" className={'am-mb-tab' + (gmSheet === 'left' && seg === 'fx' ? ' is-active' : '')}
              onClick={() => { if (gmSheet === 'left' && seg === 'fx') setGmSheet(null); else { setSeg('fx'); setGmSheet('left'); } }}>
              <span className="am-mb-tab-ic"><Sparkles size={18} /></span><span className="am-mb-tab-lbl">动效</span>
            </button>
            <button type="button" disabled={!selectedId}
              className={'am-mb-tab' + (gmSheet === 'right' ? ' is-active' : '') + (!selectedId ? ' is-disabled' : '')}
              onClick={() => setGmSheet(s => (s === 'right' ? null : 'right'))}>
              <span className="am-mb-tab-ic"><Layers size={18} /></span><span className="am-mb-tab-lbl">编辑</span>
            </button>
            <button type="button" className="am-mb-tab" disabled={exporting} onClick={() => { setGmSheet(null); onExport(); }}>
              <span className="am-mb-tab-ic">{exporting ? <Loader2 size={18} className="gm-spin" /> : <Download size={18} />}</span><span className="am-mb-tab-lbl">{exporting ? '生成中' : '导出'}</span>
            </button>
          </div>
        </>
      )}
      {ctxMenu.render()}
    </>
  );
}

// 跟视频 ImageProps/CaptionProps 同款的 Field + NumberInput (am-* class, 求一致)
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="am-field"><div className="am-field-label">{label}</div>{children}</div>;
}
function NumberInput({ label, value, onChange, step, min, max }: { label: string; value: number; onChange: (v: number) => void; step: number; min?: number; max?: number }) {
  return (
    <div className="am-numinput-wrap">
      <div className="am-field-sublabel">{label}</div>
      <input type="number" className="am-input am-tabular" value={Number(value.toFixed(2))} step={step} min={min} max={max}
        onChange={e => onChange(parseFloat(e.target.value || '0'))} />
    </div>
  );
}
