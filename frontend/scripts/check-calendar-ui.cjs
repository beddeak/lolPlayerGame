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
    if (name === "./MatchSpectator") return { __esModule:true,default:function MatchSpectator(){return null;} };
    if (name === "./match-spectator") return require('./load-source.cjs').loadSource('match-spectator');
    if (name === "./ClubLogo") return loadClubLogo();
    if (name === "./InternationalPanel") return { __esModule: true, default: function InternationalPanel() { return null; } };
    if (name === "./QuickSimReport") return { __esModule: true, default: function QuickSimReport() { return React.createElement("dialog", { "aria-label": "Quick Sim 경기 결과" }); } };
    if (name === "./DraftPreviewDialog") return { __esModule: true, default: function DraftPreviewDialog() { return React.createElement("dialog", { "aria-label": "밴픽 화면 미리보기" }); } };
    if (name === "./MatchFlowDialog") return { __esModule: true, default: function MatchFlowDialog() { return React.createElement("dialog", { "aria-label": "경기 밴픽" }); } };
    if (name === "./ManagerOffersPanel") return { __esModule: true, default: () => null };
    if (name === "./SeasonSkipDialog") return { __esModule: true, default: () => null };
    if (name === "./LeagueBracket") return { __esModule: true, default: function LeagueBracket({stage}) { return React.createElement('section',{'aria-label': `${stage.name} 대진표`}); } };
    if (name === "./league-stage") return require('./load-source.cjs').loadSource('league-stage');
    if (name === "./LeagueStandings") return require('./load-league-standings.cjs');
    if (name === "./ClubNewsDrawer") {
      const ClubNewsDrawer = () => null;
      return { __esModule: true, default: ClubNewsDrawer, ClubNewsDrawer };
    }
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
    standaloneCalendar: (calendarProps) => module.exports.SeasonCalendarView(calendarProps),
    children: () => React.Children.toArray(tree.props.children).filter(React.isValidElement),
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
  assert.equal((html.match(/국제대회 · 진출 조건 확인/g) ?? []).length, 3);
  assert.match(html, /주전과 후보 선수단 확인/);
  assert.match(html, /2026\.07\.29/);
  assert.ok(data.calls.every((call) => !call.options?.method));
  assert.ok(view.button("연간 리그 일정 연결"));
  assert.ok(view.button("LCK SPLIT 1 일정 생성"));
}

