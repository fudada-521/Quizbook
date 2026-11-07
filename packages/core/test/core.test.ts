import { readFileSync } from 'node:fs';
import { createSession, gradeAnswer, normalizeState, normalizeQuizData, validateBank, shouldAutoAdvance, wrongQuestions, unansweredQuestions, questionsOfChapter, qkey, isFavorite, toggleFavorite, favoriteQuestions, notesFor, addQuestionNote, mergeStates, dailyQuestions, scoreSession, makeChallengeRecord, ACHIEVEMENTS, achievementStats, achievementProgress, evaluateAchievements, resetProgressState, resetAllLearningState, gradeAnswer as grade, DEFAULT_SETTINGS, SCHEMA_VERSION, dateKey, BUILTIN_BANK_ID, type QuizData, type PersistedState } from '../src/index.ts';

const data: QuizData = {
  id: 'test-bank',
  name: '测试题库',
  version: 1,
  generatedFrom: 'test',
  chapters: { 1: '第一章', 2: '第二章' },
  questions: [
    { id: '1-1', c: 1, n: 1, s: '题1', o: ['A', 'B', 'C', 'D'], a: 0, e: '解析1' },
    { id: '1-2', c: 1, n: 2, s: '题2', o: ['A', 'B', 'C', 'D'], a: 3, e: '解析2' },
    { id: '2-1', c: 2, n: 1, s: '题3', o: ['A', 'B', 'C', 'D'], a: 1, e: '解析3' },
  ],
};
let passes=0, fails=0;
function ok(cond: boolean, msg: string){ if(cond){passes++;} else {fails++; console.log('FAIL:', msg);} }

const ch1 = questionsOfChapter(data, 1);
ok(ch1.length===2 && ch1[0].n===1 && ch1[1].n===2, 'chapter order');

const sess = createSession(ch1, 't', { shuffle: true });
ok(sess.list.length===2, 'session length');

const sourced = createSession(ch1, '第一章', { origin: 'chapter:1' });
ok(sourced.origin==='chapter:1' && sourced.idx===0 && (sourced.updatedAt ?? 0)>0, 'session origin + timestamp');
const item = sess.list[0];
const sortedMap = [...item.map].sort((a,b)=>a-b);
ok(JSON.stringify(sortedMap)==='[0,1,2,3]', 'map is permutation');

const st = normalizeState({});
ok(st.settings.count===DEFAULT_SETTINGS.count && Object.keys(st.answers).length===0, 'normalize defaults');
ok(st.schemaVersion===SCHEMA_VERSION && Object.keys(st.favorites).length===0 && Object.keys(st.notes).length===0, 'normalize favorites + notes + schema');

// 旧版（schemaVersion 1）数据迁移后补全 favorites / notes
const migrated = normalizeState({ schemaVersion: 1, answers: {}, wrong: {}, settings: {} });
ok(migrated.schemaVersion===SCHEMA_VERSION && migrated.favorites != null && migrated.notes != null, 'v1 migration adds favorites + notes');

const state = normalizeState({});
const pickCorrect = item.map.indexOf(item.q.a);
const r1 = gradeAnswer(state, item, pickCorrect);
ok(r1.ok===true, 'correct grade ok');
ok(state.answers[qkey(item.q)].ok===true, 'answer recorded');
ok(!state.wrong[qkey(item.q)], 'no wrong entry on correct');

const item2 = sess.list[1];
const pickWrong = (item2.map.indexOf(item2.q.a)+1)%4;
const r2 = gradeAnswer(state, item2, pickWrong);
ok(r2.ok===false, 'wrong grade not ok');
ok(state.wrong[qkey(item2.q)]===1, 'wrong entry recorded');

