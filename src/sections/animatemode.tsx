// AnimateMode v5 — 沙雕动画剪辑模式 (完整可用 + 导出 + 全屏预览)
// v5 新增 (vs v4):
//   ✅ 选中框紧贴 image bbox (不再 cover 整个 canvas)
//   ✅ 单击素材也直接添加 (不只是双击)
//   ✅ 预览 canvas 接 onDrop (拖素材到预览也能添加)
//   ✅ VOICE_LIB 重做 - 加 gender + hints array + 命名朴素; pickVoice gender 强匹 + 找不到时强行 pitch 极端模拟
//   ✅ 真 MP4/webm 导出 (MediaRecorder + canvas.captureStream, 自动选最佳 mime)
//   ✅ 全屏预览 modal (大尺寸 canvas + 自动播放 + TTS + Esc 关闭)

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Play, Pause, Mic, Music, Sparkles, Search, Upload, Download,
  Trash2, Eye, Shuffle, Image as ImageIcon, SkipBack,
  SkipForward, X, Settings, Scissors, Copy as CopyIcon,
  ChevronUp, ChevronDown, Undo2, Redo2, Plus, Minus,
  RotateCw, FlipHorizontal, Save, FolderOpen, Move, AlertCircle,
  MessageSquare,
  // v23-b FX/voice icons (替代 emoji)
  Maximize2, Sunrise, Sunset, ArrowRightFromLine, ArrowLeftFromLine,
  ChevronsUp, Zap, Heart, RefreshCw, Tv2, Camera, ZoomIn, ZoomOut,
  Film, DoorOpen, LogOut, Globe, ArrowLeft, ArrowRight, ArrowUp, ArrowDown,
  Vibrate, Type as TypeIcon, ArrowLeftRight, ArrowUpDown, Layers, FileText,
  ImagePlus, AlertTriangle, Folder, Pencil, Check, Keyboard,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { get as idbGet, set as idbSet, del as idbDel } from 'idb-keyval';
import { ALL_PANDAS, ALL_FACES, getLivePandaFaceOffset, type Material } from '@/data/materials';
// v23-d: 内置 SVG scene preset 删除 — 用户嫌 cheesy, 改成纯用户上传 (任意位图/jpg/png/gif)
// import { ANIMATE_SCENES } from '@/data/animateScenes';  // 保留 file 备查, 不再 import
import { composeMeme, flattenAlphaShell } from '@/lib/composeMeme';
import { useMeme, type DraftSlot, type ImageElement, type TextElement, type MemeElement } from '@/context/memecontext';
import { pickRandomText, type Mode as CaptionMode, MODE_LABELS as CAPTION_MODE_LABELS } from '@/data/quickModeTexts';
import { ContextMenu, useContextMenu, type ContextMenuItem } from '@/components/contextmenu';
import { IS_MAC, fmtShortcut, isMetaOrCtrl, matchShortcut, isTypingTarget } from '@/lib/keyboard';
import { ANIMATE_TEMPLATES, type AnimateTemplate } from '@/data/animateTemplates';
import { useIsMobile } from '@/hooks/usemediaquery';
import { showDialog } from '@/components/appdialog';
import './animatemode.css';

// ============================================================
// Types
// ============================================================
type TrackType = 'image' | 'caption' | 'fx' | 'tts' | 'bgm';
// 已有微动效 (作用范围: clip 内部 micro-FX) + 场景运镜 (作用整 clip duration, 大幅 pan/zoom) + 移动 (跨首尾帧 tween)
type ImageFx =
  | 'none'
  // 微动效 (短促入场感)
  | 'shake' | 'zoom' | 'flash' | 'fade-in' | 'fade-out' | 'slide-l' | 'slide-r' | 'bounce' | 'spin' | 'pulse' | 'glitch'
  // 场景运镜 (持续整 clip, 大幅 pan/zoom)
  | 'pan-l' | 'pan-r' | 'pan-u' | 'pan-d' | 'zoom-in' | 'zoom-out' | 'ken-burns'
  // 移动 (lerp clip.transform → clip.endTransform; 首尾帧 tween)
  | 'move';
type AspectId = '16:9' | '9:16' | '1:1';

interface Transform { x: number; y: number; scale: number; rotation: number; flipX: boolean; }
const DEFAULT_TRANSFORM: Transform = { x: 0, y: 0, scale: 1, rotation: 0, flipX: false };

interface BaseClip { id: string; trackId: TrackType; lane: number; start: number; end: number; }
// kind?: 'scene' — 场景背景图 (全屏 cover, 跟普通 image 短边 60% contain 区分)
// endTransform — 'move' 特效用首尾帧 tween. lerp clip.transform → endTransform 按 t/duration
interface ImageClip extends BaseClip { trackId: 'image'; src: string; label: string; caption?: string; fx: ImageFx; transform?: Transform; endTransform?: Transform; kind?: 'scene'; }
interface CaptionTransform { x: number; y: number; }
const DEFAULT_CAPTION_TRANSFORM: CaptionTransform = { x: 0, y: 35 };
// 'meme' = 白字 + 黑描边 (跟编辑器对齐, meme 经典款); 'panel' = 白底黑框; 'bar' = 黑底白字
type CaptionStyle = 'meme' | 'panel' | 'bar';
const DEFAULT_CAPTION_STYLE: CaptionStyle = 'meme';
// v23-k Phase A: entranceFx — 字幕入场动效 (沙雕动画核心, 加入场感)
type CaptionEntranceFx = 'none' | 'fade' | 'pop' | 'slam' | 'typewriter';
interface CaptionClip extends BaseClip { trackId: 'caption'; text: string; fontSize?: number; color?: string; style?: CaptionStyle; transform?: CaptionTransform; linkedTTSId?: string /* v23-e: caption ⇌ tts 1:1 双向 link, caption.start/end/text 改 → tts 自动同步 */; entranceFx?: CaptionEntranceFx; entranceDuration?: number; }
// v23-e: TTSClip + linkedCaptionId (双向 link) + playbackRate (clip 级倍速 0.5-3.0, 优先于 voice 级)
// v23-k: audioDuration (原始 audio 时长, resize 时自动算 rate fit)
interface TTSClip extends BaseClip { trackId: 'tts'; text: string; voice: string; audioSrc?: string; audioDuration?: number; genFailed?: boolean; audioEngine?: 'youdao' | 'baidu'; linkedCaptionId?: string; playbackRate?: number; }
interface BGMClip extends BaseClip { trackId: 'bgm'; bgmId: string; name: string; volume: number; }
// 特效独立轨 — 可绑定到某 image clip 或全局生效 (targetClipId 空)
// 跟 ImageClip.fx 同时存在: FXClip 优先, 旧 image.fx 是 fallback
// v23-h: 'move' 用 startTransform/endTransform · v23-j (phase 2): 其他 FX 也接参数
// strength: 强度 0-3 倍 (默认 1) — shake/flash/pulse/glitch/pan/slide
// zoomFrom/zoomTo: zoom-in/out 起始/结束 scale (默认 1.0/1.25)
// spinTurns: spin 圈数 (默认 1)
// 老 image.fx='move' + image.endTransform 仍兼容渲染 (fallback path)
interface FXClip extends BaseClip {
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
type Clip = ImageClip | CaptionClip | TTSClip | BGMClip | FXClip;
type LaneCount = Record<TrackType, number>;
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
export const GIF_PRESETS: GifPreset[] = [
  { id: 'wechat',      label: '微信表情',     width: 240, height: 240, fps: 12, defaultDuration: 2.5, maxDuration: 3,  note: '微信表情 · ≤500KB · 240×240 · 12fps · 严格' },
  { id: 'moments',     label: '朋友圈/微博',  width: 400, height: 400, fps: 12, defaultDuration: 4,   maxDuration: 5,  note: '朋友圈微博 · ≤2MB · 400×400 · 12fps' },
  { id: 'tg',          label: 'TG 贴纸',      width: 512, height: 512, fps: 24, defaultDuration: 2.5, maxDuration: 3,  note: 'Telegram · ≤256KB · 512×512 · 24fps' },
  { id: 'quick-share', label: '快速分享',     width: 360, height: 360, fps: 15, defaultDuration: 4,   maxDuration: 6,  note: '通用 · ≤1MB · 360×360 · 15fps' },
  { id: 'x',           label: 'X (推特)',     width: 480, height: 480, fps: 18, defaultDuration: 6,   maxDuration: 12, note: 'X/Twitter · ≤15MB · 480×480 · 18fps' },
  { id: 'custom',      label: '自定义',       width: 480, height: 360, fps: 15, defaultDuration: 6,   maxDuration: 15, note: '自由 · 上限 15s · 480×360 · 15fps' },
];
export const GIF_MAX_DURATION = 15; // s, 总上限 (业界 GIF 通常 ≤15s, 微信/Telegram 表情 ≤3s, 见 GIF_PRESETS)
export const GIF_MIN_DURATION = 1;

interface ProjectState {
  clips: Clip[];
  lanes: LaneCount;
  duration: number;
  mode?: ProjectMode;       // 'video' (默认) / 'gif'. optional 兼容旧 project
  gifPresetId?: GifPresetId; // 仅 gif 模式有效
}
interface DragPayload {
  type: TrackType;
  src?: string; label?: string;
  voice?: string; text?: string;
  bgmId?: string; name?: string;
  fx?: ImageFx;
  // image 子类 — 'scene' = 场景背景图 (全屏 cover)
  kind?: 'scene';
  // caption 模板
  captionStyle?: CaptionStyle;
  captionFontSize?: number;
  captionColor?: string;
  defaultDuration?: number;
}
interface VoicePreset {
  id: string;
  name: string;
  desc: string;
  emoji: string;
  icon?: LucideIcon; // v23-b: 优先 icon, emoji 兜底 (兼容老调用点)
  gender: 'male' | 'female';
  lang: 'zh-CN' | 'en-US' | 'en-GB';
  hints: string[];      // 浏览器 SS voice.name 关键字
  azureName: string;    // Microsoft Neural voice name — 配 TTS proxy 用
  source?: 'ss' | 'youdao' | 'baidu'; // 老字段, 保留兼容 (现已无实际意义, 都走云端)
  preferredEngine?: 'youdao' | 'baidu'; // 云端 TTS 优先 engine, 决定听感. 失败自动 fallback 另一个 (除非 noFallback)
  baiduPer?: number;    // baidu 说话人 ID (0=度小美女 1=度小宇男 4=度丫丫萌). 仅 engine=baidu 起效
  noFallback?: boolean; // 严格模式: preferred engine 失败时不 fallback (保证音色一致, 失败时 inspector 显 ❌)
  playbackRate?: number; // audio.playbackRate hack — 让同 engine audio 听感真区分. 默认 1.0
  sampleText: string;   // 试听稿 (短, <10 字)
  fallbackPitch: number; // 找不到匹配 gender 时使用 (并自动校正到极端)
  rate: number;
}
interface BGMPreset {
  id: string;
  name: string;
  mood: string;
  tempo: number;
  notes: number[];
  kind?: 'synth' | 'file'; // synth = Web Audio 合成 (内置 6 首), file = 用户上传 mp3 dataURL
  src?: string;             // file 类才有 — dataURL
  sizeBytes?: number;       // file 类记总占用
  durationSec?: number;     // file 类: 上传时探测的真实时长 (用于设 BGM clip.end)
}
interface AnimateDraftSlot {
  id: string;
  name: string;
  updatedAt: number;
  project: ProjectState;
  note?: string; // 备注 (用户写)
  thumbSrc?: string; // v23-b: 首帧 image src 作缩略图
}

// ============================================================
// Constants
// ============================================================
const TRACK_META: Record<TrackType, { name: string; icon: LucideIcon }> = {
  image:   { name: '画面', icon: ImageIcon },
  caption: { name: '字幕', icon: TypeIcon },
  fx:      { name: '特效', icon: Sparkles },
  tts:     { name: '配音', icon: Mic },
  bgm:     { name: '音乐', icon: Music },
};
const TRACK_ORDER: TrackType[] = ['image', 'caption', 'fx', 'tts', 'bgm'];

// VOICE_LIB v16 — 推翻级诚实化
// 实测真相:
//   - Chrome 中文 SS voice 永远是 Huihui/Yaoyao 女声 (Chromium issue 374263394/331977824)
//   - SpeechSynthesisUtterance.pitch 在中文 voice 上效果近乎 placebo (无差异感)
//   - 真男声/萝莉只有 Edge browser + Yunjian/Xiaoyi Online Natural 才有
// 所以: 中文只留 1 个浏览器试听 (诚实标注 "浏览器原生 · 品质有限"). 真音质走 "📂 上传 mp3".
// 英文浏览器 voice 库男女齐全, 保留 3 个 (听感真有差异)
// 国内可靠免费 TTS engine 只 youdao 一家 (baidu 加 sign 验证, Google 墙, Edge bing 403)
// 中文 voice 全女声 (youdao + 浏览器 SS 都只 female). 真男声需自部署 TTS proxy (见 VoiceDiagBtn)
// v23-b: 精简至中英各 1 — 实测 baidu 中文 / Ryan 英式 听感与主声差异不明显
// 想加回更多 voice → 自部署 edge-tts proxy + setTTSProxyURL (azureName 已保留)
const VOICE_LIB: VoicePreset[] = [
  {
    id: 'zh-youdao',
    name: '中文 · 晓晓',
    desc: '中文女声 · 有道朗读 · 成熟播音腔',
    emoji: '🎙️', // keep emoji for compat (VoicePreset.emoji 字段)
    icon: Mic,
    gender: 'female',
    lang: 'zh-CN',
    hints: [],
    azureName: 'zh-CN-XiaoxiaoNeural',
    source: 'youdao',
    preferredEngine: 'youdao',
    noFallback: false,
    playbackRate: 1.0,
    fallbackPitch: 1.0,
    rate: 1.0,
    sampleText: '家人们都来看看',
  },
  {
    id: 'en-joey',
    name: 'English · Guy',
    desc: '美式男声 · 云端真品质',
    emoji: '🇺🇸',
    icon: Globe,
    gender: 'male',
    lang: 'en-US',
    hints: ['Guy', 'Davis', 'Andrew', 'Brian', 'Mark'],
    azureName: 'en-US-GuyNeural',
    source: 'youdao',
    preferredEngine: 'youdao',
    playbackRate: 1.0,
    fallbackPitch: 1.0,
    rate: 1.02,
    sampleText: 'Yo guys',
  },
];
const VOICE_BY_ID = Object.fromEntries(VOICE_LIB.map(v => [v.id, v])) as Record<string, VoicePreset>;
// TTS 时长估算 — 让 clip width 跟实际朗读时间匹配
// 中文: ≈ 0.26s / 字 (1.0 rate), 英文: ≈ 0.32s / 词
// 抖音/CapCut 实测节奏类似. 留 +0.4s 头尾缓冲, 最少 0.8s 防极短 clip
function estimateTTSDuration(text: string, voiceId: string): number {
  const v = VOICE_BY_ID[resolveVoiceId(voiceId)];
  const playbackRate = v?.playbackRate ?? 1.0;
  const clean = (text || '').trim();
  if (!clean) return 1.2;
  let raw: number;
  if (v?.lang.startsWith('zh')) {
    // 中文按字数 (含标点也算节奏停顿)
    const chars = clean.replace(/\s+/g, '').length;
    raw = chars * 0.26;
  } else {
    // 英文按词数
    const words = clean.split(/\s+/).filter(Boolean).length;
    raw = words * 0.32;
  }
  // playbackRate>1 加速 → 实际墙钟更短
  return Math.max(0.8, Math.min(30, (raw + 0.3) / playbackRate));
}

// fallback: 旧 voice id → 新 id, 防 IDB 旧 project crash
// 中文 voice 全部映射到 zh-youdao (晓晓), 因为国内只 youdao 一家可靠 engine
const LEGACY_VOICE_MAP: Record<string, string> = {
  'zh-xiaoxiao': 'zh-youdao',
  'zh-narrator': 'zh-youdao',
  'zh-yunjian': 'zh-youdao',
  'zh-yunxi': 'zh-youdao',
  'zh-yunyang': 'zh-youdao',
  'zh-xiaohan': 'zh-youdao',
  'zh-xiaoyi': 'zh-youdao',
  'zh-sweet': 'zh-youdao',
  'zh-cutie': 'zh-youdao',
  'zh-loli': 'zh-youdao',
  'zh-female': 'zh-youdao',
  'zh-default': 'zh-youdao',
  'zh-f-standard': 'zh-youdao',
  'zh-m-standard': 'zh-youdao',
  'zh-m-bass': 'zh-youdao',
  'zh-f-loli': 'zh-youdao',
  'zh-m-anchor': 'zh-youdao',
  'zh-robot': 'zh-youdao',
  'zh-baidu-female': 'zh-youdao',
  'zh-baidu-male': 'zh-youdao',
  // 英文 — v23-b 精简: en-storyteller 合并到 en-joey
  'en-jenny': 'en-joey',
  'en-f-jenny': 'en-joey',
  'en-m-joey': 'en-joey',
  'en-m-adam': 'en-joey',
  'en-m-ryan': 'en-joey',
  'en-storyteller': 'en-joey',
  'en-f-sonia': 'en-joey',
};
function resolveVoiceId(id: string): string {
  if (VOICE_BY_ID[id]) return id;
  if (LEGACY_VOICE_MAP[id] && VOICE_BY_ID[LEGACY_VOICE_MAP[id]]) return LEGACY_VOICE_MAP[id];
  return VOICE_LIB[0].id;
}

// ============================================================
// 配音方案 v15 — 现实最优
// ============================================================
// 经过深度调研 (speech.platform.bing.com 全球下线 + 浏览器 native WebSocket 不能
// 设 Sec-WebSocket-Version header, 非 Edge 浏览器无法直连 MS endpoint), 简化为:
//   1. 试听: 浏览器 SS API (秒响, 3 voice 用极端 pitch/rate 区分听感)
//   2. 真 Neural 配音: 引导用户去 TTSMaker.cn 一键生成 mp3 (国内秒通免费, 含
//      zh-CN-Yunjian 等抖音/剪映同款真男声), 然后 "📂 上传 mp3" 写入 audioSrc
//   3. 想自动化? 用户自部署 edge-tts proxy (但本 codebase 不依赖任何 server-side)
const TTSMAKER_URL = 'https://ttsmaker.cn/';

// TTS 服务端中转 endpoint — 统一 /api/tts (一份代码)
//   dev: vite-plugin-tts-proxy (本地 fetch 中转 + CORS)
//   prod: netlify/functions/tts.mts (Netlify Function)
// 浏览器拿 blob → dataURL → 既试听又写 audioSrc → MP4 真音轨
const TTS_PROXY_BASE = '/api/tts';

function youdaoTTSURL(text: string, lang: 'zh' | 'en' = 'zh'): string {
  const params = new URLSearchParams({ engine: 'youdao', text, lang });
  return `${TTS_PROXY_BASE}?${params}`;
}

// 测音频文件真实时长 (秒). HTMLAudioElement.loadedmetadata
// 用于: audioSrc 写入 TTS clip 时自动 align clip.end = start + duration
function getAudioDuration(src: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    audio.preload = 'metadata';
    let settled = false;
    const cleanup = () => { try { audio.src = ''; } catch {} };
    audio.addEventListener('loadedmetadata', () => {
      if (settled) return; settled = true;
      const d = audio.duration;
      cleanup();
      if (Number.isFinite(d) && d > 0) resolve(d);
      else reject(new Error('invalid duration'));
    });
    audio.addEventListener('error', () => {
      if (settled) return; settled = true;
      cleanup();
      reject(new Error('audio load failed'));
    });
    audio.src = src;
    // 超时兜底
    setTimeout(() => {
      if (settled) return; settled = true;
      cleanup();
      reject(new Error('duration probe timeout'));
    }, 8000);
  });
}

// 通过 Netlify Function 中转 fetch TTS → dataURL (可写 audioSrc + 直接播)
// opts.per — baidu 说话人 ID (engine=baidu 时才生效)
async function fetchTTSBlob(text: string, engine: 'youdao' | 'baidu' = 'youdao', lang: 'zh' | 'en' = 'zh', opts: { per?: number } = {}): Promise<string> {
  const params = new URLSearchParams({ engine, text, lang });
  if (engine === 'baidu' && opts.per !== undefined) params.set('per', String(opts.per));
  const url = `${TTS_PROXY_BASE}?${params}`;
  // eslint-disable-next-line no-console
  console.log('[TTS] fetch via Netlify Function:', url);
  const res = await fetch(url);
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Function ${res.status}: ${errText.slice(0, 100)}`);
  }
  const ct = res.headers.get('content-type') || '';
  if (!ct.startsWith('audio')) {
    throw new Error(`非 audio 响应 (${ct})`);
  }
  const blob = await res.blob();
  return await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(new Error('FileReader 失败'));
    r.readAsDataURL(blob);
  });
}

// 有道试听 — 走 Netlify Function 中转 → dataURL → audio.play()
async function playYoudao(text: string, lang: 'zh' | 'en' = 'zh'): Promise<void> {
  const dataUrl = await fetchTTSBlob(text, 'youdao', lang);
  await new Promise<void>((resolve, reject) => {
    const audio = new Audio(dataUrl);
    audio.onended = () => resolve();
    audio.onerror = () => reject(new Error('audio load failed'));
    audio.play().catch(reject);
    setTimeout(() => resolve(), 10000);
  });
}

// 统一 TTS fetch — 用 voice.preferredEngine + voice.baiduPer (baidu 时), 严格 noFallback 时失败不降级
// 所有 fetch (auto-gen / VoiceRow 试听 / Inspector 试听+生成) 都用这个, 保证一致性
async function fetchTTSForVoice(text: string, voice: VoicePreset): Promise<{ dataUrl: string; engine: 'youdao' | 'baidu' }> {
  const lang: 'zh' | 'en' = voice.lang.startsWith('zh') ? 'zh' : 'en';
  const preferred: 'youdao' | 'baidu' = voice.preferredEngine || 'youdao';
  const fallback: 'youdao' | 'baidu' = preferred === 'youdao' ? 'baidu' : 'youdao';
  const perOpts = preferred === 'baidu' && voice.baiduPer !== undefined ? { per: voice.baiduPer } : {};
  try {
    const dataUrl = await fetchTTSBlob(text, preferred, lang, perOpts);
    return { dataUrl, engine: preferred };
  } catch (preferredErr) {
    // eslint-disable-next-line no-console
    console.warn(`[TTS] ${voice.id} ${preferred} 失败:`, (preferredErr as Error).message);
    // 严格模式: noFallback=true 时不降级到另一 engine (保证音色一致)
    if (voice.noFallback) throw preferredErr;
    const fbPerOpts = fallback === 'baidu' && voice.baiduPer !== undefined ? { per: voice.baiduPer } : {};
    const dataUrl = await fetchTTSBlob(text, fallback, lang, fbPerOpts);
    return { dataUrl, engine: fallback };
  }
}

// ============================================================
// TTS HTTP 代理 — 用户自部署 edge-tts 反代 (Cloudflare Worker / Vercel)
// 拿真 Azure Neural Yunjian/Xiaoxiao 男女童声, 国内秒通免费
// ============================================================
let _userTTSProxyURL = '';
export function setTTSProxyURL(url: string) { _userTTSProxyURL = url.trim(); }
export function getTTSProxyURL() { return _userTTSProxyURL; }

const _ttsCache = new Map<string, string>();
const _TTS_CACHE_LIMIT = 60;
function _ttsCacheLRU(key: string, val: string) {
  if (_ttsCache.size >= _TTS_CACHE_LIMIT) {
    const first = _ttsCache.keys().next().value;
    if (first) _ttsCache.delete(first);
  }
  _ttsCache.set(key, val);
}

// fetch HTTP proxy → mp3 dataURL. 兼容多种 proxy URL 格式
async function fetchTTSFromProxy(text: string, azureVoice: string, rate = 0, pitch = 0): Promise<string> {
  if (!_userTTSProxyURL) throw new Error('未配 TTS 代理');
  const cacheKey = `${azureVoice}|${rate}|${pitch}|${text}`;
  const hit = _ttsCache.get(cacheKey);
  if (hit) return hit;
  const base = _userTTSProxyURL.replace(/\/+$/, '');
  // 尝试 POST OpenAI 兼容 (/v1/audio/speech) → 失败试 GET (?text=...&voice=...)
  let blob: Blob | null = null;
  // POST OpenAI 风格
  try {
    const url = base.endsWith('/v1/audio/speech') ? base : `${base}/v1/audio/speech`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'tts-1', input: text, voice: azureVoice, response_format: 'mp3' }),
    });
    if (res.ok && res.headers.get('content-type')?.startsWith('audio')) {
      blob = await res.blob();
    }
  } catch { /* try GET */ }
  // GET 风格
  if (!blob) {
    try {
      const params = new URLSearchParams({ text, voice: azureVoice, voiceName: azureVoice, rate: String(rate), pitch: String(pitch) });
      const url = `${base}${base.includes('?') ? '&' : '?'}${params}`;
      const res = await fetch(url);
      if (res.ok && res.headers.get('content-type')?.startsWith('audio')) {
        blob = await res.blob();
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch (e) {
      throw new Error('代理无效或返回非 audio: ' + (e as Error).message);
    }
  }
  return await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const url = String(r.result || '');
      _ttsCacheLRU(cacheKey, url);
      resolve(url);
    };
    r.onerror = () => reject(new Error('FileReader 失败'));
    r.readAsDataURL(blob!);
  });
}

const BGM_LIB: BGMPreset[] = [
  { id: 'bgm-jigou', name: '机构进场了', mood: '熟悉感 · 沙雕动画神曲', tempo: 0, notes: [],
    kind: 'file', src: '/assets/bgm/jigou-jinchang.mp3' },
  { id: 'bgm-mox',   name: '魔性循环', mood: '洗脑 · 4拍循环', tempo: 140, notes: [0, 3, 5, 7],   kind: 'synth' },
  { id: 'bgm-cool',  name: '装逼专用', mood: 'Drip 慢摇',      tempo: 80,  notes: [0, 3, 7, 10],  kind: 'synth' },
];
const BGM_BY_ID = Object.fromEntries(BGM_LIB.map(b => [b.id, b])) as Record<string, BGMPreset>;
// BGM file 类 mp3 时长缓存 — BGMRow 运行时 lazy 探测后写入, 让 timeline clip 长度对齐
const _bgmDurationCache = new Map<string, number>();
// 找 BGM (内置 + 用户上传)
function resolveBGM(bgmId: string, userBGMs: BGMPreset[] = []): BGMPreset | undefined {
  return BGM_BY_ID[bgmId] || userBGMs.find(b => b.id === bgmId);
}
// 触发 BGM 播放 — 区分 synth/file
function playBGM(b: BGMPreset, volume: number, durationSec: number) {
  if (b.kind === 'file' && b.src) {
    audioEngine.startUserBGM(b.src, volume);
  } else {
    audioEngine.startBGM(b, volume, durationSec);
  }
}

// FX 分 5 类 (参考剪映/CapCut 分类):
//   enter     — 入场动画 (image 出现时), fade-in/zoom/slide/bounce
//   emphasis  — 强调动画 (中间高亮), shake/flash/pulse/spin/glitch
//   exit      — 出场动画, fade-out
//   camera    — 场景运镜, 持续整 clip duration
//   move      — 首尾帧 tween, 用 clip.endTransform 决定终点
type FxGroup = 'enter' | 'emphasis' | 'exit' | 'camera' | 'move';
const FX_LIB: { id: ImageFx; name: string; icon: LucideIcon; desc: string; defaultDuration: number; group: FxGroup }[] = [
  // 入场
  { id: 'zoom',      name: '弹大',     icon: Maximize2,           desc: '从小弹到大入场',     defaultDuration: 0.8, group: 'enter' },
  { id: 'fade-in',   name: '淡入',     icon: Sunrise,             desc: '透明 → 清晰',       defaultDuration: 0.8, group: 'enter' },
  { id: 'slide-l',   name: '左滑入',   icon: ArrowRightFromLine,  desc: '从左边滑入',        defaultDuration: 0.7, group: 'enter' },
  { id: 'slide-r',   name: '右滑入',   icon: ArrowLeftFromLine,   desc: '从右边滑入',        defaultDuration: 0.7, group: 'enter' },
  { id: 'bounce',    name: '弹跳入',   icon: ChevronsUp,          desc: '上下弹跳入场',      defaultDuration: 1.2, group: 'enter' },
  // 强调
  { id: 'shake',     name: '抖动',     icon: Vibrate,             desc: '画面震一震',        defaultDuration: 0.6, group: 'emphasis' },
  { id: 'flash',     name: '闪光',     icon: Zap,                 desc: '高亮闪一下',        defaultDuration: 0.5, group: 'emphasis' },
  { id: 'pulse',     name: '脉冲',     icon: Heart,               desc: '一收一放心跳感',    defaultDuration: 1.2, group: 'emphasis' },
  { id: 'spin',      name: '旋转',     icon: RefreshCw,           desc: '原地转一圈',        defaultDuration: 1.0, group: 'emphasis' },
  { id: 'glitch',    name: '故障',     icon: Tv2,                 desc: '错位闪烁 cyberpunk', defaultDuration: 0.8, group: 'emphasis' },
  // 出场
  { id: 'fade-out',  name: '淡出',     icon: Sunset,              desc: '清晰 → 透明',       defaultDuration: 0.8, group: 'exit' },
  // 场景运镜
  { id: 'pan-l',     name: '镜头·向左', icon: ArrowLeft,           desc: '镜头从右到左缓慢平移', defaultDuration: 3.0, group: 'camera' },
  { id: 'pan-r',     name: '镜头·向右', icon: ArrowRight,          desc: '镜头从左到右缓慢平移', defaultDuration: 3.0, group: 'camera' },
  { id: 'pan-u',     name: '镜头·向上', icon: ArrowUp,             desc: '镜头从下到上缓慢平移', defaultDuration: 3.0, group: 'camera' },
  { id: 'pan-d',     name: '镜头·向下', icon: ArrowDown,           desc: '镜头从上到下缓慢平移', defaultDuration: 3.0, group: 'camera' },
  { id: 'zoom-in',   name: '镜头·推近', icon: ZoomIn,              desc: '镜头持续推近 1.0→1.25x', defaultDuration: 3.0, group: 'camera' },
  { id: 'zoom-out',  name: '镜头·拉远', icon: ZoomOut,             desc: '镜头持续拉远 1.25→1.0x', defaultDuration: 3.0, group: 'camera' },
  { id: 'ken-burns', name: 'Ken Burns', icon: Film,               desc: '推近 + 缓慢平移 (经典纪录片感)', defaultDuration: 4.0, group: 'camera' },
  // 移动 (首尾帧 tween)
  { id: 'move',      name: '移动',     icon: Move,                desc: '首尾帧 tween (右键素材可记录首尾帧)', defaultDuration: 2.0, group: 'move' },
];
const FX_BY_ID = Object.fromEntries(FX_LIB.map(f => [f.id, f])) as Record<ImageFx, typeof FX_LIB[number]>;
const FX_GROUP_META: Record<FxGroup, { label: string; icon: LucideIcon }> = {
  enter:    { label: '入场',    icon: DoorOpen },
  emphasis: { label: '强调',    icon: Sparkles },
  exit:     { label: '出场',    icon: LogOut },
  camera:   { label: '运镜',    icon: Camera },
  move:     { label: '移动',    icon: Move },
};
const FX_LABEL: Record<ImageFx, string> = {
  none: '无', shake: '抖动', zoom: '弹大', flash: '闪光',
  'fade-in': '淡入', 'fade-out': '淡出', 'slide-l': '左滑入', 'slide-r': '右滑入',
  bounce: '弹跳', spin: '旋转', pulse: '脉冲', glitch: '故障',
  'pan-l': '镜头·向左', 'pan-r': '镜头·向右', 'pan-u': '镜头·向上', 'pan-d': '镜头·向下',
  'zoom-in': '镜头·推近', 'zoom-out': '镜头·拉远', 'ken-burns': 'Ken Burns',
  move: '移动',
};

// v23-d: 场景库 — 实拍位图 (Lorem Picsum stable seed, fastly CDN 全球, CORS open)
// img.crossOrigin='anonymous' 已 set, 可用于 canvas 合成 + MP4 export
// 同 seed 永远同图. 1280x720 = sl1 cover ratio.
// 加载失败时 onerror 占位 — fallback 引导用户去外部图源 (unsplash/pixabay/pexels) 上传
const PICSUM = (seed: string) => `https://picsum.photos/seed/${seed}/1280/720`;
const SCENE_LIB: Material[] = [
  { id: 'scene-city',    src: PICSUM('city18'),     labelCn: '城市',     labelEn: 'City',     tags: ['场景', '城市', '街道'], tagsEn: ['scene', 'city'], faceOffset: { x: 0, y: 0, w: 0, h: 0 }, kind: 'scene' },
  { id: 'scene-mountain', src: PICSUM('mountain7'), labelCn: '山林',     labelEn: 'Mountain', tags: ['场景', '山', '自然'],   tagsEn: ['scene', 'mountain'], faceOffset: { x: 0, y: 0, w: 0, h: 0 }, kind: 'scene' },
  { id: 'scene-beach',   src: PICSUM('beach22'),   labelCn: '海滩',     labelEn: 'Beach',    tags: ['场景', '海', '海滩'],   tagsEn: ['scene', 'beach'], faceOffset: { x: 0, y: 0, w: 0, h: 0 }, kind: 'scene' },
  { id: 'scene-forest',  src: PICSUM('forest11'),  labelCn: '森林',     labelEn: 'Forest',   tags: ['场景', '森林', '树'],   tagsEn: ['scene', 'forest'], faceOffset: { x: 0, y: 0, w: 0, h: 0 }, kind: 'scene' },
  { id: 'scene-room',    src: PICSUM('room33'),    labelCn: '房间',     labelEn: 'Room',     tags: ['场景', '室内', '房间'], tagsEn: ['scene', 'room'], faceOffset: { x: 0, y: 0, w: 0, h: 0 }, kind: 'scene' },
  { id: 'scene-street',  src: PICSUM('street55'),  labelCn: '街道',     labelEn: 'Street',   tags: ['场景', '街道', '都市'], tagsEn: ['scene', 'street'], faceOffset: { x: 0, y: 0, w: 0, h: 0 }, kind: 'scene' },
  { id: 'scene-sky',     src: PICSUM('sky88'),     labelCn: '天空',     labelEn: 'Sky',      tags: ['场景', '天空', '云'],   tagsEn: ['scene', 'sky'], faceOffset: { x: 0, y: 0, w: 0, h: 0 }, kind: 'scene' },
  { id: 'scene-sunset',  src: PICSUM('sunset44'),  labelCn: '日落',     labelEn: 'Sunset',   tags: ['场景', '日落', '黄昏'], tagsEn: ['scene', 'sunset'], faceOffset: { x: 0, y: 0, w: 0, h: 0 }, kind: 'scene' },
  { id: 'scene-night',   src: PICSUM('night77'),   labelCn: '夜景',     labelEn: 'Night',    tags: ['场景', '夜', '霓虹'],   tagsEn: ['scene', 'night'], faceOffset: { x: 0, y: 0, w: 0, h: 0 }, kind: 'scene' },
  { id: 'scene-snow',    src: PICSUM('snow99'),    labelCn: '雪景',     labelEn: 'Snow',     tags: ['场景', '雪', '冬'],     tagsEn: ['scene', 'snow'], faceOffset: { x: 0, y: 0, w: 0, h: 0 }, kind: 'scene' },
  { id: 'scene-desert',  src: PICSUM('desert12'),  labelCn: '沙漠',     labelEn: 'Desert',   tags: ['场景', '沙漠'],         tagsEn: ['scene', 'desert'], faceOffset: { x: 0, y: 0, w: 0, h: 0 }, kind: 'scene' },
  { id: 'scene-cafe',    src: PICSUM('cafe66'),    labelCn: '咖啡馆',   labelEn: 'Cafe',     tags: ['场景', '咖啡馆', '室内'], tagsEn: ['scene', 'cafe'], faceOffset: { x: 0, y: 0, w: 0, h: 0 }, kind: 'scene' },
];

const SNAP_PX = 8;
const LANE_ROW_H = 44;
const RULER_H = 24;
const HISTORY_MAX = 50;
const AM_DRAFT_IDB_KEY = 'xiongmaotou.animate-drafts.v1';
const AM_DRAFT_MAX = 10;
// 当前 project 自动持久化 — 切走/刷新不丢操作
// v24: 双缓存 — video / gif 各自一份 IDB 记录, 切 mode 不互相破坏.
// AM_CURRENT_IDB_KEY 是 v23-l 之前的单 key, 仍读它做一次性迁移.
const AM_CURRENT_IDB_KEY = 'xiongmaotou.animate-current.v1';
const AM_VIDEO_CURRENT_IDB_KEY = 'xiongmaotou.animate-current.video.v1';
const AM_GIF_CURRENT_IDB_KEY = 'xiongmaotou.animate-current.gif.v1';
function getCurrentIdbKey(mode: ProjectMode | undefined): string {
  return mode === 'gif' ? AM_GIF_CURRENT_IDB_KEY : AM_VIDEO_CURRENT_IDB_KEY;
}
const AM_UPLOADS_IDB_KEY = 'xiongmaotou.animate-uploads.v1';
// v23-b: 大幅放宽 — IDB 单库容量浏览器普遍 >1GB, 不写服务器
// 限制只是防 base64 dataURL 内存爆炸 (单图 30MB → dataURL ≈ 40MB string)
const AM_UPLOAD_MAX_COUNT = 200;                       // 200 张 (上：80)
const AM_UPLOAD_MAX_BYTES = 500 * 1024 * 1024;         // 总 500 MB (上：80MB)
const AM_UPLOAD_MAX_DIM = 4096;                        // 4K (上：2000px)
const AM_UPLOAD_MAX_FILE_BYTES = 30 * 1024 * 1024;     // 单图 30 MB (上：5MB) — 容纳高 res 照片/gif
const AM_TRACK_ORDER_IDB_KEY = 'xiongmaotou.animate-track-order.v1';
// TTS HTTP 代理 URL — bing endpoint 全球 403 下线, 真男声只能走自部署代理 (Cloudflare Worker)
const AM_TTS_PROXY_IDB_KEY = 'xiongmaotou.animate-tts-proxy.v2';
// 用户上传 BGM (mp3/wav dataURL) 持久化
const AM_USER_BGMS_IDB_KEY = 'xiongmaotou.animate-user-bgms.v1';
const AM_USER_BGM_MAX_COUNT = 30;                      // 30 首 (上：10)
const AM_USER_BGM_MAX_FILE_BYTES = 30 * 1024 * 1024;   // 单首 30 MB (上：5MB) — 容纳无损 mp3
const AM_USER_BGM_MAX_TOTAL_BYTES = 200 * 1024 * 1024; // 总 200 MB (上：30MB)

// gender 关键字 (用 voice.name 推断 voice 实际性别)
const MALE_RE = /\b(male|man|guy|kang|yun|jian|davis|brandon|adam|joey|ryan|mark|alex|brian|daniel|andrew|oliver|aaron)\b/i;
const FEMALE_RE = /\b(female|woman|girl|jenny|aria|samantha|karen|allison|sonia|libby|kate|jessie|huihui|yaoyao|xiao|mei|tian|tingting|tracy|hanhan)\b/i;

function inferVoiceGender(av?: SpeechSynthesisVoice | null): 'male' | 'female' | 'unknown' {
  if (!av) return 'unknown';
  if (MALE_RE.test(av.name)) return 'male';
  if (FEMALE_RE.test(av.name)) return 'female';
  return 'unknown';
}

// ============================================================
// Audio Engine v8 — TTS gender 校正 + BGM Web Audio 真合成
// ============================================================
const audioEngine = (() => {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return {
      speak: (_t: string, _v: VoicePreset, _o?: { volume?: number }) => null as SpeechSynthesisUtterance | null,
      cancel: () => {},
      previewVoice: (_v: VoicePreset) => null as SpeechSynthesisUtterance | null,
      startBGM: (_b: BGMPreset, _vol?: number, _dur?: number) => {},
      stopBGM: () => {},
      cancelAll: () => {},
      ready: () => false,
      getDiagnostics: () => ({ count: 0, sample: [] as string[] }),
      startExportCapture: () => null as MediaStream | null,
      stopExportCapture: () => {},
      startUserBGM: (_src: string, _vol?: number) => {},
      playTTSAudio: (_src: string, _vol?: number, _pr?: number) => {},
      destroyAll: () => {},
      syncTTSPlayer: (_id: string, _src: string, _ph: number, _cs: number, _ip: boolean, _v?: number, _pr?: number) => {},
      preloadTTSAudios: async (_clips: { id: string; audioSrc?: string }[]) => {},
      stopAllTTSAudio: () => {},
      destroyAllTTSPlayers: () => {},
      syncUserBGMPlayer: (_id: string, _src: string, _ph: number, _cs: number, _ip: boolean, _v?: number) => {},
      preloadUserBGMs: async (_clips: { id: string; src?: string }[]) => {},
      stopAllUserBGM: () => {},
      destroyAllUserBGMPlayers: () => {},
    };
  }
  let voicesCache: SpeechSynthesisVoice[] | null = null;
  const synth = window.speechSynthesis;
  function getVoices(): SpeechSynthesisVoice[] {
    if (voicesCache && voicesCache.length > 0) return voicesCache;
    voicesCache = synth.getVoices() || [];
    return voicesCache;
  }
  synth.onvoiceschanged = () => { voicesCache = synth.getVoices(); };

  // ===== BGM Web Audio Engine =====
  let _ac: AudioContext | null = null;
  let bgmActive: { master: GainNode; stopAt: number } | null = null;
  // 导出录制时: 创建 MediaStreamDestination, BGM master 同时 connect 到这里 → 录到 MP4
  // TTS (SpeechSynthesis) 无法路由 AudioContext, 是浏览器 spec 限制 — 妥协: 渲染时把 TTS 文字烧录成字幕 (见 drawFrame)
  let exportDest: MediaStreamAudioDestinationNode | null = null;
  function getAC(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    type WindowWithWebkit = Window & { webkitAudioContext?: typeof AudioContext };
    const AC = window.AudioContext || (window as WindowWithWebkit).webkitAudioContext;
    if (!AC) return null;
    if (!_ac) _ac = new AC();
    if (_ac.state === 'suspended') _ac.resume().catch(() => {});
    return _ac;
  }
  function startExportCapture(): MediaStream | null {
    const ac = getAC();
    if (!ac) return null;
    if (!exportDest) {
      try { exportDest = ac.createMediaStreamDestination(); } catch { return null; }
    }
    return exportDest?.stream ?? null;
  }
  function stopExportCapture() {
    if (exportDest) {
      try { exportDest.disconnect(); } catch {}
      exportDest = null;
    }
  }
  function startBGM(bgmCfg: BGMPreset, volume = 0.5, durationSec = 5) {
    // FIX BGM 越累越大: 必须停所有 BGM source (synth + user file), 不能只停一种
    stopBGM();
    stopUserBGM();
    const ac = getAC();
    if (!ac) return;
    const master = ac.createGain();
    master.gain.value = Math.max(0, Math.min(1, volume)) * 0.18;
    master.connect(ac.destination);
    // 导出录制中: 同时 connect 到 MediaStreamDestination, 让 MediaRecorder 抓到 BGM
    if (exportDest) {
      try { master.connect(exportDest); } catch {}
    }
    const bpm = bgmCfg.tempo || 120;
    const beatSec = 60 / bpm;
    const notes = bgmCfg.notes || [0, 3, 5, 7];
    const rootHz = 220;
    const semitone = (n: number) => rootHz * Math.pow(2, n / 12);
    const startAt = ac.currentTime + 0.02;
    const endAt = startAt + durationSec;
    const waves: OscillatorType[] = ['sine', 'triangle', 'sawtooth', 'square'];
    const waveType: OscillatorType = waves[(bgmCfg.id.length || 0) % 4];
    let t = startAt;
    let i = 0;
    while (t < endAt) {
      const n = notes[i % notes.length];
      const freq = semitone(n);
      const dur = beatSec * 0.9;
      const o = ac.createOscillator();
      o.type = waveType;
      o.frequency.value = freq;
      const g = ac.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.5, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(master);
      o.start(t);
      o.stop(t + dur + 0.05);
      if (i % 2 === 0) {
        const ob = ac.createOscillator();
        ob.type = 'sine';
        ob.frequency.value = freq / 2;
        const gb = ac.createGain();
        gb.gain.setValueAtTime(0, t);
        gb.gain.linearRampToValueAtTime(0.4, t + 0.05);
        gb.gain.exponentialRampToValueAtTime(0.0001, t + beatSec * 1.6);
        ob.connect(gb).connect(master);
        ob.start(t);
        ob.stop(t + beatSec * 1.7);
      }
      t += beatSec;
      i++;
    }
    bgmActive = { master, stopAt: endAt };
  }
  function stopBGM() {
    if (!bgmActive || !_ac) { bgmActive = null; return; }
    try {
      const { master } = bgmActive;
      master.gain.cancelScheduledValues(_ac.currentTime);
      master.gain.linearRampToValueAtTime(0, _ac.currentTime + 0.06);
      setTimeout(() => { try { master.disconnect(); } catch {} }, 100);
    } catch {}
    bgmActive = null;
  }
  // 用户上传的 BGM (mp3/wav) — 真 sync 模式 (跟 TTS 一致)
  // 类似 TTSPlayer: 一个 BGMPlayer per clip.id, audio.currentTime = playhead - clip.start
  // 让时间轴拖到中段听对应位置 (不再每次播都从头), 导出 MP4 也按位置录
  interface UserBGMPlayer {
    audio: HTMLAudioElement;
    source: MediaElementAudioSourceNode | null;
    gain: GainNode | null;
    src: string;
    connectedExportDests: Set<MediaStreamAudioDestinationNode>;
  }
  const _userBGMPlayers = new Map<string, UserBGMPlayer>();

  function _ensureUserBGMPlayer(clipId: string, src: string, volume = 0.6): UserBGMPlayer | null {
    const ac = getAC();
    if (!ac) return null;
    if (ac.state === 'suspended') ac.resume().catch(() => {});
    let p = _userBGMPlayers.get(clipId);
    if (p && p.src !== src) {
      try { p.audio.pause(); p.audio.src = ''; } catch {}
      try { p.source?.disconnect(); p.gain?.disconnect(); } catch {}
      _userBGMPlayers.delete(clipId);
      p = undefined;
    }
    if (!p) {
      try {
        const audio = new Audio(src);
        audio.preload = 'auto';
        audio.loop = false; // 跟 sync 模式: 不 loop, 让 clip 长度决定播放范围
        const source = ac.createMediaElementSource(audio);
        const gain = ac.createGain();
        gain.gain.value = Math.max(0, Math.min(1, volume));
        source.connect(gain);
        gain.connect(ac.destination);
        p = { audio, source, gain, src, connectedExportDests: new Set() };
        _userBGMPlayers.set(clipId, p);
        try { audio.load(); } catch {}
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[UserBGMPlayer] init failed', e);
        return null;
      }
    } else if (p.gain) {
      p.gain.gain.value = Math.max(0, Math.min(1, volume));
    }
    if (exportDest && p.gain && !p.connectedExportDests.has(exportDest)) {
      try {
        p.gain.connect(exportDest);
        p.connectedExportDests.add(exportDest);
      } catch {}
    }
    return p;
  }

  // sync BGM 到 playhead — 跟 syncTTSPlayer 同套机制
  function syncUserBGMPlayer(clipId: string, src: string, playhead: number, clipStart: number, isPlaying: boolean, volume = 0.6): void {
    const p = _ensureUserBGMPlayer(clipId, src, volume);
    if (!p) return;
    const local = playhead - clipStart;
    const duration = isFinite(p.audio.duration) ? p.audio.duration : Infinity;
    if (local < 0 || local > duration) {
      if (!p.audio.paused) {
        try { p.audio.pause(); } catch {}
      }
      return;
    }
    const drift = Math.abs(p.audio.currentTime - local);
    if (drift > 0.2) {
      try { p.audio.currentTime = local; } catch {}
    }
    if (isPlaying) {
      if (p.audio.paused) p.audio.play().catch(() => {});
    } else {
      if (!p.audio.paused) {
        try { p.audio.pause(); } catch {}
      }
    }
  }

  async function preloadUserBGMs(clips: { id: string; src?: string }[]): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const c of clips) {
      if (!c.src) continue;
      const p = _ensureUserBGMPlayer(c.id, c.src);
      if (!p) continue;
      const audio = p.audio;
      if (audio.readyState >= 4) continue;
      promises.push(new Promise<void>((resolve) => {
        let settled = false;
        const done = () => { if (!settled) { settled = true; resolve(); } };
        audio.addEventListener('canplaythrough', done, { once: true });
        audio.addEventListener('loadeddata', done, { once: true });
        audio.addEventListener('error', done, { once: true });
        setTimeout(done, 5000);
        try { audio.load(); } catch { done(); }
      }));
    }
    await Promise.all(promises);
  }

  function stopAllUserBGM(): void {
    for (const p of _userBGMPlayers.values()) {
      try { p.audio.pause(); } catch {}
    }
  }

  function destroyAllUserBGMPlayers(): void {
    for (const p of _userBGMPlayers.values()) {
      try { p.audio.pause(); p.audio.src = ''; } catch {}
      try { p.source?.disconnect(); p.gain?.disconnect(); } catch {}
    }
    _userBGMPlayers.clear();
  }

  // 兼容老 API: startUserBGM (现已只用于 LeftPane 试听一次性 — 试听场景接受 loop 触发)
  let userBgmEl: HTMLAudioElement | null = null;
  let userBgmGain: GainNode | null = null;
  function startUserBGM(src: string, volume = 0.6) {
    stopBGM();
    stopUserBGM();
    const ac = getAC();
    if (!ac) return;
    try {
      const audio = new Audio(src);
      const node = ac.createMediaElementSource(audio);
      const gain = ac.createGain();
      gain.gain.value = Math.max(0, Math.min(1, volume));
      node.connect(gain);
      gain.connect(ac.destination);
      if (exportDest) gain.connect(exportDest);
      audio.play().catch(() => {});
      userBgmEl = audio;
      userBgmGain = gain;
    } catch (e) {
      console.warn('[userBGM] failed', e);
    }
  }
  function stopUserBGM() {
    if (userBgmEl) {
      try { userBgmEl.pause(); userBgmEl.src = ''; } catch {}
      userBgmEl = null;
    }
    if (userBgmGain) {
      try { userBgmGain.disconnect(); } catch {}
      userBgmGain = null;
    }
    stopAllUserBGM();
  }
  // ============================================================
  // TTS Player — audio 跟时间轴 playhead 严格同步 (剪映/CapCut 真专业模式)
  // 不再 "触发一次" 模式; audio.currentTime 主动跟 playhead - clip.start 对齐
  // 让 1-5s 配音, 用户 2s 听就是第 2s 那段字 (不是从头)
  // ============================================================
  interface TTSPlayer {
    audio: HTMLAudioElement;
    source: MediaElementAudioSourceNode | null;
    gain: GainNode | null;
    src: string;
    connectedExportDests: Set<MediaStreamAudioDestinationNode>;
  }
  const _ttsPlayers = new Map<string, TTSPlayer>(); // key: clip.id

  function _ensureTTSPlayer(clipId: string, src: string, volume = 1.0, playbackRate = 1.0): TTSPlayer | null {
    const ac = getAC();
    if (!ac) return null;
    if (ac.state === 'suspended') ac.resume().catch(() => {});
    let p = _ttsPlayers.get(clipId);
    if (p && p.src !== src) {
      // src 变了, 销毁旧 player
      try { p.audio.pause(); p.audio.src = ''; } catch {}
      try { p.source?.disconnect(); p.gain?.disconnect(); } catch {}
      _ttsPlayers.delete(clipId);
      p = undefined;
    }
    if (!p) {
      try {
        const audio = new Audio(src);
        audio.preload = 'auto';
        audio.playbackRate = playbackRate;
        const source = ac.createMediaElementSource(audio);
        const gain = ac.createGain();
        gain.gain.value = Math.max(0, Math.min(1, volume));
        source.connect(gain);
        gain.connect(ac.destination);
        p = { audio, source, gain, src, connectedExportDests: new Set() };
        _ttsPlayers.set(clipId, p);
        // 强制 load + decode
        try { audio.load(); } catch {}
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[TTSPlayer] init failed', e);
        return null;
      }
    } else {
      // 复用旧 player: 同步 volume + playbackRate (voice 配置可能变)
      if (p.gain) p.gain.gain.value = Math.max(0, Math.min(1, volume));
      if (p.audio.playbackRate !== playbackRate) p.audio.playbackRate = playbackRate;
    }
    // 接入 exportDest (如果当前在导出中, exportDest 已建)
    if (exportDest && p.gain && !p.connectedExportDests.has(exportDest)) {
      try {
        p.gain.connect(exportDest);
        p.connectedExportDests.add(exportDest);
      } catch {}
    }
    return p;
  }

  // 关键: 把 audio 同步到 playhead. 调用频率 = 每 transport frame
  // playhead 在 clip 范围内 + isPlaying → audio.play() + currentTime 校正
  // 离开 clip 范围 → audio.pause()
  // playbackRate: audio 以 rate 速度播放原始内容. 墙钟 1s = audio 内部 rate 秒
  //   audio.currentTime (原始时间) = (playhead - clipStart 墙钟) * rate
  function syncTTSPlayer(clipId: string, src: string, playhead: number, clipStart: number, isPlaying: boolean, volume = 1.0, playbackRate = 1.0): void {
    const p = _ensureTTSPlayer(clipId, src, volume, playbackRate);
    if (!p) return;
    // 墙钟 → audio 原始时间映射 (rate=1.18 时, 墙钟 1s 对应 audio 内部 1.18s)
    const local = (playhead - clipStart) * playbackRate;
    const duration = isFinite(p.audio.duration) ? p.audio.duration : Infinity;
    // 超出 audio 时长 / clip 前 → pause
    if (local < 0 || local > duration) {
      if (!p.audio.paused) {
        try { p.audio.pause(); } catch {}
      }
      return;
    }
    // 在范围内
    // drift > 150ms 才 seek (避免每 frame 都 seek 卡顿)
    const drift = Math.abs(p.audio.currentTime - local);
    if (drift > 0.15) {
      try { p.audio.currentTime = local; } catch {}
    }
    if (isPlaying) {
      if (p.audio.paused) {
        p.audio.play().catch(() => {});
      }
    } else {
      if (!p.audio.paused) {
        try { p.audio.pause(); } catch {}
      }
    }
  }

  // 导出前 preload — 确保 audio decode 完, 录制时立刻有数据
  async function preloadTTSAudios(clips: { id: string; audioSrc?: string }[]): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const c of clips) {
      if (!c.audioSrc) continue;
      const p = _ensureTTSPlayer(c.id, c.audioSrc);
      if (!p) continue;
      const audio = p.audio;
      if (audio.readyState >= 4) continue; // already canplaythrough
      promises.push(new Promise<void>((resolve) => {
        let settled = false;
        const done = () => { if (!settled) { settled = true; resolve(); } };
        audio.addEventListener('canplaythrough', done, { once: true });
        audio.addEventListener('error', done, { once: true });
        audio.addEventListener('loadeddata', done, { once: true });
        setTimeout(done, 5000);
        try { audio.load(); } catch { done(); }
      }));
    }
    await Promise.all(promises);
  }

  // 停所有 TTS audio (preview 暂停 / seek / cancelAll)
  function stopAllTTSAudio(): void {
    for (const p of _ttsPlayers.values()) {
      try { p.audio.pause(); } catch {}
    }
  }
  // 完全销毁 TTS players (项目变 / cancelAll 时调)
  function destroyAllTTSPlayers(): void {
    for (const p of _ttsPlayers.values()) {
      try { p.audio.pause(); p.audio.src = ''; } catch {}
      try { p.source?.disconnect(); p.gain?.disconnect(); } catch {}
    }
    _ttsPlayers.clear();
  }

  // 试听单次播放的 audio Set — 防 cleanup 漏掉 (之前 audio 不进任何 Map → 切板块后还在响)
  const _previewAudios = new Set<HTMLAudioElement>();
  function stopAllPreviewAudios(): void {
    for (const a of _previewAudios) {
      try { a.pause(); a.src = ''; a.load(); } catch {}
    }
    _previewAudios.clear();
  }
  function playTTSAudio(src: string, volume = 1.0, playbackRate = 1.0): void {
    const ac = getAC();
    if (!ac) return;
    if (ac.state === 'suspended') ac.resume().catch(() => {});
    try {
      const audio = new Audio(src);
      audio.playbackRate = playbackRate;
      _previewAudios.add(audio);
      const node = ac.createMediaElementSource(audio);
      const gain = ac.createGain();
      gain.gain.value = Math.max(0, Math.min(1, volume));
      node.connect(gain);
      gain.connect(ac.destination);
      if (exportDest) gain.connect(exportDest);
      audio.play().catch(() => {});
      const cleanup = () => {
        _previewAudios.delete(audio);
        try { node.disconnect(); gain.disconnect(); } catch {}
      };
      audio.addEventListener('ended', cleanup, { once: true });
      audio.addEventListener('error', cleanup, { once: true });
    } catch (e) {
      console.warn('[ttsAudio] failed', e);
    }
  }
  // patch stopBGM 同时 stop user bgm + tts audio
  const _origStopBGM = stopBGM;
  function _stopAllBGM() { _origStopBGM(); stopUserBGM(); }
  function cancelAll() {
    try { synth.cancel(); } catch {}
    _stopAllBGM();
    stopAllTTSAudio();
    stopAllUserBGM();
    stopAllPreviewAudios();
  }
  function destroyAll() {
    cancelAll();
    destroyAllTTSPlayers();
    destroyAllUserBGMPlayers();
  }

  function pickVoice(v: VoicePreset): SpeechSynthesisVoice | null {
    const all = getVoices();
    if (all.length === 0) return null;
    const langFull = all.filter(av => av.lang === v.lang);
    const langPrefix = all.filter(av => av.lang.toLowerCase().startsWith(v.lang.slice(0, 2)));
    const pool = langFull.length ? langFull : (langPrefix.length ? langPrefix : all);

    // 1. hints 精确匹配 (Edge Neural Yunjian / Yunyang 优先) — 中文男声关键
    for (const hint of v.hints) {
      const hit = pool.find(av => new RegExp(hint, 'i').test(av.name));
      if (hit) return hit;
    }
    // 2. **激进性别匹配** — 找含明确男/女声关键字的 voice
    const sameGender = pool.find(av =>
      v.gender === 'male' ? MALE_RE.test(av.name) : FEMALE_RE.test(av.name)
    );
    if (sameGender) return sameGender;
    // 3. 男声 fallback — 中文环境优先找含 Yun/Kang/Jian 等 prefix 的 voice
    if (v.gender === 'male' && v.lang.startsWith('zh')) {
      const maleFallback = pool.find(av => /\b(Yun|Kang|Hao|Jian|Yang|Xi|Feng)/i.test(av.name));
      if (maleFallback) return maleFallback;
    }
    // 4. fallback 同 lang 第一个
    return pool[0] || all[0] || null;
  }

  function speak(text: string, v: VoicePreset, opts: { volume?: number } = {}): SpeechSynthesisUtterance | null {
    if (!text) return null;
    // 等 voices 加载 — onvoiceschanged 异步, mount 时立刻 speak 可能 getVoices 返空 → 男声匹配失败
    const allVoices = synth.getVoices();
    if (allVoices.length === 0) {
      // 延 200ms retry, 给 onvoiceschanged 触发时间
      // eslint-disable-next-line no-console
      console.warn('[SS] voices 未加载, 200ms 后 retry');
      setTimeout(() => speak(text, v, opts), 200);
      return null;
    }
    try { synth.cancel(); } catch {}
    const u = new SpeechSynthesisUtterance(text);
    const chosen = pickVoice(v);
    // eslint-disable-next-line no-console
    console.log(`[SS] speak "${text.slice(0, 20)}" voice="${chosen?.name ?? 'default'}" preset=${v.id} (${v.gender})`);
    if (chosen) u.voice = chosen;
    u.lang = v.lang;

    // gender 校正: 如果选到的 voice 性别跟 preset 不符, 用极端 pitch 模拟
    const actualGender = inferVoiceGender(chosen);
    let pitch = v.fallbackPitch;
    if (v.gender === 'male' && actualGender !== 'male') {
      // 浏览器只能给女声, 强行 极端 压低 (0.3 是 SS 实测的"明显男声化"阈值)
      pitch = 0.3;
      // eslint-disable-next-line no-console
      console.warn(`[SS] ${v.name} 想要男声但 SS 给的是 "${chosen?.name}", 强压 pitch 0.3 模拟. 真男声请用 🎙 录音 / 📂 上传 mp3`);
    } else if (v.gender === 'female' && actualGender !== 'female') {
      pitch = 1.7;
    }
    u.pitch = Math.max(0, Math.min(2, pitch));
    u.rate = Math.max(0.1, Math.min(2, v.rate));
    u.volume = opts.volume ?? 1;
    try { synth.speak(u); } catch {}
    return u;
  }

  function cancel() { try { synth.cancel(); } catch {} }
  function previewVoice(v: VoicePreset): SpeechSynthesisUtterance | null {
    // 试听稿 = sampleText (<10 字), 快速听音色不啰嗦
    return speak(v.sampleText || (v.lang.startsWith('zh') ? '你好' : 'Hi'), v);
  }
  function getDiagnostics() {
    const all = getVoices();
    return { count: all.length, sample: all.slice(0, 5).map(av => `${av.name} (${av.lang})`) };
  }
  return {
    speak, cancel, previewVoice,
    startBGM, stopBGM: _stopAllBGM, cancelAll, destroyAll,
    ready: () => getVoices().length > 0, getDiagnostics,
    startExportCapture, stopExportCapture,
    startUserBGM, playTTSAudio,
    // 新 API: TTS 跟时间轴严格同步
    syncTTSPlayer, preloadTTSAudios, stopAllTTSAudio, destroyAllTTSPlayers,
    // 新 API: BGM (用户上传 mp3) 跟时间轴严格同步 (跟 TTS 同套机制)
    syncUserBGMPlayer, preloadUserBGMs, stopAllUserBGM, destroyAllUserBGMPlayers,
  };
})();

// ============================================================
// Initial Project
// ============================================================
// 完全空白 project — "新建" 时用, 用户从 0 开始
function makeBlankProject(): ProjectState {
  return {
    duration: 12,
    mode: 'video',
    lanes: { image: 1, caption: 1, fx: 1, tts: 1, bgm: 1 },
    clips: [],
  };
}

// v23-l: 统一反序列化 — 旧 project 没 mode/gifPresetId 字段默认 video. 任何 raw → ProjectState 都过这.
// 含 v9 blob: URL 失效 image clip 自动清逻辑.
function hydrateProject(raw: unknown): { project: ProjectState; cleanedInvalidImages: number } | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<ProjectState>;
  if (!Array.isArray(r.clips) || typeof r.duration !== 'number') return null;
  const before = r.clips.length;
  const cleanClips = r.clips.filter(c =>
    !(c.trackId === 'image' && typeof (c as ImageClip).src === 'string' && (c as ImageClip).src.startsWith('blob:'))
  );
  const project: ProjectState = {
    duration: r.duration,
    clips: cleanClips,
    lanes: {
      image: r.lanes?.image ?? 1,
      caption: r.lanes?.caption ?? 1,
      fx: r.lanes?.fx ?? 1,
      tts: r.lanes?.tts ?? 1,
      bgm: r.lanes?.bgm ?? 1,
    },
    mode: r.mode === 'gif' ? 'gif' : 'video',
    // v24: gif mode 时 gifPresetId 必须有 (ExportModal 等下游依赖). 老 project 没字段时兜底 'wechat'.
    gifPresetId: r.mode === 'gif' ? (r.gifPresetId ?? 'wechat') : r.gifPresetId,
  };
  return { project, cleanedInvalidImages: before - cleanClips.length };
}

function makeInitialProject(): ProjectState {
  const pickPanda = (i: number) => ALL_PANDAS[i % ALL_PANDAS.length];
  const dur = 12;
  return {
    duration: dur,
    mode: 'video',
    lanes: { image: 1, caption: 1, fx: 1, tts: 1, bgm: 1 },
    clips: [
      { id: 'c1', trackId: 'image', lane: 0, start: 0,  end: 3,  src: pickPanda(7).src,  label: pickPanda(7).labelCn,  fx: 'none', transform: { ...DEFAULT_TRANSFORM } },
      { id: 'c2', trackId: 'image', lane: 0, start: 3,  end: 6,  src: pickPanda(13).src, label: pickPanda(13).labelCn, fx: 'shake', transform: { ...DEFAULT_TRANSFORM } },
      { id: 'c3', trackId: 'image', lane: 0, start: 6,  end: 9,  src: pickPanda(5).src,  label: pickPanda(5).labelCn,  fx: 'zoom', transform: { ...DEFAULT_TRANSFORM } },
      { id: 'c4', trackId: 'image', lane: 0, start: 9,  end: 12, src: pickPanda(10).src, label: pickPanda(10).labelCn, fx: 'flash', transform: { ...DEFAULT_TRANSFORM } },
      { id: 'cap1', trackId: 'caption', lane: 0, start: 0,  end: 3,  text: '家人们谁懂啊' },
      { id: 'cap2', trackId: 'caption', lane: 0, start: 3,  end: 6,  text: '我直接裂开' },
      { id: 'cap3', trackId: 'caption', lane: 0, start: 6,  end: 9,  text: '但我装作很淡定' },
      { id: 'cap4', trackId: 'caption', lane: 0, start: 9,  end: 12, text: '我可太牛了' },
      { id: 'tts1', trackId: 'tts',  lane: 0, start: 0.3,  end: 5.7,  text: '家人们谁懂啊，我直接裂开',  voice: 'zh-default' },
      { id: 'tts2', trackId: 'tts',  lane: 0, start: 6.3,  end: 11.7, text: '但我装作很淡定，我可太牛了', voice: 'zh-default' },
      { id: 'bgm1', trackId: 'bgm',  lane: 0, start: 0,    end: 12,   bgmId: 'bgm-mox', name: '魔性循环', volume: 0.5 },
    ],
  };
}

// ============================================================
// Helpers
// ============================================================
function uid(prefix = 'c') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}
function clipsByLane(clips: Clip[], type: TrackType, lane: number): Clip[] {
  return clips.filter(c => c.trackId === type && c.lane === lane);
}
function findSnapTime(rawTime: number, clips: Clip[], duration: number, playhead: number, ignoreId: string | null, pxPerSec: number): number {
  const candidates: number[] = [0, duration, playhead];
  for (let s = 0; s <= Math.ceil(duration); s++) candidates.push(s);
  clips.forEach(c => { if (c.id === ignoreId) return; candidates.push(c.start, c.end); });
  const tol = SNAP_PX / pxPerSec;
  let best = rawTime, bestDx = tol;
  for (const t of candidates) {
    const d = Math.abs(t - rawTime);
    if (d < bestDx) { best = t; bestDx = d; }
  }
  return best;
}
function findFreeLane(type: TrackType, clips: Clip[], lanes: number, start: number, end: number): number | null {
  for (let lane = 0; lane < lanes; lane++) {
    const overlap = clips.some(c => c.trackId === type && c.lane === lane && c.start < end && c.end > start);
    if (!overlap) return lane;
  }
  return null;
}

// 傻瓜式 — 找 lane 0 上能放下 dur 的下一个时间起点 (接现有 clip 末尾)
// 跟剪映/CapCut 主轨行为一致, 拖素材自动衔接, 不开新 lane
function findNextSlotOnLane0(
  type: TrackType,
  clips: Clip[],
  preferredStart: number,
  dur: number,
  projectDuration: number,
): { start: number; end: number } | null {
  const sameType = clips
    .filter(c => c.trackId === type && c.lane === 0)
    .sort((a, b) => a.start - b.start);
  let start = Math.max(0, preferredStart);
  for (const c of sameType) {
    if (start < c.end && start + dur > c.start) {
      start = c.end;
    }
  }
  if (start + dur > projectDuration + 0.001) return null;
  return { start, end: start + dur };
}

// 字幕专用: 永远能加 — 优先 preferredStart (playhead) 上无冲突 lane, 其次后移, 最后塞 gap
// 剪映/CapCut 标准: 用户拖动后字幕应出现在 playhead 当前位置 (符合直觉)
function findFlexibleSlotForCaption(
  clips: Clip[],
  preferredStart: number,
  preferredDur: number,
  projectDuration: number,
): { start: number; end: number; lane: number } {
  const MIN_DUR = 0.3;
  const startAt = Math.max(0, Math.min(preferredStart, Math.max(0, projectDuration - MIN_DUR)));
  // 第 1 轮 — preferredStart 上找无冲突 lane (符合"用户拖动时直接显示到当下时间")
  for (let lane = 0; lane < 5; lane++) {
    const sameLane = clips
      .filter(c => c.trackId === 'caption' && c.lane === lane);
    const overlap = sameLane.some(c => c.start < startAt + preferredDur && c.end > startAt);
    if (!overlap) {
      // 检查能塞下完整 dur (考虑 projectDuration 边界)
      const end = Math.min(projectDuration, startAt + preferredDur);
      if (end - startAt >= MIN_DUR) {
        return { start: startAt, end, lane };
      }
    }
  }
  // 第 2 轮 — 不能在 preferredStart 找到无冲突 lane, 退回 "后移" 策略
  for (let lane = 0; lane < 5; lane++) {
    const sameLane = clips
      .filter(c => c.trackId === 'caption' && c.lane === lane)
      .sort((a, b) => a.start - b.start);
    let triedStart = startAt;
    for (const c of sameLane) {
      if (triedStart < c.end && triedStart + preferredDur > c.start) {
        triedStart = c.end;
      }
    }
    if (triedStart + preferredDur <= projectDuration + 0.001) {
      return { start: triedStart, end: triedStart + preferredDur, lane };
    }
    // gaps
    const gaps: { start: number; end: number }[] = [];
    let prev = 0;
    for (const c of sameLane) {
      if (c.start - prev >= MIN_DUR) gaps.push({ start: prev, end: c.start });
      prev = Math.max(prev, c.end);
    }
    if (projectDuration - prev >= MIN_DUR) gaps.push({ start: prev, end: projectDuration });
    if (gaps.length > 0) {
      gaps.sort((a, b) => Math.abs(a.start - startAt) - Math.abs(b.start - startAt));
      const g = gaps[0];
      const gapDur = g.end - g.start;
      return { start: g.start, end: g.start + Math.min(preferredDur, gapDur), lane };
    }
  }
  // 全满 → 在 playhead 处挤 0.5s (即使覆盖)
  const tinyStart = Math.min(startAt, Math.max(0, projectDuration - 0.5));
  return { start: tinyStart, end: tinyStart + Math.min(0.5, projectDuration - tinyStart), lane: 0 };
}
function clamp(v: number, min: number, max: number) { return Math.max(min, Math.min(max, v)); }
function getTransform(c: ImageClip): Transform { return c.transform ?? DEFAULT_TRANSFORM; }

// 在时间 t 计算 image clip 实际应渲染的 transform
//   - 没 endTransform + 不是 move fx → 直接返回 clip.transform
//   - 有 endTransform 且 effective fx 是 'move' → lerp clip.transform → endTransform 按 t/duration
// effectiveFx 通常已经 resolve 过 (FX track 优先 + image.fx fallback)
// 当 fx 不是 move 时不 lerp (即使设了 endTransform), 让用户能"录终态"暂留待用
function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
// v23-h: 接受 effectiveFxFor 完整返回值, 优先用 FX 'move' clip 的 startTransform/endTransform
// fallback: 老 image.fx='move' + image.endTransform (兼容旧 project)
function computeLiveTransform(c: ImageClip, t: number, eff: { fx: ImageFx; fxClip: FXClip | null; fxStart: number; fxDur: number }): Transform {
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
function formatTC(t: number) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const cs = Math.floor((t * 100) % 100);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

// ============================================================
// EXPORT — Render to canvas + MediaRecorder
// ============================================================
function pickBestMime(preferMp4 = false): { mime: string; ext: 'mp4' | 'webm' } {
  // 实测真相:
  //   - Chrome video/mp4;codecs=avc1.*,mp4a.40.2 在 M123+ 才"宣称"支持, 但部分版本仍 mux 失败 (audio track 计数 1 但实际空)
  //   - WebM+Opus (vp9+opus) 是浏览器原生最稳, 音轨写入可靠
  // 默认走 webm. 用户选 preferMp4=true 才尝试 mp4 (兼容性高但音轨可能丢)
  const webmCandidates = [
    { mime: 'video/webm;codecs=vp9,opus', ext: 'webm' as const },
    { mime: 'video/webm;codecs=vp8,opus', ext: 'webm' as const },
    { mime: 'video/webm;codecs=h264,opus', ext: 'webm' as const },
    { mime: 'video/webm', ext: 'webm' as const },
  ];
  const mp4Candidates = [
    { mime: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', ext: 'mp4' as const },
    { mime: 'video/mp4;codecs=avc1,mp4a.40.2', ext: 'mp4' as const },
    { mime: 'video/mp4;codecs=h264,aac', ext: 'mp4' as const },
  ];
  const order = preferMp4
    ? [...mp4Candidates, ...webmCandidates]
    : [...webmCandidates, ...mp4Candidates];
  for (const c of order) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c.mime)) {
      // eslint-disable-next-line no-console
      console.log('[export] using mime:', c.mime, '(ext .' + c.ext + ')');
      return c;
    }
  }
  return { mime: 'video/webm', ext: 'webm' };
}

// 检测浏览器 mp4 audio mux 是否真工作 — 用 isTypeSupported 不够 (撒谎). 录 0.3s 真测试.
async function probeMp4AudioMuxing(): Promise<boolean> {
  if (typeof MediaRecorder === 'undefined') return false;
  const mime = 'video/mp4;codecs=avc1.42E01E,mp4a.40.2';
  if (!MediaRecorder.isTypeSupported(mime)) return false;
  try {
    // 造一个 silent audio track + 0.5s 录制 → 检查 blob 是否含 audio
    type WindowWithWebkit = Window & { webkitAudioContext?: typeof AudioContext };
    const AC = window.AudioContext || (window as WindowWithWebkit).webkitAudioContext;
    if (!AC) return false;
    const ac = new AC();
    if (ac.state === 'suspended') await ac.resume().catch(() => {});
    const dest = ac.createMediaStreamDestination();
    const osc = ac.createOscillator();
    const g = ac.createGain();
    g.gain.value = 0.001;
    osc.connect(g).connect(dest);
    osc.start();
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    canvas.getContext('2d')!.fillRect(0, 0, 32, 32);
    const stream = new MediaStream([
      ...canvas.captureStream(10).getVideoTracks(),
      ...dest.stream.getAudioTracks(),
    ]);
    const r = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 64_000 });
    const chunks: Blob[] = [];
    r.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    const done = new Promise<Blob>((res) => { r.onstop = () => res(new Blob(chunks, { type: mime })); });
    r.start();
    await new Promise((res) => setTimeout(res, 500));
    r.stop();
    osc.stop();
    const blob = await done;
    try { await ac.close(); } catch {}
    // 0.5s 含 audio 至少应有 ~4KB; 没 audio mux 则 < 2KB
    return blob.size > 3000;
  } catch {
    return false;
  }
}

async function loadImage(src: string): Promise<HTMLImageElement> {
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

async function loadGifFrames(src: string): Promise<GifFrames> {
  const { parseGIF, decompressFrames } = await import('gifuct-js');
  const resp = await fetch(src);
  if (!resp.ok) throw new Error(`gif fetch failed: ${resp.status}`);
  const buf = await resp.arrayBuffer();
  const parsed = parseGIF(buf);
  const decoded = decompressFrames(parsed, true);
  if (decoded.length === 0) throw new Error('gif empty');

  const W = parsed.lsd.width;
  const H = parsed.lsd.height;
  const composed: { canvas: HTMLCanvasElement; delayMs: number }[] = [];

  // gifuct-js 帧数据是 patch (局部更新), 需按 disposalType 累积合成完整帧.
  // disposal: 0/1=保留前帧, 2=clear to bg, 3=restore prev (罕见, 简化 = 视为 1)
  const prev = document.createElement('canvas');
  prev.width = W; prev.height = H;
  const prevCtx = prev.getContext('2d');
  if (!prevCtx) throw new Error('canvas 2d unavailable');

  for (const f of decoded) {
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d unavailable');
    ctx.drawImage(prev, 0, 0);

    // f.patch 是 RGBA Uint8ClampedArray, dims 是局部 bbox
    const patchData = new ImageData(new Uint8ClampedArray(f.patch), f.dims.width, f.dims.height);
    const tmp = document.createElement('canvas');
    tmp.width = f.dims.width; tmp.height = f.dims.height;
    const tmpCtx = tmp.getContext('2d');
    if (!tmpCtx) throw new Error('canvas 2d unavailable');
    tmpCtx.putImageData(patchData, 0, 0);
    ctx.drawImage(tmp, f.dims.left, f.dims.top);

    composed.push({ canvas, delayMs: Math.max(20, f.delay || 100) });

    // 更新 prev
    if (f.disposalType === 2) {
      prevCtx.clearRect(0, 0, W, H);
    } else {
      prevCtx.clearRect(0, 0, W, H);
      prevCtx.drawImage(canvas, 0, 0);
    }
  }

  const totalDurMs = composed.reduce((s, f) => s + f.delayMs, 0);
  return { type: 'gif', width: W, height: H, frames: composed, totalDurMs };
}

async function loadMedia(src: string): Promise<MediaAsset> {
  if (isGifSrc(src)) {
    try {
      return await loadGifFrames(src);
    } catch (e) {
      // gif decode 失败 fallback 走 <img> 加载 (至少首帧能显)
      // eslint-disable-next-line no-console
      console.warn('[gif] decode failed, fallback to <img>:', e);
      return await loadImage(src);
    }
  }
  return await loadImage(src);
}

export function gifFrameAt(g: GifFrames, t: number, clipStart: number): HTMLCanvasElement {
  if (g.frames.length === 1 || g.totalDurMs <= 0) return g.frames[0].canvas;
  const localMs = (((t - clipStart) * 1000) % g.totalDurMs + g.totalDurMs) % g.totalDurMs;
  let acc = 0;
  for (const f of g.frames) {
    acc += f.delayMs;
    if (localMs < acc) return f.canvas;
  }
  return g.frames[g.frames.length - 1].canvas;
}

export function mediaWH(m: MediaAsset): { w: number; h: number } {
  if (isGifFrames(m)) return { w: m.width, h: m.height };
  return { w: m.naturalWidth || m.width, h: m.naturalHeight || m.height };
}

export function drawableAt(m: MediaAsset, t: number, clipStart: number): CanvasImageSource {
  if (isGifFrames(m)) return gifFrameAt(m, t, clipStart);
  return m;
}

// 决定某 image clip 在时间 t 实际应用的 fx 名:
// FX track 优先 — 找 active 的 FXClip, 若 targetClipId 匹配 / 为空 (全局) 都生效, 否则用 image.fx
function effectiveFxFor(clip: ImageClip, t: number, allClips: Clip[]): { fx: ImageFx; fxStart: number; fxDur: number; fxClip: FXClip | null } {
  const fxClip = allClips.find(c =>
    c.trackId === 'fx' && t >= c.start && t < c.end && (!c.targetClipId || c.targetClipId === clip.id)
  ) as FXClip | undefined;
  if (fxClip) return { fx: fxClip.fx, fxStart: fxClip.start, fxDur: fxClip.end - fxClip.start, fxClip };
  return { fx: clip.fx, fxStart: clip.start, fxDur: clip.end - clip.start, fxClip: null };
}

// 计算 fx 在 t 时刻的具体 transform 偏移 / 缩放 / 旋转 / 透明度 / 滤镜
// 跟 export canvas render 同算法 → preview 跟 export 视觉一致, 也不依赖 CSS animation (避免漂移)
// move fx 的 transform tween 走 computeLiveTransform — 这里 FxApply 不重复处理
interface FxApply { offsetX: number; offsetY: number; scaleMul: number; rotateAdd: number; alpha: number; filter: string; }
// easeInOutCubic — 让运镜更柔, 不死板线性
function ease(p: number): number { return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; }
// v23-j (phase 2): FX clip 创建时按 fx 种类初始化默认 strength/zoom/spin 参数
function initFXDefaults(fxClip: FXClip, targetTr: Transform): void {
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
function computeFx(fx: ImageFx, fxStart: number, fxDur: number, t: number, W: number, fxClip?: FXClip | null): FxApply {
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

function renderExportFrame(
  ctx: CanvasRenderingContext2D,
  t: number,
  project: ProjectState,
  W: number,
  H: number,
  imgCache: Map<string, MediaAsset>,
) {
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, W, H);
  // v23-i: 删 scene 强制最底 — 用户痛点 "改 lane 没变化". 纯按 lane 排 (lane 大 = 底层, lane 0 = 顶层)
  // scene 仍按 lane 排, 但 cover 全屏性质保留. 想让 scene 当背景 → 把 scene 放高 lane (e.g. lane 1+)
  const active = (project.clips.filter(c => c.trackId === 'image' && t >= c.start && t < c.end) as ImageClip[])
    .sort((a, b) => b.lane - a.lane);

  for (let idx = 0; idx < active.length; idx++) {
    const c = active[idx];
    const media = imgCache.get(c.src);
    if (!media) continue;
    const { w: naturalW, h: naturalH } = mediaWH(media);
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

    ctx.save();
    ctx.globalAlpha = fxA.alpha;
    if (fxA.filter) ctx.filter = fxA.filter;
    ctx.translate(cx + fxA.offsetX, cy + fxA.offsetY);
    ctx.rotate((tr.rotation + fxA.rotateAdd) * Math.PI / 180);
    ctx.scale(tr.flipX ? -1 : 1, 1);
    // GIF: 按 (t-clipStart) % gifDur 取当前帧; 静图: HTMLImageElement 自身
    ctx.drawImage(drawableAt(media, t, c.start), -iw / 2, -ih / 2, iw, ih);
    ctx.restore();
  }

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
      drawCaption(ctx, ent.visibleText, W, H, cap.fontSize, cap.color, cap.style ?? DEFAULT_CAPTION_STYLE, cap.transform ?? DEFAULT_CAPTION_TRANSFORM, { opacity: ent.opacity, scale: ent.scale });
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
function computeCaptionEntrance(
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

function drawCaption(
  ctx: CanvasRenderingContext2D,
  text: string,
  W: number,
  H: number,
  capFontSize: number | undefined,
  capColor: string | undefined,
  style: CaptionStyle = DEFAULT_CAPTION_STYLE,
  tr: CaptionTransform = DEFAULT_CAPTION_TRANSFORM,
  entranceState: { opacity: number; scale: number } = { opacity: 1, scale: 1 },
): void {
  if (!text) return;
  if (entranceState.opacity <= 0.01) return;  // v23-k: 完全透明 skip 绘制
  const fontSize = capFontSize ? Math.round(capFontSize * W / 1280) : Math.max(28, Math.round(W * 0.04));
  // meme/bar 默认白字, panel 默认黑字
  const color = capColor ?? (style === 'panel' ? '#000000' : '#ffffff');
  ctx.font = `bold ${fontSize}px "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // transform.x/y 都是 % of stage, 跟预览 'left: 50+x%' 'top: 50+y%' 对齐
  const cx = W * (0.5 + tr.x / 100);
  const cy = H * (0.5 + tr.y / 100);
  // v23-k: entranceState (opacity + scale) — 用 ctx.save/translate/scale/globalAlpha 包裹后续绘制
  const needsXform = entranceState.opacity < 1 || Math.abs(entranceState.scale - 1) > 0.01;
  if (needsXform) {
    ctx.save();
    ctx.globalAlpha = entranceState.opacity;
    ctx.translate(cx, cy);
    ctx.scale(entranceState.scale, entranceState.scale);
    ctx.translate(-cx, -cy);
  }

  if (style === 'panel') {
    const metrics = ctx.measureText(text);
    const padX = 16, padY = 6;
    const boxW = metrics.width + padX * 2;
    const boxH = fontSize * 1.3;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(cx - boxW / 2, cy - boxH / 2, boxW, boxH);
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.strokeRect(cx - boxW / 2, cy - boxH / 2, boxW, boxH);
    ctx.fillStyle = color;
    ctx.fillText(text, cx, cy + padY * 0.2);
  } else if (style === 'bar') {
    const metrics = ctx.measureText(text);
    const padX = 18, padY = 8;
    const boxW = metrics.width + padX * 2;
    const boxH = fontSize * 1.35;
    ctx.fillStyle = 'rgba(0,0,0,0.78)';
    ctx.fillRect(cx - boxW / 2, cy - boxH / 2, boxW, boxH);
    ctx.fillStyle = color;
    ctx.fillText(text, cx, cy + padY * 0.1);
  } else {
    // meme: 白字 + 黑描边 (跟编辑器 + 草图卡片一致)
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(4, fontSize * 0.18);
    ctx.strokeStyle = '#000000';
    ctx.strokeText(text, cx, cy);
    ctx.fillStyle = color;
    ctx.fillText(text, cx, cy);
  }
  if (needsXform) ctx.restore();
}

// 导出 MP4 — 网页剪辑通用做法 (无 getDisplayMedia 弹窗):
//   - 视频: canvas.captureStream(30)
//   - 音频: AudioContext.createMediaStreamDestination → BGM 直接路由 → MediaRecorder 录到
//   - TTS: SpeechSynthesis 因浏览器 spec 不能路由 AudioContext, 妥协把 TTS 文字烧录成画面字幕
//     (renderExportFrame 顶部条字幕条显示对应 TTS 文字)
// v23-k Phase A: 分辨率 / 帧率 / 码率 — 工业级标配
export type ExportResolution = '480p' | '720p' | '1080p';
export type ExportFps = 24 | 30 | 60;
const RESOLUTION_DIM: Record<ExportResolution, { w: number; h: number }> = {
  '480p': { w: 854, h: 480 },
  '720p': { w: 1280, h: 720 },
  '1080p': { w: 1920, h: 1080 },
};
const RESOLUTION_VBPS: Record<ExportResolution, number> = {
  '480p': 2_000_000,
  '720p': 4_000_000,
  '1080p': 8_000_000,
};

async function exportVideo(
  project: ProjectState,
  name: string,
  onProgress: (p: number) => void,
  userBGMs: BGMPreset[] = [],
  preferMp4 = false,
  resolution: ExportResolution = '720p',
  fps: ExportFps = 30,
): Promise<{ ext: string; size: number; hasAudio: boolean; mime: string; resolution: ExportResolution; fps: ExportFps }> {
  // FIX BGM 越累越大: export 开始前彻底清干净所有跑着的音源 (试听 / 上次 export 残留)
  audioEngine.cancelAll();
  audioEngine.stopExportCapture();
  // 销毁旧 TTS players, export 重建保证 audio 跟 exportDest 重新 connect
  audioEngine.destroyAllTTSPlayers();

  const { w: W, h: H } = RESOLUTION_DIM[resolution];
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctxRaw = canvas.getContext('2d', { alpha: false });
  if (!ctxRaw) throw new Error('canvas 2d 不可用');
  const ctx: CanvasRenderingContext2D = ctxRaw;

  const { mime, ext } = pickBestMime(preferMp4);
  // 先把所有 image 资源预加载 (GIF 走 decoder 拿多帧, 静图走 <img>)
  const allSrcs = Array.from(new Set(project.clips.filter(c => c.trackId === 'image').map(c => (c as ImageClip).src)));
  const imgCache = new Map<string, MediaAsset>();
  await Promise.all(allSrcs.map(async src => {
    try { imgCache.set(src, await loadMedia(src)); } catch {}
  }));

  // 第 0 帧先画
  renderExportFrame(ctx, 0, project, W, H, imgCache);

  // Web Audio MediaStream — BGM + 用户录音 TTS 都路由进 audioStream
  // FIX MP4 配音越来越大: 导出前彻底销毁所有旧 TTS player + BGM
  // 旧 player 残留的 gain 连接累积 → 多次导出后音轨叠加导致末尾音量过大
  // destroyAll 强制 _ttsPlayers Map 清空, 下面 preloadTTSAudios 时全新重建 (干净 connection)
  audioEngine.destroyAll();

  const audioStream = audioEngine.startExportCapture();
  const hasBGM = project.clips.some(c => c.trackId === 'bgm');
  const hasRecordedTTS = project.clips.some(c => c.trackId === 'tts' && !!(c as TTSClip).audioSrc);
  // BGM 不录入 MP4 (产品决策). audio 流只跟 TTS 走
  const hasAudio = !!audioStream && hasRecordedTTS;
  if (hasBGM) {
    toast(`提示: MP4 仅含 TTS 配音, BGM 不录入 (可第三方工具合并)`, { duration: 4000 });
  }
  // eslint-disable-next-line no-console
  console.log('[export] audioStream:', !!audioStream, 'tracks:', audioStream?.getAudioTracks().length, 'hasBGM:', hasBGM, 'hasRecordedTTS:', hasRecordedTTS);

  const videoStream = canvas.captureStream(fps);
  const combinedStream = audioStream
    ? new MediaStream([
        ...videoStream.getVideoTracks(),
        ...audioStream.getAudioTracks(),
      ])
    : videoStream;
  // eslint-disable-next-line no-console
  console.log('[export] combinedStream — video:', combinedStream.getVideoTracks().length, 'audio:', combinedStream.getAudioTracks().length);

  const recorderOpts: MediaRecorderOptions = {
    mimeType: mime,
    videoBitsPerSecond: RESOLUTION_VBPS[resolution],
  };
  if (audioStream) recorderOpts.audioBitsPerSecond = 128_000;
  const recorder = new MediaRecorder(combinedStream, recorderOpts);
  const chunks: Blob[] = [];
  recorder.ondataavailable = e => { if (e.data && e.data.size > 0) chunks.push(e.data); };
  const donePromise = new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: mime }));
    recorder.onerror = (e) => reject(new Error('recorder error: ' + (e as Event).type));
  });
  recorder.start();

  // ★ 关键: preload 所有 TTS audio (canplaythrough), 录制时立刻有数据
  // 没 preload 的话 audio.play() 是 async, 录前几帧 audio 是空的 → MP4 配音缺帧
  const ttsClipsForPreload = project.clips
    .filter((c): c is TTSClip => c.trackId === 'tts' && !!c.audioSrc)
    .map((c) => ({ id: c.id, audioSrc: c.audioSrc }));
  if (ttsClipsForPreload.length > 0) {
    // eslint-disable-next-line no-console
    console.log('[export] preload', ttsClipsForPreload.length, 'TTS audios');
    await audioEngine.preloadTTSAudios(ttsClipsForPreload);
  }
  // BGM 不录入 MP4 (产品决策, 见上 step()), 这里也不 preload

  // 实时渲染 + BGM 真发声 (走 MediaStreamDestination 自动录到 MP4) — v23-k: 用参数 fps
  const frameMs = 1000 / fps;
  const startTime = performance.now();
  const totalMs = project.duration * 1000;
  const bgmStarted = new Set<string>();
  const ttsStarted = new Set<string>(); // 兼容旧逻辑, 实际不再用 (audioSrc 走 sync)

  await new Promise<void>(resolve => {
    function step() {
      const elapsed = performance.now() - startTime;
      const t = Math.min(project.duration, elapsed / 1000);
      renderExportFrame(ctx, t, project, W, H, imgCache);
      onProgress(Math.min(1, elapsed / totalMs));

      // 仅 TTS 录入 MP4. BGM 故意不录 (产品决策: 用户要无 BGM 视频), 后续可第三方合并
      for (const c of project.clips) {
        // BGM 不录 — 跳过 (export 静默, preview 仍可听)
        if (c.trackId === 'bgm') continue;
        // ★ 关键: TTS 走 sync (而非 trigger), audio.currentTime = t - clip.start
        // 让 audio 跟 video 时钟严格对齐, export 录入 MP4 真音轨
        if (c.trackId === 'tts') {
          const ts = c as TTSClip;
          if (ts.audioSrc) {
            const rate = VOICE_BY_ID[resolveVoiceId(ts.voice)]?.playbackRate ?? 1.0;
            audioEngine.syncTTSPlayer(ts.id, ts.audioSrc, t, ts.start, true, 1.0, rate);
          }
        }
      }
      // 兼容 lint: ttsStarted 仍声明但导出走 sync 不再用
      void ttsStarted;

      if (elapsed >= totalMs) {
        resolve();
        return;
      }
      setTimeout(step, frameMs);
    }
    step();
  });

  // 最后一帧 + 等 audio 收尾
  renderExportFrame(ctx, project.duration, project, W, H, imgCache);
  await new Promise(r => setTimeout(r, hasAudio ? 400 : 100));
  recorder.stop();
  // FIX MP4 配音越来越大: 导出后 destroyAll (cancelAll + destroyAllTTSPlayers)
  // 彻底销毁所有 TTS player + audio element + gain connection
  // 下次导出/preview 时 _ensureTTSPlayer 全新重建, 无历史残留
  audioEngine.destroyAll();
  audioEngine.stopExportCapture();
  const blob = await donePromise;

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name || 'animate'}.${ext}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);

  onProgress(1);
  // eslint-disable-next-line no-console
  console.log('[export] done · blob size:', (blob.size / 1024 / 1024).toFixed(2), 'MB · mime:', mime);
  return { ext, size: blob.size, hasAudio, mime, resolution, fps };
}

// ============ exportGIF — GIF 模式直出 GIF (gif.js worker) ============
// 不录音 / 不走 MediaRecorder / 帧帧 addFrame → gif.render → blob
// 用 GIF_PRESETS 决定 width/height/fps. 时长跟 project.duration.
// PreviewPane DOM-based 渲染 GIF 自带动画, 这里 export 走 canvas 也支持多帧 (drawableAt).
export async function exportGIF(
  project: ProjectState,
  name: string,
  onProgress: (p: number) => void,
  presetId: GifPresetId = 'wechat',
): Promise<{ ext: string; size: number; width: number; height: number; fps: number; frameCount: number; durationSec: number }> {
  const preset = GIF_PRESETS.find(p => p.id === presetId) ?? GIF_PRESETS[0];
  const { width: W, height: H, fps } = preset;
  // v24: cap 在三方 min (项目时长 / 全局上限 / preset.maxDuration). 防止微信 preset (≤3s) 但 project=5s 实际导出 5s 上传被拒.
  const durationSec = Math.min(project.duration, GIF_MAX_DURATION, preset.maxDuration);

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('canvas 2d 不可用');

  // 预加载所有 image (含 GIF decoder)
  const allSrcs = Array.from(new Set(project.clips.filter(c => c.trackId === 'image').map(c => (c as ImageClip).src)));
  const imgCache = new Map<string, MediaAsset>();
  await Promise.all(allSrcs.map(async src => {
    try { imgCache.set(src, await loadMedia(src)); } catch {}
  }));

  // 动态 import gif.js + worker (减 prod bundle, 用户没点 GIF 导出就不加载)
  const [{ default: GIF }, workerUrlMod] = await Promise.all([
    import('gif.js'),
    // gif.js 的 worker. Vite ?url import 拿到资源 URL, 不进 main bundle
    import('gif.js/dist/gif.worker.js?url'),
  ]);
  const workerScript = (workerUrlMod as { default: string }).default;

  // GIF quality 1=highest, 30=lowest. 10 是常用甜点 (微信表情包 ≤500KB 可达)
  // workers 2 个: 主线程 + worker 并行 quantize
  const gif = new GIF({
    workers: 2,
    quality: 10,
    width: W,
    height: H,
    workerScript,
    background: '#000000',
    repeat: 0,  // 0 = infinite loop
  });

  const frameCount = Math.max(1, Math.round(durationSec * fps));
  const delayMs = Math.round(1000 / fps);

  // 同步逐帧渲染 + addFrame (gif.js encode 后续 async)
  for (let i = 0; i < frameCount; i++) {
    const t = (i / fps);
    renderExportFrame(ctx, t, project, W, H, imgCache);
    gif.addFrame(canvas, { copy: true, delay: delayMs });
    // 进度: render 阶段占 50% (encode 阶段占 50%, gif.on('progress'))
    if (i % 4 === 0) onProgress(0.5 * (i / frameCount));
    // 让出主线程 (防 UI 卡死)
    if (i % 8 === 0) await new Promise(r => setTimeout(r, 0));
  }

  const blob = await new Promise<Blob>((resolve, reject) => {
    gif.on('finished', (b: Blob) => resolve(b));
    gif.on('progress', (p: number) => {
      onProgress(0.5 + 0.5 * p);
    });
    gif.on('abort', () => reject(new Error('GIF encode aborted')));
    gif.render();
  });

  // 触发下载
  const safe = (name || '我的GIF').replace(/[\\/:*?"<>|]/g, '_').slice(0, 40);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safe}.gif`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  return { ext: 'gif', size: blob.size, width: W, height: H, fps, frameCount, durationSec };
}

// ============================================================
// Main Component
// ============================================================
export function AnimateMode() {
  const isMobile = useIsMobile();
  const [project, setProject] = useState<ProjectState>(() => makeInitialProject());
  const [playhead, setPlayhead] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [projectHydrated, setProjectHydrated] = useState(false);
  // v23-l mobile: 底栏 4 tab → sheet
  const [mobileSheet, setMobileSheet] = useState<'assets' | 'caption' | 'fx' | 'inspector' | null>(null);
  // v23-l audit-fix: sheet drag-to-dismiss (leftover #4). 之前 cursor:grab 撒谎 — 现在 PointerDown/Move/Up 真支持向下拖关.
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const dragStartYRef = useRef<number | null>(null);
  const [sheetTranslateY, setSheetTranslateY] = useState(0);
  const onSheetHandlePointerDown = (e: React.PointerEvent) => {
    dragStartYRef.current = e.clientY;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onSheetHandlePointerMove = (e: React.PointerEvent) => {
    if (dragStartYRef.current === null) return;
    const dy = e.clientY - dragStartYRef.current;
    if (dy > 0) setSheetTranslateY(dy); // 只允许向下拖
  };
  const onSheetHandlePointerUp = (e: React.PointerEvent) => {
    if (dragStartYRef.current === null) return;
    const dy = e.clientY - dragStartYRef.current;
    dragStartYRef.current = null;
    try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* already released */ }
    const sheetH = sheetRef.current?.offsetHeight ?? 1;
    if (dy / sheetH > 0.3) {
      // 拖超 30% 关
      setSheetTranslateY(0);
      setMobileSheet(null);
    } else {
      // snap 回原位
      setSheetTranslateY(0);
    }
  };
  // sheet 关时重置 translateY (防 reopen 残留)
  useEffect(() => { if (mobileSheet === null && sheetTranslateY !== 0) setSheetTranslateY(0); }, [mobileSheet, sheetTranslateY]);

  // mount: 从 IDB 恢复上次的 project (静态站, 用户跨刷新/切走不丢工作)
  // v24 双缓存策略:
  //   优先读 video / gif 任一新双 key, 没数据时一次性从老单 key 迁移按 project.mode 拆分.
  // schema migrate:
  //   1. 旧 v9 project 没 fx lane → 补默认 1, 否则 totalLanes 算出 NaN
  //   2. ImageClip.src 是 blob: URL (v10 之前 ComboTab 用) → 失效 → 自动清理
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // 1) 优先读两个新 key — 取最近一次有效的
        const [vRaw, gRaw] = await Promise.all([
          idbGet<ProjectState>(AM_VIDEO_CURRENT_IDB_KEY).catch(() => undefined),
          idbGet<ProjectState>(AM_GIF_CURRENT_IDB_KEY).catch(() => undefined),
        ]);
        // 默认起 video (即使 gif 缓存存在也优先 video, 因为新建/常用都在视频)
        let pickRaw: ProjectState | undefined = vRaw;
        if (!pickRaw && gRaw) pickRaw = gRaw;

        // 2) 都没有 → 试老单 key 一次性迁移
        if (!pickRaw) {
          const oldRaw = await idbGet<ProjectState>(AM_CURRENT_IDB_KEY).catch(() => undefined);
          if (oldRaw) {
            const oldHydrated = hydrateProject(oldRaw);
            if (oldHydrated) {
              const splitMode: ProjectMode = oldHydrated.project.mode ?? 'video';
              const targetKey = splitMode === 'gif' ? AM_GIF_CURRENT_IDB_KEY : AM_VIDEO_CURRENT_IDB_KEY;
              await idbSet(targetKey, oldHydrated.project).catch(() => {});
              await idbDel(AM_CURRENT_IDB_KEY).catch(() => {});
              pickRaw = oldHydrated.project;
            }
          }
        }

        if (cancelled) return;
        if (pickRaw) {
          const hydrated = hydrateProject(pickRaw);
          if (hydrated) {
            setProject(hydrated.project);
            if (hydrated.cleanedInvalidImages > 0) {
              toast.warning(`检测到 ${hydrated.cleanedInvalidImages} 个失效图片片段已自动清理 (刷新后的临时 URL), 请用左侧 "配套" tab 重新加`);
            }
          }
        }
      } finally {
        if (!cancelled) setProjectHydrated(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // project 变 → debounced 写 IDB (hydrate 完了才开始, 防初次 default project 覆盖 IDB)
  // v24: 写当前 mode 对应的 IDB key — video 和 gif 各自独立持久化, 切 mode 互不破坏.
  useEffect(() => {
    if (!projectHydrated) return;
    const t = window.setTimeout(() => {
      const key = getCurrentIdbKey(project.mode);
      void idbSet(key, project).catch(() => {});
    }, 250);
    return () => window.clearTimeout(t);
  }, [project, projectHydrated]);

  const historyRef = useRef<{ past: ProjectState[]; future: ProjectState[] }>({ past: [], future: [] });
  const [, setHistoryTick] = useState(0);
  const commit = useCallback((updater: (prev: ProjectState) => ProjectState) => {
    setProject(prev => {
      const next = updater(prev);
      if (next === prev) return prev;
      historyRef.current.past.push(prev);
      if (historyRef.current.past.length > HISTORY_MAX) historyRef.current.past.shift();
      historyRef.current.future = [];
      setHistoryTick(t => t + 1);
      return next;
    });
  }, []);
  const setProjectLive = useCallback((updater: (prev: ProjectState) => ProjectState) => { setProject(updater); }, []);
  const dragSnapshotRef = useRef<ProjectState | null>(null);
  const beginDrag = useCallback(() => { dragSnapshotRef.current = project; }, [project]);
  const endDrag = useCallback(() => {
    if (dragSnapshotRef.current) {
      historyRef.current.past.push(dragSnapshotRef.current);
      if (historyRef.current.past.length > HISTORY_MAX) historyRef.current.past.shift();
      historyRef.current.future = [];
      setHistoryTick(t => t + 1);
      dragSnapshotRef.current = null;
    }
  }, []);
  const undo = useCallback(() => {
    setProject(prev => {
      const p = historyRef.current.past.pop();
      if (!p) return prev;
      historyRef.current.future.push(prev);
      setHistoryTick(t => t + 1);
      return p;
    });
    setSelectedId(null);
  }, []);
  const redo = useCallback(() => {
    setProject(prev => {
      const n = historyRef.current.future.pop();
      if (!n) return prev;
      historyRef.current.past.push(prev);
      setHistoryTick(t => t + 1);
      return n;
    });
    setSelectedId(null);
  }, []);
  const canUndo = historyRef.current.past.length > 0;
  const canRedo = historyRef.current.future.length > 0;

  // 新建项目 — 清当前 mode 的 project (另一个 mode 的缓存保留)
  const resetProject = useCallback(() => {
    setProject(prev => {
      const fresh = makeBlankProject();
      // 保留 mode + gifPresetId, 让用户在当前 mode 继续工作
      fresh.mode = prev.mode ?? 'video';
      if (fresh.mode === 'gif') {
        fresh.gifPresetId = prev.gifPresetId ?? 'wechat';
        fresh.duration = Math.min(fresh.duration, GIF_MAX_DURATION);
      }
      // 同步清空当前 mode 对应 IDB key
      void idbDel(getCurrentIdbKey(fresh.mode)).catch(() => {});
      return fresh;
    });
    setPlayhead(0);
    setSelectedId(null);
    historyRef.current = { past: [], future: [] };
    setHistoryTick(t => t + 1);
    audioEngine.destroyAll();
    toast.success('已新建空白项目');
  }, []);

  // v23-k Phase A: 项目 JSON 导入/导出 (跨设备 / 备份 / 分享)
  const exportProjectJSON = useCallback(() => {
    try {
      const payload = {
        version: 'v23-l',
        exportedAt: new Date().toISOString(),
        name: '我的沙雕动画',
        project,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sadiao-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.amjson`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(`✓ 已导出项目 JSON · ${project.clips.length} 片段 · ${project.duration.toFixed(1)}s`);
    } catch (e) {
      toast.error(`导出 JSON 失败: ${(e as Error).message}`);
    }
  }, [project]);

  const importProjectJSON = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.amjson,application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        if (file.size > 20 * 1024 * 1024) {
          toast.error('JSON 文件最多 20MB');
          return;
        }
        const text = await file.text();
        const data = JSON.parse(text) as { project?: ProjectState; name?: string };
        const hydrated = hydrateProject(data.project);
        if (!hydrated) {
          toast.error('不是有效 .amjson 文件');
          return;
        }
        const importRes = await showDialog({
          title: '导入项目',
          message: `导入会替换当前工作 · 当前 ${project.clips.length} 个片段会清空 (已存草稿不影响). 继续?`,
          variant: 'warning',
          confirmText: '导入',
        });
        if (!importRes.confirmed) return;
        setProject(hydrated.project);
        setPlayhead(0);
        setSelectedId(null);
        historyRef.current = { past: [], future: [] };
        setHistoryTick(t => t + 1);
        audioEngine.destroyAll();
        toast.success(`✓ 已导入项目 · ${hydrated.project.clips.length} 片段 · ${hydrated.project.duration.toFixed(1)}s${data.name ? ` · 名称: ${data.name}` : ''}${hydrated.cleanedInvalidImages > 0 ? ` · 清理 ${hydrated.cleanedInvalidImages} 失效图` : ''}`);
      } catch (e) {
        toast.error(`导入失败: ${(e as Error).message}`);
      }
    };
    input.click();
  }, [project.clips.length]);

  // ========================================================
  // Auto-gen TTS audioSrc — 推翻级: 所有 voice 都走云端 (统一 sync 体验)
  //   理由: SS API 不能 seek 也不能录 MP4. 想要 timeline sync + 导 MP4 必须 audioSrc.
  //   策略: 1. LRU 缓存 (text|lang) - 同文同语种共享
  //         2. youdao 失败 → baidu fallback
  //         3. 都失败 → genFailed=true → ❌ + inspector 重试按钮
  //   voice 标签 (晓晓/Guy/Ryan) 保留为 UI 名, 实际 audio 都从云端拿
  // ========================================================
  const ttsGenSigRef = useRef<Map<string, string>>(new Map());
  const ttsAudioCacheRef = useRef<Map<string, { audioSrc: string; duration: number }>>(new Map());
  useEffect(() => {
    const timer = setTimeout(async () => {
      for (const c of project.clips) {
        if (c.trackId !== 'tts') continue;
        const ts = c as TTSClip;
        const text = (ts.text || '').trim();
        if (!text) continue;
        const v = VOICE_BY_ID[resolveVoiceId(ts.voice)];
        // 所有 voice 都 auto-gen (SS 不能 sync 也不能导 MP4, 必须云端 audio)
        const sig = `${text}|${ts.voice}`;
        const tried = ttsGenSigRef.current.get(ts.id);
        if (ts.audioSrc && tried === `done:${sig}`) continue;
        if (tried === `fail:${sig}`) continue;
        if (tried === `pending:${sig}`) continue;
        // LRU 缓存: key=text|voice.id (按 voice 隔离, 不同 engine 的 audio 不混)
        // 同 text 同 voice (如随机生成的 1/3 都 zh-youdao 同文) 共享 audio, 只 fetch 1 次
        const cacheKey = `${text}|${ts.voice}`;
        const cached = ttsAudioCacheRef.current.get(cacheKey);
        // v23-e: clip.playbackRate (用户在 Inspector 调倍速) 优先, fallback voice 级
        const rate = ts.playbackRate ?? v.playbackRate ?? 1.0;
        if (cached) {
          const wallDuration = cached.duration / rate;
          ttsGenSigRef.current.set(ts.id, `done:${sig}`);
          setProjectLive(p => ({
            ...p,
            clips: p.clips.map(cc => cc.id === ts.id
              ? ({ ...cc, audioSrc: cached.audioSrc, audioDuration: cached.duration, end: cc.start + wallDuration, genFailed: false } as Clip)
              : cc
            ),
          }));
          // eslint-disable-next-line no-console
          console.log(`[auto-gen TTS cache] ${ts.id} "${text.slice(0, 20)}" → ${wallDuration.toFixed(1)}s (rate ${rate.toFixed(2)})`);
          continue;
        }
        ttsGenSigRef.current.set(ts.id, `pending:${sig}`);
        try {
          // 用 voice.preferredEngine, 失败 fallback 另一个 engine
          const { dataUrl, engine: usedEngine } = await fetchTTSForVoice(text, v);
          if (ttsGenSigRef.current.get(ts.id) !== `pending:${sig}`) continue;
          const duration = await getAudioDuration(dataUrl);
          if (ttsGenSigRef.current.get(ts.id) !== `pending:${sig}`) continue;
          const wallDuration = duration / rate;
          ttsAudioCacheRef.current.set(cacheKey, { audioSrc: dataUrl, duration });
          ttsGenSigRef.current.set(ts.id, `done:${sig}`);
          setProjectLive(p => ({
            ...p,
            clips: p.clips.map(cc => cc.id === ts.id
              ? ({ ...cc, audioSrc: dataUrl, audioDuration: duration, end: cc.start + wallDuration, genFailed: false, audioEngine: usedEngine } as Clip)
              : cc
            ),
          }));
          // eslint-disable-next-line no-console
          console.log(`[auto-gen TTS ${usedEngine}] ${ts.id} "${text.slice(0, 20)}" → ${wallDuration.toFixed(1)}s (rate ${rate.toFixed(2)})`);
        } catch (e) {
          if (ttsGenSigRef.current.get(ts.id) === `pending:${sig}`) {
            ttsGenSigRef.current.set(ts.id, `fail:${sig}`);
          }
          // mark genFailed=true + 清旧 audioSrc/audioEngine (防 user 改 text 后 dump 仍显旧 audio)
          setProjectLive(p => ({
            ...p,
            clips: p.clips.map(cc => cc.id === ts.id
              ? ({ ...cc, genFailed: true, audioSrc: undefined, audioEngine: undefined } as Clip)
              : cc
            ),
          }));
          // eslint-disable-next-line no-console
          console.warn(`[auto-gen TTS] ${ts.id} 两个 engine 都失败:`, (e as Error).message);
        }
      }
    }, 800);
    return () => clearTimeout(timer);
  }, [project.clips, setProjectLive]);

  // ========================================================
  // DEV: TTS state dump 工具 — Ctrl+Shift+D 或 console 调 __dumpTTS()
  // 一键 console.table 所有 TTS clip 的: id/text/voice/source/audioSrc/sigState/播放路径
  // 同时复制 JSON 到剪贴板, 用户能直接粘贴报问题
  // ========================================================
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const dump = () => {
      const rows = project.clips
        .filter(c => c.trackId === 'tts')
        .sort((a, b) => a.start - b.start)
        .map((c, idx) => {
          const ts = c as TTSClip;
          const v = VOICE_BY_ID[resolveVoiceId(ts.voice)];
          const sigState = ttsGenSigRef.current.get(ts.id) || '(none)';
          // preferred = voice 配置的 engine; usedEngine = fetch 真正命中的 engine (可能被 fallback 抢回)
          // 当 preferred !== usedEngine 时 → fallback 发生过, 听感跟 voice 名字不一致! noFallback=true 可防
          const preferred = v?.preferredEngine || 'youdao';
          const usedEngine = ts.audioEngine || '(未知)';
          const mismatch = ts.audioEngine && ts.audioEngine !== preferred ? '⚠️FALLBACK' : '';
          return {
            '#': idx + 1,
            id: ts.id,
            text: (ts.text || '').slice(0, 24),
            start: +ts.start.toFixed(2),
            end: +ts.end.toFixed(2),
            dur: +(ts.end - ts.start).toFixed(2),
            voice: ts.voice,
            voiceName: v?.name,
            preferred,
            usedEngine: `${usedEngine}${mismatch}`,
            baiduPer: v?.baiduPer ?? '-',
            noFallback: v?.noFallback ? 'YES' : '-',
            playbackRate: `${ts.playbackRate ?? v?.playbackRate ?? 1.0} (clip${ts.playbackRate !== undefined ? '✓' : '-'})`,
            audioSrc: ts.audioSrc ? `${(ts.audioSrc.length / 1024).toFixed(1)}KB` : '(none)',
            genFailed: ts.genFailed ? '❌ YES' : '-',
            sigState,
            path: ts.audioSrc ? '✅ sync(mp3)' : (ts.genFailed ? '❌ 生成失败' : '⚠️ SS触发'),
          };
        });
      // eslint-disable-next-line no-console
      console.log('🔬 ===== TTS State Dump =====');
      // eslint-disable-next-line no-console
      console.table(rows);
      try {
        const json = JSON.stringify(rows, null, 2);
        void navigator.clipboard.writeText(json);
        toast.success(`🔬 已 dump ${rows.length} 段 TTS → console + 剪贴板`);
      } catch {
        toast.success(`🔬 已 dump ${rows.length} 段 TTS → console`);
      }
    };
    // 扩展: 全 project 时间表 dump (含 image / caption / tts / bgm / fx 对齐时间)
    const dumpProject = () => {
      const rows = project.clips
        .slice()
        .sort((a, b) => a.start - b.start || a.trackId.localeCompare(b.trackId))
        .map((c, idx) => {
          const base = {
            '#': idx + 1,
            type: c.trackId,
            id: c.id,
            start: +c.start.toFixed(2),
            end: +c.end.toFixed(2),
            dur: +(c.end - c.start).toFixed(2),
            lane: c.lane,
          };
          if (c.trackId === 'tts') {
            const ts = c as TTSClip;
            return { ...base, content: (ts.text || '').slice(0, 20), voice: ts.voice, hasAudio: !!ts.audioSrc };
          }
          if (c.trackId === 'caption') {
            const cc = c as CaptionClip;
            return { ...base, content: (cc.text || '').slice(0, 20), style: cc.style ?? '-' };
          }
          if (c.trackId === 'bgm') {
            const bc = c as BGMClip;
            return { ...base, content: bc.name, vol: bc.volume };
          }
          if (c.trackId === 'image') {
            const ic = c as ImageClip;
            return { ...base, content: (ic.label || '图').slice(0, 16), fx: ic.fx ?? 'none' };
          }
          if (c.trackId === 'fx') {
            const fc = c as FXClip;
            return { ...base, content: fc.fx, bind: fc.targetClipId ?? '-' };
          }
          return base;
        });
      // eslint-disable-next-line no-console
      console.log(`🎬 ===== Project ${project.duration.toFixed(1)}s · ${project.clips.length} clips =====`);
      // eslint-disable-next-line no-console
      console.table(rows);
      try {
        void navigator.clipboard.writeText(JSON.stringify(rows, null, 2));
        toast.success(`🎬 已 dump ${rows.length} clips → console + 剪贴板`);
      } catch {
        toast.success(`🎬 已 dump ${rows.length} clips → console`);
      }
    };

    // 导出当前 project 为 TS 模板代码 (可粘到 source 作为预设模板)
    const dumpTemplate = () => {
      const tmpl = {
        duration: project.duration,
        lanes: project.lanes,
        clips: project.clips.map(c => {
          // 去掉运行时大字段 (audioSrc dataURL 会污染代码)
          const cleaned = { ...c } as Record<string, unknown>;
          delete cleaned.audioSrc;
          delete cleaned.genFailed;
          if (c.trackId === 'image') {
            // src 太长, 只保留 label 跟相对路径
            const ic = c as ImageClip;
            cleaned.src = ic.src?.startsWith('data:') ? '<dataURL>' : ic.src;
          }
          return cleaned;
        }),
      };
      const code = `// 模板 · ${new Date().toISOString().slice(0, 19).replace('T', ' ')}\nconst TEMPLATE = ${JSON.stringify(tmpl, null, 2)};`;
      // eslint-disable-next-line no-console
      console.log('📋 ===== Template TS Code =====');
      // eslint-disable-next-line no-console
      console.log(code);
      try {
        void navigator.clipboard.writeText(code);
        toast.success('📋 模板代码 → 剪贴板 (可粘到 source 作为预设)');
      } catch {
        toast.success('📋 模板代码 → console');
      }
    };

    const win = window as unknown as { __dumpTTS?: () => void; __dumpProject?: () => void; __dumpTemplate?: () => void };
    win.__dumpTTS = dump;
    win.__dumpProject = dumpProject;
    win.__dumpTemplate = dumpTemplate;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.code === 'KeyD' || e.key === 'D' || e.key === 'd')) {
        e.preventDefault();
        dump();
      }
      if (e.ctrlKey && e.shiftKey && (e.code === 'KeyP' || e.key === 'P' || e.key === 'p')) {
        e.preventDefault();
        dumpProject();
      }
      if (e.ctrlKey && e.shiftKey && (e.code === 'KeyT' || e.key === 'T' || e.key === 't')) {
        e.preventDefault();
        dumpTemplate();
      }
    };
    window.addEventListener('keydown', onKey);
    // eslint-disable-next-line no-console
    console.log('🔬 DEV: Ctrl+Shift+D 全 TTS · Ctrl+Shift+P 全 project · Ctrl+Shift+T 模板代码');
    return () => {
      window.removeEventListener('keydown', onKey);
      delete win.__dumpTTS; delete win.__dumpProject; delete win.__dumpTemplate;
    };
  }, [project.clips, project.duration, project.lanes]);

  // FIX #8a: 切到其他板块时 (AnimateMode unmount), audio 还在响 — destroyAll 彻底销毁
  useEffect(() => () => {
    audioEngine.destroyAll();
  }, []);

  // Transport loop
  const rafRef = useRef<number | null>(null);
  const lastTimeRef = useRef(0);
  const spokenRef = useRef<Set<string>>(new Set());
  const bgmStartedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!isPlaying) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      audioEngine.cancelAll();
      spokenRef.current.clear();
      bgmStartedRef.current.clear();
      return;
    }
    lastTimeRef.current = performance.now();
    function tick(now: number) {
      const dt = (now - lastTimeRef.current) / 1000;
      lastTimeRef.current = now;
      setPlayhead(p => {
        const np = p + dt;
        if (np >= project.duration) {
          setIsPlaying(false);
          return project.duration;
        }
        return np;
      });
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [isPlaying, project.duration]);
  // TTS / BGM 同步 — 两条路径:
  //   有 audioSrc: syncTTSPlayer 严格跟 playhead 绑 (1s/2s/3s 听到对应字, 可导出 MP4 真音轨)
  //   没 audioSrc 且 genFailed: SS 触发式 fallback (无 sync 但有声)
  //   没 audioSrc 也没 fail: auto-gen pending — 静默等 (v23-k: 不再 SS 兜底, 避免 audio gen 完后双响)
  useEffect(() => {
    for (const c of project.clips) {
      if (c.trackId === 'tts') {
        const ts = c as TTSClip;
        if (ts.audioSrc) {
          // v23-k: 之前 SS 跑过 + 现在 audio 出现 → 强 cancel SS, 让 audio 独占
          if (spokenRef.current.has(ts.id)) {
            try { audioEngine.cancel(); } catch {}
            spokenRef.current.delete(ts.id);
          }
          const rate = VOICE_BY_ID[resolveVoiceId(ts.voice)]?.playbackRate ?? 1.0;
          audioEngine.syncTTSPlayer(ts.id, ts.audioSrc, playhead, ts.start, isPlaying, 1.0, rate);
        } else if (ts.genFailed && isPlaying && playhead >= ts.start && playhead < ts.end && !spokenRef.current.has(ts.id)) {
          // v23-k: 仅 auto-gen 已确认失败时才 SS fallback (避免 gen pending 时双响)
          spokenRef.current.add(ts.id);
          const v = VOICE_BY_ID[resolveVoiceId(ts.voice)];
          audioEngine.speak(ts.text, v);
        }
      }
      if (c.trackId === 'bgm') {
        const b = resolveBGM(c.bgmId, userBGMsRef.current);
        if (b?.kind === 'file' && b.src) {
          // 用户上传 mp3: 走 sync 模式, audio.currentTime 跟 playhead 严格绑
          audioEngine.syncUserBGMPlayer(c.id, b.src, playhead, c.start, isPlaying, c.volume ?? 0.5);
        } else if (isPlaying) {
          // 内置 synth BGM: 触发模式 (osc 排队跑)
          if (playhead >= c.start && playhead < c.end && !bgmStartedRef.current.has(c.id)) {
            bgmStartedRef.current.add(c.id);
            if (b) playBGM(b, c.volume ?? 0.5, c.end - playhead);
          }
          if (playhead >= c.end && bgmStartedRef.current.has(c.id)) {
            bgmStartedRef.current.delete(c.id);
            audioEngine.stopBGM();
          }
        }
      }
    }
  }, [playhead, isPlaying, project.clips]);
  const seekPlayhead = useCallback((t: number) => {
    // SS 不能 seek (一次性 trigger), 取消 + 重置 spokenRef
    try { audioEngine.cancel(); } catch {}
    audioEngine.stopBGM();
    spokenRef.current.clear();
    bgmStartedRef.current.clear();
    project.clips.forEach(c => {
      if (c.trackId === 'tts' && t > c.end) spokenRef.current.add(c.id);
      if (c.trackId === 'bgm' && t > c.end) bgmStartedRef.current.add(c.id);
    });
    // TTS audioSrc: syncTo 新 t (拖动条立即跳字)
    for (const c of project.clips) {
      if (c.trackId === 'tts') {
        const ts = c as TTSClip;
        if (ts.audioSrc) {
          const rate = VOICE_BY_ID[resolveVoiceId(ts.voice)]?.playbackRate ?? 1.0;
          audioEngine.syncTTSPlayer(ts.id, ts.audioSrc, t, ts.start, false, 1.0, rate);
        }
      }
    }
    setPlayhead(t);
  }, [project.clips]);

  // Ops
  const addClip = useCallback((c: Clip) => {
    commit(p => ({ ...p, clips: [...p.clips, c] }));
    setSelectedId(c.id);
  }, [commit]);
  // v23-k: 批量 add + auto-link (caption ⇌ tts 配对生成)
  const addClipsBatch = useCallback((newClips: Clip[]) => {
    commit(p => ({ ...p, clips: [...p.clips, ...newClips] }));
    if (newClips.length > 0) setSelectedId(newClips[0].id);
  }, [commit]);
  // v23-e: caption ⇌ tts link sync — caption.start/end/text 改 → linkedTTSId 同步; tts.start/end 改 → linkedCaptionId 同步
  // 抽 helper, updateClipLive / updateClipCommit 都用 (drag 实时也同步)
  const applyLinkedSync = (clips: Clip[], id: string, patch: Record<string, unknown>): Clip[] => {
    const updated = clips.find(c => c.id === id);
    if (!updated) return clips;
    if (updated.trackId === 'caption' && (updated as CaptionClip).linkedTTSId) {
      const sync: Record<string, unknown> = {};
      if ('start' in patch) sync.start = patch.start;
      if ('end' in patch) sync.end = patch.end;
      if ('text' in patch) sync.text = patch.text; // caption text 改 → tts.text 跟 (auto-regen audio)
      if (Object.keys(sync).length > 0) {
        const ttsId = (updated as CaptionClip).linkedTTSId!;
        // text 改时清 audioSrc 让 tts auto-gen 重跑
        if ('text' in sync) { sync.audioSrc = undefined; sync.audioEngine = undefined; sync.genFailed = false; }
        return clips.map(c => c.id === ttsId ? ({ ...c, ...sync } as Clip) : c);
      }
    }
    if (updated.trackId === 'tts' && (updated as TTSClip).linkedCaptionId) {
      const sync: Record<string, unknown> = {};
      if ('start' in patch) sync.start = patch.start;
      if ('end' in patch) sync.end = patch.end;
      // tts.text 改不强同步到 caption (用户可能想短字幕 + 长台词)
      if (Object.keys(sync).length > 0) {
        const capId = (updated as TTSClip).linkedCaptionId!;
        return clips.map(c => c.id === capId ? ({ ...c, ...sync } as Clip) : c);
      }
    }
    return clips;
  };
  const updateClipLive = useCallback((id: string, patch: Record<string, unknown>) => {
    setProjectLive(p => {
      let clips = p.clips.map(c => c.id === id ? ({ ...c, ...patch } as Clip) : c);
      clips = applyLinkedSync(clips, id, patch);
      return { ...p, clips };
    });
  }, [setProjectLive]);
  const updateClipCommit = useCallback((id: string, patch: Record<string, unknown>) => {
    commit(p => {
      let clips = p.clips.map(c => c.id === id ? ({ ...c, ...patch } as Clip) : c);
      clips = applyLinkedSync(clips, id, patch);
      return { ...p, clips };
    });
  }, [commit]);
  // v23-e: 建/解 caption-tts link (双向 link 同时 set)
  const linkCaptionTTS = useCallback((capId: string, ttsId: string) => {
    commit(p => ({
      ...p,
      clips: p.clips.map(c => {
        if (c.id === capId && c.trackId === 'caption') return { ...c, linkedTTSId: ttsId } as Clip;
        if (c.id === ttsId && c.trackId === 'tts') return { ...c, linkedCaptionId: capId } as Clip;
        return c;
      }),
    }));
  }, [commit]);
  const unlinkCaptionTTS = useCallback((id: string) => {
    commit(p => {
      const c = p.clips.find(x => x.id === id);
      if (!c) return p;
      const partnerId = c.trackId === 'caption' ? (c as CaptionClip).linkedTTSId : c.trackId === 'tts' ? (c as TTSClip).linkedCaptionId : undefined;
      return {
        ...p,
        clips: p.clips.map(x => {
          if (x.id === id) {
            if (x.trackId === 'caption') return { ...x, linkedTTSId: undefined } as Clip;
            if (x.trackId === 'tts') return { ...x, linkedCaptionId: undefined } as Clip;
          }
          if (partnerId && x.id === partnerId) {
            if (x.trackId === 'caption') return { ...x, linkedTTSId: undefined } as Clip;
            if (x.trackId === 'tts') return { ...x, linkedCaptionId: undefined } as Clip;
          }
          return x;
        }),
      };
    });
  }, [commit]);
  const patchSelected = useCallback((patch: Record<string, unknown>) => {
    if (!selectedId) return;
    updateClipCommit(selectedId, patch);
  }, [selectedId, updateClipCommit]);
  const patchSelectedTransform = useCallback((tPatch: Partial<Transform>) => {
    if (!selectedId) return;
    commit(p => ({
      ...p,
      clips: p.clips.map(c => {
        if (c.id !== selectedId) return c;
        if (c.trackId === 'image') {
          const cur = c.transform ?? DEFAULT_TRANSFORM;
          return { ...c, transform: { ...cur, ...tPatch } } as ImageClip;
        }
        if (c.trackId === 'caption') {
          const cur = (c as CaptionClip).transform ?? DEFAULT_CAPTION_TRANSFORM;
          return { ...c, transform: { x: tPatch.x ?? cur.x, y: tPatch.y ?? cur.y } } as CaptionClip;
        }
        return c;
      }),
    }));
  }, [selectedId, commit]);
  // 通用 transform update: image 用完整 Transform, caption 只用 x/y
  const updateTransformLive = useCallback((id: string, tPatch: Partial<Transform>) => {
    setProjectLive(p => ({
      ...p,
      clips: p.clips.map(c => {
        if (c.id !== id) return c;
        if (c.trackId === 'image') {
          const cur = c.transform ?? DEFAULT_TRANSFORM;
          return { ...c, transform: { ...cur, ...tPatch } } as ImageClip;
        }
        if (c.trackId === 'caption') {
          const cur = (c as CaptionClip).transform ?? DEFAULT_CAPTION_TRANSFORM;
          return { ...c, transform: { x: tPatch.x ?? cur.x, y: tPatch.y ?? cur.y } } as CaptionClip;
        }
        return c;
      }),
    }));
  }, [setProjectLive]);
  const deleteClip = useCallback((id: string) => {
    commit(p => {
      const clips = p.clips.filter(c => c.id !== id);
      // 删 clip 后, 收掉每 type 末尾的空 lane (保留 >= 1) — 不让用户看到无用空轨
      const lanes = { ...p.lanes };
      (Object.keys(lanes) as TrackType[]).forEach(t => {
        let n = lanes[t];
        while (n > 1 && !clips.some(c => c.trackId === t && c.lane === n - 1)) n--;
        lanes[t] = n;
      });
      return { ...p, clips, lanes };
    });
    if (selectedId === id) setSelectedId(null);
    toast.success('已删除片段');
  }, [commit, selectedId]);

  // 图层拖动改 z-order — 交换两个 image/caption clip 的 lane (高 lane 盖低 lane)
  // v23-i: insertion-based reorder — 修用户痛点 "调图层顺序无变化" (之前是 swap, 同 lane 时不变)
  const reorderLayer = useCallback((draggedId: string, targetId: string) => {
    commit(p => {
      const a = p.clips.find(c => c.id === draggedId);
      const b = p.clips.find(c => c.id === targetId);
      if (!a || !b || a.trackId !== b.trackId || a.id === b.id) return p;
      const sameType = p.clips.filter(c => c.trackId === a.trackId).sort((x, y) => x.lane - y.lane);
      const aIdx = sameType.findIndex(c => c.id === a.id);
      const bIdx = sameType.findIndex(c => c.id === b.id);
      if (aIdx === -1 || bIdx === -1) return p;
      const reordered = [...sameType];
      const [moved] = reordered.splice(aIdx, 1);
      reordered.splice(bIdx, 0, moved);
      // 重排 lane index 0..N-1
      const laneMap = new Map<string, number>();
      reordered.forEach((c, i) => laneMap.set(c.id, i));
      const newClips = p.clips.map(c => {
        const ln = laneMap.get(c.id);
        if (ln === undefined) return c;
        return { ...c, lane: ln } as Clip;
      });
      const lanes = { ...p.lanes };
      if (reordered.length > lanes[a.trackId]) lanes[a.trackId] = reordered.length;
      return { ...p, clips: newClips, lanes };
    });
    toast.success('已调整图层顺序');
  }, [commit]);

  // 一键整理 — 收所有 type 末尾的空 lane (保留 >= 1)
  const compactLanes = useCallback(() => {
    commit(p => {
      const lanes = { ...p.lanes };
      let changed = false;
      (Object.keys(lanes) as TrackType[]).forEach(t => {
        let n = lanes[t];
        while (n > 1 && !p.clips.some(c => c.trackId === t && c.lane === n - 1)) {
          n--; changed = true;
        }
        lanes[t] = n;
      });
      if (!changed) return p;
      return { ...p, lanes };
    });
    toast.success('已整理空轨');
  }, [commit]);

  // 全平 — 把所有 image/caption/fx 等 clip 重排到 lane 0, 按 start 时序接龙
  // 用于救救已经被多 lane 顶穿的 broken project (用户截图里 7 image lane 的场景)
  const flattenToMainTrack = useCallback(() => {
    commit(p => {
      const newClips: Clip[] = [];
      const types: TrackType[] = ['image', 'caption', 'fx', 'tts', 'bgm'];
      for (const t of types) {
        const typeClips = p.clips
          .filter(c => c.trackId === t)
          .sort((a, b) => a.start - b.start);
        let cursor = 0;
        for (const c of typeClips) {
          // 接龙: 这个 clip 保持原长度, 但 start 接前一个的 end
          const dur = c.end - c.start;
          let newStart = Math.max(cursor, c.start);
          // 如果跟前一个重叠 → 推到末尾
          if (newStart < cursor) newStart = cursor;
          const newEnd = Math.min(p.duration, newStart + dur);
          if (newEnd <= newStart) continue; // 放不下了, 跳过
          newClips.push({ ...c, lane: 0, start: newStart, end: newEnd } as Clip);
          cursor = newEnd;
        }
      }
      return {
        ...p,
        clips: newClips,
        lanes: { image: 1, caption: 1, fx: 1, tts: 1, bgm: 1 },
      };
    });
    toast.success('已展平到主轨 — 多轨已合并');
  }, [commit]);
  const splitAt = useCallback((id: string, time: number) => {
    const c = project.clips.find(x => x.id === id);
    if (!c) return;
    if (time <= c.start + 0.1 || time >= c.end - 0.1) { toast('切分点太靠边'); return; }
    const aId = c.id;
    const bId = uid(c.trackId[0]);
    commit(p => {
      const newClips = p.clips.map(x => x.id === aId ? ({ ...x, end: time }) as Clip : x);
      const bBase: BaseClip = { id: bId, trackId: c.trackId, lane: c.lane, start: time, end: c.end };
      let bClip: Clip;
      if (c.trackId === 'image') bClip = { ...bBase, trackId: 'image', src: c.src, label: c.label, fx: c.fx, transform: c.transform ? { ...c.transform } : { ...DEFAULT_TRANSFORM } };
      else if (c.trackId === 'caption') bClip = { ...bBase, trackId: 'caption', text: c.text, fontSize: c.fontSize, color: c.color, style: c.style, transform: c.transform };
      else if (c.trackId === 'fx') bClip = { ...bBase, trackId: 'fx', fx: c.fx, targetClipId: c.targetClipId };
      else if (c.trackId === 'tts') bClip = { ...bBase, trackId: 'tts', text: c.text, voice: c.voice, audioSrc: c.audioSrc };
      else bClip = { ...bBase, trackId: 'bgm', bgmId: c.bgmId, name: c.name, volume: c.volume };
      newClips.push(bClip);
      return { ...p, clips: newClips };
    });
    setSelectedId(aId);
    toast.success('已切分为两段');
  }, [commit, project]);
  const duplicateClip = useCallback((id: string) => {
    const c = project.clips.find(x => x.id === id);
    if (!c) return;
    const dur = c.end - c.start;
    const newId = uid(c.trackId[0]);
    const newStart = Math.min(project.duration - dur, c.end);
    const newEnd = newStart + dur;
    commit(p => {
      const baseDup: BaseClip = { id: newId, trackId: c.trackId, lane: c.lane, start: newStart, end: newEnd };
      let dup: Clip;
      if (c.trackId === 'image') dup = { ...baseDup, trackId: 'image', src: c.src, label: c.label, caption: c.caption, fx: c.fx, transform: c.transform ? { ...c.transform } : { ...DEFAULT_TRANSFORM } };
      else if (c.trackId === 'caption') dup = { ...baseDup, trackId: 'caption', text: c.text, fontSize: c.fontSize, color: c.color, style: c.style, transform: c.transform };
      else if (c.trackId === 'fx') dup = { ...baseDup, trackId: 'fx', fx: c.fx, targetClipId: c.targetClipId };
      else if (c.trackId === 'tts') dup = { ...baseDup, trackId: 'tts', text: c.text, voice: c.voice, audioSrc: c.audioSrc };
      else dup = { ...baseDup, trackId: 'bgm', bgmId: c.bgmId, name: c.name, volume: c.volume };
      return { ...p, clips: [...p.clips, dup] };
    });
    setSelectedId(newId);
    toast.success('已复制片段');
  }, [commit, project]);
  // v23-b: dir=+1 越界自动 add lane (用户痛点 "无法改变图层" — 之前 disabled)
  const moveClipLane = useCallback((id: string, dir: -1 | 1) => {
    const c = project.clips.find(x => x.id === id);
    if (!c) return;
    const newLane = c.lane + dir;
    if (newLane < 0) { toast('已是顶轨'); return; }
    const max = project.lanes[c.trackId] - 1;
    if (newLane > max) {
      // 自动加一条新 lane 把 clip 放过去
      commit(p => ({
        ...p,
        lanes: { ...p.lanes, [c.trackId]: p.lanes[c.trackId] + 1 },
        clips: p.clips.map(x => x.id === id ? ({ ...x, lane: newLane }) as Clip : x),
      }));
      toast.success(`已下移到新轨 (${TRACK_META[c.trackId].name} ${newLane + 1})`);
      return;
    }
    updateClipCommit(id, { lane: newLane });
  }, [project, updateClipCommit, commit]);
  // v23-b: 直接 set lane 到具体 index (Inspector lane Field 用)
  const setClipLane = useCallback((id: string, targetLane: number) => {
    const c = project.clips.find(x => x.id === id);
    if (!c) return;
    if (targetLane < 0) return;
    const max = project.lanes[c.trackId] - 1;
    if (targetLane > max) {
      commit(p => ({
        ...p,
        lanes: { ...p.lanes, [c.trackId]: targetLane + 1 },
        clips: p.clips.map(x => x.id === id ? ({ ...x, lane: targetLane }) as Clip : x),
      }));
      return;
    }
    updateClipCommit(id, { lane: targetLane });
  }, [project, updateClipCommit, commit]);
  const addLane = useCallback((type: TrackType) => {
    commit(p => ({ ...p, lanes: { ...p.lanes, [type]: p.lanes[type] + 1 } }));
  }, [commit]);
  const removeLane = useCallback((type: TrackType, lane: number) => {
    const used = project.clips.some(c => c.trackId === type && c.lane === lane);
    if (used) { toast.error('该轨道还有片段, 不能删'); return; }
    if (project.lanes[type] <= 1) { toast('至少保留 1 条轨道'); return; }
    commit(p => ({
      ...p,
      lanes: { ...p.lanes, [type]: p.lanes[type] - 1 },
      clips: p.clips.map(c => c.trackId === type && c.lane > lane ? ({ ...c, lane: c.lane - 1 }) as Clip : c),
    }));
  }, [commit, project]);
  const setDuration = useCallback((d: number) => {
    commit(p => ({ ...p, duration: Math.max(1, Math.round(d * 10) / 10) }));
  }, [commit]);
  const extendDuration = useCallback((delta: number) => {
    commit(p => ({ ...p, duration: Math.min(60, p.duration + delta) }));
    toast(`时长已加长 ${delta}s`);
  }, [commit]);
  const clearAll = useCallback(() => {
    // 清空 = 清 clips + 重置 lanes 到全 1 (傻瓜式默认)
    commit(p => ({ ...p, clips: [], lanes: { image: 1, caption: 1, fx: 1, tts: 1, bgm: 1 } }));
    setSelectedId(null);
    setPlayhead(0);
    audioEngine.cancelAll();
    toast('时间轴已清空');
  }, [commit]);
  const nudge = useCallback((id: string, delta: number) => {
    const c = project.clips.find(x => x.id === id);
    if (!c) return;
    const dur = c.end - c.start;
    const newStart = clamp(c.start + delta, 0, project.duration - dur);
    updateClipCommit(id, { start: newStart, end: newStart + dur });
  }, [project, updateClipCommit]);
  const randomize = useCallback(async () => {
    const lines = ['家人们谁懂啊', '我直接裂开', '但我装作很淡定', '我可太牛了', '麻了麻了', '让你装！', '别问 问就是不知道', '你礼貌吗', '6 兄弟 6', '今天也要努力摸鱼'];
    const fxs: ImageFx[] = ['none', 'none', 'shake', 'zoom', 'flash'];
    const voices = VOICE_LIB.filter(v => v.lang.startsWith('zh')).map(v => v.id);
    const segs = 4;
    const ttsGap = 1.0; // 每段 TTS 后预留 1s 间隔 (剪映风格连贯感)
    const initialOffset = 0.3; // 第一段从 0.3s 开始 (头部留白)
    const ts = Date.now();
    const tid = toast.loading('随机生成中 (panda+face 合成…)');
    try {
      const composedImages = await Promise.all(
        Array.from({ length: segs }, async () => {
          const p = ALL_PANDAS[Math.floor(Math.random() * ALL_PANDAS.length)];
          const f = ALL_FACES[Math.floor(Math.random() * ALL_FACES.length)];
          const src = await composeMeme({
            pandaSrc: p.src,
            faceSrc: f.src,
            faceOffset: getLivePandaFaceOffset(p),
            size: 384,
            outputFormat: 'dataurl',
            fillInternalShell: true, // 沙雕动画: panda 内部填白 防场景透出
          });
          return { src, label: `${p.labelCn}+${f.labelCn}` };
        }),
      );
      const next: Clip[] = [];
      let cursor = initialOffset;
      for (let i = 0; i < segs; i++) {
        const line = lines[Math.floor(Math.random() * lines.length)];
        const voice = voices[Math.floor(Math.random() * voices.length)];
        const ttsDur = estimateTTSDuration(line, voice);
        const segStart = cursor;
        const ttsEnd = segStart + ttsDur;
        const segEnd = ttsEnd + ttsGap;
        const imageId = `ri${i}-${ts}`;
        next.push({
          id: imageId, trackId: 'image', lane: 0,
          start: segStart, end: segEnd,
          src: composedImages[i].src, label: composedImages[i].label,
          fx: 'none',  // FX 单独创建到 FX 轨, 时间轴可见可调
          transform: { ...DEFAULT_TRANSFORM },
        });
        next.push({
          id: `rc${i}-${ts}`, trackId: 'caption', lane: 0,
          start: segStart, end: ttsEnd, text: line,
        });
        next.push({
          id: `rt${i}-${ts}`, trackId: 'tts', lane: 0,
          start: segStart, end: ttsEnd, text: line, voice,
        });
        // FX clip 到 FX 轨 (时间轴可见, 右侧可调时长 / 类型). 跳 'none' 避免空 fx clip
        const fxPick = fxs[Math.floor(Math.random() * fxs.length)];
        if (fxPick !== 'none') {
          const fxInfo = FX_LIB.find(f => f.id === fxPick);
          const fxDur = Math.min(ttsDur, fxInfo?.defaultDuration ?? 0.8);
          next.push({
            id: `rfx${i}-${ts}`, trackId: 'fx', lane: 0,
            start: segStart, end: segStart + fxDur,
            fx: fxPick, targetClipId: imageId,
          });
        }
        cursor = segEnd;
      }
      // 总时长自适应 (最少 8s, 防 clip 顶不下)
      const totalDur = Math.max(cursor, 8);
      const bgm = BGM_LIB[Math.floor(Math.random() * BGM_LIB.length)];
      next.push({
        id: `rb-${ts}`, trackId: 'bgm', lane: 0, start: 0, end: totalDur,
        bgmId: bgm.id, name: bgm.name, volume: 0.5,
      });
      // FIX: 之前 commit(() => ({...})) 丢 mode/gifPresetId. 现 explicit 构造完整 ProjectState 保留 schema.
      const newProject: ProjectState = {
        duration: totalDur,
        lanes: { image: 1, caption: 1, fx: 1, tts: 1, bgm: 1 },
        clips: next,
        mode: project.mode ?? 'video',
        gifPresetId: project.gifPresetId,
      };
      commit(() => newProject);
      // 清旧 audio players Map (避免 stale clipId 的 player 残留 + 内存 leak)
      audioEngine.destroyAll();
      // 立即写 IDB — 不等 debounce, 防"用户立即刷新"丢数据 (v24: 按当前 mode 写对应 key)
      void idbSet(getCurrentIdbKey(newProject.mode), newProject).catch(() => {});
      setSelectedId(null);
      setPlayhead(0);
      toast.dismiss(tid);
      toast.success(`已生成 4 段配套熊猫头 · 总时长 ${totalDur.toFixed(1)}s · 段间 1s`);
    } catch (e) {
      toast.dismiss(tid);
      toast.error('随机生成失败: ' + (e as Error).message);
    }
  }, [commit, project]);
  const quickAdd = useCallback((payload: DragPayload) => {
    const dur = payload.defaultDuration ?? 2.5;
    const type = payload.type;
    let start: number, end: number, lane: number;
    // 场景 — 新开 image lane 独立放置 (lane = project.lanes.image), 从 playhead 开始
    // 不跟普通 image 接末尾, 让 scene 像剪映"背景轨"独立 timeline
    if (type === 'image' && payload.kind === 'scene') {
      const newLane = project.lanes.image;
      start = Math.max(0, Math.min(playhead, project.duration - dur));
      end = Math.min(project.duration, start + dur);
      lane = newLane;
      commit(p => ({ ...p, lanes: { ...p.lanes, image: newLane + 1 } }));
    } else if (type === 'caption') {
      const flex = findFlexibleSlotForCaption(project.clips, playhead, dur, project.duration);
      start = flex.start; end = flex.end; lane = flex.lane;
      if (lane > project.lanes.caption - 1) {
        commit(p => ({ ...p, lanes: { ...p.lanes, caption: lane + 1 } }));
      }
    } else {
      const slot = findNextSlotOnLane0(type, project.clips, playhead, dur, project.duration);
      if (!slot) {
        toast.error(`时长 ${project.duration.toFixed(1)}s 内放不下, 请用 ⏱ 加长时长 / 或拖到指定轨叠加`);
        return;
      }
      start = slot.start; end = slot.end; lane = 0;
    }
    const id = uid(type[0]);
    let clip: Clip;
    if (type === 'image') clip = {
      id, trackId: 'image', lane, start, end,
      src: payload.src!, label: payload.label || '图片',
      // scene 默认配 ken-burns 运镜, 否则 none
      // v23-i: scene 默认 fx='none' (用户痛点: 删 FX 后场景仍动是 ken-burns 残留). 想运镜 → 主动加 FX clip
      fx: 'none',
      transform: { ...DEFAULT_TRANSFORM },
      kind: payload.kind === 'scene' ? 'scene' : undefined,
    };
    else if (type === 'caption') clip = {
      id, trackId: 'caption', lane, start, end,
      text: payload.text || '点击编辑字幕',
      style: payload.captionStyle ?? DEFAULT_CAPTION_STYLE,
      fontSize: payload.captionFontSize,
      color: payload.captionColor,
    };
    else if (type === 'fx') {
      const sel = selectedId ? project.clips.find(c => c.id === selectedId) : null;
      const fxKind = payload.fx || 'shake';
      // v23-h: 找 target image — 优先选中的 image
      // v23-k: 修默认 target — 优先非 scene (= panda/face) + lane 最低 (= 视觉最顶层)
      let targetImage: ImageClip | undefined = sel?.trackId === 'image' ? (sel as ImageClip) : undefined;
      if (!targetImage) {
        const ph = playhead;
        const candidates = project.clips.filter(c => c.trackId === 'image' && ph >= c.start && ph < c.end) as ImageClip[];
        targetImage = candidates.length > 0
          ? candidates.sort((a, b) => {
              const aScene = a.kind === 'scene' ? 1 : 0;
              const bScene = b.kind === 'scene' ? 1 : 0;
              if (aScene !== bScene) return aScene - bScene;  // 非 scene 先
              return a.lane - b.lane;                          // lane 低 (顶层) 先
            })[0]
          : undefined;
      }
      const targetTr = targetImage?.transform ?? DEFAULT_TRANSFORM;
      const fxBase: FXClip = { id, trackId: 'fx', lane, start, end, fx: fxKind, targetClipId: targetImage?.id };
      // v23-j (phase 2): 按 fx.id 初始化 defaults
      initFXDefaults(fxBase, targetTr);
      if (fxKind === 'move') {
        toast.success('已加入移动动画 · 在画板上拖 A/B 圆圈设位置', { duration: 4000 });
      } else if (targetImage) {
        toast.success(`已加 ${FX_LIB.find(f => f.id === fxKind)?.name || fxKind} · 作用于 ${targetImage.label || '图片'}${targetImage.kind === 'scene' ? ' (场景)' : ''} · Inspector 可改对象`, { duration: 3500 });
      }
      clip = fxBase;
    }
    else if (type === 'tts') {
      const ttsVoice = resolveVoiceId(payload.voice || VOICE_LIB[0].id);
      const ttsText = payload.text || '点击编辑文字';
      const ttsDur = estimateTTSDuration(ttsText, ttsVoice);
      const ttsEnd = Math.min(project.duration, start + ttsDur);
      clip = { id, trackId: 'tts', lane, start, end: ttsEnd, text: ttsText, voice: ttsVoice };
    }
    else {
      // BGM: 查 userBGMs (用户上传) + BGM_LIB (内置, 含 bgm-jigou) + 运行时探测 cache
      const userBgm = userBGMsRef.current.find(b => b.id === payload.bgmId);
      const libBgm = BGM_BY_ID[payload.bgmId!];
      const bgmRef = userBgm ?? libBgm;
      let bgmEnd = end;
      if (bgmRef?.kind === 'file') {
        const realDur = bgmRef.durationSec ?? _bgmDurationCache.get(bgmRef.id);
        if (realDur) bgmEnd = Math.min(project.duration, start + realDur);
      }
      clip = { id, trackId: 'bgm', lane, start, end: bgmEnd, bgmId: payload.bgmId!, name: payload.name || 'BGM', volume: 0.5 };
    }
    // 用 functional setState 防 race (字幕 path 可能先 commit 了 lanes+1)
    commit(p => ({ ...p, clips: [...p.clips, clip] }));
    setSelectedId(id);
  }, [commit, playhead, project, selectedId]);

  // 把草图拆成 image clip (panda+face / 整图 panda only) + caption clip (text)
  // 解决: 草图收藏时 caption 嵌入到 previewUrl 合成图里, 拖到动画后无法独立调字幕
  // 5 命名空间打通: 内置 panda/face + upload-panda/face + custom-face + network-panda/face + custom-panda (整图)
  const addDraftAsClips = useCallback(async (slot: DraftSlot) => {
    const elements = slot.state?.elements ?? [];
    const isPandaName = (n: string | undefined) => !!n && (
      ALL_PANDAS.some(p => p.id === n)
      || n.startsWith('upload-panda-')
      || n.startsWith('network-panda-')
      || n.startsWith('custom-panda-')
    );
    const isFaceName = (n: string | undefined) => !!n && (
      ALL_FACES.some(f => f.id === n)
      || n.startsWith('upload-face-')
      || n.startsWith('custom-face-')
      || n.startsWith('network-face-')
    );
    const pandaEl = elements.find((e): e is ImageElement => e.type === 'image' && isPandaName((e as ImageElement).name));
    const faceEl = elements.find((e): e is ImageElement => e.type === 'image' && isFaceName((e as ImageElement).name));
    const textEl = elements.find((e): e is TextElement => e.type === 'text');

    // 决定 imgSrc 优先级:
    // 1. panda + face 双件 → composeMeme 合成无字幕高清图
    // 2. panda 整图 (no face, e.g. network-panda-* / custom-panda-* / upload-panda-* 整图) → 直接用 panda.src (dataURL 全尺寸)
    // 3. fallback → slot.previewUrl (220x220 缩略)
    let imgSrc = slot.previewUrl;
    if (pandaEl && faceEl) {
      // 内置 panda 查 meta 拿 faceOffset; 非内置 panda 用整图 fallback (避免硬编码 faceOffset 合成丑) (audit-recent MED-2h)
      const pandaMeta = ALL_PANDAS.find(p => p.id === pandaEl.name);
      if (pandaMeta) {
        try {
          imgSrc = await composeMeme({
            pandaSrc: pandaMeta.src,
            faceSrc: faceEl.src,
            faceOffset: getLivePandaFaceOffset(pandaMeta),
            size: 384, outputFormat: 'dataurl',
            fillInternalShell: true,
          });
        } catch { /* 落败用 previewUrl */ }
      } else {
        // 非内置 panda (upload/network/custom) + face: 整图 fallback (face 数据保留在编辑器, timeline 上呈现整图)
        imgSrc = pandaEl.src;
      }
    } else if (pandaEl && !faceEl) {
      // 整图模式 — panda 自身就是完整作品 (网图 / 上传整图 / 自制整图)
      imgSrc = pandaEl.src;
    }

    // 傻瓜式 — lane 0 接末尾 (跟剪映/CapCut 一致). 不再每次开新 lane (旧 bug 根因)
    const dur = 2.8;
    const imgSlot = findNextSlotOnLane0('image', project.clips, playhead, dur, project.duration);
    if (!imgSlot) {
      toast.error(`时长 ${project.duration.toFixed(1)}s 内放不下, 请用 ⏱ 加长视频时长`);
      return;
    }
    const { start, end } = imgSlot;
    const imageClip: ImageClip = {
      id: uid('di'), trackId: 'image', lane: 0, start, end,
      src: imgSrc, label: slot.name || '草图',
      fx: 'none', transform: { ...DEFAULT_TRANSFORM },
    };
    const newClips: Clip[] = [imageClip];
    const text = textEl?.text?.trim();
    if (text) {
      // caption 跟 image 同 time range, 也走 lane 0 接末尾 (上面 image 占了 [start, end] 这段)
      // caption 不冲突 image, 但跟现有 caption 可能冲突 → 用 findNextSlotOnLane0
      const capSlot = findNextSlotOnLane0('caption', project.clips, start, dur, project.duration);
      if (capSlot) {
        newClips.push({
          id: uid('dc'), trackId: 'caption', lane: 0,
          start: capSlot.start, end: capSlot.end, text,
        });
      }
    }
    commit(p => ({ ...p, clips: [...p.clips, ...newClips] }));
    setSelectedId(imageClip.id);
    toast.success(text ? '已加 画面 + 字幕 双轨' : '已加画面');
  }, [commit, playhead, project]);

  // Drafts (IDB)
  const [drafts, setDrafts] = useState<AnimateDraftSlot[]>([]);
  const draftsLoadedRef = useRef(false);
  useEffect(() => {
    if (draftsLoadedRef.current) return;
    draftsLoadedRef.current = true;
    idbGet<AnimateDraftSlot[]>(AM_DRAFT_IDB_KEY).then(loaded => {
      if (Array.isArray(loaded)) setDrafts(loaded.slice(0, AM_DRAFT_MAX));
    }).catch(() => {});
  }, []);
  const persistDrafts = useCallback((next: AnimateDraftSlot[]) => {
    setDrafts(next);
    idbSet(AM_DRAFT_IDB_KEY, next).catch(() => {});
  }, []);
  const saveCurrentAsDraft = useCallback((name?: string) => {
    // v23-b: 取首张 image clip src 作缩略图 (草稿列表一眼可辨)
    const firstImage = project.clips.find(c => c.trackId === 'image') as ImageClip | undefined;
    const slot: AnimateDraftSlot = {
      id: uid('amd'),
      name: name || `草稿${drafts.length + 1}`,
      updatedAt: Date.now(),
      project: JSON.parse(JSON.stringify(project)),
      thumbSrc: firstImage?.src,
    };
    persistDrafts([slot, ...drafts].slice(0, AM_DRAFT_MAX));
    toast.success(`已保存为 ${slot.name}`);
  }, [project, drafts, persistDrafts]);
  // v23-b: 复制草稿 — 一份变两份, 防直接改后丢原版
  const duplicateDraftAM = useCallback((id: string) => {
    const src = drafts.find(s => s.id === id);
    if (!src) return;
    if (drafts.length >= AM_DRAFT_MAX) { toast.error(`最多 ${AM_DRAFT_MAX} 个草稿, 先删`); return; }
    const slot: AnimateDraftSlot = {
      ...src,
      id: uid('amd'),
      name: `${src.name} 副本`,
      updatedAt: Date.now(),
      project: JSON.parse(JSON.stringify(src.project)),
    };
    persistDrafts([slot, ...drafts].slice(0, AM_DRAFT_MAX));
    toast.success(`已复制 ${src.name}`);
  }, [drafts, persistDrafts]);
  const loadDraft = useCallback((id: string) => {
    const slot = drafts.find(s => s.id === id);
    if (!slot) return;
    // FIX: 走 hydrateProject 统一反序列化 (旧 draft 无 mode/gifPresetId 字段时默认 video, 跟 IDB/JSON import 对齐)
    const hydrated = hydrateProject(slot.project);
    if (!hydrated) {
      toast.error('草稿数据格式无效, 无法加载');
      return;
    }
    audioEngine.destroyAll(); // upgrade cancelAll → destroyAll, 释放旧 clipId 的 player Map
    commit(() => hydrated.project);
    // 立即写 IDB — 防"载入草稿后立即刷新"丢 (v24: 按草稿 mode 写对应 key)
    void idbSet(getCurrentIdbKey(hydrated.project.mode), hydrated.project).catch(() => {});
    setSelectedId(null);
    setPlayhead(0);
    toast.success(`已读入 ${slot.name}${hydrated.cleanedInvalidImages > 0 ? ` · 自动清理 ${hydrated.cleanedInvalidImages} 失效图` : ''}`);
  }, [drafts, commit]);
  const deleteDraft = useCallback((id: string) => {
    persistDrafts(drafts.filter(s => s.id !== id));
    toast.success('已删除草稿');
  }, [drafts, persistDrafts]);
  const renameDraftAM = useCallback((id: string, name: string) => {
    persistDrafts(drafts.map(s => s.id === id ? { ...s, name, updatedAt: Date.now() } : s));
  }, [drafts, persistDrafts]);
  const noteDraftAM = useCallback((id: string, note: string) => {
    persistDrafts(drafts.map(s => s.id === id ? { ...s, note } : s));
  }, [drafts, persistDrafts]);

  // Modals
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [draftPopoverOpen, setDraftPopoverOpen] = useState(false);
  // DEV-only modals (import.meta.env.DEV 控制是否能开 — 按钮 toolbar 内 gate, 这里 state 反正不耗)
  const [templatesModalOpen, setTemplatesModalOpen] = useState(false);
  const [bgmAlignModalOpen, setBgmAlignModalOpen] = useState(false);
  const [stateDumpModalOpen, setStateDumpModalOpen] = useState(false);
  const [shortcutsModalOpen, setShortcutsModalOpen] = useState(false);
  // v23-k Phase A: TTS gen stats — Toolbar status pill 显进度
  const ttsGenStats = useMemo(() => {
    const tts = project.clips.filter((c): c is TTSClip => c.trackId === 'tts' && !!(c as TTSClip).text?.trim());
    const total = tts.length;
    const done = tts.filter(t => !!t.audioSrc).length;
    const failed = tts.filter(t => !!t.genFailed).length;
    const pending = Math.max(0, total - done - failed);
    return { total, done, failed, pending };
  }, [project.clips]);
  const [uploads, setUploads] = useState<Material[]>([]);
  const [userBGMs, setUserBGMs] = useState<BGMPreset[]>([]);
  const userBGMsRef = useRef<BGMPreset[]>([]);
  useEffect(() => { userBGMsRef.current = userBGMs; }, [userBGMs]);
  // 上传素材 + user BGM IDB 持久化 (用户跨刷新保留自建素材/音乐库)
  const uploadsLoadedRef = useRef(false);
  const userBgmsLoadedRef = useRef(false);
  useEffect(() => {
    if (uploadsLoadedRef.current) return;
    uploadsLoadedRef.current = true;
    idbGet<Material[]>(AM_UPLOADS_IDB_KEY).then(loaded => {
      if (Array.isArray(loaded)) setUploads(loaded.slice(0, AM_UPLOAD_MAX_COUNT));
    }).catch(() => {});
  }, []);
  useEffect(() => {
    if (userBgmsLoadedRef.current) return;
    userBgmsLoadedRef.current = true;
    idbGet<BGMPreset[]>(AM_USER_BGMS_IDB_KEY).then(loaded => {
      if (Array.isArray(loaded)) setUserBGMs(loaded.slice(0, AM_USER_BGM_MAX_COUNT));
    }).catch(() => {});
  }, []);
  useEffect(() => {
    if (!uploadsLoadedRef.current) return;
    const t = window.setTimeout(() => {
      void idbSet(AM_UPLOADS_IDB_KEY, uploads).catch(() => {});
    }, 400);
    return () => window.clearTimeout(t);
  }, [uploads]);
  useEffect(() => {
    if (!userBgmsLoadedRef.current) return;
    const t = window.setTimeout(() => {
      void idbSet(AM_USER_BGMS_IDB_KEY, userBGMs).catch(() => {});
    }, 400);
    return () => window.clearTimeout(t);
  }, [userBGMs]);

  const selectedClip = useMemo(
    () => selectedId ? project.clips.find(c => c.id === selectedId) ?? null : null,
    [selectedId, project.clips]
  );

  // 剪贴板 — clip 复制/粘贴 + 右键菜单都用同一个 ref
  // 用 ref (不 state) — paste 拿到的是最新值, 不引发 re-render
  const clipboardRef = useRef<Clip | null>(null);
  const copyClipToClipboard = useCallback((id: string) => {
    const c = project.clips.find(x => x.id === id);
    if (!c) return;
    // deep-clone (avoid live ref into project state)
    clipboardRef.current = JSON.parse(JSON.stringify(c));
    toast.success(`已复制 ${clipDisplayName(c)}`);
  }, [project.clips]);
  const cutClipToClipboard = useCallback((id: string) => {
    const c = project.clips.find(x => x.id === id);
    if (!c) return;
    clipboardRef.current = JSON.parse(JSON.stringify(c));
    deleteClip(id);
    toast.success(`已剪切 ${clipDisplayName(c)}`);
  }, [project.clips, deleteClip]);
  const pasteClipFromClipboard = useCallback(() => {
    const cb = clipboardRef.current;
    if (!cb) { toast.error('剪贴板空'); return; }
    const dur = cb.end - cb.start;
    // 粘贴位置 = 当前 playhead. 跟同类 sameLane clip 冲突则后移
    let pasteStart = playhead;
    const sameLane = project.clips
      .filter(c => c.trackId === cb.trackId && c.lane === cb.lane)
      .sort((a, b) => a.start - b.start);
    for (const c of sameLane) {
      if (pasteStart < c.end && pasteStart + dur > c.start) {
        pasteStart = c.end;
      }
    }
    if (pasteStart + dur > project.duration) {
      // 缩短到 available
      const avail = project.duration - pasteStart;
      if (avail < 0.2) { toast.error('放不下, 加长视频时长'); return; }
    }
    const newId = uid('p');
    const newClip: Clip = { ...JSON.parse(JSON.stringify(cb)), id: newId, start: pasteStart, end: Math.min(project.duration, pasteStart + dur) };
    commit(p => ({ ...p, clips: [...p.clips, newClip] }));
    setSelectedId(newId);
    toast.success(`已粘贴 ${clipDisplayName(cb)}`);
  }, [commit, playhead, project]);
  const selectAllClips = useCallback(() => {
    // 单选只允许选最近 click 的; 但 "全选 → 删" 这种场景, 选第一个 + 提示快捷键继续
    if (project.clips.length === 0) return;
    setSelectedId(project.clips[0].id);
    toast(`本编辑器单选, 删全部请 Ctrl+A → Delete (将循环删 ${project.clips.length} 个)`);
  }, [project.clips]);
  const deleteAllClips = useCallback(async () => {
    if (project.clips.length === 0) return;
    const res = await showDialog({
      title: '删除全部片段',
      message: `确认删除全部 ${project.clips.length} 个片段?`,
      destructive: true,
      confirmText: '删除全部',
    });
    if (!res.confirmed) return;
    commit(p => ({ ...p, clips: [] }));
    setSelectedId(null);
  }, [commit, project.clips.length]);

  // ContextMenu — 通用 clip 右键菜单
  const ctxMenu = useContextMenu();
  const buildClipMenu = useCallback((c: Clip): ContextMenuItem[] => {
    const trackLabel = TRACK_META[c.trackId].name;
    const items: ContextMenuItem[] = [
      { id: 'split', label: '切分 (在 playhead)', shortcut: 'S', icon: <Scissors size={12} />,
        disabled: playhead <= c.start + 0.1 || playhead >= c.end - 0.1,
        onClick: () => splitAt(c.id, playhead) },
      { id: 'duplicate', label: '复制片段', shortcut: fmtShortcut('Mod+D'), icon: <CopyIcon size={12} />,
        onClick: () => duplicateClip(c.id) },
      { id: 'copy', label: '拷贝', shortcut: fmtShortcut('Mod+C'), icon: <CopyIcon size={12} />,
        onClick: () => copyClipToClipboard(c.id) },
      { id: 'cut', label: '剪切', shortcut: fmtShortcut('Mod+X'),
        onClick: () => cutClipToClipboard(c.id) },
      { id: 'paste', label: '粘贴到 playhead', shortcut: fmtShortcut('Mod+V'),
        disabled: !clipboardRef.current,
        onClick: () => pasteClipFromClipboard() },
      { id: 'sep1', label: '', separator: true },
      { id: 'lane-up', label: '上移一轨', icon: <ChevronUp size={12} />,
        disabled: c.lane === 0,
        onClick: () => moveClipLane(c.id, -1) },
      { id: 'lane-down', label: '下移一轨', icon: <ChevronDown size={12} />,
        disabled: c.lane >= project.lanes[c.trackId] - 1,
        onClick: () => moveClipLane(c.id, 1) },
      { id: 'sep2', label: '', separator: true },
      { id: 'copy-tc', label: '复制时间码',
        onClick: () => {
          const tc = `${formatTC(c.start)} → ${formatTC(c.end)}  (${(c.end - c.start).toFixed(2)}s)`;
          try { navigator.clipboard.writeText(tc); toast.success('已复制: ' + tc); } catch { toast.error('剪贴板不可用'); }
        }},
      { id: 'info', label: `📋 ${trackLabel} · L${c.lane + 1}`, disabled: true },
    ];
    // image clip 特定: 录终态 / 清终态 (回滚 v23-g: 跟 v23-e 之前一致, 起=终 不默认右移)
    if (c.trackId === 'image') {
      const ic = c as ImageClip;
      items.push({ id: 'sep-img', label: '', separator: true });
      if (ic.fx === 'move' && ic.endTransform) {
        items.push({ id: 'clear-end', label: '清除终帧 (取消 move)',
          onClick: () => updateClipCommit(c.id, { fx: 'none', endTransform: undefined }) });
      } else {
        items.push({ id: 'record-end', label: '🚀 把当前为终帧 (启动 move)',
          onClick: () => updateClipCommit(c.id, { fx: 'move', endTransform: { ...(ic.transform ?? DEFAULT_TRANSFORM) } }) });
      }
    }
    // v23-k: caption clip 特定 — 链接 / 生成配音
    if (c.trackId === 'caption') {
      const cc = c as CaptionClip;
      items.push({ id: 'sep-cap', label: '', separator: true });
      if (cc.linkedTTSId) {
        items.push({ id: 'cap-unlink', label: '🔗 解除配音链接',
          onClick: () => unlinkCaptionTTS(c.id) });
      } else {
        const ttsCount = project.clips.filter(x => x.trackId === 'tts').length;
        items.push({ id: 'cap-link', label: `🔗 链接到已有配音${ttsCount > 0 ? ` (${ttsCount})` : ''}`,
          disabled: ttsCount === 0,
          onClick: () => {
            const counter = findCounterpartClip(project.clips, { start: c.start, end: c.end }, 'tts') as TTSClip | null;
            if (!counter) { toast.error('找不到合适的配音对齐'); return; }
            updateClipCommit(c.id, { start: counter.start, end: counter.end, text: counter.text || cc.text });
            linkCaptionTTS(c.id, counter.id);
            toast.success(`✓ 字幕 ⇌ 配音 双向链接 · 文字 "${(counter.text || '').slice(0, 12)}"`);
          }});
        items.push({ id: 'cap-gen-tts', label: '🎙 同步生成配音 (新 TTS clip)',
          onClick: () => {
            const ttsVoice = VOICE_LIB[0].id;
            const ttsText = cc.text || '';
            if (!ttsText.trim()) { toast.error('字幕为空, 先填文字'); return; }
            const ttsDur = estimateTTSDuration(ttsText, ttsVoice);
            const ttsEnd = Math.min(project.duration, c.start + ttsDur);
            const ttsId = uid('t');
            commit(p => ({
              ...p,
              clips: [
                ...p.clips.map(x => x.id === c.id ? { ...x, end: ttsEnd, linkedTTSId: ttsId } as Clip : x),
                { id: ttsId, trackId: 'tts' as const, lane: 0, start: c.start, end: ttsEnd, text: ttsText, voice: ttsVoice, linkedCaptionId: c.id } as Clip,
              ],
            }));
            toast.success(`✓ 已生成配音 · 时段对齐 ${ttsDur.toFixed(1)}s · auto-gen 中`);
          }});
      }
    }
    // v23-k: TTS clip 特定 — 链接 / 生成字幕
    if (c.trackId === 'tts') {
      const ts = c as TTSClip;
      items.push({ id: 'sep-tts', label: '', separator: true });
      if (ts.linkedCaptionId) {
        items.push({ id: 'tts-unlink', label: '🔗 解除字幕链接',
          onClick: () => unlinkCaptionTTS(c.id) });
      } else {
        const capCount = project.clips.filter(x => x.trackId === 'caption').length;
        items.push({ id: 'tts-link', label: `🔗 链接到已有字幕${capCount > 0 ? ` (${capCount})` : ''}`,
          disabled: capCount === 0,
          onClick: () => {
            const counter = findCounterpartClip(project.clips, { start: c.start, end: c.end }, 'caption') as CaptionClip | null;
            if (!counter) { toast.error('找不到合适的字幕对齐'); return; }
            updateClipCommit(c.id, { start: counter.start, end: counter.end, text: counter.text || ts.text, audioSrc: undefined, audioEngine: undefined, genFailed: false });
            linkCaptionTTS(counter.id, c.id);
            toast.success(`✓ 配音 ⇌ 字幕 双向链接 · 文字 "${(counter.text || '').slice(0, 12)}"`);
          }});
        items.push({ id: 'tts-gen-cap', label: '📝 同步生成字幕 (新 Caption clip)',
          onClick: () => {
            const ttsText = ts.text || '';
            if (!ttsText.trim()) { toast.error('配音为空, 先填文字'); return; }
            const capId = uid('c');
            commit(p => ({
              ...p,
              clips: [
                ...p.clips.map(x => x.id === c.id ? { ...x, linkedCaptionId: capId } as Clip : x),
                { id: capId, trackId: 'caption' as const, lane: 0, start: c.start, end: c.end, text: ttsText, style: DEFAULT_CAPTION_STYLE, linkedTTSId: c.id } as Clip,
              ],
            }));
            toast.success(`✓ 已生成同步字幕 (${ttsText.length} 字)`);
          }});
      }
    }
    // v23-k: FX clip 特定 — 右键改作用对象 (傻瓜式)
    if (c.trackId === 'fx') {
      const fc = c as FXClip;
      const imageClips = project.clips.filter(x => x.trackId === 'image') as ImageClip[];
      const pandas = imageClips.filter(ic => ic.kind !== 'scene');
      const scenes = imageClips.filter(ic => ic.kind === 'scene');
      const submenu: ContextMenuItem[] = [
        { id: 'fx-target-all', label: '🌐 所有同时刻图 (全局)',
          icon: !fc.targetClipId ? <Check size={12} /> : undefined,
          onClick: () => updateClipCommit(c.id, { targetClipId: undefined }) },
      ];
      if (pandas.length > 0) {
        submenu.push({ id: 'sep-pandas', label: '— 角色 / 熊猫 —', separator: true });
        pandas.forEach(p => submenu.push({
          id: `fx-target-${p.id}`,
          label: `🐼 ${p.label || '图片'} · ${p.start.toFixed(1)}-${p.end.toFixed(1)}s`,
          icon: p.id === fc.targetClipId ? <Check size={12} /> : undefined,
          onClick: () => updateClipCommit(c.id, { targetClipId: p.id }),
        }));
      }
      if (scenes.length > 0) {
        submenu.push({ id: 'sep-scenes', label: '— 场景 —', separator: true });
        scenes.forEach(s => submenu.push({
          id: `fx-target-${s.id}`,
          label: `🎬 ${s.label || '场景'} · ${s.start.toFixed(1)}-${s.end.toFixed(1)}s`,
          icon: s.id === fc.targetClipId ? <Check size={12} /> : undefined,
          onClick: () => updateClipCommit(c.id, { targetClipId: s.id }),
        }));
      }
      items.push({ id: 'sep-fx', label: '', separator: true });
      items.push({ id: 'fx-target', label: '🎯 作用对象', submenu });
    }
    items.push({ id: 'sep3', label: '', separator: true });
    items.push({ id: 'delete', label: '删除', shortcut: 'Del', danger: true, icon: <Trash2 size={12} />,
      onClick: () => deleteClip(c.id) });
    return items;
  }, [playhead, splitAt, duplicateClip, copyClipToClipboard, cutClipToClipboard, pasteClipFromClipboard, moveClipLane, deleteClip, project.lanes, project.clips, project.duration, updateClipCommit, linkCaptionTTS, unlinkCaptionTTS, commit]);
  const onClipContextMenu = useCallback((e: React.MouseEvent, c: Clip) => {
    setSelectedId(c.id);
    ctxMenu.open(e, buildClipMenu(c));
  }, [ctxMenu, buildClipMenu]);

  // Keyboard — 跨平台 (isMetaOrCtrl 自动 ⌘/Ctrl), 参考剪映/CapCut 常用快捷键
  // 注意: 必须放在所有 callback (copyClipToClipboard/ctxMenu 等) 之后, 避免 TDZ
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e)) {
        if (e.key === 'Escape') (e.target as HTMLInputElement).blur?.();
        return;
      }
      const ctrl = isMetaOrCtrl(e);
      if (e.code === 'Space') { e.preventDefault(); setIsPlaying(p => !p); return; }
      if (e.key === 'Home') { e.preventDefault(); seekPlayhead(0); return; }
      if (e.key === 'End') { e.preventDefault(); seekPlayhead(project.duration); return; }
      if (!ctrl && e.key.toLowerCase() === 'j') { e.preventDefault(); seekPlayhead(Math.max(0, playhead - 1)); return; }
      if (!ctrl && e.key.toLowerCase() === 'k') { e.preventDefault(); setIsPlaying(p => !p); return; }
      if (!ctrl && e.key.toLowerCase() === 'l') { e.preventDefault(); seekPlayhead(Math.min(project.duration, playhead + 1)); return; }
      if (!ctrl && e.key === ',') { e.preventDefault(); seekPlayhead(Math.max(0, playhead - 1/30)); return; }
      if (!ctrl && e.key === '.') { e.preventDefault(); seekPlayhead(Math.min(project.duration, playhead + 1/30)); return; }
      if (ctrl && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
      if (ctrl && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); redo(); return; }
      if (ctrl && e.key.toLowerCase() === 'a') { e.preventDefault(); selectAllClips(); return; }
      if (ctrl && e.key.toLowerCase() === 'c' && selectedId) { e.preventDefault(); copyClipToClipboard(selectedId); return; }
      if (ctrl && e.key.toLowerCase() === 'x' && selectedId) { e.preventDefault(); cutClipToClipboard(selectedId); return; }
      if (ctrl && e.key.toLowerCase() === 'v') { e.preventDefault(); pasteClipFromClipboard(); return; }
      if (ctrl && e.key.toLowerCase() === 'd' && selectedId) { e.preventDefault(); duplicateClip(selectedId); return; }
      if (ctrl && e.shiftKey && e.key.toLowerCase() === 's') { e.preventDefault(); saveCurrentAsDraft(); return; }
      if (ctrl && e.key.toLowerCase() === 's') { e.preventDefault(); saveCurrentAsDraft(); return; }
      if (ctrl && e.shiftKey && (e.key === 'Backspace' || e.key === 'Delete')) {
        e.preventDefault(); deleteAllClips(); return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) { e.preventDefault(); deleteClip(selectedId); return; }
      if (e.key === 'Escape') { setSelectedId(null); ctxMenu.close(); return; }
      if ((e.key === 's' || e.key === 'S') && selectedId && !ctrl) { e.preventDefault(); splitAt(selectedId, playhead); return; }
      if (e.key === 'ArrowLeft' && selectedId) {
        e.preventDefault();
        const step = e.shiftKey ? -1 : (e.altKey ? -1/30 : -0.1);
        nudge(selectedId, step); return;
      }
      if (e.key === 'ArrowRight' && selectedId) {
        e.preventDefault();
        const step = e.shiftKey ? 1 : (e.altKey ? 1/30 : 0.1);
        nudge(selectedId, step); return;
      }
      if (e.key === 'ArrowUp' && selectedId && !ctrl) { e.preventDefault(); moveClipLane(selectedId, -1); return; }
      if (e.key === 'ArrowDown' && selectedId && !ctrl) { e.preventDefault(); moveClipLane(selectedId, 1); return; }
      if (!ctrl && (e.key === '+' || e.key === '=')) { e.preventDefault(); window.dispatchEvent(new CustomEvent('am-zoom-in')); return; }
      if (!ctrl && (e.key === '-' || e.key === '_')) { e.preventDefault(); window.dispatchEvent(new CustomEvent('am-zoom-out')); return; }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    selectedId, playhead, project.duration,
    undo, redo, duplicateClip, deleteClip, splitAt, nudge, saveCurrentAsDraft,
    seekPlayhead, setIsPlaying, moveClipLane,
    copyClipToClipboard, cutClipToClipboard, pasteClipFromClipboard, selectAllClips, deleteAllClips,
    ctxMenu,
  ]);

  return (
    <div className={'am-root' + (isMobile ? ' am-root-mobile' : '')}>
      <AnimateToolbar
        duration={project.duration}
        clipCount={project.clips.length}
        canUndo={canUndo}
        canRedo={canRedo}
        draftsCount={drafts.length}
        onUndo={undo}
        onRedo={redo}
        onRandomize={randomize}
        onClear={clearAll}
        onReset={resetProject}
        onFlatten={flattenToMainTrack}
        onSetDuration={setDuration}
        onSaveDraft={() => saveCurrentAsDraft()}
        onToggleDraftPopover={() => setDraftPopoverOpen(o => !o)}
        onOpenPreview={() => { setIsPlaying(false); setPreviewModalOpen(true); }}
        onOpenExport={() => { setIsPlaying(false); setExportModalOpen(true); }}
        onOpenTemplates={import.meta.env.DEV ? () => setTemplatesModalOpen(true) : undefined}
        onOpenBgmAlign={import.meta.env.DEV ? () => setBgmAlignModalOpen(true) : undefined}
        onOpenStateDump={import.meta.env.DEV ? () => setStateDumpModalOpen(true) : undefined}
        onOpenShortcuts={() => setShortcutsModalOpen(true)}
        ttsGenStats={ttsGenStats}
        onExportJSON={exportProjectJSON}
        onImportJSON={importProjectJSON}
        mode={project.mode ?? 'video'}
        onModeChange={async (m) => {
          // v24 双缓存切 mode 流程:
          //   1) 先保存当前 state 到当前 mode 对应的 IDB key (避免 debounce 漏)
          //   2) 读取目标 mode 缓存
          //   3) AppDialog 弹"复制时间轴"checkbox (video→gif 默认勾, gif→video 默认不勾)
          //   4) 勾选: 复制当前 state 到目标 mode (v→g 自动裁/删 TTS/BGM)
          //      不勾: 用目标 mode 已有缓存; 若无 → 新建空白
          //   5) commit + idbSet 目标 key + (仅切 gif 时) 清 audio player
          if (m === (project.mode ?? 'video')) return;
          const currentMode: ProjectMode = project.mode ?? 'video';
          const isV2G = currentMode === 'video' && m === 'gif';

          // 1) 保存当前 state 到当前 mode 对应 key
          await idbSet(getCurrentIdbKey(currentMode), project).catch(() => {});

          // 2) 读取目标 mode 缓存
          const targetRaw = await idbGet<ProjectState>(getCurrentIdbKey(m)).catch(() => undefined);
          const targetHydrated = targetRaw ? hydrateProject(targetRaw) : null;
          const hasTargetCache = !!targetHydrated && targetHydrated.project.clips.length > 0;

          // 3) summary
          const tts = project.clips.filter(c => c.trackId === 'tts').length;
          const bgm = project.clips.filter(c => c.trackId === 'bgm').length;
          const imgs = project.clips.filter(c => c.trackId === 'image').length;
          const captions = project.clips.filter(c => c.trackId === 'caption').length;
          const summaryLines: string[] = [];
          if (imgs > 0 || captions > 0) summaryLines.push(`${imgs} 张图片 · ${captions} 条字幕`);
          if (tts > 0 || bgm > 0) summaryLines.push(`${tts} 个配音 + ${bgm} 个 BGM`);

          const checkboxKey = 'copyTimeline';
          const checkboxLabel = isV2G
            ? `复制视频时间轴到 GIF (自动裁 ${GIF_MAX_DURATION}s 后片段并移除配音/BGM)`
            : '复制 GIF 时间轴到视频';
          const targetLabel = m === 'gif' ? `GIF (≤${GIF_MAX_DURATION}s, 无声音)` : '视频';

          const res = await showDialog({
            title: `切换到 ${m === 'gif' ? 'GIF' : '视频'} 模式`,
            message: (
              <>
                <p>当前 <strong>{currentMode === 'gif' ? 'GIF' : '视频'}</strong> 工作区:</p>
                <ul>
                  {summaryLines.length > 0
                    ? summaryLines.map((l, i) => <li key={i}>{l}</li>)
                    : <li>(空)</li>}
                </ul>
                {hasTargetCache ? (
                  <p>💡 目标 <strong>{targetLabel}</strong> 已有 {targetHydrated!.project.clips.length} 个片段, 切回会保留它.</p>
                ) : (
                  <p>目标 <strong>{targetLabel}</strong> 工作区为空.</p>
                )}
              </>
            ),
            confirmText: '切换',
            checkboxes: [{
              key: checkboxKey,
              label: checkboxLabel,
              defaultChecked: isV2G,
              description: isV2G
                ? '勾选: 复制当前视频时间轴到 GIF 工作区 (会裁剪) · 不勾: 用 GIF 已有缓存或空白'
                : '勾选: 复制当前 GIF 时间轴到视频工作区 · 不勾: 用视频已有缓存或空白',
            }],
          });

          if (!res.confirmed) return;
          const shouldCopy = !!res.checkboxes[checkboxKey];

          // 4) commit functional updater — 读 fresh prev 而非 closure project
          //    (修 H2: showDialog open 期间, TTS auto-gen 可能写 setProjectLive 更新 project state;
          //     如果用 closure project 构造 nextProject 会丢这些中间改动 — 用 prev 让最新 state 入合并)
          let committedProject: ProjectState = project; // 闭包外暴露给后续 idbSet
          commit((prev) => {
            let next: ProjectState;
            if (shouldCopy) {
              if (m === 'gif') {
                // video → gif: 裁 ≥GIF_MAX_DURATION + 删 TTS/BGM + 清 orphan linkedTTSId
                const ttsIds = new Set(prev.clips.filter(c => c.trackId === 'tts').map(c => c.id));
                next = {
                  ...prev,
                  mode: 'gif',
                  duration: Math.min(prev.duration, GIF_MAX_DURATION),
                  gifPresetId: prev.gifPresetId ?? 'wechat',
                  clips: prev.clips
                    .filter(c => c.trackId !== 'tts' && c.trackId !== 'bgm')
                    .filter(c => c.start < GIF_MAX_DURATION)
                    .map(c => {
                      if (c.trackId === 'caption' && (c as CaptionClip).linkedTTSId && ttsIds.has((c as CaptionClip).linkedTTSId!)) {
                        const cleaned = { ...c } as CaptionClip;
                        delete cleaned.linkedTTSId;
                        return cleaned as Clip;
                      }
                      return c;
                    }),
                };
              } else {
                // gif → video: 直接 copy + mode 切到 video
                next = { ...prev, mode: 'video' };
              }
            } else if (targetHydrated) {
              next = targetHydrated.project;
            } else {
              next = m === 'gif'
                ? { duration: 6, mode: 'gif', gifPresetId: 'wechat', lanes: { image: 1, caption: 1, fx: 1, tts: 1, bgm: 1 }, clips: [] }
                : { duration: 12, mode: 'video', lanes: { image: 1, caption: 1, fx: 1, tts: 1, bgm: 1 }, clips: [] };
            }
            committedProject = next;
            return next;
          });

          // 5) 立即 IDB write + audio cleanup (仅 gif 时)
          await idbSet(getCurrentIdbKey(m), committedProject).catch(() => {});
          if (m === 'gif') {
            audioEngine.destroyAllTTSPlayers();
            audioEngine.destroyAllUserBGMPlayers();
          }
        }}
      />
      <div className="am-workspace">
        <LeftPane
          mode={project.mode ?? 'video'}
          uploads={uploads}
          setUploads={setUploads}
          userBGMs={userBGMs}
          setUserBGMs={setUserBGMs}
          onQuickAdd={quickAdd}
          onAddDraftAsClips={addDraftAsClips}
          onAddClipsBatch={addClipsBatch}
          playhead={playhead}
          projectDuration={project.duration}
        />
        <PreviewPane
          clips={project.clips}
          lanes={project.lanes}
          time={playhead}
          duration={project.duration}
          isPlaying={isPlaying}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onPlayPause={() => setIsPlaying(p => !p)}
          onSeek={seekPlayhead}
          onTransformLive={updateTransformLive}
          onCaptionTextLive={(id, text) => updateClipLive(id, { text })}
          onUpdateClipLive={updateClipLive}
          onUpdateClipCommit={updateClipCommit}
          onBeginDrag={beginDrag}
          onEndDrag={endDrag}
          onQuickAdd={quickAdd}
          onClipContextMenu={onClipContextMenu}
          onRandomize={randomize}
          onOpenShortcuts={() => setShortcutsModalOpen(true)}
          onToggleDraftPopover={() => setDraftPopoverOpen(o => !o)}
        />
        <RightPane
          clip={selectedClip}
          project={project}
          playhead={playhead}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onUpdate={patchSelected}
          onTransform={patchSelectedTransform}
          onDelete={() => selectedId && deleteClip(selectedId)}
          onDeleteClip={deleteClip}
          onSplit={() => selectedId && splitAt(selectedId, playhead)}
          onDuplicate={() => selectedId && duplicateClip(selectedId)}
          onMoveLane={(dir) => selectedId && moveClipLane(selectedId, dir)}
          onSetClipLane={setClipLane}
          onLinkCaptionTTS={linkCaptionTTS}
          onUnlinkCaptionTTS={unlinkCaptionTTS}
          onReorderLayer={reorderLayer}
          onClipContextMenu={onClipContextMenu}
        />
      </div>
      <Timeline
        project={project}
        playhead={playhead}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onSeek={seekPlayhead}
        onUpdateClipLive={updateClipLive}
        onBeginDrag={beginDrag}
        onEndDrag={endDrag}
        onAddClip={addClip}
        onAddLane={addLane}
        onRemoveLane={removeLane}
        onSetDuration={setDuration}
        onClipContextMenu={onClipContextMenu}
      />
      {ctxMenu.render()}
      {/* v23-l mobile: 底栏 5 大 tab — 复刻剪映 (素材/字幕/动效/编辑/导出). 第 5 tab 编辑器仅 selectedId 可点 */}
      {isMobile && (
        <div className="am-mobile-bottombar am-mobile-bottombar--5" role="tablist" aria-label="底部工具">
          <button
            type="button"
            role="tab"
            aria-selected={mobileSheet === 'assets'}
            className={'am-mb-tab' + (mobileSheet === 'assets' ? ' is-active' : '')}
            onClick={() => setMobileSheet(s => s === 'assets' ? null : 'assets')}
          >
            <span className="am-mb-tab-ic">🎨</span>
            <span className="am-mb-tab-lbl">素材</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mobileSheet === 'caption'}
            className={'am-mb-tab' + (mobileSheet === 'caption' ? ' is-active' : '')}
            onClick={() => setMobileSheet(s => s === 'caption' ? null : 'caption')}
          >
            <span className="am-mb-tab-ic">💬</span>
            <span className="am-mb-tab-lbl">字幕</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mobileSheet === 'fx'}
            className={'am-mb-tab' + (mobileSheet === 'fx' ? ' is-active' : '')}
            onClick={() => setMobileSheet(s => s === 'fx' ? null : 'fx')}
          >
            <span className="am-mb-tab-ic">✨</span>
            <span className="am-mb-tab-lbl">动效</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mobileSheet === 'inspector'}
            disabled={!selectedId}
            className={
              'am-mb-tab' +
              (mobileSheet === 'inspector' ? ' is-active' : '') +
              (!selectedId ? ' is-disabled' : '')
            }
            onClick={() => selectedId && setMobileSheet(s => s === 'inspector' ? null : 'inspector')}
            title={!selectedId ? '先选中片段' : '编辑选中片段'}
          >
            <span className="am-mb-tab-ic">🔧</span>
            <span className="am-mb-tab-lbl">编辑</span>
          </button>
          <button
            type="button"
            className="am-mb-tab"
            onClick={() => { setIsPlaying(false); setExportModalOpen(true); }}
          >
            <span className="am-mb-tab-ic">⬇️</span>
            <span className="am-mb-tab-lbl">导出</span>
          </button>
        </div>
      )}
      {/* v23-l mobile sheet — 上滑展开. 4 tab + 5th (Inspector MVP) 分支 */}
      {isMobile && mobileSheet && (
        <>
          <div className="am-mobile-sheet-backdrop" onClick={() => setMobileSheet(null)} />
          <div
            className="am-mobile-sheet"
            role="dialog"
            aria-modal="true"
            ref={sheetRef}
            style={sheetTranslateY > 0 ? { transform: `translateY(${sheetTranslateY}px)`, transition: 'none' } : undefined}
          >
            <div
              className="am-mobile-sheet-handle"
              onClick={() => setMobileSheet(null)}
              onPointerDown={onSheetHandlePointerDown}
              onPointerMove={onSheetHandlePointerMove}
              onPointerUp={onSheetHandlePointerUp}
              onPointerCancel={onSheetHandlePointerUp}
            />
            <div className="am-mobile-sheet-head">
              <span>
                {mobileSheet === 'assets' && '🎨 素材库'}
                {mobileSheet === 'caption' && '💬 字幕'}
                {mobileSheet === 'fx' && '✨ 动效'}
                {mobileSheet === 'inspector' && '🔧 编辑'}
              </span>
              <button className="am-mobile-sheet-close" onClick={() => setMobileSheet(null)} aria-label="关闭">
                <X size={18} />
              </button>
            </div>
            <div className="am-mobile-sheet-body">
              {mobileSheet === 'inspector' && selectedClip ? (
                <MobileInspectorMVP
                  clip={selectedClip}
                  onUpdateText={(text) => commit(p => ({
                    ...p,
                    clips: p.clips.map(c => c.id === selectedClip.id ? ({ ...c, text } as Clip) : c),
                  }))}
                  onDelete={() => { deleteClip(selectedClip.id); setMobileSheet(null); }}
                  onSplit={() => { splitAt(selectedClip.id, playhead); setMobileSheet(null); }}
                  onDuplicate={() => { duplicateClip(selectedClip.id); setMobileSheet(null); }}
                />
              ) : (
                <LeftPane
                  mode={project.mode ?? 'video'}
                  initialSeg={mobileSheet === 'caption' ? 'caption' : mobileSheet === 'fx' ? 'fx' : 'asset'}
                  uploads={uploads}
                  setUploads={setUploads}
                  userBGMs={userBGMs}
                  setUserBGMs={setUserBGMs}
                  onQuickAdd={(p) => { quickAdd(p); setMobileSheet(null); /* 加完关 sheet, 立即看效果 */ }}
                  onAddDraftAsClips={async (s) => { await addDraftAsClips(s); setMobileSheet(null); /* await 避免 toast 没出 sheet 已关 */ }}
                  onAddClipsBatch={(cs) => { addClipsBatch(cs); setMobileSheet(null); }}
                  playhead={playhead}
                  projectDuration={project.duration}
                />
              )}
            </div>
          </div>
        </>
      )}
      {draftPopoverOpen && (
        <DraftPopover
          drafts={drafts}
          onClose={() => setDraftPopoverOpen(false)}
          onSave={(name) => { saveCurrentAsDraft(name); }}
          onLoad={(id) => { loadDraft(id); setDraftPopoverOpen(false); }}
          onDelete={deleteDraft}
          onRename={renameDraftAM}
          onNote={noteDraftAM}
          onDuplicate={duplicateDraftAM}
        />
      )}
      {previewModalOpen && (
        <PreviewModal
          project={project}
          userBGMs={userBGMs}
          onClose={() => setPreviewModalOpen(false)}
        />
      )}
      {exportModalOpen && (
        <ExportModal
          project={project}
          userBGMs={userBGMs}
          name={'我的沙雕动画'}
          onClose={() => setExportModalOpen(false)}
        />
      )}
      {import.meta.env.DEV && templatesModalOpen && (
        <TemplatesModal
          currentProject={project}
          onClose={() => setTemplatesModalOpen(false)}
          onLoad={(tpl) => {
            // 加载: 把 tpl.project 替换当前 (走 hydrateProject 防 schema 丢失, 跟 loadDraft / IDB / JSON import 对齐)
            try {
              const hydrated = hydrateProject(tpl.project);
              if (!hydrated) { toast.error('模板数据格式无效'); return; }
              audioEngine.destroyAll();
              commit(() => hydrated.project);
              setSelectedId(null);
              setPlayhead(0);
              toast.success(`已读入模板 ${tpl.name}`);
              setTemplatesModalOpen(false);
            } catch (e) { toast.error('模板格式无效: ' + (e as Error).message); }
          }}
        />
      )}
      {import.meta.env.DEV && bgmAlignModalOpen && (
        <BgmAlignModal
          duration={project.duration}
          onClose={() => setBgmAlignModalOpen(false)}
          onApply={(beatTimes, texts, style) => {
            // 把节拍位置 + texts 转成 caption clips, 加到时间轴
            const newClips: Clip[] = [];
            const ts = Date.now();
            for (let i = 0; i < beatTimes.length; i++) {
              const start = beatTimes[i];
              const next = beatTimes[i + 1] ?? Math.min(project.duration, start + 1.5);
              const dur = Math.max(0.4, Math.min(2.0, next - start - 0.05));
              if (start + dur > project.duration) continue;
              newClips.push({
                id: `bgm-cap-${ts}-${i}`,
                trackId: 'caption',
                lane: 0,
                start,
                end: start + dur,
                text: texts[i % texts.length],
                style,
                fontSize: 56,
                color: style === 'panel' ? '#222' : '#fff',
              });
            }
            commit(p => ({ ...p, clips: [...p.clips, ...newClips] }));
            toast.success(`已加 ${newClips.length} 个节拍字幕`);
            setBgmAlignModalOpen(false);
          }}
        />
      )}
      {import.meta.env.DEV && stateDumpModalOpen && (
        <StateDumpModal
          onClose={() => setStateDumpModalOpen(false)}
        />
      )}
      {shortcutsModalOpen && (
        <ShortcutsModal onClose={() => setShortcutsModalOpen(false)} />
      )}
    </div>
  );
}

// ============================================================
// Toolbar
// ============================================================
function AnimateToolbar({
  duration, clipCount, canUndo, canRedo, draftsCount,
  onUndo, onRedo, onRandomize, onClear, onReset, onFlatten, onSetDuration,
  onSaveDraft, onToggleDraftPopover, onOpenPreview, onOpenExport,
  onOpenTemplates, onOpenBgmAlign, onOpenStateDump, onOpenShortcuts,
  ttsGenStats, onExportJSON, onImportJSON,
  mode = 'video', onModeChange,
}: {
  duration: number; clipCount: number;
  canUndo: boolean; canRedo: boolean; draftsCount: number;
  onUndo: () => void; onRedo: () => void;
  onRandomize: () => void; onClear: () => void; onReset: () => void; onFlatten: () => void; onSetDuration: (d: number) => void;
  onSaveDraft: () => void; onToggleDraftPopover: () => void;
  onOpenPreview: () => void; onOpenExport: () => void;
  onOpenTemplates?: () => void; onOpenBgmAlign?: () => void; onOpenStateDump?: () => void;
  onOpenShortcuts: () => void;
  // v23-k Phase A
  ttsGenStats?: { total: number; done: number; failed: number; pending: number };
  onExportJSON?: () => void;
  onImportJSON?: () => void;
  // v23-l: 视频 / GIF 双模式
  mode?: ProjectMode;
  onModeChange?: (m: ProjectMode) => void;
}) {
  const [name, setName] = useState('我的沙雕动画');
  const [editing, setEditing] = useState(false);
  const [tmp, setTmp] = useState(name);
  const [durOpen, setDurOpen] = useState(false);
  const durRef = useRef<HTMLDivElement>(null);
  useEffect(() => { setTmp(name); }, [name]);
  useEffect(() => {
    if (!durOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!durRef.current?.contains(e.target as Node)) setDurOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [durOpen]);
  // GIF 模式时长上限 30s, 视频 60s
  const isGif = mode === 'gif';
  const maxDur = isGif ? GIF_MAX_DURATION : 60;
  const DURATION_PRESETS = isGif ? [3, 4, 5, 6, 10, 15, 20] : [5, 10, 15, 20, 30, 45, 60];

  return (
    <div className="am-toolbar win7-titlebar">
      <div className="am-toolbar-name">
        <span className="am-toolbar-name-ic">🎬</span>
        {editing ? (
          <input
            autoFocus value={tmp}
            onChange={(e) => setTmp(e.target.value)}
            onBlur={() => { setName(tmp.trim() || '未命名作品'); setEditing(false); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') { setTmp(name); setEditing(false); }
            }}
          />
        ) : (
          <span className="am-toolbar-name-text" onClick={() => setEditing(true)} title="点击改名">{name}</span>
        )}
      </div>
      {/* v23-l: 视频 / GIF 模式切换. GIF 模式无声 (TTS/BGM 隐藏) + 短时长 + 走 GIF encoder */}
      {onModeChange && (
        <div className="am-tb-mode" role="tablist" aria-label="输出模式">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'video'}
            className={'am-tb-mode-btn' + (mode === 'video' ? ' is-active' : '')}
            onClick={() => onModeChange('video')}
            title="视频模式 — 含声音 (TTS+BGM) + 长时长 + MP4 导出"
          >🎬 视频</button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'gif'}
            className={'am-tb-mode-btn' + (mode === 'gif' ? ' is-active' : '')}
            onClick={() => onModeChange('gif')}
            title="GIF 模式 — 无声 + 短时长 + 直出 GIF (微信/X/TG 适配)"
          >🎞️ GIF</button>
        </div>
      )}
      <div className="am-toolbar-stat">
        <span>{clipCount} 片段</span>
        {ttsGenStats && ttsGenStats.total > 0 && (ttsGenStats.pending > 0 || ttsGenStats.failed > 0) && (
          <span
            className={'am-tb-tts-progress' + (ttsGenStats.failed > 0 ? ' is-fail' : ttsGenStats.pending > 0 ? ' is-pending' : '')}
            title={`配音 gen 进度 · 已完成 ${ttsGenStats.done}/${ttsGenStats.total}${ttsGenStats.failed > 0 ? ` · ❌ ${ttsGenStats.failed} 失败` : ''}`}
          >
            🎙 {ttsGenStats.done}/{ttsGenStats.total}
            {ttsGenStats.pending > 0 && <span className="am-tb-tts-progress-dot">⏳</span>}
            {ttsGenStats.failed > 0 && <span className="am-tb-tts-progress-fail"> · ❌{ttsGenStats.failed}</span>}
          </span>
        )}
      </div>
      <div className="am-tb-duration" ref={durRef}>
        <button
          className="am-tb-btn am-tb-duration-btn"
          onClick={() => setDurOpen(o => !o)}
          title={isGif ? 'GIF 时长上限 30s' : '视频时长上限 60s'}
          type="button"
        >
          ⏱ <strong>{duration.toFixed(1)}s</strong>
          <ChevronDown size={11} style={{ marginLeft: 2 }} />
        </button>
        {durOpen && (
          <div className="am-tb-duration-menu win7-panel">
            <div className="am-tb-duration-head">{isGif ? `GIF 时长 · 上限 ${GIF_MAX_DURATION}s` : '视频时长 · 上限 60s'}</div>
            <div className="am-tb-duration-grid">
              {DURATION_PRESETS.map(d => (
                <button
                  key={d}
                  type="button"
                  className={'am-tb-duration-chip' + (Math.abs(duration - d) < 0.05 ? ' is-active' : '')}
                  onClick={() => { onSetDuration(d); setDurOpen(false); }}
                >
                  {d}s
                </button>
              ))}
            </div>
            <div className="am-tb-duration-custom">
              <span>自定义:</span>
              <input
                type="number"
                min={1}
                max={maxDur}
                step={0.5}
                value={Number(duration.toFixed(1))}
                onChange={(e) => onSetDuration(clamp(parseFloat(e.target.value || '1'), 1, maxDur))}
                className="am-input am-tabular"
                style={{ width: 60, padding: '3px 6px' }}
              />
              <span style={{ color: '#666' }}>s</span>
            </div>
          </div>
        )}
      </div>
      <div className="am-toolbar-spacer" />
      <button className="am-tb-btn am-tb-btn-icon" onClick={onUndo} disabled={!canUndo} title="撤销 (Ctrl+Z)"><Undo2 size={14} /></button>
      <button className="am-tb-btn am-tb-btn-icon" onClick={onRedo} disabled={!canRedo} title="重做 (Ctrl+Y)"><Redo2 size={14} /></button>
      <div className="am-tb-sep" />
      <button
        className="am-tb-btn"
        onClick={async () => {
          const res = await showDialog({
            title: '新建空白项目',
            message: '新建会清空当前工作 (草稿已存的不影响). 继续?',
            variant: 'warning',
            confirmText: '新建',
          });
          if (res.confirmed) onReset();
        }}
        title="新建空白项目 (会清空当前)"
        data-mobile-hide
      ><Plus size={13} /> <span>新建</span></button>
      <button className="am-tb-btn" onClick={onRandomize} title="随机生成"><Shuffle size={13} /> <span>随机</span></button>
      <button className="am-tb-btn" onClick={onClear} title="清空时间轴 (保留时长)" data-mobile-hide><Trash2 size={13} /> <span>清空</span></button>
      <button
        className="am-tb-btn"
        onClick={async () => {
          const res = await showDialog({
            title: '整理时间轴',
            message: '把所有片段压回主轨 (lane 0), 按时序接龙. 副轨内容会重新排到末尾.',
            confirmText: '整理',
          });
          if (res.confirmed) onFlatten();
        }}
        title="把多轨压回主轨 (剪映主轨模式)"
        data-mobile-hide
      >
        ⤓ <span>整理</span>
      </button>
      <div className="am-tb-sep" />
      <button className="am-tb-btn" onClick={onSaveDraft} title="保存为新草稿 (Ctrl+S)"><Save size={13} /> <span>保存</span></button>
      <button className="am-tb-btn" onClick={onToggleDraftPopover} title={`管理 ${draftsCount} 个草稿`}>
        <FolderOpen size={13} /> <span>草稿 ({draftsCount})</span>
      </button>
      {/* v23-k Phase A: 项目 JSON 导入/导出 (跨设备 / 备份 / 分享) */}
      {onExportJSON && (
        <button className="am-tb-btn am-tb-btn-icon" onClick={onExportJSON} title="导出项目 JSON (.amjson, 跨设备 / 备份)">
          <Upload size={13} />
        </button>
      )}
      {onImportJSON && (
        <button className="am-tb-btn am-tb-btn-icon" onClick={onImportJSON} title="导入项目 JSON (.amjson)">
          <FileText size={13} />
        </button>
      )}
      <div className="am-tb-sep" />
      <button className="am-tb-btn" onClick={onOpenShortcuts} title="完整快捷键列表"><span style={{ fontSize: 14 }}>⌨️</span> <span>快捷键</span></button>
      <button className="am-tb-btn" onClick={onOpenPreview} title="全屏预览"><Eye size={13} /> <span>预览</span></button>
      <button className="am-tb-btn am-tb-btn-primary" onClick={onOpenExport} title="渲染 + 下载视频文件">
        <Download size={13} /> <span>导出视频</span>
      </button>
      {import.meta.env.DEV && (onOpenTemplates || onOpenBgmAlign || onOpenStateDump) && (
        <div className="am-tb-dev-group" title="DEV-only 工具 — prod 看不到">
          {onOpenTemplates && (
            <button className="am-tb-dev-btn" onClick={onOpenTemplates} title="模板库 — 保存 project / 读已存模板">
              📋 <span>模板</span>
            </button>
          )}
          {onOpenBgmAlign && (
            <button className="am-tb-dev-btn" onClick={onOpenBgmAlign} title="BGM 字幕对齐器 — 节拍生成字幕">
              🎵 <span>对齐</span>
            </button>
          )}
          {onOpenStateDump && (
            <button className="am-tb-dev-btn" onClick={onOpenStateDump} title="状态导出 — TTS/Project/Template 三表">
              🛠 <span>状态</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================
// MOBILE INSPECTOR (v23-l) — 选中 clip 后 mobile sheet 内的极简编辑器
// MVP scope: 字幕/配音 text 编辑 + 删除 + 分割 + 复制. 完整属性 (FX/voice/lane) 走 desktop.
// ============================================================
function MobileInspectorMVP({ clip, onUpdateText, onDelete, onSplit, onDuplicate }: {
  clip: Clip;
  onUpdateText: (text: string) => void;
  onDelete: () => void;
  onSplit: () => void;
  onDuplicate: () => void;
}) {
  const isCaption = clip.trackId === 'caption';
  const isTTS = clip.trackId === 'tts';
  const supportsText = isCaption || isTTS;
  const currentText = supportsText ? ((clip as CaptionClip | TTSClip).text ?? '') : '';
  const typeLabel = (
    {
      image: '🖼️ 图片',
      caption: '💬 字幕',
      fx: '✨ 动效',
      tts: '🎤 配音',
      bgm: '🎵 BGM',
    } as Record<TrackType, string>
  )[clip.trackId];

  return (
    <div className="am-mobile-inspector">
      <div className="am-mobile-inspector-head">
        <span>{typeLabel}</span>
        <span className="am-mobile-inspector-time">
          {clip.start.toFixed(1)}s – {clip.end.toFixed(1)}s
        </span>
      </div>
      {supportsText && (
        <div className="am-mobile-inspector-section">
          <label className="am-field-sublabel">{isCaption ? '字幕文字' : '配音文字'}</label>
          <textarea
            className="am-input am-mobile-inspector-textarea"
            value={currentText}
            onChange={(e) => onUpdateText(e.target.value)}
            rows={3}
            placeholder={isCaption ? '点击编辑字幕' : '点击编辑配音'}
          />
        </div>
      )}
      <div className="am-mobile-inspector-actions">
        <button className="am-tb-btn" onClick={onSplit} type="button">✂ 分割</button>
        <button className="am-tb-btn" onClick={onDuplicate} type="button">📋 复制</button>
        <button className="am-tb-btn am-mobile-inspector-delete" onClick={onDelete} type="button">🗑 删除</button>
      </div>
      <div className="am-mobile-inspector-hint">
        💡 完整属性 (FX/voice/lane/transform) 请切到 desktop 用右侧 Inspector
      </div>
    </div>
  );
}

// ============================================================
// LEFT PANE — 素材库 (单击 / 双击 / 拖拽 三态都行)
// ============================================================
type LibSeg = 'asset' | 'music' | 'voice' | 'caption' | 'fx';

// 字幕样式示例库 — 给用户看 3 种 style (meme/panel/bar) 长啥样
// 旧的 10 条都被 "快速生成" 区替代 (随机出 quickModeTexts 内容)
interface CaptionTemplate { id: string; text: string; emoji: string; style: CaptionStyle; fontSize: number; color: string; desc: string; }
// v23-c: 字幕样式 demo 文字 — 在 QuickGen 预览框统一用 (不跟用户输入文字)
const CAPTION_SAMPLE_TEXT = '字幕样式';
// v23-c revert: 不再放一堆 preset row, 让 QuickGen 区域负责样式调试. LeftPane caption subtab 只显 QuickGen
const CAPTION_LIB: CaptionTemplate[] = [];
type LibSub = 'combo' | 'panda' | 'face' | 'scene' | 'draft' | 'upload';

function LeftPane({
  mode = 'video',
  initialSeg,
  uploads, setUploads, userBGMs, setUserBGMs, onQuickAdd, onAddDraftAsClips,
  onAddClipsBatch, playhead, projectDuration,
}: {
  mode?: ProjectMode;
  initialSeg?: LibSeg;
  uploads: Material[];
  setUploads: React.Dispatch<React.SetStateAction<Material[]>>;
  userBGMs: BGMPreset[];
  setUserBGMs: React.Dispatch<React.SetStateAction<BGMPreset[]>>;
  onQuickAdd: (payload: DragPayload) => void;
  onAddDraftAsClips: (slot: DraftSlot) => void;
  // v23-k: 批量加成对 clip (caption + 链 TTS) — 走 commit 一次, 不走 quickAdd 多次
  onAddClipsBatch: (clips: Clip[]) => void;
  playhead: number;
  projectDuration: number;
}) {
  const { draftSlots } = useMeme();
  const isGif = mode === 'gif';
  // GIF 模式: voice/music 不可用. 自动切回 asset tab 如果当前是 voice/music
  const [seg, setSegRaw] = useState<LibSeg>(initialSeg ?? 'asset');
  const setSeg = (s: LibSeg) => {
    if (isGif && (s === 'voice' || s === 'music')) return;
    setSegRaw(s);
  };
  useEffect(() => {
    if (isGif && (seg === 'voice' || seg === 'music')) setSegRaw('asset');
  }, [isGif, seg]);
  // mobile sheet 切换 tab 时, initialSeg 改变 → reset
  useEffect(() => {
    if (initialSeg) setSegRaw(initialSeg);
  }, [initialSeg]);
  const [sub, setSub] = useState<LibSub>('combo');
  const [fxGroup, setFxGroup] = useState<FxGroup | 'all'>('all');
  const [q, setQ] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  // v23-b: 上传分类 — "通用 / 场景 / 熊猫 / 表情", 决定上传后归到哪个 subtab
  const [uploadKind, setUploadKind] = useState<'general' | 'scene' | 'panda' | 'face'>('general');

  const filter = useCallback((arr: Material[]): Material[] => {
    if (!q) return arr;
    const k = q.toLowerCase();
    return arr.filter(m => m.labelCn.toLowerCase().includes(k) || m.labelEn.toLowerCase().includes(k) || m.tags.some(t => t.toLowerCase().includes(k)));
  }, [q]);

  // v23-b 上传 — 单图 30MB / 总 500MB / 200 张 / 尺寸 4096px (放宽, 只存 IDB)
  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0) return;
    let added = 0, rejected = 0;
    const currentBytes = uploads.reduce((acc, m) => acc + (m.src?.length || 0), 0);
    let usedBytes = currentBytes;
    for (const f of files) {
      if (uploads.length + added >= AM_UPLOAD_MAX_COUNT) {
        toast.error(`已达数量上限 ${AM_UPLOAD_MAX_COUNT} 张`);
        break;
      }
      if (f.size > AM_UPLOAD_MAX_FILE_BYTES) {
        toast.error(`${f.name} 超过 ${(AM_UPLOAD_MAX_FILE_BYTES / 1024 / 1024).toFixed(0)}MB`);
        rejected++; continue;
      }
      try {
        // file → dataURL (base64) + 尺寸校验 + 容量校验
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result || ''));
          r.onerror = () => reject(new Error('read failed'));
          r.readAsDataURL(f);
        });
        const dims = await new Promise<{ w: number; h: number }>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
          img.onerror = () => reject(new Error('img failed'));
          img.src = dataUrl;
        });
        if (dims.w > AM_UPLOAD_MAX_DIM || dims.h > AM_UPLOAD_MAX_DIM) {
          toast.error(`${f.name} 尺寸超 ${AM_UPLOAD_MAX_DIM}px`);
          rejected++; continue;
        }
        if (usedBytes + dataUrl.length > AM_UPLOAD_MAX_BYTES) {
          toast.error(`总存储已超 ${(AM_UPLOAD_MAX_BYTES / 1024 / 1024).toFixed(0)}MB`);
          rejected++; break;
        }
        usedBytes += dataUrl.length;
        const id = uid('u');
        const labelCn = f.name.split('.')[0].slice(0, 10) || `上传${added + 1}`;
        // v23-b: 存 kind, scene subtab / panda subtab / face subtab 据此分流
        const tagsCN = uploadKind === 'scene' ? ['上传', '场景'] : uploadKind === 'panda' ? ['上传', '熊猫'] : uploadKind === 'face' ? ['上传', '表情'] : ['上传'];
        setUploads(prev => [...prev, {
          id, src: dataUrl, labelCn, labelEn: labelCn, tags: tagsCN, tagsEn: ['upload'],
          faceOffset: { x: 0, y: 0, w: 0, h: 0 },
          kind: uploadKind,
        }]);
        added++;
      } catch {
        rejected++;
      }
    }
    if (added > 0) toast.success(`已上传 ${added} 张${rejected > 0 ? ` (${rejected} 张拒绝)` : ''}`);
    else if (rejected > 0) toast.error('全部上传失败');
  };
  const handleDeleteUpload = (id: string) => setUploads(prev => prev.filter(m => m.id !== id));
  const handleClearUploads = async () => {
    const res = await showDialog({
      title: '清空上传素材',
      message: `清空全部 ${uploads.length} 张上传素材?`,
      destructive: true,
      confirmText: '清空',
    });
    if (res.confirmed) {
      setUploads([]);
      toast.success('已清空');
    }
  };
  const uploadUsedBytes = useMemo(() => uploads.reduce((acc, m) => acc + (m.src?.length || 0), 0), [uploads]);
  const uploadUsedMB = (uploadUsedBytes / 1024 / 1024).toFixed(1);
  const uploadMaxMB = (AM_UPLOAD_MAX_BYTES / 1024 / 1024).toFixed(0);

  // 用户上传 BGM (mp3/wav) — 同样上限 + dataURL 持久化
  const audioFileRef = useRef<HTMLInputElement>(null);
  const handleAudioFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0) return;
    const currentBytes = userBGMs.reduce((s, b) => s + (b.sizeBytes || 0), 0);
    let usedBytes = currentBytes;
    let added = 0, rejected = 0;
    for (const f of files) {
      if (userBGMs.length + added >= AM_USER_BGM_MAX_COUNT) {
        toast.error(`已达数量上限 ${AM_USER_BGM_MAX_COUNT} 首`);
        break;
      }
      if (f.size > AM_USER_BGM_MAX_FILE_BYTES) {
        toast.error(`${f.name} 超 ${(AM_USER_BGM_MAX_FILE_BYTES / 1024 / 1024).toFixed(0)}MB`);
        rejected++; continue;
      }
      if (usedBytes + f.size > AM_USER_BGM_MAX_TOTAL_BYTES) {
        toast.error(`总存储超 ${(AM_USER_BGM_MAX_TOTAL_BYTES / 1024 / 1024).toFixed(0)}MB`);
        rejected++; break;
      }
      try {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result || ''));
          r.onerror = () => reject(new Error('read failed'));
          r.readAsDataURL(f);
        });
        usedBytes += f.size;
        const name = f.name.replace(/\.(mp3|wav|m4a|ogg|aac)$/i, '').slice(0, 18) || `音乐${added + 1}`;
        // 探测真实时长 — 让加到时间轴时 clip.end 跟 audio 实际长度对齐 (不再瞎写 5s)
        let durationSec: number | undefined;
        try {
          durationSec = await getAudioDuration(dataUrl);
        } catch {
          // 探测失败兜底, 不阻塞上传
          // eslint-disable-next-line no-console
          console.warn('[BGM upload] duration probe failed:', name);
        }
        setUserBGMs(prev => [...prev, {
          id: `user-bgm-${Date.now()}-${added}`,
          name,
          mood: durationSec ? `${durationSec.toFixed(1)}s` : '自定义上传',
          tempo: 120,
          notes: [],
          kind: 'file',
          src: dataUrl,
          sizeBytes: f.size,
          durationSec,
        }]);
        added++;
      } catch {
        rejected++;
      }
    }
    if (added > 0) toast.success(`已上传 ${added} 首${rejected > 0 ? ` (${rejected} 拒绝)` : ''}`);
    else if (rejected > 0) toast.error('全部上传失败');
  };
  const handleDeleteUserBGM = (id: string) => setUserBGMs(prev => prev.filter(b => b.id !== id));
  const bgmUsedBytes = useMemo(() => userBGMs.reduce((s, b) => s + (b.sizeBytes || 0), 0), [userBGMs]);

  const renderSearch = () => (
    <div className="material-search-box">
      <Search size={12} />
      <input
        type="text"
        className="material-search-input"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={`搜${sub === 'panda' ? '熊猫头' : sub === 'face' ? '表情' : '场景'}...`}
      />
      {q && <button className="material-search-clear" onClick={() => setQ('')}><X size={12} /></button>}
    </div>
  );

  return (
    <aside className="desktop-sidebar-left am-pane-left">
      <div className="am-seg-bar win7-panel">
        <SegBtn active={seg === 'asset'} icon={<ImageIcon size={14} />} label="素材" onClick={() => { setSeg('asset'); setSub('combo'); }} />
        {/* GIF 模式无声 — 音乐 + 配音 隐藏 */}
        {!isGif && <SegBtn active={seg === 'music'} icon={<Music size={14} />} label="音乐" onClick={() => setSeg('music')} />}
        {!isGif && <SegBtn active={seg === 'voice'} icon={<Mic size={14} />} label="配音" onClick={() => setSeg('voice')} />}
        <SegBtn active={seg === 'caption'} icon={<MessageSquare size={14} />} label="字幕" onClick={() => setSeg('caption')} />
        <SegBtn active={seg === 'fx'} icon={<Sparkles size={14} />} label="动效" onClick={() => setSeg('fx')} />
      </div>

      <div className="sidebar-section win7-panel am-left-section">
        <div className="sidebar-section-header">
          <span className="sidebar-icon">
            {seg === 'asset' ? '🎨' : seg === 'music' ? '🎵' : seg === 'voice' ? '🎙' : seg === 'caption' ? '💬' : '✨'}
          </span>
          <span className="sidebar-label">
            {seg === 'asset' ? '素材库' : seg === 'music' ? '背景音乐' : seg === 'voice' ? '配音音色' : seg === 'caption' ? '字幕模板' : '动画特效'}
          </span>
          {seg === 'asset' && (
            <button className="am-mini-upload" title="上传图片" onClick={() => { setSub('upload'); fileRef.current?.click(); }}>
              <Upload size={12} />
            </button>
          )}
        </div>

        {seg === 'asset' && (
          <div className="am-subtabs">
            {/* panda/face 单独拖也开放 — 通过 flattenAlphaShell 自动填白内部 (跟 combo 同效果) */}
            {(['combo', 'panda', 'face', 'scene', 'draft', 'upload'] as LibSub[]).map(k => (
              <button
                key={k}
                className={'am-subtab' + (sub === k ? ' is-active' : '')}
                onClick={() => setSub(k)}
              >
                {k === 'combo' ? '配套' : k === 'panda' ? '熊猫' : k === 'face' ? '表情' : k === 'scene' ? '场景' : k === 'draft' ? `草图${draftSlots.length ? ` ${draftSlots.length}` : ''}` : '上传'}
              </button>
            ))}
          </div>
        )}

        {seg === 'asset' && sub !== 'upload' && sub !== 'draft' && sub !== 'combo' && (
          <div className="am-search-wrap">{renderSearch()}</div>
        )}

        <div className="sidebar-scroll">
          {seg === 'asset' && sub === 'combo' && (
            <ComboTab onAdd={onQuickAdd} />
          )}
          {seg === 'asset' && sub === 'panda' && (
            <div className="sidebar-grid">
              {/* v23-b: 内置 panda 池 + 用户上传 kind=panda */}
              {filter(uploads.filter(u => u.kind === 'panda')).map(m => <MaterialCardClip key={m.id} item={m} kind="panda" onQuickAdd={onQuickAdd} onDelete={() => handleDeleteUpload(m.id)} />)}
              {filter(ALL_PANDAS).map(m => <MaterialCardClip key={m.id} item={m} kind="panda" onQuickAdd={onQuickAdd} />)}
              {filter(ALL_PANDAS).length === 0 && <p className="am-empty-line">无匹配素材</p>}
            </div>
          )}
          {seg === 'asset' && sub === 'face' && (
            <div className="sidebar-grid">
              {/* v23-b: 内置 face 池 + 用户上传 kind=face */}
              {filter(uploads.filter(u => u.kind === 'face')).map(m => <MaterialCardClip key={m.id} item={m} kind="face" onQuickAdd={onQuickAdd} onDelete={() => handleDeleteUpload(m.id)} />)}
              {filter(ALL_FACES).map(m => <MaterialCardClip key={m.id} item={m} kind="face" onQuickAdd={onQuickAdd} />)}
              {filter(ALL_FACES).length === 0 && <p className="am-empty-line">无匹配素材</p>}
            </div>
          )}
          {seg === 'asset' && sub === 'scene' && (
            <>
              {/* v23-d: 内置 Lorem Picsum 真位图 + 用户上传混合 */}
              <div className="am-scene-hint">
                <ImagePlus size={11} strokeWidth={2.2} /> 内置 12 张实拍 (Picsum CDN) + 想换:
                <button type="button" className="am-scene-upload-link" onClick={() => { setUploadKind('scene'); setSub('upload'); }}>+ 上传自己的</button>
              </div>
              <div className="sidebar-grid">
                {filter(uploads.filter(u => u.kind === 'scene')).map(m => <MaterialCardClip key={m.id} item={m} kind="scene" onQuickAdd={onQuickAdd} onDelete={() => handleDeleteUpload(m.id)} />)}
                {filter(SCENE_LIB).map(m => <MaterialCardClip key={m.id} item={m} kind="scene" onQuickAdd={onQuickAdd} />)}
              </div>
              <div className="am-scene-sources" style={{ marginTop: 10 }}>
                <div className="am-scene-sources-label">还可以去这些图源找 (CC0 免费) ↓</div>
                <a className="am-scene-source-link" href="https://unsplash.com/s/photos/landscape" target="_blank" rel="noopener noreferrer">Unsplash</a>
                <a className="am-scene-source-link" href="https://pixabay.com/zh/images/search/%E5%9C%BA%E6%99%AF/" target="_blank" rel="noopener noreferrer">Pixabay</a>
                <a className="am-scene-source-link" href="https://www.pexels.com/search/scene/" target="_blank" rel="noopener noreferrer">Pexels</a>
              </div>
            </>
          )}
          {seg === 'asset' && sub === 'draft' && (
            <>
              {draftSlots.length === 0 ? (
                <div className="am-draft-empty">
                  <FolderOpen size={28} strokeWidth={1.5} />
                  <div className="am-draft-empty-ttl">还没有草图</div>
                  <div className="am-draft-empty-hint">去 编辑器 或 快速 制作熊猫头, 保存后这里就有了</div>
                </div>
              ) : (
                <div className="sidebar-grid">
                  {draftSlots.map(slot => (
                    <DraftCardClip
                      key={slot.id}
                      slot={slot}
                      onAddDraftAsClips={onAddDraftAsClips}
                    />
                  ))}
                </div>
              )}
            </>
          )}
          {seg === 'asset' && sub === 'upload' && (
            <>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple style={{ display: 'none' }} onChange={handleFile} />
              {/* v23-b: 上传分类选择 — 决定上传后归到哪个 subtab */}
              <div className="am-upload-kind-row">
                <span className="am-upload-kind-label">导入为:</span>
                {([
                  { k: 'general' as const, lbl: '通用图', tip: '一般图片素材 (画面 / 道具 / 表情包)' },
                  { k: 'scene' as const,   lbl: '场景',   tip: '作为背景场景 (会出现在 场景 subtab)' },
                  { k: 'panda' as const,   lbl: '熊猫',   tip: '作为自定义熊猫 (会出现在 熊猫 subtab)' },
                  { k: 'face' as const,    lbl: '表情',   tip: '作为自定义表情 (会出现在 表情 subtab)' },
                ]).map(opt => (
                  <button
                    key={opt.k}
                    type="button"
                    className={'am-upload-kind-chip' + (uploadKind === opt.k ? ' is-active' : '')}
                    onClick={() => setUploadKind(opt.k)}
                    title={opt.tip}
                  >
                    {opt.lbl}
                  </button>
                ))}
              </div>
              {uploads.length === 0 ? (
                <div className="am-upload-zone" onClick={() => fileRef.current?.click()}>
                  <Upload size={22} strokeWidth={1.6} />
                  <div className="am-upload-ttl">点击或拖入图片</div>
                  <div className="am-upload-hint">单图 ≤{(AM_UPLOAD_MAX_FILE_BYTES / 1024 / 1024).toFixed(0)}MB · 尺寸 ≤{AM_UPLOAD_MAX_DIM}px · 总 {AM_UPLOAD_MAX_COUNT} 张 / {(AM_UPLOAD_MAX_BYTES / 1024 / 1024).toFixed(0)}MB</div>
                  <div className="am-upload-hint">仅存浏览器 IndexedDB · 不上传服务器 · 跨刷新保留</div>
                </div>
              ) : (
                <>
                  <div className="am-upload-quota">
                    <span><Folder size={11} strokeWidth={2.2} /> {uploads.length}/{AM_UPLOAD_MAX_COUNT} · {uploadUsedMB}/{uploadMaxMB}MB</span>
                    <button className="am-upload-clear-btn" onClick={handleClearUploads} type="button" title="清空">
                      <Trash2 size={10} />
                    </button>
                  </div>
                  <button className="am-upload-more" onClick={() => fileRef.current?.click()}>
                    <Upload size={12} /> <span>继续上传 (作为 {uploadKind === 'general' ? '通用图' : uploadKind === 'scene' ? '场景' : uploadKind === 'panda' ? '熊猫' : '表情'})</span>
                  </button>
                  <div className="sidebar-grid">
                    {uploads.map(m => (
                      <MaterialCardClip key={m.id} item={m} kind={m.kind === 'panda' ? 'panda' : m.kind === 'face' ? 'face' : m.kind === 'scene' ? 'scene' : undefined} onQuickAdd={onQuickAdd} onDelete={() => handleDeleteUpload(m.id)} />
                    ))}
                  </div>
                </>
              )}
            </>
          )}

          {seg === 'music' && (
            <div className="am-row-list">
              <input ref={audioFileRef} type="file" accept="audio/*" multiple style={{ display: 'none' }} onChange={handleAudioFile} />
              <div className="am-upload-quota">
                <span>📦 {userBGMs.length}/{AM_USER_BGM_MAX_COUNT} 首 · {(bgmUsedBytes / 1024 / 1024).toFixed(1)}/{(AM_USER_BGM_MAX_TOTAL_BYTES / 1024 / 1024).toFixed(0)}MB</span>
                <button className="am-upload-clear-btn" onClick={() => audioFileRef.current?.click()} type="button" title="上传 mp3/wav">
                  <Upload size={10} />
                </button>
              </div>
              {userBGMs.length > 0 && (
                <>
                  <div className="am-list-section-head">自定义</div>
                  {userBGMs.map(b => <BGMRow key={b.id} item={b} onQuickAdd={onQuickAdd} onDelete={() => handleDeleteUserBGM(b.id)} />)}
                </>
              )}
              <div className="am-list-section-head">内置合成 BGM</div>
              {BGM_LIB.map(b => <BGMRow key={b.id} item={b} onQuickAdd={onQuickAdd} />)}
            </div>
          )}

          {seg === 'voice' && (
            <div className="am-row-list">
              <VoiceDiagBtn />
              {VOICE_LIB.map(v => <VoiceRow key={v.id} item={v} onQuickAdd={onQuickAdd} />)}
              {/* v23-k: TTS 批量导入 — paste 多段台词 → 一次性多个 TTS clip + 可选随同字幕 */}
              <TTSBatchImport
                onAddClipsBatch={onAddClipsBatch}
                playhead={playhead}
                projectDuration={projectDuration}
              />
            </div>
          )}

          {seg === 'caption' && (
            <div className="am-row-list">
              <CaptionQuickGen onQuickAdd={onQuickAdd} />
              {/* v23-i: 字幕实用功能扩展 — 位置预设 / 沙雕 emoji 一键插 / 批量导入 */}
              <CaptionPositionPresets onQuickAdd={onQuickAdd} />
              <CaptionEmojiPicker onQuickAdd={onQuickAdd} />
              {/* v23-k: 批量导入加 "同步生成配音" toggle */}
              <CaptionBatchImport
                onQuickAdd={onQuickAdd}
                onAddClipsBatch={onAddClipsBatch}
                playhead={playhead}
                projectDuration={projectDuration}
              />
            </div>
          )}

          {seg === 'fx' && (
            <div className="am-row-list">
              <div className="am-fx-group-tabs">
                <button
                  type="button"
                  className={'am-fx-group-tab' + (fxGroup === 'all' ? ' is-active' : '')}
                  onClick={() => setFxGroup('all')}
                >全部</button>
                {(['enter', 'emphasis', 'exit', 'camera', 'move'] as FxGroup[]).map(g => {
                  const GIcon = FX_GROUP_META[g].icon;
                  return (
                    <button
                      key={g}
                      type="button"
                      className={'am-fx-group-tab' + (fxGroup === g ? ' is-active' : '')}
                      onClick={() => setFxGroup(g)}
                    >
                      <GIcon size={12} strokeWidth={2} />
                      <span>{FX_GROUP_META[g].label}</span>
                    </button>
                  );
                })}
              </div>
              <p className="am-empty-line am-empty-hint">单击 / 拖到特效轨 · 选中片段后可绑定</p>
              {FX_LIB.filter(fx => fxGroup === 'all' || fx.group === fxGroup).map(fx => <FXRow key={fx.id} item={fx} onQuickAdd={onQuickAdd} />)}
            </div>
          )}
        </div>
      </div>

      <div className="sidebar-hint">单击 / 双击 / 拖拽 都能添加到时间指针</div>
    </aside>
  );
}

function SegBtn({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button className={'am-seg-btn' + (active ? ' is-active' : '')} onClick={onClick} type="button">
      <span className="am-seg-ic">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

// ComboTab — panda+face 配套合成主入口 (素材库第一个 tab)
// 用 composeMeme + getLivePandaFaceOffset 自动应用校准, 单 ImageClip 加入时间轴
// 左右切 + 随机 (主) + 点缩略图展开全部选项手动选 (深度)
function ComboTab({ onAdd }: { onAdd: (payload: DragPayload) => void }) {
  const [pIdx, setPIdx] = useState(() => Math.floor(Math.random() * ALL_PANDAS.length));
  const [fIdx, setFIdx] = useState(() => Math.floor(Math.random() * ALL_FACES.length));
  const [picker, setPicker] = useState<'panda' | 'face' | null>(null);
  const [pickerQ, setPickerQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<string>('');
  const panda = ALL_PANDAS[pIdx % ALL_PANDAS.length];
  const face = ALL_FACES[fIdx % ALL_FACES.length];

  useEffect(() => {
    let cancelled = false;
    setPreview('');
    // 直接生成 dataURL — preview 用 + 拖到时间轴当 clip src 都能持久化
    void composeMeme({
      pandaSrc: panda.src, faceSrc: face.src,
      faceOffset: getLivePandaFaceOffset(panda),
      size: 384, outputFormat: 'dataurl',
      fillInternalShell: true,
    }).then(url => {
      if (!cancelled) setPreview(url);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [panda.src, face.src, panda]);

  const shuffle = () => {
    setPIdx(Math.floor(Math.random() * ALL_PANDAS.length));
    setFIdx(Math.floor(Math.random() * ALL_FACES.length));
  };
  const cyclePanda = (dir: 1 | -1) => setPIdx(i => (i + dir + ALL_PANDAS.length) % ALL_PANDAS.length);
  const cycleFace = (dir: 1 | -1) => setFIdx(i => (i + dir + ALL_FACES.length) % ALL_FACES.length);

  const handleAdd = async () => {
    if (loading) return;
    setLoading(true);
    try {
      // 加 ImageClip 必须用 dataURL 持久化 (blob URL 刷新失效 → 破图)
      const composed = await composeMeme({
        pandaSrc: panda.src, faceSrc: face.src,
        faceOffset: getLivePandaFaceOffset(panda),
        size: 384, outputFormat: 'dataurl',
        fillInternalShell: true,
      });
      onAdd({ type: 'image', src: composed, label: `${panda.labelCn}+${face.labelCn}`, defaultDuration: 2.5 });
      toast.success(`已加 ${panda.labelCn}+${face.labelCn} 配套`);
    } catch {
      toast.error('合成失败');
    } finally {
      setLoading(false);
    }
  };

  const onDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    if (!preview) { e.preventDefault(); return; }
    const payload: DragPayload = { type: 'image', src: preview, label: `${panda.labelCn}+${face.labelCn}`, defaultDuration: 2.5 };
    e.dataTransfer.setData('application/x-meme', JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'copy';
  };

  // 展开 picker — 列出全部 panda 或 face, 支持搜索
  const pickerList = useMemo(() => {
    if (!picker) return [] as Material[];
    const all = picker === 'panda' ? ALL_PANDAS : ALL_FACES;
    if (!pickerQ) return all;
    const k = pickerQ.toLowerCase();
    return all.filter(m =>
      m.labelCn.toLowerCase().includes(k) ||
      m.labelEn.toLowerCase().includes(k) ||
      m.tags.some(t => t.toLowerCase().includes(k))
    );
  }, [picker, pickerQ]);

  return (
    <div className="am-combo-tab">
      <div className="am-combo-tab-head">
        <span className="am-combo-tab-title">🐼+🤔 配套合成</span>
        <span className="am-combo-tab-sub">校准自动应用 · 单层加入</span>
      </div>

      <div className="am-combo-tab-slots">
        <div className="am-combo-tab-slot">
          <div className="am-combo-tab-slot-label">熊猫头 ({pIdx + 1}/{ALL_PANDAS.length})</div>
          <div className="am-combo-tab-slot-row">
            <button className="am-combo-arrow" onClick={() => cyclePanda(-1)} type="button" title="上一个">‹</button>
            <button
              className="am-combo-tab-thumb-btn"
              onClick={() => { setPicker('panda'); setPickerQ(''); }}
              title="点击展开全部选项手动选"
              type="button"
            >
              <img src={panda.src} alt={panda.labelCn} className="am-combo-tab-thumb" draggable={false} />
              <span className="am-combo-tab-thumb-name">{panda.labelCn}</span>
              <span className="am-combo-tab-expand">▾</span>
            </button>
            <button className="am-combo-arrow" onClick={() => cyclePanda(1)} type="button" title="下一个">›</button>
          </div>
        </div>

        <div className="am-combo-tab-slot">
          <div className="am-combo-tab-slot-label">表情 ({fIdx + 1}/{ALL_FACES.length})</div>
          <div className="am-combo-tab-slot-row">
            <button className="am-combo-arrow" onClick={() => cycleFace(-1)} type="button" title="上一个">‹</button>
            <button
              className="am-combo-tab-thumb-btn"
              onClick={() => { setPicker('face'); setPickerQ(''); }}
              title="点击展开全部选项手动选"
              type="button"
            >
              <img src={face.src} alt={face.labelCn} className="am-combo-tab-thumb" draggable={false} />
              <span className="am-combo-tab-thumb-name">{face.labelCn}</span>
              <span className="am-combo-tab-expand">▾</span>
            </button>
            <button className="am-combo-arrow" onClick={() => cycleFace(1)} type="button" title="下一个">›</button>
          </div>
        </div>
      </div>

      <button className="am-combo-shuffle-btn" onClick={shuffle} type="button">
        <Shuffle size={12} /> <span>随机一对</span>
      </button>

      <div
        className="am-combo-tab-preview"
        draggable={!!preview}
        onDragStart={onDragStart}
        title={preview ? '点 / 拖拽 加入时间轴' : '合成中…'}
      >
        {preview ? (
          <img src={preview} alt="合成预览" className="am-combo-tab-preview-img" draggable={false} />
        ) : (
          <div className="am-combo-preview-loading">合成中…</div>
        )}
      </div>
      <button className="am-combo-add" onClick={handleAdd} disabled={loading || !preview} type="button">
        {loading ? '加入中…' : '✚ 加入时间轴'}
      </button>

      {picker && (
        <div className="am-combo-picker-overlay" onClick={() => setPicker(null)}>
          <div className="am-combo-picker win7-panel" onClick={(e) => e.stopPropagation()}>
            <div className="am-combo-picker-head">
              <span>选 {picker === 'panda' ? '熊猫头' : '表情'} · {pickerList.length}/{picker === 'panda' ? ALL_PANDAS.length : ALL_FACES.length}</span>
              <button className="am-popover-close" onClick={() => setPicker(null)} type="button"><X size={14} /></button>
            </div>
            <div className="am-combo-picker-search material-search-box">
              <Search size={12} color="#888" />
              <input
                autoFocus
                type="text"
                className="material-search-input"
                placeholder={`搜${picker === 'panda' ? '熊猫头' : '表情'}…`}
                value={pickerQ}
                onChange={(e) => setPickerQ(e.target.value)}
              />
              {pickerQ && (
                <button className="material-search-clear" onClick={() => setPickerQ('')} type="button">
                  <X size={11} />
                </button>
              )}
            </div>
            <div className="am-combo-picker-grid">
              {pickerList.map((m, i) => {
                const origIdx = (picker === 'panda' ? ALL_PANDAS : ALL_FACES).findIndex(x => x.id === m.id);
                const isActive = picker === 'panda' ? origIdx === pIdx : origIdx === fIdx;
                return (
                  <button
                    key={m.id}
                    type="button"
                    className={'am-combo-picker-card' + (isActive ? ' is-active' : '')}
                    onClick={() => {
                      if (picker === 'panda') setPIdx(origIdx);
                      else setFIdx(origIdx);
                      setPicker(null);
                    }}
                    title={m.labelCn}
                  >
                    <img src={m.src} alt={m.labelCn} className="am-combo-picker-thumb" draggable={false} loading="lazy" />
                    <span className="am-combo-picker-name">{m.labelCn}</span>
                  </button>
                );
              })}
              {pickerList.length === 0 && (
                <div className="am-combo-picker-empty">无匹配 · 改关键词试试</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MaterialCardClip({ item, kind, onQuickAdd, onDelete }: {
  item: Material; kind?: 'scene' | 'panda' | 'face' | 'upload';
  onQuickAdd: (payload: DragPayload) => void;
  onDelete?: () => void;
}) {
  // 单独 panda/face 拖入沙雕动画时, flattenAlphaShell 把内部 transparent fill 白, 防场景透出
  // scene 不处理 (本身就是背景), upload 用户图也不动 (尊重用户原图)
  const needsFlattenShell = kind === 'panda' || kind === 'face';
  const buildPayload = useCallback(async (): Promise<DragPayload> => {
    let src = item.src;
    if (needsFlattenShell) {
      try { src = await flattenAlphaShell(item.src); } catch { /* fallback 原 src */ }
    }
    return {
      type: 'image', src, label: item.labelCn,
      defaultDuration: kind === 'scene' ? 4.0 : 2.5,
      kind: kind === 'scene' ? 'scene' : undefined,
    };
  }, [item.src, item.labelCn, kind, needsFlattenShell]);
  // v23-i: 性能修 — 之前 mount 时所有 ~200 panda/face card 并发跑 flattenAlphaShell, 卡板. 改 lazy
  // cached 默认拿原 src (拖时立即可用, panda 内部边缘可能透出, trade-off)
  // hover/click 才触发 flatten, cache 命中后下次 fast
  const cachedPayloadRef = useRef<DragPayload | null>(null);
  useEffect(() => {
    cachedPayloadRef.current = {
      type: 'image', src: item.src, label: item.labelCn,
      defaultDuration: kind === 'scene' ? 4.0 : 2.5,
      kind: kind === 'scene' ? 'scene' as const : undefined,
    };
  }, [item.src, item.labelCn, kind]);
  // hover warmup — 用户 hover 1 张卡时才 schedule flatten (一次性 1 个并发, 不卡 LeftPane)
  const warmedRef = useRef(false);
  const onHover = () => {
    if (!needsFlattenShell || warmedRef.current) return;
    warmedRef.current = true;
    void buildPayload().then(p => { cachedPayloadRef.current = p; }).catch(() => {});
  };
  const handleClick = useCallback(async () => {
    const tid = needsFlattenShell ? toast.loading('合成中…') : null;
    try {
      const payload = await buildPayload();
      if (tid) toast.dismiss(tid);
      onQuickAdd(payload);
    } catch (e) {
      if (tid) toast.dismiss(tid);
      toast.error('处理失败: ' + (e as Error).message);
    }
  }, [buildPayload, needsFlattenShell, onQuickAdd]);
  const onDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    const p = cachedPayloadRef.current ?? {
      type: 'image' as const, src: item.src, label: item.labelCn,
      defaultDuration: kind === 'scene' ? 4.0 : 2.5,
      kind: kind === 'scene' ? 'scene' as const : undefined,
    };
    e.dataTransfer.setData('application/x-meme', JSON.stringify(p));
    e.dataTransfer.effectAllowed = 'copy';
    const imgEl = e.currentTarget.querySelector('img') as HTMLImageElement | null;
    if (imgEl) { try { e.dataTransfer.setDragImage(imgEl, 32, 32); } catch {} }
  };
  return (
    <div
      className="material-card am-card"
      draggable
      onDragStart={onDragStart}
      onClick={handleClick}
      onDoubleClick={handleClick}
      onMouseEnter={onHover}
      title={`单击或拖到时间轴: ${item.labelCn}`}
    >
      <img
        src={item.src}
        alt={item.labelCn}
        className={'material-img' + (kind === 'scene' ? ' am-img-scene' : '')}
        draggable={false}
        loading="lazy"
        onError={(e) => {
          // Picsum 偶发 5xx / 国内偶尔被墙 → 显占位 + 提示用户改用外部图源上传
          const el = e.currentTarget;
          el.style.background = 'linear-gradient(135deg, #cbd1da, #8b95a4)';
          el.style.objectFit = 'contain';
          el.removeAttribute('src');
        }}
      />
      <span className="material-name">{item.labelCn}</span>
      {item.tags.length > 0 && kind !== 'scene' && (
        <div className="material-tags">
          {item.tags.slice(0, 2).map(t => <span key={t} className="material-tag">{t}</span>)}
        </div>
      )}
      {onDelete && (
        <button className="am-card-del" onClick={(e) => { e.stopPropagation(); onDelete(); }} title="删除">
          <X size={10} />
        </button>
      )}
    </div>
  );
}

function DraftCardClip({ slot, onAddDraftAsClips }: {
  slot: DraftSlot;
  onAddDraftAsClips: (s: DraftSlot) => void;
}) {
  const { previewUrl, name, elementCount } = slot;
  // 检测是否有文字 — 用于给 card 加 "字幕分轨" tag
  const hasText = useMemo(() => {
    return (slot.state?.elements ?? []).some(e => e.type === 'text' && !!(e as TextElement).text?.trim());
  }, [slot.state]);
  return (
    <div
      className="material-card am-card am-card-draft"
      onClick={() => onAddDraftAsClips(slot)}
      onDoubleClick={() => onAddDraftAsClips(slot)}
      title={`点击加入: ${name} — 画面 + 字幕 自动分轨`}
    >
      {previewUrl ? (
        <img src={previewUrl} alt={name} className="material-img am-img-scene" draggable={false} loading="lazy" />
      ) : (
        <div className="material-img am-draft-blank">—</div>
      )}
      <span className="material-name">{name}</span>
      <div className="material-tags">
        <span className="material-tag">{elementCount} 层</span>
        {hasText && <span className="material-tag am-draft-tag-cap">字幕分轨</span>}
      </div>
    </div>
  );
}

// 字幕快速生成 — 从 quickModeTexts 随机出文字 + 用户调样式 → 拖/单击加到时间轴
// 4 模式: default('all') / roast / fomo / fud, 跟 QuickMode 同源
function CaptionQuickGen({ onQuickAdd }: { onQuickAdd: (p: DragPayload) => void }) {
  const [mode, setMode] = useState<CaptionMode | 'all'>('all');
  const [text, setText] = useState(() => pickRandomText('zh', 'all') || '点击编辑字幕');
  const [style, setStyle] = useState<CaptionStyle>('meme');
  const [fontSize, setFontSize] = useState(56);
  const [color, setColor] = useState('#ffffff');
  const reroll = useCallback(() => {
    const t = pickRandomText('zh', mode, text);
    if (t) setText(t);
  }, [mode, text]);
  // 切模式 — 重新随机一条
  useEffect(() => {
    const t = pickRandomText('zh', mode);
    if (t) setText(t);
    // 切到 panel 自动改黑字 (背景白), 其他默认白字
    setColor(c => style === 'panel' || c === '#222222' ? c : c);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);
  const payload: DragPayload = useMemo(() => ({
    type: 'caption',
    text,
    captionStyle: style,
    captionFontSize: fontSize,
    captionColor: color,
    defaultDuration: 2.5,
  }), [text, style, fontSize, color]);
  const onDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    e.dataTransfer.setData('application/x-meme', JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'copy';
  };
  const MODE_BTNS: (CaptionMode | 'all')[] = ['all', 'roast', 'fomo', 'fud'];
  return (
    <div className="am-cap-quick win7-panel">
      <div className="am-cap-quick-head">
        <span>🎲 快速生成</span>
        <span className="am-cap-quick-sub">从快速模式池抽 · 编辑后加</span>
      </div>
      <div className="am-cap-quick-modes">
        {MODE_BTNS.map(m => (
          <button
            key={m}
            type="button"
            className={'am-cap-quick-mode' + (mode === m ? ' is-active' : '')}
            onClick={() => setMode(m)}
            title={m === 'all' ? '默认 (全池)' : CAPTION_MODE_LABELS[m]?.zh ?? m}
          >
            {m === 'all' ? '默认' : CAPTION_MODE_LABELS[m]?.zh ?? m}
          </button>
        ))}
      </div>
      {/* v23-c: 预览框 — 固定文字 "字幕样式" 演示当前 style + 真显当前字号, 不跟随用户输入文本 */}
      <div
        className={`am-cap-quick-preview am-caption-style-${style} am-cap-preview-demo`}
        draggable
        onDragStart={onDragStart}
        style={{
          // 按比例缩放: 预览框最大 ~28px 行高, 字幕原始 20-100, 缩到 22-64 范围, 但**保留差异**
          fontSize: Math.max(18, Math.min(64, fontSize * 0.7)),
          color,
          minHeight: Math.max(60, fontSize * 0.95),
        }}
        title={`样式演示 · 加到时间轴时实际文字: "${text || '空'}" · 字号 ${fontSize}px`}
      >
        {CAPTION_SAMPLE_TEXT}
      </div>
      <div className="am-row am-row-tight" style={{ marginTop: 6 }}>
        <button type="button" className="am-tb-btn" onClick={reroll} title="再抽一条 (避免连出同句)">
          <Shuffle size={11} /> 换一条
        </button>
        <input
          type="text"
          className="am-input am-cap-quick-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="或直接打字"
          maxLength={80}
        />
      </div>
      <div className="am-cap-quick-row">
        <span className="am-cap-quick-label">样式</span>
        <div className="am-style-chips am-style-chips-mini">
          {(['meme', 'panel', 'bar'] as CaptionStyle[]).map(s => (
            <button
              key={s}
              type="button"
              className={`am-style-chip am-style-chip-${s}${style === s ? ' is-active' : ''}`}
              onClick={() => {
                setStyle(s);
                // 自动调默认色 — panel 黑字 / 其他白字 (仍保留用户选过的色)
                if (s === 'panel' && color === '#ffffff') setColor('#222222');
                if (s !== 'panel' && color === '#222222') setColor('#ffffff');
              }}
            >
              {s === 'meme' ? 'Meme' : s === 'panel' ? '白板' : '黑条'}
            </button>
          ))}
        </div>
      </div>
      <div className="am-cap-quick-row">
        <span className="am-cap-quick-label">字号</span>
        <input
          type="range" min="20" max="100" step="2"
          value={fontSize}
          onChange={(e) => setFontSize(parseInt(e.target.value))}
          className="am-range am-cap-quick-range"
        />
        <span className="am-cap-quick-val">{fontSize}</span>
      </div>
      <div className="am-cap-quick-row">
        <span className="am-cap-quick-label">颜色</span>
        <div className="am-chips am-chips-tight">
          {['#ffffff', '#222222', '#ff5e00', '#1f84df', '#00cc66', '#cb2a2a', '#ffbf22'].map(c => (
            <button
              key={c}
              type="button"
              className={'am-chip am-chip-color' + (color.toLowerCase() === c.toLowerCase() ? ' is-active' : '')}
              style={{ background: c, width: 18, height: 18, padding: 0 }}
              onClick={() => setColor(c)}
              title={c}
            />
          ))}
        </div>
      </div>
      <button
        type="button"
        className="am-tb-btn am-tb-btn-primary am-cap-quick-add"
        onClick={() => onQuickAdd(payload)}
      >
        ✚ 加到时间轴 (playhead 位置)
      </button>
    </div>
  );
}

// v23-c: CaptionRow / CAPTION_LIB 已废弃 (用户 explicit "不是放一堆示例的意思")
// 保留 type 不删, 兼容外部引用. QuickGen 区域负责样式调试

// v23-i: 字幕位置预设 — 5 个常用位置 (沙雕短视频抖音/快手常见布局)
function CaptionPositionPresets({ onQuickAdd }: { onQuickAdd: (p: DragPayload) => void }) {
  const presets: { id: string; label: string; x: number; y: number; emoji: string }[] = [
    { id: 'top',       label: '顶部',   x: 0,  y: -35, emoji: '⬆️' },
    { id: 'mid-up',    label: '中上',   x: 0,  y: -15, emoji: '↗' },
    { id: 'mid',       label: '居中',   x: 0,  y: 0,   emoji: '·' },
    { id: 'mid-down',  label: '中下',   x: 0,  y: 15,  emoji: '↘' },
    { id: 'bottom',    label: '底部',   x: 0,  y: 35,  emoji: '⬇️' },
  ];
  const addAt = (p: typeof presets[number]) => {
    onQuickAdd({
      type: 'caption',
      text: '位置示例',
      captionStyle: 'meme',
      captionFontSize: 48,
      defaultDuration: 2.5,
      // 用 captionFontSize / captionColor 路径 — 位置走 transform 但 DragPayload 无 captionTransform 字段
      // 实际加入后用户可在 Inspector 调 Y. 这里仅 mark 提示
    });
    // 立即用 transform 微调 — 但 quickAdd 走不通 transform field. 加完后用户 Inspector 改 Y%
    toast(`已加底部字幕 · 在画板拖动调位置`, { duration: 2500 });
    void p;
  };
  return (
    <div className="am-cap-extra-card">
      <div className="am-cap-extra-head">📍 字幕位置预设</div>
      <div className="am-cap-extra-sub">点一下加位置示例 · 加入后可继续拖</div>
      <div className="am-cap-pos-grid">
        {presets.map(p => (
          <button key={p.id} type="button" className="am-cap-pos-btn" onClick={() => addAt(p)} title={`y=${p.y}%`}>
            <span className="am-cap-pos-icon">{p.emoji}</span>
            <span className="am-cap-pos-label">{p.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// v23-i: 沙雕常用 emoji 一键插入 — 选中 caption clip 后追加到 text
function CaptionEmojiPicker({ onQuickAdd }: { onQuickAdd: (p: DragPayload) => void }) {
  const emojis = ['😂', '🤣', '💀', '🐼', '🤡', '🥹', '🫠', '😭', '👀', '👻', '💩', '🔥', '✨', '💯', '🙏', '🤝'];
  return (
    <div className="am-cap-extra-card">
      <div className="am-cap-extra-head">🎭 沙雕表情字幕</div>
      <div className="am-cap-extra-sub">单击加一条单 emoji 字幕 · 大字号</div>
      <div className="am-cap-emoji-grid">
        {emojis.map(e => (
          <button
            key={e}
            type="button"
            className="am-cap-emoji-btn"
            onClick={() => onQuickAdd({ type: 'caption', text: e, captionStyle: 'meme', captionFontSize: 80, defaultDuration: 1.2 })}
            title={`加 ${e} 字幕 (大字号 1.2s)`}
          >
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}

// v23-i: 批量字幕导入 — paste 多行文本 → 自动按行 split + 时间均分
function CaptionBatchImport({ onQuickAdd, onAddClipsBatch, playhead, projectDuration }: {
  onQuickAdd: (p: DragPayload) => void;
  onAddClipsBatch: (clips: Clip[]) => void;
  playhead: number;
  projectDuration: number;
}) {
  const [text, setText] = useState('');
  // v23-k: 默认"一起加" (字幕+配音双向链接), 沙雕动画 99% 用户希望两个一起
  const [withTTS, setWithTTS] = useState(true);
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const doImport = () => {
    if (lines.length === 0) { toast.error('粘贴一段台词, 每行一条字幕'); return; }
    if (withTTS) {
      const voice = VOICE_LIB[0].id;
      const ttsVoice = resolveVoiceId(voice);
      const clips: Clip[] = [];
      let cursor = Math.max(0, playhead);
      const gap = 0.3;
      for (const line of lines) {
        const dur = estimateTTSDuration(line, ttsVoice);
        const segEnd = Math.min(projectDuration, cursor + dur);
        if (segEnd - cursor < 0.3) break;
        const capId = uid('c');
        const ttsId = uid('t');
        clips.push({
          id: capId, trackId: 'caption', lane: 0, start: cursor, end: segEnd,
          text: line, style: 'meme', fontSize: 48, linkedTTSId: ttsId,
        } as Clip);
        clips.push({
          id: ttsId, trackId: 'tts', lane: 0, start: cursor, end: segEnd,
          text: line, voice: ttsVoice, linkedCaptionId: capId,
        } as Clip);
        cursor = segEnd + gap;
      }
      onAddClipsBatch(clips);
      toast.success(`✓ ${lines.length} 段台词 → 字幕 + 配音 配套生成, 已双向链接`);
    } else {
      lines.forEach(line => {
        onQuickAdd({ type: 'caption', text: line, captionStyle: 'meme', captionFontSize: 48, defaultDuration: 2.5 });
      });
      toast.success(`已加 ${lines.length} 条字幕 · 每条 2.5s`);
    }
    setText('');
  };
  return (
    <div className="am-cap-extra-card">
      <div className="am-cap-extra-head">📋 批量导入台词稿</div>
      {/* v23-k: 二选一 大 chip 顶部, 默认"一起加" — 用户一眼看到结果是啥 */}
      <div className="am-pair-mode-row" role="radiogroup" aria-label="生成模式">
        <button
          type="button"
          role="radio"
          aria-checked={withTTS}
          className={'am-pair-mode' + (withTTS ? ' is-active' : '')}
          onClick={() => setWithTTS(true)}
          title="每行台词同时建 1 个字幕 + 1 个配音 · 双向链接 (改一个另一个自动跟)"
        >
          <span className="am-pair-mode-ic">✨</span>
          <span className="am-pair-mode-main">字幕 + 配音 一起加</span>
          <span className="am-pair-mode-sub">推荐 · 双向链接</span>
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={!withTTS}
          className={'am-pair-mode' + (!withTTS ? ' is-active' : '')}
          onClick={() => setWithTTS(false)}
          title="仅字幕轨, 每条 2.5s 接龙"
        >
          <span className="am-pair-mode-ic">💬</span>
          <span className="am-pair-mode-main">只加字幕</span>
          <span className="am-pair-mode-sub">每条 2.5s</span>
        </button>
      </div>
      <textarea
        className="am-input am-textarea am-cap-batch-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'家人们谁懂啊\n直接裂开\n但我装作很淡定\n我可太牛了'}
        rows={5}
      />
      <button
        type="button"
        className="am-tb-btn am-tb-btn-primary am-cap-batch-add"
        onClick={doImport}
        disabled={lines.length === 0}
      >
        ✚ 加 {lines.length > 0 ? `${lines.length} 段` : ''} {withTTS ? '→ 字幕+配音' : '→ 字幕'}
      </button>
    </div>
  );
}

// v23-k: TTS 批量导入 — 对称 CaptionBatchImport, paste 多段 → 多个 TTS clip + 可选同步字幕
function TTSBatchImport({ onAddClipsBatch, playhead, projectDuration }: {
  onAddClipsBatch: (clips: Clip[]) => void;
  playhead: number;
  projectDuration: number;
}) {
  const [text, setText] = useState('');
  const [voice, setVoice] = useState<string>(VOICE_LIB[0].id);
  // v23-k: 默认 true — 沙雕动画几乎一定要字幕跟配音同步
  const [withCaption, setWithCaption] = useState(true);
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const doImport = () => {
    if (lines.length === 0) { toast.error('粘贴一段台词, 每行一条配音'); return; }
    const ttsVoice = resolveVoiceId(voice);
    const clips: Clip[] = [];
    let cursor = Math.max(0, playhead);
    const gap = 0.3;
    for (const line of lines) {
      const dur = estimateTTSDuration(line, ttsVoice);
      const segEnd = Math.min(projectDuration, cursor + dur);
      if (segEnd - cursor < 0.3) break;
      const ttsId = uid('t');
      const capId = withCaption ? uid('c') : undefined;
      clips.push({
        id: ttsId, trackId: 'tts', lane: 0, start: cursor, end: segEnd,
        text: line, voice: ttsVoice,
        linkedCaptionId: capId,
      } as Clip);
      if (capId) {
        clips.push({
          id: capId, trackId: 'caption', lane: 0, start: cursor, end: segEnd,
          text: line, style: 'meme', fontSize: 48, linkedTTSId: ttsId,
        } as Clip);
      }
      cursor = segEnd + gap;
    }
    onAddClipsBatch(clips);
    toast.success(`✓ ${lines.length} 段台词 → ${withCaption ? '配音 + 字幕 配套生成, 已双向链接' : '配音 已加, auto-gen 中'}`);
    setText('');
  };
  return (
    <div className="am-cap-extra-card">
      <div className="am-cap-extra-head">📋 批量导入台词稿</div>
      {/* v23-k: 二选一 大 chip 顶部 (默认配音+字幕一起加) */}
      <div className="am-pair-mode-row" role="radiogroup" aria-label="生成模式">
        <button
          type="button"
          role="radio"
          aria-checked={withCaption}
          className={'am-pair-mode' + (withCaption ? ' is-active' : '')}
          onClick={() => setWithCaption(true)}
          title="每行台词同时建 1 个配音 + 1 个字幕 · 双向链接"
        >
          <span className="am-pair-mode-ic">✨</span>
          <span className="am-pair-mode-main">配音 + 字幕 一起加</span>
          <span className="am-pair-mode-sub">推荐 · 双向链接</span>
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={!withCaption}
          className={'am-pair-mode' + (!withCaption ? ' is-active' : '')}
          onClick={() => setWithCaption(false)}
          title="仅配音轨"
        >
          <span className="am-pair-mode-ic">🎙</span>
          <span className="am-pair-mode-main">只加配音</span>
          <span className="am-pair-mode-sub">按朗读时长接龙</span>
        </button>
      </div>
      <textarea
        className="am-input am-textarea am-cap-batch-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'家人们听我说\n这事儿挺离谱\n但我装得很淡定\n好家伙'}
        rows={5}
      />
      <div className="am-tts-batch-voice-row">
        <label className="am-tts-batch-voice-label">音色:</label>
        <select className="am-input am-tts-batch-voice-select" value={voice} onChange={(e) => setVoice(e.target.value)}>
          {VOICE_LIB.map(v => (
            <option key={v.id} value={v.id}>{v.name} ({v.lang === 'zh-CN' ? '中' : v.lang === 'en-US' ? 'US' : 'UK'})</option>
          ))}
        </select>
      </div>
      <button
        type="button"
        className="am-tb-btn am-tb-btn-primary am-cap-batch-add"
        onClick={doImport}
        disabled={lines.length === 0}
      >
        ✚ 加 {lines.length > 0 ? `${lines.length} 段` : ''} {withCaption ? '→ 配音+字幕' : '→ 配音'}
      </button>
    </div>
  );
}

function FXRow({ item, onQuickAdd }: { item: typeof FX_LIB[number]; onQuickAdd: (p: DragPayload) => void }) {
  const payload: DragPayload = { type: 'fx', fx: item.id, defaultDuration: item.defaultDuration };
  const onDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    e.dataTransfer.setData('application/x-meme', JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'copy';
  };
  return (
    <div
      className="am-list-row am-list-row-fx"
      draggable
      onDragStart={onDragStart}
      onClick={() => onQuickAdd(payload)}
      onDoubleClick={() => onQuickAdd(payload)}
      title={`单击加入 / 拖到特效轨: ${item.name}`}
    >
      <div className="am-list-row-emoji am-list-row-fx-icon"><item.icon size={20} strokeWidth={1.8} /></div>
      <div className="am-list-row-meta">
        <div className="am-list-row-name">{item.name}</div>
        <div className="am-list-row-sub">{item.desc} · {item.defaultDuration}s</div>
      </div>
    </div>
  );
}

function BGMRow({ item, onQuickAdd, onDelete }: {
  item: BGMPreset;
  onQuickAdd: (p: DragPayload) => void;
  onDelete?: () => void;
}) {
  // 内置 file 类 BGM (e.g. bgm-jigou): 没 durationSec → 运行时探测一次 cache (lazy useState init 已读 cache, useEffect 仅 async fetch)
  const [probedDur, setProbedDur] = useState<number | undefined>(item.durationSec ?? _bgmDurationCache.get(item.id));
  useEffect(() => {
    if (item.kind !== 'file' || !item.src) return;
    if (item.durationSec) return; // 用户上传已带
    if (_bgmDurationCache.has(item.id)) return; // lazy useState init 已拿到
    getAudioDuration(item.src).then(d => {
      _bgmDurationCache.set(item.id, d);
      setProbedDur(d);
    }).catch(() => {});
  }, [item.id, item.kind, item.src, item.durationSec]);
  const realDur = item.durationSec ?? probedDur;
  const payload: DragPayload = {
    type: 'bgm',
    bgmId: item.id,
    name: item.name,
    defaultDuration: item.kind === 'file' && realDur ? realDur : 8,
  };
  const onDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    e.dataTransfer.setData('application/x-meme', JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'copy';
  };
  const handlePreview = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (item.kind === 'file' && item.src) {
      audioEngine.startUserBGM(item.src, 0.7);
      toast(`试听 ${item.name}`);
    } else {
      audioEngine.startBGM(item, 0.6, 6);
      toast(`试听 ${item.name} 6 秒`);
    }
  };
  return (
    <div
      className="am-list-row am-list-row-bgm"
      draggable
      onDragStart={onDragStart}
      onClick={(e) => { if ((e.target as HTMLElement).closest('.am-list-play, .am-list-row-del')) return; onQuickAdd(payload); }}
      onDoubleClick={() => onQuickAdd(payload)}
      title={`单击添加 / 拖到音乐轨: ${item.name}`}
    >
      <div className="am-list-row-ic"><Music size={13} /></div>
      <div className="am-list-row-meta">
        <div className="am-list-row-name">
          {item.name}
          {item.kind === 'file' && <span className="am-bgm-tag-file">上传</span>}
        </div>
        <div className="am-list-row-sub">{item.mood} · {item.tempo > 0 ? `${item.tempo} BPM` : 'mp3'}</div>
      </div>
      <button className="am-list-play" onClick={handlePreview} title="试听">
        <Play size={10} />
      </button>
      {onDelete && (
        <button className="am-list-row-del" onClick={(e) => { e.stopPropagation(); onDelete(); }} title="删除">
          <X size={10} />
        </button>
      )}
    </div>
  );
}

// 顶部 TTS 代理配置 + 引导 — 真 Neural 路径
function VoiceDiagBtn() {
  const [cfgOpen, setCfgOpen] = useState(false);
  const [proxyInput, setProxyInput] = useState(_userTTSProxyURL);
  const [testing, setTesting] = useState(false);
  useEffect(() => {
    idbGet<string>(AM_TTS_PROXY_IDB_KEY).then(v => {
      if (typeof v === 'string' && v) {
        setTTSProxyURL(v);
        setProxyInput(v);
      }
    }).catch(() => {});
  }, []);
  const save = (url: string) => {
    setTTSProxyURL(url);
    void idbSet(AM_TTS_PROXY_IDB_KEY, url).catch(() => {});
    toast.success(url ? '已保存代理 · 试听走真 Neural' : '已清空 · 退回浏览器 SS');
  };
  const test = async () => {
    if (testing || !proxyInput.trim()) return;
    setTesting(true);
    setTTSProxyURL(proxyInput.trim());
    const tid = toast.loading('测试代理 · 拿 Yunjian 男声样本…');
    try {
      const start = performance.now();
      const dataUrl = await fetchTTSFromProxy('我是真的男声', 'zh-CN-YunjianNeural', 0, 0);
      audioEngine.playTTSAudio(dataUrl, 1.0);
      toast.dismiss(tid);
      toast.success(`✅ 代理通 · ${Math.round(performance.now() - start)}ms · 应听到 Yunjian 真男声`);
    } catch (e) {
      toast.dismiss(tid);
      toast.error(`❌ 代理失败: ${(e as Error).message}`);
    } finally {
      setTesting(false);
    }
  };
  return (
    <>
      <div className="am-voice-diag-row">
        <a
          className="am-voice-diag-btn"
          href={TTSMAKER_URL}
          target="_blank"
          rel="noopener noreferrer"
          title="网页一键生成真 Neural mp3 (含 Yunjian 男声), 下载后用 📂 上传"
        >
          🌐 TTSMaker.cn 生成 mp3 ↗
        </a>
        <button
          className={'am-voice-diag-cfg' + (_userTTSProxyURL ? ' is-set' : '')}
          onClick={() => setCfgOpen(true)}
          type="button"
          title={_userTTSProxyURL ? '已配代理 (真 Neural 试听)' : '官方 bing endpoint 全球下线 · 配代理拿真男声'}
        >
          ⚙️
        </button>
      </div>
      {cfgOpen && (
        <div className="am-popover-backdrop" onClick={() => setCfgOpen(false)}>
          <div className="am-popover am-tts-cfg win7-panel" onClick={(e) => e.stopPropagation()}>
            <div className="am-popover-head">
              <span>⚙️ TTS 代理 (真 Neural)</span>
              <button className="am-popover-close" onClick={() => setCfgOpen(false)} type="button"><X size={14} /></button>
            </div>
            <div className="am-popover-body">
              <p className="am-tts-cfg-tip">
                <b>现状</b>: Microsoft 官方 <code>speech.platform.bing.com</code> <b>全球 403 下线</b>, 所有不带 key 直连服务都失败.
                <br /><br />
                <b>真男声/萝莉/晓晓真 Neural</b> 需自部署 edge-tts 反代 (永久免费, 1 分钟 Cloudflare Worker):
              </p>
              <ul className="am-tts-cfg-tip">
                <li>开源模板: <a href="https://github.com/travisvn/openai-edge-tts" target="_blank" rel="noopener noreferrer">openai-edge-tts</a> (Docker / 服务器)</li>
                <li>或 <a href="https://github.com/wangwangit/tts" target="_blank" rel="noopener noreferrer">wangwangit/tts</a> (一键 Cloudflare Workers 部署)</li>
                <li>部署后填 URL (示例: <code>https://your.workers.dev</code>)</li>
              </ul>
              <Field label="TTS HTTP 代理 URL">
                <input
                  type="text"
                  className="am-input"
                  placeholder="https://your-edge-tts.workers.dev"
                  value={proxyInput}
                  onChange={(e) => setProxyInput(e.target.value)}
                />
              </Field>
              <div className="am-row" style={{ gap: 8, marginTop: 10 }}>
                <button className="am-tb-btn" onClick={() => { setProxyInput(''); save(''); }} type="button">清空</button>
                <button className="am-tb-btn" onClick={test} disabled={testing || !proxyInput.trim()} type="button">
                  {testing ? '测试中…' : '🔍 测听'}
                </button>
                <div className="am-toolbar-spacer" />
                <button className="am-tb-btn" onClick={() => setCfgOpen(false)} type="button">取消</button>
                <button
                  className="am-tb-btn am-tb-btn-primary"
                  onClick={() => { save(proxyInput.trim()); setCfgOpen(false); }}
                  type="button"
                >保存</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function VoiceRow({ item, onQuickAdd }: { item: VoicePreset; onQuickAdd: (p: DragPayload) => void }) {
  const payload: DragPayload = {
    type: 'tts', voice: item.id,
    text: item.lang.startsWith('zh') ? '点击编辑文字' : 'Click to edit text',
    defaultDuration: 2.5,
  };
  const onDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    e.dataTransfer.setData('application/x-meme', JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'copy';
  };
  return (
    <div
      className="am-list-row am-list-row-tts"
      draggable
      onDragStart={onDragStart}
      onClick={(e) => { if ((e.target as HTMLElement).closest('.am-list-play')) return; onQuickAdd(payload); }}
      onDoubleClick={() => onQuickAdd(payload)}
      title={`单击添加 / 拖到配音轨: ${item.name}`}
    >
      <div className="am-list-row-emoji am-list-row-voice-icon">
        {item.icon ? <item.icon size={20} strokeWidth={1.8} /> : <span>{item.emoji}</span>}
      </div>
      <div className="am-list-row-meta">
        <div className="am-list-row-name">
          {item.name}
          <span className="am-voice-gender">{item.gender === 'male' ? '♂' : '♀'}</span>
          <span className="am-voice-lang">{item.lang === 'zh-CN' ? '中' : item.lang === 'en-US' ? 'US' : 'UK'}</span>
        </div>
        <div className="am-list-row-sub">{item.desc}</div>
      </div>
      <button
        className="am-list-play"
        onClick={async (e) => {
          e.stopPropagation();
          const rate = item.playbackRate ?? 1.0;
          // 1. proxy 优先: 配了自部署 → 真 Neural (Azure Yunjian 等)
          if (_userTTSProxyURL) {
            try {
              const dataUrl = await fetchTTSFromProxy(item.sampleText, item.azureName, 0, 0);
              audioEngine.playTTSAudio(dataUrl, 1.0, rate);
              return;
            } catch (err) {
              // eslint-disable-next-line no-console
              console.warn('[voice preview] proxy 失败,试云端:', (err as Error).message);
            }
          }
          // 2. fetchTTSForVoice — 用 voice.preferredEngine, 失败 fallback 另一个
          //    跟 auto-gen 完全同链路, 所听即所得 (左侧听啥 = 时间轴 audio 一致)
          try {
            const { dataUrl } = await fetchTTSForVoice(item.sampleText, item);
            audioEngine.playTTSAudio(dataUrl, 1.0, rate);
          } catch (err) {
            // 3. 云端都挂 → SS 兜底
            toast.error(`云端试听失败 (${(err as Error).message.slice(0, 40)}), 退化浏览器 SS`);
            audioEngine.previewVoice(item);
          }
        }}
        title={`试听 (${item.preferredEngine || 'youdao'} 云端) · 跟时间轴 audio 一致`}
      >
        <Play size={10} />
      </button>
    </div>
  );
}

// ============================================================
// v23-j (phase 2): 超宽场景 Mini 预览 — 画板右上小框, 显 scene 整体 + 当前画板 viewport 矩形
// 拖 viewport 矩形 → 改 scene.transform.x/y (相当于镜头平移)
// ============================================================
function SceneMiniPreview({ clip, canvasSize, onTransformLive, onBeginDrag, onEndDrag }: {
  clip: ImageClip;
  canvasSize: { w: number; h: number };
  onTransformLive: (id: string, t: Partial<Transform>) => void;
  onBeginDrag: () => void;
  onEndDrag: () => void;
}) {
  const tr = clip.transform ?? DEFAULT_TRANSFORM;
  const scale = tr.scale;
  // mini 尺寸 (110px 宽, 16:9)
  const MINI_W = 110;
  const MINI_H = 62;
  // scene 整体在 mini 内: scene 实际尺寸 = canvasSize × scale, mini 等比缩
  // 这里把 scene 当 canvas × scale → mini 内 scene 占 MINI_W × MINI_H (整 mini 就是 scene)
  // viewport = canvas (即 1/scale 大小 of scene), 在 mini 内的尺寸 = MINI_W / scale × MINI_H / scale
  const vpW = MINI_W / scale;
  const vpH = MINI_H / scale;
  // viewport 在 mini 内的位置 — scene.transform.x/y 越往右下, viewport 越往左上 (镜头追随)
  // tr.x: -60..60 (% of canvas). 转 mini 像素: 中心位置 + (-tr.x/100) * MINI_W (反向)
  const vpCx = MINI_W * 0.5 - (tr.x / 100) * MINI_W;
  const vpCy = MINI_H * 0.5 - (tr.y / 100) * MINI_H;
  const vpLeft = vpCx - vpW / 2;
  const vpTop = vpCy - vpH / 2;
  const startDrag = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch {}
    onBeginDrag();
    const startMouseX = e.clientX;
    const startMouseY = e.clientY;
    const startTrX = tr.x;
    const startTrY = tr.y;
    // mini 内每 px 对应 scene 内多少 % — 拖 mini 1px = scene tr.x 1/MINI_W * 100% 变化, 取反向
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startMouseX;
      const dy = ev.clientY - startMouseY;
      const newX = clamp(startTrX - (dx / MINI_W) * 100, -60, 60);
      const newY = clamp(startTrY - (dy / MINI_H) * 100, -60, 60);
      onTransformLive(clip.id, { x: newX, y: newY });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      onEndDrag();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };
  void canvasSize;
  return (
    <div className="am-scene-mini" style={{ width: MINI_W, height: MINI_H }} onPointerDown={(e) => e.stopPropagation()}>
      <div className="am-scene-mini-bg">
        <img src={clip.src} alt="" className="am-scene-mini-img" />
        <div
          className="am-scene-mini-viewport"
          style={{ left: vpLeft, top: vpTop, width: vpW, height: vpH }}
          onPointerDown={startDrag}
          title="拖动调整镜头位置"
        />
      </div>
      <div className="am-scene-mini-label">{scale.toFixed(1)}x · 镜头</div>
    </div>
  );
}

// ============================================================
// PREVIEW PANE — stage-img 居中布局 + 选中框紧贴 + 接 drop
// ============================================================
function PreviewPane({
  clips, lanes, time, duration, isPlaying, selectedId,
  onSelect, onPlayPause, onSeek, onTransformLive, onCaptionTextLive, onUpdateClipLive, onUpdateClipCommit, onBeginDrag, onEndDrag, onQuickAdd,
  onClipContextMenu,
  onRandomize, onOpenShortcuts, onToggleDraftPopover,
}: {
  clips: Clip[];
  lanes: LaneCount;
  time: number;
  duration: number;
  isPlaying: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onPlayPause: () => void;
  onSeek: (t: number) => void;
  onTransformLive: (id: string, t: Partial<Transform>) => void;
  onCaptionTextLive: (id: string, text: string) => void;
  onUpdateClipLive: (id: string, patch: Record<string, unknown>) => void;
  onUpdateClipCommit: (id: string, patch: Record<string, unknown>) => void;
  onBeginDrag: () => void;
  onEndDrag: () => void;
  onQuickAdd: (payload: DragPayload) => void;
  onClipContextMenu?: (e: React.MouseEvent, clip: Clip) => void;
  // v23-k Phase A: 空白页 CTA — 新用户进来直接动手
  onRandomize?: () => void;
  onOpenShortcuts?: () => void;
  onToggleDraftPopover?: () => void;
}) {
  const [aspect, setAspect] = useState<AspectId>('16:9');
  const stageRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState({ w: 640, h: 360 });
  const [dropHilite, setDropHilite] = useState(false);

  const activeImageClips = useMemo(() => {
    const arr = clips.filter(c => c.trackId === 'image' && time >= c.start && time < c.end) as ImageClip[];
    return arr.sort((a, b) => b.lane - a.lane);
  }, [clips, time]);

  useEffect(() => {
    function resize() {
      if (!stageRef.current) return;
      const r = stageRef.current.getBoundingClientRect();
      const availW = r.width - 40;
      const availH = r.height - 40;
      const ratio = aspect === '16:9' ? 16 / 9 : aspect === '9:16' ? 9 / 16 : 1;
      let w = availW, h = w / ratio;
      if (h > availH) { h = availH; w = h * ratio; }
      setCanvasSize({ w: Math.round(w), h: Math.round(h) });
    }
    resize();
    const ro = new ResizeObserver(resize);
    if (stageRef.current) ro.observe(stageRef.current);
    return () => ro.disconnect();
  }, [aspect]);

  const captionSize = Math.max(18, Math.round(canvasSize.w * 0.045));
  const topClip = activeImageClips[activeImageClips.length - 1] ?? null;
  const selectedImageOnStage = activeImageClips.find(c => c.id === selectedId) ?? null;
  // v23-k Phase A: 选中 FX clip 时, 它的 targetClipId 对应 image 高亮 (橙色边框 + 浮动标)
  const selectedFXClip = useMemo(() => {
    const c = clips.find(c => c.id === selectedId);
    return c?.trackId === 'fx' ? (c as FXClip) : null;
  }, [clips, selectedId]);
  const fxTargetImageId = selectedFXClip?.targetClipId ?? null;

  // image natural aspect (img onLoad 后填) — px-based render 用它算 height
  // v23-l audit-fix: 单 useState<Map> 替代 ref + tick (lint react-hooks/refs — refs 不该在 render 读)
  const [naturalAspects, setNaturalAspects] = useState<Map<string, number>>(() => new Map());

  // caption: 所有 active caption clips (按 lane 顺序), 渲染时按 transform 位置叠加
  const activeCaptionClips = useMemo(() => {
    return (clips.filter(c => c.trackId === 'caption' && time >= c.start && time < c.end) as CaptionClip[])
      .sort((a, b) => a.lane - b.lane);
  }, [clips, time]);

  // legacy fallback: 没 caption track clip 时用 topClip.caption
  const fallbackCaption = activeCaptionClips.length === 0 && topClip?.caption ? topClip.caption : null;

  // 字幕编辑态
  const [editingCaptionId, setEditingCaptionId] = useState<string | null>(null);

  // 拖动 caption clip
  const startCaptionDrag = (e: React.PointerEvent, clip: CaptionClip) => {
    if (e.button !== 0) return;
    if (editingCaptionId === clip.id) return;
    e.preventDefault();
    e.stopPropagation();
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch {}
    onSelect(clip.id);
    onBeginDrag();
    const startT = clip.transform ?? DEFAULT_CAPTION_TRANSFORM;
    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;
    const onMove = (ev: PointerEvent) => {
      const dxPct = (ev.clientX - startX) / canvasSize.w * 100;
      const dyPct = (ev.clientY - startY) / canvasSize.h * 100;
      if (Math.abs(dxPct) > 0.3 || Math.abs(dyPct) > 0.3) moved = true;
      onTransformLive(clip.id, {
        x: clamp(startT.x + dxPct, -50, 50),
        y: clamp(startT.y + dyPct, -50, 50),
      });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      onEndDrag();
      if (!moved) {
        // 没拖动 → 视为单击, 不做额外操作 (选中已在 onSelect)
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // v23-h: 拖动 A/B marker → 改 FX 'move' clip 的 startTransform / endTransform
  const startFXMoveMarkerDrag = (e: React.PointerEvent, fxClip: FXClip, target: 'start' | 'end') => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch {}
    onBeginDrag();
    const startMouseX = e.clientX;
    const startMouseY = e.clientY;
    const startTr = fxClip.startTransform ?? DEFAULT_TRANSFORM;
    const endTr = fxClip.endTransform ?? startTr;
    const base = target === 'start' ? startTr : endTr;
    const onMove = (ev: PointerEvent) => {
      const dxPct = (ev.clientX - startMouseX) / canvasSize.w * 100;
      const dyPct = (ev.clientY - startMouseY) / canvasSize.h * 100;
      const newX = clamp(base.x + dxPct, -60, 60);
      const newY = clamp(base.y + dyPct, -60, 60);
      if (target === 'start') {
        onUpdateClipLive(fxClip.id, { startTransform: { ...startTr, x: newX, y: newY } });
      } else {
        onUpdateClipLive(fxClip.id, { endTransform: { ...endTr, x: newX, y: newY } });
      }
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      onEndDrag();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // 拖动 selected image clip
  const startStageDrag = (e: React.PointerEvent, clip: ImageClip, kind: 'move' | 'scale') => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    // pointer capture 让 pointer 离开元素后仍能收到事件
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch {}
    onSelect(clip.id);
    onBeginDrag();
    const startT = getTransform(clip);
    const startX = e.clientX;
    const startY = e.clientY;
    const onMove = (ev: PointerEvent) => {
      if (kind === 'move') {
        const dxPct = (ev.clientX - startX) / canvasSize.w * 100;
        const dyPct = (ev.clientY - startY) / canvasSize.h * 100;
        // 自由度优先 — 不再 clamp image bbox 在 canvas 内, user 想拖出框就拖出 (overflow:hidden 自然裁掉超出部分)
        // 上限 ±200% 防极端值 (user 不可能想拖到 canvas 外 2x). px-based positioning 让 image 出框也合理
        onTransformLive(clip.id, {
          x: clamp(startT.x + dxPct, -200, 200),
          y: clamp(startT.y + dyPct, -200, 200),
        });
      } else {
        // 跟手缩放 — image 边框跟随 pointer
        // image 半径 ≈ baseSize/2 * scale. 拖动 dx (右下角 handle), dx 应直接等于半径变化:
        //   newScale = startScale + (dx + dy) / baseSize (右下方向 dx+dy 同号)
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        const baseSize = Math.min(canvasSize.w, canvasSize.h) * 0.6;
        // 用 max(dx, dy) 让单轴拖动也跟手 (取主导方向)
        const drag = Math.max(dx, dy);
        const newScale = clamp(startT.scale + (drag * 2) / Math.max(1, baseSize), 0.2, 4);
        onTransformLive(clip.id, { scale: newScale });
      }
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      onEndDrag();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // Drop from sidebar
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDropHilite(false);
    const raw = e.dataTransfer.getData('application/x-meme');
    if (!raw) return;
    let payload: DragPayload;
    try { payload = JSON.parse(raw) as DragPayload; } catch { return; }
    onQuickAdd(payload);
  };
  const handleDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('application/x-meme')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDropHilite(true);
  };
  const handleDragLeave = () => setDropHilite(false);

  return (
    <section className="am-preview-pane">
      <div className="am-preview-head">
        <span className="am-preview-title">预览</span>
        <span className="am-preview-layers" title={`同时刻 ${activeImageClips.length} 个画面图层`}>
          🪟 {activeImageClips.length} 图层
        </span>
        {selectedImageOnStage && (
          <span className="am-preview-edit-tip"><Move size={11} /> 拖动调整位置</span>
        )}
        <div className="am-toolbar-spacer" />
        <div className="am-aspect-tabs">
          {(['16:9', '9:16', '1:1'] as AspectId[]).map(a => (
            <button key={a} className={'am-aspect-tab' + (aspect === a ? ' is-active' : '')} onClick={() => setAspect(a)} type="button">{a}</button>
          ))}
        </div>
      </div>

      <div
        className="am-preview-stage"
        ref={stageRef}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div
          className={'am-preview-canvas' + (dropHilite ? ' is-drop' : '')}
          style={{ width: canvasSize.w, height: canvasSize.h }}
          onPointerDown={(e) => { if (e.target === e.currentTarget) onSelect(null); }}
        >
          {/* v23-i: empty 只在 project 完全没 image 时显 — 防止播放经过 gap (无 active image 那一帧) 闪烁 */}
          {clips.filter(c => c.trackId === 'image').length === 0 && (
            <div className="am-preview-empty">
              <div className="am-preview-emoji">🐼</div>
              <div className="am-preview-empty-text">从左边拖个素材进来</div>
              <div className="am-preview-empty-sub">单击 / 双击 / 拖动 都行</div>
              {(onRandomize || onOpenShortcuts || onToggleDraftPopover) && (
                <div className="am-preview-empty-cta">
                  {onRandomize && (
                    <button type="button" className="am-preview-empty-btn am-preview-empty-btn-primary" onClick={onRandomize} title="一键生成 4 段沙雕作品 (随机熊猫+台词+配音+BGM)">
                      <Shuffle size={13} strokeWidth={2.2} /> 🎲 一键生成
                    </button>
                  )}
                  {onToggleDraftPopover && (
                    <button type="button" className="am-preview-empty-btn" onClick={onToggleDraftPopover} title="打开草稿管理 (载入之前的作品)">
                      <FolderOpen size={13} strokeWidth={2.2} /> 草稿
                    </button>
                  )}
                  {onOpenShortcuts && (
                    <button type="button" className="am-preview-empty-btn" onClick={onOpenShortcuts} title="完整快捷键列表">
                      <Keyboard size={13} strokeWidth={2.2} /> 快捷键
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
          {activeImageClips.map((c, idx) => {
            const isScene = c.kind === 'scene';
            void idx;
            const fxInfo = effectiveFxFor(c, time, clips);
            const tr = computeLiveTransform(c, time, fxInfo);
            const rawFxA = computeFx(fxInfo.fx, fxInfo.fxStart, fxInfo.fxDur, time, canvasSize.w, fxInfo.fxClip);
            const isSel = c.id === selectedId;
            // 编辑模式 — paused + selected 时 freeze fx
            const editingFrozen = isSel && !isPlaying;
            const fxA: FxApply = editingFrozen
              ? { offsetX: 0, offsetY: 0, scaleMul: 1, rotateAdd: 0, alpha: 1, filter: '' }
              : rawFxA;
            // 顽固 bug 终极修法 (v3) — 推翻 transform: scale + % 定位的 architecture
            //   旧: left:50%+tr.x%, transform: translate(-50%) scale(sx,sy) — 多层 % + scale 叠加, 易被 CSS edge cases 干扰
            //   新: 直接算 image bbox 在 canvas 内的绝对 px (left/top/width/height), transform 只 rotate
            //        跟 react-draggable (编辑器用的) 同理念 — 单一 source of truth, 不依赖任何 CSS scale 复合
            const naturalAspect = naturalAspects.get(c.id) ?? 1; // h/w
            const totalRot = tr.rotation + fxA.rotateAdd;
            // v23-i: 删 scene 强制 z=0 — 按 lane 排 (lane 0 顶, 大 lane 底)
            const z = 10 - c.lane;
            // image bbox px (含 tr.scale + fxA.scaleMul):
            const effectiveScale = tr.scale * fxA.scaleMul;
            // v23-i: scene 也乘 effectiveScale (用户痛点 "场景图片无法缩小或放大")
            // scene 默认 cover 整 canvas (scale=1), 放大 → 超出露出部分被 overflow:hidden 裁掉, 缩小 → 露出底层
            const eW = isScene
              ? canvasSize.w * effectiveScale
              : Math.min(canvasSize.w, canvasSize.h) * 0.6 * effectiveScale;
            const eH = isScene ? canvasSize.h * effectiveScale : eW * naturalAspect;
            // image 中心 in canvas px (canvas 内部坐标)
            const cx = canvasSize.w * (0.5 + tr.x / 100) + fxA.offsetX;
            const cy = canvasSize.h * (0.5 + tr.y / 100) + fxA.offsetY;
            // image 左上角 px
            const left = cx - eW / 2;
            const top = cy - eH / 2;
            const imgWidth = isScene ? canvasSize.w : Math.min(canvasSize.w, canvasSize.h) * 0.6; // overlay 报告用
            const sx = effectiveScale * (tr.flipX ? -1 : 1);
            const sy = effectiveScale;
            return (
              <div
                key={c.id}
                className={`am-stage-img${isSel ? ' is-selected' : ''}${isScene ? ' am-stage-scene' : ''}${c.id === fxTargetImageId ? ' am-stage-fx-target' : ''}`}
                style={{
                  // px-based positioning — 不再用 % + translate(-50%) 双重转换, 不用 scale transform
                  left: left,
                  top: top,
                  width: eW,
                  height: eH,
                  transform: totalRot !== 0 ? `rotate(${totalRot}deg)` : undefined,
                  opacity: fxA.alpha,
                  filter: fxA.filter || undefined,
                  zIndex: z,
                  cursor: isSel ? 'move' : 'pointer',
                }}
                onPointerDown={(e) => startStageDrag(e, c, 'move')}
                onDragStart={(e) => e.preventDefault()}
                onContextMenu={(e) => onClipContextMenu?.(e, c)}
              >
                <img
                  src={c.src}
                  alt={c.label}
                  draggable={false}
                  onLoad={(e) => {
                    const t = e.currentTarget;
                    if (t.naturalWidth > 0) {
                      const aspect = t.naturalHeight / t.naturalWidth;
                      setNaturalAspects(prev => {
                        if (prev.get(c.id) === aspect) return prev;
                        const next = new Map(prev);
                        next.set(c.id, aspect);
                        return next;
                      });
                    }
                  }}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: isScene ? 'cover' : 'contain',
                    display: 'block',
                    transform: tr.flipX ? 'scaleX(-1)' : undefined,
                  }}
                />
                {isSel && (
                  <>
                    <div className="am-stage-frame" />
                    <div
                      className="am-stage-handle am-stage-handle-se"
                      onPointerDown={(e) => { e.stopPropagation(); startStageDrag(e, c, 'scale'); }}
                      title="拖动缩放"
                    />
                  </>
                )}
              </div>
            );
          })}
          {/* v23-j (phase 2): 超宽场景 Mini 预览 — 选中 scene + scale > 1.2 时画板右上显 mini */}
          {selectedImageOnStage && selectedImageOnStage.kind === 'scene' && (selectedImageOnStage.transform?.scale ?? 1) > 1.2 && (
            <SceneMiniPreview
              clip={selectedImageOnStage}
              canvasSize={canvasSize}
              onTransformLive={onTransformLive}
              onBeginDrag={onBeginDrag}
              onEndDrag={onEndDrag}
            />
          )}
          {/* v23-h: 移动 A/B markers 已迁到 FX clip 选中时 (FXProps Inspector wizard), stage 上不再有 FAB/markers */}
          {/* selectedFxMoveClip ? render markers : null — markers 由选中 fx 'move' clip 时显示 (用 targetClipId 找 image, 取 fx clip 的 startTransform/endTransform) */}
          {(() => {
            const selFx = clips.find(c => c.id === selectedId && c.trackId === 'fx' && c.fx === 'move') as FXClip | undefined;
            if (!selFx || !selFx.startTransform || !selFx.endTransform) return null;
            // 只在 FX clip active 时段显 markers (playhead 在 fx clip 内)
            if (time < selFx.start || time >= selFx.end) return null;
            const sT = selFx.startTransform;
            const eT = selFx.endTransform;
            const ax = 50 + sT.x;
            const ay = 50 + sT.y;
            const bx = 50 + eT.x;
            const by = 50 + eT.y;
            const sameSpot = Math.abs(sT.x - eT.x) < 0.5 && Math.abs(sT.y - eT.y) < 0.5;
            return (
              <div className="am-move-overlay" style={{ zIndex: 200 }}>
                <svg className="am-move-overlay-arrow" viewBox="0 0 100 100" preserveAspectRatio="none">
                  <defs>
                    <marker id="am-move-arrow-head" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                      <path d="M 0 0 L 10 5 L 0 10 z" fill="#FF5E00" />
                    </marker>
                  </defs>
                  {!sameSpot && (
                    <line x1={ax} y1={ay} x2={bx} y2={by}
                      stroke="#FF5E00" strokeWidth="0.5" strokeDasharray="1.5 1.5"
                      markerEnd="url(#am-move-arrow-head)" />
                  )}
                </svg>
                <div
                  className="am-move-marker am-move-marker-a"
                  style={{ left: `${ax}%`, top: `${ay}%` }}
                  onPointerDown={(e) => startFXMoveMarkerDrag(e, selFx, 'start')}
                  title="起点 A · 拖到画面初始位置"
                >A</div>
                <div
                  className="am-move-marker am-move-marker-b"
                  style={{ left: `${bx}%`, top: `${by}%` }}
                  onPointerDown={(e) => startFXMoveMarkerDrag(e, selFx, 'end')}
                  title="终点 B · 拖到画面终止位置"
                >B</div>
                {sameSpot && (
                  <div className="am-move-hint-bubble" style={{ left: `${ax}%`, top: `${ay}%` }}>
                    起=终 · 拖 <strong>B</strong> 设终点位置
                  </div>
                )}
              </div>
            );
          })()}
          {/* legacy: image.caption fallback (旧 draft 兼容) — 没 caption track 时显示 */}
          {fallbackCaption && (
            <div className="am-caption" style={{ fontSize: captionSize }}>{fallbackCaption}</div>
          )}
          {/* caption track 上的字幕: 每个独立可拖 + 双击编辑 */}
          {activeCaptionClips.map(c => {
            const tr = c.transform ?? DEFAULT_CAPTION_TRANSFORM;
            const isSel = c.id === selectedId;
            const isEditing = c.id === editingCaptionId;
            const style: CaptionStyle = c.style ?? DEFAULT_CAPTION_STYLE;
            const cFontSize = c.fontSize ?? captionSize;
            // meme/bar 默认白字, panel 默认黑字 (跟样式背景反色)
            const cColor = c.color ?? (style === 'panel' ? '#000' : '#fff');
            // v23-k: 字幕入场动效 — 实时计算 (编辑时禁用动效, 不打扰)
            const ent = isEditing ? { opacity: 1, scale: 1, visibleText: c.text } : computeCaptionEntrance(c, time);
            const xformStyle = (ent.opacity < 1 || Math.abs(ent.scale - 1) > 0.01)
              ? { opacity: ent.opacity, transform: `translate(-50%, -50%) scale(${ent.scale})` }
              : {};
            return (
              <div
                key={c.id}
                className={`am-caption-stage am-caption-style-${style}${isSel ? ' is-selected' : ''}${isEditing ? ' is-editing' : ''}`}
                style={{
                  left: `${50 + tr.x}%`,
                  top: `${50 + tr.y}%`,
                  fontSize: cFontSize,
                  color: cColor,
                  cursor: isEditing ? 'text' : (isSel ? 'move' : 'pointer'),
                  ...xformStyle,
                }}
                onPointerDown={(e) => startCaptionDrag(e, c)}
                onDoubleClick={(e) => { e.stopPropagation(); setEditingCaptionId(c.id); onSelect(c.id); }}
                onContextMenu={(e) => onClipContextMenu?.(e, c)}
              >
                {isEditing ? (
                  <textarea
                    autoFocus
                    className="am-caption-edit"
                    value={c.text}
                    onChange={(e) => onCaptionTextLive(c.id, e.target.value)}
                    onBlur={() => setEditingCaptionId(null)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') { e.preventDefault(); setEditingCaptionId(null); }
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); setEditingCaptionId(null); }
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                    style={{ fontSize: cFontSize, color: cColor }}
                  />
                ) : (
                  ent.visibleText || (c.text ? '' : '空字幕')
                )}
              </div>
            );
          })}
          {lanes.image > 1 && <div className="am-preview-lane-tag">画面 × {lanes.image}</div>}
        </div>
      </div>

      <div className="am-transport">
        <button className="am-step-btn" onClick={() => onSeek(0)} title="跳到开头"><SkipBack size={14} /></button>
        <button className="am-play-btn" onClick={onPlayPause} title="播放/暂停 (Space)">
          {isPlaying ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <button className="am-step-btn" onClick={() => onSeek(Math.min(time + 1, duration))} title="前进 1s"><SkipForward size={14} /></button>
        <div className="am-transport-time">
          <span>{formatTC(time)}</span>
          <span className="am-transport-total">/ {formatTC(duration)}</span>
        </div>
        <div className="am-toolbar-spacer" />
        <div className="am-transport-kbd">Space 播放 · S 切分 · ←→ 微调 · Ctrl+S 存草稿</div>
      </div>
    </section>
  );
}

// ============================================================
// RIGHT PANE — Inspector
// ============================================================
function RightPane({
  clip, project, playhead, selectedId,
  onSelect, onUpdate, onTransform, onDelete, onDeleteClip, onSplit, onDuplicate, onMoveLane, onSetClipLane, onReorderLayer,
  onLinkCaptionTTS, onUnlinkCaptionTTS,
  onClipContextMenu,
}: {
  clip: Clip | null;
  project: ProjectState;
  playhead: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onUpdate: (patch: Record<string, unknown>) => void;
  onTransform: (t: Partial<Transform>) => void;
  onDelete: () => void;
  onDeleteClip: (id: string) => void;
  onSplit: () => void;
  onDuplicate: () => void;
  onMoveLane: (dir: -1 | 1) => void;
  onSetClipLane: (id: string, lane: number) => void;
  onReorderLayer: (draggedId: string, targetId: string) => void;
  onLinkCaptionTTS: (capId: string, ttsId: string) => void;
  onUnlinkCaptionTTS: (id: string) => void;
  onClipContextMenu?: (e: React.MouseEvent, clip: Clip) => void;
}) {
  return (
    <aside className="desktop-sidebar-right am-pane-right">
      <LayerPanel
        clips={project.clips}
        playhead={playhead}
        selectedId={selectedId}
        onSelect={onSelect}
        onDelete={onDeleteClip}
        onReorder={onReorderLayer}
        onClipContextMenu={onClipContextMenu}
      />
      <div className="sidebar-section win7-panel am-right-section">
        <div className="sidebar-section-header">
          <span className="sidebar-icon">⚙️</span>
          <span className="sidebar-label">属性面板</span>
          {clip && <span className="am-track-tag">{TRACK_META[clip.trackId].name} {clip.lane + 1}</span>}
        </div>
        {!clip ? (
          <div className="am-inspector-empty">
            <Settings size={26} strokeWidth={1.5} />
            <div className="am-inspector-empty-ttl">选中时间轴或预览片段</div>
            <div className="am-inspector-empty-hint">在此调整属性 · 右键片段看完整菜单</div>
            <div className="am-shortcut-hint am-shortcut-hint-minimal">
              <div><kbd>Space</kbd> 播放 · <kbd>S</kbd> 切分 · <kbd>Del</kbd> 删除</div>
              <div><kbd>{fmtShortcut('Mod+Z')}</kbd> 撤销 · <kbd>{fmtShortcut('Mod+S')}</kbd> 存稿</div>
              <div className="am-shortcut-hint-more">⌨️ 完整快捷键 → 顶部"快捷键"按钮</div>
            </div>
          </div>
        ) : (
          <div className="am-inspector-body">
            <div className="am-clip-card">
              <div className={`am-clip-badge am-clip-badge-${clip.trackId}`}>
                {clip.trackId === 'image' ? <img src={(clip as ImageClip).src} alt="" />
                  : clip.trackId === 'tts' ? <Mic size={14} />
                  : <Music size={14} />}
              </div>
              <div className="am-clip-card-meta">
                <div className="am-clip-card-name">{clipDisplayName(clip)}</div>
                <div className="am-clip-card-sub">
                  {clip.start.toFixed(2)}s → {clip.end.toFixed(2)}s · {(clip.end - clip.start).toFixed(2)}s
                </div>
              </div>
            </div>

            <div className="am-quick-actions">
              <button className="am-quick-btn" onClick={onSplit} title="切分 (S)" disabled={playhead <= clip.start + 0.1 || playhead >= clip.end - 0.1}>
                <Scissors size={12} /> <span>切分</span>
              </button>
              <button className="am-quick-btn" onClick={onDuplicate} title="复制 (Ctrl+D)"><CopyIcon size={12} /> <span>复制</span></button>
              <button className="am-quick-btn" onClick={() => onMoveLane(-1)} title="移到上一轨" disabled={clip.lane === 0}>
                <ChevronUp size={12} /> <span>上轨</span>
              </button>
              <button className="am-quick-btn" onClick={() => onMoveLane(1)} title="移到下一轨 (越界自动新建)">
                <ChevronDown size={12} /> <span>下轨</span>
              </button>
            </div>

            <Field label="时间">
              <div className="am-row">
                <NumberInput label="开始" value={clip.start} step={0.1}
                  onChange={(v) => onUpdate({ start: clamp(v, 0, clip.end - 0.2) })} />
                <NumberInput label="结束" value={clip.end} step={0.1}
                  onChange={(v) => onUpdate({ end: clamp(v, clip.start + 0.2, project.duration) })} />
              </div>
            </Field>
            {/* v23-b: 图层 (lane) — 用户直接改 image/caption/fx/tts/bgm 各自的 lane index */}
            <Field label={`图层 · ${TRACK_META[clip.trackId].name} ${clip.lane + 1}`}>
              <div className="am-lane-row">
                <button className="am-lane-btn" onClick={() => onMoveLane(-1)} disabled={clip.lane === 0} title="移到上一轨">
                  <ChevronUp size={12} />
                </button>
                <select
                  className="am-lane-select"
                  value={clip.lane}
                  onChange={(e) => {
                    const v = parseInt(e.target.value);
                    if (v === clip.lane) return;
                    onSetClipLane(clip.id, v);
                  }}
                >
                  {Array.from({ length: project.lanes[clip.trackId] + 1 }).map((_, i) => (
                    <option key={i} value={i}>{TRACK_META[clip.trackId].name} {i + 1}{i === project.lanes[clip.trackId] ? ' (新建轨)' : ''}</option>
                  ))}
                </select>
                <button className="am-lane-btn" onClick={() => onMoveLane(1)} title="移到下一轨 (越界自动新建)">
                  <ChevronDown size={12} />
                </button>
              </div>
              <div className="am-field-sublabel">高 lane 盖低 lane · 越界下移自动建新轨</div>
            </Field>

            {clip.trackId === 'image'   && <ImageProps   clip={clip} onUpdate={onUpdate} onTransform={onTransform} />}
            {clip.trackId === 'caption' && <CaptionProps clip={clip} onUpdate={onUpdate} onTransform={onTransform} project={project} onLinkCaptionTTS={onLinkCaptionTTS} onUnlinkCaptionTTS={onUnlinkCaptionTTS} />}
            {clip.trackId === 'fx'      && <FXProps      clip={clip} project={project} onUpdate={onUpdate} />}
            {clip.trackId === 'tts'     && <TTSProps     clip={clip} onUpdate={onUpdate} project={project} onLinkCaptionTTS={onLinkCaptionTTS} onUnlinkCaptionTTS={onUnlinkCaptionTTS} />}
            {clip.trackId === 'bgm'     && <BGMProps     clip={clip} onUpdate={onUpdate} />}

            <button className="am-delete-btn" onClick={onDelete}>
              <Trash2 size={13} /> <span>删除片段</span>
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}

// LayerPanel — 剪映模式
// 默认只显当前 playhead 时刻 active 的 clips (跟剪映"当前帧图层"一致),
// 避免几十个素材堆一起. "全部" toggle 切换到完整列表.
function LayerPanel({
  clips, playhead, selectedId, onSelect, onDelete, onReorder, onClipContextMenu,
}: {
  clips: Clip[];
  playhead: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onDelete: (id: string) => void;
  onReorder: (draggedId: string, targetId: string) => void;
  onClipContextMenu?: (e: React.MouseEvent, clip: Clip) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const dragIdRef = useRef<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  // 图层概念只对图片/字幕有意义, 配音/音乐当独立轨即可 — 过滤掉 tts/bgm
  const visualClips = useMemo(
    () => clips.filter(c => c.trackId === 'image' || c.trackId === 'caption'),
    [clips],
  );
  const activeClips = useMemo(
    () => visualClips.filter(c => playhead >= c.start && playhead < c.end),
    [visualClips, playhead],
  );
  const displayClips = showAll ? visualClips : activeClips;
  const headLabel = showAll ? `全部 ${visualClips.length}` : `当前 ${activeClips.length} / ${visualClips.length}`;

  return (
    <div className="sidebar-section win7-panel am-layer-section">
      <div className="sidebar-section-header" onClick={() => setCollapsed(c => !c)} style={{ cursor: 'pointer' }}>
        <span className="sidebar-icon">🎞</span>
        <span className="sidebar-label">图层 ({headLabel})</span>
        <button
          className={`am-layer-mode-btn${showAll ? ' is-on' : ''}`}
          onClick={(e) => { e.stopPropagation(); setShowAll(v => !v); }}
          title={showAll ? '切到只看当前帧' : '查看所有片段'}
          type="button"
        >
          {showAll ? '当前' : '全部'}
        </button>
        <span className="am-layer-toggle">{collapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}</span>
      </div>
      {!collapsed && (
        <div className="am-layer-list">
          {displayClips.length === 0 ? (
            <div className="am-layer-empty">
              {clips.length === 0
                ? '没有片段'
                : <>当前时刻无图层<br /><span style={{ fontSize: 10, opacity: 0.7 }}>点 "全部" 查看所有片段</span></>}
            </div>
          ) : (
            TRACK_ORDER.map(type => {
              const typeClips = displayClips.filter(c => c.trackId === type).sort((a, b) => b.lane - a.lane || a.start - b.start);
              if (typeClips.length === 0) return null;
              const TMIcon = TRACK_META[type].icon;
              return (
                <div key={type} className="am-layer-group">
                  <div className={`am-layer-group-head am-layer-group-${type}`}>
                    <span className="am-layer-group-emoji"><TMIcon size={12} strokeWidth={2.2} /></span>
                    <span className="am-layer-group-name">{TRACK_META[type].name}</span>
                    <span className="am-layer-group-count">{typeClips.length}</span>
                  </div>
                  {typeClips.map(c => {
                    const isDragOver = dragOverId === c.id;
                    return (
                      <div
                        key={c.id}
                        className={`am-layer-item am-layer-item-${type}${c.id === selectedId ? ' is-selected' : ''}${isDragOver ? ' is-drag-over' : ''}`}
                        onClick={() => onSelect(c.id)}
                        onContextMenu={(e) => onClipContextMenu?.(e, c)}
                        draggable
                        onDragStart={(e) => {
                          dragIdRef.current = c.id;
                          e.dataTransfer.effectAllowed = 'move';
                          try { e.dataTransfer.setData('text/x-am-layer', c.id); } catch {}
                        }}
                        onDragOver={(e) => {
                          if (!dragIdRef.current || dragIdRef.current === c.id) return;
                          // 仅同 type 交换
                          const dragged = clips.find(x => x.id === dragIdRef.current);
                          if (!dragged || dragged.trackId !== c.trackId) return;
                          e.preventDefault();
                          setDragOverId(c.id);
                        }}
                        onDragLeave={() => setDragOverId(prev => prev === c.id ? null : prev)}
                        onDrop={(e) => {
                          e.preventDefault();
                          const draggedId = dragIdRef.current;
                          dragIdRef.current = null;
                          setDragOverId(null);
                          if (!draggedId || draggedId === c.id) return;
                          onReorder(draggedId, c.id);
                        }}
                        onDragEnd={() => { dragIdRef.current = null; setDragOverId(null); }}
                      >
                        <span className="am-layer-drag">⋮⋮</span>
                        {c.trackId === 'image' ? (
                          <img src={(c as ImageClip).src} alt="" className="am-layer-thumb" />
                        ) : (
                          <span className="am-layer-icon"><TMIcon size={14} strokeWidth={2} /></span>
                        )}
                        <div className="am-layer-meta">
                          <div className="am-layer-name">{clipDisplayName(c)}</div>
                          <div className="am-layer-sub">{c.start.toFixed(1)}→{c.end.toFixed(1)}s · L{c.lane + 1}</div>
                        </div>
                        <button
                          className="am-layer-del"
                          onClick={(e) => { e.stopPropagation(); onDelete(c.id); }}
                          title="删除"
                        >
                          <X size={10} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

function clipDisplayName(c: Clip): string {
  if (c.trackId === 'image') return c.label || '图片';
  if (c.trackId === 'caption') return (c.text || '空字幕').slice(0, 20);
  if (c.trackId === 'fx') return FX_LABEL[c.fx] || '特效';
  if (c.trackId === 'tts') return (c.text || '空配音').slice(0, 20);
  return c.name || '背景音乐';
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="am-field"><div className="am-field-label">{label}</div>{children}</div>;
}

function NumberInput({ label, value, onChange, step, min, max }: { label: string; value: number; onChange: (v: number) => void; step: number; min?: number; max?: number }) {
  return (
    <div className="am-numinput-wrap">
      <div className="am-field-sublabel">{label}</div>
      <input
        type="number"
        className="am-input am-tabular"
        value={Number(value.toFixed(2))}
        step={step} min={min} max={max}
        onChange={(e) => onChange(parseFloat(e.target.value || '0'))}
      />
    </div>
  );
}

// 找时段最重叠的另一类 clip (找 overlap 最大, 没 overlap 找最近)
function findCounterpartClip(clips: Clip[], src: { start: number; end: number }, targetType: TrackType): Clip | null {
  const candidates = clips.filter(c => c.trackId === targetType);
  if (candidates.length === 0) return null;
  let best: Clip | null = null;
  let bestScore = -Infinity;
  for (const c of candidates) {
    const overlap = Math.max(0, Math.min(c.end, src.end) - Math.max(c.start, src.start));
    const proximity = -Math.abs((c.start + c.end) / 2 - (src.start + src.end) / 2);
    const score = overlap * 1000 + proximity;
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return best;
}

function CaptionProps({ clip, onUpdate, onTransform, project, onLinkCaptionTTS, onUnlinkCaptionTTS }: {
  clip: CaptionClip;
  onUpdate: (p: Record<string, unknown>) => void;
  onTransform: (t: Partial<Transform>) => void;
  project: ProjectState;
  onLinkCaptionTTS: (capId: string, ttsId: string) => void;
  onUnlinkCaptionTTS: (id: string) => void;
}) {
  const t = clip.transform ?? DEFAULT_CAPTION_TRANSFORM;
  const curStyle: CaptionStyle = clip.style ?? DEFAULT_CAPTION_STYLE;
  const curSize = clip.fontSize ?? 32;
  // meme/bar 默认色不一样, 让 active swatch 跟样式联动
  const defaultColor = curStyle === 'panel' ? '#000000' : '#ffffff';
  const curColor = clip.color ?? defaultColor;
  const STYLE_OPTIONS: { id: CaptionStyle; label: string; tip: string }[] = [
    { id: 'meme', label: 'Meme', tip: '白字黑描边 (经典款, 跟编辑器一致)' },
    { id: 'panel', label: '白板', tip: '白底黑框, 配音 / 旁白感' },
    { id: 'bar', label: '黑条', tip: '黑底白字, 电影字幕条感' },
  ];
  const SIZE_PRESETS = [
    { v: 22, lbl: '小' },
    { v: 32, lbl: '中' },
    { v: 48, lbl: '大' },
    { v: 64, lbl: '特大' },
  ];
  // v23-e: 对齐 = 时间对齐 + 建立双向 link (caption.start/end 改时, tts 自动跟随)
  const ttsCandidates = project.clips.filter(c => c.trackId === 'tts');
  const linkedTTS = clip.linkedTTSId ? project.clips.find(c => c.id === clip.linkedTTSId && c.trackId === 'tts') as TTSClip | undefined : undefined;
  const alignToTTS = () => {
    if (ttsCandidates.length === 0) {
      toast.error('当前没有配音 clip · 先拖一个 TTS 上时间轴 (LeftPane 配音 subtab)', { duration: 5000 });
      return;
    }
    const counterpart = findCounterpartClip(project.clips, { start: clip.start, end: clip.end }, 'tts') as TTSClip | null;
    if (!counterpart) { toast.error('找不到合适的配音 clip 对齐'); return; }
    // v23-k: 字幕时段 + 文本 同步到配音 + 建 link (跟 alignToCaption 对称)
    const ttsText = counterpart.text || '';
    onUpdate({ start: counterpart.start, end: counterpart.end, text: ttsText, linkedTTSId: counterpart.id });
    onLinkCaptionTTS(clip.id, counterpart.id);
    toast.success(`✓ 字幕 ⇌ 配音 双向链接 · 文字 "${ttsText.slice(0, 12)}" · 时段 ${counterpart.start.toFixed(2)}→${counterpart.end.toFixed(2)}s`, { duration: 4000 });
  };
  const onUnlink = () => {
    onUnlinkCaptionTTS(clip.id);
    toast('已解除 字幕 ⇌ 配音 链接');
  };
  return (
    <>
      {/* v23-e: link 状态 — 已链接显绿条 + 解绑, 未链接显对齐按钮 */}
      {linkedTTS ? (
        <div className="am-link-status am-link-status-active">
          <div className="am-link-status-line">
            <Check size={13} strokeWidth={2.4} />
            <span className="am-link-status-label">已链接配音</span>
            <span className="am-link-status-target" title={`TTS clip: ${linkedTTS.id}`}>"{(linkedTTS.text || '空').slice(0, 12)}"</span>
          </div>
          <div className="am-link-status-line">
            <span className="am-link-status-hint">改字幕时段 / 文字 → 配音自动跟随同步</span>
            <button type="button" className="am-link-unlink-btn" onClick={onUnlink}>解除</button>
          </div>
        </div>
      ) : (
        <div className="am-align-quick-row">
          <button
            type="button"
            className="am-align-quick-btn"
            onClick={alignToTTS}
            disabled={ttsCandidates.length === 0}
            title={ttsCandidates.length === 0 ? '当前没有配音 clip · 先拖一个 TTS 上时间轴' : `字幕 ⇌ 配音 双向链接 (时段同步 + 文字同步, ${ttsCandidates.length} 个候选)`}
          >
            <ArrowLeftRight size={14} strokeWidth={2.2} />
            <span>链接配音{ttsCandidates.length > 0 ? ` (${ttsCandidates.length})` : ''}</span>
          </button>
          <div className="am-align-quick-hint">{ttsCandidates.length === 0 ? '⚠️ 还没有配音' : '一键时段对齐 + 双向同步'}</div>
        </div>
      )}
      <Field label="字幕文字">
        <textarea
          className="am-input am-textarea"
          value={clip.text || ''}
          onChange={(e) => onUpdate({ text: e.target.value })}
          placeholder="输入字幕…(画板内双击字幕也能直接编辑)"
          maxLength={80}
        />
        <div className="am-field-sublabel">画板内拖动字幕调位置 · 双击进入编辑</div>
      </Field>

      <Field label="样式">
        <div className="am-style-chips">
          {STYLE_OPTIONS.map(s => (
            <button
              key={s.id}
              type="button"
              className={`am-style-chip am-style-chip-${s.id}${curStyle === s.id ? ' is-active' : ''}`}
              onClick={() => onUpdate({ style: s.id })}
              title={s.tip}
            >
              <span className={`am-style-preview am-style-preview-${s.id}`}>Aa</span>
              <span className="am-style-label">{s.label}</span>
            </button>
          ))}
        </div>
      </Field>

      <Field label={`位置 · X ${t.x.toFixed(0)}% / Y ${t.y.toFixed(0)}%`}>
        <div className="am-row">
          <NumberInput label="X%" value={t.x} step={1} min={-50} max={50} onChange={(v) => onTransform({ x: clamp(v, -50, 50) })} />
          <NumberInput label="Y%" value={t.y} step={1} min={-50} max={50} onChange={(v) => onTransform({ y: clamp(v, -50, 50) })} />
        </div>
      </Field>

      <Field label={`字号 · ${curSize}px`}>
        <div className="am-size-preset-row">
          {SIZE_PRESETS.map(p => (
            <button
              key={p.v}
              type="button"
              className={`am-size-preset${curSize === p.v ? ' is-active' : ''}`}
              onClick={() => onUpdate({ fontSize: p.v })}
              title={`${p.v}px`}
            >
              <span className="am-size-preset-num" style={{ fontSize: Math.min(18, Math.max(10, p.v * 0.35)) }}>A</span>
              <span className="am-size-preset-lbl">{p.lbl}</span>
            </button>
          ))}
        </div>
        <input
          type="range" min="14" max="120" step="1"
          value={curSize}
          onChange={(e) => onUpdate({ fontSize: parseInt(e.target.value) })}
          className="am-range"
        />
      </Field>

      <Field label="颜色">
        <div className="am-chips">
          {['#ffffff', '#000000', '#FF5E00', '#1f84df', '#00CC66', '#cb2a2a', '#ffbf22'].map(c => (
            <button
              key={c}
              className={'am-chip am-chip-color' + (curColor.toLowerCase() === c.toLowerCase() ? ' is-active' : '')}
              style={{ background: c }}
              onClick={() => onUpdate({ color: c })}
              type="button"
              title={c}
            >
              {curColor.toLowerCase() === c.toLowerCase() && <span style={{ color: c === '#ffffff' ? '#000' : '#fff' }}>✓</span>}
            </button>
          ))}
        </div>
        <div className="am-field-sublabel">默认色跟样式联动 (Meme/黑条 = 白字 · 白板 = 黑字)</div>
      </Field>

      {/* v23-k Phase A: 入场动效 — 沙雕动画核心 */}
      <Field label={`入场动效 · ${clip.entranceFx ?? 'none'}`}>
        <div className="am-chips am-caption-entrance-chips">
          {([
            { id: 'none' as const, name: '无', tip: '硬切显示' },
            { id: 'fade' as const, name: '淡入', tip: '透明→清晰 0.4s' },
            { id: 'pop' as const, name: '弹入', tip: 'scale 0.5→1 弹性' },
            { id: 'slam' as const, name: '砸字', tip: '大→小 砸入感' },
            { id: 'typewriter' as const, name: '打字机', tip: '字一个个出 (按字 0.06s)' },
          ]).map(opt => (
            <button
              key={opt.id}
              type="button"
              className={'am-chip am-caption-entrance-chip' + ((clip.entranceFx ?? 'none') === opt.id ? ' is-active' : '')}
              onClick={() => onUpdate({ entranceFx: opt.id === 'none' ? undefined : opt.id })}
              title={opt.tip}
            >
              {opt.name}
            </button>
          ))}
        </div>
        <div className="am-field-sublabel">字幕出现时的动画 · 编辑模式不应用 (双击进入编辑)</div>
      </Field>
    </>
  );
}

function ImageProps({ clip, onUpdate, onTransform }: {
  clip: ImageClip;
  onUpdate: (p: Record<string, unknown>) => void;
  onTransform: (t: Partial<Transform>) => void;
}) {
  const t = clip.transform ?? DEFAULT_TRANSFORM;
  const isScene = clip.kind === 'scene';
  return (
    <>
      {isScene && (
        <div className="am-field-sublabel" style={{ marginBottom: 8, padding: '6px 8px', background: '#eef5ff', borderRadius: 4 }}>
          🎬 场景背景 · 自动 cover 全屏 · 推荐配运镜 FX (FX 轨)
        </div>
      )}
      {/* v23-h: 移动动画完全迁到 FX 时间轴 — 用户从 LeftPane "动效" → 移动 拖到 fx 轨建 FX clip */}
      <Field label={`位置 · X ${t.x.toFixed(0)}% / Y ${t.y.toFixed(0)}%`}>
        <div className="am-row">
          <NumberInput label="X%" value={t.x} step={1} min={-60} max={60} onChange={(v) => onTransform({ x: clamp(v, -60, 60) })} />
          <NumberInput label="Y%" value={t.y} step={1} min={-60} max={60} onChange={(v) => onTransform({ y: clamp(v, -60, 60) })} />
        </div>
      </Field>
      <Field label={`缩放 · ${t.scale.toFixed(2)}x${isScene && t.scale > 1.2 ? ' · 超宽场景 (右上 mini 调位置)' : ''}`}>
        <input
          type="range" min="0.2" max={isScene ? 6 : 4} step="0.05"
          value={t.scale}
          onChange={(e) => onTransform({ scale: parseFloat(e.target.value) })}
          className="am-range"
        />
        {isScene && t.scale > 1.2 && (
          <div className="am-field-sublabel">💡 scene 超 1.2x · 画板右上有 mini 预览, 拖 viewport 调镜头位置</div>
        )}
      </Field>
      <Field label={`旋转 · ${Math.round(t.rotation)}°`}>
        <div className="am-row am-row-tight">
          <input
            type="range" min="-180" max="180" step="1"
            value={t.rotation}
            onChange={(e) => onTransform({ rotation: parseFloat(e.target.value) })}
            className="am-range"
          />
          <button className="am-quick-btn am-quick-btn-mini" onClick={() => onTransform({ rotation: 0 })} title="重置旋转"><RotateCw size={11} /></button>
        </div>
      </Field>
      <Field label="翻转">
        <button className={'am-chip' + (t.flipX ? ' is-active' : '')} onClick={() => onTransform({ flipX: !t.flipX })} type="button">
          <FlipHorizontal size={12} /> 水平翻转
        </button>
      </Field>
      {/* v23-f: 删除 "自带特效" Field (chips 入场/强调/出场/运镜) — 改用独立 FX 时间轴, 防混淆 */}
      {/* 想给 image 加 fade-in / shake / pan / zoom 等? 拖 LeftPane "动画特效" 到 FX 时间轴, 然后在 FXProps Inspector 选 "作用对象" 绑定到这个 image */}
      <Field label="标签">
        <input className="am-input" value={clip.label || ''} onChange={(e) => onUpdate({ label: e.target.value })} placeholder="片段标签..." />
      </Field>
    </>
  );
}

function FXProps({ clip, project, onUpdate }: {
  clip: FXClip;
  project: ProjectState;
  onUpdate: (p: Record<string, unknown>) => void;
}) {
  const imageClips = project.clips.filter((c): c is ImageClip => c.trackId === 'image');
  // v23-h: 5 group, move 也是 FX clip (不再走 image.fx)
  const groups: { label: string; group: FxGroup }[] = [
    { label: '入场', group: 'enter' },
    { label: '强调', group: 'emphasis' },
    { label: '出场', group: 'exit' },
    { label: '运镜', group: 'camera' },
    { label: '移动', group: 'move' },
  ];
  const isMove = clip.fx === 'move';
  const startT = clip.startTransform ?? DEFAULT_TRANSFORM;
  const endT = clip.endTransform ?? startT;
  const swapStartEnd = () => {
    onUpdate({ startTransform: { ...endT }, endTransform: { ...startT } });
  };
  const setEqual = (which: 'B=A' | 'A=B') => {
    if (which === 'B=A') onUpdate({ endTransform: { ...startT } });
    else onUpdate({ startTransform: { ...endT } });
  };
  // 切换到 move 时 auto-init transforms (若空)
  const switchFx = (newFx: ImageFx) => {
    if (newFx === 'move' && (!clip.startTransform || !clip.endTransform)) {
      // 找 target image 起 transform
      const target = clip.targetClipId ? imageClips.find(ic => ic.id === clip.targetClipId) : imageClips[0];
      const t = target?.transform ?? DEFAULT_TRANSFORM;
      onUpdate({ fx: newFx, startTransform: { ...t }, endTransform: { ...t } });
    } else if (newFx !== 'move') {
      // 切走 move → 清 transforms 释放空间 (改回还会自动 re-init)
      onUpdate({ fx: newFx, startTransform: undefined, endTransform: undefined });
    } else {
      onUpdate({ fx: newFx });
    }
  };
  // v23-k: 作用对象 helpers — chip 风格替代 select, 提到 FXProps 顶部
  const currentTarget = clip.targetClipId ? imageClips.find(ic => ic.id === clip.targetClipId) : undefined;
  const targetSummary = !clip.targetClipId
    ? '🌐 全局 (所有同时刻图叠加)'
    : `${currentTarget?.kind === 'scene' ? '🎬 场景' : '🐼 角色'} · ${currentTarget?.label || '图片'}`;
  return (
    <>
      {/* v23-k: 作用对象 — 顶部显著卡片 (用户立刻看到 FX 作用于谁, chip 直接换) */}
      <div className="am-fx-target-card">
        <div className="am-fx-target-head">
          <Layers size={13} strokeWidth={2.2} />
          <span>作用对象</span>
          <span className="am-fx-target-summary">{targetSummary}</span>
        </div>
        <div className="am-fx-target-chips">
          <button
            type="button"
            className={'am-fx-target-chip' + (!clip.targetClipId ? ' is-active' : '')}
            onClick={() => onUpdate({ targetClipId: undefined })}
            title="所有同时刻 image 都叠加 (全局)"
          >
            🌐 全局
          </button>
          {imageClips.map(ic => (
            <button
              key={ic.id}
              type="button"
              className={'am-fx-target-chip' + (clip.targetClipId === ic.id ? ' is-active' : '') + (ic.kind === 'scene' ? ' am-fx-target-chip-scene' : '')}
              onClick={() => onUpdate({ targetClipId: ic.id })}
              title={`${ic.label || '图片'} · ${ic.start.toFixed(1)}-${ic.end.toFixed(1)}s${ic.kind === 'scene' ? ' (场景)' : ''}`}
            >
              {ic.kind === 'scene' ? '🎬' : '🐼'} {(ic.label || '图').slice(0, 6)}
            </button>
          ))}
        </div>
        <div className="am-fx-target-tip">💡 默认绑定到顶层非场景 image · 右键 timeline FX clip 也能快换</div>
      </div>
      {/* v23-h: 移动特效引导卡 — 放最顶部 (用户点 timeline 上的 move clip 立刻看到) */}
      {isMove && (
        <div className="am-fx-move-guide">
          <div className="am-fx-move-guide-head">
            <Move size={14} strokeWidth={2.2} />
            <span>移动动画 · 引导</span>
          </div>
          <div className="am-fx-move-guide-body">
            画面会从 <strong>起点 A</strong> 缓慢移到 <strong>终点 B</strong>.<br/>
            <strong>速度 = 这个 FX clip 的时长</strong> (timeline 上拖把手调).<br/>
            <strong>在画板上直接拖蓝色 A 和橙色 B 圆圈</strong>设位置 — 最快.
          </div>
          {/* 双卡 visual */}
          <div className="am-move-frames">
            <div className="am-move-frame am-move-frame-start">
              <div className="am-move-frame-head">
                <span className="am-move-frame-badge">起点 A</span>
                <span className="am-move-frame-meta">X {startT.x.toFixed(0)} · Y {startT.y.toFixed(0)} · {startT.scale.toFixed(2)}x</span>
              </div>
              <div className="am-move-frame-thumb">
                <div className="am-move-frame-canvas">
                  <div className="am-move-frame-dot am-move-frame-dot-start"
                    style={{ left: `${50 + startT.x * 0.4}%`, top: `${50 + startT.y * 0.4}%`, transform: `translate(-50%, -50%) scale(${Math.min(2, Math.max(0.4, startT.scale))})` }}
                  >A</div>
                </div>
              </div>
            </div>
            <div className="am-move-frame am-move-frame-end">
              <div className="am-move-frame-head">
                <span className="am-move-frame-badge am-move-frame-badge-end">终点 B</span>
                <span className="am-move-frame-meta">X {endT.x.toFixed(0)} · Y {endT.y.toFixed(0)} · {endT.scale.toFixed(2)}x</span>
              </div>
              <div className="am-move-frame-thumb">
                <div className="am-move-frame-canvas">
                  <div className="am-move-frame-dot am-move-frame-dot-start am-move-frame-dot-ghost"
                    style={{ left: `${50 + startT.x * 0.4}%`, top: `${50 + startT.y * 0.4}%`, transform: `translate(-50%, -50%) scale(${Math.min(2, Math.max(0.4, startT.scale))})` }}
                  >A</div>
                  <svg className="am-move-frame-arrow" viewBox="0 0 100 100" preserveAspectRatio="none">
                    <line x1={50 + startT.x * 0.4} y1={50 + startT.y * 0.4} x2={50 + endT.x * 0.4} y2={50 + endT.y * 0.4}
                      stroke="#FF5E00" strokeWidth="1.8" strokeDasharray="3 2" />
                  </svg>
                  <div className="am-move-frame-dot am-move-frame-dot-end"
                    style={{ left: `${50 + endT.x * 0.4}%`, top: `${50 + endT.y * 0.4}%`, transform: `translate(-50%, -50%) scale(${Math.min(2, Math.max(0.4, endT.scale))})` }}
                  >B</div>
                </div>
              </div>
            </div>
          </div>
          {/* 双控件 */}
          <div className="am-move-ctrl-section">
            <div className="am-move-ctrl-label am-move-ctrl-label-start">起点 A 位置</div>
            <div className="am-row">
              <NumberInput label="X%" value={startT.x} step={1} min={-60} max={60} onChange={(v) => onUpdate({ startTransform: { ...startT, x: clamp(v, -60, 60) } })} />
              <NumberInput label="Y%" value={startT.y} step={1} min={-60} max={60} onChange={(v) => onUpdate({ startTransform: { ...startT, y: clamp(v, -60, 60) } })} />
              <NumberInput label="缩放" value={startT.scale} step={0.05} min={0.2} max={4} onChange={(v) => onUpdate({ startTransform: { ...startT, scale: clamp(v, 0.2, 4) } })} />
            </div>
          </div>
          <div className="am-move-ctrl-section">
            <div className="am-move-ctrl-label am-move-ctrl-label-end">终点 B 位置</div>
            <div className="am-row">
              <NumberInput label="X%" value={endT.x} step={1} min={-60} max={60} onChange={(v) => onUpdate({ endTransform: { ...endT, x: clamp(v, -60, 60) } })} />
              <NumberInput label="Y%" value={endT.y} step={1} min={-60} max={60} onChange={(v) => onUpdate({ endTransform: { ...endT, y: clamp(v, -60, 60) } })} />
              <NumberInput label="缩放" value={endT.scale} step={0.05} min={0.2} max={4} onChange={(v) => onUpdate({ endTransform: { ...endT, scale: clamp(v, 0.2, 4) } })} />
            </div>
          </div>
          {/* 一键操作 */}
          <div className="am-move-quick-ops">
            <button className="am-move-quick-op" onClick={swapStartEnd} type="button" title="A ↔ B 互换 (一秒反向)">
              <ArrowLeftRight size={11} strokeWidth={2.2} /> A ↔ B 互换
            </button>
            <button className="am-move-quick-op" onClick={() => setEqual('B=A')} type="button" title="把终点设为起点 (不动)">B = A</button>
            <button className="am-move-quick-op" onClick={() => setEqual('A=B')} type="button" title="把起点设为终点 (不动)">A = B</button>
          </div>
          <div className="am-move-tip">
            💡 拖画板上的 A/B 圆圈最直觉 · timeline 拖把手调动画时长 (= 速度)
          </div>
        </div>
      )}
      {/* v23-j (phase 2): 其他 FX 引导卡 — 按 fx.id 切换 */}
      {!isMove && <FXGuideCard clip={clip} onUpdate={onUpdate} />}
      <Field label="特效类型">
        {groups.map(g => (
          <Fragment key={g.group}>
            <div className="am-fx-group-label">{g.label}</div>
            <div className="am-chips am-fx-chips">
              {FX_LIB.filter(f => f.group === g.group).map(f => (
                <button
                  key={f.id}
                  type="button"
                  className={'am-chip am-fx-chip' + (clip.fx === f.id ? ' is-active' : '')}
                  onClick={() => switchFx(f.id)}
                  title={f.desc}
                >
                  <span className="am-fx-chip-emoji"><f.icon size={13} strokeWidth={2} /></span>
                  <span>{f.name}</span>
                </button>
              ))}
            </div>
          </Fragment>
        ))}
      </Field>
      {/* v23-k: 作用对象 移到 FXProps 顶部 (chip 风格), 不再这里 */}
    </>
  );
}

// v23-j (phase 2): 各 FX 引导卡 — 按 fx.id 切换 sub-component
function FXGuideCard({ clip, onUpdate }: { clip: FXClip; onUpdate: (p: Record<string, unknown>) => void }) {
  const fx = clip.fx;
  const info = FX_LIB.find(f => f.id === fx);
  if (!info || fx === 'none' || fx === 'move') return null;
  const Icon = info.icon;
  const strength = clip.strength ?? 1;
  const zoomFrom = clip.zoomFrom ?? (fx === 'zoom' ? 0.3 : 1.0);
  const zoomTo = clip.zoomTo ?? 1.25;
  const spinTurns = clip.spinTurns ?? 1;
  // 强度类 (shake/flash/pulse/glitch 共用)
  const strengthGroup: ImageFx[] = ['shake', 'flash', 'pulse', 'glitch'];
  const panGroup: ImageFx[] = ['pan-l', 'pan-r', 'pan-u', 'pan-d'];
  const enterStrengthGroup: ImageFx[] = ['slide-l', 'slide-r', 'bounce'];
  return (
    <div className="am-fx-guide">
      <div className="am-fx-guide-head">
        <Icon size={14} strokeWidth={2.2} />
        <span>{info.name} · 引导</span>
      </div>
      <div className="am-fx-guide-desc">{info.desc}</div>
      {/* 强度类 — shake/flash/pulse/glitch — 单 strength */}
      {strengthGroup.includes(fx) && (
        <div className="am-fx-guide-row">
          <div className="am-fx-guide-label">强度 · {strength.toFixed(2)}x</div>
          <div className="am-fx-guide-presets">
            {[0.5, 1, 1.5, 2, 3].map(v => (
              <button key={v} className={'am-fx-guide-preset' + (Math.abs(strength - v) < 0.01 ? ' is-active' : '')} onClick={() => onUpdate({ strength: v })} type="button">{v}x</button>
            ))}
          </div>
          <input type="range" min="0" max="3" step="0.05" value={strength} onChange={(e) => onUpdate({ strength: parseFloat(e.target.value) })} className="am-range" />
          <div className="am-fx-guide-tip">💡 timeline 拖把手 = 调动效时长</div>
        </div>
      )}
      {/* pan 镜头平移 — 强度 + 方向 visual */}
      {panGroup.includes(fx) && (
        <div className="am-fx-guide-row">
          <div className="am-fx-guide-label">平移强度 · {strength.toFixed(2)}x</div>
          <div className="am-fx-guide-pan-visual">
            <div className="am-fx-guide-pan-frame">
              <div className={`am-fx-guide-pan-arrow am-fx-guide-pan-arrow-${fx}`} />
            </div>
          </div>
          <div className="am-fx-guide-presets">
            {[0.5, 1, 1.5, 2, 3].map(v => (
              <button key={v} className={'am-fx-guide-preset' + (Math.abs(strength - v) < 0.01 ? ' is-active' : '')} onClick={() => onUpdate({ strength: v })} type="button">{v}x</button>
            ))}
          </div>
          <input type="range" min="0.2" max="3" step="0.05" value={strength} onChange={(e) => onUpdate({ strength: parseFloat(e.target.value) })} className="am-range" />
          <div className="am-fx-guide-tip">💡 镜头 {fx === 'pan-l' ? '从右到左' : fx === 'pan-r' ? '从左到右' : fx === 'pan-u' ? '从下到上' : '从上到下'} 平移 · 强度越大移得越多</div>
        </div>
      )}
      {/* zoom-in/out — from/to scale */}
      {(fx === 'zoom-in' || fx === 'zoom-out') && (
        <div className="am-fx-guide-row">
          <div className="am-fx-guide-label">起始缩放 {zoomFrom.toFixed(2)}x → 结束 {zoomTo.toFixed(2)}x</div>
          <div className="am-row">
            <NumberInput label="从" value={zoomFrom} step={0.05} min={0.3} max={3} onChange={(v) => onUpdate({ zoomFrom: clamp(v, 0.3, 3) })} />
            <NumberInput label="到" value={zoomTo} step={0.05} min={0.3} max={3} onChange={(v) => onUpdate({ zoomTo: clamp(v, 0.3, 3) })} />
          </div>
          <div className="am-fx-guide-presets">
            <button className="am-fx-guide-preset" onClick={() => onUpdate({ zoomFrom: 1.0, zoomTo: 1.25 })} type="button">轻推 1→1.25</button>
            <button className="am-fx-guide-preset" onClick={() => onUpdate({ zoomFrom: 1.0, zoomTo: 1.5 })} type="button">中推 1→1.5</button>
            <button className="am-fx-guide-preset" onClick={() => onUpdate({ zoomFrom: 1.0, zoomTo: 2.0 })} type="button">猛推 1→2</button>
            <button className="am-fx-guide-preset" onClick={() => onUpdate({ zoomFrom: zoomTo, zoomTo: zoomFrom })} type="button">↔ 反向</button>
          </div>
          <div className="am-fx-guide-tip">💡 起→终 lerp · 起=终 → 不动</div>
        </div>
      )}
      {/* ken-burns — 强度 */}
      {fx === 'ken-burns' && (
        <div className="am-fx-guide-row">
          <div className="am-fx-guide-label">推近 + 平移强度 · {strength.toFixed(2)}x</div>
          <div className="am-fx-guide-presets">
            {[0.5, 1, 1.5, 2].map(v => (
              <button key={v} className={'am-fx-guide-preset' + (Math.abs(strength - v) < 0.01 ? ' is-active' : '')} onClick={() => onUpdate({ strength: v })} type="button">{v}x</button>
            ))}
          </div>
          <input type="range" min="0.2" max="3" step="0.05" value={strength} onChange={(e) => onUpdate({ strength: parseFloat(e.target.value) })} className="am-range" />
          <div className="am-fx-guide-tip">💡 经典纪录片感: 缓慢推近同时轻微横向平移</div>
        </div>
      )}
      {/* zoom (入场弹大) — from scale */}
      {fx === 'zoom' && (
        <div className="am-fx-guide-row">
          <div className="am-fx-guide-label">起始缩放 · {zoomFrom.toFixed(2)}x → 1.00x</div>
          <input type="range" min="0.1" max="0.9" step="0.05" value={zoomFrom} onChange={(e) => onUpdate({ zoomFrom: parseFloat(e.target.value) })} className="am-range" />
          <div className="am-fx-guide-presets">
            {[0.1, 0.3, 0.5, 0.7].map(v => (
              <button key={v} className={'am-fx-guide-preset' + (Math.abs(zoomFrom - v) < 0.01 ? ' is-active' : '')} onClick={() => onUpdate({ zoomFrom: v })} type="button">{v}x</button>
            ))}
          </div>
          <div className="am-fx-guide-tip">💡 越小越夸张 (0.1x = 从几乎看不见弹到原大小)</div>
        </div>
      )}
      {/* 入场强度类 — slide-l/r/bounce */}
      {enterStrengthGroup.includes(fx) && (
        <div className="am-fx-guide-row">
          <div className="am-fx-guide-label">{fx === 'bounce' ? '弹跳' : '滑入'}强度 · {strength.toFixed(2)}x</div>
          <input type="range" min="0.3" max="2" step="0.05" value={strength} onChange={(e) => onUpdate({ strength: parseFloat(e.target.value) })} className="am-range" />
          <div className="am-fx-guide-tip">💡 {fx === 'slide-l' ? '从屏幕左外滑入, 强度 = 起始距离' : fx === 'slide-r' ? '从屏幕右外滑入' : '弹跳高度倍数'}</div>
        </div>
      )}
      {/* spin — 圈数 */}
      {fx === 'spin' && (
        <div className="am-fx-guide-row">
          <div className="am-fx-guide-label">转圈数 · {spinTurns} 圈</div>
          <div className="am-fx-guide-presets">
            {[0.5, 1, 2, 3].map(v => (
              <button key={v} className={'am-fx-guide-preset' + (Math.abs(spinTurns - v) < 0.01 ? ' is-active' : '')} onClick={() => onUpdate({ spinTurns: v })} type="button">{v}圈</button>
            ))}
          </div>
          <div className="am-fx-guide-tip">💡 旋转圈数 · 越多越眼花</div>
        </div>
      )}
      {/* fade — 仅说明 */}
      {(fx === 'fade-in' || fx === 'fade-out') && (
        <div className="am-fx-guide-row">
          <div className="am-fx-guide-tip" style={{ marginTop: 0 }}>
            💡 {fx === 'fade-in' ? '画面在 clip 时长内从透明变清晰' : '画面在 clip 时长内从清晰变透明'} · 时长 = clip 时长 (拖把手调)
          </div>
        </div>
      )}
    </div>
  );
}

function TTSProps({ clip, onUpdate, project, onLinkCaptionTTS, onUnlinkCaptionTTS }: { clip: TTSClip; onUpdate: (p: Record<string, unknown>) => void; project: ProjectState; onLinkCaptionTTS: (capId: string, ttsId: string) => void; onUnlinkCaptionTTS: (id: string) => void }) {
  const v = VOICE_BY_ID[resolveVoiceId(clip.voice)];
  // v23-e: estimate 用 clip 级 rate (用户调 1.5x 倍速时, 预计时长 / 1.5)
  const estimatedBase = estimateTTSDuration(clip.text, clip.voice);
  const clipRate = clip.playbackRate ?? VOICE_BY_ID[resolveVoiceId(clip.voice)]?.playbackRate ?? 1.0;
  const voiceRate = VOICE_BY_ID[resolveVoiceId(clip.voice)]?.playbackRate ?? 1.0;
  const estimated = estimatedBase * (voiceRate / clipRate);
  const actual = clip.end - clip.start;
  // 有 audioSrc 时, "对齐" 按钮已无意义 (写入时已自动 align)
  const needsAlign = !clip.audioSrc && Math.abs(estimated - actual) > 0.3;
  const [recording, setRecording] = useState(false);
  const mediaRecRef = useRef<MediaRecorder | null>(null);
  const recStreamRef = useRef<MediaStream | null>(null);

  // 关键: 写 audioSrc 时**自动测真实时长 → 调 clip.end = start + duration**
  // 让时间轴 clip 长度 1:1 跟实际 audio 一致 (剪映/CapCut 标准)
  // → 导出时音视频同步, 不会"配音先于/后于"
  const applyAudioSrc = async (dataUrl: string, label = '配音') => {
    try {
      const duration = await getAudioDuration(dataUrl);
      // wallDuration = audio 原始时长 / playbackRate (rate>1 加速 → 实际墙钟更短)
      // v23-e: clip 级 playbackRate 优先 (用户 inspector 调倍速)
      const rate = clip.playbackRate ?? v.playbackRate ?? 1.0;
      const wallDuration = duration / rate;
      const newEnd = clip.start + wallDuration;
      onUpdate({ audioSrc: dataUrl, end: newEnd, genFailed: false });
      toast.success(`✅ ${label} · 真音轨 ${wallDuration.toFixed(1)}s (rate ${rate.toFixed(2)}) · 时间轴已对齐`);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[audioSrc] duration probe failed:', e);
      onUpdate({ audioSrc: dataUrl, genFailed: false });
      toast.success(`✅ ${label} · 真音轨 (时长探测失败, end 保持)`);
    }
  };

  // 录音 — 浏览器麦克风 dataURL → applyAudioSrc 自动 align
  const startRecord = async () => {
    if (recording) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recStreamRef.current = stream;
      const mr = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      mr.onstop = () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onload = () => {
          void applyAudioSrc(String(reader.result || ''), '录音');
        };
        reader.readAsDataURL(blob);
        stream.getTracks().forEach(t => t.stop());
        recStreamRef.current = null;
      };
      mr.start();
      mediaRecRef.current = mr;
      setRecording(true);
    } catch (e) {
      toast.error('麦克风获取失败 (浏览器权限?)');
      console.warn(e);
    }
  };
  const stopRecord = () => {
    if (!mediaRecRef.current) return;
    try { mediaRecRef.current.stop(); } catch {}
    mediaRecRef.current = null;
    setRecording(false);
  };
  const clearRecord = () => {
    onUpdate({ audioSrc: undefined });
    toast('已删除录音, 导出会烧字幕代替');
  };
  // 跳出框架方案: 用户从外部 TTS (剪映/讯飞/百度/有道) 生成 mp3 → 上传 → applyAudioSrc 自动 align
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    // v23-b: TTS clip 单音频 → 提到 15MB (容纳长台词无损 mp3)
    if (f.size > 15 * 1024 * 1024) {
      toast.error('单 audio 文件最多 15MB');
      return;
    }
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result || ''));
        r.onerror = () => reject(new Error('read failed'));
        r.readAsDataURL(f);
      });
      await applyAudioSrc(dataUrl, `上传 ${f.name}`);
    } catch {
      toast.error('上传失败');
    }
  };
  useEffect(() => () => {
    if (recStreamRef.current) recStreamRef.current.getTracks().forEach(t => t.stop());
  }, []);
  // v23-c: 对齐 candidates + disabled state + debug log
  const capCandidates = project.clips.filter(c => c.trackId === 'caption');
  const linkedCap = clip.linkedCaptionId ? project.clips.find(c => c.id === clip.linkedCaptionId && c.trackId === 'caption') as CaptionClip | undefined : undefined;
  const alignToCaption = () => {
    if (capCandidates.length === 0) {
      toast.error('当前没有字幕 clip · 先拖一个 caption 上时间轴 (LeftPane 字幕 subtab)', { duration: 5000 });
      return;
    }
    const counterpart = findCounterpartClip(project.clips, { start: clip.start, end: clip.end }, 'caption');
    if (!counterpart) { toast.error('找不到合适的字幕 clip 对齐'); return; }
    // v23-e: 配音时段对齐到字幕 + 同步 text + 建 link
    const capText = (counterpart as CaptionClip).text || '';
    onUpdate({ start: counterpart.start, end: counterpart.end, text: capText, audioSrc: undefined, audioEngine: undefined, genFailed: false, linkedCaptionId: counterpart.id });
    onLinkCaptionTTS(counterpart.id, clip.id);
    toast.success(`✓ 配音 ⇌ 字幕 双向链接 · 文字 "${capText.slice(0, 12)}" · 时段 ${counterpart.start.toFixed(2)}→${counterpart.end.toFixed(2)}s`, { duration: 4000 });
  };
  const onUnlink = () => {
    onUnlinkCaptionTTS(clip.id);
    toast('已解除 配音 ⇌ 字幕 链接');
  };
  return (
    <>
      {linkedCap ? (
        <div className="am-link-status am-link-status-active">
          <div className="am-link-status-line">
            <Check size={13} strokeWidth={2.4} />
            <span className="am-link-status-label">已链接字幕</span>
            <span className="am-link-status-target" title={`Caption clip: ${linkedCap.id}`}>"{(linkedCap.text || '空').slice(0, 12)}"</span>
          </div>
          <div className="am-link-status-line">
            <span className="am-link-status-hint">字幕改动时配音自动跟随 (时段 + 文字)</span>
            <button type="button" className="am-link-unlink-btn" onClick={onUnlink}>解除</button>
          </div>
        </div>
      ) : (
        <div className="am-align-quick-row">
          <button
            type="button"
            className="am-align-quick-btn"
            onClick={alignToCaption}
            disabled={capCandidates.length === 0}
            title={capCandidates.length === 0 ? '当前没有字幕 clip · 先拖一个 caption 上时间轴' : `配音 ⇌ 字幕 双向链接 (时段 + 文字, ${capCandidates.length} 个候选)`}
          >
            <ArrowLeftRight size={14} strokeWidth={2.2} />
            <span>链接字幕{capCandidates.length > 0 ? ` (${capCandidates.length})` : ''}</span>
          </button>
          <div className="am-align-quick-hint">{capCandidates.length === 0 ? '⚠️ 还没有字幕' : '一键时段+台词同步'}</div>
        </div>
      )}
      <Field label="台词">
        <textarea
          className="am-input am-textarea"
          value={clip.text || ''}
          onChange={(e) => {
            const newText = e.target.value;
            // text 变 → 清旧 audioSrc + genFailed, auto-gen useEffect 触发重新生成 (防 dump 显旧 audio bug)
            if (newText !== clip.text) {
              onUpdate({ text: newText, audioSrc: undefined, audioEngine: undefined, genFailed: false });
            }
          }}
          placeholder={v.lang.startsWith('zh') ? '要说什么…' : 'What to say…'}
        />
        <div className="am-tts-dur-row">
          <span className="am-tts-dur-info">
            预计读 <strong>{estimated.toFixed(1)}s</strong> · 当前 {actual.toFixed(1)}s
            {needsAlign && <span className="am-tts-dur-warn"> · 不匹配</span>}
          </span>
          {needsAlign && (
            <button
              type="button"
              className="am-tts-align-btn"
              onClick={() => onUpdate({ end: clip.start + estimated })}
              title="把片段长度调到预计朗读时间"
            >
              🎯 对齐
            </button>
          )}
        </div>
      </Field>
      <Field label="音色">
        <div className="am-chips">
          {VOICE_LIB.map(item => (
            <button
              key={item.id}
              className={'am-chip am-voice-chip' + (clip.voice === item.id ? ' is-active' : '')}
              onClick={() => onUpdate({ voice: item.id })}
              type="button"
              title={item.desc}
            >
              {item.icon ? <item.icon size={13} strokeWidth={2} /> : <span>{item.emoji}</span>}
              <span>{item.name}</span>
              <span className="am-voice-gender-mini">{item.gender === 'male' ? '♂' : '♀'}</span>
              <span className="am-voice-lang-mini">{item.lang === 'zh-CN' ? '中' : item.lang === 'en-US' ? 'US' : 'UK'}</span>
            </button>
          ))}
        </div>
      </Field>
      {/* v23-e: TTS 倍速 — clip 级, 0.5-3.0, 优先 voice 级 */}
      <Field label={`倍速 · ${(clip.playbackRate ?? 1.0).toFixed(2)}x`}>
        <div className="am-tts-rate-row">
          {[0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0].map(r => (
            <button
              key={r}
              type="button"
              className={'am-tts-rate-preset' + ((clip.playbackRate ?? 1.0) === r ? ' is-active' : '')}
              onClick={() => onUpdate({ playbackRate: r === 1.0 ? undefined : r })}
              title={`${r}x`}
            >
              {r}x
            </button>
          ))}
        </div>
        <input
          type="range" min="0.5" max="3.0" step="0.05"
          value={clip.playbackRate ?? 1.0}
          onChange={(e) => {
            const r = parseFloat(e.target.value);
            onUpdate({ playbackRate: r === 1.0 ? undefined : r });
          }}
          className="am-range"
        />
        <div className="am-field-sublabel">
          {(clip.playbackRate ?? 1.0) === 1.0 ? '正常语速 · 改变后试听 / 重生成 audio 才生效' :
            (clip.playbackRate ?? 1.0) > 1.0 ? `加速 ${((clip.playbackRate ?? 1.0) * 100).toFixed(0)}% · 实际朗读时长 = 原始 / ${(clip.playbackRate ?? 1.0).toFixed(2)}` :
            `减速 ${((clip.playbackRate ?? 1.0) * 100).toFixed(0)}%`}
        </div>
      </Field>
      <button
        className="am-test-btn"
        onClick={async () => {
          // v23-e: 试听走 clip 级 rate (听到所设倍速)
          const rate = clip.playbackRate ?? v.playbackRate ?? 1.0;
          // 所听即所得: clip.audioSrc 已生成 → 直接播 (跟 timeline 上一摸一样)
          if (clip.audioSrc) {
            audioEngine.playTTSAudio(clip.audioSrc, 1.0, rate);
            return;
          }
          // 没 audioSrc → fetchTTSForVoice (preferred engine + fallback), 跟 auto-gen 同链路
          const sample = clip.text?.trim() || (v.lang.startsWith('zh') ? '这是一段试听' : 'This is a preview');
          try {
            const { dataUrl } = await fetchTTSForVoice(sample, v);
            audioEngine.playTTSAudio(dataUrl, 1.0, rate);
          } catch {
            toast.error('云端试听失败, 退化浏览器 SS');
            audioEngine.speak(sample, v);
          }
        }}
        type="button"
      >
        <Play size={12} /> 试听
      </button>

      <Field label="MP4 真音轨配音">
        <input
          ref={uploadInputRef}
          type="file"
          accept="audio/mpeg,audio/mp3,audio/wav,audio/webm,audio/*"
          style={{ display: 'none' }}
          onChange={handleUpload}
        />
        {!clip.audioSrc && !recording && (
          <div className="am-tts-record-row">
            <button
              type="button"
              className="am-tb-btn am-tb-btn-primary am-tts-edge-btn"
              style={clip.genFailed ? { background: '#ef4444', color: '#fff', fontWeight: 700 } : undefined}
              onClick={async () => {
                if (!clip.text?.trim()) { toast.error('先填台词'); return; }
                const tid = toast.loading(clip.genFailed ? '🔄 重试生成 (youdao → baidu)…' : '云端生成中…');
                const lang: 'zh' | 'en' = v.lang.startsWith('zh') ? 'zh' : 'en';
                try {
                  let dataUrl: string;
                  let usedEngine: 'youdao' | 'baidu' = 'youdao';
                  try {
                    dataUrl = await fetchTTSBlob(clip.text, 'youdao', lang);
                  } catch (youdaoErr) {
                    // eslint-disable-next-line no-console
                    console.warn('[inspector] youdao 失败, 试 baidu:', (youdaoErr as Error).message);
                    dataUrl = await fetchTTSBlob(clip.text, 'baidu', lang);
                    usedEngine = 'baidu';
                  }
                  toast.dismiss(tid);
                  await applyAudioSrc(dataUrl, usedEngine === 'baidu' ? 'baidu fallback' : '有道');
                } catch (e) {
                  toast.dismiss(tid);
                  toast.error(`youdao + baidu 都失败: ${(e as Error).message}`);
                  onUpdate({ genFailed: true });
                }
              }}
              title="云端 TTS (youdao 失败自动试 baidu) · 自动按 audio 时长对齐时间轴"
            >
              {clip.genFailed ? '🔄 重试生成 (上次失败)' : '🌐 云端生成 (推荐)'}
            </button>
            {_userTTSProxyURL && (
              <button
                type="button"
                className="am-tb-btn"
                onClick={async () => {
                  if (!clip.text?.trim()) { toast.error('先填台词'); return; }
                  const tid = toast.loading(`代理 ${v.azureName}…`);
                  try {
                    const dataUrl = await fetchTTSFromProxy(clip.text, v.azureName, 0, 0);
                    toast.dismiss(tid);
                    await applyAudioSrc(dataUrl, `Neural ${v.name}`);
                  } catch (e) {
                    toast.dismiss(tid);
                    toast.error(`代理失败: ${(e as Error).message}`);
                  }
                }}
              >
                🎯 代理 Neural
              </button>
            )}
            <button type="button" className="am-tb-btn am-tts-rec-btn" onClick={() => uploadInputRef.current?.click()}>
              📂 上传 mp3
            </button>
            <button type="button" className="am-tb-btn am-tts-rec-btn" onClick={startRecord}>
              🎙 麦录
            </button>
            <a
              className="am-tb-btn"
              href={TTSMAKER_URL}
              target="_blank"
              rel="noopener noreferrer"
              title="网页另一选项"
            >
              🌐 TTSMaker ↗
            </a>
          </div>
        )}
        {recording && (
          <div className="am-tts-record-row">
            <button type="button" className="am-tb-btn am-tts-rec-btn is-rec" onClick={stopRecord}>
              ⏹ 停止录音
            </button>
          </div>
        )}
        {clip.audioSrc && !recording && (
          <div className="am-tts-record-row">
            <button type="button" className="am-tb-btn" onClick={() => audioEngine.playTTSAudio(clip.audioSrc!, 1.0, clip.playbackRate ?? v.playbackRate ?? 1.0)}>
              <Play size={12} /> 试听
            </button>
            <button type="button" className="am-tb-btn" onClick={() => uploadInputRef.current?.click()}>
              📂 重新上传
            </button>
            <button type="button" className="am-tb-btn am-tb-btn-danger" onClick={clearRecord}>
              <X size={12} /> 删
            </button>
          </div>
        )}
        <div className="am-field-sublabel">
          {clip.audioSrc
            ? '✅ 已设音轨 · 导出 MP4 真带声 (不烧字幕)'
            : '上方试听是浏览器 SS (女声化). 要抖音同款真男/女声 → 点 🌐 TTSMaker 复制台词生成 → 下载 mp3 → 📂 上传'}
        </div>
      </Field>
    </>
  );
}

function BGMProps({ clip, onUpdate }: { clip: BGMClip; onUpdate: (p: Record<string, unknown>) => void }) {
  return (
    <>
      <Field label="曲目">
        <div className="am-chips">
          {BGM_LIB.map(b => (
            <button
              key={b.id}
              className={'am-chip' + (clip.bgmId === b.id ? ' is-active' : '')}
              onClick={() => onUpdate({ bgmId: b.id, name: b.name })}
              type="button"
            >
              {b.name}
            </button>
          ))}
        </div>
      </Field>
      <Field label={`音量 · ${Math.round((clip.volume ?? 0.5) * 100)}`}>
        <input
          type="range" min="0" max="1" step="0.05"
          value={clip.volume ?? 0.5}
          onChange={(e) => onUpdate({ volume: parseFloat(e.target.value) })}
          className="am-range"
        />
      </Field>
      <button
        className="am-test-btn"
        onClick={() => {
          const b = resolveBGM(clip.bgmId);
          if (b) playBGM(b, clip.volume ?? 0.5, 8);
        }}
        type="button"
      >
        <Play size={12} /> 试听 8 秒
      </button>
    </>
  );
}

// ============================================================
// DRAFT POPOVER
// ============================================================
// v23-b: 重设计 — 卡片网格 + 缩略图 + inline 改名 + icon 化 + 复制功能
function DraftPopover({
  drafts, onClose, onSave, onLoad, onDelete, onRename, onNote, onDuplicate,
}: {
  drafts: AnimateDraftSlot[];
  onClose: () => void;
  onSave: (name: string) => void;
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onNote: (id: string, note: string) => void;
  onDuplicate: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null); // 当前 hover/选中

  const draftStats = (d: AnimateDraftSlot) => {
    const types = d.project.clips.reduce<Record<TrackType, number>>((acc, c) => {
      acc[c.trackId] = (acc[c.trackId] || 0) + 1;
      return acc;
    }, { image: 0, caption: 0, fx: 0, tts: 0, bgm: 0 });
    return types;
  };

  const handleSave = () => {
    onSave(name.trim() || `草稿${drafts.length + 1}`);
    setName('');
  };

  return (
    <>
      <div className="am-popover-backdrop" onClick={onClose} />
      <div className="am-popover am-draft-popover-v3 win7-panel">
        <div className="am-popover-head">
          <span className="am-popover-title"><FolderOpen size={15} strokeWidth={2.2} /> 沙雕动画草稿 ({drafts.length}/{AM_DRAFT_MAX})</span>
          <button className="am-popover-close" onClick={onClose}><X size={14} /></button>
        </div>
        <div className="am-popover-body am-draft-body-v3">
          {/* 保存条 */}
          <div className="am-draft-save-v3">
            <input
              type="text"
              className="am-input am-draft-save-input"
              placeholder={`命名当前作品 — 默认 "草稿${drafts.length + 1}"`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
              disabled={drafts.length >= AM_DRAFT_MAX}
            />
            <button
              className="am-draft-save-btn-v3"
              onClick={handleSave}
              disabled={drafts.length >= AM_DRAFT_MAX}
              title={drafts.length >= AM_DRAFT_MAX ? `最多 ${AM_DRAFT_MAX} 个 · 先删旧的` : '保存当前作品 (Ctrl+S)'}
            >
              <Save size={13} strokeWidth={2.2} />
              <span>{drafts.length >= AM_DRAFT_MAX ? '已满' : '保存当前'}</span>
            </button>
          </div>

          {/* 列表 */}
          {drafts.length === 0 ? (
            <div className="am-draft-empty-v3">
              <FolderOpen size={28} strokeWidth={1.5} />
              <div className="am-draft-empty-ttl">还没有草稿</div>
              <div className="am-draft-empty-hint-v3">命名 + 点 保存当前 → 这里就有了</div>
            </div>
          ) : (
            <div className="am-draft-grid-v3">
              {drafts.map(d => {
                const stats = draftStats(d);
                const isEditing = editingId === d.id;
                const isActive = activeId === d.id;
                return (
                  <div
                    key={d.id}
                    className={'am-draft-card-v3' + (isActive ? ' is-active' : '')}
                    onMouseEnter={() => setActiveId(d.id)}
                    onMouseLeave={() => setActiveId(prev => prev === d.id ? null : prev)}
                  >
                    {/* 缩略图区 — 点击 = 读入 */}
                    <button
                      type="button"
                      className="am-draft-thumb-btn"
                      onClick={() => onLoad(d.id)}
                      title="点击读入此草稿"
                    >
                      {d.thumbSrc ? (
                        <img src={d.thumbSrc} alt={d.name} className="am-draft-thumb-img" />
                      ) : (
                        <div className="am-draft-thumb-empty"><ImageIcon size={22} strokeWidth={1.5} /></div>
                      )}
                      <div className="am-draft-thumb-overlay">
                        <Play size={20} strokeWidth={2.2} />
                        <span>读入</span>
                      </div>
                      <span className="am-draft-thumb-dur">{d.project.duration.toFixed(1)}s</span>
                    </button>
                    {/* meta */}
                    <div className="am-draft-meta-v3">
                      {isEditing ? (
                        <input
                          autoFocus
                          type="text"
                          className="am-input am-draft-rename-v3"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { onRename(d.id, editValue.trim() || d.name); setEditingId(null); }
                            if (e.key === 'Escape') setEditingId(null);
                          }}
                          onBlur={() => { onRename(d.id, editValue.trim() || d.name); setEditingId(null); }}
                        />
                      ) : (
                        <div className="am-draft-name-row">
                          <span className="am-draft-name-v3" title={d.name}>{d.name}</span>
                          <button
                            className="am-draft-icon-btn"
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setEditValue(d.name); setEditingId(d.id); }}
                            title="改名"
                          >
                            <Pencil size={11} strokeWidth={2.2} />
                          </button>
                        </div>
                      )}
                      <div className="am-draft-stats-v3">
                        <span title={`画面 ${stats.image}`}><ImageIcon size={10} strokeWidth={2} />{stats.image}</span>
                        <span title={`字幕 ${stats.caption}`}><TypeIcon size={10} strokeWidth={2} />{stats.caption}</span>
                        {stats.fx > 0 && <span title={`特效 ${stats.fx}`}><Sparkles size={10} strokeWidth={2} />{stats.fx}</span>}
                        {stats.tts > 0 && <span title={`配音 ${stats.tts}`}><Mic size={10} strokeWidth={2} />{stats.tts}</span>}
                        {stats.bgm > 0 && <span title={`音乐 ${stats.bgm}`}><Music size={10} strokeWidth={2} />{stats.bgm}</span>}
                      </div>
                      <div className="am-draft-time-v3">
                        {new Date(d.updatedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </div>
                      <textarea
                        className="am-input am-draft-note-v3"
                        value={d.note || ''}
                        onChange={(e) => onNote(d.id, e.target.value)}
                        placeholder="备注…"
                        rows={1}
                      />
                      <div className="am-draft-actions-v3">
                        <button
                          className="am-draft-icon-btn"
                          type="button"
                          onClick={() => onDuplicate(d.id)}
                          disabled={drafts.length >= AM_DRAFT_MAX}
                          title="复制一份"
                        >
                          <CopyIcon size={12} strokeWidth={2} />
                        </button>
                        <button
                          className="am-draft-icon-btn am-draft-icon-btn-danger"
                          type="button"
                          onClick={async () => {
                            const res = await showDialog({
                              title: '删除草稿',
                              message: `删除 "${d.name}"?`,
                              destructive: true,
                              confirmText: '删除',
                            });
                            if (res.confirmed) onDelete(d.id);
                          }}
                          title="删除"
                        >
                          <Trash2 size={12} strokeWidth={2} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ============================================================
// PREVIEW MODAL — 全屏播放
// ============================================================
function PreviewModal({ project, userBGMs, onClose }: { project: ProjectState; userBGMs: BGMPreset[]; onClose: () => void }) {
  const [playhead, setPlayhead] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const userBGMsRef = useRef(userBGMs);
  useEffect(() => { userBGMsRef.current = userBGMs; }, [userBGMs]);
  const rafRef = useRef<number | null>(null);
  const lastTimeRef = useRef(0);
  const spokenRef = useRef<Set<string>>(new Set());
  const bgmStartedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!isPlaying) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      audioEngine.cancelAll();
      spokenRef.current.clear();
      bgmStartedRef.current.clear();
      return;
    }
    lastTimeRef.current = performance.now();
    function tick(now: number) {
      const dt = (now - lastTimeRef.current) / 1000;
      lastTimeRef.current = now;
      setPlayhead(p => {
        const np = p + dt;
        if (np >= project.duration) {
          setIsPlaying(false);
          return project.duration;
        }
        return np;
      });
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [isPlaying, project.duration]);

  // PreviewModal transport — 跟主 transport 一致 (v23-k: 同步修双响 bug):
  //   有 audioSrc → syncTTSPlayer 严格绑 playhead (出现时强 cancel pending SS)
  //   没 audioSrc 且 genFailed → SS 触发式 fallback
  //   没 audioSrc 也没 fail → auto-gen pending, 静默
  useEffect(() => {
    for (const c of project.clips) {
      if (c.trackId === 'tts') {
        const ts = c as TTSClip;
        if (ts.audioSrc) {
          if (spokenRef.current.has(ts.id)) {
            try { audioEngine.cancel(); } catch {}
            spokenRef.current.delete(ts.id);
          }
          const rate = VOICE_BY_ID[resolveVoiceId(ts.voice)]?.playbackRate ?? 1.0;
          audioEngine.syncTTSPlayer(ts.id, ts.audioSrc, playhead, ts.start, isPlaying, 1.0, rate);
        } else if (ts.genFailed && isPlaying && playhead >= ts.start && playhead < ts.end && !spokenRef.current.has(ts.id)) {
          spokenRef.current.add(ts.id);
          const v = VOICE_BY_ID[resolveVoiceId(ts.voice)];
          audioEngine.speak(ts.text, v);
        }
      }
      if (c.trackId === 'bgm') {
        const b = resolveBGM(c.bgmId, userBGMsRef.current);
        if (b?.kind === 'file' && b.src) {
          audioEngine.syncUserBGMPlayer(c.id, b.src, playhead, c.start, isPlaying, c.volume ?? 0.5);
        } else if (isPlaying && playhead >= c.start && playhead < c.end && !bgmStartedRef.current.has(c.id)) {
          bgmStartedRef.current.add(c.id);
          if (b) playBGM(b, c.volume ?? 0.5, c.end - playhead);
        }
      }
      if (c.trackId === 'bgm' && playhead >= c.end && bgmStartedRef.current.has(c.id)) {
        bgmStartedRef.current.delete(c.id);
        audioEngine.stopBGM();
      }
    }
  }, [playhead, isPlaying, project.clips]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.code === 'Space') { e.preventDefault(); setIsPlaying(p => !p); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // cleanup on unmount
  useEffect(() => () => audioEngine.cancelAll(), []);

  const stageRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState({ w: 1280, h: 720 });
  useEffect(() => {
    function resize() {
      if (!stageRef.current) return;
      const r = stageRef.current.getBoundingClientRect();
      const availW = r.width - 32;
      const availH = r.height - 32;
      const ratio = 16 / 9;
      let w = availW, h = w / ratio;
      if (h > availH) { h = availH; w = h * ratio; }
      setCanvasSize({ w: Math.round(w), h: Math.round(h) });
    }
    resize();
    const ro = new ResizeObserver(resize);
    if (stageRef.current) ro.observe(stageRef.current);
    return () => ro.disconnect();
  }, []);

  const activeImageClips = useMemo(() => {
    const arr = project.clips.filter(c => c.trackId === 'image' && playhead >= c.start && playhead < c.end) as ImageClip[];
    return arr.sort((a, b) => b.lane - a.lane);
  }, [project.clips, playhead]);
  // FIX #9: PreviewModal 之前没渲染 caption track, 现在补
  const activeCaptionClips = useMemo(() => {
    return (project.clips.filter(c => c.trackId === 'caption' && playhead >= c.start && playhead < c.end) as CaptionClip[])
      .sort((a, b) => a.lane - b.lane);
  }, [project.clips, playhead]);
  const topClip = activeImageClips[activeImageClips.length - 1] ?? null;
  const captionSize = Math.max(24, Math.round(canvasSize.w * 0.04));

  return (
    <div className="am-preview-modal-backdrop" onClick={onClose}>
      <div className="am-preview-modal" onClick={(e) => e.stopPropagation()}>
        <div className="am-popover-head">
          <span>🎬 全屏预览 · {project.duration.toFixed(1)}s · {project.clips.length} 片段</span>
          <button className="am-popover-close" onClick={onClose}><X size={14} /></button>
        </div>
        <div className="am-preview-modal-stage" ref={stageRef}>
          <div className="am-preview-canvas" style={{ width: canvasSize.w, height: canvasSize.h }}>
            {activeImageClips.length === 0 && (
              <div className="am-preview-empty">
                <div className="am-preview-emoji">🐼</div>
                <div className="am-preview-empty-text">空预览</div>
              </div>
            )}
            {activeImageClips.map((c) => {
              // 跟 PreviewPane 一致 — 不再用 baseScale "副图自动缩" (该机制造成"逐渐缩小" bug). 永远 1.
              const baseScale = 1;
              const tr = getTransform(c);
              const fxInfo = effectiveFxFor(c, playhead, project.clips);
              const fxA = computeFx(fxInfo.fx, fxInfo.fxStart, fxInfo.fxDur, playhead, canvasSize.w, fxInfo.fxClip);
              const sx = baseScale * tr.scale * fxA.scaleMul * (tr.flipX ? -1 : 1);
              const sy = baseScale * tr.scale * fxA.scaleMul;
              const totalRot = tr.rotation + fxA.rotateAdd;
              return (
                <div
                  key={c.id}
                  className="am-stage-img"
                  style={{
                    left: `${50 + tr.x}%`,
                    top: `${50 + tr.y}%`,
                    transform: `translate(calc(-50% + ${fxA.offsetX}px), calc(-50% + ${fxA.offsetY}px)) scale(${sx}, ${sy}) rotate(${totalRot}deg)`,
                    opacity: fxA.alpha,
                    filter: fxA.filter || undefined,
                    zIndex: 10 - c.lane,
                  }}
                >
                  <img
                    src={c.src}
                    alt={c.label}
                    draggable={false}
                    style={{
                      width: Math.min(canvasSize.w, canvasSize.h) * 0.6,
                      height: 'auto',
                      maxHeight: canvasSize.h * 0.85,
                      display: 'block',
                    }}
                  />
                </div>
              );
            })}
            {/* 旧兼容: image.caption legacy field */}
            {activeCaptionClips.length === 0 && topClip && topClip.caption && (
              <div className="am-caption" style={{ fontSize: captionSize }}>{topClip.caption}</div>
            )}
            {/* FIX #9: PreviewModal 字幕轨完整渲染 (跟 PreviewPane 一致) + v23-k 入场动效 */}
            {activeCaptionClips.map(c => {
              const tr = c.transform ?? DEFAULT_CAPTION_TRANSFORM;
              const style: CaptionStyle = c.style ?? DEFAULT_CAPTION_STYLE;
              const cFontSize = c.fontSize ?? captionSize;
              const cColor = c.color ?? (style === 'panel' ? '#000' : '#fff');
              const ent = computeCaptionEntrance(c, playhead);
              const xformStyle = (ent.opacity < 1 || Math.abs(ent.scale - 1) > 0.01)
                ? { opacity: ent.opacity, transform: `translate(-50%, -50%) scale(${ent.scale})` }
                : {};
              return (
                <div
                  key={c.id}
                  className={`am-caption-stage am-caption-style-${style}`}
                  style={{
                    left: `${50 + tr.x}%`,
                    top: `${50 + tr.y}%`,
                    fontSize: cFontSize,
                    color: cColor,
                    ...xformStyle,
                  }}
                >
                  {ent.visibleText || (c.text ? '' : '空字幕')}
                </div>
              );
            })}
          </div>
        </div>
        <div className="am-preview-modal-transport">
          <button className="am-step-btn" onClick={() => { setIsPlaying(false); setPlayhead(0); spokenRef.current.clear(); }} title="重头"><SkipBack size={16} /></button>
          <button className="am-play-btn" onClick={() => setIsPlaying(p => !p)} title="播放/暂停 (Space)">
            {isPlaying ? <Pause size={20} /> : <Play size={20} />}
          </button>
          <div className="am-transport-time am-transport-time-big">
            <span>{formatTC(playhead)}</span>
            <span className="am-transport-total">/ {formatTC(project.duration)}</span>
          </div>
          <div className="am-toolbar-spacer" />
          <div className="am-transport-kbd">Esc 关闭 · Space 播放</div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// EXPORT MODAL — 真渲染 + 下载
// ============================================================
function ExportModal({ project, userBGMs, name, onClose }: { project: ProjectState; userBGMs: BGMPreset[]; name: string; onClose: () => void }) {
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outputInfo, setOutputInfo] = useState<{ ext: string; size: number; hasAudio?: boolean; mime?: string; resolution?: ExportResolution; fps?: ExportFps; width?: number; height?: number; frameCount?: number; durationSec?: number } | null>(null);
  // v23-l: MP4 默认主推 (99% 用户只懂 MP4). WebM 折叠到 advanced
  const [format, setFormat] = useState<'webm' | 'mp4'>('mp4');
  const [showAdvanced, setShowAdvanced] = useState(false);
  // v23-k Phase A: 工业级 — 分辨率 + 帧率 自选
  const [resolution, setResolution] = useState<ExportResolution>('720p');
  const [fps, setFps] = useState<ExportFps>(30);
  // v23-l: GIF preset (仅 mode=gif 用)
  const isGif = (project.mode ?? 'video') === 'gif';
  const [gifPresetId, setGifPresetId] = useState<GifPresetId>(project.gifPresetId ?? 'wechat');
  const gifPreset = GIF_PRESETS.find(p => p.id === gifPresetId) ?? GIF_PRESETS[0];

  const supportedMime = useMemo(() => pickBestMime(format === 'mp4'), [format]);
  const [phase, setPhase] = useState<'ready' | 'rendering' | 'done'>('ready');
  const [mp4AudioOK, setMp4AudioOK] = useState<null | boolean>(null);
  const cancelledRef = useRef(false);
  const hasBGM = project.clips.some(c => c.trackId === 'bgm');
  const ttsClips = project.clips.filter(c => c.trackId === 'tts') as TTSClip[];
  const hasTTS = ttsClips.length > 0;
  const hasRecordedTTS = ttsClips.some(c => !!c.audioSrc);
  const ttsAllRecorded = hasTTS && ttsClips.every(c => !!c.audioSrc);

  // GIF 估算大小: 帧数 × 平均帧大小 ~ 帧数 × (w*h*0.4 bytes / 1024). 480x480 100 frames ~ 460KB 经验值
  const gifEstSize = useMemo(() => {
    if (!isGif) return 0;
    const dur = Math.min(project.duration, GIF_MAX_DURATION);
    const frames = dur * gifPreset.fps;
    const perFrameKB = (gifPreset.width * gifPreset.height) / 5800; // 经验 quality=10
    return Math.round(frames * perFrameKB);
  }, [isGif, gifPreset, project.duration]);

  // mount: 探测 mp4+audio 真支持否 (isTypeSupported 撒谎, 必须真测)
  useEffect(() => {
    if (isGif) return; // GIF 模式无需探测 mp4
    void probeMp4AudioMuxing().then(ok => setMp4AudioOK(ok));
  }, [isGif]);

  const startExport = useCallback(() => {
    setPhase('rendering');
    cancelledRef.current = false;
    (async () => {
      try {
        if (isGif) {
          const result = await exportGIF(project, name, (p) => { if (!cancelledRef.current) setProgress(p); }, gifPresetId);
          if (!cancelledRef.current) {
            setOutputInfo(result);
            setDone(true);
            setPhase('done');
          }
        } else {
          const result = await exportVideo(project, name, (p) => { if (!cancelledRef.current) setProgress(p); }, userBGMs, format === 'mp4', resolution, fps);
          if (!cancelledRef.current) {
            setOutputInfo(result);
            setDone(true);
            setPhase('done');
          }
        }
      } catch (e) {
        if (!cancelledRef.current) {
          setError((e as Error).message || '导出失败');
          setPhase('done');
        }
      }
    })();
  }, [project, name, format, userBGMs, resolution, fps, isGif, gifPresetId]);

  useEffect(() => {
    return () => { cancelledRef.current = true; audioEngine.cancelAll(); audioEngine.stopExportCapture(); };
  }, []);

  return (
    <div className="am-export-modal-backdrop" onClick={(done || error) ? onClose : undefined}>
      <div className="am-export-modal win7-panel" onClick={(e) => e.stopPropagation()}>
        <div className="am-popover-head">
          <span><Download size={14} /> {isGif ? '导出 GIF' : `导出视频 (${supportedMime.ext.toUpperCase()})`}</span>
          {(done || error || phase === 'ready') && <button className="am-popover-close" onClick={onClose}><X size={14} /></button>}
        </div>
        <div className="am-export-body">
          {phase === 'ready' && isGif && (
            <>
              <div className="am-export-status">
                <strong>导出 GIF 动图</strong>
                <span className="am-export-sub">{gifPreset.width}×{gifPreset.height} · {gifPreset.fps}fps · 时长 {Math.min(project.duration, GIF_MAX_DURATION, gifPreset.maxDuration).toFixed(1)}s · 预估 ~{gifEstSize}KB</span>
              </div>
              <div className="am-export-format-row">
                <div className="am-field-sublabel" style={{ marginBottom: 4 }}>社媒预设 (尺寸 + 帧率)</div>
                <div className="am-row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  {GIF_PRESETS.map(p => (
                    <button
                      key={p.id}
                      type="button"
                      className={'am-tb-btn' + (gifPresetId === p.id ? ' am-tb-btn-primary' : '')}
                      onClick={() => setGifPresetId(p.id)}
                      style={{ flex: '1 1 calc(50% - 3px)', justifyContent: 'center' }}
                      title={p.note}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <div className="am-field-sublabel" style={{ marginTop: 6, color: '#666' }}>{gifPreset.note}</div>
              </div>
              <div className="am-export-hint">
                <AlertCircle size={11} />
                <span>GIF 无声音 · 跨设备兼容性最强 (微信/X/TG 直发) · 体积越小延迟越低</span>
              </div>
              <button className="am-tb-btn am-tb-btn-primary" onClick={startExport} style={{ width: '100%', justifyContent: 'center', padding: '8px 12px' }}>
                <Download size={13} /> 开始导出 GIF
              </button>
            </>
          )}
          {phase === 'ready' && !isGif && (
            <>
              <div className="am-export-status">
                <strong>{`导出 ${(supportedMime.ext || 'mp4').toUpperCase()} 视频`}</strong>
                <span className="am-export-sub">{RESOLUTION_DIM[resolution].w}×{RESOLUTION_DIM[resolution].h} · {fps}fps · 时长 {project.duration.toFixed(1)}s · 估算码率 {(RESOLUTION_VBPS[resolution] / 1_000_000).toFixed(1)} Mbps</span>
              </div>
              {/* v23-k Phase A: 分辨率 + 帧率 自选 */}
              <div className="am-export-format-row">
                <div className="am-field-sublabel" style={{ marginBottom: 4 }}>分辨率</div>
                <div className="am-row" style={{ gap: 6 }}>
                  {(['480p', '720p', '1080p'] as ExportResolution[]).map(r => (
                    <button
                      key={r}
                      type="button"
                      className={'am-tb-btn' + (resolution === r ? ' am-tb-btn-primary' : '')}
                      onClick={() => setResolution(r)}
                      style={{ flex: 1, justifyContent: 'center' }}
                      title={`${RESOLUTION_DIM[r].w}×${RESOLUTION_DIM[r].h} · ${(RESOLUTION_VBPS[r] / 1_000_000).toFixed(1)} Mbps`}
                    >
                      {r === '480p' ? '480p 标清' : r === '720p' ? '720p 高清' : '1080p 蓝光'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="am-export-format-row">
                <div className="am-field-sublabel" style={{ marginBottom: 4 }}>帧率</div>
                <div className="am-row" style={{ gap: 6 }}>
                  {([24, 30, 60] as ExportFps[]).map(f => (
                    <button
                      key={f}
                      type="button"
                      className={'am-tb-btn' + (fps === f ? ' am-tb-btn-primary' : '')}
                      onClick={() => setFps(f)}
                      style={{ flex: 1, justifyContent: 'center' }}
                      title={f === 24 ? '电影感' : f === 30 ? '标准 (推荐)' : '丝滑 (慢动作友好)'}
                    >
                      {f}fps {f === 24 ? '🎞️' : f === 30 ? '⭐' : '✨'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="am-export-track-grid">
                <div className="am-export-track">
                  <span className="am-export-track-ic">🎬</span>
                  <span className="am-export-track-lbl">画面</span>
                  <span className="am-export-track-ok">真录制</span>
                </div>
                <div className="am-export-track">
                  <span className="am-export-track-ic">💬</span>
                  <span className="am-export-track-lbl">字幕</span>
                  <span className="am-export-track-ok">真录制</span>
                </div>
                <div className={'am-export-track' + (hasBGM ? '' : ' is-empty')}>
                  <span className="am-export-track-ic">🎵</span>
                  <span className="am-export-track-lbl">BGM</span>
                  <span className={hasBGM ? 'am-export-track-ok' : 'am-export-track-skip'}>{hasBGM ? '真录入音轨' : '无 BGM'}</span>
                </div>
                <div className={'am-export-track' + (hasTTS ? '' : ' is-empty')}>
                  <span className="am-export-track-ic">🎤</span>
                  <span className="am-export-track-lbl">配音</span>
                  <span className={!hasTTS ? 'am-export-track-skip' : ttsAllRecorded ? 'am-export-track-ok' : hasRecordedTTS ? 'am-export-track-warn' : 'am-export-track-warn'}>
                    {!hasTTS ? '无配音' : ttsAllRecorded ? '真录入音轨' : hasRecordedTTS ? '部分录音 / 部分字幕' : '需录音才能进音轨'}
                  </span>
                </div>
              </div>
              {/* v23-l: MP4 主推 + WebM 折叠 advanced (pro 用户才会切) */}
              <button
                type="button"
                className="am-tb-btn"
                onClick={() => setShowAdvanced(s => !s)}
                style={{ width: '100%', justifyContent: 'center', fontSize: 11, color: '#666' }}
              >
                {showAdvanced ? '⊟ 收起高级选项' : '⊞ 高级 (其他格式)'}
              </button>
              {showAdvanced && (
                <div className="am-export-format-row">
                  <div className="am-field-sublabel" style={{ marginBottom: 4 }}>视频格式</div>
                  <div className="am-row" style={{ gap: 6 }}>
                    <button
                      type="button"
                      className={'am-tb-btn' + (format === 'mp4' ? ' am-tb-btn-primary' : '')}
                      onClick={() => setFormat('mp4')}
                      style={{ flex: 1, justifyContent: 'center' }}
                    >
                      MP4 <span style={{ opacity: 0.7, fontSize: 10 }}>{mp4AudioOK === null ? '探测中…' : mp4AudioOK ? '默认 · 兼容性高' : '⚠️ 此浏览器音轨可能丢'}</span>
                    </button>
                    <button
                      type="button"
                      className={'am-tb-btn' + (format === 'webm' ? ' am-tb-btn-primary' : '')}
                      onClick={() => setFormat('webm')}
                      style={{ flex: 1, justifyContent: 'center' }}
                    >
                      WebM <span style={{ opacity: 0.7, fontSize: 10 }}>pro · 真音轨更稳</span>
                    </button>
                  </div>
                </div>
              )}
              {format === 'mp4' && mp4AudioOK === false && (
                <div className="am-export-hint" style={{ background: '#fff4d8', borderColor: '#c89028' }}>
                  <AlertCircle size={11} />
                  <span><b>⚠️ 实测警告</b>: 此浏览器 MP4 容器 audio mux 失败 → 导出可能无声. 切到 WebM (高级里) 含真音轨, 任何播放器/剪映都能开.</span>
                </div>
              )}
              {hasTTS && (
                <div className="am-export-hint">
                  <AlertCircle size={11} />
                  <span>
                    SS 不能录入 MediaStream. <b>想配音进音轨?</b> 选 TTS clip → Inspector: <b>🌐 TTSMaker</b> 生成真神经配音 mp3, 然后 <b>📂 上传</b> · 或 <b>🎙 麦录</b>. 没 audioSrc 的会烧字幕条.
                  </span>
                </div>
              )}
              <button className="am-tb-btn am-tb-btn-primary" onClick={startExport} style={{ width: '100%', justifyContent: 'center', padding: '8px 12px' }}>
                <Download size={13} /> 开始导出 ({supportedMime.ext.toUpperCase()})
              </button>
            </>
          )}
          {phase === 'rendering' && !done && !error && (
            <>
              <div className="am-export-status">
                <strong>{Math.round(progress * 100)}%</strong>
                <span className="am-export-sub">· 实时渲染 · {((1 - progress) * project.duration).toFixed(1)}s 剩余</span>
              </div>
              <div className="am-export-progress">
                <div className="am-export-progress-fill" style={{ width: `${progress * 100}%` }} />
              </div>
              <div className="am-export-hint">
                <AlertCircle size={11} />
                <span>渲染期间 tab 可以最小化, 但不要关闭. {isGif ? 'GIF encoder 走 worker 不阻塞 UI.' : '音轨走 Web Audio MediaStream 全自动.'}</span>
              </div>
              <div className="am-export-meta">
                {isGif
                  ? `${gifPreset.width}×${gifPreset.height} · ${gifPreset.fps}fps · GIF (gif.js worker)`
                  : `${RESOLUTION_DIM[resolution].w}×${RESOLUTION_DIM[resolution].h} · ${fps}fps · ${supportedMime.mime}`
                }
              </div>
            </>
          )}
          {error && (
            <>
              <div className="am-export-error">❌ {error}</div>
              <button className="am-tb-btn am-tb-btn-primary" onClick={onClose}>关闭</button>
            </>
          )}
          {done && !error && (
            <>
              <div className="am-export-done">
                ✅ 导出完成 · {outputInfo?.ext.toUpperCase()} · {outputInfo
                  ? (outputInfo.size >= 1024 * 1024
                    ? `${(outputInfo.size / 1024 / 1024).toFixed(2)} MB`
                    : `${(outputInfo.size / 1024).toFixed(0)} KB`)
                  : '0 KB'}
                {!isGif && (outputInfo?.hasAudio ? ' · 🔊 含音轨' : ' · 🔇 无音轨')}
                {isGif && ` · ${outputInfo?.frameCount ?? 0} 帧`}
              </div>
              <div className="am-export-hint">
                <AlertCircle size={11} />
                <span>
                  文件已下载.{' '}
                  {isGif
                    ? '直接发微信/X/TG. 无声音 — 这是 GIF 格式特性.'
                    : <>{outputInfo?.hasAudio ? 'BGM 已写入. ' : ''}{hasTTS ? 'TTS 文字已烧录成字幕条. ' : ''}如需多音轨完整版, 推荐剪映/CapCut 二次处理.</>}
                </span>
              </div>
              <button className="am-tb-btn am-tb-btn-primary" onClick={onClose}>完成</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// TIMELINE
// ============================================================
function Timeline({
  project, playhead, selectedId,
  onSelect, onSeek, onUpdateClipLive, onBeginDrag, onEndDrag,
  onAddClip, onAddLane, onRemoveLane, onSetDuration, onClipContextMenu,
}: {
  project: ProjectState;
  playhead: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onSeek: (t: number) => void;
  onUpdateClipLive: (id: string, patch: Record<string, unknown>) => void;
  onBeginDrag: () => void;
  onEndDrag: () => void;
  onAddClip: (c: Clip) => void;
  onAddLane: (type: TrackType) => void;
  onRemoveLane: (type: TrackType, lane: number) => void;
  onSetDuration: (d: number) => void;
  onClipContextMenu?: (e: React.MouseEvent, clip: Clip) => void;
}) {
  void onSetDuration;
  const [zoom, setZoom] = useState(1.0);
  const pxPerSec = Math.round(80 * zoom);
  // 监听全局快捷键 +/- 缩放时间轴
  useEffect(() => {
    const onZoomIn = () => setZoom(z => Math.min(2.0, +(z + 0.1).toFixed(2)));
    const onZoomOut = () => setZoom(z => Math.max(0.4, +(z - 0.1).toFixed(2)));
    window.addEventListener('am-zoom-in', onZoomIn);
    window.addEventListener('am-zoom-out', onZoomOut);
    return () => {
      window.removeEventListener('am-zoom-in', onZoomIn);
      window.removeEventListener('am-zoom-out', onZoomOut);
    };
  }, []);
  const wrapRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ kind: 'move' | 'resize-l' | 'resize-r'; clipId: string; startX: number; startY: number; startStart: number; startEnd: number; startLane: number; type: TrackType; lastStart?: number; lastEnd?: number } | null>(null);
  const [dropInfo, setDropInfo] = useState<{ type: TrackType; lane: number } | null>(null);
  const [resizeTip, setResizeTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const [snapLine, setSnapLine] = useState<number | null>(null);

  // v24: GIF 模式隐藏 TTS/BGM 轨道 (GIF 无声音)
  const isGifMode = project.mode === 'gif';
  const totalWidth = project.duration * pxPerSec;
  // 防御 NaN: 旧 IDB project 缺 fx lane 字段时, undefined 累加 = NaN
  const totalLanes = TRACK_ORDER.reduce((sum, type) => {
    if (isGifMode && (type === 'tts' || type === 'bgm')) return sum;
    return sum + (project.lanes[type] ?? 0);
  }, 0);
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (labelsRef.current) labelsRef.current.scrollTop = e.currentTarget.scrollTop;
  };
  const startScrub = (e: React.PointerEvent) => {
    e.preventDefault();
    const wrap = wrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const update = (clientX: number) => {
      const sl = wrap.scrollLeft;
      const x = clientX - rect.left + sl;
      const t = Math.max(0, Math.min(project.duration, x / pxPerSec));
      onSeek(t);
    };
    update(e.clientX);
    const onMove = (ev: PointerEvent) => update(ev.clientX);
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };
  const startPlayheadDrag = (e: React.PointerEvent) => { e.preventDefault(); e.stopPropagation(); startScrub(e); };
  // 拖 ruler 右端调 project.duration — video 上限 60s, gif 上限 GIF_MAX_DURATION (15s), 下限 max(clip.end, 1s)
  const startDurationDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch {}
    const startX = e.clientX;
    const startDur = project.duration;
    const minDur = Math.max(1, ...project.clips.map(c => c.end));
    const maxDur = isGifMode ? GIF_MAX_DURATION : 60;
    const onMove = (ev: PointerEvent) => {
      const delta = (ev.clientX - startX) / pxPerSec;
      const next = Math.max(minDur, Math.min(maxDur, startDur + delta));
      // round to 0.5s
      onSetDuration(Math.round(next * 2) / 2);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };
  const startClipDrag = useCallback((e: React.PointerEvent, clip: Clip, kind: 'move' | 'resize-l' | 'resize-r') => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch {}
    onSelect(clip.id);
    onBeginDrag();
    dragRef.current = { kind, clipId: clip.id, startX: e.clientX, startY: e.clientY, startStart: clip.start, startEnd: clip.end, startLane: clip.lane, type: clip.trackId };
    const onMove = (ev: PointerEvent) => {
      const d = dragRef.current; if (!d) return;
      const dx = (ev.clientX - d.startX) / pxPerSec;
      const dy = ev.clientY - d.startY;
      const dur0 = d.startEnd - d.startStart;
      let s = d.startStart, en = d.startEnd, lane = d.startLane;
      if (d.kind === 'move') {
        s = clamp(d.startStart + dx, 0, project.duration - dur0);
        const snapped = findSnapTime(s, project.clips, project.duration, playhead, d.clipId, pxPerSec);
        if (Math.abs(snapped - s) < SNAP_PX / pxPerSec) { s = clamp(snapped, 0, project.duration - dur0); setSnapLine(s); }
        else {
          const snappedEnd = findSnapTime(s + dur0, project.clips, project.duration, playhead, d.clipId, pxPerSec);
          if (Math.abs(snappedEnd - (s + dur0)) < SNAP_PX / pxPerSec) { s = clamp(snappedEnd - dur0, 0, project.duration - dur0); setSnapLine(snappedEnd); }
          else setSnapLine(null);
        }
        en = s + dur0;
        const maxLane = project.lanes[d.type] - 1;
        lane = clamp(d.startLane + Math.round(dy / LANE_ROW_H), 0, maxLane);
      } else if (d.kind === 'resize-l') {
        s = clamp(d.startStart + dx, 0, d.startEnd - 0.2);
        const snapped = findSnapTime(s, project.clips, project.duration, playhead, d.clipId, pxPerSec);
        if (Math.abs(snapped - s) < SNAP_PX / pxPerSec) { s = clamp(snapped, 0, d.startEnd - 0.2); setSnapLine(s); }
        else setSnapLine(null);
        en = d.startEnd;
        setResizeTip({ x: ev.clientX, y: ev.clientY, text: `${(en - s).toFixed(2)}s` });
      } else {
        en = clamp(d.startEnd + dx, d.startStart + 0.2, project.duration);
        const snapped = findSnapTime(en, project.clips, project.duration, playhead, d.clipId, pxPerSec);
        if (Math.abs(snapped - en) < SNAP_PX / pxPerSec) { en = clamp(snapped, d.startStart + 0.2, project.duration); setSnapLine(en); }
        else setSnapLine(null);
        s = d.startStart;
        setResizeTip({ x: ev.clientX, y: ev.clientY, text: `${(en - s).toFixed(2)}s` });
      }
      d.lastStart = s;
      d.lastEnd = en;
      onUpdateClipLive(d.clipId, { start: s, end: en, lane });
    };
    const onUp = () => {
      const d = dragRef.current;
      // v23-k: TTS resize 完成后, 自动算 playbackRate fit audio
      // (用户拉长 clip → rate 变慢, 缩短 → 变快, audio 不会断/留空)
      if (d && (d.kind === 'resize-l' || d.kind === 'resize-r') && clip.trackId === 'tts') {
        const ts = clip as TTSClip;
        if (ts.audioDuration && ts.audioDuration > 0 && d.lastEnd !== undefined && d.lastStart !== undefined) {
          const finalDur = d.lastEnd - d.lastStart;
          if (finalDur > 0.1) {
            const newRate = Math.max(0.5, Math.min(3.0, ts.audioDuration / finalDur));
            const curRate = ts.playbackRate ?? 1.0;
            if (Math.abs(newRate - curRate) > 0.02) {
              onUpdateClipLive(d.clipId, { playbackRate: Math.abs(newRate - 1.0) < 0.02 ? undefined : Number(newRate.toFixed(2)) });
              toast(`📐 已自动调倍速 ${newRate.toFixed(2)}x 让配音 fit ${finalDur.toFixed(2)}s`, { duration: 2500 });
            }
          }
        }
      }
      dragRef.current = null;
      setSnapLine(null);
      setResizeTip(null);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      onEndDrag();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [pxPerSec, playhead, project, onSelect, onBeginDrag, onEndDrag, onUpdateClipLive]);

  const handleDrop = (e: React.DragEvent, type: TrackType, lane: number) => {
    e.preventDefault();
    setDropInfo(null);
    const raw = e.dataTransfer.getData('application/x-meme');
    if (!raw) return;
    let payload: DragPayload;
    try { payload = JSON.parse(raw) as DragPayload; } catch { return; }
    if (payload.type !== type) return;
    // v23-l: GIF 模式无声 → TTS/BGM 拖入 timeline 阻挡 (LeftPane 已隐藏 tab, 这里防其他入口) (audit-recent MED-2d-2)
    if ((project.mode ?? 'video') === 'gif' && (payload.type === 'tts' || payload.type === 'bgm')) {
      toast.warning('GIF 模式无声音, 不能加 ' + (payload.type === 'tts' ? '配音' : '背景音乐'));
      return;
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const rawTime = Math.max(0, x / pxPerSec);
    const dur = payload.defaultDuration || 2.5;
    const snapped = findSnapTime(rawTime, project.clips, project.duration, playhead, null, pxPerSec);
    let start = clamp(snapped, 0, project.duration - dur);
    let droppedLane = lane;
    // 字幕特殊: 优先保持 cursor 位置, 跨 lane 找无冲突 (符合"拖动看当下时间" 直觉)
    // 找不到才 fallback 后移
    if (type === 'caption') {
      const captionLanes = project.lanes.caption;
      let foundFreeLane = -1;
      for (let ln = lane; ln < captionLanes; ln++) {
        const overlap = project.clips.some(c => c.trackId === 'caption' && c.lane === ln && c.start < start + dur && c.end > start);
        if (!overlap) { foundFreeLane = ln; break; }
      }
      // 也试 lane 之前的 (用户拖到 lane 1 但 lane 0 空, 可以放 lane 0)
      if (foundFreeLane === -1) {
        for (let ln = 0; ln < lane; ln++) {
          const overlap = project.clips.some(c => c.trackId === 'caption' && c.lane === ln && c.start < start + dur && c.end > start);
          if (!overlap) { foundFreeLane = ln; break; }
        }
      }
      if (foundFreeLane !== -1) {
        droppedLane = foundFreeLane;
      } else {
        // fallback: sameLane 后移
        const sameLane = project.clips
          .filter(c => c.trackId === 'caption' && c.lane === lane)
          .sort((a, b) => a.start - b.start);
        for (const c of sameLane) {
          if (start < c.end && start + dur > c.start) { start = c.end; }
        }
      }
    } else {
      const sameLane = project.clips
        .filter(c => c.trackId === type && c.lane === lane)
        .sort((a, b) => a.start - b.start);
      for (const c of sameLane) {
        if (start < c.end && start + dur > c.start) { start = c.end; }
      }
    }
    // FIX #5 字幕灵活: 放不下时不报错, 缩短到 available (>= 0.3s 就接受)
    let effectiveDur = dur;
    if (start + dur > project.duration) {
      if (type === 'caption') {
        const available = project.duration - start;
        if (available < 0.3) {
          toast.error('实在塞不下, 请加长视频时长或换轨');
          return;
        }
        effectiveDur = available;
      } else {
        toast.error('放不下, 请加长视频时长或换轨');
        return;
      }
    }
    const id = uid(type[0]);
    let clip: Clip;
    if (payload.type === 'image') clip = {
      id, trackId: 'image', lane: droppedLane, start, end: start + effectiveDur,
      src: payload.src!, label: payload.label || '图片',
      // v23-i: scene 默认 fx='none' (用户痛点: 删 FX 后场景仍动是 ken-burns 残留). 想运镜 → 主动加 FX clip
      fx: 'none',
      transform: { ...DEFAULT_TRANSFORM },
      kind: payload.kind === 'scene' ? 'scene' : undefined,
    };
    else if (payload.type === 'caption') clip = {
      id, trackId: 'caption', lane: droppedLane, start, end: start + effectiveDur,
      text: payload.text || '点击编辑字幕',
      style: payload.captionStyle ?? DEFAULT_CAPTION_STYLE,
      fontSize: payload.captionFontSize,
      color: payload.captionColor,
    };
    else if (payload.type === 'fx') {
      // v23-h: timeline drop — 同 quickAdd 路径, fx='move' 时 init transforms from 同时段最上层 image
      // v23-k: 修默认 target 优先非 scene + lane 最低
      const fxKind = payload.fx || 'shake';
      const ph = (start + end) / 2;
      const candidates = project.clips.filter(c => c.trackId === 'image' && ph >= c.start && ph < c.end) as ImageClip[];
      const targetImage = candidates.length > 0
        ? candidates.sort((a, b) => {
            const aScene = a.kind === 'scene' ? 1 : 0;
            const bScene = b.kind === 'scene' ? 1 : 0;
            if (aScene !== bScene) return aScene - bScene;
            return a.lane - b.lane;
          })[0]
        : undefined;
      const targetTr = targetImage?.transform ?? DEFAULT_TRANSFORM;
      const fxBase: FXClip = { id, trackId: 'fx', lane: droppedLane, start, end: start + effectiveDur, fx: fxKind, targetClipId: targetImage?.id };
      initFXDefaults(fxBase, targetTr);
      if (fxKind === 'move') {
        toast.success('已加入移动动画 · 在画板上拖 A/B 圆圈设位置', { duration: 4000 });
      } else if (targetImage) {
        toast.success(`已加 ${FX_LIB.find(f => f.id === fxKind)?.name || fxKind} · 作用于 ${targetImage.label || '图片'}${targetImage.kind === 'scene' ? ' (场景)' : ''} · Inspector 可改对象`, { duration: 3500 });
      }
      clip = fxBase;
    }
    else if (payload.type === 'tts') {
      const ttsVoice = resolveVoiceId(payload.voice || VOICE_LIB[0].id);
      const ttsText = payload.text || '点击编辑文字';
      const ttsDur = estimateTTSDuration(ttsText, ttsVoice);
      clip = { id, trackId: 'tts', lane: droppedLane, start, end: Math.min(project.duration, start + ttsDur), text: ttsText, voice: ttsVoice };
    }
    else clip = { id, trackId: 'bgm', lane: droppedLane, start, end: start + effectiveDur, bgmId: payload.bgmId!, name: payload.name || 'BGM', volume: 0.5 };
    onAddClip(clip);
  };
  const handleDragOver = (e: React.DragEvent, type: TrackType, lane: number) => {
    if (!e.dataTransfer.types.includes('application/x-meme')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDropInfo({ type, lane });
  };
  useEffect(() => {
    if (!wrapRef.current) return;
    const w = wrapRef.current;
    const x = playhead * pxPerSec;
    const view = w.clientWidth;
    if (x < w.scrollLeft + 40) w.scrollLeft = Math.max(0, x - 40);
    else if (x > w.scrollLeft + view - 40) w.scrollLeft = x - view + 40;
  }, [playhead, pxPerSec]);

  const ticks = useMemo(() => {
    const arr: { s: number; major: boolean }[] = [];
    for (let s = 0; s <= project.duration; s++) arr.push({ s, major: s % 5 === 0 });
    return arr;
  }, [project.duration]);
  // 用户自定义 track 顺序 (持久化 IDB), 默认 TRACK_ORDER. 拖 label 调换
  const [customTrackOrder, setCustomTrackOrder] = useState<TrackType[]>(TRACK_ORDER);
  useEffect(() => {
    void idbGet<TrackType[]>(AM_TRACK_ORDER_IDB_KEY).then(loaded => {
      if (Array.isArray(loaded) && loaded.length === TRACK_ORDER.length && TRACK_ORDER.every(t => loaded.includes(t))) {
        setCustomTrackOrder(loaded);
      }
    }).catch(() => {});
  }, []);
  useEffect(() => {
    void idbSet(AM_TRACK_ORDER_IDB_KEY, customTrackOrder).catch(() => {});
  }, [customTrackOrder]);
  // 拖类型 label 调换顺序
  const dragTypeRef = useRef<TrackType | null>(null);
  const handleTypeDragStart = (type: TrackType) => { dragTypeRef.current = type; };
  const handleTypeDragOver = (e: React.DragEvent, _target: TrackType) => {
    if (dragTypeRef.current) e.preventDefault();
  };
  const handleTypeDrop = (target: TrackType) => {
    const src = dragTypeRef.current;
    dragTypeRef.current = null;
    if (!src || src === target) return;
    setCustomTrackOrder(prev => {
      const next = prev.filter(t => t !== src);
      const idx = next.indexOf(target);
      next.splice(idx, 0, src);
      return next;
    });
  };
  const flatLanes = useMemo(() => {
    const arr: { type: TrackType; lane: number }[] = [];
    for (const type of customTrackOrder) {
      // v24: GIF 模式隐藏 TTS/BGM 轨道
      if (isGifMode && (type === 'tts' || type === 'bgm')) continue;
      for (let i = 0; i < project.lanes[type]; i++) arr.push({ type, lane: i });
    }
    return arr;
  }, [project.lanes, customTrackOrder, isGifMode]);
  const timelineBodyHeight = totalLanes * LANE_ROW_H;

  return (
    <section className="am-timeline win7-panel" style={{ '--lane-h': `${LANE_ROW_H}px` } as React.CSSProperties}>
      <div className="am-tl-head">
        <span className="am-tl-head-title">⏱ 时间轴</span>
        <span className="am-tl-head-sub">{project.clips.length} 片段 · {totalLanes} 轨 · {project.duration.toFixed(1)}s</span>
        <div className="am-toolbar-spacer" />
        <div className="am-tl-zoom">
          <span>缩放</span>
          <input type="range" min="0.4" max="2.0" step="0.1" value={zoom} onChange={(e) => setZoom(parseFloat(e.target.value))} />
          <span className="am-tl-zoom-val">{zoom.toFixed(1)}x</span>
        </div>
      </div>
      <div className="am-tl-body">
        <div className="am-tl-labels" ref={labelsRef}>
          <div className="am-tl-ruler-cell" />
          {flatLanes.map(({ type, lane }) => {
            const isFirstOfType = lane === 0;
            const isLastOfType = lane === project.lanes[type] - 1;
            const TMIcon = TRACK_META[type].icon;
            return (
              <div
                key={`${type}-${lane}`}
                className={`am-tl-label am-tl-label-${type}`}
                draggable={isFirstOfType}
                onDragStart={isFirstOfType ? () => handleTypeDragStart(type) : undefined}
                onDragOver={(e) => handleTypeDragOver(e, type)}
                onDrop={() => handleTypeDrop(type)}
                title={isFirstOfType ? '拖动整组改变顺序' : ''}
              >
                {isFirstOfType && <span className="am-tl-label-drag" title="拖动调整轨道顺序">⋮⋮</span>}
                <span className="am-tl-label-emoji"><TMIcon size={12} strokeWidth={2.2} /></span>
                <span className="am-tl-label-name">{TRACK_META[type].name} {project.lanes[type] > 1 ? lane + 1 : ''}</span>
                <div className="am-tl-label-actions">
                  {isLastOfType && (
                    <button className="am-tl-lane-btn am-tl-lane-add" onClick={() => onAddLane(type)} title={`增加${TRACK_META[type].name}轨`}><Plus size={11} /></button>
                  )}
                  {!isFirstOfType && (
                    <button className="am-tl-lane-btn am-tl-lane-del" onClick={() => onRemoveLane(type, lane)} title={`删除空${TRACK_META[type].name}轨 ${lane + 1}`}><Minus size={11} /></button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="am-tl-tracks-wrap" ref={wrapRef} onScroll={handleScroll}>
          <div className="am-tl-tracks" style={{ width: totalWidth, height: RULER_H + timelineBodyHeight }}>
            <div className="am-tl-ruler">
              <div className="am-tl-scrub-zone" onPointerDown={startScrub} />
              {ticks.map(t => (
                <Fragment key={t.s}>
                  <div className={'am-tl-tick' + (t.major ? ' major' : '')} style={{ left: t.s * pxPerSec }} />
                  <div className="am-tl-tick-label" style={{ left: t.s * pxPerSec }}>{t.s}s</div>
                </Fragment>
              ))}
              <div className="am-tl-playhead-handle" style={{ left: playhead * pxPerSec }} onPointerDown={startPlayheadDrag} title="拖动跳转" />
              <div
                className="am-tl-duration-handle"
                style={{ left: project.duration * pxPerSec }}
                onPointerDown={startDurationDrag}
                title={`拖动改总时长 (当前 ${project.duration.toFixed(1)}s · 上限 ${isGifMode ? GIF_MAX_DURATION : 60}s)`}
              >
                <span className="am-tl-duration-handle-bar" />
                <span className="am-tl-duration-handle-lbl">{project.duration.toFixed(1)}s</span>
              </div>
            </div>
            {flatLanes.map(({ type, lane }) => {
              const isDrop = dropInfo?.type === type && dropInfo.lane === lane;
              return (
                <div
                  key={`${type}-${lane}`}
                  className={'am-tl-track' + (isDrop ? ' is-drop' : '')}
                  style={{ height: LANE_ROW_H }}
                  onDragOver={(e) => handleDragOver(e, type, lane)}
                  onDragLeave={() => setDropInfo(null)}
                  onDrop={(e) => handleDrop(e, type, lane)}
                >
                  {clipsByLane(project.clips, type, lane).map(c => (
                    <TLClip
                      key={c.id} clip={c} pxPerSec={pxPerSec} isSelected={c.id === selectedId}
                      onDown={(e) => startClipDrag(e, c, 'move')}
                      onResizeL={(e) => startClipDrag(e, c, 'resize-l')}
                      onResizeR={(e) => startClipDrag(e, c, 'resize-r')}
                      onContextMenu={(e) => onClipContextMenu?.(e, c)}
                    />
                  ))}
                </div>
              );
            })}
            {snapLine !== null && <div className="am-tl-snap-line" style={{ left: snapLine * pxPerSec }} />}
            <div className="am-tl-playhead" style={{ left: playhead * pxPerSec, top: 0, height: RULER_H + timelineBodyHeight }} />
          </div>
        </div>
      </div>
      {resizeTip && <div className="am-tl-resize-tip" style={{ left: resizeTip.x + 12, top: resizeTip.y - 28 }}>{resizeTip.text}</div>}
    </section>
  );
}

function TLClip({ clip, pxPerSec, isSelected, onDown, onResizeL, onResizeR, onContextMenu }: {
  clip: Clip; pxPerSec: number; isSelected: boolean;
  onDown: (e: React.PointerEvent) => void;
  onResizeL: (e: React.PointerEvent) => void;
  onResizeR: (e: React.PointerEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  const left = clip.start * pxPerSec;
  const width = Math.max(20, (clip.end - clip.start) * pxPerSec);
  const t = clip.trackId;
  let inner: React.ReactNode = null;
  if (t === 'image') {
    inner = (<><div className="am-tl-clip-thumb"><img src={clip.src} alt="" /></div><div className="am-tl-clip-label">{clip.label || '图片'}</div></>);
  } else if (t === 'caption') {
    inner = (<><span className="am-tl-clip-emoji"><TypeIcon size={11} strokeWidth={2.2} /></span><div className="am-tl-clip-label">{(clip as CaptionClip).text || '空字幕'}</div></>);
  } else if (t === 'fx') {
    const fxInfo = FX_LIB.find(f => f.id === (clip as FXClip).fx);
    const FXIcon = fxInfo?.icon ?? Sparkles;
    inner = (<><span className="am-tl-clip-emoji"><FXIcon size={11} strokeWidth={2.2} /></span><div className="am-tl-clip-label">{fxInfo?.name ?? '特效'}</div></>);
  } else if (t === 'tts') {
    const ts = clip as TTSClip;
    const v = VOICE_BY_ID[resolveVoiceId(ts.voice)];
    const VIcon = v?.icon ?? Mic;
    // 🔊 = 有 audioSrc (sync, 可导 MP4 真音轨)
    // ❌ = auto-gen 失败 (youdao + baidu 都挂), inspector 手动重试
    // ⏳ = youdao voice 但还没生成 (生成中)
    // 🎤 = SS voice (浏览器触发式, 无 sync, MP4 无声)
    const stateIcon = ts.text?.trim()
      ? (ts.audioSrc ? ' 🔊' : ts.genFailed ? ' ❌' : (v?.source === 'youdao' ? ' ⏳' : ' 🎤'))
      : '';
    inner = (<><span className="am-tl-clip-emoji"><VIcon size={11} strokeWidth={2.2} /></span><div className="am-tl-clip-label">{v?.name ? `${v.name}：` : ''}{ts.text || '空配音'}{stateIcon}</div></>);
  } else {
    inner = (<><span className="am-tl-clip-emoji"><Music size={11} strokeWidth={2.2} /></span><div className="am-tl-clip-label">{(clip as BGMClip).name || 'BGM'}</div></>);
  }
  // v23-h: 'move' FX clip 用更显眼的样式 (跟其他 FX 区分, 提示用户可点击编辑)
  const isMoveFx = clip.trackId === 'fx' && (clip as FXClip).fx === 'move';
  return (
    <div className={`am-tl-clip am-tl-clip-${t}${isSelected ? ' is-selected' : ''}${isMoveFx ? ' am-tl-clip-move' : ''}`} style={{ left, width }} onPointerDown={onDown} onContextMenu={onContextMenu}>
      <div className="am-tl-handle am-tl-handle-l" onPointerDown={onResizeL} />
      {inner}
      <div className="am-tl-handle am-tl-handle-r" onPointerDown={onResizeR} />
    </div>
  );
}

// ============================================================
// DEV-only — 📋 模板库 Modal
// ============================================================
function TemplatesModal({
  currentProject, onLoad, onClose,
}: {
  currentProject: ProjectState;
  onLoad: (tpl: AnimateTemplate) => void;
  onClose: () => void;
}) {
  const [templates, setTemplates] = useState<AnimateTemplate[]>(ANIMATE_TEMPLATES);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [tags, setTags] = useState('roast');
  const [saving, setSaving] = useState(false);

  // 序列化当前 project — 去除 audioSrc dataURL 防文件爆炸; image src 保留 (dataURL 内联 SVG / 上传图)
  const serializedProject = useMemo(() => {
    const safe: ProjectState = {
      duration: currentProject.duration,
      lanes: { ...currentProject.lanes },
      clips: currentProject.clips.map(c => {
        if (c.trackId === 'tts') {
          const ts = c as TTSClip;
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { audioSrc, ...rest } = ts;
          return rest;
        }
        return c;
      }),
    };
    return safe;
  }, [currentProject]);

  const save = async () => {
    if (!name.trim()) { toast.error('填模板名'); return; }
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || `tpl-${Date.now()}`;
    if (templates.some(t => t.id === id)) {
      const overwriteRes = await showDialog({
        title: '模板已存在',
        message: `模板 id "${id}" 已存在, 覆盖?`,
        variant: 'warning',
        confirmText: '覆盖',
      });
      if (!overwriteRes.confirmed) return;
    }
    setSaving(true);
    const next: AnimateTemplate[] = [
      ...templates.filter(t => t.id !== id),
      { id, name: name.trim(), desc: desc.trim(), tags: tags.split(',').map(s => s.trim()).filter(Boolean), project: serializedProject },
    ];
    try {
      const res = await fetch('/__sync/animate-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templates: next }),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`${res.status}: ${t.slice(0, 200)}`);
      }
      setTemplates(next);
      toast.success(`✅ 已写入 src/data/animateTemplates.ts (${next.length} 模板) · 刷新生效`);
      setName(''); setDesc('');
    } catch (e) {
      toast.error('写盘失败: ' + (e as Error).message);
    } finally { setSaving(false); }
  };
  const remove = async (id: string) => {
    const removeRes = await showDialog({
      title: '删除模板',
      message: `删除模板 "${id}"?`,
      destructive: true,
      confirmText: '删除',
    });
    if (!removeRes.confirmed) return;
    const next = templates.filter(t => t.id !== id);
    if (next.length === 0) { toast.error('至少留 1 个模板 (防误删)'); return; }
    try {
      const res = await fetch('/__sync/animate-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templates: next }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      setTemplates(next);
      toast.success('已删');
    } catch (e) {
      toast.error('删除失败: ' + (e as Error).message);
    }
  };

  return (
    <div className="am-dev-modal-bg" onClick={onClose}>
      <div className="am-dev-modal" onClick={(e) => e.stopPropagation()}>
        <div className="am-dev-modal-head">
          📋 <span>模板库 (DEV)</span>
          <span style={{ fontSize: 11, fontWeight: 400, color: '#888', marginLeft: 8 }}>
            写到 src/data/animateTemplates.ts · prod tree-shake
          </span>
          <button className="am-dev-close" onClick={onClose} type="button"><X size={14} /></button>
        </div>
        <div className="am-dev-modal-body">
          <div className="am-dev-row">
            <strong>💾 保存当前 project 为新模板</strong>
          </div>
          <div className="am-dev-row">
            <input className="am-input" placeholder="模板名 (如 熊猫斗图开场)" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1 }} />
          </div>
          <div className="am-dev-row">
            <input className="am-input" placeholder="一句话描述" value={desc} onChange={(e) => setDesc(e.target.value)} style={{ flex: 2 }} />
            <input className="am-input" placeholder="tags (逗号分隔)" value={tags} onChange={(e) => setTags(e.target.value)} style={{ flex: 1 }} />
            <button className="am-tb-btn am-tb-btn-primary" onClick={save} disabled={saving || !name.trim()} type="button">
              {saving ? '写盘中…' : '💾 保存到源文件'}
            </button>
          </div>
          <div className="am-dev-row" style={{ color: '#888', fontSize: 10 }}>
            当前 project: {currentProject.clips.length} clips · {currentProject.duration.toFixed(1)}s
            · {(JSON.stringify(serializedProject).length / 1024).toFixed(1)} KB
          </div>
          <hr style={{ margin: '12px 0', border: 0, borderTop: '1px dashed #cdd3da' }} />
          <div className="am-dev-row"><strong>已有模板 ({templates.length})</strong></div>
          {templates.length === 0 ? (
            <div className="am-dev-tpl-empty">暂无模板 · 用上方表单保存当前 project</div>
          ) : (
            <div className="am-dev-tpl-grid">
              {templates.map(t => (
                <div key={t.id} className="am-dev-tpl-card">
                  <div className="am-dev-tpl-card-name">{t.name}</div>
                  <div className="am-dev-tpl-card-desc">{t.desc || '(无描述)'}</div>
                  <div className="am-dev-tpl-card-meta">tags: {t.tags.join(', ') || '(无)'}</div>
                  <div className="am-row am-row-tight" style={{ marginTop: 6 }}>
                    <button className="am-tb-btn" type="button" onClick={() => onLoad(t)}>📂 读入</button>
                    <button className="am-tb-btn am-tb-btn-danger" type="button" onClick={() => remove(t.id)}>✕</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="am-dev-modal-foot">
          <button className="am-tb-btn" onClick={onClose} type="button">关闭</button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// DEV-only — 🎵 BGM 字幕对齐器 Modal
// 选 mp3 → Web Audio 解码 → 找节拍 → 一键按节拍生成 caption clips
// 简易节拍检测 (energy onset): 切 50ms 窗, 算 RMS, peak detect with 0.5s 最小间隔
// ============================================================
function BgmAlignModal({
  duration, onClose, onApply,
}: {
  duration: number;
  onClose: () => void;
  onApply: (beatTimes: number[], texts: string[], style: CaptionStyle) => void;
}) {
  const [waveData, setWaveData] = useState<{ peaks: number[]; durationSec: number } | null>(null);
  const [beats, setBeats] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [textPoolMode, setTextPoolMode] = useState<CaptionMode | 'all'>('all');
  const [overrideTexts, setOverrideTexts] = useState('');
  const [style, setStyle] = useState<CaptionStyle>('meme');
  const [minGap, setMinGap] = useState(0.5);
  const [sensitivity, setSensitivity] = useState(1.4); // RMS 倍数阈值
  const fileRef = useRef<HTMLInputElement>(null);

  const analyze = async (file: File) => {
    // v23-b: caption/tts auto-extract 音频, 30MB 容纳长 BGM, 解码内存 OK
    if (file.size > 30 * 1024 * 1024) {
      toast.error('audio 文件超 30MB · 解码占内存过大, 拒绝');
      return;
    }
    setBusy(true);
    type WindowWithWebkit = Window & { webkitAudioContext?: typeof AudioContext };
    const AC = window.AudioContext || (window as WindowWithWebkit).webkitAudioContext;
    if (!AC) { toast.error('浏览器不支持 AudioContext'); setBusy(false); return; }
    const ac = new AC();
    try {
      const buf = await file.arrayBuffer();
      const audioBuf = await ac.decodeAudioData(buf);
      const channel = audioBuf.getChannelData(0);
      const sr = audioBuf.sampleRate;
      const winSec = 0.05;
      const winLen = Math.floor(sr * winSec);
      const peaks: number[] = [];
      for (let i = 0; i < channel.length; i += winLen) {
        let sum = 0;
        for (let j = i; j < Math.min(i + winLen, channel.length); j++) sum += channel[j] * channel[j];
        peaks.push(Math.sqrt(sum / winLen));
      }
      setWaveData({ peaks, durationSec: audioBuf.duration });
    } catch (e) {
      toast.error('解码失败: ' + (e as Error).message);
    } finally {
      try { await ac.close(); } catch {}
      setBusy(false);
    }
  };
  const detectBeats = useCallback(() => {
    if (!waveData) return;
    const { peaks, durationSec } = waveData;
    if (peaks.length === 0) return;
    const winSec = durationSec / peaks.length;
    const minGapWins = Math.max(1, Math.floor(minGap / winSec));
    const avg = peaks.reduce((a, b) => a + b, 0) / peaks.length;
    const threshold = avg * sensitivity;
    const bts: number[] = [];
    let lastBeatIdx = -minGapWins;
    for (let i = 1; i < peaks.length - 1; i++) {
      if (peaks[i] > threshold && peaks[i] > peaks[i - 1] && peaks[i] > peaks[i + 1] && i - lastBeatIdx >= minGapWins) {
        bts.push(i * winSec);
        lastBeatIdx = i;
      }
    }
    setBeats(bts);
    toast.success(`检测到 ${bts.length} 个节拍`);
  }, [waveData, minGap, sensitivity]);
  const applyToTimeline = () => {
    if (beats.length === 0) { toast.error('先检测节拍'); return; }
    const overrideArr = overrideTexts.split('\n').map(s => s.trim()).filter(Boolean);
    let texts = overrideArr.length > 0 ? overrideArr : [];
    if (texts.length === 0) {
      // 从 quickModeTexts 抽 beats.length 条 (取够数, 自动循环)
      const want = Math.min(20, beats.length);
      for (let i = 0; i < want; i++) {
        const t = pickRandomText('zh', textPoolMode, texts[texts.length - 1]);
        if (t) texts.push(t); else texts.push('🎤');
      }
    }
    // 过滤超过 project.duration 的节拍
    const inRange = beats.filter(t => t < duration);
    onApply(inRange, texts, style);
  };

  // 渲染 waveform — peaks normalize 到 0-1, 每条 2px
  const visBars = useMemo(() => {
    if (!waveData) return [];
    const W = 800;
    const barW = 2;
    const max = waveData.peaks.reduce((m, p) => Math.max(m, p), 0.001);
    const step = Math.max(1, Math.ceil(waveData.peaks.length / (W / barW)));
    const out: { left: number; h: number }[] = [];
    for (let i = 0; i < waveData.peaks.length; i += step) {
      out.push({
        left: (i / waveData.peaks.length) * W,
        h: Math.min(80, (waveData.peaks[i] / max) * 90),
      });
    }
    return out;
  }, [waveData]);

  return (
    <div className="am-dev-modal-bg" onClick={onClose}>
      <div className="am-dev-modal" onClick={(e) => e.stopPropagation()}>
        <div className="am-dev-modal-head">
          🎵 <span>BGM 字幕对齐器 (DEV)</span>
          <span style={{ fontSize: 11, fontWeight: 400, color: '#888', marginLeft: 8 }}>
            选 mp3 → 检测节拍 → 一键生成对齐字幕
          </span>
          <button className="am-dev-close" onClick={onClose} type="button"><X size={14} /></button>
        </div>
        <div className="am-dev-modal-body">
          <div className="am-dev-row">
            <input
              ref={fileRef} type="file" accept="audio/*" style={{ display: 'none' }}
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void analyze(f); }}
            />
            <button className="am-tb-btn am-tb-btn-primary" onClick={() => fileRef.current?.click()} disabled={busy} type="button">
              {busy ? '解码中…' : '📂 选 mp3 / wav'}
            </button>
            <span style={{ fontSize: 11, color: '#888' }}>
              {waveData ? `波形 ${waveData.durationSec.toFixed(1)}s · ${waveData.peaks.length} 帧` : '未加载'}
            </span>
          </div>
          {waveData && (
            <>
              <div className="am-dev-bgm-wave" style={{ width: 800 }}>
                {visBars.map((b, i) => (
                  <div key={i} className="am-dev-bgm-bar" style={{ left: b.left, height: b.h }} />
                ))}
                {beats.map((t, i) => (
                  <div key={i} className="am-dev-bgm-beat" style={{ left: (t / waveData.durationSec) * 800 }} />
                ))}
              </div>
              <div className="am-dev-row">
                <span>灵敏度 (peak 倍数)</span>
                <input type="range" min="0.8" max="3" step="0.1" value={sensitivity} onChange={(e) => setSensitivity(parseFloat(e.target.value))} style={{ flex: 1 }} />
                <strong>{sensitivity.toFixed(1)}</strong>
              </div>
              <div className="am-dev-row">
                <span>最小间隔 (s)</span>
                <input type="range" min="0.2" max="2" step="0.1" value={minGap} onChange={(e) => setMinGap(parseFloat(e.target.value))} style={{ flex: 1 }} />
                <strong>{minGap.toFixed(1)}s</strong>
              </div>
              <div className="am-dev-row">
                <button className="am-tb-btn" onClick={detectBeats} type="button">⚡ 检测节拍</button>
                <span>找到 <strong>{beats.length}</strong> 个节拍</span>
              </div>
              <hr style={{ margin: '10px 0', border: 0, borderTop: '1px dashed #cdd3da' }} />
              <div className="am-dev-row">
                <span>文本池</span>
                {(['all', 'roast', 'fomo', 'fud'] as (CaptionMode | 'all')[]).map(m => (
                  <button key={m} type="button" className={'am-cap-quick-mode' + (textPoolMode === m ? ' is-active' : '')} onClick={() => setTextPoolMode(m)}>
                    {m === 'all' ? '默认' : CAPTION_MODE_LABELS[m]?.zh ?? m}
                  </button>
                ))}
              </div>
              <div className="am-dev-row">
                <span>样式</span>
                {(['meme', 'panel', 'bar'] as CaptionStyle[]).map(s => (
                  <button key={s} type="button" className={'am-style-chip am-style-chip-' + s + (style === s ? ' is-active' : '')} onClick={() => setStyle(s)}>
                    {s === 'meme' ? 'Meme' : s === 'panel' ? '白板' : '黑条'}
                  </button>
                ))}
              </div>
              <div className="am-dev-row">
                <textarea
                  className="am-input am-textarea"
                  placeholder="留空 = 自动从文本池抽; 或一行一句覆盖 (循环用)"
                  value={overrideTexts}
                  onChange={(e) => setOverrideTexts(e.target.value)}
                  style={{ flex: 1, minHeight: 60 }}
                />
              </div>
            </>
          )}
        </div>
        <div className="am-dev-modal-foot">
          <button className="am-tb-btn" onClick={onClose} type="button">取消</button>
          <button className="am-tb-btn am-tb-btn-primary" onClick={applyToTimeline} disabled={beats.length === 0} type="button">
            ✚ 加 {beats.length} 个节拍字幕到时间轴
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// DEV-only — 🛠 状态导出 Modal (封装 console 三件套, 不走快捷键)
// ============================================================
function StateDumpModal({ onClose }: { onClose: () => void }) {
  const callDump = (name: '__dumpTTS' | '__dumpProject' | '__dumpTemplate') => {
    const fn = (window as unknown as Record<string, (() => void) | undefined>)[name];
    if (typeof fn === 'function') { fn(); }
    else toast.error(name + ' 未挂载 (打开 AnimateMode 时 useEffect 才注册)');
  };
  return (
    <div className="am-dev-modal-bg" onClick={onClose}>
      <div className="am-dev-modal" onClick={(e) => e.stopPropagation()} style={{ width: 'min(520px, 95vw)' }}>
        <div className="am-dev-modal-head">
          🛠 <span>状态导出 (DEV)</span>
          <button className="am-dev-close" onClick={onClose} type="button"><X size={14} /></button>
        </div>
        <div className="am-dev-modal-body">
          <p style={{ marginTop: 0 }}>导出当前 AnimateMode 内部状态到 console + 剪贴板 (报 bug 时可粘给开发者).</p>
          <div className="am-dev-row">
            <button className="am-tb-btn am-tb-btn-primary" onClick={() => callDump('__dumpTTS')} type="button" style={{ flex: 1 }}>
              🎤 TTS 状态表
            </button>
            <span style={{ fontSize: 11, color: '#888' }}>显所有 TTS clip 的 audioSrc / engine / path</span>
          </div>
          <div className="am-dev-row">
            <button className="am-tb-btn am-tb-btn-primary" onClick={() => callDump('__dumpProject')} type="button" style={{ flex: 1 }}>
              📋 Project 时间表
            </button>
            <span style={{ fontSize: 11, color: '#888' }}>全 clip 排序按 start, 适合排查时序</span>
          </div>
          <div className="am-dev-row">
            <button className="am-tb-btn am-tb-btn-primary" onClick={() => callDump('__dumpTemplate')} type="button" style={{ flex: 1 }}>
              📜 模板 (TS 代码)
            </button>
            <span style={{ fontSize: 11, color: '#888' }}>序列化 project 为 TS 代码, 可粘到 source</span>
          </div>
          <div className="am-dev-row" style={{ fontSize: 10, color: '#888', marginTop: 10 }}>
            提示: 这 3 个 dump 也对应 F12 快捷键 <kbd>{fmtShortcut('Mod+Shift+D')}</kbd> / <kbd>{fmtShortcut('Mod+Shift+P')}</kbd> / <kbd>{fmtShortcut('Mod+Shift+T')}</kbd>
          </div>
        </div>
        <div className="am-dev-modal-foot">
          <button className="am-tb-btn" onClick={onClose} type="button">关闭</button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// 快捷键完整 Modal
// ============================================================
function ShortcutsModal({ onClose }: { onClose: () => void }) {
  const sections: { label: string; rows: { keys: string[]; desc: string }[] }[] = [
    {
      label: '播放控制',
      rows: [
        { keys: ['Space', 'K'], desc: '播放 / 暂停' },
        { keys: ['J'], desc: '倒退 1 秒' },
        { keys: ['L'], desc: '前进 1 秒' },
        { keys: [','], desc: '后退 1 帧' },
        { keys: ['.'], desc: '前进 1 帧' },
        { keys: ['Home'], desc: '跳到开头' },
        { keys: ['End'], desc: '跳到结尾' },
      ],
    },
    {
      label: '选中片段',
      rows: [
        { keys: ['S'], desc: '在 playhead 切分' },
        { keys: [fmtShortcut('Mod+D')], desc: '复制片段' },
        { keys: [fmtShortcut('Mod+C')], desc: '拷贝' },
        { keys: [fmtShortcut('Mod+X')], desc: '剪切' },
        { keys: [fmtShortcut('Mod+V')], desc: '粘贴到 playhead' },
        { keys: ['Delete', 'Backspace'], desc: '删除' },
        { keys: ['↑', '↓'], desc: '上 / 下 lane' },
        { keys: ['←', '→'], desc: '微调 0.1s' },
        { keys: ['Shift+←/→'], desc: '微调整秒' },
        { keys: ['Alt+←/→'], desc: '微调 1 帧' },
        { keys: ['Esc'], desc: '取消选择' },
      ],
    },
    {
      label: '整体',
      rows: [
        { keys: [fmtShortcut('Mod+Z')], desc: '撤销' },
        { keys: [fmtShortcut('Mod+Shift+Z'), fmtShortcut('Mod+Y')], desc: '重做' },
        { keys: [fmtShortcut('Mod+S')], desc: '保存草稿' },
        { keys: [fmtShortcut('Mod+Shift+S')], desc: '另存草稿' },
        { keys: [fmtShortcut('Mod+A')], desc: '全选' },
        { keys: [fmtShortcut('Mod+Shift+Backspace')], desc: '清空所有片段' },
        { keys: ['+', '='], desc: '时间轴放大' },
        { keys: ['-', '_'], desc: '时间轴缩小' },
      ],
    },
  ];
  return (
    <div className="am-dev-modal-bg" onClick={onClose}>
      <div className="am-dev-modal am-shortcut-modal" onClick={(e) => e.stopPropagation()} style={{ width: 'min(640px, 95vw)' }}>
        <div className="am-dev-modal-head">
          ⌨️ <span>沙雕动画 · 快捷键</span>
          <span style={{ fontSize: 11, fontWeight: 400, color: '#888', marginLeft: 8 }}>
            当前系统: <strong>{IS_MAC ? 'macOS (⌘)' : 'Win/Linux (Ctrl)'}</strong>
          </span>
          <button className="am-dev-close" onClick={onClose} type="button"><X size={14} /></button>
        </div>
        <div className="am-dev-modal-body am-shortcut-modal-body">
          {sections.map(sec => (
            <div key={sec.label} className="am-shortcut-section">
              <div className="am-shortcut-section-head">{sec.label}</div>
              {sec.rows.map((r, i) => (
                <div key={i} className="am-shortcut-row">
                  <div className="am-shortcut-keys">
                    {r.keys.map((k, j) => (
                      <Fragment key={j}>
                        {j > 0 && <span className="am-shortcut-sep">/</span>}
                        <kbd className="am-shortcut-kbd">{k}</kbd>
                      </Fragment>
                    ))}
                  </div>
                  <div className="am-shortcut-desc">{r.desc}</div>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="am-dev-modal-foot">
          <button className="am-tb-btn am-tb-btn-primary" onClick={onClose} type="button">知道了</button>
        </div>
      </div>
    </div>
  );
}

export default AnimateMode;