async function calendarDisclosureLayout() {
  const data = fixture();
  const view = harness(data.props, data.request);
  await view.mount();
  const standalone = view.standaloneCalendar({ calendar: data.calendar, busy: false, onStart() {} });
  const standaloneDisclosure = React.Children.toArray(standalone.props.children)[0];
  assert.equal(standaloneDisclosure.type, "details");
  assert.notEqual(standaloneDisclosure.props.open, true, "The standalone calendar must remain collapsed by default");
  assert.doesNotMatch(renderToStaticMarkup(standaloneDisclosure).split(">", 1)[0], /\bopen(?:\s|=|$)/);
  const panels = view.nodes().filter((node) => node.props.className === "annual-season-panel");
  assert.equal(panels.length, 1, "The annual calendar must appear only once");
  assert.equal(panels[0].props["aria-label"], "연간 시즌 일정");
  const disclosure = React.Children.toArray(panels[0].props.children)[0];
  assert.equal(disclosure.type, "details");
  assert.equal(disclosure.props.className, "season-calendar-disclosure");
  assert.equal(disclosure.props.open, true, "The hub calendar must start expanded to fill the space below league standings");
  const [summary, body] = React.Children.toArray(disclosure.props.children);
  assert.equal(summary.type, "summary", "The native disclosure control must be first");
  const summaryHtml = renderToStaticMarkup(summary);
  assert.match(summaryHtml, /2026/);
  assert.match(summaryHtml, /프리시즌/);
  assert.match(summaryHtml, /2026\.01\.01 – 2026\.01\.13/);
  assert.match(summaryHtml, /자동 일정 연결 전/);
  assert.match(summaryHtml, /펼치기/);
  assert.match(summaryHtml, /접기/);
  assert.doesNotMatch(summaryHtml, /<(?:button|a|input|select|textarea)\b/, "Only the disclosure itself should be interactive in its summary");
  assert.equal(body.props.className, "season-calendar-body");
  const bodyHtml = renderToStaticMarkup(body);
  assert.match(bodyHtml, /연간 리그 일정 연결/);
  assert.match(bodyHtml, /다음 구간/);
  assert.match(bodyHtml, /주전과 후보 선수단 확인/);
  assert.equal((bodyHtml.match(/class="season-period period-/g) ?? []).length, 14);
  const children = view.children();
  const content = children.find((node) => node.props.className === "season-content-grid");
  assert.ok(content);
  const columns = React.Children.toArray(content.props.children).filter(React.isValidElement);
  assert.deepEqual(columns.map((node) => node.props.className), ["season-main-column", "season-side-column"]);
  const mainChildren = React.Children.toArray(columns[0].props.children).filter(React.isValidElement);
  assert.deepEqual(mainChildren.map((node) => node.props.className ?? node.type.name), [
    "league-center-panel", "SeasonCalendarView", "other-match-history",
  ], "The left column stacks standings, calendar and optional other-club results");
  const sideHtml = renderToStaticMarkup(columns[1]);
  assert.doesNotMatch(sideHtml, /annual-season-panel/, "The calendar must not be duplicated in the side column");
  const mainHtml = children.filter((node) => node.type !== "dialog").map((node) => renderToStaticMarkup(node)).join("");
  assert.doesNotMatch(mainHtml, /event-feed-panel|이벤트 큐|INBOX/, "The hub must not show a permanent event feed outside club news");
  assert.ok(children.every((node) => node.type.name !== "SeasonCalendarView"), "The calendar must not also appear outside the content grid");
  assert.ok(data.calls.every((call) => !call.options?.method));
}

async function calendarBeforeQuickSimReport() {
  const data = fixture();
  const opponent = { id: 11, code: "T1", name: "T1", region: "LCK" };
  data.calendar.nextMatch = {
    id: 21, leagueSplitId: 1, scheduledDate: data.calendar.currentDate,
    region: "LCK", splitNumber: 1, stageCode: "REGULAR", bestOf: 3, roundNumber: 1,
    teamA: data.career.teams[0], teamB: opponent,
  };
  data.calendar.dueMatches = [data.calendar.nextMatch];
  const posts = [];
  const view = harness(data.props, async (url, options) => {
    if (options?.method === "POST") {
      posts.push({ url, options });
      return { series: { winnerTeamId: 10, bestOf: 3, teams: [
        { teamId: 10, teamCode: "HLE", wins: 2 },
        { teamId: 11, teamCode: "T1", wins: 0 },
      ], games: [] } };
    }
    return data.request(url, options);
  });
  await view.mount();
  const quickSim = view.button("경기 시작밴픽부터 세트별 진행 →");
  assert.equal(quickSim.props.disabled, false);
  quickSim.props.onClick();
  await settle();
  assert.match(view.render(), /경기 밴픽/);
  const children = view.children();
  const contentIndex = children.findIndex((node) => node.props.className === "season-content-grid");
  const internationalIndex = children.findIndex((node) => node.type.name === "InternationalPanel");
  const reportIndex = children.findIndex((node) => node.type.name === "MatchFlowDialog");
  assert.ok(contentIndex >= 0);
  assert.equal(internationalIndex, contentIndex + 1, "International competitions must appear after the content grid containing the calendar");
  assert.ok(reportIndex > internationalIndex, "The result dialog must remain after the calendar and international competitions");
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, "/careers/1/league-splits/1/fixtures/21/prepare");
  assert.equal(posts[0].options.body, undefined);
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
  const disclosure = view.nodes().find((node) => node.props.className === "season-calendar-disclosure");
  assert.equal(disclosure.props.open, true);
  const summary = React.Children.toArray(disclosure.props.children)[0];
  const summaryHtml = renderToStaticMarkup(summary);
  assert.match(summaryHtml, /일정[^<]*1건/, "Schedule warnings must remain visible while collapsed");
  assert.match(summaryHtml, /지역[^<]*3/, "The collapsed summary must count only unready regions");
  assert.doesNotMatch(summaryHtml, /자동 일정 연결 전/);
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
  const button = view.button("다음 캘린더 이벤트로→");
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
  assert.equal(view.button("다음 주요 일정까지 진행 ▶").props.disabled, true);
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
  assert.doesNotMatch(html, /add-split-panel|NEXT COMPETITION|다음 스플릿 일정을 미리 생성/, "Existing splits must not expose the removed competition preview");
  assert.equal(view.button("일정 생성"), undefined);
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

async function autoContinue(cancel = false, changeSave = false, failure = false) {
  const data = fixture();
  data.calendar.autoSchedule = true;
  let posts = 0;
  const pending = deferred();
  const response = () => ({ calendar: { ...data.calendar }, previousDate: '2026-01-01', currentDate: '2026-01-02', advancedDays: 1,
    stopReason: 'FIXTURE_LIMIT', simulatedFixtures: [{ fixtureId: 1 }], simulatedInternationalFixtures: [] });
  const view = harness(data.props, async (url, options) => {
    if (options?.method === 'POST') {
      posts++;
      assert.equal(url, '/careers/1/simulations/fast');
      assert.deepEqual(options.body, { days: 3, maxFixtures: 5, focusManagedTeam: true });
      if (posts === 1) return pending.promise;
      if (failure) throw new Error('Stopped network');
      return { ...response(), stopReason: 'WEEKLY_ACTIVITY', simulatedFixtures: [] };
    }
    return data.request(url, options);
  });
  await view.mount();
  const click = view.button('다음 주요 일정까지 진행 ▶').props.onClick;
  click(); click();
  view.render();
  assert.equal(posts, 1, 'Same-tick double click must not start two loops');
  assert.ok(view.button('진행 중단'));
  if (cancel) view.button('진행 중단').props.onClick();
  if (changeSave) await view.update({ career: { ...data.career, id: 2 } });
  pending.resolve(response());
  await settle();
  const html = view.render();
  assert.equal(posts, cancel || changeSave ? 1 : 2);
  if (changeSave) assert.equal(data.refreshes(), 0, 'Old auto run must not refresh a new save');
  else assert.equal(data.refreshes(), 1);
  if (failure) assert.match(html, /Stopped network/);
  else if (!cancel && !changeSave) assert.ok(view.button('주간 스크림·휴식 선택'));
  if (cancel) assert.match(html, /진행을 중단했습니다/);
}

async function ownFixtureAndHistory() {
  const data = fixture();
  const team = id => ({ id, code: `CLUB${id}`, name: `Club ${id}` });
  const fixtureRow = (id, a, b, date, status = 'SCHEDULED') => ({ id, teamA: team(a), teamB: team(b), scheduledDate: date, status, leagueStageId: 7, bestOf: 3, roundNumber: 1, teamAWins: status === 'COMPLETED' ? 2 : 0, teamBWins: 0 });
  const ai = fixtureRow(1, 20, 30, '2026-01-02');
  const own = fixtureRow(2, 10, 30, '2026-01-04');
  data.calendar.nextMatch = { ...ai, leagueSplitId: 5, region: 'LCK', splitNumber: 1, stageCode: 'REGULAR', year: 2026 };
  const games = [ai, own, fixtureRow(3, 20, 30, '2026-01-01', 'COMPLETED'), fixtureRow(4, 10, 20, '2026-01-01', 'COMPLETED')];
  const split = { id: 5, year: 2026, region: 'LCK', splitNumber: 1, stages: [{ id: 7, code: 'REGULAR', name: 'Regular', fixtures: games, standings: [], status: 'ACTIVE' }], fixtures: games };
  const view = harness(data.props, (url, options) => url.endsWith('/league-splits') ? Promise.resolve([split]) : data.request(url, options));
  await view.mount();
  const match = view.nodes().find(node => node.type.name === 'NextMatchCard');
  assert.equal(match.props.fixture.id, own.id, 'AI nextMatch cannot replace the managed club card');
  const history = view.nodes().find(node => node.props.className === 'other-match-history');
  const html = renderToStaticMarkup(history);
  assert.match(html, /CLUB20/); assert.match(html, /2 : 0/); assert.doesNotMatch(html, /CLUB10/);
  const schedule = view.nodes().find(node => node.type.name === 'FixtureList');
  assert.ok(schedule.props.fixtures.every(game => game.teamA.id === 10 || game.teamB.id === 10));
  const open = view.nodes().find(node => node.props.className === 'quick-sim-button');
  assert.equal(open.props.disabled, true, 'Future fixtures cannot start a real draft');
  assert.ok(!view.nodes().some(node => node.props.className === 'open-draft-preview'));
}

async function bracketStageRouting() {
  const data=fixture();
  const regular={id:1,code:'REGULAR',name:'정규시즌',format:'ROUND_ROBIN',status:'COMPLETED',currentRound:1,standings:[],fixtures:[]};
  const playoff={...regular,id:2,code:'PLAYOFFS',name:'플레이오프',format:'DOUBLE_ELIMINATION',status:'ACTIVE'};
  const split={id:5,year:2026,region:'LCK',splitNumber:1,name:'LCK S1',status:'IN_PROGRESS',stages:[regular,playoff],fixtures:[]};
  const view=harness(data.props,(url,o)=>url.endsWith('/league-splits')?Promise.resolve([split]):data.request(url,o));
  assert.match(await view.mount(),/플레이오프 대진표/);
  assert.equal(view.nodes().filter(n=>n.type.name==='LeagueStandings').length,0);
  view.button('정규시즌').props.onClick();view.render();
  assert.equal(view.nodes().filter(n=>n.type.name==='LeagueStandings').length,1);
  view.button('현재 단계').props.onClick();assert.match(view.render(),/플레이오프 대진표/);
  assert.ok(data.calls.every(c=>!c.options?.method),'Browsing brackets cannot simulate or create fixtures');
  view.unmount();
}

async function managedGroupRank() {
  const data=fixture();
  const row={teamId:10,teamCode:'CLUB10',teamName:'Club 10',rank:8,played:3,seriesWins:2,seriesLosses:1,gameDifference:1};
  const stage={id:7,code:'GROUP_BATTLE',name:'그룹 배틀',format:'GROUP',status:'ACTIVE',currentRound:1,
    settings:{pairingMode:'CROSS_GROUP'},participants:[{teamId:10,groupCode:'BARON'}],fixtures:[],standings:[row],
    groups:[{code:'BARON',name:'바론 그룹',points:2,seriesWins:2,seriesLosses:1,gameDifference:1,battleStatus:'LEADING',standings:[{...row,rank:1}]}]};
  const split={id:5,year:2026,region:'LCK',splitNumber:1,name:'LCK S1',status:'IN_PROGRESS',stages:[stage],fixtures:[]};
  const view=harness(data.props,(url,o)=>url.endsWith('/league-splits')?Promise.resolve([split]):data.request(url,o));
  const html=await view.mount();
  assert.match(html,/그룹별 순위/);
  const snapshot=view.nodes().find(n=>n.props.className==='snapshot-metrics');
  const snapshotHtml=renderToStaticMarkup(snapshot);
  assert.match(snapshotHtml,/바론 그룹 순위/);assert.match(snapshotHtml,/<strong>1<small>위/);
  assert.doesNotMatch(snapshotHtml,/<strong>8<small>위/);
  assert.equal(view.nodes().filter(n=>n.type==='table'&&n.props.className==='league-standings-table').length,1);
  assert.ok(data.calls.every(c=>!c.options?.method),'Group display is read-only');
  view.unmount();
}

async function spectatorDemoReadOnly() {
  const data=fixture();
  const positions=['TOP','JUNGLE','MID','ADC','SUPPORT'];
  const roster=(base)=>positions.map((position,i)=>({starterPosition:position,careerPlayer:{id:base+i,playerCard:{player:{nickname:`P${base+i}`},imageUrl:null}}}));
  data.career.teams[0].starters=roster(1);
  data.career.teams.push({...data.career.teams[0],id:20,code:'T1',isUserControlled:false,starters:roster(11)});
  const view=harness(data.props,data.request);await view.mount();const count=data.calls.length;
  view.button('▶ 협곡 관전 데모  · 저장 영향 없음').props.onClick();view.render();
  const spectator=view.nodes().find(n=>n.type.name==='MatchSpectator');assert.ok(spectator);assert.equal(spectator.props.replay.demo,true);
  assert.equal(data.calls.length,count,'demo cannot trigger any API request');spectator.props.onClose();view.render();
  assert.ok(!view.nodes().some(n=>n.type.name==='MatchSpectator'));assert.equal(data.calls.length,count);view.unmount();
}

(async () => {
  await spectatorDemoReadOnly();
  await bracketStageRouting();
  await managedGroupRank();
  await autoContinue();
  await autoContinue(true);
  await autoContinue(false, true);
  await autoContinue(false, false, true);
  await ownFixtureAndHistory();
  await annualReadOnly();
  await calendarDisclosureLayout();
  await calendarBeforeQuickSimReport();
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
  console.log("Calendar UI checks passed: bracket/standings routing, group-local managed rank, historical stage browsing, managed match focus, continuation, cancel, failures and session isolation.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