const SET = {count:20,shuffle:0 as const,instant:1 as const,autoNext:1600,sound:1 as const,haptics:1 as const};
ok(shouldAutoAdvance(true, SET, false)===true, 'auto on correct');
ok(shouldAutoAdvance(false, SET, false)===false, 'no auto on wrong');
ok(shouldAutoAdvance(true, {...SET,autoNext:0}, false)===false, 'no auto when autoNext=0');
ok(shouldAutoAdvance(true, SET, true)===false, 'no auto in reviewOnly');
ok(shouldAutoAdvance(true, SET, false, false)===false, 'no auto when revisiting an answered question');

// 刚判分的题带 fresh 标记，翻题离开后清掉
const freshItem = createSession(ch1, 't').list[0];
ok(freshItem.fresh !== true, 'new session item is not fresh');
gradeAnswer(normalizeState({}), freshItem, freshItem.map.indexOf(freshItem.q.a));
ok(freshItem.fresh === true, 'grade marks item fresh');

const wq = wrongQuestions(data, state);
ok(wq.length===1 && qkey(wq[0])==='1-2', 'wrongQuestions');
const uq = unansweredQuestions(data, state);
ok(uq.length===1 && qkey(uq[0])==='2-1', 'unansweredQuestions');

// 收藏：切换、时间排序、与答题状态互不影响
const favState = normalizeState({});
ok(!isFavorite(favState, data.questions[0]), 'not favorite initially');
ok(toggleFavorite(favState, data.questions[0], 100)===true && isFavorite(favState, data.questions[0]), 'add favorite');
ok(toggleFavorite(favState, data.questions[2], 200)===true, 'add second favorite');
ok(favState.answers[qkey(data.questions[0])] == null, 'favorite does not touch answers');
const favs = favoriteQuestions(data, favState);
ok(favs.length===2 && qkey(favs[0])==='2-1' && qkey(favs[1])==='1-1', 'favorites newest first');
ok(toggleFavorite(favState, data.questions[0], 300)===false && !isFavorite(favState, data.questions[0]), 'remove favorite');

// 心得：追加、去空白、按题隔离
const noteState = normalizeState({});
const n1 = addQuestionNote(noteState, data.questions[0], '  第一条心得  ', 100);
const n2 = addQuestionNote(noteState, data.questions[0], '第二条心得', 200);
ok(n1?.text==='第一条心得' && n2?.text==='第二条心得', 'add note trims text');
ok(addQuestionNote(noteState, data.questions[0], '   ', 300)===null, 'blank note ignored');
const timeline = notesFor(noteState, data.questions[0]);
ok(timeline.length===2 && timeline[0].text==='第一条心得' && timeline[1].text==='第二条心得', 'notes append chronological');
ok(timeline[0].id !== timeline[1].id, 'note ids unique');
ok(notesFor(noteState, data.questions[1]).length===0, 'notes scoped by question');
ok(noteState.answers[qkey(data.questions[0])] == null, 'note does not touch answers');

// ---------- schema v4：新增字段与迁移 ----------
const v4 = normalizeState({ schemaVersion: 3, answers: {}, wrong: {}, favorites: {}, notes: {}, settings: {} });
ok(v4.schemaVersion === SCHEMA_VERSION, 'schema bumped to current version');
ok(v4.favoriteRemovals && v4.daily && v4.achievements && Array.isArray(v4.challenges), 'v4 migration fills sync fields');
ok(v4.resetAt === 0 && v4.settingsAt === 0, 'v4 migration defaults timestamps');

// ---------- schema v5：音效 / 触觉开关 ----------
const v5 = normalizeState({ schemaVersion: 4, answers: {}, wrong: {}, favorites: {}, notes: {}, settings: {} });
ok(v5.schemaVersion === SCHEMA_VERSION, 'schema bumped to current version');
ok(v5.settings.sound === 1 && v5.settings.haptics === 1, 'v5 migration adds feedback settings');
const v5off = normalizeState({ schemaVersion: 5, answers: {}, wrong: {}, favorites: {}, notes: {}, settings: { sound: 0, haptics: 0 } });
ok(v5off.settings.sound === 0 && v5off.settings.haptics === 0, 'v5 keeps explicit feedback settings');
ok(v5off.settings.count === DEFAULT_SETTINGS.count, 'v5 fills missing settings from defaults');

