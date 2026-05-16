// 联网搜熊猫头 — 全屏 Modal (LeftSidebar 入口)
//
// 2026-05-17 重新设计 (用户反馈编辑器 sidebar 嵌入 panel 滚轮卡 + 框太小 + bug 多):
//   - sidebar 不再嵌入 PandaSearchPanel, 改为大按钮触发本 modal
//   - modal 全屏白底, PandaSearchPanel 非 embedded 模式, 自己 grid 滚, 0 双层滚动冲突
//   - 大瀑布流 3 列 (>= 768px) / 2 列 (mobile), 卡片更大
//   - 关闭 = ESC / 点 X / 应用成功后自动关

import { useEffect } from 'react';
import { X } from 'lucide-react';
import { PandaSearchPanel } from './pandasearchpanel';
import type { Material } from '@/data/materials';
import type { NetworkResult } from '@/lib/networkImage';
import './pandasearchmodal.css';

export interface PandaSearchModalProps {
  open: boolean;
  lang: 'zh' | 'en';
  /** 应用到画板 — caller 在内部 dispatch + close modal */
  onSelect: (material: Material, result: NetworkResult) => void;
  /** DEV-only ⭐ 沉淀 */
  onSaveToPool?: (result: NetworkResult) => void;
  onClose: () => void;
}

export function PandaSearchModal(props: PandaSearchModalProps) {
  const { open, lang, onSelect, onSaveToPool, onClose } = props;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    // 锁 body 滚 (modal 全屏时)
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="psm-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="psm-frame" onClick={(e) => e.stopPropagation()}>
        <header className="psm-header">
          <div className="psm-title">
            <span className="psm-title-icon" aria-hidden="true">🌐</span>
            <span>{lang === 'zh' ? '联网搜熊猫头表情包' : 'Search Panda Memes Online'}</span>
          </div>
          <button
            type="button"
            className="psm-close-btn"
            onClick={onClose}
            aria-label="close"
            title={lang === 'zh' ? '关闭 (ESC)' : 'Close (ESC)'}
          >
            <X size={16} />
          </button>
        </header>
        <div className="psm-body">
          <PandaSearchPanel
            lang={lang}
            onSelect={onSelect}
            onSaveToPool={onSaveToPool}
          />
        </div>
      </div>
    </div>
  );
}
