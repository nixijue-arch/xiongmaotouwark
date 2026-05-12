import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import App from './app.tsx'

// ============================================================
// 移动端诊断 — 黑屏 / 白屏时让 user 在 iOS Safari 上能直接看到错误
// 临时存在; iPhone 联调稳定后可移除
// ============================================================
if (typeof window !== 'undefined') {
  const showErr = (label: string, msg: string, stack?: string) => {
    try {
      let el = document.getElementById('_xmw_errbox');
      if (!el) {
        el = document.createElement('div');
        el.id = '_xmw_errbox';
        el.style.cssText = [
          'position:fixed',
          'top:0', 'left:0', 'right:0',
          'z-index:99999',
          'background:#fee',
          'color:#900',
          'padding:10px 12px',
          'font:12px ui-monospace,Menlo,monospace',
          'white-space:pre-wrap',
          'max-height:60vh',
          'overflow:auto',
          'border-bottom:3px solid #c00',
          'line-height:1.45',
        ].join(';');
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

  // 启动后 2s 显示 viewport + UA + root child count, 8s 后自动消失
  setTimeout(() => {
    try {
      const root = document.getElementById('root');
      const childCount = root?.children.length ?? 0;
      const el = document.createElement('div');
      el.style.cssText = [
        'position:fixed',
        'bottom:0', 'left:0', 'right:0',
        'z-index:99998',
        'background:rgba(34,34,34,0.88)',
        'color:#ffe',
        'padding:6px 10px',
        'font:10px ui-monospace,Menlo,monospace',
        'line-height:1.4',
      ].join(';');
      el.textContent = `[xmw boot] ${window.innerWidth}x${window.innerHeight} • root.children=${childCount} • dvh=${(typeof CSS !== 'undefined' && CSS.supports?.('height: 100dvh')) ? 'OK' : 'NO'} • UA=${navigator.userAgent.slice(0, 90)}`;
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 8000);
    } catch {
      /* ignore */
    }
  }, 2000);

  // eslint-disable-next-line no-console
  console.log('[xmw] main.tsx loaded, UA:', navigator.userAgent);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
