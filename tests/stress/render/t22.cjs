'use strict';
// 3A: copy image setup (Same shape formats / All other formats) from Image > Screenshot.
//   node tests/stress/run.cjs tests/stress/render/t22.cjs
const {setup} = require('./common.cjs');
module.exports = async ({ev}) => {
  const res = {ok: true};
  const fail = (k, v) => { res.ok = false; res[k] = v === undefined ? 1 : v; };
  await setup(ev);
  // Cover (3:2): the only same-shape format is Card. Make every layout distinguishable first.
  await ev(`(()=>{
    FORMATS.forEach((f,i)=>{ const L=state.layouts[f.id]; L.shot.panels=1+(i%3); L.shot.rot[0]=i; L.fx.blur=0.001*i; L.grad.on=(i%2===0); });
    state.active='unity_cover';
    const S=state.layouts.unity_cover; S.shot.panels=3; S.shot.src=[2,1,0,3,4,5]; S.shot.active=1;
    S.shot.rot=[7,-3,2,0,0,0]; S.shot.sc=[1.3,0.9,1.1,1,1,1]; S.shot.px=[0.4,0.55,0.6,0.5,0.5,0.5]; S.shot.fit='contain';
    S.fx.blur=0.012; S.fx.zoomBlur=0.3; S.fx.edgeBlur=0.4; S.fx.vignette=0.5; S.fx.tintOn=true; S.fx.tintColor='#336699';
    S.grad.on=true; S.grad.side='top'; S.grad.size=0.31; S.grad.strength=0.66;
    buildFormats(); buildControls(); vaiScheda('image'); return 1; })()`);
  const strip = id => `(()=>{ const L=JSON.parse(JSON.stringify(state.layouts['${id}'])); delete L.shot; delete L.fx; delete L.grad; return JSON.stringify(L); })()`;
  const img = id => `JSON.stringify([state.layouts['${id}'].shot,state.layouts['${id}'].fx,state.layouts['${id}'].grad])`;
  const ids = await ev(`FORMATS.map(f=>f.id)`);
  const toast = () => ev(`document.getElementById('toast').textContent`);
  const click = txt => ev(`(()=>{ const b=[...document.querySelectorAll('#controls button')].find(b=>b.textContent==='${txt}'); b.click(); return 1; })()`);
  const goto = id => ev(`state.active='${id}'; buildFormats(); buildControls(); vaiScheda('image'); 1`);
  const nonImg = {}, imgs = {};
  for (const id of ids) { nonImg[id] = await ev(strip(id)); imgs[id] = await ev(img(id)); }
  const srcImg = imgs.unity_cover;

  // rows exist in the Screenshot section, before "Images in the panels"
  const rows = await ev(`(()=>{ const sec=[...document.querySelectorAll('#controls .sec')].find(s=>s.dataset.title==='Screenshot');
    return [...sec.querySelectorAll('.bd > *')].map(e=> e.querySelector('button') ? 'B:'+e.querySelector('button').textContent : e.textContent); })()`);
  res.rows = rows;
  const iC = rows.findIndex(x => /Copy to other formats/.test(x)), iP = rows.findIndex(x => /Images in the panels/.test(x));
  if (iC < 0 || iP < 0 || iC > iP || rows[iC + 1] !== 'B:Same shape formats' || rows[iC + 2] !== 'B:All other formats') fail('rows', rows);
  const tip = await ev(`[...document.querySelectorAll('#controls button')].filter(b=>/Same shape|All other/.test(b.textContent)).map(b=>b.title.length)`);
  if (tip.length !== 2 || tip.some(x => !x)) fail('tooltips', tip);

  // ---- 1. Same shape: only Card
  const u0 = await ev(`undoStack.length`);
  await click('Same shape formats');
  const t1 = await toast(); res.t1 = t1;
  if (!/^Image setup copied to Card/.test(t1) || !/Undo/.test(t1)) fail('toastSimilar', t1);
  if (await ev(`undoStack.length`) !== u0 + 1) fail('undoSteps');
  for (const id of ids) {
    if (await ev(strip(id)) !== nonImg[id]) fail('nonImageChanged_' + id);
    const now = await ev(img(id));
    if (id === 'unity_card') { if (now !== srcImg) fail('cardNotCopied'); }
    else if (now !== imgs[id]) fail('otherTouched_' + id);
  }
  // deep copy: editing the target must not change the source
  await ev(`state.layouts.unity_card.shot.rot[0]=99; state.layouts.unity_card.shot.src[0]=5; 1`);
  if (await ev(`state.layouts.unity_cover.shot.rot[0]`) !== 7 || await ev(`state.layouts.unity_cover.shot.src[0]`) !== 2) fail('notDeep');
  // toast Undo button = one step back
  await ev(`document.querySelector('#toast button')`); // (toast is gone from the DOM state by now? button may still exist)
  await ev(`undo(); 1`);
  if (await ev(img('unity_card')) !== imgs.unity_card) fail('undoRestoresCard');
  if (await ev(strip('unity_card')) !== nonImg.unity_card) fail('undoRestoresCardOverlay');

  // real Undo button path
  await goto('unity_cover');
  await click('Same shape formats');
  await ev(`document.querySelector('#toast button').click()`);
  if (await ev(img('unity_card')) !== imgs.unity_card) fail('toastUndoButton');

  // ---- 2. All other formats
  const u2 = await ev(`undoStack.length`);
  await click('All other formats');
  const t2 = await toast(); res.t2 = t2;
  if (!/^Image setup copied to 7 formats/.test(t2)) fail('toastAll', t2);
  if (await ev(`undoStack.length`) !== u2 + 1) fail('undoStepsAll');
  for (const id of ids) {
    if (await ev(strip(id)) !== nonImg[id]) fail('nonImageChangedAll_' + id);
    if (await ev(img(id)) !== srcImg) fail('allNotCopied_' + id);
  }
  await goto('unity_card'); await ev(`render(); 1`);
  const nonBlank = await ev(`(()=>{ const c=document.querySelector('#cvwrap canvas'); if(!c) return -1; const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data; let n=0; for(let i=0;i<d.length;i+=200) if(d[i]+d[i+1]+d[i+2]>30) n++; return n; })()`);
  if (!(nonBlank > 10)) fail('cardBlank', nonBlank);
  await ev(`undo(); 1`);
  for (const id of ids) {
    if (await ev(strip(id)) !== nonImg[id]) fail('undoAllNonImage_' + id);
    if (await ev(img(id)) !== imgs[id]) fail('undoAllRestore_' + id);
  }

  // ---- 3. No similar format: Icon (1:1)
  await goto('unity_icon');
  const u3 = await ev(`undoStack.length`), snap3 = await ev(`snapState()`);
  await click('Same shape formats');
  const t3 = await toast(); res.t3 = t3;
  if (!/No other format has the same shape/.test(t3) || !/All other formats/.test(t3)) fail('toastNone', t3);
  if (await ev(`undoStack.length`) !== u3) fail('undoOnNone');
  if (await ev(`snapState()`) !== snap3) fail('stateOnNone');

  // ---- 4. Asset page (4K or 1080p, 16:9) -> YouTube + both Fab formats
  await goto('unity_shot');
  const before4 = {}; for (const id of ids) before4[id] = await ev(img(id));
  await click('Same shape formats');
  const t4 = await toast(); res.t4 = t4;
  if (!/^Image setup copied to YouTube Thumbnail, Fab Thumbnail, Gallery/.test(t4)) fail('toast16x9', t4);
  const s4 = await ev(img('unity_shot'));
  for (const id of ['yt_thumb', 'fab_thumb', 'fab_gallery']) if (await ev(img(id)) !== s4) fail('16x9_' + id);
  for (const id of ['unity_cover', 'unity_card', 'unity_icon', 'unity_social']) if (await ev(img(id)) !== before4[id]) fail('16x9Touched_' + id);

  // ---- 5. bAll confirm text points to the new buttons
  const txt = await ev(`(async()=>{ const p = document.getElementById('bAll').onclick(); await new Promise(r=>setTimeout(r,100)); const m = (document.getElementById('dlg')||document.body).textContent; document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); await p; return m; })()`);
  if (!/Image > Screenshot > Copy to other formats/.test(txt)) fail('bAllText', txt);
  const errs = await ev(`window.qaErrors`);
  if (errs.length) fail('pageErrors', errs);
  return res;
};
