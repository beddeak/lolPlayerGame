// Actual component SSR/handler checks with controlled hooks; no browser claim.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const settle = async () => {
  for (let i = 0; i < 3; i++)
    await new Promise((resolve) => setImmediate(resolve));
};

function harness(file, props, request) {
  const slots = [];
  let cursor = 0;
  let effects = [];
  let tree;
  const same = (a, b) =>
    a && b && a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
  const memo = (factory, dependencies) => {
    const i = cursor++;
    if (!slots[i] || !same(slots[i].dependencies, dependencies))
      slots[i] = { value: factory(), dependencies };
    return slots[i].value;
  };
  const hooks = {
    ...React,
    useMemo: memo,
    useCallback: (callback, deps) => memo(() => callback, deps),
    useState(initial) {
      const i = cursor++;
      if (!slots[i])
        slots[i] = {
          value: typeof initial === "function" ? initial() : initial,
        };
      return [
        slots[i].value,
        (value) => {
          slots[i].value =
            typeof value === "function" ? value(slots[i].value) : value;
        },
      ];
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
        effects.push(() => {
          previous?.cleanup?.();
          slots[i].cleanup = effect();
        });
      }
    },
  };
  const entry = path.resolve(__dirname, "../src", file);
  const localRequire = createRequire(entry);
  const output = ts.transpileModule(fs.readFileSync(entry, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", output)(
    (name) => {
      if (name === "react") return hooks;
      if (name === "./api") return { apiRequest: request, ApiError: Error };
      if (name.endsWith(".css")) return {};
      return localRequire(name);
    },
    module,
    module.exports,
  );
  const render = () => {
    cursor = 0;
    tree = module.exports.default(props);
    return renderToStaticMarkup(tree);
  };
  const nodes = () => {
    const found = [];
    const visit = (node) => {
      if (Array.isArray(node)) return node.forEach(visit);
      if (!React.isValidElement(node)) return;
      found.push(node);
      visit(node.props.children);
    };
    visit(tree);
    return found;
  };
  const text = (node) =>
    Array.isArray(node)
      ? node.map(text).join("")
      : React.isValidElement(node)
        ? text(node.props.children)
        : typeof node === "string" || typeof node === "number"
          ? String(node)
          : "";
  return {
    render,
    nodes,
    button: (label) =>
      nodes().find((node) => node.type === "button" && text(node) === label),
    form: () => nodes().find((node) => node.type === "form"),
    async mount() {
      render();
      const pending = effects;
      effects = [];
      pending.forEach((effect) => effect());
      await settle();
      return render();
    },
    unmount() {
      slots.forEach((slot) => slot?.cleanup?.());
    },
  };
}

function fixture() {
  const player = {
    careerPlayerId: 99,
    playerCardId: 9,
    nickname: "Viper",
    cardYear: 2021,
    position: "ADC",
    currentAge: 21,
    overall: 94,
    imageUrl: null,
    currentTeam: null,
    interestedClubs: [{ id: 20, code: "GEN", name: "Gen.G" }],
    canNegotiate: true,
  };
  const market = {
    careerId: 1,
    currentDate: "2026-11-23",
    events: [
      {
        id: 7,
        seasonYear: 2026,
        theme: { id: 3, code: "WORLDS_2021", name: "2021 Worlds Winners" },
        revealedDate: "2026-11-23",
        players: [player],
      },
    ],
  };
  const team = {
    id: 10,
    code: "HLE",
    name: "Hanwha Life",
    region: "LCK",
    isUserControlled: true,
    chemistry: 80,
    starters: [],
    benches: [],
  };
  const calendar = {
    careerId: 1,
    currentYear: 2026,
    currentDate: market.currentDate,
    canCloseTransferWindow: false,
    transferWindow: {
      nextBoundaryDate: "2027-01-01",
      nextBoundaryType: "CLOSE",
    },
    nextMatch: null,
    dueMatches: [],
    blockingEvents: [],
  };
  const career = { id: 1, currentDate: market.currentDate, teams: [team] };
  const opened = [];
  const props = {
    career,
    token: "test",
    onBack() {},
    onOpenSeason() {},
    onCareerUpdated: async () => {},
    onOpenContractOffer: (id) => opened.push(id),
  };
  return { player, market, calendar, career, opened, props };
}

