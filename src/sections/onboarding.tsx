// onboarding.tsx — 沙雕动画「新手引导」交互式引擎 (自包含, 解耦 app context)
//
// 设计目标 (社区反馈: 功能太多, 首次打开懵): 3 分钟动手快速上手, 直奔「第一次成功」
// (做出会动的表情包 / 循环 GIF). 走「learn-by-doing」: 聚光灯 cutout + coach 卡 + 真·动手 demo 提示.
//
// 用法 (host 在 animatemode.tsx / gifmode.tsx 里):
//   import { AnimateOnboarding, ONBOARDING_SEEN_KEY } from '@/sections/onboarding';
//   <AnimateOnboarding open={showGuide} lang={lang} theme="video" view="video"
//      onClose={() => setShowGuide(false)} onFinish={() => { setShowGuide(false); localStorage.setItem(ONBOARDING_SEEN_KEY,'1'); }} />
//
// ❗ 本文件只「新增」, 不改任何现有文件. host 负责: ① 给真实元素加 data-tour="KEY" ② 控制 open ③ 处理 onClose/onFinish.
//
// ── host 要加的 data-tour="KEY" 选择器清单 (KEY → 真实元素) ──
//   mode-toggle      → 顶栏 视频/GIF 切换: <div className="am-tb-mode">          (animatemode.tsx) / GIF 视图同款 (gifmode.tsx)
//   panel-materials  → 左栏「素材」段按钮: 第 1 个 <SegBtn label="素材">         (两视图)
//   panel-combo      → 「配套」子 tab 按钮: am-subtabs 里 k==='combo' 的 <button> (两视图)
//   preview-canvas   → 中间预览画板: <div className="am-preview-canvas">(视频) / <div className="gm-stage">(GIF)
//   panel-motion     → 左栏「动效」段按钮: <SegBtn label="动效"> / GIF segbar seg==='fx' 按钮
//   panel-caption    → 左栏「字幕」段按钮: <SegBtn label="字幕"> / GIF segbar seg==='caption' 按钮
//   panel-music      → 左栏「音乐」段按钮: <SegBtn label="音乐"> (仅视频, GIF 无此段)
//   panel-voice      → 左栏「配音」段按钮: <SegBtn label="配音"> (仅视频, GIF 无此段)
//   timeline         → 底部时间轴容器: <div className="am-tl-..."> (视频) / <div className="gm-timeline">(GIF)
//   duration-handle  → 时间轴时长手柄: <div className="am-tl-duration-handle">(视频) / <div className="gm-tl-durhandle">(GIF)
//   btn-export       → 导出按钮: 「导出视频」<button className="am-tb-btn-primary">(视频) / 「导出 GIF」(GIF)
//   btn-upload       → 左栏素材区「上传」入口 (am-mini-upload / 上传子 tab) — welcome/done 步骤文案提到, 选择器可选加
//   guide-button     → host 新增的「新手引导」重放按钮 (放顶栏「⌨️ 快捷键」旁边即可)
//
// anchor 找不到 (元素没渲染 / KEY 没加) → 自动降级成居中弹窗, 绝不崩.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useIsMobile } from '@/hooks/usemediaquery';
import {
  DEFAULT_VIDEO_STEPS,
  DEFAULT_GIF_STEPS,
  type OnboardingStep,
  type OnboardingProps,
} from '@/sections/onboarding-steps';
import './onboarding.css';

// re-export 数据层 → host 从本文件一处 import 即可 (放 onboarding-steps.ts 是为了 eslint react-refresh 干净)
export { DEFAULT_VIDEO_STEPS, DEFAULT_GIF_STEPS, ONBOARDING_SEEN_KEY } from '@/sections/onboarding-steps';
export type { OnboardingStep, OnboardingProps } from '@/sections/onboarding-steps';

// ============================================================
// 文案 — chrome 按钮 (双语)
// ============================================================
const T = {
  prev: { zh: '上一步', en: 'Prev' },
  next: { zh: '下一步', en: 'Next' },
  skip: { zh: '跳过', en: 'Skip' },
  done: { zh: '完成', en: 'Done' },
  tryIt: { zh: '试试看', en: 'Try it' },
  tryHint: {
    zh: '↑ 在高亮处动手试一下 (或直接「下一步」)',
    en: '↑ Try it on the highlighted area (or just hit Next)',
  },
} as const;

