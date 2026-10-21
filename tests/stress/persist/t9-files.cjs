'use strict';
// Z1 (1.8.0): data, files, undo.
//  - a screenshot rewritten on disk after it was added: Save (testoProgetto) and the IndexedDB write still work,
//    and no wrong "not enough room" toast
//  - rescan of a folder with a retaken screenshot: no duplicate, "Replace N changed images" action replaces in place
//    (assignments kept), one Undo step; new files are added; skipped Edit copies are mentioned
//  - PREVOLO / Last export cleared on Open, New from this pack, applySnap of another pack; notes of unticked
//    formats are not listed
//  - undo / redo toasts carry the label; labels live outside snapState
//  - Desktop file name = title + file name (and the real button passes it)
//  - file inputs reset .value; quota only for QuotaExceededError; meta helpers; image-file test
// Run: APP_ROOT=<copy> PORT=<port> node tests/stress/run.cjs tests/stress/persist/t9-files.cjs
module.exports = async ({ev, log, delay, until}) => {
  const R = {ok: true, notes: []};
  const bad = m => { R.ok = false; R.notes.push(m); log('FAIL ' + m); };
  const toastText = () => ev(`document.getElementById('toast').textContent`);
  const toastBtn = label => ev(`(()=>{const b=[...document.querySelectorAll('#toast button')].find(x=>x.textContent.indexOf(${JSON.stringify(label)})===0);return b?b.textContent:null;})()`);
  const clickToastBtn = label => ev(`(()=>{const b=[...document.querySelectorAll('#toast button')].find(x=>x.textContent.indexOf(${JSON.stringify(label)})===0);if(!b)return false;b.click();return true;})()`);
  await ev(`window.wait=ms=>new Promise(r=>setTimeout(r,ms));
window.mk=async(name,w,h,hue,rel)=>{
  const c=document.createElement('canvas');c.width=w;c.height=h;const g=c.getContext('2d');
  const gr=g.createLinearGradient(0,0,w,h);gr.addColorStop(0,'hsl('+hue+',70%,35%)');gr.addColorStop(1,'hsl('+((hue+80)%360)+',70%,60%)');
  g.fillStyle=gr;g.fillRect(0,0,w,h);g.fillStyle='#fff';g.font=(h/6)+'px sans-serif';g.fillText(name+hue,w*0.1,h*0.5);
  const b=await new Promise(r=>c.toBlob(r,'image/png'));
  const f=new File([b],name,{type:'image/png',lastModified:100000+hue*13+w});
  if(rel)Object.defineProperty(f,'webkitRelativePath',{value:rel});
  return f;
};
SHOTS=[];imgShot=null;buildControls();render();1`);

  // ---------------------------------------------------------------- 1. file overwritten on disk after adding
  const stale = await ev(`(async()=>{
    const root=await navigator.storage.getDirectory();
    const fh=await root.getFileHandle('z1-retake.png',{create:true});
    const put=async f=>{const w=await fh.createWritable();await w.write(f);await w.close();};
    const f1=await mk('z1-retake.png',640,360,30);await put(f1);
    const lazy=await fh.getFile();
    SHOTS=[];imgShot=null;
    await new Promise(r=>addShots([lazy],r));
    // the screenshot is retaken in Unity: same name, new bytes
    const f2=await mk('z1-retake.png',800,450,200);await put(f2);
    const out={added:SHOTS.length};
    try{ const t=await testoProgetto(); out.saveOk=true; out.hasData=t.indexOf('"data":"')>0; }
    catch(e){ out.saveOk=false; out.saveErr=String(e&&e.name)+': '+(e&&e.message); }
    dbAvvisato=false;
    dbSalvaOra();
    await wait(900);
    const d=await dbApri();
    out.idbRows=await new Promise(r=>{const q=d.transaction('shots').objectStore('shots').getAll();q.onsuccess=()=>r(q.result.length);q.onerror=()=>r(-1);});
    out.avvisato=dbAvvisato;
    out.blobIsFile=SHOTS[0]&&SHOTS[0].blob instanceof File;
    return out;
  })()`);
  R.stale = stale; log('stale', JSON.stringify(stale));
  if (stale.added !== 1) bad('stale: image not added ' + JSON.stringify(stale));
  if (!stale.saveOk || !stale.hasData) bad('stale: Save failed after the file was rewritten on disk: ' + stale.saveErr);
  if (stale.idbRows !== 1) bad('stale: IndexedDB rows ' + stale.idbRows);
  if (stale.avvisato) bad('stale: the "could not keep the images" warning fired');
  const t1 = await toastText();
  if (/not enough room/.test(t1)) bad('stale: wrong quota toast: ' + t1);

  // ---------------------------------------------------------------- 7. error causes
  const causes = await ev(`(()=>{
    const o={};
    dbAvvisato=false; avvisaDb({name:'QuotaExceededError'}); o.quota=document.getElementById('toast').textContent;
    dbAvvisato=false; avvisaDb({name:'NotReadableError'}); o.nr=document.getElementById('toast').textContent;
    dbAvvisato=false; avvisaDb({name:'DataError',message:'bad key'}); o.other=document.getElementById('toast').textContent;
    dbAvvisato=false;
    return o;})()`);
  if (!/not enough room/.test(causes.quota)) bad('quota cause: ' + causes.quota);
  if (/not enough room/.test(causes.nr) || !/could not be read/.test(causes.nr)) bad('NotReadable cause: ' + causes.nr);
  if (/not enough room/.test(causes.other) || !/DataError/.test(causes.other)) bad('generic cause: ' + causes.other);

  // ---------------------------------------------------------------- 2. rescan after a retake
  const fakeFolder = files => ev(`document.getElementById('fFolder').onchange({target:{files:window.__ff,value:'x'}})`);
  await ev(`(async()=>{
    SHOTS=[];imgShot=null;
    window.__ff=[await mk('a.png',640,360,10,'Pack/No Edit/a.png'),await mk('b.png',640,360,120,'Pack/No Edit/b.png'),
                 await mk('a.png',640,360,11,'Pack/Edit/a.png'),await mk('z.png',640,360,12,'Pack/Edit/z.png')];
    return 1;})()`);
  await fakeFolder();
  await until(async () => (await ev('SHOTS.length')) === 2, 'first scan', 8000);
  const t2 = await toastText();
  R.firstScan = t2;
  if (!/2 images added from the folder/.test(t2) || !/2 Edit copies skipped because No Edit exists/.test(t2)) bad('first scan toast: ' + t2);
  // panel 0 shows image 1 (b)
  await ev(`(()=>{const S=state.layouts[state.active].shot;S.src=[1,0,0,0,0,0];imgShot=SHOTS[1].img;buildControls();render();return 1;})()`);
  const before = await ev(`({n:SHOTS.length,sizeB:SHOTS[1].blob.size,uidB:SHOTS[1].img.__uid,undo:undoStack.length})`);
  await ev(`(async()=>{
    window.__ff=[await mk('a.png',640,360,10,'Pack/No Edit/a.png'),            // unchanged (same size and date)
                 await mk('b.png',900,500,260,'Pack/No Edit/b.png'),           // retaken
                 await mk('c.png',640,360,70,'Pack/No Edit/c.png')];           // new
    return 1;})()`);
  await fakeFolder();
  await until(async () => /changed on disk/.test(await toastText()), 'rescan toast', 8000);
  const t3 = await toastText();
  const mid = await ev(`({n:SHOTS.length,names:SHOTS.map(s=>s.name+'@'+s.path).join('|'),sizeB:SHOTS[1].blob.size})`);
  R.rescan = {toast: t3, mid};
  if (mid.n !== 3) bad('rescan: expected 3 images (a, b, new c), got ' + mid.n + ' ' + mid.names);
  if (mid.sizeB !== before.sizeB) bad('rescan: image replaced before asking');
  if (!/1 image added from the folder/.test(t3)) bad('rescan toast should count the new image: ' + t3);
  const btn = await toastBtn('Replace 1 changed image');
  if (!btn) bad('rescan: no "Replace 1 changed image" action in the toast: ' + t3);
  await clickToastBtn('Replace');
  await delay(300);
  const after = await ev(`({n:SHOTS.length,sizeB:SHOTS[1].blob.size,src0:state.layouts[state.active].shot.src[0],main:imgShot===SHOTS[1].img,undo:undoStack.length,label:undoNomi[undoNomi.length-1]})`);
  R.afterReplace = after;
  if (after.n !== 3) bad('replace: count changed ' + after.n);
  if (after.sizeB === before.sizeB) bad('replace: image still the old file');
  if (after.src0 !== 1) bad('replace: panel assignment lost ' + after.src0);
  if (!after.main) bad('replace: main image not updated');
  if (after.label !== 'Replace changed images') bad('replace label: ' + after.label);
  const undoBtn = await toastBtn('Undo');
  if (!undoBtn) bad('replace: toast without Undo');
  await ev(`undo()`);
  await delay(200);
  const undone = await ev(`({n:SHOTS.length,sizeB:SHOTS[1].blob.size,toast:document.getElementById('toast').textContent})`);
  if (undone.sizeB !== before.sizeB) bad('undo of replace did not bring the old image back');
  if (undone.toast !== 'Undo: Replace changed images') bad('undo toast: ' + undone.toast);
  await ev(`redo()`);
  const redone = await ev(`document.getElementById('toast').textContent`);
  if (redone !== 'Redo: Replace changed images') bad('redo toast: ' + redone);
  await ev(`undo()`);

  // a dropped file (no folder path) with the same name is still a new image
  const drop = await ev(`(async()=>{
    const n0=SHOTS.length;
    const f=await mk('a.png',700,400,300);       // path = name only
    const r=await new Promise(res=>addShots([f],(n,rot,mot,info)=>res({n,cam:(info&&info.cambiate||[]).length})));
    return {added:r.n,cam:r.cam,total:SHOTS.length-n0};
  })()`);
  if (drop.added !== 1 || drop.cam !== 0) bad('same name without a folder path should add: ' + JSON.stringify(drop));

  // ---------------------------------------------------------------- 3. PREVOLO and Last export
  const marks = `(()=>{
    PREVOLO={quando:Date.now(),trovati:[{formato:'A',id:FORMATS[0].id,tipo:'nota',testo:'x'},{formato:'B',id:FORMATS[1].id,tipo:'nota',testo:'y'},{formato:'',id:'',tipo:'nota',testo:'z'}]};
    segnaExport({n:2,dove:'somewhere',nomi:['a.png'],avvisi:[]});return 1;})()`;
  const state0 = `({prevolo:PREVOLO===null,ultimo:ULTIMO_EXPORT===null,lastDom:[...document.querySelectorAll('.lastexp')].every(e=>e.style.display==='none'||!e.textContent)})`;
  // unticked formats
  await ev(marks);
  const filt = await ev(`(()=>{const id=FORMATS[1].id;const was=state.layouts[id].on;state.layouts[id].on=true;const a=esitoPreflight().trovati.length;
    state.layouts[id].on=false;const b=esitoPreflight().trovati.map(x=>x.testo).join();state.layouts[id].on=was;return {a,b};})()`);
  if (filt.a !== 3 || filt.b !== 'x,z') bad('unticked formats still listed in the check: ' + JSON.stringify(filt));
  // another pack by applySnap
  await ev(marks);
  await ev(`(()=>{const s=JSON.parse(snapState());applySnap(JSON.stringify(s));return 1;})()`);
  const same = await ev(state0);
  if (same.prevolo || same.ultimo) bad('applySnap of the same pack cleared the results');
  await ev(`(()=>{const s=JSON.parse(snapState());s.pack.title='Another pack';applySnap(JSON.stringify(s));return 1;})()`);
  const other = await ev(state0);
  if (!other.prevolo || !other.ultimo) bad('applySnap of another pack kept the results ' + JSON.stringify(other));
  await ev(`(()=>{const s=JSON.parse(snapState());s.pack.title='Z1 pack';applySnap(JSON.stringify(s));return 1;})()`);
  // New from this pack
  await ev(marks);
  await ev(`document.getElementById('bNew').click()`);
  await until(() => ev(`!document.getElementById('dlg').hidden`), 'new dialog', 4000);
  const clicked = await ev(`(()=>{const b=[...document.querySelectorAll('#dlg .dlg-btns button')].find(x=>/from this pack/i.test(x.textContent));if(!b)return false;b.click();return true;})()`);
  if (!clicked) bad('New dialog: no "from this pack" button');
  await delay(400);
  const afterNew = await ev(state0);
  if (!afterNew.prevolo || !afterNew.ultimo || !afterNew.lastDom) bad('New from this pack kept the results ' + JSON.stringify(afterNew));
  const nl = await ev(`({label:undoNomi[undoNomi.length-1],toast:document.getElementById('toast').textContent})`);
  if (nl.label !== 'New pack') bad('New pack label: ' + nl.label);
  await ev(`undo()`);
  // Open
  await ev(`(async()=>{
    state.pack.title='Open test pack';
    const f=await mk('o1.png',640,360,50);await new Promise(r=>addShots([f],r));
    window.__proj=new File([await testoProgetto()],'open-test.json',{type:'application/json'});return 1;})()`);
  await ev(marks);
  await ev(`caricaPresetFile(window.__proj)`);
  await until(() => ev('aprendoProgetto===false'), 'open', 15000);
  await delay(300);
  const afterOpen = await ev(state0);
  if (!afterOpen.prevolo || !afterOpen.ultimo) bad('Open kept the results ' + JSON.stringify(afterOpen));
  const openToast = await toastText();
  R.openToast = openToast;
  if (!/Project opened/.test(openToast)) bad('Open toast: ' + openToast);
  if (!(await toastBtn('Undo'))) bad('Open toast has no Undo button');
  const ol = await ev(`undoNomi[undoNomi.length-1]`);
  if (ol !== 'Open project') bad('Open label: ' + ol);

  // ---------------------------------------------------------------- 5. undo labels
  const lab = await ev(`(()=>{
    const o={};
    const keys=Object.keys(JSON.parse(snapState(true)));o.keys=keys.join();
    undoStack.length=0;redoStack.length=0;undoShots.length=0;redoShots.length=0;undoNomi.length=0;redoNomi.length=0;
    const S=state.layouts[state.active].shot;
    pushUndo('Test move');S.sc=[...(S.sc||[1])];S.sc[0]=1.5;
    o.par=undoStack.length+'/'+undoNomi.length;
    undo();o.undo=document.getElementById('toast').textContent;o.par2=redoStack.length+'/'+redoNomi.length;
    redo();o.redo=document.getElementById('toast').textContent;
    pushUndo();S.sc[0]=1.2;undo();o.plain=document.getElementById('toast').textContent;
    runAction('panelsEven');undo();o.action=document.getElementById('toast').textContent;
    // a click that moves nothing leaves the stacks in step
    o.len=undoStack.length+'/'+undoNomi.length+'/'+undoShots.length;
    for(let i=0;i<70;i++)pushUndo('n'+i);
    o.cap=undoStack.length+'/'+undoNomi.length+'/'+undoShots.length+' first '+undoNomi[0];
    return o;})()`);
  R.labels = lab; log('labels', JSON.stringify(lab));
  if (/label|nome/i.test(lab.keys)) bad('labels leaked into snapState: ' + lab.keys);
  if (lab.par !== '1/1') bad('parallel stacks out of step ' + lab.par);
  if (lab.undo !== 'Undo: Test move') bad('undo toast ' + lab.undo);
  if (lab.par2 !== '1/1') bad('redo stacks out of step ' + lab.par2);
  if (lab.redo !== 'Redo: Test move') bad('redo toast ' + lab.redo);
  if (lab.plain !== 'Undo') bad('unlabelled undo toast ' + lab.plain);
  if (lab.action !== 'Undo: Even panels') bad('runAction label ' + lab.action);
  if (!/^60\/60\/60 first n10$/.test(lab.cap)) bad('cap of 60 steps ' + lab.cap);

  // ---------------------------------------------------------------- 6. Desktop file name
  const desk = await ev(`(async()=>{
    const o={};
    const f=FORMATS.find(x=>x.id===state.active);
    const pk=Object.assign({},state.pack,{title:'Realistic Impacts Pack'});
    o.name=nomeDesktop(f,pk);o.file=fileNameFor(f,pk,1).split('/').pop();
    o.mainOk=/^[\\w .()\\-]+$/.test(o.name);
    o.empty=nomeDesktop(f,Object.assign({},pk,{title:'  '}))===o.file;
    const keep=state.naming.pattern;state.naming.pattern='{title}_{format}';
    o.noDup=nomeDesktop(f,pk)===fileNameFor(f,pk,1).split('/').pop();state.naming.pattern=keep;
    // the real button hands the name to the bridge (bridge replaced: nothing is written to the Desktop)
    const old=Object.getOwnPropertyDescriptor(window,'desktop');
    let got=null;
    Object.defineProperty(window,'desktop',{configurable:true,writable:true,value:{saveToDesktop:async(n,b)=>{got=n;return {name:n.replace(/(\\.\\w+)$/,'_1$1'),path:'C:/x/'+n};},showOnDesktop(){}}});
    state.pack.title='Realistic Impacts Pack';
    document.getElementById('bDesk').click();
    for(let i=0;i<60&&!got;i++)await wait(100);
    o.sent=got;o.expect=nomeDesktop(f,state.pack);
    if(old)Object.defineProperty(window,'desktop',old);else delete window.desktop;
    return o;})()`);
  R.desktop = desk; log('desktop', JSON.stringify(desk));
  if (desk.name !== 'Realistic_Impacts_Pack_' + desk.file) bad('desktop name ' + desk.name + ' vs ' + desk.file);
  if (!desk.mainOk) bad('desktop name rejected by the main.js name rule: ' + desk.name);
  if (!desk.empty) bad('empty title should give the plain file name');
  if (!desk.noDup) bad('title repeated when the pattern already has it');
  if (desk.sent !== desk.expect) bad('bDesk sent ' + desk.sent + ', expected ' + desk.expect);

  // ---------------------------------------------------------------- 8. file inputs reset, 9. helpers
  const inp = await ev(`(async()=>{
    const o={};
    const setFile=(id,f)=>{const dt=new DataTransfer();dt.items.add(f);const el=document.getElementById(id);el.files=dt.files;return el;};
    const el1=setFile('fFont',new File([new Uint8Array(8)],'bad.ttf'));el1.dispatchEvent(new Event('change'));o.font=el1.value;
    const el2=setFile('fPreset',new File(['{}'],'x.json'));el2.dispatchEvent(new Event('change'));o.preset=el2.value;
    const el3=setFile('fLogo',await mk('logo.png',200,200,90));el3.dispatchEvent(new Event('change'));o.logo=el3.value;
    await wait(500);
    // image-file test
    o.img=[eImmagine(new File([],'a.PNG')),eImmagine(new File([],'x',{type:'image/webp'})),eImmagine(new File([],'a.txt')),
           eImmagine(new File([],'a.svg',{type:'image/svg+xml'}),true),eImmagine(new File([],'x',{type:'image/webp'}),true)].join();
    // meta helpers
    await metaPut('z1-test',{a:1});o.get=JSON.stringify(await metaGet('z1-test'));
    await metaDel('z1-test');o.gone=await metaGet('z1-test');
    // forget export folder
    cartellaExport=await navigator.storage.getDirectory();await metaPut('cartellaExport',cartellaExport);
    dimenticaCartellaExport();await wait(200);o.exportForgot=cartellaExport===null&&(await metaGet('cartellaExport'))===null;
    o.fnLogo=typeof caricaFontFile==='function';
    return o;})()`);
  R.inputs = inp; log('inputs', JSON.stringify(inp));
  if (inp.font !== '' || inp.preset !== '' || inp.logo !== '') bad('file inputs not reset: ' + JSON.stringify([inp.font, inp.preset, inp.logo]));
  if (inp.img !== 'true,true,false,false,false') bad('eImmagine ' + inp.img);
  if (inp.get !== '{"a":1}' || inp.gone !== null) bad('meta helpers ' + inp.get + ' ' + inp.gone);
  if (!inp.exportForgot) bad('dimenticaCartellaExport');

  // ---------------------------------------------------------------- the batch with a missing file is still reported
  const errs = await ev('qaErrors');
  if (errs.length) bad('page errors: ' + errs.join(' | '));
  return R;
};
