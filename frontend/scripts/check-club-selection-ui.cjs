// Exercises actual components and callbacks with controlled hooks and SSR.
// Browser layout and keyboard interaction still require browser verification.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const POSITIONS = ["TOP", "JUNGLE", "MID", "ADC", "SUPPORT"];
const settle = async () => {
  for (let i = 0; i < 3; i++)
    await new Promise((resolve) => setImmediate(resolve));
};
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function card(id, position = "TOP") {
  return {
    id,
    playerId: id,
    themeId: 1,
    cardYear: 2026,
    startingAge: 20,
    imageUrl: null,
    mainPosition: position,
    mechanics: 80,
    gameSense: 80,
    laning: 80,
    teamFight: 80,
    macro: 80,
    teamPlay: 80,
    mental: 80,
    championPool: 80,
    player: { id, nickname: `Player${id}`, nationality: "KR" },
    theme: { id: 1, code: "BASE", name: "Base" },
  };
}
function club(code, region, offset = 0) {
  return {
    code,
    name: `${code} Club`,
    region,
    logoUrl: null,
    selectable: true,
    unavailableReason: null,
    startingStrength: 80,
    starters: POSITIONS.map((position, index) => ({
      position,
      playerCard: card(offset + index + 1, position),
    })),
    benches: [{ playerCard: card(offset + 6) }],
  };
}
function fixture() {
  const data = {
    startYear: 2026,
    worldTeamCount: 3,
    ready: true,
    unavailableReason: null,
    clubs: [club("T1", "LCK"), club("GEN", "LCK", 10), club("G2", "LEC", 20)],
  };
  const calls = [],
    submissions = [],
    sessionErrors = [];
  return {
    data,
    calls,
    submissions,
    sessionErrors,
    props: {
      token: "session-a",
      onBack() {},
      async onSubmit(payload) {
        submissions.push(payload);
      },
      onSessionError(error) {
        sessionErrors.push(error);
      },
    },
    request: async (url, options) => {
      calls.push({ url, options });
      return data;
    },
  };
}
function harness(props, request, exportName = "default") {
  const slots = [];
  let cursor = 0,
    effects = [],
    tree,
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
        const previous = slots[index];
        slots[index] = { dependencies };
        effects.push(() => {
          previous?.cleanup?.();
          slots[index].cleanup = effect();
        });
      }
    },
  };
  const output = ts.transpileModule(
    fs.readFileSync(
      path.resolve(__dirname, "../src/ClubSelectionView.tsx"),
      "utf8",
    ),
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
      if (name === "react") return hooks;
      if (name === "./api") return { apiRequest: request, ApiError };
      if (name === "./types") return { POSITIONS };
      if (name.endsWith(".css")) return {};
      return require(name);
    },
    module,
    module.exports,
  );
  const text = (node) =>
    Array.isArray(node)
      ? node.map(text).join("")
      : React.isValidElement(node)
        ? text(node.props.children)
        : typeof node === "number" || typeof node === "string"
          ? String(node)
          : "";
  function render() {
    cursor = 0;
    tree = module.exports[exportName](props);
    return renderToStaticMarkup(tree);
  }
  function nodes() {
    const result = [];
    const visit = (node) => {
      if (Array.isArray(node)) return node.forEach(visit);
      if (!React.isValidElement(node)) return;
      result.push(node);
      visit(node.props.children);
    };
    visit(tree);
    return result;
  }
  async function mount() {
    render();
    const pending = effects;
    effects = [];
    pending.forEach((effect) => effect());
    await settle();
    return render();
  }
  return {
    render,
    mount,
    nodes,
    writes: () => writes,
    button: (label) =>
      nodes().find(
        (node) => node.type === "button" && text(node).trim() === label,
      ),
    tile: (code) =>
      nodes().find(
        (node) =>
          node.type === "button" &&
          node.props["aria-label"]?.startsWith(`${code} Club`),
      ),
    async update(next) {
      props = { ...props, ...next };
      return mount();
    },
    unmount() {
      slots.forEach((slot) => slot?.cleanup?.());
    },
  };
}

