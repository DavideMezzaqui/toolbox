'use strict';
// Clip Joiner inside the real Electron app: make three short clips in the page
// (one with a tone), join them, play, export frame-exact, and read the MP4
// back. Nothing is saved to disk: the download is caught in the page.
const assert = require('node:assert/strict');

module.exports = async function clipsCheck({ command, evaluate, until, contexts, checks, capture }) {
  await evaluate('show("clips")');
  await until(() => evaluate('frames["clips"]?.contentDocument?.readyState==="complete" && typeof frames["clips"].contentWindow.addFiles==="function"'), 'Clip Joiner ready');
  const tree = await command('Page.getFrameTree');
  const frame = tree.frameTree.childFrames.find(f => f.frame.url.includes('/clips/')).frame.id;
  const ctx = contexts.find(c => c.auxData?.frameId === frame && c.auxData?.isDefault).id;
  const ev = x => evaluate(x, ctx);

  await ev(`window.qaErrors=[];addEventListener("error",e=>qaErrors.push(e.message));addEventListener("unhandledrejection",e=>qaErrors.push(String(e.reason)));
    HTMLAnchorElement.prototype.click=function(){ if(this.download){ window.__got={href:this.href,name:this.download}; return; } };
    window.__make=async function(name,seconds,hue,tone){
      const c=document.createElement('canvas');c.width=640;c.height=360;const g=c.getContext('2d');const s=c.captureStream(0);const vt=s.getVideoTracks()[0];let ac,o;
      if(tone){ac=new AudioContext();await ac.resume();o=ac.createOscillator();const d=ac.createMediaStreamDestination();o.connect(d);o.start();d.stream.getAudioTracks().forEach(t=>s.addTrack(t));}
      const r=new MediaRecorder(s,{mimeType:tone?'video/webm;codecs=vp8,opus':'video/webm;codecs=vp8'});const ch=[];r.ondataavailable=e=>ch.push(e.data);
      const stop=new Promise(x=>r.onstop=x);const t0=performance.now();r.start(100);
      await new Promise(res=>{(function f(){const t=(performance.now()-t0)/1000;g.fillStyle='hsl('+hue+',60%,35%)';g.fillRect(0,0,640,360);g.fillStyle='#fff';g.font='bold 90px Arial';g.fillText(name,200,200);vt.requestFrame();if(t<seconds)setTimeout(f,33);else res();})();});
      r.stop();await Promise.race([stop,new Promise(x=>setTimeout(x,3000))]);if(o){o.stop();ac.close();}
      const f=new File(ch,name+'.webm',{type:'video/webm',lastModified:hue});window.__tries=(window.__tries||0)+1;if(f.size<2000&&window.__tries<5){const again=await __make(name,seconds,hue,tone);return again;}window.__tries=0;return f;
    };1`);
  await ev(`(async()=>{window.__files=[await __make('B',1.6,140,false),await __make('A',1.8,10,true),await __make('C',1.4,220,false)];return 1})()`);
  await ev('addFiles(__files)');
  try { await until(() => ev('clips.length===3'), 'three clips added'); }
  catch (e) { throw new Error(e.message + ' ' + JSON.stringify(await ev('({n:clips.length,files:(window.__files||[]).map(f=>f.name+" "+f.size+" "+f.type),toast:document.getElementById("toast").textContent,errs:qaErrors})'))); }
  assert.deepEqual(await ev('clips.map(c=>c.name)'), ['A', 'B', 'C']);
  assert(await ev('items.every(it=>it.fadeInOn&&it.fadeOutOn)'), 'every clip opens from and closes to black by default');
  checks.push('Clip Joiner: clips join in name order with a fade through black on every cut');

  await ev('select(clips[1].id);setTab("text");[...document.querySelectorAll("#insp button")].find(b=>b.textContent==="Add text").click();clips[1].tf.z0=1.25;commit();draw();1');
  assert.equal(await ev('clips[1].texts.length'), 1);

  /* real playback in the real window: the clock must move and the picture follow */
  const t0 = await ev('(showAt(0.8),T)');
  await ev('play()');
  await new Promise(r => setTimeout(r, 900));
  const t1 = await ev('T');
  await ev('pause()');
  assert(t1 - t0 > 0.5, 'playback advanced ' + (t1 - t0).toFixed(2) + ' s in 0.9 s');
  checks.push('Clip Joiner: playback runs in the app');
  await capture('clips-preview');

  await ev('seq.preset="720p";applyPreset();seq.audio=true;commit();rebuildAll();window.__got=null;exportMP4()');
  await until(() => ev('!!window.__got && !exporting'), 'Clip Joiner export');
  const r = await ev(`(async()=>{const b=await (await fetch(__got.href)).blob();const v=document.createElement('video');v.muted=true;v.src=__got.href;
    await new Promise(x=>v.onloadedmetadata=x);let audio=false;try{const ab=await new OfflineAudioContext(2,48000,48000).decodeAudioData(await b.arrayBuffer());audio=ab.duration>0;}catch(e){}
    return {size:b.size,dur:v.duration,w:v.videoWidth,h:v.videoHeight,total,audio,name:__got.name};})()`);
  assert.equal(r.w, 1280); assert.equal(r.h, 720);
  assert(Math.abs(r.dur - r.total) < 0.1, 'duration ' + r.dur + ' vs ' + r.total);
  assert(r.audio, 'the clip with a tone gives the export a sound track');
  checks.push('Clip Joiner: frame-exact MP4 export with sound, ' + r.dur.toFixed(2) + ' s at 1280x720');

  /* The export just made is H.264 MP4: feed it back in, twice, so the second
     export goes through the front-to-back hardware decoder, not seeking. */
  await ev(`(async()=>{const blob=await (await fetch(__got.href)).blob();clips=[];sel=null;commit();rebuildAll();
    await addFiles([new File([blob],'M1.mp4',{type:'video/mp4',lastModified:1}),new File([blob],'M2.mp4',{type:'video/mp4',lastModified:2})]);
    clips[0].trans='cross';commit();rebuildAll();window.__got=null;window.__decodeStats=null;exportMP4();return 1})()`);
  await until(() => ev('!!window.__got && !exporting'), 'Clip Joiner export from MP4');
  const d = await ev(`(async()=>{const v=document.createElement('video');v.muted=true;v.src=__got.href;await new Promise(x=>v.onloadedmetadata=x);
    return {dur:v.duration,total,stats:__decodeStats};})()`);
  assert.equal(d.stats.usedDecoder, 2, 'both MP4 clips read by the decoder: ' + JSON.stringify(d.stats));
  assert.equal(d.stats.usedSeek, 0);
  assert(Math.abs(d.dur - d.total) < 0.1, 'duration ' + d.dur + ' vs ' + d.total);
  checks.push('Clip Joiner: MP4 clips are read front to back by the hardware decoder, crossfade included');
  assert.deepEqual(await ev('qaErrors'), []);
};
