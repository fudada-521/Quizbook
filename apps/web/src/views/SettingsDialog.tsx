import { useRef, useState } from 'react';
import { normalizeState } from '@quiz/core';
import { useQuiz, type CloudPhase } from '../store/QuizStore';
import { Icon } from '../components/Icon';

const PHASE_LABEL: Record<CloudPhase, string> = {
  'signed-out': '未登录',
  'signing-in': '等待授权',
  syncing: '同步中',
  synced: '已同步',
  offline: '离线',
  error: '同步出错',
};

export function SettingsDialog() {
  const {
    settings,
    patchSettings,
    state,
    replaceState,
    resetProgress,
    cloud,
    login,
    cancelLogin,
    logout,
    syncNow,
    setServerUrl,
    openVerificationPage,
  } = useQuiz();
  const ref = useRef<HTMLDialogElement>(null);
  const [serverInput, setServerInput] = useState(cloud.serverUrl);

  const close = () => ref.current?.close();

  const exportProgress = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = `题本进度-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importProgress = () => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.json';
    inp.onchange = () => {
      const f = inp.files?.[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        try {
          const d = JSON.parse(String(r.result));
          if (d && d.answers) {
            replaceState(normalizeState(d));
            alert('导入成功');
          } else {
            alert('文件格式不正确');
          }
        } catch {
          alert('文件格式不正确');
        }
      };
      r.readAsText(f);
    };
    inp.click();
  };

  return (
    <dialog
      id="settings"
      ref={ref}
      onMouseDown={(e) => {
        if (e.target === ref.current) close();
      }}
    >
      <div className="dialog-head">
        <h2>设置与数据</h2>
        <button className="icon-btn" onClick={close} aria-label="关闭">
          <Icon name="x" size={17} />
        </button>
      </div>

      <div className="dialog-body">
        <section className="account-section">
          <div className="panel-head">
            <h2>账号与同步</h2>
            <span className={`sync-state ${cloud.phase}`}>{PHASE_LABEL[cloud.phase]}</span>
          </div>

          {cloud.user ? (
            <div className="account-row">
              <span className="avatar">
                {cloud.user.avatarUrl ? (
                  <img src={cloud.user.avatarUrl} alt="" />
                ) : (
                  <Icon name="user" size={18} />
                )}
              </span>
              <div className="account-copy">
                <strong>{cloud.user.name || cloud.user.login}</strong>
                <p>
                  @{cloud.user.login}
                  {cloud.lastSyncAt
                    ? ` · 最近同步 ${new Date(cloud.lastSyncAt).toLocaleTimeString('zh-CN', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}`
                    : ''}
                </p>
              </div>
              <div className="account-actions">
                <button
                  className="btn ghost sm"
                  onClick={() => void syncNow()}
                  disabled={cloud.phase === 'syncing'}
                >
                  {cloud.phase === 'syncing' ? '同步中…' : '立即同步'}
                </button>
                <button className="text-btn danger" onClick={() => void logout()}>
                  退出登录
                </button>
              </div>
            </div>
          ) : (
            <div className="account-row">
              <div className="setting-copy">
                <label>GitHub 登录</label>
                <p>登录后进度、收藏、心得和成就会在 Web / 桌面 / 手机之间同步；不登录也能照常离线使用。</p>
              </div>
              <button
                className="btn primary sm"
                onClick={() => void login()}
                disabled={cloud.phase === 'signing-in'}
              >
                {cloud.phase === 'signing-in' ? '等待授权…' : '登录'}
              </button>
            </div>
          )}

          {cloud.pendingDevice && (
            <div className="device-panel">
              <p>已在浏览器打开验证页。请确认验证码一致：</p>
              <div className="device-code">{cloud.pendingDevice.userCode}</div>
              <div className="device-actions">
                <a
                  className="btn ghost sm"
                  href={cloud.pendingDevice.verificationUrl}
                  target="_blank"
                  rel="noreferrer"
                  onClick={openVerificationPage}
                >
                  打开验证页
                </a>
                <button className="text-btn" onClick={cancelLogin}>
                  取消
                </button>
              </div>
            </div>
          )}

          {cloud.error && <p className="cloud-error">{cloud.error}</p>}

          <div className="server-row">
            <label htmlFor="set-server">服务器地址</label>
            <div className="server-input">
              <input
                id="set-server"
                type="url"
                value={serverInput}
                placeholder="http://127.0.0.1:8787"
                onChange={(e) => setServerInput(e.target.value)}
              />
              <button
                className="btn ghost sm"
                disabled={!serverInput.trim() || serverInput.trim() === cloud.serverUrl}
                onClick={() => setServerUrl(serverInput)}
              >
                保存
              </button>
            </div>
            <p>更换地址会退出当前账号，本机数据保留。</p>
          </div>
        </section>

        <div className="setting-row">
          <div className="setting-copy">
            <label htmlFor="set-count">每组题量</label>
            <p>随机练习和智能推进每次抽取的题目数量</p>
          </div>
          <div className="setting-control">
            <input
              id="set-count"
              type="number"
              min={5}
              max={200}
              step={5}
              value={settings.count}
              onChange={(e) =>
                patchSettings({ count: Math.max(5, Math.min(200, +e.target.value || 20)) })
              }
            />
          </div>
        </div>

        <div className="setting-row">
          <div className="setting-copy">
            <label htmlFor="set-shuffle">选项乱序</label>
            <p>打乱选项顺序，避免死记选项</p>
          </div>
          <div className="setting-control">
            <select
              id="set-shuffle"
              value={settings.shuffle}
              onChange={(e) => patchSettings({ shuffle: (+e.target.value) as 0 | 1 })}
            >
              <option value={0}>关闭</option>
              <option value={1}>开启</option>
            </select>
          </div>
        </div>

        <div className="setting-row">
          <div className="setting-copy">
            <label htmlFor="set-instant">答题方式</label>
            <p>点选后立即判分，或选中后再确认</p>
          </div>
          <div className="setting-control">
            <select
              id="set-instant"
              value={settings.instant}
              onChange={(e) => patchSettings({ instant: (+e.target.value) as 0 | 1 })}
            >
              <option value={1}>点选即判分</option>
              <option value={0}>选中后确认</option>
            </select>
          </div>
        </div>

        <div className="setting-row">
          <div className="setting-copy">
            <label htmlFor="set-auto">答对后自动下一题</label>
            <p>答错始终停留，便于阅读解析</p>
          </div>
          <div className="setting-control">
            <select
              id="set-auto"
              value={settings.autoNext}
              onChange={(e) => patchSettings({ autoNext: +e.target.value })}
            >
              <option value={1000}>1 秒</option>
              <option value={1600}>1.6 秒</option>
              <option value={2500}>2.5 秒</option>
              <option value={4000}>4 秒</option>
              <option value={0}>不自动</option>
            </select>
          </div>
        </div>
      </div>

      <div className="dialog-foot">
        <div className="dialog-tools">
          <button className="text-btn" onClick={exportProgress}>
            <Icon name="download" size={14} />
            导出进度
          </button>
          <button className="text-btn" onClick={importProgress}>
            <Icon name="upload" size={14} />
            导入进度
          </button>
          <button
            className="text-btn danger"
            onClick={() => {
              if (confirm('确定清空所有答题记录？此操作不可恢复。')) resetProgress();
            }}
          >
            清空记录
          </button>
        </div>
        <button className="btn primary sm" onClick={close}>
          完成
        </button>
      </div>
    </dialog>
  );
}