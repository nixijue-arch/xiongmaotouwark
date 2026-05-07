import { useRef, useState, useCallback, useEffect } from 'react';
import { useMeme } from '@/context/memecontext';
import type { ImageElement, TextElement } from '@/context/memecontext';
import { useIsMobile } from '@/hooks/usemediaquery';
import Draggable from 'react-draggable';
import { Eraser, RotateCcw, LogOut, Save, Undo2 } from 'lucide-react';

/* ========== DraggableImage ========== */
interface DraggableImageProps {
  element: ImageElement;
  isSelected: boolean;
  onSelect: () => void;
  onStartEdit: () => void;
}

type ResizeDir = 'nw' | 'n' | 'ne' | 'w' | 'e' | 'sw' | 's' | 'se';

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

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove);
    window.addEventListener('touchend', onUp);
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
      className={`absolute ${p.c}`}
      style={{ ...p.s, width: 10, height: 10, borderRadius: '50%', backgroundColor: '#FF5E00', zIndex: 15, border: '2px solid #fff', boxSizing: 'border-box' }}
      onMouseDown={onStart}
      onTouchStart={onStart}
    />
  );
}

function DraggableImage({ element, isSelected, onSelect, onStartEdit }: DraggableImageProps) {
  const nodeRef = useRef<HTMLDivElement>(null);
  const { dispatch } = useMeme();
  const rhNW = useResizeHandler(element, 'nw');
  const rhN  = useResizeHandler(element, 'n');
  const rhNE = useResizeHandler(element, 'ne');
  const rhW  = useResizeHandler(element, 'w');
  const rhE  = useResizeHandler(element, 'e');
  const rhSW = useResizeHandler(element, 'sw');
  const rhS  = useResizeHandler(element, 's');
  const rhSE = useResizeHandler(element, 'se');
  return (
    <Draggable
      nodeRef={nodeRef}
      position={{ x: element.x, y: element.y }}
      onStop={(_, data) => dispatch({ type: 'UPDATE_ELEMENT', id: element.id, updates: { x: data.x, y: data.y } })}
      onStart={onSelect}
    >
      <div
        ref={nodeRef}
        className="absolute cursor-move select-none"
        style={{ zIndex: isSelected ? 50 : element.zIndex, transform: `rotate(${element.rotation}deg)`, opacity: element.opacity }}
        onClick={(e) => { e.stopPropagation(); onSelect(); }}
      >
        <img src={element.src} alt="element" className="block max-w-none" draggable={false}
          style={{ width: element.width, height: element.height, transform: element.flipX ? 'scaleX(-1)' : 'none' }}
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
        {isSelected && (
          <>
            <div className="absolute border-2 border-dashed pointer-events-none" style={{ borderColor: '#FF5E00', inset: -2, zIndex: 5 }} />
            {/* Delete button - top right corner */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                dispatch({ type: 'REMOVE_ELEMENT', id: element.id });
                dispatch({ type: 'SELECT_ELEMENT', id: null });
              }}
              className="absolute flex items-center justify-center rounded-full pointer-events-auto hover:scale-110 transition-transform"
              style={{
                width: 18, height: 18,
                top: -10, right: -10,
                backgroundColor: '#EF4444',
                zIndex: 20,
                border: '2px solid #fff',
              }}
              title="删除"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
            <ResizeHandle dir="nw" onStart={rhNW} />
            <ResizeHandle dir="n"  onStart={rhN} />
            <ResizeHandle dir="ne" onStart={rhNE} />
            <ResizeHandle dir="w"  onStart={rhW} />
            <ResizeHandle dir="e"  onStart={rhE} />
            <ResizeHandle dir="sw" onStart={rhSW} />
            <ResizeHandle dir="s"  onStart={rhS} />
            <ResizeHandle dir="se" onStart={rhSE} />
            <button
              onClick={(e) => { e.stopPropagation(); onStartEdit(); }}
              className="absolute flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold text-white pointer-events-auto"
              style={{ backgroundColor: '#0080FF', zIndex: 16, left: '50%', transform: 'translateX(-50%)', top: 'calc(100% + 6px)' }}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
              编辑
            </button>
          </>
        )}
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

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove);
    window.addEventListener('touchend', onUp);
  }, [element, dispatch]);
}

