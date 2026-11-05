import { useEffect, useState } from 'react';
import { normalizeState } from '@megrez/core';
import { useQuiz, type CloudPhase } from '../store/QuizStore';
import { Icon, type IconName } from '../components/Icon';
import { confirmAction, notify } from '../components/Feedback';

const PHASE_LABEL: Record<CloudPhase, string> = {
  'signed-out': '未登录',
  'signing-in': '等待授权',
  syncing: '同步中',
  synced: '已同步',
  offline: '离线',
  error: '连接出错',
};

type Section = 'account' | 'practice' | 'data';

/** 自动下一题的预设档位（毫秒）；不在这几个值里的都算自定义 */
const AUTO_PRESETS = [0, 1000, 1600, 2500, 4000];
const CUSTOM_MIN_SEC = 0.5;
const CUSTOM_MAX_SEC = 10;

/** 自定义秒数收敛到 0 或 0.5–10，并保留一位小数 */
function normalizeSeconds(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const clamped = Math.min(Math.max(value, CUSTOM_MIN_SEC), CUSTOM_MAX_SEC);
  return Math.round(clamped * 10) / 10;
}

const SECTIONS: { id: Section; label: string; hint: string; icon: IconName }[] = [
  { id: 'account', label: '账号与同步', hint: '登录、账户与服务器', icon: 'cloud' },
  { id: 'practice', label: '答题设置', hint: '题量、判分与反馈', icon: 'settings' },
  { id: 'data', label: '数据与备份', hint: '导入、导出与清空', icon: 'download' },
];

