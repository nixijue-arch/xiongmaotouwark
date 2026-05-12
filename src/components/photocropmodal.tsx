import { useState, useRef, useEffect, useCallback } from 'react';
import { X, Upload, Check, RotateCcw, Move, Square, PenTool, Eraser, Undo2, Sparkles } from 'lucide-react';
import { PANDA_HEADS } from '@/data/materials';

type Tool = 'rect' | 'lasso';
type Mode = 'crop' | 'eraser';

interface Point { x: number; y: number; }

interface PhotoCropModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (dataUrl: string) => void;
  language: 'zh' | 'en';
}

const tDict = {
  zh: {
    title: '自制熊猫脸',
    upload: '上传照片',
    rect: '矩形',
    lasso: '套索',
    cropHint: '拖动方框调整位置，拖动右下角调整大小',
    lassoHint: '按住鼠标/手指自由绘制选区',
    lassoDraw: '画线中…松开手指闭合选区',
    preview: '预览效果',
    contrast: '对比度',
    strength: '强度',
    strengthHint: '强度越高：灰阶越少，白色越白，黑色越纯',
    flip: '水平翻转',
    eraser: '喷枪橡皮擦',
    eraserSize: '橡皮擦大小',
    undo: '撤销',
    noUndo: '没有可撤销的操作',
    confirm: '确认使用',
    cancel: '取消',
    reset: '重新上传',
  },
  en: {
    title: 'Custom Panda Face',
    upload: 'Upload Photo',
    rect: 'Rect',
    lasso: 'Lasso',
    cropHint: 'Drag box to move, drag corner to resize',
    lassoHint: 'Hold and draw freely to select area',
    lassoDraw: 'Drawing… release to close selection',
    preview: 'Preview',
    contrast: 'Contrast',
    strength: 'Strength',
    strengthHint: 'Higher = fewer grays, whiter whites, blacker blacks',
    flip: 'Flip H',
    eraser: 'Airbrush Eraser',
    eraserSize: 'Eraser Size',
    undo: 'Undo',
    noUndo: 'Nothing to undo',
    confirm: 'Confirm',
    cancel: 'Cancel',
    reset: 'Re-upload',
  },
};

const DEFAULT_CONTRAST = 100;
const DEFAULT_STRENGTH = 150;

// Enhanced B&W + Exposure combined
function applyStrength(gray: number, s: number): number {
  if (s <= 0) return gray;
  const t = s / 150;

  // Exposure - boost highlights
  const exposureBoost = t * 60 * Math.pow(gray / 255, 1.5);
  gray = Math.min(255, gray + exposureBoost);

  // S-curve
  const norm = gray / 255;
  const steepness = 1 + t * 6;
  let curved: number;
  if (norm < 0.5) {
    curved = 0.5 * Math.pow(2 * norm, steepness);
  } else {
    curved = 1 - 0.5 * Math.pow(2 * (1 - norm), steepness);
  }

  // Posterize
  const levels = Math.max(2, Math.round(256 * (1 - t * 0.95)));
  const step = 255 / (levels - 1);
  let result = Math.round(curved * 255 / step) * step;

  // Extra white boost
  if (result > 200) {
    result = result + (255 - result) * t * 0.5;
  }

  // Extra black crush
  if (result < 60) {
    result = result * (1 - t * 0.3);
  }

  return Math.max(0, Math.min(255, result));
}

