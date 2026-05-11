// 校准工具的 localStorage 持久层
// 用户在 CalibrateAnchor 页面调好的 faceOffset + faceFill 存在这里，仅开发期/本地预览有效
// "导出全部 TS code"按钮把 overrides 拷成可粘贴的对象字面量 → 粘到 panda-manual-overrides.ts 永久生效

export interface AnchorOverride {
  faceOffset: { x: number; y: number; w: number; h: number };
  faceFill?: number; // 0.7-1.1, default 0.95
  // 字幕距离微调 (px, 350-coord 空间): 正数 = caption 往上挪贴近 panda, 负数 = 拉远
  // 修 wide-shape panda 透明 padding 检测不够紧、caption 看着太远的 case
  captionOffset?: number;
  ts: number;
}

const KEY = 'pmw-anchor-overrides-v1';

export function readAnchorOverrides(): Record<string, AnchorOverride> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}') as Record<string, AnchorOverride>;
  } catch {
    return {};
  }
}

export function readAnchorOverride(pandaId: string): AnchorOverride | undefined {
  return readAnchorOverrides()[pandaId];
}

export const ANCHOR_CHANGED_EVENT = 'pmw-anchor-changed';

function notify() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(ANCHOR_CHANGED_EVENT));
  }
}

export function saveAnchorOverride(pandaId: string, ov: Omit<AnchorOverride, 'ts'>): void {
  const all = readAnchorOverrides();
  all[pandaId] = { ...ov, ts: Date.now() };
  localStorage.setItem(KEY, JSON.stringify(all));
  notify();
}

export function removeAnchorOverride(pandaId: string): void {
  const all = readAnchorOverrides();
  delete all[pandaId];
  localStorage.setItem(KEY, JSON.stringify(all));
  notify();
}

export function clearAllAnchorOverrides(): void {
  localStorage.removeItem(KEY);
  notify();
}

// 导出 TS code，可直接粘贴到 panda-manual-overrides.ts
// 输出两个 export: PANDA_MANUAL_OVERRIDES (face anchor) + PANDA_CAPTION_OFFSETS (caption 偏移)
export function exportToTSCode(): string {
  const all = readAnchorOverrides();
  const ids = Object.keys(all).sort();
  const lines: string[] = [];
  lines.push('// 校准工具导出 — paste 到 src/data/panda-manual-overrides.ts 永久生效');
  lines.push(`// generated at ${new Date().toISOString()}`);
  lines.push('');
  lines.push('export const PANDA_MANUAL_OVERRIDES: Record<string, { x: number; y: number; w: number; h: number }> = {');
  for (const id of ids) {
    const o = all[id].faceOffset;
    const fill = all[id].faceFill;
    const note = fill && fill !== 0.95 ? ` // faceFill ${fill.toFixed(2)}` : '';
    lines.push(`  '${id}': { x: ${o.x}, y: ${o.y}, w: ${o.w}, h: ${o.h} },${note}`);
  }
  lines.push('};');
  lines.push('');

  // captionOffset 单独一个 map (仅输出非零值)
  const capIds = ids.filter(id => typeof all[id].captionOffset === 'number' && all[id].captionOffset !== 0);
  lines.push('export const PANDA_CAPTION_OFFSETS: Record<string, number> = {');
  for (const id of capIds) {
    lines.push(`  '${id}': ${all[id].captionOffset},`);
  }
  lines.push('};');
  return lines.join('\n');
}

// 读单个 panda 的 caption offset (默认 0)
export function readCaptionOffset(pandaId: string): number {
  return readAnchorOverrides()[pandaId]?.captionOffset ?? 0;
}

export function saveCaptionOffset(pandaId: string, offset: number): void {
  const all = readAnchorOverrides();
  const existing = all[pandaId];
  all[pandaId] = {
    faceOffset: existing?.faceOffset ?? { x: 100, y: 70, w: 250, h: 250 },
    faceFill: existing?.faceFill,
    captionOffset: offset === 0 ? undefined : offset,
    ts: Date.now(),
  };
  localStorage.setItem(KEY, JSON.stringify(all));
  notify();
}
