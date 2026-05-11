// useLiveAnchor — 让 QuickMode/Collection 在校准工具改 anchor 时自动 re-render
// DEV-only 监听 'pmw-anchor-changed' event；prod 是 no-op
//
// Contributed by PandaHead

import { useEffect, useState } from 'react';
import { ANCHOR_CHANGED_EVENT } from '@/lib/anchorOverrides';

export function useLiveAnchor(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const handler = () => setTick((n) => n + 1);
    window.addEventListener(ANCHOR_CHANGED_EVENT, handler);
    // 跨 tab（同 origin）也同步：监听 storage event
    const storageHandler = (e: StorageEvent) => {
      if (e.key === 'pmw-anchor-overrides-v1') setTick((n) => n + 1);
    };
    window.addEventListener('storage', storageHandler);
    return () => {
      window.removeEventListener(ANCHOR_CHANGED_EVENT, handler);
      window.removeEventListener('storage', storageHandler);
    };
  }, []);
  return tick;
}
