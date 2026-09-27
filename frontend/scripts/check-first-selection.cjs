const assert=require('node:assert/strict');
const {harness}=require('./check-legend-ui.cjs');
const {loadSource}=require('./load-source.cjs');
const settle=async()=>{for(let i=0;i<4;i++)await new Promise(r=>setImmediate(r));};
const timers=new Map();let timerId=0;
global.window={setInterval(fn){timers.set(++timerId,fn);return timerId;},clearInterval(id){timers.delete(id);}};
global.document={body:{style:{overflow:''}}};
function Selection(){return null;} function Board(){return null;}
(async()=>{
  let selected=[];
  const props={selection:{firstSelectionTeamId:1,policy:'RANDOM',choices:[],blueTeamId:null,redTeamId:null,firstPickTeamId:null,secondPickTeamId:null},teams:[{id:1,code:'A'},{id:2,code:'B'}],managedTeamId:1,deadline:Date.now()+30000,busy:false,error:'',onChoose:c=>selected.push(c),onReload(){},onClose(){}};
  const view=harness('FirstSelectionPanel.tsx',props,async()=>{});
  assert.match(await view.mount(),/코인토스/);
  for(const name of ['블루 진영','레드 진영','선픽','후픽'])assert.equal(view.button(name).props.disabled,false);
  for(const fn of timers.values())fn();assert.deepEqual(selected,[]);
  view.button('레드 진영').props.onClick();assert.deepEqual(selected,['RED']);
  props.selection={...props.selection,choices:[{teamId:1,choice:'RED'}],blueTeamId:2,redTeamId:1};
  await view.mount();assert.equal(view.button('블루 진영'),undefined);assert.equal(view.button('선픽').props.disabled,true);
  for(const fn of timers.values())fn();assert.deepEqual(selected,['RED',undefined]);
  props.busy=true;await view.mount();for(const fn of timers.values())fn();assert.equal(selected.length,2);
  view.unmount();assert.equal(timers.size,0);
  const timeout=harness('FirstSelectionPanel.tsx',{...props,busy:false,selection:{...props.selection,choices:[],blueTeamId:null,redTeamId:null},deadline:Date.now()-1},async()=>{});
  await timeout.mount();for(const fn of timers.values())fn();assert.equal(selected.length,3);timeout.unmount();

  const series={seriesId:3,nextGameNumber:1,bestOf:3,games:[],status:'IN_PROGRESS',teams:[{teamCode:'A',wins:0},{teamCode:'B',wins:0}]};
  const state={gameNumber:1,actions:[],deadline:new Date(Date.now()+30000).toISOString(),serverNow:Date.now(),completed:false,blue:{id:1},red:{id:2},managedTeamId:1,selection:{...props.selection,choices:[],blueTeamId:null,redTeamId:null},unavailable:['TOP_TANK_A'],turns:[{side:'RED',kind:'BAN'}]};
  let count=0;
  const flow=harness('MatchFlowDialog.tsx',{career:{teams:props.teams},token:'x',flow:{series,fixturePath:'/fixture'},onClose(){}},async(url,o)=>{
    if(url==='/drafts/catalog')return {variants:[],turns:[]};
    if(url==='/match-series/3')return series;
    if(url.endsWith('/selection')){count++;assert.equal(o.body.expectedStep,0);state.selection={...state.selection,choices:[{teamId:1,choice:'FIRST_PICK'},{teamId:2,choice:'BLUE'}],blueTeamId:2,redTeamId:1,firstPickTeamId:1,secondPickTeamId:2};state.blue={id:2};state.red={id:1};}
    return structuredClone(state);
  },{'./FirstSelectionPanel':{__esModule:true,default:Selection},'./DraftBoard':{__esModule:true,default:Board},'./IntermissionPanel':{__esModule:true,default:()=>null},'./IntermissionDialog':{__esModule:true,default:()=>null}});
  await flow.mount();assert.equal(flow.nodes().filter(n=>n.type===Board).length,0);
  const choose=flow.nodes().find(n=>n.type===Selection).props.onChoose;choose('FIRST_PICK');choose('FIRST_PICK');await settle();flow.render();assert.equal(count,1);
  const board=flow.nodes().find(n=>n.type===Board).props;assert.equal(board.red.id,1);assert.equal(board.live.firstPickTeamId,1);assert.equal(board.catalog.turns[0].side,'RED');assert.deepEqual(board.live.state.unavailable,['TOP_TANK_A']);flow.unmount();
  const {choiceReason}=loadSource('draft-preview');
  assert.match(choiceReason({id:'TOP_TANK_A'}, {actions:[],unavailable:['TOP_TANK_A']},{turns:[{side:'RED',kind:'BAN'}]}),/피어리스/);
  console.log('First Selection UI passed: both dimensions, opponent controls, 30s expiry, busy guard, cleanup, draft gate, double clicks, red first-pick and fearless restrictions (controlled handlers, not browser).');
})().catch(e=>{console.error(e);process.exitCode=1});
