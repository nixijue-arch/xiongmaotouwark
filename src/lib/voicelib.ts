// voicelib.ts — 配音音色库 + 时长估算 + id 解析 (从 animatemode.tsx 抽出, E0)
// 融会贯通但不打通: video(animatemode) 与共享字幕批量导入(sharededitor)都 import 这里.
// GIF 模式强制 withTTS=false, 用不到合成, 但 CaptionBatchImport 的类型/常量需可解析.
// 实际 TTS 抓取 (fetchTTSForVoice / audioEngine) 仍留在 animatemode.tsx.

import type { LucideIcon } from 'lucide-react';
import { Mic, Globe } from 'lucide-react';

export interface VoicePreset {
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
export const VOICE_LIB: VoicePreset[] = [
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
    name: 'English · Aria',
    desc: '美式英文 · 云端朗读 (跟中文同源音色)',
    emoji: '🇺🇸',
    icon: Globe,
    gender: 'female',
    lang: 'en-US',
    hints: ['Aria', 'Jenny', 'Michelle', 'Ana', 'Sara'],
    azureName: 'en-US-AriaNeural',
    source: 'youdao',
    preferredEngine: 'youdao',
    playbackRate: 1.0,
    fallbackPitch: 1.0,
    rate: 1.02,
    sampleText: 'Hello everyone',
  },
];
export const VOICE_BY_ID = Object.fromEntries(VOICE_LIB.map(v => [v.id, v])) as Record<string, VoicePreset>;
// TTS 时长估算 — 让 clip width 跟实际朗读时间匹配
// 中文: ≈ 0.26s / 字 (1.0 rate), 英文: ≈ 0.32s / 词
// 抖音/CapCut 实测节奏类似. 留 +0.4s 头尾缓冲, 最少 0.8s 防极短 clip
export function estimateTTSDuration(text: string, voiceId: string): number {
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
export function resolveVoiceId(id: string): string {
  if (VOICE_BY_ID[id]) return id;
  if (LEGACY_VOICE_MAP[id] && VOICE_BY_ID[LEGACY_VOICE_MAP[id]]) return LEGACY_VOICE_MAP[id];
  return VOICE_LIB[0].id;
}
