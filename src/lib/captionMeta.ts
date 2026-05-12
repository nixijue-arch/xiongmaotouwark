// captionMeta — DEV-only 用户 QuickMode 文案补充
// localStorage 池 + 导出 TS code 工具, 让用户在校准里持续补 caption
// pickRandomText 在 DEV 模式会自动合并这里的条目, QuickMode 抽签立即生效
//
// Contributed by PandaHead — github.com/jokkibtc/panda

import type { Mode } from '@/data/quickModeTexts';
import { ALL_MODES } from '@/data/quickModeTexts';

const STORAGE_KEY = 'pmw-caption-overrides-v1';
export const CAPTION_CHANGED_EVENT = 'pmw-caption-changed';

export interface UserCaption {
  id: string;
  text: string;
  lang: 'zh' | 'en';
  tags: Mode[];
  /** ISO 时间戳, 列表排序用 */
  ts: number;
}

function notify() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(CAPTION_CHANGED_EVENT));
  // 跨 tab 同步
  try {
    const ev = new StorageEvent('storage', { key: STORAGE_KEY });
    window.dispatchEvent(ev);
  } catch { /* ignore */ }
}

export function readUserCaptions(): UserCaption[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter(
        (e): e is UserCaption =>
          e &&
          typeof e.id === 'string' &&
          typeof e.text === 'string' &&
          (e.lang === 'zh' || e.lang === 'en') &&
          Array.isArray(e.tags),
      )
      // v5: 老数据可能带 'abstract' 等已废弃 tag → sanitize 过滤掉, 防 MODE_LABELS[t] 解引用空导致白屏
      .map((c) => ({
        ...c,
        tags: c.tags.filter((t) => (ALL_MODES as string[]).includes(t)) as Mode[],
      }));
  } catch {
    return [];
  }
}

// ============ 源 caption 删除 (DEV-only, 屏蔽源池里某条) ============
const DELETED_KEY = 'pmw-caption-deleted-v1';
export const DELETED_CHANGED_EVENT = 'pmw-caption-deleted-changed';

function notifyDeleted() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(DELETED_CHANGED_EVENT));
  window.dispatchEvent(new Event(CAPTION_CHANGED_EVENT));
}

