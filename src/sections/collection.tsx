// Collection v3 — 草图管理板块
// 数据源完全统一到 memecontext 的 draftSlots (与编辑器左上角"本地草稿"共享)
// Contributed by PandaHead (https://pandahead.fun · github.com/jsybtc/panda)

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
// JSZip 改为批量导出时动态 import (~28KB gz 不进主包, 见 packSelected)
import { useMeme } from '@/context/memecontext';
import type { DraftSlot, ImageElement, MemeElement, TextElement } from '@/context/memecontext';
import {
  listGifDrafts, listAnimateDrafts, deleteGifDraft, deleteAnimateDraft,
  openGifDraftInAnimate, openVideoDraftInAnimate, openVideoDraftForExport,
  renameGifDraft, renameAnimateDraft,
  type GifDraftSlot, type AnimateDraftSlot,
} from '@/lib/animatedrafts';
import { exportGIFLoop } from '@/lib/gifloop';
import { ALL_PANDAS, ALL_FACES, getLivePandaFaceOffset, getLiveCaptionOffset } from '@/data/materials';
import { useLiveAnchor } from '@/hooks/useLiveAnchor';
import { captureNode, copyImageToClipboard, downloadImage } from '@/lib/exportImage';
import { composeMeme } from '@/lib/composeMeme';
import { PandaCanvas } from '@/components/pandacanvas';
import {
  FolderOpen, Copy, Download, Trash2, SquarePen, Sparkles, Edit2, Check, X,
  Package, FolderInput,
} from 'lucide-react';
import { toast } from 'sonner';
import './collection.css';

interface CollectionProps {
  onOpenQuick: () => void;
  onOpenEditor: () => void;
  onOpenAnimate: () => void;   // 打开 GIF/视频草稿 → 切到沙雕动画板块
}

// 三格式: 图片(memecontext draftSlots) / GIF / 视频(沙雕动画两模式草稿)
type Filter = 'all' | 'image' | 'gif' | 'video';
type GalleryRow =
  | { kind: 'image'; updatedAt: number; id: string; slot: DraftSlot }
  | { kind: 'gif'; updatedAt: number; id: string; slot: GifDraftSlot }
  | { kind: 'video'; updatedAt: number; id: string; slot: AnimateDraftSlot };

// 判定 element 是不是 panda / face — 跟 leftsidebar / quickmode 同款
function isPanda(e: MemeElement): boolean {
  if (e.type !== 'image') return false;
  const name = (e as ImageElement).name;
  return name === 'panda-head'
    || ALL_PANDAS.some(p => p.id === name)
    || name.startsWith('upload-panda-')
    || name.startsWith('network-panda-')   // ⭐ 联网搜的 panda
    || name.startsWith('custom-panda-');    // ⭐ 用户上传的 panda
}
function isFace(e: MemeElement): boolean {
  if (e.type !== 'image') return false;
  const name = (e as ImageElement).name;
  return ALL_FACES.some(f => f.id === name)
    || name.startsWith('upload-face-')
    || name.startsWith('custom-face-')
    || name.startsWith('network-face-');    // ⭐ 联网搜的 face
}

// 从 slot 抽出 panda / face / text 信息, 给预览渲染 + ZIP 打包用
interface SlotInfo {
  panda: { src: string; id: string; faceOffset: { x: number; y: number; w: number; h: number } } | null;
  face: { src: string; id: string } | null;
  text: string;
  fontFamily: string;
}
function extractSlotInfo(slot: DraftSlot): SlotInfo {
  const elements = slot.state?.elements ?? [];
  const pandaEl = elements.find((e): e is ImageElement => e.type === 'image' && isPanda(e));
  const faceEl = elements.find((e): e is ImageElement => e.type === 'image' && isFace(e));
  const textEl = elements.find((e): e is TextElement => e.type === 'text');

  let panda: SlotInfo['panda'] = null;
  if (pandaEl) {
    const matched = ALL_PANDAS.find(p => p.id === pandaEl.name);
    if (matched) {
      panda = { src: matched.src, id: matched.id, faceOffset: getLivePandaFaceOffset(matched) };
    } else {
      // 上传 / 旧 schema 的兜底 — 用 element 位置反推 faceOffset
      const fo = faceEl && pandaEl
        ? { x: faceEl.x - pandaEl.x, y: faceEl.y - pandaEl.y, w: faceEl.width, h: faceEl.height }
        : { x: 100, y: 70, w: 250, h: 250 };
      panda = { src: pandaEl.src, id: pandaEl.name, faceOffset: fo };
    }
  }
  let face: SlotInfo['face'] = null;
  if (faceEl) {
    const matched = ALL_FACES.find(f => f.id === faceEl.name);
    face = matched ? { src: matched.src, id: matched.id } : { src: faceEl.src, id: faceEl.name };
  }
  return {
    panda,
    face,
    text: textEl?.text ?? '',
    fontFamily: textEl?.fontFamily ?? 'sans-serif',
  };
}

