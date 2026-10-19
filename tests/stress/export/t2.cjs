'use strict';
// 3D: export one file per image (esportaPerImmagine, runAction('perImage')).
//  - fewer than 2 images: hint toast, no dialog
//  - dialog: one tick per image (all ticked), All/None, live count and button label, Cancel writes nothing
//  - N consecutive files; file k shows image k (centre pixel hue); snapState/undoStack unchanged
//  - Zip mode: files go straight into the export folder; Separate files (3C key): into the {title} subfolder
//  - panel 2 active in a 2-panel layout: only panel 2 changes
//  - renderFormatToBlob without the 3rd argument is unchanged (layout in state used)
//   node tests/stress/run.cjs tests/stress/export/t2.cjs
module.exports = async ({ev, delay, until, log}) => {
  const R = {ok: true, notes: []};
  const bad = (m, v) => { R.ok = false; R.notes.push(m + (v !== undefined ? ' -> ' + JSON.stringify(v).slice(0, 300) : '')); log('FAIL ' + m); };
  await ev(`window.wait=ms=>new Promise(r=>setTimeout(r,ms));
window.COL=['#ff0000','#00ff00','#0000ff','#ffff00'];
window.mk=async(name,col)=>{const c=document.createElement('canvas');c.width=640;c.height=360;const g=c.getContext('2d');g.fillStyle=col;g.fillRect(0,0,640,360);
  const b=await new Promise(r=>c.toBlob(r,'image/png'));return new File([b],name,{type:'image/png',lastModified:5000+name.length*13+col.charCodeAt(1)});};
window.klass=(r,g,b)=>{
  const t=[[255,0,0],[0,255,0],[0,0,255],[255,255,0]];let best=-1,bd=1e9;
  t.forEach((c,i)=>{ const n=Math.max(1,Math.hypot(r,g,b)),m=Math.hypot(...c);const d=Math.hypot(r/n-c[0]/m,g/n-c[1]/m,b/n-c[2]/m); if(d<bd){bd=d;best=i;} });
  return bd<0.35?best:-1; };
window.centre=async(dir,name)=>{const fh=await dir.getFileHandle(name);const bm=await createImageBitmap(await fh.getFile());
  const c=document.createElement('canvas');c.width=bm.width;c.height=bm.height;const g=c.getContext('2d');g.drawImage(bm,0,0);
  const d=g.getImageData(Math.round(bm.width/2),Math.round(bm.height*0.4),1,1).data;return {w:bm.width,h:bm.height,k:klass(d[0],d[1],d[2]),px:[d[0],d[1],d[2]]};};
window.lsDir=async(dir)=>{const o=[];for await(const [n,h] of dir.entries())o.push(h.kind==='directory'?n+'/':n);return o.sort();};
window.freshDir=async()=>{const root=await navigator.storage.getDirectory();for await(const [n] of root.entries())await root.removeEntry(n,{recursive:true});return root;};
window.dlgItems=()=>document.querySelectorAll('#dlg .imgpick .it').length;
window.waitDlg=async(open)=>{for(let i=0;i<100;i++){const h=document.getElementById('dlg');if(!h.hidden===open)return true;await wait(50);}return false;};
SHOTS=[];imgShot=null;buildControls();render();1`);
  // ---- fewer than 2 images
  const few = await ev(`(async()=>{ state.active='yt_thumb'; toast(''); await esportaPerImmagine(); return {dlg:!document.getElementById('dlg').hidden,toast:document.getElementById('toast').textContent}; })()`);
  if (few.dlg || !/at least 2/.test(few.toast)) bad('<2 images', few);
  // ---- 4 images
  await ev(`(async()=>{ const f=[]; for(let i=0;i<4;i++) f.push(await mk('im'+(i+1)+'.png',COL[i])); await new Promise(r=>addShots(f,r)); await scaldaImmagini(); buildFormats(); buildControls(); render(); return SHOTS.length; })()`);
  const n = await ev('SHOTS.length'); if (n !== 4) bad('4 images expected', n);
  await ev(`(async()=>{ const root=await freshDir(); cartellaExport=root; state.active='yt_thumb'; state.export.format='PNG'; delete state.export.bundle; return 1; })()`);
  const snap0 = await ev('snapState()'), und0 = await ev('undoStack.length');
  const hashL = await ev('JSON.stringify(state.layouts)');
  // ---- dialog, cancel
  await ev(`window.__p=esportaPerImmagine(); 1`);
  if (!(await ev('waitDlg(true)'))) bad('dialog did not open');
  const d1 = await ev(`({items:dlgItems(),on:document.querySelectorAll('#dlg .imgpick .it.on').length,title:document.querySelector('#dlg h3').textContent,
    btn:document.querySelector('#dlg .dlg-btns button.primary').textContent,cnt:document.querySelector('#dlg .pibar .cnt').textContent,
    note:document.querySelector('#dlg .dlg-body').textContent.slice(0,140)})`);
  R.dialog = d1;
  if (d1.items !== 4 || d1.on !== 4) bad('4 ticked items', d1);
  if (d1.title !== 'YouTube Thumbnail once per image') bad('title', d1.title);
  if (d1.btn !== 'Export 4 files' || !/4 of 4/.test(d1.cnt)) bad('button/count', d1);
  const d2 = await ev(`(async()=>{ const q=s=>document.querySelector(s); const bs=[...document.querySelectorAll('#dlg .pibar button')];
    bs.find(b=>b.textContent==='None').click(); const a={on:document.querySelectorAll('#dlg .imgpick .it.on').length,btn:q('#dlg .dlg-btns button.primary').textContent,dis:q('#dlg .dlg-btns button.primary').disabled};
    bs.find(b=>b.textContent==='All').click(); const b={on:document.querySelectorAll('#dlg .imgpick .it.on').length,btn:q('#dlg .dlg-btns button.primary').textContent,dis:q('#dlg .dlg-btns button.primary').disabled};
    document.querySelectorAll('#dlg .imgpick .it')[2].click(); const c={on:document.querySelectorAll('#dlg .imgpick .it.on').length,btn:q('#dlg .dlg-btns button.primary').textContent,cnt:q('#dlg .pibar .cnt').textContent};
    document.querySelectorAll('#dlg .imgpick .it')[2].click(); return {a,b,c}; })()`);
  if (d2.a.on !== 0 || d2.a.btn !== 'Export 0 files' || !d2.a.dis) bad('None', d2.a);
  if (d2.b.on !== 4 || d2.b.dis) bad('All', d2.b);
  if (d2.c.on !== 3 || d2.c.btn !== 'Export 3 files' || !/3 of 4/.test(d2.c.cnt)) bad('untick one', d2.c);
  // thumbs are drawn (not black) once ready
  const th = await ev(`(async()=>{ await wait(300); return [...document.querySelectorAll('#dlg .imgpick canvas')].map(c=>{const d=c.getContext('2d').getImageData(64,36,1,1).data;return d[0]+d[1]+d[2]>60;}); })()`);
  if (!th.every(Boolean)) bad('thumbnails not drawn in the picker', th);
  await ev(`[...document.querySelectorAll('#dlg .dlg-btns button')].find(b=>b.textContent==='Cancel').click(); 1`);
  await ev('__p');
  const afterCancel = await ev(`lsDir(cartellaExport)`);
  if (afterCancel.length) bad('cancel wrote files', afterCancel);
  // ---- export all 4 (Zip mode / key missing): straight into the export folder
  await ev(`window.__p=esportaPerImmagine(); 1`); await ev('waitDlg(true)');
  await ev(`document.querySelector('#dlg .dlg-btns button.primary').click(); 1`);
  await ev('__p');
  const files1 = await ev('lsDir(cartellaExport)');
  R.zipMode = files1;
  if (files1.length !== 4 || files1.some(f => /\/$/.test(f))) bad('4 files at top level', files1);
  const num = f => +(/_(\d+)\./.exec(f) || [])[1];
  const nums = files1.map(num).sort((a, b) => a - b);
  if (nums.join() !== '1,2,3,4') bad('consecutive numbering', nums);
  const ks = [];
  for (const f of files1.slice().sort((a, b) => num(a) - num(b))) ks.push(await ev(`centre(cartellaExport,${JSON.stringify(f)})`));
  R.centres = ks.map(x => x.k);
  if (ks.map(x => x.k).join() !== '0,1,2,3') bad('file k shows image k', ks);
  if (ks.some(x => x.w !== 1920 || x.h !== 1080)) bad('size', ks);
  const toastEnd = await ev(`document.getElementById('toast').textContent`);
  if (!/^4 files exported/.test(toastEnd)) bad('final toast', toastEnd);
  if ((await ev('snapState()')) !== snap0) bad('snapState changed');
  if ((await ev('undoStack.length')) !== und0) bad('undo entry added', [und0, await ev('undoStack.length')]);
  if ((await ev('JSON.stringify(state.layouts)')) !== hashL) bad('layouts mutated');
  // ---- subset: untick image 2 and 4, Separate files mode into the {title} subfolder
  await ev(`(async()=>{ const root=await freshDir(); cartellaExport=root; state.export.bundle='Separate files'; state.pack.title='My Pack'; state.naming.folder='{title}'; return 1; })()`);
  await ev(`window.__p=esportaPerImmagine(); 1`); await ev('waitDlg(true)');
  await ev(`(()=>{ const it=document.querySelectorAll('#dlg .imgpick .it'); it[1].click(); it[3].click(); document.querySelector('#dlg .dlg-btns button.primary').click(); return 1; })()`);
  await ev('__p');
  const top = await ev('lsDir(cartellaExport)');
  R.sepTop = top;
  if (top.length !== 1 || !/\/$/.test(top[0])) bad('one subfolder', top);
  else {
    const sub = top[0].replace(/\/$/, '');
    const inside = await ev(`(async()=>{ const d=await cartellaExport.getDirectoryHandle(${JSON.stringify(sub)}); return lsDir(d); })()`);
    R.sepInside = inside;
    if (inside.length !== 2) bad('2 files in subfolder', inside);
    const k2 = [];
    for (const f of inside) k2.push((await ev(`(async()=>{ const d=await cartellaExport.getDirectoryHandle(${JSON.stringify(sub)}); return centre(d,${JSON.stringify(f)}); })()`)).k);
    if (k2.sort().join() !== '0,2') bad('subset shows images 1 and 3', k2);
  }
  // ---- 2 panels, panel 2 active: only panel 2 changes
  const p2 = await ev(`(async()=>{ const root=await freshDir(); cartellaExport=root; state.export.bundle='Zip file';
    const S=state.layouts.yt_thumb.shot; S.panels=2; S.active=1; S.src=[0,1,2,3,4,5]; render();
    const before=JSON.stringify(state.layouts.yt_thumb);
    window.__p=esportaPerImmagine(); await waitDlg(true);
    const it=document.querySelectorAll('#dlg .imgpick .it'); it[1].click(); it[3].click();
    document.querySelector('#dlg .dlg-btns button.primary').click(); await __p;
    const names=await lsDir(root); const out=[];
    for(const f of names){ const fh=await root.getFileHandle(f); const bm=await createImageBitmap(await fh.getFile());
      const c=document.createElement('canvas');c.width=bm.width;c.height=bm.height;const g=c.getContext('2d');g.drawImage(bm,0,0);
      const L=g.getImageData(Math.round(bm.width*0.15),Math.round(bm.height*0.4),1,1).data,Rr=g.getImageData(Math.round(bm.width*0.85),Math.round(bm.height*0.4),1,1).data;
      out.push([f,klass(L[0],L[1],L[2]),klass(Rr[0],Rr[1],Rr[2])]); }
    return {names,out,unchanged:JSON.stringify(state.layouts.yt_thumb)===before}; })()`);
  R.panel2 = p2.out;
  if (!p2.unchanged) bad('layout changed by panel 2 export', p2);
  const ordered = p2.out.slice().sort((a, b) => num(a[0]) - num(b[0]));
  if (ordered.length !== 2 || ordered[0][1] !== 0 || ordered[0][2] !== 0 || ordered[1][1] !== 0 || ordered[1][2] !== 2) bad('panel 2 only changes (left stays image 1, right = 1 then 3)', ordered);
  // ---- renderFormatToBlob without 3rd arg uses state
  const same = await ev(`(async()=>{ const f=FORMATS.find(x=>x.id==='unity_card'); const a=await new Promise(r=>renderFormatToBlob(f,r));
    const L=JSON.parse(JSON.stringify(state.layouts.unity_card)); const b=await new Promise(r=>renderFormatToBlob(f,r,L));
    const ha=new Uint8Array(await crypto.subtle.digest('SHA-256',await a.arrayBuffer())).join(),hb=new Uint8Array(await crypto.subtle.digest('SHA-256',await b.arrayBuffer())).join(); return ha===hb; })()`);
  if (!same) bad('renderFormatToBlob(f,cb) != renderFormatToBlob(f,cb,copy of state layout)');
  // ---- runAction route + segnaExport guard
  const ra = await ev(`(async()=>{ const root=await freshDir(); cartellaExport=root; state.export.bundle='Zip file'; state.layouts.yt_thumb.shot.panels=1; state.layouts.yt_thumb.shot.active=0;
    const calls=[]; window.segnaExport=function(o){calls.push(o);}; runAction('perImage'); await waitDlg(true);
    document.querySelector('#dlg .dlg-btns button.primary').click();
    for(let i=0;i<200 && (await lsDir(root)).length<4;i++) await wait(50);
    await wait(300); delete window.segnaExport; return {calls,n:(await lsDir(root)).length}; })()`);
  R.segna = ra.calls[0] && {n: ra.calls[0].n, dove: ra.calls[0].dove, nomi: ra.calls[0].nomi.length};
  if (ra.n !== 4 || ra.calls.length !== 1 || ra.calls[0].n !== 4 || ra.calls[0].nomi.length !== 4) bad('runAction + segnaExport', ra);
  return R;
};
