// CalibrateAnchor — 表情对齐工具（DEV-only）
//
// 在预览图上拖拽 anchor box 调整 faceOffset，自动存 localStorage，可一键导出 TS code。
//
// 快捷键：
//   ← → : 上/下一个 panda
//   Shift+← → : 上/下一个 face
//   方向键（鼠标在预览框内）: anchor 1px 平移
//   Shift+方向键: 10px 平移
//   R : 重置当前
//   Ctrl+Z / Ctrl+Shift+Z : 撤销/重做
//   Esc : 返回
//
// Contributed by PandaHead — github.com/jokkibtc/panda

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ALL_PANDAS, ALL_FACES } from '@/data/materials';
import { PandaCanvas } from '@/components/pandacanvas';
import { loadImage } from '@/lib/composeMeme';
import {
  readAnchorOverrides,
  saveAnchorOverride,
  removeAnchorOverride,
  exportToTSCode,
  clearAllAnchorOverrides,
} from '@/lib/anchorOverrides';
import {
  RotateCcw, Copy, Trash2, Download, ArrowLeft, ChevronLeft, ChevronRight,
  HelpCircle, CheckCircle2, Undo2, Redo2,
} from 'lucide-react';
import { toast } from 'sonner';

const FACE_FILL_DEFAULT = 0.95;
const AUTO_SAVE_DEBOUNCE_MS = 400;
const HISTORY_LIMIT = 30;

interface FaceOff {
  x: number;
  y: number;
  w: number;
  h: number;
}

// 350-coord ↔ native pixel ↔ 显示像素 三套坐标，与 composeMeme 同公式
function letterboxParams(NW: number, NH: number) {
  const scale = Math.min(350 / NW, 350 / NH);
  return { scale, padX: (350 - NW * scale) / 2, padY: (350 - NH * scale) / 2 };
}
function offset350ToNative(off: FaceOff, NW: number, NH: number) {
  const { scale, padX, padY } = letterboxParams(NW, NH);
  return { x: (off.x - padX) / scale, y: (off.y - padY) / scale, w: off.w / scale, h: off.h / scale };
}

interface CalibrateAnchorProps {
  onBack: () => void;
}

export function CalibrateAnchor({ onBack }: CalibrateAnchorProps) {
  if (!import.meta.env.DEV) {
    return (
      <div style={{ flex: 1, padding: 32, color: '#888', textAlign: 'center' }}>
        <p>校准工具仅本地 DEV 可用</p>
        <button onClick={onBack} style={{ marginTop: 12, padding: '6px 14px' }}>返回</button>
      </div>
    );
  }
  return <CalibrateAnchorImpl onBack={onBack} />;
}

