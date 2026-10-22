'use strict';
// Contact sheet (app/frames/index.html, Studio mode "sheet") inside the real app, embedded the way Studio does it:
// the page runs in the "sheet" mode iframe of the Studio host (?embed=1), ev() runs in that nested frame and
// `parent` is the real Studio host (toasts, header actions and status live there). Section (g3) also checks the
// page standalone (no ?embed).
//   (a) images added in the given order stay in that order (a big slow image first, tiny ones after; two quick adds)
//   (b) fit crop / contain changes the pixels; cells uniform vs proportional
//   (c) video frames are exact: a frame-numbered 1080p H.264 clip, 9 frames extracted, the codes read back
//   (d) a duration-less WebM loads and gives frames
//   (e) PNG export size = output width (images and frames; frames re-read at the resolution the output needs, no 1280 cap)
//   (f) settings: sheet.opts written; first run seeded from vc-collage-opts and from toolbox.controls.frames
//   (g) the controls are bound (DOM -> options), no duplicate ids, ?embed=1 registers with the real Studio host
//       (header title/actions/status, Studio.send routing, toasts in the host), standalone page keeps its own header and toasts
// Run: APP_ROOT=<copy> TAB=frames PORT=<port> node tests/stress/run-tab.cjs tests/stress/sheet/t1.cjs
module.exports = async ({ ev, evaluate, command, until, delay, capture, log }) => {
  const R = { ok: true, notes: [] };
  const bad = m => { R.ok = false; R.notes.push(m); log('FAIL ' + m); };
  const chk = (c, m) => { if (!c) bad(m); };
  const ready = () => until(() => ev('window.Sheet&&Sheet.ready===true&&document.readyState==="complete"'), 'sheet ready');
  const MODE = "frames.studio.contentWindow.Studio.modes.find(m=>m.id==='sheet')";   // the host's record of the mode
  const EMBED = 'app://local/frames/index.html?embed=1', STANDALONE = 'app://local/frames/index.html';
  const gotoFrame = async (url) => {
    await evaluate(`${MODE}.frame.src=${JSON.stringify(url)}`);
    await delay(500);
    await ready();
    await ev('window.qaErrors=[];addEventListener("error",e=>qaErrors.push(e.message));addEventListener("unhandledrejection",e=>qaErrors.push(String(e.reason&&e.reason.stack||e.reason)));1');
  };
  /* park the frame (its unload writes sheet.opts), wipe storage, load it fresh */
  const freshLoad = async (setup, url = EMBED) => {
    await evaluate(`${MODE}.frame.src='about:blank'`);
    await delay(400);
    await evaluate(setup || '1');
    await gotoFrame(url);
  };

  await ready();
  await command('Emulation.setDeviceMetricsOverride', { width: 1700, height: 1000, deviceScaleFactor: 1, mobile: false });

  // ---- (f1) first run seeded from the Collage options of the old tool
  await freshLoad(`localStorage.removeItem('sheet.opts');localStorage.removeItem('toolbox.controls.frames');
    localStorage.setItem('vc-collage-opts', JSON.stringify({cgLayout:'row',cgCols:'4',cgSizing:'uniform',cgFit:'contain',cgGap:'21',cgPad:'33',cgRadius:'5',cgBorder:'3',cgBorderColor:'#334455',cgBg:'#223344',cgTransparent:false,cgLabels:true,cgLabelPos:'bottom',cgLabelColor:'#ffeedd',cgLabelSize:'30',cgOutW:'1500'}));1`);
  const s1 = await ev('({o:Sheet.S.o,source:Sheet.S.source,stored:JSON.parse(localStorage.getItem("sheet.opts")||"null")})');
  log('(f1) seeded from vc-collage-opts:', JSON.stringify(s1.o));
  chk(s1.o.layout === 'row' && s1.o.cols === 4 && s1.o.sizing === 'uniform' && s1.o.fit === 'contain', 'collage layout fields not carried over ' + JSON.stringify(s1.o));
  chk(s1.o.gap === 21 && s1.o.pad === 33 && s1.o.radius === 5 && s1.o.border === 3 && s1.o.outW === 1500, 'collage numbers not carried over');
  chk(s1.o.borderColor === '#334455' && s1.o.bg === '#223344' && s1.o.labelColor === '#ffeedd' && s1.o.labelSize === 30 && s1.o.labelPos === 'bottom', 'collage colours/labels not carried over');
  chk(s1.o.labelModeImg === 'caption', 'cgLabels:true should become captions, got ' + s1.o.labelModeImg);
  chk(s1.source === 'images', 'collage-only seed should start on images, got ' + s1.source);
  chk(s1.stored && s1.stored.o && s1.stored.o.gap === 21, 'sheet.opts was not written after seeding');
  chk((await ev('document.getElementById("gap").value')) === '21' && (await ev('document.getElementById("fit").value')) === 'contain', 'controls do not show the seeded values');
  // a second load keeps sheet.opts (the seed happens once), even if the old key changes
  await freshLoad(`localStorage.setItem('vc-collage-opts', JSON.stringify({cgGap:'2'}));1`);
  chk((await ev('Sheet.S.o.gap')) === 21, 'seed ran twice: gap is ' + (await ev('Sheet.S.o.gap')));

  // ---- (f2) first run seeded from Frame Strip (shell control mirror), frames wins on shared fields
  await freshLoad(`localStorage.removeItem('sheet.opts');localStorage.removeItem('vc-collage-opts');
    localStorage.setItem('toolbox.controls.frames', JSON.stringify({count:'12',sampling:'centres',layout:'col',cols:'5',outW:'2400',gap:'11',pad:'14',radius:'2',border:'1',borderColor:'#112233',bg:'#445566',transparent:true,labelMode:'number',labelPos:'top',labelSize:'26',labelColor:'#aabbcc',start:'3',end:'9'}));1`);
  const s2 = await ev('({o:Sheet.S.o,source:Sheet.S.source})');
  log('(f2) seeded from Frame Strip:', JSON.stringify(s2.o), s2.source);
  chk(s2.o.count === 12 && s2.o.sampling === 'centres' && s2.o.layout === 'col' && s2.o.cols === 5 && s2.o.outW === 2400, 'frame strip fields not carried over');
  chk(s2.o.labelMode === 'number' && s2.o.labelPos === 'top' && s2.o.labelSize === 26 && s2.o.transparent === true && s2.o.bg === '#445566', 'frame strip labels/colours not carried over');
  chk(s2.source === 'frames', 'frame-strip-only seed should start on frames, got ' + s2.source);
  // the trim of the old tool (start/end) is per-file and must not leak in
  chk((await ev('Sheet.S.trim.start')) === 0, 'old start leaked in');

  // ---- clean slate for the rest
  await freshLoad(`localStorage.removeItem('sheet.opts');localStorage.removeItem('toolbox.controls.frames');localStorage.removeItem('vc-collage-opts');1`);
  const HELP1 = String.raw`(async()=>{
    HTMLAnchorElement.prototype.click=function(){ if(this.download){ window.__got={href:this.href,name:this.download}; return; } };
    window.mkImg=async(name,w,h,color,noisy)=>{ const c=document.createElement('canvas'); c.width=w; c.height=h; const g=c.getContext('2d');
      g.fillStyle=color; g.fillRect(0,0,w,h);
      if(noisy){ const d=g.getImageData(0,Math.floor(h*0.7),w,Math.floor(h*0.3)); for(let i=0;i<d.data.length;i++) d.data[i]=Math.random()*255; g.putImageData(d,0,Math.floor(h*0.7)); }
      const b=await new Promise(r=>c.toBlob(r,'image/png')); return new File([b],name,{type:'image/png'}); };
    window.px=(cv,x,y)=>{ const d=cv.getContext('2d',{willReadFrequently:true}).getImageData(Math.round(x),Math.round(y),1,1).data; return [d[0],d[1],d[2],d[3]]; };
    window.near=(a,b,t)=>Math.abs(a[0]-b[0])<=t&&Math.abs(a[1]-b[1])<=t&&Math.abs(a[2]-b[2])<=t;
    window.hash=cv=>{ const d=cv.getContext('2d',{willReadFrequently:true}).getImageData(0,0,cv.width,cv.height).data; let h=0; for(let i=0;i<d.length;i+=7) h=(h*31+d[i])|0; return h; };
    return 1; })()`; await ev(HELP1);

  // ---- (a) order
  const cols = { big: [200, 30, 30], g: [30, 200, 30], b: [30, 30, 220], y: [230, 230, 30], m: [220, 30, 220] };
  const t0 = Date.now();
  await ev(`(async()=>{ const L=[await mkImg('big.png',3200,2400,'rgb(200,30,30)',true),await mkImg('g.png',200,100,'rgb(30,200,30)'),await mkImg('b.png',100,200,'rgb(30,30,220)'),await mkImg('y.png',300,300,'rgb(230,230,30)'),await mkImg('m.png',160,90,'rgb(220,30,220)')]; window.__L=L; return L.map(f=>f.size); })()`);
  log('test images ready in', Date.now() - t0, 'ms');
  const ord = await ev(`(async()=>{ await Sheet.addImages(__L); return Sheet.S.images.map(i=>i.name); })()`);
  chk(JSON.stringify(ord) === JSON.stringify(['big.png', 'g.png', 'b.png', 'y.png', 'm.png']), '(a) images out of order: ' + ord);
  // two adds without waiting for the first: still in call order
  const ord2 = await ev(`(async()=>{ const a=await mkImg('c1.png',500,300,'rgb(10,100,200)',true), b=await mkImg('c2.png',40,40,'rgb(200,100,10)');
    const p1=Sheet.addImages([a]), p2=Sheet.addImages([b]); await Promise.all([p1,p2]); return Sheet.S.images.map(i=>i.name); })()`);
  chk(JSON.stringify(ord2) === JSON.stringify(['big.png', 'g.png', 'b.png', 'y.png', 'm.png', 'c1.png', 'c2.png']), '(a) two quick adds out of order: ' + ord2);
  await ev('Sheet.removeImage(Sheet.S.images[6].id);Sheet.removeImage(Sheet.S.images[5].id);1');
  // what the sheet draws follows the same order: sample the centre of every cell
  const draw = await ev(`(()=>{ Sheet.setOpt('layout','grid'); Sheet.setOpt('cols',3); Sheet.setOpt('sizing','uniform'); Sheet.setOpt('labelModeImg','none');
    const L=Sheet.layout(), cv=Sheet.compose(); return {n:L.cells.length, centres:L.cells.map(c=>px(cv,c.x+c.w/2,c.y+c.h/2-2)), w:cv.width, h:cv.height}; })()`);
  const want = [cols.big, cols.g, cols.b, cols.y, cols.m];
  chk(draw.n === 5, '(a) cells ' + draw.n);
  draw.centres.forEach((p, i) => chk(Math.abs(p[0] - want[i][0]) < 8 && Math.abs(p[1] - want[i][1]) < 8 && Math.abs(p[2] - want[i][2]) < 8, `(a) cell ${i} has colour ${p}, expected ${want[i]}`));
  log('(a) order ok:', JSON.stringify(ord));

  // list in the panel: order numbers and names follow the same order; drag/keyboard reorder
  const lst = await ev('[...document.querySelectorAll("#list .it .nm")].map(n=>n.textContent)');
  chk(JSON.stringify(lst) === JSON.stringify(['big.png', 'g.png', 'b.png', 'y.png', 'm.png']), '(a) list order ' + lst);
  await ev('Sheet.moveImage(Sheet.S.images[4].id,0);1');
  chk((await ev('Sheet.S.images.map(i=>i.name).join()')) === 'm.png,big.png,g.png,b.png,y.png', '(a) moveImage');
  await ev('Sheet.moveImage(Sheet.S.images[0].id,4);1');
  chk((await ev('Sheet.S.images.map(i=>i.name).join()')) === 'big.png,g.png,b.png,y.png,m.png', '(a) moveImage back');

  // ---- (b) crop / contain
  const fitRes = await ev(`(()=>{ Sheet.S.images.slice(1).forEach(i=>Sheet.removeImage(i.id)); Sheet.removeImage(Sheet.S.images[0].id); return 1; })()`);
  await ev(`(async()=>{ await Sheet.addImages([await mkImg('wide.png',400,200,'rgb(200,30,30)'),await mkImg('tall.png',200,400,'rgb(30,30,220)')]);
    Sheet.setOpt('layout','row');Sheet.setOpt('sizing','uniform');Sheet.setOpt('gap',10);Sheet.setOpt('pad',10);Sheet.setOpt('bg','#00ff00');Sheet.setOpt('transparent',false);Sheet.setOpt('radius',0);Sheet.setOpt('border',0);Sheet.setOpt('outW',1000); return 1; })()`);
  const fitA = await ev(`(()=>{ Sheet.setOpt('fit','cover'); const L=Sheet.layout(), c0=L.cells[0]; const cv=Sheet.compose();
    return {px:px(cv,c0.x+2,c0.y+2), h:hash(cv), cell:[c0.x,c0.y,c0.w,c0.h]}; })()`);
  const fitB = await ev(`(()=>{ Sheet.setOpt('fit','contain'); const L=Sheet.layout(), c0=L.cells[0]; const cv=Sheet.compose();
    return {px:px(cv,c0.x+2,c0.y+2), h:hash(cv)}; })()`);
  log('(b) fit cover/contain:', JSON.stringify(fitA), JSON.stringify(fitB));
  chk(fitA.px[0] > 150 && fitA.px[1] < 80, '(b) crop-to-fill should cover the cell corner with the image, got ' + fitA.px);
  chk(fitB.px[1] > 200 && fitB.px[0] < 60, '(b) fit-inside should leave the background in the corner, got ' + fitB.px);
  chk(fitA.h !== fitB.h, '(b) cover and contain give the same pixels');
  // proportional vs uniform: different heights
  const prop = await ev(`(()=>{ Sheet.setOpt('layout','col'); Sheet.setOpt('sizing','proportional'); const a=Sheet.layout().height; Sheet.setOpt('sizing','uniform'); const b=Sheet.layout().height; return [a,b]; })()`);
  chk(prop[0] !== prop[1], '(b) proportional and uniform layouts are identical ' + prop);
  // the fit select is a select now (the old cgFit id was shared with a button)
  const sel = await ev(`({tag:document.getElementById('fit').tagName, n:document.querySelectorAll('#fit').length, opts:[...document.getElementById('fit').options].map(o=>o.value)})`);

  // ---- (g1) controls bound to the options, no duplicate ids, labels
  const ui = await ev(`(()=>{ const ids=[...document.querySelectorAll('[id]')].map(e=>e.id); const dup=ids.filter((x,i)=>ids.indexOf(x)!==i);
    const gap=document.getElementById('gap'); gap.value='27'; gap.dispatchEvent(new Event('input',{bubbles:true}));
    const lm=document.getElementById('labelModeImg'); lm.value='caption'; lm.dispatchEvent(new Event('change',{bubbles:true}));
    const sz=document.getElementById('sizing'); sz.value='uniform'; sz.dispatchEvent(new Event('change',{bubbles:true}));
    const fitSel=document.getElementById('fit');
    return {dup, gap:Sheet.S.o.gap, lm:Sheet.S.o.labelModeImg, fitTag:fitSel.tagName, fitHidden:fitSel.closest('.row').hidden}; })()`);
  chk(ui.dup.length === 0, '(g) duplicate ids: ' + ui.dup);
  chk(ui.gap === 27 && ui.lm === 'caption', '(g) controls did not reach the options ' + JSON.stringify(ui));
  chk(ui.fitTag === 'SELECT' && ui.fitHidden === false, '(g) the fit select is missing or hidden: ' + JSON.stringify(ui));
  // the fit select really drives the pixels (the old page bound the zoom button instead)
  const viaSelect = await ev(`(()=>{ const f=document.getElementById('fit'); f.value='cover'; f.dispatchEvent(new Event('change',{bubbles:true})); const a=Sheet.S.o.fit;
    f.value='contain'; f.dispatchEvent(new Event('change',{bubbles:true})); return [a,Sheet.S.o.fit]; })()`);
  chk(viaSelect[0] === 'cover' && viaSelect[1] === 'contain', '(g) the fit select does not change the option ' + viaSelect);
  // persisted
  await ev('Sheet.saveNow();1');
  const st = await ev('JSON.parse(localStorage.getItem("sheet.opts"))');
  chk(st && st.o && st.o.gap === 27 && st.o.fit === 'contain', '(f) sheet.opts did not follow the controls ' + JSON.stringify(st && st.o));

  // ---- (e1) PNG export size = output width (images)
  await ev('window.__got=null;Sheet.setOpt("outW",1234);Sheet.setOpt("labelModeImg","none");1');
  await ev('Sheet.exportPNG()');
  const e1 = await ev(`(async()=>{ const g=window.__got; if(!g) return null; const b=await (await fetch(g.href)).blob(); const bm=await createImageBitmap(b); const L=Sheet.layout(); return {name:g.name,w:bm.width,h:bm.height,lw:L.width,lh:L.height,type:b.type}; })()`);
  log('(e1) export:', JSON.stringify(e1));
  chk(e1 && e1.w === 1234 && e1.h === e1.lh && e1.type === 'image/png', '(e) image export size ' + JSON.stringify(e1));
  chk(e1 && /^sheet_2x_1234px\.png$/.test(e1.name), '(e) image export name ' + (e1 && e1.name));
  // embedded: "Exported ..." is shown by the Studio host (Embed.toast), not by the page
  const e1t = await ev(`({host:(parent.document.querySelector('.kit-toast.on')||{}).textContent||'', page:!!document.querySelector('.kit-toast.on')})`);
  chk(/^Exported sheet_2x_1234px\.png/.test(e1t.host) && e1t.page === false, '(e) export toast should be in the host, not the page: ' + JSON.stringify(e1t));
  // transparent background really exports alpha
  const tr = await ev(`(()=>{ Sheet.setOpt('transparent',true); const cv=Sheet.compose(); const p=px(cv,2,2); Sheet.setOpt('transparent',false); return p; })()`);
  chk(tr[3] === 0, '(e) transparent export has alpha ' + tr);

  // ---- (c) video frames are exact
  const HELP2 = String.raw`(async()=>{
    window.V = await import('../shared/lib/video-io.js');
    window.CELLS=12;
    window.paint=(g,w,h,i)=>{ g.fillStyle='rgb('+(40+(i*3)%120)+',60,'+(120-i%60)+')'; g.fillRect(0,0,w,h);
      const cw=w/CELLS; for(let b=0;b<CELLS;b++){ g.fillStyle=((i>>b)&1)?'#fff':'#000'; g.fillRect(b*cw,0,cw,h/6); }
      g.fillStyle='#fff'; g.font='bold '+Math.round(h/5)+'px Arial'; g.fillText(String(i), w*0.1, h*0.7); };
    window.readIdx=d=>{ const W=240,H=135; const c=readIdx.c||(readIdx.c=document.createElement('canvas')); c.width=W; c.height=H;
      const g=c.getContext('2d',{willReadFrequently:true}); g.drawImage(d,0,0,W,H); let idx=0; const cw=W/CELLS;
      for(let b=0;b<CELLS;b++){ const p=g.getImageData(Math.floor(b*cw+cw/2),11,1,1).data; if(p[0]>128) idx|=1<<b; } return idx; };
    window.mkCoded=async(name,w,h,n,fps,keyEvery)=>{ const enc=await V.Encoder.create({width:w,height:h,fps,bitrate:8e6,only:'avc',keyEvery}); const c=document.createElement('canvas'); c.width=enc.width; c.height=enc.height; const g=c.getContext('2d');
      for(let i=0;i<n;i++){ paint(g,c.width,c.height,i); await enc.addFrame(c); } await enc.flushVideo(); const out=enc.finalize(); const codec=enc.codec; enc.close();
      return {file:new File([out.blob],name,{type:'video/mp4',lastModified:7}),codec,frames:out.frames,w:enc.width,h:enc.height}; };
    return 1; })()`; await ev(HELP2);
  const NF = 45, FPS = 30;
  const mk = await ev(`(async()=>{ const r=await mkCoded('coded.mp4',1920,1080,${NF},${FPS},15); window.__mp4=r.file; return {codec:r.codec,frames:r.frames,w:r.w,h:r.h,size:r.file.size}; })()`);
  log('(c) clip:', JSON.stringify(mk));
  chk(/^avc1\./.test(mk.codec) && mk.frames === NF && mk.w === 1920 && mk.h === 1080, '(c) test clip ' + JSON.stringify(mk));

  await ev(`Sheet.setOpt('count',9);Sheet.setOpt('sampling','ends');Sheet.setOpt('layout','grid');Sheet.setOpt('cols',1);Sheet.setOpt('outW',1920);Sheet.setOpt('pad',8);Sheet.setOpt('gap',8);Sheet.setOpt('labelMode','time');1`);
  const ok = await ev(`Sheet.loadVideoFile(__mp4)`);
  chk(ok === true, '(c) loadVideoFile returned ' + ok);
  await ev('Sheet.idle()');
  await until(() => ev('Sheet.S.frames.length===9'), 'nine frames');
  const c = await ev(`(()=>{ const V=Sheet.S.video; return {src:Sheet.S.source, mode:V.src.mode, dur:V.duration, w:V.w, h:V.h, grabW:Sheet.S.grabW,
    idx:Sheet.S.frames.map(f=>readIdx(f.canvas)), t:Sheet.S.frames.map(f=>f.t), cw:Sheet.S.frames[0].canvas.width, dockHidden:document.getElementById('dock').hidden}; })()`);
  const expect = c.t.map(t => Math.min(NF - 1, Math.floor(t * FPS + 1e-6)));
  log('(c) frames:', JSON.stringify({ mode: c.mode, dur: c.dur, grabW: c.grabW, idx: c.idx, expect }));
  chk(c.src === 'frames' && c.mode === 'decoder', '(c) video should take the decoder path on the frames source: ' + c.mode + '/' + c.src);
  chk(JSON.stringify(c.idx) === JSON.stringify(expect), '(c) frames are not the exact ones: got ' + c.idx + ' expected ' + expect);
  chk(c.idx[0] === 0 && c.idx[8] === NF - 1, '(c) first/last frame ' + c.idx[0] + ' ' + c.idx[8]);
  chk(c.cw > 1280 && c.grabW === c.cw, '(c) frames are capped: cached at ' + c.cw + ' px wide from a 1920 source');
  chk(c.dockHidden === false, '(c) trim dock is hidden with a video loaded');
  // even intervals, and a trimmed range
  await ev(`Sheet.setOpt('sampling','centres');1`);
  await delay(700); await ev('Sheet.idle()');
  const c2 = await ev(`({idx:Sheet.S.frames.map(f=>readIdx(f.canvas)),t:Sheet.S.frames.map(f=>f.t)})`);
  const exp2 = c2.t.map(t => Math.min(NF - 1, Math.floor(t * FPS + 1e-6)));
  chk(JSON.stringify(c2.idx) === JSON.stringify(exp2), '(c) even-interval frames ' + c2.idx + ' expected ' + exp2);
  chk(c2.idx[0] > 0 && c2.idx[8] < NF - 1, '(c) even intervals should not include the first/last frame ' + c2.idx);
  // trim via the sliders: frames stay inside the range
  await ev(`(()=>{ const s=document.getElementById('start'), e=document.getElementById('end'); s.value=0.5; s.dispatchEvent(new Event('input',{bubbles:true})); e.value=1.0; e.dispatchEvent(new Event('input',{bubbles:true})); return 1; })()`);
  await delay(900); await ev('Sheet.idle()');
  const c3 = await ev(`({idx:Sheet.S.frames.map(f=>readIdx(f.canvas)),t:Sheet.S.frames.map(f=>f.t),trim:Sheet.S.trim})`);
  log('(c) trimmed:', JSON.stringify(c3));
  chk(c3.t[0] >= 0.499 && c3.t[8] <= 1.001, '(c) trimmed times ' + c3.t);
  chk(c3.idx.every(i => i >= 14 && i <= 30), '(c) trimmed frames outside 15..30: ' + c3.idx);
  // labels: timestamps drawn above (strip) -> a taller sheet than without
  const lh = await ev(`(()=>{ Sheet.setOpt('labelMode','time'); const a=Sheet.layout().height; Sheet.setOpt('labelMode','none'); const b=Sheet.layout().height; Sheet.setOpt('labelMode','time'); return [a,b]; })()`);
  chk(lh[0] > lh[1], '(c) timestamp strip does not add height ' + lh);

  // ---- (e2) export frames at the resolution the output needs: 3 columns at 5760 px = 1909 px cells (> 1280 cap)
  await ev(`window.__got=null;Sheet.setOpt('cols',3);Sheet.setOpt('outW',5760);Sheet.setOpt('sampling','ends');Sheet.setOpt('labelMode','number');
    document.getElementById('start').value=0;document.getElementById('end').value=Sheet.S.video.duration;
    document.getElementById('start').dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('end').dispatchEvent(new Event('input',{bubbles:true}));1`);
  await delay(500);
  await ev('Sheet.exportPNG()');
  const e2 = await ev(`(async()=>{ const g=window.__got; if(!g) return null; const b=await (await fetch(g.href)).blob(); const bm=await createImageBitmap(b); const L=Sheet.layout();
    return {name:g.name,w:bm.width,h:bm.height,lh:L.height,grabW:Sheet.S.grabW,cellW:L.cells[0].w}; })()`);
  log('(e2) frames export:', JSON.stringify(e2));
  chk(e2 && e2.w === 5760 && e2.h === e2.lh, '(e) frames export size ' + JSON.stringify(e2));
  chk(e2 && e2.grabW >= e2.cellW - 2 && e2.grabW > 1280, '(e) frames were not re-read at the output resolution: ' + JSON.stringify(e2));
  chk(e2 && /^coded_9frames\.png$/.test(e2.name), '(e) frames export name ' + (e2 && e2.name));

  // ---- (d) duration-less WebM (MediaRecorder output)
  await ev(String.raw`(async()=>{
    window.__make=async function(name,seconds,hue){
      const c=document.createElement('canvas');c.width=640;c.height=360;const g=c.getContext('2d');const s=c.captureStream(0);const vt=s.getVideoTracks()[0];
      const r=new MediaRecorder(s,{mimeType:'video/webm;codecs=vp8'});const ch=[];r.ondataavailable=e=>ch.push(e.data);
      const stop=new Promise(x=>r.onstop=x);const t0=performance.now();r.start(100);
      await new Promise(res=>{(function f(){const t=(performance.now()-t0)/1000;g.fillStyle='hsl('+hue+',60%,35%)';g.fillRect(0,0,640,360);g.fillStyle='#fff';g.font='bold 90px Arial';g.fillText(name,200,200);vt.requestFrame();if(t<seconds)setTimeout(f,33);else res();})();});
      r.stop();await Promise.race([stop,new Promise(x=>setTimeout(x,3000))]);
      const f=new File(ch,name+'.webm',{type:'video/webm',lastModified:hue});window.__tries=(window.__tries||0)+1;if(f.size<2000&&window.__tries<5){return await __make(name,seconds,hue);}window.__tries=0;return f; };
    window.__web=await __make('W',1.8,200); return window.__web.size; })()`);
  const w = await ev(`(async()=>{ const f=__web, url=URL.createObjectURL(f); const raw=document.createElement('video'); raw.preload='auto'; raw.src=url; await new Promise(r=>{raw.onloadedmetadata=r; raw.onerror=r;}); const rawDur=String(raw.duration); URL.revokeObjectURL(url);
    Sheet.setOpt('cols',3);Sheet.setOpt('outW',1920);Sheet.setOpt('count',6);
    const ok=await Sheet.loadVideoFile(f); await Sheet.idle();
    const V=Sheet.S.video; const frames=Sheet.S.frames;
    const pxs=frames.map(fr=>{ const g=fr.canvas.getContext('2d',{willReadFrequently:true}); const d=g.getImageData(8,fr.canvas.height-8,1,1).data; return d[0]+d[1]+d[2]; });
    return {ok,rawDur,dur:V&&V.duration,mode:V&&V.src.mode,n:frames.length,pxs,size:f.size,w:V&&V.w,ts:frames.map(x=>+x.t.toFixed(2))}; })()`);
  log('(d) WebM:', JSON.stringify(w));
  chk(w.size > 2000, '(d) WebM recording came out empty');
  chk(w.ok === true && Number.isFinite(w.dur) && w.dur > 0.5 && w.dur < 3, '(d) duration-less WebM: duration ' + w.dur + ' (raw ' + w.rawDur + ')');
  chk(w.mode === 'seek' && w.n === 6, '(d) WebM frames: mode ' + w.mode + ', n ' + w.n);
  chk(w.pxs.every(p => p > 60), '(d) WebM frames are black ' + w.pxs);
  chk(w.ts[0] === 0 && Math.abs(w.ts[5] - w.dur) < 0.02, '(d) WebM sample times ' + w.ts);

  // ---- (g2) ?embed=1 inside the real Studio host: header hidden, registered, actions/status/toasts in the host, files routed by Studio.send
  await freshLoad(`localStorage.removeItem('sheet.opts');localStorage.removeItem('toolbox.controls.frames');localStorage.removeItem('vc-collage-opts');1`); await ev(HELP1); await ev(HELP2);
  await until(() => ev(`parent.Studio.modes.find(m=>m.id==='sheet').state==='ready'`), 'sheet registered with the host');
  const em = await ev(`(()=>{ const H=parent.document, M=parent.Studio.modes.find(m=>m.id==='sheet'); const btn=[...H.querySelectorAll('#actions button')];
    return {embed:Embed.active, bodyEmbed:document.body.classList.contains('embed'), head:getComputedStyle(document.getElementById('head')).display,
    realHost:parent!==window&&typeof parent.Studio.register==='function'&&typeof parent.Studio.trayItems==='function',
    state:M.state, active:parent.Studio.mode(), frameHidden:M.frame.hidden, id:M.spec&&M.spec.id, title:M.spec&&M.spec.title, hostTitle:H.getElementById('title').textContent,
    specActions:M.spec&&M.spec.actions.map(a=>a.id+(a.primary?'*':'')+(a.disabled?'-':'')), hostActions:btn.map(b=>b.dataset.action+(b.classList.contains('primary')?'*':'')+(b.disabled?'-':'')),
    accepts:M.spec&&M.spec.accepts, sc:M.spec&&M.spec.shortcuts.length, recv:M.spec&&typeof M.spec.onReceive}})()`);
  log('(g2) embed:', JSON.stringify(em));
  chk(em.embed && em.bodyEmbed && em.head === 'none', '(g) own header not hidden in embed ' + JSON.stringify(em));
  chk(em.realHost && em.state === 'ready' && em.active === 'sheet' && em.frameHidden === false, '(g) the page is not a registered, visible Studio mode ' + JSON.stringify(em));
  chk(em.id === 'sheet' && em.title === 'Contact sheet' && em.hostTitle === 'Contact sheet', '(g) register id/title/host header ' + em.id + '/' + em.title + '/' + em.hostTitle);
  chk(JSON.stringify(em.specActions) === JSON.stringify(['addImages', 'addVideo', 'copy-', 'export*-']), '(g) registered actions ' + JSON.stringify(em.specActions));
  chk(JSON.stringify(em.hostActions) === JSON.stringify(['addImages', 'addVideo', 'copy-', 'export*-']), '(g) header buttons in the host ' + JSON.stringify(em.hostActions));
  chk(JSON.stringify(em.accepts) === JSON.stringify(['image/*', 'video/*']) && em.sc >= 3 && em.recv === 'function', '(g) accepts/shortcuts/onReceive ' + JSON.stringify(em));
  // Studio.send (what the tray and a drop on the rail call): an image lands on the images source, then a video on the frames source; the host header follows
  const rc = await ev(`(async()=>{ const S0=parent.Studio, H=parent.document; const img=await mkImg('r.png',320,180,'rgb(90,90,200)'); const sent=S0.send('sheet',[img]); await Sheet.idle(); await new Promise(r=>setTimeout(r,400));
    const a={sent,src:Sheet.S.source,n:Sheet.S.images.length,expDisabled:H.querySelector('#actions [data-action=export]').disabled,copyDisabled:H.querySelector('#actions [data-action=copy]').disabled};
    const mp4=await mkCoded('r.mp4',640,360,30,30,15); const sent2=S0.send('sheet',[mp4.file]);
    for(let i=0;i<60&&Sheet.S.frames.length!==Sheet.S.o.count;i++) await new Promise(r=>setTimeout(r,100));
    return {a, b:{sent2,src:Sheet.S.source, frames:Sheet.S.frames.length, name:Sheet.S.video&&Sheet.S.video.name}, st:H.getElementById('status').textContent, hostSt:S0.modes.find(m=>m.id==='sheet').status}; })()`);
  log('(g2) Studio.send:', JSON.stringify(rc));
  chk(rc.a.sent === true && rc.a.src === 'images' && rc.a.n === 1, '(g) an image sent to the mode did not land on the images source ' + JSON.stringify(rc.a));
  chk(rc.a.expDisabled === false && rc.a.copyDisabled === false, '(g) the host export/copy buttons stayed disabled with an image loaded ' + JSON.stringify(rc.a));
  chk(rc.b.sent2 === true && rc.b.src === 'frames' && rc.b.frames === 9 && rc.b.name === 'r.mp4', '(g) a video sent to the mode did not land on the frames source ' + JSON.stringify(rc.b));
  chk(typeof rc.st === 'string' && /9 frames/.test(rc.st) && rc.st === rc.hostSt, '(g) host status ' + rc.st + ' / ' + rc.hostSt);
  // a file the mode does not take is refused by the host, with the toast in the host (not in the page)
  const rj = await ev(`(async()=>{ const S0=parent.Studio, H=parent.document; const sent=S0.send('sheet',[new File(['x'],'notes.txt',{type:'text/plain'})]); await new Promise(r=>setTimeout(r,150));
    return {sent, hostToast:(H.querySelector('.kit-toast.on')||{}).textContent||'', pageToast:!!document.querySelector('.kit-toast.on')}; })()`);
  chk(rj.sent === false && /Sheet does not take this file/.test(rj.hostToast) && rj.pageToast === false, '(g) refused file: ' + JSON.stringify(rj));
  // the header button of the host runs the action in the page: Export PNG downloads, and its toast shows in the host
  await ev(`window.__got=null;Sheet.setOpt('outW',1000);1`);
  await ev(`parent.document.querySelector('#actions [data-action=export]').click()`);
  await until(() => ev('!!window.__got'), 'export from the host header');
  await delay(200);
  const ht = await ev(`({got:window.__got&&window.__got.name, hostToast:(parent.document.querySelector('.kit-toast.on')||{}).textContent||'', pageToast:!!document.querySelector('.kit-toast.on')})`);
  chk(/^r_9frames\.png$/.test(ht.got) && /^Exported r_9frames\.png/.test(ht.hostToast) && ht.pageToast === false, '(g) header Export PNG / host toast ' + JSON.stringify(ht));
  // leaving the mode saves the options (onHide) and coming back keeps the state (onShow re-renders)
  await ev(`Sheet.setOpt('gap',33);parent.Studio.show('join');1`);
  await delay(300);
  chk((await evaluate(`JSON.parse(localStorage.getItem('sheet.opts')).o.gap`)) === 33, '(g) onHide did not save sheet.opts');
  await ev(`parent.Studio.show('sheet');1`);
  await delay(300);
  chk(await ev(`parent.Studio.mode()==='sheet'&&!parent.Studio.modes.find(m=>m.id==='sheet').frame.hidden&&document.getElementById('gap').value==='33'`), '(g) coming back to the mode lost its state');

  // ---- (g3) the same page standalone (no ?embed): own header, never registers with the host, toasts in the page itself
  await freshLoad('1', STANDALONE); await ev(HELP1);
  await delay(1800);   // the host waits 1.5 s for a registration, then treats the page as a plain one
  const sa = await ev(`(async()=>{ const M=parent.Studio.modes.find(m=>m.id==='sheet'); await Sheet.addImages([await mkImg('s.png',200,100,'rgb(60,160,60)')]); window.__got=null; await Sheet.exportPNG();
    return {embed:Embed.active, bodyEmbed:document.body.classList.contains('embed'), head:getComputedStyle(document.getElementById('head')).display, state:M.state, spec:!!M.spec, got:window.__got&&window.__got.name,
    pageToast:(document.querySelector('.kit-toast.on')||{}).textContent||'', hostToast:!!parent.document.querySelector('.kit-toast.on')}})()`);
  log('(g3) standalone:', JSON.stringify(sa));
  chk(sa.embed === false && sa.bodyEmbed === false && sa.head !== 'none', '(g3) standalone page should keep its own header ' + JSON.stringify(sa));
  chk(sa.state === 'legacy' && sa.spec === false, '(g3) standalone page registered with the host ' + JSON.stringify(sa));
  chk(/^sheet_1x_\d+px\.png$/.test(sa.got) && /^Exported sheet_1x/.test(sa.pageToast) && sa.hostToast === false, '(g3) standalone export / toast in the page ' + JSON.stringify(sa));

  // ---- screenshots (standalone, populated), 1920 and 1280
  const shots = [];
  const shoot = async (label, w, h) => {
    await command('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await delay(500);
    shots.push(await capture(label + '-' + w));
  };
  await freshLoad(`localStorage.removeItem('sheet.opts');localStorage.removeItem('toolbox.controls.frames');localStorage.removeItem('vc-collage-opts');1`);
  await ev(HELP1); await ev(HELP2); await ev(`(async()=>{ window.__mp4=(await mkCoded('coded.mp4',1920,1080,45,30,15)).file; return 1; })()`);
  await shoot('empty-images', 1920, 1080);
  await ev(`(async()=>{ const mk=async(n,w,h,hue)=>{ const c=document.createElement('canvas'); c.width=w; c.height=h; const g=c.getContext('2d'); const gr=g.createLinearGradient(0,0,w,h); gr.addColorStop(0,'hsl('+hue+',55%,30%)'); gr.addColorStop(1,'hsl('+(hue+50)+',60%,55%)'); g.fillStyle=gr; g.fillRect(0,0,w,h); g.fillStyle='#fff'; g.font='bold '+Math.round(h/4)+'px Arial'; g.fillText(n,w*0.08,h*0.58); const b=await new Promise(r=>c.toBlob(r,'image/png')); return new File([b],'screenshot-'+n+'.png',{type:'image/png'}); };
    await Sheet.addImages([await mk('A',1920,1080,10),await mk('B',1280,800,120),await mk('C',900,1200,200),await mk('D',1600,900,280),await mk('E',1000,1000,60)]);
    Sheet.S.images.forEach((im,i)=>{ im.caption=['Before','After','Detail','Glow','Smoke'][i]; }); Sheet.setOpt('labelModeImg','caption'); Sheet.setOpt('cols',3); Sheet.setOpt('gap',12); Sheet.setOpt('pad',12);
    document.querySelectorAll('#list .cap').forEach((c,i)=>{ c.value=Sheet.S.images[i].caption; }); Sheet.render(); return 1; })()`);
  await shoot('images', 1920, 1080);
  await shoot('images', 1280, 720);
  await command('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await ev(`(async()=>{ Sheet.setOpt('outW',1920); await Sheet.loadVideoFile(__mp4); Sheet.setOpt('count',9); Sheet.setOpt('cols',3); Sheet.setOpt('labelMode','time'); await Sheet.idle(); Sheet.render(); return 1; })()`);
  await delay(800);
  await shoot('frames', 1920, 1080);
  await shoot('frames', 1280, 720);

  await command('Emulation.setDeviceMetricsOverride', { width: 1700, height: 1000, deviceScaleFactor: 1, mobile: false });
  R.shots = shots;
  return R;
};