export function PhotoCropModal({ isOpen, onClose, onConfirm, language }: PhotoCropModalProps) {
  const t = tDict[language];
  const [sourceUrl, setSourceUrl] = useState<string>('');
  const [tool, setTool] = useState<Tool>('rect');
  const [mode, setMode] = useState<Mode>('crop');
  const [crop, setCrop] = useState({ x: 80, y: 60, w: 180, h: 180 });
  const [lassoPoints, setLassoPoints] = useState<Point[]>([]);
  const [contrast, setContrast] = useState(DEFAULT_CONTRAST);
  const [strength, setStrength] = useState(DEFAULT_STRENGTH);
  const [flipH, setFlipH] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [isDrawingLasso, setIsDrawingLasso] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0, cropX: 0, cropY: 0, cropW: 0, cropH: 0 });
  const [eraserSize, setEraserSize] = useState(25);
  const [isErasing, setIsErasing] = useState(false);
  const [hasEraseData, setHasEraseData] = useState(false);
  const lastEraserPos = useRef<Point | null>(null);
  const [history, setHistory] = useState<ImageData[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  // Panda head preview loaded
  const [, setPandaLoaded] = useState(false);
  const [isDragOverUpload, setIsDragOverUpload] = useState(false);

  const imgRef = useRef<HTMLImageElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const processCanvasRef = useRef<HTMLCanvasElement>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const saveHistory = useCallback(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    setHistory(prev => { const next = prev.slice(0, historyIndex + 1); next.push(data); if (next.length > 30) next.shift(); return next; });
    setHistoryIndex(prev => Math.min(prev + 1, 29));
  }, [historyIndex]);

  const undo = useCallback(() => {
    if (historyIndex < 0 || history.length === 0) { alert(t.noUndo); return; }
    const idx = historyIndex - 1;
    if (idx < 0) { alert(t.noUndo); return; }
    const canvas = previewCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const prevData = history[idx];
    canvas.width = prevData.width; canvas.height = prevData.height;
    ctx.putImageData(prevData, 0, 0);
    setHistoryIndex(idx);
    const processCanvas = processCanvasRef.current;
    if (processCanvas) {
      processCanvas.width = prevData.width; processCanvas.height = prevData.height;
      const pCtx = processCanvas.getContext('2d');
      if (pCtx) pCtx.putImageData(prevData, 0, 0);
    }
    if (maskCanvasRef.current) {
      const mCtx = maskCanvasRef.current.getContext('2d');
      if (mCtx) mCtx.clearRect(0, 0, maskCanvasRef.current.width, maskCanvasRef.current.height);
    }
    setHasEraseData(false);
  }, [history, historyIndex, t.noUndo]);

  // ===== CORE PROCESSING =====
  const processImage = useCallback(() => {
    if (!sourceUrl || !processCanvasRef.current) return;
    const canvas = processCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      let _srcX = 0, _srcY = 0, srcW = img.naturalWidth, srcH = img.naturalHeight;
      if (tool === 'rect') {
        _srcX = crop.x; _srcY = crop.y; srcW = crop.w; srcH = crop.h;
      }

      // Ensure canvas size matches crop exactly
      canvas.width = srcW;
      canvas.height = srcH;
      ctx.clearRect(0, 0, srcW, srcH);

      // Draw clipped image
      ctx.save();
      ctx.translate(srcW / 2, srcH / 2);
      if (flipH) ctx.scale(-1, 1);

      if (tool === 'lasso' && lassoPoints.length > 2) {
        const minX = Math.min(...lassoPoints.map(p => p.x));
        const minY = Math.min(...lassoPoints.map(p => p.y));
        const maxX = Math.max(...lassoPoints.map(p => p.x));
        const maxY = Math.max(...lassoPoints.map(p => p.y));
        const bw = maxX - minX, bh = maxY - minY;
        if (bw > 0 && bh > 0) {
          ctx.beginPath();
          ctx.moveTo(lassoPoints[0].x - minX - bw / 2, lassoPoints[0].y - minY - bh / 2);
          for (let i = 1; i < lassoPoints.length; i++) ctx.lineTo(lassoPoints[i].x - minX - bw / 2, lassoPoints[i].y - minY - bh / 2);
          ctx.closePath(); ctx.clip();
          ctx.drawImage(img, minX, minY, bw, bh, -bw / 2, -bh / 2, bw, bh);
        }
      } else {
        ctx.drawImage(img, _srcX, _srcY, srcW, srcH, -srcW / 2, -srcH / 2, srcW, srcH);
      }
      ctx.restore();

      // Pixel processing
      const imageData = ctx.getImageData(0, 0, srcW, srcH);
      const data = imageData.data;
      for (let i = 0; i < data.length; i += 4) {
        let r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
        if (a < 10) continue;
        let gray = 0.299 * r + 0.587 * g + 0.114 * b;
        if (contrast !== 0) {
          const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));
          gray = factor * (gray - 128) + 128;
          gray = Math.max(0, Math.min(255, gray));
        }
        gray = applyStrength(gray, strength);
        data[i] = gray; data[i + 1] = gray; data[i + 2] = gray;
        if (gray > 242) data[i + 3] = 0;
        else if (gray > 200) data[i + 3] = Math.max(0, Math.round(a * (255 - (gray - 200)) / 42));
      }
      ctx.putImageData(imageData, 0, 0);

      // Apply eraser mask
      if (hasEraseData && maskCanvasRef.current) {
        const maskCtx = maskCanvasRef.current.getContext('2d');
        if (maskCtx) { ctx.save(); ctx.globalCompositeOperation = 'destination-out'; ctx.drawImage(maskCanvasRef.current, 0, 0); ctx.restore(); }
      }

      // Copy to preview canvas
      const pCanvas = previewCanvasRef.current;
      if (pCanvas) {
        pCanvas.width = srcW;
        pCanvas.height = srcH;
        const pCtx = pCanvas.getContext('2d');
        if (pCtx) { pCtx.clearRect(0, 0, srcW, srcH); pCtx.drawImage(canvas, 0, 0); }
      }
    };
    img.src = sourceUrl;
  }, [sourceUrl, tool, crop, lassoPoints, contrast, strength, flipH, hasEraseData]);

  // Re-process when params change
  useEffect(() => {
    if (sourceUrl) {
      const timer = setTimeout(() => { processImage(); setTimeout(() => saveHistory(), 80); }, 60);
      return () => clearTimeout(timer);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceUrl, tool, crop, lassoPoints, contrast, strength, flipH]);

  // Render preview with panda head background
  const renderPreviewWithPanda = useCallback(() => {
    const pCanvas = previewCanvasRef.current;
    if (!pCanvas) return;

    // Get current processed image from process canvas
    const procCanvas = processCanvasRef.current;
    if (!procCanvas) return;

    // Create composite canvas
    const comp = document.createElement('canvas');
    comp.width = 280; comp.height = 280;
    const cCtx = comp.getContext('2d');
    if (!cCtx) return;

    // Clear
    cCtx.clearRect(0, 0, 280, 280);

    // Draw panda head (scaled to fit)
    const pandaImg = new window.Image();
    pandaImg.crossOrigin = 'anonymous';
    pandaImg.onload = () => {
      // Draw panda centered, fitting in bottom portion
      const scale = 280 / 500; // scale down from 500px canvas to 280px preview
      cCtx.drawImage(pandaImg, 0, 0, 500, 500, 0, 0, 280, 280);

      // Draw face on top, positioned at default face offset
      const faceX = 140 - procCanvas.width * scale / 2;
      const faceY = 90 - procCanvas.height * scale / 2; // adjust for eyes area
      cCtx.drawImage(procCanvas, 0, 0, procCanvas.width, procCanvas.height, faceX, faceY, procCanvas.width * scale, procCanvas.height * scale);
    };
    pandaImg.src = PANDA_HEADS[0].src;
  }, [sourceUrl, processImage]);

  // Trigger composite render after processImage
  useEffect(() => {
    if (sourceUrl) {
      const timer = setTimeout(() => renderPreviewWithPanda(), 100);
      return () => clearTimeout(timer);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceUrl, tool, crop, lassoPoints, contrast, strength, flipH, hasEraseData]);

  // ===== FILE UPLOAD =====
  const handleSelectedFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const url = ev.target?.result as string;
      setSourceUrl(url); setLassoPoints([]); setFlipH(false);
      setContrast(DEFAULT_CONTRAST); setStrength(DEFAULT_STRENGTH);
      setMode('crop'); setHasEraseData(false);
      setMode('crop'); setHasEraseData(false);
      const img = new window.Image();
      img.onload = () => {
        const cw = Math.min(280, img.width * 0.55); const ch = Math.min(280, img.height * 0.55);
        setCrop({ x: (img.width - cw) / 2, y: (img.height - ch) / 2, w: cw, h: ch });
      };
      img.src = url;
    };
    reader.readAsDataURL(file);
  }, []);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    handleSelectedFile(file);
    e.target.value = '';
  };

  const handleUploadDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setIsDragOverUpload(true);
  };

  const handleUploadDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return;
    e.preventDefault();
    setIsDragOverUpload(false);
  };

  const handleUploadDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOverUpload(false);
    const file = Array.from(e.dataTransfer.files).find(item => item.type.startsWith('image/'));
    if (!file) return;
    handleSelectedFile(file);
  };

  // ===== COORDS =====
  const getImgCoords = (clientX: number, clientY: number): Point | null => {
    const img = imgRef.current; if (!img) return null;
    const rect = img.getBoundingClientRect();
    return { x: (clientX - rect.left) * (img.naturalWidth / rect.width), y: (clientY - rect.top) * (img.naturalHeight / rect.height) };
  };

  // ===== RECT =====
  const onPointerDownBox = (e: React.PointerEvent) => {
    if (tool === 'lasso') return;
    e.preventDefault(); setIsDragging(true);
    setDragStart({ x: e.clientX, y: e.clientY, cropX: crop.x, cropY: crop.y, cropW: crop.w, cropH: crop.h });
  };

  const onPointerDownCorner = (e: React.PointerEvent) => {
    if (tool === 'lasso') return;
    e.preventDefault(); e.stopPropagation(); setIsResizing(true);
    setDragStart({ x: e.clientX, y: e.clientY, cropX: crop.x, cropY: crop.y, cropW: crop.w, cropH: crop.h });
  };

  // ===== LASSO =====
  const onLassoDown = (e: React.PointerEvent) => {
    if (tool !== 'lasso') return; e.preventDefault(); setIsDrawingLasso(true); setLassoPoints([]);
    const pt = getImgCoords(e.clientX, e.clientY); if (pt) setLassoPoints([pt]);
  };

  const onLassoMove = (e: React.PointerEvent) => {
    if (!isDrawingLasso || tool !== 'lasso') return;
    const pt = getImgCoords(e.clientX, e.clientY); if (pt) setLassoPoints(prev => [...prev, pt]);
  };

  const onLassoUp = () => { if (!isDrawingLasso) return; setIsDrawingLasso(false); setLassoPoints(prev => prev.length > 2 ? [...prev, prev[0]] : []); };

  // ===== ERASER =====
  const getPreviewCanvasCoords = (clientX: number, clientY: number): Point | null => {
    const canvas = previewCanvasRef.current; if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return { x: (clientX - rect.left) * (canvas.width / rect.width), y: (clientY - rect.top) * (canvas.height / rect.height) };
  };

  const drawAirbrush = (ctx: CanvasRenderingContext2D, x: number, y: number, size: number) => {
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, size);
    gradient.addColorStop(0, 'rgba(0,0,0,0.9)'); gradient.addColorStop(0.3, 'rgba(0,0,0,0.5)');
    gradient.addColorStop(0.6, 'rgba(0,0,0,0.15)'); gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient; ctx.beginPath(); ctx.arc(x, y, size, 0, Math.PI * 2); ctx.fill();
  };

  const onEraserDown = (e: React.PointerEvent) => {
    if (mode !== 'eraser') return; e.preventDefault(); setIsErasing(true);
    const pt = getPreviewCanvasCoords(e.clientX, e.clientY);
    if (pt) { lastEraserPos.current = pt; saveHistory(); eraseAt(pt.x, pt.y); }
  };

  const onEraserMove = (e: React.PointerEvent) => {
    if (!isErasing || mode !== 'eraser') return;
    const pt = getPreviewCanvasCoords(e.clientX, e.clientY);
    if (pt && lastEraserPos.current) { eraseLine(lastEraserPos.current, pt); lastEraserPos.current = pt; }
  };

  const onEraserUp = () => {
    if (!isErasing) return; setIsErasing(false); lastEraserPos.current = null;
    const pCanvas = previewCanvasRef.current; const processCanvas = processCanvasRef.current;
    if (pCanvas && processCanvas) {
      processCanvas.width = pCanvas.width; processCanvas.height = pCanvas.height;
      const pCtx = processCanvas.getContext('2d'); const pCtx2 = pCanvas.getContext('2d');
      if (pCtx && pCtx2) { pCtx.clearRect(0, 0, processCanvas.width, processCanvas.height); pCtx.drawImage(pCanvas, 0, 0); }
    }
  };

  const eraseAt = (x: number, y: number) => {
    if (!previewCanvasRef.current) return;
    const pCtx = previewCanvasRef.current.getContext('2d'); if (!pCtx) return;
    if (maskCanvasRef.current) {
      const mCtx = maskCanvasRef.current.getContext('2d');
      if (mCtx) {
        if (maskCanvasRef.current.width !== previewCanvasRef.current.width || maskCanvasRef.current.height !== previewCanvasRef.current.height) {
          maskCanvasRef.current.width = previewCanvasRef.current.width; maskCanvasRef.current.height = previewCanvasRef.current.height;
        }
        drawAirbrush(mCtx, x, y, eraserSize);
      }
    }
    pCtx.save(); pCtx.globalCompositeOperation = 'destination-out'; drawAirbrush(pCtx, x, y, eraserSize); pCtx.restore();
    setHasEraseData(true);
  };

  const eraseLine = (from: Point, to: Point) => {
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    const steps = Math.max(1, Math.floor(dist / (eraserSize * 0.35)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps; const x = from.x + (to.x - from.x) * t; const y = from.y + (to.y - from.y) * t;
      if (!previewCanvasRef.current) continue;
      const pCtx = previewCanvasRef.current.getContext('2d'); if (!pCtx) continue;
      if (maskCanvasRef.current) { const mCtx = maskCanvasRef.current.getContext('2d'); if (mCtx) drawAirbrush(mCtx, x, y, eraserSize); }
      pCtx.save(); pCtx.globalCompositeOperation = 'destination-out'; drawAirbrush(pCtx, x, y, eraserSize); pCtx.restore();
    }
    setHasEraseData(true);
  };

  // ===== GLOBAL DRAG =====
  useEffect(() => {
    if (!isDragging && !isResizing) return;
    const onMove = (e: PointerEvent) => {
      if (!imgRef.current) return;
      const img = imgRef.current; const imgRect = img.getBoundingClientRect();
      const scaleX = img.naturalWidth / imgRect.width; const scaleY = img.naturalHeight / imgRect.height;
      if (isDragging) {
        const dx = (e.clientX - dragStart.x) * scaleX; const dy = (e.clientY - dragStart.y) * scaleY;
        setCrop(prev => ({ ...prev, x: Math.max(0, Math.min(img.naturalWidth - prev.w, dragStart.cropX + dx)), y: Math.max(0, Math.min(img.naturalHeight - prev.h, dragStart.cropY + dy)) }));
      } else if (isResizing) {
        const dx = (e.clientX - dragStart.x) * scaleX; const dy = (e.clientY - dragStart.y) * scaleY;
        setCrop(prev => ({ ...prev, w: Math.max(40, Math.min(img.naturalWidth - prev.x, dragStart.cropW + dx)), h: Math.max(40, Math.min(img.naturalHeight - prev.y, dragStart.cropH + dy)) }));
      }
    };
    const onUp = () => { setIsDragging(false); setIsResizing(false); };
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp);
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
  }, [isDragging, isResizing, dragStart]);

  // ===== EDGE FEATHER =====
  const applyEdgeFeather = (canvas: HTMLCanvasElement): string => {
    const ctx = canvas.getContext('2d'); if (!ctx) return canvas.toDataURL('image/png');
    const w = canvas.width, h = canvas.height;
    const temp = document.createElement('canvas'); temp.width = w; temp.height = h;
    const tCtx = temp.getContext('2d'); if (!tCtx) return canvas.toDataURL('image/png');
    tCtx.filter = 'blur(4px)'; tCtx.drawImage(canvas, 0, 0); tCtx.filter = 'none';
    const mask = document.createElement('canvas'); mask.width = w; mask.height = h;
    const mCtx = mask.getContext('2d'); if (!mCtx) return canvas.toDataURL('image/png');
    mCtx.fillStyle = '#000'; mCtx.fillRect(0, 0, w, h); mCtx.globalCompositeOperation = 'destination-out';
    mCtx.filter = 'blur(6px)'; mCtx.fillStyle = '#fff';
    mCtx.fillRect(3, 3, w - 6, h - 6);
    mCtx.filter = 'none';
    const result = document.createElement('canvas'); result.width = w; result.height = h;
    const rCtx = result.getContext('2d'); if (!rCtx) return canvas.toDataURL('image/png');
    rCtx.drawImage(temp, 0, 0);
    rCtx.save(); rCtx.globalCompositeOperation = 'destination-out'; rCtx.drawImage(mask, 0, 0); rCtx.restore();
    const mask2 = document.createElement('canvas'); mask2.width = w; mask2.height = h;
    const m2Ctx = mask2.getContext('2d');
    if (m2Ctx) { m2Ctx.fillStyle = '#fff'; m2Ctx.fillRect(0, 0, mask2.width, mask2.height); m2Ctx.drawImage(mask, 0, 0); m2Ctx.globalCompositeOperation = 'source-in'; m2Ctx.drawImage(canvas, 0, 0); rCtx.drawImage(mask2, 0, 0); }
    rCtx.restore();
    return result.toDataURL('image/png');
  };

  // ===== ACTIONS =====
  const resetAll = () => {
    setSourceUrl(''); setLassoPoints([]);
    setCrop({ x: 80, y: 60, w: 180, h: 180 });
    setContrast(DEFAULT_CONTRAST); setStrength(DEFAULT_STRENGTH);
    setFlipH(false); setMode('crop'); setHasEraseData(false);
    setTool('rect');
    setHistory([]); setHistoryIndex(-1);
  };

  const handleConfirm = () => {
    const finalCanvas = previewCanvasRef.current || processCanvasRef.current;
    if (!finalCanvas) return;
    const featheryUrl = applyEdgeFeather(finalCanvas);
    onConfirm(featheryUrl);
    resetAll();
  };

  const handleClose = () => { resetAll(); onClose(); };

  // ===== RENDER HELPERS =====
  const renderLassoOverlay = () => {
    if (!lassoPoints.length || !imgRef.current) return null;
    const img = imgRef.current;
    const pts = lassoPoints.map(p => ({ x: (p.x / img.naturalWidth) * 100, y: (p.y / img.naturalHeight) * 100 }));
    const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x},${p.y}`).join(' ');

    // Only fill if closed (lassoUp has run)
    const isClosed = !isDrawingLasso && lassoPoints.length > 2;

    return (
      <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
        <path d={path + (isClosed ? ' Z' : '')} fill={isClosed ? 'rgba(31,146,248,0.15)' : 'none'} stroke="#FF5E00" strokeWidth="0.25" strokeDasharray="0.6,0.3" />
        {pts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="0.4" fill="#FF5E00" />)}
      </svg>
    );
  };

  const renderCropOverlay = () => {
    if (!sourceUrl || !imgRef.current || tool === 'lasso') return null;
    const img = imgRef.current;
    const left = (crop.x / img.naturalWidth) * 100, top = (crop.y / img.naturalHeight) * 100;
    const width = (crop.w / img.naturalWidth) * 100, height = (crop.h / img.naturalHeight) * 100;
    return (
      <>
        <div className="absolute inset-0 pointer-events-none" style={{ backgroundColor: 'rgba(0,0,0,0.55)' }} />
        <div className="absolute cursor-move select-none" style={{ left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${height}%`, pointerEvents: 'auto' }} onPointerDown={onPointerDownBox}>
          <div className="absolute inset-0 pointer-events-none" style={{ boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)' }} />
          <div className="absolute inset-0 pointer-events-none" style={{ border: '2px dashed #FF5E00' }} />
          <div className="absolute bottom-0 right-0 w-6 h-6 cursor-se-resize flex items-center justify-center z-10" style={{ backgroundColor: '#1f92f8', transform: 'translate(50%, 50%)', borderRadius: '50%' }} onPointerDown={onPointerDownCorner}><Move size={12} color="#fff" /></div>
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none"><Move size={16} color="rgba(255,255,255,0.5)" /></div>
        </div>
      </>
    );
  };



  const edgeHandle = (pos: string): React.CSSProperties => {
    const s: React.CSSProperties = { position: 'absolute', backgroundColor: '#1f92f8', zIndex: 10 };
    switch (pos) {
      case 'n': return { ...s, top: -4, left: '25%', right: '25%', height: 8, cursor: 'ns-resize', borderRadius: 4 };
      case 's': return { ...s, bottom: -4, left: '25%', right: '25%', height: 8, cursor: 'ns-resize', borderRadius: 4 };
      case 'e': return { ...s, top: '25%', bottom: '25%', right: -4, width: 8, cursor: 'ew-resize', borderRadius: 4 };
      case 'w': return { ...s, top: '25%', bottom: '25%', left: -4, width: 8, cursor: 'ew-resize', borderRadius: 4 };
      case 'se': return { ...s, bottom: -5, right: -5, width: 10, height: 10, cursor: 'se-resize', borderRadius: '50%' };
      case 'nw': return { ...s, top: -5, left: -5, width: 10, height: 10, cursor: 'nw-resize', borderRadius: '50%' };
      case 'ne': return { ...s, top: -5, right: -5, width: 10, height: 10, cursor: 'ne-resize', borderRadius: '50%' };
      case 'sw': return { ...s, bottom: -5, left: -5, width: 10, height: 10, cursor: 'sw-resize', borderRadius: '50%' };
      default: return s;
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center p-2" style={{ backgroundColor: 'rgba(10, 53, 109, 0.6)' }} onClick={handleClose}>
      <div className="relative w-full max-w-[960px] max-h-[94dvh] overflow-y-auto rounded-2xl p-3 sm:p-5 flex flex-col gap-2 sm:gap-3"
        style={{ background: 'linear-gradient(180deg, #fffdf7 0%, #f7f1e3 100%)', border: '3px solid #0a4e97', boxShadow: '0 8px 24px rgba(7, 48, 95, 0.22)' }}
        onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 flex-wrap">
            <Sparkles size={20} style={{ color: '#1767c7' }} />
            <h2 className="text-base sm:text-lg font-bold" style={{ color: '#0a356d' }}>{t.title}</h2>
            <span className="text-xs hidden sm:inline" style={{ color: '#456' }}>· {language === 'zh' ? '上传照片自定义熊猫头脸' : 'Upload your own photo'}</span>
          </div>
          <button onClick={handleClose} className="p-1.5 rounded" style={{ color: '#0a356d' }}><X size={18} /></button>
        </div>

        {/* Upload */}
        {!sourceUrl && (
          <>
            <label
              className="block border-2 border-dashed rounded-xl py-8 px-6 text-center cursor-pointer transition-all hover:scale-[1.01]"
              style={{
                borderColor: isDragOverUpload ? '#0a8552' : '#0a8552',
                background: isDragOverUpload ? 'linear-gradient(180deg, #c6ecd9 0%, #a5e0c1 100%)' : 'linear-gradient(180deg, #fff 0%, #ddf5e8 100%)',
              }}
              onDragOver={handleUploadDragOver}
              onDragLeave={handleUploadDragLeave}
              onDrop={handleUploadDrop}
            >
              <Upload size={28} className="mx-auto mb-2" style={{ color: '#0a8552' }} />
              <div className="font-bold text-sm" style={{ color: '#0a356d' }}>{t.upload}</div>
              <div className="text-[11px] mt-1" style={{ color: '#456', fontWeight: 500 }}>JPG / PNG / GIF · {language === 'zh' ? '拖拽 / 点击' : 'Drag / Click'}</div>
              <input type="file" accept="image/*" onChange={handleFile} className="hidden" ref={fileInputRef} />
            </label>
            <div className="mt-1 p-3 rounded-lg text-[11px] leading-relaxed" style={{ background: 'linear-gradient(180deg, #dff0ff 0%, #d5ebff 100%)', border: '2px solid #0a4e97', color: '#0a356d' }}>
              <div className="font-bold mb-1" style={{ color: '#1767c7' }}>📌 几个小提醒</div>
              <div>· {language === 'zh' ? '上传照片后, 用矩形或套索框选脸部区域' : 'Upload a photo, then crop face with rect or lasso tool'}</div>
              <div>· {language === 'zh' ? '右侧预览实时显示效果, 可拖滑块调整强度' : 'Preview shows results live, drag sliders to tune'}</div>
              <div>· {language === 'zh' ? '橡皮擦可擦除不想要的部分' : 'Use eraser to remove unwanted parts'}</div>
            </div>
          </>
        )}

        {/* Editor */}
        {sourceUrl && (
          <>
            {/* Tool Bar */}
            <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
              <span className="text-[11px] sm:text-xs mr-0.5 font-bold" style={{ color: '#0a356d' }}>{language === 'zh' ? '工具:' : 'Tool:'}</span>
              {([
                ['rect', t.rect, Square], ['lasso', t.lasso, PenTool]
              ] as const).map(([key, label, Icon]) => {
                const isActive = tool === key && mode === 'crop';
                return (
                  <button key={key} onClick={() => { setTool(key); setMode('crop'); }}
                    className="about-arcade-btn"
                    style={isActive
                      ? { padding: '6px 10px', fontSize: 11 }
                      : { padding: '6px 10px', fontSize: 11, background: 'linear-gradient(180deg, #ffffff 0%, #e8f1fa 100%)', borderColor: '#0a4e97', color: '#0a356d' }}>
                    <Icon size={12} />{label}
                  </button>
                );
              })}
              <button onClick={() => setMode('eraser')}
                className="about-arcade-btn"
                style={mode === 'eraser'
                  ? { padding: '6px 10px', fontSize: 11, background: 'linear-gradient(180deg, #cc5050 0%, #a74040 100%)', borderColor: '#7a2d2d', color: '#fff' }
                  : { padding: '6px 10px', fontSize: 11, background: 'linear-gradient(180deg, #ffffff 0%, #e8f1fa 100%)', borderColor: '#0a4e97', color: '#0a356d' }}>
                <Eraser size={12} />{t.eraser}
              </button>
              <button onClick={undo} disabled={historyIndex < 0}
                className="about-arcade-btn disabled:opacity-30 disabled:cursor-not-allowed"
                style={{ padding: '6px 10px', fontSize: 11, background: 'linear-gradient(180deg, #ffffff 0%, #e8f1fa 100%)', borderColor: '#0a4e97', color: '#0a356d' }}>
                <Undo2 size={12} />{t.undo}
              </button>
              <button onClick={() => { setSourceUrl(''); fileInputRef.current?.click(); }}
                className="about-arcade-btn ml-auto"
                style={{ padding: '6px 10px', fontSize: 11, background: 'linear-gradient(180deg, #ffffff 0%, #e8e8e8 100%)', borderColor: '#888', color: '#0a356d' }}>
                <RotateCcw size={12} />{t.reset}
              </button>
            </div>

            <div className="flex flex-col lg:flex-row gap-3 sm:gap-4">
              {/* Source image */}
              <div className="flex-1 flex flex-col gap-1.5 sm:gap-2 min-w-0">
                <div className="min-h-[40px]">
                  <div className="px-3 py-2 rounded-lg text-xs text-center" style={{ background: 'linear-gradient(180deg, #dff0ff 0%, #d5ebff 100%)', border: '1.5px solid #0a4e97', color: '#0a356d', fontWeight: 600 }}>
                    {language === 'zh'
                      ? '💡 圈选T型五官区域（眼睛→鼻子→嘴巴）效果更好'
                      : '💡 Crop T-zone (eyes→nose→mouth) for best results'}
                  </div>
                </div>
                <div className="min-h-[20px]">
                  <p className="text-[10px] sm:text-xs" style={{ color: '#456' }}>
                    {isDrawingLasso ? t.lassoDraw
                      : mode === 'eraser' ? (language === 'zh' ? '在右侧预览图使用橡皮擦' : 'Use eraser on preview')
                      : tool === 'lasso' ? t.lassoHint
                      : t.cropHint}
                  </p>
                </div>
                <div className="relative overflow-hidden rounded-lg select-none" style={{ background: '#fff', border: '2px solid #0a4e97', maxHeight: '40vh', display: 'flex', justifyContent: 'center', alignItems: 'center' }}
                  onPointerMove={(e) => { if (tool === 'lasso') onLassoMove(e); }}
                  onPointerUp={() => { if (tool === 'lasso') onLassoUp(); }}
                >
                  <div className="relative inline-block shrink-0">
                    <img ref={imgRef} src={sourceUrl} alt="source" className="block max-w-full max-h-[40vh] object-contain" draggable={false} style={tool === 'lasso' ? { pointerEvents: 'none' } : undefined} />
                    {tool === 'lasso' && (
                      <div className="absolute inset-0" style={{ touchAction: 'none' }}
                        onPointerDown={onLassoDown}
                        onPointerMove={onLassoMove}
                        onPointerUp={onLassoUp}
                      />
                    )}
                    {renderLassoOverlay()}
                    {renderCropOverlay()}
                  </div>
                  
                </div>
              </div>

              {/* Preview & Controls */}
              <div className="flex-1 flex flex-col gap-2 sm:gap-3 min-w-0">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold" style={{ color: '#0a356d' }}>{t.preview}</p>
                  {mode === 'eraser' && <p className="text-[10px] font-bold" style={{ color: '#a74040' }}>{language === 'zh' ? '橡皮擦模式' : 'Eraser Mode'}</p>}
                </div>

                {/* Preview with panda head bottom */}
                <div className="relative rounded-lg overflow-hidden flex items-center justify-center self-center" style={{ backgroundColor: '#FFFFFF', border: '2px solid #0a4e97', width: 280, height: 280 }}>
                  {/* Panda head background */}
                  <img
                    src={PANDA_HEADS[0].src}
                    alt="panda"
                    className="absolute bottom-0 left-1/2 -translate-x-1/2"
                    style={{ width: 240, height: 240, opacity: 0.3, objectFit: 'contain', pointerEvents: 'none' }}
                    onLoad={() => setPandaLoaded(true)}
                  />
                  {/* Processed face on top */}
                  <canvas ref={previewCanvasRef} className="w-full h-full object-contain relative"
                    style={{
                      touchAction: 'none',
                      cursor: mode === 'eraser'
                        ? `url('data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22${Math.min(eraserSize * 2, 64)}%22 height=%22${Math.min(eraserSize * 2, 64)}%22><circle cx=%22${Math.min(eraserSize, 32)}%22 cy=%22${Math.min(eraserSize, 32)}%22 r=%22${Math.min(eraserSize, 32)}%22 fill=%22rgba(239,68,68,0.3)%22 stroke=%22%23EF4444%22 stroke-width=%222%22/></svg>') ${Math.min(eraserSize, 32)} ${Math.min(eraserSize, 32)}, crosshair`
                        : 'default',
                      display: 'block',
                    }}
                    onPointerDown={mode === 'eraser' ? onEraserDown : undefined}
                    onPointerMove={mode === 'eraser' ? onEraserMove : undefined}
                    onPointerUp={mode === 'eraser' ? onEraserUp : undefined}
                  />
                  {(['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se'] as const).map(pos => <div key={pos} style={edgeHandle(pos)} />)}
                </div>

                {/* Controls */}
                {mode === 'eraser' ? (
                  <div>
                    <div className="flex justify-between mb-1"><label className="text-xs font-bold" style={{ color: '#a74040' }}>{t.eraserSize}</label><span className="text-xs font-mono font-bold" style={{ color: '#a74040' }}>{eraserSize}px</span></div>
                    <input type="range" min={5} max={80} step={1} value={eraserSize} onChange={e => setEraserSize(Number(e.target.value))} className="w-full" style={{ accentColor: '#a74040' }} />
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-2 flex-wrap mt-1">
                      <button onClick={() => setFlipH(!flipH)}
                        className="about-arcade-btn"
                        style={flipH
                          ? { padding: '6px 10px', fontSize: 11 }
                          : { padding: '6px 10px', fontSize: 11, background: 'linear-gradient(180deg, #ffffff 0%, #e8f1fa 100%)', borderColor: '#0a4e97', color: '#0a356d' }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20V4m0 0L6 10m6-6l6 6"/></svg>{t.flip}
                      </button>
                    </div>
                    <div>
                      <div className="flex justify-between mb-1"><label className="text-xs font-bold" style={{ color: '#0a356d' }}>{t.contrast}</label><span className="text-xs font-mono font-bold" style={{ color: '#0a356d' }}>{contrast}</span></div>
                      <input type="range" min={-100} max={100} step={1} value={contrast} onChange={e => setContrast(Number(e.target.value))} className="w-full" style={{ accentColor: '#0a4e97' }} />
                    </div>
                    <div>
                      <div className="flex justify-between mb-1"><label className="text-xs font-bold" style={{ color: '#1767c7' }}>{t.strength}</label><span className="text-xs font-mono font-bold" style={{ color: '#1767c7' }}>{strength}</span></div>
                      <input type="range" min={0} max={150} step={1} value={strength} onChange={e => setStrength(Number(e.target.value))} className="w-full" style={{ accentColor: '#1767c7' }} />
                      <p className="text-[10px] mt-0.5" style={{ color: '#456' }}>{t.strengthHint}</p>
                    </div>
                  </>
                )}
              </div>
            </div>

            <canvas ref={processCanvasRef} style={{ display: 'none' }} />
            <canvas ref={maskCanvasRef} style={{ display: 'none' }} />

            {/* Actions */}
            <div className="flex items-center gap-2 sm:gap-3 justify-end pt-2" style={{ borderTop: '1px dashed rgba(10, 78, 151, 0.3)' }}>
              <button onClick={() => { setSourceUrl(''); fileInputRef.current?.click(); }}
                className="about-arcade-btn"
                style={{ padding: '8px 14px', fontSize: 12, background: 'linear-gradient(180deg, #ffffff 0%, #e8e8e8 100%)', borderColor: '#888', color: '#0a356d' }}>
                <RotateCcw size={14} />{t.reset}
              </button>
              <button onClick={handleClose}
                className="about-arcade-btn"
                style={{ padding: '8px 14px', fontSize: 12, background: 'linear-gradient(180deg, #ffffff 0%, #e8e8e8 100%)', borderColor: '#888', color: '#0a356d' }}>
                <X size={14} />{t.cancel}
              </button>
              <button onClick={handleConfirm}
                className="about-arcade-btn"
                style={{ padding: '10px 18px', fontSize: 14, background: 'linear-gradient(180deg, #34d4a1 0%, #10a87a 100%)', borderColor: '#0a6e50', color: '#fff' }}>
                <Check size={16} />{t.confirm}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
