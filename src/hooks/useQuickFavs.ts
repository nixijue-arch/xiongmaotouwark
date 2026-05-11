// QuickMode favorites — localStorage 持久化（contributed by PandaHead）
// 未来 Collection page 读 STORAGE_KEY 同款 schema 渲染 polaroid 墙

import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'pmw-quick-favs';

export interface QuickFav {
  id: string;                 // `${pandaId}|${faceId}|${text}|${fontFamily}` 作 dedup key
  pandaId: string;
  faceId: string;
  text: string;
  fontFamily: string;
  ts: number;                 // unix ms
  name?: string;              // 用户改名（可空）
  // v2: 用户上传/智能提取的素材没在 ALL_PANDAS/ALL_FACES 池里
  // 存 src dataURL 防 Collection 显示"素材丢失"
  pandaSrc?: string;
  faceSrc?: string;
  pandaFaceOffset?: { x: number; y: number; w: number; h: number };
}

export type QuickFavMap = Record<string, QuickFav>;

function loadFavs(): QuickFavMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as QuickFavMap;
  } catch { /* ignore */ }
  return {};
}

export function makeFavKey(pandaId: string, faceId: string, text: string, fontFamily: string) {
  return `${pandaId}|${faceId}|${text}|${fontFamily}`;
}

export function useQuickFavs() {
  const [favs, setFavs] = useState<QuickFavMap>(() => loadFavs());

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(favs)); } catch { /* ignore */ }
  }, [favs]);

  const isFav = useCallback((id: string) => Boolean(favs[id]), [favs]);

  const toggle = useCallback((fav: Omit<QuickFav, 'ts'>) => {
    setFavs((m) => {
      const next = { ...m };
      if (next[fav.id]) delete next[fav.id];
      else next[fav.id] = { ...fav, ts: Date.now() };
      return next;
    });
  }, []);

  const remove = useCallback((id: string) => {
    setFavs((m) => {
      const next = { ...m };
      delete next[id];
      return next;
    });
  }, []);

  const rename = useCallback((id: string, name: string) => {
    setFavs((m) => (m[id] ? { ...m, [id]: { ...m[id], name } } : m));
  }, []);

  return { favs, isFav, toggle, remove, rename };
}
