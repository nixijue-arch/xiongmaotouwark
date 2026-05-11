// QuickMode v2 — 简易"点选 + 立即出图"模式（完整移植 PandaHead 功能）
// Contributed by PandaHead (https://pandahead.fun · github.com/jokkibtc/panda)
//
// v2 增强 (vs v1)：
//   + face rotation 状态 + RotationDot 拖动条 + 在 preview 上滚轮微调
//   + face 水平翻转 (flip-h) + reset 按钮
//   + 文字语言池选择 (双 / 中 / EN)
//   + 收藏后弹 NamePopover 改名
//
// 集成方式：独立 page，不入侵编辑器内部 LeftSidebar / RightSidebar / CanvasArea
// "进编辑器精修"按钮 dispatch ADD_ELEMENT × 3 → setPage('editor')

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useMeme } from '@/context/MemeContext';
import { ALL_PANDAS as PANDA_HEADS, ALL_FACES as FACES, getLivePandaFaceOffset, type Material } from '@/data/materials';
import { pickRandomText, RANDOM_TEXTS_ZH, RANDOM_TEXTS_EN } from '@/data/quickModeTexts';
import { useQuickFavs, makeFavKey } from '@/hooks/useQuickFavs';
import { useLiveAnchor } from '@/hooks/useLiveAnchor';
import { copyImageToClipboard, downloadImage } from '@/lib/exportImage';
import { PandaCanvas } from '@/components/pandacanvas';
import { PhotoCropModal } from '@/components/photocropmodal';
import { SmartExtractModal } from '@/components/smartextractmodal';
import { calcEditorFaceLayout } from '@/lib/composeMeme';
import { Camera } from 'lucide-react';
import {
  Sparkles, Copy, Download, Heart, Wand2, ArrowRight, Type,
  RotateCcw, FlipHorizontal, Check, X,
} from 'lucide-react';
import { toast } from 'sonner';
import './quickmode.css';

const FONT_OPTIONS = [
  { id: 'default', labelKey: 'quickFontDefault' as const, stack: '"Noto Sans SC", system-ui, sans-serif' },
  { id: 'serif',   labelKey: 'quickFontSerif'   as const, stack: '"Songti SC", "STSong", "SimSun", serif' },
  { id: 'mono',    labelKey: 'quickFontMono'    as const, stack: 'ui-monospace, SFMono-Regular, "Noto Sans SC", monospace' },
];

const TEXT_LANG_OPTIONS = [
  { id: 'both' as const, label: '双' },
  { id: 'zh'   as const, label: '中' },
  { id: 'en'   as const, label: 'EN' },
];

interface QuickModeProps {
  onOpenEditor: () => void;
}

