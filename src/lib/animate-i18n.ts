// 沙雕动画 (animate / GIF) 板块 i18n 基础设施.
// 整个 app 早有全局 中/EN 开关 (translations.ts + useMeme().state.language), 但 animate 板块历来全是
// 硬编码中文、完全不响应开关. 本模块让 animate 各文件跟随同一个开关: 切到 EN 时整板块显英文, 默认仍中文.
//
// 用法 (各组件):
//   const lang = useUiLang();
//   const t = pickLang(DICT, lang);   // DICT = 该文件内联的 { zh: {...}, en: {...} }
//   ...{t('someKey')}...
// 组件都在 <MemeProvider> 下, 可直接调 useUiLang(). 字典放各文件内联 (按文件就近维护, 避免一个巨型字典).
import { useMeme } from '@/context/memecontext';

export type UiLang = 'zh' | 'en';

/** 当前界面语言 (跟随顶栏 中/EN 全局开关). 非 'en' 一律按 'zh'. */
export function useUiLang(): UiLang {
  return useMeme().state.language === 'en' ? 'en' : 'zh';
}

/** 用 {zh, en} 字典 + 当前语言生成翻译函数. en 缺某 key 时回退 zh (永不显示 undefined). */
export function pickLang<T extends Record<string, string>>(
  dict: { zh: T; en: Partial<Record<keyof T, string>> },
  lang: UiLang,
): (k: keyof T) => string {
  return (k) => (lang === 'en' ? (dict.en[k] ?? dict.zh[k]) : dict.zh[k]);
}

// 循环/鬼畜动作名 (LOOP_MOTIONS 的 label 在 animcore, 是视频+GIF 共用的 *数据*; 不改数据结构,
// 这里按 kind 提供 EN 名, 渲染处用 motionLabel(kind, lang) 取当前语言名. customMove 单列.
const MOTION_EN: Record<string, string> = {
  none: 'Still', bob: 'Bob', shimmy: 'Shake', sway: 'Sway', breathe: 'Breathe',
  pulseLoop: 'Pulse', spin360: 'Spin', float: 'Figure-8', bounce: 'Bounce', orbit: 'Orbit',
  hop: 'Hop', wobble: 'Wobble', jitter: 'Jitter', punch: 'Punch-in', swing: 'Pendulum',
  flip: 'Flip', customMove: 'Custom',
};
/** 动作名按语言取: zh 直接用传入的中文 label, en 用 kind 映射 (回退中文 label). */
export function motionLabel(kind: string, zhLabel: string, lang: UiLang): string {
  return lang === 'en' ? (MOTION_EN[kind] ?? zhLabel) : zhLabel;
}

// 新手引导「动手 demo」信号 — animate/gif 在「用户真做了某动作」(加配套/拖图层/加动效) 时调一下,
// 引导组件 (AnimateOnboarding 的 onDemoMount) 监听到匹配类型就自动推进到下一步 → 真·交互式而非只读+下一步.
export type OnboardDemoType = 'add-combo' | 'drag-layer' | 'click-motion';
export function signalOnboardingDemo(type: OnboardDemoType): void {
  try { window.dispatchEvent(new CustomEvent('xmw-onboard-demo', { detail: { type } })); } catch { /* SSR/旧环境忽略 */ }
}
