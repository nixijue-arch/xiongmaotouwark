import { useMeme } from '@/context/memecontext';
import { Languages, Copy, CheckCircle2, Image, PenTool, BookOpen, User, Zap, FolderOpen, Crosshair, Database, FileText, Menu, Film, Repeat } from 'lucide-react';
import { useState } from 'react';
import type { Page } from '@/app';
import { MobileNav } from '@/components/mobilenav';

export function Header({ page, setPage }: { page: Page; setPage: (page: Page) => void }) {
  const { state, dispatch, t } = useMeme();
  const [copied, setCopied] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const activeLinkClass = 'header-link header-link-active';

  const switchLang = () => {
    dispatch({ type: 'SET_LANGUAGE', lang: state.language === 'zh' ? 'en' : 'zh' });
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
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <header className="header-bar">
      <div className="header-left">
        {/* Mobile-only hamburger — 桌面 CSS 隐藏 (.mobile-hamburger display:none). 放在 header-left 首位是
            为了 mobile grid 上自然落到第一列 (左) */}
        <button
          onClick={() => setMobileNavOpen(true)}
          className="mobile-hamburger"
          aria-label={state.language === 'zh' ? '打开菜单' : 'Open menu'}
          type="button"
        >
          <Menu size={20} strokeWidth={2.4} />
        </button>
        <div className="brand-icon">
          <img src="/site-logo.png" alt="Site logo" className="brand-logo-image" />
        </div>
        <div className="brand-text">
          <span className="brand-name">$熊猫头</span>
          <span className="brand-tag">{t('subtitle')}</span>
        </div>
        <div className="brand-bubble">
          <span className="brand-bubble-title">{state.language === 'zh' ? '做表情，不内耗！' : 'Make memes, not stress.'}</span>
          <span className="brand-bubble-note">{state.language === 'zh' ? '人人都能做自己的梗图工坊。' : 'A playful studio for fast meme-making.'}</span>
        </div>

        <button
          onClick={() => setPage('quick')}
          className={page === 'quick' ? activeLinkClass : 'header-link'}
          title={state.language === 'zh' ? '快速生图' : 'Quick'}
        >
          <Zap size={14} />
          <span className="link-label">{state.language === 'zh' ? '快速' : 'Quick'}</span>
        </button>
        <button
          onClick={() => setPage('editor')}
          className={page === 'editor' ? activeLinkClass : 'header-link'}
          title={state.language === 'zh' ? '表情包编辑器' : 'Meme Editor'}
        >
          <PenTool size={14} />
          <span className="link-label">{state.language === 'zh' ? '编辑器' : 'Editor'}</span>
        </button>
        <button
          onClick={() => setPage('animate')}
          className={page === 'animate' ? activeLinkClass : 'header-link'}
          title={state.language === 'zh' ? '沙雕动画剪辑' : 'Animation Editor'}
        >
          <Film size={14} />
          <span className="link-label">{state.language === 'zh' ? '沙雕动画' : 'Animation'}</span>
        </button>
        <button
          onClick={() => setPage('gif')}
          className={page === 'gif' ? activeLinkClass : 'header-link'}
          title={state.language === 'zh' ? 'GIF 循环编辑器' : 'GIF Loop Maker'}
        >
          <Repeat size={14} />
          <span className="link-label">{state.language === 'zh' ? 'GIF 循环' : 'GIF Loop'}</span>
        </button>
        <button
          onClick={() => setPage('collection')}
          className={page === 'collection' ? activeLinkClass : 'header-link'}
          title={state.language === 'zh' ? '草图' : 'Drafts'}
        >
          <FolderOpen size={14} />
          <span className="link-label">{state.language === 'zh' ? '草图' : 'Drafts'}</span>
        </button>
        <button
          onClick={() => setPage('museum')}
          className={page === 'museum' ? activeLinkClass : 'header-link'}
          title={t('museum')}
        >
          <Image size={14} />
          <span className="link-label">{t('museum')}</span>
        </button>
        <button
          onClick={() => setPage('about')}
          className={page === 'about' ? activeLinkClass : 'header-link'}
          title={state.language === 'zh' ? '了解熊猫头' : 'About Panda Meme'}
        >
          <BookOpen size={14} />
          <span className="link-label">{state.language === 'zh' ? '了解' : 'About'}</span>
        </button>

        {/* DEV-only 工具入口 — 校准 / 素材 / 文案 */}
        {import.meta.env.DEV && (
          <>
            <button
              onClick={() => setPage('calibrate')}
              className="header-link"
              style={page === 'calibrate'
                ? { backgroundColor: 'rgba(255,94,0,0.18)', borderColor: '#FF5E00', color: '#FF5E00' }
                : { borderStyle: 'dashed', opacity: 0.7 }}
              title="表情对齐工具 (DEV only)"
            >
              <Crosshair size={14} />
              <span className="link-label">校准</span>
            </button>
            <button
              onClick={() => setPage('materials')}
              className="header-link"
              style={page === 'materials'
                ? { backgroundColor: 'rgba(255,94,0,0.18)', borderColor: '#FF5E00', color: '#FF5E00' }
                : { borderStyle: 'dashed', opacity: 0.7 }}
              title="素材管理 (DEV only)"
            >
              <Database size={14} />
              <span className="link-label">素材</span>
            </button>
            <button
              onClick={() => setPage('captions')}
              className="header-link"
              style={page === 'captions'
                ? { backgroundColor: 'rgba(255,94,0,0.18)', borderColor: '#FF5E00', color: '#FF5E00' }
                : { borderStyle: 'dashed', opacity: 0.7 }}
              title="文案管理 (DEV only)"
            >
              <FileText size={14} />
              <span className="link-label">文案</span>
            </button>
          </>
        )}

        {/* X Community Link - desktop only */}
        <a
          href="https://x.com/xiongmaotoubnb"
          target="_blank"
          rel="noopener noreferrer"
          className="header-link header-link-external"
          title="X Community"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
          </svg>
          <span className="link-label">{t('xCommunity')}</span>
        </a>

        {/* Avatar Maker Link - desktop only */}
        <a
          href="https://xiongmaotouweb.linbuxiao.workers.dev/"
          target="_blank"
          rel="noopener noreferrer"
          className="header-link header-link-external avatar-link"
          title="Avatar Maker"
        >
          <User size={14} />
          <span className="link-label">{t('avatarMaker')}</span>
        </a>

      </div>
      <div className="header-right">
        <button
          onClick={copyCA}
          className="ca-badge group"
          title="Click to copy CA"
        >
          <span className="ca-star">★</span>
          <span className="ca-label">CA:</span>
          <span className="ca-abbrev">0xf35...4444</span>
          <span className="ca-full">0xf3525965a4ad3ca0ac13f4d2f237113691194444</span>
          {copied ? <CheckCircle2 size={12} /> : <Copy size={12} className="ca-copy-icon" />}
        </button>

        <button onClick={switchLang} className="lang-toggle" title="Switch language">
          <Languages size={14} />
          <span className="lang-label">{t('switchLang')}</span>
        </button>
      </div>

      <MobileNav
        open={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
        page={page}
        setPage={setPage}
      />
    </header>
  );
}
