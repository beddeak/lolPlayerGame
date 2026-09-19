// Runs the actual App handlers with controlled React hooks and API responses.
// These request-order regressions do not replace browser interaction checks.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const React = require("react");
const {
  harness: clubHarness,
  fixture: clubFixture,
} = require("./check-club-selection-ui.cjs");

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const settle = async () => {
  for (let index = 0; index < 3; index++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const career = (id) => ({
  id,
  startYear: 2026,
  currentYear: 2026,
  currentDate: "2026-12-20",
  currentMeta: "BALANCED",
  teams: [
    { id: id * 10, code: `T${id}`, name: `Team ${id}`, isUserControlled: true },
  ],
});
const auth = (id = 1) => ({
  accessToken: `token-${id}`,
  account: { id, displayName: `Coach ${id}`, email: `coach${id}@example.com` },
});

function harness() {
  const slots = [];
  let cursor = 0;
  let tree;
  let effects = [];
  let storedToken = null;
  let requestHandler;
  const calls = [];
  const sameDeps = (a, b) =>
    a && b && a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
  const hooks = {
    ...React,
    useState(initial) {
      const index = cursor++;
      if (!slots[index])
        slots[index] = {
          value: typeof initial === "function" ? initial() : initial,
        };
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
        const previous = slots[index];
        slots[index] = { dependencies };
        effects.push(() => {
          previous?.cleanup?.();
          slots[index].cleanup = effect();
        });
      }
    },
  };
  const fallback = async (url, options = {}) => {
    if (url === "/careers/from-club" && options.method === "POST")
      return career(3);
    if (url === "/careers") return [];
    if (url === "/auth/logout" || options.method === "PATCH") return {};
    if (/^\/careers\/\d+$/.test(url))
      return career(Number(url.split("/").at(-1)));
    throw new Error(`Unexpected API request: ${url}`);
  };
  const api = {
    ApiError,
    getStoredAccessToken: () => storedToken,
    storeAccessToken: (token) => {
      storedToken = token;
    },
    clearStoredAccessToken: () => {
      storedToken = null;
    },
    apiRequest: (url, options) => {
      calls.push({ url, options });
      return requestHandler
        ? requestHandler(url, options ?? {}, fallback)
        : fallback(url, options);
    },
  };
  const output = ts.transpileModule(
    fs.readFileSync(path.resolve(__dirname, "../src/App.tsx"), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
      },
    },
  ).outputText;
  const module = { exports: {} };
  const views = {
    "./TrainingPanel": { default: function TrainingPanel() {} },
    "./ClubLogo": { default: function ClubLogo() {} },
    "./ClubSelectionView": { default: function ClubSelectionView() {} },
    "./SeasonHubView": { default: function SeasonHubView() {} },
    "./ContractsView": { default: function ContractsView() {} },
    "./LegendEventsView": { default: function LegendEventsView() {} },
    "./MarketView": { default: function MarketView() {} },
    "./SquadView": { default: function SquadView() {} },
    "./GoogleAuthButton": { default: function GoogleAuthButton() {} },
    "./GoogleAccountLink": { default: function GoogleAccountLink() {} },
  };
  new Function("require", "module", "exports", output)(
    (name) => {
      if (name === "react") return hooks;
      if (name === "./api") return api;
      if (name === "./types")
        return { POSITIONS: ["TOP", "JUNGLE", "MID", "ADC", "SUPPORT"] };
      if (name.endsWith(".css")) return {};
      if (views[name]) return { __esModule: true, ...views[name] };
      return require(name);
    },
    module,
    module.exports,
  );
  const render = () => {
    cursor = 0;
    tree = module.exports.default();
    const pending = effects;
    effects = [];
    pending.forEach((effect) => effect());
    return tree;
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
  const component = (name) => {
    render();
    const node = nodes().find(
      (item) => typeof item.type === "function" && item.type.name === name,
    );
    assert.ok(node, `Expected ${name}`);
    return node.props;
  };
  return {
    calls,
    unmount() {
      slots.forEach((slot) => slot?.cleanup?.());
    },
    render,
    nodes,
    component,
    intercept(handler) {
      requestHandler = handler;
    },
    storedToken: () => storedToken,
    async login(id = 1) {
      await component("AuthScreen").onAuthenticated(auth(id));
      render();
    },
    async open(id) {
      component("AppHeader").onHome();
      await component("SaveSelectScreen").onOpen(id);
      render();
    },
    async createScreen() {
      component("AppHeader").onCreate();
      await settle();
      render();
    },
    refresh() {
      component("AppHeader").onSeason();
      return component("SeasonHubView").onCareerRefresh();
    },
    swap() {
      component("AppHeader").onSquad();
      return component("SquadView").onSwapStarter(10, "TOP", 99);
    },
    async logout() {
      component("AppHeader").onLogout();
      await settle();
      render();
    },
    activeId() {
      return component("CareerDashboard").career.id;
    },
  };
}

async function staleRefresh(fail = false) {
  const app = harness();
  await app.login();
  await app.open(1);
  const old = deferred();
  app.intercept((url, options, fallback) =>
    url === "/careers/1" ? old.promise : fallback(url, options),
  );
  const pending = app.refresh();
  await app.open(2);
  if (fail) old.reject(new ApiError(401, "Old session expired"));
  else old.resolve(career(1));
  await pending;
  assert.equal(
    app.activeId(),
    2,
    "A stale refresh must not overwrite B or log out its session",
  );
  assert.equal(app.storedToken(), "token-1");
}

async function staleSwap(pendingPatch = false) {
  const app = harness();
  await app.login();
  await app.open(1);
  const old = deferred();
  app.intercept((url, options, fallback) =>
    (pendingPatch ? options.method === "PATCH" : url === "/careers/1")
      ? old.promise
      : fallback(url, options),
  );
  const pending = app.swap();
  await settle();
  await app.open(2);
  const count = app.calls.length;
  old.resolve(pendingPatch ? {} : career(1));
  await pending;
  assert.equal(app.activeId(), 2);
  if (pendingPatch)
    assert.equal(
      app.calls.length,
      count,
      "Do not start a stale follow-up GET after changing saves",
    );
}

async function staleOpen() {
  const app = harness();
  await app.login();
  const old = deferred();
  app.intercept((url, options, fallback) =>
    url === "/careers/1" ? old.promise : fallback(url, options),
  );
  const pending = app.open(1);
  await app.open(2);
  old.resolve(career(1));
  await pending;
  assert.equal(app.activeId(), 2);
}

async function logoutDuringRequest() {
  const app = harness();
  await app.login();
  await app.open(1);
  const oldRefresh = deferred();
  const oldLogout = deferred();
  app.intercept((url, options, fallback) => {
    if (url === "/careers/1") return oldRefresh.promise;
    if (url === "/auth/logout") return oldLogout.promise;
    return fallback(url, options);
  });
  const pending = app.refresh();
  await app.logout();
  assert.equal(
    app.storedToken(),
    null,
    "Logout must finish locally before its network request completes",
  );
  await app.login(2);
  await app.open(2);
  oldRefresh.resolve(career(1));
  oldLogout.resolve({});
  await pending;
  await settle();
  assert.equal(app.activeId(), 2);
  assert.equal(app.storedToken(), "token-2");
  assert.equal(app.component("AppHeader").account.id, 2);
}

async function failedCreateList() {
  const app = harness();
  await app.login();
  await app.createScreen();
  app.intercept((url, options, fallback) => {
    if (url === "/careers" && options.method !== "POST")
      throw new Error("Temporary list refresh failure");
    return fallback(url, options);
  });
  await app.component("ClubSelectionView").onSubmit({ clubCode: "T1" });
  assert.equal(
    app.activeId(),
    3,
    "A successful create must leave the create form even if the list refresh fails",
  );
  assert.ok(
    app
      .nodes()
      .some(
        (node) =>
          typeof node.props.children === "string" &&
          node.props.children.includes("커리어는 저장했습니다"),
      ),
  );
  app.component("AppHeader").onHome();
  const saves = app.component("SaveSelectScreen").careers;
  assert.equal(saves[0].id, 3, "Keep the successful save in the local list");
  assert.equal(
    app.calls.filter((call) => call.options?.method === "POST").length,
    1,
  );
}

async function failedCreatePost() {
  const app = harness();
  await app.login();
  await app.createScreen();
  app.intercept((url, options, fallback) => {
    if (options.method === "POST") throw new ApiError(400, "Invalid setup");
    return fallback(url, options);
  });
  await assert.rejects(
    app.component("ClubSelectionView").onSubmit({ clubCode: "T1" }),
    /Invalid setup/,
  );
  app.component("ClubSelectionView");
  assert.equal(app.component("AppHeader").hasActiveCareer, false);
}

async function duplicateCreateClick() {
  const app = harness();
  await app.login();
  await app.createScreen();
  const post = deferred();
  app.intercept((url, options, fallback) =>
    options.method === "POST" ? post.promise : fallback(url, options),
  );
  const submit = app.component("ClubSelectionView").onSubmit;
  const pending = submit({ clubCode: "T1" });
  await submit({ clubCode: "T1" });
  assert.equal(
    app.calls.filter((call) => call.options?.method === "POST").length,
    1,
  );
  post.resolve(career(3));
  await pending;
  assert.equal(app.activeId(), 3);
}

async function staleCreate() {
  const app = harness();
  await app.login();
  await app.createScreen();
  const post = deferred();
  app.intercept((url, options, fallback) =>
    options.method === "POST" ? post.promise : fallback(url, options),
  );
  const pending = app
    .component("ClubSelectionView")
    .onSubmit({ clubCode: "T1" });
  await app.open(2);
  post.resolve(career(3));
  await pending;
  assert.equal(app.activeId(), 2);
  app.component("AppHeader").onHome();
  assert.ok(
    app.component("SaveSelectScreen").careers.some((item) => item.id === 3),
    "A create completed in the same session must still be listed after switching saves",
  );
}

async function currentMutationRefresh(swap = false) {
  const app = harness();
  await app.login();
  await app.open(1);
  const refreshed = { ...career(1), currentDate: "2026-12-21" };
  app.intercept((url, options, fallback) =>
    url === "/careers/1" ? Promise.resolve(refreshed) : fallback(url, options),
  );
  if (swap) await app.swap();
  else await app.refresh();
  assert.equal(
    app.component(swap ? "SquadView" : "SeasonHubView").career.currentDate,
    "2026-12-21",
    "Current-session, current-save updates must still apply",
  );
}

function rosterCareer(starterId) {
  const result = career(1);
  result.teams[0].starters = [{ careerPlayer: { id: starterId } }];
  return result;
}

function assertStarter(app, view, id) {
  assert.equal(
    app.component(view).career.teams[0].starters[0].careerPlayer.id,
    id,
  );
}

function assertNoPageError(app) {
  app.render();
  assert.equal(
    app.nodes().some((node) => node.props.className === "notice error-notice"),
    false,
  );
  assert.equal(app.storedToken(), "token-1");
}

async function sameSaveRefreshThenSwap(errorStatus) {
  const app = harness();
  await app.login();
  await app.open(1);
  const old = deferred();
  let reads = 0;
  app.intercept((url, options, fallback) =>
    url === "/careers/1"
      ? ++reads === 1
        ? old.promise
        : Promise.resolve(rosterCareer(99))
      : fallback(url, options),
  );
  const pending = app.refresh();
  await app.swap();
  assertStarter(app, "SquadView", 99);
  if (errorStatus)
    old.reject(new ApiError(errorStatus, "Old season request failed"));
  else old.resolve(rosterCareer(10));
  await pending;
  assertStarter(app, "SquadView", 99);
  assertNoPageError(app);
  assert.equal(
    app.calls.filter((call) => call.options?.method === "PATCH").length,
    1,
  );
}

async function sameSaveRefreshOrdering() {
  const app = harness();
  await app.login();
  await app.open(1);
  const old = deferred();
  let reads = 0;
  let lists = 0;
  app.intercept((url, options, fallback) => {
    if (url === "/careers/1")
      return ++reads === 1 ? old.promise : Promise.resolve(rosterCareer(99));
    if (url === "/careers")
      return Promise.resolve([
        { id: 1, currentDate: ++lists === 1 ? "2026-12-21" : "2026-12-22" },
      ]);
    return fallback(url, options);
  });
  const pending = app.refresh();
  await app.refresh();
  assertStarter(app, "SeasonHubView", 99);
  old.resolve(rosterCareer(10));
  await pending;
  assertStarter(app, "SeasonHubView", 99);
  app.component("AppHeader").onHome();
  assert.equal(
    app.component("SaveSelectScreen").careers[0].currentDate,
    "2026-12-22",
  );
}

async function sameSaveSwapThenRefresh(fail = false) {
  const app = harness();
  await app.login();
  await app.open(1);
  const old = deferred();
  let reads = 0;
  app.intercept((url, options, fallback) =>
    url === "/careers/1"
      ? ++reads === 1
        ? old.promise
        : Promise.resolve(rosterCareer(99))
      : fallback(url, options),
  );
  const pending = app.swap();
  await settle();
  await app.refresh();
  if (fail) old.reject(new ApiError(500, "Old swap refresh failed"));
  else old.resolve(rosterCareer(10));
  await pending;
  assertStarter(app, "SeasonHubView", 99);
  assertNoPageError(app);
}

async function readDuringSwap(readCompletesEarly) {
  const app = harness();
  await app.login();
  await app.open(1);
  const patch = deferred();
  const during = deferred();
  let reads = 0;
  app.intercept((url, options, fallback) => {
    if (options.method === "PATCH") return patch.promise;
    if (url === "/careers/1")
      return ++reads === 1 ? during.promise : Promise.resolve(rosterCareer(99));
    return fallback(url, options);
  });
  const swapping = app.swap();
  const reading = app.refresh();
  if (readCompletesEarly) {
    during.resolve(rosterCareer(10));
    await reading;
  }
  patch.resolve({});
  await swapping;
  assert.equal(
    reads,
    2,
    "A read started during PATCH must not prevent the post-write refresh",
  );
  assertStarter(app, "SeasonHubView", 99);
  if (!readCompletesEarly) {
    during.resolve(rosterCareer(10));
    await reading;
    assertStarter(app, "SeasonHubView", 99);
  }
}

async function failedSwapAfterNewerRead() {
  const app = harness();
  await app.login();
  await app.open(1);
  const patch = deferred();
  app.intercept((url, options, fallback) => {
    if (options.method === "PATCH") return patch.promise;
    if (url === "/careers/1") return Promise.resolve(rosterCareer(10));
    return fallback(url, options);
  });
  const swapping = app.swap();
  const rejected = assert.rejects(
    swapping,
    (error) => error instanceof ApiError && error.status === 409,
  );
  await app.refresh();
  patch.reject(new ApiError(409, "Player can no longer be promoted"));
  await rejected;
  assertStarter(app, "SeasonHubView", 10);
  assertNoPageError(app);
  assert.equal(
    app.calls.filter((call) => call.url === "/careers/1").length,
    2,
    "A rejected PATCH must not issue a post-write GET or resolve as a successful swap",
  );
}

async function overlappingSwaps(reverseCompletion) {
  const app = harness();
  await app.login();
  await app.open(1);
  const patches = [deferred(), deferred()];
  const firstRead = deferred();
  let writes = 0;
  let reads = 0;
  app.intercept((url, options, fallback) => {
    if (options.method === "PATCH") return patches[writes++].promise;
    if (url === "/careers/1")
      return ++reads === 1
        ? firstRead.promise
        : Promise.resolve(rosterCareer(99));
    return fallback(url, options);
  });
  app.component("AppHeader").onSquad();
  const swap = app.component("SquadView").onSwapStarter;
  const first = swap(10, "TOP", 99);
  const second = swap(10, "MID", 100);
  patches[reverseCompletion ? 1 : 0].resolve({});
  await settle();
  patches[reverseCompletion ? 0 : 1].resolve({});
  await settle();
  assertStarter(app, "SquadView", 99);
  firstRead.resolve(rosterCareer(10));
  await Promise.all([first, second]);
  assert.equal(
    reads,
    2,
    "Each successful mutation still performs its final read, regardless of start order",
  );
  assertStarter(app, "SquadView", 99);
}

async function sameSaveOpenThenRefresh() {
  const app = harness();
  await app.login();
  await app.open(1);
  const old = deferred();
  let reads = 0;
  app.intercept((url, options, fallback) =>
    url === "/careers/1"
      ? ++reads === 1
        ? old.promise
        : Promise.resolve(rosterCareer(99))
      : fallback(url, options),
  );
  const opening = app.open(1);
  await app.refresh();
  old.resolve(rosterCareer(10));
  await opening;
  assertStarter(app, "SeasonHubView", 99);
}

async function createListThenRefresh() {
  const app = harness();
  await app.login();
  await app.createScreen();
  const oldList = deferred();
  let lists = 0;
  app.intercept((url, options, fallback) => {
    if (url === "/careers" && options.method !== "POST")
      return ++lists === 1
        ? oldList.promise
        : Promise.resolve([{ id: 3, currentDate: "2026-12-22" }]);
    return fallback(url, options);
  });
  const creating = app
    .component("ClubSelectionView")
    .onSubmit({ clubCode: "T1" });
  await settle();
  await app.refresh();
  oldList.reject(new Error("Old create list failed"));
  await creating;
  assertNoPageError(app);
  app.component("AppHeader").onHome();
  assert.equal(
    app.component("SaveSelectScreen").careers[0].currentDate,
    "2026-12-22",
  );
}

async function legendNavigation() {
  const app = harness();
  await app.login();
  await app.open(1);
  app.component("AppHeader").onLegends();
  const market = app.component("MarketView");
  assert.equal(market.career.id, 1);
  assert.equal(market.initialSection, "players");
  market.onOpenContractOffer(77);
  assert.equal(app.component("ContractsView").initialOfferId, 77);
  app.component("AppHeader").onSeason();
  app.component("SeasonHubView").onOpenLegends();
  assert.equal(app.component("MarketView").career.id, 1);
  assert.equal(app.component("MarketView").initialSection, "legends");
}

async function clubCreationContract() {
  const app = harness();
  await app.login();
  await app.createScreen();
  assert.equal(app.component("ClubSelectionView").token, "token-1");
  await app.component("ClubSelectionView").onSubmit({ clubCode: "T1" });
  const post = app.calls.find((call) => call.options?.method === "POST");
  assert.equal(post.url, "/careers/from-club");
  assert.deepEqual(post.options.body, { clubCode: "T1" });
  assert.equal(post.options.token, "token-1");
  assert.equal(
    app.calls.some((call) => call.url === "/player-cards"),
    false,
  );
}

async function createAfterGoingBack() {
  const app = harness();
  await app.login();
  await app.createScreen();
  const post = deferred();
  app.intercept((url, options, fallback) =>
    options.method === "POST" ? post.promise : fallback(url, options),
  );
  const pending = app
    .component("ClubSelectionView")
    .onSubmit({ clubCode: "T1" });
  app.component("ClubSelectionView").onBack();
  post.resolve(career(3));
  await pending;
  assert.equal(app.component("SaveSelectScreen").careers[0].id, 3);
}

async function reenterPendingCreation(fail = false) {
  const app = harness();
  await app.login();
  await app.createScreen();
  const post = deferred();
  let posts = 0;
  app.intercept((url, options, fallback) =>
    url === "/careers/from-club" && ++posts === 1
      ? post.promise
      : fallback(url, options),
  );
  const f = clubFixture();
  Object.assign(f.data.clubs[0], { code: "DK", name: "DK Club" });
  const first = clubHarness(app.component("ClubSelectionView"), f.request);
  await first.mount();
  first.button("이 구단으로 시작하기→").props.onClick();
  assert.equal(app.component("ClubSelectionView").creatingClubCode, "DK");
  app.component("ClubSelectionView").onBack();
  first.unmount();
  await app.createScreen();

  const reopened = clubHarness(app.component("ClubSelectionView"), f.request);
  const html = await reopened.mount();
  assert.match(html, /DK 새 게임 생성이 끝날 때까지 기다려 주세요/);
  assert.equal(reopened.tile("GEN").props.disabled, true);
  reopened.tile("GEN").props.onClick();
  reopened.render();
  assert.equal(reopened.tile("DK").props["aria-pressed"], true);
  const start = reopened.button("시즌 생성 중...→");
  assert.equal(start.props.disabled, true);
  start.props.onClick();
  await settle();
  assert.equal(posts, 1, "Re-entering while DK is pending must not create GEN");
  assert.ok(
    app
      .nodes()
      .some(
        (node) =>
          node.props.role === "status" &&
          node.props.children
            .join("")
            .includes("DK 새 게임을 생성하고 있습니다"),
      ),
    "Creation remains visibly pending after navigating away and back",
  );

  if (fail) post.reject(new Error("Create temporarily unavailable"));
  else post.resolve(career(3));
  await settle();
  assert.equal(app.component("ClubSelectionView").creatingClubCode, null);
  if (fail) {
    assert.ok(
      app
        .nodes()
        .some(
          (node) =>
            node.props.className === "notice error-notice" &&
            node.props.children.includes("Create temporarily unavailable"),
        ),
      "A failed creation must remain understandable after re-entry",
    );
  }
  await reopened.update(app.component("ClubSelectionView"));
  assert.equal(reopened.button("이 구단으로 시작하기→").props.disabled, false);
  assert.equal(
    app.component("AppHeader").hasActiveCareer,
    false,
    "Completion must not hijack the reopened selection screen",
  );
  app.component("ClubSelectionView").onBack();
  assert.equal(app.component("SaveSelectScreen").careers.length, fail ? 0 : 1);
  await app.createScreen();
  await reopened.update(app.component("ClubSelectionView"));
  reopened.tile("GEN").props.onClick();
  reopened.render();
  reopened.button("이 구단으로 시작하기→").props.onClick();
  await settle();
  assert.equal(posts, 2, "A deliberate new start is allowed after completion");
  assert.deepEqual(
    app.calls
      .filter((call) => call.url === "/careers/from-club")
      .map((call) => call.options.body),
    [{ clubCode: "DK" }, { clubCode: "GEN" }],
  );
  reopened.unmount();
}

async function oldCreationCannotClearNewSessionPending(fail = false) {
  const app = harness();
  await app.login();
  await app.createScreen();
  const first = deferred(),
    second = deferred();
  app.intercept((url, options, fallback) =>
    url === "/careers/from-club"
      ? options.token === "token-1"
        ? first.promise
        : second.promise
      : fallback(url, options),
  );
  const oldPending = app
    .component("ClubSelectionView")
    .onSubmit({ clubCode: "DK" });
  await app.logout();
  await app.login(2);
  await app.createScreen();
  assert.equal(app.component("ClubSelectionView").creatingClubCode, null);
  const currentPending = app
    .component("ClubSelectionView")
    .onSubmit({ clubCode: "GEN" });
  if (fail) first.reject(new ApiError(401, "Old account expired"));
  else first.resolve(career(3));
  await oldPending;
  assert.equal(app.component("ClubSelectionView").creatingClubCode, "GEN");
  assert.equal(app.storedToken(), "token-2");
  assertNoPageErrorForCurrentSession(app);
  second.resolve(career(4));
  await currentPending;
  assert.equal(app.activeId(), 4);
}

function assertNoPageErrorForCurrentSession(app) {
  app.render();
  assert.equal(
    app.nodes().some((node) => node.props.className === "notice error-notice"),
    false,
  );
}

async function createAcrossSessions() {
  const app = harness();
  await app.login();
  await app.createScreen();
  const post = deferred();
  app.intercept((url, options, fallback) =>
    url === "/careers/from-club" ? post.promise : fallback(url, options),
  );
  const pending = app
    .component("ClubSelectionView")
    .onSubmit({ clubCode: "T1" });
  await app.logout();
  await app.login(2);
  post.resolve(career(3));
  await pending;
  assert.equal(app.component("SaveSelectScreen").careers.length, 0);
  assert.equal(app.storedToken(), "token-2");
}

async function unmountedCreate() {
  const app = harness();
  await app.login();
  await app.createScreen();
  const post = deferred();
  app.intercept((url, options, fallback) =>
    options.method === "POST" ? post.promise : fallback(url, options),
  );
  const pending = app
    .component("ClubSelectionView")
    .onSubmit({ clubCode: "T1" });
  app.unmount();
  const callCount = app.calls.length;
  post.resolve(career(3));
  await pending;
  assert.equal(
    app.calls.length,
    callCount,
    "Unmounted create must not issue follow-up requests",
  );
}

async function googleLinkPanelPreservesCareerAndSession() {
  const app = harness();
  await app.login();
  await app.open(1);
  app.component("AppHeader").onHome();
  const linking = app.component("GoogleAccountLink");
  assert.equal(linking.token, "token-1");
  assert.equal(linking.onAuthenticated, undefined, "Linking must never replace the current account or reset careers");
  assert.equal(app.nodes().find((node) => node.type.name === "GoogleAccountLink").key, "token-1");
  app.component("AppHeader").onSeason();
  assert.equal(app.component("SeasonHubView").career.id, 1);
  assert.equal(app.storedToken(), "token-1");
  await app.logout();
  await app.login(2);
  assert.equal(app.component("GoogleAccountLink").token, "token-2");
  assert.equal(app.nodes().find((node) => node.type.name === "GoogleAccountLink").key, "token-2");
}

(async () => {
  await staleRefresh();
  await staleRefresh(true);
  await staleSwap();
  await staleSwap(true);
  await staleOpen();
  await logoutDuringRequest();
  await failedCreateList();
  await failedCreatePost();
  await duplicateCreateClick();
  await staleCreate();
  await currentMutationRefresh();
  await currentMutationRefresh(true);
  await sameSaveRefreshThenSwap();
  await sameSaveRefreshThenSwap(401);
  await sameSaveRefreshThenSwap(500);
  await sameSaveRefreshOrdering();
  await sameSaveSwapThenRefresh();
  await sameSaveSwapThenRefresh(true);
  await readDuringSwap(false);
  await readDuringSwap(true);
  await failedSwapAfterNewerRead();
  await overlappingSwaps(false);
  await overlappingSwaps(true);
  await sameSaveOpenThenRefresh();
  await createListThenRefresh();
  await legendNavigation();
  await clubCreationContract();
  await createAfterGoingBack();
  await reenterPendingCreation();
  await reenterPendingCreation(true);
  await oldCreationCannotClearNewSessionPending();
  await oldCreationCannotClearNewSessionPending(true);
  await createAcrossSessions();
  await unmountedCreate();
  await googleLinkPanelPreservesCareerAndSession();
  console.log(
    "App request regression checks passed: 35 scenarios (save/session races, request ordering, mutation failures, create/list failures, creation re-entry, legend navigation, Google linking isolation).",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
