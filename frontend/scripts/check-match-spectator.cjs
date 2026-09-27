// Deterministic data and controlled component checks, not a browser layout test.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {loadSource}=require('./load-source.cjs');
const {harness}=require('./check-legend-ui.cjs');
const helper=loadSource('match-spectator');
const positions=['TOP','JUNGLE','MID','ADC','SUPPORT'];
const career={id:1,teams:[0,1].map(side=>({id:side+1,code:side?'RED':'BLUE',isUserControlled:!side,
  starters:positions.map((position,i)=>({starterPosition:position,careerPlayer:{id:side*5+i+1,playerCard:{player:{nickname:`P${side*5+i+1}`},imageUrl:null}}})),benches:[]}))};
const game={matchId:77,seriesGameNumber:1,durationMinutes:30,winnerTeamId:1,winnerTeamCode:'BLUE',
  teams:[0,1].map(side=>({teamId:side+1,teamCode:side?'RED':'BLUE',teamKills:10,
    playerStats:positions.map((position,i)=>({careerPlayerId:side*5+i+1,position,kills:2,deaths:2,assists:4}))})),
  draft:{version:3,blue:{id:2},red:{id:1},assignments:{BLUE:Object.fromEntries(positions.map(p=>[p,`red-${p}`])),RED:Object.fromEntries(positions.map(p=>[p,`blue-${p}`]))},
    actions:['red','blue'].flatMap(side=>positions.map(p=>({kind:'PICK',variantId:`${side}-${p}`,championName:`${side} ${p}`,championImageUrl:`/champions/${side}-${p}.png`})))}
};
const before=JSON.stringify({career,game});
const geometryBefore=JSON.stringify({bases:helper.BASES,routes:helper.ROUTES,structures:helper.STRUCTURES});
const replay=helper.buildSpectatorReplay(game,career);
assert.deepEqual(replay,helper.buildSpectatorReplay(game,career),'stable on replay');
assert.deepEqual(replay.teams,['RED','BLUE'],'uses saved blue side, not series order');
assert.equal(replay.winner,1);
assert.equal(replay.players.length,10);assert.equal(replay.warning,null);
assert.equal(replay.players.find(p=>p.id===1).champion,'blue TOP');
assert.equal(replay.events.at(-1).kind,'NEXUS');assert.equal(replay.events.at(-1).at,replay.duration);
assert.ok(replay.events.every((e,i)=>e.at>=0&&e.at<=replay.duration&&(!i||replay.events[i-1].at<=e.at)));
for(const p of replay.players){
  const f=helper.playerFrame(replay,p,replay.duration);
  assert.equal(f.kills,p.kills);assert.equal(f.deaths,p.deaths);assert.equal(f.assists,p.assists);
  for(let t=0;t<=replay.duration;t+=11){const q=helper.playerFrame(replay,p,t);assert.ok(Number.isFinite(q.x)&&q.x>=0&&q.x<=helper.MAP_SIZE&&q.y>=0&&q.y<=helper.MAP_SIZE);}
}
assert.deepEqual(helper.replayScore(replay,0).map(s=>s.kills),[0,0]);
assert.deepEqual(helper.replayScore(replay,replay.duration).map(s=>s.kills),[10,10]);
assert.equal(helper.replayClock(125),'02:05');
assert.equal(JSON.stringify({career,game}),before,'never mutates saved data');
assert.equal(helper.buildSpectatorReplay({...game,teams:[]},career),null);
assert.equal(helper.buildSpectatorReplay({...game,winnerTeamId:999},career),null);
assert.equal(helper.buildSpectatorReplay({...game,draft:null},career).teams[0],'BLUE');
const mismatch=structuredClone(game);mismatch.teams[0].playerStats[0].deaths=0;
assert.match(helper.buildSpectatorReplay(mismatch,career).warning,/킬·데스/);
const demo=helper.createSpectatorDemo(career);assert.equal(demo.demo,true);assert.equal(demo.players.length,10);assert.equal(demo.warning,null);
assert.equal(helper.createSpectatorDemo({teams:[]}),null);
assert.equal(helper.buildSpectatorReplay({...game,durationMinutes:12},career),null,'short legacy games keep their ordinary report');

