import type { Career, MatchSimulation, Position } from "./types";
import { deathSeconds, initializeProgression, progressionFrame } from "./match-spectator-progression";
export { deathSeconds } from "./match-spectator-progression";

export type Point = { x: number; y: number };
export type ReplaySide = 0 | 1;
export type Lane = "TOP" | "MID" | "BOT";
export type Scene = "LANE" | "GANK" | "OBJECTIVE" | "PICK" | "SIEGE";
export interface ReplayPlayer {
  id: number; name: string; champion: string; image: string | null;
  side: ReplaySide; position: Position; kills: number; deaths: number; assists: number; farmBonus?: number;
}
export interface ReplayEvent {
  id: number; at: number; startsAt: number;
  kind: "KILL" | "TRADE" | "TOWER" | "INHIBITOR" | "NEXUS_TOWER" | "DRAGON" | "BARON" | "NEXUS";
  scene: Scene; side: ReplaySide; point: Point; actor?: number; victim?: number;
  assists: number[]; participants: number[]; structureId?: string;
  title: string; detail: string;
  lane?: Lane; damage?: number; respawnAt?: number; deathLevel?: number; gankSide?: ReplaySide;
}
export interface VictoryPlan { code: "SIEGE" | "SPLIT" | "OBJECTIVE" | "PICK" | "COMEBACK"; label: string; primaryLane: Lane; secondaryLane: Lane }
export interface SpectatorReplay {
  key: string; demo: boolean; duration: number; set: number; winner: ReplaySide;
  teams: [string, string]; players: ReplayPlayer[]; events: ReplayEvent[];
  warning: string | null; plan: VictoryPlan;
}
export interface RiftStructure {
  id: string; side: ReplaySide; lane: Lane | null;
  kind: "TOWER" | "INHIBITOR" | "NEXUS_TOWER" | "NEXUS";
  point: Point; label: string; requires: string[]; requiresAny?: string[];
}
export const LANING_END = 15 * 60;
const POSITIONS: Position[] = ["TOP", "JUNGLE", "MID", "ADC", "SUPPORT"];
const LANE_NAMES = { TOP:"탑", MID:"미드", BOT:"바텀" };
export const MAP_SIZE = 900;
export const BASES: Point[] = [{ x: 95, y: 805 }, { x: 805, y: 95 }].map(p=>Object.freeze(p));
export const OBJECTIVE_POINTS = { BARON: {x:330,y:340}, DRAGON: {x:570,y:560} };
export const ROUTES: Record<Lane,Point[]> = {
  TOP:[BASES[0],{x:95,y:200},{x:200,y:95},BASES[1]],
  MID:[BASES[0],BASES[1]],
  BOT:[BASES[0],{x:700,y:805},{x:805,y:700},BASES[1]],
};
export const LANE_PATHS = Object.fromEntries(Object.entries(ROUTES).map(([lane,points])=>[lane,points.map((p,i)=>`${i?'L':'M'}${p.x} ${p.y}`).join(' ')])) as Record<Lane,string>;
const clamp = (n:number,a:number,b:number) => Math.max(a,Math.min(b,n));
const count = (n:number) => Number.isFinite(n)?clamp(Math.round(n),0,200):0;
const mix = (a:Point,b:Point,p:number):Point => ({x:a.x+(b.x-a.x)*p,y:a.y+(b.y-a.y)*p});
const distance = (a:Point,b:Point) => Math.hypot(a.x-b.x,a.y-b.y);
export function lanePoint(lane:Lane,progress:number):Point {
  const route=ROUTES[lane],lengths=route.slice(1).map((p,i)=>distance(route[i],p));
  let left=clamp(progress,0,1)*lengths.reduce((a,b)=>a+b,0);
  for(let i=0;i<lengths.length;i++){if(left<=lengths[i])return mix(route[i],route[i+1],left/lengths[i]);left-=lengths[i];}
  return route.at(-1)!;
}
export const LANES:Record<Position,Point> = {
  TOP:lanePoint("TOP",.5),MID:lanePoint("MID",.5),ADC:lanePoint("BOT",.5),
  SUPPORT:lanePoint("BOT",.5),JUNGLE:{x:280,y:350},
};
const positionLane=(p:Position):Lane => p==="TOP"?"TOP":p==="MID"?"MID":"BOT";
const structureId=(side:ReplaySide,lane:Lane,tier:string)=>`${side}-${lane}-${tier}`;
export const STRUCTURES:RiftStructure[] = ([0,1] as const).flatMap(side=>{
  const structures:RiftStructure[]=[];
  for(const lane of ["TOP","MID","BOT"] as const){
    const tiers=["OUTER","INNER","BASE","INHIBITOR"];
    tiers.forEach((tier,i)=>structures.push({id:structureId(side,lane,tier),side,lane,
      kind:i===3?"INHIBITOR":"TOWER",point:lanePoint(lane,side===0?[.34,.22,.115,.075][i]:1-[.34,.22,.115,.075][i]),
      label:`${LANE_NAMES[lane]} ${["1차 포탑","2차 포탑","억제기 포탑","억제기"][i]}`,
      requires:i?[structureId(side,lane,tiers[i-1])]:[]}));
  }
  for(const i of [0,1])structures.push({id:`${side}-NEXUS-TOWER-${i}`,side,lane:null,kind:"NEXUS_TOWER",
    point:{x:BASES[side].x+(side===0?40:-40)+(i===0?-12:12),y:BASES[side].y+(side===0?-32:32)+(i===0?-15:15)},
    label:`넥서스 포탑 ${i+1}`,requires:[],requiresAny:["TOP","MID","BOT"].map(l=>structureId(side,l as Lane,"INHIBITOR"))});
  structures.push({id:`${side}-NEXUS`,side,lane:null,kind:"NEXUS",point:BASES[side],label:"넥서스",
    requires:[`${side}-NEXUS-TOWER-0`,`${side}-NEXUS-TOWER-1`]});
  return structures;
});
const ready=(s:RiftStructure,destroyed:Set<string>)=>s.requires.every(id=>destroyed.has(id))&&(!s.requiresAny||s.requiresAny.some(id=>destroyed.has(id)));
function random(seed:number){let value=seed|0;return()=>{value+=0x6D2B79F5;let t=Math.imul(value^value>>>15,1|value);t^=t+Math.imul(t^t>>>7,61|t);return((t^t>>>14)>>>0)/4294967296;};}
const respawnEnd=(e:ReplayEvent)=>e.respawnAt!==undefined&&e.respawnAt>e.at?e.respawnAt:e.at+deathSeconds(18,e.at);
const aliveAt=(events:ReplayEvent[],id:number,time:number)=>!events.some(e=>e.kind==="KILL"&&e.victim===id&&time>=e.at&&time<respawnEnd(e));
function victoryPlan(players:ReplayPlayer[],winner:ReplaySide,rng:()=>number):VictoryPlan {
  const codes=["SIEGE","SPLIT","OBJECTIVE","PICK","COMEBACK"] as const;
  const code=codes[Math.floor(rng()*codes.length)];
  // Compare lane carries, not summed headcounts (ADC + support + jungle used to force BOT).
  const lanes=(["TOP","MID","BOT"] as const).map(lane=>{
    const p=players.find(p=>p.side===winner&&p.position===(lane==="BOT"?"ADC":lane));
    return {lane,score:1+Math.min(2,Math.max(0,((p?.kills??0)-(p?.deaths??0))*.15))+rng()*4};
  }).sort((a,b)=>b.score-a.score);
  const primaryLane=code==="SIEGE"?"MID":code==="SPLIT"?(rng()<.5?"TOP":"BOT"):lanes[0].lane;
  const secondaryLane=lanes.find(l=>l.lane!==primaryLane)!.lane;
  const labels={SIEGE:"미드 집중 공성",SPLIT:"사이드 스플릿 · 양쪽 압박",OBJECTIVE:"오브젝트 확보 · 라인 전환",PICK:"끊어먹기 · 빈 라인 돌파",COMEBACK:"기지 방어 · 역전 진격"};
  return {code,label:labels[code],primaryLane,secondaryLane};
}

