// Collection v2 — 草图管理板块（批量选 + ZIP 导出 + filter）
// Contributed by PandaHead (https://pandahead.fun · github.com/jokkibtc/panda)

import { useCallback, useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';
import { useMeme } from '@/context/MemeContext';
import { ALL_PANDAS, ALL_FACES, getLivePandaFaceOffset } from '@/data/materials';
import { useQuickFavs, type QuickFav } from '@/hooks/useQuickFavs';
import { useLiveAnchor } from '@/hooks/useLiveAnchor';
import { captureNode, copyImageToClipboard, downloadImage } from '@/lib/exportImage';
import { composeMeme, calcEditorFaceLayout } from '@/lib/composeMeme';
import { PandaCanvas } from '@/components/pandacanvas';
import {
  FolderOpen, Copy, Download, Trash2, ArrowRight, Sparkles, Edit2, Check, X,
  Package,
} from 'lucide-react';
import { toast } from 'sonner';
import './collection.css';

interface CollectionProps {
  onOpenQuick: () => void;
  onOpenEditor: () => void;
}

type Filter = 'all' | 'recent';

export function Collection({ onOpenQuick, onOpenEditor }: CollectionProps) {
  const { state, dispatch, generateId } = useMeme();
  const { favs, remove, rename } = useQuickFavs();
  const lang = state.language;
  // DEV: 校准工具改 anchor 时触发 re-render
  useLiveAnchor();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<Filter>('all');
  const offscreenContainerRef = useRef<HTMLDivElement>(null);

  const items = useMemo<QuickFav[]>(() => {
    let list = Object.values(favs).sort((a, b) => b.ts - a.ts);
    if (filter === 'recent') list = list.slice(0, 12);
    return list;
  }, [favs, filter]);

  const toggleSelect = useCallback((id: string) => {
    setSelected((s) => {
      const ns = new Set(s);
      if (ns.has(id)) ns.delete(id);
      else ns.add(id);
      return ns;
    });
  }, []);

  const selectAll = useCallback(() => setSelected(new Set(items.map((i) => i.id))), [items]);
  const clearSelection = useCallback(() => setSelected(new Set()), []);

  const onBatchDelete = useCallback(() => {
    Array.from(selected).forEach((id) => remove(id));
    setSelected(new Set());
    toast.success(lang === 'zh' ? `已删除 ${selected.size} 张` : `Deleted ${selected.size}`);
  }, [selected, remove, lang]);

  // 批量打 ZIP — 每张草图渲染到离屏 element → captureNode → blob → zip.file
  const onBatchZip = useCallback(async () => {
    if (selected.size === 0) return;
    const itemsToPack = items.filter((it) => selected.has(it.id));
    if (!itemsToPack.length) return;
    if (!offscreenContainerRef.current) return;

    toast.info(lang === 'zh' ? `打包 ${itemsToPack.length} 张...` : `Packing ${itemsToPack.length}...`);

    try {
      const zip = new JSZip();
      // 离屏渲染容器：每张草图 render → captureNode → 加进 zip
      // 用 composeMeme 预合成 panda+face data URL（含白色 mask 裁切），再嵌入 DOM 让 captureNode 加上 caption
      const container = offscreenContainerRef.current;
      for (let i = 0; i < itemsToPack.length; i++) {
        const fav = itemsToPack[i];
        const panda = ALL_PANDAS.find((p) => p.id === fav.pandaId);
        const face = ALL_FACES.find((f) => f.id === fav.faceId);
        if (!panda || !face) continue;
        const composedDataUrl = await composeMeme({
          pandaSrc: panda.src,
          faceSrc: face.src,
          faceOffset: getLivePandaFaceOffset(panda),
          size: 1024,
        });
        const node = document.createElement('div');
        // v4: 与预览/草图一致的 flex 列布局 — caption 紧贴 panda 下方，间距等比例
        node.style.cssText =
          'position:absolute;left:-99999px;top:0;width:400px;background:#fff;display:flex;flex-direction:column;align-items:center;padding:25px 25px 30px;';
        node.innerHTML = `
          <img src="${composedDataUrl}" style="display:block;max-width:350px;max-height:350px;object-fit:contain;" />
          ${
            fav.text
              ? `<div style="margin-top:22px;width:100%;max-width:360px;text-align:center;font-size:32px;font-weight:700;color:#000;padding:0 16px;line-height:1.2;word-break:break-word;font-family:${fav.fontFamily || 'sans-serif'};">${fav.text}</div>`
              : ''
          }
        `;
        container.appendChild(node);
        await new Promise((r) => setTimeout(r, 80)); // data URL 已就绪，仅等 layout
        const blob = await captureNode(node);
        const safeName = (fav.name || fav.text || `panda-${i + 1}`).replace(/[^\w一-龥-]/g, '_').slice(0, 40);
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
      toast.success(lang === 'zh' ? `已打包 ${itemsToPack.length} 张 ZIP` : `Packed ${itemsToPack.length} as ZIP`);
    } catch (e) {
      toast.error(lang === 'zh' ? `打包失败: ${e instanceof Error ? e.message : 'unknown'}` : `Pack failed`);
    }
  }, [selected, items, lang]);

  // 进编辑器精修单张 — 用 calcEditorFaceLayout 让 face 元素位置/大小跟草图卡片视觉一致
  // (之前直接用 350-coord faceOffset 当 face 元素 x/y/w/h，face PNG 含透明 padding 视觉位移)
  const onSendToEditor = useCallback(async (fav: QuickFav) => {
    // 优先用 fav 自带 src（上传/智能提取素材），fallback 到 ALL_* 池 — 跟 DraftCard 同样逻辑
    const pandaInPool = ALL_PANDAS.find((p) => p.id === fav.pandaId);
    const faceInPool = ALL_FACES.find((f) => f.id === fav.faceId);
    const panda = pandaInPool
      ?? (fav.pandaSrc
        ? { id: fav.pandaId, src: fav.pandaSrc, labelCn: '上传', labelEn: 'Upload', tags: [], tagsEn: [], faceOffset: fav.pandaFaceOffset ?? { x: 100, y: 70, w: 250, h: 250 } }
        : null);
    const face = faceInPool
      ?? (fav.faceSrc
        ? { id: fav.faceId, src: fav.faceSrc, labelCn: '上传', labelEn: 'Upload', tags: [], tagsEn: [], faceOffset: { x: 0, y: 0, w: 0, h: 0 } }
        : null);
    if (!panda || !face) {
      toast.error(lang === 'zh' ? '素材丢失（旧草图无 src 数据，需重新存一次）' : 'Material missing (old draft, please re-save)');
      return;
    }
    // 用 live faceOffset (含校准工具改动) + 算 face 元素的实际显示位置
    const offset350 = getLivePandaFaceOffset(panda);
    const faceLayout = await calcEditorFaceLayout({
      pandaSrc: panda.src,
      faceSrc: face.src,
      faceOffset350: offset350,
    });
    dispatch({ type: 'CLEAR_CANVAS' });
    dispatch({
      type: 'ADD_ELEMENT',
      element: {
        id: generateId(), type: 'image' as const, src: panda.src, name: panda.id,
        x: 75, y: 50, width: 350, height: 350,
        rotation: 0, opacity: 1, zIndex: 0, flipX: false,
      },
    });
    setTimeout(() => {
      dispatch({
        type: 'ADD_ELEMENT',
        element: {
          id: generateId(), type: 'image' as const, src: face.src, name: face.id,
          x: faceLayout.x, y: faceLayout.y, width: faceLayout.width, height: faceLayout.height,
          rotation: 0, opacity: 1, zIndex: 1, flipX: false,
        },
      });
      if (fav.text) {
        dispatch({
          type: 'ADD_ELEMENT',
          element: {
            id: generateId(), type: 'text' as const, text: fav.text,
            x: 60, y: 410, width: 380, height: 56,
            rotation: 0, opacity: 1, zIndex: 2,
            fontFamily: fav.fontFamily || 'sans-serif',
            fontSize: 32, fontWeight: 'bold' as const,
            textAlign: 'center' as const,
            fillColor: '#000000', strokeColor: '#ffffff', strokeWidth: 0,
          },
        });
      }
      onOpenEditor();
    }, 30);
  }, [dispatch, generateId, lang, onOpenEditor]);

  // 空 state — 套 LittleRed about- 风格
  if (Object.keys(favs).length === 0) {
    return (
      <div className="about-container about-arcade-shell col-root">
        <div className="about-page">
          <section className="about-banner-card" style={{ flexDirection: 'column', textAlign: 'center', padding: '40px 22px' }}>
            <FolderOpen size={48} color="#1767c7" />
            <h3 style={{ margin: '12px 0 6px', fontSize: 20, fontWeight: 800, color: '#0a356d' }}>
              {lang === 'zh' ? '草图本是空的' : 'No drafts yet'}
            </h3>
            <p style={{ margin: '0 0 18px', fontSize: 13, color: '#456' }}>
              {lang === 'zh' ? '去快速生图收藏几张试试' : 'Open Quick mode and save some drafts'}
            </p>
            <button onClick={onOpenQuick} className="about-arcade-btn">
              <Sparkles size={14} />
              {lang === 'zh' ? '打开快速生图' : 'Open Quick Mode'}
            </button>
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
              {lang === 'zh' ? '我的草图' : 'My Drafts'}
              <span className="about-chip" style={{ padding: '4px 10px', fontSize: 12 }}>{items.length}</span>
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: '#456' }}>
              {lang === 'zh' ? '点卡片多选 → 批量打包 ZIP / 删除' : 'Click card to multi-select → batch ZIP / delete'}
            </p>
          </div>
        </div>
        <div style={{ display: 'inline-flex', gap: 4, padding: 4, background: 'rgba(15, 93, 175, 0.1)', borderRadius: 12 }}>
          {(['all', 'recent'] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={filter === f ? 'about-arcade-btn' : ''}
              style={filter === f
                ? { padding: '6px 14px', fontSize: 13, borderRadius: 10 }
                : { padding: '6px 14px', fontSize: 13, color: '#0a356d', background: 'transparent', border: 'none', cursor: 'pointer', fontWeight: 600 }}
            >
              {lang === 'zh' ? (f === 'all' ? '全部' : '最近') : (f === 'all' ? 'All' : 'Recent')}
            </button>
          ))}
        </div>
      </section>

      <div className="col-grid">
        {items.map((fav) => (
          <DraftCard
            key={fav.id}
            fav={fav}
            lang={lang}
            isSelected={selected.has(fav.id)}
            onToggleSelect={() => toggleSelect(fav.id)}
            onDelete={() => {
              remove(fav.id);
              toast.success(lang === 'zh' ? '已删除' : 'Deleted');
            }}
            onRename={(name) => {
              rename(fav.id, name);
              toast.success(lang === 'zh' ? '已改名' : 'Renamed');
            }}
            onSendToEditor={() => onSendToEditor(fav)}
          />
        ))}
      </div>

      {/* 离屏渲染容器（ZIP 打包时塞临时 preview node） */}
      <div ref={offscreenContainerRef} style={{ position: 'absolute', left: -99999, top: 0 }} />

      {/* Floating action bar — 选中时浮动 */}
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

interface DraftCardProps {
  fav: QuickFav;
  lang: 'zh' | 'en';
  isSelected: boolean;
  onToggleSelect: () => void;
  onDelete: () => void;
  onRename: (name: string) => void;
  onSendToEditor: () => void;
}

function DraftCard({ fav, lang, isSelected, onToggleSelect, onDelete, onRename, onSendToEditor }: DraftCardProps) {
  // 优先用 fav 自带的 src（上传/智能提取素材），fallback 到 ALL_* 池
  const pandaInPool = ALL_PANDAS.find((p) => p.id === fav.pandaId);
  const faceInPool = ALL_FACES.find((f) => f.id === fav.faceId);
  const panda = pandaInPool ?? (fav.pandaSrc ? { id: fav.pandaId, src: fav.pandaSrc, labelCn: '上传', labelEn: 'Upload', tags: [], tagsEn: [], faceOffset: fav.pandaFaceOffset ?? { x: 100, y: 70, w: 250, h: 250 } } : null);
  const face = faceInPool ?? (fav.faceSrc ? { id: fav.faceId, src: fav.faceSrc, labelCn: '上传', labelEn: 'Upload', tags: [], tagsEn: [], faceOffset: { x: 0, y: 0, w: 0, h: 0 } } : null);
  const previewRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState(fav.name || fav.text || '');

  const tilt = useMemo(() => {
    let h = 0;
    for (const c of fav.id) h = (h * 31 + c.charCodeAt(0)) | 0;
    return ((h % 7) - 3) * 0.8;
  }, [fav.id]);

  // broken card：素材丢了 — 加删除按钮 + 选择框（之前 user 删不掉）
  if (!panda || !face) {
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
          {fav.name || fav.text || lang === 'zh' ? `${fav.pandaId} + ${fav.faceId}` : `${fav.pandaId} + ${fav.faceId}`}
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
      await downloadImage(
        previewRef.current,
        `panda-${fav.pandaId}-${fav.faceId}-${Date.now()}.png`
      );
    } catch {
      toast.error(lang === 'zh' ? '下载失败' : 'Download failed');
    }
  };

  const submitRename = () => {
    if (nameDraft.trim()) onRename(nameDraft.trim());
    setEditing(false);
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
          <PandaCanvas
            pandaSrc={panda.src}
            pandaId={panda.id}
            faceSrc={face.src}
            faceOffset={getLivePandaFaceOffset(panda)}
            alt={panda.id}
            className="draft-panda-img"
            size={512}
          />
        </div>
        {fav.text && <div className="draft-caption">{fav.text}</div>}
      </div>

      <div className="draft-meta" onClick={(e) => e.stopPropagation()}>
        {editing ? (
          <div className="draft-rename-row">
            <input
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitRename();
                if (e.key === 'Escape') setEditing(false);
              }}
              placeholder={lang === 'zh' ? '起个名字...' : 'Name it...'}
              className="draft-rename-input"
              onClick={(e) => e.stopPropagation()}
            />
            <button onClick={(e) => { e.stopPropagation(); submitRename(); }} className="draft-rename-ok"><Check size={12} /></button>
            <button onClick={(e) => { e.stopPropagation(); setEditing(false); }} className="draft-rename-cancel"><X size={12} /></button>
          </div>
        ) : (
          <div className="draft-name-row">
            <span className="draft-name">{fav.name || fav.text || (lang === 'zh' ? '未命名' : 'Untitled')}</span>
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
          <ArrowRight size={13} />
        </button>
        <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="draft-icon-btn draft-icon-btn-danger" title={lang === 'zh' ? '删除' : 'Delete'}>
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}
