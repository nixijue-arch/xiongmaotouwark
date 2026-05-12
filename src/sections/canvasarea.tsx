import { useRef, useState, useCallback, useEffect, useLayoutEffect } from 'react';
import { useMeme } from '@/context/memecontext';
import type { ImageElement, TextElement } from '@/context/memecontext';
import { useIsMobile } from '@/hooks/usemediaquery';
import Draggable from 'react-draggable';
import { Eraser, RotateCcw, LogOut, Save, Undo2 } from 'lucide-react';

// blendMode 直接读 element.blendMode (创建时已根据 shell 透明/不透明 决定)
// 不再用硬编码 isPandaElement / isFaceElement 判定
// 见 materials.ts 的 getShellLayering()

/* ========== DraggableImage ========== */
interface DraggableImageProps {
  element: ImageElement;
  isSelected: boolean;
  onSelect: () => void;
  onStartEdit: () => void;
}

type ResizeDir = 'nw' | 'n' | 'ne' | 'w' | 'e' | 'sw' | 's' | 'se';
const CANVAS_SIZE = 500;
const MAX_DESKTOP_CANVAS_SCALE = 2.35;
const MOBILE_CANVAS_MIN_SCALE = 0.45;
const DESKTOP_CANVAS_MIN_SCALE = 1;
const DRAGGABLE_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif'];
const DEFAULT_VISIBLE_BOUNDS = { left: 0, top: 0, width: 1, height: 1 };
const visibleBoundsCache = new Map<string, typeof DEFAULT_VISIBLE_BOUNDS>();

function getCanvasScale(
  isMobile: boolean,
  availableWidth: number,
  availableHeight: number,
) {
  const widthScale = availableWidth / CANVAS_SIZE;
  const heightScale = availableHeight / CANVAS_SIZE;
  const rawScale = Math.min(widthScale, heightScale);

  if (!Number.isFinite(rawScale) || rawScale <= 0) {
    return 1;
  }

  if (isMobile) {
    return Math.max(MOBILE_CANVAS_MIN_SCALE, Math.min(1, rawScale));
  }

  return Math.max(DESKTOP_CANVAS_MIN_SCALE, Math.min(MAX_DESKTOP_CANVAS_SCALE, rawScale));
}

function validateDroppedImage(file: File, language: 'zh' | 'en'): string | null {
  if (!DRAGGABLE_IMAGE_TYPES.includes(file.type)) {
    return language === 'zh' ? '仅支持拖拽 JPG、PNG 或 GIF 图片' : 'Only JPG, PNG, or GIF images can be dropped';
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

async function getVisibleImageBounds(src: string): Promise<typeof DEFAULT_VISIBLE_BOUNDS> {
  const cached = visibleBoundsCache.get(src);
  if (cached) return cached;

  try {
    const img = await loadImage(src);
    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;
    if (!width || !height) return DEFAULT_VISIBLE_BOUNDS;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return DEFAULT_VISIBLE_BOUNDS;

    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, width, height);
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const alpha = data[(y * width + x) * 4 + 3];
        if (alpha <= 12) continue;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }

    if (maxX < minX || maxY < minY) {
      visibleBoundsCache.set(src, DEFAULT_VISIBLE_BOUNDS);
      return DEFAULT_VISIBLE_BOUNDS;
    }

    const bounds = {
      left: minX / width,
      top: minY / height,
      width: (maxX - minX + 1) / width,
      height: (maxY - minY + 1) / height,
    };
    visibleBoundsCache.set(src, bounds);
    return bounds;
  } catch {
    return DEFAULT_VISIBLE_BOUNDS;
  }
}

function useResizeHandler(element: ImageElement, dir: ResizeDir) {
  const { dispatch } = useMeme();
  return useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const startX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const startY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    const { x: startElX, y: startElY, width: startW, height: startH } = element;

    const onMove = (ev: MouseEvent | TouchEvent) => {
      const cx = 'touches' in ev ? ev.touches[0].clientX : ev.clientX;
      const cy = 'touches' in ev ? ev.touches[0].clientY : ev.clientY;
      const dx = cx - startX;
      const dy = cy - startY;
      let newW = startW, newH = startH, newX = startElX, newY = startElY;

      if (dir.includes('e')) newW = Math.max(20, startW + dx);
      if (dir.includes('w')) { newW = Math.max(20, startW - dx); newX = startElX + dx; }
      if (dir.includes('s')) newH = Math.max(20, startH + dy);
      if (dir.includes('n')) { newH = Math.max(20, startH - dy); newY = startElY + dy; }

      dispatch({ type: 'UPDATE_ELEMENT', id: element.id, updates: { width: newW, height: newH, x: newX, y: newY } });
    };

    const cleanup = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', cleanup);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', cleanup);
      window.removeEventListener('touchcancel', cleanup);
      window.removeEventListener('blur', cleanup);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', cleanup);
    window.addEventListener('touchmove', onMove);
    window.addEventListener('touchend', cleanup);
    window.addEventListener('touchcancel', cleanup);
    window.addEventListener('blur', cleanup);
  }, [element, dispatch, dir]);
}

