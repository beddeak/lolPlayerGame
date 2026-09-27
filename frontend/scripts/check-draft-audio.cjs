// Controlled audio/component checks; never emits sound or opens a browser.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {loadSource} = require('./load-source.cjs');
const {harness} = require('./check-legend-ui.cjs');
const audio = loadSource('draft-audio');
const saved = {window:global.window,document:global.document};
const listeners = new Map(), contexts = [], storage = new Map();
let denyResume=false, sampleMode='ok', fetches=0, decodes=0;
const resolveDecodes=[];
const samples=new Map([audio.DRAFT_PICK_SOUND_URL,audio.DRAFT_BAN_SOUND_URL].map(url=>{
  const bytes=fs.readFileSync(path.resolve(__dirname,'../public',url.slice(1)));
  assert.equal(bytes.toString('ascii',0,4),'OggS');
  assert.ok(bytes.length>1000&&bytes.length<100000);
  return [url,bytes];
}));
assert.ok(!samples.get(audio.DRAFT_PICK_SOUND_URL).equals(samples.get(audio.DRAFT_BAN_SOUND_URL)),'ban must have its own sample');
assert.doesNotMatch(fs.readFileSync(path.resolve(__dirname,'../src/draft-audio.ts'),'utf8'),/createOscillator|exponentialRampToValueAtTime|const NOTES/,'synth generation completely removed');
class Context {
  constructor(){this.state='suspended';this.currentTime=0;this.destination={};this.nodes=[];this.gains=[];this.listeners=new Set();contexts.push(this);}
  addEventListener(kind,fn){this.listeners.add(fn);}
  removeEventListener(kind,fn){this.listeners.delete(fn);}
  resume(){if(denyResume)return Promise.reject(Error('autoplay denied'));this.state='running';return Promise.resolve();}
  close(){this.state='closed';return Promise.resolve();}
  decodeAudioData(bytes){
    decodes++;
    const url=[...samples].find(([,sample])=>sample.length===bytes.byteLength)?.[0];
    assert.ok(url);
    if(sampleMode==='decode-error')return Promise.reject(Error('unsupported codec'));
    if(sampleMode==='pending')return new Promise(resolve=>{resolveDecodes.push(resolve);});
    return Promise.resolve({duration:2.044,url});
  }
  createOscillator(){throw Error('No synthesized sound is allowed');}
  createBufferSource(){
    const node={kind:'sample',connect(){},disconnect(){this.disconnected=true;},start(t){this.started=t;},stop(t){this.stopped=t??'now';}};
    this.nodes.push(node);return node;
  }
  createGain(){
    const node={values:[],gain:{},connect(){},disconnect(){this.disconnected=true;}};
    node.gain.setValueAtTime=v=>node.values.push(v);this.gains.push(node);return node;
  }
}
global.window={AudioContext:Context,
  fetch:async url=>{fetches++;const bytes=samples.get(url);assert.ok(bytes);return {ok:sampleMode!=='http-error'&&!(sampleMode==='ban-missing'&&url===audio.DRAFT_BAN_SOUND_URL),arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};},
  localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},
  addEventListener:(k,fn)=>listeners.set(k,fn),removeEventListener:(k,fn)=>{if(listeners.get(k)===fn)listeners.delete(k);}};
