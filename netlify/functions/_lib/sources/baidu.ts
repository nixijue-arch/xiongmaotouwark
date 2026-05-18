// 百度图片适配器 — acjson 半公开 JSON API
// 接口: https://image.baidu.com/search/acjson?tn=resultjson_com&word=...&pn=...&rn=30
// 实测稳定 (2026-05-17), 但反爬偶尔触发. UA + Referer 严格伪装.

import { fetchWithTimeout } from '../fetchWithTimeout';
import type { SearchResultItem, SourceAdapter } from '../types';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// 百度图片 CDN 域名 (proxy-image 白名单也要加这些)
const TRUSTED_HOSTS = [
  'gimg2.baidu.com',
  'gimg3.baidu.com',
  'gimg0.baidu.com',
  'gimg1.baidu.com',
  'img0.baidu.com',
  'img1.baidu.com',
  'img2.baidu.com',
  't7.baidu.com',
  't9.baidu.com',
  't10.baidu.com',
  't11.baidu.com',
  't12.baidu.com',
];

function djb2Hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) + s.charCodeAt(i);
    h = h | 0;
  }
  return Math.abs(h).toString(36);
}

interface BaiduItem {
  thumbURL?: unknown;
  hoverURL?: unknown;
  middleURL?: unknown;
  objURL?: unknown;
  width?: unknown;
  height?: unknown;
  fromPageTitle?: unknown;
  fromPageTitleEnc?: unknown;
}
interface BaiduResp {
  data?: unknown;
}

function pickFirstTrustedUrl(item: BaiduItem): string | null {
  const candidates = [item.thumbURL, item.middleURL, item.hoverURL];
  for (const c of candidates) {
    if (typeof c !== 'string' || !c) continue;
    if (!c.startsWith('http')) continue;
    try {
      const u = new URL(c);
      if (TRUSTED_HOSTS.includes(u.hostname)) return c;
    } catch { /* skip malformed */ }
  }
  return null;
}

async function search(query: string, page = 0): Promise<SearchResultItem[]> {
  const pn = page * 50;
  const wordEnc = encodeURIComponent(query);
  // tab='&qc=&nc=1&fr=&expermode=&force=' 这些参数固定即可, 百度 acjson 容错
  const url =
    `https://image.baidu.com/search/acjson?tn=resultjson_com&logid=&ipn=rj&ct=201326592` +
    `&fp=result&queryWord=${wordEnc}&cl=2&lm=-1&ie=utf-8&oe=utf-8` +
    `&word=${wordEnc}&face=0&istype=2&nc=1&pn=${pn}&rn=50`;

  const res = await fetchWithTimeout(url, {
    headers: {
      'User-Agent': UA,
      'Referer': 'https://image.baidu.com/',
      'Accept': 'application/json,text/plain,*/*',
      'Accept-Language': 'zh-CN,zh;q=0.9',
    },
    timeoutMs: 6000,
  });
  if (!res.ok) throw new Error(`baidu HTTP ${res.status}`);

  // 百度返回有时带 BOM 或注释, 尝试容错 parse
  const text = await res.text();
  let json: BaiduResp;
  try {
    json = JSON.parse(text) as BaiduResp;
  } catch {
    // 兜底: 修剪非法尾部尝试再解析
    const trimmed = text.replace(/[﻿]/g, '').trim();
    try {
      json = JSON.parse(trimmed) as BaiduResp;
    } catch (e) {
      throw new Error(`baidu json parse: ${(e as Error).message}`);
    }
  }
  const list = Array.isArray(json.data) ? (json.data as BaiduItem[]) : [];
  if (list.length === 0) return [];

  const items: SearchResultItem[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const url = pickFirstTrustedUrl(raw);
    if (!url) continue;
    const w = typeof raw.width === 'number' ? raw.width : undefined;
    const h = typeof raw.height === 'number' ? raw.height : undefined;
    const titleRaw = raw.fromPageTitle;
    const hint = typeof titleRaw === 'string' ? titleRaw.replace(/<[^>]+>/g, '').slice(0, 60) : undefined;
    items.push({
      id: `baidu:${djb2Hash(url)}`,
      src: url,
      thumb: url,
      source: 'baidu',
      w,
      h,
      hint,
    });
  }
  return items;
}

export const baiduAdapter: SourceAdapter = {
  name: 'baidu',
  weight: 0.85,
  // 2026-05-17 重启: 之前 disable 因为 page title 不可靠混入非 panda 图,
  // 现在前端加 detectColorfulness 视觉过滤 (黑白二值梗图 vs 彩色照片),
  // 重启 baidu 提供海量候选 (90+ 张/页), 视觉过滤后保留干净结果.
  enabled: () => true,
  search,
};
