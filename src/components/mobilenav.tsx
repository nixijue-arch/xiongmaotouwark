// MobileNav — 顶部滑下汉堡菜单 drawer (mobile 专用)
// 美学跟 header / sidebar 一致：Win7 蓝色 titlebar + 金色 active 高亮

import { useEffect, useState } from 'react';
import {
  Zap,
  PenTool,
  FolderOpen,
  Image as ImageIcon,
  BookOpen,
  Languages,
  Copy,
  CheckCircle2,
  X,
  ChevronRight,
  Crosshair,
  Database,
  FileText,
  User,
  Film,
} from 'lucide-react';
import { useMeme } from '@/context/memecontext';
import type { Page } from '@/app';

interface MobileNavProps {
  open: boolean;
  onClose: () => void;
  page: Page;
  setPage: (page: Page) => void;
}

const NAV_ITEMS: Array<{
  page: Page;
  icon: typeof Zap;
  labelZh: string;
  labelEn: string;
}> = [
  // 严格对齐桌面 header 的 link-label (原手机端用了更长的描述名, 不一致)
  { page: 'quick', icon: Zap, labelZh: '快速', labelEn: 'Quick' },
  { page: 'editor', icon: PenTool, labelZh: '编辑器', labelEn: 'Editor' },
  { page: 'animate', icon: Film, labelZh: '沙雕动画', labelEn: 'Animation' },
  { page: 'collection', icon: FolderOpen, labelZh: '草图', labelEn: 'Drafts' },
  { page: 'museum', icon: ImageIcon, labelZh: '表情博物馆', labelEn: 'Museum' },
  { page: 'about', icon: BookOpen, labelZh: '了解', labelEn: 'About' },
];

export function MobileNav({ open, onClose, page, setPage }: MobileNavProps) {
  const { state, dispatch } = useMeme();
  const lang = state.language;
  const [copied, setCopied] = useState(false);

  // 锁定 body 滚动 + ESC 关闭
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', handler);
    };
  }, [open, onClose]);

  const handleNav = (p: Page) => {
    setPage(p);
    onClose();
  };

  const switchLang = () => {
    dispatch({ type: 'SET_LANGUAGE', lang: lang === 'zh' ? 'en' : 'zh' });
  };

  const copyCA = async () => {
    const ca = '0xf3525965a4ad3ca0ac13f4d2f237113691194444';
    try {
      await navigator.clipboard.writeText(ca);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = ca;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
      } catch {
        /* ignore */
      }
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <>
      <div
        className={`mobile-nav-backdrop ${open ? 'open' : ''}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <nav
        className={`mobile-nav-drawer ${open ? 'open' : ''}`}
        aria-hidden={!open}
        aria-label={lang === 'zh' ? '导航菜单' : 'Navigation menu'}
      >
        <div className="mobile-nav-titlebar">
          <span className="mobile-nav-titlebar-text">
            <span>📋</span>
            <span>{lang === 'zh' ? '菜单' : 'Menu'}</span>
          </span>
          <button
            className="mobile-nav-close"
            onClick={onClose}
            aria-label={lang === 'zh' ? '关闭' : 'Close'}
            type="button"
          >
            <X size={16} strokeWidth={2.5} />
          </button>
        </div>

        <div className="mobile-nav-banner">
          <img src="/site-logo.png" alt="$熊猫头" className="mobile-nav-banner-logo" />
          <div className="mobile-nav-banner-text">
            <span className="mobile-nav-banner-name">$熊猫头</span>
            <span className="mobile-nav-banner-tag">
              {lang === 'zh' ? '做表情，不内耗！' : 'Make memes, not stress.'}
            </span>
          </div>
        </div>

        <div className="mobile-nav-list">
          {NAV_ITEMS.map(({ page: p, icon: Icon, labelZh, labelEn }) => {
            const active = page === p;
            return (
              <button
                key={p}
                className={`mobile-nav-item ${active ? 'mobile-nav-item-active' : ''}`}
                onClick={() => handleNav(p)}
                type="button"
              >
                <Icon size={20} strokeWidth={2.2} />
                <span className="mobile-nav-item-label">{lang === 'zh' ? labelZh : labelEn}</span>
                {active ? (
                  <span className="mobile-nav-item-meta">
                    {lang === 'zh' ? '当前' : 'Current'}
                  </span>
                ) : (
                  <ChevronRight size={16} strokeWidth={2} style={{ opacity: 0.45 }} />
                )}
              </button>
            );
          })}
        </div>

        <div className="mobile-nav-section-label">
          {lang === 'zh' ? '设置 / 链接' : 'Settings · Links'}
        </div>
        <div className="mobile-nav-list">
          <button className="mobile-nav-item" onClick={switchLang} type="button">
            <Languages size={20} strokeWidth={2.2} />
            <span className="mobile-nav-item-label">
              {lang === 'zh' ? '语言: 中文' : 'Language: English'}
            </span>
            <span className="mobile-nav-item-meta">
              {lang === 'zh' ? '点切 EN' : 'Tap for 中文'}
            </span>
          </button>

          <a
            className="mobile-nav-item"
            href="https://x.com/xiongmaotoubnb"
            target="_blank"
            rel="noopener noreferrer"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
            <span className="mobile-nav-item-label">X Community</span>
            <span className="mobile-nav-item-meta">↗</span>
          </a>

          <a
            className="mobile-nav-item"
            href="https://xiongmaotouweb.linbuxiao.workers.dev/"
            target="_blank"
            rel="noopener noreferrer"
          >
            <User size={20} strokeWidth={2.2} />
            <span className="mobile-nav-item-label">
              {lang === 'zh' ? '头像生成' : 'Avatar Maker'}
            </span>
            <span className="mobile-nav-item-meta">↗</span>
          </a>
        </div>

        <div className="mobile-nav-ca-row" title={lang === 'zh' ? '合约地址，点右侧复制' : 'Contract address — tap copy'}>
          <span className="mobile-nav-ca-star">★</span>
          <span className="mobile-nav-ca-text">CA: 0xf35...4444</span>
          <button
            className="mobile-nav-ca-copy"
            onClick={copyCA}
            aria-label="Copy CA"
            type="button"
          >
            {copied ? <CheckCircle2 size={14} /> : <Copy size={14} />}
          </button>
        </div>

        {import.meta.env.DEV && (
          <>
            <div className="mobile-nav-section-label">DEV TOOLS</div>
            <div className="mobile-nav-dev-row">
              <button
                className={`mobile-nav-dev-btn ${page === 'calibrate' ? 'mobile-nav-dev-btn-active' : ''}`}
                onClick={() => handleNav('calibrate')}
                type="button"
              >
                <Crosshair size={20} strokeWidth={2.2} />
                <span>校准</span>
              </button>
              <button
                className={`mobile-nav-dev-btn ${page === 'materials' ? 'mobile-nav-dev-btn-active' : ''}`}
                onClick={() => handleNav('materials')}
                type="button"
              >
                <Database size={20} strokeWidth={2.2} />
                <span>素材</span>
              </button>
              <button
                className={`mobile-nav-dev-btn ${page === 'captions' ? 'mobile-nav-dev-btn-active' : ''}`}
                onClick={() => handleNav('captions')}
                type="button"
              >
                <FileText size={20} strokeWidth={2.2} />
                <span>文案</span>
              </button>
            </div>
          </>
        )}
      </nav>
    </>
  );
}
