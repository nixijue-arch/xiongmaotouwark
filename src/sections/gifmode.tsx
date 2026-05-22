// gifmode.tsx — GIF 循环编辑器 (融入 animate 的 "GIF 视图", 复用 am-* 外壳与视频视图高度一致)
// 范式: 循环优先. clips 全是 [0,duration] 全幅图层 (无时间轴), 循环本身取代时间轴.
// 复用 animcore 纯渲染核心 + gifloop 循环引擎. 绝不 import animatemode (避免拉起 audio 单例).
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Play, Pause, Download, Trash2, Upload, Loader2, FlipHorizontal, Type as TypeIcon, Eye, Layers, X, Image as ImageIcon, MessageSquare, Sparkles, FolderOpen, Search, ArrowLeftRight, Shuffle, Save, RotateCw, Undo2, Redo2 } from 'lucide-react';
import { toast } from 'sonner';
import { get as idbGet, set as idbSet } from 'idb-keyval';
import { ALL_PANDAS, ALL_FACES, type Material } from '@/data/materials';
import { useIsMobile } from '@/hooks/usemediaquery';
import { useMeme, type DraftSlot } from '@/context/memecontext';
import { getEditorPandaBox, calcEditorFaceLayout } from '@/lib/composeMeme';
import { pickRandomText } from '@/data/quickModeTexts';
import {
  loadMedia, mediaWH, isGifSrc, isGifFrames, drawableAt, GIF_PRESETS, GIF_MAX_DURATION, GIF_MIN_DURATION,
  DEFAULT_TRANSFORM, DEFAULT_CAPTION_TRANSFORM,
  type MediaAsset, type Clip, type ImageClip, type CaptionClip, type Transform,
  type GifPresetId, type LoopMotionKind, type ProjectMode, type GifFrameEdit,
} from '@/lib/animcore';
import {
  type GifProject, type GifLoopMode, type GifVariant, DEFAULT_LOOP_CONFIG,
  loopTimeMap, loopSpecAt, renderLoopFrame, makeLoopMotionAt, makeBoundFaceAt, resolveBoundFaceBox, captureFaceLocal, loopMotionDelta, loopSeamScore, exportGIFLoop, exportGIFVariants, downloadBlob,
} from '@/lib/gifloop';
import { ComboTab, MaterialCardClip, MaterialSourceButtons, DraftCardClip, SCENE_LIB, draftToLayers, CaptionQuickGen, CaptionPositionPresets, CaptionEmojiPicker, CaptionBatchImport, type DragPayload } from '@/lib/sharededitor';
import { showDialog } from '@/components/appdialog';
import { makeDraftThumb } from '@/lib/thumbutil';
import { Maximize2, FileDown, FileUp, FilePlus, ChevronDown, Scissors, Copy as CopyIcon, ChevronUp, Link2, Link2Off } from 'lucide-react';
import { useContextMenu, type ContextMenuItem } from '@/components/contextmenu';
import './gifmode.css';

const GIF_PROJECT_IDB_KEY = 'xiongmaotou.gifmode-current.v1';
const GIF_DRAFTS_IDB_KEY = 'xiongmaotou.gifmode-drafts.v1';
const GIF_DRAFT_MAX = 10;
const GIF_UPLOADS_IDB_KEY = 'xiongmaotou.gifmode-userpool.v1'; // GIF 自己的素材池 (联网搜图/抠脸沉淀, 跟 video 数据隔离)
const GIF_UPLOAD_MAX = 60;
// 字幕默认字号 (1280-conv: drawCaption 按 capFontSize*W/1280 渲) — 56 跟视频默认一致 (原 180 过大 ~3.3x, 一加就盖满画面)
const GIF_CAP_FONT = 56;
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