async function emptyMarket() {
  const data = fixture();
  data.market.events = [];
  data.market.unpublishedDate = "2099-12-27";
  const calls = [];
  const view = harness(
    "LegendEventsView.tsx",
    data.props,
    async (url, options) => {
      calls.push({ url, options });
      return url.endsWith("legend-events") ? data.market : [];
    },
  );
  const html = await view.mount();
  assert.match(html, /아직 공개된 이벤트가 없습니다/);
  assert.doesNotMatch(html, /2099-12-27/);
  assert.equal(view.form(), undefined);
  assert.ok(calls.every((call) => !call.options?.method));
}

async function offerFlow() {
  const data = fixture();
  const posts = [];
  const view = harness(
    "LegendEventsView.tsx",
    data.props,
    async (url, options) => {
      if (options?.method === "POST") {
        posts.push({ url, body: options.body });
        return {
          id: 77,
          careerPlayerId: 99,
          status: "WAITING_PLAYER_RESPONSE",
        };
      }
      return url.endsWith("legend-events") ? data.market : [];
    },
  );
  const html = await view.mount();
  assert.match(html, /2021 Worlds Winners/);
  assert.match(html, /Viper/);
  assert.match(html, /GEN/);
  assert.match(html, />94</);
  view.form().props.onSubmit({ preventDefault() {} });
  await settle();
  assert.deepEqual(posts, [
    {
      url: "/careers/1/contracts/offers",
      body: {
        careerPlayerId: 99,
        terms: {
          annualSalary: 10000,
          years: 2,
          expectedRole: "STARTER",
          starterGuarantee: false,
          promises: [],
        },
      },
    },
  ]);
  assert.deepEqual(data.opened, [77]);
}

async function unavailable(signed) {
  const data = fixture();
  data.player.canNegotiate = false;
  if (signed) data.player.currentTeam = { id: 20, code: "GEN", name: "Gen.G" };
  const view = harness("LegendEventsView.tsx", data.props, async (url) =>
    url.endsWith("legend-events") ? data.market : [],
  );
  const html = await view.mount();
  assert.equal(view.form(), undefined);
  assert.match(html, signed ? /Gen.G 소속/ : /현재 계약 제안 불가/);
}

async function existingOffer() {
  const data = fixture();
  const view = harness("LegendEventsView.tsx", data.props, async (url) =>
    url.endsWith("legend-events")
      ? data.market
      : [{ id: 88, careerPlayerId: 99, status: "COUNTER_OFFERED" }],
  );
  await view.mount();
  assert.equal(view.form(), undefined);
  view.button("협상 이어가기 →").props.onClick();
  assert.deepEqual(data.opened, [88]);
}

async function invalidSalary() {
  const data = fixture();
  let posts = 0;
  const view = harness(
    "LegendEventsView.tsx",
    data.props,
    async (url, options) => {
      if (options?.method === "POST") posts++;
      return url.endsWith("legend-events") ? data.market : [];
    },
  );
  await view.mount();
  view
    .nodes()
    .find((node) => node.type === "input" && node.props.type === "number")
    .props.onChange({ target: { valueAsNumber: 0 } });
  view.render();
  assert.equal(view.button("계약 제안 보내기 →").props.disabled, true);
  view.form().props.onSubmit({ preventDefault() {} });
  await settle();
  assert.equal(posts, 0);
}

async function offerRace() {
  const data = fixture();
  const view = harness(
    "LegendEventsView.tsx",
    data.props,
    async (url, options) => {
      if (options?.method === "POST") {
        data.player.currentTeam = { id: 20, code: "GEN", name: "Gen.G" };
        data.player.canNegotiate = false;
        throw new Error("다른 구단과 계약했습니다");
      }
      return url.endsWith("legend-events") ? data.market : [];
    },
  );
  await view.mount();
  view.form().props.onSubmit({ preventDefault() {} });
  await settle();
  const html = view.render();
  assert.match(html, /다른 구단과 계약했습니다/);
  assert.match(html, /Gen.G 소속/);
  assert.equal(view.form(), undefined);
  assert.deepEqual(data.opened, []);
}

async function pendingOffer(unmount) {
  const data = fixture();
  let resolve;
  let posts = 0;
  const pending = new Promise((yes) => {
    resolve = yes;
  });
  const view = harness(
    "LegendEventsView.tsx",
    data.props,
    async (url, options) => {
      if (options?.method === "POST") {
        posts++;
        return pending;
      }
      return url.endsWith("legend-events") ? data.market : [];
    },
  );
  await view.mount();
  const submit = view.form().props.onSubmit;
  submit({ preventDefault() {} });
  submit({ preventDefault() {} });
  assert.equal(posts, 1);
  if (unmount) view.unmount();
  resolve({ id: 77, careerPlayerId: 99, status: "WAITING_PLAYER_RESPONSE" });
  await settle();
  assert.deepEqual(data.opened, unmount ? [] : [77]);
}