// ---------- schema v6：清空全部数据的纪元 ----------
const v6 = normalizeState({ schemaVersion: 5, answers: {}, wrong: {}, favorites: {}, notes: {}, settings: {} });
ok(v6.schemaVersion === 6 && v6.dataResetAt === 0, 'v6 migration defaults dataResetAt');

// ---------- 合并：作答 / 错题 ----------
const base = normalizeState({});
const aState: PersistedState = normalizeState({
  ...base,
  answers: { '1-1': { ok: true, tries: 1, t: 200 } },
  wrong: {},
});
const bState: PersistedState = normalizeState({
  ...base,
  answers: {
    '1-1': { ok: false, tries: 2, t: 300 },
    '1-2': { ok: true, tries: 1, t: 150 },
  },
  wrong: { '1-1': 2 },
});
const merged = mergeStates(aState, bState);
ok(merged.answers['1-1'].ok === false && merged.answers['1-1'].t === 300, 'merge answers by newer timestamp');
ok(merged.answers['1-1'].tries === 2, 'merge tries by max');
ok(merged.answers['1-2'].ok === true, 'merge answers union');
ok(merged.wrong['1-1'] === 2, 'wrong kept when latest answer is wrong');

const corrected = mergeStates(merged, normalizeState({ answers: { '1-1': { ok: true, tries: 1, t: 400 } } }));
ok(!corrected.wrong['1-1'], 'wrong removed after later correct answer');

// ---------- 合并：收藏删除墓碑 ----------
const favA = normalizeState({ favorites: { '1-1': 100 }, favoriteRemovals: { '1-1': 200 } });
const favB = normalizeState({ favorites: { '1-1': 50, '1-2': 120 } });
const favMerged = mergeStates(favA, favB);
ok(!favMerged.favorites['1-1'] && favMerged.favoriteRemovals['1-1'] === 200, 'favorite removal wins over older add');
ok(favMerged.favorites['1-2'] === 120, 'favorite union');

// ---------- 合并：心得去重 / 设置后写胜 ----------
const noteA = normalizeState({ notes: { '1-1': [{ id: 'n1', text: 'a', at: 100 }] } });
const noteB = normalizeState({ notes: { '1-1': [{ id: 'n1', text: 'a', at: 100 }, { id: 'n2', text: 'b', at: 200 }] } });
ok(mergeStates(noteA, noteB).notes['1-1'].length === 2, 'notes union dedupe by id');

const setA = normalizeState({ settings: { ...DEFAULT_SETTINGS, count: 10 }, settingsAt: 100 });
const setB = normalizeState({ settings: { ...DEFAULT_SETTINGS, count: 50 }, settingsAt: 200 });
ok(mergeStates(setA, setB).settings.count === 50, 'settings newer wins');

// ---------- 合并：resetAt 丢弃旧数据 ----------
const resetA = normalizeState({ resetAt: 1000, answers: {}, wrong: {} });
const oldB = normalizeState({ answers: { '1-1': { ok: true, tries: 1, t: 500 } } });
ok(!mergeStates(resetA, oldB).answers['1-1'], 'resetAt drops pre-reset answers');
const newB = normalizeState({ answers: { '1-2': { ok: true, tries: 1, t: 1500 } } });
ok(mergeStates(resetA, newB).answers['1-2'].ok === true, 'post-reset answers kept');

// 合并幂等
const once = mergeStates(aState, bState);
const twice = mergeStates(once, bState);
ok(JSON.stringify(once) === JSON.stringify(twice), 'merge is idempotent');

// ---------- 每日一练确定性 ----------
const day = '2026-11-03';
const d1 = dailyQuestions(data, day);
const d2 = dailyQuestions(data, day);
ok(d1.length === 3 && JSON.stringify(d1.map(qkey)) === JSON.stringify(d2.map(qkey)), 'daily questions deterministic');
ok(dailyQuestions(data, '2026-11-04').length === 3, 'daily questions valid for another date');

