// Actual React components with controlled hooks; API handlers and SSR, not browser layout.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const settle = async () => {
  for (let i = 0; i < 4; i++)
    await new Promise((resolve) => setImmediate(resolve));
};
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
function harness(file, props, request) {
  const slots = [];
  let cursor = 0,
    effects = [],
    tree,
    writes = 0;
  const hooks = {
    ...React,
    useState(initial) {
      const i = cursor++;
      slots[i] ??= { value: initial };
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
        deps.some((value, index) => !Object.is(value, slots[i].deps[index]))
      ) {
        const previous = slots[i];
        slots[i] = { deps };
        effects.push(() => {
          previous?.cleanup?.();
          slots[i].cleanup = effect();
        });
      }
    },
  };
  const module = { exports: {} };
  const output = ts.transpileModule(
    fs.readFileSync(path.join(__dirname, "../src", `${file}.tsx`), "utf8"),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    },
  ).outputText;
  const loadLocal = (name) => {
    const filename = [".tsx", ".ts"]
      .map((ext) => path.join(__dirname, "../src", name + ext))
      .find(fs.existsSync);
    const child = { exports: {} };
    const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    }).outputText;
    new Function("require", "module", "exports", code)(
      resolve,
      child,
      child.exports,
    );
    return child.exports;
  };
  const resolve = (name) =>
    name === "react"
      ? hooks
      : name === "./api"
        ? { apiRequest: request }
        : name.endsWith(".css")
          ? {}
          : name.startsWith("./")
            ? loadLocal(name)
            : require(name);
  new Function("require", "module", "exports", output)(
    resolve,
    module,
    module.exports,
  );
  const render = () => {
    cursor = 0;
    tree = module.exports.default(props);
    return renderToStaticMarkup(tree);
  };
  const nodes = () => {
    const result = [];
    const walk = (node) => {
      if (Array.isArray(node)) node.forEach(walk);
      else if (React.isValidElement(node)) {
        result.push(node);
        walk(node.props.children);
      }
    };
    walk(tree);
    return result;
  };
  const text = (node) =>
    Array.isArray(node)
      ? node.map(text).join("")
      : React.isValidElement(node)
        ? text(node.props.children)
        : (node ?? "");
  return {
    render,
    nodes,
    writes: () => writes,
    openPlayer(id) {
      nodes()
        .find((node) => node.props["aria-label"] === `PLAYER_${id} 훈련 관리`)
        .props.onClick({ currentTarget: { focus() {} } });
      return render();
    },
    button: (label, index = 0) =>
      nodes().filter((node) => node.type === "button" && text(node) === label)[
        index
      ],
    async mount() {
      render();
      const pending = effects;
      effects = [];
      pending.forEach((effect) => effect());
      await settle();
      return render();
    },
    unmount() {
      slots.forEach((slot) => slot.cleanup?.());
    },
  };
}
const player = (id) => ({
  id,
  currentPosition: "TOP",
  condition: 70,
  form: 40,
  currentLaning: 80,
  currentMechanics: 80,
  currentGameSense: 80,
  currentTeamFight: 80,
  currentMacro: 80,
  currentTeamPlay: 80,
  currentMental: 80,
  currentChampionPool: 80,
  playerCard: { player: { nickname: `PLAYER_${id}` } },
});
const trainingFixture = () => ({
  props: {
    career: { id: 1, currentDate: "2026-01-05" },
    token: "a",
    team: {
      id: 7,
      chemistry: 50,
      teamStrategy: "BALANCED",
      strategyProficiencies: [{ strategy: "BALANCED", proficiency: 50 }],
      starters: [1, 2, 3, 4, 5].map((id) => ({
        starterPosition: ["TOP", "JUNGLE", "MID", "ADC", "SUPPORT"][id - 1],
        careerPlayer: player(id),
      })),
      benches: [{ careerPlayer: player(6) }],
    },
    onCareerRefresh: async () => {},
    onOpenPlayer() {},
  },
  period: {
    weekStartsAt: "2026-01-05",
    weekEndsAt: "2026-01-11",
    available: true,
    teamAvailable: true,
    teamRested: false,
    phaseLabel: "프리시즌",
    usedPlayerIds: [],
    teamTraining: { remaining: 1, limit: 1 },
    sessions: [],
  },
});
async function main() {
  const fit = { exports: {} };
  new Function(
    "exports",
    ts.transpileModule(
      fs.readFileSync(
        path.resolve(__dirname, "../src/position-fit.ts"),
        "utf8",
      ),
      { compilerOptions: { module: ts.ModuleKind.CommonJS } },
    ).outputText,
  )(fit.exports);
  const backendConfig = fs.readFileSync(
    path.resolve(
      __dirname,
      "../../backend/src/matches/config/position-proficiency.config.ts",
    ),
    "utf8",
  );
  assert.equal(
    fit.exports.POSITION_MAX_PENALTY,
    -Number(backendConfig.match(/maxPenalty:\s*(-?\d+)/)[1]),
  );
  const fitPlayer = player(1);
  assert.equal(fit.exports.positionFit(fitPlayer, "MID").penalty, 32);
  assert.equal(fit.exports.positionFit(fitPlayer, "TOP").penalty, 0);
  fitPlayer.positionProficiencies = [{ position: "MID", proficiency: 100 }];
  assert.equal(fit.exports.positionFit(fitPlayer, "MID").penalty, 0);
  assert.equal(fitPlayer.currentMechanics, 80);
  const beforeFit = structuredClone(fitPlayer);
  const offRole = fit.exports.playerForPositionDisplay(fitPlayer, "ADC");
  for (const field of fit.exports.POSITION_DISPLAY_STATS)
    assert.equal(offRole[field], 48);
  assert.equal(fit.exports.positionDisplayOverall(offRole), 48);
  assert.deepEqual(fitPlayer, beforeFit);
  assert.equal(
    fit.exports.playerForPositionDisplay(fitPlayer, "TOP").currentMechanics,
    80,
  );
  assert.equal(
    fit.exports.playerForPositionDisplay(
      { ...fitPlayer, currentMechanics: 10 },
      "ADC",
    ).currentMechanics,
    0,
  );
  let checks = 0;
  const check = async (label, work) => {
    await work();
    checks++;
    console.log(`PASS ${label}`);
  };
  await check(
    "live OVR, all eight stats and legend artwork drop on reassignment and recover on return",
    async () => {
      const f = trainingFixture();
      for (const slot of f.props.team.starters)
        slot.careerPlayer.currentPosition = slot.starterPosition;
      const adc = f.props.team.starters[3],
        mid = f.props.team.starters[2];
      adc.careerPlayer.playerCard.imageUrl = "/player-cards/2021viperEDG.png";
      let target;
      f.props.onCareerRefresh = async () => {
        mid.starterPosition = adc.starterPosition;
        adc.starterPosition = target;
      };
      const h = harness("TrainingPanel", f.props, async (url, options) => {
        if (options.method === "PATCH") {
          target = url.split("/").at(-2);
          return {};
        }
        return f.period;
      });
      const cardMarkup = () =>
        renderToStaticMarkup(
          h.nodes().find((n) => n.props["aria-label"] === "PLAYER_4 훈련 관리"),
        );
      const drop = (position) => {
        h.nodes()
          .find((n) => n.props["aria-label"] === "PLAYER_4 훈련 관리")
          .props.onDragStart({
            dataTransfer: { setData() {} },
            preventDefault() {},
          });
        h.nodes()
          .find((n) => n.props["aria-label"] === `${position} 선발 자리`)
          .props.onDrop({ preventDefault() {} });
      };
      await h.mount();
      assert.match(cardMarkup(), /aria-label="OVR 80"/);
      drop("MID");
      await settle();
      h.render();
      assert.match(cardMarkup(), /aria-label="OVR 48"/);
      assert.match(cardMarkup(), /live-position-number">48/);
      assert.doesNotMatch(cardMarkup(), /포지션 적용|−32/);
      const html = h.openPlayer(4);
      assert.match(html, /MID 배치 기준/);
      const statGrid = h
        .nodes()
        .find((n) => n.props.className === "management-stat-grid");
      for (const button of statGrid.props.children)
        assert.equal(
          button.props.children.find((n) => n?.type === "strong").props
            .children,
          48,
        );
      assert.equal(adc.careerPlayer.currentMechanics, 80);
      drop("ADC");
      await settle();
      h.render();
      assert.match(cardMarkup(), /aria-label="OVR 80"/);
    },
  );
  await check(
    "dragging a starter to MID sends one authenticated move and ignores external drops",
    async () => {
      const f = trainingFixture(),
        wait = deferred();
      let patches = 0,
        refreshes = 0;
      f.props.onCareerRefresh = async () => {
        refreshes++;
      };
      const h = harness("TrainingPanel", f.props, async (url, options) => {
        if (options.method === "PATCH") {
          patches++;
          assert.equal(url, "/careers/1/teams/7/starters/MID/swap");
          assert.deepEqual(options.body, { careerPlayerId: 4 });
          assert.equal(options.token, "a");
          return wait.promise;
        }
        return f.period;
      });
      await h.mount();
      const slot = () =>
        h.nodes().find((n) => n.props["aria-label"] === "MID 선발 자리");
      slot().props.onDrop({ preventDefault() {} });
      assert.equal(patches, 0);
      h.nodes()
        .find((n) => n.props["aria-label"] === "PLAYER_4 훈련 관리")
        .props.onDragStart({
          dataTransfer: { setData() {} },
          preventDefault() {},
        });
      h.render();
      const drop = slot().props.onDrop;
      drop({ preventDefault() {} });
      drop({ preventDefault() {} });
      assert.equal(patches, 1);
      wait.resolve({});
      await settle();
      assert.equal(refreshes, 1);
      assert.match(h.render(), /선발 배치를 저장/);
    },
  );
  await check(
    "accessible bench placement and uncertain-response reconciliation never repeat the swap",
    async () => {
      const f = trainingFixture();
      let patches = 0,
        refreshes = 0;
      f.props.onCareerRefresh = async () => {
        refreshes++;
      };
      const h = harness("TrainingPanel", f.props, async (_url, options) => {
        if (options.method === "PATCH") {
          patches++;
          assert.deepEqual(options.body, { careerPlayerId: 6 });
          throw new Error("lost response");
        }
        return f.period;
      });
      await h.mount();
      h.openPlayer(6);
      h.button("MID 선발로 배치").props.onClick();
      await settle();
      assert.match(h.render(), /lost response/);
      assert.equal(patches, 1);
      assert.equal(refreshes, 1);
    },
  );
  await check(
    "starter drops onto an occupied bench card use the assigned slot, not the native role",
    async () => {
      const f = trainingFixture(),
        wait = deferred();
      const assigned = f.props.team.starters[2];
      assigned.careerPlayer.currentPosition = "ADC";
      let patches = 0,
        refreshes = 0;
      f.props.onCareerRefresh = async () => {
        refreshes++;
      };
      const h = harness("TrainingPanel", f.props, async (url, options) => {
        if (options.method === "PATCH") {
          patches++;
          assert.equal(url, "/careers/1/teams/7/starters/MID/swap");
          assert.deepEqual(options.body, { careerPlayerId: 6 });
          return wait.promise;
        }
        return f.period;
      });
      await h.mount();
      const card = (id) =>
        h
          .nodes()
          .find((n) => n.props["aria-label"] === `PLAYER_${id} 훈련 관리`);
      card(6).props.onDrop({ preventDefault() {} });
      assert.equal(patches, 0, "external dataTransfer ids are not trusted");
      card(3).props.onDragStart({
        dataTransfer: { setData() {} },
        preventDefault() {},
      });
      let accepted = false;
      card(6).props.onDragOver({
        preventDefault() {
          accepted = true;
        },
        dataTransfer: {},
      });
      assert.equal(accepted, true);
      card(6).props.onDrop({ preventDefault() {} });
      card(6).props.onDrop({ preventDefault() {} });
      assert.equal(patches, 1);
      wait.resolve({});
      await settle();
      assert.equal(refreshes, 1);
      assert.equal(assigned.careerPlayer.currentPosition, "ADC");
      assert.equal(assigned.careerPlayer.currentMechanics, 80);
      assert.ok(
        h
          .nodes()
          .filter((n) => n.type === "img")
          .every((n) => n.props.draggable === false),
      );
      // Bench-to-bench drops are not a valid starting-lineup operation.
      card(6).props.onDragStart({
        dataTransfer: { setData() {} },
        preventDefault() {},
      });
      card(6).props.onDrop({ preventDefault() {} });
      assert.equal(patches, 1);
    },
  );
  await check(
    "committed training and swaps refresh the career even after navigation",
    async () => {
      for (const operation of ["POST", "PATCH"]) {
        const f = trainingFixture(),
          wait = deferred();
        let refreshes = 0;
        f.props.onCareerRefresh = async () => {
          refreshes++;
        };
        const h = harness("TrainingPanel", f.props, async (_url, options) =>
          options.method === operation ? wait.promise : f.period,
        );
        await h.mount();
        if (operation === "POST") h.button("스크림 진행").props.onClick();
        else {
          h.nodes()
            .find((n) => n.props["aria-label"] === "PLAYER_6 훈련 관리")
            .props.onDragStart({
              dataTransfer: { setData() {} },
              preventDefault() {},
            });
          h.nodes()
            .find((n) => n.props["aria-label"] === "MID 선발 자리")
            .props.onDrop({ preventDefault() {} });
        }
        h.unmount();
        const before = h.writes();
        wait.resolve(f.period);
        await settle();
        assert.equal(refreshes, 1);
        assert.equal(h.writes(), before, "unmounted local UI is not changed");
      }
    },
  );
  await check(
    "lost training response reconciles stats as well as weekly usage",
    async () => {
      const f = trainingFixture();
      let reads = 0,
        posts = 0,
        refreshes = 0;
      f.props.onCareerRefresh = async () => {
        refreshes++;
        f.props.team.benches[0].careerPlayer.currentLaning = 82;
      };
      const h = harness("TrainingPanel", f.props, async (_url, options) => {
        if (options.method === "POST") {
          posts++;
          throw new Error("lost response");
        }
        return ++reads === 1 ? f.period : { ...f.period, usedPlayerIds: [6] };
      });
      await h.mount();
      h.openPlayer(6);
      h.button("훈련").props.onClick();
      await settle();
      assert.match(h.render(), /라인전 · 82/);
      assert.ok(h.button("이번 주 완료").props.disabled);
      assert.equal(posts, 1);
      assert.equal(refreshes, 1);
    },
  );
  await check(
    "adaptation is shown only for the assigned off-role slot; stale choices reset on return",
    async () => {
      const f = trainingFixture();
      let submitted;
      const h = harness("TrainingPanel", f.props, async (_url, options) => {
        if (options.method === "POST") submitted = options.body;
        return f.period;
      });
      await h.mount();
      h.openPlayer(3);
      h.button("MID 적응20").props.onClick();
      assert.match(h.render(), /MID 적응 20 → 최대 22/);
      h.button("훈련").props.onClick();
      await settle();
      assert.deepEqual(submitted, {
        type: "POSITION",
        position: "MID",
        careerPlayerId: 3,
      });
      assert.equal(h.button("TOP 적응100"), undefined);
      assert.equal(h.button("ADC 적응20"), undefined);
      // Returning to native TOP must discard the old MID training selection.
      f.props.team.starters[2].starterPosition = "TOP";
      h.render();
      assert.equal(h.button("MID 적응20"), undefined);
      h.button("훈련").props.onClick();
      await settle();
      assert.deepEqual(submitted, { type: "LANING", careerPlayerId: 3 });
      h.openPlayer(6);
      assert.equal(
        h
          .nodes()
          .filter(
            (n) =>
              n.type === "option" &&
              String(n.props.value).startsWith("POSITION:"),
          ).length,
        0,
      );
    },
  );
  await check(
    "training renders all five starters and bench; no old starting-lineup table",
    async () => {
      const f = trainingFixture(),
        h = harness("TrainingPanel", f.props, async () => f.period);
      const html = await h.mount();
      for (let id = 1; id <= 6; id++)
        assert.match(html, new RegExp(`PLAYER_${id}`));
      assert.equal(h.button("훈련"), undefined);
      assert.doesNotMatch(html, /선발 라인업/);
      assert.equal(
        h
          .nodes()
          .filter((n) =>
            n.props.className?.split(" ").includes("management-player-card"),
          ).length,
        6,
      );
      h.openPlayer(6);
      assert.equal(h.button("훈련").props.disabled, false);
      assert.equal(
        h.nodes().filter((n) => n.props["aria-pressed"] !== undefined).length,
        8,
      );
    },
  );
  await check(
    "season permits team choices but blocks stat training; zero condition and max stats disable training",
    async () => {
      const f = trainingFixture();
      f.period.available = false;
      const h = harness("TrainingPanel", f.props, async () => f.period);
      await h.mount();
      h.openPlayer(1);
      assert.equal(h.button("스크림 진행").props.disabled, false);
      assert.ok(h.button("훈련").props.disabled);
      assert.equal(h.button("팀 전체 휴식").props.disabled, false);
      const f2 = trainingFixture();
      f2.props.team.starters[0].careerPlayer.currentLaning = 119;
      f2.props.team.starters[1].careerPlayer.condition = 0;
      f2.props.team.starters[2].careerPlayer.condition = 100;
      const h2 = harness("TrainingPanel", f2.props, async () => f2.period);
      await h2.mount();
      h2.openPlayer(1);
      assert.ok(h2.button("훈련").props.disabled);
      assert.match(h2.render(), /최대치 119/);
      h2.openPlayer(2);
      assert.ok(h2.button("훈련").props.disabled);
      assert.equal(h2.button("팀 전체 휴식").props.disabled, false);
    },
  );
  await check(
    "same-tick double click submits once and persists per-player usage",
    async () => {
      const f = trainingFixture(),
        wait = deferred();
      let posts = 0;
      const h = harness("TrainingPanel", f.props, async (url, options) => {
        if (options.method === "POST") {
          posts++;
          assert.equal(url, "/careers/1/training-periods/current/individual");
          assert.deepEqual(options.body, { type: "LANING", careerPlayerId: 1 });
          return wait.promise;
        }
        return f.period;
      });
      await h.mount();
      h.openPlayer(1);
      const click = h.button("훈련").props.onClick;
      click();
      click();
      assert.equal(posts, 1);
      wait.resolve({ ...f.period, usedPlayerIds: [1] });
      await settle();
      h.render();
      assert.ok(h.button("이번 주 완료").props.disabled);
      h.openPlayer(2);
      assert.equal(h.button("훈련").props.disabled, false);
    },
  );
  await check(
    "scrim and team rest target the same team slot; show condition/form changes including bench",
    async () => {
      const f = trainingFixture(),
        bodies = [];
      const h = harness("TrainingPanel", f.props, async (url, options) => {
        if (options.method === "POST") {
          assert.match(url, /\/team$/);
          bodies.push(options.body);
        }
        return f.period;
      });
      await h.mount();
      h.button("스크림 진행").props.onClick();
      await settle();
      h.render();
      f.period = {
        ...f.period,
        teamRested: true,
        teamTraining: { remaining: 0, limit: 1 },
        sessions: [
          {
            id: 1,
            type: "REST",
            careerPlayerId: null,
            resultDelta: 0,
            conditionDelta: null,
            playerEffects: [
              {
                careerPlayerId: 6,
                conditionBefore: 70,
                conditionAfter: 90,
                conditionDelta: 20,
                formBefore: 40,
                formAfter: 43,
                formDelta: 3,
              },
            ],
          },
        ],
      };
      h.button("팀 전체 휴식").props.onClick();
      await settle();
      const html = h.openPlayer(6);
      assert.match(html, /70 → 90/);
      assert.match(html, /40 → 43/);
      assert.match(html, /회복 멘탈 80/);
      assert.ok(h.button("팀 전체 휴식").props.disabled);
      assert.ok(h.button("훈련").props.disabled);
      h.button("팀 전체 휴식").props.onClick();
      await settle();
      assert.deepEqual(bodies, [
        { type: "STRATEGY", strategy: "BALANCED" },
        { type: "REST" },
      ]);
    },
  );
  await check(
    "rest is blocked only when both states are full or individual training already used",
    async () => {
      const f = trainingFixture();
      [...f.props.team.starters, ...f.props.team.benches].forEach((slot) => {
        slot.careerPlayer.condition = 100;
        slot.careerPlayer.form = 100;
      });
      const h = harness("TrainingPanel", f.props, async () => f.period);
      await h.mount();
      assert.ok(h.button("팀 전체 휴식").props.disabled);
      f.props.team.benches[0].careerPlayer.form = 99;
      h.render();
      assert.equal(h.button("팀 전체 휴식").props.disabled, false);
      f.period.usedPlayerIds = [1];
      h.render();
      assert.ok(h.button("팀 전체 휴식").props.disabled);
    },
  );
  await check(
    "uncertain POST response reloads latest usage without automatic retry",
    async () => {
      const f = trainingFixture();
      let reads = 0,
        posts = 0;
      const h = harness("TrainingPanel", f.props, async (_url, options) => {
        if (options.method === "POST") {
          posts++;
          throw new Error("timeout");
        }
        return ++reads === 1 ? f.period : { ...f.period, usedPlayerIds: [1] };
      });
      await h.mount();
      h.openPlayer(1);
      h.button("훈련").props.onClick();
      await settle();
      assert.match(h.render(), /timeout/);
      assert.ok(h.button("이번 주 완료").props.disabled);
      assert.equal(posts, 1);
      assert.equal(reads, 2);
    },
  );
  await check("unmounted training load ignores late responses", async () => {
    const f = trainingFixture(),
      wait = deferred(),
      h = harness("TrainingPanel", f.props, () => wait.promise);
    await h.mount();
    h.unmount();
    const before = h.writes();
    wait.resolve(f.period);
    await settle();
    assert.equal(h.writes(), before);
  });
  await check(
    "five position slots remain ordered with vacancies; bench is a separate section",
    async () => {
      const f = trainingFixture();
      f.props.team.starters = f.props.team.starters.slice(1).reverse();
      f.props.team.benches = [];
      const h = harness("TrainingPanel", f.props, async () => f.period);
      const html = await h.mount();
      assert.match(html, /선발 미등록/);
      assert.match(html, /등록된 후보 선수가 없습니다/);
      const row = h
        .nodes()
        .find((n) => n.props.className === "management-starting-row");
      assert.equal(row.props.children.length, 5);
      assert.deepEqual(
        row.props.children
          .slice(1)
          .map((n) => n.props.children.props["aria-label"]),
        [2, 3, 4, 5].map((id) => `PLAYER_${id} 훈련 관리`),
      );
    },
  );
  await check(
    "stat selection changes the submitted training target and displays refreshed stats",
    async () => {
      const f = trainingFixture();
      let body;
      f.props.onCareerRefresh = async () => {
        f.props.team.benches[0].careerPlayer.currentMechanics = 82;
      };
      const h = harness("TrainingPanel", f.props, async (_url, options) => {
        if (options.method === "POST") {
          body = options.body;
          return { ...f.period, usedPlayerIds: [6] };
        }
        return f.period;
      });
      await h.mount();
      h.openPlayer(6);
      h.button("메카닉80").props.onClick();
      h.render();
      h.button("훈련").props.onClick();
      await settle();
      const html = h.render();
      assert.deepEqual(body, { type: "MECHANICS", careerPlayerId: 6 });
      assert.match(html, /메카닉 · 82/);
      assert.ok(h.button("이번 주 완료").props.disabled);
    },
  );
  await check(
    "native dialog opens, closes via Escape, restores scroll and supports player details",
    async () => {
      const f = trainingFixture();
      let shown = 0,
        closed = 0,
        detail;
      f.props.onOpenPlayer = (p) => {
        detail = p.id;
      };
      const previous = global.document;
      global.document = { body: { style: { overflow: "auto" } } };
      const h = harness("TrainingPanel", f.props, async () => f.period);
      try {
        await h.mount();
        h.openPlayer(6);
        h.nodes().find((n) => n.type === "dialog").props.ref.current = {
          showModal() {
            shown++;
          },
          close() {
            closed++;
          },
        };
        await h.mount();
        assert.equal(shown, 1);
        assert.equal(document.body.style.overflow, "hidden");
        h.nodes()
          .find((n) => n.type === "dialog")
          .props.onCancel({ preventDefault() {} });
        await h.mount();
        assert.equal(closed, 1);
        assert.equal(document.body.style.overflow, "auto");
        assert.equal(h.button("훈련"), undefined);
        h.openPlayer(2);
        h.nodes()
          .find((n) => n.props.className === "training-player-name")
          .props.onClick();
        h.render();
        assert.equal(detail, 2);
        assert.equal(h.button("훈련"), undefined);
      } finally {
        h.unmount();
        global.document = previous;
      }
    },
  );
  await check(
    "uncertain submission with failed reload locks further training",
    async () => {
      const f = trainingFixture();
      let calls = 0;
      const h = harness("TrainingPanel", f.props, async () => {
        if (++calls > 1) throw new Error("offline");
        return f.period;
      });
      await h.mount();
      h.openPlayer(1);
      h.button("훈련").props.onClick();
      await settle();
      assert.match(h.render(), /화면을 다시 열어/);
      assert.ok(h.button("훈련").props.disabled);
      assert.ok(h.button("스크림 진행").props.disabled);
    },
  );
  const internationalFixture = () => ({
    props: {
      career: {
        id: 1,
        teams: [
          { id: 1, code: "T1", isUserControlled: true },
          { id: 2, code: "BLG", isUserControlled: false },
        ],
      },
      token: "a",
      revision: {},
      busy: false,
      onAction() {},
    },
    data: {
      readiness: [
        {
          kind: "FIRST_STAND",
          participantCount: 8,
          startsAt: "2026-03-16",
          endsAt: "2026-03-22",
          tournamentId: null,
          ready: false,
          reasons: ["LCP 예선 미완료"],
          teamRequirements: [{ region: "LCP", available: 0, required: 1 }],
        },
      ],
      tournaments: [
        {
          id: 4,
          kind: "MSI",
          year: 2026,
          rosterConfirmed: false,
          championTeamId: null,
          entrants: [
            { teamId: 1, region: "LCK", regionalSeed: 1, entry: "MAIN" },
          ],
          fixtures: [
            {
              id: 9,
              key: "GF",
              stage: "FINAL",
              round: 7,
              scheduledDate: "2026-07-12",
              bestOf: 5,
              teamAId: 1,
              teamBId: 2,
              winnerTeamId: null,
              teamAWins: 0,
              teamBWins: 0,
              playable: false,
            },
          ],
        },
      ],
    },
  });
  await check(
    "international missing-data reasons are visible; future games disabled",
    async () => {
      const f = internationalFixture(),
        h = harness("InternationalPanel", f.props, async () => f.data);
      const html = await h.mount();
      assert.match(html, /LCP 예선 미완료/);
      assert.match(html, /BLG/);
      assert.ok(h.button("대회 준비").props.disabled);
      assert.ok(h.button("일정 / 진출팀 대기").props.disabled);
    },
  );
  await check(
    "international registration and simulation route through shared season action lock",
    async () => {
      const f = internationalFixture(),
        actions = [];
      f.props.onAction = (action) => actions.push(action);
      f.data.tournaments[0].fixtures[0].playable = true;
      const h = harness("InternationalPanel", f.props, async () => f.data);
      await h.mount();
      h.button("현재 선수단 등록").props.onClick();
      h.button("경기 시작 · 세트별 밴픽").props.onClick();
      assert.deepEqual(actions, ["4/roster", "4/fixtures/9/simulate"]);
      f.props.busy = true;
      h.render();
      assert.ok(h.button("경기 시작 · 세트별 밴픽").props.disabled);
    },
  );
  await check(
    "old international responses cannot overwrite a newer calendar revision",
    async () => {
      const f = internationalFixture(),
        old = deferred();
      let count = 0;
      const h = harness("InternationalPanel", f.props, () =>
        ++count === 1 ? old.promise : Promise.resolve(f.data),
      );
      await h.mount();
      f.props.revision = {};
      await h.mount();
      const before = h.writes();
      old.resolve({ readiness: [], tournaments: [] });
      await settle();
      assert.equal(h.writes(), before);
      assert.match(h.render(), /LCP 예선 미완료/);
    },
  );
  await check(
    "AI-only international games are read-only and collapsed while owned games retain controls",
    async () => {
      const f = internationalFixture();
      f.props.career.teams[0].isUserControlled = false;
      f.data.tournaments[0].rosterConfirmed = true;
      f.data.tournaments[0].fixtures[0].playable = true;
      const published = [];
      f.props.onData = (data) => published.push(data);
      const h = harness("InternationalPanel", f.props, async () => f.data);
      const html = await h.mount();
      assert.match(html, /일정 진행 시 자동 처리/);
      assert.equal(h.button("경기 시작 · 세트별 밴픽"), undefined);
      assert.equal(
        h
          .nodes()
          .find((node) => node.props.className === "international-tournament")
          .props.open,
        false,
      );
      assert.deepEqual(published, [f.data]);
    },
  );
  await check(
    "unmounted international errors never write to a different screen",
    async () => {
      const f = internationalFixture(),
        wait = deferred(),
        h = harness("InternationalPanel", f.props, () => wait.promise);
      await h.mount();
      h.unmount();
      const before = h.writes();
      wait.reject(new Error("old error"));
      await settle();
      assert.equal(h.writes(), before);
    },
  );
  console.log(`Activity UI checks passed: ${checks} scenarios.`);
}
module.exports = { harness, trainingFixture };
if (require.main === module)
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