const SPOTLIGHT_PAD = 8;     // 聚光灯洞比元素四周大多少 px
const CARD_GAP = 14;         // coach 卡跟 anchor 的间距
const CARD_W = 320;          // coach 卡桌面宽度 (跟 css 同步)
const VIEWPORT_MARGIN = 12;  // 卡距视口边缘最小留白

type Rect = { top: number; left: number; width: number; height: number; panelRight?: number };
type Placement = NonNullable<OnboardingStep['placement']>;

// ============================================================
// 主组件
// ============================================================
export function AnimateOnboarding(props: OnboardingProps): React.JSX.Element | null {
  const { open, lang, theme, view, onClose, onFinish, steps, onDemoMount } = props;
  const isMobile = useIsMobile();

  // 默认步骤按 view 选 (host 没传 steps 时)
  const activeSteps = useMemo<OnboardingStep[]>(
    () => steps ?? (view === 'gif' ? DEFAULT_GIF_STEPS : DEFAULT_VIDEO_STEPS),
    [steps, view],
  );

  const [idx, setIdx] = useState(0);
  // anchor 的视口坐标 (null = 无 anchor 或没找到 → 居中弹窗)
  const [anchorRect, setAnchorRect] = useState<Rect | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  // 打开前的焦点元素 — 关闭时还原 (最小 focus trap)
  const prevFocusRef = useRef<HTMLElement | null>(null);

  // open: false→true 的瞬间把 idx 归 0. 用「渲染期 setState + 上一次值用 state 存」的官方模式
  // (React 允许渲染期 setState 做派生; 比 effect setIdx 更早生效, 且不触发 set-state-in-effect / refs 规则)
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setIdx(0);
  }
  // 引导开着时切换 视频/GIF → 步骤集换了, idx 归 0 (防落到另一套步骤的中间 / 越界). 同样的渲染期派生模式.
  const [prevView, setPrevView] = useState(view);
  if (view !== prevView) {
    setPrevView(view);
    setIdx(0);
  }

  // OOB 守卫: steps 变短的那一帧 idx 可能还没复位 → 兜底取末步, 防 step.title 访问崩溃
  const step = activeSteps[idx] ?? activeSteps[activeSteps.length - 1];
  const isFirst = idx === 0;
  const isLast = idx === activeSteps.length - 1;
  const total = activeSteps.length;

  const reduceMotion = useMemo(
    () => typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  );

  // 打开时记录原焦点, 关闭时还原 (最小 focus trap: 不强夺, 只归还). idx 复位在渲染期已做.
  useEffect(() => {
    if (!open) return;
    prevFocusRef.current = (document.activeElement as HTMLElement) ?? null;
    return () => {
      try { prevFocusRef.current?.focus?.(); } catch { /* 元素可能已卸载 */ }
    };
  }, [open]);

  // 锁背景滚动 (引导期间)
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // ── 测量当前 step 的 anchor (resize / scroll 都重测) ──
  const measure = useCallback(() => {
    if (!step?.anchor) { setAnchorRect(null); return; }
    let el: Element | null = null;
    try { el = document.querySelector(step.anchor); } catch { el = null; }
    if (!el) { setAnchorRect(null); return; }  // 选择器没命中 → 降级居中, 不崩
    const r = el.getBoundingClientRect();
    // 元素被折叠/隐藏 (0 尺寸) 也降级居中, 避免在角落打个看不见的洞
    if (r.width < 1 || r.height < 1) { setAnchorRect(null); return; }
    // anchor 若在左栏面板内, 记面板右缘 → coach 卡放到面板右侧 (不遮挡用户要点的面板内容, 如 combo 列表)
    let panelRight: number | undefined;
    const panel = el.closest('.am-pane-left, .gm-pane-left');
    if (panel) { const pr = panel.getBoundingClientRect(); if (pr.right > r.left + r.width) panelRight = pr.right; }
    setAnchorRect({ top: r.top, left: r.left, width: r.width, height: r.height, panelRight });
  }, [step]);

  // step 变 / 打开 → 立即测 (useLayoutEffect 防闪烁); 并把 anchor 滚进视野
  useLayoutEffect(() => {
    if (!open) return;
    if (step?.anchor) {
      try {
        const el = document.querySelector(step.anchor);
        el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
      } catch { /* ignore */ }
    }
    // 测量放进 rAF / setTimeout 回调里 (而非 effect 体内直接 setState):
    // rAF 在下一帧 paint 前跑 = 视觉上即时无闪; 滚动是异步的, 220ms 后再补测一次命中更稳.
    const raf = requestAnimationFrame(measure);
    const t = window.setTimeout(measure, reduceMotion ? 0 : 220);
    return () => { cancelAnimationFrame(raf); window.clearTimeout(t); };
  }, [open, idx, step, measure, reduceMotion]);

  // resize / scroll (捕获阶段, 抓所有滚动容器) 时持续重测
  useEffect(() => {
    if (!open) return;
    const onMove = () => measure();
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [open, measure]);

  // ── 导航 ── (onFinish 放 updater 外, 避免 StrictMode 下 updater 双调导致 onFinish 触发两次)
  const goNext = useCallback(() => {
    if (idx >= total - 1) { onFinish(); return; }
    setIdx((i) => Math.min(total - 1, i + 1));
  }, [idx, total, onFinish]);
  const goPrev = useCallback(() => setIdx((i) => Math.max(0, i - 1)), []);

  // ── 键盘: Esc 跳过, ← → 上/下一步 ──
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); goNext(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); goPrev(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, goNext, goPrev]);

  // 进入新步骤把焦点移到卡上 (键盘可达 + 屏幕阅读器跟读)
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => { try { cardRef.current?.focus(); } catch { /* ignore */ } }, 30);
    return () => window.clearTimeout(t);
  }, [open, idx]);

  // ── demo hook: 带 demo 的步骤挂载时通知 host, host 可在真实动作完成时 advance() 自动推进 ──
  useEffect(() => {
    if (!open || !step?.demo || !onDemoMount) return;
    const cleanup = onDemoMount(step.demo, goNext);
    return typeof cleanup === 'function' ? cleanup : undefined;
  }, [open, step, onDemoMount, goNext]);

  if (!open || !step) return null;

  // ── 计算 coach 卡位置 + 实际 placement (越界翻转) ──
  const layout = computeCardLayout(anchorRect, step.placement, isMobile);

  const titleTxt = step.title[lang];
  const bodyTxt = step.body[lang];

  const overlay = (
    <div
      className={
        'ob-root ob-theme-' + theme
        + (isMobile ? ' ob-mobile' : '')
        + (reduceMotion ? ' ob-reduce' : '')
      }
      role="dialog"
      aria-modal="true"
      aria-label={lang === 'zh' ? '新手引导' : 'Onboarding guide'}
    >
      {/* 背景遮罩 + 聚光灯 cutout. 有 anchor → 用 4 块挖空洞 (box-shadow 法对滚动更稳, 这里用 clip 思路: 中间洞透出, 四周暗) */}
      {anchorRect ? (
        <Spotlight rect={anchorRect} />
      ) : (
        // 无 anchor: 整屏暗背景. 不再"点空白就退出"(用户反馈误触退出); 退出走 跳过/X/Esc.
        <div className="ob-backdrop ob-backdrop-full" />
      )}

      {/* demo 视觉提示: anchor 旁脉冲手势 / 箭头 (纯引导, 不劫持事件) */}
      {step.demo && anchorRect && (
        <DemoHint demo={step.demo} rect={anchorRect} lang={lang} />
      )}

      {/* coach 卡 */}
      <div
        ref={cardRef}
        className={'ob-card ob-place-' + layout.placement}
        style={layout.style}
        tabIndex={-1}
        // 阻止冒泡到 backdrop (点卡片不应关闭)
        onClick={(e) => e.stopPropagation()}
      >
        {/* 小三角箭头指向 anchor (居中弹窗无 anchor 时隐藏) */}
        {anchorRect && layout.placement !== 'center' && (
          <span className={'ob-arrow ob-arrow-' + layout.placement} aria-hidden style={layout.arrowStyle} />
        )}

        <button className="ob-x" onClick={onClose} aria-label={T.skip[lang]} type="button">
          <XIcon />
        </button>

        <div className="ob-card-head">
          <h3 className="ob-title">{titleTxt}</h3>
        </div>

        {/* body 支持 \n 换行 */}
        <div className="ob-body">
          {bodyTxt.split('\n').map((line, i) => (
            line.trim() === ''
              ? <div key={i} className="ob-body-gap" />
              : <p key={i} className="ob-body-line">{line}</p>
          ))}
        </div>

        {/* demo 步骤: 「试试看」affordance + 提示 (永不困住, 仍可下一步) */}
        {step.demo && (
          <div className="ob-demo-cta">
            <span className="ob-demo-pulse" aria-hidden>👆</span>
            <span className="ob-demo-text">{T.tryHint[lang]}</span>
          </div>
        )}

        <div className="ob-foot">
          <div className="ob-dots" aria-label={`${idx + 1} / ${total}`}>
            <span className="ob-dots-num">{idx + 1} / {total}</span>
            <span className="ob-dots-row" aria-hidden>
              {activeSteps.map((s, i) => (
                <i key={s.id} className={'ob-dot' + (i === idx ? ' is-active' : i < idx ? ' is-done' : '')} />
              ))}
            </span>
          </div>

          <div className="ob-btns">
            <button className="ob-btn ob-btn-ghost" onClick={onClose} type="button">{T.skip[lang]}</button>
            {!isFirst && (
              <button className="ob-btn" onClick={goPrev} type="button">{T.prev[lang]}</button>
            )}
            <button className="ob-btn ob-btn-primary" onClick={goNext} type="button">
              {isLast ? T.done[lang] : T.next[lang]}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}

