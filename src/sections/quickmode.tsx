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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMeme } from '@/context/memecontext';
import { useIsMobile } from '@/hooks/usemediaquery';
import { ALL_PANDAS as PANDA_HEADS, ALL_FACES as FACES, getLivePandaFaceOffset, getLiveCaptionOffset, getShellLayering, type Material } from '@/data/materials';
import { pickRandomText, RANDOM_TEXTS_ZH, RANDOM_TEXTS_EN, ALL_MODES, MODE_LABELS, nextMode, type Mode } from '@/data/quickModeTexts';
import { makeFavKey } from '@/hooks/useQuickFavs';
import { useLiveAnchor } from '@/hooks/useLiveAnchor';
import { copyImageToClipboard, downloadImage } from '@/lib/exportImage';
import { PandaCanvas } from '@/components/pandacanvas';
import { PhotoCropModal } from '@/components/photocropmodal';
import { SmartExtractModal } from '@/components/smartextractmodal';
import { calcEditorFaceLayout, composeMeme, getContentBbox, getEditorPandaBox } from '@/lib/composeMeme';
import { Camera } from 'lucide-react';
import {
  Sparkles, Copy, Download, Heart, Wand2, ArrowRight, Type,
  RotateCcw, FlipHorizontal, Check, X, RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import './quickmode.css';

const FONT_OPTIONS = [
  { id: 'default', labelKey: 'quickFontDefault' as const, stack: '"Noto Sans SC", system-ui, sans-serif' },
  { id: 'serif',   labelKey: 'quickFontSerif'   as const, stack: '"Songti SC", "STSong", "SimSun", serif' },
  { id: 'mono',    labelKey: 'quickFontMono'    as const, stack: 'ui-monospace, SFMono-Regular, "Noto Sans SC", monospace' },
];

// v2: 删掉 'both' 双语模式 — 默认跟 state.language, 中文 UI 也可手动切 EN
const TEXT_LANG_OPTIONS = [
  { id: 'zh' as const, label: '中' },
  { id: 'en' as const, label: 'EN' },
];

interface QuickModeProps {
  onOpenEditor: () => void;
}

export function QuickMode({ onOpenEditor }: QuickModeProps) {
  const { state, dispatch, t, generateId, draftSlots, saveDraftWithState, clearDraft, renameDraft } = useMeme();
  const lang = state.language;
  const isMobile = useIsMobile();
  // mobile-only: panda/face picker bottom sheets
  const [pandaSheetOpen, setPandaSheetOpen] = useState(false);
  const [faceSheetOpen, setFaceSheetOpen] = useState(false);
  // DEV: 校准工具改 anchor 时触发 re-render，让预览实时显示新值
  useLiveAnchor();

  const [pandaId, setPandaId] = useState<string>(() => PANDA_HEADS[0]?.id ?? '');
  const [faceId, setFaceId] = useState<string>(() => FACES[0]?.id ?? '');
  const [text, setText] = useState<string>(
    () => (lang === 'zh' ? RANDOM_TEXTS_ZH : RANDOM_TEXTS_EN)[0] ?? ''
  );
  const [fontKey, setFontKey] = useState<string>('default');
  // v2: textLang 默认跟 UI 语言, 取消 'both'. 用户手动切的话 localStorage 持久 (但忽略老 'both' 值)
  const [textLang, setTextLang] = useState<'zh' | 'en'>(() => {
    try {
      const stored = localStorage.getItem('pmw-quick-textlang');
      if (stored === 'zh' || stored === 'en') return stored;
    } catch { /* ignore */ }
    return lang;
  });
  // v3: 模式 cycle 按钮 (操作面板里, 紧贴一键随机生图)
  // 老 mode 值 ('daily'/'scold'/'chill'/'ct') 不在新 4 模式里, 走兜底 'all'
  const [mode, setMode] = useState<Mode | 'all'>(() => {
    try {
      const stored = localStorage.getItem('pmw-quick-mode');
      if (stored === 'all' || (ALL_MODES as string[]).includes(stored ?? '')) return stored as Mode | 'all';
    } catch { /* ignore */ }
    return 'all';
  });
  // cycleKey 每次点击 ++, 用作 cycle 角标的 React key, 强制 remount 触发 spin 动画
  const [cycleKey, setCycleKey] = useState(0);
  const cycleMode = useCallback(() => {
    setMode((cur) => {
      const next = nextMode(cur);
      // 切 mode 同时 reroll 文字 (imperative, 比 useEffect 可靠)
      setTextSynced((curText) => pickRandomText(textLang, next === 'all' ? 'all' : next as Mode, curText));
      return next;
    });
    setCycleKey((k) => k + 1);
  }, [textLang]);
  // 切 textLang 时 reroll 文字 (imperative, 跟按钮 onClick 同步)
  const handleSetTextLang = useCallback((nextLang: 'zh' | 'en') => {
    setTextLang(nextLang);
    setTextSynced((curText) => pickRandomText(nextLang, mode, curText));
  }, [mode]);

  // 顶栏 UI 语言切换 (state.language) → textLang 跟着切 + 文字 reroll 成对应语言
  // skip 首次 mount 避免抢初始 text state
  const isFirstUiLangSync = useRef(true);
  useEffect(() => {
    if (isFirstUiLangSync.current) {
      isFirstUiLangSync.current = false;
      return;
    }
    setTextLang(state.language);
    setTextSynced((cur) => pickRandomText(state.language, mode, cur));
  }, [state.language]);
  const [faceRotation, setFaceRotation] = useState(0);
  const [faceFlipX, setFaceFlipX] = useState(false);
  const [customFaceModalOpen, setCustomFaceModalOpen] = useState(false);
  const [smartModalOpen, setSmartModalOpen] = useState(false);
  const [customFace, setCustomFace] = useState<Material | null>(null);
  // 注意: 之前用 useDeferredValue 防滚轮拖 rotation 频闪
  // 但发现 random combo 时 deferred 滞后会让 PandaCanvas 双渲染 → 双 compose → 双慢
  // 现在 composeMeme 已加 LRU 缓存 + 异步 toBlob, drag 也不会卡, 不再需要 deferred
  // PandaCanvas 内部用 reqRef 中断陈旧请求, drag 期间也只显示最新结果
  const [namePopoverOpen, setNamePopoverOpen] = useState(false);
  const [pendingFavName, setPendingFavName] = useState('');

  useEffect(() => {
    try { localStorage.setItem('pmw-quick-textlang', textLang); } catch { /* ignore */ }
  }, [textLang]);
  useEffect(() => {
    try { localStorage.setItem('pmw-quick-mode', mode); } catch { /* ignore */ }
  }, [mode]);

  // 性能 v3: requestIdleCallback 分批 HTTP fetch 预热 (不主动 decode).
  // 之前主动 img.decode() 在 mobile 上把 202 张 PNG 同时 GPU decode → RGBA 累计 ~400 MB →
  // iPhone Chrome iOS / Safari WebView 内存预算 (~500 MB-1.5 GB) 被打爆 → 渲染进程 crash →
  // "无法打开此网页" 错误页. mobile 完全跳过预热, desktop 保留但只 HTTP cache 不强制 decode.
  // 这跟 "修改前可以正常进入" 完全 match — Phase 2 默认 'editor' 不挂 QuickMode → 不跑预热,
  // Phase 2.5 默认改 'quick' 后预热立刻跑 → OOM.
  useEffect(() => {
    if (isMobile) return; // mobile 完全跳过预热 — random 按需 load 单张 50-150ms 可接受
    const queue: Array<{ src: string }> = [...PANDA_HEADS, ...FACES];
    let cancelled = false;
    const processChunk = (deadline: IdleDeadline) => {
      while (!cancelled && queue.length > 0 && deadline.timeRemaining() > 2) {
        const item = queue.shift()!;
        const img = new Image();
        img.decoding = 'async';
        img.src = item.src;
        // desktop 仍主动 decode — 16GB RAM 不 OOM, 保 random 冷路径 ~10ms
        img.decode().catch(() => { /* 失败不阻断 */ });
      }
      if (!cancelled && queue.length > 0) {
        requestIdleCallback(processChunk, { timeout: 2000 });
      }
    };
    // 兜底: 浏览器不支持 requestIdleCallback (Safari <= 16)
    const ric: (cb: (d: IdleDeadline) => void, opts?: { timeout: number }) => number =
      typeof window.requestIdleCallback === 'function'
        ? window.requestIdleCallback
        : (cb) => window.setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 50 } as IdleDeadline), 100) as unknown as number;
    const handle = ric(processChunk, { timeout: 2000 });
    return () => {
      cancelled = true;
      if (typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(handle);
    };
  }, [isMobile]);

  const previewRef = useRef<HTMLDivElement>(null);
  const previewWrapRef = useRef<HTMLDivElement>(null);

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
  // 心是否亮 = 同 favKey 派生的 draftSlot 是否存在 (Collection / 编辑器本地草稿都看的同一个池)
  const favSlotId = `quick-${favKey}`;
  const isFavored = useMemo(() => draftSlots.some(s => s.id === favSlotId), [draftSlots, favSlotId]);

  // -------- actions --------

  const onRandomText = useCallback(() => {
    setTextSynced((cur) => pickRandomText(textLang, mode, cur));
  }, [textLang, mode]);

  // 视觉同步 v3: 只有 onRandomize (一键随机, panda+face+text 一起换) 走 lagging,
  // 其他场景 (打字 / Reroll / 切语言 / 切模式 / 切 panda picker / 切 face picker) 都走 immediate.
  // → displayedText 跟 displayCaptionOffset 平时同步 text/panda, onRandomize 触发后等 onRendered 一起切.
  const [displayedText, setDisplayedText] = useState(text);
  const [displayCaptionOffset, setDisplayCaptionOffset] = useState(() => getLiveCaptionOffset(panda));

  // 文字 immediate setter — 给所有"只动文字不动图"的场景用 (打字 / Reroll / 切语言 / 切模式)
  const setTextSynced = useCallback((v: string | ((cur: string) => string)) => {
    if (typeof v === 'function') {
      setText((cur) => {
        const next = v(cur);
        setDisplayedText(next);
        return next;
      });
    } else {
      setText(v);
      setDisplayedText(v);
    }
  }, []);

  const onRandomize = useCallback(() => {
    const otherPandas = PANDA_HEADS.filter((p) => p.id !== pandaId);
    const otherFaces = FACES.filter((f) => f.id !== faceId);
    const np = otherPandas.length ? otherPandas : PANDA_HEADS;
    const nf = otherFaces.length ? otherFaces : FACES;
    const newPanda = np[Math.floor(Math.random() * np.length)];
    const newFace = nf[Math.floor(Math.random() * nf.length)];
    // 一键随机生图: 文字跟随当前 mode (mode 自己不切换 — 用户点 Mode 角标才切)
    const newText = pickRandomText(textLang, mode, text);

    // 不再 await 预合成 → 点击瞬间响应, 不卡 ~100-200ms
    // panda/face/text 都新, displayed* 由 onRendered 一起同步
    setPandaId(newPanda.id);
    setFaceId(newFace.id);
    setText(newText);
    setFaceRotation(0);
    setFaceFlipX(false);
  }, [pandaId, faceId, textLang, mode, text]);

  const onResetTransform = useCallback(() => {
    setFaceRotation(0);
    setFaceFlipX(false);
  }, []);

  const onFlipH = useCallback(() => setFaceFlipX((f) => !f), []);

  // 用 composeMeme bbox-cropped 合成 + 临时 DOM 节点 → 复制/下载得到紧凑的图
  // 之前直接 captureNode(previewRef) = 拍 .quickmode-preview (400x480 含白边/留白) 太大
  // 现在拍一个临时构造的 tight 节点 (跟 Collection 批量打 ZIP 同款做法)
  const buildTightExportNode = useCallback(async (): Promise<HTMLDivElement> => {
    const composedDataUrl = await composeMeme({
      pandaSrc: panda.src,
      faceSrc: face.src,
      faceOffset: getLivePandaFaceOffset(panda),
      rotation: faceRotation,
      flipX: faceFlipX,
      size: 1024,
    });
    const capOff = getLiveCaptionOffset(panda);
    // 紧凑节点 — 不再用固定 frame, 让 IMG 按自然 bbox 渲染 (无额外上下留白)
    // composeMeme 输出已经是 bbox-tight, 所以 IMG 自身就是紧凑的
    const node = document.createElement('div');
    node.style.cssText = [
      'position:absolute',
      'left:-99999px',
      'top:0',
      'background:#fff',
      'display:inline-block', // 容器自动按内容收缩
      'padding:14px 18px 18px',
      'box-sizing:border-box',
      'text-align:center',
    ].join(';');
    const escapedText = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    // 导出时不用 translateY (会撑出多余空间); 用 caption marginTop 直接控制间距
    // 最终图像里"谁动谁不动"无所谓 — 只看最终的 panda 内容底 ↔ caption 顶 间距
    const captionMargin = Math.max(2, 12 - capOff);
    node.innerHTML = `
      <img src="${composedDataUrl}" style="display:block;max-width:380px;max-height:380px;width:auto;height:auto;margin:0 auto;" />
      ${escapedText ? `<div style="margin:${captionMargin}px auto 0;max-width:360px;text-align:center;font-size:30px;font-weight:700;color:#000;line-height:1.15;word-break:break-word;white-space:pre-line;font-family:${fontStack};">${escapedText}</div>` : ''}
    `;
    document.body.appendChild(node);
    await new Promise((r) => setTimeout(r, 80));
    return node;
  }, [panda, face, faceRotation, faceFlipX, text, fontStack]);

  const onCopy = useCallback(async () => {
    let node: HTMLDivElement | null = null;
    try {
      node = await buildTightExportNode();
      await copyImageToClipboard(node);
      toast.success(t('quickCopied'));
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'unknown';
      toast.error(`${t('quickCopyFail')}: ${msg}`);
    } finally {
      if (node && node.parentNode) node.parentNode.removeChild(node);
    }
  }, [buildTightExportNode, t]);

  const onDownload = useCallback(async () => {
    let node: HTMLDivElement | null = null;
    try {
      node = await buildTightExportNode();
      await downloadImage(node, `panda-${pandaId}-${faceId}-${Date.now()}.png`);
    } catch (e) {
      toast.error(`Download failed: ${e instanceof Error ? e.message : 'unknown'}`);
    } finally {
      if (node && node.parentNode) node.parentNode.removeChild(node);
    }
  }, [buildTightExportNode, pandaId, faceId]);

  // 心一按 = 写入 draftSlot (这是 Collection + 编辑器本地草稿的唯一数据源)
  // 心再按 (已亮) = 删除该 slot
  const onFav = useCallback(async () => {
    if (isFavored) {
      clearDraft(favSlotId);
      toast.info(t('quickUnsaved'));
      return;
    }
    try {
      const offset350 = getLivePandaFaceOffset(panda);
      // v3: panda bbox-crop + 实际 box → face anchor 跟 QuickMode 预览 100% 对齐
      const pandaBox = await getEditorPandaBox(panda.src);
      const faceLayout = await calcEditorFaceLayout({
        pandaSrc: panda.src,
        faceSrc: face.src,
        faceOffset350: offset350,
        panda350OffsetX: pandaBox.x, panda350OffsetY: pandaBox.y,
        panda350W: pandaBox.w, panda350H: pandaBox.h,
      });
      const layering = getShellLayering(panda.id);
      const elements: any[] = [
        {
          id: generateId(), type: 'image', src: face.src, name: face.id,
          x: faceLayout.x, y: faceLayout.y, width: faceLayout.width, height: faceLayout.height,
          rotation: faceRotation, opacity: 1,
          zIndex: layering.faceZ, blendMode: layering.faceBlend, flipX: faceFlipX,
        },
        {
          id: generateId(), type: 'image', src: pandaBox.croppedSrc, name: panda.id,
          x: pandaBox.x, y: pandaBox.y, width: pandaBox.w, height: pandaBox.h,
          rotation: 0, opacity: 1,
          zIndex: layering.pandaZ, blendMode: layering.pandaBlend, flipX: false,
        },
      ];
      if (text.trim()) {
        elements.push({
          id: generateId(), type: 'text', text,
          x: 60, y: 410, width: 380, height: 56,
          rotation: 0, opacity: 1, zIndex: 100, // 强制最高图层
          fontFamily: fontStack, fontSize: 32, fontWeight: 'bold',
          textAlign: 'center', fillColor: '#000000', strokeColor: '#ffffff',
          strokeWidth: 0,
        });
      }
      const slotName = text.trim() || `快速·${panda.labelCn}`;
      await saveDraftWithState(favSlotId, { elements, selectedId: null, language: lang }, slotName);
      setPendingFavName(text || '');
      setNamePopoverOpen(true);
      toast.success(t('quickSaved'));
    } catch (e) {
      toast.error(`${t('quickCopyFail')}: ${e instanceof Error ? e.message : 'unknown'}`);
    }
  }, [isFavored, favSlotId, panda, face, faceRotation, faceFlipX, text, fontStack, lang, generateId, saveDraftWithState, clearDraft, t]);

  // 改名 — 直接改 draftSlot 的 name (Collection 也会同步显示)
  const onSaveName = useCallback((name: string) => {
    if (name.trim()) renameDraft(favSlotId, name.trim());
    setNamePopoverOpen(false);
  }, [favSlotId, renameDraft]);

  const onToEditor = useCallback(async () => {
    // v3: panda bbox-crop + 实际 box → 跟 QuickMode 预览 100% 一致
    const offset350 = getLivePandaFaceOffset(panda);
    const pandaBox = await getEditorPandaBox(panda.src);
    const faceLayout = await calcEditorFaceLayout({
      pandaSrc: panda.src,
      faceSrc: face.src,
      faceOffset350: offset350,
      panda350OffsetX: pandaBox.x, panda350OffsetY: pandaBox.y,
      panda350W: pandaBox.w, panda350H: pandaBox.h,
    });
    const layering = getShellLayering(panda.id);
    const faceEl = {
      id: generateId(),
      type: 'image' as const,
      src: face.src,
      name: face.id,
      x: faceLayout.x, y: faceLayout.y, width: faceLayout.width, height: faceLayout.height,
      rotation: faceRotation, opacity: 1,
      zIndex: layering.faceZ, blendMode: layering.faceBlend, flipX: faceFlipX,
    };
    const pandaEl = {
      id: generateId(),
      type: 'image' as const,
      src: pandaBox.croppedSrc,
      name: panda.id,
      x: pandaBox.x, y: pandaBox.y, width: pandaBox.w, height: pandaBox.h,
      rotation: 0, opacity: 1,
      zIndex: layering.pandaZ, blendMode: layering.pandaBlend, flipX: false,
    };
    dispatch({ type: 'CLEAR_CANVAS' });
    dispatch({ type: 'ADD_ELEMENT', element: faceEl });
    setTimeout(() => {
      dispatch({ type: 'ADD_ELEMENT', element: pandaEl });
      if (text.trim()) {
        const textEl = {
          id: generateId(),
          type: 'text' as const,
          text,
          x: 60, y: 410, width: 380, height: 56,
          rotation: 0, opacity: 1, zIndex: 100, // 强制最高图层 — 文字永远在 panda/face 之上
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
            onChange={(id) => {
              // 同 id 直接 return — setPandaId 会被 React noop 但其他副作用要避免
              if (id === pandaId) return;
              setPandaId(id);
            }}
            lang={lang}
          />
          <PickPanel
            badge="😂"
            title={t('quickPickFace')}
            items={FACES}
            value={customFace ? '__custom__' : faceId}
            onChange={(id) => {
              // 同 face 且无 customFace 直接 return; customFace 存在则点同 id 也算切换 (清 customFace)
              if (id === faceId && !customFace) return;
              setFaceId(id);
              setCustomFace(null);
            }}
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
                  rotation={faceRotation}
                  flipX={faceFlipX}
                  alt={panda.id}
                  className="qm-panda-img"
                  size={384}
                  // v2 同步切换: onRendered = panda 实际显示 (img onLoad) 后才触发
                  // 一起切 displayed* (caption + transform), 旧版本完整保持到这一刻
                  onRendered={() => {
                    setDisplayedText(text);
                    setDisplayCaptionOffset(getLiveCaptionOffset(panda));
                  }}
                  // transform 用 displayCaptionOffset (旧值保持到 onRendered 才切)
                  // 不再加 opacity 抖动 → 旧 panda 始终 1.0 直到新 panda 真出现
                  style={{ transform: `translateY(${displayCaptionOffset}px)` }}
                />
              </div>
              {displayedText && (
                <div
                  className="qm-caption"
                  style={{ fontFamily: fontStack }}
                >{displayedText}</div>
              )}
            </div>
          </div>

          {/* Mobile-only control stack — Phase 2.7 重排:
              JSX 顺序: preview / action(模式+随机) / caption / pick-row-4(熊猫/脸/自制/提取) / customFace-clear
              视觉顺序 (CSS order): preview → transform(.about-banner-card 卡, 见 main 末尾) → action → caption → pick → clear
              目标: 一屏到底, sticky bottom 走 (复制 / 下载 / ♥ / 编辑器)  */}
          {isMobile && (
            <>
              {/* 行 2: 模式 chip + 🎲 随机生图 */}
              <div className="qmm-action-row">
                <button
                  className="qmm-mode-chip"
                  onClick={cycleMode}
                  title={lang === 'zh' ? '点击切换模式 (循环)' : 'Tap to cycle mode'}
                  type="button"
                >
                  <span key={cycleKey} className="qmm-mode-chip-icon" aria-hidden="true">
                    <RefreshCw size={12} strokeWidth={2.8} />
                  </span>
                  <span>{lang === 'zh' ? '模式' : 'Mode'}:</span>
                  <span>{lang === 'zh' ? MODE_LABELS[mode].zh : MODE_LABELS[mode].en}</span>
                </button>
                <button onClick={onRandomize} className="qmm-random-btn" type="button">
                  <span className="qmm-pick-btn-emoji">🎲</span>
                  <span>{lang === 'zh' ? '随机生图' : 'Random'}</span>
                </button>
              </div>

              {/* Caption card (textarea + 换文字 / 中En / font) */}
              <div className="qmm-caption-card">
                <textarea
                  value={text}
                  onChange={(e) => setTextSynced(e.target.value)}
                  placeholder={t('quickTextPlaceholder')}
                  rows={2}
                  className="qmm-caption-textarea"
                />
                <div className="qmm-caption-controls">
                  <button onClick={onRandomText} className="qmm-reroll-btn" type="button">
                    <Wand2 size={14} /> {lang === 'zh' ? '换文字' : 'Reroll'}
                  </button>
                  <div className="qmm-textlang-group" role="group" aria-label={lang === 'zh' ? '文字语言' : 'Caption language'}>
                    {TEXT_LANG_OPTIONS.map((opt) => (
                      <button
                        key={opt.id}
                        onClick={() => handleSetTextLang(opt.id)}
                        className={`qmm-textlang-btn-m ${textLang === opt.id ? 'qmm-textlang-btn-m-on' : ''}`}
                        type="button"
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  <select
                    value={fontKey}
                    onChange={(e) => setFontKey(e.target.value)}
                    className="qmm-font-select-m"
                    aria-label={lang === 'zh' ? '字体' : 'Font'}
                  >
                    {FONT_OPTIONS.map((f) => (
                      <option key={f.id} value={f.id}>{t(f.labelKey)}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Pick row 4-col: 熊猫 / 脸 / 自制 / 提取 (替代原 3-col + upload row, 节省一行) */}
              <div className="qmm-pick-row qmm-pick-row-4">
                <button onClick={() => setPandaSheetOpen(true)} className="qmm-pick-btn" type="button">
                  <span className="qmm-pick-btn-emoji">🐼</span>
                  <span>{lang === 'zh' ? '选熊猫头' : 'Pandas'}</span>
                </button>
                <button onClick={() => setFaceSheetOpen(true)} className="qmm-pick-btn" type="button">
                  <span className="qmm-pick-btn-emoji">😂</span>
                  <span>{lang === 'zh' ? '选人脸' : 'Faces'}</span>
                </button>
                <button onClick={() => setCustomFaceModalOpen(true)} className="qmm-pick-btn qmm-pick-btn-photo" type="button">
                  <Camera size={18} strokeWidth={2.2} />
                  <span>{lang === 'zh' ? '自制熊猫脸' : 'Custom face'}</span>
                </button>
                <button onClick={() => setSmartModalOpen(true)} className="qmm-pick-btn qmm-pick-btn-emerald" type="button">
                  <Sparkles size={18} strokeWidth={2.2} />
                  <span>{lang === 'zh' ? '智能提取' : 'Smart'}</span>
                </button>
              </div>

              {customFace && (
                <button
                  onClick={() => setCustomFace(null)}
                  className="qmm-clear-custom-btn"
                  type="button"
                >
                  <X size={14} /> {lang === 'zh' ? '清除自制人脸' : 'Clear custom face'}
                </button>
              )}
            </>
          )}

          {/* 操作按钮组 (desktop only) — mobile 走 sticky bottom bar */}
          {!isMobile && (
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
          )}

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

        {/* ===== 右栏: 操作 → 上传/提取 → 文字 (desktop) — mobile 走 main 内 + sticky bar ===== */}
        {!isMobile && (
        <aside style={{ width: 300, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <section className="about-panel">
            <div className="about-panel-title">
              <span className="about-panel-badge"><Sparkles size={18} /></span>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#0a356d' }}>{lang === 'zh' ? '操作' : 'Actions'}</h3>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {/* v5: 随机生图 0.85x, 模式 1.15x — 让 "模式: FOMO" 一行排齐, nowrap 兜底 */}
              <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
                <button
                  onClick={onRandomize}
                  className="about-arcade-btn"
                  style={{ flex: '0.85 1 0', minWidth: 0, padding: '12px 12px', whiteSpace: 'nowrap' }}
                >
                  <Wand2 size={14} /> {t('quickRandom')}
                </button>
                <button
                  onClick={cycleMode}
                  className="about-arcade-btn qm-mode-cycle"
                  style={{
                    flex: '1.15 1 0', minWidth: 0,
                    // v5: grid 50/50, "模式" 锁左半中心, 模式名锁右半中心
                    // → 切 mode 时 "模式" 字位置零偏移, 模式名 center 锁住
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    alignItems: 'center',
                    padding: '12px 8px',
                    gap: 0,
                    position: 'relative', // 容纳 absolute cycle 指示器
                  }}
                  title={lang === 'zh' ? '点击切换模式 (循环)' : 'Click to cycle mode'}
                >
                  {/* 角标 cycle 提示 — 橙色徽章, 每次点击通过 key remount 触发 spin 一圈 */}
                  <span key={cycleKey} className="qm-mode-cycle-icon" aria-hidden="true">
                    <RefreshCw size={13} strokeWidth={2.8} />
                  </span>
                  <span style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                    {lang === 'zh' ? '模式' : 'Mode'}
                  </span>
                  <span style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                    {lang === 'zh' ? MODE_LABELS[mode].zh : MODE_LABELS[mode].en}
                  </span>
                </button>
              </div>
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
              {/* v4: textarea 支持多行 — 回车换行, 预览/导出走 white-space: pre-line */}
              <textarea
                value={text}
                onChange={(e) => setTextSynced(e.target.value)}
                placeholder={t('quickTextPlaceholder')}
                rows={2}
                style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: '2px solid #0a4e97',
                  background: '#fff',
                  color: '#0a356d',
                  fontSize: 14,
                  fontFamily: 'inherit',
                  outline: 'none',
                  resize: 'vertical',
                  minHeight: 44,
                  lineHeight: 1.4,
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
                      onClick={() => handleSetTextLang(opt.id)}
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
        )}
      </div>

      {/* Mobile-only: sticky bottom action bar + panda/face picker bottom sheets */}
      {isMobile && (
        <>
          <div className="quickmode-mobile-bottom" role="toolbar" aria-label={lang === 'zh' ? '操作栏' : 'Actions'}>
            <button onClick={onCopy} className="quickmode-mobile-bottom-btn" type="button">
              <Copy size={16} strokeWidth={2.2} />
              <span style={{ marginLeft: 4 }}>{t('quickCopy')}</span>
            </button>
            <button onClick={onDownload} className="quickmode-mobile-bottom-btn" type="button">
              <Download size={16} strokeWidth={2.2} />
              <span style={{ marginLeft: 4 }}>{t('quickDownload')}</span>
            </button>
            <button
              onClick={onFav}
              className={`quickmode-mobile-bottom-btn ${isFavored ? 'quickmode-mobile-bottom-btn-active' : ''}`}
              type="button"
              aria-pressed={isFavored}
              aria-label={lang === 'zh' ? '收藏' : 'Favorite'}
            >
              <Heart size={18} strokeWidth={2.2} fill={isFavored ? '#fff' : 'none'} />
            </button>
            <button
              onClick={onToEditor}
              className="quickmode-mobile-bottom-btn quickmode-mobile-bottom-btn-primary"
              type="button"
            >
              <span>{lang === 'zh' ? '编辑器' : 'Editor'}</span>
              <ArrowRight size={16} strokeWidth={2.4} />
            </button>
          </div>

          {/* Panda picker sheet */}
          <div
            className={`bottom-sheet-overlay ${pandaSheetOpen ? 'open' : ''}`}
            onClick={() => setPandaSheetOpen(false)}
            aria-hidden="true"
          />
          <div
            className={`bottom-sheet ${pandaSheetOpen ? 'open' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-label={lang === 'zh' ? '选熊猫头' : 'Pick panda'}
          >
            <div className="bottom-sheet-header">
              <span className="bottom-sheet-title">🐼 {t('quickPickPanda')} · {PANDA_HEADS.length}</span>
              <button className="bottom-sheet-close" onClick={() => setPandaSheetOpen(false)} aria-label="Close" type="button">
                <X size={16} strokeWidth={2.5} />
              </button>
            </div>
            <div className="bottom-sheet-body">
              <div className="qmm-picker-grid">
                {PANDA_HEADS.map((it) => (
                  <button
                    key={it.id}
                    onClick={() => { setPandaId(it.id); setPandaSheetOpen(false); }}
                    className={`qmm-picker-item ${it.id === pandaId ? 'qmm-picker-item-active' : ''}`}
                    title={lang === 'zh' ? it.labelCn : it.labelEn}
                    type="button"
                  >
                    <img src={it.src} alt={it.id} loading="lazy" draggable={false} />
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Face picker sheet */}
          <div
            className={`bottom-sheet-overlay ${faceSheetOpen ? 'open' : ''}`}
            onClick={() => setFaceSheetOpen(false)}
            aria-hidden="true"
          />
          <div
            className={`bottom-sheet ${faceSheetOpen ? 'open' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-label={lang === 'zh' ? '选脸' : 'Pick face'}
          >
            <div className="bottom-sheet-header">
              <span className="bottom-sheet-title">😂 {t('quickPickFace')} · {FACES.length}</span>
              <button className="bottom-sheet-close" onClick={() => setFaceSheetOpen(false)} aria-label="Close" type="button">
                <X size={16} strokeWidth={2.5} />
              </button>
            </div>
            <div className="bottom-sheet-body">
              <div className="qmm-picker-grid">
                {FACES.map((it) => (
                  <button
                    key={it.id}
                    onClick={() => { setFaceId(it.id); setCustomFace(null); setFaceSheetOpen(false); }}
                    className={`qmm-picker-item ${(it.id === faceId && !customFace) ? 'qmm-picker-item-active' : ''}`}
                    title={lang === 'zh' ? it.labelCn : it.labelEn}
                    type="button"
                  >
                    <img src={it.src} alt={it.id} loading="lazy" draggable={false} />
                  </button>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

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
