// Executes the actual Google components, App auth handlers and GIS loader with
// controlled hooks/network/DOM. This is not a live Google/browser sign-in test.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const React = require("react");

const settle = async () => {
  for (let i = 0; i < 4; i++)
    await new Promise((resolve) => setImmediate(resolve));
};
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const auth = {
  accessToken: "app-session",
  account: { id: 1, email: "coach@example.com", displayName: "Coach" },
};
const googleModule = {
  __esModule: true,
  default: function GoogleAuthButton() {},
};

function compile(file, dependencies = {}, exportName = "default") {
  const source = fs.readFileSync(
    path.resolve(__dirname, `../src/${file}`),
    "utf8",
  );
  const output = ts.transpileModule(
    source + (exportName === "AuthScreen" ? "\nexport { AuthScreen };" : ""),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
      },
    },
  ).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", output)(
    (name) => {
      if (dependencies[name]) return dependencies[name];
      if (name.endsWith(".css")) return {};
      if (name.startsWith("./") && name !== "./types")
        return { __esModule: true, default: function View() {} };
      if (name === "./types") return {};
      return require(name);
    },
    module,
    module.exports,
  );
  return exportName === "*" ? module.exports : module.exports[exportName];
}

function harness(
  file,
  initialProps = {},
  request = async () => ({}),
  identityLoader,
  exportName = "default",
) {
  const slots = [];
  let cursor = 0,
    effects = [],
    tree,
    props = initialProps,
    writes = 0;
  const same = (a, b) =>
    a &&
    b &&
    a.length === b.length &&
    a.every((value, index) => Object.is(value, b[index]));
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
        (value) => {
          writes++;
          slots[index].value =
            typeof value === "function" ? value(slots[index].value) : value;
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
      if (!slots[index] || !same(slots[index].dependencies, dependencies)) {
        const old = slots[index];
        slots[index] = { dependencies };
        effects.push(() => {
          old?.cleanup?.();
          slots[index].cleanup = effect();
        });
      }
    },
  };
  const component = compile(
    file,
    {
      react: hooks,
      "./api": { apiRequest: request, getStoredAccessToken: () => null },
      "./googleIdentity": { loadGoogleIdentity: identityLoader },
      "./GoogleAuthButton": googleModule,
    },
    exportName,
  );
  const nodes = () => {
    const result = [];
    const visit = (node) => {
      if (Array.isArray(node)) return node.forEach(visit);
      if (!React.isValidElement(node)) return;
      result.push(node);
      visit(node.props.children);
    };
    visit(tree);
    return result;
  };
  const render = () => {
    cursor = 0;
    tree = component(props);
    for (const node of nodes()) {
      if (node.props.ref && !node.props.ref.current)
        node.props.ref.current = { replaceChildren() {} };
    }
    const pending = effects;
    effects = [];
    pending.forEach((effect) => effect());
    return tree;
  };
  const textOf = (value) =>
    Array.isArray(value)
      ? value.map(textOf).join("")
      : React.isValidElement(value)
        ? textOf(value.props.children)
        : value == null || typeof value === "boolean"
          ? ""
          : String(value);
  return {
    render,
    nodes,
    text() {
      render();
      return textOf(tree);
    },
    button(label) {
      render();
      const button = nodes().find(
        (node) =>
          node.type === "button" && textOf(node.props.children) === label,
      );
      assert.ok(button, `Missing button ${label}: ${textOf(tree)}`);
      return button.props;
    },
    child() {
      render();
      return nodes().find((node) => node.type === googleModule.default)?.props;
    },
    form() {
      render();
      return nodes().find((node) => node.type === "form").props;
    },
    async mount() {
      render();
      await settle();
      render();
    },
    async update(next) {
      props = next;
      render();
      await settle();
      render();
    },
    unmount() {
      slots.forEach((slot) => slot?.cleanup?.());
    },
    writes: () => writes,
  };
}

function clock() {
  const timers = new Map();
  let id = 0;
  global.window = {
    setTimeout(callback, delay) {
      timers.set(++id, { callback, delay });
      return id;
    },
    clearTimeout(key) {
      timers.delete(key);
    },
  };
  return {
    fire(delay) {
      const pending = [...timers].filter(([, value]) => value.delay === delay);
      for (const [key, value] of pending) {
        timers.delete(key);
        value.callback();
      }
    },
  };
}

