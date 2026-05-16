// ContextMenu — 右键菜单 (portal + viewport clamp + submenu + keyboard nav)
// Win7-aero panel 风格. 配套 useContextMenu hook 一行接入.

import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { JSX, ReactNode } from 'react';

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  hidden?: boolean;
  onClick?: () => void;
  submenu?: ContextMenuItem[];
  separator?: boolean;
}

export interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

const STYLE_ID = 'ctxmenu-style';
const CSS = `
.ctxmenu {
  position: fixed;
  z-index: 9999;
  min-width: 200px;
  max-width: 280px;
  background: #fff;
  border: 1px solid #cdd3da;
  border-radius: 4px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.15);
  padding: 4px 0;
  font-size: 12px;
  user-select: none;
  outline: none;
}
.ctxmenu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 28px;
  padding: 0 8px;
  background: transparent;
  border: 0;
  cursor: pointer;
  text-align: left;
  font-size: 12px;
  color: #222;
  box-sizing: border-box;
}
.ctxmenu-item:hover,
.ctxmenu-item-active {
  background: #e8f0fe;
}
.ctxmenu-item-active {
  background: #d4e4fc;
}
.ctxmenu-item-disabled {
  opacity: 0.4;
  cursor: default;
  pointer-events: none;
}
.ctxmenu-item-danger {
  color: #cb2a2a;
}
.ctxmenu-item-danger:hover,
.ctxmenu-item-danger.ctxmenu-item-active {
  background: rgba(203, 42, 42, 0.08);
}
.ctxmenu-icon {
  flex: 0 0 14px;
  width: 14px;
  height: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.ctxmenu-label {
  flex: 1 1 auto;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ctxmenu-shortcut {
  flex: 0 0 auto;
  text-align: right;
  font-size: 10px;
  color: #888;
  font-family: 'SF Mono', Menlo, monospace;
  margin-left: 12px;
}
.ctxmenu-sub {
  flex: 0 0 auto;
  font-size: 10px;
  color: #888;
  margin-left: 8px;
}
.ctxmenu-sep {
  height: 1px;
  background: #e5e7eb;
  margin: 4px 0;
}
`;

function ensureStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = CSS;
  document.head.appendChild(el);
}

function visibleItems(items: ContextMenuItem[]): ContextMenuItem[] {
  return items.filter((it) => !it.hidden);
}

function firstFocusableIndex(items: ContextMenuItem[]): number {
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it.separator && !it.disabled) return i;
  }
  return -1;
}

function nextFocusableIndex(items: ContextMenuItem[], from: number, dir: 1 | -1): number {
  const n = items.length;
  if (n === 0) return -1;
  let i = from;
  for (let step = 0; step < n; step++) {
    i = (i + dir + n) % n;
    const it = items[i];
    if (!it.separator && !it.disabled) return i;
  }
  return from;
}

interface MenuPanelProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
  isRoot: boolean;
  onParentRequestClose?: () => void;
}

