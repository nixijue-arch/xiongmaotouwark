// vite-plugin-network-pool-sync — DEV-only "⭐ 沉淀" 工具后端
//
// 注册端点:
//   POST /__sync/network-pool  → 写盘到:
//     public/assets/network-pool/{id}.png
//     src/data/network-pool.ts (按 kind append 进 NETWORK_PANDAS / NETWORK_FACES / NETWORK_SCENES)
//
// 仿 scripts/vite-plugin-dev-sync.ts (replaceArrayInSource / singleQuoteString / sanitize 模式)
//
// 安全:
//   - apply: 'serve' — prod build 完全不挂
//   - 仅接受 localhost / LAN 来源
//   - id 走 SLUG_RE 验证, 防 path traversal
//   - 一旦同 id 已存在 → 409, 不覆盖

import type { Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

const POOL_FILE_REL = 'src/data/network-pool.ts';
const ASSETS_DIR_REL = 'public/assets/network-pool';

// id 形如: network-{kind}-{8-32位 lowercase alnum}
const ID_RE = /^network-(panda|face|scene)-[a-z0-9]{1,32}$/;

interface SaveItem {
  id: string;
  kind: 'panda' | 'face' | 'scene';
  labelCn: string;
  labelEn: string;
  tags: string[];
  tagsEn: string[];
  sourceUrl?: string;
  blobBase64: string;
}

function sanitize(o: unknown): SaveItem | null {
  if (!o || typeof o !== 'object') return null;
  const r = o as Record<string, unknown>;
  if (typeof r.id !== 'string' || !ID_RE.test(r.id)) return null;
  if (r.kind !== 'panda' && r.kind !== 'face' && r.kind !== 'scene') return null;
  if (typeof r.labelCn !== 'string' || !r.labelCn.trim()) return null;
  if (typeof r.blobBase64 !== 'string' || r.blobBase64.length < 100) return null;
  const tags = Array.isArray(r.tags)
    ? r.tags.filter((t): t is string => typeof t === 'string').slice(0, 10).map((t) => t.slice(0, 20))
    : [];
  const tagsEn = Array.isArray(r.tagsEn)
    ? r.tagsEn.filter((t): t is string => typeof t === 'string').slice(0, 10).map((t) => t.slice(0, 20))
    : [];
  return {
    id: r.id,
    kind: r.kind,
    labelCn: r.labelCn.trim().slice(0, 30),
    labelEn: typeof r.labelEn === 'string' && r.labelEn.trim()
      ? r.labelEn.trim().slice(0, 30)
      : r.labelCn.trim().slice(0, 30),
    tags,
    tagsEn,
    sourceUrl: typeof r.sourceUrl === 'string' ? r.sourceUrl.slice(0, 500) : undefined,
    blobBase64: r.blobBase64,
  };
}

function escSingleQuote(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r');
}

function tagsLiteral(tags: string[]): string {
  return tags.map((t) => `'${escSingleQuote(t)}'`).join(', ');
}

/** 返回 ] 字符所在 index (matching opening [) — 用于 append entry */
function findClosingBracket(content: string, varName: string): number {
  const startPattern = new RegExp(`(export const ${varName}: Material\\[\\] = \\[)`);
  const m = content.match(startPattern);
  if (!m) throw new Error(`Cannot locate ${varName} declaration`);
  const startIdx = (m.index as number) + m[0].length;

  let depth = 1;
  let i = startIdx;
  while (i < content.length) {
    const ch = content[i];
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) return i;
    } else if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      i++;
      while (i < content.length && content[i] !== quote) {
        if (content[i] === '\\') i++;
        i++;
      }
    }
    i++;
  }
  throw new Error(`Unbalanced brackets in ${varName}`);
}

function appendEntry(content: string, varName: string, entryLine: string): string {
  const closeIdx = findClosingBracket(content, varName);
  return content.substring(0, closeIdx) + entryLine + '\n' + content.substring(closeIdx);
}

function isLocalhost(addr: string | undefined): boolean {
  if (!addr) return false;
  return (
    addr === '127.0.0.1' ||
    addr === '::1' ||
    addr === '::ffff:127.0.0.1' ||
    addr.startsWith('192.168.') ||
    addr.startsWith('10.') ||
    addr.startsWith('::ffff:192.168.') ||
    addr.startsWith('::ffff:10.')
  );
}

export function networkPoolSyncPlugin(): Plugin {
  return {
    name: 'network-pool-sync',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__sync/network-pool', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'method_not_allowed' }));
          return;
        }
        const remoteAddr = req.socket.remoteAddress;
        if (!isLocalhost(remoteAddr)) {
          res.statusCode = 403;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'localhost_only', got: remoteAddr }));
          return;
        }

        let body = '';
        req.on('data', (chunk: Buffer) => {
          body += chunk.toString('utf-8');
          if (body.length > 20 * 1024 * 1024) {
            req.destroy();
          }
        });
        req.on('end', () => {
          try {
            const raw = JSON.parse(body);
            const item = sanitize(raw);
            if (!item) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'invalid_payload' }));
              return;
            }

            // 1. Decode base64 → write PNG
            const assetsDir = path.resolve(server.config.root, ASSETS_DIR_REL);
            if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });
            const pngPath = path.join(assetsDir, `${item.id}.png`);
            const buf = Buffer.from(item.blobBase64, 'base64');
            if (buf.length === 0 || buf.length > 10 * 1024 * 1024) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'invalid_blob_size', size: buf.length }));
              return;
            }
            fs.writeFileSync(pngPath, buf);

            // 2. Modify src/data/network-pool.ts — append to right array
            const arrayName =
              item.kind === 'panda' ? 'NETWORK_PANDAS' :
              item.kind === 'face' ? 'NETWORK_FACES' :
              'NETWORK_SCENES';
            const src = `./assets/network-pool/${item.id}.png`;
            const entryLine =
              `  { id: '${escSingleQuote(item.id)}', src: '${escSingleQuote(src)}', ` +
              `labelCn: '${escSingleQuote(item.labelCn)}', labelEn: '${escSingleQuote(item.labelEn)}', ` +
              `tags: [${tagsLiteral(item.tags)}], tagsEn: [${tagsLiteral(item.tagsEn)}], ` +
              `faceOffset: { x: 100, y: 70, w: 250, h: 250 }, kind: 'network' },`;

            const filePath = path.resolve(server.config.root, POOL_FILE_REL);
            let content = fs.readFileSync(filePath, 'utf-8');

            // 防重复 id (覆盖会破坏 HMR + 用户预期)
            if (content.includes(`id: '${item.id}'`)) {
              res.statusCode = 409;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'id_exists', id: item.id }));
              return;
            }
            content = appendEntry(content, arrayName, entryLine);
            fs.writeFileSync(filePath, content, 'utf-8');

            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({
              ok: true,
              id: item.id,
              kind: item.kind,
              arrayName,
              file: POOL_FILE_REL,
              pngFile: path.relative(server.config.root, pngPath).replace(/\\/g, '/'),
            }));
            // eslint-disable-next-line no-console
            console.log(`[network-pool-sync] ✓ sunk ${item.id} → ${arrayName}`);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: msg }));
            // eslint-disable-next-line no-console
            console.error('[network-pool-sync] failed:', msg);
          }
        });
      });
    },
  };
}