const cases = [];
const test = (name, run) => cases.push({ name, run });

test("club catalogue uses JWT and renders registered lineups without setup fields", async () => {
  const f = fixture();
  const view = harness(f.props, f.request);
  const html = await view.mount();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, "/clubs");
  assert.equal(f.calls[0].options.token, "session-a");
  assert.match(html, /T1 Club/);
  assert.match(html, /주전 선수/);
  assert.match(html, /시작 전력<\/dt><dd>80<small>평균<\/small>/);
  assert.match(html, /Player1/);
  assert.match(html, /Player5/);
  assert.match(html, /후보 1명/);
  assert.match(html, /Player6/);
  assert.match(html, /총 3개 팀/);
  assert.match(html, /다른 팀도 모두 자동 생성/);
  assert.equal(
    view
      .nodes()
      .filter((node) =>
        ["input", "select", "textarea", "form"].includes(node.type),
      ).length,
    0,
  );
  assert.doesNotMatch(html, /선수 선택|두 팀|팀 코드 입력|시작 연도/);
  assert.ok(!view.button("이 구단으로 시작하기→").props.disabled);
});

test("selecting another club submits only its clubCode", async () => {
  const f = fixture();
  const view = harness(f.props, f.request);
  await view.mount();
  view.tile("GEN").props.onClick();
  const html = view.render();
  assert.equal(view.tile("GEN").props["aria-pressed"], true);
  assert.match(html, /Player11/);
  view.button("이 구단으로 시작하기→").props.onClick();
  await settle();
  assert.deepEqual(f.submissions, [{ clubCode: "GEN" }]);
});

test("league filter changes visible clubs and keeps preview in the selected league", async () => {
  const f = fixture();
  const view = harness(f.props, f.request);
  await view.mount();
  view.button("LEC1").props.onClick();
  const html = view.render();
  assert.equal(view.tile("T1"), undefined);
  assert.ok(view.tile("G2"));
  assert.match(html, /Player21/);
  assert.equal(view.button("LEC1").props["aria-selected"], true);
  assert.equal(view.button("LEC1").props.tabIndex, 0);
});

test("league tabs support arrow keys and Home/End with focus transfer", async () => {
  const f = fixture();
  const view = harness(f.props, f.request);
  await view.mount();
  let focusIndex = -1,
    prevented = 0;
  const event = (key) => ({
    key,
    preventDefault() {
      prevented++;
    },
    currentTarget: {
      parentElement: {
        querySelectorAll: () =>
          [0, 1, 2].map((index) => ({
            focus() {
              focusIndex = index;
            },
          })),
      },
    },
  });
  view.button("전체 리그3").props.onKeyDown(event("ArrowRight"));
  view.render();
  assert.equal(focusIndex, 1);
  assert.equal(view.button("LCK2").props["aria-selected"], true);
  view.button("LCK2").props.onKeyDown(event("End"));
  view.render();
  assert.equal(focusIndex, 2);
  view.button("LEC1").props.onKeyDown(event("Home"));
  view.render();
  assert.equal(focusIndex, 0);
  assert.equal(prevented, 3);
});

test("loading has a status and offers no creation action", async () => {
  const f = fixture(),
    load = deferred();
  const view = harness(f.props, () => load.promise);
  const html = await view.mount();
  assert.match(html, /구단을 불러오는 중/);
  assert.equal(view.button("이 구단으로 시작하기→"), undefined);
  assert.ok(view.nodes().some((node) => node.props.role === "status"));
  view.unmount();
  load.resolve(f.data);
  await settle();
});

test("empty catalogue is a completed empty state with retry", async () => {
  const f = fixture();
  f.data.clubs = [];
  f.data.worldTeamCount = 0;
  const view = harness(f.props, f.request);
  const html = await view.mount();
  assert.match(html, /등록된 구단이 없습니다/);
  assert.doesNotMatch(html, /불러오는 중/);
  assert.ok(view.button("다시 불러오기"));
});

