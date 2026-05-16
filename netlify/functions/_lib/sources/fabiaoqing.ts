// 发表情 HTML 爬适配器 (副力图源)
// 实测接口: https://fabiaoqing.com/search/bqb/keyword/{q}/page/{N}.html (N 从 1 开始)
// 返回 HTML, 用 regex 提取 <img data-src/data-original/src="...">
//
// 已知坑:
// - WebFetch 看到的版本有 lazy-load placeholder (transparent.gif), 真实 HTTP fetch 看是否能拿到 data-src
// - 如果实测 data-src 真拿不到, 在 enabled() 返 false 暂时屏蔽

import { fetchWithTimeout } from '../fetchWithTimeout';
import type { SearchResultItem, SourceAdapter } from '../types';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// 同时匹配 data-src / data-original / src, 三种都覆盖到
const IMG_RE = /<img\b[^>]*?(?:data-src|data-original|src)=["']([^"']+\.(?:jpe?g|png|gif|webp))["'][^>]*?(?:alt=["']([^"']*)["'])?/gi;
const PLACEHOLDER_RE = /transparent\.gif|loading\.gif|placeholder|spinner|blank\.png/i;
// 真搜索结果在 image.fabiaoqing.com / img.fabiaoqing.com CDN 上
// 主站 fabiaoqing.com/Public/img/* 是 logo / 广告等固定资源, 排除
const VALID_CDN_RE = /(?:image|img)\.fabiaoqing\.com/i;
const SITE_ASSETS_RE = /\/Public\/img\//i;

function djb2Hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) + s.charCodeAt(i);
    h = h | 0;
  }
  return Math.abs(h).toString(36);
}

function normalizeUrl(url: string): string {
  if (url.startsWith('//')) return 'https:' + url;
  if (url.startsWith('/')) return 'https://fabiaoqing.com' + url;
  return url;
}

async function search(query: string, page = 0): Promise<SearchResultItem[]> {
  const url = `https://fabiaoqing.com/search/bqb/keyword/${encodeURIComponent(query)}/page/${page + 1}.html`;
  const res = await fetchWithTimeout(url, {
    headers: {
      'User-Agent': UA,
      'Referer': 'https://fabiaoqing.com/',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    },
    timeoutMs: 6000,
  });
  if (!res.ok) throw new Error(`fabiaoqing HTTP ${res.status}`);
  const html = await res.text();

  const items: SearchResultItem[] = [];
  const seen = new Set<string>();
  IMG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = IMG_RE.exec(html)) !== null) {
    let raw = m[1];
    if (!raw) continue;
    raw = normalizeUrl(raw);
    if (PLACEHOLDER_RE.test(raw)) continue;
    if (SITE_ASSETS_RE.test(raw)) continue;          // 站点 logo/广告等
    if (!VALID_CDN_RE.test(raw)) continue;           // 必须命中真搜结果 CDN
    if (seen.has(raw)) continue;
    seen.add(raw);
    const hint = m[2] ? m[2].slice(0, 60) : undefined;
    items.push({
      id: `fabiaoqing:${djb2Hash(raw)}`,
      src: raw,
      thumb: raw,
      source: 'fabiaoqing',
      hint,
    });
    if (items.length >= 30) break;
  }
  return items;
}

export const fabiaoqingAdapter: SourceAdapter = {
  name: 'fabiaoqing',
  weight: 0.95,
  // ⚠️ 实测 (2026-05-17, dev verify): 发表情 HTML 真用 JS 懒加载, 真实 HTTP fetch 拿到的 HTML
  // 只含站点固定 logo (/Public/img/*), 真搜索结果 (image.fabiaoqing.com) 在客户端 JS 运行后才注入.
  // server-side regex 抓不到 → enabled=false 节省 5s timeout. 留待后续:
  //   方案 A: server-side headless browser (puppeteer) — 部署成本高
  //   方案 B: 直接 reverse-engineer 发表情内部 JSON API (它的 JS 应该调了某个 endpoint)
  //   方案 C: 接其它简中表情包专站 (堆糖 720+ 结果其实够用)
  enabled: () => false,
  search,
};
