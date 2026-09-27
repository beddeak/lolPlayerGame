const assert = require('node:assert/strict');
const {harness} = require('./check-legend-ui.cjs');
const row = (teamId, rank) => ({teamId,rank,teamCode:`TEAM${teamId}`,teamName:`Team ${teamId}`,played:3,seriesWins:2,seriesLosses:1,gameDifference:2});
const group = (code, name, rows) => ({code,name,points:4,seriesWins:3,seriesLosses:2,gameDifference:2,battleStatus:'LEADING',standings:rows});
const stage={name:'Group Battle',code:'GROUP_BATTLE',format:'GROUP',status:'ACTIVE',settings:{pairingMode:'CROSS_GROUP',superWeek:{bestOf:5,winPoints:2}},participants:[{teamId:1}],standings:[row(1,8)],groups:[group('BARON','바론 그룹',[row(1,1),row(3,2)]),group('ELDER','장로 그룹',[row(2,1),row(4,2)])]};
(async()=>{
  const props={stage,managedTeamId:1};
  const view=harness('LeagueStandings.tsx',props,()=>{throw Error('Read-only view');});
  const before=structuredClone(stage);
  let html=await view.mount();
  assert.equal((html.match(/<table /g)||[]).length,2);
  assert.match(html,/바론 그룹/);assert.match(html,/장로 그룹/);assert.match(html,/슈퍼 위크/);assert.match(html,/현재 우세/);assert.match(html,/내 구단/);
  assert.equal((html.match(/class="league-group-rank">1</g)||[]).length,2,'each group has its own first place');
  assert.doesNotMatch(html,/class="league-group-rank">8</,'global rank must not leak into groups');
  assert.deepEqual(stage,before);
  props.stage={...stage,groups:stage.groups.map(g=>({...g,battleTiebreaker:'INITIAL_SEED'}))};
  assert.match(view.render(),/기존 상위 시드 기준으로 결정/);
  props.stage={...stage,groups:stage.groups.map(g=>({...g,battleTiebreaker:'GAME_DIFFERENCE'}))};
  assert.match(view.render(),/합산 세트 득실로 비교/);
  for(const codes of [['S','A','B'],['A','B','C','D'],['ASCEND','NIRVANA'],['LEGEND','RISE']]){
    props.stage={...stage,code:'OTHER',settings:{pairingMode:'INTRA_GROUP'},groups:codes.map((code,i)=>group(code,`${code} 그룹`,[row(i+1,1)]))};
    html=view.render();assert.equal((html.match(/<table /g)||[]).length,codes.length);assert.doesNotMatch(html,/슈퍼 위크|현재 우세/);assert.match(html,/같은 그룹/);
  }
  props.stage={...stage,status:'PLANNED',participants:[]};assert.match(view.render(),/이전 단계가 끝나면/);
  props.stage={...stage,groups:undefined};assert.match(view.render(),/다시 불러와/);
  props.stage={...stage,format:'ROUND_ROBIN'};html=view.render();assert.equal((html.match(/<table /g)||[]).length,1);assert.match(html,/class="league-group-rank">8</);assert.doesNotMatch(html,/바론 그룹/);
  view.unmount();
  console.log('League groups passed: separate LCK/LPL/Legend-Rise tables, group-local ranks, owned club, points, legacy response recovery, planned groups and ordinary standings (SSR; no browser).');
})().catch(error=>{console.error(error);process.exitCode=1;});
