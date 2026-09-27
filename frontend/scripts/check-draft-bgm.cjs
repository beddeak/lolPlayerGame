// Native audio lifecycle checks only: no network, browser or real speaker output.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {harness} = require('./check-legend-ui.cjs');
const saved = {window:global.window,document:global.document};
const storage = new Map(), windowEvents = new Map(), documentEvents = new Map(), players = [];
const preference = 'lol-manager:draft-bgm:v2';
let playback = () => Promise.resolve();
const events = map => ({
  addEventListener:(event,fn)=>map.set(event,fn),
  removeEventListener:(event,fn)=>{if(map.get(event)===fn)map.delete(event);}
});
class Audio {
  constructor() {this.src='';this.currentTime=0;this.error=null;this.events=new Map();this.plays=0;this.pauses=0;this.loads=0;players.push(this);}
  play() {this.plays++;return playback();}
  pause() {this.pauses++;}
  load() {this.loads++;this.error=null;}
  removeAttribute(name) {if(name==='src')this.src='';}
  addEventListener(event,fn) {this.events.set(event,fn);}
  removeEventListener(event,fn) {if(this.events.get(event)===fn)this.events.delete(event);}
}
global.window = {Audio,localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},...events(windowEvents)};
global.document = {hidden:false,...events(documentEvents)};
const create=()=>harness('DraftBackgroundMusic.tsx',{},()=>{throw Error('BGM must not call game APIs');});
const settle=async()=>{for(let i=0;i<3;i++)await new Promise(r=>setImmediate(r));};
const toggle=view=>view.nodes().find(n=>n.props.className==='draft-bgm-toggle');
const assertClean=()=>{
  assert.equal(windowEvents.size,0);assert.equal(documentEvents.size,0);
  assert.ok(players.every(p=>p.events.size===0));
};
(async()=>{
  try {
    const view=create();await view.mount();
    const audio=players.at(-1);
    assert.equal(audio.plays,1,'automatically starts on draft entry');
    assert.equal(decodeURI(audio.src),'/audio/Prelude To Battle - The Trilogy [Champ Select(밴픽)]   LCK Music.mp3');
    const musicPath=path.resolve(__dirname,'../public',decodeURI(audio.src).slice(1));
    assert.ok(fs.statSync(musicPath).size>100000,'configured music file exists, not a missing placeholder');
    const music=fs.readFileSync(musicPath);
    assert.ok(music.toString('ascii',0,3)==='ID3'||(music[0]===0xff&&(music[1]&0xe0)===0xe0),'MP3 header');
    assert.equal(audio.loop,true);assert.equal(audio.volume,0.25);
    assert.equal(toggle(view).props['aria-pressed'],true);
    assert.equal(view.nodes().filter(n=>n.type==='iframe').length,0,'no video popup');
    assert.equal(view.nodes().filter(n=>n.type==='button').length,1,'only compact mute control');
    const instances=players.length;
    view.render();await view.mount();assert.equal(audio.plays,1);assert.equal(players.length,instances,'one player across turn rerenders');
    audio.currentTime=42;
    toggle(view).props.onClick();await view.mount();
    assert.equal(storage.get(preference),'off');assert.ok(audio.pauses>0);
    assert.equal(audio.plays,1);
    toggle(view).props.onClick();await view.mount();
    assert.equal(storage.get(preference),'on');assert.equal(audio.plays,2);
    assert.equal(audio.currentTime,42,'unmute resumes without rewinding');assert.equal(players.length,instances);
    const pauses=audio.pauses;
    document.hidden=true;documentEvents.get('visibilitychange')();
    assert.equal(audio.pauses,pauses+1);
    document.hidden=false;documentEvents.get('visibilitychange')();await settle();
    assert.equal(audio.plays,3);assert.equal(audio.currentTime,42);
    view.unmount();assert.equal(audio.src,'');assert.equal(audio.loads,1);assertClean();

    storage.set(preference,'off');
    const muted=create();await muted.mount();
    assert.equal(players.at(-1).plays,0);assert.equal(players.at(-1).src,'','saved mute does not download media');muted.unmount();assertClean();
    storage.clear();

    playback=()=>Promise.reject(Object.assign(Error('gesture needed'),{name:'NotAllowedError'}));
    const blocked=create();await blocked.mount();const blockedAudio=players.at(-1);
    assert.match(blocked.render(),/화면을 한 번 클릭/);
    windowEvents.get('pointerdown')({target:{closest:()=>true}});
    assert.equal(blockedAudio.plays,1,'mute pointer does not preempt the toggle');
    playback=()=>Promise.resolve();
    windowEvents.get('pointerdown')({target:null});await settle();
    assert.equal(blockedAudio.plays,2);assert.doesNotMatch(blocked.render(),/화면을 한 번 클릭/);
    windowEvents.get('keydown')({target:null});assert.equal(blockedAudio.plays,2,'no redundant playback after unlock');
    blocked.unmount();assertClean();

    playback=()=>Promise.reject(Object.assign(Error('missing file'),{name:'NotSupportedError'}));
    const missing=create();await missing.mount();const missingAudio=players.at(-1);
    assert.match(missing.render(),/음원 파일을 확인/);
    windowEvents.get('pointerdown')({target:null});await settle();
    assert.equal(missingAudio.plays,1,'missing media does not retry on every click');
    missingAudio.error={code:4};missingAudio.events.get('error')();
    toggle(missing).props.onClick();await missing.mount();
    playback=()=>Promise.resolve();
    toggle(missing).props.onClick();await missing.mount();
    assert.equal(missingAudio.plays,2);assert.equal(missingAudio.loads,1,'explicit unmute reloads repaired media');
    missing.unmount();assertClean();

    let resolvePlay;
    playback=()=>new Promise(resolve=>{resolvePlay=resolve;});
    const gone=create();await gone.mount();const goneAudio=players.at(-1);
    gone.unmount();resolvePlay();await settle();
    assert.equal(goneAudio.plays,1);assert.equal(goneAudio.src,'');assertClean();

    const hidden=create();document.hidden=true;await hidden.mount();
    assert.equal(players.at(-1).plays,0);
    playback=()=>Promise.resolve();
    document.hidden=false;documentEvents.get('visibilitychange')();await settle();
    assert.equal(players.at(-1).plays,1);hidden.unmount();assertClean();

    window.localStorage={getItem(){throw Error('denied');},setItem(){throw Error('denied');}};
    const denied=create();await denied.mount();assert.equal(players.at(-1).plays,1);
    toggle(denied).props.onClick();await denied.mount();assert.equal(toggle(denied).props['aria-pressed'],false);
    denied.unmount();assertClean();
    console.log('Draft BGM passed: automatic native playback, repeat/volume, mute preference, stable rerenders, hidden pause/resume, gesture retry, missing media, late close, storage denial and cleanup (mock audio; no browser or actual playback).');
  } finally {global.window=saved.window;global.document=saved.document;}
})().catch(error=>{console.error(error);process.exitCode=1;});