export function SettingsView() {
  const {
    settings,
    patchSettings,
    state,
    replaceState,
    resetProgress,
    cloud,
    login,
    register,
    logout,
    syncNow,
    setServerUrl,
  } = useQuiz();
  const [section, setSection] = useState<Section>('account');
  const [serverInput, setServerInput] = useState(cloud.serverUrl);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  // 自定义自动跳转时长：进入页面时若当前值不在预设里就直接展开输入框
  const [customAuto, setCustomAuto] = useState(
    () => !AUTO_PRESETS.includes(settings.autoNext),
  );
  const [customSeconds, setCustomSeconds] = useState(() =>
    String(normalizeSeconds(settings.autoNext / 1000)),
  );
  // 同步回来的值不在预设里（或用户刚选了「自定义…」）时展示输入框
  const showCustom = customAuto || !AUTO_PRESETS.includes(settings.autoNext);

  const signingIn = cloud.phase === 'signing-in';
  const canSubmit = username.trim().length > 0 && password.length > 0 && !signingIn;

  const submit = (mode: 'login' | 'register') => {
    if (!canSubmit) return;
    void (mode === 'login' ? login(username.trim(), password) : register(username.trim(), password));
  };

  /** 切到「自定义…」时以当前时长作为起点，没有时长就用 2 秒 */
  const changeAutoNext = (raw: string) => {
    if (raw === 'custom') {
      const seed = normalizeSeconds(settings.autoNext / 1000) || 2;
      setCustomAuto(true);
      setCustomSeconds(String(seed));
      patchSettings({ autoNext: Math.round(seed * 1000) });
      return;
    }
    setCustomAuto(false);
    patchSettings({ autoNext: +raw });
  };

  /** 输入过程中即时生效；空值或非数字先不写入，等失焦再兜底 */
  const editCustomSeconds = (raw: string) => {
    setCustomSeconds(raw);
    const n = Number(raw);
    if (raw.trim() === '' || !Number.isFinite(n)) return;
    patchSettings({ autoNext: Math.round(normalizeSeconds(n) * 1000) });
  };

  const commitCustomSeconds = () => {
    const n = Number(customSeconds);
    const sec =
      customSeconds.trim() === '' || !Number.isFinite(n)
        ? normalizeSeconds(settings.autoNext / 1000)
        : normalizeSeconds(n);
    setCustomSeconds(String(sec));
    patchSettings({ autoNext: Math.round(sec * 1000) });
  };

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, []);

  const answered = Object.keys(state.answers).length;
  const favoriteCount = Object.keys(state.favorites).length;
  const noteCount = Object.values(state.notes).reduce((sum, list) => sum + list.length, 0);

  const exportProgress = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = `天权进度-${new Date().toISOString().slice(0, 10)}.json`;
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
            notify('导入成功');
          } else {
            notify('文件格式不正确', 'error');
          }
        } catch {
          notify('文件格式不正确', 'error');
        }
      };
      r.readAsText(f);
    };
    inp.click();
  };

  return (
    <div className="view-page">
      <header className="view-head">
        <div className="view-head-copy">
          <h1>设置与数据</h1>
          <p className="page-sub">账号同步、答题偏好与本机数据管理</p>
        </div>
      </header>

      <div className="side-layout">
        <nav className="side-nav" aria-label="设置分类">
          {SECTIONS.map((item) => (
            <button
              key={item.id}
              className={`side-nav-item${section === item.id ? ' active' : ''}`}
              onClick={() => setSection(item.id)}
              aria-current={section === item.id ? 'page' : undefined}
            >
              <Icon name={item.icon} size={17} />
              <span className="side-nav-copy">
                <strong>{item.label}</strong>
                <small>{item.hint}</small>
              </span>
              <Icon name="chevron-right" size={14} className="chev" />
            </button>
          ))}
        </nav>

        <div className="side-content">
          {section === 'account' && (
            <section className="panel settings-panel" aria-labelledby="settings-account">
              <div className="panel-head">
                <h2 id="settings-account">账号与同步</h2>
                <span className={`sync-state ${cloud.phase}`}>{PHASE_LABEL[cloud.phase]}</span>
              </div>

              {cloud.user ? (
                <div className="account-row">
                  <span className="avatar">
                    <Icon name="user" size={18} />
                  </span>
                  <div className="account-copy">
                    <strong>{cloud.user.name || cloud.user.username}</strong>
                    <p>
                      @{cloud.user.username}
                      {cloud.lastSyncAt
                        ? `，最近同步 ${new Date(cloud.lastSyncAt).toLocaleTimeString('zh-CN', {
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
                <form
                  className="auth-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    submit('login');
                  }}
                >
                  <p className="auth-hint">
                    登录后进度、收藏、心得和成就会在多端同步；不登录也能离线使用。首次使用可直接注册。
                  </p>
                  <div className="auth-fields">
                    <label>
                      <span>用户名</span>
                      <input
                        type="text"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        autoComplete="username"
                        autoCapitalize="none"
                        spellCheck={false}
                        placeholder="3 到 32 位字母、数字或 _ . -"
                      />
                    </label>
                    <label>
                      <span>密码</span>
                      <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        autoComplete="current-password"
                        placeholder="至少 8 位"
                      />
                    </label>
                  </div>
                  <div className="auth-actions">
                    <button className="btn primary sm" type="submit" disabled={!canSubmit}>
                      {signingIn ? '处理中…' : '登录'}
                    </button>
                    <button
                      className="btn ghost sm"
                      type="button"
                      disabled={!canSubmit}
                      onClick={() => submit('register')}
                    >
                      注册新账号
                    </button>
                  </div>
                </form>
              )}

              <p
                className="cloud-error"
                role="status"
                aria-live="polite">
                {cloud.error}
              </p>

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
          )}

          {section === 'practice' && (
            <section className="panel settings-panel" aria-labelledby="settings-practice">
              <div className="panel-head">
                <h2 id="settings-practice">答题设置</h2>
                <span>每题组 {settings.count} 题</span>
              </div>

              <h3 className="settings-group-title">抽题与判分</h3>

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
                  <p>答错始终停留；自定义可设 0 到 10 秒</p>
                </div>
                <div className="setting-control auto-custom">
                  <select
                    id="set-auto"
                    value={showCustom ? 'custom' : String(settings.autoNext)}
                    onChange={(e) => changeAutoNext(e.target.value)}
                  >
                    <option value={1000}>1 秒</option>
                    <option value={1600}>1.6 秒</option>
                    <option value={2500}>2.5 秒</option>
                    <option value={4000}>4 秒</option>
                    <option value={0}>不自动</option>
                    <option value="custom">自定义…</option>
                  </select>
                  {showCustom && (
                    <span className="auto-custom-field">
                      <input
                        className="auto-seconds"
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        aria-label="自定义自动跳转秒数，0 表示不自动"
                        value={customSeconds}
                        onChange={(e) => editCustomSeconds(e.target.value)}
                        onBlur={commitCustomSeconds}
                      />
                      <span className="auto-custom-unit">秒</span>
                    </span>
                  )}
                </div>
              </div>

              <h3 className="settings-group-title">反馈</h3>

              <div className="setting-row">
                <div className="setting-copy">
                  <label htmlFor="set-sound">答题音效</label>
                  <p>答对与答错时播放短提示音</p>
                </div>
                <div className="setting-control">
                  <select
                    id="set-sound"
                    value={settings.sound}
                    onChange={(e) => patchSettings({ sound: (+e.target.value) as 0 | 1 })}
                  >
                    <option value={1}>开启</option>
                    <option value={0}>关闭</option>
                  </select>
                </div>
              </div>

              <div className="setting-row">
                <div className="setting-copy">
                  <label htmlFor="set-haptics">触觉反馈</label>
                  <p>答错时在手机上轻震一下，桌面端无效果</p>
                </div>
                <div className="setting-control">
                  <select
                    id="set-haptics"
                    value={settings.haptics}
                    onChange={(e) => patchSettings({ haptics: (+e.target.value) as 0 | 1 })}
                  >
                    <option value={1}>开启</option>
                    <option value={0}>关闭</option>
                  </select>
                </div>
              </div>
            </section>
          )}

          {section === 'data' && (
            <section className="panel settings-panel" aria-labelledby="settings-data">
              <div className="panel-head">
                <h2 id="settings-data">本机数据</h2>
                <span>仅存于当前设备</span>
              </div>

              <dl className="settings-stats">
                <div>
                  <dt>已作答</dt>
                  <dd>{answered}</dd>
                </div>
                <div>
                  <dt>收藏</dt>
                  <dd>{favoriteCount}</dd>
                </div>
                <div>
                  <dt>题目心得</dt>
                  <dd>{noteCount}</dd>
                </div>
              </dl>

              <div className="setting-row">
                <div className="setting-copy">
                  <label>导出进度</label>
                  <p>把答题记录、收藏、心得和设置保存为 JSON 文件</p>
                </div>
                <div className="setting-control">
                  <button className="btn ghost sm" onClick={exportProgress}>
                    <Icon name="download" size={14} />
                    导出
                  </button>
                </div>
              </div>

              <div className="setting-row">
                <div className="setting-copy">
                  <label>导入进度</label>
                  <p>从备份文件恢复，同名记录以文件为准</p>
                </div>
                <div className="setting-control">
                  <button className="btn ghost sm" onClick={importProgress}>
                    <Icon name="upload" size={14} />
                    导入
                  </button>
                </div>
              </div>

              <div className="setting-row">
                <div className="setting-copy">
                  <label>清空答题记录</label>
                  <p>清除作答与错题记录，收藏和题目心得会保留</p>
                </div>
                <div className="setting-control">
                  <button
                    className="btn ghost sm danger"
                    onClick={() => {
                      void confirmAction({
                        title: '清空答题记录？',
                        body: '作答与错题记录会被清除，收藏和题目心得保留。此操作不可恢复。',
                        confirmLabel: '清空',
                        danger: true,
                      }).then((ok) => {
                        if (ok) resetProgress();
                      });
                    }}
                  >
                    清空
                  </button>
                </div>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}