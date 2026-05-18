#!/usr/bin/env node
// 把后端字典 (single source of truth) 复制到前端 src/data/
// 后端 file:  netlify/functions/_lib/emotionDict.ts
// 前端 file:  src/data/emotionDict.ts (AUTO-GENERATED)
//
// predev/prebuild hook 在 package.json scripts 里挂.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');

const SRC = resolve(ROOT, 'netlify/functions/_lib/emotionDict.ts');
const DST = resolve(ROOT, 'src/data/emotionDict.ts');

if (!existsSync(SRC)) {
  console.error(`[sync-emotion-dict] source not found: ${SRC}`);
  process.exit(1);
}

const content = readFileSync(SRC, 'utf-8');

const header = `// ============================================================
// AUTO-GENERATED — DO NOT EDIT MANUALLY
// Source:    netlify/functions/_lib/emotionDict.ts
// Regenerate: node scripts/sync-emotion-dict.mjs (or just 'bun run dev' / 'bun run build')
// ============================================================

`;

const out = header + content;

// 确保 dst 目录存在
const dstDir = dirname(DST);
if (!existsSync(dstDir)) mkdirSync(dstDir, { recursive: true });

let prevContent = '';
if (existsSync(DST)) prevContent = readFileSync(DST, 'utf-8');

if (prevContent === out) {
  // 内容一致, 跳过写盘避免触发不必要 HMR reload
  console.log('[sync-emotion-dict] already up-to-date');
  process.exit(0);
}

writeFileSync(DST, out, 'utf-8');
console.log(`[sync-emotion-dict] ✓ ${SRC} → ${DST}`);