global.document={hidden:false,addEventListener:(k,fn)=>listeners.set(k,fn),removeEventListener:(k,fn)=>{if(listeners.get(k)===fn)listeners.delete(k);}};
const settle=async()=>{for(let i=0;i<3;i++)await new Promise(r=>setImmediate(r));};
const button=view=>view.nodes().find(n=>n.props.className==='draft-sound-toggle');
(async()=>{
  try {
    const engine=audio.createDraftAudio();
    assert.equal(contexts.length,0);assert.equal(engine.playPick('before-unlock'),false);assert.equal(engine.playBan('before-unlock'),false);
    assert.equal(await engine.unlock(),true);await settle();
    const first=contexts.at(-1);
    assert.equal(first.nodes.length,0,'unlock and preload are silent');
    assert.equal(fetches,2);assert.equal(decodes,2);
    assert.equal(engine.playPick('pick:1'),true);
    assert.equal(first.nodes.length,1);assert.equal(first.nodes[0].kind,'sample');
    assert.equal(first.nodes[0].buffer.url,audio.DRAFT_PICK_SOUND_URL);
    assert.deepEqual(first.gains[0].values,[0.45]);
    assert.equal(engine.playPick('pick:1'),false,'duplicate event stays silent');
    assert.equal(engine.playBan('ban:1'),true);
    assert.equal(first.nodes.at(-1).buffer.url,audio.DRAFT_BAN_SOUND_URL);
    assert.equal(engine.playBan('ban:1'),false,'duplicate ban stays silent');
    document.hidden=true;assert.equal(engine.playPick('pick:hidden'),false);assert.equal(engine.playBan('ban:hidden'),false);document.hidden=false;
    engine.stop();assert.ok(first.nodes.every(n=>n.disconnected&&n.stopped==='now'));
    engine.dispose();assert.equal(first.listeners.size,0);
    const next=audio.createDraftAudio();assert.equal(next.isRunning(),true);
    await settle();assert.equal(fetches,2,'each asset cached once between panels');assert.equal(contexts.length,1);
    assert.equal(next.playPick('pick:2'),true);const current=first.nodes.at(-1);
    next.dispose();assert.equal(current.stopped,'now');assert.equal(current.disconnected,true);
    assert.equal(engine.playPick('after-close'),false);assert.equal(engine.playBan('after-close'),false);assert.equal(await engine.unlock(),false);
    first.state='suspended';denyResume=true;
    const denied=audio.createDraftAudio();assert.equal(await denied.unlock(),false);
    assert.equal(denied.playPick('denied'),false);denied.dispose();denyResume=false;await first.close();

    for(const mode of ['decode-error','http-error']){
      sampleMode=mode;
      const missing=audio.createDraftAudio();assert.equal(await missing.unlock(),true);await settle();
      const ctx=contexts.at(-1), count=fetches;
      assert.equal(missing.playPick('missing:1'),false);assert.equal(missing.playBan('missing:2'),false);
      assert.equal(ctx.nodes.length,0,'missing/invalid audio must not fall back to synth');
      assert.equal(fetches,count,'no retry storm');
      missing.dispose();await ctx.close();
    }
    sampleMode='ban-missing';
    const partial=audio.createDraftAudio();await partial.unlock();await settle();
    assert.equal(partial.playBan('missing-ban'),false);assert.equal(partial.playPick('present-pick'),true,'a missing ban sample does not break picks');
    partial.dispose();await contexts.at(-1).close();
    sampleMode='pending';
    const loading=audio.createDraftAudio();await loading.unlock();await settle();
    const loadingContext=contexts.at(-1);
    assert.equal(loading.playPick('too-early'),false,'no test sound while loading');assert.equal(loading.playBan('too-early'),false);
    loading.dispose();resolveDecodes.forEach(resolve=>resolve({duration:2.044}));await settle();
    assert.equal(loadingContext.nodes.length,0,'late asset does not replay a missed event');
    await loadingContext.close();sampleMode='ok';

    const originalAudio=window.AudioContext;window.AudioContext=undefined;
    assert.equal(await audio.createDraftAudio().unlock(),false);window.AudioContext=originalAudio;
    const originalStorage=window.localStorage;
    window.localStorage={getItem(){throw Error('denied');},setItem(){throw Error('denied');}};
    assert.equal(audio.readDraftSoundPreference(),false);audio.saveDraftSoundPreference(true);window.localStorage=originalStorage;

    const cues=[];
    const fake={isRunning:()=>false,unlock:async()=>true,playPick:key=>cues.push(`PICK:${key}`),playBan:key=>cues.push(`BAN:${key}`),stop(){this.stops=(this.stops??0)+1;},dispose(){this.closed=true;}};
    const props={turnKey:'set:1:0:BAN',blocked:false,confirmations:0,confirmationKind:null};
    const create=(engine=fake)=>harness('DraftSoundControl.tsx',props,()=>{}, {'./draft-audio':{...audio,createDraftAudio:()=>engine}});
    const view=create();await view.mount();
    assert.equal(cues.length,0);
    button(view).props.onClick();await settle();await view.mount();
    assert.equal(button(view).props['aria-pressed'],true);
    assert.equal(storage.get(audio.DRAFT_SOUND_KEY),'on');assert.equal(cues.length,0,'enable does not play a test/preview tone');
    assert.ok(!view.nodes().some(n=>n.props.className==='draft-sound-test'));
    props.turnKey='set:1:1:BAN';await view.mount();assert.equal(cues.length,0,'turn changes alone are silent');
    props.confirmations=1;props.confirmationKind='BAN';props.blocked=true;await view.mount();
    assert.equal(cues.length,0,'no ban sound while save is pending/failed');
    props.blocked=false;await view.mount();assert.deepEqual(cues,['BAN:confirmed:set:1:1:BAN:1']);
    await view.mount();assert.equal(cues.length,1,'ban does not repeat on rerender');
    props.turnKey='set:1:2:PICK';props.confirmations=2;props.confirmationKind='PICK';props.blocked=true;
    await view.mount();assert.equal(cues.length,1,'wait for save');
    props.blocked=false;await view.mount();assert.equal(cues.at(-1),'PICK:confirmed:set:1:2:PICK:2');
    await view.mount();assert.equal(cues.length,2,'timer rerender cannot replay sound');
    props.confirmationKind=null;props.confirmations=3;await view.mount();
    assert.equal(cues.length,2,'assignment/first-selection confirmation is silent');
    button(view).props.onClick();await view.mount();
    props.confirmationKind='BAN';props.confirmations=4;await view.mount();assert.equal(cues.length,2,'muted ban is skipped');
    button(view).props.onClick();await settle();await view.mount();
    assert.equal(cues.length,2,'unmute never replays a skipped ban or preview');
    props.confirmationKind='PICK';props.confirmations=5;await view.mount();assert.equal(cues.length,3,'new actual pick is audible');
    document.hidden=true;listeners.get('visibilitychange')();assert.ok(fake.stops>0);document.hidden=false;
    view.unmount();assert.equal(fake.closed,true);assert.equal(listeners.size,0);

    storage.delete(audio.DRAFT_SOUND_KEY);
    const automatic=create();await automatic.mount();
    listeners.get('pointerdown')({target:{closest:()=>true}});await settle();await automatic.mount();
    assert.equal(button(automatic).props['aria-pressed'],false);
    listeners.get('pointerdown')({target:null});await settle();await automatic.mount();
    assert.equal(button(automatic).props['aria-pressed'],true);assert.equal(cues.length,3,'gesture unlock stays silent');automatic.unmount();
    const restored=create({...fake,isRunning:()=>true});await restored.mount();
    assert.equal(button(restored).props['aria-pressed'],true);assert.equal(cues.length,3);restored.unmount();
    let resolveUnlock;
    const pending={...fake,closed:false,unlock:()=>new Promise(resolve=>{resolveUnlock=resolve;})};
    const gone=create(pending);await gone.mount();button(gone).props.onClick();gone.unmount();resolveUnlock(true);await settle();
    assert.equal(pending.closed,true);assert.equal(cues.length,3);assert.equal(listeners.size,0);
    console.log('Draft audio passed: distinct real ban/pick samples on saved confirmations; no voices, synth, preview, turn, countdown or fallback tones; mute, caching, duplicate suppression, loading/error silence and lifecycle cleanup (mock audio; no browser).');
  } finally {global.window=saved.window;global.document=saved.document;}
})().catch(error=>{console.error(error);process.exitCode=1;});
