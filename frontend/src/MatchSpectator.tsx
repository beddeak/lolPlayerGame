import { useEffect, useMemo, useRef, useState } from "react";
import { LANE_PATHS, MAP_SIZE, OBJECTIVE_POINTS, minionFrame, playerFrame, replayClock, replayFinished, replayPhase, replayScore, structureStates, type Lane, type SpectatorReplay } from "./match-spectator";
import "./MatchSpectator.css";

const terrain = (
  <g className="rift-terrain">
    <defs>
      <radialGradient id="rift-ground"><stop stopColor="#193a37"/><stop offset="1" stopColor="#0b1d24"/></radialGradient>
      <pattern id="rift-grid" width="45" height="45" patternUnits="userSpaceOnUse"><path d="M45 0H0V45" fill="none" stroke="#91c6b6" strokeOpacity=".035"/></pattern>
    </defs>
    <rect width={MAP_SIZE} height={MAP_SIZE} rx="24" fill="url(#rift-ground)"/>
    <rect width={MAP_SIZE} height={MAP_SIZE} rx="24" fill="url(#rift-grid)"/>
    {Object.entries(LANE_PATHS).map(([lane,d])=><g key={lane}><path d={d} fill="none" stroke="#315353" strokeWidth="57" strokeLinejoin="round"/><path d={d} fill="none" stroke="#839180" strokeOpacity=".25" strokeWidth="34" strokeLinejoin="round"/></g>)}
    <path d="M180 180C270 280 360 390 450 450S630 620 720 720" fill="none" stroke="#27606b" strokeWidth="58"/>
    <path d="M180 180C270 280 360 390 450 450S630 620 720 720" fill="none" stroke="#5495a0" strokeOpacity=".2" strokeWidth="27"/>
    {[[260,610],[230,360],[390,650],[640,290],[670,540],[510,250]].map(([x,y],i)=><g key={i} transform={`translate(${x} ${y})`}>
      <path d="M-50 20L-38-26 0-43 48-20 57 16 21 42Z" fill="#152b2c" stroke="#32514b" strokeWidth="3"/>
      <path d="M-22 5L-8-27 8-4 27-20 35 12Z" fill="#34574b"/>
      <circle r="8" cx="-5" cy="20" fill="#c39d67" opacity=".55"/>
    </g>)}
    {Object.entries(OBJECTIVE_POINTS).map(([name,point])=><g key={name}><circle cx={point.x} cy={point.y} r="35" fill="#202836" stroke="#928078" strokeWidth="3"/><text x={point.x} y={point.y+4} textAnchor="middle" fill="#e3d3b7" fontSize="11">{name}</text></g>)}
    <text x="95" y="55" className="rift-lane-label">TOP LANE</text><text x="750" y="855" className="rift-lane-label">BOT LANE</text>
    <text x="420" y="420" className="rift-lane-label">MID</text>
  </g>
);

