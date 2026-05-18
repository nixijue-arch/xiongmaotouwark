// Netlify Function 入口 — 联网搜熊猫头表情包
// 业务逻辑在 ./_lib/handlers.ts (dev plugin 共享同一份)
//
// GET /api/search-pandas?q=开心&page=0&sources=duitang,fabiaoqing
//
// 返回 JSON SearchResponse {
//   items: [{ id, src, thumb, source, w?, h?, hint? }],
//   total, hasMore, nextPage,
//   sources: { duitang: { ok, took, count, error? }, ... },
//   hint?: 'all_sources_failed' | 'partial'
// }
//
// Cache-Control: public, max-age=86400 — Netlify Edge 做主缓存
// in-memory LRU 二级缓存 (热实例期间复用, 冷启重置)

import { handleSearch } from './_lib/handlers';

export default handleSearch;

export const config = { path: '/api/search-pandas' };
