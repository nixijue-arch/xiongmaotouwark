import { useEffect, useMemo, useState } from 'react';
import { useMeme, DRAFT_SLOT_MAX } from '@/context/memecontext';
import type { DraftSlot } from '@/context/memecontext';
import { useIsMobile } from '@/hooks/usemediaquery';
import { ALL_PANDAS, ALL_FACES, getLivePandaFaceOffset, getShellLayering } from '@/data/materials';
import { calcEditorFaceLayout, bboxCropImage } from '@/lib/composeMeme';
import { PandaCanvas } from '@/components/pandacanvas';
import { toast } from 'sonner';
import type { ImageElement, MemeElement } from '@/context/memecontext';
import { X, Search } from 'lucide-react';
import type { Material } from '@/data/materials';
import { PandaSearchModal } from '@/components/pandasearchmodal';
import { PandaSearchSaveModal } from '@/components/pandasearchsavemodal';
import type { NetworkResult } from '@/lib/networkImage';

function isElementActive(elements: MemeElement[], itemId: string): boolean {
  return elements.some(e => e.type === 'image' && (e as ImageElement).name === itemId);
}

function isPanda(e: MemeElement): boolean {
  if (e.type !== 'image') return false;
  const name = (e as ImageElement).name;
  // 也认 'panda-head' fallback name（handleAddFace 兜底用）
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

// 从 draftSlot 抽出 panda 信息给预览渲染用
function getSlotPreviewInfo(slot: DraftSlot) {
  const elements = slot.state?.elements ?? [];
  const pandaEl = elements.find(e => e.type === 'image' && isPanda(e)) as ImageElement | undefined;
  const faceEl = elements.find(e => e.type === 'image' && isFace(e)) as ImageElement | undefined;
  if (!pandaEl) return null;
  const pandaInPool = ALL_PANDAS.find(p => p.id === pandaEl.name);
  const faceOffset = pandaInPool
    ? getLivePandaFaceOffset(pandaInPool)
    : (faceEl
        ? { x: faceEl.x - pandaEl.x, y: faceEl.y - pandaEl.y, w: faceEl.width, h: faceEl.height }
        : { x: 100, y: 70, w: 250, h: 250 });
  return {
    pandaSrc: pandaInPool?.src ?? pandaEl.src,
    pandaId: pandaInPool?.id ?? pandaEl.name,
    faceSrc: faceEl ? (ALL_FACES.find(f => f.id === faceEl.name)?.src ?? faceEl.src) : '',
    faceOffset,
  };
}

export function LeftSidebar() {
  const { state, dispatch, generateId, draftSlots, saveDraft, loadDraft, clearDraft } = useMeme();

  const isMobile = useIsMobile();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'panda' | 'face'>('panda');

  // RPC for EditorMobilePanel — 通过 window event 触发本组件 sheet 打开
  // CustomEvent detail.tab 可指定打开时显示哪个 tab ('panda' / 'face')
  useEffect(() => {
    const onOpenLeft = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.tab === 'panda' || detail?.tab === 'face') {
        setActiveTab(detail.tab);
      }
      setSheetOpen(true);
    };
    window.addEventListener('xmw-editor-open-left-sheet', onOpenLeft);
    return () => window.removeEventListener('xmw-editor-open-left-sheet', onOpenLeft);
  }, []);
  const [pandaSearch, setPandaSearch] = useState('');
  const [faceSearch, setFaceSearch] = useState('');
  // 联网搜 modal (sidebar 入口按钮触发, 全屏 modal)
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  // DEV: 沉淀 modal (network search 用户点 ⭐ 后弹)
  const [savePromptResult, setSavePromptResult] = useState<NetworkResult | null>(null);

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

  // 已不需要单独"存到草图本"逻辑 — saveDraft 写入的 draftSlot 就是 Collection 的数据源

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
  };

  const handleAddPandaHead = (src: string, id: string) => {
    const pandaCount = state.elements.filter(isPanda).length;
    const layering = getShellLayering(id);
    const element: ImageElement = {
      id: generateId(), type: 'image', src, name: id,
      x: Math.min(150, 75 + pandaCount * 18),
      y: Math.min(120, 50 + pandaCount * 18),
      width: 350, height: 350,
      rotation: 0, opacity: 1,
      zIndex: layering.pandaZ,
      blendMode: layering.pandaBlend,
      flipX: false,
    };
    dispatch({ type: 'ADD_ELEMENT', element });
    if (isMobile) setSheetOpen(false);
  };

  // 加 face — 先 bbox-crop 原 face PNG 去掉透明 padding, 再用 cropped 尺寸算 anchor 内位置
  // 这样保证 face 元素尺寸 = 实际内容尺寸, 在 panda anchor 区域里精确就位
  // (修 sunglasses/extreme padding face 在编辑器里"过大或错位"的 bug)
  // 如果没 panda 在画布上, 自动塞一个默认 panda (用 ALL_PANDAS[0] = panda-01, 有完整 anchor 数据)
  const handleAddFace = async (src: string, id: string) => {
    let pandaId: string;
    const currentPanda = getTargetPanda(state.elements, state.selectedId);
    if (currentPanda) {
      pandaId = currentPanda.name;
    } else {
      // 没 panda → 自动加一个默认 (用第一个有 calibration 的 panda, anchor 数据齐全)
      const defaultPanda = ALL_PANDAS[0];
      pandaId = defaultPanda.id;
      const defaultLayering = getShellLayering(defaultPanda.id);
      const pandaElement: ImageElement = {
        id: generateId(), type: 'image', src: defaultPanda.src, name: defaultPanda.id,
        x: 75, y: 50, width: 350, height: 350,
        rotation: 0, opacity: 1,
        zIndex: defaultLayering.pandaZ,
        blendMode: defaultLayering.pandaBlend,
        flipX: false,
      };
      dispatch({ type: 'ADD_ELEMENT', element: pandaElement });
    }
    const anchorPanda = ALL_PANDAS.find(p => p.id === pandaId);
    // 1. bbox 紧凑裁剪 face PNG (去透明边)
    let croppedSrc = src;
    let croppedW = 0, croppedH = 0;
    try {
      const cropped = await bboxCropImage(src);
      croppedSrc = cropped.dataUrl;
      croppedW = cropped.w;
      croppedH = cropped.h;
    } catch { /* 失败用原 src 兜底 */ }

    // 2. 算元素在 panda anchor 里的位置 + 尺寸 (按 cropped 比例 contain 进 anchor)
    let layout = { x: 100, y: 70, width: 250, height: 250 };
    if (anchorPanda && croppedW > 0 && croppedH > 0) {
      const anchor = getLivePandaFaceOffset(anchorPanda);
      const faceFill = 0.95;
      const fScale = Math.min(anchor.w / croppedW, anchor.h / croppedH) * faceFill;
      const dispW = Math.round(croppedW * fScale);
      const dispH = Math.round(croppedH * fScale);
      // panda 元素左上角 (75,50) + anchor 中心 - 元素中心 = 元素左上角
      const elX = Math.round(75 + anchor.x + anchor.w / 2 - dispW / 2);
      const elY = Math.round(50 + anchor.y + anchor.h / 2 - dispH / 2);
      layout = { x: elX, y: elY, width: dispW, height: dispH };
    } else if (anchorPanda) {
      // bbox crop 失败的兜底 — 用旧 calcEditorFaceLayout
      const fallback = await calcEditorFaceLayout({
        pandaSrc: anchorPanda.src,
        faceSrc: src,
        faceOffset350: getLivePandaFaceOffset(anchorPanda),
      });
      layout = fallback;
    }

    const faceCount = state.elements.filter(isFace).length;
    // face 的图层方案根据当前 panda 决定
    const faceLayering = getShellLayering(pandaId);
    const faceElement: ImageElement = {
      id: generateId(), type: 'image', src: croppedSrc, name: id,
      x: layout.x + faceCount * 6, y: layout.y + faceCount * 6, width: layout.width, height: layout.height,
      rotation: 0, opacity: 1,
      zIndex: faceLayering.faceZ,
      blendMode: faceLayering.faceBlend,
      flipX: false,
    };
    dispatch({ type: 'ADD_ELEMENT', element: faceElement });
    if (isMobile) setSheetOpen(false);
  };

  // 联网搜 modal 应用回调 — desktop / mobile 共用
  const handleNetworkApply = (mat: Material) => {
    try {
      // 跟全局 isPanda 一致 — 含 4 个外部素材命名空间 + 内置 panda
      const currentPanda = state.elements.find((e) => e.type === 'image' && isPanda(e));
      // eslint-disable-next-line no-console
      console.log('[leftsidebar.handleNetworkApply]', {
        mat: { id: mat.id, srcPrefix: mat.src.slice(0, 60) },
        path: currentPanda ? `UPDATE_ELEMENT id=${currentPanda.id}` : 'ADD_ELEMENT new panda',
        elementsCount: state.elements.length,
      });
      if (currentPanda) {
        dispatch({
          type: 'UPDATE_ELEMENT',
          id: currentPanda.id,
          updates: { src: mat.src, name: mat.id },
        });
      } else {
        handleAddPandaHead(mat.src, mat.id);
      }
      setSearchModalOpen(false);
      toast.success(lang === 'zh' ? '已应用到画板' : 'Applied to canvas');
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[leftsidebar.handleNetworkApply] failed', e);
      toast.error(`${lang === 'zh' ? '应用失败' : 'Apply failed'}: ${(e as Error).message ?? 'unknown'}`);
    }
  };

  // 沉淀回调 — 严格 DEV gate, prod build 完全无 (import.meta.env.DEV 被 tree-shake 为 false)
  const handleSaveToPool = import.meta.env.DEV
    ? (result: NetworkResult) => setSavePromptResult(result)
    : undefined;

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
            {/* 联网搜 CTA 按钮 — 触发全屏 modal */}
            <button
              type="button"
              className="sidebar-network-cta"
              style={{ marginBottom: 12 }}
              onClick={() => { setSheetOpen(false); setSearchModalOpen(true); }}
            >
              <span className="sidebar-network-cta-emoji" aria-hidden="true">🌐</span>
              <span>{lang === 'zh' ? '联网搜素材 (海量熊猫头)' : 'Search Online (lots of memes)'}</span>
            </button>
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
        {/* 联网搜 modal — mobile + desktop 共用一个组件实例 */}
        <PandaSearchModal
          open={searchModalOpen}
          lang={lang}
          onSelect={handleNetworkApply}
          onSaveToPool={handleSaveToPool}
          onClose={() => setSearchModalOpen(false)}
        />
        <PandaSearchSaveModal
          result={savePromptResult}
          lang={lang}
          onClose={() => setSavePromptResult(null)}
          onSaved={(kind) => {
            setSavePromptResult(null);
            toast.success(lang === 'zh' ? '已沉淀到本地素材池' : 'Saved to local pool');
            if (kind === 'face' || kind === 'panda') {
              window.setTimeout(() => {
                toast.info(
                  lang === 'zh' ? '建议立即校准 face 锚点' : 'Tip: calibrate face anchor now',
                  {
                    duration: 8000,
                    action: {
                      label: lang === 'zh' ? '立即校准' : 'Calibrate',
                      onClick: () => {
                        const url = new URL(window.location.href);
                        url.searchParams.set('page', 'calibrate');
                        window.location.href = url.toString();
                      },
                    },
                  },
                );
              }, 500);
            }
          }}
        />
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
        {/* 保存草稿 = 在草图 tab 也立刻可见 (同一个 draftSlots 数据源) */}
        <button
          className="draft-save-current-btn"
          onClick={() => {
            void saveDraft(nextDraftSlotId);
            toast.success(
              lang === 'zh'
                ? `已存为${nextDraftLabel}（草图本同步可见）`
                : `Saved as ${nextDraftLabel.replace('草稿', 'Draft ')} (visible in Drafts tab)`
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
          <div className="draft-slot-grid" style={{ maxHeight: 360, overflowY: 'auto', scrollbarWidth: 'thin', scrollbarGutter: 'stable' }}>
            {savedDraftSlots.map(slot => {
            const draftTime = slot.updatedAt
              ? new Intl.DateTimeFormat(lang === 'zh' ? 'zh-CN' : 'en-US', {
                  month: 'numeric',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                }).format(new Date(slot.updatedAt))
              : '';

            const preview = getSlotPreviewInfo(slot);
            return (
              <div key={slot.id} className="draft-slot-card">
                <button
                  className="draft-slot-preview"
                  onClick={() => handleUseDraft(slot.id, slot.name)}
                  title={lang === 'zh' ? '点击使用草稿' : 'Click to use this draft'}
                >
                  {/* 用 PandaCanvas 渲染缩略图 — 跟 Collection / QuickMode 共享同款 composeMeme
                      锚点对齐, 所以编辑器侧栏与草图 tab 的缩略图视觉一致 */}
                  {preview && preview.faceSrc ? (
                    <PandaCanvas
                      pandaSrc={preview.pandaSrc}
                      pandaId={preview.pandaId}
                      faceSrc={preview.faceSrc}
                      faceOffset={preview.faceOffset}
                      alt={slot.name}
                      className="draft-slot-image"
                      size={256}
                    />
                  ) : slot.previewUrl ? (
                    <img src={slot.previewUrl} alt={slot.name} className="draft-slot-image" />
                  ) : (
                    <div className="draft-slot-image" style={{ background: '#eee', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#888' }}>—</div>
                  )}
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

      {/* 联网搜入口 — 单按钮独立放 sidebar, 不套 win7-panel 框 (user feedback "只有一个按钮就不用矩形框了") */}
      <button
        type="button"
        className="sidebar-network-cta sidebar-network-cta-solo"
        onClick={() => setSearchModalOpen(true)}
      >
        <span className="sidebar-network-cta-emoji" aria-hidden="true">🌐</span>
        <span>{lang === 'zh' ? '联网搜素材' : 'Search Online'}</span>
      </button>

      <div className="sidebar-hint">
        {lang === 'zh' ? '点击素材 · 拖拽调整位置 · Delete删除' : 'Click to add · Drag to move · Delete to remove'}
      </div>
      {/* 联网搜 modal — desktop sidebar 按钮触发, 跟 mobile sheet 同款 */}
      <PandaSearchModal
        open={searchModalOpen}
        lang={lang}
        onSelect={handleNetworkApply}
        onSaveToPool={handleSaveToPool}
        onClose={() => setSearchModalOpen(false)}
      />
      {/* DEV: 沉淀 modal — prod tree-shake */}
      <PandaSearchSaveModal
        result={savePromptResult}
        lang={lang}
        onClose={() => setSavePromptResult(null)}
        onSaved={(kind, _id) => {
          setSavePromptResult(null);
          toast.success(lang === 'zh' ? '已沉淀到本地素材池' : 'Saved to local pool');
          // face/panda 类素材建议立即去校准锚点
          if (kind === 'face' || kind === 'panda') {
            window.setTimeout(() => {
              toast.info(
                lang === 'zh' ? '建议立即校准 face 锚点' : 'Tip: calibrate face anchor now',
                {
                  duration: 8000,
                  action: {
                    label: lang === 'zh' ? '立即校准' : 'Calibrate',
                    onClick: () => {
                      const url = new URL(window.location.href);
                      url.searchParams.set('page', 'calibrate');
                      window.location.href = url.toString();
                    },
                  },
                },
              );
            }, 500);
          }
        }}
      />
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
