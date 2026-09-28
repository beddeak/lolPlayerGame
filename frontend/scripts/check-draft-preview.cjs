// Actual UI handlers + wall-clock timer tests. This is not a browser layout test.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { harness } = require("./check-legend-ui.cjs");
const { loadSource } = require("./load-source.cjs");
const logic = loadSource("draft-preview");
const descriptions = loadSource("variant-description");
const cache = new Map();
function backendSource(relative) {
  const filename = path.resolve(
    __dirname,
    "../../backend/src",
    relative.endsWith(".ts") ? relative : `${relative}.ts`,
  );
  if (cache.has(filename)) return cache.get(filename).exports;
  const module = { exports: {} };
  // Match CommonJS: cycles observe the in-progress module's live exports.
  cache.set(filename, module);
  const output = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  new Function("require", "module", "exports", output)(
    (name) =>
      name.startsWith(".")
        ? backendSource(path.resolve(path.dirname(filename), name))
        : require(name),
    module,
    module.exports,
  );
  return module.exports;
}
const { CHAMPION_VARIANTS } = backendSource("drafts/variant-catalog");
const { DRAFT_TURNS } = backendSource("drafts/draft-state");
const catalog = {
  version: 1,
  turnSeconds: 30,
  variants: CHAMPION_VARIANTS,
  turns: DRAFT_TURNS,
};
const team = (id) => ({
  id,
  code: id === 1 ? "BLG" : "GEN",
  name: id === 1 ? "Bilibili Gaming" : "Gen.G",
  starters: logic.DRAFT_POSITIONS.map((position, index) => ({
    starterPosition: position,
    playerInstruction: null,
    careerPlayer: {
      id: id * 10 + index,
      playerCard: {
        player: { nickname: `${id === 1 ? "Blue" : "Red"}${position}` },
      },
    },
  })),
});
const nodesByClass = (view, name) =>
  view
    .nodes()
    .filter((node) => (node.props.className ?? "").split(" ").includes(name));
const choose = (view, id) =>
  view.nodes().find((node) => node.type === "button" && node.key === id);