export function readDeletedBaseCaptions(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(DELETED_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((t) => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

export function deleteBaseCaption(text: string): void {
  const cur = readDeletedBaseCaptions();
  if (cur.includes(text)) return;
  cur.push(text);
  try { localStorage.setItem(DELETED_KEY, JSON.stringify(cur)); notifyDeleted(); } catch { /* ignore */ }
}

export function undeleteBaseCaption(text: string): void {
  const cur = readDeletedBaseCaptions().filter((t) => t !== text);
  try { localStorage.setItem(DELETED_KEY, JSON.stringify(cur)); notifyDeleted(); } catch { /* ignore */ }
}

export function clearAllDeletedBase(): void {
  try { localStorage.removeItem(DELETED_KEY); notifyDeleted(); } catch { /* ignore */ }
}

function writeAll(list: UserCaption[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    notify();
  } catch { /* ignore */ }
}

export function addUserCaption(input: { text: string; lang: 'zh' | 'en'; tags: Mode[] }): UserCaption {
  const c: UserCaption = {
    id: `cap-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    text: input.text.trim(),
    lang: input.lang,
    tags: input.tags.filter((t) => (ALL_MODES as string[]).includes(t)),
    ts: Date.now(),
  };
  const all = readUserCaptions();
  // 同 lang 同文本就更新 tags, 不重复
  const dup = all.find((x) => x.lang === c.lang && x.text === c.text);
  if (dup) {
    dup.tags = Array.from(new Set([...dup.tags, ...c.tags]));
    dup.ts = c.ts;
    writeAll(all);
    return dup;
  }
  all.push(c);
  writeAll(all);
  return c;
}

export function updateUserCaption(id: string, patch: Partial<Pick<UserCaption, 'text' | 'lang' | 'tags'>>): void {
  const all = readUserCaptions();
  const i = all.findIndex((x) => x.id === id);
  if (i < 0) return;
  if (typeof patch.text === 'string') all[i].text = patch.text.trim();
  if (patch.lang === 'zh' || patch.lang === 'en') all[i].lang = patch.lang;
  if (Array.isArray(patch.tags)) all[i].tags = patch.tags.filter((t) => (ALL_MODES as string[]).includes(t));
  writeAll(all);
}

export function deleteUserCaption(id: string): void {
  const all = readUserCaptions().filter((x) => x.id !== id);
  writeAll(all);
}

export function clearAllUserCaptions(): void {
  writeAll([]);
}

/**
 * 导出"完整源" TS code — 把当前 base + 用户加的 − 用户删的 渲染成完整的 TEXTS_ZH/TEXTS_EN 数组
 * 直接覆盖 src/data/quickModeTexts.ts 里对应数组就行, 一次性把所有 localStorage 改动落到源文件
 */
export function exportCompleteSourceTS(
  baseZh: Array<{ text: string; tags: string[] }>,
  baseEn: Array<{ text: string; tags: string[] }>,
): string {
  const userCaps = readUserCaptions();
  const deletedSet = new Set(readDeletedBaseCaptions());

  const finalZh = [
    ...baseZh.filter((t) => !deletedSet.has(t.text)),
    ...userCaps.filter((c) => c.lang === 'zh').map((c) => ({ text: c.text, tags: c.tags as string[] })),
  ];
  const finalEn = [
    ...baseEn.filter((t) => !deletedSet.has(t.text)),
    ...userCaps.filter((c) => c.lang === 'en').map((c) => ({ text: c.text, tags: c.tags as string[] })),
  ];

  const fmt = (arr: Array<{ text: string; tags: string[] }>) =>
    arr.map((c) => {
      const tagsCode = c.tags.length ? c.tags.map((t) => `'${t}'`).join(', ') : "'roast'";
      return `  { text: ${JSON.stringify(c.text)}, tags: [${tagsCode}] },`;
    }).join('\n');

  const lines: string[] = [];
  lines.push('// === 完整源 export — 直接覆盖 src/data/quickModeTexts.ts 里的两个数组 ===');
  lines.push(`// generated ${new Date().toISOString()} · ZH ${finalZh.length} · EN ${finalEn.length}`);
  lines.push(`// (base ZH ${baseZh.length} - deleted ${deletedSet.size} + user ${userCaps.filter(c => c.lang==='zh').length})`);
  lines.push('');
  lines.push('export const TEXTS_ZH: ModedText[] = [');
  lines.push(fmt(finalZh));
  lines.push('];');
  lines.push('');
  lines.push('export const TEXTS_EN: ModedText[] = [');
  lines.push(fmt(finalEn));
  lines.push('];');
  return lines.join('\n');
}

/** 导出可粘到 TEXTS_ZH/EN 数组里的 TS code (仅用户加的, 不含删除) */
export function exportCaptionsTSCode(): string {
  const all = readUserCaptions();
  if (!all.length) return '// (no user captions yet)';
  const zh = all.filter((c) => c.lang === 'zh').sort((a, b) => a.ts - b.ts);
  const en = all.filter((c) => c.lang === 'en').sort((a, b) => a.ts - b.ts);
  const lines: string[] = [];
  lines.push('// === 用户在校准工具补的文案 — 粘到 src/data/quickModeTexts.ts 对应数组 ===');
  if (zh.length) {
    lines.push('');
    lines.push('// --- 中文 (插入 TEXTS_ZH 数组) ---');
    for (const c of zh) {
      const tagsCode = c.tags.length ? c.tags.map((t) => `'${t}'`).join(', ') : "'roast'";
      lines.push(`  { text: ${JSON.stringify(c.text)}, tags: [${tagsCode}] },`);
    }
  }
  if (en.length) {
    lines.push('');
    lines.push('// --- 英文 (插入 TEXTS_EN 数组) ---');
    for (const c of en) {
      const tagsCode = c.tags.length ? c.tags.map((t) => `'${t}'`).join(', ') : "'roast'";
      lines.push(`  { text: ${JSON.stringify(c.text)}, tags: [${tagsCode}] },`);
    }
  }
  return lines.join('\n');
}
