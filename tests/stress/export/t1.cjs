'use strict';
// 3C: Export all as Zip file | Separate files, Fab checks, Last export row, left-out formats in the toast,
// bundle in snapState / old files default to Zip, vanished folder forgotten. Pickers are replaced by OPFS handles
// (cartellaExport). Run: node tests/stress/run.cjs tests/stress/export/t1.cjs
module.exports = async ({ev, log, delay}) => {
  const R = {ok: true, notes: []};
  const bad = m => { R.ok = false; R.notes.push(m); log('FAIL ' + m); };
  const chk = (c, m) => { if (!c) bad(m); };

  await ev(`window.wait=ms=>new Promise(r=>setTimeout(r,ms));
window.rootFresh=async()=>{ const r=await navigator.storage.getDirectory(); for await (const [n] of r.entries()) await r.removeEntry(n,{recursive:true}); const d=await r.getDirectoryHandle('Exports',{create:true}); cartellaExport=d; return d; };
window.lista=async(d,pre)=>{ const out=[]; for await (const [n,h] of d.entries()){ if(h.kind==='directory') out.push(...await lista(h,(pre||'')+n+'/')); else out.push((pre||'')+n); } return out.sort(); };
window.zipNames=async(d,nome)=>{ const f=await (await d.getFileHandle(nome)).getFile(); const u=new Uint8Array(await f.arrayBuffer()); const dv=new DataView(u.buffer); const out=[]; let p=0;
  while(p+30<=u.length && dv.getUint32(p,true)===0x04034b50){ const sz=dv.getUint32(p+18,true), n=dv.getUint16(p+26,true), m=dv.getUint16(p+28,true); out.push(new TextDecoder().decode(u.slice(p+30,p+30+n))); p+=30+n+m+sz; } return out; };
window.mk=async(name,w,h,noise)=>{ const c=document.createElement('canvas'); c.width=w; c.height=h; const g=c.getContext('2d');
  if(noise){ const id=g.createImageData(w,h); for(let i=0;i<id.data.length;i++) id.data[i]=(i%4===3)?255:Math.random()*255; g.putImageData(id,0,0); }
  else { g.fillStyle='#3a6ea5'; g.fillRect(0,0,w,h); g.fillStyle='#e8b04a'; g.fillRect(w*.2,h*.2,w*.4,h*.4); }
  const b=await new Promise(r=>c.toBlob(r,'image/png')); return new File([b],name,{type:'image/png',lastModified:5000+w}); };
window.toastTxt=()=>document.getElementById('toast').textContent;
1`);

  const ticked = await ev(`(()=>{ FORMATS.forEach(f=> state.layouts[f.id].on = true); return FORMATS.map(f=>f.id); })()`);
  chk(ticked.length === 8, 'expected 8 formats, got ' + ticked.length);
  await ev(`(async()=>{ SHOTS=[]; imgShot=null; const fa=await mk('a.png',1600,900,false); await new Promise(r=>addShots([fa],()=>r())); render(); return 1; })()`);

  // ---- default is Zip file; state carries bundle; row exists
  R.def = await ev(`({bundle: state.export.bundle, snap: JSON.parse(snapState()).export.bundle, rows: EXPORT_SECTION.rows.map(r=>r.type+':'+(r.p||r.act||'')).join(' ')})`);
  chk(R.def.bundle === 'Zip file' && R.def.snap === 'Zip file', 'default bundle not Zip file: ' + JSON.stringify(R.def));
  chk(/^lastexport: /.test(R.def.rows), 'lastexport is not the first row: ' + R.def.rows);
  chk(/select:export.bundle/.test(R.def.rows) && /button:perImage/.test(R.def.rows), 'bundle select or perImage button missing');

  // ---- Zip mode: same entry names/order as the ticked formats, one zip in the export folder root
  R.zip = await ev(`(async()=>{ const d=await rootFresh(); await document.getElementById('bZip').onclick();
    const files=await lista(d); const expect=FORMATS.filter(f=>state.layouts[f.id].on).map(f=>folderFor(f,state.pack,1)+fileNameFor(f,state.pack,1));
    const z=files.filter(n=>/\\.zip$/.test(n)); const names=z.length===1?await zipNames(d,z[0]):[];
    return {files, expect, names, toast: toastTxt(), last: ULTIMO_EXPORT && ULTIMO_EXPORT.n}; })()`);
  chk(R.zip.files.length === 1 && /\.zip$/.test(R.zip.files[0]), 'zip mode did not write exactly one zip: ' + JSON.stringify(R.zip.files));
  chk(JSON.stringify(R.zip.names) === JSON.stringify(R.zip.expect), 'zip entries differ from expected order/names: ' + JSON.stringify(R.zip.names));
  chk(/8 images exported in /.test(R.zip.toast), 'zip toast: ' + R.zip.toast);
  chk(R.zip.last === 8, 'segnaExport after zip');

  // ---- left-out formats in the toast (Zip) and the Last export row
  R.fuori = await ev(`(async()=>{ const d=await rootFresh(); state.layouts.unity_card.on=false; state.layouts.unity_icon.on=false;
    await document.getElementById('bZip').onclick(); const t=toastTxt();
    typeof vaiScheda==='function' && vaiScheda('out'); buildControls();
    const row=document.querySelector('.lastexp'); const txt=row?row.textContent:null; const disp=row?getComputedStyle(row).display:null;
    state.layouts.unity_card.on=true; state.layouts.unity_icon.on=true;
    return {t, txt, disp, secs:[...document.querySelectorAll('#controls .sec, .secHead, .sec-head')].length}; })()`);
  chk(/6 images exported/.test(R.fuori.t) && /\(.*Card.*Icon.* not ticked\)/.test(R.fuori.t), 'left-out formats missing from toast: ' + R.fuori.t);
  chk(R.fuori.txt && /^Last export \d\d:\d\d . 6 images . /.test(R.fuori.txt), 'Last export row text: ' + R.fuori.txt);
  chk(R.fuori.disp && R.fuori.disp !== 'none', 'Last export row hidden');

  // ---- Separate files: N files in Exports/{title}, numbering per folder, second run -> _2
  R.sep = await ev(`(async()=>{ const d=await rootFresh(); state.export.bundle='Separate files';
    await document.getElementById('bZip').onclick(); const f1=await lista(d); const t1=toastTxt();
    await document.getElementById('bZip').onclick(); const f2=await lista(d);
    return {f1, t1, f2, sub: folderFor(FORMATS[0],state.pack,1)}; })()`);
  chk(R.sep.f1.length === 8 && R.sep.f1.every(n => /^Realistic_Impacts_Pack\/[^/]+_1\.png$/.test(n)), 'separate files layout: ' + JSON.stringify(R.sep.f1));
  chk(R.sep.f2.length === 16 && R.sep.f2.filter(n => /_2\.png$/.test(n)).length === 8, 'second run did not number _2: ' + JSON.stringify(R.sep.f2));
  chk(/8 images exported to Exports\/Realistic_Impacts_Pack/.test(R.sep.t1), 'separate toast: ' + R.sep.t1);
  chk(!R.sep.f1.some(n => /\.zip$/.test(n)), 'a zip was written in Separate mode');

  // ---- Export current: Separate -> subfolder, Zip -> export folder root
  R.cur = await ev(`(async()=>{ const d=await rootFresh(); state.export.bundle='Separate files'; await document.getElementById('bExp').onclick(); const a=await lista(d); const ta=toastTxt();
    state.export.bundle='Zip file'; await document.getElementById('bExp').onclick(); const b=await lista(d);
    return {a, ta, b}; })()`);
  chk(R.cur.a.length === 1 && /^Realistic_Impacts_Pack\/.+_1\.png$/.test(R.cur.a[0]), 'export current separate: ' + JSON.stringify(R.cur.a));
  chk(R.cur.b.length === 2 && R.cur.b.some(n => /^[^/]+_1\.png$/.test(n)), 'export current zip mode writes to the root: ' + JSON.stringify(R.cur.b));

  // ---- empty folder naming: Separate with naming.folder '' writes into the export folder itself
  R.flat = await ev(`(async()=>{ const d=await rootFresh(); state.export.bundle='Separate files'; const keep=state.naming.folder; state.naming.folder='';
    await document.getElementById('bZip').onclick(); const f=await lista(d); state.naming.folder=keep; state.export.bundle='Zip file'; return f; })()`);
  chk(R.flat.length === 8 && R.flat.every(n => !n.includes('/')), 'empty folder name should write flat: ' + JSON.stringify(R.flat));

  // ---- Fab checks: webp with Fab ticked -> preflight error per Fab format; >3 MiB Fab warning
  R.fab = await ev(`(async()=>{ const keep=state.export.format; state.export.format='WebP';
    const p1=preflight().filter(x=>/Fab accepts PNG or JPEG only/.test(x.testo)); const ids=p1.map(x=>x.id).sort();
    state.layouts.fab_thumb.on=false; state.layouts.fab_gallery.on=false;
    const p2=preflight().filter(x=>/Fab accepts/.test(x.testo)).length;
    state.layouts.fab_thumb.on=true; state.layouts.fab_gallery.on=true; state.export.format=keep;
    const p3=preflight().filter(x=>/Fab accepts/.test(x.testo)).length;
    return {ids, tipo:p1.map(x=>x.tipo), p2, p3}; })()`);
  chk(JSON.stringify(R.fab.ids) === '["fab_gallery","fab_thumb"]' && R.fab.tipo.every(t => t === 'errore'), 'Fab webp preflight: ' + JSON.stringify(R.fab));
  chk(R.fab.p2 === 0 && R.fab.p3 === 0, 'Fab preflight should be silent when not webp / not ticked');

  R.fabBig = await ev(`(async()=>{ SHOTS=[]; imgShot=null; const fn=await mk('n.png',1920,1080,true); await new Promise(r=>addShots([fn],()=>r()));
    const L=state.layouts.fab_thumb; L.shot.panels=1; L.shot.src=[0]; state.active='fab_thumb'; render();
    const d=await rootFresh(); state.export.bundle='Separate files';
    const blob=await new Promise(r=>renderFormatToBlob(FORMATS.find(f=>f.id==='fab_thumb'),r));
    const av=avvisoFab(FORMATS.find(f=>f.id==='fab_thumb'),blob); const avCard=avvisoFab(FORMATS.find(f=>f.id==='unity_cover'),blob);
    await document.getElementById('bExp').onclick(); const t=toastTxt(); const last=ULTIMO_EXPORT;
    state.export.bundle='Zip file';
    return {size:blob.size, av, avCard, t, avvisi:last&&last.avvisi, kind:document.getElementById('toast').className}; })()`);
  chk(R.fabBig.size > 3 * 1048576 ? /Fab asks for under 3 MB/.test(R.fabBig.av) : true, 'Fab size warning: ' + JSON.stringify(R.fabBig));
  chk(R.fabBig.size > 3 * 1048576, 'noise image did not exceed 3 MiB (' + R.fabBig.size + '): the test cannot check the warning');
  chk(R.fabBig.avCard === '', 'non-Fab formats must not warn');
  chk(/Fab asks for under 3 MB/.test(R.fabBig.t) && R.fabBig.avvisi && R.fabBig.avvisi.length === 1, 'Export current Fab toast/last: ' + JSON.stringify(R.fabBig));

  // ---- bundle in project/autosave: snapState carries it, applySnap restores it; old files without it -> Zip
  R.mig = await ev(`(()=>{ state.export.bundle='Separate files'; const s=snapState(); const o=JSON.parse(s).export.bundle;
    state.export.bundle='Zip file'; applySnap(s); const back=state.export.bundle;
    const old=JSON.parse(s); delete old.export.bundle; state.export.bundle='Separate files'; applySnap(JSON.stringify(old)); const oldBack=state.export.bundle;
    state.export.bundle='Zip file'; return {o, back, oldBack}; })()`);
  chk(R.mig.o === 'Separate files' && R.mig.back === 'Separate files', 'bundle not carried by snapState/applySnap: ' + JSON.stringify(R.mig));
  chk(R.mig.oldBack === 'Zip file', 'an old file without bundle must open as Zip file: ' + JSON.stringify(R.mig));
  R.proj = await ev(`(async()=>{ state.export.bundle='Separate files'; const text=await testoProgetto(); const has=JSON.parse(text).export; state.export.bundle='Zip file';
    caricaPresetFile(new File([text],'p.json',{type:'application/json'})); await wait(1500); const after=state.export.bundle;
    const old=JSON.parse(text); delete old.export.bundle; state.export.bundle='Separate files';
    caricaPresetFile(new File([JSON.stringify(old)],'o.json',{type:'application/json'})); await wait(1500);
    const afterOld=state.export.bundle; state.export.bundle='Zip file'; return {has:has&&has.bundle, after, afterOld}; })()`);
  chk(R.proj.has === 'Separate files' && R.proj.after === 'Separate files', 'project file does not carry bundle: ' + JSON.stringify(R.proj));
  chk(R.proj.afterOld === 'Zip file', 'old project must open as Zip file: ' + JSON.stringify(R.proj));

  // ---- the select row works and is undoable; reload keeps the autosaved bundle
  R.sel = await ev(`(async()=>{ typeof vaiScheda==='function' && vaiScheda('out'); buildControls();
    const s=[...document.querySelectorAll('select')].find(x=>[...x.options].some(o=>o.value==='Separate files'));
    if(!s) return {found:false}; s.value='Separate files'; s.dispatchEvent(new Event('change',{bubbles:true})); await wait(50);
    const a=state.export.bundle; undo(); await wait(50); const b=state.export.bundle; return {found:true,a,b}; })()`);
  chk(R.sel.found && R.sel.a === 'Separate files' && R.sel.b === 'Zip file', 'select row/undo: ' + JSON.stringify(R.sel));

  // ---- vanished export folder is forgotten in Separate mode
  R.gone = await ev(`(async()=>{ const root=await navigator.storage.getDirectory(); for await (const [n] of root.entries()) await root.removeEntry(n,{recursive:true});
    const d=await root.getDirectoryHandle('Gone',{create:true}); cartellaExport=d; await root.removeEntry('Gone',{recursive:true});
    state.export.bundle='Separate files'; await document.getElementById('bZip').onclick(); const t=toastTxt(); const forgot=cartellaExport===null;
    state.export.bundle='Zip file'; return {t, forgot}; })()`);
  chk(R.gone.forgot, 'vanished folder not forgotten: ' + JSON.stringify(R.gone));
  chk(/Export failed/.test(R.gone.t), 'no failure toast for a vanished folder: ' + R.gone.t);

  // ---- perImage button: clicking it in this copy does nothing harmful
  R.per = await ev(`(async()=>{ const before=snapState(); typeof vaiScheda==='function' && vaiScheda('out'); buildControls();
    const b=[...document.querySelectorAll('button')].find(x=>/Export one file per image/.test(x.textContent)); if(!b) return {found:false};
    b.click(); await wait(300); return {found:true, same: snapState()===before}; })()`);
  chk(R.per.found && R.per.same, 'perImage button: ' + JSON.stringify(R.per));

  const errs = await ev('qaErrors');
  chk(!errs.length, 'page errors: ' + JSON.stringify(errs));
  return R;
};
