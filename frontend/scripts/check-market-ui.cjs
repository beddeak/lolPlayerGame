const assert = require('node:assert/strict');
const { harness } = require('./check-legend-ui.cjs');
const { loadSource } = require('./load-source.cjs');
const { formatMoney } = loadSource('money');
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const event = { preventDefault() {} };
const candidate = (id = 9) => ({ careerPlayerId: id, nickname: `PLAYER_${id}`, nationality: 'KR', currentAge: 24, position: 'TOP', overall: 90, availability: 'CONTRACTED', currentTeamId: 2, currentTeam: { id: 2, code: 'GEN', name: 'Gen.G' }, currentContract: null, requiredFee: 180000, activeAgreementId: null, canNegotiate: true, hasBenchSpace: true, blockedReason: null });
const fixture = () => {
  const opened = [], posts = [];
  const data = { players: [candidate(), { ...candidate(10), nickname: 'FREE_AGENT', position: 'ADC', availability: 'FREE_AGENT', currentTeamId: null, currentTeam: null, requiredFee: 0 }], window: { currentDate: '2026-11-23', isOpen: true, opensAt: '2026-11-19', endsAt: '2026-12-31' }, offers: [], sales: [] };
  const props = { career: { id: 1, currentDate: data.window.currentDate, teams: [{ id: 1, name: 'T1', isUserControlled: true, starters: [], benches: [] }, { id: 2, name: 'Gen.G', region: 'LCK', isUserControlled: false }] }, token: 'test', onOpenContractOffer: id => opened.push(id), onCareerUpdated: async () => {}, onOpenSeason() {}, onBack() {} };
  const request = async (url, options = {}) => {
    if (options.method === 'POST') {
      posts.push({ url, body: options.body });
      if (url.endsWith('/agreements')) { data.players[0].activeAgreementId = 7; return { id: 7, status: 'ACCEPTED' }; }
      if (url.endsWith('/offers')) return { id: 11, careerPlayerId: options.body.careerPlayerId, status: 'WAITING_PLAYER_RESPONSE' };
      if (url.endsWith('/cancel')) { data.sales[0].status = 'WITHDRAWN'; return {}; }
      if (url.endsWith('/sales')) { data.sales = [{ id: 8, careerPlayerId: options.body.careerPlayerId, nickname: 'PLAYER_9', buyerTeam: { id: 2, code: 'GEN' }, transferFee: options.body.askingFee, status: 'WAITING_PLAYER_RESPONSE', responseDate: '2026-11-25' }]; return {}; }
    }
    if (url.endsWith('/market') || url.endsWith('/sale-candidates')) return structuredClone(data.players);
    if (url.endsWith('/window')) return data.window;
    if (url.endsWith('/offers')) return structuredClone(data.offers);
    if (url.endsWith('/sales')) return structuredClone(data.sales);
    throw new Error(`Unexpected request ${url}`);
  };
  return { props, data, posts, opened, request };
};
const select = (view, id = 9) => view.nodes().find(node => node.type === 'button' && node.key === String(id)).props.onClick();
const input = (view, label) => view.nodes().find(node => node.type === 'input' && node.props['aria-label'] === label);