test("catalogue failure can be retried successfully", async () => {
  const f = fixture();
  let attempts = 0;
  const view = harness(f.props, async () => {
    if (++attempts === 1) throw new Error("일시적인 연결 오류");
    return f.data;
  });
  assert.match(await view.mount(), /일시적인 연결 오류/);
  view.button("다시 불러오기").props.onClick();
  assert.match(await view.mount(), /T1 Club/);
  assert.equal(attempts, 2);
});

test("unready world shows server reason and blocks forged start", async () => {
  const f = fixture();
  f.data.ready = false;
  f.data.unavailableReason = "LEC 로스터를 먼저 등록하세요.";
  const view = harness(f.props, f.request);
  assert.match(await view.mount(), /LEC 로스터를 먼저 등록하세요/);
  const start = view.button("이 구단으로 시작하기→");
  assert.equal(start.props.disabled, true);
  start.props.onClick();
  await settle();
  assert.equal(f.submissions.length, 0);
});

test("incomplete clubs are disabled and show the reason accessibly", async () => {
  const f = fixture();
  f.data.clubs[1].selectable = false;
  f.data.clubs[1].unavailableReason = "MID 주전 미등록";
  f.data.clubs[1].starters = [];
  const view = harness(f.props, f.request);
  await view.mount();
  const tile = view.tile("GEN");
  assert.equal(tile.props.disabled, true);
  assert.match(tile.props["aria-label"], /MID 주전 미등록/);
  tile.props.onClick();
  view.render();
  assert.equal(view.tile("T1").props["aria-pressed"], true);
});

test("unselectable-only catalogue previews missing positions and cannot start", async () => {
  const f = fixture();
  f.data.clubs = [
    {
      ...club("PENDING", "LCK"),
      selectable: false,
      startingStrength: null,
      starters: [],
      benches: [],
      unavailableReason: "주전 5명이 필요합니다.",
    },
  ];
  const view = harness(f.props, f.request);
  const html = await view.mount();
  assert.equal((html.match(/등록 대기/g) ?? []).length, 5);
  assert.match(html, /주전 5명이 필요합니다/);
  assert.equal(view.button("이 구단으로 시작하기→").props.disabled, true);
});

test("same-tick duplicate start clicks send one request and lock selection", async () => {
  const f = fixture(),
    post = deferred();
  f.props.onSubmit = (payload) => {
    f.submissions.push(payload);
    return post.promise;
  };
  const view = harness(f.props, f.request);
  await view.mount();
  const click = view.button("이 구단으로 시작하기→").props.onClick;
  click();
  click();
  view.tile("GEN").props.onClick();
  view.render();
  assert.equal(f.submissions.length, 1);
  assert.equal(view.tile("T1").props["aria-pressed"], true);
  assert.equal(view.tile("GEN").props.disabled, true);
  assert.equal(view.button("시즌 생성 중...→").props.disabled, true);
  post.resolve();
  await settle();
});

test("failed creation preserves selection and permits a deliberate retry", async () => {
  const f = fixture();
  let attempts = 0;
  f.props.onSubmit = async () => {
    if (++attempts === 1) throw new Error("선수 등록이 변경되었습니다.");
  };
  const view = harness(f.props, f.request);
  await view.mount();
  view.tile("GEN").props.onClick();
  view.render();
  view.button("이 구단으로 시작하기→").props.onClick();
  await settle();
  const html = view.render();
  assert.match(html, /선수 등록이 변경되었습니다/);
  assert.equal(view.tile("GEN").props["aria-pressed"], true);
  assert.equal(view.button("이 구단으로 시작하기→").props.disabled, false);
  view.button("이 구단으로 시작하기→").props.onClick();
  await settle();
  assert.equal(attempts, 2);
});

test("current unauthorized catalogue load calls session handler", async () => {
  const f = fixture();
  const view = harness(f.props, async () => {
    throw new ApiError(401, "Session expired");
  });
  await view.mount();
  assert.equal(f.sessionErrors.length, 1);
});

