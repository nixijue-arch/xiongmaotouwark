// PandaCanvas — React wrapper of composeMeme
// 替换 <img panda /> + <img face /> 双 overlay 方案
// 用 canvas 合成 + 白色 mask 裁 face → 解决 face 白边遮 panda 黑廓 + 超出 shell 区
//
// Contributed by PandaHead (https://pandahead.fun · github.com/jokkibtc/panda)

import { Component, useEffect, useRef, useState, type ReactNode } from 'react';
import { composeMeme } from '@/lib/composeMeme';
import { useLiveAnchor } from '@/hooks/useLiveAnchor';

interface Props {
  pandaSrc: string;
  pandaId?: string; // DEV: 传了的话，PandaCanvas 内部 DEV-only 读 localStorage override 兜底（不依赖调用方）
  faceSrc: string;
  faceOffset: { x: number; y: number; w: number; h: number };
  rotation?: number;
  flipX?: boolean;
  size?: number; // canvas resolution, default 1024 for export quality (display via CSS)
  faceFill?: number; // face content bbox 占 anchor 的比例，校准工具用
  className?: string;
  style?: React.CSSProperties;
  alt?: string;
  draggable?: boolean;
  onRendered?: (info: { naturalW: number; naturalH: number }) => void;
}

interface Rendered {
  key: string;
  url: string;
  naturalW: number;
  naturalH: number;
}

// DEV-only: 读 localStorage anchor override（pandaId 模式）兜底
// 即使调用方传了过期的 faceOffset，PandaCanvas 内部也会用 localStorage 最新值覆盖
function getEffectiveOffset(props: Props): { x: number; y: number; w: number; h: number } {
  if (import.meta.env.DEV && props.pandaId) {
    try {
      const stored = JSON.parse(localStorage.getItem('pmw-anchor-overrides-v1') || '{}');
      const ov = stored[props.pandaId];
      if (ov?.faceOffset) return ov.faceOffset;
    } catch {
      /* ignore */
    }
  }
  return props.faceOffset;
}

function getEffectiveFaceFill(props: Props): number | undefined {
  if (import.meta.env.DEV && props.pandaId) {
    try {
      const stored = JSON.parse(localStorage.getItem('pmw-anchor-overrides-v1') || '{}');
      const ov = stored[props.pandaId];
      if (typeof ov?.faceFill === 'number') return ov.faceFill;
    } catch {
      /* ignore */
    }
  }
  return props.faceFill;
}

function makeKey(p: Props, eff: { x: number; y: number; w: number; h: number }, faceFill: number): string {
  return [p.pandaSrc, p.faceSrc, eff.x, eff.y, eff.w, eff.h, p.rotation ?? 0, p.flipX ? 1 : 0, p.size ?? 1024, faceFill].join('|');
}

// ErrorBoundary 防 PandaCanvas 内部任何 throw 把整页搞白屏
class PandaCanvasBoundary extends Component<{ children: ReactNode; pandaId?: string }, { err: Error | null }> {
  state: { err: Error | null } = { err: null };
  static getDerivedStateFromError(err: Error) { return { err }; }
  componentDidCatch(err: Error, info: { componentStack?: string | null }) {
    // eslint-disable-next-line no-console
    console.error('[PandaCanvas error]', this.props.pandaId, err, info.componentStack);
  }
  render() {
    if (this.state.err) {
      return (
        <div style={{ width: '100%', height: '100%', minHeight: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fee', color: '#c00', fontSize: 11, padding: 8, textAlign: 'center', borderRadius: 4 }}>
          合成失败：{this.state.err.message}
        </div>
      );
    }
    return this.props.children;
  }
}

export function PandaCanvas(props: Props) {
  return (
    <PandaCanvasBoundary pandaId={props.pandaId}>
      <PandaCanvasInner {...props} />
    </PandaCanvasBoundary>
  );
}

function PandaCanvasInner(props: Props) {
  const { className, style, alt, draggable = false, onRendered } = props;
  // DEV: 校准工具改 anchor 后强制本组件 re-render → 重新读 localStorage → makeKey 新值 → useEffect 重 compose
  useLiveAnchor();
  const effectiveOffset = getEffectiveOffset(props);
  const effectiveFill = getEffectiveFaceFill(props) ?? 0.95;
  const [rendered, setRendered] = useState<Rendered>({ key: '', url: '', naturalW: 0, naturalH: 0 });
  const reqRef = useRef<number>(0);
  const targetKey = makeKey(props, effectiveOffset, effectiveFill);

  useEffect(() => {
    const reqId = ++reqRef.current;
    let cancelled = false;
    composeMeme({
      pandaSrc: props.pandaSrc,
      faceSrc: props.faceSrc,
      faceOffset: effectiveOffset,
      rotation: props.rotation,
      flipX: props.flipX,
      size: props.size,
      faceFill: effectiveFill,
    })
      .then((url) => {
        if (cancelled || reqId !== reqRef.current) return;
        setRendered({ key: targetKey, url, naturalW: 0, naturalH: 0 });
      })
      .catch((e) => {
        if (cancelled || reqId !== reqRef.current) return;
        console.error('[PandaCanvas]', e);
      });
    return () => {
      cancelled = true;
    };
  }, [targetKey]);

  // 频闪修法（user 反馈滚轮调 rotation 时频闪）：
  // 去掉 'stale 时 opacity 0.7' 的渐变 — dataURL 是同步可用的，每次 props 变都先 dim 再渐变到 1
  // 用户视觉上就是反复闪。新 url 直接全亮显示。仅首次加载（url 空）保留 0.4 占位
  return (
    <img
      src={rendered.url || undefined}
      alt={alt}
      draggable={draggable}
      className={className}
      // 性能: 让浏览器异步 decode 不阻塞主线程; fetchpriority high 让组合图优先解码
      decoding="async"
      fetchPriority="high"
      onLoad={(e) => {
        const im = e.currentTarget;
        if (onRendered) onRendered({ naturalW: im.naturalWidth, naturalH: im.naturalHeight });
      }}
      style={{
        ...style,
        opacity: rendered.url ? 1 : 0.4,
      }}
    />
  );
}
