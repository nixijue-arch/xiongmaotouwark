// Netlify Function 入口 — 远程图代理 (解决 canvas tainted)
// 业务逻辑在 ./_lib/handlers.ts
//
// GET /api/proxy-image?url=https%3A%2F%2Fc-ssl.duitang.com%2F...
//
// 严格 hostname 白名单 + Content-Type image/* + size < 10MB + SSRF 防御
// 返回原图 binary + CORS header + 一周 immutable 缓存
// 前端用此 URL 进 <img crossOrigin> 或 fetch → blob → dataURL, canvas 不 tainted

import { handleProxyImage } from './_lib/handlers';

export default handleProxyImage;

export const config = { path: '/api/proxy-image' };