export function QuickMode({ onOpenEditor }: QuickModeProps) {
  const { state, dispatch, t, generateId, saveDraftWithState, clearDraft } = useMeme();
  const lang = state.language;
  // DEV: 校准工具改 anchor 时触发 re-render，让预览实时显示新值
  useLiveAnchor();

  const [pandaId, setPandaId] = useState<string>(() => PANDA_HEADS[0]?.id ?? '');
  const [faceId, setFaceId] = useState<string>(() => FACES[0]?.id ?? '');
  const [text, setText] = useState<string>(
    () => (lang === 'zh' ? RANDOM_TEXTS_ZH : RANDOM_TEXTS_EN)[0] ?? ''
  );
  const [fontKey, setFontKey] = useState<string>('default');
  const [textLang, setTextLang] = useState<'both' | 'zh' | 'en'>(() => {
    try { return (localStorage.getItem('pmw-quick-textlang') as 'both' | 'zh' | 'en') || 'both'; }
    catch { return 'both'; }
  });
  const [faceRotation, setFaceRotation] = useState(0);
  const [faceFlipX, setFaceFlipX] = useState(false);
  const [customFaceModalOpen, setCustomFaceModalOpen] = useState(false);
  const [smartModalOpen, setSmartModalOpen] = useState(false);
  const [customFace, setCustomFace] = useState<Material | null>(null);
  // 防频闪：滚轮高频改 rotation 时，PandaCanvas 用 deferred 值
  // → React 跳过中间帧，仅在用户停下时合成最终 canvas
  // memory feedback_engineering.md '频闪用 useDeferredValue 防' SOP
  const deferredRotation = useDeferredValue(faceRotation);
  const deferredFlipX = useDeferredValue(faceFlipX);
  const [namePopoverOpen, setNamePopoverOpen] = useState(false);
  const [pendingFavName, setPendingFavName] = useState('');

  useEffect(() => {
    try { localStorage.setItem('pmw-quick-textlang', textLang); } catch { /* ignore */ }
  }, [textLang]);

  const previewRef = useRef<HTMLDivElement>(null);
  const previewWrapRef = useRef<HTMLDivElement>(null);
  const { favs, toggle, rename } = useQuickFavs();

  const panda = useMemo(
    () => PANDA_HEADS.find((p) => p.id === pandaId) ?? PANDA_HEADS[0],
    [pandaId]
  );
  // 优先用 customFace (自制/智能提取的)，否则用 池里的
  const face = useMemo(() => customFace ?? (FACES.find((f) => f.id === faceId) ?? FACES[0]), [faceId, customFace]);

  // 自制熊猫脸 / 智能提取 confirm 后注入到 Quick 的 face state — 跳过 faceId 直接覆盖
  const onCustomFaceConfirm = useCallback((dataUrl: string) => {
    const id = `custom-face-${Date.now()}`;
    setCustomFace({ id, src: dataUrl, labelCn: '自制人脸', labelEn: 'Custom', tags: [], tagsEn: [], faceOffset: { x: 0, y: 0, w: 0, h: 0 } });
    setCustomFaceModalOpen(false);
    setSmartModalOpen(false);
  }, []);
  const fontStack = FONT_OPTIONS.find((f) => f.id === fontKey)?.stack ?? FONT_OPTIONS[0].stack;
  const favKey = makeFavKey(pandaId, faceId, text, fontKey);
  const isFavored = Boolean(favs[favKey]);

  // -------- actions --------

  const onRandomText = useCallback(() => {
    setText((cur) => pickRandomText(textLang, cur));
  }, [textLang]);

  const onRandomize = useCallback(() => {
    const otherPandas = PANDA_HEADS.filter((p) => p.id !== pandaId);
    const otherFaces = FACES.filter((f) => f.id !== faceId);
    const np = otherPandas.length ? otherPandas : PANDA_HEADS;
    const nf = otherFaces.length ? otherFaces : FACES;
    setPandaId(np[Math.floor(Math.random() * np.length)].id);
    setFaceId(nf[Math.floor(Math.random() * nf.length)].id);
    setText((cur) => pickRandomText(textLang, cur));
    setFaceRotation(0);
    setFaceFlipX(false);
  }, [pandaId, faceId, textLang]);

  const onResetTransform = useCallback(() => {
    setFaceRotation(0);
    setFaceFlipX(false);
  }, []);

  const onFlipH = useCallback(() => setFaceFlipX((f) => !f), []);

  const onCopy = useCallback(async () => {
    if (!previewRef.current) return;
    try {
      await copyImageToClipboard(previewRef.current);
      toast.success(t('quickCopied'));
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'unknown';
      toast.error(`${t('quickCopyFail')}: ${msg}`);
    }
  }, [t]);

  const onDownload = useCallback(async () => {
    if (!previewRef.current) return;
    try {
      await downloadImage(previewRef.current, `panda-${pandaId}-${faceId}-${Date.now()}.png`);
    } catch (e) {
      toast.error(`Download failed: ${e instanceof Error ? e.message : 'unknown'}`);
    }
  }, [pandaId, faceId]);

  // 收藏 = 写 useQuickFavs (Collection 看得到) + 写 draftSlots (编辑器本地草稿看得到)
  // 取消收藏 = 同步删两边
  // 让"快速生图收藏"和"编辑器本地草稿"打通成同一个池子
  const onFav = useCallback(async () => {
    const wasOn = isFavored;
    toggle({ id: favKey, pandaId, faceId, text, fontFamily: fontKey });
    // 派生 slotId — 同一个 favKey 永远对应同一个 slot, 重复收藏不重复创建草稿
    const slotId = `quick-${favKey}`;

    if (wasOn) {
      clearDraft(slotId);
      toast.info(t('quickUnsaved'));
      return;
    }

    // 心 ON: 构造编辑器 elements 写入 draftSlot, 跟点"进编辑器精修"逻辑一致
    try {
      const offset350 = getLivePandaFaceOffset(panda);
      const faceLayout = await calcEditorFaceLayout({
        pandaSrc: panda.src,
        faceSrc: face.src,
        faceOffset350: offset350,
      });
      const elements: any[] = [
        {
          id: generateId(), type: 'image', src: panda.src, name: panda.id,
          x: 75, y: 50, width: 350, height: 350,
          rotation: 0, opacity: 1, zIndex: 0, flipX: false,
        },
        {
          id: generateId(), type: 'image', src: face.src, name: face.id,
          x: faceLayout.x, y: faceLayout.y, width: faceLayout.width, height: faceLayout.height,
          rotation: faceRotation, opacity: 1, zIndex: 1, flipX: faceFlipX,
        },
      ];
      if (text.trim()) {
        elements.push({
          id: generateId(), type: 'text', text,
          x: 60, y: 410, width: 380, height: 56,
          rotation: 0, opacity: 1, zIndex: 2,
          fontFamily: fontStack, fontSize: 32, fontWeight: 'bold',
          textAlign: 'center', fillColor: '#000000', strokeColor: '#ffffff',
          strokeWidth: 0,
        });
      }
      const slotName = text.trim() || `快速·${panda.labelCn}`;
      await saveDraftWithState(slotId, { elements, selectedId: null, language: lang }, slotName);
    } catch (e) {
      // 不阻断 fav, draft 写失败仍然显示 fav 心
      console.warn('[QuickMode] saveDraftWithState failed:', e);
    }

    setPendingFavName(text || '');
    setNamePopoverOpen(true);
    toast.success(t('quickSaved'));
  }, [isFavored, toggle, favKey, pandaId, faceId, text, fontKey, panda, face, faceRotation, faceFlipX, fontStack, lang, generateId, saveDraftWithState, clearDraft, t]);

  const onSaveName = useCallback((name: string) => {
    if (name.trim()) rename(favKey, name.trim());
    setNamePopoverOpen(false);
  }, [favKey, rename]);

  const onToEditor = useCallback(async () => {
    // 用 calcEditorFaceLayout 让编辑器里 face 元素位置/大小跟 QuickMode 预览视觉一致
    const offset350 = getLivePandaFaceOffset(panda);
    const faceLayout = await calcEditorFaceLayout({
      pandaSrc: panda.src,
      faceSrc: face.src,
      faceOffset350: offset350,
    });
    const pandaEl = {
      id: generateId(),
      type: 'image' as const,
      src: panda.src,
      name: panda.id,
      x: 75, y: 50, width: 350, height: 350,
      rotation: 0, opacity: 1, zIndex: 0, flipX: false,
    };
    dispatch({ type: 'CLEAR_CANVAS' });
    dispatch({ type: 'ADD_ELEMENT', element: pandaEl });
    setTimeout(() => {
      const faceEl = {
        id: generateId(),
        type: 'image' as const,
        src: face.src,
        name: face.id,
        x: faceLayout.x, y: faceLayout.y, width: faceLayout.width, height: faceLayout.height,
        rotation: faceRotation, opacity: 1, zIndex: 1, flipX: faceFlipX,
      };
      dispatch({ type: 'ADD_ELEMENT', element: faceEl });
      if (text.trim()) {
        const textEl = {
          id: generateId(),
          type: 'text' as const,
          text,
          x: 60, y: 410, width: 380, height: 56,
          rotation: 0, opacity: 1, zIndex: 2,
          fontFamily: fontStack,
          fontSize: 32, fontWeight: 'bold' as const,
          textAlign: 'center' as const,
          fillColor: '#000000', strokeColor: '#ffffff',
          strokeWidth: 0,
        };
        dispatch({ type: 'ADD_ELEMENT', element: textEl });
      }
      onOpenEditor();
    }, 30);
  }, [dispatch, generateId, panda, face, text, faceRotation, faceFlipX, fontStack, onOpenEditor]);

  // (键盘快捷键 R/C/D 已删 — 用户反馈干扰 form 输入和浏览器原生快捷键)

  // (滚轮调 face rotation 已删 — 用户反馈页面滚轮误触干扰，改为只能拖圆点旋转)

  // -------- render --------

  return (
    <div className="about-container about-arcade-shell quickmode-root">
      <div className="about-page quickmode-three-col" style={{ display: 'flex', gap: 14, padding: '12px 14px 20px', minHeight: 'calc(100vh - 70px)' }}>
        {/* ===== 左栏: 选熊猫头 + 选人脸 ===== */}
        <aside style={{ width: 320, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 'calc(100vh - 70px)', overflowY: 'auto' }}>
          <PickPanel
            badge="🐼"
            title={t('quickPickPanda')}
            items={PANDA_HEADS}
            value={pandaId}
            onChange={setPandaId}
            lang={lang}
          />
          <PickPanel
            badge="😂"
            title={t('quickPickFace')}
            items={FACES}
            value={customFace ? '__custom__' : faceId}
            onChange={(id) => { setFaceId(id); setCustomFace(null); }}
            lang={lang}
          />
        </aside>

        {/* ===== 中间: 预览 + 操作 + transform ===== */}
        <main style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, minWidth: 0 }}>
          {/* 预览大卡 */}
          <div ref={previewWrapRef} style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
            <div
              ref={previewRef}
              className="quickmode-preview"
              style={{
                fontFamily: fontStack,
                background: '#fff',
                borderRadius: 22,
                border: '3px solid #0a4e97',
                boxShadow: 'inset 0 0 0 2px rgba(255,255,255,0.55), 0 8px 24px rgba(7,48,95,0.22)',
                padding: 24,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                width: '100%',
                maxWidth: 460,
              }}
            >
              <div className="qm-panda-frame">
                <PandaCanvas
                  pandaSrc={panda.src}
                  pandaId={panda.id}
                  faceSrc={face.src}
                  faceOffset={getLivePandaFaceOffset(panda)}
                  rotation={deferredRotation}
                  flipX={deferredFlipX}
                  alt={panda.id}
                  className="qm-panda-img"
                />
              </div>
              {text && (
                <div className="qm-caption" style={{ fontFamily: fontStack }}>{text}</div>
              )}
            </div>
          </div>

          {/* 操作按钮组 */}
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 10 }}>
            <button onClick={onCopy} className="about-arcade-btn">
              <Copy size={14} /> {t('quickCopy')}
            </button>
            <button onClick={onDownload} className="about-arcade-btn">
              <Download size={14} /> {t('quickDownload')}
            </button>
            <div style={{ position: 'relative' }}>
              <button onClick={onFav} className="about-arcade-btn" style={isFavored ? { background: 'linear-gradient(180deg, #ff7e3e 0%, #d8541a 100%)', borderColor: '#a13a09' } : {}}>
                <Heart size={14} fill={isFavored ? '#fff' : 'none'} />
                {t('quickFav')}
              </button>
              {namePopoverOpen && (
                <NamePopover
                  initial={pendingFavName}
                  onSave={onSaveName}
                  onClose={() => setNamePopoverOpen(false)}
                  placeholder={lang === 'zh' ? '起个名字...' : 'Name it...'}
                />
              )}
            </div>
            <button onClick={onToEditor} className="about-arcade-btn" style={{ background: 'linear-gradient(180deg, #f5c56a 0%, #e0a13e 100%)', borderColor: '#7a5a1a' }}>
              {t('quickToEditor')} <ArrowRight size={14} />
            </button>
          </div>

          {/* Transform row 米白卡 — 宽度与上方 preview (maxWidth: 460) 对齐 */}
          <div
            className="about-banner-card quickmode-transform-card"
            style={{
              padding: '10px 16px',
              width: '100%',
              maxWidth: 460,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              flexWrap: 'nowrap',
              boxSizing: 'border-box',
            }}
          >
            <RotationDot value={faceRotation} onChange={setFaceRotation} />
            <span className="qm-rotation-display" title={lang === 'zh' ? '当前旋转角度' : 'Current rotation'}>
              {faceRotation > 0 ? '+' : ''}{faceRotation}°
              {faceFlipX && ' ⇋'}
            </span>
            <button
              onClick={onFlipH}
              className={'qm-icon-btn ' + (faceFlipX ? 'qm-icon-btn-on' : '')}
              title={lang === 'zh' ? '水平翻转' : 'Flip horizontal'}
            >
              <FlipHorizontal size={14} />
            </button>
            <button
              onClick={onResetTransform}
              className="qm-icon-btn"
              title={lang === 'zh' ? '重置' : 'Reset'}
            >
              <RotateCcw size={14} />
            </button>
          </div>
        </main>

        {/* ===== 右栏: 操作 → 上传/提取 → 文字（user 指定顺序） ===== */}
        <aside style={{ width: 300, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <section className="about-panel">
            <div className="about-panel-title">
              <span className="about-panel-badge"><Sparkles size={18} /></span>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#0a356d' }}>{lang === 'zh' ? '操作' : 'Actions'}</h3>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button onClick={onRandomize} className="about-arcade-btn" style={{ width: '100%' }}>
                <Wand2 size={14} /> {t('quickRandom')}
              </button>
              <button onClick={onToEditor} className="about-arcade-btn" style={{ width: '100%', background: 'linear-gradient(180deg, #f5c56a 0%, #e0a13e 100%)', borderColor: '#7a5a1a' }}>
                {t('quickToEditor')} <ArrowRight size={14} />
              </button>
            </div>
          </section>

          {/* 上传 / 智能提取人脸 — 输出后直接套到 Quick 当前 panda 上 */}
          <section className="about-panel">
            <div className="about-panel-title">
              <span className="about-panel-badge"><Camera size={18} /></span>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#0a356d' }}>{lang === 'zh' ? '上传 / 提取' : 'Upload / Extract'}</h3>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button onClick={() => setCustomFaceModalOpen(true)} className="about-arcade-btn" style={{ width: '100%', background: 'linear-gradient(180deg, #f5c56a 0%, #e0a13e 100%)', borderColor: '#7a5a1a' }}>
                <Camera size={14} /> {t('customFace')}
              </button>
              <button onClick={() => setSmartModalOpen(true)} className="about-arcade-btn" style={{ width: '100%', background: 'linear-gradient(180deg, #34d4a1 0%, #10a87a 100%)', borderColor: '#0a6e50' }}>
                <Sparkles size={14} /> {t('smartExtract')}
              </button>
              {customFace && (
                <button onClick={() => setCustomFace(null)} className="about-arcade-btn" style={{ width: '100%', background: 'linear-gradient(180deg, #fff 0%, #e8e8e8 100%)', borderColor: '#888', color: '#0a356d', fontSize: 12, padding: '8px 14px' }}>
                  <X size={12} /> {lang === 'zh' ? '清除自制人脸' : 'Clear custom face'}
                </button>
              )}
            </div>
          </section>

          <section className="about-panel">
            <div className="about-panel-title">
              <span className="about-panel-badge"><Type size={18} /></span>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#0a356d' }}>{t('quickText')}</h3>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input
                type="text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={t('quickTextPlaceholder')}
                style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: '2px solid #0a4e97',
                  background: '#fff',
                  color: '#0a356d',
                  fontSize: 14,
                  fontFamily: 'inherit',
                  outline: 'none',
                }}
              />
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <button onClick={onRandomText} className="about-arcade-btn" style={{ padding: '6px 12px', fontSize: 12, flex: 1 }} title={t('quickRandomText')}>
                  <Wand2 size={12} /> {lang === 'zh' ? '换文字' : 'Reroll'}
                </button>
                <div style={{ display: 'inline-flex', gap: 0, borderRadius: 10, overflow: 'hidden', border: '2px solid #0a4e97' }}>
                  {TEXT_LANG_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      onClick={() => setTextLang(opt.id)}
                      style={{
                        padding: '6px 12px',
                        fontSize: 12,
                        fontWeight: 700,
                        background: textLang === opt.id ? 'linear-gradient(180deg, #1f92f8 0%, #116bcc 100%)' : '#fff',
                        color: textLang === opt.id ? '#fff' : '#0a356d',
                        border: 'none',
                        cursor: 'pointer',
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              <select
                value={fontKey}
                onChange={(e) => setFontKey(e.target.value)}
                style={{
                  padding: '8px 10px',
                  borderRadius: 10,
                  border: '2px solid #0a4e97',
                  background: '#fff',
                  color: '#0a356d',
                  fontSize: 13,
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                }}
              >
                {FONT_OPTIONS.map((f) => (
                  <option key={f.id} value={f.id}>{t(f.labelKey)}</option>
                ))}
              </select>
            </div>
          </section>
        </aside>
      </div>

      {/* Modals — onConfirm 注入 face 到 quick state */}
      <PhotoCropModal
        isOpen={customFaceModalOpen}
        onClose={() => setCustomFaceModalOpen(false)}
        onConfirm={onCustomFaceConfirm}
        language={lang}
      />
      <SmartExtractModal
        isOpen={smartModalOpen}
        onClose={() => setSmartModalOpen(false)}
        onConfirm={onCustomFaceConfirm}
        language={lang}
      />
    </div>
  );
}

// 选 panda / face 的小 panel — 用 about-panel + 2 列 grid
interface PickPanelProps {
  badge: string;
  title: string;
  items: Material[];
  value: string;
  onChange: (id: string) => void;
  lang: 'zh' | 'en';
}
function PickPanel({ badge, title, items, value, onChange, lang }: PickPanelProps) {
  return (
    <section className="about-panel" style={{ padding: 12 }}>
      <div className="about-panel-title" style={{ marginBottom: 10 }}>
        <span className="about-panel-badge" style={{ fontSize: 18 }}>{badge}</span>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: '#0a356d' }}>{title}</h3>
        <span className="about-chip" style={{ padding: '2px 8px', fontSize: 11, marginLeft: 'auto' }}>{items.length}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, maxHeight: 360, overflowY: 'auto', paddingRight: 4 }}>
        {items.map((it) => (
          <button
            key={it.id}
            onClick={() => onChange(it.id)}
            title={lang === 'zh' ? it.labelCn : it.labelEn}
            style={{
              padding: 4,
              borderRadius: 10,
              background: '#fff',
              // 只在边框做选中高亮 — 不要整张卡蓝色盖住 panda/face 图
              border: it.id === value ? '3px solid #1f92f8' : '2px solid rgba(10, 78, 151, 0.18)',
              boxShadow: it.id === value ? '0 0 0 2px rgba(31,146,248,0.25), 0 2px 8px rgba(7,48,95,0.18)' : 'none',
              cursor: 'pointer',
              aspectRatio: '1',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 120ms ease',
            }}
          >
            <img src={it.src} alt={it.id} draggable={false} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          </button>
        ))}
      </div>
    </section>
  );
}

