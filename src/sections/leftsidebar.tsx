import { useState } from 'react';
import { useMeme } from '@/context/memecontext';
import { useIsMobile } from '@/hooks/usemediaquery';
import { PANDA_HEADS, FACES, getPandaFaceOffset } from '@/data/materials';
import type { ImageElement, MemeElement } from '@/context/memecontext';
import { X, Search } from 'lucide-react';
import type { Material } from '@/data/materials';

function isElementActive(elements: MemeElement[], itemId: string): boolean {
  return elements.some(e => e.type === 'image' && (e as ImageElement).name === itemId);
}

function isPanda(e: MemeElement): boolean {
  if (e.type !== 'image') return false;
  const name = (e as ImageElement).name;
  return PANDA_HEADS.some(p => p.id === name);
}

function isFace(e: MemeElement): boolean {
  if (e.type !== 'image') return false;
  const name = (e as ImageElement).name;
  return FACES.some(f => f.id === name);
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
  const { state, dispatch, generateId } = useMeme();
  const isMobile = useIsMobile();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'panda' | 'face'>('panda');
  const [pandaSearch, setPandaSearch] = useState('');
  const [faceSearch, setFaceSearch] = useState('');

  const lang = state.language;
  const filteredPandas = filterMaterials(PANDA_HEADS, pandaSearch, lang);
  const filteredFaces = filterMaterials(FACES, faceSearch, lang);

  const handleAddPandaHead = (src: string, id: string) => {
    state.elements.filter(isPanda).forEach(e => {
      dispatch({ type: 'REMOVE_ELEMENT', id: e.id });
    });
    const element: ImageElement = {
      id: generateId(), type: 'image', src, name: id,
      x: 75, y: 50, width: 350, height: 350,
      rotation: 0, opacity: 1, zIndex: 0, flipX: false,
    };
    dispatch({ type: 'ADD_ELEMENT', element });
    if (isMobile) setSheetOpen(false);
  };

  const handleAddFace = (src: string, id: string) => {
    state.elements.filter(isFace).forEach(e => {
      dispatch({ type: 'REMOVE_ELEMENT', id: e.id });
    });
    let pandaId = 'panda-head';
    const currentPanda = state.elements.find(isPanda) as ImageElement | undefined;
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
    const offset = getPandaFaceOffset(pandaId);
    const faceElement: ImageElement = {
      id: generateId(), type: 'image', src, name: id,
      x: offset.x, y: offset.y, width: offset.w, height: offset.h,
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
      <div className="sidebar-section sidebar-panda">
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

      <div className="sidebar-section sidebar-face">
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