test("old-session catalogue success cannot replace a newer response", async () => {
  const f = fixture(),
    old = deferred();
  const current = { ...f.data, clubs: [club("NEW", "LEC")] };
  const view = harness(f.props, (_, options) =>
    options.token === "session-a" ? old.promise : Promise.resolve(current),
  );
  await view.mount();
  assert.match(await view.update({ token: "session-b" }), /NEW Club/);
  old.resolve(f.data);
  await settle();
  const html = view.render();
  assert.match(html, /NEW Club/);
  assert.doesNotMatch(html, /T1 Club/);
});

test("old-session unauthorized response does not expire current session", async () => {
  const f = fixture(),
    old = deferred();
  const view = harness(f.props, (_, options) =>
    options.token === "session-a" ? old.promise : Promise.resolve(f.data),
  );
  await view.mount();
  await view.update({ token: "session-b" });
  old.reject(new ApiError(401, "Old session"));
  await settle();
  assert.equal(f.sessionErrors.length, 0);
  assert.match(view.render(), /T1 Club/);
});

test("overlapping reloads keep the newest catalogue", async () => {
  const f = fixture(),
    first = deferred(),
    second = deferred();
  let attempts = 0;
  const view = harness(f.props, () =>
    ++attempts === 1
      ? Promise.reject(new Error("offline"))
      : attempts === 2
        ? first.promise
        : second.promise,
  );
  await view.mount();
  const retry = view.button("다시 불러오기").props.onClick;
  retry();
  await view.mount();
  retry();
  await view.mount();
  second.resolve({ ...f.data, clubs: [club("NEW", "LEC")] });
  await settle();
  first.resolve(f.data);
  await settle();
  const html = view.render();
  assert.match(html, /NEW Club/);
  assert.doesNotMatch(html, /T1 Club/);
});

test("unmounted catalogue request is aborted and cannot write state", async () => {
  const f = fixture(),
    load = deferred();
  let signal;
  const view = harness(f.props, (_, options) => {
    signal = options.signal;
    return load.promise;
  });
  await view.mount();
  view.unmount();
  const writes = view.writes();
  assert.equal(signal.aborted, true);
  load.resolve(f.data);
  await settle();
  assert.equal(view.writes(), writes);
});

test("unmounted creation rejection cannot write state", async () => {
  const f = fixture(),
    post = deferred();
  f.props.onSubmit = () => post.promise;
  const view = harness(f.props, f.request);
  await view.mount();
  view.button("이 구단으로 시작하기→").props.onClick();
  view.unmount();
  const writes = view.writes();
  post.reject(new Error("old request"));
  await settle();
  assert.equal(view.writes(), writes);
});

test("registered logo URL is used, with an initials fallback when it fails", async () => {
  const view = harness(
    { club: { code: "GEN", name: "Gen.G", logoUrl: "/team-logos/gen.png" } },
    null,
    "ClubLogo",
  );
  assert.match(view.render(), /team-logos\/gen.png/);
  view
    .nodes()
    .find((node) => node.type === "img")
    .props.onError();
  const html = view.render();
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /GEN/);
});

test("missing player images show initials; registered images recover from failure", async () => {
  const player = card(1);
  player.imageUrl = "/players/photo.png";
  const view = harness({ card: player }, null, "PlayerPortrait");
  assert.match(view.render(), /players\/photo.png/);
  view
    .nodes()
    .find((node) => node.type === "img")
    .props.onError();
  assert.doesNotMatch(view.render(), /<img/);
  assert.match(view.render(), /PL/);
  const absent = harness({ card: card(2) }, null, "PlayerPortrait");
  assert.doesNotMatch(absent.render(), /<img/);
});

(async () => {
  for (const { name, run } of cases) {
    await run();
    console.log(`PASS ${name}`);
  }
  console.log(`Club selection checks passed: ${cases.length} scenarios.`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
