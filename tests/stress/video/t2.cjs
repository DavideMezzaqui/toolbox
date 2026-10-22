'use strict';
// Video Comparison page (app/video/index.html: modes Compare and Grid) inside the real app.
//   - the page runs in the real Studio host: the Compare and Grid mode frames (?embed=1&mode=compare|grid, nested in the studio
//     frame; ev() is the Compare frame), registered with the host (header title, buttons, status), plus a standalone load of the page
//   - two generated clips (an H.264 MP4 whose every frame carries its number, and a duration-less WebM): the preview is
//     not blank, scrub and play move, Export MP4 goes through video-io and is read back (duration, even size, exact frames)
//   - offset/speed, odd widths, a grid with 3 clips, drop anywhere, selected row, control ids kept
// Every frame of the numbered clips has 12 black/white cells along the top (the frame number in binary).
// Test files and helpers live in the shell page (window.fA ...), the mode frames reach them through `top`.
// Run: APP_ROOT=<copy> TAB=video PORT=<port> node tests/stress/run-tab.cjs tests/stress/video/t2.cjs
module.exports = async ({ ev, evaluate, command, until, delay, capture, reload, log }) => {
  const R = { ok: true, notes: [], t: {} };
  const bad = m => { R.ok = false; R.notes.push(m); log('FAIL ' + m); };
  const chk = (c, m) => { if (!c) bad(m); };
  const FPS = 30, NF = 60;

  // ---- 1. the Studio host restores the saved controls of the video page (toolbox.controls.video): ids must still be the same
  await until(() => ev('typeof VC==="object" && !!VC.M'), 'page ready in the Compare mode');
  const ids = await ev(`(()=>{const need=['offsetA','speedA','zoomA','rotA','panXA','panYA','offsetB','speedB','zoomB','rotB','panXB','panYB','lineW','lineWn','lineC','exportFps','bitrate',
    'gvOffset','gvSpeed','gvZoom','gvRot','gvPanX','gvPanY','gvCols','gvCellShape','gvFit','gvGap','gvPad','gvRadius','gvBorder','gvBorderColor','gvBg','gvLabels','gvLabelPos','gvLabelSize','gvLabelColor','gvOutW','gvFps','gvBitrate'];
    return need.filter(i=>!document.getElementById(i));})()`);
  chk(ids.length === 0, 'control ids missing: ' + ids);
  await ev(`(()=>{const set=(id,v)=>{const e=document.getElementById(id);e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));};
    set('lineW',9);set('exportFps',60);set('gvGap',21);set('gvCols',3);set('zoomA',3);return 1})()`);
  await delay(900);
  const saved = await ev(`JSON.parse(localStorage.getItem('toolbox.controls.video')||'{}')`);
  chk(saved.lineW === '9' && saved.exportFps === '60' && saved.gvGap === '21' && saved.gvCols === '3', 'Studio saved ' + JSON.stringify(saved).slice(0, 200));
  chk(!('zoomA' in saved), 'zoomA must stay per-file (not saved)');
  await reload();
  await until(() => ev('typeof VC==="object" && !!VC.M'), 'page ready after reload');
  const back = await ev('({lw:VC.cfg.lineW,fps:VC.cfg.fps,gap:VC.G.o.gap,cols:VC.G.o.cols,zoom:VC.sides.A.zoom,lwn:document.getElementById("lineWn").value})');
  log('restored:', JSON.stringify(back));
  chk(back.lw === 9 && back.fps === 60 && back.gap === 21 && back.cols === 3 && back.zoom === 1 && back.lwn === '9', 'restored values ' + JSON.stringify(back));
  await ev(`localStorage.removeItem('toolbox.controls.video');1`);


  // ---- 2. the page in the real mode frames of the Studio host: Compare, Grid (both ?embed=1), then standalone
  const SH = 'frames.studio.contentWindow.Studio';                       // the real Studio host
  const MF = id => `${SH}.modes.find(m=>m.id==='${id}').frame`;           // a mode's iframe, nested in the studio frame
  let cur = 'compare', W = `${MF('compare')}.contentWindow`;               // the window FE() talks to
  const FE = code => evaluate(`(async()=>{const w=${W},d=w.document,VC=w.VC,Kit=w.Kit;${code}})()`);
  const URLS = { compare: 'app://local/video/index.html?embed=1&mode=compare', grid: 'app://local/video/index.html?embed=1&mode=grid', standalone: 'app://local/video/index.html' };
  // open(kind): show the mode in Studio and load a fresh page into its frame; 'standalone' loads the page without ?embed into the Compare frame
  const open = async kind => {
    const id = kind === 'grid' ? 'grid' : 'compare';
    cur = id; W = `${MF(id)}.contentWindow`;
    await evaluate(`${SH}.show('${id}');${MF(id)}.src='${URLS[kind]}';1`);
    await delay(500);
    await until(() => evaluate(`!!(${W}.VC&&${W}.VC.M&&${W}.document.readyState==="complete")`), 'frame ' + kind, 30000);
    if (kind !== 'standalone') await until(() => evaluate(`${SH}.modes.find(m=>m.id==='${id}').state==='ready'`), 'registered ' + kind, 10000);
    await FE(`w.__errs=[];w.addEventListener('error',e=>w.__errs.push(e.message));w.addEventListener('unhandledrejection',e=>w.__errs.push(String(e.reason&&e.reason.stack||e.reason)));return 1`);
  };
  // size(w, h): the MODE frame gets w x h (what the page sees); the window is that plus the Studio rail, header and shell bar
  const size = async (w, h) => {
    for (let i = 0; i < 4; i++) {
      const c = await evaluate(`(()=>{const b=${MF(cur)}.getBoundingClientRect();return {dx:innerWidth-b.width,dy:innerHeight-b.height,w:b.width,h:b.height}})()`);
      if (Math.round(c.w) === w && Math.round(c.h) === h && i > 0) break;
      await command('Emulation.setDeviceMetricsOverride', { width: Math.round(w + c.dx), height: Math.round(h + c.dy), deviceScaleFactor: 1, mobile: false });
      await delay(200);
    }
    await delay(150);
  };
  // the host's view of the active mode: header title, buttons (label + state), status
  const HEAD = `(()=>{const H=${SH.replace('.contentWindow.Studio', '.contentDocument')};return {title:H.getElementById('title').textContent,status:H.getElementById('status').textContent,
    btns:[...H.querySelectorAll('#actions button')].map(b=>b.dataset.action+':'+b.textContent.trim()+(b.classList.contains('primary')?'*':'')+(b.disabled?'!':''))}})()`;

  // test helpers live in the shell page (clips are made there and handed to the frame: same origin)
  await evaluate(String.raw`(async()=>{
    window.V = await import('./shared/lib/video-io.js');
    HTMLAnchorElement.prototype.click=function(){ if(this.download){ window.__saved={href:this.href,name:this.download}; } };
    window.CELLS=12;
    window.paintN=(g,w,h,i,hue)=>{ g.fillStyle='hsl('+hue+',45%,'+(28+(i*5)%20)+'%)'; g.fillRect(0,0,w,h);
      const cw=w/CELLS; for(let b=0;b<CELLS;b++){ g.fillStyle=((i>>b)&1)?'#fff':'#000'; g.fillRect(b*cw,0,cw,h/6); }
      g.fillStyle='#fff'; g.font='bold '+Math.round(h/4)+'px Arial'; g.fillText(String(i), w*0.1, h*0.7); };
    // frame number from a drawable, cells over the rectangle x0,y0,w,h of it
    window.idxIn=(d,x0,y0,w,h)=>{ const c=idxIn.c||(idxIn.c=document.createElement('canvas')); c.width=1;c.height=1; const g=c.getContext('2d',{willReadFrequently:true});
      let idx=0; const cw=w/CELLS; for(let b=0;b<CELLS;b++){ g.clearRect(0,0,1,1); g.drawImage(d,Math.floor(x0+(b+0.5)*cw),Math.floor(y0+h/12),1,1,0,0,1,1); if(g.getImageData(0,0,1,1).data[0]>128) idx|=1<<b; } return idx; };
    window.mkMp4=async(name,w,h,n,base,hue)=>{ const enc=await V.Encoder.create({width:w,height:h,fps:${FPS},bitrate:6e6,only:'avc',keyEvery:15}); const c=document.createElement('canvas'); c.width=enc.width; c.height=enc.height; const g=c.getContext('2d');
      for(let i=0;i<n;i++){ paintN(g,c.width,c.height,base+i,hue); await enc.addFrame(c); } await enc.flushVideo(); const out=enc.finalize(); enc.close();
      return new File([out.blob],name,{type:'video/mp4',lastModified:7}); };
    window.mkWebm=async(name,seconds,hue,w,h)=>{
      const c=document.createElement('canvas');c.width=w;c.height=h;const g=c.getContext('2d');const s=c.captureStream(0);const vt=s.getVideoTracks()[0];
      const r=new MediaRecorder(s,{mimeType:'video/webm;codecs=vp8'});const ch=[];r.ondataavailable=e=>ch.push(e.data);
      const stop=new Promise(x=>r.onstop=x);const t0=performance.now();r.start(100);
      await new Promise(res=>{(function f(){const t=(performance.now()-t0)/1000;g.fillStyle='hsl('+hue+',60%,35%)';g.fillRect(0,0,w,h);g.fillStyle='#fff';g.font='bold '+Math.round(h/4)+'px Arial';g.fillText(name,w*0.1,h*0.6);vt.requestFrame();if(t<seconds)setTimeout(f,33);else res();})();});
      r.stop();await Promise.race([stop,new Promise(x=>setTimeout(x,3000))]);
      const f=new File(ch,name+'.webm',{type:'video/webm',lastModified:hue});
      if(f.size<2000&&(window.__tr=(window.__tr||0)+1)<5) return await mkWebm(name,seconds,hue,w,h); window.__tr=0; return f; };
    // read an exported MP4 back: info + frame numbers in two cell rows
    window.readBack=async(blob,times,boxes)=>{ const f=new File([blob],'export.mp4',{type:'video/mp4',lastModified:9}); const src=await V.loadVideo(f);
      const o={mode:src.mode,w:src.width,h:src.height,dur:src.duration,count:src.frameCount,frames:[]};
      for(const t of times){ const fr=await src.frameAt(t); o.frames.push(boxes.map(b=>idxIn(fr,b[0],b[1],b[2],b[3]))); }
      src.dispose(); return o; };
    return 1; })()`);

  // ---- clips: A numbered 0.. (960x540 MP4), B numbered 100.. (960x540 MP4), C a duration-less WebM, D an odd WebM
  const t0 = Date.now();
  await evaluate(`(async()=>{ window.fA=await mkMp4('clip-A.mp4',960,540,${NF},0,210); window.fB=await mkMp4('clip-B.mp4',960,540,${NF},100,20);
    window.fC=await mkWebm('clip-C',1.6,140,640,360); window.fD=await mkWebm('clip-D',1.4,300,643,361); return [fA.size,fB.size,fC.size,fD.size]; })()`)
    .then(s => { log('clips made in', Date.now() - t0, 'ms, sizes', JSON.stringify(s)); chk(s.every(x => x > 2000), 'a generated clip is empty ' + s); });

  // ---- 3. Compare, embedded (?embed=1&mode=compare)
  await open('compare');
  await size(1920, 1080);
  const m0 = await FE(`return {mode:VC.M.id,fixed:d.body.classList.contains('fixed-mode'),embed:d.body.classList.contains('embed'),seg:getComputedStyle(d.querySelector('.kit-head')).display,
    gridHidden:getComputedStyle(d.getElementById('vGrid')).display,slots:getComputedStyle(d.getElementById('slots')).display,pageScroll:d.documentElement.scrollHeight<=w.innerHeight}`);
  chk(m0.mode === 'compare' && m0.embed && m0.seg === 'none' && m0.gridHidden === 'none' && m0.slots !== 'none' && m0.pageScroll, 'embedded compare start ' + JSON.stringify(m0));
  const hd0 = await evaluate(HEAD);
  chk(hd0.title === 'Compare videos' && hd0.btns.join() === 'load:Load,export:Export MP4*!,record:Record WebM!' && /^Load a left and a right clip/.test(hd0.status), 'Studio header (compare, empty) ' + JSON.stringify(hd0));
  await capture('video-compare-empty-1920');

  await FE(`await VC.setSlot('A', top.fA); return 1`);
  await FE(`await VC.setSlot('B', top.fC); return 1`);   // MP4 on the left, duration-less WebM on the right
  const m1 = await FE(`return {ready:VC.M.ready(),dA:VC.slots.A.src.duration,dB:VC.slots.B.src.duration,modeA:VC.slots.A.src.mode,modeB:VC.slots.B.src.mode,cw:d.getElementById('canvas').width,ch:d.getElementById('canvas').height,dur:VC.dur()}`);
  log('compare loaded:', JSON.stringify(m1));
  chk(m1.ready && Number.isFinite(m1.dB) && m1.dB > 1.2 && m1.dB < 2.4, 'WebM B duration ' + m1.dB);
  chk(m1.modeA === 'decoder' && m1.modeB === 'seek', 'source modes ' + m1.modeA + '/' + m1.modeB);
  chk(m1.cw % 2 === 0 && m1.ch % 2 === 0, 'canvas size not even ' + m1.cw + 'x' + m1.ch);
  await delay(300);
  const blank = await FE(`const c=d.getElementById('canvas'),g=c.getContext('2d');const px=g.getImageData(Math.floor(c.width*0.25),Math.floor(c.height/2),1,1).data,pr=g.getImageData(Math.floor(c.width*0.75),Math.floor(c.height/2),1,1).data;
    return {l:[px[0],px[1],px[2]],r:[pr[0],pr[1],pr[2]],vis:getComputedStyle(c).display}`);
  chk(blank.vis !== 'none' && blank.l[0] + blank.l[1] + blank.l[2] > 40 && blank.r[0] + blank.r[1] + blank.r[2] > 40, 'preview blank after loading: ' + JSON.stringify(blank));
  const hd1 = await evaluate(HEAD);
  chk(hd1.btns.join() === 'load:Load,export:Export MP4*,record:Record WebM' && /^\d+ × \d+ · 0:0\d/.test(hd1.status), 'Studio header (compare, loaded) ' + JSON.stringify(hd1));
  await capture('video-compare-loaded-1920');

  // scrub: seekT, then the real pointer on the scrub bar
  await FE(`VC.seekT(0.5); return 1`);
  await until(() => FE(`const c=d.getElementById('canvas');return top.idxIn(c,0,0,c.width/2,c.height)`).then(v => v === 15), 'preview frame 15 after seekT(0.5)');
  const tl = await FE(`const r=d.getElementById('tl').getBoundingClientRect(),f=(()=>{const a=w.frameElement.getBoundingClientRect(),b=w.parent.frameElement.getBoundingClientRect();return {left:a.left+b.left,top:a.top+b.top}})();return {x:f.left+r.left,y:f.top+r.top+r.height/2,w:r.width}`);
  await command('Input.dispatchMouseEvent', { type: 'mousePressed', x: tl.x + tl.w * 0.9, y: tl.y, button: 'left', clickCount: 1 });
  await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: tl.x + tl.w * 0.25, y: tl.y, button: 'left' });
  await command('Input.dispatchMouseEvent', { type: 'mouseReleased', x: tl.x + tl.w * 0.25, y: tl.y, button: 'left', clickCount: 1 });
  const dd = await FE('return VC.dur()');
  const tt = await FE('return VC.T');
  chk(Math.abs(tt - dd * 0.25) < 0.06, 'scrub bar drag landed at ' + tt + ' expected ' + dd * 0.25);
  // play
  await FE(`VC.play(); return 1`); await delay(900);
  const pl = await FE(`return {t:VC.T,playing:d.getElementById('tPlay').querySelector('svg')!==null}`);
  chk(pl.t > tt + 0.3, 'playback did not advance: ' + pl.t + ' from ' + tt);
  await FE(`VC.pause(); return 1`);
  await FE(`VC.stop(); return 1`);
  // the transport bar under the picture drives the page (Play/Pause toggles, Stop goes back to the start); the Studio header has no Play/Stop
  const TB = id => FE(`d.getElementById('${id}').click(); return 1`);
  await TB('tPlay'); await delay(700);
  const hp = await evaluate(HEAD), tp = await FE('return VC.T');
  chk(tp > 0.3 && !hp.btns.some(x => /^(play|stop):/.test(x)), 'transport Play button: T ' + tp + ' ' + JSON.stringify(hp.btns));
  await TB('tPlay'); await delay(150);
  const tq = await FE('return VC.T'); await delay(250);
  chk(Math.abs((await FE('return VC.T')) - tq) < 0.02, 'transport Pause button did not pause');
  await TB('tStop'); await delay(200);
  chk((await FE('return VC.T')) === 0 && (await FE("return d.getElementById('tStop').disabled")) === true, 'transport Stop button did not rewind');

  // export A (MP4) + C (WebM), default
  const e1 = await FE(`const t=performance.now();const r=await VC.exportMp4();return {ms:Math.round(performance.now()-t),name:r&&r.name,frames:r&&r.frames,w:r&&r.width,h:r&&r.height,size:r&&r.blob.size,err:VC.error,errs:w.__errs}`);
  log('export MP4 + WebM:', JSON.stringify(e1));
  chk(e1.name === 'comparison.mp4' && e1.frames > 0, 'export gave ' + JSON.stringify(e1));
  const sz1 = m1.cw;
  const rb1 = await evaluate(`(async()=>{const r=${W}.VC.last;const dur=${W}.VC.dur();const total=Math.ceil(dur*30-1e-6);return await readBack(r.blob,[0.5/30, 5.5/30, (total-1+0.5)/30],[[0,0,${sz1}/2,${m1.ch}]]).then(o=>Object.assign(o,{total,dur}))})()`);
  log('read back:', JSON.stringify({ w: rb1.w, h: rb1.h, dur: rb1.dur, count: rb1.count, frames: rb1.frames, total: rb1.total }));
  chk(rb1.w === m1.cw && rb1.h === m1.ch && rb1.w % 2 === 0, 'export size ' + rb1.w + 'x' + rb1.h + ' expected ' + m1.cw + 'x' + m1.ch);
  chk(rb1.mode === 'decoder' && rb1.count === rb1.total && Math.abs(rb1.dur - rb1.total / FPS) < 0.1, 'frame count ' + rb1.count + ' vs ' + rb1.total + ', duration ' + rb1.dur);
  chk(JSON.stringify(rb1.frames.map(f => f[0])) === JSON.stringify([0, 5, rb1.total - 1]), 'left frames ' + JSON.stringify(rb1.frames) + ' (last must be ' + (rb1.total - 1) + ': the tail is not lost)');
  R.t.exportMixed = e1.ms;

  // two numbered MP4s: exact frames on both sides, offset and speed
  await FE(`await VC.setSlot('A', top.fA); await VC.setSlot('B', top.fB); return 1`);
  const m2 = await FE(`return {cw:d.getElementById('canvas').width,ch:d.getElementById('canvas').height,dur:VC.dur()}`);
  await delay(200);
  const e2 = await FE(`const t=performance.now();const r=await VC.exportMp4();return {ms:Math.round(performance.now()-t),frames:r&&r.frames}`);
  const rb2 = await evaluate(`readBack(${W}.VC.last.blob,[0.5/30,1.5/30,17.5/30,30.5/30,58.5/30,59.5/30],[[0,0,960,540],[960,0,960,540]])`);
  log('MP4+MP4 export:', e2.ms, 'ms', JSON.stringify(rb2.frames), rb2.w + 'x' + rb2.h, rb2.dur);
  chk(m2.cw === 1920 && rb2.w === 1920 && rb2.h === 540 && rb2.count === NF && e2.frames === NF, `MP4+MP4 size/count ${rb2.w}x${rb2.h} count ${rb2.count} frames ${e2.frames}`);
  const want = [0, 1, 17, 30, 58, 59];
  chk(JSON.stringify(rb2.frames.map(f => f[0])) === JSON.stringify(want), 'left frames ' + JSON.stringify(rb2.frames.map(f => f[0])));
  chk(JSON.stringify(rb2.frames.map(f => f[1])) === JSON.stringify(want.map(x => x + 100)), 'right frames ' + JSON.stringify(rb2.frames.map(f => f[1])));
  R.t.exportMp4Mp4 = e2.ms;

  // offset 0.5 s and speed 2 on the left: output frame i shows source frame 15 + 2i; the shortest clip decides the length
  await FE(`VC.sides.A.offset=0.5; VC.sides.A.speed=2; return 1`);
  const dOff = await FE('return VC.dur()');
  chk(Math.abs(dOff - 0.75) < 1e-6, 'duration with offset/speed ' + dOff);
  const e3 = await FE(`const r=await VC.exportMp4();return {frames:r&&r.frames}`);
  const rb3 = await evaluate(`readBack(${W}.VC.last.blob,[0.5/30,3.5/30,22.5/30],[[0,0,960,540],[960,0,960,540]])`);
  log('offset+speed export:', JSON.stringify(rb3.frames), e3.frames);
  chk(e3.frames === 23, 'offset/speed frame count ' + e3.frames);
  chk(JSON.stringify(rb3.frames.map(f => f[0])) === JSON.stringify([15, 21, 59]), 'left frames with offset/speed ' + JSON.stringify(rb3.frames.map(f => f[0])));
  chk(JSON.stringify(rb3.frames.map(f => f[1])) === JSON.stringify([100, 103, 122]), 'right frames with offset/speed ' + JSON.stringify(rb3.frames.map(f => f[1])));
  await FE(`VC.sides.A.offset=0; VC.sides.A.speed=1; return 1`);

  // speed on real sizes: two 2 s 1080p clips (MP4 + MP4, then MP4 + WebM)
  await evaluate(`(async()=>{window.fH1=await mkMp4('h1.mp4',1920,1080,60,0,200);window.fH2=await mkMp4('h2.mp4',1920,1080,60,100,30);window.fH3=await mkWebm('h3',2,90,1920,1080);return 1})()`);
  await FE(`await VC.setSlot('A', top.fH1); await VC.setSlot('B', top.fH2); return 1`);
  await delay(300);
  const h1 = await FE(`const t=performance.now();const r=await VC.exportMp4();return {ms:Math.round(performance.now()-t),frames:r&&r.frames,w:r&&r.width,h:r&&r.height,err:VC.error}`);
  await FE(`await VC.setSlot('B', top.fH3); return 1`);
  await delay(300);
  const h2 = await FE(`const t=performance.now();const r=await VC.exportMp4();return {ms:Math.round(performance.now()-t),frames:r&&r.frames,w:r&&r.width,h:r&&r.height,err:VC.error}`);
  log('1080p MP4+MP4:', JSON.stringify(h1), ' MP4+WebM:', JSON.stringify(h2));
  chk(h1.frames === 60 && h1.w === 3840 && h1.h === 1080, '1080p MP4+MP4 ' + JSON.stringify(h1));
  chk(h2.frames > 40 && h2.w === 3840, '1080p MP4+WebM ' + JSON.stringify(h2));
  R.t.p1080 = [h1.ms, h2.ms];

  // odd width: A 854x480 MP4 next to the 643x361 WebM -> 854 + 855 = 1709, the file must be 1708 wide
  await evaluate(`(async()=>{window.fE=await mkMp4('clip-E.mp4',854,480,40,0,60);return 1})()`);
  await FE(`await VC.setSlot('A', top.fE); await VC.setSlot('B', top.fD); return 1`);
  await delay(300);
  const m3 = await FE(`return {cw:d.getElementById('canvas').width,ch:d.getElementById('canvas').height}`);
  const e4 = await FE(`const r=await VC.exportMp4();return {frames:r&&r.frames,w:r&&r.width,h:r&&r.height,errs:w.__errs}`);
  log('odd widths:', JSON.stringify(m3), JSON.stringify(e4));
  chk(m3.cw === 1708 && m3.ch === 480 && e4.w === 1708 && e4.h === 480 && e4.frames > 20, 'odd width handling ' + JSON.stringify({ m3, e4 }));

  // cancel
  await FE(`await VC.setSlot('A', top.fA); await VC.setSlot('B', top.fB); return 1`);
  const cn = await FE(`const p=VC.exportMp4(); await new Promise(r=>setTimeout(r,60)); const during=VC.busy; VC.exportMp4(); const r=await p; return {during,after:VC.busy,r}`);
  chk(cn.during === 'export' && cn.after === null && cn.r === null, 'cancel ' + JSON.stringify(cn));

  // keyboard: Space plays and pauses, then Record WebM records one pass
  await FE(`VC.stop(); return 1`);
  const kb = await FE(`const key=k=>d.dispatchEvent(new w.KeyboardEvent('keydown',{key:k,bubbles:true,cancelable:true}));
    key(' '); await new Promise(r=>setTimeout(r,500)); const t1=VC.T; key(' '); const t2=VC.T; await new Promise(r=>setTimeout(r,200)); const t3=VC.T; key('ArrowRight'); const t4=VC.T; return {t1,t2,t3,t4}`);
  chk(kb.t1 > 0.2 && Math.abs(kb.t3 - kb.t2) < 0.02 && Math.abs(kb.t4 - kb.t3 - 1 / 30) < 0.005, 'keyboard ' + JSON.stringify(kb));
  await FE(`VC.stop(); return 1`);
  const rc = await FE(`const p=VC.record(); await new Promise(r=>setTimeout(r,500)); const during=VC.busy; const t0=Date.now(); while(VC.busy&&Date.now()-t0<12000) await new Promise(r=>setTimeout(r,100)); return {during,after:VC.busy,name:VC.last&&VC.last.name,size:VC.last&&VC.last.blob&&VC.last.blob.size}`);
  log('record:', JSON.stringify(rc));
  chk(rc.during === 'record' && rc.after === null && rc.name === 'comparison.webm' && rc.size > 3000, 'record webm ' + JSON.stringify(rc));

  // drop anywhere: a file dropped over the right half replaces the right clip, a drop on the left half the left clip
  const dr = await FE(`const mk=(n)=>{const dt=new w.DataTransfer();dt.items.add(n);return dt;};
    const fire=(type,dt,x,y)=>d.body.dispatchEvent(new w.DragEvent(type,{dataTransfer:dt,clientX:x,clientY:y,bubbles:true,cancelable:true}));
    const W=w.innerWidth,H=w.innerHeight; let dt=mk(top.fC); fire('dragenter',dt,W*0.7,H*0.5); fire('dragover',dt,W*0.7,H*0.5);
    const veil=d.querySelector('.kit-drop.on span')&&d.querySelector('.kit-drop.on span').textContent;
    fire('drop',dt,W*0.7,H*0.5); await new Promise(r=>setTimeout(r,1500));
    const right=VC.slots.B.name; dt=mk(top.fD); fire('dragenter',dt,W*0.1,H*0.5); fire('drop',dt,W*0.1,H*0.5); await new Promise(r=>setTimeout(r,1500));
    return {veil,right,left:VC.slots.A.name}`);
  log('drop:', JSON.stringify(dr));
  chk(dr.right === 'clip-C.webm' && dr.left === 'clip-D.webm' && /right/.test(dr.veil || ''), 'drop anywhere ' + JSON.stringify(dr));
  // Studio.send (what the tray and a drop on the rail call): two videos fill left and right, a text file is refused by the host
  const sd = await evaluate(`(()=>{const S=${SH};const ok=S.send('compare',[fA,fB]);return ok})()`);
  await delay(1200);
  const sn = await FE('return [VC.slots.A.name,VC.slots.B.name]');
  chk(sd === true && sn.join() === 'clip-A.mp4,clip-B.mp4', 'Studio.send did not fill left/right: ' + sd + ' ' + sn);
  const sx = await evaluate(`(()=>{const ok=${SH}.send('compare',[new File(['x'],'a.txt',{type:'text/plain'})]);return {ok,toast:(frames.studio.contentDocument.querySelector('.kit-toast.on')||{}).textContent||''}})()`);
  chk(sx.ok === false && /Compare does not take this file/.test(sx.toast), 'Studio.send(text) ' + JSON.stringify(sx));
  const errs1 = await FE('return w.__errs');
  chk(errs1.length === 0, 'page errors in compare: ' + JSON.stringify(errs1));

  await FE(`await VC.setSlot('A', top.fA); await VC.setSlot('B', top.fB); VC.seekT(0.6); return 1`);
  await delay(600);
  await capture('video-compare-1920');
  await size(1280, 720);
  const pg = await FE(`return {sh:d.documentElement.scrollHeight,ih:w.innerHeight,sw:d.documentElement.scrollWidth,iw:w.innerWidth}`);
  chk(pg.sh <= pg.ih && pg.sw <= pg.iw, 'page scrolls at 1280x720 ' + JSON.stringify(pg));
  await delay(300);
  await capture('video-compare-1280');

  // ---- 4. Grid, embedded
  await open('grid');
  await size(1920, 1080);
  const g0 = await FE(`return {mode:VC.M.id,cv:getComputedStyle(d.getElementById('vCompare')).display,empty:d.getElementById('vGrid').classList.contains('empty')}`);
  chk(g0.mode === 'grid' && g0.cv === 'none' && g0.empty, 'grid start ' + JSON.stringify(g0));
  const gh0 = await evaluate(HEAD);
  chk(gh0.title === 'Video grid' && gh0.btns.join() === 'load:Load,export:Export MP4*!,record:Record WebM!' && gh0.status === 'No clips yet', 'Studio header (grid, empty) ' + JSON.stringify(gh0));
  await capture('video-grid-empty-1920');
  await FE(`await VC.addClips([top.fA, top.fC, top.fB]); return 1`);
  await delay(500);
  const g1 = await FE(`const L=VC.G.clips;return {n:L.length,names:L.map(c=>c.name),sel:VC.G.sel,items:[...d.querySelectorAll('.vc-item')].map(i=>i.className),aria:[...d.querySelectorAll('.vc-item')].map(i=>i.getAttribute('aria-selected')),
    cw:d.getElementById('gvCanvas').width,ch:d.getElementById('gvCanvas').height,dur:VC.dur()}`);
  log('grid loaded:', JSON.stringify(g1));
  const gh1 = await evaluate(HEAD);
  chk(/^3 clips · 0:01/.test(gh1.status) && gh1.btns.join() === 'load:Load,export:Export MP4*,record:Record WebM', 'Studio header (grid, 3 clips) ' + JSON.stringify(gh1));
  chk(g1.n === 3 && g1.names.join() === 'clip-A.mp4,clip-C.webm,clip-B.mp4', 'grid clips (order kept) ' + g1.names);
  chk(g1.items[0].includes(' on') && !g1.items[1].includes(' on') && g1.aria.join() === 'true,false,false', 'selected row state ' + JSON.stringify(g1.items));
  chk(g1.cw % 2 === 0 && g1.ch % 2 === 0, 'grid size not even ' + g1.cw + 'x' + g1.ch);
  await FE(`d.querySelectorAll('.vc-item')[1].click(); return 1`);
  const g2 = await FE(`return {sel:VC.G.sel,items:[...d.querySelectorAll('.vc-item')].map(i=>i.classList.contains('on')),name:d.querySelector('.vc-clipname').textContent,box:!d.getElementById('gvSelBox').hidden}`);
  chk(g2.items.join() === 'false,true,false' && g2.name === 'clip-C.webm' && g2.box, 'selecting a row ' + JSON.stringify(g2));
  // click a cell in the preview (real mouse): selects the third clip
  const cell = await FE(`const r=d.getElementById('gvCanvas').getBoundingClientRect(),f=(()=>{const a=w.frameElement.getBoundingClientRect(),b=w.parent.frameElement.getBoundingClientRect();return {left:a.left+b.left,top:a.top+b.top}})(),L=d.getElementById('gvCanvas').width;
    const k=VC.G.clips.length; const sc=r.width/L; return {x:f.left+r.left+r.width*0.25,y:f.top+r.top+r.height*0.75}`);
  await command('Input.dispatchMouseEvent', { type: 'mousePressed', x: cell.x, y: cell.y, button: 'left', clickCount: 1 });
  await command('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cell.x, y: cell.y, button: 'left', clickCount: 1 });
  const g3 = await FE('return VC.G.clips.findIndex(c=>c.id===VC.G.sel)');
  chk(g3 === 2, 'clicking a cell selected clip index ' + g3);
  await FE(`VC.seekT(0.5); return 1`);
  await delay(700);
  const gb = await FE(`const c=d.getElementById('gvCanvas'),g=c.getContext('2d');const px=g.getImageData(Math.floor(c.width*0.75),Math.floor(c.height*0.25),1,1).data;return [px[0],px[1],px[2]]`);
  chk(gb[0] + gb[1] + gb[2] > 40, 'grid preview cell blank ' + gb);
  await capture('video-grid-1920');

  const e5 = await FE(`const t=performance.now();const r=await VC.exportMp4();return {ms:Math.round(performance.now()-t),frames:r&&r.frames,w:r&&r.width,h:r&&r.height,name:r&&r.name}`);
  log('grid export:', JSON.stringify(e5));
  const L5 = await FE(`const L=VC.modes.grid; const s=L.size(); return s`);
    const rb5 = await evaluate(`readBack(${W}.VC.last.blob,[0.5/30,12.5/30,40.5/30],[[0,0,956,536],[0,546,956,536]])`);
  log('grid read back:', rb5.w + 'x' + rb5.h, rb5.dur, JSON.stringify(rb5.frames));
  chk(e5.name === 'grid.mp4' && rb5.w === e5.w && rb5.h === e5.h && rb5.w % 2 === 0 && rb5.h % 2 === 0, 'grid export size ' + rb5.w + 'x' + rb5.h);
  chk(Math.abs(rb5.dur - 1.6) < 0.15 && rb5.count === e5.frames, 'grid duration ' + rb5.dur + ' frames ' + rb5.count + '/' + e5.frames + ' (shortest clip is the 1.6 s WebM)');
  chk(rb5.frames[0][0] === 0 && rb5.frames[1][0] === 12 && rb5.frames[2][0] === 40, 'grid cell 0 frames ' + JSON.stringify(rb5.frames.map(f => f[0])));
  chk(rb5.frames[1][1] === 112, 'grid cell 2 (clip B) frame ' + rb5.frames[1][1] + ' expected 112');
  R.t.gridExport = e5.ms;
  const errs2 = await FE('return w.__errs');
  chk(errs2.length === 0, 'page errors in grid: ' + JSON.stringify(errs2));
  await size(1280, 720);
  const pg2 = await FE(`return {sh:d.documentElement.scrollHeight,ih:w.innerHeight}`);
  chk(pg2.sh <= pg2.ih, 'grid page scrolls at 1280x720 ' + JSON.stringify(pg2));
  // Studio.send on the grid adds the clips to it, and the host status follows
  await evaluate(`${SH}.send('grid',[fE])`);
  await delay(900);
  const gs = await FE(`return {n:VC.G.clips.length,last:VC.G.clips[VC.G.clips.length-1].name}`);
  chk(gs.n === 4 && gs.last === 'clip-E.mp4' && /^4 clips/.test((await evaluate(HEAD)).status), 'Studio.send on the grid ' + JSON.stringify(gs));
  await delay(300);
  await capture('video-grid-1280');

  // ---- 5. standalone: header with the mode switch and the same actions
  await open('standalone');
  await size(1920, 1080);
  await delay(1800);   // the host waits 1.5 s for a registration, then treats the page as a plain one
  const hs = await evaluate(`(()=>{const M=${SH}.modes.find(m=>m.id==='compare');return {state:M.state,spec:!!M.spec,btns:frames.studio.contentDocument.querySelectorAll('#actions button').length}})()`);
  chk(hs.state === 'legacy' && hs.spec === false && hs.btns === 0, 'standalone page registered with the host ' + JSON.stringify(hs));
  const s0 = await FE(`return {seg:getComputedStyle(d.getElementById('modeSeg')).display,acts:[...d.querySelectorAll('#actions button')].map(b=>b.textContent.trim()),mode:VC.M.id}`);
  chk(s0.seg !== 'none' && s0.acts.join() === 'Load,Play,Stop,Export MP4,Record WebM', 'standalone header ' + JSON.stringify(s0));
  await FE(`await VC.setSlot('A', top.fA); await VC.setSlot('B', top.fB); VC.seekT(0.8); return 1`);
  await delay(500);
  await capture('video-compare-standalone-1920');
  await FE(`d.querySelector('#modeSeg button[data-mode=grid]').click(); await VC.addClips([top.fA, top.fB, top.fC, top.fD]); return 1`);
  await delay(600);
  const s1 = await FE(`return {mode:d.body.dataset.mode,n:VC.G.clips.length}`);
  chk(s1.mode === 'grid' && s1.n === 4, 'standalone switch to grid ' + JSON.stringify(s1));
  await capture('video-grid-standalone-1920');
  await size(1280, 720);
  await delay(300);
  await capture('video-grid-standalone-1280');
  await FE(`d.querySelector('#modeSeg button[data-mode=compare]').click(); return 1`);
  await delay(300);
  await capture('video-compare-standalone-1280');
  const errs3 = await FE('return w.__errs');
  chk(errs3.length === 0, 'page errors standalone: ' + JSON.stringify(errs3));

  await size(1700, 1000);
  return R;
};