// ---------- 挑战成绩 ----------
const examSession = createSession(data.questions, '模拟考', { mode: 'exam', startedAt: 1000, durationMs: 9000 });
examSession.list.forEach((it) => { it.done = true; it.lastPick = it.map.indexOf(it.q.a); });
ok(scoreSession(examSession).score === 3, 'scoreSession counts correct');
const examRec = makeChallengeRecord(examSession, 5000);
ok(examRec?.kind === 'exam' && examRec.score === 3 && examRec.total === 3 && examRec.passed === false, 'exam record fields');
const dailySession = createSession(data.questions, '每日一练', { mode: 'daily', date: day, startedAt: 1000 });
dailySession.list.forEach((it) => { it.done = true; it.lastPick = it.map.indexOf(it.q.a); });
ok(makeChallengeRecord(dailySession, 2000)?.kind === 'daily', 'daily challenge record');

// ---------- 成就 ----------
const achState = normalizeState({
  answers: {
    '1-1': { ok: true, tries: 1, t: 1000 },
    '1-2': { ok: true, tries: 1, t: 1001 },
    '2-1': { ok: true, tries: 1, t: 1002 },
  },
  notes: { '1-1': [{ id: 'x', text: '记', at: 1003 }] },
  daily: {
    '2026-11-01': { date: '2026-11-01', answered: 1, correct: 1, completed: false, t: 1 },
    '2026-11-02': { date: '2026-11-02', answered: 1, correct: 1, completed: false, t: 2 },
    '2026-11-03': { date: '2026-11-03', answered: 1, correct: 1, completed: true, t: 3 },
  },
});
const unlocked = evaluateAchievements(achState, data, 2000);
ok(Boolean(unlocked.first_steps), 'achievement first_steps');
ok(Boolean(unlocked.chapter_clear), 'achievement chapter_clear');
ok(Boolean(unlocked.note_first), 'achievement note_first');
ok(Boolean(unlocked.streak_3), 'achievement streak_3');
ok(!unlocked.streak_7, 'streak_7 not unlocked');
const progress = achievementProgress(achState, data);
const firstSteps = progress.find((p) => p.id === 'first_steps')!;
ok(firstSteps.unlocked && firstSteps.current === 3, 'achievement progress value');

// 成就目录：40+ 条、id 唯一、含分级与隐藏成就
ok(ACHIEVEMENTS.length >= 40, 'achievement catalog has 40+ entries');
ok(new Set(ACHIEVEMENTS.map((item) => item.id)).size === ACHIEVEMENTS.length, 'achievement ids unique');
ok(ACHIEVEMENTS.filter((item) => item.hidden).length >= 3, 'has hidden achievements');
ok(ACHIEVEMENTS.some((item) => item.tier === 5), 'has diamond tier');

// 用于统计类成就的较大题库（30 章 × 10 题）
const bigData: QuizData = normalizeQuizData(
  {
    generatedFrom: 'test-big',
    chapters: Object.fromEntries(
      Array.from({ length: 30 }, (_, i) => [String(i + 1), `第${i + 1}章`]),
    ),
    questions: Array.from({ length: 300 }, (_, i) => ({
      c: Math.floor(i / 10) + 1,
      n: (i % 10) + 1,
      s: `题${i}`,
      o: ['A', 'B', 'C', 'D'] as [string, string, string, string],
      a: 0,
      e: '',
    })),
  },
  { id: 'test-big', name: '大题库' },
);

