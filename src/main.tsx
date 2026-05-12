import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import App from './app.tsx'

// visualViewport-based 真实可见 viewport 高度同步 — 标准解法适配 iOS Safari / iOS Chrome / Android
// 100dvh 在 iOS Chrome 不正确反映底部 native tab bar 占据的空间 → content overflow
// visualViewport.height 是浏览器报的"实际可视"高度 (含所有 chrome 调整后), 写到 --visual-vh CSS var
// 让 .app-shell { height: var(--visual-vh) } 真正适配真机
if (typeof window !== 'undefined') {
  const updateVisualVh = () => {
    const vv = window.visualViewport;
    const h = vv ? vv.height : window.innerHeight;
    document.documentElement.style.setProperty('--visual-vh', `${h}px`);
  };
  updateVisualVh();
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', updateVisualVh);
    window.visualViewport.addEventListener('scroll', updateVisualVh);
  } else {
    window.addEventListener('resize', updateVisualVh);
    window.addEventListener('orientationchange', updateVisualVh);
  }
}

// DEV-only 错误捕获 overlay — 用户/手机端真机 debug 用; prod build (import.meta.env.DEV=false) 被 tree-shake
// 默认 silent, 只在抛 Error / unhandledrejection 时显示红条; 不再有 always-visible boot 信息条
if (typeof window !== 'undefined' && import.meta.env.DEV) {
  const showErr = (label: string, msg: string, stack?: string) => {
    try {
      let el = document.getElementById('_xmw_errbox');
      if (!el) {
        el = document.createElement('div');
        el.id = '_xmw_errbox';
        el.style.cssText =
          'position:fixed;top:0;left:0;right:0;z-index:99999;background:#fee;color:#900;padding:10px 12px;font:12px ui-monospace,Menlo,monospace;white-space:pre-wrap;max-height:60vh;overflow:auto;border-bottom:3px solid #c00;line-height:1.45;';
        document.body.appendChild(el);
      }
      el.textContent = (el.textContent || '') + `[${label}] ${msg}${stack ? '\n' + stack : ''}\n\n`;
    } catch {
      /* nothing more we can do */
    }
  };
  window.addEventListener('error', (e) => {
    showErr('Error', e.message || 'unknown error', e.error?.stack);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const reason: any = e.reason;
    showErr('Promise rejection', String(reason?.message || reason), reason?.stack);
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
