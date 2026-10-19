'use strict';
// 3B: strip features. Ctrl+click swaps the image of the selected panel everywhere (live formats only, variants
// untouched, -1 panels included, one undo); card title/badge say where an image is used and update without a
// rebuild; removing a used image says where it was; a file dropped on a card replaces that image (assignments
// kept, imgShot follows, one undo, extra files are added); Remove unused ignores images any live layout or
// variant shows and keeps every panel on the same picture.
module.exports = async ({ev, log, delay, until, reload}) => {
  const R = {ok: true, notes: []};
  const bad = m => { R.ok = false; R.notes.push(m); log('FAIL ' + m); };
  await ev(`window.wait=ms=>new Promise(r=>setTimeout(r,ms));
window.mk=async(name,w,h,hue,opts={})=>{
  const c=document.createElement('canvas');c.width=w;c.height=h;const g=c.getContext('2d');
  g.fillStyle='hsl('+hue+',70%,45%)';g.fillRect(0,0,w,h);g.fillStyle='#fff';g.font=(h/6)+'px sans-serif';g.fillText(name,w*0.1,h*0.5);
  const b=await new Promise(r=>c.toBlob(r,'image/png'));
  return new File([b],name,{type:'image/png',lastModified:5000+hue*7+(opts.salt||0)});
};
/* what every live panel shows, by file name */
window.shownLive=()=>{ const o={}; FORMATS.forEach(f=>{ const S=state.layouts[f.id].shot, n=Math.max(1,Math.round(S.panels||1)); o[f.id]=[]; for(let p=0;p<n;p++){ const im=shotByIndex(panelSrc(S,p)); const sh=SHOTS.find(x=>x.img===im); o[f.id].push(sh?sh.name:null); } }); return JSON.stringify(o); };
window.shownVar=()=>JSON.stringify((state.variants||[]).map(v=>FORMATS.map(f=>{ const S=v.layouts[f.id].shot, n=Math.max(1,Math.round(S.panels||1)); const a=[]; for(let p=0;p<n;p++){ const im=shotByIndex(panelSrc(S,p)); const sh=SHOTS.find(x=>x.img===im); a.push(sh?sh.name:null);} return a; })));
window.varSrc=()=>JSON.stringify((state.variants||[]).map(v=>FORMATS.map(f=>v.layouts[f.id].shot.src)));
window.cards=()=>[...document.querySelectorAll('#imgs .lib .card')];
window.clickCard=(i,o)=>cards()[i].dispatchEvent(new MouseEvent('click',Object.assign({bubbles:true,cancelable:true},o||{})));
window.toastTxt=()=>{ const t=document.getElementById('toast'); return t.classList.contains('on')?t.textContent:''; };
SHOTS=[];imgShot=null;undoStack.length=0;redoStack.length=0;undoShots.length=0;redoShots.length=0;state.variants=[];state.currentVariant=null;buildControls();render();1`);
  // five images; img_4 only a variant shows
  await ev(`(async()=>{ const F=[]; for(let i=0;i<5;i++) F.push(await mk('img_'+i+'.png',640,360,i*60)); window.F=F;
    await new Promise(r=>addShots(F,r)); return SHOTS.length; })()`);
  await until(async () => (await ev(`cards().length`)) === 5, 'five cards', 8000);
  await until(async () => (await ev(`SHOTS.every(s=>s.thumb)`)), 'thumbs', 8000);
  await ev(`(()=>{
    const A=FORMATS.map(f=>state.layouts[f.id].shot);
    state.active=FORMATS[0].id;
    A[0].panels=1; A[0].src=[0];
    A[1].panels=2; A[1].src=[0,1];
    A[2].panels=1; A[2].src=[-1];
    A[3].panels=3; A[3].src=[1,0,2];
    A[4].panels=1; A[4].src=[4];
    imgShot=SHOTS[0].img;
    variantAdd();                 /* the variant keeps img_4 on format 4 */
    A[4].src=[0];
    buildControls(); render(); undoStack.length=0; undoShots.length=0; redoStack.length=0; redoShots.length=0; updateHistBtns();
    return 1; })()`);
  const f0 = await ev(`FORMATS.map(f=>nomeFormato(f))`);

  // ---- usage text and badges
  const uses = await ev(`(()=>{ const c=cards(); return c.map(x=>({t:x.title.split('\\n').slice(0,2).join(' | '), u:(x.querySelector('.uses')||{}).textContent||''})); })()`);
  R.uses = uses;
  if (!/Used in: /.test(uses[0].t) || !uses[0].t.includes(f0[0])) bad('card 0 title lacks its formats: ' + uses[0].t);
  if (!/Not used$/.test(uses[3].t) || uses[3].u) bad('card 3 should be Not used with no badge: ' + JSON.stringify(uses[3]));
  if (!/Not used$/.test(uses[4].t)) bad('card 4 (variant only) should be Not used in live formats: ' + uses[4].t);
  const n0 = await ev(`usiImmagine(SHOTS[0].img).length`);
  if (String(n0) !== uses[0].u) bad('badge ' + uses[0].u + ' != formats ' + n0);
  const multi = await ev(`testoUsi(usiImmagine(SHOTS[1].img))`);
  if (!/ P\d/.test(multi)) bad('multi-panel usage text lacks panel numbers: ' + multi);

  // ---- Ctrl+click swap
  await ev(`window.__s=document.getElementById('imgs'); 1`);
  const pre = await ev(`({live:shownLive(), vars:shownVar(), vsrc:varSrc(), u:undoStack.length, snap:snapState()})`);
  await ev(`clickCard(2,{ctrlKey:true})`);
  await delay(300);
  const post = await ev(`({live:shownLive(), vars:shownVar(), vsrc:varSrc(), u:undoStack.length, toast:toastTxt(), same:document.getElementById('imgs')===window.__s,
     uses2:(cards()[2].querySelector('.uses')||{}).textContent, t0:cards()[0].title.split('\\n')[1], hasBtn:!!document.querySelector('#toast button')})`);
  R.swap = {toast: post.toast};
  const wantLive = pre.live.split('img_0.png').join('img_2.png');   // every panel that showed img_0 now shows img_2
  if (post.live !== wantLive) bad('live panels after swap: ' + post.live + ' want ' + wantLive);
  if (post.vars !== pre.vars || post.vsrc !== pre.vsrc) bad('swap touched a variant');
  if (post.u !== pre.u + 1) bad('swap should be one undo step: ' + pre.u + ' -> ' + post.u);
  if (!/now show/.test(post.toast) || !post.hasBtn) bad('swap toast: ' + post.toast);
  if (!post.same) bad('strip rebuilt on swap');
  if (post.t0 !== 'Not used') bad('card 0 title not refreshed: ' + post.t0);
  if (!post.uses2) bad('card 2 badge not refreshed');
  await ev(`undo()`); await delay(200);
  const back = await ev(`({live:shownLive(), snap:snapState(), n:SHOTS.length})`);
  if (back.live !== pre.live || back.snap !== pre.snap) bad('undo of swap did not restore');
  // hints: same image, no image
  const u1 = await ev(`undoStack.length`);
  await ev(`clickCard(0,{ctrlKey:true})`); await delay(100);
  const h1 = await ev(`({t:toastTxt(), u:undoStack.length})`);
  if (!/already/.test(h1.t) || h1.u !== u1) bad('same-image hint: ' + JSON.stringify(h1));
  await ev(`(()=>{ window.__keep=imgShot; imgShot=null; state.layouts[state.active].shot.src[0]=-1; clickCard(1,{ctrlKey:true}); })()`); await delay(100);
  const h2 = await ev(`({t:toastTxt(), u:undoStack.length})`);
  await ev(`(()=>{ imgShot=window.__keep; state.layouts[state.active].shot.src[0]=0; return 1; })()`);
  if (!/Put an image/.test(h2.t) || h2.u !== u1) bad('no-image hint: ' + JSON.stringify(h2));
  // plain click still works
  await ev(`clickCard(1)`); await delay(250);
  if ((await ev(`state.layouts[state.active].shot.src[pannelloAttivo(state.layouts[state.active].shot)]`)) !== 1) bad('plain click broken');
  await ev(`undo()`); await delay(150);

  // ---- remove a used image: toast says where it was; undo
  const rm = await ev(`(()=>{ const s0=snapState(); const l0=shownLive(); togliImmagine(0); return {t:toastTxt(), n:SHOTS.length, s0, l0}; })()`);
  if (!/It was in /.test(rm.t) || !/main image/.test(rm.t)) bad('remove toast: ' + rm.t);
  await ev(`undo()`); await delay(200);
  const rb = await ev(`({snap:snapState(), live:shownLive(), n:SHOTS.length})`);
  if (rb.snap !== rm.s0 || rb.n !== 5) bad('undo of remove failed');
  const rm2 = await ev(`(()=>{ togliImmagine(3); return toastTxt(); })()`);
  if (!/^Removed\. \d left/.test(rm2)) bad('remove unused-image toast: ' + rm2);
  await ev(`undo()`); await delay(150);

  // ---- Remove unused
  const un0 = await ev(`(()=>{ const b=document.querySelector('#imgs .ih .rmu'); return {n:indiciNonUsati().join(), hidden:b.hidden, txt:b.textContent, vis:getComputedStyle(b).display}; })()`);
  R.unused = un0;
  if (un0.n !== '3' || un0.hidden || !/3|Unused/.test(un0.txt) || un0.vis === 'none') bad('unused detection: ' + JSON.stringify(un0));
  const pre2 = await ev(`({live:shownLive(), vars:shownVar(), u:undoStack.length, snap:snapState(), main:SHOTS.findIndex(x=>x.img===imgShot)})`);
  await ev(`document.querySelector('#imgs .ih .rmu').click()`); await delay(300);
  const post2 = await ev(`({live:shownLive(), vars:shownVar(), u:undoStack.length, names:SHOTS.map(s=>s.name).join(), toast:toastTxt(), cards:cards().length,
     hidden:document.querySelector('#imgs .ih .rmu').hidden, main:SHOTS.findIndex(x=>x.img===imgShot)})`);
  if (post2.names !== 'img_0.png,img_1.png,img_2.png,img_4.png') bad('remaining images: ' + post2.names);
  if (post2.live !== pre2.live || post2.vars !== pre2.vars) bad('Remove unused changed what a panel shows');
  if (post2.u !== pre2.u + 1) bad('Remove unused should be one undo step');
  if (post2.cards !== 4 || !post2.hidden) bad('strip after Remove unused: ' + JSON.stringify({c: post2.cards, h: post2.hidden}));
  if (!/1 unused image removed/.test(post2.toast)) bad('unused toast: ' + post2.toast);
  await ev(`undo()`); await delay(200);
  const back2 = await ev(`({snap:snapState(), n:SHOTS.length, names:SHOTS.map(s=>s.name).join(), hidden:document.querySelector('#imgs .ih .rmu').hidden})`);
  if (back2.snap !== pre2.snap || back2.n !== 5 || back2.hidden) bad('undo of Remove unused failed: ' + JSON.stringify(back2));
  // nothing unused: the button hides
  await ev(`(()=>{ state.layouts[FORMATS[5].id].shot.src=[3]; state.layouts[FORMATS[5].id].shot.panels=1; state.variants[0].layouts[FORMATS[5].id].shot.src=[3]; buildControls(); return 1; })()`);
  const un1 = await ev(`indiciNonUsati().join()`);
  if (un1 !== '') bad('after using 3 everywhere nothing should be unused, got ' + un1);
  if (!(await ev(`document.querySelector('#imgs .ih .rmu').hidden`))) bad('button should hide with nothing unused');
  await ev(`(()=>{ state.layouts[FORMATS[5].id].shot.src=[-1]; state.variants[0].layouts[FORMATS[5].id].shot.src=[-1]; buildControls(); return 1; })()`);

  // ---- drop a file on a card
  const drop = async (idx, files) => ev(`(async()=>{
    const fs=[]; for(const [n,h,t] of ${JSON.stringify(files)}){ if(t) fs.push(new File(['{}'],n,{type:t})); else fs.push(await mk(n,640,360,h,{salt:9})); }
    const dt=new DataTransfer(); fs.forEach(f=>dt.items.add(f));
    const c=cards()[${idx}];
    const mkEv=t=>new DragEvent(t,{dataTransfer:dt,bubbles:true,cancelable:true});
    c.dispatchEvent(mkEv('dragenter')); c.dispatchEvent(mkEv('dragover'));
    const o={cls:c.classList.contains('replace-target'), txt:document.querySelector('#dropzone span').textContent, on:document.getElementById('dropzone').classList.contains('on')};
    c.dispatchEvent(mkEv('drop'));
    o.clsAfter=cards().some(x=>x.classList.contains('replace-target')); o.on2=document.getElementById('dropzone').classList.contains('on');
    return o; })()`);
  // a json over a card does not mark it
  const dj = await drop(1, [['p.json', 0, 'application/json']]);
  if (dj.cls) bad('json marked a card as replace target');
  await ev(`dropProfondita=0; segnaCarta(null); mostraDrop(false); 1`);
  const preD = await ev(`({snap:snapState(), live:shownLive(), u:undoStack.length, n:SHOTS.length, mainIdx:SHOTS.findIndex(x=>x.img===imgShot)})`);
  const d1 = await drop(1, [['new_one.png', 300]]);
  R.drop = d1;
  if (!d1.cls || !/replace image 2/.test(d1.txt) || !d1.on) bad('dragover feedback: ' + JSON.stringify(d1));
  if (d1.clsAfter || d1.on2) bad('drop did not clear the marks: ' + JSON.stringify(d1));
  await until(async () => (await ev(`SHOTS[1].name`)) === 'new_one.png', 'replace done', 8000);
  await delay(300);
  const postD = await ev(`({snap:snapState(), live:shownLive(), u:undoStack.length, n:SHOTS.length, toast:toastTxt(), cardsN:cards().length,
     bt:!!document.querySelector('#toast button')})`);
  if (postD.snap !== preD.snap) bad('replace changed the assignments');
  if (postD.live !== preD.live.split('img_1.png').join('new_one.png')) bad('panels do not show the new image: ' + postD.live);
  if (postD.u !== preD.u + 1 || postD.n !== preD.n) bad('replace: undo steps/count ' + JSON.stringify(postD));
  if (!/replaced by new_one\.png/.test(postD.toast) || !postD.bt) bad('replace toast: ' + postD.toast);
  await until(async () => (await ev(`SHOTS[1].thumb?1:0`)) === 1, 'thumb of the new image', 8000);
  const thOk = await ev(`(()=>{ const cv=cards()[1].querySelector('canvas'); const d=cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data; let k=0; for(let i=0;i<d.length;i+=4) if(d[i+3]>200&&(d[i]+d[i+1]+d[i+2])>45){k=1;break;} return k; })()`);
  if (!thOk) bad('card of the replaced image has no thumbnail drawn');
  await ev(`undo()`); await delay(250);
  const backD = await ev(`({snap:snapState(), live:shownLive(), name:SHOTS[1].name})`);
  if (backD.snap !== preD.snap || backD.live !== preD.live || backD.name !== 'img_1.png') bad('undo of replace failed: ' + JSON.stringify(backD));
  // the main image follows
  await drop(0, [['new_main.png', 100]]);
  await until(async () => (await ev(`SHOTS[0].name`)) === 'new_main.png', 'replace main', 8000);
  if (!(await ev(`imgShot===SHOTS[0].img`))) bad('imgShot did not follow the replaced main image');
  await ev(`undo()`); await delay(250);
  if (!(await ev(`imgShot===SHOTS[0].img && SHOTS[0].name==='img_0.png'`))) bad('undo of main replace');
  // two files: the first replaces, the second is added
  await drop(2, [['two_a.png', 10], ['two_b.png', 20]]);
  await until(async () => (await ev(`SHOTS.length`)) === 6 && (await ev(`SHOTS[2].name`)) === 'two_a.png', 'replace + add', 8000);
  const names2 = await ev(`SHOTS.map(s=>s.name).join()`);
  if (!/two_b\.png$/.test(names2)) bad('second file not added: ' + names2);
  // a file that is not an image: replace reports, nothing changes
  await ev(`(()=>{ window.__u=undoStack.length; window.__toasts=[]; const o=toast; toast=function(m,op){ window.__toasts.push(String(m)); return o(m,op); }; sostituisciImmagine(0,new File(['not an image'],'bad.png',{type:'image/png'})); return 1; })()`);
  await until(async () => /Could not replace/.test(await ev(`window.__toasts.join('|')`)), 'broken file toast', 40000);
  if ((await ev(`undoStack.length`)) !== (await ev(`window.__u`))) bad('broken replace pushed an undo');

  // ---- persistence of a replacement
  await drop(1, [['persist.png', 250]]);
  await until(async () => (await ev(`SHOTS[1].name`)) === 'persist.png', 'replace for reload', 8000);
  await delay(1000);
  await reload();
  await until(async () => (await ev(`SHOTS.map(s=>s.name).includes('persist.png')`)), 'replaced image back after reload', 20000);
  return R;
};