// 综合统计：题量、正确率、周末/深夜/大满贯与速度类
const richAnswers: Record<string, { ok: boolean; tries: number; t: number }> = {};
const richWrong: Record<string, number> = {};
const nightTime = new Date(2026, 10, 7, 2, 0, 0).getTime();
for (let i = 0; i < 200; i++) {
  const q = bigData.questions[i];
  const correct = i < 170;
  richAnswers[qkey(q)] = { ok: correct, tries: 1, t: nightTime };
  if (!correct) richWrong[qkey(q)] = 1;
}
const richState = normalizeState({
  answers: richAnswers,
  wrong: richWrong,
  daily: {
    '2026-11-07': { date: '2026-11-07', answered: 100, correct: 85, completed: false, t: 1 },
    '2026-11-08': { date: '2026-11-08', answered: 100, correct: 85, completed: true, t: 2 },
  },
  challenges: [
    {
      id: 'timed-fast',
      kind: 'timed',
      date: '2026-11-08',
      score: 20,
      total: 20,
      durationMs: 5 * 60 * 1000,
      finishedAt: 3,
    },
    {
      id: 'exam-70',
      kind: 'exam',
      date: '2026-11-08',
      score: 70,
      total: 75,
      durationMs: 60 * 60 * 1000,
      finishedAt: 4,
      passed: true,
    },
  ],
});
const richStats = achievementStats(richState, bigData);
ok(richStats.answered === 200 && richStats.correct === 170, 'stats count answers');
ok(richStats.accuracy === 85, 'stats accuracy');
ok(richStats.totalAttempts === 200 && richStats.studyDays === 2, 'stats volume and study days');
ok(richStats.maxDailyAnswered === 100, 'stats max daily answered');
ok(richStats.timedPerfect && richStats.timedFast, 'stats timed perfect and fast');
ok(richStats.examsPassed === 1 && richStats.examBestScore === 70, 'stats exam scores');
ok(richStats.weekendWarrior && richStats.nightOwl, 'stats weekend warrior and night owl');
ok(!richStats.earlyBird && richStats.grandSlam, 'stats grand slam');

const richUnlocked = evaluateAchievements(richState, bigData, 5000);
ok(Boolean(richUnlocked.correct_50), 'achievement correct_50');
ok(Boolean(richUnlocked.accuracy_80_100), 'achievement accuracy_80_100');
ok(Boolean(richUnlocked.accuracy_85_200), 'achievement accuracy_85_200');
ok(!richUnlocked.accuracy_90_300, 'accuracy_90_300 needs more answers');
ok(Boolean(richUnlocked.timed_fast), 'achievement timed_fast');
ok(Boolean(richUnlocked.exam_60), 'achievement exam_60');
ok(Boolean(richUnlocked.night_owl), 'hidden night_owl');
ok(Boolean(richUnlocked.weekend_warrior), 'hidden weekend_warrior');
ok(Boolean(richUnlocked.marathon_day), 'hidden marathon_day');
ok(Boolean(richUnlocked.grand_slam), 'hidden grand_slam');
ok(!richUnlocked.early_bird, 'hidden early_bird not unlocked');
ok(!richUnlocked.no_wrong_100, 'no_wrong_100 needs a clean record');

// 零错题成就：答满 100 题且全部答对
const cleanAnswers: Record<string, { ok: boolean; tries: number; t: number }> = {};
for (const q of bigData.questions.slice(0, 100)) {
  cleanAnswers[qkey(q)] = { ok: true, tries: 1, t: 6000 };
}
const cleanUnlocked = evaluateAchievements(normalizeState({ answers: cleanAnswers }), bigData, 6000);
ok(Boolean(cleanUnlocked.no_wrong_100), 'achievement no_wrong_100');

// 动态目标：全题库/全章节的 target 来自题库规模
const dynamicTargets = achievementProgress(normalizeState({}), bigData);
ok(
  dynamicTargets.find((item) => item.id === 'correct_all')?.target === bigData.questions.length,
  'correct_all target follows question count',
);
ok(
  dynamicTargets.find((item) => item.id === 'chapter_all')?.target ===
    Object.keys(bigData.chapters).length,
  'chapter_all target follows chapter count',
);

