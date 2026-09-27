const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const postcss=require('postcss');
const {harness}=require('./check-legend-ui.cjs');
const {loadSource}=require('./load-source.cjs');
const {swapChampion}=loadSource('champion-draft');
const helpers=loadSource('draft-preview');
const positions=helpers.DRAFT_POSITIONS;
const champions=['Ashe','Jinx','Caitlyn','Draven','Vayne','Ahri','Ornn','LeeSin','Lulu','Azir'].map((id,i)=>({id,name:id,title:'Test champion',imageUrl:`/fixture/${id}.png`,recommendedPositions:[i<5?'ADC':'MID'],roleRatings:Object.fromEntries(positions.map(p=>[p,70])),early:80,mid:80,late:90,lanePower:80,teamFight:80,scaling:80,range:80,engage:50,frontline:40,protection:40}));
const lineup=Object.fromEntries(positions.map((p,i)=>[p,champions[i].id]));
const red=Object.fromEntries(positions.map((p,i)=>[p,champions[i+5].id]));
const team=id=>({id,code:`T${id}`,name:`Team ${id}`,starters:positions.map(p=>({starterPosition:p,careerPlayer:{playerCard:{player:{nickname:`Player ${p}`}}}}))});
const assignments={BLUE:lineup,RED:red};
const actions=champions.map((c,i)=>({side:i<5?'BLUE':'RED',kind:'PICK',variantId:c.id}));
const catalog={version:1,championDataVersion:'fixture',championBalanceVersion:'prototype-1',champions,variants:[],turns:[],turnSeconds:30};
const originalWindow=global.window;
const timers=new Map();let sequence=0;
global.window={setInterval(fn){timers.set(++sequence,fn);return sequence;},clearInterval(id){timers.delete(id);},setTimeout(fn){timers.set(++sequence,fn);return sequence;},clearTimeout(id){timers.delete(id);}};
const tick=()=>[...timers.values()].forEach(fn=>fn());
function setup(overrides={},managedTeamId=1){
  const calls=[], audioProps=[];
  const live={state:{actions,deadline:Date.now()+30000},gameNumber:1,busy:false,error:'',assignments,assignmentsConfirmed:false,assignmentRevision:0,onAction:(...args)=>calls.push(['action',...args]),onLineup:(...args)=>calls.push(['lineup',...args]),onPlay:()=>calls.push(['play']),onReload(){},...overrides};
  const view=harness('ChampionDraftBoard.tsx',{catalog,blue:team(1),red:team(2),managedTeamId,matchLabel:'BO3',onClose(){},live},()=>{}, {'./draft-preview':helpers,'./champion-draft':loadSource('champion-draft'),'./DraftSoundControl':{__esModule:true,default:props=>{audioProps.push(props);return null;}}});
  return {view,calls,live,audioProps};
}
(async()=>{
  try{
    {
      const previousTurns=catalog.turns;
      catalog.turns=[{side:'BLUE',kind:'BAN'},{side:'RED',kind:'PICK'}];
      const {view,live,audioProps}=setup({state:{actions:[{side:'BLUE',kind:'BAN',variantId:'Ashe'}],deadline:Date.now()+30000}});
      await view.mount();
      assert.equal(audioProps.at(-1).confirmationKind,'BAN','sound is the saved action, not the next PICK turn');
      assert.equal(audioProps.at(-1).confirmations,1);
      live.state={...live.state,actions:[...live.state.actions,{side:'RED',kind:'PICK',variantId:'Jinx'}]};
      await view.mount();assert.equal(audioProps.at(-1).confirmationKind,'PICK');
      live.assignmentsConfirmed=true;await view.mount();assert.equal(audioProps.at(-1).confirmationKind,null,'assignment is not a new pick');
      live.error='network';await view.mount();assert.equal(audioProps.at(-1).blocked,true);
      view.unmount();catalog.turns=previousTurns;
    }
    const changed=swapChampion(lineup,'MID','Ashe');
    assert.equal(changed.MID,'Ashe');assert.equal(changed.TOP,'Caitlyn');assert.equal(lineup.TOP,'Ashe');
    assert.equal(new Set(Object.values(changed)).size,5);
    assert.deepEqual(swapChampion(lineup,'MID','not-owned'),lineup);
    {
      const {view,calls}=setup();const html=await view.mount();
      assert.match(html,/챔피언 포지션 배정/);assert.match(html,/모든 챔피언을 모든 포지션/);
      assert.equal(view.nodes().filter(n=>n.type==='select').length,5);
      assert.equal(view.nodes().filter(n=>n.type==='select')[0].props.children.length,5);
      view.nodes().find(n=>n.props['aria-label']==='MID 챔피언 배정').props.onChange({target:{value:'Ashe'}});
      view.render();view.button('배치 확정').props.onClick();
      assert.equal(calls[0][1].find(e=>e.position==='MID').championId,'Ashe');
      assert.equal(new Set(calls[0][1].map(e=>e.championId)).size,5);
      assert.equal(view.button('경기 시작'),undefined);view.unmount();
    }
    {
      const {view,calls}=setup();await view.mount();
      const row=view.nodes().find(n=>n.props.className==='champion-lineup-row');
      row.props.onDrop({preventDefault(){},dataTransfer:{getData:()=> 'Vayne'}});
      view.render();view.button('배치 확정').props.onClick();
      assert.equal(calls[0][1].find(e=>e.position==='TOP').championId,'Vayne');view.unmount();
    }
    {
      const {view,calls}=setup({state:{actions,deadline:Date.now()-1000}});await view.mount();tick();
      assert.deepEqual(calls[0],['lineup',undefined,0]);view.unmount();
      const n=calls.length;tick();assert.equal(calls.length,n);
    }
    for(const restriction of [{busy:true},{error:'network'}]){
      const {view,calls}=setup({...restriction,state:{actions,deadline:Date.now()-1000}});await view.mount();tick();assert.equal(calls.length,0);
      assert.equal(view.button('배치 확정').props.disabled,true);view.unmount();
    }
    {
      const {view,calls}=setup({assignmentsConfirmed:true});await view.mount();assert.equal(view.button('배치 확정'),undefined);
      view.button('경기 시작').props.onClick();assert.deepEqual(calls,[['play']]);
      assert.ok(view.nodes().filter(n=>n.type==='select').every(n=>n.props.disabled));view.unmount();
    }
    {
      const previousTurns=catalog.turns;catalog.turns=[{side:'BLUE',kind:'BAN'}];
      const {view,calls}=setup({state:{actions:[],deadline:Date.now()+30000,unavailable:['Ashe']},assignments:undefined});
      await view.mount();assert.equal(view.nodes().find(n=>n.props['aria-label']==='Ashe · 피어리스').props.disabled,true);
      view.nodes().find(n=>n.props['aria-label']==='Jinx').props.onClick();view.render();view.button('밴 확정').props.onClick();assert.deepEqual(calls,[['action','Jinx',0]]);
      view.nodes().find(n=>n.props['aria-label']==='챔피언 검색').props.onChange({target:{value:'Caitlyn'}});view.render();
      assert.ok(view.nodes().some(n=>n.props['aria-label']==='Caitlyn'));assert.ok(!view.nodes().some(n=>n.props['aria-label']==='Jinx'));
      view.unmount();catalog.turns=previousTurns;
    }
    {
      // All 173 tiles keep separate artwork and captions. Scroll sizing is
      // checked as a stylesheet contract below, not a browser geometry test.
      const previous={turns:catalog.turns,champions:catalog.champions};
      catalog.turns=[{side:'BLUE',kind:'BAN'}];
      catalog.champions=Array.from({length:173},(_,i)=>({...champions[0],id:`champion-${i}`,name:i===172?'레나타 글라스크':`챔피언 ${i}`}));
      const {view}=setup({state:{actions:[],deadline:Date.now()+30000,unavailable:['champion-0']},assignments:undefined});
      const html=await view.mount();
      const tiles=view.nodes().filter(n=>n.type==='button'&&n.props.className?.includes('champion-pool-card'));
      assert.equal(tiles.length,173);
      assert.equal(view.nodes().filter(n=>n.props.className==='champion-pool-art').length,173);
      assert.equal(view.nodes().filter(n=>n.props.className==='champion-pool-caption').length,173);
      assert.equal(tiles[0].props['data-status'],'피어리스');
      assert.equal(tiles[172].props.title,'레나타 글라스크 · ADC');
      const pool=view.nodes().find(n=>n.props.className==='champion-pool');
      assert.equal(pool.props.role,'region');
      assert.equal(pool.props.tabIndex,0);
      assert.match(html,/레나타 글라스크/);
      const realNow=Date.now;
      try {Date.now=()=>realNow()+1500;tick();view.render();}
      finally {Date.now=realNow;}
      assert.ok(view.nodes().find(n=>n.props.className==='champion-clock').props.children<30,'advance a displayed second');
      const unchanged=view.nodes().filter(n=>n.type==='button'&&n.props.className?.includes('champion-pool-card'));
      assert.ok(tiles.every((tile,i)=>tile===unchanged[i]),'clock ticks reuse all 173 tile elements');
      view.unmount();Object.assign(catalog,previous);
    }
    {
      const previous=catalog.turns;
      catalog.turns=[{side:'BLUE',kind:'BAN'},{side:'RED',kind:'BAN'},{side:'BLUE',kind:'PICK'},{side:'BLUE',kind:'PICK'}];
      const {view,live}=setup({state:{actions:[],deadline:Date.now()+4000},assignments:undefined});
      let html=await view.mount();
      assert.match(html,/지금 내 차례/);assert.match(html,/금지할 챔피언을 선택하세요/);
      const board=()=>view.nodes().find(n=>n.props.className==='champion-draft-board');
      assert.equal(board().props['data-turn'],'mine');assert.equal(board().props['data-urgent'],true);
      assert.equal(view.nodes().filter(n=>n.props['aria-current']==='step').length,1);
      assert.equal(view.nodes().find(n=>n.props['aria-label']==='T1 조합').props['data-active'],true);
      live.state={actions:[{side:'BLUE',kind:'BAN',variantId:'Ashe'}],deadline:Date.now()+30000};
      html=await view.mount();assert.match(html,/T2의 밴을 기다리세요/);assert.equal(board().props['data-turn'],'opponent');
      assert.equal(view.button('상대 선택 중').props.disabled,true);
      assert.equal(view.nodes().find(n=>n.props['aria-label']==='T2 조합').props['data-active'],true);
      live.state.actions=[...live.state.actions,{side:'RED',kind:'BAN',variantId:'Ahri'}];
      html=await view.mount();assert.match(html,/플레이할 챔피언을 선택하세요/);
      assert.equal(board().props['data-phase'],'PICK');
      live.state.actions=[...live.state.actions,{side:'BLUE',kind:'PICK',variantId:'Jinx'}];
      html=await view.mount();assert.match(html,/지금 내 차례/,'consecutive picks are still my turn');
      assert.equal(view.nodes().find(n=>n.props['aria-current']==='step').props.title,'4턴 · 내 팀 픽');
      live.error='network';html=await view.mount();assert.match(html,/연결 확인 필요/);assert.equal(board().props['data-turn'],'error');
      view.unmount();
      const redView=setup({state:{actions:[{side:'BLUE',kind:'BAN',variantId:'Ashe'}],deadline:Date.now()+30000},assignments:undefined},2).view;
      assert.match(await redView.mount(),/지금 내 차례/,'red-side player sees their own turn');
      assert.equal(redView.nodes().find(n=>n.props.className==='champion-draft-board').props['data-turn'],'mine');
      assert.equal(redView.nodes().find(n=>n.props['aria-label']==='T2 조합').props['data-active'],true);
      redView.unmount();catalog.turns=previous;
    }
    {
      const css=postcss.parse(fs.readFileSync(path.resolve(__dirname,'../src/ChampionDraftBoard.css'),'utf8'));
      const declaration=(selector,property)=>{
        let value;
        css.walkRules(rule=>{
          if(rule.parent.type==='root'&&rule.selectors.includes(selector))
            rule.walkDecls(property,d=>{value=d.value;});
        });
        return value;
      };
      assert.equal(declaration('.champion-draft-center.is-selecting','grid-template-rows'),'auto minmax(0, 1fr) auto');
      assert.equal(declaration('.champion-pool','overflow-y'),'auto');
      assert.equal(declaration('.champion-pool','grid-auto-rows'),'max-content');
      assert.equal(declaration('.champion-pool','align-items'),'start');
      assert.equal(declaration('.champion-draft-board .champion-pool-card','min-height'),'144px');
      assert.equal(declaration('.champion-draft-board .champion-pool-card','content-visibility'),'auto');
      assert.equal(declaration('.champion-pool-art','aspect-ratio'),'1 / 1');
      assert.equal(declaration('.champion-pool-art > img','height'),'100%');
      assert.equal(declaration('.champion-pool-caption strong','min-height'),'34px');
      assert.equal(declaration('.champion-draft-footer','flex-shrink'),'0');
      assert.equal(declaration('.champion-draft-board .champion-pool-card:disabled','opacity'),'1');
    }
    console.log('Champion draft UI passed: flex swaps, drag, five-position bijection, search, fearless, confirmation, deadline, error/busy guards, cleanup (controlled components, not browser).');
  }finally{global.window=originalWindow;}
})().catch(error=>{console.error(error);process.exitCode=1;});
