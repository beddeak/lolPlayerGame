// Runs the actual App handlers with controlled React hooks and API responses.
// These request-order regressions do not replace browser interaction checks.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const React = require("react");

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
    if (url === "/careers" && options.method === "POST") return career(3);
    if (url === "/careers" || url === "/player-cards") return [];
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
    "./SeasonHubView": { default: function SeasonHubView() {} },
    "./ContractsView": { default: function ContractsView() {} },
    "./SquadView": { default: function SquadView() {} },
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
  await app.component("CreateCareerScreen").onSubmit({});
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
    app.component("CreateCareerScreen").onSubmit({}),
    /Invalid setup/,
  );
  app.component("CreateCareerScreen");
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
  const submit = app.component("CreateCareerScreen").onSubmit;
  const pending = submit({});
  await submit({});
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
  const pending = app.component("CreateCareerScreen").onSubmit({});
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
  console.log(
    "App request regression checks passed: 12 scenarios (save/session races, stale errors, create/list failures, duplicate submission, current-save updates).",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
