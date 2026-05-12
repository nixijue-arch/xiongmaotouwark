// EditorBottomBar — 编辑器底部持续可见 toolbar
// 现代设计参考: Figma / Canva / Photoroom mobile 等 — 把核心操作下沉到 thumb-reach 底部
// 桌面 + mobile 通用. mobile.css 适配紧凑版.
//
// 操作: 快速 / 草图 / 加文字 / 清空 / 复制 / 下载

import { Copy, Download, Type, Trash2, Zap, FolderOpen, Save, FolderHeart } from 'lucide-react';
import { useMeme } from '@/context/memecontext';
import { copyImageToClipboard, downloadImage } from '@/lib/exportImage';
import { toast } from 'sonner';
import type { RefObject } from 'react';
import type { Page } from '@/app';

interface Props {
  canvasRef: RefObject<HTMLDivElement | null>;
  setPage: (page: Page) => void;
}

export function EditorBottomBar({ canvasRef, setPage }: Props) {
  const { state, dispatch, generateId } = useMeme();
  const lang = state.language;
  const hasContent = state.elements.length > 0;

  const onCopy = async () => {
    if (!canvasRef.current) return;
    try {
      await copyImageToClipboard(canvasRef.current);
      toast.success(lang === 'zh' ? '已复制' : 'Copied');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'unknown';
      toast.error(`${lang === 'zh' ? '复制失败' : 'Copy failed'}: ${msg}`);
    }
  };

  const onDownload = async () => {
    if (!canvasRef.current) return;
    try {
      await downloadImage(canvasRef.current, `panda-meme-${Date.now()}.png`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'unknown';
      toast.error(`${lang === 'zh' ? '下载失败' : 'Download failed'}: ${msg}`);
    }
  };

  const onAddText = () => {
    dispatch({
      type: 'ADD_ELEMENT',
      element: {
        id: generateId(),
        type: 'text',
        text: lang === 'zh' ? '双击编辑' : 'Edit me',
        x: 80,
        y: 380,
        width: 340,
        height: 56,
        rotation: 0,
        opacity: 1,
        zIndex: 100,
        fontFamily: 'sans-serif',
        fontSize: 32,
        fontWeight: 'bold',
        textAlign: 'center',
        fillColor: '#000000',
        strokeColor: '#ffffff',
        strokeWidth: 0,
      },
    });
  };

  const onClear = () => {
    if (!hasContent) return;
    dispatch({ type: 'CLEAR_CANVAS' });
    toast.info(lang === 'zh' ? '画布已清空' : 'Canvas cleared');
  };

  // 存当前画布到草稿 — 通过 window event 调 RightSidebar 已实现 handleSaveDraft
  // (含 panda+face 必需校验 + slot LRU + toast 反馈, 不重复造)
  const onSaveDraft = () => {
    if (!hasContent) return;
    window.dispatchEvent(new CustomEvent('xmw-editor-save-draft'));
  };

  // 选草稿 = 跳到 Collection 页面 (mobile 已 polished, 缩略图 grid + 点选载入)
  const onPickDraft = () => setPage('collection');

  return (
    <div className="editor-bottom-bar" role="toolbar" aria-label={lang === 'zh' ? '编辑器工具' : 'Editor toolbar'}>
      <div className="editor-bb-group editor-bb-group-nav">
        <button
          onClick={() => setPage('quick')}
          className="editor-bb-btn"
          type="button"
          title={lang === 'zh' ? '回到快速生图' : 'Back to Quick'}
        >
          <Zap size={16} strokeWidth={2.2} />
          <span>{lang === 'zh' ? '快速' : 'Quick'}</span>
        </button>
        <button
          onClick={() => setPage('collection')}
          className="editor-bb-btn"
          type="button"
          title={lang === 'zh' ? '打开草图本' : 'Open Drafts'}
        >
          <FolderOpen size={16} strokeWidth={2.2} />
          <span>{lang === 'zh' ? '草图本' : 'Drafts'}</span>
        </button>
      </div>

      <div className="editor-bb-divider editor-bb-divider-nav" />

      {/* NEW: drafts group — 存当前 / 选已存 (mobile + desktop) */}
      <div className="editor-bb-group">
        <button
          onClick={onSaveDraft}
          disabled={!hasContent}
          className="editor-bb-btn"
          type="button"
          title={lang === 'zh' ? '存当前为草稿' : 'Save as draft'}
        >
          <Save size={16} strokeWidth={2.2} />
          <span>{lang === 'zh' ? '存稿' : 'Save'}</span>
        </button>
        <button
          onClick={onPickDraft}
          className="editor-bb-btn"
          type="button"
          title={lang === 'zh' ? '打开草图本选取' : 'Open drafts'}
        >
          <FolderHeart size={16} strokeWidth={2.2} />
          <span>{lang === 'zh' ? '选稿' : 'Pick'}</span>
        </button>
      </div>

      <div className="editor-bb-divider" />

      <div className="editor-bb-group">
        <button onClick={onAddText} className="editor-bb-btn" type="button">
          <Type size={16} strokeWidth={2.2} />
          <span>{lang === 'zh' ? '加文字' : 'Text'}</span>
        </button>
        <button
          onClick={onClear}
          disabled={!hasContent}
          className="editor-bb-btn editor-bb-btn-danger"
          type="button"
        >
          <Trash2 size={16} strokeWidth={2.2} />
          <span>{lang === 'zh' ? '清空' : 'Clear'}</span>
        </button>
      </div>

      <div className="editor-bb-divider" />

      <div className="editor-bb-group">
        <button
          onClick={onCopy}
          disabled={!hasContent}
          className="editor-bb-btn"
          type="button"
        >
          <Copy size={16} strokeWidth={2.2} />
          <span>{lang === 'zh' ? '复制' : 'Copy'}</span>
        </button>
        <button
          onClick={onDownload}
          disabled={!hasContent}
          className="editor-bb-btn editor-bb-btn-primary"
          type="button"
        >
          <Download size={16} strokeWidth={2.2} />
          <span>{lang === 'zh' ? '下载' : 'Download'}</span>
        </button>
      </div>
    </div>
  );
}