const LOOP_MOTIONS: { kind: LoopMotionKind; label: string; emoji: string }[] = [
  { kind: 'none', label: '静止', emoji: '⏸️' },
  { kind: 'bob', label: '上下浮', emoji: '↕️' },
  { kind: 'shimmy', label: '左右抖', emoji: '↔️' },
  { kind: 'sway', label: '摇摆', emoji: '🙃' },
  { kind: 'breathe', label: '呼吸', emoji: '🫁' },
  { kind: 'pulseLoop', label: '脉冲', emoji: '💓' },
  { kind: 'spin360', label: '整圈转', emoji: '🔄' },
  { kind: 'float', label: '8字漂', emoji: '🎈' },
  { kind: 'bounce', label: '弹跳', emoji: '🏀' },
  { kind: 'orbit', label: '绕圈', emoji: '🛸' },
  { kind: 'hop', label: '横跳', emoji: '🦘' },
  { kind: 'wobble', label: '果冻晃', emoji: '🍮' },
  { kind: 'jitter', label: '疯狂抖', emoji: '⚡' },
  { kind: 'punch', label: '怼脸', emoji: '🥊' },
  { kind: 'swing', label: '钟摆', emoji: '🎐' },
];
// 动作 kind → 图标/名 (含 customMove); 时间轴 chip + clip 角标 + 弹层网格共用
const motionMeta = (kind?: LoopMotionKind): { kind: LoopMotionKind; label: string; emoji: string } =>
  kind === 'customMove' ? { kind: 'customMove', label: '自定义', emoji: '🎯' }
    : (LOOP_MOTIONS.find(m => m.kind === kind) ?? LOOP_MOTIONS[0]);

