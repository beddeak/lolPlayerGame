const assert=require('node:assert/strict');
const {harness}=require('./check-legend-ui.cjs');
const {loadSource}=require('./load-source.cjs');
const {isBracketStage}=loadSource('league-stage');
const node=(key,round,lane,a,b)=>({key,round,lane,label:lane==='FINAL'?'결승':`${key}경기`,bestOf:5,fixtureId:null,a,b});
const source=(key,result)=>({teamId:null,source:{key,result}});
const stage={name:'Playoffs',format:'DOUBLE_ELIMINATION',status:'ACTIVE',participants:[{teamId:1,teamCode:'T1',teamName:'T1'},{teamId:2,teamCode:'GEN',teamName:'Gen.G'}],fixtures:[{id:10,status:'COMPLETED',teamA:{id:1,code:'T1',name:'T1'},teamB:{id:2,code:'GEN',name:'Gen.G'},teamAWins:3,teamBWins:1,winnerTeamId:1,scheduledDate:'2026-08-21'}],bracket:{dynamic:false,nodes:[{...node('1',1,'UPPER',{teamId:1},{teamId:2}),fixtureId:10},node('2',2,'LOWER',source('1','LOSER'),{teamId:null}),node('3',3,'FINAL',source('1','WINNER'),source('2','WINNER'))]}};
(async()=>{
  for(const f of ['PLAY_IN','SINGLE_ELIMINATION','DOUBLE_ELIMINATION','GAUNTLET'])assert.equal(isBracketStage(f),true);
  for(const f of ['SWISS','ROUND_ROBIN','GROUP'])assert.equal(isBracketStage(f),false);
  const props={stage,managedTeamId:1};const view=harness('LeagueBracket.tsx',props,async()=>{throw Error('read-only component must not call API');});
  const html=await view.mount();assert.match(html,/Playoffs 대진표/);assert.match(html,/패자조/);assert.match(html,/결승/);assert.match(html,/1경기 패자/);assert.match(html,/2경기 승자/);assert.match(html,/2026-08-21/);assert.match(html,/BO5/);assert.match(html,/is-winner/);assert.match(html,/is-managed/);
  assert.equal(view.nodes().filter(n=>n.type==='article').length,3);assert.equal(view.nodes().filter(n=>n.type==='path').length,3);assert.equal(view.nodes().filter(n=>n.type==='path'&&n.props.className==='is-loser-link').length,1);
  const cards=view.nodes().filter(n=>n.type==='article');for(const c of cards){assert.ok(Number.isFinite(c.props.style.left));assert.ok(Number.isFinite(c.props.style.top));}
  props.stage={...stage,bracket:{...stage.bracket,dynamic:true}};assert.match(view.render(),/시드에 따라 대진이 확정/);
  props.stage={...stage,status:'PLANNED',bracket:{nodes:[],dynamic:false}};assert.match(view.render(),/이전 단계가 끝나면/);
  props.stage={...stage,bracket:undefined};assert.match(view.render(),/다시 불러와/);view.unmount();
  console.log('Bracket UI passed: stage routing, teams/logos, score/winner, managed highlight, solid/dashed routes, future slots, dynamic warning, planned/legacy states (SSR, not browser).');
})().catch(e=>{console.error(e);process.exitCode=1});
