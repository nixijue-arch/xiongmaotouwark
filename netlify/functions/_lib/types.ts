// 联网搜熊猫头表情包 — 共享类型
// 前后端都用 (前端 import 用相对 + 复制类型 / 后端 .mts 入口 import 这里)

export type SourceName = 'duitang' | 'fabiaoqing' | 'bing' | 'baidu' | 'sogou';

export interface SearchResultItem {
  id: string;       // `${source}:${hash(url)}` 全局唯一
  src: string;      // 原图 URL
  thumb: string;    // 缩略图 URL (源给则用, 否则 = src)
  source: SourceName;
  w?: number;
  h?: number;
  hint?: string;    // 源给的 alt/caption, 用于过滤评分
  _score?: number;  // 内部排序用, 不返前端 (返时已被排好序)
}

export interface SourceAdapter {
  name: SourceName;
  weight: number;
  enabled: () => boolean;
  search: (query: string, page: number) => Promise<SearchResultItem[]>;
}

export interface SearchResponse {
  items: SearchResultItem[];
  total: number;
  hasMore: boolean;
  nextPage: number;
  sources: Record<string, { ok: boolean; took: number; count: number; error?: string }>;
  hint?: 'all_sources_failed' | 'partial';
}

export interface ExpansionPlan {
  duitangQueries: string[];
  fabiaoqingQueries: string[];
  baiduQueries?: string[];
  sogouQueries?: string[];
  bingQueries?: string[];
}
