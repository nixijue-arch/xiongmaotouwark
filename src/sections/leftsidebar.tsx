import { useMemo, useState } from 'react';
import { useMeme, DRAFT_SLOT_MAX } from '@/context/memecontext';
import { useIsMobile } from '@/hooks/usemediaquery';
import { ALL_PANDAS, ALL_FACES, getLivePandaFaceOffset } from '@/data/materials';
import { calcEditorFaceLayout } from '@/lib/composeMeme';
import { useQuickFavs } from '@/hooks/useQuickFavs';
import { toast } from 'sonner';
import type { ImageElement, MemeElement } from '@/context/memecontext';
import { X, Search } from 'lucide-react';
import type { Material } from '@/data/materials';

function isElementActive(elements: MemeElement[], itemId: string): boolean {
  return elements.some(e => e.type === 'image' && (e as ImageElement).name === itemId);
}

function isPanda(e: MemeElement): boolean {
  if (e.type !== 'image') return false;
  const name = (e as ImageElement).name;
  // 也认 'panda-head' fallback name（handleAddFace 兜底用）
  return name === 'panda-head' || ALL_PANDAS.some(p => p.id === name) || name.startsWith('upload-panda-');
}

function isFace(e: MemeElement): boolean {
  if (e.type !== 'image') return false;
  const name = (e as ImageElement).name;
  return ALL_FACES.some(f => f.id === name) || name.startsWith('upload-face-') || name.startsWith('custom-face-');
}

function getTargetPanda(elements: MemeElement[], selectedId: string | null) {
  const selected = selectedId ? elements.find(e => e.id === selectedId) : undefined;
  if (selected && isPanda(selected)) {
    return selected as ImageElement;
  }

  const pandas = elements.filter(isPanda) as ImageElement[];
  if (pandas.length === 0) return undefined;
  return pandas.reduce((top, current) => current.zIndex > top.zIndex ? current : top);
}

function filterMaterials(items: Material[], query: string, lang: 'zh' | 'en'): Material[] {
  if (!query.trim()) return items;
  const q = query.trim().toLowerCase();
  return items.filter(item => {
    const nameMatch = lang === 'zh'
      ? item.labelCn.toLowerCase().includes(q)
      : item.labelEn.toLowerCase().includes(q);
    const tagMatch = lang === 'zh'
      ? item.tags.some(t => t.includes(q))
      : item.tagsEn.some(t => t.toLowerCase().includes(q));
    return nameMatch || tagMatch;
  });
}

