const assert = require('node:assert/strict');
const { harness } = require('./check-legend-ui.cjs');
const settle = async () => { for(let i=0;i<4;i++) await new Promise(resolve => setImmediate(resolve)); };
const deferred = () => { let resolve; const promise=new Promise(yes=>{resolve=yes}); return {promise,resolve}; };
const values = Object.fromEntries(['currentMechanics','currentGameSense','currentLaning','currentTeamFight','currentMacro','currentTeamPlay','currentMental','currentChampionPool','form','condition','coachTrust'].map(key=>[key,80]));
const initial = () => ({ currentDate:'2026-01-01', cursor:'2026-01-01:0', games:0, players:[{id:7,nickname:'Player',team:'A',position:'MID',values:{...values}}] });
function setup(handler) {
  const calls=[]; let refreshed=0;
  const props={careerId:1,token:'test-token',onRefresh:async()=>{refreshed++},onBack(){}};
  const view=harness('TestAdminPanel.tsx',props,async(url,options)=>{calls.push({url,options});return handler(url,options)});
  return {view,calls,refreshed:()=>refreshed};
}
const selectPlayer=view=>{view.nodes().find(n=>n.type==='select').props.onChange({target:{value:'7'}});view.render();};
const confirm=view=>{view.nodes().find(n=>n.type==='input'&&n.props.type==='checkbox').props.onChange({target:{checked:true}});view.render();};

(async()=>{
  {
    const state=initial(); const x=setup(async(_url,o)=>o.method==='PATCH'?{}:state);
    assert.match(await x.view.mount(), /테스트 관리자/);
    assert.equal(x.view.button('11월 19일 FA 시장까지 이동').props.disabled,true);
    selectPlayer(x.view);
    const mechanics=()=>x.view.nodes().find(n=>n.type==='input'&&n.props['aria-label']==='메카닉');
    mechanics().props.onChange({target:{value:'120'}}); x.view.render();
    assert.equal(x.view.button('능력치 저장').props.disabled,true);
    x.view.button('능력치 저장').props.onClick(); await settle();
    assert.equal(x.calls.filter(c=>c.options.method==='PATCH').length,0);
    mechanics().props.onChange({target:{value:'119'}}); x.view.render();
    const save=x.view.button('능력치 저장').props.onClick; save(); save(); await settle(); x.view.render();
    const writes=x.calls.filter(c=>c.options.method==='PATCH'); assert.equal(writes.length,1);
    assert.equal(writes[0].options.body.values.currentMechanics,119);
    assert.equal(writes[0].options.body.expected.currentMechanics,80);
    assert.equal(writes[0].url,'/careers/1/test-admin/players/7');
    assert.equal(x.refreshed(),1); x.view.unmount();
  }
  {
    const state=initial(), waiting=deferred();
    const x=setup(async(_url,o)=>o.method==='POST'?waiting.promise:state);
    await x.view.mount(); confirm(x.view);
    const begin=x.view.button('11월 19일 FA 시장까지 이동').props.onClick;
    begin(); begin(); await settle(); x.view.render();
    assert.equal(x.calls.filter(c=>c.options.method==='POST').length,1);
    x.view.button('자동 진행 중단').props.onClick();
    Object.assign(state,{currentDate:'2026-01-02',cursor:'2026-01-02:0'});
    waiting.resolve({...state,done:false,stopped:false,message:'진행'}); await settle();
    assert.match(x.view.render(),/중단했습니다/);
    assert.equal(x.calls.filter(c=>c.options.method==='POST').length,1);
    assert.equal(x.refreshed(),1); x.view.unmount();
  }
  {
    const state=initial(); let steps=0;
    const x=setup(async(_url,o)=>{
      if(o.method==='POST') { steps++; assert.equal(o.body.targetDate,'2026-11-19'); Object.assign(state,{currentDate:'2026-11-19',cursor:'2026-11-19:30',games:30}); return {...state,done:true,stopped:false,message:'완료'}; }
      return state;
    });
    await x.view.mount(); confirm(x.view); x.view.button('11월 19일 FA 시장까지 이동').props.onClick(); await settle(); x.view.render();
    assert.equal(steps,1); assert.equal(x.view.button('11월 19일 FA 시장까지 이동').props.disabled,true); x.view.unmount();
  }
  {
    const state=initial(); let posts=0;
    const x=setup(async(_url,o)=>{if(o.method==='POST'){posts++;throw new Error('연결 끊김')}return state;});
    await x.view.mount(); confirm(x.view); x.view.button('11월 19일 FA 시장까지 이동').props.onClick(); await settle();
    assert.match(x.view.render(),/자동 재시도하지 않았습니다/); assert.equal(posts,1); x.view.unmount();
  }
  {
    const state=initial(), waiting=deferred(); const x=setup(async(_url,o)=>o.method==='POST'?waiting.promise:state);
    await x.view.mount(); confirm(x.view); x.view.button('11월 19일 FA 시장까지 이동').props.onClick(); await settle(); x.view.unmount();
    waiting.resolve({...state,done:false,stopped:false,message:'진행'}); await settle();
    assert.equal(x.calls.filter(c=>c.options.method==='POST').length,1);
  }
  console.log('Test admin UI passed: validation, expected values, duplicate click lock, confirmation, stop, completion, lost response and unmount (controlled handlers, not browser).');
})().catch(error=>{console.error(error);process.exitCode=1});
