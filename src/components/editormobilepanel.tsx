// EditorMobilePanel — 编辑器 mobile inline 工具区
// 充满 canvas → EditorBottomBar 之间空白. 内含:
//   1. mini layer strip (横排 thumb + ↑↓ reorder)
//   2. 选中 image 时: 翻转 / 旋转 90° / 复原 / 删除 quick action
//   3. 选中 text 时: text input + 字号 slider + 删除
// 桌面不渲染 (display: none via CSS).

import { useMemo } from 'react';
import { useMeme } from '@/context/memecontext';
import { useIsMobile } from '@/hooks/usemediaquery';
import {
  ArrowUp, ArrowDown, Trash2, FlipHorizontal, RotateCw, RotateCcw, Type as TypeIcon,
  Shuffle, Wand2, Settings2,
} from 'lucide-react';
import type { ImageElement, TextElement, MemeElement } from '@/context/memecontext';
import { ALL_PANDAS, ALL_FACES } from '@/data/materials';

function isPanda(e: MemeElement): boolean {
  if (e.type !== 'image') return false;
  const name = (e as ImageElement).name;
  return name === 'panda-head' || ALL_PANDAS.some(p => p.id === name) || name.startsWith('upload-panda-');
}

function isFace(e: MemeElement): boolean {
  if (e.type !== 'image') return false;
  const name = (e as ImageElement).name;
  return ALL_FACES.some(f => f.id === name) || name.startsWith('upload-face-') || name.startsWith('custom-face-');
}

