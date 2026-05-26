// vite-plugin-dev-sync — DEV-only 本地工具 → 源文件直接写入
//
// 注册端点:
//   POST /__sync/captions          → src/data/quickModeTexts.ts (TEXTS_ZH / TEXTS_EN)
//   POST /__sync/animate-templates → src/data/animateTemplates.ts (ANIMATE_TEMPLATES)
//
// DEV 工具调用这些端点把内存里编辑过的内容写回源文件,
// Vite HMR 自动 reload, 用户立即看到效果.
//
// 安全:
//   - apply: 'serve' — 只在 dev 起, prod build 完全不带这个插件
//   - 只接受 localhost 来源
//   - 路径固定 hardcode, 无 path traversal 风险

import type { Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

const TEXTS_FILE_REL = 'src/data/quickModeTexts.ts';
const ANIMATE_TEMPLATES_FILE_REL = 'src/data/animateTemplates.ts';

interface CaptionEntry {
  text: string;
  tags: string[];
}
interface CaptionPayload {
  zh: CaptionEntry[];
  en: CaptionEntry[];
}

interface AnimateTemplateEntry {
  id: string;
  name: string;
  desc: string;
  tags: string[];
  project: Record<string, unknown>;
}

const VALID_TAGS = new Set(['fomo', 'fud', 'roast']);
const SLUG_RE = /^[a-z0-9-]+$/;

function sanitizeEntry(e: unknown): CaptionEntry | null {
  if (!e || typeof e !== 'object') return null;
  const o = e as { text?: unknown; tags?: unknown };
  if (typeof o.text !== 'string' || !o.text.trim()) return null;
  if (!Array.isArray(o.tags)) return null;
  const tags = o.tags
    .filter((t: unknown): t is string => typeof t === 'string' && VALID_TAGS.has(t));
  return { text: o.text, tags };
}

function sanitizeTemplate(e: unknown): AnimateTemplateEntry | null {
  if (!e || typeof e !== 'object') return null;
  const o = e as {
    id?: unknown;
    name?: unknown;
    desc?: unknown;
    tags?: unknown;
    project?: unknown;
  };
  if (typeof o.id !== 'string' || !o.id.trim() || !SLUG_RE.test(o.id)) return null;
  if (typeof o.name !== 'string' || !o.name.trim()) return null;
  const desc = typeof o.desc === 'string' ? o.desc : '';
  const tags = Array.isArray(o.tags)
    ? o.tags.filter((t: unknown): t is string => typeof t === 'string')
    : [];
  if (
    !o.project ||
    typeof o.project !== 'object' ||
    Array.isArray(o.project)
  ) {
    return null;
  }
  // 验证可序列化 (跳过含循环引用 / 函数等的对象)
  try {
    JSON.stringify(o.project);
  } catch {
    return null;
  }
  return {
    id: o.id,
    name: o.name,
    desc,
    tags,
    project: o.project as Record<string, unknown>,
  };
}

// 输出单引号字符串 — 跟原文件风格一致, diff 友好
// 处理: \\, \', \n, \r, \t 转义
function singleQuoteString(s: string): string {
  return "'" + s
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    + "'";
}

function formatArrayBody(arr: CaptionEntry[]): string {
  return arr.map((c) => {
    const tagsCode = c.tags.length ? c.tags.map((t) => `'${t}'`).join(', ') : "'roast'";
    return `  { text: ${singleQuoteString(c.text)}, tags: [${tagsCode}] },`;
  }).join('\n');
}

function formatTemplateArrayBody(arr: AnimateTemplateEntry[]): string {
  return arr.map((t) => {
    const tagsCode = t.tags.length
      ? t.tags.map((tag) => `'${tag.replace(/'/g, "\\'")}'`).join(', ')
      : '';
    // JSON.stringify 给我们带 double-quoted keys 的 JS 对象字面量 — 仍是合法 TS
    const projectJSON = JSON.stringify(t.project, null, 2);
    // 缩进每行 4 空格, 让 project: { ... } 跟外层 entry 一起对齐
    const projectIndented = projectJSON.split('\n').map((line, i) => i === 0 ? line : '    ' + line).join('\n');
    return [
      '  {',
      `    id: ${singleQuoteString(t.id)},`,
      `    name: ${singleQuoteString(t.name)},`,
      `    desc: ${singleQuoteString(t.desc)},`,
      `    tags: [${tagsCode}],`,
      `    project: ${projectIndented},`,
      '  },',
    ].join('\n');
  }).join('\n');
}

/**
 * 替换文件里 `export const VARNAME: TYPENAME[] = [...];` 的数组内容.
 * 用 bracket-counting 找配对的 `]`, 防止跨数组误匹配.
 *
 * typeName 默认 'ModedText' 保持向后兼容.
 */
function replaceArrayInSource(
  content: string,
  varName: string,
  newBody: string,
  typeName: string = 'ModedText',
): string {
  const startPattern = new RegExp(`(export const ${varName}: ${typeName}\\[\\] = \\[)`);
  const m = content.match(startPattern);
  if (!m) throw new Error(`Cannot locate ${varName}: ${typeName}[] declaration`);

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

function isLocalhostHost(host: string | undefined): boolean {
  const h = (host || '').split(':')[0];
  return h === 'localhost' || h === '127.0.0.1' || h === '::1';
}

function readBody(req: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString('utf-8'); });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
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
        if (!isLocalhostHost(req.headers.host)) {
          res.statusCode = 403;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'localhost_only' }));
          return;
        }

        readBody(req).then((body) => {
          try {
            const raw = JSON.parse(body) as { zh?: unknown[]; en?: unknown[] };
            const zh = (Array.isArray(raw.zh) ? raw.zh : []).map(sanitizeEntry).filter((e): e is CaptionEntry => e !== null);
            const en = (Array.isArray(raw.en) ? raw.en : []).map(sanitizeEntry).filter((e): e is CaptionEntry => e !== null);

            // 防误清空: 两个数组都为 0 直接拒绝, 避免误清掉整个文案库
            if (zh.length === 0 && en.length === 0) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'refused_empty_payload', hint: '至少保留一条 caption, 不然会清空整个池子' }));
              return;
            }

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
        }).catch((e: unknown) => {
          const msg = e instanceof Error ? e.message : String(e);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: msg }));
        });
      });

      server.middlewares.use('/__sync/animate-templates', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'method_not_allowed' }));
          return;
        }

        if (!isLocalhostHost(req.headers.host)) {
          res.statusCode = 403;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'localhost_only' }));
          return;
        }

        readBody(req).then((body) => {
          try {
            const raw = JSON.parse(body) as { templates?: unknown[] };
            const templates = (Array.isArray(raw.templates) ? raw.templates : [])
              .map(sanitizeTemplate)
              .filter((t): t is AnimateTemplateEntry => t !== null);

            // 防误清空: 一个都没有直接拒绝
            if (templates.length === 0) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({
                error: 'refused_empty_payload',
                hint: '至少保留一个模板, 不然会清空整个模板库',
              }));
              return;
            }

            // 检查重复 id
            const seenIds = new Set<string>();
            for (const t of templates) {
              if (seenIds.has(t.id)) {
                res.statusCode = 400;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: 'duplicate_id', id: t.id }));
                return;
              }
              seenIds.add(t.id);
            }

            const filePath = path.resolve(server.config.root, ANIMATE_TEMPLATES_FILE_REL);
            let content = fs.readFileSync(filePath, 'utf-8');
            content = replaceArrayInSource(
              content,
              'ANIMATE_TEMPLATES',
              formatTemplateArrayBody(templates),
              'AnimateTemplate',
            );
            fs.writeFileSync(filePath, content, 'utf-8');

            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({
              ok: true,
              count: templates.length,
              ids: templates.map((t) => t.id),
              file: ANIMATE_TEMPLATES_FILE_REL,
            }));
            // eslint-disable-next-line no-console
            console.log(`[dev-sync] wrote ${templates.length} animate templates → ${ANIMATE_TEMPLATES_FILE_REL}`);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: msg }));
            // eslint-disable-next-line no-console
            console.error('[dev-sync] animate-templates write failed:', msg);
          }
        }).catch((e: unknown) => {
          const msg = e instanceof Error ? e.message : String(e);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: msg }));
        });
      });
    },
  };
}