/** This reconstructs presentation, not an authoritative combat timeline. No writes/RNG in render. */
export function buildSpectatorReplay(game: MatchSimulation, career: Career): SpectatorReplay | null {
  if (game.teams?.length !== 2 || game.teams.some(t=>!t.playerStats?.length)) return null;
  const ordered = [...game.teams].sort((a,b) => game.draft ? Number(b.teamId===game.draft.blue.id)-Number(a.teamId===game.draft.blue.id) : 0);
  if (!ordered.some(t=>t.teamId===game.winnerTeamId)) return null;
  const names = new Map(career.teams.flatMap(t=>[...(t.starters??[]),...(t.benches??[])].map(s=>[s.careerPlayer.id,s.careerPlayer])));
  const players: ReplayPlayer[] = ordered.flatMap((team, side) => team.playerStats.map(p=> {
    const person=names.get(p.careerPlayerId);
    const champId=game.draft?.assignments?.[side===0?"BLUE":"RED"]?.[p.position];
    const pick=game.draft?.actions.find(a=>a.kind==="PICK" && a.variantId===champId);
    return {id:p.careerPlayerId,name:person?.playerCard.player.nickname??`선수 ${p.careerPlayerId}`,
      champion:pick?.championName??p.position,image:pick?.championImageUrl??person?.playerCard.imageUrl??null,
      side:side as ReplaySide,position:p.position,kills:count(p.kills),deaths:count(p.deaths),assists:count(p.assists),farmBonus:Number.isFinite(p.csdAt15)?clamp(p.csdAt15/30,-1,1):0};
  }));
  if (new Set(players.map(p=>p.id)).size!==players.length) return null;
  const duration=Number.isFinite(game.durationMinutes)?clamp(game.durationMinutes*60,60,7200):1800;
  // Very short legacy matches do not have room for this phase model: show their normal report.
  if (duration < 18 * 60) return null;
  const winner=ordered[0].teamId===game.winnerTeamId?0:1,rng=random(game.matchId);
  const replay: SpectatorReplay={key:`match-${game.matchId}`,demo:false,duration,set:game.seriesGameNumber??1,
    winner,teams:[ordered[0].teamCode,ordered[1].teamCode],players,events:[],warning:null,plan:victoryPlan(players,winner,rng)};
  populate(replay,rng);
  return replay;
}


