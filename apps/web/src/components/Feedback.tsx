/** @format */

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { Icon } from './Icon';

type ToastTone = 'info' | 'error';

interface ToastEntry {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ConfirmOptions {
  title: string;
  body?: string;
  confirmLabel?: string;
  danger?: boolean;
}

interface ConfirmRequest extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

/**
 * 应用内提示与确认。原生 alert / confirm 会打断阅读、无法沿用设计令牌，
 * 这里用订阅式的小 store 暴露给任意模块（包括 store 里的领域动作）。
 */
let toasts: ToastEntry[] = [];
let confirmRequest: ConfirmRequest | null = null;
const listeners = new Set<() => void>();
let toastSeq = 0;

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function toastSnapshot() {
  return toasts;
}

function confirmSnapshot() {
  return confirmRequest;
}

/** 轻提示，最多同时保留三条，3.6 秒后自动消失 */
export function notify(message: string, tone: ToastTone = 'info') {
  const id = ++toastSeq;
  toasts = [...toasts, { id, message, tone }].slice(-3);
  emit();
  window.setTimeout(() => {
    toasts = toasts.filter((toast) => toast.id !== id);
    emit();
  }, 3600);
}

/** 用应用内对话框替代 window.confirm，返回用户是否确认 */
export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    confirmRequest = { ...options, resolve };
    emit();
  });
}

export function FeedbackHost() {
  const toastList = useSyncExternalStore(subscribe, toastSnapshot);
  const request = useSyncExternalStore(subscribe, confirmSnapshot);
  const dlgRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dlg = dlgRef.current;
    if (!dlg) return;
    if (request && !dlg.open) {
      dlg.showModal();
      dlg.querySelector<HTMLButtonElement>('[data-confirm]')?.focus();
    } else if (!request && dlg.open) {
      dlg.close();
    }
  }, [request]);

  const settle = (ok: boolean) => {
    const current = confirmRequest;
    if (!current) return;
    confirmRequest = null;
    emit();
    current.resolve(ok);
  };

  return (
    <>
      <div className="toast-stack" role="status" aria-live="polite">
        {toastList.map((toast) => (
          <div className={`toast${toast.tone === 'error' ? ' error' : ''}`} key={toast.id}>
            <span className="toast-icon" aria-hidden="true">
              <Icon name={toast.tone === 'error' ? 'x' : 'check'} size={18} />
            </span>
            <span className="toast-copy">
              <strong>{toast.message}</strong>
            </span>
          </div>
        ))}
      </div>

      <dialog
        ref={dlgRef}
        className="confirm-dialog"
        aria-labelledby="confirm-title"
        onClose={() => settle(false)}
        onMouseDown={(e) => {
          if (e.target === dlgRef.current) settle(false);
        }}>
        {request && (
          <>
            <div className="dialog-head">
              <h2 id="confirm-title">{request.title}</h2>
            </div>
            {request.body && <p className="confirm-body">{request.body}</p>}
            <div className="dialog-foot confirm-foot">
              <button className="btn ghost" onClick={() => settle(false)}>
                取消
              </button>
              <button
                className="btn primary"
                data-confirm
                onClick={() => settle(true)}>
                {request.confirmLabel ?? '确定'}
              </button>
            </div>
          </>
        )}
      </dialog>
    </>
  );
}