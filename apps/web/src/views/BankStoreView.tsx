/**
 * 题库管理：内置题库 + 云端目录 + 已下载题库。
 *
 * 下载 / 更新需要会员；切换只动本地，不联网；删除时可选择是否同时清空本机进度。
 * 断网时目录读缓存，已下载的题库照常可用。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { BankMeta } from '@megrez/storage';
import type { RemoteBankMeta } from '@megrez/storage/http';
import { useQuiz, type BankActionReason } from '../store/QuizStore';
import { Icon } from '../components/Icon';
import { notify } from '../components/Feedback';

interface BankEntry {
  id: string;
  name: string;
  subtitle?: string;
  description?: string;
  version: number;
  questionCount: number;
  chapterCount: number;
  builtin: boolean;
  installed: BankMeta | null;
  remote: RemoteBankMeta | null;
}

function formatCount(n: number): string {
  return `${n.toLocaleString()} 题`;
}

function errorHint(reason: BankActionReason): string {
  switch (reason) {
    case 'login':
      return '登录后即可下载云端题库';
    case 'membership':
      return '题库下载为会员功能，可先兑换会员';
    case 'network':
      return '网络不可用，已安装的题库仍可离线使用';
    default:
      return '题库操作失败，请稍后重试';
  }
}

export function BankStoreView() {
  const {
    bankId,
    bankName,
    bankVersion,
    builtinBank,
    installedBanks,
    catalog,
    catalogAt,
    bankBusy,
    switchBank,
    installBank,
    deleteBank,
    refreshCatalog,
    cloud,
    isMember,
    setView,
  } = useQuiz();

  const [refreshing, setRefreshing] = useState(false);
  const [hint, setHint] = useState<{ reason: BankActionReason; message: string } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<BankMeta | null>(null);
  const [clearProgress, setClearProgress] = useState(false);
  const dlgRef = useRef<HTMLDialogElement>(null);
  const catalogLoadedRef = useRef(false);

  // 进入题库页时拉一次目录；启动时不联网，保证离线打开不受影响
  useEffect(() => {
    if (catalogLoadedRef.current) return;
    catalogLoadedRef.current = true;
    if (navigator.onLine !== false) void refreshCatalog();
  }, [refreshCatalog]);

  useEffect(() => {
    const dlg = dlgRef.current;
    if (!dlg) return;
    if (pendingDelete && !dlg.open) {
      dlg.showModal();
      dlg.querySelector<HTMLButtonElement>('[data-cancel]')?.focus();
    } else if (!pendingDelete && dlg.open) {
      dlg.close();
    }
  }, [pendingDelete]);

  const entries = useMemo<BankEntry[]>(() => {
    const installed = new Map(installedBanks.map((b) => [b.id, b]));
    const remote = new Map(catalog.map((b) => [b.id, b]));
    const ids = new Set<string>([builtinBank.id, ...installed.keys(), ...remote.keys()]);

    return [...ids]
      .sort((a, b) => {
        if (a === builtinBank.id) return -1;
        if (b === builtinBank.id) return 1;
        return a.localeCompare(b);
      })
      .map((id) => {
        const local = installed.get(id) ?? null;
        const online = remote.get(id) ?? null;
        const isBuiltin = id === builtinBank.id;
        return {
          id,
          name: isBuiltin ? builtinBank.name : local?.name ?? online?.name ?? id,
          subtitle: (isBuiltin ? undefined : local?.subtitle) ?? online?.subtitle,
          description: online?.description,
          version: isBuiltin
            ? builtinBank.version
            : local?.version ?? online?.version ?? 0,
          questionCount: isBuiltin
            ? builtinBank.questionCount
            : local?.questionCount ?? online?.questionCount ?? 0,
          chapterCount: isBuiltin
            ? builtinBank.chapterCount
            : local?.chapterCount ?? online?.chapterCount ?? 0,
          builtin: isBuiltin,
          installed: local,
          remote: online,
        };
      });
  }, [builtinBank, installedBanks, catalog]);

  const runInstall = async (id: string) => {
    setHint(null);
    const result = await installBank(id);
    if (result.ok) return;
    if (result.reason === 'login' || result.reason === 'membership') {
      setHint({ reason: result.reason, message: result.message });
    } else {
      notify(result.message, 'error');
    }
  };

  const checkUpdates = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const ok = await refreshCatalog();
      notify(ok ? '题库列表已更新' : '无法连接服务器，稍后再试', ok ? 'info' : 'error');
    } finally {
      setRefreshing(false);
    }
  };

  const confirmDelete = async () => {
    const target = pendingDelete;
    if (!target) return;
    setPendingDelete(null);
    const result = await deleteBank(target.id, clearProgress);
    if (!result.ok) notify(result.message, 'error');
    setClearProgress(false);
  };

  const catalogTime = catalogAt
    ? new Date(catalogAt).toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

  return (
    <div className="view-page bank-store">
      <header className="view-head">
        <div className="view-head-copy">
          <h1>题库</h1>
          <p className="page-sub">
            当前使用「{bankName}」v{bankVersion}。下载后的题库可离线使用，进度、收藏与心得按题库独立保存。
          </p>
        </div>
        <div className="view-head-actions">
          <button className="btn ghost sm" onClick={() => void checkUpdates()} disabled={refreshing}>
            {refreshing ? '检查中…' : '检查更新'}
          </button>
        </div>
      </header>

      {hint && (
        <div className="bank-hint" role="status">
          <span className="bank-hint-icon">
            <Icon name={hint.reason === 'membership' ? 'lock' : 'user'} size={16} />
          </span>
          <span className="bank-hint-copy">
            <strong>{hint.message}</strong>
            <span>{errorHint(hint.reason)}</span>
          </span>
          <button className="btn ghost sm" onClick={() => setView('settings')}>
            去设置
          </button>
        </div>
      )}

      <section className="panel bank-panel" aria-label="题库列表">
        <div className="panel-head">
          <h2>全部题库</h2>
          <span>
            {entries.length} 个
            {catalogTime ? ` · 目录更新于 ${catalogTime}` : ''}
          </span>
        </div>

        <div className="bank-list">
          {entries.map((entry) => {
            const current = entry.id === bankId;
            const busy = bankBusy === entry.id;
            const updatable =
              !entry.builtin &&
              entry.installed != null &&
              entry.remote != null &&
              entry.remote.version > entry.installed.version;
            const downloadLabel = !cloud.user ? '登录下载' : !isMember ? '会员下载' : '下载';

            return (
              <article className={`bank-row${current ? ' current' : ''}`} key={entry.id}>
                <span className="bank-row-icon">
                  <Icon name={entry.builtin ? 'star' : 'book'} size={18} />
                </span>
                <div className="bank-row-main">
                  <div className="bank-row-title">
                    <strong>{entry.name}</strong>
                    {entry.builtin && <span className="bank-tag">内置</span>}
                    {current && <span className="bank-tag active">使用中</span>}
                    {updatable && <span className="bank-tag update">有更新</span>}
                    {!entry.builtin && entry.installed && !updatable && (
                      <span className="bank-tag">已下载</span>
                    )}
                  </div>
                  {(entry.subtitle || entry.description) && (
                    <p className="bank-row-desc">{entry.subtitle || entry.description}</p>
                  )}
                  <p className="bank-row-meta">
                    v{entry.version} · {formatCount(entry.questionCount)} · {entry.chapterCount} 章
                  </p>
                </div>
                <div className="bank-row-actions">
                  {current ? (
                    <span className="bank-current">
                      <Icon name="check" size={14} />
                      当前
                    </span>
                  ) : entry.builtin || entry.installed ? (
                    <button className="btn primary sm" onClick={() => void switchBank(entry.id)}>
                      切换
                    </button>
                  ) : (
                    <button
                      className="btn primary sm"
                      disabled={busy}
                      onClick={() => void runInstall(entry.id)}>
                      {busy ? '下载中…' : downloadLabel}
                    </button>
                  )}

                  {updatable && (
                    <button
                      className="btn ghost sm"
                      disabled={busy}
                      onClick={() => void runInstall(entry.id)}>
                      <Icon name="download" size={14} />
                      {busy ? '更新中…' : '更新'}
                    </button>
                  )}

                  {!entry.builtin && entry.installed && (
                    <button
                      className="text-btn danger"
                      disabled={busy}
                      onClick={() => {
                        setClearProgress(false);
                        setPendingDelete(entry.installed);
                      }}>
                      删除
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>

        {!cloud.user && (
          <p className="bank-foot">
            未登录只能使用内置题库；登录并兑换会员后可下载云端题库。
          </p>
        )}
        {cloud.user && !isMember && (
          <p className="bank-foot">
            当前为免费账号，题库下载与多端同步需要会员。已下载的题库可继续离线使用。
          </p>
        )}
      </section>

      <dialog
        ref={dlgRef}
        className="confirm-dialog bank-delete-dialog"
        aria-labelledby="bank-delete-title"
        onClose={() => setPendingDelete(null)}
        onMouseDown={(e) => {
          if (e.target === dlgRef.current) setPendingDelete(null);
        }}>
        {pendingDelete && (
          <>
            <div className="dialog-head">
              <h2 id="bank-delete-title">删除「{pendingDelete.name}」？</h2>
            </div>
            <p className="confirm-body">
              题库文件会从本机删除，云端进度不受影响。重新下载后可继续学习。
            </p>
            <label className="bank-delete-option">
              <input
                type="checkbox"
                checked={clearProgress}
                onChange={(e) => setClearProgress(e.target.checked)}
              />
              <span>
                同时删除本机进度
                <small>该题库的作答、错题、收藏与心得记录将被清除，不可恢复</small>
              </span>
            </label>
            <div className="dialog-foot confirm-foot">
              <button className="btn ghost" data-cancel onClick={() => setPendingDelete(null)}>
                取消
              </button>
              <button className="btn primary" onClick={() => void confirmDelete()}>
                删除
              </button>
            </div>
          </>
        )}
      </dialog>
    </div>
  );
}