function ResizeHandle({ dir, onStart }: { dir: ResizeDir; onStart: (e: React.MouseEvent | React.TouchEvent) => void }) {
  const posMap: Record<ResizeDir, { c: string; s: React.CSSProperties }> = {
    nw: { c: 'cursor-nw-resize', s: { top: -5, left: -5 } },
    n:  { c: 'cursor-n-resize',  s: { top: -5, left: '50%', transform: 'translateX(-50%)' } },
    ne: { c: 'cursor-ne-resize', s: { top: -5, right: -5 } },
    w:  { c: 'cursor-w-resize',  s: { top: '50%', left: -5, transform: 'translateY(-50%)' } },
    e:  { c: 'cursor-e-resize',  s: { top: '50%', right: -5, transform: 'translateY(-50%)' } },
    sw: { c: 'cursor-sw-resize', s: { bottom: -5, left: -5 } },
    s:  { c: 'cursor-s-resize',  s: { bottom: -5, left: '50%', transform: 'translateX(-50%)' } },
    se: { c: 'cursor-se-resize', s: { bottom: -5, right: -5 } },
  };
  const p = posMap[dir];
  return (
    <div
      className={`absolute ${p.c} resize-handle`}
      style={{ ...p.s, width: 10, height: 10, borderRadius: '50%', backgroundColor: '#FF5E00', zIndex: 15, border: '2px solid #fff', boxSizing: 'border-box', pointerEvents: 'auto' }}
      onMouseDown={onStart}
      onTouchStart={onStart}
    />
  );
}

