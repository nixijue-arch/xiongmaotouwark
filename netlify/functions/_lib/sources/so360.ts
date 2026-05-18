// 360 图片搜索适配器 — image.so.com 半公开 JSON API
// 接口: https://image.so.com/j?q=X&pn=37&sn=offset
//   返 JSON: { total, list: [{ thumb, img, title, width, height, source }] }
//   每页 37 张, thumb 走 p1-p5.ssl.qhimgs1/2.com CDN (有 SSL, 稳定 hot link)
// 2026-05-17 加入 — duitang+baidu 之外的第 3 个稳定源, total 通常 100-1500 张/query

import { fetchWithTimeout } from '../fetchWithTimeout';
import type { SearchResultItem, SourceAdapter } from '../types';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// 360 image CDN 域名 — thumb 全走这些 host, proxy 白名单也要加
const TRUSTED_HOSTS = [
  'p0.ssl.qhimgs1.com',
  'p1.ssl.qhimgs1.com',
  'p2.ssl.qhimgs1.com',
  'p3.ssl.qhimgs1.com',
  'p4.ssl.qhimgs1.com',
  'p5.ssl.qhimgs1.com',
  'p0.ssl.qhimgs2.com',
  'p1.ssl.qhimgs2.com',
  'p2.ssl.qhimgs2.com',
  'p3.ssl.qhimgs2.com',
  'p4.ssl.qhimgs2.com',
  'p5.ssl.qhimgs2.com',
  'p0.ssl.qhmsg.com',
  'p1.ssl.qhmsg.com',
];

function djb2Hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) + s.charCodeAt(i);
    h = h | 0;
  }
  return Math.abs(h).toString(36);
}

interface So360Item {
  thumb?: unknown;
  img?: unknown;
  title?: unknown;
  litetitle?: unknown;
  width?: unknown;
  height?: unknown;
}
interface So360Resp {
  total?: unknown;
  list?: unknown;
}

function pickTrustedThumb(item: So360Item): string | null {
  const thumb = item.thumb;
  if (typeof thumb !== 'string' || !thumb) return null;
  if (!thumb.startsWith('http')) return null;
  try {
    const u = new URL(thumb);
    if (TRUSTED_HOSTS.includes(u.hostname)) return thumb;
  } catch { /* skip */ }
  return null;
}

async function search(query: string, page = 0): Promise<SearchResultItem[]> {
  // 每页 37 张 (实测固定 list 长度)
  const sn = page * 37;
  const url = `https://image.so.com/j?q=${encodeURIComponent(query)}&pn=37&sn=${sn}`;

  const res = await fetchWithTimeout(url, {
    headers: {
      'User-Agent': UA,
      'Referer': 'https://image.so.com/',
      'Accept': 'application/json,text/plain,*/*',
      'Accept-Language': 'zh-CN,zh;q=0.9',
    },
    timeoutMs: 5000,
  });
  if (!res.ok) throw new Error(`so360 HTTP ${res.status}`);

  const json = (await res.json()) as So360Resp;
  const list = Array.isArray(json.list) ? (json.list as So360Item[]) : [];
  if (list.length === 0) return [];

  const items: SearchResultItem[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const thumb = pickTrustedThumb(raw);
    if (!thumb) continue;
    const w = typeof raw.width === 'number' ? raw.width : undefined;
    const h = typeof raw.height === 'number' ? raw.height : undefined;
    const titleRaw = (raw.title as string | undefined) || (raw.litetitle as string | undefined);
    const hint = typeof titleRaw === 'string'
      ? titleRaw.replace(/<[^>]+>/g, '').slice(0, 60)
      : undefined;
    items.push({
      id: `so360:${djb2Hash(thumb)}`,
      src: thumb,
      thumb,
      source: 'so360',
      w,
      h,
      hint,
    });
  }
  return items;
}

export const so360Adapter: SourceAdapter = {
  name: 'so360',
  weight: 0.9,
  enabled: () => true,
  search,
};
