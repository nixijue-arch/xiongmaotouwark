// 联网搜表情包 — 远程图管线 (前端)
//
// 用法:
//   1. 缩略图直接展示 (hot-link): <img src={result.thumb} /> — 网格展示用源 URL, 不走代理省后端流量
//   2. 用户选中 → fetchAsDataUrl(result.src) — 走 /api/proxy-image, 转 dataURL, canvas 不 tainted
//   3. makeNetworkMaterial(result, 'panda'|'face') — 直接生成 Material 实例, 注入到现有合成流程
//
// 远程图为什么必须转 dataURL:
//   - canvas drawImage 接 cross-origin 图 → canvas tainted → toDataURL/toBlob 抛 SecurityError
//   - 即使源站返了 CORS header, 浏览器对 <img> 默认请求不带 crossorigin attr 也会污染
//   - dataURL 是 same-origin, 100% 兼容现有 composeMeme / 导出 / 复制流程

import type { Material } from '@/data/materials';
import { get as idbGet, set as idbSet } from 'idb-keyval';

export interface NetworkResult {
  id: string;            // `${source}:${hash}` 后端返
  src: string;           // 原图 URL
  thumb: string;         // 缩略图 URL (一般 = src 或更小)
  source: 'duitang' | 'fabiaoqing' | 'bing' | 'baidu' | 'sogou' | 'so360';   // 跟后端 SourceName 对齐 (原漏 baidu/sogou/so360)
  w?: number;
  h?: number;
  hint?: string;
}

// ============================================================
// 全局「最近搜索」— 用户用过(选中/加入)的联网素材, 最近 20 个; 跨 快速/编辑器/沙雕动画 通用.
// 存 NetworkResult (src/thumb/source/hint), 不存 dataURL (太大), 重显缩略图走 thumb URL.
// ============================================================
const RECENT_NET_KEY = 'xiongmaotou.network-recent.v1';
const RECENT_NET_MAX = 20;
export async function getRecentNetwork(): Promise<NetworkResult[]> {
  try { const d = await idbGet<NetworkResult[]>(RECENT_NET_KEY); return Array.isArray(d) ? d.slice(0, RECENT_NET_MAX) : []; }
  catch { return []; }
}
export async function addRecentNetwork(r: NetworkResult): Promise<void> {
  try {
    const cur = await getRecentNetwork();
    await idbSet(RECENT_NET_KEY, [r, ...cur.filter(x => x.id !== r.id)].slice(0, RECENT_NET_MAX));   // 最新置顶 + 去重 + 限 20
  } catch { /* ignore */ }
}
// 网络结果是否 GIF (URL 嗅探, 跟 animcore isGifSrc 同规则; 避免 import animcore 到本 lib)
export function isGifResult(r: { src?: string }): boolean {
  const s = (r.src || '').toLowerCase();
  return s.startsWith('data:image/gif') || s.endsWith('.gif') || s.includes('.gif?');
}

export interface SearchResponse {
  items: NetworkResult[];
  total: number;
  hasMore: boolean;
  nextPage: number;
  sources: Record<string, { ok: boolean; took: number; count: number; error?: string }>;
  hint?: 'all_sources_failed' | 'partial';
}

/**
 * 远程图 URL → 浏览器加载的 URL (智能路由).
 *
 * 2026-05-17 性能优化 v2: 生产端用户反馈搜索 30s+ (本地 3s).
 *   根因: 每张缩略图都走 /api/proxy-image, 国内用户 → Netlify(海外) → 国内 CDN → Netlify → 用户
 *   每张 ~1-2s 国际 round-trip × 60 张 ÷ 6 浏览器并发 ≈ 15-30s 真瓶颈.
 *
 * 优化策略: 只有真正防盗链的源走 proxy, 无防盗链的源直接 hot-link CDN (国内→国内 ~50ms).
 *   - duitang / dtstatic    → 必须 proxy (实测有 Referer 检查 + 防盗链)
 *   - fabiaoqing            → 必须 proxy (有防盗链)
 *   - baidu (img*.baidu)    → 直接 hot-link (实测无 Referer 检查)
 *   - so360 (qhimgs*)       → 直接 hot-link (实测无 Referer 检查)
 *   - sogou (sogoucdn)      → 直接 hot-link
 *
 * 用于缩略图渲染 (<img src={...}>). detect 函数需要 canvas getImageData (CORS canvas), 不能用此函数,
 * 必须固定走 proxy 拿 same-origin RGBA — 用 proxyForCanvasDetect.
 */