function DraggableImage({ element, isSelected, onSelect, onStartEdit }: DraggableImageProps) {
  const nodeRef = useRef<HTMLDivElement>(null);
  const { dispatch, state } = useMeme();
  const lang = state.language;
  const [visibleBounds, setVisibleBounds] = useState(DEFAULT_VISIBLE_BOUNDS);
  const rhNW = useResizeHandler(element, 'nw');
  const rhN  = useResizeHandler(element, 'n');
  const rhNE = useResizeHandler(element, 'ne');
  const rhW  = useResizeHandler(element, 'w');
  const rhE  = useResizeHandler(element, 'e');
  const rhSW = useResizeHandler(element, 'sw');
  const rhS  = useResizeHandler(element, 's');
  const rhSE = useResizeHandler(element, 'se');

  useEffect(() => {
    let cancelled = false;
    void getVisibleImageBounds(element.src).then(bounds => {
      if (!cancelled) setVisibleBounds(bounds);
    });
    return () => {
      cancelled = true;
    };
  }, [element.src]);

  const selectionStyle: React.CSSProperties = {
    left: visibleBounds.left * element.width - 2,
    top: visibleBounds.top * element.height - 2,
    width: visibleBounds.width * element.width + 4,
    height: visibleBounds.height * element.height + 4,
  };

  const handleSelectionStart = (handler: (e: React.MouseEvent | React.TouchEvent) => void) => (e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    handler(e);
  };

  const handleElementPointerStart = (e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    onSelect();
  };

  return (
    <Draggable
      nodeRef={nodeRef}
      cancel="button, input, .resize-handle"
      position={{ x: element.x, y: element.y }}
      onStop={(_, data) => dispatch({ type: 'UPDATE_ELEMENT', id: element.id, updates: { x: data.x, y: data.y } })}
      onStart={onSelect}
    >
      <div
        ref={nodeRef}
        className="absolute cursor-move select-none canvas-element"
        style={{ zIndex: isSelected ? 50 : element.zIndex, opacity: element.opacity }}
        onMouseDown={handleElementPointerStart}
        onTouchStart={handleElementPointerStart}
      >
        <div style={{ position: 'relative', transform: `rotate(${element.rotation}deg)` }}>
          {/* panda 元素用 mix-blend-mode: multiply
              panda 在 face 之上 (zIndex panda > face)
              panda 白色内部 × face = face (face 透过来)
              panda 黑色 silhouette × face = black (廓盖 face)
              图层面板按 text > panda > face 排序 (符合 user 要求) */}
          <img src={element.src} alt="element" className="block max-w-none" draggable={false}
            style={{
              width: element.width,
              height: element.height,
              transform: element.flipX ? 'scaleX(-1)' : 'none',
              // 直接读 element.blendMode (创建时根据 shell 透明/不透明 设置好)
              mixBlendMode: element.blendMode === 'multiply' ? 'multiply' : 'normal',
            }}
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
          {isSelected && (
            <>
              <div className="absolute border-2 border-dashed pointer-events-none" style={{ borderColor: '#FF5E00', zIndex: 5, ...selectionStyle }} />
              <div className="absolute" style={{ zIndex: 15, pointerEvents: 'none', ...selectionStyle }}>
                <ResizeHandle dir="nw" onStart={handleSelectionStart(rhNW)} />
                <ResizeHandle dir="n"  onStart={handleSelectionStart(rhN)} />
                <ResizeHandle dir="ne" onStart={handleSelectionStart(rhNE)} />
                <ResizeHandle dir="w"  onStart={handleSelectionStart(rhW)} />
                <ResizeHandle dir="e"  onStart={handleSelectionStart(rhE)} />
                <ResizeHandle dir="sw" onStart={handleSelectionStart(rhSW)} />
                <ResizeHandle dir="s"  onStart={handleSelectionStart(rhS)} />
                <ResizeHandle dir="se" onStart={handleSelectionStart(rhSE)} />
              </div>
              <div
                className="absolute flex items-center gap-2 pointer-events-auto"
                style={{
                  zIndex: 16,
                  left: (selectionStyle.left as number) + (selectionStyle.width as number) / 2,
                  transform: 'translateX(-50%)',
                  top: (selectionStyle.top as number) + (selectionStyle.height as number) + 8,
                }}
              >
                <button
                  onClick={(e) => { e.stopPropagation(); onStartEdit(); }}
                  className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold text-white"
                  style={{ backgroundColor: '#0080FF' }}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                  {lang === 'zh' ? '编辑' : 'Edit'}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    dispatch({ type: 'REMOVE_ELEMENT', id: element.id });
                    dispatch({ type: 'SELECT_ELEMENT', id: null });
                  }}
                  className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold text-white"
                  style={{ backgroundColor: '#EF4444' }}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
                  {lang === 'zh' ? '删除' : 'Delete'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </Draggable>
  );
}

/* ========== DraggableText ========== */
function useTextResizeHandler(element: TextElement) {
  const { dispatch } = useMeme();
  return useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const startX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const startY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    const startFontSize = element.fontSize;

    const onMove = (ev: MouseEvent | TouchEvent) => {
      const clientX = 'touches' in ev ? ev.touches[0].clientX : ev.clientX;
      const clientY = 'touches' in ev ? ev.touches[0].clientY : ev.clientY;
      const delta = Math.sqrt((clientX - startX) ** 2 + (clientY - startY) ** 2) * Math.sign(clientX - startX + clientY - startY);
      const newFontSize = Math.max(8, Math.round(startFontSize + delta * 0.3));
      dispatch({ type: 'UPDATE_ELEMENT', id: element.id, updates: { fontSize: newFontSize } });
    };

    const cleanup = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', cleanup);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', cleanup);
      window.removeEventListener('touchcancel', cleanup);
      window.removeEventListener('blur', cleanup);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', cleanup);
    window.addEventListener('touchmove', onMove);
    window.addEventListener('touchend', cleanup);
    window.addEventListener('touchcancel', cleanup);
    window.addEventListener('blur', cleanup);
  }, [element, dispatch]);
}

