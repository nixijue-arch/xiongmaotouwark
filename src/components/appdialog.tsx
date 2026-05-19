import { useEffect, useState, useRef, useCallback } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import './appdialog.css';

export type DialogVariant = 'default' | 'danger' | 'warning' | 'info';

export interface DialogCheckbox {
  key: string;
  label: string;
  defaultChecked?: boolean;
  description?: string;
}

export interface DialogInput {
  key: string;
  label?: string;
  placeholder?: string;
  defaultValue?: string;
  multiline?: boolean;
  required?: boolean;
}

export interface DialogOptions {
  title: string;
  message?: string | ReactNode;
  variant?: DialogVariant;
  confirmText?: string;
  cancelText?: string;
  checkboxes?: DialogCheckbox[];
  input?: DialogInput;
  destructive?: boolean;
}

export interface DialogResult {
  confirmed: boolean;
  checkboxes: Record<string, boolean>;
  input?: string;
}

type DialogInstance = DialogOptions & { resolve: (r: DialogResult) => void };

// 用 functional setState 让"替换 dialog 时 resolve 老的"原子化, 避免双击/并发 caller 永久 hang.
type DialogSetter = React.Dispatch<React.SetStateAction<DialogInstance | null>>;
let currentSetDialog: DialogSetter | null = null;

export function showDialog(opts: DialogOptions): Promise<DialogResult> {
  return new Promise((resolve) => {
    if (!currentSetDialog) {
      const fallbackMsg = typeof opts.message === 'string' ? opts.message : '';
      const ok = typeof window === 'undefined'
        ? true
        : window.confirm(opts.title + (fallbackMsg ? '\n\n' + fallbackMsg : ''));
      resolve({ confirmed: ok, checkboxes: {} });
      return;
    }
    // functional updater: 如果已有 dialog open, 先 resolve 它 (confirmed:false), 然后替换为新 dialog.
    // 避免双击触发的并发 caller 永久 hang.
    currentSetDialog((prev) => {
      if (prev) {
        try {
          prev.resolve({ confirmed: false, checkboxes: {}, input: undefined });
        } catch {
          // ignore: 老 resolve 已 called 也 OK
        }
      }
      return { ...opts, resolve };
    });
  });
}

function getOrCreateRoot(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  let root = document.getElementById('app-dialog-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'app-dialog-root';
    document.body.appendChild(root);
  }
  return root;
}

