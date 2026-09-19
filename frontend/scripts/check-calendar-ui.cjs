// Actual SeasonHub SSR and handler checks, not browser/DOM integration tests.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { loadClubLogo } = require("./check-club-logo.cjs");
const settle = async () => {
  for (let i = 0; i < 4; i++) await new Promise((resolve) => setImmediate(resolve));
};
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function harness(props, request) {
  const slots = [];
  let cursor = 0;
  let effects = [];
  let tree;
  let writes = 0;
  const same = (a, b) => a && b && a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
  const memo = (factory, dependencies) => {
    const i = cursor++;
    if (!slots[i] || !same(slots[i].dependencies, dependencies)) slots[i] = { value: factory(), dependencies };
    return slots[i].value;
  };
  const hooks = {
    ...React,
    useMemo: memo,
    useCallback: (callback, deps) => memo(() => callback, deps),
    useState(initial) {
      const i = cursor++;
      if (!slots[i]) slots[i] = { value: typeof initial === "function" ? initial() : initial };
      return [slots[i].value, (value) => {
        writes++;
        slots[i].value = typeof value === "function" ? value(slots[i].value) : value;
      }];
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
    if (name === "./ClubLogo") return loadClubLogo();
    if (name === "./InternationalPanel") return { __esModule: true, default: () => null };
    if (name.endsWith(".css")) return {};
    return localRequire(name);
  }, module, module.exports);
  function render() {
    cursor = 0;
    tree = module.exports.default(props);
    return renderToStaticMarkup(tree);
  }
  const nodes = () => {
    const result = [];
    const visit = (node) => {
      if (Array.isArray(node)) return node.forEach(visit);
      if (!React.isValidElement(node)) return;
      result.push(node);
      if (node.type.name === "ClubLogo") return;
      if (typeof node.type === "function") visit(node.type(node.props));
      else visit(node.props.children);
    };
    visit(tree);
    return result;
  };
  const text = (node) => Array.isArray(node) ? node.map(text).join("") : React.isValidElement(node)
    ? text(node.props.children) : typeof node === "string" || typeof node === "number" ? String(node) : "";
  return {
    render,
    nodes,
    writes: () => writes,
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

const period = (code, label, kind, from, to, status, splitNumber = null) => ({
  code, label, kind, startsAt: `2026-${from}`, endsAt: `2026-${to}`, status, splitNumber,
  activities: kind === "PRESEASON" ? ["주전과 후보 선수단 확인", "팀 전략 확인"] : ["선수단과 다음 일정 확인"],
});
function fixture() {
  const periods = [
    period("PRESEASON", "프리시즌", "PRESEASON", "01-01", "01-13", "CURRENT"),
    period("SPLIT_1", "Split 1", "REGIONAL", "01-14", "03-08", "UPCOMING", 1),
    period("FIRST_STAND_BREAK", "First Stand 준비", "BREAK", "03-09", "03-15", "UPCOMING"),
    period("FIRST_STAND", "First Stand", "INTERNATIONAL", "03-16", "03-22", "UPCOMING"),
    period("SPRING_BREAK", "봄 휴식기", "BREAK", "03-23", "03-31", "UPCOMING"),
    period("SPLIT_2", "Split 2", "REGIONAL", "04-01", "06-21", "UPCOMING", 2),
    period("MSI_BREAK", "MSI 준비", "BREAK", "06-22", "06-28", "UPCOMING"),
    period("MSI", "MSI", "INTERNATIONAL", "06-29", "07-12", "UPCOMING"),
    period("SUMMER_BREAK", "여름 휴식기", "BREAK", "07-13", "07-28", "UPCOMING"),
    period("SPLIT_3", "Split 3", "REGIONAL", "07-29", "09-27", "UPCOMING", 3),
    period("WORLDS_BREAK", "Worlds 준비", "BREAK", "09-28", "10-13", "UPCOMING"),
    period("WORLDS", "Worlds", "INTERNATIONAL", "10-14", "11-14", "UPCOMING"),
    period("SEASON_REVIEW", "시즌 리뷰", "REVIEW", "11-15", "11-17", "UPCOMING"),
    period("OFFSEASON", "스토브리그", "OFFSEASON", "11-18", "12-31", "UPCOMING"),
  ];
  const calendar = {
    careerId: 1, currentDate: "2026-01-01", currentYear: 2026, autoSchedule: false,
    season: { year: 2026, currentPhase: periods[0], nextPhase: periods[1], nextBoundaryDate: "2026-01-14", periods },
    scheduleWarnings: [], seasonReadiness: [], canCloseTransferWindow: false,
    transferWindow: { isOpen: false, nextBoundaryDate: null, nextBoundaryType: "OPEN" },
    nextMatch: null, dueMatches: [], blockingEvents: [],
  };
  const career = {
    id: 1, currentDate: calendar.currentDate,
    teams: [{ id: 10, code: "HLE", name: "Hanwha Life", region: "LCK", isUserControlled: true, chemistry: 80, starters: [], benches: [] }],
  };
  const calls = [];
  let refreshes = 0;
  const props = { career, token: "session-a", onBack() {}, onCareerRefresh: async () => { refreshes++; }, onOpenContracts() {}, onOpenLegends() {} };
  return {
    calendar, career, props, calls, refreshes: () => refreshes,
    async request(url, options) {
      calls.push({ url, options });
      if (url.endsWith("/calendar")) return calendar;
      return [];
    },
  };
}

async function annualReadOnly() {
  const data = fixture();
  const view = harness(data.props, data.request);
  const html = await view.mount();
  assert.match(html, /올해의 여정/);
  assert.match(html, /src="\/club-logos\/hle.png"/);
  assert.match(html, /현재는 수동 일정 모드/);
  assert.equal((html.match(/class="season-period period-/g) ?? []).length, 14);
  assert.equal((html.match(/aria-current="date"/g) ?? []).length, 1);
  assert.equal((html.match(/기간 예약 · 경기 시스템 미구현/g) ?? []).length, 3);
  assert.match(html, /주전과 후보 선수단 확인/);
  assert.match(html, /2026\.07\.29/);
  assert.ok(data.calls.every((call) => !call.options?.method));
  assert.ok(view.button("연간 리그 일정 연결"));
  assert.ok(view.button("LCK SPLIT 1 일정 생성"));
}

async function yearRollover() {
  const data = fixture();
  const offseason = data.calendar.season.periods.at(-1);
  offseason.status = "CURRENT";
  data.calendar.season.periods[0].status = "COMPLETED";
  data.calendar.season.currentPhase = offseason;
  data.calendar.season.nextPhase = { ...data.calendar.season.periods[0], status: "UPCOMING", startsAt: "2027-01-01", endsAt: "2027-01-13" };
  data.calendar.season.nextBoundaryDate = "2027-01-01";
  const view = harness(data.props, data.request);
  assert.match(await view.mount(), /2027\.01\.01 – 2027\.01\.13/);
}

async function optInSuccess() {
  const data = fixture();
  const pending = deferred();
  const posts = [];
  const view = harness(data.props, async (url, options) => {
    if (options?.method === "POST") { posts.push({ url, options }); return pending.promise; }
    return data.request(url, options);
  });
  await view.mount();
  const click = view.button("연간 리그 일정 연결").props.onClick;
  click(); click();
  assert.equal(posts.length, 1, "Synchronous double clicks must not duplicate mutations");
  assert.equal(posts[0].url, "/careers/1/calendar/start-season");
  assert.equal(posts[0].options.token, "session-a");
  assert.equal(posts[0].options.body, undefined);
  view.render();
  assert.equal(view.button("연간 리그 일정 연결").props.disabled, true);
  data.calendar.autoSchedule = true;
  pending.resolve(data.calendar);
  await settle();
  const html = view.render();
  assert.match(html, /연간 리그 일정 연결됨/);
  assert.equal(view.button("연간 리그 일정 연결"), undefined);
  assert.equal(data.refreshes(), 1);
}

async function optInFailure() {
  const data = fixture();
  let posts = 0;
  const view = harness(data.props, async (url, options) => {
    if (options?.method === "POST") { posts++; throw new Error("리그 연결을 재시도하세요"); }
    return data.request(url, options);
  });
  await view.mount();
  view.button("연간 리그 일정 연결").props.onClick();
  await settle();
  const html = view.render();
  assert.match(html, /리그 연결을 재시도하세요/);
  assert.match(html, /현재는 수동 일정 모드/);
  assert.equal(view.button("연간 리그 일정 연결").props.disabled, false);
  assert.equal(data.refreshes(), 0);
  assert.equal(posts, 1);
}

async function preparationWarnings() {
  const data = fixture();
  data.calendar.autoSchedule = true;
  data.calendar.seasonReadiness = [
    { region: "LCK", teamCount: 2, status: "READY", message: "리그 준비됨", splitNumber: 1 },
    { region: "LPL", teamCount: 1, status: "INSUFFICIENT_TEAMS", message: "최소 2팀이 필요합니다", splitNumber: 1 },
    { region: "LEC", teamCount: 2, status: "WAITING_FOR_PREVIOUS_SPLIT", message: "이전 스플릿 완료가 필요합니다", splitNumber: 3 },
    { region: "LCS", teamCount: 2, status: "NO_REMAINING_SPLIT", message: "올해 남은 스플릿이 없습니다", splitNumber: null },
  ];
  data.calendar.scheduleWarnings = [{ fixtureId: 21, leagueSplitId: 1, scheduledDate: "2026-10-20", expectedEndDate: "2026-09-27", message: "기존 Split 3 경기" }];
  const before = JSON.stringify(data.calendar);
  const view = harness(data.props, data.request);
  const html = await view.mount();
  assert.match(html, /최소 2팀이 필요합니다/);
  assert.match(html, /이전 스플릿 완료가 필요합니다/);
  assert.match(html, /올해 남은 스플릿이 없습니다/);
  assert.match(html, /기존 경기 일정 확인 필요 · 1건/);
  assert.match(html, /2026-10-20/);
  assert.match(html, /구간 종료 2026-09-27/);
  assert.match(html, /임의로 옮기거나 삭제하지 않았습니다/);
  assert.equal(JSON.stringify(data.calendar), before);
  assert.ok(data.calls.every((call) => !call.options?.method));
}

async function seasonBoundaryAdvance() {
  const data = fixture();
  const posts = [];
  const view = harness(data.props, async (url, options) => {
    if (options?.method === "POST") {
      posts.push({ url, options });
      data.calendar.currentDate = "2026-01-14";
      data.calendar.season.currentPhase = data.calendar.season.periods[1];
      return { ...data.calendar, stopReason: "SEASON_BOUNDARY", advancedDays: 13 };
    }
    return data.request(url, options);
  });
  await view.mount();
  const button = view.button("다음 주요 일정까지 진행→");
  assert.equal(button.props.disabled, false, "Annual boundary is reachable without matches or events");
  button.props.onClick();
  await settle();
  assert.deepEqual(posts.map((post) => post.options.body), [{ mode: "NEXT_EVENT" }]);
  const html = view.render();
  assert.match(html, /Split 1 시작/);
  assert.match(html, /시즌 구간이 바뀌어 멈췄습니다/);
}

async function fastSimBoundary() {
  const data = fixture();
  const posts = [];
  const view = harness(data.props, async (url, options) => {
    if (options?.method === "POST") {
      posts.push({ url, options });
      return { calendar: data.calendar, stopReason: "SEASON_BOUNDARY", advancedDays: 7, simulatedFixtures: [] };
    }
    return data.request(url, options);
  });
  await view.mount();
  const button = view.button("7DFast Sim");
  assert.equal(button.props.disabled, false);
  button.props.onClick();
  await settle();
  assert.deepEqual(posts.map((post) => post.options.body), [{ days: 7, maxFixtures: 50 }]);
  assert.match(view.render(), /다음 시즌 구간에 도착했습니다/);
}

async function loadRace(reject) {
  const data = fixture();
  const pending = deferred();
  const next = fixture();
  next.calendar.careerId = 2;
  next.calendar.currentDate = "2026-02-20";
  const view = harness(data.props, async (url, options) => {
    if (url === "/careers/1/calendar") return pending.promise;
    if (url === "/careers/2/calendar") return next.calendar;
    return data.request(url, options);
  });
  await view.mount();
  await view.update({ career: { ...next.career, id: 2 }, token: "session-b" });
  assert.match(view.render(), /2월 20일/);
  if (reject) pending.reject(new Error("Old session load error"));
  else pending.resolve(data.calendar);
  await settle();
  const html = view.render();
  assert.match(html, /2월 20일/);
  assert.doesNotMatch(html, /Old session load error/);
}

async function mutationRace(reject, tokenOnly = false) {
  const data = fixture();
  const pending = deferred();
  let activeCalendar = data.calendar;
  const view = harness(data.props, async (url, options) => {
    if (options?.method === "POST") return pending.promise;
    if (url.endsWith("/calendar")) return activeCalendar;
    return data.request(url, options);
  });
  await view.mount();
  view.button("연간 리그 일정 연결").props.onClick();
  activeCalendar = { ...data.calendar, careerId: tokenOnly ? 1 : 2, currentDate: "2026-03-22" };
  await view.update({ career: { ...data.career, id: activeCalendar.careerId }, token: "session-b" });
  const previousCalls = data.calls.length;
  const previousWrites = view.writes();
  if (reject) pending.reject(new Error("Old session mutation error"));
  else pending.resolve({ ...data.calendar, autoSchedule: true });
  await settle();
  const html = view.render();
  assert.match(html, /3월 22일/);
  assert.doesNotMatch(html, /Old session mutation error/);
  assert.ok(view.button("연간 리그 일정 연결"));
  assert.equal(data.refreshes(), 0);
  assert.equal(data.calls.length, previousCalls);
  assert.equal(view.writes(), previousWrites);
}

async function unmountRace(loading) {
  const data = fixture();
  const pending = deferred();
  const view = harness(data.props, async (url, options) => {
    if ((loading && url.endsWith("/calendar")) || options?.method === "POST") return pending.promise;
    return data.request(url, options);
  });
  await view.mount();
  if (!loading) view.button("연간 리그 일정 연결").props.onClick();
  view.unmount();
  const previousWrites = view.writes();
  pending.resolve(data.calendar);
  await settle();
  assert.equal(view.writes(), previousWrites);
  assert.equal(data.refreshes(), 0);
}

async function manualSplitCompatibility() {
  const data = fixture();
  const posts = [];
  const view = harness(data.props, async (url, options) => {
    if (options?.method === "POST") { posts.push({ url, options }); return { id: 40 }; }
    return data.request(url, options);
  });
  await view.mount();
  view.button("LCK SPLIT 1 일정 생성").props.onClick();
  await settle();
  assert.equal(posts[0].url, "/careers/1/league-splits");
  assert.deepEqual(posts[0].options.body, { region: "LCK", splitNumber: 1 });
  assert.equal(data.calendar.autoSchedule, false);
  assert.match(view.render(), /현재는 수동 일정 모드/);
}

async function legacyCalendarResponse() {
  const data = fixture();
  delete data.calendar.season;
  delete data.calendar.autoSchedule;
  delete data.calendar.scheduleWarnings;
  delete data.calendar.seasonReadiness;
  const view = harness(data.props, data.request);
  const html = await view.mount();
  assert.match(html, /시즌 허브/);
  assert.doesNotMatch(html, /올해의 여정/);
  assert.ok(view.button("LCK SPLIT 1 일정 생성"));
}

async function blockingEventCompatibility() {
  const data = fixture();
  data.calendar.blockingEvents = [{ id: 1, type: "PLAYER_MEETING", status: "READY", requiresUserAction: true, payload: {} }];
  const view = harness(data.props, data.request);
  await view.mount();
  assert.equal(view.button("7DFast Sim").props.disabled, true);
  assert.equal(view.button("+1하루 진행").props.disabled, true);
  assert.equal(view.button("다음 주요 일정까지 진행→").props.disabled, true);
}

async function loadRetry() {
  const data = fixture();
  let failed = true;
  const view = harness(data.props, async (url, options) => {
    if (failed) throw new Error("Calendar outage");
    return data.request(url, options);
  });
  assert.match(await view.mount(), /Calendar outage/);
  failed = false;
  view.button("다시 시도").props.onClick();
  await settle();
  assert.match(view.render(), /올해의 여정/);
}

function multiYearFixture() {
  const data = fixture();
  data.calendar.currentYear = 2027;
  data.calendar.currentDate = "2027-01-01";
  const split = (id, year, region, status) => ({
    id, year, region, status, splitNumber: 1, name: `${region} Split 1`,
    stages: [{ id, name: "그룹 스테이지", status: "ACTIVE", currentRound: 1, standings: [], fixtures: [] }],
  });
  data.splits = [
    split(60, 2026, "LCK", "IN_PROGRESS"),
    split(71, 2027, "LPL", "IN_PROGRESS"),
    split(70, 2027, "LCK", "SCHEDULED"),
  ];
  data.makeSplit = split;
  const original = data.request;
  data.request = async (url, options) => {
    if (url.endsWith("/league-splits")) return data.splits;
    if (options?.method === "POST") return data.calendar;
    return original(url, options);
  };
  return data;
}

async function multiYearInitialSelection() {
  const data = multiYearFixture();
  const view = harness(data.props, data.request);
  const html = await view.mount();
  assert.ok(view.button("2026 LCK S1"));
  assert.ok(view.button("2027 LCK S1"));
  assert.equal(view.button("2027 LCK S1").props.className, "active");
  assert.equal(view.button("2026 LCK S1").props.className, "");
  assert.equal(view.button("2027 LPL S1").props.className, "");
  assert.match(html, /2027 · LCK Split 1/);
}

async function preserveHistoricalSelection() {
  const data = multiYearFixture();
  const view = harness(data.props, data.request);
  await view.mount();
  view.button("2026 LCK S1").props.onClick();
  view.render();
  data.calendar.currentYear = 2028;
  data.calendar.currentDate = "2028-01-01";
  data.splits.push(data.makeSplit(80, 2028, "LCK", "SCHEDULED"));
  view.button("+1하루 진행").props.onClick();
  await settle();
  const html = view.render();
  assert.equal(view.button("2026 LCK S1").props.className, "active");
  assert.equal(view.button("2028 LCK S1").props.className, "");
  assert.match(html, /2026 · LCK Split 1/);
}

async function missingHistoricalSelection() {
  const data = multiYearFixture();
  const view = harness(data.props, data.request);
  await view.mount();
  view.button("2026 LCK S1").props.onClick();
  view.render();
  data.splits = data.splits.filter((split) => split.year !== 2026);
  view.button("+1하루 진행").props.onClick();
  await settle();
  view.render();
  assert.equal(view.button("2026 LCK S1"), undefined);
  assert.equal(view.button("2027 LCK S1").props.className, "active");
}

(async () => {
  await annualReadOnly();
  await yearRollover();
  await optInSuccess();
  await optInFailure();
  await preparationWarnings();
  await seasonBoundaryAdvance();
  await fastSimBoundary();
  await loadRace(false);
  await loadRace(true);
  await mutationRace(false);
  await mutationRace(true);
  await mutationRace(false, true);
  await unmountRace(true);
  await unmountRace(false);
  await manualSplitCompatibility();
  await legacyCalendarResponse();
  await blockingEventCompatibility();
  await loadRetry();
  await multiYearInitialSelection();
  await preserveHistoricalSelection();
  await missingHistoricalSelection();
  console.log("Calendar UI checks passed: 21 scenarios (timeline, opt-in, boundaries, readiness, legacy saves, request/session races, unmount, retry, multi-year selection).");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
