// Real result component + pure snapshot aggregation, not a browser layout test.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { renderToStaticMarkup } = require("react-dom/server");
const { harness } = require("./check-legend-ui.cjs");
const { loadSource } = require("./load-source.cjs");
const { loadArtwork } = require("./check-card-artwork.cjs");
const helpers = loadSource("match-report");
const player = (id, nickname) => ({
  id,
  currentPosition: "MID",
  currentMechanics: 90,
  currentGameSense: 90,
  currentLaning: 90,
  currentTeamFight: 90,
  currentMacro: 90,
  currentTeamPlay: 90,
  currentMental: 90,
  currentChampionPool: 90,
  form: 1,
  condition: 2,
  playerCard: {
    cardYear: 2026,
    imageUrl: null,
    player: { nickname },
    theme: { name: "2026" },
  },
});
function fixture() {
  const stat = (id, form, formAfter, condition, conditionAfter, rating) => ({
    careerPlayerId: id,
    position: "MID",
    form,
    formAfter,
    condition,
    conditionAfter,
    rating,
    kills: 3,
    deaths: 1,
    assists: 5,
  });
  const games = [1, 2].map((number) => ({
    matchId: number,
    seriesGameNumber: number,
    winnerTeamId: 10,
    winnerTeamCode: "GEN",
    durationMinutes: 35,
    pog: {
      teamId: 10,
      careerPlayerId: 11,
      rating: 8,
      kills: 3,
      deaths: 1,
      assists: 5,
    },
    teams: [
      {
        teamId: 10,
        playerStats: [
          stat(
            11,
            number === 1 ? 50 : 57,
            number === 1 ? 57 : 62,
            number === 1 ? 100 : 94,
            number === 1 ? 94 : 88,
            8,
          ),
        ],
      },
      {
        teamId: 20,
        playerStats: [
          stat(
            21,
            number === 1 ? 60 : 56,
            number === 1 ? 56 : 55,
            number === 1 ? 80 : 73,
            number === 1 ? 73 : 66,
            10,
          ),
        ],
      },
    ],
  }));
  return {
    career: {
      id: 1,
      teams: [
        {
          id: 10,
          code: "GEN",
          name: "Gen.G",
          starters: [{ careerPlayer: player(11, "Chovy") }],
          benches: [{ careerPlayer: player(12, "Unplayed") }],
        },
        {
          id: 20,
          code: "DK",
          name: "Dplus Kia",
          isUserControlled: true,
          starters: [{ careerPlayer: player(21, "ShowMaker") }],
          benches: [],
        },
      ],
    },
    result: {
      series: {
        seriesId: 1,
        status: "COMPLETED",
        bestOf: 3,
        winnerTeamId: 10,
        games,
        teams: [
          { teamId: 10, teamCode: "GEN", wins: 2 },
          { teamId: 20, teamCode: "DK", wins: 0 },
        ],
        pom: {
          careerPlayerId: 11,
          teamId: 10,
          gamesPlayed: 2,
          averageRating: 8,
          totalRating: 16,
          pogCount: 2,
          kills: 6,
          deaths: 2,
          assists: 10,
        },
      },
    },
  };
}
function viewFor(props) {
  return harness("QuickSimReport.tsx", props, undefined, {
    "./match-report": helpers,
    "./card-artwork": loadSource("card-artwork"),
    "./PlayerCardArtwork": loadArtwork(),
    "./SetAnalysis": { __esModule: true, default: () => null }, // Independently exercised by check-intermission.cjs.
  });
}
const section = (view, label) =>
  view.nodes().find((node) => node.props["aria-label"] === label);