function DraggableText({ element, isSelected, onSelect }: {
  element: TextElement;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const nodeRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { state, dispatch } = useMeme();
  const rh = useTextResizeHandler(element);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(element.text);

  useEffect(() => {
    if (!isEditing) setEditText(element.text);
  }, [element.text, isEditing]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const commitEdit = useCallback(() => {
    const trimmed = editText.trim();
    if (trimmed && trimmed !== element.text) {
      dispatch({ type: 'UPDATE_ELEMENT', id: element.id, updates: { text: trimmed } });
    } else if (!trimmed) {
      setEditText(element.text);
    }
    setIsEditing(false);
  }, [dispatch, editText, element.id, element.text]);

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditText(element.text);
    setIsEditing(true);
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
    else if (e.key === 'Escape') { setEditText(element.text); setIsEditing(false); }
  };

  const textStyle: React.CSSProperties = {
    fontSize: element.fontSize,
    color: element.fillColor,
    fontWeight: element.fontWeight,
    fontFamily: element.fontFamily,
    textAlign: element.textAlign,
    WebkitTextStroke: element.strokeWidth > 0 ? `${element.strokeWidth}px ${element.strokeColor}` : 'none',
  };

  return (
    <Draggable
      nodeRef={nodeRef}
      cancel="button, input, .resize-handle"
      position={{ x: element.x, y: element.y }}
      onStop={(_, data) => dispatch({ type: 'UPDATE_ELEMENT', id: element.id, updates: { x: data.x, y: data.y } })}
      onStart={onSelect}
    >
      <div
        ref={nodeRef}
        className="absolute select-none"
        style={{ zIndex: isSelected ? 50 : element.zIndex, cursor: isEditing ? 'text' : 'move' }}
        onClick={(e) => { e.stopPropagation(); onSelect(); }}
        onDoubleClick={handleDoubleClick}
      >
        {isEditing ? (
          <input
            ref={inputRef}
            type="text"
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={handleInputKeyDown}
            onClick={(e) => e.stopPropagation()}
            // size 属性比 minWidth+block 更稳定 — input 宽度直接跟着 char 数走, 不会撑出 canvas
            // 删 block / whitespace-nowrap, 用 inline-block 默认行为 + width: max-content 兜底
            size={Math.max(4, (editText.length || 1) + 1)}
            className="px-2 py-1 bg-transparent border-none outline-none"
            style={{
              ...textStyle,
              caretColor: '#FF5E00',
              // 限死 max-width 防超长文字撑爆 canvas / 推动 editor-layout
              maxWidth: 440,
              boxShadow: 'inset 0 -2px 0 #FF5E00',
              boxSizing: 'border-box',
            }}
          />
        ) : (
          <div className="px-2 py-1" style={{ ...textStyle, whiteSpace: 'pre-line' }}>
            {element.text}
          </div>
        )}
        {isEditing && (
          <div className="absolute border-2 border-dashed pointer-events-none" style={{ borderColor: '#0080FF', inset: -4, zIndex: 5 }} />
        )}
        {isSelected && !isEditing && (
          <>
            <div className="absolute border-2 border-dashed pointer-events-none" style={{ borderColor: '#FF5E00', inset: -4, zIndex: 5 }} />
            <div
              className="absolute left-1/2 -translate-x-1/2 text-[9px] font-medium whitespace-nowrap pointer-events-none"
              style={{ bottom: -18, color: '#FF5E00' }}
            >
              {state.language === 'zh' ? '双击编辑' : 'Double-click to edit'}
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                dispatch({ type: 'REMOVE_ELEMENT', id: element.id });
                dispatch({ type: 'SELECT_ELEMENT', id: null });
              }}
              className="absolute flex items-center justify-center rounded-full pointer-events-auto hover:scale-110 transition-transform"
              style={{
                width: 18, height: 18,
                top: -12, right: -12,
                backgroundColor: '#EF4444',
                zIndex: 20,
                border: '2px solid #fff',
              }}
              title={state.language === 'zh' ? '删除' : 'Delete'}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
            <ResizeHandle dir="nw" onStart={rh} />
            <ResizeHandle dir="n"  onStart={rh} />
            <ResizeHandle dir="ne" onStart={rh} />
            <ResizeHandle dir="w"  onStart={rh} />
            <ResizeHandle dir="e"  onStart={rh} />
            <ResizeHandle dir="sw" onStart={rh} />
            <ResizeHandle dir="s"  onStart={rh} />
            <ResizeHandle dir="se" onStart={rh} />
          </>
        )}
      </div>
    </Draggable>
  );
}

/* ========== Cursor builder ========== */
function buildCursorSVG(tool: 'brush' | 'eraser', size: number, color: string): string {
  const stroke = tool === 'eraser' ? '#EF4444' : color;
  const fillOpacity = tool === 'eraser' ? '0.15' : '0.25';
  const s = Math.max(4, Math.min(size, 32));
  const half = s;
  return `url('data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22${half * 2 + 2}%22 height=%22${half * 2 + 2}%22><circle cx=%22${half + 1}%22 cy=%22${half + 1}%22 r=%22${half}%22 fill=%22${encodeURIComponent(stroke)}%22 fill-opacity=%22${fillOpacity}%22 stroke=%22${encodeURIComponent(stroke)}%22 stroke-width=%221.5%22/></svg>') ${half} ${half}, crosshair`;
}

