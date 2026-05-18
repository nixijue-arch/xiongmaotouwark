// 业务 handler — 同时给 .mts (prod Netlify Function) + vite-plugin-search-proxy.ts (dev) 用
// 这里 module-level state (LRU / TokenBucket) 在 Function 热实例期间复用
// (冷启会重置, 不是问题, Cache-Control 24h 是主缓存)

import { LRU, TokenBucket } from './lruCache';
import { expandQuery } from './queryExpansion';
import { filterAndScore } from './heuristicFilter';
import { runAllSources } from './sources';
import { fetchWithTimeout } from './fetchWithTimeout';
import type { SearchResponse } from './types';

// ============ CORS / 公共 ============

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400',
};

function jsonResp(status: number, body: unknown, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', ...extraHeaders },
  });
}

function getClientIp(req: Request): string {
  return (
    req.headers.get('x-nf-client-connection-ip') ||
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  );
}

// ============ search-pandas ============

const responseCache = new LRU<string, SearchResponse>(200, 60 * 60 * 1000); // 1h
const RATE_LIMIT_PER_MIN = parseInt(process.env.SEARCH_RATE_LIMIT_PER_MIN ?? '30', 10);
const limiter = new TokenBucket(RATE_LIMIT_PER_MIN, RATE_LIMIT_PER_MIN);

const PAGE_SIZE = 120;  // 之前 60, 扩到 120 — 用户感知"数百张/搜". 前端 colorfulness 砍 20-30% → 呈现 ~85-95 张/页
const MAX_PAGE = 10;

export async function handleSearch(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'GET') {
    return jsonResp(405, { error: 'method_not_allowed' });
  }

  const url = new URL(req.url);
  const q = (url.searchParams.get('q') ?? '').trim();
  const pageStr = url.searchParams.get('page') ?? '0';
  const sourcesParam = url.searchParams.get('sources');
  const sourceFilter = sourcesParam
    ? new Set(sourcesParam.split(',').map((s) => s.trim()).filter(Boolean))
    : undefined;

  if (!q) return jsonResp(400, { error: 'q_required' });
  if (q.length > 50) return jsonResp(413, { error: 'q_too_long', max: 50 });
  const page = parseInt(pageStr, 10);
  if (!Number.isFinite(page) || page < 0) return jsonResp(400, { error: 'invalid_page' });
  if (page > MAX_PAGE) return jsonResp(400, { error: 'page_too_large', max: MAX_PAGE });

  const clientIp = getClientIp(req);
  if (!limiter.tryConsume(clientIp)) {
    return jsonResp(429, { error: 'rate_limited', retryAfterSec: 60 });
  }

  const cacheKey = `${q}|${page}|${sourcesParam ?? 'all'}`;
  const cached = responseCache.get(cacheKey);
  if (cached) {
    return jsonResp(200, cached, {
      'Cache-Control': 'public, max-age=86400, s-maxage=86400',
      'X-Cache': 'HIT',
    });
  }

  try {
    const plan = expandQuery(q);
    const { items: rawItems, perSource } = await runAllSources(plan, page, sourceFilter);
    const filtered = filterAndScore(rawItems, q);
    const paginated = filtered.slice(0, PAGE_SIZE);
    const okSourceCount = Object.values(perSource).filter((s) => s.ok).length;
    const totalSourceCount = Object.keys(perSource).length;
    const allFailed = totalSourceCount > 0 && okSourceCount === 0;

    const resp: SearchResponse = {
      items: paginated,
      total: filtered.length,
      hasMore: filtered.length > PAGE_SIZE,
      nextPage: page + 1,
      sources: perSource,
      ...(allFailed
        ? { hint: 'all_sources_failed' as const }
        : okSourceCount < totalSourceCount
          ? { hint: 'partial' as const }
          : {}),
    };

    if (!allFailed && paginated.length > 0) {
      responseCache.set(cacheKey, resp);
    }

    return jsonResp(200, resp, {
      'Cache-Control': 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=43200',
      'X-Cache': 'MISS',
    });
  } catch (e) {
    return jsonResp(500, { error: (e as Error).message ?? 'unknown' });
  }
}

// ============ proxy-image ============