function fixture(options = {}) {
  const time = clock();
  const calls = [],
    initialized = [],
    rendered = [],
    authenticated = [],
    linked = [];
  let loads = 0,
    challenges = 0,
    ended = 0;
  const identity = {
    initialize(value) {
      initialized.push(value);
    },
    renderButton(...value) {
      rendered.push(value);
    },
  };
  const fallback = async (url) => {
    if (url === "/auth/google/config")
      return { enabled: true, clientId: "public-client-id" };
    if (url.endsWith("challenge"))
      return { nonce: `nonce-${++challenges}`, expiresInSeconds: 300 };
    if (url === "/auth/google/login") return auth;
    if (url === "/auth/google/link")
      return { linked: true, email: "linked@example.com" };
    throw new Error(`Unexpected URL ${url}`);
  };
  const request = (url, requestOptions = {}) => {
    calls.push({ url, options: requestOptions });
    return options.request
      ? options.request(url, requestOptions, fallback)
      : fallback(url);
  };
  const props = {
    onAuthenticated: async (value) => authenticated.push(value),
    onLinked: (value) => linked.push(value),
    onEnd: () => ended++,
    ...options.props,
  };
  const app = harness("GoogleAuthButton.tsx", props, request, () => {
    loads++;
    return options.loader
      ? options.loader(identity)
      : Promise.resolve(identity);
  });
  return {
    app,
    calls,
    initialized,
    rendered,
    authenticated,
    linked,
    time,
    loads: () => loads,
    ended: () => ended,
    async start() {
      await app.mount();
      app
        .button(props.token ? "Google 계정 연결" : "Google로 계속하기")
        .onClick();
      await settle();
      app.render();
    },
    async credential(
      value = { credential: "signed-google-id-token" },
      index = initialized.length - 1,
    ) {
      initialized[index].callback(value);
      await settle();
      app.render();
    },
  };
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test("unconfigured Google never loads third-party script; local auth remains", async () => {
  const f = fixture({
    request: async () => ({ enabled: false, clientId: null }),
  });
  await f.app.mount();
  assert.match(f.app.text(), /아직 설정되지 않았습니다/);
  assert.equal(f.loads(), 0);
  assert.equal(
    f.app.nodes().some((node) => node.type === "button"),
    false,
  );
  f.app.unmount();
});
test("config request failure can retry", async () => {
  let failed = true;
  const f = fixture({
    request: (url, options, fallback) =>
      failed ? Promise.reject(new Error("offline")) : fallback(url),
  });
  await f.app.mount();
  assert.match(f.app.text(), /설정을 확인하지 못했습니다/);
  failed = false;
  f.app.button("설정 다시 확인").onClick();
  await f.app.mount();
  assert.ok(f.app.button("Google로 계속하기"));
  f.app.unmount();
});
test("intentional GIS load binds server nonce and renders official button without One Tap", async () => {
  const f = fixture();
  await f.app.mount();
  assert.equal(f.loads(), 0);
  await f.start();
  assert.equal(f.initialized[0].client_id, "public-client-id");
  assert.equal(f.initialized[0].nonce, "nonce-1");
  assert.equal(f.initialized[0].auto_select, false);
  assert.equal(f.rendered[0][1].type, "standard");
  assert.equal(f.calls[1].options.headers["X-Google-Auth"], "1");
  assert.deepEqual(f.calls[1].options.body, {});
  f.app.unmount();
});
test("credential only travels in POST body and successful login finishes existing auth", async () => {
  const f = fixture();
  await f.start();
  await f.credential();
  const post = f.calls.find((call) => call.url === "/auth/google/login");
  assert.equal(post.options.method, "POST");
  assert.equal(post.options.headers["X-Google-Auth"], "1");
  assert.deepEqual(post.options.body, { credential: "signed-google-id-token" });
  assert.deepEqual(f.authenticated, [auth]);
  assert.equal(f.linked.length, 0);
  assert.equal(f.ended(), 1);
  f.app.unmount();
});
test("double preparation and duplicate GIS callbacks issue only one credential POST", async () => {
  const pending = deferred();
  const f = fixture({
    request: (url, options, fallback) =>
      url.endsWith("/login") ? pending.promise : fallback(url),
  });
  await f.app.mount();
  const button = f.app.button("Google로 계속하기");
  button.onClick();
  button.onClick();
  await settle();
  assert.equal(f.loads(), 1);
  await f.credential();
  await f.credential();
  assert.equal(f.calls.filter((call) => call.url.endsWith("/login")).length, 1);
  pending.resolve(auth);
  await settle();
  assert.equal(f.authenticated.length, 1);
  f.app.unmount();
});
for (const value of [
  undefined,
  {},
  { credential: " " },
  { credential: 1 },
  { credential: "x".repeat(8193) },
]) {
  test("malformed GIS callback is rejected before network", async () => {
    const f = fixture();
    await f.start();
    f.initialized[0].callback(value);
    await settle();
    assert.match(f.app.text(), /인증 정보를 받지 못했습니다/);
    assert.equal(
      f.calls.some((call) => call.url.endsWith("/login")),
      false,
    );
    f.app.unmount();
  });
}
test("expired challenge clears lock and retries with fresh nonce", async () => {
  const f = fixture();
  await f.start();
  f.time.fire(300_000);
  assert.match(f.app.text(), /만료/);
  await f.credential();
  assert.equal(f.authenticated.length, 0);
  f.app.button("Google로 계속하기").onClick();
  await settle();
  assert.equal(f.initialized[1].nonce, "nonce-2");
  await f.credential();
  assert.equal(f.authenticated.length, 1);
  f.app.unmount();
});
test("failed server verification retries new challenge", async () => {
  let failed = true;
  const f = fixture({
    request: (url, options, fallback) =>
      url.endsWith("/login") && failed
        ? Promise.reject(
            new Error("기존 이메일 계정으로 로그인한 후 연결해 주세요."),
          )
        : fallback(url),
  });
  await f.start();
  await f.credential();
  assert.match(f.app.text(), /기존 이메일 계정/);
  failed = false;
  f.app.button("Google로 계속하기").onClick();
  await settle();
  assert.equal(f.initialized[1].nonce, "nonce-2");
  await f.credential();
  assert.equal(f.authenticated.length, 1);
  f.app.unmount();
});
test("cancel invalidates old GIS callback even after restarting", async () => {
  const f = fixture();
  await f.start();
  f.app.button("취소").onClick();
  f.app.button("Google로 계속하기").onClick();
  await settle();
  await f.credential({ credential: "stale-token" }, 0);
  assert.equal(f.authenticated.length, 0);
  await f.credential();
  assert.equal(f.authenticated.length, 1);
  f.app.unmount();
});
test("unmount while script loading prevents challenge request", async () => {
  const pending = deferred();
  const f = fixture({ loader: () => pending.promise });
  await f.start();
  f.app.unmount();
  pending.resolve({ initialize() {}, renderButton() {} });
  await settle();
  assert.equal(f.calls.length, 1);
  assert.equal(f.ended(), 1);
});
test("unmount invalidates GIS callback", async () => {
  const f = fixture();
  await f.start();
  f.app.unmount();
  await f.credential();
  assert.equal(f.calls.length, 2);
  assert.equal(f.authenticated.length, 0);
});
test("late Google response after unmount cannot replace session", async () => {
  const pending = deferred();
  const f = fixture({
    request: (url, options, fallback) =>
      url.endsWith("/login") ? pending.promise : fallback(url),
  });
  await f.start();
  await f.credential();
  f.app.unmount();
  const count = f.app.writes();
  pending.resolve(auth);
  await settle();
  assert.equal(f.authenticated.length, 0);
  assert.equal(f.app.writes(), count);
});
test("account linking uses authenticated challenge and never replaces auth", async () => {
  const f = fixture({ props: { token: "existing-account-session" } });
  await f.start();
  await f.credential();
  assert.equal(f.calls[1].url, "/auth/google/link-challenge");
  assert.equal(f.calls[1].options.token, "existing-account-session");
  assert.equal(f.calls[2].url, "/auth/google/link");
  assert.equal(f.calls[2].options.token, "existing-account-session");
  assert.deepEqual(f.linked, [{ linked: true, email: "linked@example.com" }]);
  assert.equal(f.authenticated.length, 0);
  f.app.unmount();
});
test("old linked account cannot overwrite a remounted account panel", async () => {
  clock();
  const pending = deferred();
  const old = harness(
    "GoogleAccountLink.tsx",
    { token: "old" },
    () => pending.promise,
  );
  await old.mount();
  old.unmount();
  const writes = old.writes();
  const current = harness(
    "GoogleAccountLink.tsx",
    { token: "current" },
    async () => ({ linked: false, email: null }),
  );
  await current.mount();
  pending.resolve({ linked: true, email: "old@example.com" });
  await settle();
  assert.equal(old.writes(), writes);
  assert.equal(current.child().token, "current");
  assert.doesNotMatch(current.text(), /old@example/);
  current.child().onLinked({ linked: true, email: "current@example.com" });
  assert.match(current.text(), /current@example.com/);
  current.unmount();
});

function authScreen(request = async () => auth) {
  clock();
  const calls = [],
    authenticated = [];
  const app = harness(
    "App.tsx",
    { onAuthenticated: async (result) => authenticated.push(result) },
    (url, options) => {
      calls.push({ url, options });
      return request(url, options);
    },
    undefined,
    "AuthScreen",
  );
  return { app, calls, authenticated };
}
test("local email login keeps existing API flow", async () => {
  const f = authScreen();
  await f.app.mount();
  await f.app.form().onSubmit({ preventDefault() {} });
  assert.equal(f.calls[0].url, "/auth/login");
  assert.equal(f.calls[0].options.method, "POST");
  assert.deepEqual(f.authenticated, [auth]);
  f.app.unmount();
});
test("local registration remains available", async () => {
  const f = authScreen();
  await f.app.mount();
  f.app.button("회원가입").onClick();
  await f.app.form().onSubmit({ preventDefault() {} });
  assert.equal(f.calls[0].url, "/auth/register");
  assert.ok("displayName" in f.calls[0].options.body);
  f.app.unmount();
});
test("pending local login blocks Google and duplicate local submit synchronously", async () => {
  const pending = deferred();
  const f = authScreen(() => pending.promise);
  await f.app.mount();
  const form = f.app.form();
  const waiting = form.onSubmit({ preventDefault() {} });
  await form.onSubmit({ preventDefault() {} });
  assert.equal(f.app.child().onBegin(), false);
  assert.equal(f.app.child().disabled, true);
  assert.equal(f.calls.length, 1);
  pending.resolve(auth);
  await waiting;
  f.app.unmount();
});
test("Google preparation blocks local login and mode changes until cancel", async () => {
  const f = authScreen();
  await f.app.mount();
  assert.equal(f.app.child().onBegin(), true);
  await f.app.form().onSubmit({ preventDefault() {} });
  assert.equal(f.calls.length, 0);
  assert.equal(f.app.button("회원가입").disabled, true);
  f.app.button("회원가입").onClick();
  f.app.child().onEnd();
  await f.app.form().onSubmit({ preventDefault() {} });
  assert.equal(f.calls[0].url, "/auth/login");
  f.app.unmount();
});
test("late local response and Google handoff after AuthScreen unmount are ignored", async () => {
  const pending = deferred();
  const f = authScreen(() => pending.promise);
  await f.app.mount();
  const waiting = f.app.form().onSubmit({ preventDefault() {} });
  const google = f.app.child();
  f.app.unmount();
  pending.resolve(auth);
  await waiting;
  await google.onAuthenticated(auth);
  assert.equal(f.authenticated.length, 0);
});
test("failed local login releases shared lock for Google retry", async () => {
  const f = authScreen(() => Promise.reject(new Error("잘못된 로그인")));
  await f.app.mount();
  await f.app.form().onSubmit({ preventDefault() {} });
  assert.match(f.app.text(), /잘못된 로그인/);
  assert.equal(f.app.child().onBegin(), true);
  f.app.unmount();
});

function loaderFixture() {
  const time = clock();
  const scripts = [];
  global.document = {
    createElement() {
      return {
        remove() {
          this.removed = true;
        },
      };
    },
    head: {
      appendChild(script) {
        scripts.push(script);
      },
    },
  };
  const module = compile("googleIdentity.ts", {}, "*");
  return { scripts, time, load: module.loadGoogleIdentity };
}
test("GIS loader is singleton and uses exact official script", async () => {
  const f = loaderFixture();
  const first = f.load();
  const second = f.load();
  assert.equal(first, second);
  assert.equal(f.scripts.length, 1);
  assert.equal(f.scripts[0].src, "https://accounts.google.com/gsi/client");
  const identity = { initialize() {}, renderButton() {} };
  window.google = { accounts: { id: identity } };
  f.scripts[0].onload();
  assert.equal(await first, identity);
  assert.equal(await f.load(), identity);
});
test("GIS script error removes stale script and enables retry", async () => {
  const f = loaderFixture();
  const first = f.load();
  const rejected = assert.rejects(first, /불러오지 못했습니다/);
  f.scripts[0].onerror();
  await rejected;
  assert.equal(f.scripts[0].removed, true);
  const next = f.load();
  assert.equal(f.scripts.length, 2);
  window.google = { accounts: { id: {} } };
  f.scripts[1].onload();
  await next;
});
test("GIS loader timeout clears singleton and enables retry", async () => {
  const f = loaderFixture();
  const first = f.load();
  const rejected = assert.rejects(first, /네트워크/);
  f.time.fire(15_000);
  await rejected;
  assert.equal(f.scripts[0].removed, true);
  const next = f.load();
  window.google = { accounts: { id: {} } };
  f.scripts[1].onload();
  await next;
});

(async () => {
  for (const { name, fn } of tests) {
    try {
      await fn();
    } catch (error) {
      throw new Error(name, { cause: error });
    }
  }
  console.log(
    `Google auth regression checks passed: ${tests.length} scenarios (GIS loader, nonce, retry/expiry, session cancellation, explicit linking, local auth locks).`,
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
