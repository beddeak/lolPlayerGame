// Actual replay helpers and component handlers. Controlled rendering, not a browser layout test.
const assert = require('node:assert/strict');
const { loadSource } = require('./load-source.cjs');
const { harness } = require('./check-legend-ui.cjs');
const helpers = loadSource('tactical-replay');
const { frameAt, eventsAt, replayChunkAt, advancePlayback, cursorKey, readCursor, tacticalMetric, parseTacticalRun, parseTacticalChunk } = helpers;
const clone = value => JSON.parse(JSON.stringify(value));

function fixture(matchId = 17) {
  const actor = { id: 'blue-top', position: { x: 10, y: 10 }, hp: 500, maxHp: 600, level: 1, gold: 500,
    cs: 0, active: true, action: 'MOVE', kills: 0, deaths: 0, assists: 0, goldEarned: 0, damageToChampions: 0, items: [] };
  const frame = atMs => ({ atMs, eventSeq: atMs / 1000, actors: [{ ...clone(actor), hp: atMs >= 2000 ? 400 : 500 }], units: [],
    teams: [{ teamId: 1, side: 'BLUE', kills: atMs >= 2000 ? 1 : 0, goldEarned: 0, objectives: 0, structures: 0 },
      { teamId: 2, side: 'RED', kills: 0, goldEarned: 0, objectives: 0, structures: 0 }] });
  const chunks = [
    { schemaVersion: 1, inputHash: 'input-17', index: 0, fromMs: 0, toMs: 1000,
      frames: [frame(0), frame(1000)], events: [{ seq: 1, atMs: 1000, kind: 'RECALL_START', actorId: actor.id }] },
    { schemaVersion: 1, inputHash: 'input-17', index: 1, fromMs: 2000, toMs: 3000,
      frames: [frame(2000), frame(3000)], events: [{ seq: 2, atMs: 2000, kind: 'DEATH', actorId: actor.id, targetId: 'red-top' },
        { seq: 3, atMs: 3000, kind: 'NEXUS_DESTROYED', actorId: actor.id, targetId: 'red-nexus' }] },
  ];
  const manifest = { schemaVersion: 1, replayVersion: 'tactical-replay-1', engineVersion: 'tactical-core-3', inputHash: 'input-17',
    durationMs: 3000, status: 'FINISHED', winnerTeamId: 1, sampleIntervalMs: 1000, interpolation: 'STEP', perspective: 'OMNISCIENT',
    map: { width: 100, height: 100, bases: { BLUE: { x: 0, y: 0 }, RED: { x: 100, y: 100 } }, lanes: { MID: [{ x: 0, y: 0 }, { x: 100, y: 100 }] }, walls: [] },
    teams: [{ teamId: 1, side: 'BLUE', code: 'ALPHA' }, { teamId: 2, side: 'RED', code: 'BETA' }],
    actors: [{ actorId: actor.id, careerPlayerId: 10, teamId: 1, side: 'BLUE', position: 'TOP', championId: 'tank', name: 'Player Blue' }],
    report: { simTimeMs: 3000, status: 'FINISHED', winnerTeamId: 1, players: [{ actorId: actor.id, kills: 1, deaths: 0, assists: 0,
      cs: 0, goldEarned: 300, walletGold: 800, dpm: 10000, kp: 100, gdAt15: null, csdAt15: null }] },
    chunks: chunks.map(chunk => ({ index: chunk.index, fromMs: chunk.fromMs, toMs: chunk.toMs, frameCount: chunk.frames.length, eventCount: chunk.events.length, bytes: 1000, hash: `hash-${chunk.index}` })) };
  return { run: { matchId, status: 'FINISHED', engineVersion: manifest.engineVersion, simTimeMs: 3000, error: null, manifest }, chunks };
}