function MenuPanel(props: MenuPanelProps): JSX.Element {
  const { x, y, items, onClose, isRoot } = props;
  const ref = useRef<HTMLDivElement>(null);
  const visible = visibleItems(items);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: x, top: y });
  const [activeIdx, setActiveIdx] = useState<number>(() => firstFocusableIndex(visible));
  const [openSubIdx, setOpenSubIdx] = useState<number>(-1);
  const [subPos, setSubPos] = useState<{ left: number; top: number } | null>(null);
  const hoverTimer = useRef<number | null>(null);

  useEffect(() => {
    ensureStyles();
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let left = x;
    let top = y;
    const margin = 8;
    if (left + rect.width > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - rect.width - margin);
    }
    if (top + rect.height > window.innerHeight - margin) {
      top = Math.max(margin, window.innerHeight - rect.height - margin);
    }
    if (left < margin) left = margin;
    if (top < margin) top = margin;
    setPos({ left, top });
    el.focus();
  }, [x, y]);

  useEffect(() => {
    if (!isRoot) return;
    const onDown = (e: MouseEvent) => {
      const el = ref.current;
      if (el && e.target instanceof Node && el.contains(e.target)) return;
      const subEl = document.querySelector('[data-ctxmenu-sub="1"]');
      if (subEl && e.target instanceof Node && subEl.contains(e.target)) return;
      onClose();
    };
    const onCtx = (e: MouseEvent) => {
      const el = ref.current;
      if (el && e.target instanceof Node && el.contains(e.target)) return;
      const subEl = document.querySelector('[data-ctxmenu-sub="1"]');
      if (subEl && e.target instanceof Node && subEl.contains(e.target)) return;
      onClose();
    };
    const onScroll = () => onClose();
    const onResize = () => onClose();
    window.addEventListener('mousedown', onDown);
    window.addEventListener('contextmenu', onCtx);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('contextmenu', onCtx);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [isRoot, onClose]);

  const clearHover = useCallback(() => {
    if (hoverTimer.current !== null) {
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
  }, []);

  useEffect(() => () => clearHover(), [clearHover]);

  const computeSubPos = useCallback((idx: number): { left: number; top: number } | null => {
    const root = ref.current;
    if (!root) return null;
    const btn = root.querySelector<HTMLElement>(`[data-ctxmenu-idx="${idx}"]`);
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    const subWidth = 220;
    let left = r.right;
    if (left + subWidth > window.innerWidth - 8) {
      left = Math.max(8, r.left - subWidth);
    }
    let top = r.top;
    if (top + 200 > window.innerHeight - 8) {
      top = Math.max(8, window.innerHeight - 208);
    }
    return { left, top };
  }, []);

  const openSubmenu = useCallback(
    (idx: number) => {
      const it = visible[idx];
      if (!it || !it.submenu || it.submenu.length === 0) return;
      const sp = computeSubPos(idx);
      if (sp) setSubPos(sp);
      setOpenSubIdx(idx);
    },
    [visible, computeSubPos],
  );

  const closeSubmenu = useCallback(() => {
    setOpenSubIdx(-1);
    setSubPos(null);
  }, []);

  const activateItem = useCallback(
    (it: ContextMenuItem, idx: number) => {
      if (it.disabled || it.separator) return;
      if (it.submenu && it.submenu.length > 0) {
        openSubmenu(idx);
        return;
      }
      it.onClick?.();
      onClose();
    },
    [openSubmenu, onClose],
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (openSubIdx >= 0) {
        closeSubmenu();
      } else {
        onClose();
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => nextFocusableIndex(visible, i < 0 ? -1 : i, 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => nextFocusableIndex(visible, i < 0 ? visible.length : i, -1));
      return;
    }
    if (e.key === 'ArrowRight') {
      const it = visible[activeIdx];
      if (it && it.submenu && it.submenu.length > 0) {
        e.preventDefault();
        openSubmenu(activeIdx);
      }
      return;
    }
    if (e.key === 'ArrowLeft') {
      if (!isRoot) {
        e.preventDefault();
        props.onParentRequestClose?.();
      }
      return;
    }
    if (e.key === 'Enter') {
      const it = visible[activeIdx];
      if (it) {
        e.preventDefault();
        activateItem(it, activeIdx);
      }
    }
  };

  const handleMouseEnterItem = (idx: number) => {
    setActiveIdx(idx);
    clearHover();
    const it = visible[idx];
    if (it && it.submenu && it.submenu.length > 0) {
      hoverTimer.current = window.setTimeout(() => {
        openSubmenu(idx);
      }, 300);
    } else if (openSubIdx !== -1) {
      hoverTimer.current = window.setTimeout(() => {
        closeSubmenu();
      }, 300);
    }
  };

  const subItem = openSubIdx >= 0 ? visible[openSubIdx] : null;

  return (
    <>
      <div
        ref={ref}
        className='ctxmenu'
        style={{ left: pos.left, top: pos.top }}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        onContextMenu={(e) => e.preventDefault()}
        data-ctxmenu-sub={isRoot ? '0' : '1'}
      >
        {visible.map((it, idx) => {
          if (it.separator) {
            return <div key={it.id} className='ctxmenu-sep' />;
          }
          const cls = [
            'ctxmenu-item',
            it.disabled ? 'ctxmenu-item-disabled' : '',
            it.danger ? 'ctxmenu-item-danger' : '',
            idx === activeIdx ? 'ctxmenu-item-active' : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <button
              key={it.id}
              type='button'
              className={cls}
              data-ctxmenu-idx={idx}
              onClick={(e) => {
                e.stopPropagation();
                activateItem(it, idx);
              }}
              onMouseEnter={() => handleMouseEnterItem(idx)}
            >
              <span className='ctxmenu-icon'>{it.icon}</span>
              <span className='ctxmenu-label'>{it.label}</span>
              {it.shortcut ? <span className='ctxmenu-shortcut'>{it.shortcut}</span> : null}
              {it.submenu && it.submenu.length > 0 ? <span className='ctxmenu-sub'>▸</span> : null}
            </button>
          );
        })}
      </div>
      {subItem && subPos && subItem.submenu ? (
        <MenuPanel
          x={subPos.left}
          y={subPos.top}
          items={subItem.submenu}
          onClose={onClose}
          isRoot={false}
          onParentRequestClose={closeSubmenu}
        />
      ) : null}
    </>
  );
}

export function ContextMenu(props: ContextMenuProps): JSX.Element {
  const { x, y, items, onClose } = props;
  if (typeof document === 'undefined') {
    return <></>;
  }
  return createPortal(
    <MenuPanel x={x} y={y} items={items} onClose={onClose} isRoot={true} />,
    document.body,
  );
}

export interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

export function useContextMenu(): {
  menu: ContextMenuState | null;
  open: (e: React.MouseEvent, items: ContextMenuItem[]) => void;
  close: () => void;
  render: () => JSX.Element | null;
} {
  const [menu, setMenu] = useState<ContextMenuState | null>(null);

  const open = useCallback((e: React.MouseEvent, items: ContextMenuItem[]) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, items });
  }, []);

  const close = useCallback(() => {
    setMenu(null);
  }, []);

  const render = useCallback((): JSX.Element | null => {
    if (!menu) return null;
    return <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={close} />;
  }, [menu, close]);

  return { menu, open, close, render };
}

/* USAGE
const { open, render } = useContextMenu();
return (
  <>
    <div onContextMenu={(e) => open(e, [
      { id: 'copy', label: '复制', shortcut: 'Ctrl+C', onClick: () => doCopy() },
      { id: 'del', label: '删除', danger: true, onClick: () => doDel() },
      { separator: true, id: 'sep1', label: '' },
      { id: 'props', label: '属性', submenu: [{ id: 'a', label: 'A' }] },
    ])}>...</div>
    {render()}
  </>
);
*/
