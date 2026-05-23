// 草图本聚合用 — 沙雕动画两个模式(视频/GIF)的草稿 的共享类型 / IDB key / 读取&删除&打开 helper.
// collection.tsx 走这里聚合三格式 (图片走 memecontext), 不直接 import 沉重的 animatemode/gifmode (保 lazy 拆包).
// ⚠️ 下面的 key / 类型必须跟 animatemode.tsx / gifmode.tsx 里的本地定义一致 (它们各自持有同名常量).
import { get as idbGet, set as idbSet } from 'idb-keyval';
import type { ProjectState } from '@/lib/animcore';
import type { GifProject } from '@/lib/gifloop';

export const AM_DRAFT_IDB_KEY = 'xiongmaotou.animate-drafts.v1';        // 视频草稿列表
export const AM_VIDEO_CURRENT_IDB_KEY = 'xiongmaotou.animate-current.video.v1'; // 视频"当前项目"(mount 时 hydrate)
export const GIF_DRAFTS_IDB_KEY = 'xiongmaotou.gifmode-drafts.v1';     // GIF 草稿列表
export const GIF_PROJECT_IDB_KEY = 'xiongmaotou.gifmode-current.v1';   // GIF"当前项目"(mount 时 hydrate)
export const ANIMATE_VIEW_KEY = 'xmw.animate-view';                    // 'video' | 'gif' (AnimateMode 初始 view)
export const ANIMATE_OPEN_EXPORT_KEY = 'xmw.animate-open-export';     // 置 '1' → AnimateMode mount 后自动开导出弹窗 (草图本"导出视频"用)

export interface AnimateDraftSlot { id: string; name: string; updatedAt: number; project: ProjectState; note?: string; thumbSrc?: string; }
export interface GifDraftSlot { id: string; name: string; updatedAt: number; project: GifProject; thumbSrc?: string; }

export async function listAnimateDrafts(): Promise<AnimateDraftSlot[]> {
  try { return (await idbGet<AnimateDraftSlot[]>(AM_DRAFT_IDB_KEY)) ?? []; } catch { return []; }
}
export async function listGifDrafts(): Promise<GifDraftSlot[]> {
  try { return (await idbGet<GifDraftSlot[]>(GIF_DRAFTS_IDB_KEY)) ?? []; } catch { return []; }
}
export async function deleteAnimateDraft(id: string): Promise<AnimateDraftSlot[]> {
  const a = (await listAnimateDrafts()).filter(d => d.id !== id);
  try { await idbSet(AM_DRAFT_IDB_KEY, a); } catch { /* */ }
  return a;
}
export async function deleteGifDraft(id: string): Promise<GifDraftSlot[]> {
  const a = (await listGifDrafts()).filter(d => d.id !== id);
  try { await idbSet(GIF_DRAFTS_IDB_KEY, a); } catch { /* */ }
  return a;
}
// 打开草稿到沙雕动画: 写"当前项目"key + 初始 view → 导航到 animate 页, 编辑器 mount 时从该 key hydrate.
// (零侵入 — 不改 animatemode/gifmode 的 load 逻辑, 复用它们 mount 时已有的 current-key 水合.)
export async function openVideoDraftInAnimate(slot: AnimateDraftSlot): Promise<void> {
  try { localStorage.setItem(ANIMATE_VIEW_KEY, 'video'); } catch { /* */ }
  try { await idbSet(AM_VIDEO_CURRENT_IDB_KEY, slot.project); } catch { /* */ }
}
export async function openGifDraftInAnimate(slot: GifDraftSlot): Promise<void> {
  try { localStorage.setItem(ANIMATE_VIEW_KEY, 'gif'); } catch { /* */ }
  try { await idbSet(GIF_PROJECT_IDB_KEY, slot.project); } catch { /* */ }
}
// 改名 (写回各自 IDB 列表)
export async function renameGifDraft(id: string, name: string): Promise<GifDraftSlot[]> {
  const a = (await listGifDrafts()).map(d => d.id === id ? { ...d, name } : d);
  try { await idbSet(GIF_DRAFTS_IDB_KEY, a); } catch { /* */ }
  return a;
}
export async function renameAnimateDraft(id: string, name: string): Promise<AnimateDraftSlot[]> {
  const a = (await listAnimateDrafts()).map(d => d.id === id ? { ...d, name } : d);
  try { await idbSet(AM_DRAFT_IDB_KEY, a); } catch { /* */ }
  return a;
}
// 导出视频草稿 = 载入编辑器 + 标记自动开导出弹窗 (完整管线: 配音/BGM/分辨率/格式; 草图本不直接跑重型 MediaRecorder)
export async function openVideoDraftForExport(slot: AnimateDraftSlot): Promise<void> {
  await openVideoDraftInAnimate(slot);
  try { localStorage.setItem(ANIMATE_OPEN_EXPORT_KEY, '1'); } catch { /* */ }
}