async function loadRetry() {
  const data = fixture();
  let failed = true;
  const view = harness("LegendEventsView.tsx", data.props, async (url) => {
    if (failed) throw new Error("Temporary outage");
    return url.endsWith("legend-events") ? data.market : [];
  });
  await view.mount();
  failed = false;
  view.button("다시 불러오기").props.onClick();
  await settle();
  assert.match(view.render(), /Viper/);
  assert.ok(view.form());
}

async function seasonIntegration() {
  const data = fixture();
  const posts = [];
  let opened = 0;
  const reveal = {
    id: 8,
    type: "LEGEND_REVEAL",
    status: "READY",
    requiresUserAction: true,
    scheduledDate: "2026-11-23",
    payload: {},
  };
  const signing = {
    id: 9,
    type: "LEGEND_SIGNING",
    status: "COMPLETED",
    requiresUserAction: false,
    scheduledDate: "2026-11-23",
    payload: { message: "GEN이 2021 Viper와 계약했습니다." },
  };
  const hidden = {
    ...reveal,
    id: 10,
    status: "SCHEDULED",
    scheduledDate: "2099-12-27",
  };
  data.calendar.blockingEvents = [reveal];
  const view = harness(
    "SeasonHubView.tsx",
    {
      career: data.career,
      token: "test",
      onBack() {},
      onCareerRefresh: async () => {},
      onOpenContracts() {},
      onOpenLegends() {
        opened++;
      },
    },
    async (url, options) => {
      if (options?.method === "POST") {
        posts.push(url);
        data.calendar.blockingEvents = [];
        reveal.status = "COMPLETED";
        return reveal;
      }
      return url.endsWith("/calendar")
        ? data.calendar
        : url.endsWith("/events")
          ? [reveal, signing, hidden]
          : [];
    },
  );
  const html = await view.mount();
  assert.match(html, /GEN이 2021 Viper와 계약했습니다/);
  assert.doesNotMatch(html, /12월 27일/);
  view.button("레전드 이벤트 확인").props.onClick();
  assert.equal(opened, 1);
  assert.deepEqual(posts, []);
  view.button("확인 완료 · 일정 계속하기").props.onClick();
  await settle();
  assert.deepEqual(posts, ["/careers/1/events/8/resolve"]);
  view.render();
  assert.equal(view.button("+1하루 진행").props.disabled, false);
}

async function aiClubNews() {
  const data = fixture();
  const news = {
    id: 20,
    type: "AI_CLUB_UPDATE",
    status: "COMPLETED",
    requiresUserAction: false,
    scheduledDate: data.calendar.currentDate,
    payload: { message: "GEN이 새로운 선발 명단을 등록했습니다." },
  };
  const view = harness(
    "SeasonHubView.tsx",
    {
      career: data.career,
      token: "test",
      onBack() {},
      onCareerRefresh: async () => {},
      onOpenContracts() {},
      onOpenLegends() {},
    },
    async (url, options) => {
      assert.notEqual(
        options?.method,
        "POST",
        "Reading AI news must not resolve or advance anything",
      );
      return url.endsWith("/calendar")
        ? data.calendar
        : url.endsWith("/events")
          ? [news]
          : [];
    },
  );
  const html = await view.mount();
  assert.match(html, /구단 소식/);
  assert.match(html, /GEN이 새로운 선발 명단을 등록했습니다/);
  assert.doesNotMatch(html, /진행 전에 처리해야 할 이벤트가 있습니다/);
  assert.equal(view.button("+1하루 진행").props.disabled, false);
  assert.equal(view.button("구단 소식 처리하기"), undefined);
}

(async () => {
  await emptyMarket();
  await offerFlow();
  await unavailable(false);
  await unavailable(true);
  await existingOffer();
  await invalidSalary();
  await offerRace();
  await pendingOffer(false);
  await pendingOffer(true);
  await loadRetry();
  await seasonIntegration();
  await aiClubNews();
  console.log(
    "Market/news UI checks passed: 12 scenarios (revealed-only market, contract flow, availability, races, retry, reveal acknowledgement, legend/AI club news).",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