// ---------- 清空记录 ----------
const resetState = resetProgressState(achState, 3000);
ok(resetState.resetAt === 3000 && Object.keys(resetState.answers).length === 0, 'reset clears answers');
ok(resetState.notes['1-1'].length === 1 && Object.keys(resetState.achievements).length === 0, 'reset keeps notes');

// 清空全部学习数据：收藏 / 心得 / 成就一并清除，设置保留
const clearAllState = resetAllLearningState(
  normalizeState({
    answers: { '1-1': { ok: true, tries: 1, t: 100 } },
    wrong: { '1-2': 1 },
    favorites: { '1-1': 50 },
    favoriteRemovals: { '1-2': 60 },
    notes: { '1-1': [{ id: 'n1', text: '记', at: 70 }] },
    achievements: { first_steps: { unlockedAt: 80 } },
    settings: { ...DEFAULT_SETTINGS, count: 33 },
    settingsAt: 90,
  }),
  4000,
);
ok(
  clearAllState.resetAt === 4000 &&
    clearAllState.dataResetAt === 4000 &&
    Object.keys(clearAllState.answers).length === 0 &&
    Object.keys(clearAllState.wrong).length === 0,
  'clear all resets answers and sets epochs',
);
ok(
  Object.keys(clearAllState.favorites).length === 0 &&
    Object.keys(clearAllState.favoriteRemovals).length === 0 &&
    Object.keys(clearAllState.notes).length === 0 &&
    Object.keys(clearAllState.achievements).length === 0,
  'clear all removes favorites, notes and achievements',
);
ok(clearAllState.settings.count === 33 && clearAllState.settingsAt === 90, 'clear all keeps settings');

// dataResetAt 让云端合并丢弃重置前的收藏 / 心得 / 成就
const afterClear = normalizeState({ dataResetAt: 1000, resetAt: 1000 });
const stalePeer = normalizeState({
  favorites: { '1-1': 100 },
  notes: { '1-1': [{ id: 'n1', text: 'old', at: 100 }] },
  achievements: { first_steps: { unlockedAt: 100 } },
});
const clearedMerge = mergeStates(afterClear, stalePeer);
ok(
  !clearedMerge.favorites['1-1'] && !clearedMerge.notes['1-1'] && !clearedMerge.achievements.first_steps,
  'dataResetAt drops pre-reset favorites, notes and achievements',
);
const freshPeer = normalizeState({
  favorites: { '1-2': 2000 },
  notes: { '1-2': [{ id: 'n2', text: 'new', at: 2000 }] },
  achievements: { note_first: { unlockedAt: 2000 } },
});
const freshMerge = mergeStates(afterClear, freshPeer);
ok(
  freshMerge.favorites['1-2'] === 2000 &&
    freshMerge.notes['1-2'].length === 1 &&
    freshMerge.achievements.note_first.unlockedAt === 2000,
  'dataResetAt keeps post-reset data',
);

// ---------- 判分写入每日记录 ----------
const dailyGrade = normalizeState({});
grade(dailyGrade, createSession([data.questions[0]], 't').list[0], 0, 1234);
const today = dateKey(1234);
ok(dailyGrade.daily[today].answered === 1 && dailyGrade.daily[today].correct === 1, 'grade updates daily record');

// ---------- 题库元数据与稳定题目 ID ----------
const explicitBank = normalizeQuizData(
  {
    id: 'custom-bank',
    name: '自定义题库',
    version: 2,
    chapters: { 1: '第一章' },
    questions: [{ id: 'q-1', c: 1, n: 9, s: '题', o: ['A', 'B', 'C', 'D'], a: 0, e: '' }],
  },
  { id: 'unused', name: '未使用' },
);
ok(explicitBank.id === 'custom-bank' && explicitBank.version === 2 && explicitBank.schema === 1, 'normalizeQuizData keeps explicit metadata');
ok(explicitBank.questions[0].id === 'q-1', 'explicit question id is kept');