// Phase and participation rules: 3-minute five-player brawls must not reappear.
const lane=p=>p==='TOP'?'TOP':p==='MID'?'MID':'BOT';
function checkFlow(r){
  assert.equal(helper.replayPhase(r,180).code,'LANING');
  assert.equal(helper.replayPhase(r,899).code,'LANING');
  const kills=r.events.filter(e=>e.kind==='KILL');
  for(const e of r.events.filter(e=>e.at<900)){
    assert.ok(['KILL','TRADE'].includes(e.kind));assert.ok(['LANE','GANK'].includes(e.scene));
    assert.ok(e.participants.length<=4,'early local skirmish, not five-man collapse');
    const a=r.players.find(p=>p.id===e.actor),v=r.players.find(p=>p.id===e.victim);
    const fightLane=lane(v.position==='JUNGLE'?a.position:v.position);
    for(const id of e.participants){const p=r.players.find(p=>p.id===id);assert.ok(p.position==='JUNGLE'||lane(p.position)===fightLane,'no unrelated laner teleports into early fight');}
    if(e.scene==='GANK')assert.ok(e.participants.some(id=>{const p=r.players.find(p=>p.id===id);return p.side===e.gankSide&&p.position!=='JUNGLE'&&lane(p.position)===fightLane;}),'gank has a local laner actively following up');
    if(e.scene==='GANK')for(const id of e.participants){
      const p=r.players.find(p=>p.id===id),frame=helper.playerFrame(r,p,e.at-1);
      assert.ok(Math.hypot(frame.x-e.point.x,frame.y-e.point.y)<145,`gank participant actually reaches fight: ${id}, ${e.at}, ${r.key}`);
    }
  }
  for(const e of kills){
    for(const id of e.participants){
      const p=r.players.find(p=>p.id===id);
      assert.equal(helper.playerFrame(r,p,e.at-.001).alive,true,`dead participant ${id} at ${e.at}`);
    }
  }
  const objectives=r.events.filter(e=>['DRAGON','BARON'].includes(e.kind));
  objectives.forEach((e,i)=>{
    assert.ok(e.startsAt>=900);
    assert.ok(e.kind!=='BARON'||e.at>=1200);
    if(i)assert.ok(e.at-objectives[i-1].at>=150,'objectives have downtime');
    assert.ok(r.players.some(p=>p.side===e.side&&helper.playerFrame(r,p,e.at).alive),'a living team secures objective');
  });
  assert.equal(helper.STRUCTURES.length,30,'nine lane towers, three inhibitors, two nexus towers and a nexus per side');
  const nexus=r.events.find(e=>e.kind==='NEXUS');
  const state=helper.structureStates(r,r.duration);
  for(const s of state.filter(s=>s.destroyed)){
    assert.ok(s.requires.every(id=>state.find(other=>other.id===id).destroyed));
    assert.ok(!s.requiresAny||s.requiresAny.some(id=>state.find(other=>other.id===id).destroyed));
  }
  assert.equal(helper.replayFinished(r,nexus.at-.001),false,'no victory before nexus actually breaks');
  assert.equal(helper.replayFinished(r,r.duration),true,`normal record can complete its push: ${r.key} ${r.duration}, destroyed ${state.filter(s=>s.destroyed).map(s=>s.id)}`);
  assert.equal(helper.replayPhase(r,r.duration).code,'FINISHED');
  const push=r.events.filter(e=>e.structureId&&e.side===r.winner);
  const mainPush=push.filter(e=>!e.lane||e.lane===r.plan.primaryLane);
  assert.deepEqual(mainPush.map(e=>e.kind),['TOWER','TOWER','TOWER','INHIBITOR','NEXUS_TOWER','NEXUS_TOWER','NEXUS']);
  push.forEach((e,i)=>{if(i)assert.ok(e.startsAt>push[i-1].at,'cannot attack protected next building');});
  // No prerequisite = no nexus destruction even when the timer reaches the saved duration.
  for(const e of mainPush.slice(0,-1))assert.equal(helper.replayFinished({...r,events:r.events.filter(other=>other!==e)},r.duration),false,'all seven siege steps matter');
  // All champions dead throughout the attack: no invisible building damage.
  const wipe={...r,events:[...r.players.filter(p=>p.side===r.winner).map((p,i)=>({
    ...kills[0],id:1000+i,kind:'KILL',at:Math.floor(nexus.startsAt-1),respawnAt:r.duration+30,deathLevel:18,victim:p.id,actor:undefined,assists:[],participants:[p.id],point:nexus.point,
  })),...r.events.filter(e=>e.kind!=='KILL')]};
  wipe.events.sort((a,b)=>a.at-b.at);
  assert.equal(helper.replayFinished(wipe,r.duration),false,'dead team cannot destroy nexus');
  const atStart=helper.structureStates(r,0);
  assert.equal(atStart.filter(s=>s.vulnerable).length,6,'only six outer towers start vulnerable');
  assert.ok(atStart.every(s=>s.health===1&&!s.destroyed));
  const endSiege=push.at(-1);
  const health=[.1,.5,.9].map(part=>helper.structureStates(r,endSiege.startsAt+(endSiege.at-endSiege.startsAt)*part).find(s=>s.id===endSiege.structureId).health);
  assert.ok(health[0]>health[1]&&health[1]>health[2]&&health[2]>0,'visible damage before destruction');
}
checkFlow(replay);checkFlow(demo);
const scenarios=[];
for(const durationMinutes of [22,30,40])for(let matchId=1;matchId<=20;matchId++){
  const scenario=helper.buildSpectatorReplay({...game,durationMinutes,matchId},career);checkFlow(scenario);scenarios.push(scenario);
}
assert.equal(new Set(scenarios.map(r=>r.plan.code)).size,5,'all five victory plans occur');
assert.equal(new Set(scenarios.map(r=>r.plan.primaryLane)).size,3,'TOP/MID/BOT all finish games');
assert.ok(scenarios.some(r=>!r.events.some(e=>e.kind==='BARON')),'baron is not mandatory');
assert.ok(new Set(scenarios.flatMap(r=>r.events.filter(e=>e.kind==='BARON').map(e=>e.at))).size>=5,'baron timing varies');
assert.ok(scenarios.some(r=>new Set(r.events.filter(e=>e.kind==='TOWER'&&e.side===r.winner).map(e=>e.lane)).size>=2),'multi-lane pressure');
const ganks=scenarios.flatMap(r=>r.events.filter(e=>e.scene==='GANK'));
assert.ok(ganks.some(e=>e.gankSide===e.side)&&ganks.some(e=>e.gankSide!==e.side),'both successful ganks and counterganks, not a forced success button');
const alternate=helper.createSpectatorDemo(career,17);
assert.notDeepEqual(alternate.events,demo.events,'fresh demo seed changes the scenario');
assert.deepEqual(alternate,helper.createSpectatorDemo(career,17),'same demo seed remains repeatable');
const quiet=structuredClone(game);quiet.teams.forEach(t=>t.playerStats.forEach(p=>{p.kills=0;p.deaths=0;p.assists=0;}));
const quietReplay=helper.buildSpectatorReplay(quiet,career);checkFlow(quietReplay);assert.equal(quietReplay.warning,null);
for(const p of replay.players.filter(p=>p.position!=='JUNGLE')){
  const frame=helper.playerFrame(replay,p,180),centre=helper.lanePoint(lane(p.position),.5);
  assert.ok(Math.hypot(frame.x-centre.x,frame.y-centre.y)<85,`laners stay on own lane at 3:00: ${p.id} ${JSON.stringify({frame,centre})}`);
}
for(const p of demo.players){
  let previous=helper.playerFrame(demo,p,0);
  for(let time=1;time<=demo.duration;time++){
    const current=helper.playerFrame(demo,p,time);
    if(current.alive===previous.alive&&current.recovery!=='FOUNTAIN'&&previous.recovery!=='FOUNTAIN')assert.ok(Math.hypot(current.x-previous.x,current.y-previous.y)<=40,`movement teleport: ${p.id}, ${time}`);
    previous=current;
  }
}
// Shared square geometry: neither TOP nor BOT has a stretched or shortened route.
const length=points=>points.slice(1).reduce((sum,p,i)=>sum+Math.hypot(p.x-points[i].x,p.y-points[i].y),0);
assert.equal(length(helper.ROUTES.TOP),length(helper.ROUTES.BOT));
for(let progress=0;progress<=1;progress+=.05){
  const top=helper.lanePoint('TOP',progress),bot=helper.lanePoint('BOT',progress);
  assert.ok(Math.abs(bot.x-(helper.MAP_SIZE-top.y))<.000001&&Math.abs(bot.y-(helper.MAP_SIZE-top.x))<.000001);
}
assert.equal(helper.deathSeconds(16,1800)>helper.deathSeconds(5,1800),true);
assert.equal(helper.deathSeconds(16,2400)>helper.deathSeconds(16,900),true);
let recallSeen=false,tradeSeen=false;
for(const r of [replay,demo,alternate]){
  for(const p of r.players){
    const initial=helper.playerFrame(r,p,0),late=helper.playerFrame(r,p,r.duration);
    assert.equal(initial.level,1);assert.equal(initial.cs,0);
    assert.ok(late.cs>0&&late.level>1&&late.level<=18);
    let previous=initial;
    for(let t=1;t<=r.duration;t++){
      const frame=helper.playerFrame(r,p,t);
      assert.ok(frame.health>=0&&frame.health<=1);
      assert.ok(frame.cs>=previous.cs&&frame.level>=previous.level);
      if(!frame.alive&&!previous.alive){assert.equal(frame.cs,previous.cs);assert.equal(frame.health,0);}
      if(frame.recovery!=='NONE'&&previous.recovery!=='NONE')assert.equal(frame.cs,previous.cs,'no last-hits from fountain or recall');
      if(frame.recovery==='FOUNTAIN')recallSeen=true;
      if(frame.state==='딜교환'&&frame.health<previous.health)tradeSeen=true;
      previous=frame;
    }
  }
  for(const e of r.events.filter(e=>e.kind==='KILL')){
    const killer=r.players.find(p=>p.id===e.actor),victim=r.players.find(p=>p.id===e.victim);
    const beforeKill=helper.playerFrame(r,killer,e.at-.001),afterKill=helper.playerFrame(r,killer,e.at+1);
    assert.ok(afterKill.health<=beforeKill.health+.00001,'kill cannot reset or heal health');
    assert.ok(afterKill.health*afterKill.maxHealth<=beforeKill.health*beforeKill.maxHealth+.01,'level-up from a kill cannot heal absolute HP either');
    assert.equal(e.respawnAt-e.at,helper.deathSeconds(e.deathLevel,e.at),'level and time set death timer');
    assert.equal(helper.playerFrame(r,victim,e.at+2).alive,false);
    assert.equal(helper.playerFrame(r,victim,e.respawnAt).alive,true);
  }
}
assert.ok(recallSeen,'damaged players return to fountain to recover');
assert.ok(tradeSeen,'non-lethal lane trades change persistent HP');
assert.equal(JSON.stringify({bases:helper.BASES,routes:helper.ROUTES,structures:helper.STRUCTURES}),geometryBefore,'frame animation never mutates map coordinates');
for(const laneName of ['TOP','MID','BOT']){
  const centre=helper.lanePoint(laneName,.5);
  for(const side of [0,1]){
    assert.equal(helper.minionFrame(replay,laneName,side,0,30).visible,false);
    const wave=helper.minionFrame(replay,laneName,side,0,112);
    assert.equal(wave.fighting,true);assert.ok(Math.hypot(wave.x-centre.x,wave.y-centre.y)<20,'waves clash rather than walk through the enemy base');
  }
}

