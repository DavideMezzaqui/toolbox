'use strict';
// video-io (app/shared/lib/video-io.js) inside the real app, through the Clip Joiner tab.
//   (a) Clip Joiner exports a coded H.264 MP4 + two WebM clips; the exported MP4 is read back frame by frame
//   (b) FrameReader (decoder path) and the seek path return the same frames on the same MP4
//   (c) a duration-less WebM (MediaRecorder output) loads with its real duration
//   (d) frameAt on a 1080p H.264 MP4 returns the right frame, forward, backward and on jumps
// Every frame of the test video carries its own number as 12 black/white cells along the top, so "the right
// frame" is read from pixels, not guessed from timing.
// Run: APP_ROOT=<copy> TAB=clips PORT=<port> node tests/stress/run-tab.cjs tests/stress/video/t1.cjs
module.exports = async ({ ev, until, log, capture }) => {
  const R = { ok: true, notes: [] };
  const bad = m => { R.ok = false; R.notes.push(m); log('FAIL ' + m); };
  const chk = (c, m) => { if (!c) bad(m); };
  const FPS = 30, NF = 45;
  const seqN = n => Array.from({ length: n }, (_, i) => i);

  await until(() => ev('typeof addFiles==="function"'), 'Clip Joiner ready');
  await ev(String.raw`(async()=>{
    window.V = await import('../shared/lib/video-io.js');
    HTMLAnchorElement.prototype.click=function(){ if(this.download){ window.__got={href:this.href,name:this.download}; return; } };
    window.CELLS=12;
    window.paint=(g,w,h,i)=>{ g.fillStyle='rgb('+(40+(i*3)%120)+',60,'+(120-i%60)+')'; g.fillRect(0,0,w,h);
      const cw=w/CELLS; for(let b=0;b<CELLS;b++){ g.fillStyle=((i>>b)&1)?'#fff':'#000'; g.fillRect(b*cw,0,cw,h/6); }
      g.fillStyle='#fff'; g.font='bold '+Math.round(h/5)+'px Arial'; g.fillText(String(i), w*0.1, h*0.7); };
    window.readIdx=d=>{ const W=240,H=135; const c=readIdx.c||(readIdx.c=document.createElement('canvas')); c.width=W; c.height=H;
      const g=c.getContext('2d',{willReadFrequently:true}); g.drawImage(d,0,0,W,H); let idx=0; const cw=W/CELLS;
      for(let b=0;b<CELLS;b++){ const p=g.getImageData(Math.floor(b*cw+cw/2),11,1,1).data; if(p[0]>128) idx|=1<<b; } return idx; };
    window.pixels=d=>{ const W=240,H=135; const c=document.createElement('canvas'); c.width=W; c.height=H; const g=c.getContext('2d',{willReadFrequently:true}); g.drawImage(d,0,0,W,H); return g.getImageData(0,0,W,H).data; };
    window.diff=(a,b)=>{ let s=0; for(let i=0;i<a.length;i+=4){ s+=Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2]); } return s/(a.length/4*3); };
    window.mkCoded=async(name,w,h,n,fps,keyEvery)=>{ const enc=await V.Encoder.create({width:w,height:h,fps,bitrate:8e6,only:'avc',keyEvery}); const c=document.createElement('canvas'); c.width=enc.width; c.height=enc.height; const g=c.getContext('2d');
      for(let i=0;i<n;i++){ paint(g,c.width,c.height,i); await enc.addFrame(c); } await enc.flushVideo(); const out=enc.finalize(); const codec=enc.codec; enc.close();
      return {file:new File([out.blob],name,{type:'video/mp4',lastModified:7}),codec,frames:out.frames,w:enc.width,h:enc.height}; };
    window.__make=async function(name,seconds,hue,tone){
      const c=document.createElement('canvas');c.width=640;c.height=360;const g=c.getContext('2d');const s=c.captureStream(0);const vt=s.getVideoTracks()[0];let ac,o;
      if(tone){ac=new AudioContext();await ac.resume();o=ac.createOscillator();const d=ac.createMediaStreamDestination();o.connect(d);o.start();d.stream.getAudioTracks().forEach(t=>s.addTrack(t));}
      const r=new MediaRecorder(s,{mimeType:tone?'video/webm;codecs=vp8,opus':'video/webm;codecs=vp8'});const ch=[];r.ondataavailable=e=>ch.push(e.data);
      const stop=new Promise(x=>r.onstop=x);const t0=performance.now();r.start(100);
      await new Promise(res=>{(function f(){const t=(performance.now()-t0)/1000;g.fillStyle='hsl('+hue+',60%,35%)';g.fillRect(0,0,640,360);g.fillStyle='#fff';g.font='bold 90px Arial';g.fillText(name,200,200);vt.requestFrame();if(t<seconds)setTimeout(f,33);else res();})();});
      r.stop();await Promise.race([stop,new Promise(x=>setTimeout(x,3000))]);if(o){o.stop();ac.close();}
      const f=new File(ch,name+'.webm',{type:'video/webm',lastModified:hue});window.__tries=(window.__tries||0)+1;if(f.size<2000&&window.__tries<5){return await __make(name,seconds,hue,tone);}window.__tries=0;return f;
    };
    return 1; })()`);

  // ---- the coded 1080p H.264 MP4, made with the module's own Encoder
  const mk = await ev(`(async()=>{ const t0=performance.now(); const r=await mkCoded('A-coded.mp4',1920,1080,${NF},${FPS},15); window.__mp4=r.file; return {codec:r.codec,frames:r.frames,w:r.w,h:r.h,size:r.file.size,ms:Math.round(performance.now()-t0)}; })()`);
  log('Encoder:', JSON.stringify(mk));
  chk(/^avc1\./.test(mk.codec), 'the Encoder ladder picked ' + mk.codec + ' instead of H.264');
  chk(mk.frames === NF && mk.w === 1920 && mk.h === 1080, 'Encoder output ' + JSON.stringify(mk));

  // ---- (d) frameAt on the decoder path, 1080p
  const mid = k => (k + 0.5) / FPS;
  const fwd = [0, 3, 7, 14, 15, 16, 30, 44], back = [44, 29, 10, 9, 2, 0], jump = [0, 44, 20, 21, 1];
  const edge = [0, 1, 14, 15, 30, 44];
  const d = await ev(`(async()=>{
    const src=await V.loadVideo(__mp4); window.__src=src;
    const out={mode:src.mode,w:src.width,h:src.height,dur:src.duration,count:src.frameCount,fd:src.frameDur,runs:{}};
    const run=async(name,times)=>{ const got=[]; const t0=performance.now(); for(const t of times){ const f=await src.frameAt(t); got.push(readIdx(f)); } out.runs[name]={got,ms:Math.round(performance.now()-t0)}; };
    await run('fwd',${JSON.stringify(fwd.map(mid))});
    await run('back',${JSON.stringify(back.map(mid))});
    await run('jump',${JSON.stringify(jump.map(mid))});
    await run('edge',${JSON.stringify(edge.map(k => k / FPS))});
    const f=await src.frameAt(99); out.past=readIdx(f);
    const f2=await src.frameAt(-5); out.before=readIdx(f2);
    out.vf=f2.constructor.name;
    return out; })()`);
  log('(d) decoder path:', JSON.stringify(d));
  chk(d.mode === 'decoder', '1080p H.264 MP4 should take the decoder path, got ' + d.mode);
  chk(d.w === 1920 && d.h === 1080 && Math.abs(d.dur - NF / FPS) < 0.1 && d.count === NF, 'source info ' + JSON.stringify({ w: d.w, h: d.h, dur: d.dur, count: d.count }));
  chk(JSON.stringify(d.runs.fwd.got) === JSON.stringify(fwd), 'forward frames ' + d.runs.fwd.got + ' expected ' + fwd);
  chk(JSON.stringify(d.runs.back.got) === JSON.stringify(back), 'backward frames ' + d.runs.back.got + ' expected ' + back);
  chk(JSON.stringify(d.runs.jump.got) === JSON.stringify(jump), 'jumping frames ' + d.runs.jump.got + ' expected ' + jump);
  chk(JSON.stringify(d.runs.edge.got) === JSON.stringify(edge), 'frame-boundary times ' + d.runs.edge.got);
  chk(d.past === NF - 1, 'past the end gave frame ' + d.past);
  chk(d.before === 0, 'before the start gave frame ' + d.before);
  chk(d.vf === 'VideoFrame', 'decoder path drawable is ' + d.vf);

  // ---- (b) the seek path on the same MP4: same frames, similar pixels
  // The <video> seek path shows the frame NEAREST to t (the switch is at the half-frame), the decoder the one
  // whose time is <= t. They agree everywhere except at the half-frame itself, so seek tests ask a quarter in.
  const q = k => (k + 0.25) / FPS;
  const times = [...fwd.map(q), ...back.map(q), ...jump.map(q), ...edge.map(k => k / FPS)];
  const sk = await ev(`(async()=>{
    const dec=__src, seek=await V.loadVideo(__mp4,{mode:'seek'}); window.__seek=seek;
    const out={mode:seek.mode,type:null,rows:[]};
    let worst=0; const t0=performance.now();
    for(const t of ${JSON.stringify(times)}){ const a=await dec.frameAt(t); const pa=pixels(a), ia=readIdx(a); const b=await seek.frameAt(t); out.type=b.constructor.name; const pb=pixels(b), ib=readIdx(b);
      const df=diff(pa,pb); worst=Math.max(worst,df); out.rows.push([+t.toFixed(4),ia,ib,+df.toFixed(2)]); }
    out.worst=worst; out.ms=Math.round(performance.now()-t0); return out; })()`);
  log('(b) seek path vs decoder:', JSON.stringify({ mode: sk.mode, type: sk.type, worst: sk.worst, ms: sk.ms }));
  chk(sk.mode === 'seek', 'forced seek mode is ' + sk.mode);
  chk(sk.type === 'HTMLCanvasElement', 'seek path drawable is ' + sk.type);
  const mism = sk.rows.filter(r => r[1] !== r[2]);
  chk(!mism.length, 'seek path returned other frames than the decoder: ' + JSON.stringify(mism));
  chk(sk.worst < 12, 'seek and decoder pixels differ by ' + sk.worst.toFixed(2));

  // ---- the stale-frame case: step the seek path one frame at a time, forward and back, never a frame behind
  const st = await ev(`(async()=>{ const s=__seek, got=[]; for(let k=0;k<${NF};k++) got.push(readIdx(await s.frameAt((k+0.25)/${FPS})));
    const back=[]; for(let k=${NF - 1};k>=0;k--) back.push(readIdx(await s.frameAt((k+0.25)/${FPS})));
    const ping=[]; for(const k of [10,11,10,11,12,11,12,13]) ping.push(readIdx(await s.frameAt((k+0.25)/${FPS})));
    return {got,back,ping}; })()`);
  chk(JSON.stringify(st.got) === JSON.stringify(seqN(NF)), 'seek path stepping forward: ' + st.got);
  chk(JSON.stringify(st.back) === JSON.stringify(seqN(NF).reverse()), 'seek path stepping back: ' + st.back);
  chk(JSON.stringify(st.ping) === JSON.stringify([10, 11, 10, 11, 12, 11, 12, 13]), 'seek path ping-pong: ' + st.ping);
  await ev('__src.dispose(); __seek.dispose(); 1');

  // ---- (c) duration-less WebM
  await ev('(async()=>{ window.__webA=await __make("A",1.8,10,true); window.__webB=await __make("B",1.4,140,false); return 1; })()');
  const w = await ev(`(async()=>{
    const f=__webA, url=URL.createObjectURL(f);
    const raw=document.createElement('video'); raw.preload='auto'; raw.src=url; await new Promise(r=>{raw.onloadedmetadata=r; raw.onerror=r;});
    const rawDur=raw.duration; URL.revokeObjectURL(url);
    const src=await V.loadVideo(f);
    const fr=await src.frameAt(0.8); const c=document.createElement('canvas'); c.width=16; c.height=9; const g=c.getContext('2d',{willReadFrequently:true}); g.drawImage(fr,0,0,16,9); const p=g.getImageData(8,1,1,1).data;
    const o={size:f.size,rawDur:String(rawDur),dur:src.duration,mode:src.mode,w:src.width,h:src.height,px:[p[0],p[1],p[2]],fr:fr.constructor.name};
    src.dispose(); return o; })()`);
  log('(c) WebM:', JSON.stringify(w));
  chk(w.size > 2000, 'WebM recording came out empty');
  chk(Number.isFinite(w.dur) && w.dur > 1.4 && w.dur < 2.6, 'WebM duration ' + w.dur + ' (recorded 1.8 s)');
  chk(w.mode === 'seek', 'a WebM should take the seek path, got ' + w.mode);
  chk(w.w === 640 && w.h === 360, 'WebM size ' + w.w + 'x' + w.h);
  chk(w.px[0] + w.px[1] + w.px[2] > 60, 'the WebM frame is black: ' + w.px);

  // ---- (a) Clip Joiner joins [coded MP4, WebM A (tone), WebM B]; the export is read back frame by frame
  await ev('(async()=>{ await addFiles([__mp4,__webA,__webB]); return 1; })()');
  await until(() => ev('clips.length===3'), 'three clips added');
  const names = await ev('clips.map(c=>c.name)');
  chk(JSON.stringify(names) === JSON.stringify(['A-coded', 'A', 'B']), 'clip order ' + names);
  await ev('seq.preset="720p";applyPreset();seq.audio=true;seq.trans="cut";seq.firstIn=false;seq.lastOut=false;commit();rebuildAll();window.__got=null;window.__decodeStats=null;exportMP4()');
  await until(() => ev('!!window.__got && !exporting'), 'Clip Joiner export');
  const stats = await ev('__decodeStats');
  chk(stats.usedDecoder === 1 && stats.usedSeek === 2, 'decoder/seek split ' + JSON.stringify(stats));
  const a = await ev(`(async()=>{
    const b=await (await fetch(__got.href)).blob(); const f=new File([b],'export.mp4',{type:'video/mp4',lastModified:9});
    const src=await V.loadVideo(f); const idx=[]; for(let k=0;k<${NF};k++) idx.push(readIdx(await src.frameAt((k+0.5)/${FPS})));
    const lum=async t=>{ const fr=await src.frameAt(t); const c=document.createElement('canvas'); c.width=16; c.height=9; const g=c.getContext('2d',{willReadFrequently:true}); g.drawImage(fr,0,0,16,9); const p=g.getImageData(8,4,1,1).data; return p[0]+p[1]+p[2]; };
    const mA=await lum(${NF / FPS} + 0.9), mB=await lum(${NF / FPS} + 1.8 + 0.7);
    const audio=await V.decodeAudioFile(f);
    const o={size:b.size,mode:src.mode,w:src.width,h:src.height,dur:src.duration,total,idx,mA,mB,audio:audio?audio.duration:0,name:__got.name};
    src.dispose(); return o; })()`);
  log('(a) export:', JSON.stringify({ size: a.size, mode: a.mode, w: a.w, h: a.h, dur: a.dur, total: a.total, mA: a.mA, mB: a.mB, audio: a.audio, name: a.name }));
  chk(a.w === 1280 && a.h === 720, 'export size ' + a.w + 'x' + a.h);
  chk(Math.abs(a.dur - a.total) < 0.1, 'export duration ' + a.dur + ' vs timeline ' + a.total);
  chk(a.mode === 'decoder', 'the exported MP4 should be readable by the module, got ' + a.mode);
  chk(JSON.stringify(a.idx) === JSON.stringify(seqN(NF)), 'exported frames of the coded clip are not frames 0..' + (NF - 1) + ': ' + a.idx);
  chk(a.mA > 60 && a.mB > 60, 'WebM parts of the export are black: ' + a.mA + ' ' + a.mB);
  chk(a.audio > 1, 'export has a sound track of ' + a.audio + ' s');

  // ---- the Encoder keeps even sizes
  const e2 = await ev('(async()=>{ const e=await V.Encoder.create({width:641,height:361,fps:30,bitrate:2e6}); const o={w:e.width,h:e.height,ev:[V.evenSize(1081),V.evenSize(1),V.evenSize(0)]}; e.close(); return o; })()');
  chk(e2.w === 640 && e2.h === 360 && JSON.stringify(e2.ev) === '[1080,2,2]', 'even sizes ' + JSON.stringify(e2));

  await capture('video-t1-clips');
  R.d = d.runs; R.b = { worst: sk.worst, ms: sk.ms }; R.a = { dur: a.dur, total: a.total, stats };
  return R;
};
