import { useState, type KeyboardEvent } from 'react';
import { notesFor, type Question } from '@quiz/core';
import { useQuiz } from '../store/QuizStore';
import { Icon } from './Icon';

export function QuestionNotes({
  question,
  onComposeStart,
  className,
}: {
  question: Question;
  /** 答题解析页传入：开始写心得时取消自动跳题 */
  onComposeStart?: () => void;
  className?: string;
}) {
  const { state, addNote } = useQuiz();
  const notes = notesFor(state, question);
  const [text, setText] = useState('');

  const submit = () => {
    if (!text.trim()) return;
    addNote(question, text);
    setText('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  };

  return (
    <section
      className={`question-notes${className ? ` ${className}` : ''}`}
      aria-label="我的心得"
    >
      <div className="notes-head">
        <span className="notes-title">
          <Icon name="pen" size={14} />
          我的心得
        </span>
        <span className="notes-count">
          {notes.length ? `${notes.length} 条 · 最新在前` : '记录理解与易错点'}
        </span>
      </div>

      <div className="note-compose">
        <textarea
          className="note-input"
          value={text}
          rows={2}
          placeholder="写下这道题的理解、错因或记忆点…"
          aria-label="记录心得"
          onFocus={onComposeStart}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="note-compose-foot">
          <span className="note-hint">⌘/Ctrl + Enter 记录</span>
          <button
            type="button"
            className="btn primary sm"
            disabled={!text.trim()}
            onClick={submit}
          >
            记录
          </button>
        </div>
      </div>

      {notes.length > 0 && (
        <ol className="note-list">
          {[...notes].reverse().map((note) => (
            <li className="note-item" key={note.id}>
              <time>{formatTime(note.at)}</time>
              <p>{note.text}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function formatTime(at: number): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '时间未知';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}