'use strict';
// Kit (app/shared): every public API of window.Kit exercised in the real app, plus screenshots of the demo page.
// The demo is loaded in an iframe the test adds to the shell page (app://local/shared/kit-demo.html), so the test
// does not depend on which tabs the shell has. Run from the repo root:
//   APP_ROOT=<copy> PORT=<port> node tests/stress/run-tab.cjs tests/stress/kit/t1.cjs
module.exports = async ({evaluate, command, until, delay, capture}) => {
  const out = {ok: true, checks: {}, shots: []};
  const chk = (n, v, extra) => { out.checks[n] = extra === undefined ? !!v : {ok: !!v, v: extra}; if (!v) out.ok = false; };

  // ---- the demo page in a full-window iframe of the shell
  await evaluate(`(()=>{const f=document.createElement('iframe');f.id='kitframe';f.src='app://local/shared/kit-demo.html';
    f.style.cssText='position:fixed;inset:0;width:100vw;height:100vh;border:0;z-index:99999;background:#101012';document.body.appendChild(f);return 1})()`);
  const W = 'document.getElementById("kitframe").contentWindow';
  await until(() => evaluate(`!!(${W}.demo&&${W}.demo.ready)`), 'demo ready', 20000);
  // KE(code): async code with w (iframe window), d (its document), Kit, demo in scope
  const KE = code => evaluate(`(async()=>{const w=${W},d=w.document,Kit=w.Kit,demo=w.demo;${code}})()`);
  const key = (k, extra) => KE(`w.dispatchEvent(new w.KeyboardEvent('keydown',Object.assign({key:${JSON.stringify(k)},bubbles:true,cancelable:true},${JSON.stringify(extra || {})})));return 1`);
  const shot = async name => { out.shots.push(await capture(name)); };

  // ---- 1. load: no errors, stylesheet + fonts + tokens
  await KE(`w.__errs=[];w.addEventListener('error',e=>w.__errs.push(e.message));w.addEventListener('unhandledrejection',e=>w.__errs.push(String(e.reason)));return 1`);
  chk('kit.css applied', await KE(`return getComputedStyle(d.body).backgroundColor==='rgb(16, 16, 18)' && getComputedStyle(d.documentElement).getPropertyValue('--panel2').trim()==='#202024'`));
  chk('Turret Road loaded from fonts.css', await KE(`await d.fonts.load('700 22px "Turret Road"');return d.fonts.check('700 22px "Turret Road"') && [...d.fonts].some(f=>f.family.includes('Turret')&&f.status==='loaded')`));
  chk('Kit API surface', await KE(`const need=['icons','icon','iconHtml','paintIcons','addIcons','toast','dialog','confirm','prompt','keys','row','rows','section','tabs','drop','save','persist','config'];return need.filter(k=>!(k in Kit)).length===0`));

  // ---- 2. icons: every requested name exists, new media icons stay on the 16x16 grid (1.5..14.5)
  const REQUIRED = 'play pause stop record stepback stepfwd tostart toend loop sound mute scissors crop rotate flip film join compare grid4 sheet flipbook annotate rename texture sparkle send tray folderopen image video'.split(' ');
  const STORE = 'image file folder logo type open save saveas layoutall copy desktop down zip key undo redo reset fit grid eye eyeoff up close trash compare lock unlock magnet2 wheel unused zin zout layers branch drop sliders blur tint fade band rule tag badge frame naming clock'.split(' ');
  chk('demo shows every icon', await KE(`return d.querySelectorAll('#tiles .tile').length===Object.keys(Kit.icons).length`));
  chk('all requested + Store icons exist', await KE(`return ${JSON.stringify(REQUIRED.concat(STORE))}.filter(n=>!Kit.icons[n]).length===0`));
  const bad = await KE(`const out=[];const host=d.createElement('div');host.style.cssText='position:absolute;left:0;top:0;visibility:hidden';d.body.appendChild(host);
    for(const n of ${JSON.stringify(REQUIRED)}){const s=Kit.icon(n);host.appendChild(s);let x0=99,y0=99,x1=-1,y1=-1;
      s.querySelectorAll('path').forEach(p=>{const b=p.getBBox();x0=Math.min(x0,b.x);y0=Math.min(y0,b.y);x1=Math.max(x1,b.x+b.width);y1=Math.max(y1,b.y+b.height)});
      if(x0<1.45||y0<1.45||x1>14.55||y1>14.55||x1-x0<5||y1-y0<5)out.push(n+' '+[x0,y0,x1,y1].map(v=>+v.toFixed(2)).join(','));}
    host.remove();return out`);
  chk('media icons inside the 16x16 grid', bad.length === 0, bad);
  const ic = await KE(`const s=Kit.icon('play');const r=Kit.icon('record');return {cls:s.getAttribute('class'),vb:s.getAttribute('viewBox'),paths:s.querySelectorAll('path').length,recFill:r.querySelectorAll('path.f').length,
    unknown:Kit.icon('no-such-icon').querySelector('path').getAttribute('d')===Kit.icons.grid,html:/<svg/.test(Kit.iconHtml('play'))}`);
  chk('icon(): svg.ic, 16 grid, fill part, fallback', ic.cls === 'ic' && ic.vb === '0 0 16 16' && ic.paths === 1 && ic.recFill === 1 && ic.unknown && ic.html, ic);
  chk('paintIcons / addIcons', await KE(`Kit.addIcons({testdot:'M8 8v.02'});const b=d.createElement('button');b.setAttribute('data-ic','testdot');b.textContent='X';d.body.appendChild(b);Kit.paintIcons(d.body);Kit.paintIcons(d.body);
    const ok=b.querySelectorAll('svg.ic').length===1&&b.firstChild.tagName.toLowerCase()==='svg'&&b.lastChild.textContent==='X';b.remove();return ok&&Kit.icons.testdot==='M8 8v.02'`));

  // ---- 3. toast
  const t1 = await KE(`Kit.toast('Hello there');const t=d.querySelector('.kit-toast');const r=t.getBoundingClientRect(),sr=d.getElementById('stage').getBoundingClientRect();
    return {on:t.classList.contains('on'),role:t.getAttribute('role'),leftInStage:Math.abs(r.left-(sr.left+14))<2,bottomInStage:r.bottom<=sr.bottom,text:t.textContent}`);
  chk('toast shows bottom-left of the configured stage', t1.on && t1.leftInStage && t1.bottomInStage && t1.role === 'status' && t1.text === 'Hello there', t1);
  const t2 = await KE(`Kit.toast('Could not do it');const t=d.querySelector('.kit-toast');return {err:t.classList.contains('toast-err'),role:t.getAttribute('role')}`);
  chk('toast: "Could not..." is an error, alert role', t2.err && t2.role === 'alert', t2);
  const t3 = await KE(`Kit.toast('Careful',{kind:'warn'});const t=d.querySelector('.kit-toast');const a=t.classList.contains('toast-warn')&&!t.classList.contains('toast-err');
    Kit.toast('Plain');return {warn:a,cleared:!t.classList.contains('toast-warn')&&!t.classList.contains('toast-err'),one:d.querySelectorAll('.kit-toast').length}`);
  chk('toast kinds reset, one element', t3.warn && t3.cleared && t3.one === 1, t3);
  const t4 = await KE(`let hit=0,und=0;Kit.toast('Act',{action:{label:'Show',fn:()=>hit++}});const t=d.querySelector('.kit-toast');t.querySelector('button').click();const a=hit===1&&!t.classList.contains('on');
    Kit.toast('Del',{undo:()=>und++});const b=t.querySelector('button');const lab=b.textContent;b.click();return {a,undoLabel:lab,und,hid:!t.classList.contains('on')}`);
  chk('toast action + undo callbacks', t4.a && t4.undoLabel === 'Undo' && t4.und === 1 && t4.hid, t4);
  const t5 = await KE(`const box=d.createElement('div');box.style.cssText='position:fixed;left:200px;top:100px;width:420px;height:260px';d.body.appendChild(box);
    Kit.toast('Anchored',{anchor:box});const t=d.querySelector('.kit-toast'),r=t.getBoundingClientRect(),b=box.getBoundingClientRect();
    const ok1=Math.abs(r.left-(b.left+14))<2&&r.bottom<=b.bottom-8&&r.bottom>=b.bottom-24;
    Kit.toast('Right',{anchor:box,align:'right'});const r2=t.getBoundingClientRect();const ok2=Math.abs(r2.right-(b.right-14))<2;
    Kit.toast('Centre',{anchor:box,align:'center'});const r3=t.getBoundingClientRect();const ok3=Math.abs((r3.left+r3.right)/2-(b.left+b.right)/2)<3;
    Kit.toast('No anchor',{anchor:null});box.remove();return {ok1,ok2,ok3}`);
  chk('toast anchor element (left, right, centre)', t5.ok1 && t5.ok2 && t5.ok3, t5);
  const t6 = await KE(`const st=d.getElementById('status');const sr=st.getBoundingClientRect();
    const old=Kit.config().stage;Kit.config({stage:null,avoid:[]});
    Kit.toast('Window corner');const t=d.querySelector('.kit-toast');const r=t.getBoundingClientRect();const corner=Math.abs(r.left-14)<2&&Math.abs((w.innerHeight-r.bottom)-20)<2;
    // avoid: a text element where the toast would be makes it hop above it
    const probe=d.createElement('div');probe.id='probe';probe.textContent='info line';probe.style.cssText='position:fixed;left:10px;bottom:10px;width:300px;height:40px;background:#222';d.body.appendChild(probe);
    Kit.toast('Avoiding',{avoid:['#probe']});const r2=t.getBoundingClientRect(),p=probe.getBoundingClientRect();const hop=r2.bottom<=p.top-4;
    probe.remove();Kit.config({stage:old,avoid:['#status']});return {corner,hop}`);
  chk('toast defaults to window corner, hops above avoid elements', t6.corner && t6.hop, t6);
  chk('toast fades after ms', await KE(`Kit.toast('Short',{ms:250});const t=d.querySelector('.kit-toast');const a=t.classList.contains('on');await new Promise(r=>setTimeout(r,600));return a&&!t.classList.contains('on')`));
  chk('toast sticky stays', await KE(`Kit.toast('Stay',{sticky:true,ms:100});const t=d.querySelector('.kit-toast');await new Promise(r=>setTimeout(r,500));const s=t.classList.contains('on');Kit.toast.hide();return s&&!t.classList.contains('on')`));

  // ---- 4. dialog / confirm / prompt (and window.prompt is never needed)
  const dlg = async (open, act) => { // open a dialog, run act inside the page, return what the promise gave
    return KE(`const p=${open};await new Promise(r=>setTimeout(r,30));${act};return await p;`);
  };
  chk('dialog resolves with the clicked button id', await dlg(`Kit.dialog({title:'T',text:'Body',buttons:[{id:'a',label:'A'},{id:'b',label:'B',primary:true}]})`, `d.querySelectorAll('.kit-dlg-btns button')[0].click()`) === 'a');
  chk('dialog Esc -> null', await dlg(`Kit.dialog({title:'T',text:'x'})`, `w.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))`) === null);
  chk('dialog Enter presses the primary button', await dlg(`Kit.dialog({title:'T',text:'x',buttons:[{id:'a',label:'A'},{id:'b',label:'B',primary:true}]})`, `d.body.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}))`) === 'b');
  chk('dialog click on the scrim -> null', await dlg(`Kit.dialog({title:'T',text:'x'})`, `const s=d.querySelector('.kit-dlg-scrim');s.dispatchEvent(new w.MouseEvent('mousedown',{bubbles:true}));s.dispatchEvent(new w.MouseEvent('click',{bubbles:true}))`) === null);
  chk('dialog: a click inside the box does not close it', await KE(`const p=Kit.dialog({title:'T',text:'x'});const b=d.querySelector('.kit-dlg');b.dispatchEvent(new w.MouseEvent('mousedown',{bubbles:true}));b.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));const open=Kit.dialogOpen();d.querySelector('.kit-dlg-btns button').click();return open&&await p==='ok'`));
  chk('a new dialog closes the previous one with null', await KE(`const p1=Kit.dialog({title:'One'});const p2=Kit.dialog({title:'Two'});const first=await p1;const title=d.querySelector('.kit-dlg h3').textContent;d.querySelector('.kit-dlg-btns button').click();return first===null&&title==='Two'&&await p2==='ok'`));
  chk('dialog body node and HTML string, focus option', await KE(`const n=d.createElement('input');n.id='bodyin';const p=Kit.dialog({title:'T',body:n,focus:n});const f1=d.activeElement===n;d.querySelector('.kit-dlg-btns button').click();await p;
    const p2=Kit.dialog({body:'<b id="hb">html</b>'});const f2=!!d.getElementById('hb');d.querySelector('.kit-dlg-btns button').click();await p2;return f1&&f2&&!Kit.dialogOpen()`));
  chk('dialog restores focus and hides the host', await KE(`const b=d.getElementById('dDlg');b.focus();const p=Kit.dialog({title:'T'});d.querySelector('.kit-dlg-btns button').click();await p;return d.activeElement===b&&d.querySelector('.kit-dlg-host').hidden`));
  chk('dialog Tab stays inside the box', await KE(`const p=Kit.dialog({title:'T',buttons:[{id:'a',label:'A'},{id:'b',label:'B',primary:true}]});const bs=d.querySelectorAll('.kit-dlg-btns button');
    let seen=[d.activeElement===bs[1]];w.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));seen.push(d.activeElement===bs[0]);
    w.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true}));seen.push(d.activeElement===bs[1]);bs[0].click();await p;return seen.every(Boolean)`));
  chk('confirm true / false / Esc', await KE(`let r=[];let p=Kit.confirm('Sure?',{ok:'Do it'});const label=d.querySelectorAll('.kit-dlg-btns button')[1].textContent;d.querySelectorAll('.kit-dlg-btns button')[1].click();r.push(await p);
    p=Kit.confirm('Sure?');d.querySelectorAll('.kit-dlg-btns button')[0].click();r.push(await p);
    p=Kit.confirm('Sure?');w.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));r.push(await p);
    return label==='Do it'&&r[0]===true&&r[1]===false&&r[2]===false`));
  chk('confirm danger: red button, Cancel focused, Enter keeps Cancel safe', await KE(`const p=Kit.confirm('Delete?',{ok:'Delete',danger:true});const bs=d.querySelectorAll('.kit-dlg-btns button');
    const a=bs[1].classList.contains('danger')&&!bs[1].classList.contains('primary')&&d.activeElement===bs[0];bs[0].click();return a&&await p===false`));
  const pr = await KE(`window.__noPrompt=0;const orig=w.prompt;w.prompt=()=>{w.__np=(w.__np||0)+1;return null};
    // value kept, selected, typed text returned, Enter confirms
    let p=Kit.prompt('Name',{value:'old',placeholder:'p',text:'Explain'});let inp=d.querySelector('.kit-prompt');
    const sel=inp.selectionStart===0&&inp.selectionEnd===3&&d.activeElement===inp&&inp.placeholder==='p'&&!!d.querySelector('.kit-dlg-body').textContent.match(/Explain/);
    inp.value='new name';inp.dispatchEvent(new w.Event('input',{bubbles:true}));inp.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));const v1=await p;
    // cancel
    p=Kit.prompt('Name',{value:'x'});d.querySelectorAll('.kit-dlg-btns button')[0].click();const v2=await p;
    // Esc
    p=Kit.prompt('Name');w.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));const v3=await p;
    // empty value is a string, not null
    p=Kit.prompt('Name');d.querySelectorAll('.kit-dlg-btns button')[1].click();const v4=await p;
    // validate keeps it open with a message
    p=Kit.prompt('Name',{value:'',validate:v=>v.trim()?'':'Type a name'});d.querySelectorAll('.kit-dlg-btns button')[1].click();
    const stillOpen=Kit.dialogOpen()&&d.querySelector('.kit-prompt-err').textContent==='Type a name';
    inp=d.querySelector('.kit-prompt');inp.value='ok';inp.dispatchEvent(new w.Event('input',{bubbles:true}));const cleared=d.querySelector('.kit-prompt-err').textContent==='';
    d.querySelectorAll('.kit-dlg-btns button')[1].click();const v5=await p;
    const np=w.__np||0;w.prompt=orig;return {sel,v1,v2,v3,v4,stillOpen,cleared,v5,np}`);
  chk('prompt: value, select, Enter, Cancel, Esc, empty, validate, no window.prompt', pr.sel && pr.v1 === 'new name' && pr.v2 === null && pr.v3 === null && pr.v4 === '' && pr.stillOpen && pr.cleared && pr.v5 === 'ok' && pr.np === 0, pr);

  // ---- 5. keys popover
  const k1 = await KE(`const g=[['Edit',[['Ctrl+Z','Undo'],['Ctrl+Y','Redo']]],['View',[['?','Help']]]];const btn=d.getElementById('bKeys');
    const o1=Kit.keys(g,{button:btn});const pop=d.querySelector('.kit-keys');const a={open:o1&&!pop.hidden,h4:[...pop.querySelectorAll('h4')].map(x=>x.textContent).join(','),keysCount:pop.querySelectorAll('.kgrid b').length,exp:btn.getAttribute('aria-expanded'),title:pop.querySelector('.khead b').textContent};
    const o2=Kit.keys();a.closedByToggle=!o2&&pop.hidden&&btn.getAttribute('aria-expanded')==='false';
    Kit.keys();a.reopen=!pop.hidden;w.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));a.esc=pop.hidden;
    Kit.keys();d.body.dispatchEvent(new w.MouseEvent('mousedown',{bubbles:true}));a.outside=pop.hidden;
    Kit.keys();btn.dispatchEvent(new w.MouseEvent('mousedown',{bubbles:true}));a.buttonKeepsOpen=!pop.hidden;
    pop.querySelector('.kx').click();a.x=pop.hidden;
    Kit.keys({on:true});a.onTrue=!pop.hidden;Kit.keys({on:false});a.onFalse=pop.hidden;
    Kit.keys.close();a.api=typeof Kit.keys.isOpen==='function'&&!Kit.keys.isOpen();return a`);
  chk('keys popover: build, toggle, Esc, outside click, X, aria-expanded',
    k1.open && k1.h4 === 'Edit,View' && k1.keysCount === 3 && k1.exp === 'true' && k1.title === 'Keyboard shortcuts' && k1.closedByToggle && k1.reopen && k1.esc && k1.outside && k1.buttonKeepsOpen && k1.x && k1.onTrue && k1.onFalse && k1.api, k1);

  // ---- 6. rows: every type, set/commit/get/sync, Alt+click default, when/disabled
  const rw = await KE(`const S={};const host=d.createElement('div');host.id='rowhost';host.style.cssText='position:fixed;left:0;top:0;width:360px;visibility:hidden';d.body.appendChild(host);
    const mk=(sp)=>{const e=Kit.row(sp);host.appendChild(e);return e};
    let val=5,done=0;
    const r1=mk({type:'range',label:'Zoom',min:0,max:10,step:0.5,get:()=>val,set:v=>{val=v},commit:()=>done++,def:2,id:'r1'});
    S.range={cls:r1.className,label:r1.querySelector('label').textContent,v:r1.input.value,box:r1.valInput.value,boxType:r1.valInput.type,id:r1.input.id};
    r1.input.value=7;r1.input.dispatchEvent(new w.Event('input'));r1.input.dispatchEvent(new w.Event('change'));S.rangeInput={val,box:r1.valInput.value,done};
    r1.valInput.value='12.4';r1.valInput.dispatchEvent(new w.Event('change'));S.rangeBox={val,slider:r1.input.value,done};    // soft clamp to 2x
    r1.valInput.value='99';r1.valInput.dispatchEvent(new w.Event('change'));S.rangeSoftMax=val;
    r1.valInput.value='abc';r1.valInput.dispatchEvent(new w.Event('change'));S.rangeBad=r1.valInput.value;
    val=1;r1.sync();S.rangeSync=[r1.input.value,r1.valInput.value];
    r1.dispatchEvent(new w.MouseEvent('mousedown',{altKey:true,button:0,bubbles:true,cancelable:true}));S.alt={val,box:r1.valInput.value};
    const rh=mk({type:'range',label:'Hard',min:0,max:10,step:1,hard:true,get:()=>val,set:v=>{val=v}});rh.valInput.value='50';rh.valInput.dispatchEvent(new w.Event('change'));S.hard=val;
    let on=false;const r2=mk({type:'check',label:'On',text:'Enable it',get:()=>on,set:v=>{on=v}});r2.input.click();S.check={on,checked:r2.input.checked,txt:r2.querySelector('.rtext').textContent};r2.querySelector('.rtext').click();S.checkText=on;on=true;r2.sync();S.checkSync=r2.input.checked;
    let col='#336699';const r3=mk({type:'color',label:'Col',get:()=>col,set:v=>{col=v}});S.color={val:r3.input.value,hex:r3.querySelector('.hex').textContent};r3.input.value='#aa5500';r3.input.dispatchEvent(new w.Event('input'));S.colorSet={col,hex:r3.querySelector('.hex').textContent};
    r3.querySelector('.hex').dispatchEvent(new w.MouseEvent('dblclick',{bubbles:true}));const f=r3.querySelector('input.hexinl');S.hexEdit=!!f;f.value='f80';f.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));S.hexTyped={col,back:!!r3.querySelector('button.hex'),txt:r3.querySelector('.hex').textContent};
    let sel='b';const r4=mk({type:'select',label:'Sel',options:['a','b',{value:3,label:'Three'}],get:()=>sel,set:v=>{sel=v}});S.select={v:r4.input.value,n:r4.input.options.length};r4.input.value='3';r4.input.dispatchEvent(new w.Event('change'));S.selectNum=[sel,typeof sel];
    let sg='x';const r5=mk({type:'seg',label:'Seg',options:[['x','X'],['y','Y']],get:()=>sg,set:v=>{sg=v}});const sbs=r5.querySelectorAll('.seg button');S.seg={on:[...sbs].map(b=>b.classList.contains('on')),isSeg:!!r5.querySelector('.seg')};sbs[1].click();S.segClick={sg,on:[...sbs].map(b=>b.classList.contains('on')),aria:sbs[1].getAttribute('aria-pressed')};
    let tx='hi';const r6=mk({type:'text',label:'Txt',placeholder:'ph',get:()=>tx,set:v=>{tx=v}});r6.input.value='yo';r6.input.dispatchEvent(new w.Event('input'));S.text={tx,ph:r6.input.placeholder};tx='zz';r6.sync();S.textSync=r6.input.value;
    let ar='a\\nb';const r7=mk({type:'area',label:'Area',get:()=>ar,set:v=>{ar=v}});S.area={full:r7.classList.contains('full'),tag:r7.input.tagName,v:r7.input.value};
    let clicks=0;const r8=mk({type:'button',text:'Go',icon:'send',click:()=>clicks++});r8.querySelector('button').click();S.button={clicks,icon:!!r8.querySelector('button svg.ic'),txt:r8.textContent};
    let c2=0;const r9=mk({type:'button',buttons:[{text:'A',click:()=>c2++},{text:'B',click:()=>c2+=10,primary:true}]});r9.querySelectorAll('button')[1].click();r9.querySelectorAll('button')[0].click();S.buttons={c2,n:r9.querySelectorAll('button').length,acc:r9.querySelectorAll('button')[1].classList.contains('acc')};
    const g=Kit.row({type:'group',label:'Grp'});S.group=[g.className,g.textContent];const n=Kit.row({type:'note',text:'A note'});S.note=[n.className,n.textContent];
    let nn=3;const r10=mk({type:'number',label:'N',min:0,max:10,step:1,get:()=>nn,set:v=>{nn=v}});r10.input.value='50';r10.input.dispatchEvent(new w.Event('change'));S.number={nn,box:r10.input.value};
    let vis=true,off=false;const r11=mk({type:'check',label:'Cond',when:()=>vis,disabled:()=>off,get:()=>true});vis=false;off=true;r11.sync();S.when={hidden:r11.hidden,dis:r11.input.disabled,cls:r11.classList.contains('dis')};vis=true;off=false;r11.sync();S.whenBack={hidden:r11.hidden,dis:r11.input.disabled};
    const R=Kit.rows([{type:'check',label:'A',get:()=>on,set:()=>{}},{type:'note',text:'n'}]);S.rows={n:R.rows.length,sync:typeof R.sync};
    host.remove();return S`);
  chk('row range: build, id, label, number box', rw.range.cls === 'row' && rw.range.label === 'Zoom' && rw.range.v === '5' && rw.range.box === '5.0' && rw.range.boxType === 'number' && rw.range.id === 'r1', rw.range);
  chk('row range: slider input -> set, change -> commit', rw.rangeInput.val === 7 && rw.rangeInput.box === '7.0' && rw.rangeInput.done === 1, rw.rangeInput);
  chk('row range: typed value beyond the slider is accepted (slider stops at its max)', rw.rangeBox.val === 12.4 && rw.rangeBox.slider === '10' && rw.rangeBox.done === 2, rw.rangeBox);
  chk('row range: soft max is twice the slider max, junk is rejected', rw.rangeSoftMax === 20 && rw.rangeBad === '20.0', [rw.rangeSoftMax, rw.rangeBad]);
  chk('row range: sync() re-reads get()', rw.rangeSync[0] === '1' && rw.rangeSync[1] === '1.0', rw.rangeSync);
  chk('row: Alt+click puts def back', rw.alt.val === 2 && rw.alt.box === '2.0', rw.alt);
  chk('row range hard: typed value is clamped to max', rw.hard === 10, rw.hard);
  chk('row check', rw.check.on === true && rw.check.checked && rw.check.txt === 'Enable it' && rw.checkText === false && rw.checkSync === true, [rw.check, rw.checkText, rw.checkSync]);
  chk('row color: value, hex, typed code', rw.color.val === '#336699' && rw.color.hex === '#336699'.toUpperCase() && rw.colorSet.col === '#aa5500' && rw.colorSet.hex === '#AA5500' && rw.hexEdit && rw.hexTyped.col === '#ff8800' && rw.hexTyped.back && rw.hexTyped.txt === '#FF8800', [rw.color, rw.colorSet, rw.hexTyped]);
  chk('row select: initial, original value type kept', rw.select.v === 'b' && rw.select.n === 3 && rw.selectNum[0] === 3 && rw.selectNum[1] === 'number', [rw.select, rw.selectNum]);
  chk('row seg: on state, click sets', rw.seg.isSeg && rw.seg.on[0] && !rw.seg.on[1] && rw.segClick.sg === 'y' && rw.segClick.on[1] && !rw.segClick.on[0] && rw.segClick.aria === 'true', [rw.seg, rw.segClick]);
  chk('row text / area', rw.text.tx === 'yo' && rw.text.ph === 'ph' && rw.textSync === 'zz' && rw.area.full && rw.area.tag === 'TEXTAREA' && rw.area.v === 'a\nb', [rw.text, rw.textSync, rw.area]);
  chk('row button / buttons', rw.button.clicks === 1 && rw.button.icon && rw.button.txt === 'Go' && rw.buttons.c2 === 11 && rw.buttons.n === 2 && rw.buttons.acc, [rw.button, rw.buttons]);
  chk('row group / note', rw.group[0] === 'grp2' && rw.group[1] === 'Grp' && rw.note[0] === 'hint' && rw.note[1] === 'A note', [rw.group, rw.note]);
  chk('row number: clamps to max', rw.number.nn === 10 && rw.number.box === '10', rw.number);
  chk('row when() hides, disabled() disables, both reversible', rw.when.hidden && rw.when.dis && rw.when.cls && !rw.whenBack.hidden && !rw.whenBack.dis, [rw.when, rw.whenBack]);
  chk('rows(): wrapper with rows[] and sync()', rw.rows.n === 2 && rw.rows.sync === 'function', rw.rows);

  // ---- 7. section, tabs
  const st = await KE(`const sec=demo.sections[2];const open0=sec.classList.contains('open');let ev=[];
    const s2=Kit.section({title:'X',icon:'film',count:3,onToggle:o=>ev.push(o),body:'<div class="row"><label>q</label></div>'});d.body.appendChild(s2);s2.style.visibility='hidden';
    s2.head.click();const a=s2.classList.contains('open')&&s2.head.getAttribute('aria-expanded')==='true';
    s2.head.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));const b=!s2.classList.contains('open');
    s2.toggle(true);const c=s2.classList.contains('open');const bodyShown=getComputedStyle(s2.body).display==='block';s2.remove();
    const tabs=d.querySelector('#tabsHost .tabs');const tb=[...tabs.querySelectorAll('button')];tb[2].click();
    return {open0,a,b,c,bodyShown,ev,cnt:s2.querySelector('.cnt').textContent,tabOn:tb.map(x=>x.classList.contains('on')),lastStatus:d.getElementById('status').textContent,tabVal:tabs.value()}`);
  chk('section toggles by click, key and API; callback', !st.open0 && st.a && st.b && st.c && st.bodyShown && JSON.stringify(st.ev) === '[true,false,true]' && st.cnt === '3', st);
  chk('tabs: click selects, onChange, value()', JSON.stringify(st.tabOn) === '[false,false,true]' && /pack/.test(st.lastStatus) && st.tabVal === 'pack', st);

  // ---- 8. drop
  const dr = await KE(`const got=[];const rej=[];const box=d.createElement('div');box.style.cssText='position:fixed;left:50px;top:50px;width:200px;height:120px';d.body.appendChild(box);
    const h=Kit.drop(box,{accept:'image/*,.json',overlayText:'Drop here',onFiles:(f,e,bad)=>{got.push(f.map(x=>x.name));rej.push(bad.map(x=>x.name))}});
    const mkdt=(files)=>{const dt=new w.DataTransfer();files.forEach(f=>dt.items.add(f));return dt};
    const fire=(type,dt,x,y)=>{const e=new w.DragEvent(type,{bubbles:true,cancelable:true,dataTransfer:dt,clientX:x||0,clientY:y||0});w.dispatchEvent(e);return e};
    const png=new w.File(['x'],'a.png',{type:'image/png'}),txt=new w.File(['t'],'b.txt',{type:'text/plain'}),js=new w.File(['{}'],'p.json',{type:'application/json'});
    const dt=mkdt([png,txt]);
    const e1=fire('dragenter',dt);const shown=h.overlay.classList.contains('on');const txtShown=h.overlay.textContent;
    const e2=fire('dragover',dt);const prevented=e1.defaultPrevented&&e2.defaultPrevented&&true;
    const e3=fire('drop',dt);const hidden=!h.overlay.classList.contains('on');
    // nothing acceptable: no onFiles, toast says so
    const dt2=mkdt([txt]);const hn=Kit.drop(box,{accept:'image/*'});fire('dragenter',dt2);const noClass=hn.overlay.classList.contains('no')&&/not accepted/.test(hn.overlay.textContent);fire('drop',dt2);const toastTxt=d.querySelector('.kit-toast').textContent;hn.destroy();
    // extension in accept
    fire('drop',mkdt([js]));
    // leaving the window hides the veil
    fire('dragenter',dt);fire('dragleave',dt);const leftHidden=!h.overlay.classList.contains('on');
    // non-file drag is ignored
    const dtT=new w.DataTransfer();dtT.setData('text/plain','hello');const e4=fire('dragenter',dtT);const ignored=!e4.defaultPrevented&&!h.overlay.classList.contains('on');
    // enabled()/within
    h.destroy();const gotBefore=got.length;fire('drop',mkdt([png]));const destroyed=got.length===gotBefore&&!box.contains(h.overlay);
    const h2=Kit.drop(box,{within:true,onFiles:f=>got.push(['within:'+f[0].name])});fire('dragenter',dt,10,10);const outside=!h2.overlay.classList.contains('on');fire('dragover',dt,100,100);const inside=h2.overlay.classList.contains('on');
    fire('drop',mkdt([png]),10,10);const droppedOutside=got.filter(x=>/within/.test(x[0])).length;fire('drop',mkdt([png]),100,100);const droppedInside=got.filter(x=>/within/.test(x[0])).length;h2.destroy();
    // whole page: veil is fixed on the body
    const h3=Kit.drop(d.body,{onFiles:()=>{}});const fixed=h3.overlay.classList.contains('fixed')&&h3.overlay.parentNode===d.body;h3.destroy();
    box.remove();return {shown,txtShown,prevented,hidden,got,rej,noClass,toastTxt,leftHidden,ignored,destroyed,outside,inside,droppedOutside,droppedInside,fixed,pos:getComputedStyle(box).position}`);
  chk('drop: veil on dragenter with the text, hidden after drop', dr.shown && dr.txtShown === 'Drop here' && dr.hidden, dr);
  chk('drop: preventDefault on enter/over (window never navigates)', dr.prevented);
  chk('drop: accept filter (png yes, txt no, .json by extension)', JSON.stringify(dr.got.slice(0, 2)) === '[["a.png"],["p.json"]]' && JSON.stringify(dr.rej.slice(0, 2)) === '[["b.txt"],[]]', [dr.got, dr.rej]);
  chk('drop: nothing accepted -> "no" veil + toast', dr.noClass && /not accepted/.test(dr.toastTxt), dr);
  chk('drop: leave hides, non-file drag ignored', dr.leftHidden && dr.ignored, dr);
  chk('drop: destroy removes listeners and veil', dr.destroyed);
  chk('drop: within only reacts inside the box', dr.outside && dr.inside && dr.droppedOutside === 0 && dr.droppedInside === 1, dr);
  chk('drop: whole-page veil is fixed', dr.fixed);

  // ---- 9. save (the anchor click is intercepted: no real download dialog in the test)
  const sv = await KE(`const calls=[];const orig=w.HTMLAnchorElement.prototype.click;w.HTMLAnchorElement.prototype.click=function(){calls.push({name:this.download,href:this.href.slice(0,5),inDoc:this.isConnected});};
    const n1=Kit.save(new w.Blob(['abc'],{type:'text/plain'}),'a:b?.txt');const n2=Kit.save('plain','s.txt');const n3=Kit.save({a:1},'o.json');const n4=Kit.save(new w.Uint8Array([1,2,3]),'b.bin');const n5=Kit.save(new w.Blob(['x']));
    w.HTMLAnchorElement.prototype.click=orig;return {calls,n1,n5,left:d.querySelectorAll('a[download]').length}`);
  chk('save: download anchor, safe names, strings/objects/bytes wrapped', sv.calls.length === 5 && sv.calls[0].name === 'a_b_.txt' && sv.calls.every(c => c.href === 'blob:' && c.inDoc) && sv.calls[2].name === 'o.json' && sv.n5 === 'download' && sv.left === 0, sv);

  // ---- 10. persist
  const pe = await KE(`localStorage.removeItem('kit.t1');const p=Kit.persist('kit.t1');const a=p.get('x',7)===7;p.set('x',{a:1});const b=JSON.stringify(p.get('x'))==='{"a":1}'&&JSON.parse(localStorage.getItem('kit.t1')).x.a===1;
    p.set('y',2);p.remove('y');const c=!('y' in p.getAll());p.setAll({z:3});const dd=p.get('z')===3&&p.get('x')===undefined;localStorage.setItem('kit.t1','{broken');const e=p.get('q','d')==='d'&&Object.keys(p.getAll()).length===0;
    // never throws when storage is blocked
    const ls=Object.getOwnPropertyDescriptor(w,'localStorage');let thr=false;try{Object.defineProperty(w,'localStorage',{get(){throw new Error('blocked')},configurable:true});p.set('a',1);p.get('a');p.getAll()}catch(x){thr=true}finally{Object.defineProperty(w,'localStorage',ls)}
    localStorage.removeItem('kit.t1');return {a,b,c,dd,e,thr}`);
  chk('persist get/set/remove/setAll, broken JSON, blocked storage', pe.a && pe.b && pe.c && pe.dd && pe.e && !pe.thr, pe);
  const wc = await KE(`localStorage.removeItem('kit.t1w');
    const root=d.createElement('div');root.innerHTML='<input id="pa" type="text"><input id="pb" type="checkbox"><select id="pc"><option>one</option><option>two</option></select><input id="offsetA" type="text"><input id="start" type="number"><input id="pw" type="password"><input id="pf" type="file"><input type="text" id="" value="noid"><textarea id="pt"></textarea><button id="pbtn">b</button>';
    d.body.appendChild(root);const q=id=>root.querySelector('#'+id);
    const p=Kit.persist('kit.t1w');const W1=p.watchControls(root,Kit.persist.NOT_KEPT);
    q('pa').value='hello';q('pa').dispatchEvent(new w.Event('input',{bubbles:true}));q('pb').checked=true;q('pb').dispatchEvent(new w.Event('change',{bubbles:true}));q('pc').value='two';q('pt').value='long\\ntext';q('offsetA').value='5';q('start').value='9';q('pw').value='secret';
    q('pc').dispatchEvent(new w.Event('change',{bubbles:true}));
    const early=localStorage.getItem('kit.t1w');          // debounced: nothing yet
    await new Promise(r=>setTimeout(r,650));const stored=JSON.parse(localStorage.getItem('kit.t1w'));
    W1.stop();
    // a fresh page state gets the values back and the events fire like a hand
    q('pa').value='';q('pb').checked=false;q('pc').value='one';q('pt').value='';q('offsetA').value='';
    const seen=[];['pa','pb','pc'].forEach(id=>{q(id).addEventListener('input',()=>seen.push(id+':input'));q(id).addEventListener('change',()=>seen.push(id+':change'))});
    const W2=p.watchControls(root,Kit.persist.NOT_KEPT);
    const back={pa:q('pa').value,pb:q('pb').checked,pc:q('pc').value,pt:q('pt').value,offsetA:q('offsetA').value};W2.stop();
    // after stop() nothing more is written
    q('pa').value='again';q('pa').dispatchEvent(new w.Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,600));const still=JSON.parse(localStorage.getItem('kit.t1w')).pa;
    // custom notKept: null keeps everything with an id
    const W3=Kit.persist('kit.t1w2').watchControls(root,null);W3.save();const all=Object.keys(JSON.parse(localStorage.getItem('kit.t1w2')));W3.stop();
    root.remove();localStorage.removeItem('kit.t1w');localStorage.removeItem('kit.t1w2');
    return {early,keys:Object.keys(stored).sort(),pa:stored.pa,pb:stored.pb,pc:stored.pc,pt:stored.pt,back,seen,still,hasOffset:all.includes('offsetA'),hasPw:all.includes('pw')}`);
  chk('watchControls: debounced save, skips files/buttons/passwords/NOT_KEPT/no-id', wc.early === null && JSON.stringify(wc.keys) === '["pa","pb","pc","pt"]' && wc.pa === 'hello' && wc.pb === true && wc.pc === 'two' && wc.pt === 'long\ntext', wc);
  chk('watchControls: restore puts values back and fires input + change', wc.back.pa === 'hello' && wc.back.pb === true && wc.back.pc === 'two' && wc.back.pt === 'long\ntext' && wc.back.offsetA === '' && wc.seen.includes('pa:input') && wc.seen.includes('pa:change') && wc.seen.includes('pc:change'), wc);
  chk('watchControls: stop() ends writing; notKept null keeps offsetA but never passwords', wc.still === 'hello' && wc.hasOffset && !wc.hasPw, wc);

  // ---- 11. mp4-muxer is a byte-identical copy and loads as an ES module in the app
  const mx = await KE(`const a=new Uint8Array(await (await fetch('app://local/shared/lib/mp4-muxer.mjs')).arrayBuffer());const b=new Uint8Array(await (await fetch('app://local/clips/lib/mp4-muxer.mjs')).arrayBuffer());
    let same=a.length===b.length;for(let i=0;same&&i<a.length;i++)if(a[i]!==b[i])same=false;
    const m=await new w.Function('return import("app://local/shared/lib/mp4-muxer.mjs")')();return {same,len:a.length,keys:Object.keys(m).slice(0,6)}`);
  chk('shared/lib/mp4-muxer.mjs identical to clips copy, importable', mx.same && mx.len > 60000 && mx.keys.length > 0, mx);
  const fc = await KE(`const a=await (await fetch('app://local/shared/fonts.css')).text();const b=await (await fetch('app://local/clips/fonts.css')).text();return {same:a===b,faces:(a.match(/@font-face/g)||[]).length}`);
  chk('shared/fonts.css same as clips/fonts.css (6 faces)', fc.same && fc.faces === 6, fc);

  // ---- 12. layout at three sizes: no horizontal scroll, nothing clipped, wraps, scale tokens; screenshots
  const layout = `(()=>{const w=${W},d=w.document,bad=[];
    const clipped=[...d.querySelectorAll('button,.tile span,.sec>.hd b,.tabs button,.seg button,.row>label,.hint,.kit-head h1')].filter(e=>e.offsetParent!==null&&e.clientWidth>0&&e.scrollWidth>e.clientWidth+1).map(e=>e.className+':'+e.textContent.slice(0,24));
    const ell=[];
    const wraps=[...d.querySelectorAll('.row>label')].filter(l=>l.offsetParent!==null&&l.getBoundingClientRect().height>parseFloat(getComputedStyle(l).lineHeight)*1.5).map(l=>l.textContent);
    const btnWrap=[...d.querySelectorAll('button')].filter(b=>b.offsetParent!==null&&b.getBoundingClientRect().height>46).map(b=>b.textContent);
    const hs=d.documentElement.scrollWidth>w.innerWidth+1, bs=d.body.scrollWidth>w.innerWidth+1;
    const head=d.querySelector('.kit-head');const headOver=head.scrollWidth>head.clientWidth+1;
    const cs=getComputedStyle(d.documentElement);
    return {w:w.innerWidth,hs,bs,headOver,clipped,ell,wraps,btnWrap,fs:[cs.getPropertyValue('--fs-l').trim(),cs.getPropertyValue('--fs').trim(),cs.getPropertyValue('--fs-s').trim(),cs.getPropertyValue('--fs-xs').trim()],
      panelW:Math.round(d.getElementById('panel').getBoundingClientRect().width)}})()`;
  const sizes = [[1920, 1080], [1280, 720], [2560, 1440]];
  for (const [w, h] of sizes) {
    await command('Emulation.setDeviceMetricsOverride', {width: w, height: h, deviceScaleFactor: 1, mobile: false});
    await delay(500);
    await KE(`d.getElementById('stage').scrollTop=0;d.getElementById('panel').scrollTop=0;Kit.toast.hide();d.getElementById('dropped').textContent='';return 1`);
    const L = await evaluate(layout);
    chk('layout ' + w + ': no horizontal scroll, header fits', !L.hs && !L.bs && !L.headOver, L);
    chk('layout ' + w + ': no clipped text, no wrapped labels or buttons', L.clipped.length === 0 && L.wraps.length === 0 && L.btnWrap.length === 0 && L.ell.length === 0, L);
    if (w >= 2200) chk('type scale +1 at ' + w, L.fs.join() === '14px,13px,12px,11px', L.fs);
    else chk('type scale at ' + w, L.fs.join() === '13px,12px,11px,10px', L.fs);
    await shot('kit-' + w + '-top');
    if (w !== 2560) {
      await KE(`const s=d.getElementById('stage');s.scrollTop=d.getElementById('cIcons').offsetTop-10;return 1`);
      await delay(150);
      await shot('kit-' + w + '-icons');
      // keys popover + dialog + toast over the page
      await KE(`d.getElementById('stage').scrollTop=0;Kit.keys();Kit.toast('Exported 3 files',{undo:()=>{}});return 1`);
      await delay(350);
      await shot('kit-' + w + '-keys-toast');
      await KE(`Kit.keys.close();Kit.dialog({title:'Empty the tray',text:'Delete all 12 clips from the tray? This cannot be undone.',buttons:[{id:'c',label:'Cancel',focus:true},{id:'ok',label:'Delete all',danger:true}]});return 1`);
      await delay(250);
      await shot('kit-' + w + '-dialog');
      await KE(`d.querySelector('.kit-dlg-btns button').click();return 1`);
      await KE(`Kit.prompt('Rename the sheet',{value:'contact-sheet'});return 1`);
      await delay(250);
      await shot('kit-' + w + '-prompt');
      await KE(`if(Kit.dialogOpen())d.querySelector('.kit-dlg-btns button').click();return 1`);
    }
  }
  await KE(`if(Kit.dialogOpen()){d.querySelector('.kit-dlg-btns button').click()}return 1`);
  await command('Emulation.setDeviceMetricsOverride', {width: 1700, height: 1000, deviceScaleFactor: 1, mobile: false});

  // ---- 12b. close-up of the icons (device scale 3), two halves of the media rows, for the eye
  {
    const fs = require('node:fs'), path = require('node:path');
    await command('Emulation.setDeviceMetricsOverride', {width: 1920, height: 1080, deviceScaleFactor: 3, mobile: false});
    await delay(500);
    const rect = await KE(`const t=[...d.querySelectorAll('#tiles .tile')];const a=t[0].getBoundingClientRect(),b=t[27].getBoundingClientRect();const mid=(a.left+t[13].getBoundingClientRect().right)/2;
      return {x0:a.left,x1:t[13].getBoundingClientRect().right,mid,y0:a.top,y1:b.bottom,t2:t[14].getBoundingClientRect().top}`);
    const dir = path.join(__dirname, 'shots');
    const parts = [['kit-icons-zoom-a', rect.x0, rect.mid], ['kit-icons-zoom-b', rect.mid, rect.x1]];
    for (const [name, x0, x1] of parts) {
      const r = await command('Page.captureScreenshot', {format: 'png', clip: {x: x0, y: rect.y0, width: x1 - x0, height: rect.y1 - rect.y0, scale: 3}});
      const f = path.join(dir, name + '.png'); fs.writeFileSync(f, Buffer.from(r.data, 'base64')); out.shots.push(f);
    }
    await command('Emulation.setDeviceMetricsOverride', {width: 1700, height: 1000, deviceScaleFactor: 1, mobile: false});
  }

  // ---- 13. no page errors in the demo
  const errs = await KE(`return w.__errs`);
  chk('no errors raised in the demo page', errs.length === 0, errs);
  return out;
};