function populate(replay:SpectatorReplay,rng:()=>number) {
  const {players,duration,winner}=replay,loser=(1-winner) as ReplaySide;
  const events:ReplayEvent[]=[];
  const siegeStart=Math.max(LANING_END+40,duration-(replay.plan.code==="COMEBACK"?280:420+rng()*180));
  const winningLane=replay.plan.primaryLane;
  const chain=["OUTER","INNER","BASE","INHIBITOR"].map(t=>STRUCTURES.find(s=>s.id===structureId(loser,winningLane,t))!)
    .concat(STRUCTURES.filter(s=>s.side===loser&&s.lane===null));
  if(replay.plan.code==="SPLIT"||replay.plan.code==="OBJECTIVE")chain.splice(1,0,...["OUTER","INNER"].map(t=>STRUCTURES.find(s=>s.id===structureId(loser,replay.plan.secondaryLane,t))!));
  const siegeEvents=chain.map((s,i):ReplayEvent=>{
    const at=siegeStart+(duration-siegeStart)*(i+1)/chain.length;
    const previous=siegeStart+(duration-siegeStart)*i/chain.length;
    return {id:0,at,startsAt:Math.max(previous+8,at-35),kind:s.kind,scene:"SIEGE",side:winner,point:s.point,
      assists:[],participants:players.filter(p=>s.lane===replay.plan.secondaryLane?(positionLane(p.position)===s.lane&&p.position!=="JUNGLE")||p.position==="JUNGLE":p.side===winner||i>0||positionLane(p.position)===winningLane).map(p=>p.id),structureId:s.id,lane:s.lane??winningLane,
      title:s.kind==="NEXUS"?`${replay.teams[winner]} 승리`:`${s.label} 파괴`,
      detail:s.kind==="NEXUS"?"적 넥서스 파괴 · 저장된 경기 결과":`${replay.teams[winner]} · ${LANE_NAMES[s.lane??winningLane]} 공성`};
  });
  // Discrete objectives: group only for a contest, then return to lane pressure.
  const objectives:Array<{at:number;kind:"DRAGON"|"BARON"}>=[];
  for(let at=1020+Math.floor(rng()*140);at<duration-260;at+=300+Math.floor(rng()*140))objectives.push({at,kind:"DRAGON"});
  if(replay.plan.code==="OBJECTIVE"||rng()<.5){
    let at=1350+Math.floor(rng()*350);
    while(objectives.some(e=>Math.abs(e.at-at)<150))at+=30;
    if(at<duration-180)objectives.push({at,kind:"BARON"});
  }
  for(const {at,kind} of objectives.sort((a,b)=>a.at-b.at)){
    const side=(rng()<(replay.plan.code==="COMEBACK"?.3:.65)?winner:loser) as ReplaySide;
    events.push({id:0,at,startsAt:at-55,kind,scene:"OBJECTIVE",side,
      point:OBJECTIVE_POINTS[kind],assists:[],participants:players.map(p=>p.id),
      title:kind==="BARON"?"바론 확보":"드래곤 확보",detail:`${replay.teams[side]} · 시야 확보 → 교전 → 사냥`});
  }
  const remainingKills=new Map(players.map(p=>[p.id,p.kills]));
  const remainingDeaths=new Map(players.map(p=>[p.id,p.deaths]));
  const remainingAssists=new Map(players.map(p=>[p.id,p.assists]));
  const available=new Map(players.map(p=>[p.id,0]));
  for(const side of [0,1])if(players.filter(p=>p.side===side).reduce((n,p)=>n+p.kills,0)!==players.filter(p=>p.side!==side).reduce((n,p)=>n+p.deaths,0))
    replay.warning="이전 기록의 킬·데스 합계가 달라 일부 장면만 재구성했습니다. 최종 지표는 결과창을 확인하세요.";
  const pairs=()=>players.flatMap(a=>players.filter(v=>v.side!==a.side&&(remainingKills.get(a.id)??0)>0&&(remainingDeaths.get(v.id)??0)>0).map(v=>({a,v})));
  function addKill(a:ReplayPlayer,v:ReplayPlayer,at:number,point:Point,scene:Scene){
    at=Math.ceil(at);
    const e:ReplayEvent={id:0,at,startsAt:at-12,kind:"KILL",scene,side:a.side,actor:a.id,victim:v.id,point,assists:[],participants:[a.id,v.id],
      title:`${a.name} → ${v.name}`,detail:`${replay.teams[a.side]} · ${scene==="GANK"?"정글 갱킹":scene==="LANE"?"라인 교전":scene==="OBJECTIVE"?"오브젝트 교전":scene==="SIEGE"?"공성 교전":"사이드 교전"}`};
    events.push(e);
    if(scene==="GANK"){
      e.lane=positionLane(v.position==="JUNGLE"?a.position:v.position);
      e.gankSide=a.position==="JUNGLE"?a.side:v.side;
      const ally=players.find(p=>p.side===a.side&&p.id!==a.id&&(a.position==="JUNGLE"?p.position!=="JUNGLE"&&positionLane(p.position)===e.lane:p.position==="JUNGLE")&&
        (available.get(p.id)??0)<e.startsAt-20&&(remainingAssists.get(p.id)??0)>0);
      if(ally){e.participants.push(ally.id);e.assists.push(ally.id);remainingAssists.set(ally.id,remainingAssists.get(ally.id)!-1);}
      if(v.position==="JUNGLE"){
        const follow=players.find(p=>p.side===v.side&&p.position!=="JUNGLE"&&positionLane(p.position)===e.lane&&(available.get(p.id)??0)<e.startsAt-20);
        if(follow)e.participants.push(follow.id);
        e.detail=`${replay.teams[a.side]} · 카운터 갱 성공`;
      }
    }
    remainingKills.set(a.id,remainingKills.get(a.id)!-1);remainingDeaths.set(v.id,remainingDeaths.get(v.id)!-1);
    available.set(a.id,at+4);available.set(v.id,at+deathSeconds(18,at)+35);
  }
  // At most a few early solo kills/ganks. Never pair unrelated laners or pull all assists.
  const total=players.reduce((n,p)=>n+p.kills,0);
  for(let i=0;i<Math.min(6,Math.floor(total*.2));i++){
    const at=240+i*105+Math.floor(rng()*30);
    const candidates=pairs().filter(({a,v})=>(available.get(a.id)??0)<=at-15&&(available.get(v.id)??0)<=at-15&&
      ((a.position!=="JUNGLE"&&v.position!=="JUNGLE"&&positionLane(a.position)===positionLane(v.position))||
        (a.position==="JUNGLE"&&v.position!=="JUNGLE"&&players.some(p=>p.side===a.side&&p.position!=="JUNGLE"&&positionLane(p.position)===positionLane(v.position)&&
          (available.get(p.id)??0)<at-32&&(remainingAssists.get(p.id)??0)>0))||
        (v.position==="JUNGLE"&&a.position!=="JUNGLE"&&players.some(p=>p.side===a.side&&p.position==="JUNGLE"&&(available.get(p.id)??0)<at-32&&(remainingAssists.get(p.id)??0)>0)&&
          players.some(p=>p.side===v.side&&p.position!=="JUNGLE"&&positionLane(p.position)===positionLane(a.position)&&(available.get(p.id)??0)<at-32))));
    if(!candidates.length)break;
    const ganks=candidates.filter(p=>p.a.position==="JUNGLE");
    const counters=candidates.filter(p=>p.v.position==="JUNGLE");
    const roll=rng(),pool=counters.length&&roll<.18?counters:ganks.length&&roll<.8?ganks:candidates;
    const {a,v}=pool[Math.floor(rng()*pool.length)];
    const lane=positionLane(v.position==="JUNGLE"?a.position:v.position);
    addKill(a,v,at,lanePoint(lane,.5),a.position==="JUNGLE"||v.position==="JUNGLE"?"GANK":"LANE");
  }
  const remaining=Array.from(remainingKills.values()).reduce((a,b)=>a+b,0);
  let last=LANING_END+50;
  for(let i=0;i<remaining;i++){
    const desired=LANING_END+60+i/Math.max(1,remaining-1)*(duration-180-LANING_END-60);
    const candidates=pairs().map(p=>({...p,at:Math.max(desired,last+3,(available.get(p.a.id)??0)+12,(available.get(p.v.id)??0)+12),
      weight:(remainingKills.get(p.a.id)??0)+(remainingDeaths.get(p.v.id)??0)+rng()})).sort((a,b)=>a.at-b.at||b.weight-a.weight);
    const selected=candidates[0];if(!selected)break;
    if(selected.at>duration-100){replay.warning??="일부 과밀한 처치 기록은 부활 시간을 지키기 위해 생략했습니다. 최종 지표는 결과창을 확인하세요.";break;}
    const {a,v,at}=selected;last=at;
    const objective=events.find(e=>(e.kind==="DRAGON"||e.kind==="BARON")&&at>=e.startsAt&&at<=e.at-5);
    const siege=at>=siegeStart?siegeEvents.find(e=>e.at>=at):undefined;
    addKill(a,v,at,siege?.point??objective?.point??lanePoint(positionLane(a.position),.5),siege?"SIEGE":objective?"OBJECTIVE":"PICK");
  }
  // Allocate assists only to living players. During laning, local roles and a small party only.
  const killEvents=events.filter(e=>e.kind==="KILL").sort((a,b)=>a.at-b.at);
  for(const player of players){
    let assistsLeft=remainingAssists.get(player.id)!;
    const eligible=killEvents.filter(e=>e.side===player.side&&e.actor!==player.id&&
      !e.assists.includes(player.id)&&!killEvents.some(k=>k.victim===player.id&&k.at<=e.at&&respawnEnd(k)+35>e.startsAt));
    const later=eligible.filter(e=>e.at>=LANING_END);
    const earlier=eligible.filter(e=>e.at<LANING_END);
    // Favor later fights so aggregate assists cannot turn an early solo kill into a 5-man fight.
    for(const e of [...later,...earlier]){
      if(!assistsLeft)break;
      if(e.at<LANING_END){
        const actor=players.find(p=>p.id===e.actor)!;
        const victim=players.find(p=>p.id===e.victim)!;
        const lane=positionLane(victim.position==="JUNGLE"?actor.position:victim.position);
        if(e.participants.length>=4||(player.position!=="JUNGLE"&&positionLane(player.position)!==lane))continue;
      }
      e.assists.push(player.id);e.participants.push(player.id);assistsLeft--;
    }
    if(assistsLeft)replay.warning??="일부 어시스트는 생존·라인 동선 조건 때문에 생략했습니다. 최종 지표는 결과창을 확인하세요.";
  }
  // Objective ownership cannot go to a fully dead team.
  for(const e of events.filter(e=>e.kind==="BARON"||e.kind==="DRAGON")){
    const survivors=players.filter(p=>aliveAt(killEvents,p.id,e.at));
    if(!survivors.some(p=>p.side===e.side))e.side=(1-e.side) as ReplaySide;
    // Everyone dead: omit this objective rather than award it to a nonexistent attacker.
    if(!survivors.length){events.splice(events.indexOf(e),1);continue;}
    e.participants=players.filter(p=>aliveAt(killEvents,p.id,e.startsAt)||survivors.some(s=>s.id===p.id)).map(p=>p.id);
    e.detail=`${replay.teams[e.side]} · 시야 확보 → 교전 → 사냥`;
  }
  // An ace delays the push until someone has respawned and returned. Reserve time for every
  // remaining building rather than visually awarding towers to a wiped-out team.
  let previousBuilding=siegeStart;
  for(const [i,e] of siegeEvents.entries()){
    const latest=duration-(siegeEvents.length-i-1)*8;
    let at=clamp(Math.max(e.at,previousBuilding+8),0,latest);
    const present=(time:number)=>players.some(p=>p.side===winner&&e.participants.includes(p.id)&&
      !killEvents.some(k=>k.victim===p.id&&time>=k.at&&time<respawnEnd(k)+35));
    while(at<latest&&(!present(at)||!present(at-3)))at=Math.min(latest,at+1);
    e.at=at;e.startsAt=Math.max(previousBuilding+3,at-35);previousBuilding=at;
  }
  events.push(...siegeEvents);
  // A losing club can trade an outer turret, never magically remove a back-line building.
  const trade=STRUCTURES.find(s=>s.side===winner&&s.lane!==winningLane&&s.id.endsWith("OUTER"))!;
  const tradeAt=Math.max(980,siegeStart-100);
  events.push({id:0,at:tradeAt,startsAt:tradeAt-30,kind:"TOWER",scene:"SIEGE",side:loser,point:trade.point,structureId:trade.id,
    assists:[],participants:players.filter(p=>p.side===loser&&positionLane(p.position)===trade.lane).map(p=>p.id),
    title:`${trade.label} 파괴`,detail:`${replay.teams[loser]} · 반대편 라인 교환`});
  if(replay.plan.code==="COMEBACK"){
    const inner=STRUCTURES.find(s=>s.id===trade.id.replace("OUTER","INNER"))!;
    events.push({id:0,at:tradeAt+60,startsAt:tradeAt+30,kind:"TOWER",scene:"SIEGE",side:loser,point:inner.point,structureId:inner.id,lane:inner.lane!,
      assists:[],participants:players.map(p=>p.id),title:`${inner.label} 파괴`,detail:`${replay.teams[loser]} · 깊은 진격, 수비 팀 반격 준비`});
  }
  // Non-lethal lane trades make pressure visible without inventing extra kills in saved K/D/A.
  for(const lane of ["TOP","MID","BOT"] as const){
    const laners=players.filter(p=>p.position!=="JUNGLE"&&positionLane(p.position)===lane);
    for(let at=175+Math.floor(rng()*35);at<duration-350;at+=70+Math.floor(rng()*55)){
      const participants=laners.filter(p=>aliveAt(killEvents,p.id,at)&&!events.some(e=>e.kind!=="TRADE"&&e.participants.includes(p.id)&&at>=e.startsAt-50&&at<=e.at+30));
      const a=participants.find(p=>p.side===0),v=participants.find(p=>p.side===1);
      if(!a||!v)continue;
      events.push({id:0,at,startsAt:at-8,kind:"TRADE",scene:"LANE",side:0,actor:a.id,victim:v.id,lane,point:lanePoint(lane,.5),
        assists:[],participants:participants.map(p=>p.id),damage:.10+rng()*.08,title:`${LANE_NAMES[lane]} 딜교환`,detail:"라인 압박 · 체력 교환"});
    }
  }
  replay.events=events.sort((a,b)=>a.at-b.at).map((e,i)=>({...e,id:i}));
  initializeProgression(replay);
}