export function Collection({ onOpenQuick, onOpenEditor, onOpenAnimate }: CollectionProps) {
  const { state, draftSlots, loadDraft, clearDraft, clearDrafts, renameDraft } = useMeme();
  const lang = state.language;
  // DEV: 校准工具改 anchor 时触发 re-render
  useLiveAnchor();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<Filter>('all');
  const [gifDrafts, setGifDrafts] = useState<GifDraftSlot[]>([]);
  const [videoDrafts, setVideoDrafts] = useState<AnimateDraftSlot[]>([]);
  const [loaded, setLoaded] = useState(false);
  const offscreenContainerRef = useRef<HTMLDivElement>(null);

  // 进页面读 GIF/视频草稿 (各自 IDB key, 见 animatedrafts) — 进来快照即可, 无需实时订阅
  useEffect(() => {
    let alive = true;
    void (async () => {
      const [g, v] = await Promise.all([listGifDrafts(), listAnimateDrafts()]);
      if (alive) { setGifDrafts(g); setVideoDrafts(v); setLoaded(true); }
    })();
    return () => { alive = false; };
  }, []);

  const counts = useMemo(() => ({
    all: draftSlots.length + gifDrafts.length + videoDrafts.length,
    image: draftSlots.length, gif: gifDrafts.length, video: videoDrafts.length,
  }), [draftSlots.length, gifDrafts.length, videoDrafts.length]);

  // 三源聚合 → 按 updatedAt 倒序; 按 tab 过滤
  const rows = useMemo<GalleryRow[]>(() => {
    const img = draftSlots.map((s): GalleryRow => ({ kind: 'image', updatedAt: s.updatedAt ?? 0, id: s.id, slot: s }));
    const gif = gifDrafts.map((s): GalleryRow => ({ kind: 'gif', updatedAt: s.updatedAt, id: s.id, slot: s }));
    const vid = videoDrafts.map((s): GalleryRow => ({ kind: 'video', updatedAt: s.updatedAt, id: s.id, slot: s }));
    const list = filter === 'image' ? img : filter === 'gif' ? gif : filter === 'video' ? vid : [...img, ...gif, ...vid];
    return list.sort((a, b) => b.updatedAt - a.updatedAt);
  }, [draftSlots, gifDrafts, videoDrafts, filter]);

  const toggleSelect = useCallback((id: string) => {
    setSelected((s) => {
      const ns = new Set(s);
      if (ns.has(id)) ns.delete(id);
      else ns.add(id);
      return ns;
    });
  }, []);

  const selectAll = useCallback(() => setSelected(new Set(draftSlots.map((d) => d.id))), [draftSlots]);   // 多选/ZIP 仅图片
  const clearSelection = useCallback(() => setSelected(new Set()), []);
  // 打开 GIF/视频草稿 → 写当前项目 key + view, 切到沙雕动画 (mount 时 hydrate)
  const openGif = useCallback(async (slot: GifDraftSlot) => { await openGifDraftInAnimate(slot); onOpenAnimate(); }, [onOpenAnimate]);
  const openVideo = useCallback(async (slot: AnimateDraftSlot) => { await openVideoDraftInAnimate(slot); onOpenAnimate(); }, [onOpenAnimate]);
  const delGif = useCallback(async (id: string) => { setGifDrafts(await deleteGifDraft(id)); toast.success(lang === 'zh' ? '已删除' : 'Deleted'); }, [lang]);
  const delVideo = useCallback(async (id: string) => { setVideoDrafts(await deleteAnimateDraft(id)); toast.success(lang === 'zh' ? '已删除' : 'Deleted'); }, [lang]);
  const renGif = useCallback(async (id: string, name: string) => { setGifDrafts(await renameGifDraft(id, name)); toast.success(lang === 'zh' ? '已改名' : 'Renamed'); }, [lang]);
  const renVideo = useCallback(async (id: string, name: string) => { setVideoDrafts(await renameAnimateDraft(id, name)); toast.success(lang === 'zh' ? '已改名' : 'Renamed'); }, [lang]);
  // 下载=导出: GIF 直接编码下载 (gif.js); 视频 → 载入编辑器自动开导出弹窗 (完整带配音/分辨率)
  const expGif = useCallback(async (slot: GifDraftSlot) => {
    const tid = toast.loading(lang === 'zh' ? '导出 GIF…' : 'Exporting GIF…');
    try { await exportGIFLoop(slot.project, slot.name, (p) => toast.loading(`${lang === 'zh' ? '导出 GIF' : 'GIF'} ${Math.round(p * 100)}%`, { id: tid })); toast.success(lang === 'zh' ? 'GIF 已导出' : 'GIF exported', { id: tid }); }
    catch { toast.error(lang === 'zh' ? '导出失败' : 'Export failed', { id: tid }); }
  }, [lang]);
  const expVideo = useCallback(async (slot: AnimateDraftSlot) => { await openVideoDraftForExport(slot); onOpenAnimate(); }, [onOpenAnimate]);

  const onBatchDelete = useCallback(() => {
    const count = selected.size;
    if (count === 0) return;
    // 用 clearDrafts 单次 setState + 单次 localStorage 写, 避免 forEach 多次 setState 触发的 batching/race
    clearDrafts(Array.from(selected));
    setSelected(new Set());
    toast.success(lang === 'zh' ? `已删除 ${count} 张` : `Deleted ${count}`);
  }, [selected, clearDrafts, lang]);

  // 批量 ZIP — 用 composeMeme 渲染 panda+face → 临时 DOM 加 caption → captureNode → 加进 zip
  const onBatchZip = useCallback(async () => {
    if (selected.size === 0) return;
    const slotsToPack = draftSlots.filter((s) => selected.has(s.id));
    if (!slotsToPack.length || !offscreenContainerRef.current) return;

    toast.info(lang === 'zh' ? `打包 ${slotsToPack.length} 张...` : `Packing ${slotsToPack.length}...`);

    try {
      const { default: JSZip } = await import('jszip');  // 动态加载, 不进主包
      const zip = new JSZip();
      const container = offscreenContainerRef.current;
      for (let i = 0; i < slotsToPack.length; i++) {
        const slot = slotsToPack[i];
        const info = extractSlotInfo(slot);
        if (!info.panda) continue;  // panda 必有 (face 可选, customPanda 路径无 face)
        // face 可选: 有 face 走 composeMeme 合成, 无 face 直接用 panda.src 整图
        const composedDataUrl = info.face
          ? await composeMeme({
              pandaSrc: info.panda.src,
              faceSrc: info.face.src,
              faceOffset: info.panda.faceOffset,
              size: 1024,
            })
          : info.panda.src;  // 整图直接用 (customPanda / 上传整图)
        const node = document.createElement('div');
        node.style.cssText =
          'position:absolute;left:-99999px;top:0;width:400px;background:#fff;display:flex;flex-direction:column;align-items:center;padding:25px 25px 30px;';
        node.innerHTML = `
          <img src="${composedDataUrl}" style="display:block;max-width:350px;max-height:350px;object-fit:contain;" />
          ${
            info.text
              ? `<div style="margin-top:22px;width:100%;max-width:360px;text-align:center;font-size:32px;font-weight:700;color:#000;padding:0 16px;line-height:1.2;word-break:break-word;font-family:${info.fontFamily || 'sans-serif'};">${info.text}</div>`
              : ''
          }
        `;
        container.appendChild(node);
        await new Promise((r) => setTimeout(r, 80));
        const blob = await captureNode(node);
        const safeName = (slot.name || info.text || `panda-${i + 1}`).replace(/[^\w一-龥-]/g, '_').slice(0, 40);
        zip.file(`${String(i + 1).padStart(2, '0')}-${safeName}.png`, blob);
        container.removeChild(node);
      }
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `panda-drafts-${Date.now()}.zip`;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 100);
      toast.success(lang === 'zh' ? `已打包 ${slotsToPack.length} 张 ZIP` : `Packed ${slotsToPack.length} as ZIP`);
    } catch (e) {
      toast.error(lang === 'zh' ? `打包失败: ${e instanceof Error ? e.message : 'unknown'}` : `Pack failed`);
    }
  }, [selected, draftSlots, lang]);

  // 进编辑器 = loadDraft(slotId) + 切到 editor 页
  // 不再像之前那样拆元素手动 dispatch — 直接用 slot 已保存的 elements
  const onSendToEditor = useCallback((slot: DraftSlot) => {
    if (!slot.state) {
      toast.error(lang === 'zh' ? '草图数据丢失' : 'Draft data missing');
      return;
    }
    loadDraft(slot.id);
    setTimeout(() => onOpenEditor(), 30);
  }, [loadDraft, lang, onOpenEditor]);

  // 空 state (三源都空 + 已读完 GIF/视频)
  if (loaded && counts.all === 0) {
    return (
      <div className="about-container about-arcade-shell col-root">
        <div className="about-page">
          <section className="about-banner-card" style={{ flexDirection: 'column', textAlign: 'center', padding: '40px 22px' }}>
            <FolderOpen size={48} color="#1767c7" />
            <h3 style={{ margin: '12px 0 6px', fontSize: 20, fontWeight: 800, color: '#0a356d' }}>
              {lang === 'zh' ? '草图本是空的' : 'No drafts yet'}
            </h3>
            <p style={{ margin: '0 0 18px', fontSize: 13, color: '#456' }}>
              {lang === 'zh' ? '图片 / GIF / 视频 草稿都会出现在这 · 去快速生图收藏，或在编辑器/沙雕动画里存草稿' : 'Image / GIF / Video drafts show up here'}
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={onOpenQuick} className="about-arcade-btn">
                <Sparkles size={14} />
                {lang === 'zh' ? '快速生图' : 'Quick Mode'}
              </button>
              <button onClick={onOpenAnimate} className="about-arcade-btn">
                <Sparkles size={14} />
                {lang === 'zh' ? '沙雕动画' : 'Animate'}
              </button>
            </div>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="about-container about-arcade-shell col-root">
      <div className="about-page">
      <section className="about-banner-card">
        <div className="about-banner-main">
          <div className="about-banner-icon"><FolderOpen size={32} color="#1767c7" /></div>
          <div>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: '#0a356d', display: 'flex', alignItems: 'center', gap: 10 }}>
              {lang === 'zh' ? '我的草图本' : 'My Drafts'}
              <span className="about-chip" style={{ padding: '4px 10px', fontSize: 12 }}>{counts.all}</span>
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: '#456' }}>
              {lang === 'zh' ? '图片 / GIF / 视频 三种草稿都在这 · 点开继续编辑 · 图片可多选打包 ZIP' : 'Image / GIF / Video drafts · click to open · multi-select images to ZIP'}
            </p>
          </div>
        </div>
        <div style={{ display: 'inline-flex', gap: 4, padding: 4, background: 'rgba(15, 93, 175, 0.1)', borderRadius: 12 }}>
          {(['all', 'image', 'gif', 'video'] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={filter === f ? 'about-arcade-btn' : ''}
              style={filter === f
                ? { padding: '6px 12px', fontSize: 13, borderRadius: 10 }
                : { padding: '6px 12px', fontSize: 13, color: '#0a356d', background: 'transparent', border: 'none', cursor: 'pointer', fontWeight: 600 }}
            >
              {(lang === 'zh' ? { all: '全部', image: '图片', gif: 'GIF', video: '视频' } : { all: 'All', image: 'Image', gif: 'GIF', video: 'Video' })[f]}{counts[f] > 0 ? ` ${counts[f]}` : ''}
            </button>
          ))}
        </div>
      </section>

      <div className="col-grid">
        {rows.map((row) => row.kind === 'image' ? (
          <DraftCard
            key={'i-' + row.id}
            slot={row.slot}
            lang={lang}
            isSelected={selected.has(row.id)}
            onToggleSelect={() => toggleSelect(row.id)}
            onDelete={() => { clearDraft(row.id); toast.success(lang === 'zh' ? '已删除' : 'Deleted'); }}
            onRename={(name) => { renameDraft(row.id, name); toast.success(lang === 'zh' ? '已改名' : 'Renamed'); }}
            onSendToEditor={() => onSendToEditor(row.slot)}
          />
        ) : (
          <AnimateDraftCard
            key={row.kind + '-' + row.id}
            kind={row.kind}
            name={row.slot.name}
            thumbSrc={row.slot.thumbSrc}
            lang={lang}
            onOpen={() => { if (row.kind === 'gif') void openGif(row.slot); else void openVideo(row.slot); }}
            onExport={() => { if (row.kind === 'gif') void expGif(row.slot); else void expVideo(row.slot); }}
            onRename={(name) => { if (row.kind === 'gif') void renGif(row.id, name); else void renVideo(row.id, name); }}
            onDelete={() => { if (row.kind === 'gif') void delGif(row.id); else void delVideo(row.id); }}
          />
        ))}
      </div>

      <div ref={offscreenContainerRef} style={{ position: 'absolute', left: -99999, top: 0 }} />

      {selected.size > 0 && (
        <div className="col-action-bar">
          <span className="col-bar-count">
            {lang === 'zh' ? `已选 ${selected.size}` : `${selected.size} selected`}
          </span>
          <span className="col-bar-divider" />
          <button onClick={selectAll} className="col-bar-btn">
            {lang === 'zh' ? '全选' : 'All'}
          </button>
          <button onClick={clearSelection} className="col-bar-btn">
            {lang === 'zh' ? '取消' : 'Clear'}
          </button>
          <span className="col-bar-divider" />
          <button onClick={onBatchZip} className="col-bar-btn col-bar-btn-primary">
            <Package size={14} /> {lang === 'zh' ? '打包 ZIP' : 'Pack ZIP'}
          </button>
          <button onClick={onBatchDelete} className="col-bar-btn col-bar-btn-danger">
            <Trash2 size={14} /> {lang === 'zh' ? '删除' : 'Delete'}
          </button>
        </div>
      )}
      </div>
    </div>
  );
}

