// vite-plugin-search-proxy — DEV 模拟 Netlify Function /api/search-pandas + /api/proxy-image
//
// 跟现有 vite-plugin-tts-proxy.ts 同思路:
//   - apply: 'serve' (prod build 完全不带这个 plugin)
//   - middleware 拦截 /api/search-pandas 和 /api/proxy-image
//   - 直接调用 netlify/functions/_lib/handlers.ts 的 handler 函数
//
// 关键: 用 server.ssrLoadModule 让 Vite 编译 .ts (而不是手动跑 esbuild)
// 业务逻辑共享 prod handler, 不重写一遍

import type { Plugin, ViteDevServer } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';

const HANDLERS_PATH = '/netlify/functions/_lib/handlers.ts';

type Handler = (req: Request) => Promise<Response>;
interface HandlersModule {
  handleSearch: Handler;
  handleProxyImage: Handler;
}

function nodeReqToWebRequest(req: IncomingMessage): Request {
  const host = req.headers.host ?? 'localhost:3000';
  const fullUrl = `http://${host}${req.url ?? '/'}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === 'string') headers.set(k, v);
    else if (Array.isArray(v)) headers.set(k, v.join(', '));
  }
  return new Request(fullUrl, {
    method: req.method ?? 'GET',
    headers,
  });
}

async function sendWebResponse(webRes: Response, res: ServerResponse): Promise<void> {
  res.statusCode = webRes.status;
  webRes.headers.forEach((value, key) => {
    // Node ServerResponse 不能设 content-encoding (会触发自动 brotli/gzip 冲突)
    if (key.toLowerCase() === 'content-encoding') return;
    res.setHeader(key, value);
  });
  if (webRes.body) {
    const buf = Buffer.from(await webRes.arrayBuffer());
    res.end(buf);
  } else {
    res.end();
  }
}

export function searchProxyDevPlugin(): Plugin {
  return {
    name: 'search-proxy-dev',
    apply: 'serve',
    configureServer(server: ViteDevServer) {
      const makeHandler = (which: 'search' | 'proxy') =>
        async (req: IncomingMessage, res: ServerResponse) => {
          try {
            const mod = (await server.ssrLoadModule(HANDLERS_PATH)) as HandlersModule;
            const handler = which === 'search' ? mod.handleSearch : mod.handleProxyImage;
            if (typeof handler !== 'function') {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'handler_not_loaded', path: HANDLERS_PATH, which }));
              return;
            }
            const webReq = nodeReqToWebRequest(req);
            const webRes = await handler(webReq);
            await sendWebResponse(webRes, res);
          } catch (e) {
            const err = e as Error;
            // eslint-disable-next-line no-console
            console.error(`[search-proxy-dev:${which}]`, err);
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.end(JSON.stringify({ error: err.message, stack: err.stack }));
          }
        };

      // 用 path-prefix 注册, connect-style. 跟 vite-plugin-dev-sync.ts 同模式
      server.middlewares.use('/api/search-pandas', makeHandler('search'));
      server.middlewares.use('/api/proxy-image', makeHandler('proxy'));
    },
  };
}