/** Deliberately fictional demonstration using existing club names. Never sent to the API. */
export function createSpectatorDemo(career: Career, seed=2026): SpectatorReplay | null {
  const own=career.teams.find(t=>t.isUserControlled)??career.teams[0];
  const other=career.teams.find(t=>t.id!==own?.id && t.starters?.length===5);
  if(!own || own.starters?.length!==5 || !other) return null;
  const patterns=[[4,2,5,7,1],[2,2,3,2,1]];
  const deaths=[[2,2,2,3,1],[4,4,4,4,3]];
  const players=[own,other].flatMap((team,side)=>team.starters.map((slot,i)=>({
    id:slot.careerPlayer.id,name:slot.careerPlayer.playerCard.player.nickname,
    image:slot.careerPlayer.playerCard.imageUrl,champion:slot.starterPosition??POSITIONS[i],
    position:slot.starterPosition??POSITIONS[i],side:side as ReplaySide,
    kills:patterns[side][i],deaths:deaths[side][i],assists:side===0?8:4,
  })));
  const rng=random(seed),winner=(rng()<.5?0:1) as ReplaySide;
  const replay:SpectatorReplay={key:`demo-${own.id}-${other.id}-${seed}`,demo:true,duration:1800+Math.floor(rng()*480),set:1,winner,teams:[own.code,other.code],players,events:[],warning:null,plan:victoryPlan(players,winner,rng)};
  populate(replay,rng);
  // Demo totals describe the generated timeline, not a pre-existing authoritative match.
  for(const p of players){
    p.kills=replay.events.filter(e=>e.kind==="KILL"&&e.actor===p.id).length;
    p.deaths=replay.events.filter(e=>e.kind==="KILL"&&e.victim===p.id).length;
    p.assists=replay.events.filter(e=>e.kind==="KILL"&&e.assists.includes(p.id)).length;
  }
  replay.warning=null;return replay;
}


