// Real React components and API handlers with controlled hooks; no browser/layout claim.
const assert = require("node:assert/strict");
const React = require("react");
const { harness } = require("./check-legend-ui.cjs");
const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
};
const copy = (x) => structuredClone(x);
const text = (n) =>
  Array.isArray(n)
    ? n.map(text).join("")
    : React.isValidElement(n)
      ? text(n.props.children)
      : (n ?? "");
const button = (v, label) =>
  v.nodes().find((n) => n.type === "button" && text(n).includes(label));
const select = (v, label, value) => {
  v.nodes()
    .find((n) => n.type === "select" && n.props["aria-label"] === label)
    .props.onChange({ target: { value: String(value) } });
  v.render();
};
const positions = ["TOP", "JUNGLE", "MID", "ADC", "SUPPORT"];
function fixture() {
  const players = Array.from({ length: 6 }, (_, i) => ({
    id: i + 1,
    personality: "LOYAL",
    currentMental: 80,
    form: 60,
    condition: 85,
    coachTrust: 70,
    playerCard: { player: { nickname: `Player${i + 1}` } },
  }));
  const career = {
    id: 1,
    teams: [
      {
        id: 10,
        code: "A",
        isUserControlled: true,
        teamStrategy: "BALANCED",
        starters: players.slice(0, 5).map((careerPlayer, i) => ({
          starterPosition: positions[i],
          careerPlayer,
        })),
        benches: [{ careerPlayer: players[5] }],
      },
      { id: 20, code: "B", starters: [], benches: [] },
    ],
  };
  const stat = (id, i = 0) => ({
    careerPlayerId: id,
    position: positions[i],
    kills: 1,
    deaths: 2,
    assists: 3,
    dpm: 400,
    damageShare: 20,
    gold: 12000,
    goldShare: 20,
    gdAt15: -500,
    csdAt15: -10,
    kp: 60,
    rating: 6,
    form: 60,
    formAfter: 62,
    condition: 85,
    conditionAfter: 78,
    mental: 80,
    mentalAfter: 79,
  });
  const series = {
    seriesId: 7,
    bestOf: 3,
    nextGameNumber: 2,
    status: "IN_PROGRESS",
    teams: [
      { teamId: 10, teamCode: "A", wins: 0 },
      { teamId: 20, teamCode: "B", wins: 1 },
    ],
    games: [
      {
        matchId: 1,
        seriesGameNumber: 1,
        winnerTeamId: 20,
        teams: [
          {
            teamId: 10,
            teamCode: "A",
            baseAbility: 70,
            stateModifier: -2,
            playerStats: players.slice(0, 5).map((p, i) => stat(p.id, i)),
          },
          {
            teamId: 20,
            teamCode: "B",
            baseAbility: 80,
            stateModifier: 1,
            playerStats: positions.map((_, i) => stat(i + 11, i)),
          },
        ],
      },
    ],
  };
  const history = [],
    calls = [],
    state = [];
  let readError = false,
    lostPost = false,
    gate = null;
  const props = {
    career,
    series,
    token: "owner",
    onState(s) {
      state.push(s);
    },
    onSync(s, c) {
      props.series = s;
      props.career = c;
    },
  };
  const request = async (url, options) => {
    calls.push({ url, ...options });
    assert.equal(options.token, "owner");
    if (options.method === "POST") {
      if (gate) await gate;
      const talk = { id: history.length + 1, ...options.body, effects: [] };
      history.push(talk);
      if (lostPost) throw Error("응답 연결이 끊겼습니다.");
      return copy(talk);
    }
    if (options.method === "PATCH") {
      if (url.endsWith("/strategy"))
        career.teams[0].teamStrategy = options.body.strategy;
      return {};
    }
    if (readError) throw Error("읽기 실패");
    if (url.endsWith("/feedbacks")) return copy(history);
    if (url === "/careers/1") return copy(career);
    if (url === "/match-series/7") return copy(series);
    throw Error(`Unexpected ${url}`);
  };
  return {
    props,
    request,
    calls,
    state,
    history,
    series,
    career,
    setReadError: (v) => (readError = v),
    setLostPost: (v) => (lostPost = v),
    setGate: (v) => (gate = v),
  };
}
async function main() {
  const f = fixture(),
    v = harness("IntermissionPanel.tsx", f.props, f.request);
  let html = await v.mount();
  assert.match(html, /피드백은 선택 사항/);
  assert.equal(f.state.at(-1).ready, true);
  assert.equal(
    f.calls.filter((c) => c.method === "POST").length,
    0,
    "Loading/skipping never sends feedback",
  );
  button(v, "잘했다. 그대로 가자.").props.onClick();
  v.render();
  assert.equal(
    f.calls.filter((c) => c.method === "POST").length,
    0,
    "Selecting a quote does not send it",
  );
  const send = button(v, "선택한 피드백 전달").props.onClick;
  send();
  send();
  await settle();
  v.render();
  assert.equal(f.history.length, 1);
  assert.equal(f.history[0].afterGameNumber, 1);
  assert.equal(button(v, "이번 세트 피드백 완료").props.disabled, true);
  button(v, "개인 피드백").props.onClick();
  v.render();
  const targetOptions = v
    .nodes()
    .find((n) => n.props["aria-label"] === "개인 피드백 선수").props.children;
  assert.equal(targetOptions.length, 5, "No bench or enemy targets");
  select(v, "개인 피드백 선수", 3);
  button(v, "다음 세트는 네 중심으로 간다.").props.onClick();
  v.render();
  f.setLostPost(true);
  button(v, "선택한 피드백 전달").props.onClick();
  await settle();
  v.render();
  assert.equal(
    f.history.length,
    2,
    "Lost response reconciles by GET, never POST replay",
  );
  assert.equal(f.history[1].careerPlayerId, 3);
  assert.equal(button(v, "이번 세트 피드백 완료").props.disabled, true);
  assert.equal(f.state.at(-1).ready, true);
  select(v, "세트 사이 전술", "MID_CARRY");
  button(v, "전술 적용").props.onClick();
  await settle();
  v.render();
  assert.equal(f.career.teams[0].teamStrategy, "MID_CARRY");
  assert.ok(
    f.calls.some(
      (c) => c.url.endsWith("/strategy") && c.body.strategy === "MID_CARRY",
    ),
  );
  v.unmount();

  const restored = harness("IntermissionPanel.tsx", f.props, f.request);
  await restored.mount();
  assert.equal(button(restored, "이번 세트 피드백 완료").props.disabled, true);
  restored.unmount();

  const failed = fixture();
  failed.setReadError(true);
  const bad = harness("IntermissionPanel.tsx", failed.props, failed.request);
  await bad.mount();
  assert.equal(failed.state.at(-1).ready, false);
  assert.equal(button(bad, "선택한 피드백 전달").props.disabled, true);
  failed.setReadError(false);
  button(bad, "다시 불러오기").props.onClick();
  await settle();
  bad.render();
  assert.equal(failed.state.at(-1).ready, true);
  bad.unmount();

  for (const mode of ["draft", "complete", "spectator"]) {
    const x = fixture();
    if (mode === "draft") x.series.nextDraftStarted = true;
    if (mode === "complete") x.series.status = "COMPLETED";
    if (mode === "spectator") x.career.teams[0].isUserControlled = false;
    const locked = harness("IntermissionPanel.tsx", x.props, x.request);
    await locked.mount();
    assert.equal(button(locked, "선택한 피드백 전달").props.disabled, true);
    assert.equal(button(locked, "전술 적용").props.disabled, true);
    locked.unmount();
  }
  const gone = fixture();
  let release;
  gone.setGate(new Promise((r) => (release = r)));
  const unmounted = harness("IntermissionPanel.tsx", gone.props, gone.request);
  await unmounted.mount();
  button(unmounted, "잘했다. 그대로 가자.").props.onClick();
  unmounted.render();
  button(unmounted, "선택한 피드백 전달").props.onClick();
  unmounted.unmount();
  const count = gone.state.length;
  release();
  await settle();
  assert.equal(gone.state.length, count, "No late callbacks after unmount");

  const data = fixture(),
    analysis = harness("SetAnalysis.tsx", data.props, () => {
      throw Error("No request expected");
    });
  html = analysis.render();
  for (const label of [
    "DPM",
    "GD@15",
    "CSD@15",
    "KP",
    "폼",
    "컨디션",
    "멘탈",
    "패배 요인 분석",
    "기본 전력",
    "-10",
    "Player1",
  ])
    assert.ok(html.includes(label), label);
  assert.equal(analysis.nodes().filter((n) => n.type === "tbody").length, 2);
  assert.equal(analysis.nodes().filter((n) => n.type === "tr").length, 12);
  const measuredGame = copy(data.series.games[0]);
  data.series.games[0].teams.forEach((team) => {
    team.playerStats.forEach((player) => {
      player.gdAt15 = null;
      player.csdAt15 = null;
    });
  });
  html = analysis.render();
  assert.match(html, /15분 시점의 기록이 없습니다/);
  assert.doesNotMatch(html, /15분 지표에서 확인된 라인 열세가 없습니다/);
  assert.equal(analysis.nodes().filter((n) => n.type === "td" && text(n) === "—").length, 20,
    "Missing GD/CSD must display an em dash for every player, never zero");
  data.series.games[0].teams[0].playerStats[0].gdAt15 = 0;
  data.series.games[0].teams[0].playerStats[0].csdAt15 = 0;
  analysis.render();
  assert.equal(analysis.nodes().filter((n) => n.type === "td" && text(n) === "—").length, 18,
    "An observed zero must stay distinct from missing measurements");
  data.series.games[0] = measuredGame;
  const oldGame = copy(data.series.games[0]);
  oldGame.matchId = 2;
  oldGame.seriesGameNumber = 2;
  oldGame.teams.forEach((t) => {
    delete t.baseAbility;
    delete t.stateModifier;
  });
  data.series.games.push(oldGame);
  analysis.render();
  button(analysis, "2세트").props.onClick();
  html = analysis.render();
  assert.match(html, /이전 기록에 상세 보정값이 없습니다/);
  assert.doesNotMatch(html, /NaN|undefined/);
  const previousDocument = global.document;
  global.document = { body: { style: { overflow: "auto" } } };
  try {
    let shown = 0,
      closed = 0,
      back = 0,
      next = 0,
      exit = 0;
    const dialogProps = {
      series: fixture().series,
      children: "피드백 선택 영역",
      busy: false,
      nextDisabled: true,
      onNext() {
        next++;
      },
      onBack() {
        back++;
      },
      onClose() {
        exit++;
      },
    };
    const dialogView = harness("IntermissionDialog.tsx", dialogProps, () => {
      throw Error("Dialog must not write on its own");
    });
    const html = dialogView.render();
    assert.match(html, /2세트 준비/);
    assert.match(html, /피드백 선택 영역/);
    assert.doesNotMatch(html, /세트별 경기 분석|PLAYER OF THE MATCH/);
    const node = () => dialogView.nodes().find((n) => n.type === "dialog");
    node().props.ref.current = {
      showModal() {
        shown++;
      },
      close() {
        closed++;
      },
    };
    await dialogView.mount();
    assert.equal(shown, 1);
    assert.equal(document.body.style.overflow, "hidden");
    dialogView.button("2세트 밴픽 시작 →").props.onClick();
    assert.equal(next, 0);
    dialogProps.nextDisabled = false;
    dialogView.render();
    dialogView.button("2세트 밴픽 시작 →").props.onClick();
    assert.equal(next, 1, "Nothing requires a feedback selection");
    dialogProps.busy = true;
    dialogView.render();
    for (const label of [
      "← 결과 다시 보기",
      "2세트 밴픽 시작 →",
      "시즌 허브로 돌아가기 →",
    ]) {
      assert.equal(dialogView.button(label).props.disabled, true);
      dialogView.button(label).props.onClick();
    }
    node().props.onCancel({ preventDefault() {} });
    assert.equal(back, 0);
    assert.equal(exit, 0);
    assert.equal(next, 1);
    dialogProps.busy = false;
    dialogView.render();
    let prevented = false;
    node().props.onCancel({
      preventDefault() {
        prevented = true;
      },
    });
    assert.equal(prevented, true);
    assert.equal(back, 1);
    dialogView.button("시즌 허브로 돌아가기 →").props.onClick();
    assert.equal(exit, 1);
    dialogView.unmount();
    assert.equal(closed, 1);
    assert.equal(document.body.style.overflow, "auto");
  } finally {
    global.document = previousDocument;
  }
  console.log(
    "Intermission passed: optional skip, confirmation, two quotas, lost-response recovery, reload, auth scope, locking, unmount, real per-set analysis and 10-player metrics.",
  );
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
