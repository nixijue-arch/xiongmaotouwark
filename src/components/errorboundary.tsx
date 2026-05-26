import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props { children: ReactNode }
interface State { error: Error | null }

// 顶层错误边界 — 渲染期抛错时显示可用兜底 (刷新 / 回首页), 而不是整页白屏.
// 动机: 一次 TDZ / 渲染崩溃曾让整个 app 白屏 (build/tsc 测不到的运行时错误). 生产端用户尤其需要兜底,
//   否则任何未捕获渲染错误 = xiongmaotou.work 直接白屏. DEV 下额外显示 message/stack 方便定位.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary] 渲染崩溃:', error, info.componentStack);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 16, padding: 24, textAlign: 'center', fontFamily: 'system-ui, sans-serif', color: '#1e293b', background: '#f8fafc',
      }}>
        <div style={{ fontSize: 48 }}>😵</div>
        <div style={{ fontSize: 18, fontWeight: 700 }}>页面出了点小问题</div>
        <div style={{ fontSize: 13, color: '#64748b', maxWidth: 360 }}>
          已经记录这个错误。刷新一般就能恢复，作品草稿已自动保存在本地不会丢。
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button type="button" onClick={() => location.reload()}
            style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: '#2563eb', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>
            刷新重试
          </button>
          <button type="button" onClick={() => { location.href = '/'; }}
            style={{ padding: '8px 18px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff', color: '#334155', fontWeight: 600, cursor: 'pointer' }}>
            回首页
          </button>
        </div>
        {import.meta.env.DEV && (
          <pre style={{
            marginTop: 12, maxWidth: '90vw', maxHeight: '40vh', overflow: 'auto', textAlign: 'left',
            fontSize: 11, color: '#b91c1c', background: '#fff1f2', padding: 12, borderRadius: 8, border: '1px solid #fecaca',
          }}>{this.state.error.message}{'\n\n'}{this.state.error.stack}</pre>
        )}
      </div>
    );
  }
}