export function structureStates(replay:SpectatorReplay,time:number) {
  const destroyed=new Set<string>();
  for(const e of replay.events){
    if(e.at>time||!e.structureId)continue;
    const s=STRUCTURES.find(s=>s.id===e.structureId);
    if(s&&s.side!==e.side&&ready(s,destroyed)&&hasAttacker(replay,e,e.at))destroyed.add(s.id);
  }
  return STRUCTURES.map(s=>{
    const attack=replay.events.find(e=>e.structureId===s.id&&e.startsAt<=time&&time<e.at&&e.side!==s.side);
    const vulnerable=ready(s,destroyed);
    const attacking=!!attack&&vulnerable&&hasAttacker(replay,attack,time);
    const progress=attack&&vulnerable?attackProgress(replay,attack,time):0;
    return {...s,destroyed:destroyed.has(s.id),vulnerable,health:destroyed.has(s.id)?0:1-progress,attacking};
  });
}
// Only a living member of the attacking team can finish a building. Respawns must walk back.
function hasAttacker(replay:SpectatorReplay,e:ReplayEvent,time:number){
  return replay.players.some(p=>p.side===e.side&&e.participants.includes(p.id)&&
    progressionFrame(replay,p,time).recovery==="NONE"&&
    !replay.events.some(k=>k.kind==="KILL"&&k.victim===p.id&&time>=k.at&&time<respawnEnd(k)+35));
}
function attackProgress(replay:SpectatorReplay,e:ReplayEvent,time:number){
  const cuts=[e.startsAt,e.at,...replay.events.filter(k=>k.kind==="KILL"&&e.participants.includes(k.victim!))
    .flatMap(k=>[k.at,respawnEnd(k)+35]).filter(at=>at>e.startsAt&&at<e.at)].sort((a,b)=>a-b);
  let total=0,elapsed=0;
  for(let i=1;i<cuts.length;i++)if(hasAttacker(replay,e,(cuts[i-1]+cuts[i])/2)){
    total+=cuts[i]-cuts[i-1];elapsed+=Math.max(0,Math.min(time,cuts[i])-cuts[i-1]);
  }
  return total?clamp(elapsed/total,0,.999):0;
}
export function replayFinished(replay:SpectatorReplay,time:number){
  return structureStates(replay,time).some(s=>s.id===`${1-replay.winner}-NEXUS`&&s.destroyed);
}
export function replayPhase(replay:SpectatorReplay,time:number) {
  if(replayFinished(replay,time))return {code:"FINISHED",label:"넥서스 파괴 · 경기 종료"};
  if(time<110)return {code:"OPENING",label:"라인 진입 · 첫 정글 동선"};
  if(time<LANING_END)return {code:"LANING",label:"라인전 · 파밍 · 소규모 갱킹"};
  const nexusPush=replay.events.find(e=>e.structureId?.endsWith("INNER")&&e.side===replay.winner);
  if(nexusPush&&time>=nexusPush.startsAt)return {code:"SIEGE",label:"공성 · 포탑 → 억제기 → 넥서스"};
  return {code:"ROTATION",label:"라인 관리 · 오브젝트 교전"};
}
export function replayScore(replay:SpectatorReplay,time:number){
  const structures=structureStates(replay,time);
  return [0,1].map(side=>({
    kills:replay.events.filter(e=>e.at<=time&&e.kind==="KILL"&&e.side===side).length,
    towers:structures.filter(s=>s.destroyed&&s.side!==side&&(s.kind==="TOWER"||s.kind==="NEXUS_TOWER")).length,
    inhibitors:structures.filter(s=>s.destroyed&&s.side!==side&&s.kind==="INHIBITOR").length,
    dragons:replay.events.filter(e=>e.at<=time&&e.kind==="DRAGON"&&e.side===side).length,
  }));
}