interface RailSectionProps {
  emoji: string;
  title: string;
  items: Material[];
  value: string;
  onChange: (id: string) => void;
  lang: 'zh' | 'en';
}

function RailSection({ emoji, title, items, value, onChange, lang }: RailSectionProps) {
  const railRef = useRef<HTMLDivElement>(null);
  const idx = items.findIndex((it) => it.id === value);

  useEffect(() => {
    const el = railRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY === 0) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <div className="quickmode-rail-section">
      <div className="quickmode-rail-header">
        <span className="qm-rail-title">
          <span className="qm-rail-emoji">{emoji}</span>
          {title}
        </span>
        <span className="qm-rail-count">{Math.max(0, idx) + 1} / {items.length}</span>
      </div>
      <div ref={railRef} className="quickmode-rail">
        {items.map((it) => (
          <button
            key={it.id}
            onClick={() => onChange(it.id)}
            className={'qm-rail-item ' + (it.id === value ? 'qm-rail-item-active' : '')}
            title={lang === 'zh' ? it.labelCn : it.labelEn}
          >
            <img src={it.src} alt={it.id} draggable={false} loading="lazy" />
          </button>
        ))}
      </div>
    </div>
  );
}

// RotationDot — 拖动圆点条调 face 旋转 (-180 ~ 180 度)
function RotationDot({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const updateFromX = useCallback((clientX: number) => {
    if (!trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, x / rect.width));
    onChange(Math.round((ratio - 0.5) * 360));
  }, [onChange]);

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(true);
    updateFromX(e.clientX);
  };

  const onTouchStart = (e: React.TouchEvent) => {
    if (!e.touches || !e.touches[0]) return;
    setDragging(true);
    updateFromX(e.touches[0].clientX);
  };

  useEffect(() => {
    if (!dragging) return;
    const onMouseMove = (e: MouseEvent) => updateFromX(e.clientX);
    const onMouseUp = () => setDragging(false);
    const onTouchMove = (e: TouchEvent) => {
      if (!e.touches || !e.touches[0]) return;
      e.preventDefault();
      updateFromX(e.touches[0].clientX);
    };
    const onTouchEnd = () => setDragging(false);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
    };
  }, [dragging, updateFromX]);

  const dotPercent = 50 + (value / 360) * 100;

  return (
    <div ref={trackRef} onMouseDown={onMouseDown} onTouchStart={onTouchStart}
      className="qm-rotation-track">
      <div className="qm-rotation-track-bar" />
      <div className="qm-rotation-track-center" />
      <div className="qm-rotation-dot" style={{ left: `${dotPercent}%` }}>
        <div className="qm-rotation-dot-arrow" style={{ transform: `rotate(${value}deg)` }} />
      </div>
    </div>
  );
}

// NamePopover — 收藏后弹小 input 改名
function NamePopover({ initial, onSave, onClose, placeholder }: {
  initial: string;
  onSave: (name: string) => void;
  onClose: () => void;
  placeholder: string;
}) {
  const [v, setV] = useState(initial);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [onClose]);

  return (
    <div ref={ref} className="qm-name-popover">
      <input
        autoFocus
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSave(v.trim());
          if (e.key === 'Escape') onClose();
        }}
        placeholder={placeholder}
        className="qm-name-input"
      />
      <button onClick={() => onSave(v.trim())} className="qm-name-ok"><Check size={12} /></button>
      <button onClick={onClose} className="qm-name-cancel"><X size={12} /></button>
    </div>
  );
}
