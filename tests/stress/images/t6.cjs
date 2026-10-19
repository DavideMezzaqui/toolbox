'use strict';
// 1A: image pipeline and strip. 30 PNG 3840x2160 + one RGBA with a hole + one opaque RGB PNG added through
// addShots; long-task observer around the add; every card canvas gets a (non-black) thumbnail; `buchi` right
// (also after reload()); .lib scroll survives a card click and the strip element is reused; the same file
// twice enters once; thumbnails are not built on the main thread from full decodes (picker stays cheap).
module.exports = async ({ev, log, delay, until, reload}) => {
  const R = {ok: true, notes: []};
  const bad = m => { R.ok = false; R.notes.push(m); log('FAIL ' + m); };
  await ev(`window.wait=ms=>new Promise(r=>setTimeout(r,ms));
window.mk=async(name,w,h,hue,opts={})=>{
  const c=document.createElement('canvas');c.width=w;c.height=h;const g=c.getContext('2d',{alpha:opts.alpha!==false});
  const gr=g.createLinearGradient(0,0,w,h);gr.addColorStop(0,'hsl('+hue+',70%,35%)');gr.addColorStop(1,'hsl('+((hue+80)%360)+',70%,60%)');
  g.fillStyle=gr;g.fillRect(0,0,w,h);
  g.fillStyle='hsl('+((hue+180)%360)+',80%,70%)';g.fillRect(w*0.1,h*0.2,w*0.4,h*0.5);
  g.fillStyle='#fff';g.font=(h/6)+'px sans-serif';g.fillText(name,w*0.12,h*0.5);
  if(opts.hole)g.clearRect(w*0.55,h*0.1,w*0.3,h*0.4);
  const b=await new Promise(r=>c.toBlob(r,'image/png'));
  return new File([b],name,{type:'image/png',lastModified:1000+hue*7+(opts.salt||0)});
};
window.__lt=[];try{new PerformanceObserver(l=>l.getEntries().forEach(e=>window.__lt.push(e.duration))).observe({entryTypes:['longtask']});}catch(e){}
SHOTS=[];imgShot=null;buildControls();render();1`);
  // fixtures
  const made = await ev(`(async()=>{
    window.F=[];
    for(let i=0;i<30;i++) F.push(await mk('img_'+String(i+1).padStart(2,'0')+'.png',3840,2160,(i*12)%360));
    window.FHOLE=await mk('hole.png',1920,1080,200,{hole:true});
    window.FRGB=await mk('opaque.png',1920,1080,40,{alpha:false});
    return F.length;
  })()`);
  R.made = made;
  // add them, observe long tasks around the add
  const add = await ev(`(async()=>{
    __lt.length=0;
    const t0=performance.now();
    const files=F.concat([FHOLE,FRGB]);
    const r=await new Promise(res=>addShots(files,(n,rot)=>res({n,rot})));
    const t1=performance.now();
    return {n:r.n,rot:r.rot,ms:Math.round(t1-t0),lt:Math.round(Math.max(0,...__lt)),ltN:__lt.length,shots:SHOTS.length,cards:document.querySelectorAll('#imgs .card').length};
  })()`);
  R.add = add;
  log('add', JSON.stringify(add));
  if (add.n !== 32 || add.shots !== 32) bad('expected 32 images, got ' + JSON.stringify(add));
  if (add.cards !== 32) bad('expected 32 cards after addShots done, got ' + add.cards);
  if (add.lt > 250) bad('long task during add too long: ' + add.lt);
  // every thumbnail present and non-black, buchi right
  const readThumbs = `(()=>{
    const out={cards:0,black:[],buchi:SHOTS.map(s=>s.name+':'+s.buchi),thumbs:SHOTS.filter(s=>s.thumb).length};
    document.querySelectorAll('#imgs .card').forEach((c,i)=>{
      const cv=c.querySelector('canvas');out.cards++;
      const d=cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;let ok=false;
      for(let k=0;k<d.length;k+=4){ if(d[k+3]>200&&(d[k]+d[k+1]+d[k+2])>45){ok=true;break;} }
      if(!ok) out.black.push(i);
    });
    return out;})()`;
  await until(async () => { const r = await ev(readThumbs); return r.cards === 32 && !r.black.length && r.thumbs === 32 && r.buchi.every(x => !/undefined/.test(x)); }, 'thumbs and buchi ready', 12000);
  const th = await ev(readThumbs);
  R.thumbs = {cards: th.cards, black: th.black, thumbs: th.thumbs};
  const buchi = th.buchi.filter(x => /:true$/.test(x)).map(x => x.split(':')[0]);
  if (buchi.join() !== 'hole.png') bad('buchi after add: ' + JSON.stringify(buchi));
  // thumbs size
  const sz = await ev(`SHOTS.every(s=>s.thumb.width===128&&s.thumb.height===72)`);
  if (!sz) bad('thumb size not 128x72');
  // picker: opening it must not draw the full image (previewShot uses the thumbs)
  const pick = await ev(`(async()=>{
    const t0=performance.now();
    const cv=document.createElement('canvas');cv.width=128;cv.height=60;const g=cv.getContext('2d');g.scale(2,2);
    let spy=0;const orig=g.drawImage.bind(g);g.drawImage=function(im,...a){ if(im instanceof HTMLImageElement) spy++; return orig(im,...a); };
    for(let i=0;i<32;i++) previewShot(g,64,30,i);
    return {ms:Math.round(performance.now()-t0),fullImageDraws:spy};
  })()`);
  R.pick = pick;
  if (pick.fullImageDraws) bad('previewShot drew a full image ' + pick.fullImageDraws + ' times');
  // strip reuse and scroll
  const sc = await ev(`(async()=>{
    const lib=document.querySelector('#imgs .lib');window.__lib=lib;window.__strip=document.getElementById('imgs');
    lib.scrollTop=120;await wait(150);
    const before=lib.scrollTop;
    const cards=document.querySelectorAll('#imgs .card');
    cards[cards.length-2].click();   /* a card that is visible near the bottom */
    await wait(500);
    const lib2=document.querySelector('#imgs .lib');
    return {before,after:lib2.scrollTop,sameLib:lib2===window.__lib,sameStrip:document.getElementById('imgs')===window.__strip,
            on:[...document.querySelectorAll('#imgs .card.on')].map(c=>c.querySelector('.num').textContent)};
  })()`);
  R.scroll = sc;
  if (sc.before < 50) bad('could not scroll the library: ' + JSON.stringify(sc));
  if (Math.abs(sc.after - sc.before) > 2) bad('library scroll lost: ' + JSON.stringify(sc));
  if (!sc.sameLib || !sc.sameStrip) bad('strip was rebuilt on a card click');
  if (sc.on.join() !== '31') bad('card .on not updated: ' + sc.on.join());
  // same file twice -> one entry (also inside the same batch)
  const dup = await ev(`(async()=>{
    const f=await mk('dup.png',640,360,10,{salt:5});
    const n0=SHOTS.length;
    const r1=await new Promise(res=>addShots([f,f],(n)=>res(n)));
    const r2=await new Promise(res=>addShots([f],(n)=>res(n)));
    return {r1,r2,grew:SHOTS.length-n0};
  })()`);
  R.dup = dup;
  if (dup.r1 !== 1 || dup.r2 !== 0 || dup.grew !== 1) bad('duplicate handling: ' + JSON.stringify(dup));
  // buchi / thumbs after reload (B5)
  await delay(900);   // dbSalva timer
  await reload();
  await until(async () => (await ev('SHOTS.length')) === 33, 'images back after reload', 20000);
  await until(async () => { const r = await ev(readThumbs); return r.cards === 33 && r.thumbs === 33 && !r.black.length && r.buchi.every(x => !/undefined/.test(x)); }, 'thumbs and buchi after reload', 15000);
  const th2 = await ev(readThumbs);
  const buchi2 = th2.buchi.filter(x => /:true$/.test(x)).map(x => x.split(':')[0]);
  if (buchi2.join() !== 'hole.png') bad('buchi after reload: ' + JSON.stringify(buchi2));
  // the canvas shows the image soon after the reload
  const shown = await ev(`(()=>{ const c=document.getElementById('cv'); const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data; let n=0; for(let i=0;i<d.length;i+=4*97){ if(d[i+3]>0) n++; } return n>0; })()`);
  if (!shown) bad('canvas empty after reload');
  R.reload = {cards: th2.cards, thumbs: th2.thumbs, buchi: buchi2};
  return R;
};