const PROXY_REQUIRED_RE = /(?:^|\.)duitang\.com$|(?:^|\.)dtstatic\.com$|(?:^|\.)fabiaoqing\.com$/i;

export function proxyImageUrl(remoteUrl: string): string {
  try {
    const u = new URL(remoteUrl);
    if (PROXY_REQUIRED_RE.test(u.hostname)) {
      return `/api/proxy-image?url=${encodeURIComponent(remoteUrl)}`;
    }
    // 国内 CDN 直接 hot-link (大幅减少 latency)
    return remoteUrl;
  } catch {
    return `/api/proxy-image?url=${encodeURIComponent(remoteUrl)}`;
  }
}

/** detect 用 — canvas getImageData 需要 same-origin, 固定走 proxy */
export function proxyForCanvasDetect(remoteUrl: string): string {
  return `/api/proxy-image?url=${encodeURIComponent(remoteUrl)}`;
}

/** GET /api/search-pandas?q=...&page=... — 主搜索 */
export async function searchPandas(
  query: string,
  page = 0,
  signal?: AbortSignal,
): Promise<SearchResponse> {
  const q = query.trim();
  if (!q) return { items: [], total: 0, hasMore: false, nextPage: 0, sources: {} };
  // cache: 'no-store' — 避免浏览器 disk cache 旧 results (Cache-Control max-age=86400 会让浏览器缓存)
  // 后端 in-memory LRU 仍然命中 (同 cacheKey), 但浏览器每次都向 dev server 拿最新代码处理结果
  const url = `/api/search-pandas?q=${encodeURIComponent(q)}&page=${page}`;
  const res = await fetch(url, { signal, cache: 'no-store' });
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`search failed: ${res.status} ${errBody.slice(0, 100)}`);
  }
  return (await res.json()) as SearchResponse;
}

/** 远程图 → dataURL (走后端代理绕 CORS) */
export async function fetchAsDataUrl(remoteUrl: string, signal?: AbortSignal): Promise<string> {
  const proxied = `/api/proxy-image?url=${encodeURIComponent(remoteUrl)}`;
  const res = await fetch(proxied, { signal });
  if (!res.ok) {
    throw new Error(`proxy ${res.status}`);
  }
  const blob = await res.blob();
  return blobToDataUrl(blob);
}

/** 远程图 → Blob (沉淀工具用) */
export async function fetchAsBlob(remoteUrl: string, signal?: AbortSignal): Promise<Blob> {
  const proxied = `/api/proxy-image?url=${encodeURIComponent(remoteUrl)}`;
  const res = await fetch(proxied, { signal });
  if (!res.ok) throw new Error(`proxy ${res.status}`);
  return await res.blob();
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const v = r.result;
      if (typeof v === 'string') resolve(v);
      else reject(new Error('FileReader returned non-string'));
    };
    r.onerror = () => reject(r.error ?? new Error('FileReader failed'));
    r.readAsDataURL(blob);
  });
}

