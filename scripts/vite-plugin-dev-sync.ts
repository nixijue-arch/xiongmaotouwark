// vite-plugin-dev-sync — DEV-only 本地工具 → 源文件直接写入
//
// 注册 POST /__sync/captions 端点, DEV 文案管理点 "保存到源文件" 时 fetch 这里,
// 插件把内容写到 src/data/quickModeTexts.ts 替换 TEXTS_ZH / TEXTS_EN 数组.
// Vite HMR 自动 reload, 用户立即看到新源池.
//
// 安全:
//   - apply: 'serve' — 只在 dev 起, prod build 完全不带这个插件
//   - 只接受 localhost 来源
//   - 路径固定 hardcode, 无 path traversal 风险

import type { Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

const TEXTS_FILE_REL = 'src/data/quickModeTexts.ts';

interface CaptionEntry {
  text: string;
  tags: string[];
}
interface CaptionPayload {
  zh: CaptionEntry[];
  en: CaptionEntry[];
}

const VALID_TAGS = new Set(['fomo', 'fud', 'roast']);

function sanitizeEntry(e: unknown): CaptionEntry | null {
  if (!e || typeof e !== 'object') return null;
  const o = e as { text?: unknown; tags?: unknown };
  if (typeof o.text !== 'string' || !o.text.trim()) return null;
  if (!Array.isArray(o.tags)) return null;
  const tags = o.tags
    .filter((t: unknown): t is string => typeof t === 'string' && VALID_TAGS.has(t));
  return { text: o.text, tags };
}

function formatArrayBody(arr: CaptionEntry[]): string {
  return arr.map((c) => {
    const tagsCode = c.tags.length ? c.tags.map((t) => `'${t}'`).join(', ') : "'roast'";
    return `  { text: ${JSON.stringify(c.text)}, tags: [${tagsCode}] },`;
  }).join('\n');
}

/**
 * 替换文件里 `export const VARNAME: ModedText[] = [...];` 的数组内容.
 * 用 bracket-counting 找配对的 `];`, 防止跨数组误匹配.
 */
function replaceArrayInSource(content: string, varName: string, newBody: string): string {
  const startPattern = new RegExp(`(export const ${varName}: ModedText\\[\\] = \\[)`);
  const m = content.match(startPattern);
  if (!m) throw new Error(`Cannot locate ${varName} declaration`);

  const startIdx = (m.index as number) + m[0].length;

  // 配对 ] 的位置 — 跳过嵌套的 [tag] 之类
  let depth = 1;
  let i = startIdx;
  while (i < content.length) {
    const ch = content[i];
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) break;
    } else if (ch === "'" || ch === '"' || ch === '`') {
      // skip string literal
      const quote = ch;
      i++;
      while (i < content.length && content[i] !== quote) {
        if (content[i] === '\\') i++;
        i++;
      }
    }
    i++;
  }
  if (depth !== 0) throw new Error(`Unbalanced brackets in ${varName}`);

  // 替换 [ 后到 ] 前的内容
  return content.substring(0, startIdx) + '\n' + newBody + '\n' + content.substring(i);
}

export function devSyncPlugin(): Plugin {
  return {
    name: 'dev-sync-captions',
    apply: 'serve', // 只在 dev 启用, prod build 不挂载
    configureServer(server) {
      server.middlewares.use('/__sync/captions', (req, res) => {
        // 只接受 POST
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'method_not_allowed' }));
          return;
        }

        // localhost 限制
        const host = (req.headers.host || '').split(':')[0];
        if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') {
          res.statusCode = 403;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'localhost_only' }));
          return;
        }

        let body = '';
        req.on('data', (chunk: Buffer) => { body += chunk.toString('utf-8'); });
        req.on('end', () => {
          try {
            const raw = JSON.parse(body) as { zh?: unknown[]; en?: unknown[] };
            const zh = (Array.isArray(raw.zh) ? raw.zh : []).map(sanitizeEntry).filter((e): e is CaptionEntry => e !== null);
            const en = (Array.isArray(raw.en) ? raw.en : []).map(sanitizeEntry).filter((e): e is CaptionEntry => e !== null);

            const filePath = path.resolve(server.config.root, TEXTS_FILE_REL);
            let content = fs.readFileSync(filePath, 'utf-8');
            content = replaceArrayInSource(content, 'TEXTS_ZH', formatArrayBody(zh));
            content = replaceArrayInSource(content, 'TEXTS_EN', formatArrayBody(en));
            fs.writeFileSync(filePath, content, 'utf-8');

            const payload: CaptionPayload = { zh, en };
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({
              ok: true,
              zh: payload.zh.length,
              en: payload.en.length,
              file: TEXTS_FILE_REL,
            }));
            // eslint-disable-next-line no-console
            console.log(`[dev-sync] wrote ${zh.length} ZH + ${en.length} EN → ${TEXTS_FILE_REL}`);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: msg }));
            // eslint-disable-next-line no-console
            console.error('[dev-sync] write failed:', msg);
          }
        });
      });
    },
  };
}