const filledBank = normalizeQuizData(
  {
    chapters: { 1: '第一章' },
    questions: [{ c: 1, n: 7, s: '题', o: ['A', 'B', 'C', 'D'], a: 0, e: '' }],
  },
  { id: BUILTIN_BANK_ID, name: '内置题库' },
);
ok(filledBank.id === BUILTIN_BANK_ID && filledBank.version === 1, 'normalizeQuizData fills metadata defaults');
ok(filledBank.questions[0].id === '1-7' && qkey(filledBank.questions[0]) === '1-7', 'missing question id falls back to c-n');

ok(qkey({ id: 'stable-question', c: 9, n: 9 }) === 'stable-question', 'qkey prefers stable id over c-n');
ok(data.questions.every((q) => qkey(q) === `${q.c}-${q.n}`), 'builtin-style ids keep legacy keys unchanged');

// ---------- validateBank ----------
const demoBank = (questions: unknown[]) => ({
  schema: 1,
  id: 'demo-bank',
  name: '示例题库',
  version: 1,
  chapters: { '1': '第一章' } as Record<string, string>,
  questions,
});
const goodQ = { id: 'q1', c: 1, n: 1, s: '题干', o: ['A', 'B', 'C', 'D'], a: 0, e: '' };

const validBank = validateBank(demoBank([goodQ]));
ok(validBank.ok && validBank.bank?.id === 'demo-bank' && validBank.removed === 0, 'validateBank accepts a valid bank');
ok(validateBank('not-a-bank').ok === false, 'validateBank rejects non-object input');

const illegalId = validateBank({ ...demoBank([goodQ]), id: 'Demo Bank' });
ok(!illegalId.ok && illegalId.errors.some((e) => e.includes('id')), 'validateBank rejects illegal bank id');

const duplicateIds = validateBank(
  demoBank([goodQ, { ...goodQ, c: 1, n: 2 }]),
);
ok(!duplicateIds.ok && duplicateIds.errors.some((e) => e.includes('重复')), 'validateBank rejects duplicate question ids');

const outOfRange = validateBank(demoBank([goodQ, { ...goodQ, id: 'q2', n: 2, a: 4 }]));
ok(outOfRange.ok && outOfRange.removed === 1 && outOfRange.bank?.questions.length === 1, 'validateBank removes out-of-range a');

const missingChapter = validateBank(demoBank([goodQ, { ...goodQ, id: 'q2', n: 2, c: 5 }]));
ok(missingChapter.ok && missingChapter.removed === 1, 'validateBank removes questions of unknown chapters');

const badOptions = validateBank(demoBank([goodQ, { ...goodQ, id: 'q2', n: 2, o: ['A', 'B', 'C'] }]));
ok(badOptions.ok && badOptions.removed === 1, 'validateBank removes questions without 4 options');

const emptyStem = validateBank(demoBank([goodQ, { ...goodQ, id: 'q2', n: 2, s: '  ' }]));
ok(emptyStem.ok && emptyStem.removed === 1, 'validateBank removes questions with empty stem');

const allRemoved = validateBank(demoBank([{ ...goodQ, a: 9 }]));
ok(!allRemoved.ok && allRemoved.errors.some((e) => e.includes('可用')), 'validateBank fails when no question survives');

// 内置题库同样跑一遍校验：应当零错误、零剔除
const builtinRaw = JSON.parse(
  readFileSync(new URL('../../../data/questions.json', import.meta.url), 'utf8'),
);
const builtinCheck = validateBank({
  schema: 1,
  id: BUILTIN_BANK_ID,
  name: '清晖软考（高项）题库',
  version: 1,
  chapters: builtinRaw.chapters,
  questions: builtinRaw.questions,
});
ok(
  builtinCheck.ok && builtinCheck.removed === 0 && builtinCheck.bank?.questions.length === builtinRaw.questions.length,
  'builtin bank passes validateBank without removal',
);

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails?1:0);
