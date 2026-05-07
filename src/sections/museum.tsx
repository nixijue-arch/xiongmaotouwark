import { useState, useEffect, useCallback, useMemo } from 'react';
import { useMeme } from '@/context/memecontext';
import { MUSEUM_IMAGES } from '@/data/museum-images';
import { getTagsFor, ALL_TAGS_ZH, ALL_TAGS_EN, TAG_EMOJI } from '@/data/museum-tags';
import { X, Download, ArrowLeft, ChevronLeft, ChevronRight, Pencil, Copy, Search } from 'lucide-react';

export function Museum({ onBack, setPage }: { onBack: () => void; setPage: (page: 'editor' | 'museum') => void }) {
  const { t, state, dispatch, generateId } = useMeme();
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTag, setActiveTag] = useState<string>('all');

  // Reset museum edit mode when entering the museum
  useEffect(() => {
    dispatch({ type: 'SET_MUSEUM_EDIT_MODE', mode: false });
  }, []);

  const lang = state.language;

  /* ── hash routing ── */
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.startsWith('#meme=')) {
      const filename = decodeURIComponent(hash.slice(6));
      const idx = MUSEUM_IMAGES.findIndex(f => f === filename);
      if (idx !== -1) setSelectedIndex(idx);
    }
  }, []);

  useEffect(() => {
    if (selectedIndex !== null) {
      const filename = MUSEUM_IMAGES[selectedIndex];
      history.replaceState(null, '', `#meme=${encodeURIComponent(filename)}`);
    } else if (window.location.hash) {
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }, [selectedIndex]);

  /* ── filtered images ── */
  const filteredImages = useMemo(() => {
    let result = MUSEUM_IMAGES;

    // tag filter
    if (activeTag !== 'all') {
      const tagKey = lang === 'zh' ? 'tags' : 'tagEn';
      result = result.filter(f => {
        const tagData = getTagsFor(f);
        if (!tagData) return false;
        return (tagData as any)[tagKey]?.includes(activeTag);
      });
    }

    // search filter
    if (searchQuery.trim()) {
      result = result.filter(f => {
        const tagData = getTagsFor(f);
        if (!tagData) return false;
        const q = searchQuery.trim().toLowerCase();
        const zhMatch = tagData.tags.some(t => t.includes(q));
        const enMatch = tagData.tagEn.some(t => t.includes(q));
        return zhMatch || enMatch;
      });
    }

    return result;
  }, [activeTag, searchQuery, lang]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }, []);

  const copyImageToClipboard = async (url: string): Promise<boolean> => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      return true;
    } catch (err) {
      try {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = reject; img.src = url; });
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('no 2d');
        ctx.drawImage(img, 0, 0);
        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
        if (!blob) throw new Error('no blob');
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        return true;
      } catch (err2) {
        return false;
      }
    }
  };

  const handleShareToX = async (url: string, filename: string) => {
    const copied = await copyImageToClipboard(url);
    showToast(copied ? t('copyImageSuccess') : t('copyImageFailed'));
    const shareUrl = window.location.origin + window.location.pathname + '#meme=' + encodeURIComponent(filename);
    const text = encodeURIComponent(t('shareLinkText') + '\n\n');
    window.open(`https://twitter.com/intent/tweet?text=${text}&url=${encodeURIComponent(shareUrl)}`, '_blank');
  };

  const handleDownload = (url: string, filename: string) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleEdit = (filename: string) => {
    const url = `./museum/${filename}`;
    const img = new Image();
    img.onload = () => {
      const imgW = img.naturalWidth;
      const imgH = img.naturalHeight;
      const scale = Math.min(500 / imgW, 500 / imgH, 1);
      const w = Math.round(imgW * scale);
      const h = Math.round(imgH * scale);
      const x = Math.round((500 - w) / 2);
      const y = Math.round((500 - h) / 2);
      dispatch({ type: 'CLEAR_CANVAS' });
      dispatch({
        type: 'ADD_ELEMENT',
        element: { id: generateId(), type: 'image', src: url, name: `museum-${filename}`, x, y, width: w, height: h, rotation: 0, opacity: 1, zIndex: 0, flipX: false },
      });
      dispatch({ type: 'SET_MUSEUM_EDIT_MODE', mode: true });
      setPage('editor');
    };
    img.src = url;
  };

  const openImage = (index: number) => setSelectedIndex(index);
  const closeImage = () => setSelectedIndex(null);

  const goPrev = () => {
    if (selectedIndex === null) return;
    setSelectedIndex(selectedIndex === 0 ? MUSEUM_IMAGES.length - 1 : selectedIndex - 1);
  };
  const goNext = () => {
    if (selectedIndex === null) return;
    setSelectedIndex(selectedIndex === MUSEUM_IMAGES.length - 1 ? 0 : selectedIndex + 1);
  };

  const selectedImage = selectedIndex !== null ? MUSEUM_IMAGES[selectedIndex] : null;
  const selectedUrl = selectedImage ? `./museum/${selectedImage}` : '';

  // Tag cloud
  const tags = lang === 'zh' ? ALL_TAGS_ZH : ALL_TAGS_EN;

  return (
    <div className="museum-container">
      {/* Header */}
      <div className="museum-header">
        <button onClick={onBack} className="museum-back-btn">
          <ArrowLeft size={16} />
          <span>{t('backToEditor')}</span>
        </button>
        <h1 className="museum-title">{t('museum')}</h1>
        <div className="museum-count">{filteredImages.length} memes</div>
      </div>

      {/* Search Bar */}
      <div className="museum-search-wrap">
        <div className="museum-search-box">
          <Search size={14} color="#888" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder={lang === 'zh' ? '按标签搜索，如：开心、生气、疑惑…' : 'Search tags: happy, angry, confused…'}
            className="museum-search-input"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="museum-search-clear">
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Tag Cloud */}
      <div className="museum-tag-cloud">
        {tags.map(tag => (
          <button
            key={tag}
            onClick={() => setActiveTag(tag === activeTag ? 'all' : tag)}
            className={`museum-tag ${activeTag === tag ? 'active' : ''}`}
          >
            <span>{TAG_EMOJI[tag] || '🏷️'}</span>
            <span>{tag}</span>
          </button>
        ))}
      </div>

      {/* Image Grid */}
      <div className="museum-grid">
        {filteredImages.map((filename, index) => {
          const tagData = getTagsFor(filename);
          const displayTags = lang === 'zh' ? tagData?.tags : tagData?.tagEn;
          return (
            <div
              key={filename}
              className="museum-card"
              onClick={() => openImage(MUSEUM_IMAGES.indexOf(filename))}
            >
              <img
                src={`./museum/${filename}`}
                alt={`panda meme ${index + 1}`}
                loading="lazy"
                className="museum-img"
              />
              {displayTags && displayTags.length > 0 && (
                <div className="museum-card-tags">
                  {displayTags.slice(0, 2).map(t => (
                    <span key={t} className="museum-tag-chip">{TAG_EMOJI[t] || ''}{t}</span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {filteredImages.length === 0 && (
        <div className="museum-empty">
          <p>{lang === 'zh' ? '没有找到匹配的表情包' : 'No memes found'}</p>
        </div>
      )}

      {/* Lightbox */}
      {selectedIndex !== null && selectedImage && (
        <div className="museum-lightbox" onClick={closeImage}>
          <div className="museum-lightbox-content" onClick={(e) => e.stopPropagation()}>
            <button className="lightbox-close" onClick={closeImage}><X size={20} /></button>
            <button className="lightbox-nav lightbox-prev" onClick={goPrev}><ChevronLeft size={28} /></button>
            <button className="lightbox-nav lightbox-next" onClick={goNext}><ChevronRight size={28} /></button>
            <img src={selectedUrl} alt="panda meme" className="lightbox-img" />
            <div className="lightbox-actions">
              <button className="lightbox-btn lightbox-edit" onClick={() => { handleEdit(selectedImage); closeImage(); }}>
                <Pencil size={16} /><span>{t('editMeme')}</span>
              </button>
              <button className="lightbox-btn lightbox-share" onClick={() => handleShareToX(selectedUrl, selectedImage)}>
                <Copy size={16} /><span>{t('shareToX')}</span>
              </button>
              <button className="lightbox-btn lightbox-download" onClick={() => handleDownload(selectedUrl, selectedImage)}>
                <Download size={16} /><span>{t('saveImage')}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && <div className="museum-toast">{toast}</div>}
    </div>
  );
}
