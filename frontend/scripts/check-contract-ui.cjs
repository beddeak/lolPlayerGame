// Component/handler regression check using real React SSR and mocked hooks/API.
// This does not replace browser/DOM interaction testing. No extra dependencies.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

const settle = async () => {
  for (let index = 0; index < 3; index++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

function harness(file, props, request) {
  const slots = [];
  let cursor = 0;
  let effects = [];
  let tree;
  const sameDeps = (left, right) =>
    left &&
    right &&
    left.length === right.length &&
    left.every((value, index) => Object.is(value, right[index]));
  const memoize = (factory, dependencies) => {
    const index = cursor++;
    if (!slots[index] || !sameDeps(slots[index].dependencies, dependencies)) {
      slots[index] = { value: factory(), dependencies };
    }
    return slots[index].value;
  };
  const hooks = {
    ...React,
    useMemo: memoize,
    useCallback: (callback, dependencies) =>
      memoize(() => callback, dependencies),
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) {
        slots[index] = {
          value: typeof initial === "function" ? initial() : initial,
        };
      }
      return [
        slots[index].value,
        (next) => {
          slots[index].value =
            typeof next === "function" ? next(slots[index].value) : next;
        },
      ];
    },
    useRef(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { current: initial };
      return slots[index];
    },
    useEffect(effect, dependencies) {
      const index = cursor++;
      if (!slots[index] || !sameDeps(slots[index].dependencies, dependencies)) {
        slots[index] = { dependencies };
        effects.push(effect);
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
      if (name === "./types")
        return { POSITIONS: ["TOP", "JUNGLE", "MID", "ADC", "SUPPORT"] };
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
    async mount() {
      render();
      const pending = effects;
      effects = [];
      pending.forEach((effect) => effect());
      await settle();
      return render();
    },
  };
}

const terms = {
  annualSalary: 10000,
  years: 2,
  expectedRole: "STARTER",
  starterGuarantee: false,
  promises: [],
};
const member = (id, nickname) => ({
  role: "STARTER",
  careerPlayer: {
    id,
    currentPosition: "MID",
    currentAge: 24,
    coachTrust: 80,
    playerCard: { player: { nickname } },
  },
});
function fixture(offerType = "FREE_AGENT") {
  const offer = {
    id: 7,
    careerId: 1,
    careerTeamId: 10,
    careerPlayerId: 99,
    offerType,
    player: {
      nickname: "External Ace",
      currentPosition: "MID",
      currentAge: 25,
    },
    status: "PLAYER_ACCEPTED",
    responseEventId: 8,
    responseDate: "2026-12-31",
    offeredDate: "2026-12-29",
    terms,
    revision: 1,
    extensionsUsed: 0,
    response: { reason: "제안을 수락했습니다." },
    counterTerms: null,
  };
  const event = {
    id: 8,
    type: "CONTRACT_RESPONSE",
    status: "READY",
    scheduledDate: "2026-12-31",
    payload: { contractOfferId: 7 },
  };
  const calendar = {
    careerId: 1,
    currentDate: "2026-12-31",
    currentYear: 2026,
    canCloseTransferWindow: true,
    transferWindow: {
      nextBoundaryDate: "2027-01-01",
      nextBoundaryType: "CLOSE",
    },
    blockingEvents: [event],
    dueMatches: [],
    nextMatch: null,
  };
  const team = {
    id: 10,
    code: "TEST",
    name: "Test Club",
    region: "LCK",
    isUserControlled: true,
    chemistry: 80,
    starters: [member(1, "Home Ace")],
    benches: [],
  };
  return {
    offer,
    event,
    calendar,
    team,
    career: { id: 1, currentDate: calendar.currentDate, teams: [team] },
  };
}

async function checkExternal(offerType, action) {
  const data = fixture(offerType);
  const posts = [];
  // An opponent's existing contract must not be presented as our club's contract.
  const contracts = [
    {
      careerPlayerId: 99,
      careerTeamId: 20,
      terms: { ...terms, annualSalary: 98765 },
    },
  ];
  const view = harness(
    "ContractsView.tsx",
    {
      career: data.career,
      token: "test",
      initialOfferId: 7,
      onBack() {},
      onOpenSeason() {},
      onCareerRefresh: async () => {},
    },
    async (url, options) => {
      if (options?.method === "POST") {
        posts.push({ url, body: options.body });
        if (!url.endsWith("/respond")) return structuredClone(data.offer);
        data.offer.status = action === "ACCEPT" ? "SIGNED" : "WITHDRAWN";
        data.calendar.blockingEvents = [];
        if (action === "ACCEPT") {
          data.team.starters.push(member(99, "External Ace"));
          contracts.push({
            careerPlayerId: 99,
            careerTeamId: 10,
            terms,
            startDate: "2026-12-31",
            endDate: "2028-11-18",
          });
        }
        return structuredClone(data.offer);
      }
      return structuredClone(
        url.endsWith("/offers")
          ? [data.offer]
          : url.endsWith("/calendar")
            ? data.calendar
            : contracts,
      );
    },
  );
  const html = await view.mount();
  assert.match(html, /External Ace/);
  assert.match(html, /외부 선수 영입 협상/);
  assert.match(html, /우리 구단과 미계약/);
  const homeBefore = view
    .nodes()
    .find(
      (node) =>
        node.type === "button" &&
        renderToStaticMarkup(node).includes("Home Ace"),
    );
  homeBefore.props.onClick();
  view.render();
  const external = view
    .nodes()
    .find(
      (node) =>
        node.type === "button" &&
        renderToStaticMarkup(node).includes("External Ace"),
    );
  assert.ok(
    external,
    "외부 협상은 소속 선수 선택 후에도 목록에서 다시 열 수 있어야 함",
  );
  external.props.onClick();
  view.render();
  const button = view.button(action === "ACCEPT" ? "계약 확정" : "협상 철회");
  assert.ok(button && !button.props.disabled);
  button.props.onClick();
  await settle();
  const updated = view.render();
  assert.deepEqual(posts, [
    { url: "/careers/1/contracts/offers/7/respond", body: { action } },
  ]);
  assert.match(updated, /종료된 협상입니다/);
  assert.equal(view.button("협상 철회"), undefined);
  assert.equal(
    view.nodes().some((node) => node.type === "form"),
    false,
  );
  const nickname = action === "ACCEPT" ? "External Ace" : "Home Ace";
  const home = view
    .nodes()
    .find(
      (node) =>
        node.type === "button" && renderToStaticMarkup(node).includes(nickname),
    );
  home.props.onClick();
  const selected = view.render();
  if (action === "ACCEPT") assert.match(selected, /재계약 제안/);
  assert.ok(view.button("계약 제안 보내기"));
  view
    .nodes()
    .find((node) => node.type === "form")
    .props.onSubmit({ preventDefault() {} });
  await settle();
  assert.deepEqual(posts[1], {
    url: "/careers/1/contracts/offers",
    body: { careerPlayerId: action === "ACCEPT" ? 99 : 1, terms },
  });
}

async function checkCalendar(canClose, dueMatch = false) {
  const data = fixture();
  data.calendar.canCloseTransferWindow = canClose;
  if (dueMatch)
    data.calendar.dueMatches = [
      { id: 50, teamA: { id: 10 }, teamB: { id: 20 } },
    ];
  const posts = [];
  const view = harness(
    "SeasonHubView.tsx",
    {
      career: data.career,
      token: "test",
      onBack() {},
      onCareerRefresh: async () => {},
      onOpenContracts() {},
    },
    async (url, options) => {
      if (options?.method === "POST") {
        posts.push({ url, body: options.body });
        return data.calendar;
      }
      return url.endsWith("/calendar")
        ? data.calendar
        : url.endsWith("/events")
          ? [data.event]
          : [];
    },
  );
  await view.mount();
  assert.equal(view.button("+1하루 진행").props.disabled, true);
  assert.equal(view.button("+33일 진행").props.disabled, true);
  const close = view.button("미완료 영입 종료하고 새해로");
  assert.equal(Boolean(close), canClose);
  if (close) {
    close.props.onClick();
    await settle();
    assert.deepEqual(posts, [
      { url: "/careers/1/calendar/advance", body: { mode: "ONE_DAY" } },
    ]);
  }
}

(async () => {
  await checkExternal("FREE_AGENT", "ACCEPT");
  await checkExternal("TRANSFER", "WITHDRAW");
  await checkCalendar(true);
  await checkCalendar(false);
  await checkCalendar(false, true);
  console.log(
    "Contract UI regression checks passed: FA accept, transfer withdraw, offer selection, roster renewal, explicit closure, blocked closure.",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