export function AppDialogHost() {
  const [dialog, setDialog] = useState<DialogInstance | null>(null);
  const [checkboxState, setCheckboxState] = useState<Record<string, boolean>>({});
  const [inputValue, setInputValue] = useState('');
  const firstFocusRef = useRef<HTMLElement | null>(null);
  const dialogRef = useRef<DialogInstance | null>(null);

  useEffect(() => {
    currentSetDialog = setDialog;
    return () => { currentSetDialog = null; };
  }, []);

  useEffect(() => {
    dialogRef.current = dialog;
    if (dialog) {
      const initial: Record<string, boolean> = {};
      dialog.checkboxes?.forEach((cb) => { initial[cb.key] = cb.defaultChecked ?? false; });
      setCheckboxState(initial);
      setInputValue(dialog.input?.defaultValue ?? '');
      setTimeout(() => firstFocusRef.current?.focus(), 50);
    } else {
      firstFocusRef.current = null;
    }
  }, [dialog]);

  const handleConfirm = useCallback(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (d.input?.required && !inputValue.trim()) return;
    d.resolve({
      confirmed: true,
      checkboxes: checkboxState,
      input: d.input ? inputValue : undefined,
    });
    setDialog(null);
  }, [checkboxState, inputValue]);

  const handleCancel = useCallback(() => {
    const d = dialogRef.current;
    if (!d) return;
    d.resolve({ confirmed: false, checkboxes: {}, input: undefined });
    setDialog(null);
  }, []);

  useEffect(() => {
    if (!dialog) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // info variant 只有一个按钮 (确认/知道了), ESC 等同点确认, 让 caller 收 confirmed:true
        if ((dialog.variant ?? 'default') === 'info') handleConfirm();
        else handleCancel();
      } else if (e.key === 'Enter' && !dialog.input?.multiline) {
        const target = e.target as HTMLElement | null;
        if (target && target.tagName === 'TEXTAREA') return;
        e.preventDefault();
        handleConfirm();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog, handleCancel, handleConfirm]);

  if (!dialog) return null;

  const variant: DialogVariant = dialog.variant ?? 'default';
  const showCancel = variant !== 'info';
  const destructive = !!dialog.destructive || variant === 'danger';
  // 输入框必填校验: 必填 + 内容空 → disable confirm 按钮, 用户能看到为啥点不动
  const confirmDisabled = !!dialog.input?.required && !inputValue.trim();

  const root = getOrCreateRoot();
  if (!root) return null;

  const setFirstFocus = (el: HTMLElement | null) => {
    if (el && !firstFocusRef.current) firstFocusRef.current = el;
  };

  return createPortal(
    <div
      className="app-dialog-backdrop"
      onClick={showCancel ? handleCancel : undefined}
      role="presentation"
    >
      <div
        className={`app-dialog app-dialog--${variant}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="app-dialog-head">
          <span id="app-dialog-title" className="app-dialog-title">{dialog.title}</span>
          {showCancel && (
            <button
              type="button"
              className="app-dialog-close"
              onClick={handleCancel}
              aria-label="关闭"
            >
              <X size={14} />
            </button>
          )}
        </div>
        <div className="app-dialog-body">
          {dialog.message && (
            <div className="app-dialog-message">
              {typeof dialog.message === 'string' ? <p>{dialog.message}</p> : dialog.message}
            </div>
          )}
          {dialog.input && (
            <div className="app-dialog-input-section">
              {dialog.input.label && (
                <label className="app-dialog-input-label">
                  {dialog.input.label}
                  {dialog.input.required && <span className="app-dialog-input-required" aria-hidden="true"> *</span>}
                </label>
              )}
              {dialog.input.multiline ? (
                <textarea
                  className="app-dialog-input app-dialog-input-textarea"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder={dialog.input.placeholder}
                  rows={3}
                  ref={(el) => setFirstFocus(el)}
                />
              ) : (
                <input
                  type="text"
                  className="app-dialog-input"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder={dialog.input.placeholder}
                  ref={(el) => setFirstFocus(el)}
                />
              )}
            </div>
          )}
          {dialog.checkboxes && dialog.checkboxes.length > 0 && (
            <div className="app-dialog-checkboxes">
              {dialog.checkboxes.map((cb) => (
                <label key={cb.key} className="app-dialog-checkbox">
                  <input
                    type="checkbox"
                    checked={checkboxState[cb.key] ?? false}
                    onChange={(e) =>
                      setCheckboxState((s) => ({ ...s, [cb.key]: e.target.checked }))
                    }
                  />
                  <div className="app-dialog-checkbox-text">
                    <span className="app-dialog-checkbox-label">{cb.label}</span>
                    {cb.description && (
                      <span className="app-dialog-checkbox-desc">{cb.description}</span>
                    )}
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>
        <div className="app-dialog-actions">
          {showCancel && (
            <button
              type="button"
              className="am-tb-btn app-dialog-btn-cancel"
              onClick={handleCancel}
            >
              {dialog.cancelText ?? '取消'}
            </button>
          )}
          <button
            type="button"
            className={`am-tb-btn am-tb-btn-primary app-dialog-btn-confirm${destructive ? ' is-destructive' : ''}`}
            onClick={handleConfirm}
            disabled={confirmDisabled}
            title={confirmDisabled ? '请填写必填项' : undefined}
            ref={(el) => setFirstFocus(el)}
          >
            {dialog.confirmText ?? '确定'}
          </button>
        </div>
      </div>
    </div>,
    root
  );
}