// ============================================================
// 聚光灯 — 用 4 块半透明遮罩拼出「中间镂空」(避开 anchor 区), 比单个 box-shadow 在多滚动容器下更稳;
// 镂空区描个发光边框. 点 4 块遮罩任意处 = 跳过 (但镂空区本身可穿透到底层真实 UI, 不拦事件).
// ============================================================
function Spotlight({ rect }: { rect: Rect }): React.JSX.Element {
  const x = Math.max(0, rect.left - SPOTLIGHT_PAD);
  const y = Math.max(0, rect.top - SPOTLIGHT_PAD);
  const w = rect.width + SPOTLIGHT_PAD * 2;
  const h = rect.height + SPOTLIGHT_PAD * 2;
  // 4 块遮罩只「变暗 + 拦住高亮区外的点击」, 不再"点一下就退出引导"(用户反馈误触退出).
  // 退出走 跳过 / X / Esc. 镂空区本身无遮罩 + ring pointer-events:none → 底层真实 UI 可点 (demo「真去做」能命中).
  return (
    <>
      {/* 上 */}
      <div className="ob-backdrop" style={{ top: 0, left: 0, right: 0, height: y }} />
      {/* 下 */}
      <div className="ob-backdrop" style={{ top: y + h, left: 0, right: 0, bottom: 0 }} />
      {/* 左 */}
      <div className="ob-backdrop" style={{ top: y, left: 0, width: x, height: h }} />
      {/* 右 */}
      <div className="ob-backdrop" style={{ top: y, left: x + w, right: 0, height: h }} />
      {/* 镂空区描边 (pointer-events:none, 不拦真实 UI 交互 → demo 「真去拖」时能点到底层) */}
      <div className="ob-spotlight-ring" style={{ top: y, left: x, width: w, height: h }} aria-hidden />
    </>
  );
}

