const assert = require("node:assert/strict");
const { harness } = require("./check-legend-ui.cjs");
const settle = async () => {
  for (let i = 0; i < 4; i++)
    await new Promise((resolve) => setImmediate(resolve));
};
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
function Board() {
  return null;
}
function Report() {
  return null;
}
function Intermission() {
  return null;
}
function Preparation() {
  return null;
}

async function main() {
  const previous = global.document;
  global.document = { body: { style: { overflow: "auto" } } };
  try {
    const series = {
      seriesId: 7,
      nextGameNumber: 1,
      games: [],
      status: "IN_PROGRESS",
      bestOf: 3,
      teams: [
        { teamId: 1, teamCode: "A", wins: 0 },
        { teamId: 2, teamCode: "B", wins: 0 },
      ],
    };
    const remote = {
      gameNumber: 1,
      actions: [],
      deadline: new Date(Date.now() + 30000).toISOString(),
      serverNow: Date.now(),
      completed: false,
      blue: { id: 1 },
      red: { id: 2 },
      managedTeamId: 1,
    };
    const copy = (value) => JSON.parse(JSON.stringify(value));
    let closed = 0,
      actionCount = 0,
      playCount = 0,
      fail = false,
      wait = null;
    const calls = [];
    const props = {
      career: { teams: [{ id: 1 }, { id: 2 }] },
      token: "owner",
      flow: { series: copy(series), fixturePath: "/fixture/9" },
      onClose() {
        closed++;
      },
    };
    const request = async (url, options) => {
      calls.push({ url, options });
      assert.equal(options.token, "owner");
      if (url === "/drafts/catalog")
        return { version: 1, turnSeconds: 30, variants: [], turns: [] };
      if (url === "/match-series/7") return copy(series);
      if (url.endsWith("/actions")) {
        actionCount++;
        if (wait) await wait.promise;
        if (fail) throw Error("network");
        remote.actions.push({
          side: "BLUE",
          kind: "BAN",
          variantId: options.body.variantId,
          automatic: false,
        });
        return copy(remote);
      }
      if (url === "/fixture/9/games/simulate") {
        playCount++;
        assert.equal(options.body.gameNumber, remote.gameNumber);
        series.games.push({ seriesGameNumber: remote.gameNumber });
        series.nextGameNumber++;
        remote.gameNumber++;
        remote.actions = [];
        remote.completed = false;
        return {};
      }
      if (/\/drafts\/\d+$/.test(url)) return copy(remote);
      throw Error(`Unexpected ${url}`);
    };
    const view = harness("MatchFlowDialog.tsx", props, request, {
      "./DraftBoard": { __esModule: true, default: Board },
      "./QuickSimReport": { __esModule: true, default: Report },
      "./IntermissionPanel": { __esModule: true, default: Intermission },
      "./IntermissionDialog": { __esModule: true, default: Preparation },
    });
    const board = () => view.nodes().find((node) => node.type === Board).props;
    const report = () =>
      view.nodes().find((node) => node.type === Report).props;
    await view.mount();
    assert.equal(board().live.gameNumber, 1);
    assert.ok(view.nodes().some(n=>n.type.name==='DraftBackgroundMusic'),'BGM belongs to the draft workflow');
    assert.equal(document.body.style.overflow, "hidden");
    const choose = board().live.onAction;
    choose("TOP_TANK_A", 0);
    choose("TOP_TANK_A", 0);
    await settle();
    view.render();
    assert.equal(actionCount, 1);
    assert.equal(board().live.state.actions.length, 1);
    fail = true;
    board().live.onAction(null, 1);
    await settle();
    view.render();
    assert.match(board().live.error, /network/);
    fail = false;
    board().live.onReload();
    await settle();
    view.render();
    assert.equal(actionCount, 2, "Reload must not replay an uncertain action");
    remote.completed = true;
    remote.actions = Array.from({ length: 20 }, () => ({
      side: "BLUE",
      kind: "PICK",
      variantId: "test",
      automatic: false,
    }));
    board().live.onReload();
    await settle();
    view.render();
    const play = board().live.onPlay;
    play();
    play();
    await settle();
    await view.mount();
    assert.equal(playCount, 1);
    assert.equal(report().result.series.games.length, 1);
    assert.ok(!view.nodes().some(n=>n.type.name==='DraftBackgroundMusic'),'results unmount the BGM player');
    assert.ok(report().onNext);
    assert.equal(report().nextDisabled, false);
    assert.ok(!view.nodes().some((n) => n.type === Intermission));
    const beforeTransition = calls.length;
    const openFeedback = report().onNext;
    openFeedback();
    openFeedback();
    view.render();
    const preparation = () =>
      view.nodes().find((n) => n.type === Preparation).props;
    assert.ok(
      !view.nodes().some((n) => n.type === Report),
      "Results and feedback are separate screens",
    );
    assert.equal(
      calls.length,
      beforeTransition,
      "Opening feedback must not prepare a draft or simulate",
    );
    assert.equal(preparation().nextDisabled, true);
    preparation().onNext();
    view.render();
    assert.ok(view.nodes().some((n) => n.type === Preparation));
    assert.ok(!view.nodes().some(n=>n.type.name==='DraftBackgroundMusic'),'no BGM player during intermission');
    const panel = () => view.nodes().find((n) => n.type === Intermission).props;
    panel().onState({ busy: false, ready: true });
    view.render();
    assert.equal(preparation().nextDisabled, false);
    preparation().onBack();
    view.render();
    assert.ok(view.nodes().some((n) => n.type === Report));
    assert.ok(!view.nodes().some((n) => n.type === Intermission));
    report().onNext();
    view.render();
    assert.equal(
      preparation().nextDisabled,
      true,
      "Reopening must refresh saved feedback usage",
    );
    panel().onState({ busy: false, ready: true });
    view.render();
    const startNextDraft = preparation().onNext;
    startNextDraft();
    startNextDraft(); // No talk was submitted: skip is allowed.
    await settle();
    await view.mount();
    assert.equal(board().live.gameNumber, 2);
    assert.equal(board().live.state.actions.length, 0);
    assert.equal(
      calls.filter(
        (c) =>
          c.url === "/match-series/7/drafts/2" && c.options.method === "POST",
      ).length,
      1,
    );
    assert.equal(
      playCount,
      1,
      "Next set only opens draft; it does not simulate",
    );
    wait = deferred();
    board().live.onAction("TOP_TANK_A", 0);
    board().onClose();
    assert.equal(closed, 0, "Cannot close during a write");
    view.unmount();
    wait.resolve();
    await settle();
    assert.equal(closed, 0);
    assert.equal(document.body.style.overflow, "auto");
    assert.ok(!calls.some((call) => call.url.includes("simulations/quick")));
    let catalogAttempts = 0;
    const resumed = harness(
      "MatchFlowDialog.tsx",
      { ...props, flow: { ...props.flow, series: copy(series) } },
      async (url, options) => {
        if (url === "/drafts/catalog" && ++catalogAttempts === 1)
          throw Error("catalog unavailable");
        return request(url, options);
      },
      {
        "./DraftBoard": { __esModule: true, default: Board },
        "./QuickSimReport": { __esModule: true, default: Report },
        "./IntermissionPanel": { __esModule: true, default: Intermission },
        "./IntermissionDialog": { __esModule: true, default: Preparation },
      },
    );
    await resumed.mount();
    const resumedPanel = () =>
      resumed.nodes().find((n) => n.type === Intermission).props;
    const resumedReport = () =>
      resumed.nodes().find((n) => n.type === Report).props;
    resumedReport().onNext();
    resumed.render();
    const resumedPreparation = () =>
      resumed.nodes().find((n) => n.type === Preparation).props;
    resumedPanel().onState({ busy: true, ready: false });
    resumed.render();
    resumedPreparation().onNext();
    resumedPreparation().onClose();
    resumedPreparation().onBack();
    resumed.render();
    assert.ok(resumed.nodes().some((n) => n.type === Preparation));
    assert.equal(
      closed,
      0,
      "Feedback mutation blocks next/close synchronously",
    );
    resumedPanel().onState({ busy: false, ready: true });
    resumed.render();
    resumedPreparation().onNext();
    await settle();
    await resumed.mount();
    assert.equal(
      catalogAttempts,
      2,
      "A failed catalog read is retried when leaving a resumed intermission",
    );
    assert.ok(resumed.nodes().some((n) => n.type === Board));
    resumed.unmount();
    for (const bestOf of [1, 3, 5]) {
      const completed = harness(
        "MatchFlowDialog.tsx",
        {
          ...props,
          flow: {
            ...props.flow,
            series: {
              ...copy(series),
              bestOf,
              status: "COMPLETED",
              nextGameNumber: null,
            },
          },
        },
        request,
        {
          "./DraftBoard": { __esModule: true, default: Board },
          "./QuickSimReport": { __esModule: true, default: Report },
          "./IntermissionPanel": { __esModule: true, default: Intermission },
          "./IntermissionDialog": { __esModule: true, default: Preparation },
        },
      );
      await completed.mount();
      assert.equal(
        completed.nodes().find((n) => n.type === Report).props.onNext,
        undefined,
      );
      assert.ok(
        !completed
          .nodes()
          .some((n) => n.type === Intermission || n.type === Preparation),
      );
      completed.unmount();
    }
    console.log(
      "Match flow passed: result-only screen, explicit preparation step, optional feedback skip, back/reopen, no early draft, duplicate guards, completed BO1/3/5, request recovery and scroll cleanup.",
    );
  } finally {
    global.document = previous;
  }
}
async function championFlow(tactical = false) {
  const previous = global.document;
  global.document = {body:{style:{overflow:'auto'}}};
  function Champions(){return null;}
  const positions=['TOP','JUNGLE','MID','ADC','SUPPORT'];
  const entries=positions.map((position,i)=>({position,championId:`champion-${i}`}));
  const assignments={BLUE:Object.fromEntries(entries.map(e=>[e.position,e.championId])),RED:Object.fromEntries(entries.map((e,i)=>[e.position,`enemy-${i}`]))};
  const series={seriesId:9,nextGameNumber:1,games:[],status:'IN_PROGRESS',bestOf:3,teams:[{teamId:1,teamCode:'A',wins:0},{teamId:2,teamCode:'B',wins:0}]};
  const draft={version:3,gameNumber:1,actions:Array.from({length:20},()=>({})),deadline:new Date(Date.now()+30000).toISOString(),serverNow:Date.now(),completed:true,blue:{id:1},red:{id:2},managedTeamId:1,assignments,assignmentsConfirmed:false,assignmentRevision:0};
  let lineupPosts=0,simulatePosts=0;const waiting=deferred();
  const clone=x=>JSON.parse(JSON.stringify(x));
  const view=harness('MatchFlowDialog.tsx',{career:{teams:[{id:1},{id:2}]},token:'owner',flow:{series:clone(series),fixturePath:'/fixture/19'},onClose(){}},async(url,o)=>{
    if(url==='/drafts/catalog')return {version:1,turnSeconds:30,variants:[],champions:[],turns:[]};
    if(url==='/match-series/9')return clone(series);
    if(url.endsWith('/lineup')){
      lineupPosts++;assert.deepEqual(o.body,{expectedRevision:0,entries});await waiting.promise;
      draft.assignmentsConfirmed=true;draft.assignmentRevision=1;
      throw new Error('Response lost after commit');
    }
    if(url==='/fixture/19/games/simulate'){
      simulatePosts++;series.games.push({matchId:1,seriesGameNumber:1,durationMinutes:30,winnerTeamId:1,...(tactical?{tacticalReplay:{engineVersion:'tactical-core-3'}}:{}),
        teams:[1,2].map(id=>({teamId:id,teamCode:String(id),playerStats:[{careerPlayerId:id,position:'MID',kills:1,deaths:1,assists:0}]}))});series.nextGameNumber=2;return {};
    }
    if(/\/drafts\/1$/.test(url))return clone(draft);
    throw new Error(`Unexpected ${url}`);
  },{'./ChampionDraftBoard':{__esModule:true,default:Champions},'./QuickSimReport':{__esModule:true,default:Report},
    './DraftBoard':{__esModule:true,default:Board},'./IntermissionPanel':{__esModule:true,default:Intermission},'./IntermissionDialog':{__esModule:true,default:Preparation}});
  try{
    await view.mount();const board=()=>view.nodes().find(n=>n.type===Champions).props;
    board().live.onPlay();await settle();assert.equal(simulatePosts,0,'Cannot simulate before lineup confirmation');
    board().live.onLineup(entries,7);await settle();assert.equal(lineupPosts,0,'Ignore stale revision');
    board().live.onLineup(entries,0);board().live.onLineup(entries,0);await settle();assert.equal(lineupPosts,1);
    waiting.resolve();await settle();view.render();assert.match(board().live.error,/Response lost/);
    board().live.onReload();await settle();view.render();assert.equal(board().live.assignmentsConfirmed,true);assert.equal(lineupPosts,1,'Read recovery must not replay a committed lineup');
    board().live.onPlay();board().live.onPlay();await settle();view.render();assert.equal(simulatePosts,1);
    const spectator=view.nodes().find(n=>n.type.name===(tactical?'TacticalMatchViewer':'MatchSpectator'));assert.ok(spectator,'saved set opens correct engine spectator before results');
    if(tactical){assert.equal(spectator.props.matchId,1);assert.equal(spectator.props.token,'owner');}
    assert.ok(!view.nodes().some(n=>n.type===Report||n.type.name==='DraftBackgroundMusic'),'no result spoilers/draft BGM during viewing');
    spectator.props.onClose();view.render();assert.ok(view.nodes().some(n=>n.type===Report));
    assert.equal(simulatePosts,1,'skip viewing only changes the UI, never repeats simulation');
    console.log(`Champion match flow passed (${tactical?'tactical':'legacy'}): v3 view routing, confirm-before-play, stale revision, response recovery, one simulation, spectator before report and read-only skip.`);
  }finally{view.unmount();global.document=previous;}
}
main().then(()=>championFlow()).then(()=>championFlow(true)).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