// 完全隔离的 rename UI — 自己管 state, 父只听 onSubmit/onCancel
// 这样跟 DraftCard 的任何 props 变化 / re-render 解耦
function RenameRow({
  initialName,
  placeholder,
  onSubmit,
  onCancel,
}: {
  initialName: string;
  placeholder: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialName);
  return (
    <div
      className="draft-rename-row"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onSubmit(value.trim());
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
        placeholder={placeholder}
        className="draft-rename-input"
        onClick={(e) => e.stopPropagation()}
      />
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          // eslint-disable-next-line no-console
          console.log('[RenameRow] ✓ clicked, value=', value);
          onSubmit(value.trim());
        }}
        className="draft-rename-ok"
      >
        <Check size={12} />
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onCancel();
        }}
        className="draft-rename-cancel"
      >
        <X size={12} />
      </button>
    </div>
  );
}

interface DraftCardProps {
  slot: DraftSlot;
  lang: 'zh' | 'en';
  isSelected: boolean;
  onToggleSelect: () => void;
  onDelete: () => void;
  onRename: (name: string) => void;
  onSendToEditor: () => void;
}

function DraftCard({ slot, lang, isSelected, onToggleSelect, onDelete, onRename, onSendToEditor }: DraftCardProps) {
  const info = useMemo(() => extractSlotInfo(slot), [slot]);
  const previewRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);

  const tilt = useMemo(() => {
    let h = 0;
    for (const c of slot.id) h = (h * 31 + c.charCodeAt(0)) | 0;
    return ((h % 7) - 3) * 0.8;
  }, [slot.id]);

  // broken card (素材丢了) — 只要 panda 不存在就 broken (face 可有可无)
  // customPanda / 联网搜 整图 是 panda-only 路径 (无 face), 不能算 broken
  if (!info.panda) {
    return (
      <div
        className={'draft-card draft-card-broken ' + (isSelected ? 'draft-card-selected' : '')}
        style={{ transform: `rotate(${tilt}deg)`, cursor: 'pointer', position: 'relative' }}
        onClick={onToggleSelect}
      >
        <div className="draft-broken-msg">{lang === 'zh' ? '素材丢失' : 'Missing'}</div>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="draft-icon-btn draft-icon-btn-danger"
          title={lang === 'zh' ? '删除' : 'Delete'}
          style={{ position: 'absolute', top: 8, right: 8, zIndex: 5 }}
        >
          <Trash2 size={14} />
        </button>
        <div style={{ position: 'absolute', bottom: 8, left: 8, fontSize: 10, color: '#888' }}>
          {slot.name || info.text || lang === 'zh' ? `${info.panda?.id ?? '?'} + ${info.face?.id ?? '?'}` : ''}
        </div>
      </div>
    );
  }

  const onCopy = async () => {
    if (!previewRef.current) return;
    try {
      await copyImageToClipboard(previewRef.current);
      toast.success(lang === 'zh' ? '已复制' : 'Copied');
    } catch {
      toast.error(lang === 'zh' ? '复制失败' : 'Copy failed');
    }
  };

  const onDownload = async () => {
    if (!previewRef.current) return;
    try {
      // face 可选 (customPanda 整图无 face)
      const filename = info.face
        ? `panda-${info.panda!.id}-${info.face.id}-${Date.now()}.png`
        : `panda-${info.panda!.id}-${Date.now()}.png`;
      await downloadImage(previewRef.current, filename);
    } catch {
      toast.error(lang === 'zh' ? '下载失败' : 'Download failed');
    }
  };

  return (
    <div
      className={'draft-card ' + (isSelected ? 'draft-card-selected' : '')}
      style={{ transform: `rotate(${tilt}deg)`, cursor: 'pointer' }}
      onClick={onToggleSelect}
      title={lang === 'zh' ? '点击勾选 / 取消' : 'Click to (un)select'}
    >
      <div ref={previewRef} className="draft-preview">
        <div className="draft-panda-frame">
          {info.face ? (
            // panda + face 合成路径 (内置素材 / 上传 panda+face)
            <PandaCanvas
              pandaSrc={info.panda.src}
              pandaId={info.panda.id}
              faceSrc={info.face.src}
              faceOffset={info.panda.faceOffset}
              alt={info.panda.id}
              className="draft-panda-img"
              size={512}
              style={{ transform: `translateY(${Math.round(getLiveCaptionOffset(info.panda.id) * 0.526)}px)` }}
            />
          ) : (
            // 整图路径 (联网搜 customPanda / 用户上传整图) — 无 face, 直接 <img>
            <img
              src={info.panda.src}
              alt={info.panda.id}
              className="draft-panda-img"
              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
              draggable={false}
              referrerPolicy="no-referrer"
            />
          )}
        </div>
        {info.text && <div className="draft-caption">{info.text}</div>}
      </div>

      <div className="draft-meta" onClick={(e) => e.stopPropagation()}>
        {editing ? (
          <RenameRow
            // key 让 RenameRow 在每次 editing=true 时 fresh mount
            // 初始值用最新 slot.name, 子组件自己管 state, 不受父 re-render 影响
            key={`rename-${slot.id}`}
            initialName={slot.name || info.text || ''}
            placeholder={lang === 'zh' ? '起个名字...' : 'Name it...'}
            onSubmit={(name) => {
              // eslint-disable-next-line no-console
              console.log('[DraftCard] onSubmit', { slotId: slot.id, name, currentName: slot.name });
              if (name && name !== slot.name) {
                onRename(name);
              }
              setEditing(false);
            }}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <div className="draft-name-row">
            <span className="draft-name">{slot.name || info.text || (lang === 'zh' ? '未命名' : 'Untitled')}</span>
            <button onClick={(e) => { e.stopPropagation(); setEditing(true); }} className="draft-icon-btn" title={lang === 'zh' ? '改名' : 'Rename'}>
              <Edit2 size={11} />
            </button>
          </div>
        )}
      </div>

      <div className="draft-actions" onClick={(e) => e.stopPropagation()}>
        <button onClick={(e) => { e.stopPropagation(); onCopy(); }} className="draft-icon-btn" title={lang === 'zh' ? '复制' : 'Copy'}>
          <Copy size={13} />
        </button>
        <button onClick={(e) => { e.stopPropagation(); onDownload(); }} className="draft-icon-btn" title={lang === 'zh' ? '下载' : 'Download'}>
          <Download size={13} />
        </button>
        <button onClick={(e) => { e.stopPropagation(); onSendToEditor(); }} className="draft-icon-btn draft-icon-btn-accent" title={lang === 'zh' ? '进编辑器精修' : 'Open in Editor'}>
          <SquarePen size={13} />
        </button>
        <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="draft-icon-btn draft-icon-btn-danger" title={lang === 'zh' ? '删除' : 'Delete'}>
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

// GIF / 视频 草稿卡 — 缩略图(thumbSrc dataURL) + 类型角标 + 打开(切到沙雕动画)/删除
function AnimateDraftCard({ kind, name, thumbSrc, lang, onOpen, onExport, onRename, onDelete }: {
  kind: 'gif' | 'video';
  name: string;
  thumbSrc?: string;
  lang: 'zh' | 'en';
  onOpen: () => void;
  onExport: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const badge = kind === 'gif' ? 'GIF' : (lang === 'zh' ? '视频' : 'Video');
  const badgeBg = kind === 'gif' ? '#7b3fe4' : '#0f7b5f';
  return (
    <div className="draft-card" style={{ cursor: 'default', position: 'relative' }}>
      <span style={{ position: 'absolute', top: 8, left: 8, zIndex: 6, background: badgeBg, color: '#fff', fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 8, letterSpacing: 0.5, boxShadow: '0 1px 3px rgba(0,0,0,.25)' }}>{badge}</span>
      <div className="draft-preview" onClick={onOpen} style={{ cursor: 'pointer' }} title={lang === 'zh' ? '点击打开继续编辑' : 'Open'}>
        <div className="draft-panda-frame">
          {thumbSrc
            ? <img src={thumbSrc} alt={name} className="draft-panda-img" style={{ width: '100%', height: '100%', objectFit: 'contain' }} draggable={false} />
            : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9bb', fontSize: 14, fontWeight: 800 }}>{badge}</div>}
        </div>
      </div>
      <div className="draft-meta" onClick={(e) => e.stopPropagation()}>
        {editing ? (
          <RenameRow
            key={`rename-${kind}-${name}`}
            initialName={name}
            placeholder={lang === 'zh' ? '起个名字...' : 'Name it...'}
            onSubmit={(n) => { if (n && n !== name) onRename(n); setEditing(false); }}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <div className="draft-name-row">
            <span className="draft-name">{name || (lang === 'zh' ? '未命名' : 'Untitled')}</span>
            <button onClick={(e) => { e.stopPropagation(); setEditing(true); }} className="draft-icon-btn" title={lang === 'zh' ? '改名' : 'Rename'}>
              <Edit2 size={11} />
            </button>
          </div>
        )}
      </div>
      <div className="draft-actions">
        <button onClick={(e) => { e.stopPropagation(); onOpen(); }} className="draft-icon-btn draft-icon-btn-accent" title={lang === 'zh' ? '打开继续编辑' : 'Open'}>
          <FolderInput size={13} />
        </button>
        <button onClick={(e) => { e.stopPropagation(); onExport(); }} className="draft-icon-btn" title={kind === 'gif' ? (lang === 'zh' ? '导出 GIF' : 'Export GIF') : (lang === 'zh' ? '导出视频' : 'Export video')}>
          <Download size={13} />
        </button>
        <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="draft-icon-btn draft-icon-btn-danger" title={lang === 'zh' ? '删除' : 'Delete'}>
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}