async function main() {
  let checks = 0;
  const check = async (label, work) => { await work(); console.log(`PASS ${label}`); checks++; };
  await check('integer money boundaries never produce fractional 억', () => {
    for (const [amount, text] of [[0,'0만원'],[1,'1만원'],[9999,'9,999만원'],[10000,'1억원'],[10001,'1억 1만원'],[98765,'9억 8,765만원'],[10000000,'1,000억원']]) assert.equal(formatMoney(amount), text);
    for (const bad of [NaN, Infinity, -1, 1.5]) assert.equal(formatMoney(bad), '금액을 확인해 주세요');
  });
  await check('market lists contracted and FA players; search and position filter work', async () => {
    const f = fixture(), h = harness('TransferMarketPanel.tsx', f.props, f.request);
    assert.match(await h.mount(), /FREE_AGENT/);
    h.nodes().find(n => n.type === 'input').props.onChange({ target: { value: 'PLAYER_9' } });
    assert.doesNotMatch(h.render(), /<strong>FREE_AGENT<\/strong>/);
    h.nodes().find(n => n.type === 'select').props.onChange({ target: { value: 'ADC' } });
    assert.match(h.render(), /조건에 맞는 선수가 없습니다/);
  });
  await check('new salary defaults to 1억; decrement/increment retain integer 만원', async () => {
    const f = fixture(), h = harness('TransferMarketPanel.tsx', f.props, f.request); await h.mount(); select(h); h.render();
    assert.equal(input(h, '연봉').props.value, 10000); assert.equal(input(h, '연봉').props.step, 1);
    for (const amount of [9999,10001]) { input(h, '연봉').props.onChange({ target: { valueAsNumber: amount } }); assert.match(h.render(), new RegExp(formatMoney(amount))); }
    await h.form().props.onSubmit(event); await settle();
    assert.equal(f.posts[1].body.terms.annualSalary, 10001); assert.equal(f.posts[1].body.transferAgreementId, 7); assert.deepEqual(f.opened, [11]);
  });
  await check('FA skips club agreement and sends object request body', async () => {
    const f = fixture(), h = harness('TransferMarketPanel.tsx', f.props, f.request); await h.mount(); select(h, 10); h.render(); await h.form().props.onSubmit(event); await settle();
    assert.equal(f.posts.length, 1); assert.equal(f.posts[0].url, '/careers/1/contracts/offers'); assert.equal(f.posts[0].body.transferAgreementId, undefined); assert.equal(f.posts[0].body.terms.annualSalary, 10000);
  });
  await check('same-tick duplicate acquisition creates one agreement and one offer', async () => {
    const f = fixture(), wait = deferred();
    const h = harness('TransferMarketPanel.tsx', f.props, async (url, options) => { if (url.endsWith('/agreements')) { await wait.promise; } return f.request(url, options); });
    await h.mount(); select(h); h.render(); const submit = h.form().props.onSubmit; submit(event); submit(event); wait.resolve(); await settle(); assert.equal(f.posts.length, 2);
  });
  await check('failed player request reuses completed club agreement on retry', async () => {
    const f = fixture(); let fail = true;
    const h = harness('TransferMarketPanel.tsx', f.props, async (url, options) => { if (url.endsWith('/offers') && options.method === 'POST' && fail) { fail = false; throw new Error('temporary'); } return f.request(url, options); });
    await h.mount(); select(h); h.render(); h.form().props.onSubmit(event); await settle(); assert.match(h.render(), /temporary/);
    h.form().props.onSubmit(event); await settle(); assert.equal(f.posts.filter(p => p.url.endsWith('/agreements')).length, 1); assert.deepEqual(f.opened, [11]);
  });
  await check('existing negotiations, closed window, blocked starter and full bench prevent new offers', async () => {
    for (const block of ['closed','starter','bench','existing']) {
      const f = fixture(); if (block === 'closed') f.data.window.isOpen = false;
      if (block === 'starter') { f.data.players[0].canNegotiate = false; f.data.players[0].blockedReason = '후보 없음'; }
      if (block === 'bench') f.data.players[0].hasBenchSpace = false;
      if (block === 'existing') f.data.offers = [{ id: 12, careerPlayerId: 9, status: 'WAITING_PLAYER_RESPONSE' }];
      const h = harness('TransferMarketPanel.tsx', f.props, f.request); await h.mount(); select(h); h.render();
      if (block === 'existing') { h.button('진행 중인 계약 협상 보기').props.onClick(); assert.deepEqual(f.opened, [12]); }
      else { assert.ok(h.nodes().find(n => n.type === 'fieldset').props.disabled); h.form().props.onSubmit(event); }
      await settle(); assert.equal(f.posts.length, 0);
    }
  });
  await check('unmount after club agreement never starts a stale player offer', async () => {
    const f = fixture(), wait = deferred();
    const h = harness('TransferMarketPanel.tsx', f.props, (url, options) => url.endsWith('/agreements') ? wait.promise : f.request(url, options));
    await h.mount(); select(h); h.render(); h.form().props.onSubmit(event); h.unmount(); wait.resolve({ id: 7, status: 'ACCEPTED' }); await settle(); assert.equal(f.posts.length, 0); assert.deepEqual(f.opened, []);
  });
  await check('failed initial read exposes retry; failed refresh disables stale negotiation', async () => {
    const f = fixture(); let fail = true;
    const h = harness('TransferMarketPanel.tsx', f.props, (url, options) => fail ? Promise.reject(new Error('offline')) : f.request(url, options));
    assert.match(await h.mount(), /offline/); fail = false; h.button('시장 새로고침').props.onClick(); await settle(); h.render(); select(h); h.render();
    fail = true; h.button('시장 새로고침').props.onClick(); await settle(); h.render(); assert.ok(h.nodes().find(n => n.type === 'fieldset').props.disabled);
  });
  await check('sale shows quote; sends once; exposes pending status and cancellation', async () => {
    const f = fixture(), h = harness('PlayerSalesPanel.tsx', { ...f.props, playerId: 9 }, f.request); await h.mount();
    assert.equal(input(h, '희망 이적료').props.value, 180000);
    const submit = h.form().props.onSubmit; submit(event); submit(event); await settle(); assert.match(h.render(), /선수 검토 중/);
    assert.equal(f.posts.length, 1); assert.deepEqual(f.posts[0].body, { careerPlayerId: 9, buyerCareerTeamId: 2, askingFee: 180000 });
    h.button('판매 철회').props.onClick(); await settle(); assert.match(h.render(), /협상 종료/); assert.equal(f.posts[1].url, '/careers/1/contracts/sales/8/cancel');
  });
  await check('roster-breaking sale and invalid fee are disabled', async () => {
    const f = fixture(); f.data.players[0].canNegotiate = false; f.data.players[0].blockedReason = '같은 포지션 후보가 없습니다';
    const h = harness('PlayerSalesPanel.tsx', { ...f.props, playerId: 9 }, f.request); assert.match(await h.mount(), /같은 포지션 후보/); h.form().props.onSubmit(event); await settle(); assert.equal(f.posts.length, 0);
    const f2 = fixture(), h2 = harness('PlayerSalesPanel.tsx', { ...f2.props, playerId: 9 }, f2.request); await h2.mount(); input(h2, '희망 이적료').props.onChange({ target: { valueAsNumber: 1 } }); h2.render(); assert.ok(h2.button('판매 제안 보내기').props.disabled);
  });
  await check('ambiguous sale response reloads pending status without repeating the sale', async () => {
    const f = fixture(), h = harness('PlayerSalesPanel.tsx', { ...f.props, playerId: 9 }, async (url, options) => { const result = await f.request(url, options); if (options.method === 'POST') throw new Error('response lost'); return result; });
    await h.mount(); h.form().props.onSubmit(event); await settle(); assert.match(h.render(), /선수 검토 중/); assert.match(h.render(), /response lost/); assert.equal(f.posts.length, 1);
  });
  await check('market contains legend section and defaults to general player market', async () => {
    const f = fixture(); const child = name => ({ __esModule: true, default: () => name });
    const h = harness('MarketView.tsx', f.props, f.request, { './TransferMarketPanel': child('GENERAL_PLAYERS'), './PlayerSalesPanel': child('SALE_HISTORY'), './LegendEventsView': child('LEGEND_PLAYERS') });
    assert.match(await h.mount(), /GENERAL_PLAYERS/); assert.match(h.render(), /일반 시장/);
    h.button('레전드 시장').props.onClick(); assert.match(h.render(), /LEGEND_PLAYERS/); assert.doesNotMatch(h.render(), /GENERAL_PLAYERS/);
  });
  await check('contract screen exposes sale button and 1억 default', async () => {
    const f = fixture(); f.props.career.teams[0].starters = [{ role: 'STARTER', careerPlayer: { id: 9, currentPosition: 'TOP', currentAge: 24, coachTrust: 70, playerCard: { player: { nickname: 'PLAYER_9' } } } }];
    const h = harness('ContractsView.tsx', { ...f.props, initialOfferId: null, onCareerRefresh: async () => {} }, async url => url.endsWith('/calendar') ? { currentDate: '2026-11-23', blockingEvents: [] } : [], { './PlayerSalesPanel': { __esModule: true, default: () => 'SALE_PANEL' } });
    assert.match(await h.mount(), /1억원/); h.button('선수 팔기').props.onClick(); assert.match(h.render(), /SALE_PANEL/);
    const salary = h.nodes().find(n => n.type === 'input' && n.props.type === 'number'); assert.equal(salary.props.value, 10000); salary.props.onChange({ target: { valueAsNumber: 9999 } }); assert.match(h.render(), /9,999만원/);
  });
  console.log(`Market UI checks passed: ${checks} scenarios (actual handlers and SSR, not browser layout).`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