function farmingPoint(replay:SpectatorReplay,player:ReplayPlayer,time:number):Point {
  if(player.position==="JUNGLE"){
    const camps=player.side===0?[{x:260,y:610},{x:230,y:360},{x:390,y:650}]:[{x:640,y:290},{x:670,y:540},{x:510,y:250}];
    const step=Math.floor(Math.max(0,time-100)/45),part=((Math.max(0,time-100)%45)/45);
    return mix(camps[step%3],camps[(step+1)%3],clamp(part*2,0,1));
  }
  const lane=positionLane(player.position);
  const progress=laneFront(replay,lane,time)+(player.side===0?-.025:.025)+Math.sin(time/28)*.012;
  const point=lanePoint(lane,progress);
  if(player.position==="SUPPORT"){point.x+=player.side===0?-17:17;point.y+=player.side===0?14:-14;}
  return point;
}
function desiredPlayerFrame(replay:SpectatorReplay,player:ReplayPlayer,time:number) {
  const past=replay.events.filter(e=>e.at<=time&&e.kind==="KILL");
  const k=past.filter(e=>e.actor===player.id).length,d=past.filter(e=>e.victim===player.id).length,a=past.filter(e=>e.assists.includes(player.id)).length;
  const death=past.findLast(e=>e.victim===player.id);
  const respawn=death?respawnEnd(death):0;
  const alive=!death||time>=respawn;
  const vitals=progressionFrame(replay,player,time);
  const offset={x:(player.side===0?-19:19)+(POSITIONS.indexOf(player.position)-2)*7,y:player.side===0?16:-16};
  let target=farmingPoint(replay,player,time);
  let state=player.position==="JUNGLE"?"정글 사냥":"라인 파밍";
  const relevant=replay.events.filter(e=>e.participants.includes(player.id));
  // Hold ground between successive buildings; do not snap back to lane centre after every tower.
  const previousSiege=relevant.findLast(e=>e.scene==="SIEGE"&&e.structureId&&e.side===replay.winner&&e.at<=time);
  if(previousSiege&&time-previousSiege.at<75){target={x:previousSiege.point.x+offset.x,y:previousSiege.point.y+offset.y};state=player.side===replay.winner?"공성 대형":"기지 방어";}
  const nearby=relevant.filter(e=>time>=e.startsAt-45&&time<=e.at+25)
    .sort((a,b)=>Number(b.startsAt<=time&&time<=b.at)-Number(a.startsAt<=time&&time<=a.at)||Math.abs(a.at-time)-Math.abs(b.at-time))[0];
  if(nearby){
    // Future macro objectives must never drag laners away before the 15-minute boundary.
    const approachSeconds=nearby.kind==="TRADE"?6:45;
    const start=nearby.scene==="OBJECTIVE"||nearby.scene==="PICK"||nearby.scene==="SIEGE"?Math.max(LANING_END,nearby.startsAt-approachSeconds):nearby.startsAt-approachSeconds;
    if(time>=start){
      const approach=clamp((time-start)/Math.max(1,nearby.startsAt-start),0,1);
      const depart=clamp((nearby.at+25-time)/25,0,1);
      target=mix(target,{x:nearby.point.x+offset.x,y:nearby.point.y+offset.y},Math.min(approach,depart));
      state=time<nearby.startsAt?"이동":nearby.kind==="TRADE"?"딜교환":nearby.scene==="SIEGE"?(player.side===nearby.side?"공성":"기지 방어"):nearby.scene==="GANK"?(player.side===nearby.gankSide?(player.position==="JUNGLE"?"갱킹":"갱 호응"):(player.position==="JUNGLE"?"역갱":"갱 방어")):"교전";
    }
  }
  if(!alive&&death){target={x:death.point.x+offset.x,y:death.point.y+offset.y};state="부활 대기";}
  else if(vitals.recovery==="FOUNTAIN"){target={...BASES[player.side]};state="우물 회복";}
  else if(vitals.recovery==="RETURN"){target=mix(BASES[player.side],target,vitals.returnProgress);state="라인 복귀";}
  else if(vitals.recovery==="RECALL"){state="귀환 중";}
  else if(death&&time-respawn<35){target=mix(BASES[player.side],target,clamp((time-respawn)/35,0,1));state="라인 복귀";}
  else if(time<110){
    target=player.position==="JUNGLE"?mix(BASES[player.side],target,time/110):lanePoint(positionLane(player.position),player.side===0?.475*time/110:1-.475*time/110);
    state="라인 진입";
  }
  if(alive){target.x+=Math.sin(time/8+player.id)*2;target.y+=Math.cos(time/10+player.id)*2;}
  return {...target,...vitals,alive,health:alive?vitals.health:0,respawnRemaining:alive?0:Math.ceil(respawn-time),maxHealth:600+85*(vitals.level-1),kills:k,deaths:d,assists:a,state};
}
// Build movement once per immutable replay/player, not on every rendered frame. A travel speed
// cap prevents target switches (lane -> pit -> tower) from teleporting champions across the map.
const movementCache=new WeakMap<SpectatorReplay,Map<number,Point[]>>();
const MOVEMENT_STEP=2;
const MOVEMENT_SPEED=12;
export function playerFrame(replay:SpectatorReplay,player:ReplayPlayer,time:number){
  let tracks=movementCache.get(replay);
  if(!tracks){tracks=new Map();movementCache.set(replay,tracks);}
  let track=tracks.get(player.id);
  if(!track){
    track=[BASES[player.side]];
    let wasAlive=true;
    for(let at=MOVEMENT_STEP;at<=replay.duration+MOVEMENT_STEP;at+=MOVEMENT_STEP){
      const target=desiredPlayerFrame(replay,player,at),previous=track.at(-1)!;
      const point=!target.alive||target.recovery==="RECALL"?previous:!wasAlive||target.recovery==="FOUNTAIN"?BASES[player.side]:mix(previous,target,Math.min(1,MOVEMENT_SPEED*MOVEMENT_STEP/Math.max(1,distance(previous,target))));
      track.push(point);wasAlive=target.alive;
    }
    tracks.set(player.id,track);
  }
  const at=clamp(time,0,replay.duration),index=Math.floor(at/MOVEMENT_STEP);
  const frame=desiredPlayerFrame(replay,player,at);
  const respawn=replay.events.findLast(e=>e.kind==="KILL"&&e.victim===player.id&&respawnEnd(e)<=at);
  const justRespawned=respawn&&at-respawnEnd(respawn)<MOVEMENT_STEP;
  // Respawn is the one intentional base relocation, never an interpolated flight across the map.
  const point=justRespawned||frame.recovery==="FOUNTAIN"?BASES[player.side]:!frame.alive||frame.recovery==="RECALL"?track[index]:mix(track[index],track[index+1]??track[index],at/MOVEMENT_STEP-index);
  return {...frame,...point};
}
function laneFront(replay:SpectatorReplay,lane:Lane,time:number){
  const pressure=replay.events.filter(e=>e.at<=time&&e.structureId?.includes(`-${lane}-`)).reduce((n,e)=>n+(e.side===0?1:-1),0);
  return clamp(.5+pressure*.085,.12,.88);
}
export function minionFrame(replay:SpectatorReplay,lane:Lane,side:ReplaySide,index:number,time:number){
  const front=laneFront(replay,lane,time);
  const age=Math.max(0,time-75-index*1.5)%40;
  const progress=side===0?Math.min(front-.008,age/35*front):Math.max(front+.008,1-age/35*(1-front));
  return {...lanePoint(lane,progress),visible:time>=75+index*1.5,fighting:age>=35,health:age<35?1:Math.max(.05,1-(age-35)/5)};
}
export function replayClock(time:number){const n=Math.max(0,Math.floor(time));return `${Math.floor(n/60).toString().padStart(2,"0")}:${(n%60).toString().padStart(2,"0")}`;}
