// 搜狗图片适配器 — pic.sogou.com 半公开 JSON API
// 接口: https://pic.sogou.com/napi/pc/searchList?query=...&start=0&xml_len=15
//   返回 JSON, 含 items[] 数组
//   关键字段: items[].picUrl / items[].thumbUrl / items[].title

import { fetchWithTimeout } from '../fetchWithTimeout';
import type { SearchResultItem, SourceAdapter } from '../types';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// 搜狗图片 CDN 域名 (proxy-image 白名单要加)
const TRUSTED_HOSTS = [
  'pic.sogoucdn.com',
  'img.sogoucdn.com',
  'i01piccdn.sogoucdn.com',
  'i02piccdn.sogoucdn.com',
  'i03piccdn.sogoucdn.com',
  'i04piccdn.sogoucdn.com',
];

function djb2Hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) + s.charCodeAt(i);
    h = h | 0;
  }
  return Math.abs(h).toString(36);
}

interface SogouItem {
  picUrl?: unknown;
  thumbUrl?: unknown;
  oriPicUrl?: unknown;
  title?: unknown;
  title_main?: unknown;
  width?: unknown;
  height?: unknown;
  picUrl_xxl?: unknown;
}

function pickUrl(item: SogouItem): string | null {
  const candidates = [item.thumbUrl, item.picUrl, item.oriPicUrl, item.picUrl_xxl];
  for (const c of candidates) {
    if (typeof c !== 'string' || !c) continue;
    if (!c.startsWith('http')) continue;
    try {
      const u = new URL(c);
      if (TRUSTED_HOSTS.includes(u.hostname)) return c;
    } catch { /* skip */ }
  }
  return null;
}

// 在响应里挖 items 数组 — sogou 不同 endpoint shape 不同, 多层兼容
function extractItems(json: unknown): SogouItem[] {
  if (!json || typeof json !== 'object') return [];
  const obj = json as Record<string, unknown>;
  // shape 1: { data: { items: [...] } }
  const data = obj.data as Record<string, unknown> | undefined;
  if (data && Array.isArray(data.items)) return data.items as SogouItem[];
  // shape 2: { data: [...] }
  if (Array.isArray(obj.data)) return obj.data as SogouItem[];
  // shape 3: { items: [...] }
  if (Array.isArray(obj.items)) return obj.items as SogouItem[];
  // shape 4: { result: { items: [...] } }
  const result = obj.result as Record<string, unknown> | undefined;
  if (result && Array.isArray(result.items)) return result.items as SogouItem[];
  return [];
}

// 备用 endpoints — 真接口 sogou 偶尔轮换 / 不同入口结构不同
function buildEndpoints(query: string, start: number): string[] {
  const q = encodeURIComponent(query);
  return [
    // 主 endpoint (web 入口 - 实测 shape 多变)
    `https://pic.sogou.com/napi/pc/searchList?mode=1&start=${start}&xml_len=48&query=${q}&reqFrom=searchindex`,
    // 备用 1: 老 napi
    `https://pic.sogou.com/napi/searchList?mode=1&start=${start}&xml_len=48&query=${q}`,
    // 备用 2: ws JSON endpoint
    `https://pic.sogou.com/pic/searchList.jsp?mode=1&start=${start}&xml_len=48&query=${q}`,
  ];
}

async function search(query: string, page = 0): Promise<SearchResultItem[]> {
  const start = page * 48;
  const endpoints = buildEndpoints(query, start);

  let lastErr: Error | null = null;
  for (const url of endpoints) {
    try {
      const res = await fetchWithTimeout(url, {
        headers: {
          'User-Agent': UA,
          'Referer': 'https://pic.sogou.com/',
          'Accept': 'application/json,text/plain,*/*',
          'Accept-Language': 'zh-CN,zh;q=0.9',
        },
        timeoutMs: 5000,
      });
      if (!res.ok) {
        lastErr = new Error(`sogou HTTP ${res.status}`);
        continue;
      }
      const text = await res.text();
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        // 不是 JSON, 尝试下个 endpoint
        lastErr = new Error('sogou non-json');
        continue;
      }
      const list = extractItems(json);
      if (list.length === 0) {
        lastErr = new Error('sogou empty');
        continue;
      }

      const items: SearchResultItem[] = [];
      for (const raw of list) {
        if (!raw || typeof raw !== 'object') continue;
        const u = pickUrl(raw);
        if (!u) continue;
        const w = typeof raw.width === 'number' ? raw.width : undefined;
        const h = typeof raw.height === 'number' ? raw.height : undefined;
        const titleRaw = (raw.title_main as string | undefined) || (raw.title as string | undefined);
        const hint = typeof titleRaw === 'string'
          ? titleRaw.replace(/<[^>]+>/g, '').slice(0, 60)
          : undefined;
        items.push({
          id: `sogou:${djb2Hash(u)}`,
          src: u,
          thumb: u,
          source: 'sogou',
          w,
          h,
          hint,
        });
      }
      if (items.length > 0) return items;
    } catch (e) {
      lastErr = e as Error;
    }
  }
  if (lastErr) throw lastErr;
  return [];
}

export const sogouAdapter: SourceAdapter = {
  name: 'sogou',
  weight: 0.85,
  enabled: () => true,
  search,
};