export function EditorMobilePanel() {
  const { state, dispatch } = useMeme();
  const isMobile = useIsMobile();

  const lang = state.language;
  // 图层 top-down 排序 (zIndex 高在前 — 视觉上 selected 越高 = 越靠前)
  const sortedTopDown = useMemo(
    () => [...state.elements].sort((a, b) => b.zIndex - a.zIndex),
    [state.elements]
  );
  const selected = state.elements.find(e => e.id === state.selectedId);

  if (!isMobile) return null;

  const moveLayer = (id: string, dir: 'up' | 'down') => {
    // up = zIndex 增 (前移), down = zIndex 减 (后移)
    const sortedBottomUp = [...state.elements].sort((a, b) => a.zIndex - b.zIndex);
    const idx = sortedBottomUp.findIndex(e => e.id === id);
    if (idx < 0) return;
    const targetIdx = dir === 'up' ? idx + 1 : idx - 1;
    if (targetIdx < 0 || targetIdx >= sortedBottomUp.length) return;
    const a = sortedBottomUp[idx];
    const b = sortedBottomUp[targetIdx];
    dispatch({ type: 'UPDATE_ELEMENT', id: a.id, updates: { zIndex: b.zIndex } });
    dispatch({ type: 'UPDATE_ELEMENT', id: b.id, updates: { zIndex: a.zIndex } });
  };

  const selectedTopDownIdx = selected ? sortedTopDown.findIndex(e => e.id === selected.id) : -1;
  const canMoveUp = selected ? selectedTopDownIdx > 0 : false;
  const canMoveDown = selected ? selectedTopDownIdx < sortedTopDown.length - 1 : false;

  // 当画布为空时, 只显示 chunky row (选素材 / 换图 / 换文字 / 更多) — 主入口
  if (state.elements.length === 0) {
    return (
      <div className="emp-root">
        <div className="emp-empty-hint">
          {lang === 'zh' ? '从下方按钮开始 — 选素材 / 一键换图' : 'Start below — pick assets / randomize'}
        </div>
        <div className="emp-chunky-row">
          <button
            onClick={() => window.dispatchEvent(new CustomEvent('xmw-editor-open-left-sheet'))}
            className="emp-chunky-btn emp-chunky-btn-primary"
            type="button"
          >
            <span className="emp-chunky-emoji">🐼</span>
            <span>{lang === 'zh' ? '选素材' : 'Assets'}</span>
          </button>
          <button
            onClick={() => window.dispatchEvent(new CustomEvent('xmw-editor-switch-image'))}
            className="emp-chunky-btn emp-chunky-btn-primary"
            type="button"
          >
            <Shuffle size={20} strokeWidth={2.2} />
            <span>{lang === 'zh' ? '一键随机' : 'Random'}</span>
          </button>
          <button
            onClick={() => window.dispatchEvent(new CustomEvent('xmw-editor-recommend-text'))}
            className="emp-chunky-btn emp-chunky-btn-emerald"
            type="button"
          >
            <Wand2 size={20} strokeWidth={2.2} />
            <span>{lang === 'zh' ? '加文字' : 'Text'}</span>
          </button>
          <button
            onClick={() => window.dispatchEvent(new CustomEvent('xmw-editor-open-right-sheet'))}
            className="emp-chunky-btn"
            type="button"
          >
            <Settings2 size={20} strokeWidth={2.2} />
            <span>{lang === 'zh' ? '更多' : 'More'}</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="emp-root">
      {/* Mini layer strip + reorder buttons */}
      <div className="emp-layers" role="list">
        {sortedTopDown.map((el) => {
          const active = el.id === state.selectedId;
          const label = el.type === 'text'
            ? ((el as TextElement).text || (lang === 'zh' ? '文字' : 'Text')).slice(0, 8)
            : isPanda(el) ? (lang === 'zh' ? '熊猫' : 'Panda')
            : isFace(el) ? (lang === 'zh' ? '人脸' : 'Face')
            : (lang === 'zh' ? '图片' : 'Image');
          return (
            <button
              key={el.id}
              onClick={() => dispatch({ type: 'SELECT_ELEMENT', id: active ? null : el.id })}
              className={`emp-layer-thumb ${active ? 'emp-layer-thumb-on' : ''}`}
              type="button"
              title={label}
              aria-pressed={active}
            >
              {el.type === 'text' ? (
                <TypeIcon size={18} strokeWidth={2.4} />
              ) : (
                <img src={(el as ImageElement).src} alt="" draggable={false} />
              )}
            </button>
          );
        })}
        {selected && state.elements.length > 1 && (
          <>
            <span className="emp-divider-v" />
            <button
              onClick={() => moveLayer(selected.id, 'up')}
              disabled={!canMoveUp}
              className="emp-icon-btn"
              type="button"
              title={lang === 'zh' ? '上移一层 (前)' : 'Move up'}
              aria-label={lang === 'zh' ? '上移一层' : 'Move up'}
            >
              <ArrowUp size={16} strokeWidth={2.4} />
            </button>
            <button
              onClick={() => moveLayer(selected.id, 'down')}
              disabled={!canMoveDown}
              className="emp-icon-btn"
              type="button"
              title={lang === 'zh' ? '下移一层 (后)' : 'Move down'}
              aria-label={lang === 'zh' ? '下移一层' : 'Move down'}
            >
              <ArrowDown size={16} strokeWidth={2.4} />
            </button>
          </>
        )}
      </div>

      {/* Quick edit — selected image */}
      {selected?.type === 'image' && (
        <div className="emp-quick-edit">
          <button
            onClick={() => {
              const el = selected as ImageElement;
              dispatch({ type: 'UPDATE_ELEMENT', id: el.id, updates: { flipX: !el.flipX } });
            }}
            className="emp-quick-btn"
            type="button"
          >
            <FlipHorizontal size={14} /> {lang === 'zh' ? '翻转' : 'Flip'}
          </button>
          <button
            onClick={() => {
              const el = selected as ImageElement;
              dispatch({ type: 'UPDATE_ELEMENT', id: el.id, updates: { rotation: (el.rotation + 90) % 360 } });
            }}
            className="emp-quick-btn"
            type="button"
          >
            <RotateCw size={14} /> 90°
          </button>
          <button
            onClick={() => {
              const el = selected as ImageElement;
              dispatch({ type: 'UPDATE_ELEMENT', id: el.id, updates: { rotation: 0, flipX: false } });
            }}
            className="emp-quick-btn"
            type="button"
          >
            <RotateCcw size={14} /> {lang === 'zh' ? '复原' : 'Reset'}
          </button>
          <button
            onClick={() => {
              dispatch({ type: 'REMOVE_ELEMENT', id: selected.id });
              dispatch({ type: 'SELECT_ELEMENT', id: null });
            }}
            className="emp-quick-btn emp-quick-btn-danger"
            type="button"
          >
            <Trash2 size={14} /> {lang === 'zh' ? '删除' : 'Del'}
          </button>
        </div>
      )}

      {/* Quick edit — selected text */}
      {selected?.type === 'text' && (
        <div className="emp-text-block">
          <input
            type="text"
            value={(selected as TextElement).text}
            onChange={(e) => dispatch({ type: 'UPDATE_ELEMENT', id: selected.id, updates: { text: e.target.value } })}
            className="emp-text-input"
            placeholder={lang === 'zh' ? '编辑文字...' : 'Edit text...'}
          />
          <div className="emp-text-row">
            <span className="emp-text-label">{lang === 'zh' ? '字号' : 'Size'}</span>
            <input
              type="range"
              min={12}
              max={72}
              step={1}
              value={(selected as TextElement).fontSize}
              onChange={(e) => dispatch({ type: 'UPDATE_ELEMENT', id: selected.id, updates: { fontSize: Number(e.target.value) } })}
              className="emp-text-range"
              aria-label={lang === 'zh' ? '字号' : 'Font size'}
            />
            <span className="emp-text-value">{(selected as TextElement).fontSize}</span>
            <button
              onClick={() => {
                dispatch({ type: 'REMOVE_ELEMENT', id: selected.id });
                dispatch({ type: 'SELECT_ELEMENT', id: null });
              }}
              className="emp-quick-btn emp-quick-btn-danger emp-text-del"
              type="button"
              aria-label={lang === 'zh' ? '删除文字' : 'Delete text'}
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Hint when nothing selected (only when have content but nothing selected) */}
      {!selected && state.elements.length > 0 && (
        <div className="emp-hint">
          {lang === 'zh' ? '点上面的图层 / 画布元素来编辑' : 'Tap a layer or canvas element to edit'}
        </div>
      )}

      {/* === Chunky 4-col 大按钮 row — 仿 QuickMode pick-row-4 风格 ===
          🐼 选素材 / 🎲 换图 / 🔤 换文字 / 🔧 更多
          通过 window CustomEvent 调 LeftSidebar / RightSidebar 的现有 handler */}
      <div className="emp-chunky-row">
        <button
          onClick={() => window.dispatchEvent(new CustomEvent('xmw-editor-open-left-sheet'))}
          className="emp-chunky-btn"
          type="button"
        >
          <span className="emp-chunky-emoji">🐼</span>
          <span>{lang === 'zh' ? '选素材' : 'Assets'}</span>
        </button>
        <button
          onClick={() => window.dispatchEvent(new CustomEvent('xmw-editor-switch-image'))}
          className="emp-chunky-btn emp-chunky-btn-primary"
          type="button"
        >
          <Shuffle size={20} strokeWidth={2.2} />
          <span>{lang === 'zh' ? '换图' : 'Swap'}</span>
        </button>
        <button
          onClick={() => window.dispatchEvent(new CustomEvent('xmw-editor-recommend-text'))}
          className="emp-chunky-btn emp-chunky-btn-emerald"
          type="button"
        >
          <Wand2 size={20} strokeWidth={2.2} />
          <span>{lang === 'zh' ? '换文字' : 'Text'}</span>
        </button>
        <button
          onClick={() => window.dispatchEvent(new CustomEvent('xmw-editor-open-right-sheet'))}
          className="emp-chunky-btn"
          type="button"
        >
          <Settings2 size={20} strokeWidth={2.2} />
          <span>{lang === 'zh' ? '更多' : 'More'}</span>
        </button>
      </div>
    </div>
  );
}