function DraggableText({ element, isSelected, onSelect }: {
  element: TextElement;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const nodeRef = useRef<HTMLDivElement>(null);
  const { dispatch } = useMeme();
  const rh = useTextResizeHandler(element);

  return (
    <Draggable
      nodeRef={nodeRef}
      position={{ x: element.x, y: element.y }}
      onStop={(_, data) => dispatch({ type: 'UPDATE_ELEMENT', id: element.id, updates: { x: data.x, y: data.y } })}
      onStart={onSelect}
    >
      <div
        ref={nodeRef}
        className="absolute cursor-move select-none"
        style={{ zIndex: isSelected ? 50 : element.zIndex }}
        onClick={(e) => { e.stopPropagation(); onSelect(); }}
      >
        <div
          className="whitespace-nowrap px-2 py-1 font-bold"
          style={{
            fontSize: element.fontSize,
            color: element.fillColor,
            fontWeight: element.fontWeight,
            textAlign: element.textAlign,
            WebkitTextStroke: element.strokeWidth > 0 ? `${element.strokeWidth}px ${element.strokeColor}` : 'none',
          }}
        >
          {element.text}
        </div>
        {isSelected && (
          <>
            <div className="absolute border-2 border-dashed pointer-events-none" style={{ borderColor: '#FF5E00', inset: -4, zIndex: 5 }} />
            {/* Delete button - top right corner */}
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
              title="删除"
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
  const { state, dispatch } = useMeme();

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

  useEffect(() => {
    setCursorUrl(buildCursorSVG(editTool, editSize, editColor));
  }, [editTool, editSize, editColor]);

  const handleCanvasClick = (e: React.MouseEvent | React.TouchEvent) => {
    if ((e.target as HTMLElement).closest('.canvas-element')) return;
    if ((e.target as HTMLElement).closest('.edit-toolbar')) return;
    dispatch({ type: 'SELECT_ELEMENT', id: null });
    setEditingId(null);
  };

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
      if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedId && !editingId) {
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

  // Mobile canvas auto-scale
  const [canvasScale, setCanvasScale] = useState(1);
  const canvasWrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isMobile) {
      setCanvasScale(1);
      return;
    }
    const calc = () => {
      const vw = window.innerWidth - 16;
      const vh = window.innerHeight - 120; // leave room for header + FABs
      const s = Math.min(1, Math.min(vw / 500, vh / 500));
      setCanvasScale(Math.max(0.45, s));
    };
    calc();
    window.addEventListener('resize', calc);
    return () => window.removeEventListener('resize', calc);
  }, [isMobile]);

  return (
    <div className="flex flex-col items-center justify-center flex-1 overflow-y-auto p-3 md:p-4 gap-3"
      style={isMobile ? { paddingBottom: '60px' } : {}}>
      <div
        ref={canvasWrapperRef}
        className="canvas-outer"
        style={{
          width: isMobile ? 500 * canvasScale : 500,
          height: isMobile ? 500 * canvasScale : 500,
        }}
      >
        <div
          ref={canvasRef}
          className="relative rounded-xl canvas-inner"
          style={{
            backgroundColor: '#FFFFFF',
            width: 500,
            height: 500,
            boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
            border: '2px solid #2a2a2a',
            overflow: 'hidden',
            flexShrink: 0,
            transform: isMobile && canvasScale !== 1 ? `scale(${canvasScale})` : undefined,
            transformOrigin: 'top left',
          }}
          onClick={handleCanvasClick}
          onTouchEnd={handleCanvasClick}
        >
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
                  画笔
                </button>
                <button
                  onClick={() => setEditTool('eraser')}
                  className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium"
                  style={{ backgroundColor: editTool === 'eraser' ? '#EF4444' : '#2a2a2a', color: '#fff' }}
                >
                  <Eraser size={10} />橡皮擦
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
                  <span className="text-[9px]" style={{ color: '#888' }}>粗细</span>
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
                  title="完成编辑"
                >
                  <Save size={10} />完成
                </button>
                <button
                  onClick={handleUndoEdit}
                  disabled={editHistory.length <= 1}
                  className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold text-white disabled:opacity-30"
                  style={{ backgroundColor: '#0080FF' }}
                  title="撤回上一步"
                >
                  <Undo2 size={10} />撤回
                </button>
                <button
                  onClick={exitEdit}
                  className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold text-white"
                  style={{ backgroundColor: '#888' }}
                >
                  <LogOut size={10} />退出
                </button>
                <button
                  onClick={handleClearEdit}
                  className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium text-white"
                  style={{ backgroundColor: '#2a2a2a' }}
                  title="清空所有编辑"
                >
                  <RotateCcw size={10} />清空
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