function CalibrateAnchorImpl({ onBack }: CalibrateAnchorProps) {
  const [pandaIdx, setPandaIdx] = useState(0);
  const [faceIdx, setFaceIdx] = useState(0);
  const panda = ALL_PANDAS[pandaIdx];
  const face = ALL_FACES[faceIdx];

  const [nativeDims, setNativeDims] = useState<{ NW: number; NH: number; bbox: [number, number, number, number] } | null>(null);
  useEffect(() => {
    let cancelled = false;
    setNativeDims(null);
    loadImage(panda.src).then((img) => {
      if (cancelled) return;
      const NW = img.naturalWidth;
      const NH = img.naturalHeight;
      const c = document.createElement('canvas');
      c.width = NW; c.height = NH;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, NW, NH).data;
      let x1 = NW, y1 = NH, x2 = -1, y2 = -1;
      for (let y = 0; y < NH; y++) {
        const rb = y * NW * 4;
        for (let x = 0; x < NW; x++) {
          if (data[rb + x * 4 + 3] > 50) {
            if (x < x1) x1 = x;
            if (y < y1) y1 = y;
            if (x > x2) x2 = x;
            if (y > y2) y2 = y;
          }
        }
      }
      const bbox: [number, number, number, number] = x2 < 0 ? [0, 0, NW, NH] : [x1, y1, x2 + 1, y2 + 1];
      setNativeDims({ NW, NH, bbox });
    });
    return () => { cancelled = true; };
  }, [panda.src]);

  // 当前 anchor + faceFill state（首次从 localStorage 读）
  const [offset, setOffset] = useState<FaceOff>(() => readAnchorOverrides()[panda.id]?.faceOffset ?? panda.faceOffset);
  const [faceFill, setFaceFill] = useState<number>(() => readAnchorOverrides()[panda.id]?.faceFill ?? FACE_FILL_DEFAULT);
  // captionOffset: px (350-coord), 正数 = caption 往上挪贴近 panda 内容底部
  const [captionOffset, setCaptionOffset] = useState<number>(() => readAnchorOverrides()[panda.id]?.captionOffset ?? 0);
  const [previewDispW, setPreviewDispW] = useState(0);
  const [previewDispH, setPreviewDispH] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);
  const [savedTick, setSavedTick] = useState(0); // 触发"已保存"指示动画
  const [overrideMapVer, setOverrideMapVer] = useState(0); // 触发左侧列表重渲染

  // 撤销/重做栈
  const historyRef = useRef<{ stack: { off: FaceOff; fill: number }[]; idx: number }>({ stack: [], idx: -1 });

  // panda 切换：reset state + 重置历史栈
  useEffect(() => {
    const ov = readAnchorOverrides()[panda.id];
    const off = ov?.faceOffset ?? panda.faceOffset;
    const fill = ov?.faceFill ?? FACE_FILL_DEFAULT;
    const capOff = ov?.captionOffset ?? 0;
    setOffset(off);
    setFaceFill(fill);
    setCaptionOffset(capOff);
    historyRef.current = { stack: [{ off: { ...off }, fill }], idx: 0 };
  }, [panda.id, panda.faceOffset]);

  // 把当前 state push 到撤销栈（拖完 mouseup / 数字框 blur / 滑块停 时调）
  const pushHistory = useCallback((off: FaceOff, fill: number) => {
    const h = historyRef.current;
    // 截断 idx 之后的（用户撤销中又改了）
    h.stack = h.stack.slice(0, h.idx + 1);
    const last = h.stack[h.stack.length - 1];
    if (last && last.off.x === off.x && last.off.y === off.y && last.off.w === off.w && last.off.h === off.h && last.fill === fill) return;
    h.stack.push({ off: { ...off }, fill });
    if (h.stack.length > HISTORY_LIMIT) h.stack.shift();
    h.idx = h.stack.length - 1;
  }, []);

  const undo = useCallback(() => {
    const h = historyRef.current;
    if (h.idx <= 0) return;
    h.idx--;
    const s = h.stack[h.idx];
    setOffset({ ...s.off });
    setFaceFill(s.fill);
  }, []);
  const redo = useCallback(() => {
    const h = historyRef.current;
    if (h.idx >= h.stack.length - 1) return;
    h.idx++;
    const s = h.stack[h.idx];
    setOffset({ ...s.off });
    setFaceFill(s.fill);
  }, []);

  // 自动保存 — debounce 400ms 后写 localStorage
  const saveTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveAnchorOverride(panda.id, {
        faceOffset: offset,
        faceFill,
        captionOffset: captionOffset === 0 ? undefined : captionOffset,
      });
      setSavedTick((n) => n + 1);
      setOverrideMapVer((v) => v + 1);
    }, AUTO_SAVE_DEBOUNCE_MS);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [panda.id, offset.x, offset.y, offset.w, offset.h, faceFill, captionOffset]); // eslint-disable-line react-hooks/exhaustive-deps

  const previewWrapRef = useRef<HTMLDivElement>(null);
  const onPreviewRendered = useCallback(() => {
    const img = previewWrapRef.current?.querySelector('img');
    if (img) {
      setPreviewDispW(img.clientWidth);
      setPreviewDispH(img.clientHeight);
    }
  }, []);

  const overlay = useMemo(() => {
    if (!nativeDims || !previewDispW || !previewDispH) return null;
    const { NW, NH, bbox } = nativeDims;
    const [bx1, by1, bx2, by2] = bbox;
    const BW = bx2 - bx1;
    const BH = by2 - by1;
    const displayScale = Math.min(previewDispW / BW, previewDispH / BH);
    const nat = offset350ToNative(offset, NW, NH);
    return {
      x: (nat.x - bx1) * displayScale,
      y: (nat.y - by1) * displayScale,
      w: nat.w * displayScale,
      h: nat.h * displayScale,
      displayScale,
    };
  }, [nativeDims, previewDispW, previewDispH, offset]);

  // 拖拽 + 缩放
  const dragRef = useRef<{ mode: 'move' | 'nw' | 'ne' | 'sw' | 'se'; startX: number; startY: number; startOffset: FaceOff } | null>(null);
  const onDragStart = (mode: 'move' | 'nw' | 'ne' | 'sw' | 'se') => (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const p = 'touches' in e ? e.touches[0] : e;
    dragRef.current = { mode, startX: p.clientX, startY: p.clientY, startOffset: { ...offset } };
  };

  useEffect(() => {
    if (!nativeDims || !overlay) return;
    const onMove = (e: MouseEvent | TouchEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const p = 'touches' in e ? e.touches[0] : e;
      if (!p) return;
      const dx = p.clientX - d.startX;
      const dy = p.clientY - d.startY;
      const ndx = dx / overlay.displayScale;
      const ndy = dy / overlay.displayScale;
      const { NW, NH } = nativeDims;
      const { scale } = letterboxParams(NW, NH);
      const ox = ndx * scale;
      const oy = ndy * scale;
      const so = d.startOffset;
      const next = { ...so };
      switch (d.mode) {
        case 'move': next.x = Math.round(so.x + ox); next.y = Math.round(so.y + oy); break;
        case 'se': next.w = Math.max(10, Math.round(so.w + ox)); next.h = Math.max(10, Math.round(so.h + oy)); break;
        case 'sw': next.x = Math.round(so.x + ox); next.w = Math.max(10, Math.round(so.w - ox)); next.h = Math.max(10, Math.round(so.h + oy)); break;
        case 'ne': next.y = Math.round(so.y + oy); next.w = Math.max(10, Math.round(so.w + ox)); next.h = Math.max(10, Math.round(so.h - oy)); break;
        case 'nw': next.x = Math.round(so.x + ox); next.y = Math.round(so.y + oy); next.w = Math.max(10, Math.round(so.w - ox)); next.h = Math.max(10, Math.round(so.h - oy)); break;
      }
      setOffset(next);
    };
    const onUp = () => {
      if (dragRef.current) {
        pushHistory(offset, faceFill);
      }
      dragRef.current = null;
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onUp);
    };
  }, [nativeDims, overlay, offset, faceFill, pushHistory]);

  // 操作
  const onResetCurrent = useCallback(() => {
    removeAnchorOverride(panda.id);
    setOffset(panda.faceOffset);
    setFaceFill(FACE_FILL_DEFAULT);
    setCaptionOffset(0);
    historyRef.current = { stack: [{ off: { ...panda.faceOffset }, fill: FACE_FILL_DEFAULT }], idx: 0 };
    setOverrideMapVer((v) => v + 1);
    toast.info(`已重置 ${panda.id}`);
  }, [panda.id, panda.faceOffset]);

  const onExport = useCallback(async () => {
    const code = exportToTSCode();
    try {
      await navigator.clipboard.writeText(code);
      toast.success(`已复制 ${Object.keys(readAnchorOverrides()).length} 个 override 到剪贴板`);
    } catch {
      toast.error('复制失败，看 console');
      // eslint-disable-next-line no-console
      console.log(code);
    }
  }, []);

  const onDownload = useCallback(() => {
    const code = exportToTSCode();
    const blob = new Blob([code], { type: 'text/typescript' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `panda-manual-overrides-${Date.now()}.ts`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const onClearAll = useCallback(() => {
    if (!confirm('确认清空所有 override？此操作不可逆')) return;
    clearAllAnchorOverrides();
    setOffset(panda.faceOffset);
    setFaceFill(FACE_FILL_DEFAULT);
    setCaptionOffset(0);
    setOverrideMapVer((v) => v + 1);
    toast.info('已清空所有 override');
  }, [panda.faceOffset]);

  // 全局键盘快捷键
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      // 撤销/重做
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault(); redo(); return;
      }
      // Esc 返回
      if (e.key === 'Escape') { onBack(); return; }
      // R 重置
      if (e.key === 'r' || e.key === 'R') { onResetCurrent(); return; }
      // 方向键
      const step = e.shiftKey ? 10 : 1;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (e.altKey) setPandaIdx((i) => (i - 1 + ALL_PANDAS.length) % ALL_PANDAS.length);
        else setOffset((o) => ({ ...o, x: o.x - step }));
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (e.altKey) setPandaIdx((i) => (i + 1) % ALL_PANDAS.length);
        else setOffset((o) => ({ ...o, x: o.x + step }));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setOffset((o) => ({ ...o, y: o.y - step }));
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setOffset((o) => ({ ...o, y: o.y + step }));
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, onBack, onResetCurrent]);

  // 方向键 nudge 完后 push history（debounce）
  const nudgeTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current);
    nudgeTimerRef.current = window.setTimeout(() => {
      pushHistory(offset, faceFill);
    }, 600);
    return () => { if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current); };
  }, [offset, faceFill, pushHistory]);

  // 派生
  const overrideCount = useMemo(() => Object.keys(readAnchorOverrides()).length, [overrideMapVer]); // eslint-disable-line react-hooks/exhaustive-deps
  const hasOverride = useMemo(() => Boolean(readAnchorOverrides()[panda.id]), [overrideMapVer, panda.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const overrideMap = useMemo(() => readAnchorOverrides(), [overrideMapVer]); // eslint-disable-line react-hooks/exhaustive-deps

  // 自动保存指示淡出
  const [showSavedBadge, setShowSavedBadge] = useState(false);
  useEffect(() => {
    if (savedTick === 0) return;
    setShowSavedBadge(true);
    const t = window.setTimeout(() => setShowSavedBadge(false), 1500);
    return () => clearTimeout(t);
  }, [savedTick]);

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px 60px', background: '#1a1a1a', color: '#f0f0f0' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        {/* 顶栏 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <button onClick={onBack} style={btnStyle('ghost')}><ArrowLeft size={14} /> 返回</button>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>表情对齐工具</h2>
          <span style={{ fontSize: 12, color: '#888' }}>已校准 {overrideCount} / {ALL_PANDAS.length}</span>
          {/* 自动保存指示 */}
          <span
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              fontSize: 11, color: showSavedBadge ? '#00CC66' : '#555',
              transition: 'color 0.3s ease-out',
            }}
          >
            <CheckCircle2 size={12} /> {showSavedBadge ? '已自动保存' : '编辑即自动保存'}
          </span>
          <div style={{ flex: 1 }} />
          <button onClick={() => setHelpOpen((v) => !v)} style={btnStyle(helpOpen ? 'accent' : 'ghost')}><HelpCircle size={14} /> 帮助</button>
          <button onClick={undo} style={btnStyle('ghost')} title="撤销 (Ctrl+Z)"><Undo2 size={14} /></button>
          <button onClick={redo} style={btnStyle('ghost')} title="重做 (Ctrl+Shift+Z)"><Redo2 size={14} /></button>
          <button onClick={onExport} style={btnStyle('primary')}><Copy size={14} /> 导出 TS code</button>
          <button onClick={onDownload} style={btnStyle('ghost')}><Download size={14} /> 下载 .ts</button>
          <button onClick={onClearAll} style={btnStyle('danger')}><Trash2 size={14} /> 清空全部</button>
        </div>

        {/* 帮助面板（折叠） */}
        {helpOpen && (
          <div style={helpPanelStyle}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: '#fff' }}>使用说明</div>
            <ol style={{ margin: '0 0 8px', paddingLeft: 20, lineHeight: 1.7, fontSize: 12 }}>
              <li>左侧选 panda（已校准的右边有 ● 橙点）</li>
              <li>预览图上 <b>拖橙色椭圆</b> 移动 face 锚点；<b>拉 4 角</b> 缩放</li>
              <li>右侧 <b>数值框</b> 精调 x/y/w/h；<b>faceFill</b> slider 调五官饱满度</li>
              <li>所有改动 <b>自动保存</b> 到 localStorage（仅本机 <b>本端口</b> 同 origin 内生效）</li>
              <li>调好一批后点 <b>"导出 TS code"</b>，粘贴到 <code style={kbd}>src/data/panda-manual-overrides.ts</code> 永久生效</li>
            </ol>
            <div style={{ marginTop: 8, padding: '8px 10px', background: 'rgba(255,200,0,0.08)', border: '1px solid rgba(255,200,0,0.3)', borderRadius: 4, fontSize: 11, color: '#FFC850' }}>
              ⚠️ <b>跨端口不同步</b>：localStorage 按 origin 隔离，<code style={kbd}>localhost:5173</code> 和 <code style={kbd}>localhost:3001</code> 是不同 origin（浏览器机制）。同 origin（同端口）内 QuickMode/Collection 切过去会立即看到校准值。永久全用户生效请走"导出 TS code"路径。
            </div>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4, color: '#fff' }}>键盘快捷键</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto 1fr', gap: '4px 16px', fontSize: 11 }}>
              <span style={kbd}>← →</span><span>anchor 平移 1px</span>
              <span style={kbd}>Shift+← →</span><span>anchor 平移 10px</span>
              <span style={kbd}>↑ ↓</span><span>anchor 上下平移</span>
              <span style={kbd}>Alt+← →</span><span>切换上一个/下一个 panda</span>
              <span style={kbd}>R</span><span>重置当前 panda</span>
              <span style={kbd}>Ctrl+Z</span><span>撤销</span>
              <span style={kbd}>Ctrl+Shift+Z</span><span>重做</span>
              <span style={kbd}>Esc</span><span>返回</span>
            </div>
          </div>
        )}

        {/* 主区: 左 panda 列表，中 预览+anchor，右 控制面板 */}
        <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr 280px', gap: 16, alignItems: 'flex-start', marginTop: 14 }}>
          {/* Panda 列表 */}
          <div style={{ background: '#222', borderRadius: 8, padding: 8, maxHeight: 600, overflowY: 'auto' }}>
            <div style={{ fontSize: 11, color: '#888', padding: '4px 6px 8px' }}>panda（{ALL_PANDAS.length} 个）</div>
            {ALL_PANDAS.map((p, i) => {
              const has = Boolean(overrideMap[p.id]);
              return (
                <button
                  key={p.id}
                  onClick={() => setPandaIdx(i)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '6px 8px',
                    background: i === pandaIdx ? 'rgba(255,94,0,0.18)' : 'transparent',
                    border: i === pandaIdx ? '1px solid #FF5E00' : '1px solid transparent',
                    borderRadius: 6, color: '#ddd', cursor: 'pointer', fontSize: 11, fontFamily: 'inherit',
                    marginBottom: 2,
                  }}
                >
                  <img src={p.src} alt={p.id} width={24} height={24} style={{ objectFit: 'contain', background: '#fff', borderRadius: 3 }} />
                  <span style={{ flex: 1, textAlign: 'left', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.id}</span>
                  {has && <span style={{ color: '#FF5E00', fontSize: 10 }}>●</span>}
                </button>
              );
            })}
          </div>

          {/* 预览 + anchor overlay */}
          <div ref={previewWrapRef} style={{ position: 'relative', background: '#fff', borderRadius: 8, padding: 12, display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
            <div style={{ position: 'relative', display: 'inline-block' }}>
              <PandaCanvas
                pandaSrc={panda.src}
                faceSrc={face.src}
                faceOffset={offset}
                faceFill={faceFill}
                size={1024}
                style={{ display: 'block', maxWidth: 600, maxHeight: 600 }}
                onRendered={onPreviewRendered}
              />
              {overlay && (
                <div
                  style={{
                    position: 'absolute',
                    left: overlay.x, top: overlay.y, width: overlay.w, height: overlay.h,
                    border: '2px dashed #FF5E00', borderRadius: '50%',
                    cursor: 'move', boxSizing: 'border-box', pointerEvents: 'auto',
                  }}
                  onMouseDown={onDragStart('move')}
                  onTouchStart={onDragStart('move')}
                >
                  {(['nw', 'ne', 'sw', 'se'] as const).map((corner) => (
                    <div
                      key={corner}
                      onMouseDown={onDragStart(corner)}
                      onTouchStart={onDragStart(corner)}
                      style={{
                        position: 'absolute',
                        width: 12, height: 12, background: '#FF5E00', border: '1px solid #fff',
                        borderRadius: 2, cursor: `${corner}-resize`,
                        top: corner.startsWith('n') ? -6 : 'auto',
                        bottom: corner.startsWith('s') ? -6 : 'auto',
                        left: corner.endsWith('w') ? -6 : 'auto',
                        right: corner.endsWith('e') ? -6 : 'auto',
                      }}
                    />
                  ))}
                  <div style={{
                    position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
                    width: 8, height: 8, background: '#FF5E00', borderRadius: '50%', pointerEvents: 'none',
                  }} />
                </div>
              )}
            </div>
          </div>

          {/* 右侧控制面板 */}
          <div style={{ background: '#222', borderRadius: 8, padding: 14, fontSize: 12 }}>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, color: '#fff' }}>
                {panda.labelCn} <span style={{ color: '#888', fontWeight: 400 }}>{panda.id}</span>
              </div>
              {nativeDims && (
                <div style={{ color: '#888', fontSize: 11 }}>native {nativeDims.NW}×{nativeDims.NH} · bbox {nativeDims.bbox.join(',')}</div>
              )}
              {hasOverride ? (
                <div style={{ color: '#FF5E00', fontSize: 11, marginTop: 4 }}>● 已校准（自动保存到 localStorage）</div>
              ) : (
                <div style={{ color: '#666', fontSize: 11, marginTop: 4 }}>○ 未校准</div>
              )}
            </div>

            {/* face 选择 */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ color: '#888', marginBottom: 4 }}>测试 face（{ALL_FACES.length} 选）</div>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <button onClick={() => setFaceIdx((i) => (i - 1 + ALL_FACES.length) % ALL_FACES.length)} style={iconBtn}><ChevronLeft size={14} /></button>
                <img src={face.src} alt={face.id} width={48} height={48} style={{ objectFit: 'contain', background: '#fff', borderRadius: 4 }} />
                <button onClick={() => setFaceIdx((i) => (i + 1) % ALL_FACES.length)} style={iconBtn}><ChevronRight size={14} /></button>
                <span style={{ fontSize: 11, color: '#888' }}>{face.id}</span>
              </div>
            </div>

            {/* 数值输入 */}
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 6, alignItems: 'center', marginBottom: 12 }}>
              {(['x', 'y', 'w', 'h'] as const).map((k) => (
                <RowInput key={k} label={k} value={offset[k]} onChange={(v) => setOffset({ ...offset, [k]: v })} onBlur={() => pushHistory(offset, faceFill)} />
              ))}
            </div>

            {/* faceFill slider */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: '#888' }}>faceFill 五官饱满度</span>
                <span style={{ color: '#FF5E00', fontVariantNumeric: 'tabular-nums' }}>{faceFill.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min={0.7} max={1.1} step={0.01}
                value={faceFill}
                onChange={(e) => setFaceFill(Number(e.target.value))}
                onMouseUp={() => pushHistory(offset, faceFill)}
                onTouchEnd={() => pushHistory(offset, faceFill)}
                style={{ width: '100%' }}
              />
            </div>

            {/* captionOffset slider — 解决 wide-shape panda 底部到 caption 距离感觉太远 */}
            <div style={{ marginBottom: 14, padding: 10, background: 'rgba(255,94,0,0.07)', border: '1px dashed #FF5E00', borderRadius: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: '#ccc', fontWeight: 600 }}>📐 caption 距离</span>
                <span style={{ color: '#FF5E00', fontVariantNumeric: 'tabular-nums' }}>{captionOffset >= 0 ? '+' : ''}{captionOffset}px</span>
              </div>
              <input
                type="range"
                min={-30} max={80} step={1}
                value={captionOffset}
                onChange={(e) => setCaptionOffset(Number(e.target.value))}
                style={{ width: '100%' }}
              />
              <div style={{ fontSize: 10, color: '#888', marginTop: 4, lineHeight: 1.4 }}>
                正数 = caption 往上挪贴近 panda 底部; 负数 = 拉远。<br />
                用于修不同 shell 透明 padding 不均, caption 距离不一致的 case。
              </div>
            </div>

            {/* 操作按钮 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <button onClick={onResetCurrent} style={btnStyle('ghost')}><RotateCcw size={14} /> 重置当前 (R)</button>
              <button onClick={() => setPandaIdx((i) => (i + 1) % ALL_PANDAS.length)} style={btnStyle('accent')}>
                下一只 (Alt+→) <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  width: 28, height: 28, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  background: '#2a2a2a', border: '1px solid #3a3a3a', borderRadius: 4, color: '#ddd', cursor: 'pointer',
};
const kbd: React.CSSProperties = {
  display: 'inline-block', padding: '1px 6px', background: '#2a2a2a',
  border: '1px solid #3a3a3a', borderRadius: 3, fontFamily: 'monospace', fontSize: 11, color: '#FF5E00',
};
const helpPanelStyle: React.CSSProperties = {
  background: '#222', borderRadius: 8, padding: '12px 16px', border: '1px solid #333',
  marginBottom: 0,
};

function btnStyle(variant: 'primary' | 'ghost' | 'accent' | 'danger'): React.CSSProperties {
  const base: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 500,
    border: '1px solid', cursor: 'pointer', fontFamily: 'inherit',
  };
  switch (variant) {
    case 'primary': return { ...base, background: '#FF5E00', borderColor: '#FF5E00', color: '#fff' };
    case 'accent': return { ...base, background: 'rgba(0,204,102,0.15)', borderColor: '#00CC66', color: '#00CC66' };
    case 'danger': return { ...base, background: 'rgba(220,50,50,0.15)', borderColor: '#dc3232', color: '#dc3232' };
    default: return { ...base, background: '#2a2a2a', borderColor: '#3a3a3a', color: '#ddd' };
  }
}

function RowInput({ label, value, onChange, onBlur }: { label: string; value: number; onChange: (v: number) => void; onBlur?: () => void }) {
  return (
    <>
      <label style={{ color: '#888', fontFamily: 'monospace', textTransform: 'uppercase' }}>{label}</label>
      <input
        type="number"
        value={value}
        onChange={(e) => {
          const v = parseInt(e.target.value, 10);
          if (!Number.isNaN(v)) onChange(v);
        }}
        onBlur={onBlur}
        style={{
          background: '#1a1a1a', border: '1px solid #3a3a3a', borderRadius: 4,
          padding: '4px 8px', color: '#ddd', fontSize: 12, fontFamily: 'monospace',
          width: '100%',
        }}
      />
    </>
  );
}