async function main() {
  const data = fixture();
  const initial = JSON.stringify(data);
  assert.equal(parseTacticalRun(data.run, 17), data.run, 'valid records retain their references');
  assert.equal(parseTacticalChunk(data.chunks[0], data.run.manifest, data.run.manifest.chunks[0]), data.chunks[0]);
  for (const change of [
    value => { delete value.manifest.chunks; },
    value => { value.manifest.chunks = []; },
    value => { value.manifest.durationMs = NaN; },
    value => { value.manifest.map.lanes.MID = null; },
    value => { value.manifest.actors[0].position = {}; },
    value => { value.manifest.report.players = null; },
    value => { value.manifest.chunks[1].fromMs = 1000; },
  ]) {
    const corrupt = clone(data.run); change(corrupt);
    assert.throws(() => parseTacticalRun(corrupt, 17), /손상|호환/, 'malformed manifest is rejected before rendering');
  }
  for (const change of [
    value => { value.frames = []; },
    value => { value.frames[0].actors[0].position = null; },
    value => { value.frames[0].actors[0].hp = Infinity; },
    value => { value.frames[1].atMs = 0; },
    value => { value.frames[0].teams = null; },
    value => { value.events[0].kind = {}; },
  ]) {
    const corrupt = clone(data.chunks[0]); change(corrupt);
    assert.throws(() => parseTacticalChunk(corrupt, data.run.manifest, data.run.manifest.chunks[0]), /손상|호환/);
  }
  assert.equal(frameAt(data.chunks[0], -1), null, 'no future first frame');
  assert.equal(frameAt(data.chunks[0], 999).atMs, 0);
  assert.equal(frameAt(data.chunks[0], 1000).atMs, 1000);
  assert.equal(replayChunkAt(data.run.manifest, 1999).index, 0, 'sample holds across a chunk gap');
  assert.equal(replayChunkAt(data.run.manifest, 2000).index, 1);
  assert.deepEqual(eventsAt(data.chunks[1], data.chunks[1].frames[0]).map(event => event.kind), ['DEATH']);
  assert.deepEqual(eventsAt(data.chunks[1], { ...data.chunks[1].frames[1], eventSeq: 1 }), [], 'sequence boundary also enforced');
  assert.equal(advancePlayback(1000, -3, 32, 3000), 1000);
  assert.equal(advancePlayback(1000, Infinity, 32, 3000), 1000);
  assert.equal(advancePlayback(0, 100000, 1, 3000), 200, 'background callback is capped');
  const at30fps = Array.from({ length: 30 }).reduce(value => advancePlayback(value, 1000 / 30, 8, 100000), 0);
  const at20fps = Array.from({ length: 20 }).reduce(value => advancePlayback(value, 50, 8, 100000), 0);
  assert.ok(Math.abs(at30fps - at20fps) <= 15, 'presentation clocks remain close despite integer display rounding');
  for (const speed of [1, 8, 16, 32]) {
    const t = advancePlayback(0, 100, speed, 3000);
    const chunk = data.chunks[replayChunkAt(data.run.manifest, t).index];
    assert.ok(frameAt(chunk, t).atMs <= t);
  }
  assert.equal(JSON.stringify(data), initial, 'all playback operations leave the simulation record untouched');
  assert.equal(tacticalMetric(null), '—'); assert.equal(tacticalMetric(Infinity), '—');
  assert.notEqual(cursorKey(1, 17, data.run.manifest), cursorKey(2, 17, data.run.manifest));
  assert.notEqual(cursorKey(1, 17, data.run.manifest), cursorKey(1, 18, data.run.manifest));
  assert.notEqual(cursorKey(1, 17, data.run.manifest), cursorKey(1, 17, { ...data.run.manifest, engineVersion: 'next' }));
  assert.equal(readCursor({ getItem: () => 'NaN' }, 'x', 3000), 0);
  assert.equal(readCursor({ getItem: () => '100000' }, 'x', 3000), 3000);

  const previous = { window: global.window, document: global.document, performance: global.performance };
  const timers = new Map(), listeners = new Map(), storage = new Map();
  let sequence = 0, now = 0, closed = 0;
  global.document = { hidden: false, body: { style: { overflow: 'auto' } }, addEventListener: (key, listener) => listeners.set(key, listener), removeEventListener: key => listeners.delete(key) };
  global.window = { sessionStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    addEventListener: (key, listener) => listeners.set(key, listener), removeEventListener: key => listeners.delete(key),
    setInterval: (callback, ms) => { timers.set(++sequence, { callback, ms }); return sequence; }, clearInterval: id => timers.delete(id) };
  global.performance = { now: () => now };
  const requests = [];
  const request = async (path, options) => {
    requests.push({ path, options });
    assert.ok(!options.method || options.method === 'GET', 'viewer must never execute or save a match');
    return clone(path.includes('/chunks/') ? data.chunks[Number(path.split('/').at(-1))] : { ...data.run, matchId: Number(path.split('/')[2]) });
  };
  const props = { careerId: 1, matchId: 17, token: 'user-token', onClose: () => closed++ };
  const makeView = (currentProps = props, api = request) => harness('TacticalMatchViewer.tsx', currentProps, api, { './tactical-replay': helpers });
  const mount = async view => { for (let i = 0; i < 5; i++) await view.mount(); return view.render(); };
  const slider = view => view.nodes().find(node => node.type === 'input');
  const tick = ms => { now += ms; [...timers.values()].filter(timer => timer.ms === 50).forEach(timer => timer.callback()); };
  let view;
  try {
    view = makeView();
    let html = await mount(view);
    assert.match(html, /전지적 관전/); assert.match(html, /HP 500/);
    assert.doesNotMatch(html, /ALPHA 승리|넥서스 파괴|실제 경기 통계/);
    assert.equal([...timers.values()].filter(timer => timer.ms === 50).length, 0, 'reconnect opens paused');
    view.button('재생').props.onClick(); await mount(view); tick(100); await mount(view);
    assert.equal(slider(view).props.value, 800);
    view.button('일시정지').props.onClick(); await mount(view);
    view.button('32×').props.onClick(); await mount(view);
    assert.equal([...timers.values()].filter(timer => timer.ms === 50).length, 0, 'speed cannot resume paused playback');
    view.button('재생').props.onClick(); await mount(view);
    document.hidden = true; listeners.get('visibilitychange')(); await mount(view);
    assert.equal([...timers.values()].filter(timer => timer.ms === 50).length, 0);
    document.hidden = false; listeners.get('visibilitychange')(); await mount(view);
    view.button('일시정지').props.onClick(); await mount(view);
    slider(view).props.onChange({ target: { value: '2500' } }); html = await mount(view);
    assert.match(html, /HP 400/); assert.match(html, /처치/); assert.doesNotMatch(html, /넥서스 파괴|실제 경기 통계/);
    slider(view).props.onChange({ target: { value: '1000' } }); html = await mount(view);
    assert.match(html, /HP 500/); assert.doesNotMatch(html, /처치|넥서스 파괴/);
    assert.equal(requests.filter(request => request.path.endsWith('/chunks/0')).length, 1, 'seeking reuses bounded chunk cache');
    view.button('도달 시점 통계').props.onClick(); html = await mount(view);
    assert.match(html, /ALPHA 승리/); assert.match(html, /실제 경기 통계/); assert.match(html, /<td>—<\/td>/);
    slider(view).props.onChange({ target: { value: '1000' } }); await mount(view);
    listeners.get('pagehide')(); view.unmount();
    assert.equal(timers.size, 0); assert.equal(listeners.size, 0); assert.equal(document.body.style.overflow, 'auto');
    view = makeView(); html = await mount(view);
    assert.equal(slider(view).props.value, 1000, 'reconnect restores this match cursor');
    view.unmount();
    view = makeView({ ...props, matchId: 18 }); await mount(view);
    assert.equal(slider(view).props.value, 0, 'next set cannot inherit previous cursor or HP');
    view.unmount();
    storage.clear();
    let deliver;
    const delayedChunk = new Promise(resolve => { deliver = resolve; });
    view = makeView(props, (path, options) => path.endsWith('/chunks/1') ? delayedChunk : request(path, options));
    await mount(view);
    slider(view).props.onChange({ target: { value: '2500' } }); await mount(view);
    assert.match(view.render(), /리플레이 구간을 불러오는 중/);
    assert.doesNotMatch(view.render(), /HP 500/, 'old frame is not displayed under a new cursor while loading');
    slider(view).props.onChange({ target: { value: '0' } }); await mount(view);
    deliver(clone(data.chunks[1])); html = await mount(view);
    assert.match(html, /HP 500/); assert.doesNotMatch(html, /HP 400|처치/, 'late response cannot replace a newer seek');
    view.unmount();
    view = makeView(props, async (path, options) => path.endsWith('/chunks/1')
      ? { ...clone(data.chunks[1]), inputHash: 'another-game' } : request(path, options));
    await mount(view); slider(view).props.onChange({ target: { value: '2500' } }); html = await mount(view);
    assert.match(html, /다른 경기의 리플레이 구간/); assert.doesNotMatch(html, /HP 400/);
    view.unmount();
    storage.clear();
    let manifestAttempts = 0;
    view = makeView(props, async (path, options) => {
      const value = await request(path, options);
      if (!path.includes('/chunks/') && ++manifestAttempts === 1) delete value.manifest.chunks;
      return value;
    });
    html = await mount(view);
    assert.match(html, /리플레이 정보가 손상/);
    assert.ok(view.button('닫기'), 'malformed manifest leaves the close action usable');
    assert.doesNotMatch(html, /HP 500/, 'malformed manifest never enters the renderer');
    view.button('서버 기록 새로고침').props.onClick(); html = await mount(view);
    assert.match(html, /HP 500/); assert.doesNotMatch(html, /리플레이 정보가 손상/);
    view.unmount();
    storage.clear();
    let chunkAttempts = 0;
    view = makeView(props, async (path, options) => {
      const value = await request(path, options);
      if (path.endsWith('/chunks/0') && ++chunkAttempts === 1) value.frames = [];
      return value;
    });
    html = await mount(view);
    assert.match(html, /리플레이 구간이 손상/);
    assert.ok(view.button('닫기')); assert.ok(view.button('구간 다시 불러오기'));
    view.button('구간 다시 불러오기').props.onClick(); html = await mount(view);
    assert.equal(chunkAttempts, 2, 'invalid chunk is not cached');
    assert.match(html, /HP 500/); assert.doesNotMatch(html, /리플레이 구간이 손상/);
    view.unmount();
    const incomplete = clone(data.run); incomplete.status = 'HORIZON_REACHED'; incomplete.manifest.status = 'HORIZON_REACHED'; incomplete.manifest.winnerTeamId = null;
    view = makeView(props, async (path, options) => path.includes('/chunks/') ? request(path, options) : incomplete);
    await mount(view); view.button('도달 시점 통계').props.onClick(); html = await mount(view);
    assert.match(html, /미완료 경기/); assert.doesNotMatch(html, /ALPHA 승리/);
    view.button('닫기').props.onClick(); assert.equal(closed, 1);
    console.log('Tactical replay passed: shared snapshot clock, future-event filtering, read-only controls, chunk boundaries/cache, pause/speed/visibility, reconnect and set/engine isolation, malformed manifest/chunk rejection and retry, finite/null report metrics, incomplete result handling (controlled rendering).');
  } finally {
    view?.unmount(); global.window = previous.window; global.document = previous.document; global.performance = previous.performance;
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
