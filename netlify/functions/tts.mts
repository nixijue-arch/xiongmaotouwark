// Netlify Function — TTS 服务端中转 (仅生产/deploy-preview 跑; dev 走 scripts/vite-plugin-tts-proxy.ts).
// 浏览器调 GET /api/tts?engine=youdao&text=hi&lang=zh → 返 audio/mpeg blob + CORS header.
//
// ⚠️ 关键背景 (2026-05-24 实测): 本 function 跑在 Netlify 云 IP (海外/AWS), 跟用户本机(中国 IP)环境不同 →
//   - youdao dictvoice: 中国 IP 稳, 云 IP 被反爬/限流频繁返 500 → 本地配音正常但生产端"失效"的根因.
//   - baidu gettts: 云 IP 大多可用, 但限流时返一个 ~864B 的通用错误小音频(不是真语音).
//   所以本 function 必须: ① 请求引擎失败→自动切到另一引擎 ② 拒绝过小的错误音频(判失败) ③ 只缓存真音频
//   (public+Netlify-Vary:query 按文案缓存, 缓存命中不再打上游 → 缓存暖起来后生产端越来越稳).
import type { Context } from '@netlify/functions';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400',
};

// 小于此字节 = 上游限流返回的错误/通用小音频 (实测 baidu 限流回 ~864B), 判失败 → 切引擎.
// 真语音(哪怕 2 字)实测都 ≥ 数 KB, 故 1500 阈值不会误杀真音频.
const MIN_VALID_AUDIO_BYTES = 1500;
const PER_FETCH_TIMEOUT_MS = 4000;   // 单引擎抓取超时 (youdao 失败很快; 两引擎串行 < Netlify 10s 上限)

type Engine = 'youdao' | 'baidu';

function buildUpstream(engine: Engine, text: string, lang: string, per: string | null, spd: string): { url: string; headers: Record<string, string> } {
  const le = lang === 'en' ? 'en' : 'zh';
  if (engine === 'youdao') {
    return {
      url: `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(text)}&le=${le}`,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://dict.youdao.com/',
        'Accept': 'audio/mpeg,audio/*,*/*',
      },
    };
  }
  const perPart = per !== null && per !== '' ? `&per=${encodeURIComponent(per)}` : '';
  return {
    url: `https://fanyi.baidu.com/gettts?lan=${le}&text=${encodeURIComponent(text)}&spd=${encodeURIComponent(spd)}&source=web${perPart}`,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://fanyi.baidu.com/',
    },
  };
}

// 抓一个引擎: 失败(非200 / 非audio / 过小错误音频 / 超时) 都 throw → caller 切下一个引擎.
async function tryEngine(engine: Engine, text: string, lang: string, per: string | null, spd: string): Promise<{ buf: ArrayBuffer; contentType: string }> {
  const { url, headers } = buildUpstream(engine, text, lang, per, spd);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PER_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    if (!res.ok) throw new Error(`${engine} HTTP ${res.status}`);
    const contentType = res.headers.get('content-type') || 'audio/mpeg';
    if (!contentType.startsWith('audio')) throw new Error(`${engine} 非audio (${contentType.slice(0, 40)})`);
    const buf = await res.arrayBuffer();
    if (buf.byteLength < MIN_VALID_AUDIO_BYTES) throw new Error(`${engine} 音频过小 ${buf.byteLength}B (上游限流?)`);
    return { buf, contentType };
  } finally {
    clearTimeout(timer);
  }
}

export default async (req: Request, _ctx: Context): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405, headers: CORS_HEADERS });

  const url = new URL(req.url);
  const reqEngine = (url.searchParams.get('engine') || 'youdao').toLowerCase();
  const text = url.searchParams.get('text') || '';
  const lang = (url.searchParams.get('lang') || 'zh').toLowerCase();
  const per = url.searchParams.get('per');       // baidu 说话人
  const spd = url.searchParams.get('spd') || '5';
  if (!text) {
    return new Response(JSON.stringify({ error: 'text required' }), { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
  }
  if (text.length > 300) {
    return new Response(JSON.stringify({ error: 'text too long (max 300)' }), { status: 413, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
  }

  // 请求的引擎优先, 失败自动切另一个 (youdao↔baidu) — 云 IP 上 youdao 常挂 → 自动落 baidu, 拿到真音频.
  const order: Engine[] = reqEngine === 'baidu' ? ['baidu', 'youdao'] : ['youdao', 'baidu'];
  const errs: string[] = [];
  for (const eng of order) {
    try {
      const { buf, contentType } = await tryEngine(eng, text, lang, eng === 'baidu' ? per : null, spd);
      return new Response(buf, {
        status: 200,
        headers: {
          ...CORS_HEADERS,
          'Content-Type': contentType,
          'X-TTS-Engine': eng,   // 实际命中的引擎 (可能跟请求的不同 = 发生了 fallback)
          // 真音频才缓存: public + Netlify-Vary:query(自动) → 按完整 URL(含 ?text=) 边缘缓存, 各文案隔离, 不串台;
          // 缓存命中不再打上游 → 常用文案暖起来后生产端稳. (错误小音频走 throw, 永不到这里, 不污染缓存.)
          'Cache-Control': 'public, max-age=86400',
        },
      });
    } catch (e) {
      errs.push((e as Error).message);
    }
  }
  // 两个引擎都失败 → 502, 不缓存 (客户端会重试 / 标 genFailed)
  return new Response(JSON.stringify({ error: '上游 TTS 均失败', detail: errs.join(' | ') }), {
    status: 502,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
};

export const config = { path: '/api/tts' };