// ============================================================
// demo 视觉提示 — anchor 旁的脉冲手势 + 动作文字 (纯视觉, 不绑真实事件; 真实推进靠 onDemoMount 或手动 Next)
// ============================================================
function DemoHint({ demo, rect, lang }: { demo: NonNullable<OnboardingStep['demo']>; rect: Rect; lang: 'zh' | 'en' }): React.JSX.Element {
  const meta: Record<NonNullable<OnboardingStep['demo']>, { icon: string; zh: string; en: string; cls: string }> = {
    'drag-layer': { icon: '✋', zh: '左右拖动', en: 'drag', cls: 'ob-demo-drag' },
    'click-motion': { icon: '👆', zh: '点这里', en: 'click', cls: 'ob-demo-click' },
    'add-combo': { icon: '👆', zh: '点一个', en: 'click one', cls: 'ob-demo-click' },
  };
  const m = meta[demo];
  // 点击类: 手势挪到「框(含 pad)底部」下方, 指尖朝上对准框底 (用户反馈: 别停在框中间);
  // 拖动类: 留在框中心 (左右晃, 中心最直观).
  const isDrag = demo === 'drag-layer';
  const cx = rect.left + rect.width / 2;
  const cy = isDrag ? (rect.top + rect.height / 2) : (rect.top + rect.height + SPOTLIGHT_PAD);
  return (
    <div className={'ob-demo-hint ' + m.cls} style={{ left: cx, top: cy, transform: isDrag ? undefined : 'translate(-50%, 0)' }} aria-hidden>
      <span className="ob-demo-hand">{m.icon}</span>
      <span className="ob-demo-tip">{lang === 'zh' ? m.zh : m.en}</span>
    </div>
  );
}

// ============================================================
// 内联 X 图标 (不依赖 lucide, 保持 onboarding 自包含)
// ============================================================
function XIcon(): React.JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