/* ========== CanvasArea ========== */
export function CanvasArea({ canvasRef }: { canvasRef: React.RefObject<HTMLDivElement | null> }) {
  const { state, dispatch, generateId } = useMeme();

  // Image edit (eraser/brush) state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTool, setEditTool] = useState<'brush' | 'eraser'>('brush');
  const [editSize, setEditSize] = useState(8);
  const [editColor, setEditColor] = useState('#000000');
  const [isDrawing, setIsDrawing] = useState(false);
  const lastDrawPos = useRef<{ x: number; y: number } | null>(null);
  const editCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const originalSrcRef = useRef<string>('');
  const [cursorUrl, setCursorUrl] = useState<string>('crosshair');
  const [editHistory, setEditHistory] = useState<string[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const dragDepthRef = useRef(0);

  useEffect(() => {
    setCursorUrl(buildCursorSVG(editTool, editSize, editColor));
  }, [editTool, editSize, editColor]);

  const handleCanvasClick = (e: React.MouseEvent | React.TouchEvent) => {
    if ((e.target as HTMLElement).closest('.canvas-element')) return;
    if ((e.target as HTMLElement).closest('.edit-toolbar')) return;
    dispatch({ type: 'SELECT_ELEMENT', id: null });
    setEditingId(null);
  };

  const getCanvasPoint = useCallback((clientX: number, clientY: number) => {
    const canvasNode = canvasRef.current;
    if (!canvasNode) return null;
    const rect = canvasNode.getBoundingClientRect();
    const scaleX = canvasNode.offsetWidth > 0 ? CANVAS_SIZE / canvasNode.offsetWidth : 1;
    const scaleY = canvasNode.offsetHeight > 0 ? CANVAS_SIZE / canvasNode.offsetHeight : 1;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  }, [canvasRef]);

  const handleDroppedImage = useCallback(async (file: File, clientX: number, clientY: number) => {
    const validationError = validateDroppedImage(file, state.language);
    if (validationError) {
      alert(validationError);
      return;
    }

    try {
      const dataUrl = await readFileAsDataUrl(file);
      const image = await loadImage(dataUrl);
      const dropPoint = getCanvasPoint(clientX, clientY);
      const maxSide = 320;
      const naturalWidth = image.naturalWidth || 1;
      const naturalHeight = image.naturalHeight || 1;
      const scale = Math.min(1, maxSide / Math.max(naturalWidth, naturalHeight));
      const width = Math.max(40, Math.round(naturalWidth * scale));
      const height = Math.max(40, Math.round(naturalHeight * scale));
      const centerX = dropPoint?.x ?? CANVAS_SIZE / 2;
      const centerY = dropPoint?.y ?? CANVAS_SIZE / 2;
      const x = Math.max(0, Math.min(CANVAS_SIZE - width, Math.round(centerX - width / 2)));
      const y = Math.max(0, Math.min(CANVAS_SIZE - height, Math.round(centerY - height / 2)));

      dispatch({
        type: 'ADD_ELEMENT',
        element: {
          id: generateId(),
          type: 'image',
          src: dataUrl,
          name: `drop-image-${Date.now()}`,
          x,
          y,
          width,
          height,
          rotation: 0,
          opacity: 1,
          zIndex: 0,
          flipX: false,
        },
      });
    } catch (error) {
      console.error('Drop image failed:', error);
      alert(state.language === 'zh' ? '拖拽图片失败，请重试' : 'Failed to drop image, please try again');
    }
  }, [dispatch, generateId, getCanvasPoint, state.language]);

  const handleCanvasDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return;
    e.preventDefault();
    dragDepthRef.current += 1;
    setIsDragOver(true);
  }, []);

  const handleCanvasDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleCanvasDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return;
    e.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDragOver(false);
    }
  }, []);

  const handleCanvasDrop = useCallback(async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragDepthRef.current = 0;
    setIsDragOver(false);
    const file = Array.from(e.dataTransfer.files).find(item => item.type.startsWith('image/'));
    if (!file) return;
    await handleDroppedImage(file, e.clientX, e.clientY);
  }, [handleDroppedImage]);

  const startEdit = (id: string) => {
    setEditingId(id);
    setEditHistory([]);
    const el = state.elements.find(e => e.id === id) as ImageElement | undefined;
    if (!el) return;
    originalSrcRef.current = el.src;
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (!editCanvasRef.current) return;
      const w = img.naturalWidth || el.width;
      const h = img.naturalHeight || el.height;
      editCanvasRef.current.width = w;
      editCanvasRef.current.height = h;
      const ctx = editCanvasRef.current.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, w, h);
        ctx.globalCompositeOperation = 'source-over';
        ctx.drawImage(img, 0, 0);
        // Save original state as history[0]
        setEditHistory([editCanvasRef.current.toDataURL('image/png')]);
      }
    };
    img.src = el.src;
  };

  const getEditCoords = (clientX: number, clientY: number) => {
    const canvas = editCanvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) * (canvas.width / rect.width),
      y: (clientY - rect.top) * (canvas.height / rect.height),
    };
  };

  const drawStamp = (ctx: CanvasRenderingContext2D, x: number, y: number, size: number, tool: 'brush' | 'eraser', color: string) => {
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    if (tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0,0,0,1)';
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = color;
    }
    ctx.fill();
  };

  const onEditPointerDown = (e: React.PointerEvent) => {
    if (!editingId) return;
    e.preventDefault();
    setIsDrawing(true);
    const pt = getEditCoords(e.clientX, e.clientY);
    if (!pt || !editCanvasRef.current) return;
    const ctx = editCanvasRef.current.getContext('2d');
    if (!ctx) return;
    drawStamp(ctx, pt.x, pt.y, editSize, editTool, editColor);
    lastDrawPos.current = pt;
  };

  const onEditPointerMove = (e: React.PointerEvent) => {
    if (!isDrawing || !editingId) return;
    const pt = getEditCoords(e.clientX, e.clientY);
    if (!pt || !lastDrawPos.current || !editCanvasRef.current) return;
    const ctx = editCanvasRef.current.getContext('2d');
    if (!ctx) return;

    const dist = Math.hypot(pt.x - lastDrawPos.current.x, pt.y - lastDrawPos.current.y);
    const steps = Math.max(1, Math.floor(dist / (editSize * 0.5)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = lastDrawPos.current.x + (pt.x - lastDrawPos.current.x) * t;
      const y = lastDrawPos.current.y + (pt.y - lastDrawPos.current.y) * t;
      drawStamp(ctx, x, y, editSize, editTool, editColor);
    }
    lastDrawPos.current = pt;
  };

  /* ===== REAL-TIME SYNC: auto-save canvas to element on every stroke end ===== */
  const onEditPointerUp = () => {
    setIsDrawing(false);
    lastDrawPos.current = null;
    if (editingId && editCanvasRef.current) {
      try {
        const newUrl = editCanvasRef.current.toDataURL('image/png');
        // Limit history to 30 snapshots to avoid memory bloat
        setEditHistory(prev => {
          const next = [...prev, newUrl];
          if (next.length > 30) return next.slice(next.length - 30);
          return next;
        });
        dispatch({ type: 'UPDATE_ELEMENT', id: editingId, updates: { src: newUrl } });
      } catch (e) {
        console.error('Real-time sync failed:', e);
      }
    }
  };

  /* ===== Undo last brush/eraser stroke ===== */
  const handleUndoEdit = () => {
    if (editHistory.length <= 1 || !editCanvasRef.current || !editingId) return;
    const prev = [...editHistory];
    prev.pop(); // remove current state
    setEditHistory(prev);
    const ctx = editCanvasRef.current.getContext('2d');
    if (!ctx) return;

    const loadAndSync = (url: string) => {
      const img = new Image();
      img.onload = () => {
        ctx.clearRect(0, 0, editCanvasRef.current!.width, editCanvasRef.current!.height);
        ctx.globalCompositeOperation = 'source-over';
        ctx.drawImage(img, 0, 0);
        const newUrl = editCanvasRef.current!.toDataURL('image/png');
        dispatch({ type: 'UPDATE_ELEMENT', id: editingId, updates: { src: newUrl } });
      };
      img.src = url;
    };

    if (prev.length > 0) {
      loadAndSync(prev[prev.length - 1]);
    } else {
      loadAndSync(originalSrcRef.current);
    }
  };

  /* ===== Clear all edits (but keep original image) ===== */
  const handleClearEdit = () => {
    if (!editCanvasRef.current || !editingId) return;
    const ctx = editCanvasRef.current.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, editCanvasRef.current.width, editCanvasRef.current.height);
    ctx.globalCompositeOperation = 'source-over';

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (!editCanvasRef.current) return;
      const w = editCanvasRef.current.width;
      const h = editCanvasRef.current.height;
      const c = editCanvasRef.current.getContext('2d');
      if (!c) return;
      c.clearRect(0, 0, w, h);
      c.globalCompositeOperation = 'source-over';
      c.drawImage(img, 0, 0);
      const cleanUrl = editCanvasRef.current.toDataURL('image/png');
      setEditHistory(prev => {
        const next = [...prev, cleanUrl];
        if (next.length > 30) return next.slice(next.length - 30);
        return next;
      });
      dispatch({ type: 'UPDATE_ELEMENT', id: editingId, updates: { src: cleanUrl } });
    };
    img.src = originalSrcRef.current;
  };

  /* ===== Finish edit and return to canvas ===== */
  const handleFinishEdit = () => {
    setEditingId(null);
    setEditHistory([]);
    lastDrawPos.current = null;
  };

  const exitEdit = () => {
    setEditingId(null);
    setEditHistory([]);
    lastDrawPos.current = null;
  };

  /* ===== Keyboard: Delete selected element ===== */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const active = document.activeElement;
      const isTyping = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || (active as HTMLElement).isContentEditable);
      if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedId && !editingId && !isTyping) {
        e.preventDefault();
        dispatch({ type: 'REMOVE_ELEMENT', id: state.selectedId });
        dispatch({ type: 'SELECT_ELEMENT', id: null });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.selectedId, editingId, dispatch]);

  const editingEl = state.elements.find(e => e.id === editingId) as ImageElement | undefined;
  const isMobile = useIsMobile();

  // Canvas auto-scale based on the real middle-column space.
  const [canvasScale, setCanvasScale] = useState(1);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasWrapperRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const updateCanvasScale = () => {
      const stageNode = stageRef.current;
      if (!stageNode) return;

      const styles = window.getComputedStyle(stageNode);
      const paddingX = parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight);
      const paddingY = parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom);
      const availableWidth = Math.max(stageNode.clientWidth - paddingX, CANVAS_SIZE * MOBILE_CANVAS_MIN_SCALE);
      const availableHeight = Math.max(stageNode.clientHeight - paddingY, CANVAS_SIZE * MOBILE_CANVAS_MIN_SCALE);

      setCanvasScale(getCanvasScale(isMobile, availableWidth, availableHeight));
    };

    updateCanvasScale();

    const resizeObserver = new ResizeObserver(() => {
      updateCanvasScale();
    });

    if (stageRef.current) {
      resizeObserver.observe(stageRef.current);
    }

    window.addEventListener('resize', updateCanvasScale);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', updateCanvasScale);
    };
  }, [isMobile]);

  return (
    <div
      ref={stageRef}
      className="flex flex-col items-center justify-center flex-1 overflow-y-auto p-3 md:p-4 gap-3"
      style={isMobile ? { paddingBottom: '60px' } : {}}>
      <div
        ref={canvasWrapperRef}
        className="canvas-outer"
        style={{
          width: CANVAS_SIZE * canvasScale,
          height: CANVAS_SIZE * canvasScale,
        }}
      >
        <div
          ref={canvasRef}
          className="relative rounded-xl canvas-inner"
          data-capture-root="true"
          style={{
            backgroundColor: '#FFFFFF',
            width: CANVAS_SIZE,
            height: CANVAS_SIZE,
            boxShadow: '0 16px 32px rgba(108, 146, 196, 0.22)',
            border: '3px solid #88a6cf',
            overflow: 'hidden',
            flexShrink: 0,
            transform: canvasScale !== 1 ? `scale(${canvasScale})` : undefined,
            transformOrigin: 'top left',
          }}
          onClick={handleCanvasClick}
          onTouchEnd={handleCanvasClick}
          onDragEnter={handleCanvasDragEnter}
          onDragOver={handleCanvasDragOver}
          onDragLeave={handleCanvasDragLeave}
          onDrop={handleCanvasDrop}
        >
        {isDragOver && (
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              border: '3px dashed #FF5E00',
              backgroundColor: 'rgba(255,94,0,0.08)',
              zIndex: 200,
            }}
          />
        )}
        {state.elements.length === 0 && !editingEl && (
          <div className="canvas-empty-state">
            <div className="canvas-empty-badge canvas-empty-badge-top">
              {state.language === 'zh' ? '连击 COMBO x3' : 'COMBO x3'}
            </div>
            <div className="canvas-empty-center">
              <div className="canvas-empty-panda">🐼</div>
              <h3>{state.language === 'zh' ? '把素材拖到这里' : 'Drop assets here'}</h3>
              <p>{state.language === 'zh' ? '开始创作你的熊猫头表情包吧！' : 'Start creating your panda meme pack!'}</p>
              <span>{state.language === 'zh' ? '支持 PNG / JPG / GIF' : 'Supports PNG / JPG / GIF'}</span>
            </div>
          </div>
        )}
        {state.elements.map((el) => {
          const isSelected = el.id === state.selectedId;
          if (el.type === 'image') {
            return (
              <DraggableImage
                key={el.id}
                element={el as ImageElement}
                isSelected={isSelected}
                onSelect={() => {
                  if (editingId) exitEdit();
                  dispatch({ type: 'SELECT_ELEMENT', id: el.id });
                }}
                onStartEdit={() => {
                  dispatch({ type: 'SELECT_ELEMENT', id: el.id });
                  startEdit(el.id);
                }}
              />
            );
          }
          return (
            <DraggableText
              key={el.id}
              element={el as TextElement}
              isSelected={isSelected}
              onSelect={() => {
                if (editingId) exitEdit();
                dispatch({ type: 'SELECT_ELEMENT', id: el.id });
              }}
            />
          );
        })}

        {/* Inline Image Edit Overlay (eraser/brush) */}
        {editingEl && (
          <div
            className="absolute canvas-element"
            style={{
              left: editingEl.x,
              top: editingEl.y,
              width: editingEl.width,
              height: editingEl.height,
              zIndex: 100,
            }}
          >
            <canvas
              ref={editCanvasRef}
              className="absolute inset-0"
              style={{
                width: editingEl.width,
                height: editingEl.height,
                cursor: cursorUrl,
                touchAction: 'none',
              }}
              onPointerDown={onEditPointerDown}
              onPointerMove={onEditPointerMove}
              onPointerUp={onEditPointerUp}
            />
            {/* Edit toolbar - two rows */}
            <div
              className="absolute -bottom-24 left-0 right-0 flex flex-col gap-1 rounded-lg edit-toolbar"
              style={{ backgroundColor: '#1a1a1a', border: '1px solid #333', zIndex: 110, minWidth: 'max-content', padding: '4px' }}
            >
              {/* Row 1: tools */}
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setEditTool('brush')}
                  className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium"
                  style={{ backgroundColor: editTool === 'brush' ? '#FF5E00' : '#2a2a2a', color: '#fff' }}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                  {state.language === 'zh' ? '画笔' : 'Brush'}
                </button>
                <button
                  onClick={() => setEditTool('eraser')}
                  className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium"
                  style={{ backgroundColor: editTool === 'eraser' ? '#EF4444' : '#2a2a2a', color: '#fff' }}
                >
                  <Eraser size={10} />{state.language === 'zh' ? '橡皮擦' : 'Eraser'}
                </button>
                <input
                  type="color"
                  value={editColor}
                  onChange={e => setEditColor(e.target.value)}
                  className="w-6 h-6 rounded cursor-pointer"
                  style={{ padding: 0, border: 'none', background: 'none' }}
                  disabled={editTool !== 'brush'}
                />
                <div className="flex items-center gap-1">
                  <span className="text-[9px]" style={{ color: '#888' }}>{state.language === 'zh' ? '粗细' : 'Size'}</span>
                  <input
                    type="range"
                    min={2}
                    max={40}
                    step={1}
                    value={editSize}
                    onChange={e => setEditSize(Number(e.target.value))}
                    className="w-14"
                    style={{ accentColor: '#FF5E00' }}
                  />
                  <span className="text-[9px] font-mono" style={{ color: '#ccc' }}>{editSize}</span>
                </div>
              </div>
              {/* Row 2: actions */}
              <div className="flex items-center gap-1.5">
                <button
                  onClick={handleFinishEdit}
                  className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold text-white"
                  style={{ backgroundColor: '#00CC66' }}
                  title={state.language === 'zh' ? '完成编辑' : 'Finish'}
                >
                  <Save size={10} />{state.language === 'zh' ? '完成' : 'Done'}
                </button>
                <button
                  onClick={handleUndoEdit}
                  disabled={editHistory.length <= 1}
                  className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold text-white disabled:opacity-30"
                  style={{ backgroundColor: '#0080FF' }}
                  title={state.language === 'zh' ? '撤回上一步' : 'Undo'}
                >
                  <Undo2 size={10} />{state.language === 'zh' ? '撤回' : 'Undo'}
                </button>
                <button
                  onClick={exitEdit}
                  className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold text-white"
                  style={{ backgroundColor: '#888' }}
                >
                  <LogOut size={10} />{state.language === 'zh' ? '退出' : 'Exit'}
                </button>
                <button
                  onClick={handleClearEdit}
                  className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium text-white"
                  style={{ backgroundColor: '#2a2a2a' }}
                  title={state.language === 'zh' ? '清空所有编辑' : 'Clear all'}
                >
                  <RotateCcw size={10} />{state.language === 'zh' ? '清空' : 'Clear'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
    </div>
  );
}
