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
