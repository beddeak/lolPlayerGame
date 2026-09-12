// Runs the actual SeasonHub component with controlled hooks and SSR, not browser clicks.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

async function settle() {
  for (let i = 0; i < 4; i++) await new Promise((resolve) => setImmediate(resolve));
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function harness(props, request) {
  const slots = [];
  let cursor = 0, writes = 0, effects = [], tree;
  const same = (a, b) => a && b && a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
  const memo = (factory, dependencies) => {
    const i = cursor++;
    if (!slots[i] || !same(slots[i].dependencies, dependencies)) slots[i] = { value: factory(), dependencies };
    return slots[i].value;
  };
  const hooks = {
    ...React,
    useMemo: memo,
    useCallback: (callback, dependencies) => memo(() => callback, dependencies),
    useState(initial) {
      const i = cursor++;
      if (!slots[i]) slots[i] = { value: typeof initial === "function" ? initial() : initial };
      return [slots[i].value, (value) => { writes++; slots[i].value = typeof value === "function" ? value(slots[i].value) : value; }];
    },
    useRef(initial) {
      const i = cursor++;
      if (!slots[i]) slots[i] = { current: initial };
      return slots[i];
    },
    useEffect(effect, dependencies) {
      const i = cursor++;
      if (!slots[i] || !same(slots[i].dependencies, dependencies)) {
        const previous = slots[i];
        slots[i] = { dependencies };
        effects.push(() => { previous?.cleanup?.(); slots[i].cleanup = effect(); });
      }
    },
  };
  const entry = path.resolve(__dirname, "../src/SeasonHubView.tsx");
  const localRequire = createRequire(entry);
  const output = ts.transpileModule(fs.readFileSync(entry, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", output)((name) => {
    if (name === "react") return hooks;
    if (name === "./api") return { apiRequest: request, ApiError: Error };
    if (name.endsWith(".css")) return {};
    return localRequire(name);
  }, module, module.exports);
  const text = (node) => Array.isArray(node) ? node.map(text).join("") : React.isValidElement(node)
    ? text(node.props.children) : typeof node === "string" || typeof node === "number" ? String(node) : "";
  function render() {
    cursor = 0;
    tree = module.exports.default(props);
    return renderToStaticMarkup(tree);
  }
  function nodes() {
    const result = [];
    const visit = (node) => {
      if (Array.isArray(node)) return node.forEach(visit);
      if (!React.isValidElement(node)) return;
      result.push(node);
      if (typeof node.type === "function") visit(node.type(node.props));
      else visit(node.props.children);
    };
    visit(tree);
    return result;
  }
  return {
    render, nodes, writes: () => writes,
    button: (label) => nodes().find((node) => node.type === "button" && text(node).trim() === label),
    async mount() {
      render();
      const pending = effects;
      effects = [];
      pending.forEach((effect) => effect());
      await settle();
      return render();
    },
    async update(next) { props = { ...props, ...next }; return this.mount(); },
    unmount() { slots.forEach((slot) => slot?.cleanup?.()); },
  };
}

function fixture(status = "ACTIVE") {
  const manager = {
    careerId: 1, careerTeamId: 10, status, fanApproval: 32, boardConfidence: 71,
    canManage: status !== "DISMISSED", trackingStartedDate: "2026-01-01", reviewYear: 2026,
    record: { played: 8, wins: 3, losses: 5, expectedWins: 4.6, winningStreak: 0, losingStreak: 2 },
    warning: status === "WARNING" ? { issuedDate: "2026-02-01", issuedAtPlayed: 7, minimumAdditionalSeries: 3 } : null,
    dismissedDate: status === "DISMISSED" ? "2026-02-10" : null,
    recentReviews: [{ id: 1, date: "2026-02-10", type: "SERIES", title: "시리즈 평가", reason: "기대 전력 대비 패배했습니다.", fanDelta: -2, boardDelta: -1, fanApproval: 32, boardConfidence: 71 }],
  };
  const phase = { code: "SPLIT_1", label: "Split 1", kind: "REGIONAL", startsAt: "2026-01-14", endsAt: "2026-03-08", splitNumber: 1, status: "CURRENT", activities: ["리그 경기 진행"] };
  const match = { id: 20, scheduledDate: "2026-02-10", leagueSplitId: 2, leagueStageId: 3, year: 2026, region: "LCK", splitNumber: 1, stageCode: "REGULAR", roundNumber: 1, bestOf: 3, teamA: { id: 10, code: "HLE", name: "Hanwha Life" }, teamB: { id: 11, code: "GEN", name: "Gen.G" } };
  const calendar = {
    careerId: 1, currentDate: "2026-02-10", currentYear: 2026, autoSchedule: false, manager,
    season: { year: 2026, currentPhase: phase, nextPhase: null, nextBoundaryDate: "2026-03-09", periods: [phase] },
    scheduleWarnings: [], seasonReadiness: [], canCloseTransferWindow: false,
    transferWindow: { isOpen: false, nextBoundaryDate: null, nextBoundaryType: "OPEN" },
    nextMatch: match, dueMatches: [match], blockingEvents: [],
  };
  const career = { id: 1, teams: [{ id: 10, code: "HLE", name: "Hanwha Life", region: "LCK", isUserControlled: true, chemistry: 80, starters: [], benches: [] }] };
  const calls = [];
  let backs = 0, refreshes = 0;
  const data = {
    manager, calendar, career, calls, events: [], splits: [],
    backs: () => backs, refreshes: () => refreshes,
    props: { career, token: "session-a", onBack: () => { backs++; }, onCareerRefresh: async () => { refreshes++; }, onOpenContracts() {}, onOpenLegends() {} },
    async request(url, options) {
      calls.push({ url, options });
      if (url.endsWith("/calendar")) return data.calendar;
      if (url.endsWith("/events")) return data.events;
      if (url.endsWith("/league-splits")) return data.splits;
      throw new Error(`Unexpected request: ${url}`);
    },
  };
  return data;
}

const cases = [];
const test = (name, run) => cases.push({ name, run });

test("fan and board remain independent with public record", async () => {
  const data = fixture();
  const view = harness(data.props, data.request);
  const html = await view.mount();
  const bars = view.nodes().filter((node) => node.props.role === "progressbar");
  assert.equal(bars.length, 2);
  assert.equal(bars.find((node) => node.props["aria-label"] === "팬 지지도").props["aria-valuenow"], 32);
  assert.equal(bars.find((node) => node.props["aria-label"] === "이사회 신뢰").props["aria-valuenow"], 71);
  assert.match(html, /재직 중/);
  assert.match(html, /8경기 · 3승 5패/);
  assert.match(html, /4\.6승/);
  assert.match(html, /2연패/);
  assert.match(html, /성적 부진 · 낮은 팬 지지도 · 낮은 이사회 신뢰가 모두 겹치면/);
  assert.ok(!view.button("+1하루 진행").props.disabled);
  assert.equal(data.calls.length, 3, "Manager status comes from calendar without extra API requests");
  assert.ok(data.calls.every((call) => !call.options?.method));
});

test("warning shows remaining grace but does not stop management", async () => {
  const data = fixture("WARNING");
  const view = harness(data.props, data.request);
  const html = await view.mount();
  assert.match(html, /개선 경고/);
  assert.match(html, /경고 후 최소 3시리즈/);
  assert.match(html, /현재 1시리즈 진행 · 최소 2시리즈 남음/);
  assert.match(html, /유예가 끝나도 즉시 경질되는 것은 아닙니다/);
  assert.ok(!view.button("+1하루 진행").props.disabled);
});

test("expired warning grace never displays negative games", async () => {
  const data = fixture("WARNING");
  data.manager.record.played = 15;
  const html = await harness(data.props, data.request).mount();
  assert.match(html, /현재 8시리즈 진행 · 최소 0시리즈 남음/);
});

test("dismissal preserves save and explicitly explains unavailable new jobs", async () => {
  const data = fixture("DISMISSED");
  const html = await harness(data.props, data.request).mount();
  assert.match(html, /감독직 종료/);
  assert.match(html, /저장 데이터와 선수·계약·경기 기록은 유지됩니다/);
  assert.match(html, /구단 운영과 일정 진행은 중단/);
  assert.match(html, /감독 제안과 재취업은 아직 구현되지 않았습니다/);
  assert.match(html, /기대 전력 대비 패배했습니다/);
  assert.doesNotMatch(html, /재취업하기|저장 삭제|자동 재시작/);
});

test("all rendered mutation buttons and forged dispatch are blocked after dismissal", async () => {
  const data = fixture("DISMISSED");
  const meeting = { id: 5, type: "PLAYER_MEETING", status: "READY", requiresUserAction: true, scheduledDate: "2026-02-10", payload: null };
  const reveal = { ...meeting, id: 6, type: "LEGEND_REVEAL" };
  data.events = [meeting, reveal];
  data.calendar.blockingEvents = [meeting, reveal];
  data.calendar.canCloseTransferWindow = true;
  const view = harness(data.props, data.request);
  await view.mount();
  const buttons = view.nodes().filter((node) => node.type === "button" && node !== view.button("← 구단 사무실"));
  assert.ok(buttons.length >= 14);
  for (const button of buttons) {
    assert.equal(button.props.disabled, true, "Every mutation button must be disabled");
    button.props.onClick(); // Calling a disabled handler directly must still be harmless.
  }
  await settle();
  assert.equal(data.calls.filter((call) => call.options?.method === "POST").length, 0);
});

test("read-only history tabs and back navigation remain available", async () => {
  const data = fixture("DISMISSED");
  const split = (id, year) => ({ id, year, region: "LCK", splitNumber: 1, name: "LCK Split 1", status: "COMPLETED", stages: [{ id, name: `${year} 정규 리그`, status: "COMPLETED", currentRound: 1, fixtures: [], standings: [] }] });
  data.splits = [split(1, 2025), split(2, 2026)];
  const view = harness(data.props, data.request);
  await view.mount();
  const tab = view.button("2025 LCK S1");
  assert.ok(!tab.props.disabled);
  tab.props.onClick();
  assert.match(view.render(), /2025 · LCK Split 1/);
  assert.equal(view.button("2025 LCK S1").props.className, "active");
  view.button("← 구단 사무실").props.onClick();
  assert.equal(data.backs(), 1);
  assert.ok(data.calls.every((call) => !call.options?.method));
});

test("legacy API without manager status keeps existing controls usable", async () => {
  const data = fixture();
  delete data.calendar.manager;
  const view = harness(data.props, data.request);
  const html = await view.mount();
  assert.doesNotMatch(html, /팬과 이사회의 평가/);
  assert.ok(!view.button("+1하루 진행").props.disabled);
  assert.ok(view.button("연간 리그 일정 연결"));
});

test("uninitialized manager and empty review history are explained", async () => {
  const data = fixture();
  data.manager.trackingStartedDate = null;
  data.manager.recentReviews = [];
  data.manager.record = { played: 0, wins: 0, losses: 0, expectedWins: 0, winningStreak: 0, losingStreak: 0 };
  const html = await harness(data.props, data.request).mount();
  assert.match(html, /첫 평가 시점부터 기록을 시작합니다/);
  assert.match(html, /과거 경기는 소급 평가하지 않습니다/);
  assert.match(html, /아직 평가 기록이 없습니다/);
  assert.match(html, /시리즈 결과 대기/);
});

test("review deltas and server reasons are escaped and individually displayed", async () => {
  const data = fixture();
  data.manager.recentReviews[0] = { ...data.manager.recentReviews[0], fanDelta: 3, boardDelta: 0, title: "<script>bad</script>", reason: "<img src=x onerror=bad()>" };
  data.manager.record.winningStreak = 3;
  const html = await harness(data.props, data.request).mount();
  assert.match(html, /팬 \+3 → 32/);
  assert.match(html, /이사회 0 → 71/);
  assert.match(html, /3연승/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>|<img src=x/);
});

for (const type of ["MANAGER_REVIEW", "JOB_SECURITY_WARNING", "MANAGER_DISMISSED"]) {
  test(`${type} is nonblocking news even if an old payload is READY`, async () => {
    const data = fixture();
    const news = { id: 5, type, status: "READY", requiresUserAction: false, scheduledDate: "2026-02-10", payload: { message: `public ${type} reason` } };
    data.events = [news];
    data.calendar.blockingEvents = [news];
    const view = harness(data.props, data.request);
    const html = await view.mount();
    assert.match(html, new RegExp(`public ${type} reason`));
    assert.equal(view.button("처리"), undefined);
    assert.doesNotMatch(html, /진행 전에 처리해야 할 이벤트/);
    assert.ok(!view.button("+1하루 진행").props.disabled);
    assert.ok(data.calls.every((call) => !call.options?.method));
  });
}

test("completed manager news remains visible", async () => {
  const data = fixture();
  data.events = [{ id: 5, type: "MANAGER_REVIEW", status: "COMPLETED", requiresUserAction: false, scheduledDate: "2026-02-10", payload: { reason: "완료된 감독 평가 사유" } }];
  assert.match(await harness(data.props, data.request).mount(), /완료된 감독 평가 사유/);
});

test("fast sim dismissal disables even callbacks captured before the result", async () => {
  const data = fixture();
  const pending = deferred();
  let posts = 0;
  const view = harness(data.props, async (url, options) => {
    if (options?.method === "POST") { posts++; return pending.promise; }
    return data.request(url, options);
  });
  await view.mount();
  const previousDayClick = view.button("+1하루 진행").props.onClick;
  const click = view.button("7DFast Sim").props.onClick;
  click(); click();
  assert.equal(posts, 1);
  data.calendar = fixture("DISMISSED").calendar;
  pending.resolve({ calendar: data.calendar, stopReason: "MANAGER_DISMISSED", advancedDays: 3, simulatedFixtures: [] });
  await settle();
  const html = view.render();
  assert.match(html, /감독 경질로 구단 운영과 일정 진행이 중단/);
  assert.equal(view.button("+1하루 진행").props.disabled, true);
  previousDayClick(); click();
  await settle();
  assert.equal(posts, 1, "Captured handlers must consult current management permission");
  assert.equal(data.refreshes(), 1);
});

test("calendar advancement dismissal immediately stops management", async () => {
  const data = fixture();
  const pending = deferred();
  const view = harness(data.props, async (url, options) => options?.method === "POST" ? pending.promise : data.request(url, options));
  await view.mount();
  view.button("+1하루 진행").props.onClick();
  data.calendar = fixture("DISMISSED").calendar;
  pending.resolve({ ...data.calendar, mode: "ONE_DAY", previousDate: "2026-02-09", advancedDays: 1, stopReason: "MANAGER_DISMISSED", processedEvents: [] });
  await settle();
  assert.match(view.render(), /감독직이 종료되었습니다/);
  assert.equal(view.button("연간 리그 일정 연결").props.disabled, true);
});

for (const reject of [false, true]) {
  test(`old career ${reject ? "rejection" : "dismissal response"} cannot overwrite new active career`, async () => {
    const oldData = fixture("DISMISSED");
    const next = fixture();
    next.career.id = 2;
    next.calendar.careerId = 2;
    next.manager.careerId = 2;
    const pending = deferred();
    const view = harness(oldData.props, async (url, options) => url === "/careers/1/calendar" ? pending.promise : url.startsWith("/careers/2/") ? next.request(url, options) : []);
    await view.mount();
    await view.update({ career: next.career, token: "session-b" });
    const writes = view.writes();
    if (reject) pending.reject(new Error("stale manager failure"));
    else pending.resolve(oldData.calendar);
    await settle();
    const html = view.render();
    assert.equal(view.writes(), writes);
    assert.match(html, /재직 중/);
    assert.doesNotMatch(html, /감독직이 종료되었습니다|stale manager failure/);
    assert.ok(!view.button("+1하루 진행").props.disabled);
  });
}

test("unmounted manager request cannot write state", async () => {
  const data = fixture("DISMISSED");
  const pending = deferred();
  const view = harness(data.props, async (url, options) => url.endsWith("/calendar") ? pending.promise : data.request(url, options));
  await view.mount();
  view.unmount();
  const writes = view.writes();
  pending.resolve(data.calendar);
  await settle();
  assert.equal(view.writes(), writes);
});

(async () => {
  for (const item of cases) {
    await item.run();
    console.log(`PASS ${item.name}`);
  }
  console.log(`Manager UI checks passed: ${cases.length} scenarios (separate confidence, warnings, dismissal, retained records, guards, nonblocking news, compatibility and request races).`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
