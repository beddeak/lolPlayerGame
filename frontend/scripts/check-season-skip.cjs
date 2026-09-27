const assert = require('node:assert/strict');
const { harness } = require('./check-legend-ui.cjs');
global.document = { activeElement: null, body: { style: { overflow: '' } } };
global.HTMLElement = class HTMLElement {};
const settle = async () => { for (let i=0;i<5;i++) await new Promise(r=>setImmediate(r)); };
const initial = () => ({currentDate:'2026-01-01',games:0,activities:0,cursor:'2026-01-01:0:0',splitId:3,label:'LEC Split 1',available:true,reason:null,players:[{id:7,nickname:'Player'}]});
function setup(handler) {
  const calls=[]; let refreshes=0;
  const view=harness('SeasonSkipDialog.tsx',{careerId:1,token:'token',onClose(){},onUpdated:async()=>{refreshes++}},async(url,o)=>{calls.push({url,o});return handler(url,o)});
  return {view,calls,refreshes:()=>refreshes};
}
const confirm=v=>{v.nodes().find(n=>n.type==='input').props.onChange({target:{checked:true}});v.render();};
const begin=v=>v.button('계획 확정 · 스킵 시작').props.onClick();
(async()=>{
  {
    const state=initial(); const x=setup(async(_u,o)=>o.method==='POST'?{...state,done:true,message:'플레이오프 전 정지'}:state);
    await x.view.mount(); assert.equal(document.body.style.overflow,'hidden');
    assert.equal(x.view.button('계획 확정 · 스킵 시작').props.disabled,true); begin(x.view); await settle(); assert.equal(x.calls.length,1);
    x.view.nodes().find(n=>n.props['aria-label']==='Player 개인 훈련').props.onChange({target:{value:'MECHANICS'}});
    x.view.nodes().find(n=>n.props['aria-label']==='스크림 전술').props.onChange({target:{value:'MID_CARRY'}});
    x.view.button('휴식 → 스크림').props.onClick(); x.view.render(); confirm(x.view);
    begin(x.view); begin(x.view); await settle(); x.view.render();
    const posts=x.calls.filter(c=>c.o.method==='POST'); assert.equal(posts.length,1);
    assert.deepEqual(posts[0].o.body,{cursor:state.cursor,splitId:3,startDate:state.currentDate,strategy:'MID_CARRY',pattern:['REST','SCRIM'],individuals:[{careerPlayerId:7,type:'MECHANICS'}]});
    assert.equal(x.refreshes(),1); assert.match(x.view.render(),/플레이오프 전 정지/); x.view.unmount(); assert.equal(document.body.style.overflow,'');
  }
  for(const mode of ['stop','unmount','error']) {
    let resolve; const waiting=new Promise(r=>{resolve=r}); const state=initial();
    const x=setup(async(_u,o)=>{if(o.method==='POST'){if(mode==='error')throw new Error('연결 끊김');return waiting;}return state});
    await x.view.mount(); confirm(x.view); begin(x.view); await settle(); x.view.render();
    if(mode==='stop')x.view.button('자동 진행 중단').props.onClick();
    if(mode==='unmount')x.view.unmount();
    resolve({...state,cursor:'next',done:false,stopped:false,message:'진행'}); await settle();
    assert.equal(x.calls.filter(c=>c.o.method==='POST').length,1);
    if(mode==='error')assert.match(x.view.render(),/자동 재시도하지 않았습니다/);
    if(mode==='stop')assert.match(x.view.render(),/중단했습니다/);
    if(mode!=='unmount')x.view.unmount();
  }
  {
    let gets=0; const x=setup(async()=>({...initial(),splitId:++gets===1?3:4}));
    await x.view.mount(); confirm(x.view); begin(x.view); await settle();
    assert.equal(x.calls.filter(c=>c.o.method==='POST').length,0); assert.match(x.view.render(),/대상 스플릿이 변경/); x.view.unmount();
  }
  {
    const x=setup(async()=>{throw new Error('서버 연결 실패')});
    await x.view.mount();
    assert.match(x.view.render(),/계획을 불러오지 못했습니다/);
    assert.doesNotMatch(x.view.render(),/계획 불러오는 중/);
    assert.equal(x.view.button('계획 확정 · 스킵 시작').props.disabled,true);
    assert.equal(x.calls.length,1); x.view.unmount();
  }
  {
    // The real API/App invalidates the session and unmounts this child on a JWT 401.
    const x=setup(async(_u,o)=>{
      if(o.method==='POST') { x.view.unmount(); throw new Error('Invalid or expired access token'); }
      return initial();
    });
    await x.view.mount(); confirm(x.view); begin(x.view); await settle();
    assert.equal(x.calls.filter(c=>c.o.method==='POST').length,1);
    assert.equal(x.refreshes(),0,'No refresh or next step after session invalidation unmounts the skip');
    assert.equal(document.body.style.overflow,'');
  }
  console.log('Season skip UI passed: confirmation, plan payload, duplicate clicks, stop, completion, lost response, unmount, target changes, preview failure, session invalidation (controlled handlers; not browser).');
})().catch(e=>{console.error(e);process.exitCode=1});