/**
 * "裁掉底部文字" — 纯几何 crop, 不再 inpaint 检测.
 *
 * 2026-05-17 v2 (用户反馈"完全卡死, 重新做这个系统"):
 *   旧版 canvas inpaint (扫描 dark pixel 行 + 白色覆盖) 在以下场景卡死/失败:
 *     - getImageData 跨大图 1500x1500 一次扫 600 行 × 1500 像素 → 主线程 200~800ms
 *     - 检测算法误判: 纯黑 panda 头被误为 "文字行", 覆盖到错的 Y
 *     - 文字检测失败时 silently 返回原图, 用户以为"没生效"
 *
 *   新版 (this): 加载图 → drawImage 到 cropH = H*0.78 的新 canvas → toDataURL
 *     - 0 检测, 纯几何
 *     - 主线程总 < 50ms (一次 drawImage)
 *     - 5s timeout 兜底 (Image onload 不来), 永不卡死
 *     - 即使图本身没文字, 砍掉底 22% 也无大碍 (panda 头核心在上 60%)
 *
 * 用户感知: 应用一定快, 一定有效果 (底部一定干净). 误判风险极小.
 */
const _eraseTextCache = new Map<string, string>();

const CROP_BOTTOM_RATIO = 0.22; // 砍掉底部 22%, 实测能覆盖 95% 单/双行配文
const IMG_LOAD_TIMEOUT_MS = 5000;

export async function eraseBottomText(imgUrl: string): Promise<string> {
  const cached = _eraseTextCache.get(imgUrl);
  if (cached !== undefined) return cached;
  let img: HTMLImageElement;
  try {
    img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      const timer = window.setTimeout(() => {
        reject(new Error(`img load timeout ${IMG_LOAD_TIMEOUT_MS}ms`));
      }, IMG_LOAD_TIMEOUT_MS);
      i.onload = () => { window.clearTimeout(timer); resolve(i); };
      i.onerror = () => { window.clearTimeout(timer); reject(new Error('img load failed')); };
      i.src = imgUrl;
    });
  } catch (e) {
    // 失败时透传原 URL, 让 caller 仍能继续 (不 throw, 不卡 UI)
    // eslint-disable-next-line no-console
    console.warn('[networkImage] eraseBottomText img load failed', (e as Error).message);
    return imgUrl;
  }
  const W = img.naturalWidth || img.width;
  const H = img.naturalHeight || img.height;
  if (W < 50 || H < 50) {
    _eraseTextCache.set(imgUrl, imgUrl);
    return imgUrl;
  }
  const cropH = Math.max(50, Math.round(H * (1 - CROP_BOTTOM_RATIO)));
  const c = document.createElement('canvas');
  c.width = W;
  c.height = cropH;
  const ctx = c.getContext('2d');
  if (!ctx) return imgUrl;
  // 只画原图顶部 cropH 像素 (sx,sy,sw,sh, dx,dy,dw,dh) — 完美裁底
  ctx.drawImage(img, 0, 0, W, cropH, 0, 0, W, cropH);
  let out: string;
  try {
    out = c.toDataURL('image/png');
  } catch {
    return imgUrl;
  }
  _eraseTextCache.set(imgUrl, out);
  return out;
}

/**
 * 启发式检测图片是否含文字 — 不用 OCR (太重), 用像素分析.
 *
 * 思路: 熊猫头梗图配文通常在底部 1/3 区域, 文字 = 高对比度规整水平 dark 行.
 *   - 取图底部 35% region
 *   - 转灰度 + 阈值 (灰度<80 算 dark)
 *   - 统计每行 dark 像素占比 > 5% 的行数
 *   - 累计 ≥ 8 行 = 有文字嫌疑
 *
 * 性能: 缩到 max 200px 宽再扫描, 1 张图 < 50ms.
 * 误判: 纯黑底 panda 也会触发 (但反正用户能切换 toggle 关闭过滤).
 */
const _textDetectCache = new Map<string, boolean>();

