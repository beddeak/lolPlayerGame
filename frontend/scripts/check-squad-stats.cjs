// Render the actual squad view to verify the 119-point ability display scale.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { loadClubLogo } = require("./check-club-logo.cjs");

const output = ts.transpileModule(
  fs.readFileSync(path.resolve(__dirname, "../src/SquadView.tsx"), "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  },
).outputText;
function loadSquadView(react = React) {
  const compiled = { exports: {} };
  new Function("require", "module", "exports", output)(
    (name) =>
      name === "react"
        ? react
        : name.endsWith(".css")
          ? {}
          : name === "./ClubLogo"
            ? loadClubLogo()
            : name === "./PlayerCardArtwork"
              ? require("./check-card-artwork.cjs").loadArtwork()
              : ["./card-artwork", "./position-fit", "./types"].includes(name)
                ? require("./load-source.cjs").loadSource(name.slice(2))
                : require(name),
    compiled,
    compiled.exports,
  );
  return compiled.exports.default;
}
const SquadView = loadSquadView();
const statFields = [
  "currentMechanics",
  "currentGameSense",
  "currentLaning",
  "currentTeamFight",
  "currentMacro",
  "currentTeamPlay",
  "currentMental",
  "currentChampionPool",
];

for (const { ability, position, proficiency, expected } of [
  ...[0, 100, 101, 119].map((ability) => ({
    ability,
    position: "TOP",
    proficiency: 100,
    expected: ability,
  })),
  { ability: 90, position: "MID", proficiency: 20, expected: 58 },
  { ability: 90, position: "MID", proficiency: 80, expected: 82 },
  { ability: 90, position: "MID", proficiency: 100, expected: 90 },
  { ability: 20, position: "MID", proficiency: 20, expected: 0 },
]) {
  const player = {
    id: 1,
    currentPosition: "TOP",
    currentAge: 20,
    personality: "PROFESSIONAL",
    form: 50,
    condition: 100,
    positionProficiencies: [{ position, proficiency }],
    ...Object.fromEntries(statFields.map((field) => [field, ability])),
    playerCard: {
      imageUrl: null,
      mainPosition: "TOP",
      cardYear: 2026,
      player: { nickname: "TestPlayer", nationality: "KR" },
      theme: { name: "Base" },
    },
  };
  const html = renderToStaticMarkup(
    React.createElement(SquadView, {
      career: {
        currentYear: 2026,
        teams: [
          {
            id: 1,
            code: "HLE",
            name: "Hanwha Life",
            region: "LCK",
            isUserControlled: true,
            starters: [
              {
                id: 1,
                role: "STARTER",
                starterPosition: position,
                careerPlayer: player,
              },
            ],
            benches: [],
          },
        ],
      },
      onBack() {},
      async onSwapStarter() {},
    }),
  );
  const widths = [...html.matchAll(/style="width:([\d.]+)%"/g)].map((match) =>
    Number(match[1]),
  );
  assert.equal(widths.length, 8);
  for (const width of widths) {
    assert.ok(width >= 0 && width <= 100);
    assert.ok(Math.abs(width - (expected / 119) * 100) < 0.00001);
  }
  assert.ok(html.includes(`<strong>${expected}</strong>`));
  assert.equal(player.currentMechanics, ability);
  assert.match(html, /src="\/club-logos\/hle.png"/);
}
console.log(
  "Squad ability display: 8 cases passed (0..119, off-position, adaptation, full recovery and unchanged source stats)",
);

// Controlled hooks exercise the actual component handlers and SSR markup.
// They do not substitute for a real browser drag/layout check.
const positions = ["TOP", "JUNGLE", "MID", "ADC", "SUPPORT"];
function fixture() {
  function roster(teamId, index, role = "STARTER") {
    const id = teamId * 100 + index + 1;
    const position = positions[index % positions.length];
    return {
      id,
      role,
      starterPosition: role === "STARTER" ? position : null,
      careerPlayer: {
        id,
        currentTeamId: teamId,
        currentPosition: position,
        currentAge: 22,
        personality: "PROFESSIONAL",
        form: 50,
        condition: 100,
        ...Object.fromEntries(statFields.map((field) => [field, 90])),
        positionProficiencies: positions.map((value) => ({
          position: value,
          proficiency: value === position ? 100 : 20,
        })),
        playerCard: {
          id,
          imageUrl: null,
          mainPosition: position,
          cardYear: 2026,
          player: { id, nickname: `PLAYER_${id}`, nationality: "KR" },
          theme: { id: 1, code: "BASE", name: "Base" },
        },
      },
    };
  }
  function team(id, code, region, isUserControlled) {
    return {
      id,
      code,
      name: `${code} Club`,
      region,
      isUserControlled,
      starters: positions.map((_, index) => roster(id, index)),
      benches: [roster(id, 5, "BENCH")],
    };
  }
  return {
    career: {
      id: 17,
      currentYear: 2026,
      teams: [
        team(20, "BLG", "LPL", false),
        team(1, "HLE", "LCK", true),
        team(2, "GEN", "LCK", false),
      ],
    },
    onBack() {},
    async onSwapStarter() {},
  };
}
const settle = async () => {
  for (let i = 0; i < 4; i++)
    await new Promise((resolve) => setImmediate(resolve));
};
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
function createHarness(props) {
  const slots = [];
  let cursor = 0,
    tree,
    effects = [],
    writes = 0;
  const hooks = {
    ...React,
    useState(initial) {
      const i = cursor++;
      slots[i] ??= {
        value: typeof initial === "function" ? initial() : initial,
      };
      return [
        slots[i].value,
        (value) => {
          writes++;
          slots[i].value =
            typeof value === "function" ? value(slots[i].value) : value;
        },
      ];
    },
    useRef(initial) {
      const i = cursor++;
      return (slots[i] ??= { current: initial });
    },
    useEffect(effect, deps) {
      const i = cursor++;
      if (
        !slots[i] ||
        deps.some((value, j) => !Object.is(value, slots[i].deps[j]))
      ) {
        const old = slots[i];
        slots[i] = { deps };
        effects.push(() => {
          old?.cleanup?.();
          slots[i].cleanup = effect();
        });
      }
    },
  };
  hooks.useLayoutEffect = hooks.useEffect;
  const View = loadSquadView(hooks);
  function render() {
    cursor = 0;
    tree = View(props);
    const pendingEffects = effects;
    effects = [];
    pendingEffects.forEach((effect) => effect());
    return renderToStaticMarkup(tree);
  }
  function nodes(root = tree) {
    if (Array.isArray(root)) return root.flatMap((node) => nodes(node));
    if (!React.isValidElement(root)) return [];
    // This local, stateless child owns the card's real DOM event handlers.
    if (typeof root.type === "function" && root.type.name === "SquadPlayerCard")
      return nodes(root.type(root.props));
    return [root, ...nodes(root.props.children ?? null)];
  }
  function labeled(label) {
    const node = nodes().find((value) => value.props["aria-label"] === label);
    assert.ok(node, `Missing element: ${label}`);
    return node;
  }
  function groupButtons(label) {
    return nodes(labeled(label)).filter((node) => node.type === "button");
  }
  function clickGroup(label, index) {
    groupButtons(label)[index].props.onClick();
    return render();
  }
  render();
  return {
    props,
    render,
    nodes,
    labeled,
    groupButtons,
    clickGroup,
    card: (id) => labeled(`PLAYER_${id} 선수 상세 보기`),
    unmount() {
      slots.forEach((slot) => slot?.cleanup?.());
    },
    get writes() {
      return writes;
    },
  };
}
function dragEvent(externalId = "99999") {
  return {
    prevented: false,
    preventDefault() {
      this.prevented = true;
    },
    stopPropagation() {},
    dataTransfer: {
      effectAllowed: "none",
      dropEffect: "none",
      getData() {
        return externalId;
      },
      setData() {},
    },
  };
}
function startDrag(h, id) {
  const event = dragEvent(String(id));
  h.card(id).props.onDragStart(event);
  h.render();
  return event;
}
function drop(h, label) {
  const event = dragEvent();
  h.labeled(label).props.onDrop(event);
  h.render();
  return event;
}
async function runInteractionChecks() {
  let passed = 0;
  async function check(name, work) {
    await work();
    passed++;
    console.log(`PASS squad: ${name}`);
  }
  await check(
    "league/team filters use actual region data and handle empty leagues",
    async () => {
      const h = createHarness(fixture());
      assert.equal(h.groupButtons("리그 선택").length, 6);
      assert.deepEqual(
        h
          .groupButtons("LCK 구단 선택")
          .map((node) => node.props["aria-pressed"]),
        [true, false],
      );
      assert.match(h.render(), /HLE Club/);
      let html = h.clickGroup("리그 선택", 1);
      assert.equal(h.groupButtons("LPL 구단 선택").length, 1);
      assert.match(html, /BLG Club/);
      assert.doesNotMatch(html, /PLAYER_101/);
      html = h.clickGroup("리그 선택", 2);
      assert.equal(h.groupButtons("LEC 구단 선택").length, 0);
      assert.match(html, /LEC 구단이 아직 없습니다/);
      assert.equal(
        h
          .nodes()
          .filter((node) => node.props.className?.includes("squad-player-card"))
          .length,
        0,
      );
      h.clickGroup("리그 선택", 0);
      h.clickGroup("LCK 구단 선택", 1);
      assert.match(h.render(), /GEN Club/);
      h.unmount();
    },
  );
  await check(
    "starter-to-starter and bench-to-starter preserve exact callback contract",
    async () => {
      const props = fixture(),
        calls = [];
      props.onSwapStarter = async (...args) => calls.push(args);
      const h = createHarness(props);
      startDrag(h, 101);
      drop(h, "MID 선발 자리");
      await settle();
      assert.deepEqual(calls, [[1, "MID", 101]]);
      h.render();
      startDrag(h, 106);
      drop(h, "ADC 선발 자리");
      await settle();
      assert.deepEqual(calls.at(-1), [1, "ADC", 106]);
      assert.equal(h.labeled("선발 5명").props.className, "starting-card-row");
      const cardImages = h
        .nodes(h.card(101))
        .filter((node) => node.type === "img");
      assert.ok(cardImages.length);
      assert.ok(cardImages.every((node) => node.props.draggable === false));
      h.unmount();
    },
  );
  await check(
    "starter-to-bench fills assigned MID rather than the dragged player's native ADC",
    async () => {
      const props = fixture(),
        calls = [];
      props.career.teams[1].starters[2].careerPlayer.currentPosition = "ADC";
      props.onSwapStarter = async (...args) => calls.push(args);
      const h = createHarness(props);
      startDrag(h, 103);
      drop(h, "PLAYER_106 후보 자리");
      await settle();
      assert.deepEqual(calls, [[1, "MID", 106]]);
      h.unmount();
    },
  );
  await check(
    "outside drops, same-slot drops and bench-to-bench drops never submit",
    async () => {
      const props = fixture(),
        calls = [];
      props.onSwapStarter = async (...args) => calls.push(args);
      const h = createHarness(props);
      h.labeled("MID 선발 자리").props.onDrop(dragEvent("101"));
      startDrag(h, 101);
      drop(h, "TOP 선발 자리");
      startDrag(h, 106);
      const over = dragEvent();
      h.labeled("PLAYER_106 후보 자리").props.onDragOver(over);
      assert.equal(over.prevented, false);
      drop(h, "PLAYER_106 후보 자리");
      await settle();
      assert.deepEqual(calls, []);
      h.unmount();
    },
  );
  await check(
    "keyboard placement selects starters or substitutes using the same guarded swap",
    async () => {
      const props = fixture(),
        calls = [];
      props.career.teams[1].starters[2].careerPlayer.currentPosition = "ADC";
      props.onSwapStarter = async (...args) => calls.push(args);
      const h = createHarness(props);
      h.card(103).props.onClick();
      h.render();
      assert.equal(h.labeled("선수단 선발 배치 포지션").props.value, "MID");
      h.labeled("선수단 선발 배치 포지션").props.onChange({
        target: { value: "TOP" },
      });
      h.render();
      h.nodes()
        .find((node) => node.type === "form")
        .props.onSubmit(dragEvent());
      await settle();
      assert.deepEqual(calls, [[1, "TOP", 103]]);
      h.card(106).props.onClick();
      h.render();
      h.nodes()
        .find((node) => node.type === "form")
        .props.onSubmit(dragEvent());
      await settle();
      assert.deepEqual(calls.at(-1), [1, "TOP", 106]);
      h.clickGroup("LCK 구단 선택", 1);
      assert.equal(h.nodes().filter((node) => node.type === "form").length, 0);
      h.unmount();
    },
  );
  await check(
    "other clubs are read-only and navigation clears a drag in progress",
    async () => {
      const props = fixture(),
        calls = [];
      props.onSwapStarter = async (...args) => calls.push(args);
      const h = createHarness(props);
      startDrag(h, 101);
      h.clickGroup("LCK 구단 선택", 1);
      assert.equal(h.card(201).props.draggable, false);
      assert.equal(startDrag(h, 201).prevented, true);
      drop(h, "MID 선발 자리");
      h.clickGroup("LCK 구단 선택", 0);
      drop(h, "MID 선발 자리");
      await settle();
      assert.deepEqual(calls, []);
      h.unmount();
    },
  );
  await check(
    "duplicate drops and new drags while saving issue only one request",
    async () => {
      const props = fixture(),
        pending = deferred(),
        calls = [];
      props.onSwapStarter = (...args) => {
        calls.push(args);
        return pending.promise;
      };
      const h = createHarness(props);
      startDrag(h, 101);
      drop(h, "MID 선발 자리");
      drop(h, "MID 선발 자리");
      assert.equal(startDrag(h, 106).prevented, true);
      drop(h, "ADC 선발 자리");
      assert.equal(calls.length, 1);
      assert.equal(h.card(101).props.draggable, false);
      pending.resolve();
      await settle();
      assert.match(h.render(), /선발로 배치했습니다/);
      assert.equal(h.card(101).props.draggable, true);
      h.unmount();
    },
  );
  await check(
    "current-context failures are visible and release the pending lock",
    async () => {
      const props = fixture();
      let calls = 0;
      props.onSwapStarter = async () => {
        calls++;
        if (calls === 1) throw new Error("밴픽이 진행 중입니다.");
      };
      const h = createHarness(props);
      startDrag(h, 101);
      drop(h, "MID 선발 자리");
      await settle();
      assert.match(h.render(), /밴픽이 진행 중입니다/);
      assert.equal(h.card(101).props.draggable, true);
      startDrag(h, 106);
      drop(h, "MID 선발 자리");
      await settle();
      assert.equal(calls, 2);
      assert.doesNotMatch(h.render(), /밴픽이 진행 중입니다/);
      h.unmount();
    },
  );
  for (const reject of [false, true]) {
    await check(
      `late ${reject ? "error" : "success"} cannot replace feedback after selecting another club`,
      async () => {
        const props = fixture(),
          pending = deferred();
        props.onSwapStarter = () => pending.promise;
        const h = createHarness(props);
        startDrag(h, 101);
        drop(h, "MID 선발 자리");
        h.clickGroup("LCK 구단 선택", 1);
        h.clickGroup("LCK 구단 선택", 0);
        if (reject) pending.reject(new Error("OLD_SWAP_FAILURE"));
        else pending.resolve();
        await settle();
        assert.doesNotMatch(h.render(), /OLD_SWAP_FAILURE|선발로 배치했습니다/);
        h.unmount();
      },
    );
  }
  await check(
    "unmount ignores the completion of an in-flight swap",
    async () => {
      const props = fixture(),
        pending = deferred();
      props.onSwapStarter = () => pending.promise;
      const h = createHarness(props);
      startDrag(h, 101);
      drop(h, "MID 선발 자리");
      h.unmount();
      const before = h.writes;
      pending.resolve();
      await settle();
      assert.equal(h.writes, before);
    },
  );
  console.log(
    `Squad interactions: ${passed} cases passed (controlled handlers/SSR, not browser layout)`,
  );
}
runInteractionChecks().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