async function main() {
  assert.equal(catalog.variants.length, 81);
  const catalogBefore = JSON.stringify(catalog);
  const laneA = catalog.variants.find((v) => v.id === "ADC_LANE_BULLY_A");
  const laneC = catalog.variants.find((v) => v.id === "ADC_LANE_BULLY_C");
  assert.equal(
    descriptions.describeVariant(laneA).short,
    "라인전 강함 · 한타 약함",
  );
  assert.match(descriptions.describeVariant(laneA).summary, /강하지만.*약한/);
  assert.match(
    descriptions.describeVariant(laneA).timingDetail,
    /후반에는 초반보다 힘이 떨어/,
  );
  assert.equal(
    descriptions.describeVariant(laneC).short,
    "라인전 강함 · 한타 강함",
  );
  assert.notEqual(
    descriptions.describeVariant(laneA).summary,
    descriptions.describeVariant(laneC).summary,
  );
  for (const v of catalog.variants) {
    const copy = descriptions.describeVariant(v);
    assert.ok(copy.short && copy.summary && copy.timingDetail);
    assert.equal(copy.traits.length, 3);
    assert.deepEqual(
      copy.traits.map((t) => t.value),
      [v.range, v.engage, v.frontline],
    );
    assert.deepEqual(
      copy,
      descriptions.describeVariant({ ...v, name: "Renamed", variant: "C" }),
      "descriptions depend on stats, not names or letters",
    );
  }
  for (const [score, word] of [
    [0, "약함"],
    [69, "약함"],
    [70, "무난"],
    [79, "무난"],
    [80, "강함"],
    [100, "강함"],
  ]) {
    assert.equal(
      descriptions.describeVariant({
        ...laneA,
        lanePower: score,
        teamFight: score,
      }).short,
      `라인전 ${word} · 한타 ${word}`,
    );
  }
  assert.match(
    descriptions.describeVariant({ ...laneA, early: 50, mid: 80, late: 100 })
      .timingDetail,
    /후반을 바라보는/,
  );
  assert.equal(
    descriptions.describeVariant({ ...laneA, early: 80, mid: 80, late: 80 })
      .timing,
    "고른 시간대 성능",
  );
  assert.match(
    descriptions.describeVariant({ ...laneA, position: "JUNGLE" }).short,
    /라인 압박/,
  );
  assert.equal(JSON.stringify(catalog), catalogBefore);
  let state = { actions: [], deadline: 30000 };
  const original = state;
  const initial = JSON.stringify(state);
  state = logic.advancePreview(state, catalog, "ADC_LANE_BULLY_A", false, 0);
  assert.equal(JSON.stringify(original), initial);
  assert.notEqual(state, original);
  assert.equal(
    logic.advancePreview(state, catalog, "ADC_LANE_BULLY_A", false, 0),
    state,
  );
  for (let turn = 1; turn < 20; turn++)
    state = logic.advancePreview(
      state,
      catalog,
      logic.suggestPreview(state, catalog).id,
      true,
      0,
    );
  assert.equal(state.actions.length, 20);
  assert.equal(
    new Set(state.actions.map((action) => action.variantId)).size,
    20,
  );
  for (const side of ["BLUE", "RED"])
    assert.equal(
      new Set(
        logic
          .draftPicks(state, side, catalog)
          .map((variant) => variant.position),
      ).size,
      5,
    );
  assert.equal(logic.suggestPreview(state, catalog), undefined);
  assert.deepEqual(
    logic.restorePreview(JSON.stringify({ version: 1, state }), catalog, 0),
    state,
  );
  for (const raw of [
    "bad",
    "{}",
    '{"version":2,"state":{}}',
    JSON.stringify({
      version: 1,
      state: { ...state, actions: [state.actions[0], state.actions[0]] },
    }),
    JSON.stringify({ version: 1, state: { ...state, deadline: null } }),
  ]) {
    assert.equal(logic.restorePreview(raw, catalog, 0).actions.length, 0);
  }

  const originalWindow = global.window;
  const originalDocument = global.document;
  const originalNow = Date.now;
  const storage = new Map();
  const intervals = new Map(),
    timeouts = new Map();
  let time = 100000,
    timerId = 0,
    closed = 0;
  Date.now = () => time;
  global.window = {
    sessionStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
    setInterval: (callback) => {
      intervals.set(++timerId, callback);
      return timerId;
    },
    clearInterval: (id) => intervals.delete(id),
    setTimeout: (callback, delay) => {
      timeouts.set(++timerId, { callback, due: time + delay });
      return timerId;
    },
    clearTimeout: (id) => timeouts.delete(id),
  };
  const tick = (ms) => {
    time += ms;
    for (const callback of [...intervals.values()]) callback();
    for (const [id, pending] of [...timeouts])
      if (pending.due <= time) {
        timeouts.delete(id);
        pending.callback();
      }
  };
  const saved = (key) => JSON.parse(storage.get(key)).state;
  const props = {
    catalog,
    blue: team(1),
    red: team(2),
    managedTeamId: 1,
    matchLabel: "LPL · BO3",
    storageKey: "career-1:fixture-3",
    onClose() {
      closed++;
    },
  };
  const renderBoard = (values) =>
    harness("DraftBoard.tsx", values, undefined, {
      "./draft-preview": logic,
      "./variant-description": descriptions,
    });
  let view;
  try {
    view = renderBoard(props);
    let html = await view.mount();
    assert.match(html, /블루 1밴/);
    assert.match(html, /선택 시간 30초/);
    assert.match(html, /BlueADC/);
    assert.match(html, /RedSUPPORT/);
    assert.match(html, /아직 경기 결과에 반영되지 않습니다/);
    assert.equal(nodesByClass(view, "draft-variant-tile").length, 81);
    assert.equal(nodesByClass(view, "draft-tile-summary").length, 81);
    assert.equal(nodesByClass(view, "draft-variant-guide").length, 0);
    const search = () => view.nodes().find((node) => node.type === "input");
    search().props.onChange({ target: { value: "한타 약함" } });
    view.render();
    assert.ok(nodesByClass(view, "draft-variant-tile").length > 0);
    for (const tile of nodesByClass(view, "draft-variant-tile"))
      assert.match(tile.props["aria-description"], /한타 약함/);
    search().props.onChange({ target: { value: "" } });
    view.render();
    view.button("ADC").props.onClick();
    view.render();
    assert.equal(nodesByClass(view, "draft-variant-tile").length, 21);
    view
      .nodes()
      .find((node) => node.type === "input")
      .props.onChange({ target: { value: "LaneBully A" } });
    view.render();
    assert.equal(nodesByClass(view, "draft-variant-tile").length, 1);
    choose(view, "ADC_LANE_BULLY_A").props.onClick();
    html = view.render();
    assert.match(html, /챔피언 숙련도 · 미설정/);
    assert.match(html, /<strong>100<\/strong>/);
    assert.match(html, /라인전은 강하지만, 한타는 약한 유형입니다/);
    assert.equal(nodesByClass(view, "draft-variant-guide").length, 1);
    assert.match(html, /기본 유형 수치 기준/);
    assert.equal(
      storage.has(props.storageKey),
      false,
      "reading a description must not commit a ban",
    );
    search().props.onChange({ target: { value: "" } });
    view.render();
    choose(view, "ADC_LANE_BULLY_C").props.onClick();
    assert.match(view.render(), /라인전과 한타가 모두 강한 유형입니다/);
    choose(view, "ADC_LANE_BULLY_A").props.onClick();
    assert.match(view.render(), /라인전은 강하지만, 한타는 약한 유형입니다/);
    const lock = nodesByClass(view, "draft-lock-button")[0];
    assert.equal(lock.props.disabled, false);
    lock.props.onClick();
    lock.props.onClick();
    assert.equal(
      saved(props.storageKey).actions.length,
      1,
      "same-tick double click must commit once",
    );
    html = await view.mount();
    assert.match(html, /레드 1밴/);
    assert.equal(
      nodesByClass(view, "draft-variant-guide").length,
      0,
      "committing clears the previous description",
    );
    assert.equal(
      nodesByClass(view, "draft-lock-button")[0].props.disabled,
      true,
    );
    nodesByClass(view, "draft-lock-button")[0].props.onClick();
    assert.equal(
      saved(props.storageKey).actions.length,
      1,
      "cannot forge an opponent turn click",
    );
    tick(1401);
    html = await view.mount();
    assert.equal(saved(props.storageKey).actions.length, 2);
    assert.match(html, /블루 2밴/);
    tick(30001);
    await view.mount();
    assert.equal(saved(props.storageKey).actions.length, 3);
    assert.equal(saved(props.storageKey).actions[2].automatic, true);
    view.unmount();
    assert.equal(intervals.size, 0);
    assert.equal(timeouts.size, 0);

    view = renderBoard(props);
    html = await view.mount();
    assert.match(html, /레드 2밴/, "reopening restores the saved draft");
    view.button("처음부터 다시").props.onClick();
    view.render();
    view.button("취소").props.onClick();
    view.render();
    assert.equal(saved(props.storageKey).actions.length, 3);
    view.button("처음부터 다시").props.onClick();
    view.render();
    view.button("초기화").props.onClick();
    await view.mount();
    assert.equal(saved(props.storageKey).actions.length, 0);
    // Run a complete draft exclusively through the real timeouts.
    for (let i = 0; i < 20; i++) {
      tick(30001);
      await view.mount();
    }
    html = view.render();
    assert.match(html, /양 팀 조합 완성/);
    assert.match(html, /DRAFT LOCKED IN/);
    assert.equal(saved(props.storageKey).actions.length, 20);
    assert.equal(intervals.size, 0);
    view.button("조합 확인 완료 →").props.onClick();
    assert.equal(closed, 1);
    view.unmount();

    view = renderBoard({ ...props, storageKey: "career-2", managedTeamId: 2 });
    html = await view.mount();
    assert.match(html, /블루 1밴/);
    assert.equal(
      nodesByClass(view, "draft-lock-button")[0].props.disabled,
      true,
    );
    tick(1401);
    html = await view.mount();
    assert.match(html, /레드 1밴/);
    choose(view, "ADC_LANE_BULLY_A").props.onClick();
    view.render();
    assert.equal(
      nodesByClass(view, "draft-lock-button")[0].props.disabled,
      false,
    );
    const stale = nodesByClass(view, "draft-lock-button")[0].props.onClick;
    view
      .nodes()
      .find((node) => node.props["aria-label"] === "밴픽 화면 닫기")
      .props.onClick();
    stale();
    assert.equal(
      saved("career-2").actions.length,
      1,
      "close invalidates pending actions",
    );
    view.unmount();

    // Storage-denied mode still permits an ephemeral UI session.
    window.sessionStorage.setItem = () => {
      throw new Error("storage denied");
    };
    view = renderBoard({ ...props, storageKey: "private-mode" });
    await view.mount();
    tick(30001);
    html = await view.mount();
    assert.match(html, /브라우저 임시 저장을 사용할 수 없어/);
    view.unmount();

    // Loader/dialog cleanup: no writes, owned catalog fetch only, no late response resurrection.
    global.document = { body: { style: { overflow: "auto" } } };
    let resolve,
      signal,
      shown = 0,
      hidden = 0;
    const request = (url, options) => {
      assert.equal(url, "/drafts/catalog");
      assert.equal(options.token, "test-token");
      assert.equal(options.method, undefined);
      signal = options.signal;
      return new Promise((yes) => {
        resolve = yes;
      });
    };
    const dialogView = harness(
      "DraftPreviewDialog.tsx",
      {
        career: {
          id: 1,
          teams: [{ ...team(1), isUserControlled: true }, team(2)],
        },
        fixture: { id: 3, teamA: { id: 1 }, teamB: { id: 2 } },
        token: "test-token",
        onClose() {
          closed++;
        },
      },
      request,
      { "./DraftBoard": { default: () => null } },
    );
    dialogView.render();
    const dialogNode = dialogView
      .nodes()
      .find((node) => node.type === "dialog");
    dialogNode.props.ref.current = {
      showModal() {
        shown++;
      },
      close() {
        hidden++;
      },
    };
    await dialogView.mount();
    assert.equal(shown, 1);
    assert.equal(document.body.style.overflow, "hidden");
    let prevented = false;
    dialogNode.props.onCancel({
      preventDefault() {
        prevented = true;
      },
    });
    assert.equal(prevented, true);
    dialogView.unmount();
    assert.equal(hidden, 1);
    assert.equal(document.body.style.overflow, "auto");
    assert.equal(signal.aborted, true);
    resolve(catalog);
    await new Promise((resolve) => setImmediate(resolve));
    assert.match(dialogView.render(), /밴픽 준비/);
  } finally {
    view?.unmount();
    Date.now = originalNow;
    global.window = originalWindow;
    global.document = originalDocument;
  }
  const css = fs.readFileSync(
    path.resolve(__dirname, "../src/DraftPreview.css"),
    "utf8",
  );
  assert.match(css, /max-width:\s*900px/);
  assert.match(css, /max-width:\s*540px/);
  assert.match(css, /prefers-reduced-motion/);
  console.log(
    "Draft preview checks passed: 81 variants, snake turns, profile preview, position/search filters, duplicates, opponent guard, 30s automatic choice, double-click race, full draft, restore/reset, red-side control, close cleanup, denied storage, authenticated read-only loader, abort and modal cleanup.",
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