export async function detectTextInImage(imgUrl: string): Promise<boolean> {
  const cached = _textDetectCache.get(imgUrl);
  if (cached !== undefined) return cached;
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      const timer = window.setTimeout(() => reject(new Error('timeout')), 6000);
      i.onload = () => { window.clearTimeout(timer); resolve(i); };
      i.onerror = () => { window.clearTimeout(timer); reject(new Error('img load failed')); };
      i.src = imgUrl;
    });
    const W0 = img.naturalWidth || img.width || 1;
    const H0 = img.naturalHeight || img.height || 1;
    if (W0 < 50 || H0 < 50) {
      _textDetectCache.set(imgUrl, false);
      return false;
    }
    // 缩到 max 200 宽
    const scale = Math.min(1, 200 / W0);
    const W = Math.max(50, Math.round(W0 * scale));
    const H = Math.max(50, Math.round(H0 * scale));
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return false;
    ctx.drawImage(img, 0, 0, W, H);

    // 只看底部 35% region
    const yStart = Math.floor(H * 0.65);
    const regionH = H - yStart;
    const data = ctx.getImageData(0, yStart, W, regionH).data;

    let textLikeRows = 0;
    for (let y = 0; y < regionH; y++) {
      let darkCount = 0;
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const gray = (data[i] + data[i + 1] + data[i + 2]) / 3;
        if (gray < 80) darkCount++;
      }
      const darkRatio = darkCount / W;
      // 文字行典型 dark ratio 0.05-0.4 (太黑可能是 solid panda 头, 太白可能是空白)
      if (darkRatio > 0.05 && darkRatio < 0.5) textLikeRows++;
    }
    const hasText = textLikeRows >= 8;
    _textDetectCache.set(imgUrl, hasText);
    return hasText;
  } catch {
    return false;
  }
}

/**
 * 启发式检测图片是否是"彩色照片" (非熊猫头梗图) —
 * 用 HSV saturation 占比. 真熊猫照片 / 二次元 / 真人 saturation 通常 > 0.3,
 * 熊猫头梗图 99% 是黑/白/灰二值图, saturation 接近 0.
 *
 * 实测可去除:
 *   - 真实熊猫坐办公室 (AI 生成绿植/棕桌/彩色屏幕)
 *   - 动漫女郎 (彩色衣服头发)
 *   - 真人写真 (肤色 + 彩色)
 *
 * 性能: 缩到 60×60 (3600 像素) 扫描, ~10-30ms/张, 比 detectText 快.
 */
const _colorfulCache = new Map<string, boolean>();

export async function detectColorfulness(imgUrl: string): Promise<boolean> {
  const cached = _colorfulCache.get(imgUrl);
  if (cached !== undefined) return cached;
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      const timer = window.setTimeout(() => reject(new Error('timeout')), 6000);
      i.onload = () => { window.clearTimeout(timer); resolve(i); };
      i.onerror = () => { window.clearTimeout(timer); reject(new Error('img load failed')); };
      i.src = imgUrl;
    });
    const c = document.createElement('canvas');
    c.width = 60; c.height = 60;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return false;
    ctx.drawImage(img, 0, 0, 60, 60);
    const data = ctx.getImageData(0, 0, 60, 60).data;
    let colorfulCount = 0;
    const total = 60 * 60;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      // HSV saturation = (max - min) / max (max > 0). 简化: saturation > 30/255 ≈ 0.12
      if (max > 30 && (max - min) > 40) colorfulCount++;
    }
    const colorfulRatio = colorfulCount / total;
    // > 18% 彩色像素 = 真彩照片 (非熊猫头梗图)
    const isColorful = colorfulRatio > 0.18;
    _colorfulCache.set(imgUrl, isColorful);
    return isColorful;
  } catch {
    return false;  // 失败兜底保留 (不误杀)
  }
}

