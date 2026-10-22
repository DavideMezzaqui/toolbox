'use strict';
// Annotate (app/annotate): every tool draws, a click that only selects adds no undo step, Save proposes
// <source>_annotated.png, object URLs are revoked, the canvas is not resized on pointer moves, the toolbar never wraps,
// last tool/colour are remembered, and the Studio embed contract (register / actions / onReceive) works.
// The page runs in the "annotate" mode iframe of the real Studio host (?embed=1); ev() runs in that nested frame and `parent` is
// the host (header title/actions/status, toasts and the shortcuts popover live there). The last section checks the page standalone.
//   APP_ROOT=<copy> TAB=annotate PORT=<port> node tests/stress/run-tab.cjs tests/stress/annotate/t1.cjs
module.exports = async ({ev, evaluate, command, until, delay, capture, reload}) => {
  const out = {ok: true, checks: {}, shots: []};
  const chk = (n, v, extra) => { out.checks[n] = extra === undefined ? !!v : {ok: !!v, v: extra}; if (!v) out.ok = false; };
  const shot = async name => { out.shots.push(await capture(name)); };
  const $ = id => `document.getElementById(${JSON.stringify(id)})`;
  const MODE = "frames.studio.contentWindow.Studio.modes.find(m=>m.id==='annotate')";   // the host's record of the mode
  const EMBED = 'app://local/annotate/index.html?embed=1', STANDALONE = 'app://local/annotate/index.html';
  // size(w, h) sizes the MODE frame (what the page sees), the window is that plus the Studio rail and shell bar
  const chrome = () => evaluate(`(()=>{const b=${MODE}.frame.getBoundingClientRect();return {dx:innerWidth-b.width,dy:innerHeight-b.height,w:b.width}})()`);
  const size = async (w, h) => {
    for (let i = 0; i < 4; i++) {
      const c = await chrome();
      if (Math.round(c.w) === w && i > 0) break;
      await command('Emulation.setDeviceMetricsOverride', {width: Math.round(w + c.dx), height: Math.round(h + c.dy), deviceScaleFactor: 1, mobile: false});
      await delay(150);
    }
  };

  // ---- helpers: real mouse events through CDP (pointer capture needs a real pointer id)
  const frameRect = async () => evaluate(`(()=>{const a=frames.studio.getBoundingClientRect(),b=${MODE}.frame.getBoundingClientRect();return {x:a.left+b.left,y:a.top+b.top}})()`);
  const stageRect = async () => { const f = await frameRect(); const s = await ev(`(()=>{const r=${$('stage')}.getBoundingClientRect();return {x:r.left,y:r.top,w:r.width,h:r.height}})()`); return {x: f.x + s.x, y: f.y + s.y, w: s.w, h: s.h}; };
  const mouse = (type, x, y, extra) => command('Input.dispatchMouseEvent', Object.assign({type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1}, extra || {}));
  async function drag(pts) {      // pts in stage coordinates
    const s = await stageRect();
    const P = pts.map(p => [s.x + p[0], s.y + p[1]]);
    await mouse('mouseMoved', P[0][0], P[0][1], {button: 'none', buttons: 0});
    await mouse('mousePressed', P[0][0], P[0][1]);
    for (let i = 1; i < P.length; i++) await mouse('mouseMoved', P[i][0], P[i][1]);
    await mouse('mouseReleased', P[P.length - 1][0], P[P.length - 1][1]);
    await delay(40);
  }
  const click = (x, y) => drag([[x, y]]);
  const status = () => ev(`${$('status')}.textContent`);
  const count = async () => { const m = /(\d+) annotation/.exec(await status()); return m ? +m[1] : -1; };
  const tool = id => ev(`${$('t_' + id)}.click()`);
  const undoOnce = () => ev(`${$('undo')}.click()`);
  const makeImage = (name, type) => ev(`(async()=>{const c=document.createElement('canvas');c.width=800;c.height=500;const g=c.getContext('2d');
    const gr=g.createLinearGradient(0,0,800,500);gr.addColorStop(0,'#335');gr.addColorStop(1,'#a85');g.fillStyle=gr;g.fillRect(0,0,800,500);
    g.fillStyle='#fff';g.fillRect(100,100,200,120);g.fillStyle='#222';g.fillRect(450,250,250,150);
    const b=await new Promise(r=>c.toBlob(r,'image/png'));const f=new File([b],${JSON.stringify(name)},{type:${JSON.stringify(type || 'image/png')}});
    const dt=new DataTransfer();dt.items.add(f);const inp=${$('file')};inp.files=dt.files;inp.dispatchEvent(new Event('change',{bubbles:true}));return 1})()`);
  const loaded = async (w, h) => { await until(async () => (await status()).startsWith(w + '×' + h), 'image ' + w + 'x' + h, 8000); await delay(60); };

  // clean slate for the remembered tool/colour of a previous run
  await ev(`localStorage.removeItem('annotate.ui');1`);
  await size(1700, 1000);

  // ---- 1. load, kit look, toolbar on one row at every width
  const look = await ev(`(()=>{const cs=getComputedStyle(document.body);const tb=${$('tb')};const hb=[...document.querySelectorAll('#tools button')];
    return {kit:document.body.classList.contains('kit'),bg:cs.backgroundColor,tools:hb.map(b=>b.id),svg:hb.every(b=>b.querySelector('svg.ic path')),
      primary:getComputedStyle(${$('save')}).backgroundColor,sw:document.querySelectorAll('#swatches .sw').length,
      redUi:[...document.querySelectorAll('#tools button.on, button.primary')].some(b=>/229, ?72, ?77/.test(getComputedStyle(b).borderColor+getComputedStyle(b).backgroundColor)),
      ids:['paste','open','undo','redo','clear','copy','save','colorCustom','weight','weightV','zoomIn','zoomOut','fit','zoomV','textEdit','file','empty'].filter(i=>!document.getElementById(i))}})()`);
  chk('kit page, nine tools with svg icons, 8 swatches, all old ids present', look.kit && look.bg === 'rgb(16, 16, 18)' && look.tools.join() === 't_select,t_arrow,t_rect,t_ellipse,t_highlight,t_pen,t_text,t_number,t_blur' && look.svg && look.sw === 8 && look.ids.length === 0, look);
  chk('primary is white, no red accent on active/primary buttons', look.primary === 'rgb(230, 230, 232)' && !look.redUi, look.primary);
  for (const w of [1920, 1280, 1000, 760]) {
    await size(w, 800); await delay(250);
    const r = await ev(`(()=>{const tb=${$('tb')};const kids=[...tb.children].filter(c=>c.offsetParent!==null);const tops=new Set(kids.map(c=>Math.round(c.getBoundingClientRect().top)));
      return {h:tb.getBoundingClientRect().height,sw:tb.scrollWidth,cw:tb.clientWidth,cls:tb.className,rows:tops.size,docOverflow:document.documentElement.scrollWidth>innerWidth}})()`);
    chk('toolbar single row, no overflow at ' + w, r.h < 48 && r.sw <= r.cw + 1 && !r.docOverflow, r);
  }
  await size(1280, 800); await delay(200);

  // ---- 2. load an image: save/copy enable, status, empty state gone
  await makeImage('my shot.png');
  await loaded(800, 500);
  chk('image loaded, save/copy enabled', await ev(`!${$('save')}.disabled && !${$('copy')}.disabled && ${$('empty')}.style.display==='none'`));

  // spies: object URLs, canvas resizes, Kit.save
  await ev(`window.__urls={c:0,r:0};const oc=URL.createObjectURL.bind(URL),or=URL.revokeObjectURL.bind(URL);URL.createObjectURL=b=>{__urls.c++;return oc(b)};URL.revokeObjectURL=u=>{__urls.r++;return or(u)};
    window.__resizes=0;const cvEl=${$('cv')};for(const k of ['width','height']){const d=Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype,k);Object.defineProperty(cvEl,k,{configurable:true,get(){return d.get.call(this)},set(v){__resizes++;d.set.call(this,v)}})}
    window.__saved=[];Kit.save=(b,n)=>{__saved.push({n,size:b.size,type:b.type});return n};1`);

  // ---- 3. each tool draws
      await ev(`${$('fit')}.click()`);
  const view = await ev(`(()=>{const r=${$('stage')}.getBoundingClientRect();return {w:r.width,h:r.height}})()`);
  // positions inside the fitted image (800x500 centred): use the middle third of the stage
  const X = (f) => Math.round(view.w * f), Y = (f) => Math.round(view.h * f);
  await tool('arrow');     await drag([[X(.30), Y(.30)], [X(.40), Y(.38)], [X(.46), Y(.42)]]);
  chk('arrow adds one', await count() === 1);
  await tool('rect');      await drag([[X(.30), Y(.50)], [X(.40), Y(.60)], [X(.45), Y(.66)]]);
  await tool('ellipse');   await drag([[X(.50), Y(.30)], [X(.56), Y(.38)], [X(.62), Y(.44)]]);
  await tool('highlight'); await drag([[X(.50), Y(.50)], [X(.56), Y(.55)], [X(.62), Y(.58)]]);
  await tool('pen');       await drag([[X(.34), Y(.72)], [X(.38), Y(.76)], [X(.42), Y(.72)], [X(.46), Y(.77)], [X(.50), Y(.73)]]);
  await tool('blur');      await drag([[X(.55), Y(.64)], [X(.60), Y(.68)], [X(.66), Y(.72)]]);
  await tool('number');    await click(X(.66), Y(.32)); await click(X(.70), Y(.32));
  chk('rect, ellipse, highlight, pen, pixelate, 2 markers: 8 annotations', await count() === 8, await status());
  // text: click, type, Enter
  await tool('text');      await click(X(.36), Y(.86));
  await delay(120);
  await command('Input.insertText', {text: 'Hello'});
  await command('Input.dispatchKeyEvent', {type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13});
  await command('Input.dispatchKeyEvent', {type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13});
  await delay(150);
  chk('text adds one (9 annotations)', await count() === 9, await status());
  // an empty text box adds nothing and leaves no undo step behind
  await click(X(.20), Y(.20)); await delay(100); await ev(`document.activeElement.blur();1`); await delay(200);
  chk('empty text box discarded', await count() === 9);
  // every shape drew something: compare composed canvas against the plain image
  const painted = await ev(`(async()=>{const c=${$('cv')};const g=c.getContext('2d');const d=g.getImageData(0,0,c.width,c.height).data;let col=new Set();for(let i=0;i<d.length;i+=4*97)col.add(d[i]+','+d[i+1]+','+d[i+2]);return col.size})()`);
  chk('canvas shows content', painted > 20, painted);
  await shot('annotate-1280-annotated');

  // undo steps: nine shapes = nine steps (the empty text box left none behind)
  let steps = 0;
  while (!(await ev(`${$('undo')}.disabled`)) && steps < 80) { await undoOnce(); steps++; }
  chk('9 shapes = 9 undo steps (no stray step from the empty text box)', steps === 9 && await count() === 0, steps);
  for (let i = 0; i < steps; i++) await ev(`${$('redo')}.click()`);
  chk('redo brings them all back', await count() === 9);

  // ---- 4. a click that only selects adds no undo step; a real move adds exactly one
  await makeImage('select test.png'); await loaded(800, 500);
  await tool('rect'); await drag([[X(.30), Y(.30)], [X(.45), Y(.45)], [X(.50), Y(.50)]]);
  await tool('select');
  await click(X(.40), Y(.40));          // the middle of the rect: selects it
  await click(X(.40), Y(.40));
  await click(X(.30), Y(.30));          // a corner handle, still no movement
  await undoOnce();
  chk('select-only clicks add no undo step (one undo removes the rect)', await count() === 0 && await ev(`${$('undo')}.disabled`), await status());
  await ev(`${$('redo')}.click()`);
  chk('redo restores the rect', await count() === 1);
  await click(X(.40), Y(.40));
  await drag([[X(.40), Y(.40)], [X(.43), Y(.43)], [X(.48), Y(.50)]]);   // move it for real
  await undoOnce();
  chk('a real move is one undo step and keeps the shape', await count() === 1 && !(await ev(`${$('undo')}.disabled`)));
  await undoOnce();
  chk('second undo removes the rect', await count() === 0);

  // ---- 5. Save proposes a name from the source file
  await makeImage('my shot.png'); await loaded(800, 500);
  await ev(`__saved.length=0;${$('save')}.click()`);
  await until(() => ev(`__saved.length===1`), 'save 1', 5000);
  let sv = await ev(`__saved[0]`);
  chk('Save name from source: my shot_annotated.png', sv.n === 'my shot_annotated.png' && sv.type === 'image/png' && sv.size > 1000, sv);
  await makeImage('already_annotated.png'); await loaded(800, 500);
  await ev(`__saved.length=0;${$('save')}.click()`);
  await until(() => ev(`__saved.length===1`), 'save 2', 5000);
  chk('no doubled _annotated', (await ev(`__saved[0].n`)) === 'already_annotated.png');
  await makeImage('image.png'); await loaded(800, 500);
  await ev(`__saved.length=0;document.dispatchEvent(new KeyboardEvent('keydown',{key:'s',ctrlKey:true,bubbles:true}))`);
  await until(() => ev(`__saved.length===1`), 'save 3', 5000);
  chk('clipboard-style name falls back to annotated.png (Ctrl+S)', (await ev(`__saved[0].n`)) === 'annotated.png');

  // ---- 6. object URLs revoked, canvas not resized on pointer moves
  const urls = await ev(`__urls`);
  chk('every object URL created for an image is revoked', urls.c >= 4 && urls.r >= urls.c, urls);
  await ev(`__resizes=0;1`);
  await tool('pen'); await drag([[X(.30), Y(.30)], [X(.32), Y(.33)], [X(.34), Y(.31)], [X(.36), Y(.35)], [X(.38), Y(.32)], [X(.40), Y(.36)]]);
  await tool('select'); await drag([[X(.60), Y(.60)], [X(.62), Y(.62)], [X(.64), Y(.64)]]);
  chk('canvas width/height not reassigned during pointer moves', await ev(`__resizes`) === 0, await ev(`__resizes`));
  await size(1100, 800); await delay(300);
  chk('...but resized when the window resizes', await ev(`__resizes`) > 0);
  await size(1280, 800); await delay(200);

  // ---- 7. last tool and colour remembered (reload)
  await tool('ellipse');
  await ev(`document.querySelectorAll('#swatches .sw')[4].click()`);
  await ev(`(()=>{const w=${$('weight')};w.value=9;w.dispatchEvent(new Event('input',{bubbles:true}));w.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  await delay(600);
  await reload();
  await delay(500);
  const rem = await ev(`({tool:document.querySelector('#tools button.on')?.id,sw:[...document.querySelectorAll('#swatches .sw')].findIndex(b=>b.classList.contains('on')),custom:document.getElementById('colorCustom').value,w:${$('weight')}.value,ui:localStorage.getItem('annotate.ui')})`);
  chk('tool, swatch and width restored after reload', rem.tool === 't_ellipse' && rem.sw === 4 && rem.custom === '#4aa3f0' && rem.w === '9', rem);
  chk('toolbox.controls.annotate still receives colorCustom/weight (shell contract)', await evaluate(`(()=>{try{const k=JSON.parse(localStorage.getItem('toolbox.controls.annotate')||'{}');return 'colorCustom' in k && 'weight' in k}catch(e){return false}})()`));
  await shot('annotate-1280-empty');

  // ---- 8. screenshots standalone at 1920 with an annotated image
  await size(1920, 1080); await delay(250);
  await makeImage('wide.png'); await loaded(800, 500);
  const v2 = await ev(`(()=>{const r=${$('stage')}.getBoundingClientRect();return {w:r.width,h:r.height}})()`);
  const X2 = f => Math.round(v2.w * f), Y2 = f => Math.round(v2.h * f);
  await ev(`document.querySelectorAll('#swatches .sw')[0].click()`);
  await tool('rect'); await drag([[X2(.36), Y2(.30)], [X2(.45), Y2(.40)], [X2(.52), Y2(.46)]]);
  await ev(`document.querySelectorAll('#swatches .sw')[3].click()`);
  await tool('arrow'); await drag([[X2(.62), Y2(.62)], [X2(.58), Y2(.58)], [X2(.52), Y2(.5)]]);
  await tool('number'); await click(X2(.36), Y2(.26));
  await tool('select'); await click(X2(.36), Y2(.30));
  await shot('annotate-1920-annotated');

  // ---- 9. embedded in the real Studio host: hidden header, registered actions/status/title in the host, Studio.send, toasts and shortcuts in the host
  await reload();            // a pristine page: nothing loaded, actions at their initial state
  await delay(500);
  await until(() => ev(`parent.Studio.modes.find(m=>m.id==='annotate').state==='ready'`), 'annotate registered with the host', 15000);
  const hostBtn = id => `parent.document.querySelector('#actions [data-action=${id}]')`;
  const emb = await ev(`(()=>{const M=parent.Studio.modes.find(m=>m.id==='annotate'),r=M.spec,H=parent.document;
    return {realHost:parent!==window&&typeof parent.Studio.register==='function'&&typeof parent.Studio.trayItems==='function',active:parent.Studio.mode(),hidden:M.frame.hidden,
      id:r.id,title:r.title,hostTitle:H.getElementById('title').textContent,actions:r.actions.map(a=>a.id+':'+a.label+(a.primary?'*':'')),
      hostBtns:[...H.querySelectorAll('#actions button')].map(b=>b.dataset.action+':'+b.textContent.trim()+(b.classList.contains('primary')?'*':'')),
      acc:r.accepts,groups:r.shortcuts.map(g=>g[0]),recv:typeof r.onReceive,show:typeof r.onShow,hide:typeof r.onHide}})()`);
  chk('registers with the real host: id/title/actions/accepts/shortcuts', emb && emb.realHost && emb.active === 'annotate' && emb.hidden === false && emb.id === 'annotate' && emb.title === 'Annotate' && emb.hostTitle === 'Annotate'
    && emb.actions.join() === 'open:Open,paste:Paste,undo:Undo,redo:Redo,copy:Copy,save:Save PNG*' && emb.acc.join() === 'image/*' && emb.groups.length >= 3 && emb.recv === 'function' && emb.show === 'function' && emb.hide === 'function', emb);
  chk('the host header shows the same six buttons in order', emb.hostBtns.join() === 'open:Open,paste:Paste,undo:Undo,redo:Redo,copy:Copy,save:Save PNG*', emb.hostBtns);
  chk('embedded: own header hidden', await ev(`document.body.classList.contains('embed') && getComputedStyle(document.getElementById('head')).display==='none'`));
  chk('actions start disabled for undo/redo/copy/save (host buttons)', await ev(`${hostBtn('save')}.disabled && ${hostBtn('copy')}.disabled && ${hostBtn('undo')}.disabled && ${hostBtn('redo')}.disabled && !${hostBtn('open')}.disabled && !${hostBtn('paste')}.disabled`));
  // the host sends an image (the route a tray click or a drop on the rail takes)
  const sent = await ev(`(async()=>{const c=document.createElement('canvas');c.width=640;c.height=360;const g=c.getContext('2d');g.fillStyle='#456';g.fillRect(0,0,640,360);g.fillStyle='#eee';g.fillRect(60,60,200,100);
    const b=await new Promise(r=>c.toBlob(r,'image/png'));return parent.Studio.send('annotate',[new File([b],'from tray.png',{type:'image/png'})])})()`);
  chk('Studio.send accepts the image', sent === true);
  await loaded(640, 360);
  chk('Studio.send loads the image and enables Save/Copy in the host', await ev(`!${hostBtn('save')}.disabled && !${hostBtn('copy')}.disabled`));
  chk('status is reported to the host (state and header)', await ev(`parent.Studio.modes.find(m=>m.id==='annotate').status.startsWith('640×360') && parent.document.getElementById('status').textContent.startsWith('640×360')`));
  await ev(`window.__saved=[];Kit.save=(b,n)=>{__saved.push(n)};window.__errs=[];addEventListener('error',e=>__errs.push(e.message));addEventListener('unhandledrejection',e=>__errs.push(String(e.reason)));1`);
  await ev(`${$('t_rect')}.click()`);
  await drag([[160, 140], [220, 190], [300, 230]]);
  chk('embedded: undo button enabled in the host after drawing', await ev(`!${hostBtn('undo')}.disabled`));
  await ev(`${hostBtn('save')}.click()`);
  await until(() => ev(`__saved.length===1`), 'embedded save', 5000);
  chk('embedded: the host Save button saves from_tray_annotated', (await ev(`__saved[0]`)) === 'from tray_annotated.png');
  await ev(`${hostBtn('undo')}.click()`);
  chk('embedded: host Undo button runs, Redo gets enabled', await count() === 0 && await ev(`!${hostBtn('redo')}.disabled && ${hostBtn('undo')}.disabled`));
  await ev(`${hostBtn('redo')}.click()`);
  chk('embedded: host Redo button runs', await count() === 1);
  // a toast raised by the page shows in the host, not in the page
  await ev(`(async()=>{const f=new File([new Uint8Array(40)],'broken.png',{type:'image/png'});parent.Studio.send('annotate',[f]);return 1})()`);
  await until(() => ev(`/Could not read that image/.test((parent.document.querySelector('.kit-toast.on')||{}).textContent||'')`), 'host toast', 5000);
  chk('embedded: the page toast is shown by the host, none in the page', await ev(`!document.querySelector('.kit-toast.on')`));
  // a file the mode does not take is refused by the host
  chk('Studio.send refuses a text file', await ev(`parent.Studio.send('annotate',[new File(['x'],'a.txt',{type:'text/plain'})])`) === false);
  // shortcuts: ? in the page opens nothing of its own, the host button opens the host popover with this mode's groups
  chk('embedded: ? does not open the page popover (the host owns it)', await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'?',bubbles:true}));!document.querySelector('.kit-keys')`));
  await ev(`parent.document.getElementById('bKeys').click()`);
  const keys = await ev(`(parent.document.querySelector('.kit-keys')||{}).textContent||''`);
  chk('host Shortcuts popover merges Studio + Annotate groups', /Switch mode/.test(keys) && /Remove the selection/.test(keys) && /Save as PNG/.test(keys), keys.slice(0, 120));
  await shot('annotate-1920-embedded-keys');
  await ev(`parent.Kit.keys.close();1`);
  // leaving the mode and coming back keeps the drawing
  await ev(`parent.Studio.show('join');1`);
  await delay(300);
  await ev(`parent.Studio.show('annotate');1`);
  await delay(300);
  chk('switching away and back keeps the image and its annotation', await count() === 1 && await ev(`!${hostBtn('save')}.disabled`));
  await ev(`${$('t_select')}.click()`);
  await click(160, 140);
  await shot('annotate-1920-embedded');
  await size(1280, 800); await delay(300);
  await shot('annotate-1280-embedded');
  chk('no page errors while embedded', (await ev('__errs')).length === 0, await ev('__errs'));
  chk('embedded toolbar single row at 1280', await ev(`(()=>{const tb=document.getElementById('tb');return tb.getBoundingClientRect().height<48 && tb.scrollWidth<=tb.clientWidth+1})()`));
  chk('Studio header fits at 1280', await ev(`(()=>{const h=parent.document.getElementById('head');return h.scrollWidth<=h.clientWidth+1})()`));

  // ---- 10. the same page standalone (no ?embed): own header and buttons, never registers with the host, toasts in the page
  await evaluate(`${MODE}.frame.src=${JSON.stringify(STANDALONE)};1`);
  await delay(600);
  await until(() => ev(`document.readyState==='complete' && !!document.getElementById('stage') && !Embed.active`), 'standalone annotate', 15000);
  await delay(1800);       // the host waits 1.5 s for a registration, then treats the page as a plain one
  await makeImage('plain.png'); await loaded(800, 500);
  await ev(`window.__saved=[];Kit.save=(b,n)=>{__saved.push(n);return n};1`);
  const sa = await ev(`(()=>{const M=parent.Studio.modes.find(m=>m.id==='annotate'),hd=document.getElementById('head'),sv=document.getElementById('save');
    return {embed:Embed.active,bodyEmbed:document.body.classList.contains('embed'),head:getComputedStyle(hd).display,headBtn:hd.contains(sv)&&sv.offsetParent!==null&&!sv.disabled,state:M.state,spec:!!M.spec,hostActions:parent.document.querySelectorAll('#actions button').length}})()`);
  chk('standalone: own header and Save button shown, page not registered with the host', sa.embed === false && sa.bodyEmbed === false && sa.head !== 'none' && sa.headBtn && sa.state === 'legacy' && sa.spec === false && sa.hostActions === 0, sa);
  await ev(`${$('save')}.click()`);
  await until(() => ev(`__saved.length===1`), 'standalone save', 5000);
  chk('standalone: the page Save button saves plain_annotated.png', (await ev(`__saved[0]`)) === 'plain_annotated.png');
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'?',bubbles:true}))`);
  chk('standalone: ? opens the page own shortcuts popover', await ev(`!!document.querySelector('.kit-keys')`));
  await ev(`Kit.keys.close();1`);
  await ev(`(async()=>{const f=new File([new Uint8Array(40)],'broken.png',{type:'image/png'});const dt=new DataTransfer();dt.items.add(f);const inp=${$('file')};inp.files=dt.files;inp.dispatchEvent(new Event('change',{bubbles:true}));return 1})()`);
  await until(() => ev(`/Could not read that image/.test((document.querySelector('.kit-toast.on')||{}).textContent||'')`), 'page toast', 5000);
  chk('standalone: the toast is in the page, none in the host', await ev(`!parent.document.querySelector('.kit-toast.on')`));
  await shot('annotate-1280-standalone');

  // back to the embedded page and the usual window size for the final state
  await size(1700, 1000);
  await evaluate(`${MODE}.frame.src=${JSON.stringify(EMBED)};1`);
  await delay(500);
  await until(() => ev('document.readyState==="complete" && Embed.active'), 'embedded again', 10000);
  await ev('window.qaErrors=[];addEventListener("error",e=>qaErrors.push(e.message));1');
  await command('Emulation.setDeviceMetricsOverride', {width: 1700, height: 1000, deviceScaleFactor: 1, mobile: false});
  return out;
};