const saved={document:global.document,window:global.window,performance:global.performance};
const timers=new Map(),listeners=new Map();let now=0,next=0,closed=0;
global.document={hidden:false,body:{style:{overflow:'auto'}},addEventListener:(k,f)=>listeners.set(k,f),removeEventListener:k=>listeners.delete(k)};
global.window={setInterval:(f,ms)=>{assert.equal(ms,50);timers.set(++next,f);return next;},clearInterval:id=>timers.delete(id)};
global.performance={now:()=>now};
const view=harness('MatchSpectator.tsx',{replay,onClose:()=>closed++},()=>{throw Error('Spectator must never request game APIs');});
const tick=()=>{now+=100;[...timers.values()].forEach(f=>f());};
const input=()=>view.nodes().find(n=>n.type==='input');
(async()=>{
  try{
    const html=await view.mount();assert.match(html,/협곡 관전/);assert.match(html,/기록 기반 재구성/);assert.match(html,/BARON/);
    assert.match(html,/0–15분 라인전/);assert.equal((html.match(/data-structure=/g)||[]).length,30);
    assert.match(html,/viewBox="0 0 900 900"/);assert.match(html,/CS /);assert.match(html,/Lv\./);assert.match(html,/HP /);
    assert.equal((html.match(/class="rift-player-row"/g)||[]).length,10);
    assert.equal(document.body.style.overflow,'hidden');assert.equal(timers.size,1);
    tick();view.render();assert.equal(input().props.value,1.6);
    view.button('일시정지').props.onClick();await view.mount();assert.equal(timers.size,0);
    view.button('32×').props.onClick();await view.mount();assert.equal(timers.size,0,'speed change cannot unpause');
    view.button('재생').props.onClick();await view.mount();assert.equal(timers.size,1);
    tick();view.render();assert.ok(Math.abs(input().props.value-4.8)<1e-6);
    document.hidden=true;listeners.get('visibilitychange')();await view.mount();assert.equal(timers.size,0);
    document.hidden=false;listeners.get('visibilitychange')();await view.mount();assert.equal(timers.size,1);
    input().props.onChange({target:{value:String(replay.duration)}});await view.mount();assert.equal(timers.size,0);assert.match(view.render(),/VICTORY/);
    view.button('처음부터').props.onClick();await view.mount();assert.equal(input().props.value,0);assert.equal(timers.size,1);
    view.button('결과 바로 보기 ↗').props.onClick();assert.equal(closed,1);
    view.unmount();assert.equal(timers.size,0);assert.equal(listeners.size,0);assert.equal(document.body.style.overflow,'auto');
    const source=fs.readFileSync(path.resolve(__dirname,'../src/MatchSpectator.tsx'),'utf8');
    assert.doesNotMatch(source,/apiRequest|fetch\(|Math.random/,'view is read-only and deterministic');
    console.log('Spectator passed: 63 phase/structure scenarios, 5 plans/3 lanes, varied optional baron, gank follow-up, persistent damage/no kill heal, CS/XP/level/death timers/recall, symmetric square geometry, siege prerequisites, saved K/D/A, deterministic replay and controls (controlled rendering; no browser).');
  }finally{global.document=saved.document;global.window=saved.window;global.performance=saved.performance;}
})().catch(e=>{console.error(e);process.exitCode=1;});
