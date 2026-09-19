// Actual React components with controlled hooks; API handlers and SSR, not browser layout.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const settle = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function harness(file, props, request) {
  const slots = []; let cursor = 0, effects = [], tree, writes = 0;
  const hooks = { ...React,
    useState(initial) { const i = cursor++; slots[i] ??= { value: initial }; return [slots[i].value, value => { writes++; slots[i].value = typeof value === 'function' ? value(slots[i].value) : value; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useEffect(effect, deps) { const i = cursor++; if (!slots[i] || deps.some((value, index) => !Object.is(value, slots[i].deps[index]))) { const previous = slots[i]; slots[i] = { deps }; effects.push(() => { previous?.cleanup?.(); slots[i].cleanup = effect(); }); } },
  };
  const module = { exports: {} };
  const output = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', `${file}.tsx`), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  new Function('require', 'module', 'exports', output)(name => name === 'react' ? hooks : name === './api' ? { apiRequest: request } : name.endsWith('.css') ? {} : require(name), module, module.exports);
  const render = () => { cursor = 0; tree = module.exports.default(props); return renderToStaticMarkup(tree); };
  const nodes = () => { const result = []; const walk = node => { if (Array.isArray(node)) node.forEach(walk); else if (React.isValidElement(node)) { result.push(node); walk(node.props.children); } }; walk(tree); return result; };
  const text = node => Array.isArray(node) ? node.map(text).join('') : React.isValidElement(node) ? text(node.props.children) : node ?? '';
  return { render, nodes, writes: () => writes,
    button: (label, index = 0) => nodes().filter(node => node.type === 'button' && text(node) === label)[index],
    async mount() { render(); const pending = effects; effects = []; pending.forEach(effect => effect()); await settle(); return render(); },
    unmount() { slots.forEach(slot => slot.cleanup?.()); },
  };
}
const player = id => ({ id, currentPosition: 'TOP', condition: 70, form: 40, currentLaning: 80, currentMechanics: 80, currentGameSense: 80, currentTeamFight: 80, currentMacro: 80, currentTeamPlay: 80, currentMental: 80, currentChampionPool: 80, playerCard: { player: { nickname: `PLAYER_${id}` } } });
const trainingFixture = () => ({
  props: { career: { id: 1, currentDate: '2026-01-05' }, token: 'a', team: { teamStrategy: 'BALANCED', strategyProficiencies: [{ strategy: 'BALANCED', proficiency: 50 }], starters: [1,2,3,4,5].map(id => ({ careerPlayer: player(id) })), benches: [{ careerPlayer: player(6) }] }, onCareerRefresh: async () => {}, onOpenPlayer() {} },
  period: { weekStartsAt: '2026-01-05', weekEndsAt: '2026-01-11', available: true, teamAvailable: true, teamRested: false, phaseLabel: '프리시즌', usedPlayerIds: [], teamTraining: { remaining: 1, limit: 1 }, sessions: [] },
});
async function main() {
  let checks = 0;
  const check = async (label, work) => { await work(); checks++; console.log(`PASS ${label}`); };
  await check('training renders all five starters and bench; no old starting-lineup table', async () => {
    const f = trainingFixture(), h = harness('TrainingPanel', f.props, async () => f.period);
    const html = await h.mount(); for (let id = 1; id <= 6; id++) assert.match(html, new RegExp(`PLAYER_${id}`));
    assert.equal(h.button('훈련', 5).props.disabled, false); assert.doesNotMatch(html, /선발 라인업/);
  });
  await check('season permits team choices but blocks stat training; zero condition and max stats disable training', async () => {
    const f = trainingFixture(); f.period.available = false;
    const h = harness('TrainingPanel', f.props, async () => f.period); await h.mount();
    assert.equal(h.button('스크림 진행').props.disabled, false); assert.ok(h.button('훈련').props.disabled); assert.equal(h.button('팀 전체 휴식').props.disabled, false);
    const f2 = trainingFixture(); f2.props.team.starters[0].careerPlayer.currentLaning = 119; f2.props.team.starters[1].careerPlayer.condition = 0; f2.props.team.starters[2].careerPlayer.condition = 100;
    const h2 = harness('TrainingPanel', f2.props, async () => f2.period); await h2.mount();
    assert.ok(h2.button('훈련', 0).props.disabled); assert.ok(h2.button('훈련', 1).props.disabled); assert.equal(h2.button('팀 전체 휴식').props.disabled, false);
  });
  await check('same-tick double click submits once and persists per-player usage', async () => {
    const f = trainingFixture(), wait = deferred(); let posts = 0;
    const h = harness('TrainingPanel', f.props, async (url, options) => { if (options.method === 'POST') { posts++; assert.equal(url, '/careers/1/training-periods/current/individual'); assert.deepEqual(options.body, { type: 'LANING', careerPlayerId: 1 }); return wait.promise; } return f.period; });
    await h.mount(); const click = h.button('훈련').props.onClick; click(); click(); assert.equal(posts, 1);
    wait.resolve({ ...f.period, usedPlayerIds: [1] }); await settle(); h.render(); assert.ok(h.button('이번 주 완료').props.disabled); assert.equal(h.button('훈련').props.disabled, false);
  });
  await check('scrim and team rest target the same team slot; show condition/form changes including bench', async () => {
    const f = trainingFixture(), bodies = [];
    const h = harness('TrainingPanel', f.props, async (url, options) => { if (options.method === 'POST') { assert.match(url, /\/team$/); bodies.push(options.body); } return f.period; });
    await h.mount(); h.button('스크림 진행').props.onClick(); await settle(); h.render();
    f.period = { ...f.period, teamRested: true, teamTraining: { remaining: 0, limit: 1 }, sessions: [{ id: 1, type: 'REST', careerPlayerId: null, resultDelta: 0, conditionDelta: null, playerEffects: [{ careerPlayerId: 6, conditionBefore: 70, conditionAfter: 90, conditionDelta: 20, formBefore: 40, formAfter: 43, formDelta: 3 }] }] };
    h.button('팀 전체 휴식').props.onClick(); await settle();
    const html = h.render(); assert.match(html, /70 → 90/); assert.match(html, /40 → 43/); assert.match(html, /회복 멘탈 80/);
    assert.ok(h.button('팀 전체 휴식').props.disabled); assert.ok(h.button('훈련').props.disabled);
    h.button('팀 전체 휴식').props.onClick(); await settle();
    assert.deepEqual(bodies, [{ type: 'STRATEGY', strategy: 'BALANCED' }, { type: 'REST' }]);
  });
  await check('rest is blocked only when both states are full or individual training already used', async () => {
    const f = trainingFixture(); [...f.props.team.starters, ...f.props.team.benches].forEach(slot => { slot.careerPlayer.condition = 100; slot.careerPlayer.form = 100; });
    const h = harness('TrainingPanel', f.props, async () => f.period); await h.mount(); assert.ok(h.button('팀 전체 휴식').props.disabled);
    f.props.team.benches[0].careerPlayer.form = 99; h.render(); assert.equal(h.button('팀 전체 휴식').props.disabled, false);
    f.period.usedPlayerIds = [1]; h.render(); assert.ok(h.button('팀 전체 휴식').props.disabled);
  });
  await check('uncertain POST response reloads latest usage without automatic retry', async () => {
    const f = trainingFixture(); let reads = 0, posts = 0;
    const h = harness('TrainingPanel', f.props, async (_url, options) => { if (options.method === 'POST') { posts++; throw new Error('timeout'); } return ++reads === 1 ? f.period : { ...f.period, usedPlayerIds: [1] }; });
    await h.mount(); h.button('훈련').props.onClick(); await settle(); assert.match(h.render(), /timeout/); assert.ok(h.button('이번 주 완료').props.disabled); assert.equal(posts, 1); assert.equal(reads, 2);
  });
  await check('unmounted training load ignores late responses', async () => {
    const f = trainingFixture(), wait = deferred(), h = harness('TrainingPanel', f.props, () => wait.promise);
    await h.mount(); h.unmount(); const before = h.writes(); wait.resolve(f.period); await settle(); assert.equal(h.writes(), before);
  });
  const internationalFixture = () => ({
    props: { career: { id: 1, teams: [{ id: 1, code: 'T1' }, { id: 2, code: 'BLG' }] }, token: 'a', revision: {}, busy: false, onAction() {} },
    data: { readiness: [{ kind: 'FIRST_STAND', participantCount: 8, startsAt: '2026-03-16', endsAt: '2026-03-22', tournamentId: null, ready: false, reasons: ['LCP 예선 미완료'], teamRequirements: [{ region: 'LCP', available: 0, required: 1 }] }], tournaments: [{ id: 4, kind: 'MSI', year: 2026, rosterConfirmed: false, championTeamId: null, entrants: [{ teamId: 1, region: 'LCK', regionalSeed: 1, entry: 'MAIN' }], fixtures: [{ id: 9, key: 'GF', stage: 'FINAL', round: 7, scheduledDate: '2026-07-12', bestOf: 5, teamAId: 1, teamBId: 2, winnerTeamId: null, teamAWins: 0, teamBWins: 0, playable: false }] }] },
  });
  await check('international missing-data reasons are visible; future games disabled', async () => {
    const f = internationalFixture(), h = harness('InternationalPanel', f.props, async () => f.data);
    const html = await h.mount(); assert.match(html, /LCP 예선 미완료/); assert.match(html, /BLG/); assert.ok(h.button('대회 준비').props.disabled); assert.ok(h.button('일정 / 진출팀 대기').props.disabled);
  });
  await check('international registration and simulation route through shared season action lock', async () => {
    const f = internationalFixture(), actions = []; f.props.onAction = action => actions.push(action); f.data.tournaments[0].fixtures[0].playable = true;
    const h = harness('InternationalPanel', f.props, async () => f.data); await h.mount(); h.button('현재 선수단 등록').props.onClick(); h.button('시리즈 진행').props.onClick();
    assert.deepEqual(actions, ['4/roster', '4/fixtures/9/simulate']); f.props.busy = true; h.render(); assert.ok(h.button('시리즈 진행').props.disabled);
  });
  await check('old international responses cannot overwrite a newer calendar revision', async () => {
    const f = internationalFixture(), old = deferred(); let count = 0;
    const h = harness('InternationalPanel', f.props, () => ++count === 1 ? old.promise : Promise.resolve(f.data));
    await h.mount(); f.props.revision = {}; await h.mount(); const before = h.writes(); old.resolve({ readiness: [], tournaments: [] }); await settle(); assert.equal(h.writes(), before); assert.match(h.render(), /LCP 예선 미완료/);
  });
  await check('unmounted international errors never write to a different screen', async () => {
    const f = internationalFixture(), wait = deferred(), h = harness('InternationalPanel', f.props, () => wait.promise);
    await h.mount(); h.unmount(); const before = h.writes(); wait.reject(new Error('old error')); await settle(); assert.equal(h.writes(), before);
  });
  console.log(`Activity UI checks passed: ${checks} scenarios.`);
}
module.exports = { harness, trainingFixture };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