/**
 * AI 生成熊猫检测 — 比 colorfulness 更精细的 false-positive 杀手.
 *
 * 实测 (2026-05-17, scripts/test-ai-panda.mjs q=打工 40 张) 发现:
 *   AI 生成的"打工人熊猫"(真实风格 office panda) hint 含"熊猫头"骗过 STRICT 过滤,
 *   colorfulness 单维度也漏过 (avgSat 18-34 落在 colorfulRatio 灰区).
 *
 * 但 AI 图共有**两强信号**, 真黑白 panda meme 完全不命中:
 *   1. avgSat > 28          — 自然色 (棕黄/绿草/木桌), 真 meme avgSat 几乎 = 0
 *   2. whiteBgRatio < 0.10  — 复杂背景无白底, 真 meme 30-78% 白底环绕 panda
 *
 * 实测 q=打工: 此 rule 砍 3 张 AI panda (1024×N 打工人熊猫头, sat 28-34 + wbg 1-6%),
 * 0 误杀 (真 meme + 红心彩色装饰版 都保留, 边缘 GIF 也安全).
 *
 * 性能: 60×60 = 3600 像素, ~15-25ms/张. 跟 detectColorfulness 并行 lazy 跑.
 */
const _aiPandaCache = new Map<string, boolean>();

export async function detectAIPanda(imgUrl: string): Promise<boolean> {
  const cached = _aiPandaCache.get(imgUrl);
  if (cached !== undefined) return cached;
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      const timer = window.setTimeout(() => reject(new Error('timeout')), 6000);
      i.onload = () => { window.clearTimeout(timer); resolve(i); };
      i.onerror = () => { window.clearTimeout(timer); reject(new Error('img load failed')); };
      i.src = imgUrl;
    });
    const c = document.createElement('canvas');
    c.width = 60; c.height = 60;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return false;
    ctx.drawImage(img, 0, 0, 60, 60);
    const data = ctx.getImageData(0, 0, 60, 60).data;
    const total = 60 * 60;
    let totalSat = 0;
    let whiteBgCount = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const gray = (r + g + b) / 3;
      totalSat += (max - min);
      if (gray > 240) whiteBgCount++;
    }
    const avgSat = totalSat / total;
    const whiteBgRatio = whiteBgCount / total;
    // 双条件: 高饱和 + 极低白底 = AI 生成嫌疑
    const isAIPanda = avgSat > 28 && whiteBgRatio < 0.10;
    _aiPandaCache.set(imgUrl, isAIPanda);
    return isAIPanda;
  } catch {
    return false;  // 失败兜底保留 (不误杀)
  }
}

/** Blob → base64 (不含 data: 前缀) — 沉淀工具传给后端写盘用 */
export async function blobToBase64(blob: Blob): Promise<string> {
  const dataUrl = await blobToDataUrl(blob);
  const idx = dataUrl.indexOf(',');
  return idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl;
}

const DEFAULT_FACE_OFFSET = { x: 100, y: 70, w: 250, h: 250 };

/**
 * 把 NetworkResult 包装成 Material 实例, 注入合成流程.
 *
 * src 走 proxyForCanvasDetect (固定 proxy) 而非智能路由 proxyImageUrl:
 *   - 编辑器 <img src={element.src}>: 用户浏览器 Referer=xiongmaotou.work, baidu/so360 部分 thumb
 *     看到第三方 referer 会 403 → 画板上图不显示. proxy 内部带正确 Referer 绕过.
 *   - composeMeme.loadImage 用 crossOrigin='anonymous': 跨域无 CORS header 会 tainted, proxy 返
 *     same-origin URL 不 tainted.
 *   - 用户感知: 缩略图 (PSP grid) 用 proxyImageUrl 智能路由 (国内 CDN hot-link 快);
 *     编辑器画板 (sidebar 点击后) 用 proxyForCanvasDetect (proxy 稳).
 */
export function makeNetworkMaterial(
  result: NetworkResult,
  kind: 'panda' | 'face',
): Material {
  const label = result.hint?.trim() || (kind === 'panda' ? '网络熊猫' : '网络人脸');
  const labelEn = kind === 'panda' ? 'Network Panda' : 'Network Face';
  return {
    id: `network-${kind}-${result.id.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 32)}`,
    src: proxyForCanvasDetect(result.src),  // 编辑器用, 必须 proxy
    labelCn: label.slice(0, 12),
    labelEn,
    tags: [],
    tagsEn: [],
    faceOffset: DEFAULT_FACE_OFFSET,
    kind: 'network',
  };
}