// ============================================================
// coach 卡布局算法 — 返回 placement (越界翻转) + 卡 style + 箭头 style
//   无 anchor / center → 居中; 移动端一律底部 sheet (full width)
// ============================================================
function computeCardLayout(
  rect: Rect | null,
  preferred: Placement | undefined,
  isMobile: boolean,
): { placement: Placement; style: React.CSSProperties; arrowStyle: React.CSSProperties } {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;

  // 移动端: 底部 sheet (全宽), 但仍保留聚光灯高亮 anchor
  if (isMobile) {
    return {
      placement: 'center',  // 视觉走 sheet, css 用 .ob-mobile 控制
      style: {},            // 位置全交给 css (fixed bottom)
      arrowStyle: {},
    };
  }

  // 无 anchor 或显式 center → 居中
  if (!rect || preferred === 'center') {
    return {
      placement: 'center',
      style: { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' },
      arrowStyle: {},
    };
  }

  // 估算卡高度 (内容多变, 用经验值; 越界翻转用得到). 实际渲染后浏览器自适应, 这里仅做翻转决策.
  const cardH = 250;
  const cardW = CARD_W;

  const spaceTop = rect.top;
  const spaceBottom = vh - (rect.top + rect.height);
  const spaceLeft = rect.left;
  const spaceRight = vw - (rect.left + rect.width);

  // 决定最终 placement: 先用 preferred, 放不下就翻到对侧/空间最大侧
  let place: Placement = preferred ?? 'bottom';
  const fits = (p: Placement): boolean => {
    if (p === 'bottom') return spaceBottom >= cardH + CARD_GAP;
    if (p === 'top') return spaceTop >= cardH + CARD_GAP;
    if (p === 'left') return spaceLeft >= cardW + CARD_GAP;
    if (p === 'right') return spaceRight >= cardW + CARD_GAP;
    return true;
  };
  if (!fits(place)) {
    // 翻到对侧, 还不行就挑空间最大的方向
    const opposite: Record<Placement, Placement> = {
      top: 'bottom', bottom: 'top', left: 'right', right: 'left', center: 'center',
    };
    if (fits(opposite[place])) {
      place = opposite[place];
    } else {
      const cands: { p: Placement; s: number }[] = [
        { p: 'bottom', s: spaceBottom }, { p: 'top', s: spaceTop },
        { p: 'right', s: spaceRight }, { p: 'left', s: spaceLeft },
      ];
      cands.sort((a, b) => b.s - a.s);
      place = cands[0].p;
    }
  }

  // 根据 placement 算卡左上角坐标 (再 clamp 进视口)
  let left: number;
  let top: number;
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  if (place === 'bottom') { left = cx - cardW / 2; top = rect.top + rect.height + CARD_GAP; }
  else if (place === 'top') { left = cx - cardW / 2; top = rect.top - cardH - CARD_GAP; }
  else if (place === 'right') {
    // 卡放 anchor 右侧; anchor 在左栏面板内时放到「面板右缘」之外 → 不遮挡面板内容 (用户要点的 combo/列表)
    left = Math.max(rect.left + rect.width + CARD_GAP, (rect.panelRight ?? 0) + CARD_GAP);
    top = cy - cardH / 2;
  }
  else { left = rect.left - cardW - CARD_GAP; top = cy - cardH / 2; } // left

  // clamp 进视口 (留 margin), 记录夹了多少 → 箭头补偿对准 anchor
  const clampedLeft = clampNum(left, VIEWPORT_MARGIN, vw - cardW - VIEWPORT_MARGIN);
  const clampedTop = clampNum(top, VIEWPORT_MARGIN, vh - cardH - VIEWPORT_MARGIN);

  // 箭头: 在卡的 anchor 侧, 指向 anchor 中心. top/bottom → 调 left; left/right → 调 top.
  const arrowStyle: React.CSSProperties = {};
  if (place === 'top' || place === 'bottom') {
    const ax = clampNum(cx - clampedLeft, 18, cardW - 18);
    arrowStyle.left = ax;
  } else {
    const ay = clampNum(cy - clampedTop, 18, cardH - 18);
    arrowStyle.top = ay;
  }

  return {
    placement: place,
    style: { left: clampedLeft, top: clampedTop, width: cardW },
    arrowStyle,
  };
}

function clampNum(v: number, lo: number, hi: number): number {
  if (hi < lo) return lo;
  return Math.min(hi, Math.max(lo, v));
}
