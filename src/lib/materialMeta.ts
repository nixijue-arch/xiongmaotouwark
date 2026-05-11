// 素材管理: 用户对每个 panda / face 的元数据修改
// - rename (覆盖 labelCn / labelEn)
// - hide (从用户端选择面板里隐藏)
// 都存 localStorage. DEV 校准工具里可视化管理 + export TS code.
//
// Contributed by PandaHead

import type { Mode } from '@/data/quickModeTexts';

const KEY = 'pmw-material-meta-v1';

export interface MaterialMetaEntry {
  /** 覆盖原 labelCn */
  labelCn?: string;
  /** 覆盖原 labelEn */
  labelEn?: string;
  /** 隐藏 (用户端 picker 不显示) */
  hidden?: boolean;
  /** mode tag — 让素材跟文案模式联动 (后续 QuickMode 可以按 mode 过滤 panda/face 池) */
  tags?: Mode[];
}

export type MaterialMeta = Record<string, MaterialMetaEntry>;

export const MATERIAL_META_CHANGED_EVENT = 'pmw-material-meta-changed';

function notify() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(MATERIAL_META_CHANGED_EVENT));
  }
}

export function readMaterialMeta(): MaterialMeta {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}') as MaterialMeta;
  } catch {
    return {};
  }
}

export function readMaterialMetaEntry(id: string): MaterialMetaEntry | undefined {
  return readMaterialMeta()[id];
}

export function saveMaterialMetaEntry(id: string, patch: Partial<MaterialMetaEntry>): void {
  const all = readMaterialMeta();
  const merged: MaterialMetaEntry = { ...(all[id] || {}), ...patch };
  // 清理: 空字段不存
  if (!merged.labelCn) delete merged.labelCn;
  if (!merged.labelEn) delete merged.labelEn;
  if (!merged.hidden) delete merged.hidden;
  if (!merged.tags || merged.tags.length === 0) delete merged.tags;
  if (Object.keys(merged).length === 0) {
    delete all[id];
  } else {
    all[id] = merged;
  }
  localStorage.setItem(KEY, JSON.stringify(all));
  notify();
}

/** DEV-only 读 material 上的 mode tags (用户在素材管理页打的) */
export function readMaterialTags(id: string): Mode[] {
  if (typeof window === 'undefined') return [];
  try {
    const all = readMaterialMeta();
    return all[id]?.tags ?? [];
  } catch {
    return [];
  }
}

export function clearMaterialMetaEntry(id: string): void {
  const all = readMaterialMeta();
  delete all[id];
  localStorage.setItem(KEY, JSON.stringify(all));
  notify();
}

export function clearAllMaterialMeta(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(KEY);
    notify();
  }
}

// 导出 TS code 让 user 粘到 materials data file 永久生效
export function exportMaterialMetaTSCode(): string {
  const all = readMaterialMeta();
  const ids = Object.keys(all).sort();
  if (ids.length === 0) return '// 没有素材覆盖, 不用 paste';
  const lines: string[] = [];
  lines.push('// 校准工具素材管理导出 — paste 进 src/data/material-meta-overrides.ts');
  lines.push(`// generated ${new Date().toISOString()}`);
  lines.push('export const MATERIAL_META_OVERRIDES: Record<string, { labelCn?: string; labelEn?: string; hidden?: boolean; tags?: string[] }> = {');
  for (const id of ids) {
    const e = all[id];
    const parts: string[] = [];
    if (e.labelCn) parts.push(`labelCn: ${JSON.stringify(e.labelCn)}`);
    if (e.labelEn) parts.push(`labelEn: ${JSON.stringify(e.labelEn)}`);
    if (e.hidden) parts.push(`hidden: true`);
    if (e.tags && e.tags.length) parts.push(`tags: [${e.tags.map((t) => `'${t}'`).join(', ')}]`);
    lines.push(`  ${JSON.stringify(id)}: { ${parts.join(', ')} },`);
  }
  lines.push('};');
  return lines.join('\n');
}
