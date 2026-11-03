import { useEffect, useRef } from 'react';
import { useQuiz } from '../store/QuizStore';

export function SettingsDialog() {
  const { settings, patchSettings, state, replaceState, resetProgress } = useQuiz();
  const ref = useRef<HTMLDialogElement>(null);

  const exportProgress = () => {
    const blob = new Blob([JSON.stringify(state)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '答题进度备份.json';
    a.click();
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
            replaceState(d);
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
    <dialog id="settings" ref={ref}>
      <h3>⚙️ 设置与数据</h3>
      <div className="field">
        <label>随机练习每题数量</label>
        <input
          type="number"
          min={5}
          max={200}
          step={5}
          value={settings.count}
          onChange={(e) => patchSettings({ count: Math.max(5, Math.min(200, +e.target.value || 20)) })}
        />
      </div>
      <div className="field">
        <label>选项乱序（防止死记 ABCD 位置）</label>
        <select
          value={settings.shuffle}
          onChange={(e) => patchSettings({ shuffle: (+e.target.value) as 0 | 1 })}
        >
          <option value={0}>关闭</option>
          <option value={1}>开启</option>
        </select>
      </div>
      <div className="field">
        <label>答题方式</label>
        <select
          value={settings.instant}
          onChange={(e) => patchSettings({ instant: (+e.target.value) as 0 | 1 })}
        >
          <option value={1}>点击选项立即判分</option>
          <option value={0}>选中后需点"确认答案"</option>
        </select>
      </div>
      <div className="field">
        <label>答对后自动进入下一题（答错始终停留）</label>
        <select
          value={settings.autoNext}
          onChange={(e) => patchSettings({ autoNext: +e.target.value })}
        >
          <option value={1000}>1 秒</option>
          <option value={1600}>1.6 秒（默认）</option>
          <option value={2500}>2.5 秒</option>
          <option value={4000}>4 秒</option>
          <option value={0}>不自动（答对也手动继续）</option>
        </select>
      </div>
      <div className="actions" style={{ justifyContent: 'flex-start' }}>
        <button className="btn" onClick={exportProgress}>导出进度 JSON</button>
        <button className="btn" onClick={importProgress}>导入进度</button>
        <button className="btn" style={{ color: 'var(--bad)' }} onClick={() => { if (confirm('确定清空所有答题记录？此操作不可恢复。')) resetProgress(); }}>
          清空记录
        </button>
        <button className="btn primary" onClick={() => ref.current?.close()}>完成</button>
      </div>
    </dialog>
  );
}