export default function MatchSpectator({replay,onClose}: {replay:SpectatorReplay;onClose:()=>void}) {
  const dialog=useRef<HTMLDialogElement>(null);
  const [time,setTime]=useState(0);
  const [speed,setSpeed]=useState(16);
  const [playing,setPlaying]=useState(true);
  const [hidden,setHidden]=useState(()=>document.hidden);
  const ended=time>=replay.duration;
  const finished=replayFinished(replay,time);
  useEffect(()=>{
    const node=dialog.current,overflow=document.body.style.overflow;
    node?.showModal();document.body.style.overflow="hidden";
    const visibility=()=>setHidden(document.hidden);
    document.addEventListener("visibilitychange",visibility);
    return()=>{node?.close();document.body.style.overflow=overflow;document.removeEventListener("visibilitychange",visibility);};
  },[]);
  useEffect(()=>{
    if(!playing||hidden||ended)return;
    // A capped 20 Hz presentation clock. Never sends a simulation request.
    let last=performance.now();
    const timer=window.setInterval(()=>{
      const now=performance.now(),delta=Math.min(0.2,Math.max(0,(now-last)/1000));last=now;
      setTime(t=>Math.min(replay.duration,t+delta*speed));
    },50);
    return()=>window.clearInterval(timer);
  },[playing,hidden,ended,speed,replay.duration]);
  const score=replayScore(replay,time);
  const structures=structureStates(replay,time);
  const phase=replayPhase(replay,time);
  const frames=replay.players.map(p=>({player:p,frame:playerFrame(replay,p,time)}));
  const recent=replay.events.filter(e=>e.at<=time&&e.kind!=="TRADE").slice(-5).reverse();
  const highlight=recent[0]&&time-recent[0].at<35?recent[0]:null;
  const title=finished?`${replay.teams[replay.winner]} VICTORY`:highlight?.title??phase.label;
  const minions=useMemo(()=>Array.from({length:36},(_,i)=>({side:i<18?0 as const:1 as const,lane:(["TOP","MID","BOT"] as Lane[])[Math.floor(i%18/6)],offset:i%6})),[]);
  const minionUnits=minions.map(m=>({...m,...minionFrame(replay,m.lane,m.side,m.offset,time)}));
  const activeSieges=replay.events.filter(e=>e.structureId&&e.startsAt<=time&&time<e.at&&structures.some(s=>s.id===e.structureId&&s.attacking));
  const objectiveFight=replay.events.find(e=>(e.kind==="DRAGON"||e.kind==="BARON")&&e.startsAt<=time&&time<e.at);
  return <dialog ref={dialog} className="rift-dialog" aria-label="협곡 관전 시제품" onCancel={e=>{e.preventDefault();onClose();}}>
    <header className="rift-header"><div><span className="rift-eyebrow">TACTICAL VIEW · PROTOTYPE 03</span><h2>협곡 관전 <small>{replay.demo?"DEMO":`SET ${replay.set}`}</small></h2></div>
      <div className="rift-header-actions"><span className="rift-status">{finished?"경기 종료":ended?"재구성 종료":hidden?"다른 탭 · 일시정지":playing?"● 재생 중":"Ⅱ 일시정지"}</span><button type="button" onClick={onClose}>{replay.demo?"데모 닫기":"결과 바로 보기"} ↗</button></div>
    </header>
    <div className="rift-scoreboard">
      <div data-side="0"><span>BLUE SIDE</span><strong>{replay.teams[0]}</strong><b>{score[0].kills}</b></div>
      <div className="rift-score-clock"><strong>{replayClock(time)}</strong><span>{speed}× SPEED</span></div>
      <div data-side="1"><b>{score[1].kills}</b><strong>{replay.teams[1]}</strong><span>RED SIDE</span></div>
    </div>
    <div className="rift-phase" data-phase={phase.code}><strong>{phase.label}</strong><span>0–15분 라인전 <i>→</i> 오브젝트 교전 <i>→</i> 공성 · 넥서스 파괴</span></div>
    <div className="rift-plan"><b>{replay.plan.label}</b><span>주 공략 {replay.plan.primaryLane} · 전환 라인 {replay.plan.secondaryLane}</span></div>
    <div className="rift-body">
      <aside className="rift-roster" aria-label="블루팀 실시간 지표"><h3>{replay.teams[0]} <span>BLUE</span></h3>{frames.filter(p=>p.player.side===0).map(p=><PlayerRow key={p.player.id} {...p}/>)}</aside>
      <section className="rift-stage" aria-label="협곡 관전 화면">
        <div className="rift-map-wrap">
          <svg viewBox={`0 0 ${MAP_SIZE} ${MAP_SIZE}`} className="rift-map" role="img" aria-label="협곡 미니맵 · 선수 이동과 교전 장면">
            {terrain}
            {minionUnits.map((unit,i)=><g key={i} opacity={unit.visible?1:0}><rect x={unit.x-3} y={unit.y-3} width="6" height="6" rx="1" fill={unit.side===0?"#73caff":"#ff889b"} opacity={.3+unit.health*.7} stroke={unit.fighting?"#fff2b7":"none"}/>{unit.fighting&&<path d={`M${unit.x-2} ${unit.y-7}h${5*unit.health}`} stroke="#cfffe0" strokeWidth="2"/>}</g>)}
            {frames.filter(f=>f.frame.alive&&f.frame.state==="라인 파밍"&&(time+f.player.id)%4<1.4).map(f=>{
              const target=minionUnits.filter(m=>m.visible&&m.side!==f.player.side&&Math.hypot(m.x-f.frame.x,m.y-f.frame.y)<85).sort((a,b)=>Math.hypot(a.x-f.frame.x,a.y-f.frame.y)-Math.hypot(b.x-f.frame.x,b.y-f.frame.y))[0];
              return target?<line key={f.player.id} x1={f.frame.x} y1={f.frame.y} x2={target.x} y2={target.y} stroke={f.player.side===0?"#9cd9f2":"#f5abba"} strokeDasharray="3 9" strokeDashoffset={-time*12} opacity=".65"/>:null;
            })}
            {objectiveFight&&<g transform={`translate(${objectiveFight.point.x} ${objectiveFight.point.y})`}>
              <circle r="40" fill="none" stroke="#f0d297" strokeWidth="2" strokeDasharray="5 6" strokeDashoffset={-time*3}/>
              <rect x="-32" y="-49" width="64" height="5" fill="#07141e"/><rect x="-32" y="-49" width={64*(1-(time-objectiveFight.startsAt)/(objectiveFight.at-objectiveFight.startsAt))} height="5" fill="#e6cd94"/>
              <text y="-57" textAnchor="middle" fill="#ffe8b5" fontSize="10">오브젝트 교전</text>
            </g>}
            {replay.events.filter(e=>(e.kind==="TRADE"||e.kind==="KILL")&&e.startsAt<=time&&time<e.at).flatMap(e=>{
              const victim=frames.find(f=>f.player.id===e.victim);
              if(!victim?.frame.alive||victim.frame.recovery!=="NONE")return [];
              return frames.filter(f=>f.frame.alive&&f.frame.recovery==="NONE"&&e.participants.includes(f.player.id)).flatMap(f=>{
                const target=f.player.side===e.side?victim:frames.find(other=>other.player.id===e.actor);
                if(!target?.frame.alive||Math.hypot(f.frame.x-target.frame.x,f.frame.y-target.frame.y)>=155)return [];
                return [<line key={`trade-${e.id}-${f.player.id}`} x1={f.frame.x} y1={f.frame.y} x2={target.frame.x} y2={target.frame.y} stroke={f.player.side===0?"#9edfff":"#ffb3bc"} strokeWidth="2" strokeDasharray="5 10" strokeDashoffset={-time*13} opacity=".8"/>];
              });
            })}
            {structures.map(s=>{
              const color=s.side===0?"#7aceff":"#ff93a5",nexus=s.kind==="NEXUS",inhibitor=s.kind==="INHIBITOR";
              return <g key={s.id} data-structure={s.id} data-destroyed={s.destroyed} transform={`translate(${s.point.x} ${s.point.y})`} opacity={s.destroyed?.22:1}>
                <title>{`${replay.teams[s.side]} · ${s.label} · ${s.destroyed?"파괴됨":!s.vulnerable?"선행 건물 파괴 필요":`체력 ${Math.round(s.health*100)}%`}`}</title>
                <circle r={nexus?32:inhibitor?14:16} fill={s.side===0?"#123149":"#422733"} stroke={s.attacking?"#ffe6a7":color} strokeWidth={s.attacking?3:1}/>
                {s.destroyed?<path d="M-9-5L-2 2 6-3 10 8-10 8Z" fill={color}/>:<path d={nexus?"M0-25L18 0 0 25-18 0Z":inhibitor?"M0-11L10 0 0 11-10 0Z":"M-7 9V-5L0-14 7-5V9Z"} fill={color}/>}
                {!s.destroyed&&<><rect x={nexus?-28:-17} y={nexus?-42:-25} width={nexus?56:34} height="4" rx="2" fill="#06121e"/><rect x={nexus?-28:-17} y={nexus?-42:-25} width={(nexus?56:34)*s.health} height="4" rx="2" fill={s.vulnerable?color:"#879aa9"}/></>}
                {!s.destroyed&&!s.vulnerable&&<path d="M8-18V-22A3 3 0 0 1 14-22V-18M7-18H15V-12H7Z" fill="#e1e7ed" stroke="#152733" strokeWidth="1"/>}
              </g>;
            })}
            {activeSieges.flatMap(e=>frames.filter(f=>f.player.side===e.side&&f.frame.alive&&e.participants.includes(f.player.id)&&Math.hypot(f.frame.x-e.point.x,f.frame.y-e.point.y)<130).map(f=><line key={`${e.id}-${f.player.id}`} x1={f.frame.x} y1={f.frame.y} x2={e.point.x} y2={e.point.y} stroke={f.player.side===0?"#9bdbff":"#ffafbb"} strokeWidth="2" strokeDasharray="4 12" strokeDashoffset={-time*9} opacity=".7"/>))}
            {highlight&&<g className="rift-impact" data-kind={highlight.kind} transform={`translate(${highlight.point.x} ${highlight.point.y})`}>
              <circle r={20+(time-highlight.at)*1.5} fill="none" stroke={highlight.side===0?"#95d9ff":"#ffa1b4"} strokeWidth="2" opacity={Math.max(0,1-(time-highlight.at)/35)}/>
              <path d="M-22 0H22M0-22V22M-15-15L15 15M15-15L-15 15" stroke="#ffdf9a" strokeWidth="3" opacity={Math.max(0,1-(time-highlight.at)/14)}/>
            </g>}
            {highlight?.kind==="KILL"&&(()=>{const from=frames.find(f=>f.player.id===highlight.actor),to=frames.find(f=>f.player.id===highlight.victim);return from&&to?<line x1={from.frame.x} y1={from.frame.y} x2={to.frame.x} y2={to.frame.y} stroke="#ffe7ab" strokeWidth="3" strokeDasharray="5 6" opacity={Math.max(0,1-(time-highlight.at)/12)}/>:null;})()}
            {frames.map(({player,frame})=><g key={player.id} transform={`translate(${frame.x.toFixed(2)} ${frame.y.toFixed(2)})`} opacity={frame.alive?1:.3}>
              <circle r="21" fill="#0c1724" stroke={player.side===0?"#7eceff":"#ff9bac"} strokeWidth="3"/>
              {player.image?<svg x="-17" y="-17" width="34" height="34" viewBox="0 0 34 34" overflow="hidden"><image href={player.image} width="34" height="34" preserveAspectRatio="xMidYMid slice"/></svg>:<text textAnchor="middle" y="5" fill="#fff" fontSize="11">{player.position.slice(0,3)}</text>}
              <rect x="-22" y="-30" width="44" height="4" rx="2" fill="#091019"/><rect x="-22" y="-30" width={44*frame.health} height="4" rx="2" fill={player.side===0?"#8ce9c6":"#ffafb5"}/>
              <text y="37" textAnchor="middle" className="rift-player-label">{player.name}</text>
              <circle cx="-20" cy="19" r="10" fill="#112435" stroke="#d9bb82"/><text x="-20" y="23" textAnchor="middle" fill="#ffe2a0" fontSize="12">{frame.level}</text>
              {frame.recovery==="RECALL"&&<circle r="29" fill="none" stroke="#a5dfff" strokeWidth="3" strokeDasharray={`${frame.recallProgress*182} 182`} transform="rotate(-90)"/>}
              {!frame.alive&&<text y="7" textAnchor="middle" fill="white" fontSize="22">{frame.respawnRemaining}</text>}
            </g>)}
          </svg>
          <div className="rift-map-caption"><span>TACTICAL CAMERA</span><span>잠금 표시 = 선행 건물 보호</span></div>
          {finished&&<div className="rift-victory"><span>NEXUS DESTROYED</span><strong>{replay.teams[replay.winner]}</strong><b>VICTORY</b><button type="button" onClick={onClose}>{replay.demo?"데모 닫기":"경기 결과 보기"}</button></div>}
        </div>
        <div className="rift-announcement" data-side={highlight?.side??0}><span>{finished?"FULL TIME":highlight?.kind??"ON THE RIFT"}</span><strong>{title}</strong><small>{ended&&!finished?"완전한 공성 경로를 재구성하지 못했습니다. 저장된 결과는 결과창에서 확인하세요.":highlight?.detail??"라인별 파밍과 정글 동선 · 교전이 끝나면 다시 라인을 관리합니다."}</small></div>
      </section>
      <aside className="rift-roster" aria-label="레드팀 실시간 지표"><h3>{replay.teams[1]} <span>RED</span></h3>{frames.filter(p=>p.player.side===1).map(p=><PlayerRow key={p.player.id} {...p}/>)}</aside>
    </div>
    <section className="rift-bottom"><div className="rift-objectives"><span>오브젝트 연출</span>{score.map((s,side)=><div key={side}><b>{replay.teams[side]}</b><span>포탑 {s.towers} · 억제기 {s.inhibitors} · 용 {s.dragons}</span></div>)}</div>
      <div className="rift-feed" aria-label="최근 경기 장면">{recent.length?recent.map(e=><div key={e.id} data-side={e.side}><time>{replayClock(e.at)}</time><b>{e.title}</b><span>{e.kind==="KILL"?"KILL":e.kind==="NEXUS"?"FINISH":"연출"}</span></div>):<p>선수들이 협곡에 진입했습니다. 첫 교전을 기다리는 중…</p>}</div>
    </section>
    <footer className="rift-controls"><div className="rift-playback"><button type="button" disabled={ended} onClick={()=>setPlaying(v=>!v)}>{playing&&!ended?"일시정지":"재생"}</button><button type="button" onClick={()=>{setTime(0);setPlaying(true);}}>처음부터</button><div role="group" aria-label="관전 배속">{[8,16,32].map(n=><button key={n} type="button" aria-pressed={n===speed} onClick={()=>setSpeed(n)}>{n}×</button>)}</div></div>
      <label className="rift-seek"><span>{replayClock(time)}</span><input type="range" min="0" max={replay.duration} step="1" value={time} aria-label="관전 시점" onChange={e=>setTime(Number(e.target.value))}/><span>{replayClock(replay.duration)}</span></label>
      <p>{replay.demo?"미리보기 전용 가상 경기 · 새로 열면 다른 전개 · 세이브에 영향 없음":"기록 기반 재구성 · 승패/킬/데스는 저장 결과, 이동·교전·오브젝트는 연출입니다."} CS·레벨·체력은 관전용 계산이며 저장 지표가 아닙니다.{replay.warning&&` ${replay.warning}`}</p>
    </footer>
  </dialog>;
}

function PlayerRow({player,frame}: {player:SpectatorReplay["players"][number];frame:ReturnType<typeof playerFrame>}) {
  return <article className="rift-player-row" data-side={player.side} data-alive={frame.alive}>
    <div className="rift-portrait">{player.image?<img src={player.image} alt="" decoding="async" onError={e=>{e.currentTarget.hidden=true;}}/>:<span>{player.position.slice(0,3)}</span>}</div>
    <div><small>{player.position} · {player.champion}</small><strong>{player.name}</strong><b>{frame.kills} <i>/</i> {frame.deaths} <i>/</i> {frame.assists}</b><span className="rift-growth">Lv.{frame.level} · CS {frame.cs}</span><span className="rift-hp">HP {Math.round(frame.health*frame.maxHealth)} / {frame.maxHealth}</span></div>
    <span className="rift-player-state">{frame.alive?frame.state:`부활 ${frame.respawnRemaining}초`}</span>
  </article>;
}
