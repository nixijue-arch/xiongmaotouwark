// Netlify Function — TTS 服务端中转, 解决:
//   1. 有道朗读 dict.youdao.com/dictvoice 浏览器 fetch 失败 (无 CORS + anti-bot)
//   2. 可扩展接其他公开 TTS endpoint
// 浏览器调 GET /api/tts?engine=youdao&text=hi&lang=zh → 返 audio/mpeg blob + CORS header
// dev (localhost) 不能直接调本 function (需 netlify dev), 走绝对 prod URL 即可
import type { Context } from '@netlify/functions';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400',
};

export default async (req: Request, _ctx: Context): Promise<Response> => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405, headers: CORS_HEADERS });
  }

  const url = new URL(req.url);
  const engine = (url.searchParams.get('engine') || 'youdao').toLowerCase();
  const text = url.searchParams.get('text') || '';
  const lang = (url.searchParams.get('lang') || 'zh').toLowerCase();
  // baidu only — 说话人 + 语速 (没传则 fanyi 默认)
  const per = url.searchParams.get('per');
  const spd = url.searchParams.get('spd') || '5';
  if (!text) {
    return new Response(JSON.stringify({ error: 'text required' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
  if (text.length > 300) {
    return new Response(JSON.stringify({ error: 'text too long (max 300)' }), {
      status: 413,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  try {
    let upstreamURL: string;
    let upstreamHeaders: Record<string, string> = {};
    if (engine === 'youdao') {
      // 有道朗读 — 加 User-Agent + Referer 绕反爬
      upstreamURL = `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(text)}&le=${lang === 'en' ? 'en' : 'zh'}`;
      upstreamHeaders = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://dict.youdao.com/',
        'Accept': 'audio/mpeg,audio/*,*/*',
      };
    } else if (engine === 'baidu') {
      const perPart = per !== null && per !== '' ? `&per=${encodeURIComponent(per)}` : '';
      upstreamURL = `https://fanyi.baidu.com/gettts?lan=${lang === 'en' ? 'en' : 'zh'}&text=${encodeURIComponent(text)}&spd=${encodeURIComponent(spd)}&source=web${perPart}`;
      upstreamHeaders = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://fanyi.baidu.com/',
      };
    } else {
      return new Response(JSON.stringify({ error: `unsupported engine: ${engine}` }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const upstream = await fetch(upstreamURL, { headers: upstreamHeaders });
    if (!upstream.ok) {
      return new Response(JSON.stringify({ error: `upstream ${upstream.status}` }), {
        status: 502,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }
    const contentType = upstream.headers.get('content-type') || 'audio/mpeg';
    const buf = await upstream.arrayBuffer();
    return new Response(buf, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
};

export const config = { path: '/api/tts' };
