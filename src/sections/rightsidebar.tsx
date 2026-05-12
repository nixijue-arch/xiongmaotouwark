import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useMeme } from '@/context/memecontext';
import { useIsMobile } from '@/hooks/usemediaquery';
import type { ImageElement, TextElement, MemeElement } from '@/context/memecontext';
import { Download, Trash2, Shuffle, Image, MessageCircle, Sparkles, Settings2, Upload, X, ChevronUp, Camera, Type, AlignLeft, AlignCenter, AlignRight, Bold, Copy, Heart } from 'lucide-react';
import { PANDA_HEADS, ALL_PANDAS, ALL_FACES, getPandaFaceOffset, getLivePandaFaceOffset, getShellLayering } from '@/data/materials';
import { PhotoCropModal } from '@/components/photocropmodal';
import { SmartExtractModal } from '@/components/smartextractmodal';
import { calcEditorFaceLayout, getEditorPandaBox } from '@/lib/composeMeme';
// 编辑器推荐文字 / 随机文案 ← 与 QuickMode 共享同一个池
import { RECOMMEND_TEXTS_ZH as ZH_TEXTS, RECOMMEND_TEXTS_EN as EN_TEXTS } from '@/data/quickModeTexts';
import { toast } from 'sonner';

const MAX_UPLOAD_SIZE = 5 * 1024 * 1024;
const ALLOWED_UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const CAPTURE_SIZE = 500;
const PREVIEW_CROP_MIN_SIZE = 48;
const PREVIEW_CROP_PADDING = 16;
const PANEL_BORDER = '#8cabd8';
const PANEL_BG = '#edf5ff';
const PANEL_SURFACE = '#ffffff';
const PANEL_TEXT = '#22415f';
const PANEL_MUTED = '#6b86a7';

type CropRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type CropHandle = 'move' | 'nw' | 'ne' | 'sw' | 'se';

function validateImageFile(file: File, language: 'zh' | 'en'): string | null {
  if (!ALLOWED_UPLOAD_TYPES.includes(file.type)) {
    return language === 'zh' ? '仅支持 JPG、PNG、WEBP 或 GIF 图片' : 'Only JPG, PNG, WEBP, or GIF images are supported';
  }
  if (file.size > MAX_UPLOAD_SIZE) {
    return language === 'zh' ? '图片不能超过 5MB' : 'Images must be 5MB or smaller';
  }
  return null;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = event => {
      const dataUrl = event.target?.result;
      if (typeof dataUrl === 'string' && dataUrl) {
        resolve(dataUrl);
        return;
      }
      reject(new Error('Empty file data'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = dataUrl;
  });
}

async function renderMemeCanvas(elements: MemeElement[], pixelScale = 1): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  canvas.width = CAPTURE_SIZE * pixelScale;
  canvas.height = CAPTURE_SIZE * pixelScale;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to create canvas context');
  }

  ctx.scale(pixelScale, pixelScale);
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, CAPTURE_SIZE, CAPTURE_SIZE);

  const orderedElements = [...elements].sort((a, b) => a.zIndex - b.zIndex);
  const imageCache = new Map<string, Promise<HTMLImageElement>>();

  for (const element of orderedElements) {
    ctx.save();
    ctx.globalAlpha = element.opacity ?? 1;

    if (element.type === 'image') {
      const imageElement = element as ImageElement;
      let imagePromise = imageCache.get(imageElement.src);
      if (!imagePromise) {
        imagePromise = loadImage(imageElement.src);
        imageCache.set(imageElement.src, imagePromise);
      }

      const image = await imagePromise;
      ctx.translate(imageElement.x + imageElement.width / 2, imageElement.y + imageElement.height / 2);
      ctx.rotate((imageElement.rotation * Math.PI) / 180);
      ctx.scale(imageElement.flipX ? -1 : 1, 1);
      ctx.drawImage(image, -imageElement.width / 2, -imageElement.height / 2, imageElement.width, imageElement.height);
      ctx.restore();
      continue;
    }

    const textElement = element as TextElement;
    ctx.translate(textElement.x, textElement.y);
    ctx.rotate((textElement.rotation * Math.PI) / 180);
    ctx.font = `${textElement.fontWeight} ${textElement.fontSize}px ${textElement.fontFamily}`;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillStyle = textElement.fillColor;
    ctx.strokeStyle = textElement.strokeColor;
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(0, textElement.strokeWidth * 2);

    // Match the on-canvas text block, which is currently rendered as a natural-width
    // inline element with Tailwind `px-2 py-1`.
    const textX = 8;
    const textY = 4;

    if (textElement.strokeWidth > 0) {
      ctx.strokeText(textElement.text, textX, textY);
    }
    ctx.fillText(textElement.text, textX, textY);
    ctx.restore();
  }

  return canvas;
}

function clampCropRect(rect: CropRect, boundsWidth = CAPTURE_SIZE, boundsHeight = CAPTURE_SIZE): CropRect {
  const minWidth = Math.min(PREVIEW_CROP_MIN_SIZE, boundsWidth);
  const minHeight = Math.min(PREVIEW_CROP_MIN_SIZE, boundsHeight);
  const width = Math.max(minWidth, Math.min(boundsWidth, rect.width));
  const height = Math.max(minHeight, Math.min(boundsHeight, rect.height));
  const x = Math.max(0, Math.min(boundsWidth - width, rect.x));
  const y = Math.max(0, Math.min(boundsHeight - height, rect.y));
  return { x, y, width, height };
}

function cropCanvas(source: HTMLCanvasElement, cropRect: CropRect): HTMLCanvasElement {
  const safeRect = clampCropRect(cropRect, source.width, source.height);
  const target = document.createElement('canvas');
  target.width = Math.max(1, Math.round(safeRect.width));
  target.height = Math.max(1, Math.round(safeRect.height));
  const ctx = target.getContext('2d');
  if (!ctx) return source;

  ctx.drawImage(
    source,
    safeRect.x,
    safeRect.y,
    safeRect.width,
    safeRect.height,
    0,
    0,
    target.width,
    target.height
  );
  return target;
}

function scaleCropRect(cropRect: CropRect, scaleX: number, scaleY = scaleX): CropRect {
  return {
    x: cropRect.x * scaleX,
    y: cropRect.y * scaleY,
    width: cropRect.width * scaleX,
    height: cropRect.height * scaleY,
  };
}

function detectContentBounds(canvas: HTMLCanvasElement): CropRect {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return { x: 0, y: 0, width: CAPTURE_SIZE, height: CAPTURE_SIZE };
  }

  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const alpha = data[idx + 3];
      if (alpha < 8) continue;

      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const isNearWhite = r > 248 && g > 248 && b > 248;
      if (isNearWhite) continue;

      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < minX || maxY < minY) {
    return { x: 0, y: 0, width: CAPTURE_SIZE, height: CAPTURE_SIZE };
  }

  return clampCropRect({
    x: minX - PREVIEW_CROP_PADDING,
    y: minY - PREVIEW_CROP_PADDING,
    width: maxX - minX + 1 + PREVIEW_CROP_PADDING * 2,
    height: maxY - minY + 1 + PREVIEW_CROP_PADDING * 2,
  });
}

