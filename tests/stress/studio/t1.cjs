'use strict';
// Studio host (app/studio): rail, lifecycle, registration from a fake page, tray, send, drop routing,
// control persistence, old lastTab ids. ev runs in the Studio host frame; nested modes are reached
// through Studio.modes[i].win (same origin).
//   APP_ROOT=<copy> TAB=studio PORT=<port> node tests/stress/run-tab.cjs tests/stress/studio/t1.cjs
module.exports = async ({ ev, evaluate, command, until, delay, capture }) => {
  const out = { ok: true, checks: {}, notes: [], shots: [] };
  const chk = (n, v, extra) => { out.checks[n] = extra === undefined ? !!v : { ok: !!v, v: extra }; if (!v) { out.ok = false; console.log('FAIL', n, extra === undefined ? '' : JSON.stringify(extra)); } };
  const J = JSON.stringify;
  const modeEv = (id, code) => ev(`(async()=>{const m=Studio.modes.find(x=>x.id===${J(id)});return await m.win.eval(${J(code)})})()`);
  const state = id => ev(`Studio.modes.find(x=>x.id===${J(id)}).state`);
  const shot = async n => { out.shots.push(await capture(n)); };
  const goTest = async (id, query) => {   // load the fake page into a mode's frame
    await ev(`(()=>{Studio.show(${J(id)});const m=Studio.modes.find(x=>x.id===${J(id)});m.frame.src='test-mode.html?embed=1${query || ''}';return 1})()`);
    await delay(300);
  };
  const mouse = async (x, y) => {   // x, y in the Studio frame; the shell's bar sits above it
    const o = await evaluate('(()=>{const r=frames.studio.getBoundingClientRect();return [r.x,r.y]})()'); x += o[0]; y += o[1];
    await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await command('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await command('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  };
  const center = sel => ev(`(()=>{const r=document.querySelector(${J(sel)}).getBoundingClientRect();return [Math.round(r.x+r.width/2),Math.round(r.y+r.height/2)]})()`);
  const makeFiles = `window.mkPng=async(name,hue)=>{const c=document.createElement('canvas');c.width=320;c.height=180;const g=c.getContext('2d');g.fillStyle='hsl('+hue+',55%,40%)';g.fillRect(0,0,320,180);g.fillStyle='#fff';g.font='bold 80px Arial';g.fillText(name[0],130,115);const b=await new Promise(r=>c.toBlob(r,'image/png'));return new File([b],name,{type:'image/png',lastModified:hue})};
    window.mkVid=(name)=>new File([new Uint8Array(64)],name,{type:'video/mp4',lastModified:5});
    window.dropOn=(target,files)=>{const dt=new DataTransfer();files.forEach(f=>dt.items.add(f));const ev=new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt});target.dispatchEvent(ev);return ev.defaultPrevented};1`;

  await until(() => ev('Studio.mode()'), 'studio ready');
  await ev(makeFiles);

  // ---- 1. rail
  chk('rail: 8 modes, two groups', await ev(`document.querySelectorAll('#railList .mode').length===8 && [...document.querySelectorAll('#railList .rg')].map(x=>x.textContent).join()==='Video,Image'`));
  chk('rail: order of the modes', await ev(`[...document.querySelectorAll('#railList .mode')].map(b=>b.dataset.id).join()==='join,compare,grid,sheet,flipbook,annotate,textures,texgen'`));
  chk('starts on Join', await ev('Studio.mode()') === 'join');
  const [rx, ry] = await center('.mode[data-id="sheet"]');
  await mouse(rx, ry);
  await until(() => ev('Studio.mode()==="sheet"'), 'rail click');
  chk('a real click on the rail switches mode', true);
  chk('only the active frame is visible, others kept', await ev(`Studio.modes.filter(m=>m.frame&&!m.frame.hidden).map(m=>m.id).join()==='sheet' && Studio.modes.find(m=>m.id==='join').frame instanceof HTMLIFrameElement`));
  chk('mode is remembered (studio.mode)', await ev(`localStorage.getItem('studio.mode')`) === 'sheet');
  /* Sheet is a converted mode now (2.0): it registers, its own header is hidden and its actions are in the host */
  chk('converted mode registers (Sheet)', await until(async () => (await state('sheet')) === 'ready', 'sheet ready', 8000).then(() => true, () => false));
  chk('converted mode: actions in the host header, mode title', await ev(`document.getElementById('actions').children.length>0 && document.getElementById('title').textContent==='Contact sheet'`));
  chk('converted mode hides its own header', await modeEv('sheet', `!document.querySelector('header') || document.querySelector('header').offsetHeight===0`));

  // ---- 2. keys
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{code:'Digit2',altKey:true,bubbles:true,cancelable:true}))`);
  chk('Alt+2 -> Compare', await ev('Studio.mode()') === 'compare');
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{code:'Digit3',key:'#',ctrlKey:true,shiftKey:true,bubbles:true,cancelable:true}))`);
  chk('Ctrl+Shift+3 -> Grid', await ev('Studio.mode()') === 'grid');
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{code:'Digit4',ctrlKey:true,bubbles:true,cancelable:true}))`);
  chk('Ctrl+4 alone is not a Studio key', await ev('Studio.mode()') === 'grid');
  await modeEv('grid', `document.dispatchEvent(new KeyboardEvent('keydown',{code:'Digit1',altKey:true,bubbles:true,cancelable:true}))`);
  chk('Alt+1 pressed inside a nested frame -> Join', await ev('Studio.mode()') === 'join');
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyB',key:'b',ctrlKey:true,bubbles:true,cancelable:true}))`);
  chk('Ctrl+B collapses the rail to icons', await ev(`document.getElementById('app').classList.contains('slim') && document.getElementById('rail').offsetWidth<70`));
  chk('rail state remembered', await ev(`localStorage.getItem('studio.rail')`) === 'slim');
  await shot('studio-slim');
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyB',key:'b',ctrlKey:true,bubbles:true,cancelable:true}))`);
  chk('Ctrl+B again expands it', await ev(`!document.getElementById('app').classList.contains('slim')`));
  // the shell's Ctrl+2 from inside a nested frame reaches the shell
  await modeEv('join', `document.dispatchEvent(new KeyboardEvent('keydown',{code:'Digit2',key:'2',ctrlKey:true,bubbles:true,cancelable:true}))`);
  chk('Ctrl+2 inside a nested frame switches the Toolbox tab', await evaluate('current') === 'store');
  await evaluate('show("studio")');
  await delay(200);
  chk('and Studio is back with its state', await ev('Studio.mode()') === 'join');
  chk('the nested frame got the desktop bridge when the shell has one', await evaluate('!!window.desktop') === await ev(`!!Studio.modes.find(m=>m.id==='join').win.desktop`));

  // ---- 3. a registering page: actions, status, shortcuts, lifecycle
  await goTest('texgen');
  await until(async () => (await state('texgen')) === 'ready', 'fake page registered', 8000);
  chk('register: title in the header', await ev(`document.getElementById('title').textContent`) === 'Test mode');
  chk('register: status slot', await ev(`document.getElementById('status').textContent`) === '3 things, 0:42');
  chk('register: actions in order', await ev(`[...document.querySelectorAll('#actions button')].map(b=>b.dataset.action).join()`) === 'a1,a2,dis,go');
  chk('register: primary is white, disabled is disabled', await ev(`(()=>{const b=[...document.querySelectorAll('#actions button')];return b[3].classList.contains('primary')&&!b[0].classList.contains('primary')&&b[2].disabled&&!b[0].disabled})()`));
  chk('register: icon + label, tip carries the key', await ev(`(()=>{const b=document.querySelector('#actions button[data-action=a1]');return !!b.querySelector('svg.ic')&&b.textContent.trim()==='Run A'&&b.title==='Runs A  (A)'})()`));
  chk('register: the page hides its own header (body.embed)', await modeEv('texgen', `getComputedStyle(document.querySelector('header')).display==='none'`));
  chk('register: onShow was called for the visible page', J(await modeEv('texgen', 'events')) === J(['show']));
  await ev(`document.querySelector('#actions button[data-action=a1]').click()`);
  await ev(`document.querySelector('#actions button[data-action=dis]').click()`);
  const [gx, gy] = await center('#actions button[data-action=go]');
  await mouse(gx, gy);
  chk('actions run in the page (disabled one does not)', J(await modeEv('texgen', 'ran')) === J(['a1', 'go']));
  chk('page can set the status through Embed.status', await ev(`document.getElementById('status').textContent`) === 'exported');
  const [ax, ay] = await center('#actions button[data-action=a2]');
  await mouse(ax, ay);
  out.notes.push('user activation inside the page after a click on a host button: ' + await modeEv('texgen', 'window.activation'));
  chk('Embed.action patches a button', (await modeEv('texgen', `Embed.action('a1',{label:'Renamed',disabled:true,primary:true});1`), await ev(`(()=>{const b=document.querySelector('#actions button[data-action=a1]');return b.textContent.trim()==='Renamed'&&b.disabled&&b.classList.contains('primary')})()`)));
  await modeEv('texgen', `Embed.action('a1',{label:'Run A',disabled:false,primary:false});1`);
  await ev(`document.getElementById('bKeys').click()`);
  const keys = await ev(`document.querySelector('.kit-keys')?.textContent||''`);
  chk('Shortcuts: merged host + mode groups', /Ctrl\+Shift\+1\.\.8/.test(keys) && /Test group/.test(keys) && /Does a test thing/.test(keys), keys.slice(0, 80));
  await shot('studio-shortcuts');
  await ev(`Kit.keys.close();1`);
  // lifecycle
  await ev(`Studio.show('join')`);
  await ev(`Studio.show('texgen')`);
  chk('lifecycle: onHide then onShow', J(await modeEv('texgen', 'events')) === J(['show', 'hide', 'show']));
  await ev(`Studio.show('join')`);
  chk('lifecycle: hidden page told to hide', J(await modeEv('texgen', 'events')) === J(['show', 'hide', 'show', 'hide']));
  await ev(`Studio.show('texgen')`);

  // ---- 4. shared toast / dialog / confirm / prompt
  await ev(`Studio.toast('Hello from a mode',{anchor:document.body});1`);
  chk('toast in the host', await ev(`document.querySelector('.kit-toast.on')?.textContent`) === 'Hello from a mode');
  await ev(`window.__p=Studio.prompt('Name?',{value:'abc'});1`);
  await ev(`document.querySelector('.kit-dlg-btns .primary').click()`);
  chk('prompt resolves with the text', await ev(`window.__p`) === 'abc');
  await ev(`window.__c=Studio.confirm('Sure?');1`);
  await ev(`document.querySelector('.kit-dlg-btns button').click()`);
  chk('confirm resolves false on Cancel', (await ev(`window.__c`)) === false);
  await ev(`window.__d=Studio.dialog({title:'T',text:'x',buttons:[{id:'one',label:'One',primary:true}]});1`);
  await ev(`document.querySelector('.kit-dlg-btns button').click()`);
  chk('dialog resolves the button id', await ev(`window.__d`) === 'one');

  // ---- 5. tray + send
  await ev(`(async()=>{window.fa=await mkPng('a.png',20);window.fb=await mkPng('b.png',200);window.fv=mkVid('clip.mp4');Studio.tray([fa,fb,fv]);return 1})()`);
  chk('tray: three items', await ev('Studio.trayItems().length') === 3);
  chk('tray: kinds', await ev(`Studio.trayItems().map(t=>t.kind).join()`) === 'image,image,video');
  await until(() => ev(`Studio.trayItems().filter(t=>t.thumb).length>=2`), 'thumbnails', 10000);
  chk('tray: image thumbnails made', true);
  chk('tray: opens when files arrive, counter shows 3', await ev(`document.getElementById('tray').classList.contains('open')&&document.getElementById('trayCnt').textContent==='3'`));
  await ev(`Studio.tray([fa])`);
  chk('tray: the same file twice is kept once', await ev('Studio.trayItems().length') === 3);
  await shot('studio-tray');
  const [tx, ty] = await center('.ti[data-id="1"]');
  await mouse(tx, ty);
  await until(() => ev(`!!document.querySelector('.st-menu')`), 'send menu');
  const menu = await ev(`[...document.querySelectorAll('.st-menu button')].map(b=>b.dataset.id+':'+b.disabled).join()`);
  chk('Send to menu: images go to Sheet/Flipbook/Annotate/TexGen, not to Join', menu === 'join:true,compare:true,grid:true,sheet:false,flipbook:false,annotate:false,textures:true,texgen:false', menu);
  await shot('studio-sendmenu');
  await ev(`document.querySelector('.st-menu button[data-id=texgen]').click()`);
  await until(() => modeEv('texgen', 'received.length').then(n => n === 1), 'send delivered');
  chk('send: file reaches onReceive, as a File of the page\'s own realm', J(await modeEv('texgen', 'received')) === J(['a.png:true']));
  chk('send: the target mode is shown', await ev('Studio.mode()') === 'texgen');
  chk('send: the tray keeps the file', await ev('Studio.trayItems().length') === 3);
  await ev(`Studio.show('join')`);
  chk('send of a video to a mode that does not take it is refused', await ev(`Studio.send('texgen',[fv])`) === false);
  chk('...and the mode does not change', await ev('Studio.mode()') === 'join');
  chk('Embed.tray from a page', (await modeEv('texgen', `Embed.tray([new File(['z'],'z.png',{type:'image/png',lastModified:9})]);1`), await ev('Studio.trayItems().length')) === 4);
  await ev(`document.querySelector('.ti[data-id="4"] .acts button[title^=Remove]').click()`);
  chk('tray: remove one', await ev('Studio.trayItems().length') === 3);

  // ---- 6. drop routing
  await ev(`Studio.show('texgen')`);
  await modeEv('texgen', `received=[];1`);
  await ev(`(()=>{window.pd=dropOn(document.getElementById('head'),[window.fb])})()`);
  chk('drop on the header: the active mode takes images', J(await modeEv('texgen', 'received')) === J(['b.png:true']));
  const before = await ev('Studio.trayItems().length');
  await ev(`dropOn(document.getElementById('head'),[mkVid('v2.mp4')])`);
  chk('drop of a video the mode does not take: goes to the tray', await ev('Studio.trayItems().length') === before + 1);
  const tmsg = await ev(`document.querySelector('.kit-toast.on')?.textContent||''`);
  chk('...with a suggestion in a toast', /TexGen does not take "v2.mp4"/.test(tmsg) && /Try Join, Compare, Grid/.test(tmsg), tmsg);
  await ev(`dropOn(document.getElementById('tray'),[window.fb,mkVid('v3.mp4')])`);
  chk('drop on the tray: everything is kept (dups skipped)', await ev('Studio.trayItems().length') === before + 2);
  await modeEv('texgen', `received=[];1`);
  await ev(`dropOn(document.querySelector('.mode[data-id=texgen]'),[window.fa])`);
  chk('drop on a rail button goes to that mode', J(await modeEv('texgen', 'received')) === J(['a.png:true']));
  await ev(`Studio.show('join')`);
  await ev(`dropOn(document.querySelector('.mode[data-id=texgen]'),[window.fb])`);
  chk('...and switches to it', await ev('Studio.mode()') === 'texgen');
  // inside the nested frame: accepted drops pass through to the page, unaccepted ones are routed
  await modeEv('texgen', `dropped=[];received=[];1`);
  const n0 = await ev('Studio.trayItems().length');
  await ev(`(()=>{const w=Studio.modes.find(m=>m.id==='texgen').win;const dt=new w.DataTransfer();dt.items.add(new w.File(['x'],'in.png',{type:'image/png'}));const e=new w.DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt});w.document.body.dispatchEvent(e);return 1})()`);
  chk('drop in the frame, accepted type: the page handles it itself', J(await modeEv('texgen', 'dropped')) === J(['in.png']));
  await ev(`(()=>{const w=Studio.modes.find(m=>m.id==='texgen').win;const dt=new w.DataTransfer();dt.items.add(new w.File(['x'],'in.mp4',{type:'video/mp4'}));const e=new w.DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt});w.document.body.dispatchEvent(e);return 1})()`);
  chk('drop in the frame, type not accepted: routed to the tray, page not called', J(await modeEv('texgen', 'dropped')) === J(['in.png']) && await ev('Studio.trayItems().length') === n0 + 1);

  // ---- 7. a registered-less page with embed.js: 1.5 s then its own header
  await goTest('texgen', '&noreg=1');
  chk('no registration yet: header hidden by body.embed', await modeEv('texgen', `getComputedStyle(document.querySelector('header')).display==='none'`));
  await until(async () => (await state('texgen')) === 'legacy', 'fallback after ~1.5 s', 5000);
  chk('never registered: page shows its own header', await modeEv('texgen', `getComputedStyle(document.querySelector('header')).display!=='none'`));
  chk('never registered: no actions, title from the rail', await ev(`document.getElementById('actions').children.length===0 && document.getElementById('title').textContent==='TexGen'`));
  await ev(`Studio.send('texgen',[window.fa])`);
  await delay(200);
  chk('files sent to a legacy page arrive as a drop', J(await modeEv('texgen', 'dropped')) === J(['a.png']));
  await goTest('texgen', '&legacy=1');
  await until(async () => (await state('texgen')) === 'legacy', 'legacy page', 5000);
  chk('page without embed.js: legacy at once', true);
  await shot('studio-legacy');

  // ---- 8. persistence of controls of nested modes (same keys / NOT_KEPT as the shell had)
  await ev(`Studio.show('compare')`);
  await until(async () => (await state('compare')) !== 'loading', 'compare loaded', 8000);
  await delay(600);
  const pick = await modeEv('compare', `(()=>{const NK=/^(offset|speed|zoom|rot|panX|panY)[AB]$|^gv(Offset|Speed|Zoom|Rot|PanX|PanY)$|^(start|end|textEdit)$/;
    const e=[...document.querySelectorAll('input[type=range][id]')].find(x=>!NK.test(x.id)&&x.max!==x.min);if(!e)return null;
    const v=e.value===e.max?e.min:e.max;e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return {id:e.id,value:e.value}})()`);
  chk('found a persistable range control in the video page', !!pick, pick);
  if (pick) {
    await delay(900);
    const stored = JSON.parse(await ev(`localStorage.getItem('toolbox.controls.video')||'{}'`));
    chk('stored under toolbox.controls.video', stored[pick.id] === pick.value, stored[pick.id]);
    await ev(`Studio.modes.find(m=>m.id==='compare').win.location.reload()`);
    await delay(800);
    await until(async () => (await state('compare')) !== 'loading', 'compare reloaded', 8000);
    await delay(500);
    chk('round trip: the value is back after the frame reloads', await modeEv('compare', `document.getElementById(${J(pick.id)}).value`) === pick.value);
    await modeEv('compare', `(()=>{const e=document.getElementById('offsetA');if(e){e.value=e.max;e.dispatchEvent(new Event('input',{bubbles:true}));}return 1})()`);
    await delay(900);
    chk('NOT_KEPT controls are not stored', !('offsetA' in JSON.parse(await ev(`localStorage.getItem('toolbox.controls.video')||'{}'`))));
    // Grid is the same page: it restores the same key
    await ev(`Studio.show('grid')`);
    await ev(`Studio.modes.find(m=>m.id==='grid').win.location.reload()`);   // it was loaded before the value was stored
    await delay(800);
    await until(async () => (await state('grid')) !== 'loading', 'grid loaded', 8000);
    await delay(600);
    const gv = await modeEv('grid', `document.getElementById(${J(pick.id)}).value`);
    chk('Grid (same page, own frame) restores the same key', gv === pick.value, { grid: gv, want: pick.value, stored: await ev(`localStorage.getItem('toolbox.controls.video')`) });
  }

  // ---- 9. old tab ids
  for (const [old, mode] of [['clips', 'join'], ['frames', 'sheet'], ['video', 'compare'], ['annotate', 'annotate'], ['texgen', 'texgen']]) {
    await evaluate(`localStorage.setItem('toolbox.lastTab',${J(old)});localStorage.removeItem('studio.mode');location.reload()`);
    await delay(600);
    await until(() => evaluate(`typeof show==="function" && current==="studio" && !!frames.studio?.contentWindow?.Studio?.mode()`), 'reload ' + old, 15000);
    chk(`lastTab "${old}" opens Studio on ${mode}`, await evaluate('frames.studio.contentWindow.Studio.mode()') === mode);
  }
  await evaluate('show("store")'); await delay(200);
  await evaluate('show("clips")');
  chk('show("clips") is an alias for Studio on Join', await evaluate('current')==='studio' && await evaluate('frames.studio.contentWindow.Studio.mode()') === 'join');
  await ev('window.qaErrors=[];1');
  chk('three tabs', await evaluate('TOOLS.map(t=>t.id).join()') === 'studio,store,scene-sync');
  return out;
};