const LOOP_MODES: { mode: GifLoopMode; short: string; hint: string }[] = [
  { mode: 'normal', short: '直接', hint: '正放循环 · 播完瞬间跳回开头 — 适合本身首尾闭环的动作 (内置动作都是)' },
  { mode: 'boomerang', short: '乒乓', hint: '正放→倒放来回 · 任何动作都首尾无缝, 时长翻倍 — 最稳' },
  { mode: 'reverse', short: '倒放', hint: '整段倒着放循环 · 跟正放反方向, 出反差/搞怪感' },
  { mode: 'rewind', short: '急退', hint: '正放完急速倒带回开头 · 强节奏"卡带"感, 跟乒乓不同(回退极快)' },
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

// 时长变化时夹紧 clip [start,end] (全幅的跟随新时长; 部分的只夹上限) — 不再强制全部全幅, 让用户能在时间轴自定时段
function clampClipsToDuration(clips: Clip[], oldD: number, newD: number): Clip[] {
  return clips.map(c => {
    const wasFull = c.start <= 0.001 && c.end >= oldD - 0.01;
    const end = wasFull ? newD : Math.min(c.end, newD);
    const start = Math.min(Math.max(0, c.start), Math.max(0, end - 0.1));
    return { ...c, start, end } as Clip;
  });
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
  const preset = GIF_PRESETS[0]; // wechat
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
  const [assetSub, setAssetSub] = useState<'combo' | 'panda' | 'face' | 'scene' | 'draft' | 'upload'>('combo');
  const [q, setQ] = useState('');
  const [scrubT, setScrubT] = useState(0);
  const [variantOpen, setVariantOpen] = useState(false);
  const [variants, setVariants] = useState<{ v: GifVariant; url: string }[] | null>(null);
  const [variantBusy, setVariantBusy] = useState(false);
  const [gifDrafts, setGifDrafts] = useState<GifDraftSlot[]>([]);
  const [draftPopOpen, setDraftPopOpen] = useState(false);
  const [gifUploads, setGifUploads] = useState<Material[]>([]); // GIF 素材池 (搜图/抠脸沉淀, 隔离于 video)
  const uploadsLoadedRef = useRef(false); // 防"持久化在加载前跑→把池写空"竞态

  const cacheRef = useRef<Map<string, MediaAsset>>(new Map());
  const [cacheVer, setCacheVer] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const jsonInputRef = useRef<HTMLInputElement>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);

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
  const clearAll = useCallback(() => {
    if (projectRef.current.clips.length === 0) return;
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

  const preset = useMemo(() => GIF_PRESETS.find(p => p.id === project.preset) ?? GIF_PRESETS[0], [project.preset]);
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
        histSnapRef.current = saved;
        setProject(saved);
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
      const pr = GIF_PRESETS.find(x => x.id === p.preset) ?? GIF_PRESETS[0];
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
                el.style.transform = `translate(${((rc.cx - r0.cx) * sx).toFixed(2)}px, ${((rc.cy - r0.cy) * sy).toFixed(2)}px) rotate(${rc.rotation.toFixed(2)}deg) scale(${ds.toFixed(4)})`;
                boundDone = true;
              }
            }
          }
          if (!boundDone) {
            const md = loopMotionDelta(ic.loopMotion, t, dd, w, h, ic.transform);
            const baseRot = ic.transform?.rotation ?? 0;
            el.style.transform = `translate(${(md.dx * sx).toFixed(2)}px, ${(md.dy * sy).toFixed(2)}px) rotate(${(baseRot + md.dRot).toFixed(2)}deg) scale(${md.dScale.toFixed(4)})`;
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
            fontSize: payload.captionFontSize ?? GIF_CAP_FONT, color: payload.captionColor,
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
      const box = await getEditorPandaBox(panda.src, { fillShell: true });
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
      setProject(p => {
        const bumped = p.clips.map(c => (c.trackId === 'image' ? { ...c, lane: c.lane + 2 } as Clip : c));
        const pandaClip: ImageClip = {
          id: pandaId, trackId: 'image', lane: 1, start: 0, end: p.duration,
          src: box.croppedSrc, label: panda.labelCn, fx: 'none',
          transform: { ...DEFAULT_TRANSFORM, scale: fillScale }, loopMotion: { kind: 'none', amp: 1, cycles: 1 },
        };
        const faceClip: ImageClip = {
          id: faceId, trackId: 'image', lane: 0, start: 0, end: p.duration,
          src: face.src, label: face.labelCn + '·脸', fx: 'none',
          transform: faceTransform, loopMotion: { kind: 'none', amp: 1, cycles: 1 },
          boundTo: pandaId, faceLocal,
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
          text, style: 'meme', fontSize: GIF_CAP_FONT, transform: { ...DEFAULT_CAPTION_TRANSFORM },
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
        text: '双击编辑文字', style: 'meme', fontSize: GIF_CAP_FONT, transform: { ...DEFAULT_CAPTION_TRANSFORM },
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
    setProject(p => ({ ...p, clips: p.clips.filter(c => c.id !== id) }));
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
            loopMotion: (c as ImageClip).loopMotion ? { ...(c as ImageClip).loopMotion! } : undefined } as ImageClip)
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
      toast.success('来回动作 ✓ — 自定义往返 (画板拖 A·B 点)');
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
    const pr = GIF_PRESETS.find(x => x.id === id) ?? GIF_PRESETS[0];
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

  const onUpload = useCallback((file: File) => {
    if (file.size > 30 * 1024 * 1024) { toast.error('文件超过 30MB'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const src = String(reader.result || '');
      if (!src) return;
      const id = uid('up');
      setProject(p => {
        const clip: ImageClip = {
          id, trackId: 'image', lane: 0, start: 0, end: p.duration,
          src, label: file.name.slice(0, 16), fx: 'none',
          transform: { ...DEFAULT_TRANSFORM }, loopMotion: { kind: 'none', amp: 1, cycles: 1 },
        };
        const bumped = p.clips.map(c => (c.trackId === 'image' ? { ...c, lane: c.lane + 1 } as Clip : c));
        return { ...p, clips: [...bumped, clip] };
      });
      setSelectedId(id);
      toast.success('已添加上传素材');
    };
    reader.readAsDataURL(file);
  }, []);

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
    const thumbSrc = firstImg?.src ? await makeDraftThumb(firstImg.src) : undefined;  // 96px webp 缩略图 (省 IDB)
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
        const pr = GIF_PRESETS.find(p => p.id === data.preset) ?? GIF_PRESETS[0];
        const dur = Number.isFinite(data.duration) ? Math.max(GIF_MIN_DURATION, Math.min(data.duration, GIF_MAX_DURATION, pr.maxDuration)) : pr.defaultDuration;
        const safe: GifProject = {
          kind: 'gif-project', version: 1, preset: pr.id, duration: dur,
          loop: { ...DEFAULT_LOOP_CONFIG, ...(data.loop || {}) },
          lanes: { image: data.lanes?.image ?? 1, caption: data.lanes?.caption ?? 1, fx: data.lanes?.fx ?? 1 },
          clips: (data.clips.filter(c => c && (c.trackId === 'image' || c.trackId === 'caption') && (c.trackId !== 'image' || !!(c as ImageClip).src)) as Clip[])
            .map(c => ({ ...c, start: Math.max(0, Math.min(Number.isFinite(c.start) ? c.start : 0, Math.max(0, dur - 0.1))), end: Math.max(0.1, Math.min(Number.isFinite(c.end) ? c.end : dur, dur)) } as Clip)),
        };
        historyRef.current = { past: [], future: [] };
        skipHistRef.current = true;
        setProject(safe);
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
    const pr0 = GIF_PRESETS.find(x => x.id === projectRef.current.preset) ?? GIF_PRESETS[0];
    cv.width = pr0.width; cv.height = pr0.height;
    const ctx = cv.getContext('2d', { alpha: false }); if (!ctx) return;
    const scratch = document.createElement('canvas'); scratch.width = pr0.width; scratch.height = pr0.height;
    const sctx = scratch.getContext('2d', { alpha: true }) ?? undefined;
    const t0 = performance.now();
    let raf = 0;
    const draw = () => {
      const p = projectRef.current;
      const pr = GIF_PRESETS.find(x => x.id === p.preset) ?? GIF_PRESETS[0];
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
    const panda = ALL_PANDAS[Math.floor(Math.random() * ALL_PANDAS.length)];
    const face = ALL_FACES[Math.floor(Math.random() * ALL_FACES.length)];
    // 跟快速/编辑器同文案池 (pickRandomText), 但挑短的 (≤ GIF_CAP_MAXCHARS) 保证一行装下; 实在长就截断
    let cap = pickRandomText('zh', 'all') || '';
    for (let tries = 0; cap.length > GIF_CAP_MAXCHARS && tries < 6; tries++) cap = pickRandomText('zh', 'all') || cap;
    if (cap.length > GIF_CAP_MAXCHARS) cap = cap.slice(0, GIF_CAP_MAXCHARS);
    // 更丰富的随机: 脸动作从全集挑(含鬼畜系) + 随机幅度/周期; 身体 ~40% 也来个轻动作; 随机循环方式
    const rPick = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)];
    const faceMotions: LoopMotionKind[] = ['bob', 'shimmy', 'sway', 'breathe', 'pulseLoop', 'bounce', 'orbit', 'hop', 'wobble', 'jitter', 'punch', 'swing'];
    const bodyMotions: LoopMotionKind[] = ['none', 'none', 'none', 'bob', 'sway', 'breathe', 'wobble'];
    const faceMotion = rPick(faceMotions);
    const bodyMotion = rPick(bodyMotions);
    const faceAmp = Number((0.8 + Math.random() * 0.7).toFixed(2)); // 0.8~1.5
    const faceCycles = Math.random() < 0.35 ? 2 : 1;
    const loopMode: GifLoopMode = (() => { const r = Math.random(); return r < 0.4 ? 'normal' : r < 0.65 ? 'boomerang' : r < 0.78 ? 'reverse' : r < 0.88 ? 'rewind' : 'crossfade'; })();
    try {
      const box = await getEditorPandaBox(panda.src, { fillShell: true });
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
      setProject(p => {
        const clips: Clip[] = [
          { id: pid, trackId: 'image', lane: 1, start: 0, end: p.duration, src: box.croppedSrc, label: panda.labelCn, fx: 'none', transform: { ...DEFAULT_TRANSFORM, scale: fillScale }, loopMotion: { kind: bodyMotion, amp: 0.8, cycles: 1 } } as ImageClip,
          { id: fid, trackId: 'image', lane: 0, start: 0, end: p.duration, src: face.src, label: face.labelCn + '·脸', fx: 'none', transform: faceT, loopMotion: { kind: faceMotion, amp: faceAmp, cycles: faceCycles }, boundTo: pid, faceLocal: faceLocalR } as ImageClip,
        ];
        if (cap) clips.push({ id: uid('cap'), trackId: 'caption', lane: 0, start: 0, end: p.duration, text: cap, style: 'meme', fontSize: GIF_CAP_FONT, transform: { x: 0, y: 34 } } as CaptionClip);
        return { ...p, clips, loop: { ...p.loop, mode: loopMode } };
      });
      setSelectedId(fid);
      setCustomEdit(false);
      const ml = LOOP_MOTIONS.find(x => x.kind === faceMotion);
      toast.success(`随机生成 ✓ — ${ml?.label ?? faceMotion}${bodyMotion !== 'none' ? ' + 身体动' : ''} · ${LOOP_MODES.find(m => m.mode === loopMode)?.short ?? ''}循环`);
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
    const shell = others.slice().sort((a, b) => b.lane - a.lane)[0];  // 最底层 = 熊猫头壳
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
  const selImg = selected && selected.trackId === 'image' ? (selected as ImageClip) : null;
  const selCap = selected && selected.trackId === 'caption' ? (selected as CaptionClip) : null;
  const tr = selImg?.transform ?? DEFAULT_TRANSFORM;
  const maxDur = Math.min(GIF_MAX_DURATION, preset.maxDuration);
  const selGifMedia = selImg && isGifSrc(selImg.src) ? cacheRef.current.get(selImg.src) : undefined;
  const selGifTotal = selGifMedia && isGifFrames(selGifMedia) ? selGifMedia.frames.length : 0;

  // ---- 画板编辑 (DOM 元素拖拽, 跟视频 startStageDrag / startCaptionDrag 同款数学; canvasSize → fit 显示尺寸) ----
  const startStageDrag = (e: React.PointerEvent, clip: ImageClip, kind: 'move' | 'scale' | 'rotate') => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ }
    if (clip.id !== selectedId) setSelectedId(clip.id);
    beginDrag();
    const startT = clip.transform ?? DEFAULT_TRANSFORM;
    const startX = e.clientX, startY = e.clientY;
    const cw = fit.w || preset.width, ch = fit.h || preset.height;
    const _box = (e.currentTarget as HTMLElement).closest('.am-stage-img') as HTMLElement | null;
    const _r = (_box ?? (e.currentTarget as HTMLElement)).getBoundingClientRect();
    const _ecx = _r.left + _r.width / 2, _ecy = _r.top + _r.height / 2;
    const _startAngle = Math.atan2(startY - _ecy, startX - _ecx) * 180 / Math.PI;
    const onMove = (ev: PointerEvent) => {
      if (kind === 'move') {
        const dxPct = (ev.clientX - startX) / cw * 100;
        const dyPct = (ev.clientY - startY) / ch * 100;
        patchTransform(clip.id, { x: Math.max(-200, Math.min(200, startT.x + dxPct)), y: Math.max(-200, Math.min(200, startT.y + dyPct)) });
      } else if (kind === 'scale') {
        const baseSize = Math.min(cw, ch) * 0.6;
        const drag = Math.max(ev.clientX - startX, ev.clientY - startY);
        patchTransform(clip.id, { scale: Math.max(0.2, Math.min(4, startT.scale + (drag * 2) / Math.max(1, baseSize))) });
      } else {
        // 拖拽旋转 (Shift 锁 15°)
        const a = Math.atan2(ev.clientY - _ecy, ev.clientX - _ecx) * 180 / Math.PI;
        let rot = startT.rotation + (a - _startAngle);
        if (ev.shiftKey) rot = Math.round(rot / 15) * 15;
        patchTransform(clip.id, { rotation: Math.max(-180, Math.min(180, rot)) });
      }
    };
    const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
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

  // 自定义移动 A(base) / B(to) 圆点在画板上的显示坐标
  const markerPos = useMemo(() => {
    if (!selImg || !customEdit || selImg.loopMotion?.kind !== 'customMove' || !selImg.loopMotion.to) return null;
    const cw = fit.w || preset.width, ch = fit.h || preset.height;
    const sx = cw / preset.width, sy = ch / preset.height;
    const base = selImg.transform ?? DEFAULT_TRANSFORM;
    const to = selImg.loopMotion.to;
    // 渲染位置再夹一层 (留 14px 边距), 即使数据异常 A/B 也不会跑出画板被遮挡
    const cl = (v: number, max: number) => Math.max(14, Math.min(max - 14, v));
    return {
      ax: cl((preset.width / 2 + (base.x / 100) * preset.width) * sx, cw),
      ay: cl((preset.height / 2 + (base.y / 100) * preset.height) * sy, ch),
      bx: cl((preset.width / 2 + (to.x / 100) * preset.width) * sx, cw),
      by: cl((preset.height / 2 + (to.y / 100) * preset.height) * sy, ch),
    };
  }, [selImg, customEdit, fit, preset]);

  return (
    <>
      {/* ===== 顶栏 — 复用 am-toolbar 蓝色 titlebar, 跟视频视图同一条 ===== */}
      <div className="am-toolbar win7-titlebar gm-toolbar">
        <div className="am-toolbar-name">
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
        <div className="am-tb-sep" />
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
        <button className="am-tb-btn" onClick={openVariants} disabled={variantBusy} title="渲染 直接/乒乓/溶解 三变体并排对比">
          <Layers size={13} /> <span>对比变体</span>
        </button>
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
                {(['combo', 'panda', 'face', 'scene', 'draft', 'upload'] as const).map(k => (
                  <button key={k} className={'am-subtab' + (assetSub === k ? ' is-active' : '')} onClick={() => setAssetSub(k)}>
                    {k === 'combo' ? '配套' : k === 'panda' ? '熊猫' : k === 'face' ? '表情' : k === 'scene' ? '场景' : k === 'draft' ? `草图${draftSlots.length ? ' ' + draftSlots.length : ''}` : '上传'}
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
                      {gifUploads.filter(u => u.kind === 'panda').filter(matchQ).map(m => <MaterialCardClip key={m.id} item={m} kind="panda" onQuickAdd={addFromPayload} onDelete={() => setGifUploads(prev => prev.filter(x => x.id !== m.id))} />)}
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
                {assetSub === 'scene' && (
                  <div className="sidebar-grid">
                    {SCENE_LIB.filter(matchQ).map(m => <MaterialCardClip key={m.id} item={m} kind="scene" onQuickAdd={addFromPayload} />)}
                  </div>
                )}
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
                {assetSub === 'upload' && (
                  <div className="gm-upload-zone">
                    <button className="gm-addcap" onClick={() => fileInputRef.current?.click()}><Upload size={14} /> 上传图片 (≤30MB)</button>
                    <input ref={fileInputRef} type="file" accept="image/*" hidden
                      onChange={e => { const f = e.target.files?.[0]; if (f) onUpload(f); e.currentTarget.value = ''; }} />
                    <div className="gm-hint" style={{ marginTop: 8 }}>上传后立即作为全幅图层加入</div>
                  </div>
                )}
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
              <div className="gm-sec-title" style={{ marginTop: 12 }}>每层动作 <span className="gm-hint">(已搬到时间轴)</span></div>
              <div className="gm-fx-tlhint">
                <span className="gm-fx-tlhint-ico">🫨</span>
                <div>下方<b>时间轴</b>每层带一条<b>动效子轨</b>, 点上面的动作块 <span className="gm-fx-tlhint-chip">🫨 抖动 ▾</span> 就地选<b>动作 + 幅度 + 速度 + 自定义移动</b>。</div>
              </div>
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
                return (
                  <div key={c.id} ref={el => { if (el) overlayRefs.current.set(c.id, el); else overlayRefs.current.delete(c.id); }}
                    className={'am-stage-img' + (c.id === selectedId ? ' is-selected' : '') + (isScene ? ' am-stage-scene' : '')}
                    style={{ left: (b.cx - b.iw / 2) * sx, top: (b.cy - b.ih / 2) * sy, width: b.iw * sx, height: b.ih * sy, cursor: c.id === selectedId ? 'move' : 'pointer', zIndex: 50 - c.lane }}
                    onPointerDown={e => startStageDrag(e, c, 'move')} onContextMenu={e => onGifClipContextMenu(e, c)} onDragStart={e => e.preventDefault()}>
                    {isGifSrc(c.src) ? (
                      <canvas ref={el => { if (el) gifCanvasRefs.current.set(c.id, el); else gifCanvasRefs.current.delete(c.id); }} width={mediaWH(media).w} height={mediaWH(media).h}
                        style={{ width: '100%', height: '100%', objectFit: isScene ? 'cover' : 'contain', display: 'block', transform: c.transform?.flipX ? 'scaleX(-1)' : undefined }} />
                    ) : (
                      <img src={c.src} alt={c.label} draggable={false}
                        style={{ width: '100%', height: '100%', objectFit: isScene ? 'cover' : 'contain', display: 'block', transform: c.transform?.flipX ? 'scaleX(-1)' : undefined }} />
                    )}
                    {c.id === selectedId && <>
                      <div className="am-stage-frame" />
                      <div className="am-stage-rotstem" />
                      <div className="am-stage-handle am-stage-handle-rot" onPointerDown={e => { e.stopPropagation(); startStageDrag(e, c, 'rotate'); }} title="拖动旋转 (Shift 锁 15°)" />
                      <div className="am-stage-handle am-stage-handle-se" onPointerDown={e => { e.stopPropagation(); startStageDrag(e, c, 'scale'); }} title="拖动缩放" />
                    </>}
                  </div>
                );
              })}
              {captionClips.map(c => {
                const tr = c.transform ?? { x: 0, y: 35 };
                const st = c.style ?? 'meme';
                const isEditing = c.id === editingCaptionId;
                // 跟导出 drawCaption 同 1280-conv (capFontSize*W/1280) → 预览所见即导出所得 (修"预览大/导出小"错位)
                const fontPx = (c.fontSize ?? GIF_CAP_FONT) * (fit.w || preset.width) / 1280;
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
                        style={{ fontSize: fontPx, color: col }} />
                    ) : (c.text || '空字幕')}
                  </div>
                );
              })}
              {markerPos && (
                <>
                  <div className="gm-marker-line" style={{ left: markerPos.ax, top: markerPos.ay, width: Math.hypot(markerPos.bx - markerPos.ax, markerPos.by - markerPos.ay), transform: `rotate(${Math.atan2(markerPos.by - markerPos.ay, markerPos.bx - markerPos.ax)}rad)` }} />
                  <div className="am-move-marker am-move-marker-a" style={{ left: markerPos.ax, top: markerPos.ay }} onPointerDown={e => startMarker(e, 'a')} title="起点 A">A</div>
                  <div className="am-move-marker am-move-marker-b" style={{ left: markerPos.bx, top: markerPos.by }} onPointerDown={e => startMarker(e, 'b')} title="目标 B">B</div>
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
                  {group.map(c => (
                    <div key={c.id}
                      className={`am-layer-item am-layer-item-${type}${c.id === selectedId ? ' is-selected' : ''}${layerOverId === c.id ? ' is-drag-over' : ''}`}
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
                        <div className="am-layer-sub">{type === 'image' ? '主体' : '字幕'} · L{c.lane + 1}</div>
                      </div>
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
              <Field label="标签">
                <input className="am-input" value={selImg.label || ''} onChange={e => patchClip(selImg.id, { label: e.target.value })} placeholder="图层标签…" />
              </Field>
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
                  <div className="am-field-sublabel" style={{ padding: '4px 0' }}>🎯 自定义移动 — 画板拖 A / B 点定义往返</div>
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
              <Field label={`字号 · ${Math.round((selCap.fontSize ?? GIF_CAP_FONT) * preset.width / 1280)}px`}>
                <input type="range" min={12} max={Math.round(preset.width * 0.4)} step={1}
                  value={Math.round((selCap.fontSize ?? GIF_CAP_FONT) * preset.width / 1280)} className="am-range"
                  onChange={e => patchClip(selCap.id, { fontSize: Math.round(parseInt(e.target.value) * 1280 / preset.width) })} />
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
            <span className={'gm-tl-loopbadge gm-loop-' + project.loop.mode} title={loopInfo?.hint}>{loopGlyph} {loopInfo?.short}</span>
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
              {lm.kind === 'customMove' && <div className="gm-motionpop-hint">🎯 在画板拖橙色 A·B 两点设置起止位置</div>}
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
          <div className="am-mobile-bottombar am-mobile-bottombar--4" role="tablist">
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