function isPanda(e: MemeElement): boolean {
  if (e.type !== 'image') return false;
  const name = (e as ImageElement).name;
  // 用 ALL_PANDAS (70 = 24 native + 46 ph) 不是只 PANDA_HEADS
  return ALL_PANDAS.some(p => p.id === name) || name.startsWith('upload-panda-');
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

function LayerThumbnail({ element }: { element: MemeElement }) {
  const size = 38;
  const style: React.CSSProperties = { width: size, height: size, borderRadius: 6, flexShrink: 0, overflow: 'hidden' };

  if (element.type === 'image') {
    return (
      <div style={{ ...style, backgroundColor: '#fff' }}>
        <img src={(element as ImageElement).src} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
      </div>
    );
  }

  const el = element as TextElement;
  return (
    <div style={{ ...style, backgroundColor: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 3 }}>
      <span style={{
        color: el.fillColor,
        fontSize: 9,
        fontWeight: el.fontWeight,
        fontFamily: el.fontFamily,
        WebkitTextStroke: el.strokeWidth > 0 ? `0.4px ${el.strokeColor}` : 'none',
        lineHeight: 1.2,
        textAlign: 'center',
        wordBreak: 'break-all',
        display: '-webkit-box',
        WebkitLineClamp: 3,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
      } as React.CSSProperties}>
        {el.text || 'T'}
      </span>
    </div>
  );
}

function getLayerLabel(element: MemeElement, language: 'zh' | 'en'): string {
  if (element.type === 'text') {
    const text = (element.text || '').trim();
    if (text) return text.length > 14 ? `${text.slice(0, 14)}…` : text;
    return language === 'zh' ? '文字图层' : 'Text Layer';
  }

  if (isPanda(element)) {
    return language === 'zh' ? '熊猫头' : 'Panda Head';
  }

  if (isFace(element)) {
    return language === 'zh' ? '人脸' : 'Face';
  }

  return language === 'zh' ? '图片图层' : 'Image Layer';
}

function moveArrayItem<T>(items: T[], fromIndex: number, toIndex: number) {
  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

export function RightSidebar({ canvasRef }: { canvasRef: React.RefObject<HTMLDivElement | null> }) {
  const { state, dispatch, t, generateId, draftSlots, saveDraft } = useMeme();
  const isMobile = useIsMobile();
  const [isExporting, setIsExporting] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [copyToast, setCopyToast] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>('');
  const [previewCrop, setPreviewCrop] = useState<CropRect>({ x: 0, y: 0, width: CAPTURE_SIZE, height: CAPTURE_SIZE });
  const [sheetOpen, setSheetOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [smartModalOpen, setSmartModalOpen] = useState(false);
  const [draggedLayerId, setDraggedLayerId] = useState<string | null>(null);
  const [dragOverLayerId, setDragOverLayerId] = useState<string | null>(null);

  // RPC for EditorMobilePanel — 通过 window event 调用本组件内部 handler
  // 用 ref 模式避免 useEffect 反复 attach/remove listener (handler 每渲染都重新创建)
  const editorRpcRef = useRef<{
    switchImage?: () => void;
    recommendText?: () => void;
    openSheet?: () => void;
  }>({});

  useEffect(() => {
    const onSwitchImg = () => editorRpcRef.current.switchImage?.();
    const onRecText = () => editorRpcRef.current.recommendText?.();
    const onOpen = () => editorRpcRef.current.openSheet?.();
    window.addEventListener('xmw-editor-switch-image', onSwitchImg);
    window.addEventListener('xmw-editor-recommend-text', onRecText);
    window.addEventListener('xmw-editor-open-right-sheet', onOpen);
    return () => {
      window.removeEventListener('xmw-editor-switch-image', onSwitchImg);
      window.removeEventListener('xmw-editor-recommend-text', onRecText);
      window.removeEventListener('xmw-editor-open-right-sheet', onOpen);
    };
  }, []);
  const previewRequestIdRef = useRef(0);
  const previewCropActionRef = useRef<{
    handle: CropHandle;
    startX: number;
    startY: number;
    startRect: CropRect;
  } | null>(null);
  const previewCropFrameRef = useRef<HTMLDivElement | null>(null);

  const handleExport = async () => {
    if (state.elements.length === 0) {
      alert(state.language === 'zh' ? '画布为空' : 'Canvas is empty');
      return;
    }
    setIsExporting(true);
    try {
      const fullCanvas = await renderMemeCanvas(state.elements, 2);
      const scale = fullCanvas.width / CAPTURE_SIZE;
      const exportCanvas = cropCanvas(fullCanvas, scaleCropRect(previewCrop, scale));
      const dataUrl = exportCanvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.download = `memeforge-${Date.now()}.png`;
      link.href = dataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 3000);
    } catch (err) {
      console.error('Export failed:', err);
      alert(state.language === 'zh' ? '导出失败' : 'Export failed');
    } finally {
      setIsExporting(false);
    }
  };

  const handleClearCanvas = () => dispatch({ type: 'CLEAR_CANVAS' });

  // 保存当前编辑器内容为草图 — 写入 draftSlots (这是 Collection + 编辑器本地草稿的唯一数据源)
  const handleSaveDraft = useCallback(() => {
    const pandaEl = state.elements.find(isPanda) as ImageElement | undefined;
    const faceEl = state.elements.find(isFace) as ImageElement | undefined;
    if (!pandaEl || !faceEl) {
      toast.error(state.language === 'zh' ? '需要至少有 panda 和 face 才能存草图' : 'Need at least panda + face to save');
      return;
    }
    const slotId = `draft-${Date.now()}-${draftSlots.length + 1}`;
    void saveDraft(slotId);
    toast.success(state.language === 'zh' ? '已存到草图（左上角本地草稿 + 草图 tab 同步）' : 'Saved to drafts');
  }, [state.elements, state.language, saveDraft, draftSlots.length]);

  // 预览自动刷新 — elements 变化后 debounce 600ms 重生成（user 反馈手动按钮繁琐）
  const elementsKey = state.elements.map(e => e.id + ':' + ((e as ImageElement).src ?? '') + ':' + (e.type === 'text' ? (e as TextElement).text : '')).join('|');
  const prevKeyRef = useRef('');

  // 随机组合 — 用 calcEditorFaceLayout 自动定位 face + 素材池 ALL_* (70+132 全集)
  const handleRandomCombo = async () => {
    const randomPanda = ALL_PANDAS[Math.floor(Math.random() * ALL_PANDAS.length)];
    const randomFace = ALL_FACES[Math.floor(Math.random() * ALL_FACES.length)];
    const texts = state.language === 'zh' ? ZH_TEXTS : EN_TEXTS;
    const randomText = texts[Math.floor(Math.random() * texts.length)];
    // v3: panda bbox-crop + 实际 box 计算 → face anchor 跟 QuickMode (PandaCanvas) 100% 对齐
    const pandaBox = await getEditorPandaBox(randomPanda.src);
    const faceLayout = await calcEditorFaceLayout({
      pandaSrc: randomPanda.src,
      faceSrc: randomFace.src,
      faceOffset350: getLivePandaFaceOffset(randomPanda),
      panda350OffsetX: pandaBox.x, panda350OffsetY: pandaBox.y,
      panda350W: pandaBox.w, panda350H: pandaBox.h,
    });
    const layering = getShellLayering(randomPanda.id);
    const pandaEl: ImageElement = { id: generateId(), type: 'image', src: pandaBox.croppedSrc, name: randomPanda.id, x: pandaBox.x, y: pandaBox.y, width: pandaBox.w, height: pandaBox.h, rotation: 0, opacity: 1, zIndex: layering.pandaZ, blendMode: layering.pandaBlend, flipX: false };
    const faceEl: ImageElement = { id: generateId(), type: 'image', src: randomFace.src, name: randomFace.id, x: faceLayout.x, y: faceLayout.y, width: faceLayout.width, height: faceLayout.height, rotation: 0, opacity: 1, zIndex: layering.faceZ, blendMode: layering.faceBlend, flipX: false };
    const textEl: TextElement = { id: generateId(), type: 'text', text: randomText, x: 50, y: 440, width: 400, height: 50, rotation: 0, opacity: 1, zIndex: 100, fontFamily: '"Noto Sans SC", "Impact", sans-serif', fontSize: 36, fontWeight: 'bold', textAlign: 'center', fillColor: '#000000', strokeColor: '#000000', strokeWidth: 0 };
    dispatch({ type: 'CLEAR_CANVAS' });
    dispatch({ type: 'ADD_ELEMENT', element: faceEl });
    dispatch({ type: 'ADD_ELEMENT', element: pandaEl });
    dispatch({ type: 'ADD_ELEMENT', element: textEl });
    if (isMobile) setSheetOpen(false);
  };

  // 一键换图 — 切 panda 时 face 跟着重新定位到新 panda anchor
  const handleSwitchImage = async () => {
    const currentPanda = state.elements.find(isPanda) as ImageElement | undefined;
    const currentFace = state.elements.find(isFace) as ImageElement | undefined;
    if (!currentPanda && !currentFace) { handleRandomCombo(); return; }
    const newPanda = currentPanda
      ? (() => { const others = ALL_PANDAS.filter(p => p.id !== currentPanda.name); return others.length ? others[Math.floor(Math.random() * others.length)] : null; })()
      : null;
    const newFace = currentFace
      ? (() => { const others = ALL_FACES.filter(f => f.id !== currentFace.name); return others.length ? others[Math.floor(Math.random() * others.length)] : null; })()
      : null;
    // v3: 切换 panda 时 bbox-crop + 实际 box 算 face anchor
    if (newPanda && currentPanda) {
      const lay = getShellLayering(newPanda.id);
      const pandaBox = await getEditorPandaBox(newPanda.src);
      dispatch({ type: 'UPDATE_ELEMENT', id: currentPanda.id, updates: { src: pandaBox.croppedSrc, name: newPanda.id, x: pandaBox.x, y: pandaBox.y, width: pandaBox.w, height: pandaBox.h, zIndex: lay.pandaZ, blendMode: lay.pandaBlend } });
      if (currentFace) {
        dispatch({ type: 'UPDATE_ELEMENT', id: currentFace.id, updates: { zIndex: lay.faceZ, blendMode: lay.faceBlend } });
      }
    }
    if (newFace && currentFace) {
      const anchorPanda = newPanda ?? ALL_PANDAS.find(p => p.id === currentPanda?.name);
      if (anchorPanda) {
        const pandaBox = await getEditorPandaBox(anchorPanda.src);
        const layout = await calcEditorFaceLayout({
          pandaSrc: anchorPanda.src, faceSrc: newFace.src,
          faceOffset350: getLivePandaFaceOffset(anchorPanda),
          panda350OffsetX: pandaBox.x, panda350OffsetY: pandaBox.y,
          panda350W: pandaBox.w, panda350H: pandaBox.h,
        });
        const lay = getShellLayering(anchorPanda.id);
        dispatch({ type: 'UPDATE_ELEMENT', id: currentFace.id, updates: { src: newFace.src, name: newFace.id, x: layout.x, y: layout.y, width: layout.width, height: layout.height, zIndex: lay.faceZ, blendMode: lay.faceBlend } });
      } else {
        dispatch({ type: 'UPDATE_ELEMENT', id: currentFace.id, updates: { src: newFace.src, name: newFace.id } });
      }
    }
    if (currentPanda && !currentFace) {
      const anchorPanda = newPanda ?? ALL_PANDAS.find(p => p.id === currentPanda.name);
      const randomFace = ALL_FACES[Math.floor(Math.random() * ALL_FACES.length)];
      if (anchorPanda) {
        const pandaBox = await getEditorPandaBox(anchorPanda.src);
        const layout = await calcEditorFaceLayout({
          pandaSrc: anchorPanda.src, faceSrc: randomFace.src,
          faceOffset350: getLivePandaFaceOffset(anchorPanda),
          panda350OffsetX: pandaBox.x, panda350OffsetY: pandaBox.y,
          panda350W: pandaBox.w, panda350H: pandaBox.h,
        });
        const lay = getShellLayering(anchorPanda.id);
        const faceEl: ImageElement = { id: generateId(), type: 'image', src: randomFace.src, name: randomFace.id, x: layout.x, y: layout.y, width: layout.width, height: layout.height, rotation: 0, opacity: 1, zIndex: lay.faceZ, blendMode: lay.faceBlend, flipX: false };
        dispatch({ type: 'ADD_ELEMENT', element: faceEl });
      }
    }
    // 兜底: 老草稿里 text 可能是 zIndex < 100, 换图后会被新 panda(5) 盖. 强制拉顶
    state.elements.forEach(el => {
      if (el.type === 'text' && el.zIndex < 100) {
        dispatch({ type: 'UPDATE_ELEMENT', id: el.id, updates: { zIndex: 100 } });
      }
    });
    if (isMobile) setSheetOpen(false);
  };

  // expose handlers for window event RPC
  editorRpcRef.current.switchImage = handleSwitchImage;
  editorRpcRef.current.openSheet = () => setSheetOpen(true);

  const handleRecommendText = () => {
    const texts = state.language === 'zh' ? ZH_TEXTS : EN_TEXTS;
    const randomText = texts[Math.floor(Math.random() * texts.length)];
    const existingText = state.elements.find(e => e.type === 'text');
    if (existingText) {
      dispatch({ type: 'UPDATE_ELEMENT', id: existingText.id, updates: { text: randomText } });
    } else {
      const textEl: TextElement = { id: generateId(), type: 'text', text: randomText, x: 50, y: 440, width: 400, height: 50, rotation: 0, opacity: 1, zIndex: 100, fontFamily: '"Noto Sans SC", "Impact", sans-serif', fontSize: 36, fontWeight: 'bold', textAlign: 'center', fillColor: '#000000', strokeColor: '#000000', strokeWidth: 0 };
      dispatch({ type: 'ADD_ELEMENT', element: textEl });
    }
  };

  // bind recommendText after definition
  editorRpcRef.current.recommendText = handleRecommendText;

  const handleAddText = () => {
    const promptText = state.language === 'zh' ? '输入文字内容' : 'Enter text content';
    const defaultText = state.language === 'zh' ? '点击输入文字' : 'Click to enter text';
    const text = window.prompt(promptText, defaultText);
    if (!text || text.trim() === '') return;
    const textEl: TextElement = { id: generateId(), type: 'text', text: text.trim(), x: 50, y: 440, width: 400, height: 50, rotation: 0, opacity: 1, zIndex: 100, fontFamily: '"Noto Sans SC", "Impact", sans-serif', fontSize: 36, fontWeight: 'bold', textAlign: 'center', fillColor: '#000000', strokeColor: '#000000', strokeWidth: 0 };
    dispatch({ type: 'ADD_ELEMENT', element: textEl });
    dispatch({ type: 'SELECT_ELEMENT', id: textEl.id });
  };

  const handleShare = async (platform: 'x' | 'facebook') => {
    if (platform === 'x') {
      // Copy canvas image then open X intent
      if (state.elements.length === 0) {
        alert(state.language === 'zh' ? '画布为空' : 'Canvas is empty');
        return;
      }
      try {
        const canvas = await renderMemeCanvas(state.elements, 2);
        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
        if (blob) {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
          setCopyToast(t('copyImageSuccess'));
        } else {
          setCopyToast(t('copyImageFailed'));
        }
        setTimeout(() => setCopyToast(null), 3000);
      } catch (err) {
        console.error('Copy canvas failed:', err);
        setCopyToast(t('copyImageFailed'));
        setTimeout(() => setCopyToast(null), 3000);
      }
      const text = encodeURIComponent((state.language === 'zh' ? '来看看我制作的熊猫头表情包！🐼' : 'Check out my panda meme! 🐼') + '\n\n');
      window.open(`https://twitter.com/intent/tweet?text=${text}&url=${encodeURIComponent(window.location.href)}`, '_blank', 'noopener,noreferrer,width=600,height=400');
    } else {
      const text = state.language === 'zh' ? '来看看我制作的熊猫头表情包！' : 'Check out my panda meme!';
      const url = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(window.location.href)}&quote=${encodeURIComponent(text)}`;
      window.open(url, '_blank', 'noopener,noreferrer,width=600,height=400');
    }
  };

  const handleCopyPreview = async () => {
    if (state.elements.length === 0) {
      alert(state.language === 'zh' ? '画布为空' : 'Canvas is empty');
      return;
    }

    try {
      const fullCanvas = await renderMemeCanvas(state.elements, 2);
      const scale = fullCanvas.width / CAPTURE_SIZE;
      const croppedCanvas = cropCanvas(fullCanvas, scaleCropRect(previewCrop, scale));
      const blob = await new Promise<Blob | null>(resolve => croppedCanvas.toBlob(resolve, 'image/png'));
      if (blob) {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        setCopyToast(t('copyImageSuccess'));
      } else {
        setCopyToast(t('copyImageFailed'));
      }
    } catch (err) {
      console.error('Copy preview failed:', err);
      setCopyToast(t('copyImageFailed'));
    }

    setTimeout(() => setCopyToast(null), 3000);
  };

  const handleUploadAsset = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const error = validateImageFile(file, state.language);
    if (error) {
      alert(error);
      return;
    }
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const image = await loadImage(dataUrl);
      const maxWidth = 320;
      const maxHeight = 320;
      const scale = Math.min(maxWidth / image.naturalWidth, maxHeight / image.naturalHeight, 1);
      const width = Math.max(40, Math.round(image.naturalWidth * scale));
      const height = Math.max(40, Math.round(image.naturalHeight * scale));
      const element: ImageElement = {
        id: generateId(),
        type: 'image',
        src: dataUrl,
        name: `upload-asset-${Date.now()}`,
        x: Math.round((CAPTURE_SIZE - width) / 2),
        y: Math.round((CAPTURE_SIZE - height) / 2),
        width,
        height,
        rotation: 0,
        opacity: 1,
        zIndex: 0,
        flipX: false,
      };
      dispatch({ type: 'ADD_ELEMENT', element });
    } catch (err) {
      console.error('Upload asset failed:', err);
      alert(state.language === 'zh' ? '图片读取失败，请重试' : 'Failed to read image, please try again');
    }
  };

  const handleCustomFaceConfirm = (dataUrl: string, facePos?: { x: number; y: number; w: number; h: number }) => {
    let currentPanda = getTargetPanda(state.elements, state.selectedId);
    if (!currentPanda) {
      const defaultPanda = PANDA_HEADS[0];
      const defaultLay = getShellLayering(defaultPanda.id);
      currentPanda = {
        id: generateId(), type: 'image', src: defaultPanda.src, name: defaultPanda.id,
        x: 75, y: 50, width: 350, height: 350, rotation: 0, opacity: 1,
        zIndex: defaultLay.pandaZ, blendMode: defaultLay.pandaBlend, flipX: false,
      };
      dispatch({ type: 'ADD_ELEMENT', element: currentPanda });
    }
    const offset = facePos || getPandaFaceOffset(currentPanda.name);
    const faceCount = state.elements.filter(isFace).length;
    const customLay = getShellLayering(currentPanda.name);
    const element: ImageElement = {
      id: generateId(), type: 'image', src: dataUrl, name: `custom-face-${Date.now()}`,
      x: offset.x + faceCount * 6, y: offset.y + faceCount * 6, width: offset.w, height: offset.h,
      rotation: 0, opacity: 1,
      zIndex: customLay.faceZ, blendMode: customLay.faceBlend, flipX: false,
    };
    dispatch({ type: 'ADD_ELEMENT', element });
    setModalOpen(false);
    if (isMobile) setSheetOpen(false);
  };

  const handleRefreshPreview = useCallback(async () => {
    if (state.elements.length === 0) {
      setPreviewUrl('');
      setPreviewCrop({ x: 0, y: 0, width: CAPTURE_SIZE, height: CAPTURE_SIZE });
      return;
    }

    const requestId = ++previewRequestIdRef.current;
    try {
      const canvas = await renderMemeCanvas(state.elements, 1);
      if (previewRequestIdRef.current === requestId) {
        setPreviewUrl(canvas.toDataURL('image/png'));
        setPreviewCrop(detectContentBounds(canvas));
      }
    } catch (err) { console.error('Preview failed:', err); }
  }, [state.elements]);

  // 预览自动跟随 elements 变化 (debounce 600ms 防频繁 render 抖动)
  useEffect(() => {
    if (elementsKey === prevKeyRef.current) return;
    prevKeyRef.current = elementsKey;
    if (state.elements.length === 0) {
      if (previewUrl) setPreviewUrl('');
      return;
    }
    const t = setTimeout(() => { handleRefreshPreview(); }, 600);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elementsKey]);

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      const action = previewCropActionRef.current;
      const frame = previewCropFrameRef.current;
      if (!action || !frame) return;

      const rect = frame.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const scaleX = CAPTURE_SIZE / rect.width;
      const scaleY = CAPTURE_SIZE / rect.height;
      const dx = (event.clientX - action.startX) * scaleX;
      const dy = (event.clientY - action.startY) * scaleY;

      let nextRect: CropRect = action.startRect;
      switch (action.handle) {
        case 'move':
          nextRect = {
            ...action.startRect,
            x: action.startRect.x + dx,
            y: action.startRect.y + dy,
          };
          break;
        case 'nw':
          nextRect = {
            x: action.startRect.x + dx,
            y: action.startRect.y + dy,
            width: action.startRect.width - dx,
            height: action.startRect.height - dy,
          };
          break;
        case 'ne':
          nextRect = {
            x: action.startRect.x,
            y: action.startRect.y + dy,
            width: action.startRect.width + dx,
            height: action.startRect.height - dy,
          };
          break;
        case 'sw':
          nextRect = {
            x: action.startRect.x + dx,
            y: action.startRect.y,
            width: action.startRect.width - dx,
            height: action.startRect.height + dy,
          };
          break;
        case 'se':
          nextRect = {
            x: action.startRect.x,
            y: action.startRect.y,
            width: action.startRect.width + dx,
            height: action.startRect.height + dy,
          };
          break;
      }

      setPreviewCrop(clampCropRect(nextRect));
    };

    const onUp = () => {
      previewCropActionRef.current = null;
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const startPreviewCropAction = useCallback((handle: CropHandle, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    previewCropActionRef.current = {
      handle,
      startX: event.clientX,
      startY: event.clientY,
      startRect: previewCrop,
    };
  }, [previewCrop]);

  const resetPreviewCrop = useCallback(async () => {
    if (state.elements.length === 0) return;
    try {
      const canvas = await renderMemeCanvas(state.elements, 1);
      setPreviewCrop(detectContentBounds(canvas));
    } catch (err) {
      console.error('Reset preview crop failed:', err);
    }
  }, [state.elements]);

  useEffect(() => {
    if (state.elements.length === 0) {
      previewRequestIdRef.current += 1;
      setPreviewUrl('');
      return;
    }

    const timer = window.setTimeout(() => {
      void handleRefreshPreview();
    }, 120);

    return () => window.clearTimeout(timer);
  }, [state.elements, handleRefreshPreview]);

  const selectedElement = state.selectedId ? state.elements.find(e => e.id === state.selectedId) : undefined;
  const layerElements = [...state.elements].sort((a, b) => b.zIndex - a.zIndex);

  const handleLayerReorder = useCallback((fromId: string, toId: string) => {
    if (fromId === toId) return;

    const fromIndex = layerElements.findIndex(element => element.id === fromId);
    const toIndex = layerElements.findIndex(element => element.id === toId);
    if (fromIndex === -1 || toIndex === -1) return;

    const reordered = moveArrayItem(layerElements, fromIndex, toIndex);
    reordered.forEach((element, index) => {
      const nextZIndex = reordered.length - index;
      if (element.zIndex !== nextZIndex) {
        dispatch({ type: 'UPDATE_ELEMENT', id: element.id, updates: { zIndex: nextZIndex } });
      }
    });
  }, [dispatch, layerElements]);

  // ===== MOBILE: Bottom Sheet =====
  if (isMobile) {
    const sheetTitle = state.language === 'zh' ? '工具面板' : 'Tools';
    return (
      <>
        {/* FAB */}
        <button className="mobile-fab-right" onClick={() => setSheetOpen(true)} title={sheetTitle}>
          <ChevronUp size={24} />
        </button>

        {/* Overlay */}
        <div className={`bottom-sheet-overlay ${sheetOpen ? 'open' : ''}`} onClick={() => setSheetOpen(false)} />

        {/* Sheet */}
        <div className={`bottom-sheet ${sheetOpen ? 'open' : ''}`} style={{ maxHeight: '70vh' }}>
          <div className="bottom-sheet-header">
            <span className="bottom-sheet-title">{sheetTitle}</span>
            <button className="bottom-sheet-close" onClick={() => setSheetOpen(false)}><X size={18} /></button>
          </div>
          <div className="bottom-sheet-body">
            {/* === Preview === */}
            <div className="rs-mobile-preview-wrap">
              <div className="rs-mobile-preview-frame">
                {previewUrl ? (
                  <img src={previewUrl} alt="preview" />
                ) : (
                  <div className="rs-mobile-preview-empty">
                    <Image size={28} strokeWidth={1.8} color="#6886b0" />
                    <span>{state.language === 'zh' ? '下面操作后会自动生成预览' : 'Preview appears after edits'}</span>
                  </div>
                )}
              </div>
              <button
                onClick={handleCopyPreview}
                disabled={state.elements.length === 0}
                className="rs-mobile-btn"
                type="button"
              >
                <Copy size={14} />
                {t('copyPreview')}
              </button>
            </div>

            {/* === Transform section (image element selected) === */}
            {state.selectedId && state.elements.find(e => e.id === state.selectedId)?.type === 'image' && (
              <div className="rs-mobile-section">
                <h4 className="rs-mobile-section-title">{state.language === 'zh' ? '变换 (选中图片)' : 'Transform (image)'}</h4>
                <div className="rs-mobile-btn-grid-2">
                  <button
                    onClick={() => { const el = state.elements.find(e => e.id === state.selectedId) as ImageElement | undefined; if (el) dispatch({ type: 'UPDATE_ELEMENT', id: el.id, updates: { flipX: !el.flipX } }); }}
                    className="rs-mobile-btn"
                    type="button"
                  >
                    {state.language === 'zh' ? '左右翻转' : 'Flip'}
                  </button>
                  <button
                    onClick={() => { const el = state.elements.find(e => e.id === state.selectedId) as ImageElement | undefined; if (el) dispatch({ type: 'UPDATE_ELEMENT', id: el.id, updates: { rotation: (el.rotation + 90) % 360 } }); }}
                    className="rs-mobile-btn"
                    type="button"
                  >
                    {state.language === 'zh' ? '旋转 90°' : 'Rotate 90°'}
                  </button>
                </div>
                <button
                  onClick={() => { const el = state.elements.find(e => e.id === state.selectedId) as ImageElement | undefined; if (el) dispatch({ type: 'UPDATE_ELEMENT', id: el.id, updates: { rotation: 0 } }); }}
                  className="rs-mobile-btn"
                  type="button"
                >
                  {state.language === 'zh' ? '复原角度' : 'Reset rotation'}
                </button>
                <div className="rs-mobile-range-row">
                  <label>{state.language === 'zh' ? '旋转' : 'Rotate'}</label>
                  <input
                    type="range" min={-180} max={180} step={1}
                    value={(state.elements.find(e => e.id === state.selectedId) as ImageElement | undefined)?.rotation ?? 0}
                    onChange={e => { const el = state.elements.find(e => e.id === state.selectedId) as ImageElement | undefined; if (el) dispatch({ type: 'UPDATE_ELEMENT', id: el.id, updates: { rotation: Number(e.target.value) } }); }}
                  />
                  <span>{(state.elements.find(e => e.id === state.selectedId) as ImageElement | undefined)?.rotation ?? 0}°</span>
                </div>
                <button
                  onClick={() => dispatch({ type: 'REMOVE_ELEMENT', id: state.selectedId! })}
                  className="rs-mobile-btn rs-mobile-btn-danger"
                  type="button"
                >
                  {state.language === 'zh' ? '删除图片' : 'Delete image'}
                </button>
              </div>
            )}

            {/* === Text edit section (text element selected) === */}
            {state.selectedId && state.elements.find(e => e.id === state.selectedId)?.type === 'text' && (
              <div className="rs-mobile-section">
                <h4 className="rs-mobile-section-title">{state.language === 'zh' ? '文字编辑' : 'Edit text'}</h4>
                <input
                  type="text"
                  value={(state.elements.find(e => e.id === state.selectedId) as TextElement).text}
                  onChange={e => dispatch({ type: 'UPDATE_ELEMENT', id: state.selectedId!, updates: { text: e.target.value } })}
                  className="rs-mobile-input"
                />
                <div className="rs-mobile-range-row">
                  <label>{state.language === 'zh' ? '字号' : 'Size'}</label>
                  <input
                    type="range" min={8} max={80} step={1}
                    value={(state.elements.find(e => e.id === state.selectedId) as TextElement).fontSize}
                    onChange={e => dispatch({ type: 'UPDATE_ELEMENT', id: state.selectedId!, updates: { fontSize: Number(e.target.value) } })}
                  />
                  <span>{(state.elements.find(e => e.id === state.selectedId) as TextElement).fontSize}</span>
                </div>
                <div className="rs-mobile-color-row">
                  <input type="color"
                    value={(state.elements.find(e => e.id === state.selectedId) as TextElement).fillColor}
                    onChange={e => dispatch({ type: 'UPDATE_ELEMENT', id: state.selectedId!, updates: { fillColor: e.target.value } })}
                    aria-label={state.language === 'zh' ? '字色' : 'Text color'} />
                  <input type="color"
                    value={(state.elements.find(e => e.id === state.selectedId) as TextElement).strokeColor}
                    onChange={e => dispatch({ type: 'UPDATE_ELEMENT', id: state.selectedId!, updates: { strokeColor: e.target.value } })}
                    aria-label={state.language === 'zh' ? '描边色' : 'Stroke color'} />
                  <div className="rs-mobile-range-row" style={{ flex: 1, minWidth: 0 }}>
                    <label>{state.language === 'zh' ? '描边' : 'Stroke'}</label>
                    <input
                      type="range" min={0} max={8} step={0.5}
                      value={(state.elements.find(e => e.id === state.selectedId) as TextElement).strokeWidth}
                      onChange={e => dispatch({ type: 'UPDATE_ELEMENT', id: state.selectedId!, updates: { strokeWidth: Number(e.target.value) } })}
                    />
                    <span>{(state.elements.find(e => e.id === state.selectedId) as TextElement).strokeWidth}</span>
                  </div>
                </div>
                <div className="rs-mobile-align-row">
                  {(['left', 'center', 'right'] as const).map(align => {
                    const cur = (state.elements.find(e => e.id === state.selectedId) as TextElement).textAlign;
                    return (
                      <button
                        key={align}
                        onClick={() => dispatch({ type: 'UPDATE_ELEMENT', id: state.selectedId!, updates: { textAlign: align } })}
                        className={`rs-mobile-align-btn ${cur === align ? 'rs-mobile-align-btn-on' : ''}`}
                        type="button"
                      >
                        {state.language === 'zh'
                          ? (align === 'left' ? '左' : align === 'center' ? '中' : '右')
                          : (align === 'left' ? 'L' : align === 'center' ? 'C' : 'R')}
                      </button>
                    );
                  })}
                  <button
                    onClick={() => {
                      const el = state.elements.find(e => e.id === state.selectedId) as TextElement;
                      dispatch({ type: 'UPDATE_ELEMENT', id: state.selectedId!, updates: { fontWeight: el.fontWeight === 'bold' ? 'normal' : 'bold' } });
                    }}
                    className={`rs-mobile-align-btn ${(state.elements.find(e => e.id === state.selectedId) as TextElement).fontWeight === 'bold' ? 'rs-mobile-align-btn-on' : ''}`}
                    type="button"
                  >
                    {state.language === 'zh' ? '粗' : 'B'}
                  </button>
                </div>
                <button
                  onClick={() => dispatch({ type: 'REMOVE_ELEMENT', id: state.selectedId! })}
                  className="rs-mobile-btn rs-mobile-btn-danger"
                  type="button"
                >
                  {state.language === 'zh' ? '删除文字' : 'Delete'}
                </button>
              </div>
            )}

            {/* === 8 action grid - Win7 light + semantic colors === */}
            <div className="rs-mobile-action-grid">
              {!state.museumEditMode && (
                <button onClick={handleSwitchImage} className="rs-mobile-action rs-mobile-action-primary" type="button">
                  <Shuffle size={16} strokeWidth={2.2} /> {t('switchImage')}
                </button>
              )}
              <button onClick={handleRecommendText} className="rs-mobile-action" type="button">
                <MessageCircle size={16} strokeWidth={2.2} /> {t('recommendText')}
              </button>
              <button onClick={handleAddText} className="rs-mobile-action" type="button">
                <Type size={16} strokeWidth={2.2} /> {t('addText')}
              </button>
              {!state.museumEditMode && (
                <>
                  <label className="rs-mobile-action" style={{ cursor: 'pointer' }}>
                    <Upload size={16} strokeWidth={2.2} /> {t('uploadAsset')}
                    <input type="file" accept="image/png,image/jpeg,image/jpg,image/gif" onChange={handleUploadAsset} style={{ display: 'none' }} />
                  </label>
                  <button onClick={() => setModalOpen(true)} className="rs-mobile-action rs-mobile-action-photo" type="button">
                    <Camera size={16} strokeWidth={2.2} /> {t('customFace')}
                  </button>
                  <button onClick={() => setSmartModalOpen(true)} className="rs-mobile-action rs-mobile-action-emerald" type="button">
                    <Sparkles size={16} strokeWidth={2.2} /> {state.language === 'zh' ? '智能提取' : 'Smart Extract'}
                  </button>
                </>
              )}
              <button
                onClick={handleSaveDraft}
                disabled={state.elements.length === 0}
                className="rs-mobile-action rs-mobile-action-fav"
                type="button"
              >
                <Heart size={16} strokeWidth={2.2} /> {state.language === 'zh' ? '存草图' : 'Save'}
              </button>
              <button
                onClick={handleExport}
                disabled={isExporting || state.elements.length === 0}
                className="rs-mobile-action rs-mobile-action-primary"
                type="button"
              >
                <Download size={16} strokeWidth={2.2} /> {isExporting ? '...' : t('download')}
              </button>
            </div>

            {/* === Share row — icon buttons === */}
            <div className="rs-mobile-share-row">
              <button onClick={() => handleShare('x')} disabled={state.elements.length === 0} title={t('shareX')} className="share-icon-btn share-x" type="button">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
              </button>
              <button onClick={() => handleShare('facebook')} disabled={state.elements.length === 0} title={t('shareFB')} className="share-icon-btn share-fb" type="button">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
              </button>
            </div>

            {/* === Clear canvas (subtle danger) === */}
            <button
              onClick={handleClearCanvas}
              disabled={state.elements.length === 0}
              className="rs-mobile-btn rs-mobile-btn-subtle"
              type="button"
            >
              {t('clearCanvas')}
            </button>
          </div>
        </div>

        {showSuccess && (
          <div className="fixed bottom-20 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg text-sm font-medium z-[10000]"
            style={{ backgroundColor: '#00CC66', color: '#fff', animation: 'toastIn 0.3s ease' }}>
            {t('downloadSuccess')}
          </div>
        )}
        {copyToast && (
          <div className="fixed bottom-28 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg text-sm font-medium z-[10000]"
            style={{ backgroundColor: '#1a1a1a', color: '#fff', border: '1px solid #333', animation: 'toastIn 0.3s ease' }}>
            {copyToast}
          </div>
        )}
        <PhotoCropModal
          isOpen={modalOpen}
          onClose={() => setModalOpen(false)}
          onConfirm={handleCustomFaceConfirm}
          language={state.language}
        />
        <SmartExtractModal
          isOpen={smartModalOpen}
          onClose={() => setSmartModalOpen(false)}
          onConfirm={(dataUrl) => handleCustomFaceConfirm(dataUrl)}
          language={state.language}
        />
      </>
    );
  }

  // ===== DESKTOP: Side Panel =====
  return (
    <aside className="desktop-sidebar-right">
      {/* Preview */}
      <div className="p-4 win7-panel right-sidebar-static-panel">
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: PANEL_TEXT }}>
          <Sparkles size={14} color="#FF5E00" />{t('preview')}
        </h3>
        <div
          ref={previewCropFrameRef}
          className="rounded-lg overflow-hidden relative flex items-center justify-center select-none"
          style={{ backgroundColor: '#FFFFFF', border: '1px solid #ddd', aspectRatio: '1' }}
        >
          {previewUrl ? (
            <>
              <img src={previewUrl} alt="preview" className="w-full h-full object-contain" style={{ backgroundColor: '#FFFFFF' }} />
              <div
                className="absolute border-2"
                onMouseDown={(event) => startPreviewCropAction('move', event)}
                style={{
                  left: `${(previewCrop.x / CAPTURE_SIZE) * 100}%`,
                  top: `${(previewCrop.y / CAPTURE_SIZE) * 100}%`,
                  width: `${(previewCrop.width / CAPTURE_SIZE) * 100}%`,
                  height: `${(previewCrop.height / CAPTURE_SIZE) * 100}%`,
                  borderColor: '#FF5E00',
                  background: 'rgba(255,94,0,0.08)',
                  cursor: 'move',
                  boxShadow: '0 0 0 9999px rgba(255,255,255,0.42)',
                }}
              >
                {(['nw', 'ne', 'sw', 'se'] as const).map(handle => {
                  const positionStyle =
                    handle === 'nw' ? { left: -6, top: -6, cursor: 'nwse-resize' } :
                    handle === 'ne' ? { right: -6, top: -6, cursor: 'nesw-resize' } :
                    handle === 'sw' ? { left: -6, bottom: -6, cursor: 'nesw-resize' } :
                    { right: -6, bottom: -6, cursor: 'nwse-resize' };

                  return (
                    <div
                      key={handle}
                      onMouseDown={(event) => startPreviewCropAction(handle, event)}
                      style={{
                        position: 'absolute',
                        width: 12,
                        height: 12,
                        borderRadius: '50%',
                        backgroundColor: '#FF5E00',
                        border: '2px solid #fff',
                        ...positionStyle,
                      }}
                    />
                  );
                })}
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center gap-1 py-8">
              <Image size={28} color="#999" />
              <span className="text-[10px]" style={{ color: '#888' }}>{state.language === 'zh' ? '点击生成预览' : 'Click for preview'}</span>
            </div>
          )}
        </div>
        {previewUrl && (
          <div className="mt-2 flex items-center justify-between gap-2">
            <p className="text-[10px]" style={{ color: PANEL_MUTED }}>
              {state.language === 'zh' ? '默认自动贴边，可拖动或拉角调整复制范围' : 'Auto-trim by default. Drag or resize the box before copying.'}
            </p>
            <button
              onClick={() => void resetPreviewCrop()}
              className="shrink-0 px-2 py-1 rounded text-[10px] font-medium"
              style={{ backgroundColor: PANEL_SURFACE, color: PANEL_TEXT, border: `1px solid ${PANEL_BORDER}` }}
            >
              {state.language === 'zh' ? '重置范围' : 'Reset Crop'}
            </button>
          </div>
        )}
        <button
          onClick={handleCopyPreview}
          disabled={state.elements.length === 0}
          className="w-full mt-2 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-medium transition-all disabled:opacity-40"
          style={{ backgroundColor: PANEL_SURFACE, color: PANEL_TEXT, border: `1px solid ${PANEL_BORDER}` }}
        >
          <Copy size={14} />
          {t('copyPreview')}
        </button>
      </div>

      <div className="p-4 win7-panel right-sidebar-layers-panel">
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: PANEL_TEXT }}>
          <Type size={14} color="#FF5E00" />{state.language === 'zh' ? '图层' : 'Layers'}
        </h3>
        <p className="text-[10px] mb-3" style={{ color: PANEL_MUTED }}>
          {state.language === 'zh' ? '拖动图层卡片可调整前后顺序' : 'Drag layer cards to reorder front/back stacking'}
        </p>
        {layerElements.length === 0 ? (
          <p className="text-[11px]" style={{ color: PANEL_MUTED }}>
            {state.language === 'zh' ? '画布为空，添加素材后可在这里切换选中图层' : 'Canvas is empty. Add elements to switch layers here.'}
          </p>
        ) : (
          <div className="space-y-2 right-sidebar-layers-list">
            {layerElements.map((element, index) => {
              const isActive = element.id === state.selectedId;
              const isDragging = element.id === draggedLayerId;
              const isDropTarget = element.id === dragOverLayerId && draggedLayerId !== element.id;
              return (
                <button
                  key={element.id}
                  onClick={() => dispatch({ type: 'SELECT_ELEMENT', id: element.id })}
                  draggable
                  onDragStart={(event) => {
                    setDraggedLayerId(element.id);
                    setDragOverLayerId(element.id);
                    dispatch({ type: 'SELECT_ELEMENT', id: element.id });
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('text/plain', element.id);
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                    if (dragOverLayerId !== element.id) {
                      setDragOverLayerId(element.id);
                    }
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const fromId = draggedLayerId ?? event.dataTransfer.getData('text/plain');
                    if (fromId) {
                      handleLayerReorder(fromId, element.id);
                    }
                    setDraggedLayerId(null);
                    setDragOverLayerId(null);
                  }}
                  onDragEnd={() => {
                    setDraggedLayerId(null);
                    setDragOverLayerId(null);
                  }}
                  className="w-full flex items-center gap-2 px-2 py-2 rounded-lg text-left"
                  style={{
                    backgroundColor: isDragging
                      ? 'rgba(255,94,0,0.18)'
                      : isActive ? 'rgba(255,94,0,0.12)' : PANEL_SURFACE,
                    border: isDropTarget
                      ? '1px solid #FFB347'
                      : isActive ? '1px solid #FF5E00' : `1px solid ${PANEL_BORDER}`,
                    color: PANEL_TEXT,
                    opacity: isDragging ? 0.7 : 1,
                    cursor: 'grab',
                  }}
                >
                  <LayerThumbnail element={element} />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold truncate">{getLayerLabel(element, state.language)}</div>
                    <div className="text-[10px]" style={{ color: isActive ? '#cc6d00' : PANEL_MUTED }}>
                      {element.type === 'text'
                        ? (state.language === 'zh' ? '文字' : 'Text')
                        : (isPanda(element) ? (state.language === 'zh' ? '熊猫头' : 'Panda') : isFace(element) ? (state.language === 'zh' ? '人脸' : 'Face') : (state.language === 'zh' ? '图片' : 'Image'))}
                    </div>
                  </div>
                  <div className="flex flex-col items-end shrink-0">
                    <span className="text-[10px] font-mono" style={{ color: isActive ? '#cc6d00' : PANEL_MUTED }}>
                      {state.language === 'zh' ? `层 ${layerElements.length - index}` : `L${layerElements.length - index}`}
                    </span>
                    {isActive && (
                      <span className="text-[10px]" style={{ color: '#FF5E00' }}>
                        {state.language === 'zh' ? '已选中' : 'Selected'}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Transform / Text Edit */}
      {selectedElement?.type === 'image' && (
        <div className="p-4 transform-panel-section win7-panel right-sidebar-static-panel">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: PANEL_TEXT }}>
            <Settings2 size={14} color="#FF5E00" />{state.language === 'zh' ? '调整素材' : 'Transform'}
          </h3>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => { const el = selectedElement as ImageElement; dispatch({ type: 'UPDATE_ELEMENT', id: el.id, updates: { flipX: !el.flipX } }); }} className="flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium" style={{ backgroundColor: PANEL_SURFACE, color: PANEL_TEXT, border: `1px solid ${PANEL_BORDER}` }}>{state.language === 'zh' ? '左右翻转' : 'Flip Horizontal'}</button>
            <button onClick={() => { const el = selectedElement as ImageElement; dispatch({ type: 'UPDATE_ELEMENT', id: el.id, updates: { rotation: (el.rotation + 90) % 360 } }); }} className="flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium" style={{ backgroundColor: PANEL_SURFACE, color: PANEL_TEXT, border: `1px solid ${PANEL_BORDER}` }}>{state.language === 'zh' ? '旋转90°' : 'Rotate 90°'}</button>
          </div>
          <button
            onClick={() => { const el = selectedElement as ImageElement; dispatch({ type: 'UPDATE_ELEMENT', id: el.id, updates: { rotation: 0 } }); }}
            className="w-full flex items-center justify-center gap-1.5 py-2 mt-2 rounded-lg text-xs font-medium"
            style={{ backgroundColor: PANEL_SURFACE, color: PANEL_TEXT, border: `1px solid ${PANEL_BORDER}` }}
          >
            {state.language === 'zh' ? '复原角度' : 'Reset Rotation'}
          </button>
          <div className="mt-2 transform-range-block">
            <div className="flex justify-between mb-1 transform-range-head">
              <label className="text-[10px] font-bold uppercase tracking-wider" style={{ color: PANEL_MUTED }}>{state.language === 'zh' ? '旋转角度' : 'Rotation'}</label>
              <span className="text-[10px] font-mono transform-range-value" style={{ color: PANEL_TEXT }}>{(selectedElement as ImageElement).rotation}°</span>
            </div>
            <input type="range" min={-180} max={180} step={1} value={(selectedElement as ImageElement).rotation} onChange={e => { const el = selectedElement as ImageElement; dispatch({ type: 'UPDATE_ELEMENT', id: el.id, updates: { rotation: Number(e.target.value) } }); }} className="w-full transform-range-slider" style={{ accentColor: '#FF5E00' }} />
          </div>
          <button
            onClick={() => { dispatch({ type: 'REMOVE_ELEMENT', id: selectedElement.id }); }}
            className="w-full flex items-center justify-center gap-2 py-2 mt-3 rounded-lg text-xs font-semibold text-white transition-all hover:scale-[1.02]"
            style={{ backgroundColor: '#EF4444' }}
          >
            <Trash2 size={14} />{state.language === 'zh' ? '删除图片' : 'Delete Image'}
          </button>
        </div>
      )}

      {selectedElement?.type === 'text' && (
        <div className="p-4 win7-panel right-sidebar-static-panel">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: PANEL_TEXT }}>
            <Type size={14} color="#FF5E00" />{state.language === 'zh' ? '编辑文字' : 'Edit Text'}
          </h3>
          <div className="space-y-3">
            {/* Text content */}
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider mb-1 block" style={{ color: PANEL_MUTED }}>{state.language === 'zh' ? '文字内容' : 'Content'}</label>
              <input
                type="text"
                value={(selectedElement as TextElement).text}
                onChange={e => dispatch({ type: 'UPDATE_ELEMENT', id: selectedElement.id, updates: { text: e.target.value } })}
                className="w-full px-2.5 py-2 rounded-lg text-xs"
                style={{ backgroundColor: PANEL_SURFACE, color: PANEL_TEXT, border: `1px solid ${PANEL_BORDER}` }}
              />
            </div>
            {/* Font size */}
            <div>
              <div className="flex justify-between mb-1">
                <label className="text-[10px] font-bold uppercase tracking-wider" style={{ color: PANEL_MUTED }}>{state.language === 'zh' ? '字号' : 'Size'}</label>
                <span className="text-[10px] font-mono" style={{ color: PANEL_TEXT }}>{(selectedElement as TextElement).fontSize}px</span>
              </div>
              <input type="range" min={8} max={80} step={1} value={(selectedElement as TextElement).fontSize} onChange={e => dispatch({ type: 'UPDATE_ELEMENT', id: selectedElement.id, updates: { fontSize: Number(e.target.value) } })} className="w-full" style={{ accentColor: '#FF5E00' }} />
            </div>
            {/* Colors row */}
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-[10px] font-bold uppercase tracking-wider mb-1 block" style={{ color: PANEL_MUTED }}>{state.language === 'zh' ? '文字色' : 'Color'}</label>
                <div className="flex items-center gap-2">
                  <input type="color" value={(selectedElement as TextElement).fillColor} onChange={e => dispatch({ type: 'UPDATE_ELEMENT', id: selectedElement.id, updates: { fillColor: e.target.value } })} className="w-7 h-7 rounded cursor-pointer" style={{ padding: 0, border: 'none', background: 'none' }} />
                  <span className="text-[10px] font-mono" style={{ color: PANEL_MUTED }}>{(selectedElement as TextElement).fillColor}</span>
                </div>
              </div>
              <div className="flex-1">
                <label className="text-[10px] font-bold uppercase tracking-wider mb-1 block" style={{ color: PANEL_MUTED }}>{state.language === 'zh' ? '描边色' : 'Stroke'}</label>
                <div className="flex items-center gap-2">
                  <input type="color" value={(selectedElement as TextElement).strokeColor} onChange={e => dispatch({ type: 'UPDATE_ELEMENT', id: selectedElement.id, updates: { strokeColor: e.target.value } })} className="w-7 h-7 rounded cursor-pointer" style={{ padding: 0, border: 'none', background: 'none' }} />
                  <span className="text-[10px] font-mono" style={{ color: PANEL_MUTED }}>{(selectedElement as TextElement).strokeColor}</span>
                </div>
              </div>
            </div>
            {/* Stroke width */}
            <div>
              <div className="flex justify-between mb-1">
                <label className="text-[10px] font-bold uppercase tracking-wider" style={{ color: PANEL_MUTED }}>{state.language === 'zh' ? '描边宽度' : 'Stroke Width'}</label>
                <span className="text-[10px] font-mono" style={{ color: PANEL_TEXT }}>{(selectedElement as TextElement).strokeWidth}px</span>
              </div>
              <input type="range" min={0} max={8} step={0.5} value={(selectedElement as TextElement).strokeWidth} onChange={e => dispatch({ type: 'UPDATE_ELEMENT', id: selectedElement.id, updates: { strokeWidth: Number(e.target.value) } })} className="w-full" style={{ accentColor: '#FF5E00' }} />
            </div>
            {/* Align & Bold */}
            <div className="flex gap-2">
              {(['left', 'center', 'right'] as const).map(align => (
                <button
                  key={align}
                  onClick={() => dispatch({ type: 'UPDATE_ELEMENT', id: selectedElement.id, updates: { textAlign: align } })}
                  className="flex-1 flex items-center justify-center py-2 rounded-lg text-xs font-medium transition-all"
                  style={{
                    backgroundColor: (selectedElement as TextElement).textAlign === align ? '#FFB938' : PANEL_SURFACE,
                    color: PANEL_TEXT,
                    border: `1px solid ${PANEL_BORDER}`,
                  }}
                >
                  {align === 'left' && <AlignLeft size={14} />}
                  {align === 'center' && <AlignCenter size={14} />}
                  {align === 'right' && <AlignRight size={14} />}
                </button>
              ))}
              <button
                onClick={() => {
                  const el = selectedElement as TextElement;
                  dispatch({ type: 'UPDATE_ELEMENT', id: selectedElement.id, updates: { fontWeight: el.fontWeight === 'bold' ? 'normal' : 'bold' } });
                }}
                className="flex-1 flex items-center justify-center py-2 rounded-lg text-xs font-medium transition-all"
                style={{
                  backgroundColor: (selectedElement as TextElement).fontWeight === 'bold' ? '#FFB938' : PANEL_SURFACE,
                  color: PANEL_TEXT,
                  border: `1px solid ${PANEL_BORDER}`,
                }}
              >
                <Bold size={14} />
              </button>
            </div>
            {/* Delete */}
            <button
              onClick={() => { dispatch({ type: 'REMOVE_ELEMENT', id: selectedElement.id }); }}
              className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-semibold text-white transition-all hover:scale-[1.02]"
              style={{ backgroundColor: '#EF4444' }}
            >
              <Trash2 size={14} />{state.language === 'zh' ? '删除文字' : 'Delete Text'}
            </button>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="p-4 win7-panel right-sidebar-static-panel">
        <div className="space-y-2">
          {!state.museumEditMode && (
            <button onClick={handleSwitchImage} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold text-white transition-all hover:scale-[1.02]" style={{ backgroundColor: '#FF5E00' }}><Shuffle size={16} />{t('switchImage')}</button>
          )}
          <button onClick={handleRecommendText} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold text-white transition-all hover:scale-[1.02]" style={{ backgroundColor: '#00CC66' }}><MessageCircle size={16} />{t('recommendText')}</button>
          <button onClick={handleAddText} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold text-white transition-all hover:scale-[1.02]" style={{ backgroundColor: '#9333EA' }}><Type size={16} />{state.language === 'zh' ? '添加文字' : 'Add Text'}</button>
          {!state.museumEditMode && (
            <>
              <label className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold text-white transition-all hover:scale-[1.02] cursor-pointer" style={{ backgroundColor: '#8B5CF6' }}><Upload size={16} />{t('uploadAsset')}<input type="file" accept="image/png,image/jpeg,image/jpg,image/gif" onChange={handleUploadAsset} className="hidden" /></label>
              <p className="text-[10px] text-center" style={{ color: PANEL_MUTED }}>{state.language === 'zh' ? '支持拖拽素材到画布' : 'Drag assets onto the canvas'}</p>
              <button onClick={() => setModalOpen(true)} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold text-white transition-all hover:scale-[1.02]" style={{ backgroundColor: '#F59E0B' }}><Camera size={16} />{t('customFace')}</button>
              <button onClick={() => setSmartModalOpen(true)} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold text-white transition-all hover:scale-[1.02]" style={{ backgroundColor: '#10B981' }}><Sparkles size={16} />{state.language === 'zh' ? '智能提取人脸' : 'Smart Extract'}</button>
              <p className="text-[10px] text-center" style={{ color: PANEL_MUTED }}>{state.language === 'zh' ? '上传照片自动生成熊猫脸 · 支持 JPG / PNG / GIF' : 'Upload photo to auto-generate panda face · Supports JPG / PNG / GIF'}</p>
            </>
          )}
        </div>
      </div>

      {/* Social Share + Footer Actions */}
      <div className="p-4 space-y-2 mt-auto win7-panel win7-panel-footer">
        <button onClick={handleClearCanvas} disabled={state.elements.length === 0} className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-30" style={{ backgroundColor: PANEL_SURFACE, color: PANEL_TEXT, border: `1px solid ${PANEL_BORDER}` }}><Trash2 size={14} />{t('clearCanvas')}</button>
        <button onClick={handleSaveDraft} disabled={state.elements.length === 0} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold text-white transition-all hover:scale-[1.02] disabled:opacity-50" style={{ backgroundColor: '#FF5E00' }}><Heart size={14} />{state.language === 'zh' ? '存到草图' : 'Save to Drafts'}</button>
        <button onClick={handleExport} disabled={isExporting || state.elements.length === 0} className="w-full flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-bold text-white transition-all hover:scale-[1.02] disabled:opacity-50" style={{ backgroundColor: '#00CC66' }}><Download size={16} />{isExporting ? '...' : t('download')}</button>

        {/* Social Share Buttons - icon only with tooltip */}
        <div className="flex items-center justify-center gap-3 pt-3" style={{ borderTop: `1px solid ${PANEL_BORDER}` }}>
          <button
            onClick={() => handleShare('x')}
            disabled={state.elements.length === 0}
            title={t('shareX')}
            className="share-icon-btn share-x"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
          </button>
          <button
            onClick={() => handleShare('facebook')}
            disabled={state.elements.length === 0}
            title={t('shareFB')}
            className="share-icon-btn share-fb"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
          </button>
        </div>
      </div>

      {showSuccess && (
        <div className="absolute bottom-20 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg text-sm font-medium z-[10000]"
          style={{ backgroundColor: '#00CC66', color: '#fff', animation: 'toastIn 0.3s ease' }}>
          {t('downloadSuccess')}
        </div>
      )}
      {copyToast && (
        <div className="absolute bottom-32 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg text-sm font-medium z-[10000]"
          style={{ backgroundColor: '#1a1a1a', color: '#fff', border: '1px solid #333', animation: 'toastIn 0.3s ease' }}>
          {copyToast}
        </div>
      )}
      <PhotoCropModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onConfirm={handleCustomFaceConfirm}
        language={state.language}
      />
      <SmartExtractModal
        isOpen={smartModalOpen}
        onClose={() => setSmartModalOpen(false)}
        onConfirm={(dataUrl) => handleCustomFaceConfirm(dataUrl)}
        language={state.language}
      />
    </aside>
  );
}
