import { createSession, gradeAnswer, normalizeState, shouldAutoAdvance, wrongQuestions, unansweredQuestions, questionsOfChapter, qkey, isFavorite, toggleFavorite, favoriteQuestions, notesFor, addQuestionNote, DEFAULT_SETTINGS, SCHEMA_VERSION, type QuizData } from '../src/index.ts';

const data: QuizData = {
  generatedFrom: 'test',
  chapters: { 1: '第一章', 2: '第二章' },
  questions: [
    { c: 1, n: 1, s: '题1', o: ['A', 'B', 'C', 'D'], a: 0, e: '解析1' },
    { c: 1, n: 2, s: '题2', o: ['A', 'B', 'C', 'D'], a: 3, e: '解析2' },
    { c: 2, n: 1, s: '题3', o: ['A', 'B', 'C', 'D'], a: 1, e: '解析3' },
  ],
};
let passes=0, fails=0;
function ok(cond: boolean, msg: string){ if(cond){passes++;} else {fails++; console.log('FAIL:', msg);} }

const ch1 = questionsOfChapter(data, 1);
ok(ch1.length===2 && ch1[0].n===1 && ch1[1].n===2, 'chapter order');

const sess = createSession(ch1, 't', { shuffle: true });
ok(sess.list.length===2, 'session length');
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

const SET = {count:20,shuffle:0 as const,instant:1 as const,autoNext:1600};
ok(shouldAutoAdvance(true, SET, false)===true, 'auto on correct');
ok(shouldAutoAdvance(false, SET, false)===false, 'no auto on wrong');
ok(shouldAutoAdvance(true, {...SET,autoNext:0}, false)===false, 'no auto when autoNext=0');
ok(shouldAutoAdvance(true, SET, true)===false, 'no auto in reviewOnly');

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

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails?1:0);
