// Vite dev plugin — 本地 dev 模式中转 TTS 请求, 跟 Netlify Function /api/tts 同 path
// 让 dev (localhost) 跟 prod (Netlify) 一份代码: 浏览器调 /api/tts?engine=youdao&text=... 都通
// prod: Netlify Function 接管
// dev: 这个 plugin 接管 (Node.js fetch 中转, 加 Referer/UA 绕反爬)

import type { Plugin } from 'vite';

export function ttsProxyDevPlugin(): Plugin {
  return {
    name: 'xmw-tts-proxy-dev',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url || !req.url.startsWith('/api/tts')) {
          return next();
        }

        // CORS preflight
        if (req.method === 'OPTIONS') {
          res.statusCode = 204;
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', '*');
          res.end();
          return;
        }

        if (req.method !== 'GET') {
          res.statusCode = 405;
          res.end('Method Not Allowed');
          return;
        }

        try {
          const url = new URL(req.url, `http://${req.headers.host}`);
          const engine = (url.searchParams.get('engine') || 'youdao').toLowerCase();
          const text = url.searchParams.get('text') || '';
          const lang = (url.searchParams.get('lang') || 'zh').toLowerCase();
          if (!text) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'text required' }));
            return;
          }
          if (text.length > 300) {
            res.statusCode = 413;
            res.end(JSON.stringify({ error: 'text too long' }));
            return;
          }

          // per — 仅 baidu engine 用 (说话人 ID, 不传走 fanyi 默认 = per=0 度小美女声)
          // 常用: 0=度小美(女) 1=度小宇(男) 3=度逍遥(书生男) 4=度丫丫(萌妹)
          const per = url.searchParams.get('per');
          // spd — baidu 语速 (1-15, 默认 5). 没传走 5
          const spd = url.searchParams.get('spd') || '5';
          let upstreamURL: string;
          let upstreamHeaders: Record<string, string>;
          if (engine === 'youdao') {
            upstreamURL = `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(text)}&le=${lang === 'en' ? 'en' : 'zh'}`;
            upstreamHeaders = {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0',
              'Referer': 'https://dict.youdao.com/',
              'Accept': 'audio/mpeg,audio/*,*/*',
            };
          } else if (engine === 'baidu') {
            const perPart = per !== null && per !== '' ? `&per=${encodeURIComponent(per)}` : '';
            upstreamURL = `https://fanyi.baidu.com/gettts?lan=${lang === 'en' ? 'en' : 'zh'}&text=${encodeURIComponent(text)}&spd=${encodeURIComponent(spd)}&source=web${perPart}`;
            upstreamHeaders = {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0',
              'Referer': 'https://fanyi.baidu.com/',
            };
          } else {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: `unsupported engine: ${engine}` }));
            return;
          }

          const upstream = await fetch(upstreamURL, { headers: upstreamHeaders });
          if (!upstream.ok) {
            res.statusCode = 502;
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.end(JSON.stringify({ error: `upstream ${upstream.status}` }));
            return;
          }
          const ct = upstream.headers.get('content-type') || 'audio/mpeg';
          const buf = Buffer.from(await upstream.arrayBuffer());
          res.statusCode = 200;
          res.setHeader('Content-Type', ct);
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Cache-Control', 'public, max-age=3600');
          res.end(buf);
        } catch (e) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.end(JSON.stringify({ error: (e as Error).message }));
        }
      });
    },
  };
}