export function LeftSidebar() {
  const { state, dispatch, generateId, draftSlots, saveDraft, loadDraft, clearDraft } = useMeme();
  const { upsert: upsertFav, remove: removeFav } = useQuickFavs();

  const isMobile = useIsMobile();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'panda' | 'face'>('panda');
  const [pandaSearch, setPandaSearch] = useState('');
  const [faceSearch, setFaceSearch] = useState('');

  const lang = state.language;
  // 编辑器素材池跟 QuickMode / Collection 一致 — 用 ALL_* (70 panda + 132 face)
  // 之前只用 LittleRed 24+67 子集，PandaHead 46+65 不在 sidebar 里
  const filteredPandas = filterMaterials(ALL_PANDAS, pandaSearch, lang);
  const filteredFaces = filterMaterials(ALL_FACES, faceSearch, lang);
  // 动态 schema：所有 draftSlots 都已经 state !== null（loadDraftSlots 已过滤），直接全用
  const savedDraftSlots = draftSlots;

  // 下一个草稿 id：未满时新建；满 40 时覆盖最旧的
  const { nextDraftSlotId, nextDraftLabel } = useMemo(() => {
    if (draftSlots.length === 0) return { nextDraftSlotId: 'draft-1', nextDraftLabel: '草稿1' };
    if (draftSlots.length < DRAFT_SLOT_MAX) {
      const idx = draftSlots.length + 1;
      return { nextDraftSlotId: `draft-${Date.now()}-${idx}`, nextDraftLabel: `草稿${idx}` };
    }
    // 已满 — 找最旧的覆盖
    const oldest = draftSlots.reduce((min, slot) => ((slot.updatedAt ?? 0) < (min.updatedAt ?? 0) ? slot : min), draftSlots[0]);
    return { nextDraftSlotId: oldest.id, nextDraftLabel: oldest.name };
  }, [draftSlots]);

  // 存到草图本 — 用 upsert（不 toggle），fav id 跟 draft slot id 1:1，确保多次保存不互相抵消
  const handleSaveToCollection = (slotId: string) => {
    const pandaEl = state.elements.find((e): e is ImageElement => e.type === 'image' && isPanda(e));
    const faceEl = state.elements.find((e): e is ImageElement => e.type === 'image' && isFace(e));
    if (!pandaEl) {
      // 按钮 disabled 时不会触发；fallback 静默跳过
      return;
    }
    const textEl = state.elements.find(e => e.type === 'text') as { text: string; fontFamily: string } | undefined;
    const text = textEl?.text ?? '';
    const fontFamily = textEl?.fontFamily ?? 'sans-serif';
    const pandaId = pandaEl.name;
    const faceId = faceEl?.name ?? 'face-01';
    // 用 slot id 派生 fav id — 编辑器草图与草图本一一对应（slot 删 → 对应 fav 也清）
    const id = `editor-${slotId}`;
    const isCustomPanda = pandaId.startsWith('upload-panda-');
    const isCustomFace = faceId.startsWith('upload-face-') || faceId.startsWith('custom-face-');
    const fav: Parameters<typeof upsertFav>[0] = { id, pandaId, faceId, text, fontFamily };
    if (isCustomPanda) {
      fav.pandaSrc = pandaEl.src;
      if (faceEl) fav.pandaFaceOffset = { x: faceEl.x - pandaEl.x, y: faceEl.y - pandaEl.y, w: faceEl.width, h: faceEl.height };
    }
    if (isCustomFace && faceEl) fav.faceSrc = faceEl.src;
    upsertFav(fav);
  };

  const handleUseDraft = (slotId: string, slotName: string) => {
    const confirmed = window.confirm(
      lang === 'zh'
        ? `使用 ${slotName} 会覆盖当前画布内容，确定继续吗？`
        : `Using ${slotName.replace('草稿', 'Draft ')} will overwrite the current canvas. Continue?`
    );
    if (!confirmed) return;
    loadDraft(slotId);
  };

  const handleDeleteDraft = (slotId: string, slotName: string) => {
    const confirmed = window.confirm(
      lang === 'zh'
        ? `确定删除 ${slotName} 吗？删除后无法恢复。`
        : `Delete ${slotName.replace('草稿', 'Draft ')}? This cannot be undone.`
    );
    if (!confirmed) return;
    clearDraft(slotId);
    // 同步删除草图本里对应的 fav（与 saveDraft 配对，保持双向一致）
    removeFav(`editor-${slotId}`);
  };

  const handleAddPandaHead = (src: string, id: string) => {
    const pandaCount = state.elements.filter(isPanda).length;
    const element: ImageElement = {
      id: generateId(), type: 'image', src, name: id,
      x: Math.min(150, 75 + pandaCount * 18),
      y: Math.min(120, 50 + pandaCount * 18),
      width: 350, height: 350,
      rotation: 0, opacity: 1, zIndex: 0, flipX: false,
    };
    dispatch({ type: 'ADD_ELEMENT', element });
    if (isMobile) setSheetOpen(false);
  };

  // 加 face — 用 calcEditorFaceLayout 按 panda anchor 算 content_center 位置（跟 QuickMode/Collection 一致）
  const handleAddFace = async (src: string, id: string) => {
    let pandaId = 'panda-head';
    const currentPanda = getTargetPanda(state.elements, state.selectedId);
    if (currentPanda) {
      pandaId = currentPanda.name;
    } else {
      const pandaElement: ImageElement = {
        id: generateId(), type: 'image', src: './assets/panda-head.png', name: pandaId,
        x: 75, y: 50, width: 350, height: 350,
        rotation: 0, opacity: 1, zIndex: 0, flipX: false,
      };
      dispatch({ type: 'ADD_ELEMENT', element: pandaElement });
    }
    const anchorPanda = ALL_PANDAS.find(p => p.id === pandaId);
    const layout = anchorPanda
      ? await calcEditorFaceLayout({
          pandaSrc: anchorPanda.src,
          faceSrc: src,
          faceOffset350: getLivePandaFaceOffset(anchorPanda),
        })
      : { x: 100, y: 70, width: 250, height: 250 };
    const faceCount = state.elements.filter(isFace).length;
    const faceElement: ImageElement = {
      id: generateId(), type: 'image', src, name: id,
      x: layout.x + faceCount * 6, y: layout.y + faceCount * 6, width: layout.width, height: layout.height,
      rotation: 0, opacity: 1, zIndex: 1, flipX: false,
    };
    dispatch({ type: 'ADD_ELEMENT', element: faceElement });
    if (isMobile) setSheetOpen(false);
  };

  const renderSearchBox = (value: string, onChange: (v: string) => void, placeholder: string) => (
    <div className="material-search-box">
      <Search size={12} color="#888" />
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="material-search-input"
      />
      {value && (
        <button className="material-search-clear" onClick={() => onChange('')}>
          <X size={12} />
        </button>
      )}
    </div>
  );

  const renderMaterialCard = (item: Material) => (
    <button
      key={item.id}
      onClick={() => {
        if (activeTab === 'panda') handleAddPandaHead(item.src, item.id);
        else handleAddFace(item.src, item.id);
      }}
      className="flex flex-col items-center gap-1 p-2 rounded-lg transition-all active:scale-95"
      style={{
        backgroundColor: '#FFFFFF',
        border: isElementActive(state.elements, item.id) ? '2px solid #FF5E00' : '1px solid #ddd',
      }}
    >
      <img
        src={item.src}
        alt={lang === 'zh' ? item.labelCn : item.labelEn}
        className="w-full h-16 object-contain"
        draggable={false}
        loading="lazy"
      />
      <span className="text-[10px] truncate w-full text-center" style={{ color: '#666' }}>
        {lang === 'zh' ? item.labelCn : item.labelEn}
      </span>
    </button>
  );

  // ===== MOBILE: Bottom Sheet =====
  if (isMobile) {
    if (state.museumEditMode) return null;

    const title = lang === 'zh' ? '选择素材' : 'Choose Materials';
    const pandaTabLabel = lang === 'zh' ? '熊猫头' : 'Panda';
    const faceTabLabel = lang === 'zh' ? '人脸' : 'Face';
    const searchPh = lang === 'zh' ? '搜索名字或标签...' : 'Search name or tag...';

    return (
      <>
        <button className="mobile-fab-left" onClick={() => setSheetOpen(true)} title={title}>🐼</button>
        <div className={`bottom-sheet-overlay ${sheetOpen ? 'open' : ''}`} onClick={() => setSheetOpen(false)} />
        <div className={`bottom-sheet ${sheetOpen ? 'open' : ''}`}>
          <div className="bottom-sheet-header">
            <span className="bottom-sheet-title">{title}</span>
            <button className="bottom-sheet-close" onClick={() => setSheetOpen(false)}><X size={18} /></button>
          </div>
          <div style={{ display: 'flex', borderBottom: '1px solid #2a2a2a' }}>
            <button onClick={() => setActiveTab('panda')} className="flex-1 py-3 text-sm font-medium transition-all"
              style={{ backgroundColor: activeTab === 'panda' ? 'rgba(255,94,0,0.1)' : 'transparent', color: activeTab === 'panda' ? '#FF5E00' : '#888', borderBottom: activeTab === 'panda' ? '2px solid #FF5E00' : '2px solid transparent' }}>{pandaTabLabel}</button>
            <button onClick={() => setActiveTab('face')} className="flex-1 py-3 text-sm font-medium transition-all"
              style={{ backgroundColor: activeTab === 'face' ? 'rgba(255,94,0,0.1)' : 'transparent', color: activeTab === 'face' ? '#FF5E00' : '#888', borderBottom: activeTab === 'face' ? '2px solid #FF5E00' : '2px solid transparent' }}>{faceTabLabel}</button>
          </div>
          <div className="bottom-sheet-body">
            {activeTab === 'panda' && (
              <>
                {renderSearchBox(pandaSearch, setPandaSearch, searchPh)}
                {filteredPandas.length === 0 && <p className="text-xs text-center py-4" style={{ color: '#666' }}>{lang === 'zh' ? '没有找到匹配的素材' : 'No materials found'}</p>}
                <div className="grid grid-cols-3 gap-3 mt-2">{filteredPandas.map(renderMaterialCard)}</div>
              </>
            )}
            {activeTab === 'face' && (
              <>
                {renderSearchBox(faceSearch, setFaceSearch, searchPh)}
                {filteredFaces.length === 0 && <p className="text-xs text-center py-4" style={{ color: '#666' }}>{lang === 'zh' ? '没有找到匹配的素材' : 'No materials found'}</p>}
                <div className="grid grid-cols-3 gap-3 mt-2">{filteredFaces.map(renderMaterialCard)}</div>
              </>
            )}
          </div>
        </div>
      </>
    );
  }

  // ===== DESKTOP: Side Panel =====
  if (state.museumEditMode) {
    return (
      <aside className="desktop-sidebar-left" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px' }}>
        <div className="text-3xl">🔒</div>
        <p className="text-xs text-center" style={{ color: '#888' }}>
          {lang === 'zh' ? '博物馆编辑模式\n仅支持文字编辑' : 'Museum edit mode\nText editing only'}
        </p>
      </aside>
    );
  }

  return (
    <aside className="desktop-sidebar-left">
      <div className="draft-card win7-panel">
        <div className="draft-card-header">
          <span className="draft-card-icon">💾</span>
          <span className="draft-card-title">{lang === 'zh' ? '本地草稿' : 'Local Draft'}</span>
        </div>
        {/* 一键打通: 保存到草稿N 同时进草图本 (顶部"草图" tab 也能看) */}
        <button
          className="draft-save-current-btn"
          onClick={() => {
            void saveDraft(nextDraftSlotId);
            // 同时存到 useQuickFavs — slot 与 fav 1:1 对应（upsert，不 toggle）
            handleSaveToCollection(nextDraftSlotId);
            toast.success(
              lang === 'zh'
                ? `已存为${nextDraftLabel}（草图本可见）`
                : `Saved as ${nextDraftLabel.replace('草稿', 'Draft ')} (visible in Drafts)`
            );
          }}
          disabled={state.elements.filter(isPanda).length === 0}
          title={
            lang === 'zh'
              ? `本地草稿上限 ${DRAFT_SLOT_MAX}，已存 ${draftSlots.length}`
              : `Max ${DRAFT_SLOT_MAX} drafts, saved ${draftSlots.length}`
          }
        >
          {lang === 'zh'
            ? `保存当前到${nextDraftLabel}（${draftSlots.length}/${DRAFT_SLOT_MAX}）`
            : `Save to ${nextDraftLabel.replace('草稿', 'Draft ')} (${draftSlots.length}/${DRAFT_SLOT_MAX})`}
        </button>
        {savedDraftSlots.length === 0 ? (
          <p className="draft-empty-hint">
            {lang === 'zh' ? '还没有已保存草稿，先保存一份当前编辑内容' : 'No saved drafts yet. Save the current edit first.'}
          </p>
        ) : (
          <div className="draft-slot-grid hide-scrollbar" style={{ maxHeight: 360, overflowY: 'auto' }}>
            {savedDraftSlots.map(slot => {
            const draftTime = slot.updatedAt
              ? new Intl.DateTimeFormat(lang === 'zh' ? 'zh-CN' : 'en-US', {
                  month: 'numeric',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                }).format(new Date(slot.updatedAt))
              : '';

            return (
              <div key={slot.id} className="draft-slot-card">
                <button
                  className="draft-slot-preview"
                  onClick={() => handleUseDraft(slot.id, slot.name)}
                  title={lang === 'zh' ? '点击使用草稿' : 'Click to use this draft'}
                >
                  <img src={slot.previewUrl} alt={slot.name} className="draft-slot-image" />
                </button>
                <div className="draft-slot-info">
                  <div className="draft-slot-name">{lang === 'zh' ? slot.name : slot.name.replace('草稿', 'Draft ')}</div>
                  <div className="draft-slot-meta">
                    {lang === 'zh' ? `${slot.elementCount} 图层 · ${draftTime}` : `${slot.elementCount} layers · ${draftTime}`}
                  </div>
                </div>
                  <div className="draft-slot-actions">
                    <button className="draft-card-btn primary" onClick={() => handleUseDraft(slot.id, slot.name)}>
                    {lang === 'zh' ? '使用' : 'Use'}
                    </button>
                    <button className="draft-card-btn danger" onClick={() => handleDeleteDraft(slot.id, slot.name)}>
                      {lang === 'zh' ? '删除' : 'Delete'}
                    </button>
                  </div>
              </div>
            );
            })}
          </div>
        )}
      </div>

      <div className="sidebar-section sidebar-panda win7-panel">
        <div className="sidebar-section-header">
          <span className="sidebar-icon">🐼</span>
          <span className="sidebar-label">{lang === 'zh' ? '选择熊猫头' : 'Choose Panda Head'}</span>
        </div>
        {renderSearchBox(pandaSearch, setPandaSearch, lang === 'zh' ? '搜索名字或标签...' : 'Search name or tag...')}
        <div className="sidebar-scroll">
          <div className="sidebar-grid">
            {filteredPandas.map(item => (
              <MaterialCard key={item.id} item={item} lang={lang} active={isElementActive(state.elements, item.id)} onClick={() => handleAddPandaHead(item.src, item.id)} />
            ))}
            {filteredPandas.length === 0 && <p className="text-xs text-center col-span-2" style={{ color: '#666' }}>{lang === 'zh' ? '无匹配素材' : 'No matches'}</p>}
          </div>
        </div>
      </div>

      <div className="sidebar-section sidebar-face win7-panel">
        <div className="sidebar-section-header">
          <span className="sidebar-icon">😂</span>
          <span className="sidebar-label">{lang === 'zh' ? '选择人脸' : 'Choose Face'}</span>
        </div>
        {renderSearchBox(faceSearch, setFaceSearch, lang === 'zh' ? '搜索名字或标签...' : 'Search name or tag...')}
        <div className="sidebar-scroll">
          <div className="sidebar-grid">
            {filteredFaces.map(item => (
              <MaterialCard key={item.id} item={item} lang={lang} active={isElementActive(state.elements, item.id)} onClick={() => handleAddFace(item.src, item.id)} />
            ))}
            {filteredFaces.length === 0 && <p className="text-xs text-center col-span-2" style={{ color: '#666' }}>{lang === 'zh' ? '无匹配素材' : 'No matches'}</p>}
          </div>
        </div>
      </div>

      <div className="sidebar-hint">
        {lang === 'zh' ? '点击素材 · 拖拽调整位置 · Delete删除' : 'Click to add · Drag to move · Delete to remove'}
      </div>
    </aside>
  );
}

function MaterialCard({ item, lang, active, onClick }: { item: Material; lang: 'zh' | 'en'; active: boolean; onClick: () => void }) {
  const displayLabel = lang === 'zh' ? item.labelCn : item.labelEn;
  const displayTags = lang === 'zh' ? item.tags : item.tagsEn;

  return (
    <button
      onClick={onClick}
      className="material-card"
      style={{ border: active ? '2px solid #FF5E00' : '1px solid #ddd', backgroundColor: '#FFFFFF' }}
      title={`${item.labelCn} / ${item.labelEn}`}
    >
      <img src={item.src} alt={displayLabel} className="material-img" draggable={false} loading="lazy" style={{ backgroundColor: '#FFFFFF' }} />
      <span className="material-name">{displayLabel}</span>
      <div className="material-tags">
        {displayTags.slice(0, 2).map(t => <span key={t} className="material-tag">{t}</span>)}
      </div>
    </button>
  );
}