const markup = (view, label) => renderToStaticMarkup(section(view, label));
(async () => {
  const data = fixture();
  data.result.series.games.reverse();
  const original = JSON.stringify(data.result.series);
  const changes = helpers.seriesPlayerChanges(data.result.series);
  assert.deepEqual(changes[0], {
    careerPlayerId: 11,
    teamId: 10,
    position: "MID",
    gamesPlayed: 2,
    formBefore: 50,
    formAfter: 62,
    conditionBefore: 100,
    conditionAfter: 88,
  });
  assert.equal(
    data.result.series.games[0].seriesGameNumber,
    2,
    "Must not mutate stored arrays",
  );
  assert.equal(
    changes.some((p) => p.careerPlayerId === 12),
    false,
  );
  const substituted = fixture();
  substituted.result.series.games[1].teams[0].playerStats[0].careerPlayerId = 12;
  const substituteChanges = helpers.seriesPlayerChanges(
    substituted.result.series,
  );
  assert.equal(
    substituteChanges.find((p) => p.careerPlayerId === 11).gamesPlayed,
    1,
  );
  assert.equal(
    substituteChanges.find((p) => p.careerPlayerId === 11).formAfter,
    57,
  );
  assert.equal(
    substituteChanges.find((p) => p.careerPlayerId === 12).formBefore,
    57,
  );
  assert.equal(
    substituteChanges.find((p) => p.careerPlayerId === 12).conditionAfter,
    88,
  );

  let closed = 0,
    showed = 0;
  const props = {
    ...data,
    onClose() {
      closed++;
    },
  };
  const view = viewFor(props);
  let html = view.render();
  assert.match(html, /DEFEAT/);
  assert.match(markup(view, "시리즈 POM"), /Chovy/);
  assert.doesNotMatch(markup(view, "시리즈 POM"), /ShowMaker|MVP/);
  assert.doesNotMatch(markup(view, "세트별 POG"), /ShowMaker|MVP/);
  assert.match(markup(view, "선수 폼과 컨디션 변화"), /ShowMaker/);
  assert.match(markup(view, "선수 폼과 컨디션 변화"), /negative">-14/);
  view.button("GEN").props.onClick();
  html = view.render();
  assert.match(markup(view, "선수 폼과 컨디션 변화"), /positive">\+12/);
  assert.doesNotMatch(html, /Unplayed/);
  const previousDocument = global.document;
  global.document = { body: { style: { overflow: "auto" } } };
  try {
    const dialog = section(view, "경기 결과");
    const dom = {
      showModal() {
        showed++;
      },
      close() {},
      getBoundingClientRect() {
        return { top: 0, left: 100, right: 1100, bottom: 900 };
      },
    };
    dialog.props.ref.current = dom;
    await view.mount();
    assert.equal(showed, 1);
    assert.equal(document.body.style.overflow, "hidden");
    dialog.props.onClick({
      target: dom,
      currentTarget: dom,
      clientX: 200,
      clientY: 200,
    });
    assert.equal(closed, 0);
    dialog.props.onClick({
      target: dom,
      currentTarget: dom,
      clientX: 50,
      clientY: 200,
    });
    assert.equal(closed, 1);
    let prevented = false;
    dialog.props.onCancel({
      preventDefault() {
        prevented = true;
      },
    });
    assert.equal(prevented, true);
    assert.equal(closed, 2);
    view.button("시즌 허브로 돌아가기 →").props.onClick();
    assert.equal(closed, 3);
    view.unmount();
    assert.equal(document.body.style.overflow, "auto");
  } finally {
    global.document = previousDocument;
  }

  const invalid = fixture();
  invalid.result.series.pom.teamId = 20;
  invalid.result.series.games[0].pog.teamId = 20;
  const invalidView = viewFor({ ...invalid, onClose() {} });
  invalidView.render();
  assert.match(markup(invalidView, "시리즈 POM"), /POM 기록이 없습니다/);
  assert.match(markup(invalidView, "세트별 POG"), /기록 없음/);
  const missing = fixture();
  delete missing.result.series.pom;
  delete missing.result.series.games[0].teams[0].playerStats[0].form;
  assert.equal(
    helpers.seriesPlayerChanges(missing.result.series)[0].formBefore,
    null,
  );
  const incomplete = fixture();
  incomplete.result.series.status = "IN_PROGRESS";
  incomplete.result.series.nextGameNumber = 2;
  let nextClicked = 0;
  const incompleteView = viewFor({
    ...incomplete,
    onClose() {},
    onNext() {
      nextClicked++;
    },
  });
  incompleteView.render();
  assert.match(markup(incompleteView, "시리즈 POM"), /시리즈가 끝난 뒤/);
  incompleteView.button("2세트 넘어가기 →").props.onClick();
  assert.equal(nextClicked, 1);
  assert.doesNotMatch(
    incompleteView.render(),
    /세트 사이 감독 피드백|피드백 전달/,
  );

  const art = fixture();
  art.career.teams[0].starters[0].careerPlayer.playerCard.imageUrl =
    "/player-cards/2021viperEDG.png";
  const artView = viewFor({ ...art, onClose() {} });
  assert.match(artView.render(), /player-card-artwork/);
  assert.match(artView.render(), /aria-label="OVR 90"/);

  // The globally activated theme leaves original artwork untouched and has readable base text.
  const theme = fs.readFileSync(
    path.join(__dirname, "../src/ModernTheme.css"),
    "utf8",
  );
  assert.match(
    fs.readFileSync(path.join(__dirname, "../index.html"), "utf8"),
    /body class="modern-dark"/,
  );
  for (const screen of [
    "training-panel",
    "international-panel",
    "contracts-page",
    "market-page",
    "squad-board",
    "club-browser",
    "gm-navigation-panel",
    "club-news-dialog",
  ])
    assert.ok(theme.includes(`.${screen}`));
  assert.doesNotMatch(theme, /filter:\s*(invert|brightness)/);
  const luminance = (hex) =>
    hex
      .match(/\w\w/g)
      .map((x) => parseInt(x, 16) / 255)
      .map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4))
      .reduce((sum, x, i) => sum + x * [0.2126, 0.7152, 0.0722][i], 0);
  for (const text of ["e8eef7", "a4b3c7"])
    for (const bg of ["0c1119", "141d29", "1c2838"])
      assert.ok((luminance(text) + 0.05) / (luminance(bg) + 0.05) >= 4.5);
  assert.equal(JSON.stringify(data.result.series), original);
  view.button('1세트 협곡 다시보기').props.onClick();view.render();
  const replay=view.nodes().find(n=>n.type.name==='MatchSpectator');
  assert.ok(replay);assert.equal(replay.props.replay.set,1);
  replay.props.onClose();view.render();assert.ok(section(view,'경기 결과'));
  assert.equal(JSON.stringify(data.result.series),original,'replay does not modify recorded series');
  const shortGame=fixture();shortGame.result.series.games[0].durationMinutes=12;
  const shortView=viewFor({...shortGame,onClose(){}});shortView.render();
  assert.equal(shortView.button('짧은 경기 · 결과 기록만 제공').props.disabled,true,'short legacy record explains disabled replay instead of a no-op button');
  console.log(
    "Match report checks passed: winner-only POG/POM presentation, aggregate snapshots, losing team focus, both teams, no bench invention, legacy/missing records, actual artwork, modal lifecycle, dark theme base contrast.",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