const ALLOWED_HOSTS = new Set<string>([
  // 堆糖
  'c-ssl.duitang.com',
  'c1-ssl.duitang.com',
  'b-ssl.duitang.com',
  'c-ssl.dtstatic.com',
  // 发表情
  'image.fabiaoqing.com',
  'img.fabiaoqing.com',
  // 百度图片 (2026-05-17 加)
  'gimg0.baidu.com',
  'gimg1.baidu.com',
  'gimg2.baidu.com',
  'gimg3.baidu.com',
  'img0.baidu.com',
  'img1.baidu.com',
  'img2.baidu.com',
  't7.baidu.com',
  't9.baidu.com',
  't10.baidu.com',
  't11.baidu.com',
  't12.baidu.com',
  // 搜狗图片 (2026-05-17 加)
  'pic.sogoucdn.com',
  'img.sogoucdn.com',
  'i01piccdn.sogoucdn.com',
  'i02piccdn.sogoucdn.com',
  'i03piccdn.sogoucdn.com',
  'i04piccdn.sogoucdn.com',
  // 360 图片 (2026-05-17 加)
  'p0.ssl.qhimgs1.com', 'p1.ssl.qhimgs1.com', 'p2.ssl.qhimgs1.com',
  'p3.ssl.qhimgs1.com', 'p4.ssl.qhimgs1.com', 'p5.ssl.qhimgs1.com',
  'p0.ssl.qhimgs2.com', 'p1.ssl.qhimgs2.com', 'p2.ssl.qhimgs2.com',
  'p3.ssl.qhimgs2.com', 'p4.ssl.qhimgs2.com', 'p5.ssl.qhimgs2.com',
  'p0.ssl.qhmsg.com', 'p1.ssl.qhmsg.com',
  // 必应 (预留)
  'tse1.mm.bing.net',
  'tse2.mm.bing.net',
  'tse3.mm.bing.net',
  'tse4.mm.bing.net',
]);

// env 扩展白名单 (CSV)
const EXTRA_HOSTS = (process.env.EXTRA_ALLOWED_HOSTS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
for (const h of EXTRA_HOSTS) ALLOWED_HOSTS.add(h);

const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB
const IP_LITERAL_RE = /^(\d{1,3}\.){3}\d{1,3}$|^\[?[0-9a-f:]+\]?$/i;

function isSafeHost(hostname: string): boolean {
  const lc = hostname.toLowerCase();
  if (IP_LITERAL_RE.test(lc)) return false;
  if (lc === 'localhost') return false;
  if (lc.endsWith('.local') || lc.endsWith('.internal') || lc.endsWith('.lan')) return false;
  return ALLOWED_HOSTS.has(lc);
}

export async function handleProxyImage(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: { ...CORS_HEADERS, 'Cross-Origin-Resource-Policy': 'cross-origin' },
    });
  }
  if (req.method !== 'GET') {
    return jsonResp(405, { error: 'method_not_allowed' });
  }

  const url = new URL(req.url);
  const target = url.searchParams.get('url');
  if (!target) return jsonResp(400, { error: 'url_required' });

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return jsonResp(400, { error: 'invalid_url' });
  }
  if (parsed.protocol !== 'https:') return jsonResp(403, { error: 'https_only' });
  if (parsed.username || parsed.password) return jsonResp(403, { error: 'no_userinfo' });
  if (!isSafeHost(parsed.hostname)) return jsonResp(403, { error: 'forbidden_host', host: parsed.hostname });

  try {
    const upstream = await fetchWithTimeout(parsed.toString(), {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': `https://${parsed.hostname}/`,
        'Accept': 'image/*,*/*;q=0.8',
      },
      timeoutMs: 10000,
    });

    if (!upstream.ok) {
      return jsonResp(502, { error: 'upstream', status: upstream.status });
    }
    const contentType = upstream.headers.get('content-type') ?? 'image/jpeg';
    if (!contentType.startsWith('image/')) {
      return jsonResp(415, { error: 'not_an_image', contentType });
    }
    const contentLengthHeader = upstream.headers.get('content-length');
    if (contentLengthHeader) {
      const cl = parseInt(contentLengthHeader, 10);
      if (Number.isFinite(cl) && cl > MAX_IMAGE_SIZE) {
        return jsonResp(413, { error: 'too_large', max: MAX_IMAGE_SIZE });
      }
    }
    const buf = await upstream.arrayBuffer();
    if (buf.byteLength > MAX_IMAGE_SIZE) {
      return jsonResp(413, { error: 'too_large', max: MAX_IMAGE_SIZE });
    }
    return new Response(buf, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=604800, immutable',
        'Cross-Origin-Resource-Policy': 'cross-origin',
        'X-Proxy-Source': parsed.hostname,
      },
    });
  } catch (e) {
    return jsonResp(500, { error: (e as Error).message ?? 'unknown' });
  }
}
