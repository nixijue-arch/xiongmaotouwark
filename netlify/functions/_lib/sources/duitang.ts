// 堆糖 JSON 适配器 (主力图源)
// 实测接口: https://www.duitang.com/napi/blog/list/by_search/?kw=xxx&start=0&limit=24
// 返回 JSON, 关键字段: data.object_list[].photo.{path,width,height}
// CDN 域名: c-ssl.duitang.com / b-ssl.duitang.com / dtstatic.com

import { fetchWithTimeout } from '../fetchWithTimeout';
import type { SearchResultItem, SourceAdapter } from '../types';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const TRUSTED_HOSTS = ['c-ssl.duitang.com', 'b-ssl.duitang.com', 'c1-ssl.duitang.com', 'dtstatic.com'];

function djb2Hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) + s.charCodeAt(i);
    h = h | 0; // force i32
  }
  return Math.abs(h).toString(36);
}

interface DuitangPhoto {
  path?: unknown;
  width?: unknown;
  height?: unknown;
}
interface DuitangItem {
  photo?: DuitangPhoto;
  msg?: unknown;
}
interface DuitangResp {
  status?: unknown;
  data?: { object_list?: unknown };
}

async function search(query: string, page = 0): Promise<SearchResultItem[]> {
  const start = page * 30;
  const url = `https://www.duitang.com/napi/blog/list/by_search/?kw=${encodeURIComponent(query)}&start=${start}&limit=30`;
  const res = await fetchWithTimeout(url, {
    headers: {
      'User-Agent': UA,
      'Referer': 'https://www.duitang.com/',
      'Accept': 'application/json,text/plain,*/*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    },
    timeoutMs: 5000,
  });
  if (!res.ok) throw new Error(`duitang HTTP ${res.status}`);
  const json = (await res.json()) as DuitangResp;
  const list = json?.data?.object_list;
  if (!Array.isArray(list)) return [];

  const items: SearchResultItem[] = [];
  for (const raw of list as DuitangItem[]) {
    const photo = raw?.photo;
    if (!photo) continue;
    const path = typeof photo.path === 'string' ? photo.path : undefined;
    if (!path) continue;
    if (!TRUSTED_HOSTS.some((h) => path.includes(h))) continue;
    const w = typeof photo.width === 'number' ? photo.width : undefined;
    const h = typeof photo.height === 'number' ? photo.height : undefined;
    const hint = typeof raw.msg === 'string' ? raw.msg.slice(0, 60) : undefined;
    items.push({
      id: `duitang:${djb2Hash(path)}`,
      src: path,
      thumb: path,
      source: 'duitang',
      w,
      h,
      hint,
    });
  }
  return items;
}

export const duitangAdapter: SourceAdapter = {
  name: 'duitang',
  weight: 1.0,
  enabled: () => true,
  search,
};
