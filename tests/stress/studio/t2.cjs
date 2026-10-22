'use strict';
// Consistency of the eight Studio modes (package E): the same layout parts, the same shortcut for the same idea.
//   (a) settings column: one width in every mode (--panel-w), on the right; Textures too
//   (b) empty state: every mode shows the kit card (icon, one line, buttons); Compare shows two
//   (c) kit parts in use: .kit-transport (Join, Compare, Grid, Flipbook), .kit-status (Sheet, Annotate, Textures),
//       .kit-viewbar (Grid, Sheet, Annotate), .kit-tools (Annotate, Flipbook); kit --dim contrast >= 5:1 on the raised panel
//   (d) host header: Undo/Redo are icon-only in Join and Annotate; Compare, Grid and Flipbook carry no Play/Stop/Fit there
//   (e) keys: ? opens the host shortcut list from any mode; Ctrl+O in Join and Flipbook; Ctrl+E and Ctrl+S export in Sheet and
//       Annotate; F / 0 / + / - in Annotate and Grid
//   APP_ROOT=<copy> TAB=studio PORT=<port> node tests/stress/run-tab.cjs tests/stress/studio/t2.cjs
module.exports = async ({ ev, evaluate, command, until, delay, capture }) => {
  const out = { ok: true, checks: {}, shots: [] };
  const chk = (n, v, extra) => { out.checks[n] = extra === undefined ? !!v : { ok: !!v, v: extra }; if (!v) { out.ok = false; console.log('FAIL', n, extra === undefined ? '' : JSON.stringify(extra)); } };
  const J = JSON.stringify;
  const M = id => `Studio.modes.find(x=>x.id===${J(id)})`;
  const W = (id, code) => ev(`(async()=>{const w=${M(id)}.win;return await w.eval(${J(code)})})()`);
  const show = async id => { await ev(`Studio.show(${J(id)})`); await until(() => ev(`${M(id)}.state==='ready'`), 'mode ' + id); await delay(500); };
  const size = async (w, h) => { await command('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false }); await delay(700); };
  const codeOf = k => /^[a-z]$/i.test(k) ? 'Key' + k.toUpperCase() : /^d$/.test(k) ? 'Digit' + k : k === '+' ? 'Equal' : k === '-' ? 'Minus' : '';
const key = (id, k, mods = {}) => W(id, `document.dispatchEvent(new KeyboardEvent('keydown',${J({ key: k, code: codeOf(k), bubbles: true, cancelable: true, ...mods })}));1`);

  await until(() => ev('Studio.mode()'), 'studio ready');
  await ev(String.raw`window.__png=async function(name,w,h,hue){const c=document.createElement('canvas');c.width=w;c.height=h;const g=c.getContext('2d');g.fillStyle='hsl('+hue+',55%,40%)';g.fillRect(0,0,w,h);g.fillStyle='#fff';g.font='bold 60px Arial';g.fillText(name,20,h/2);const b=await new Promise(r=>c.toBlob(r,'image/png'));return new File([b],name,{type:'image/png',lastModified:hue});};
    window.__mk=async function(name,seconds,hue){const c=document.createElement('canvas');c.width=320;c.height=180;const g=c.getContext('2d');const s=c.captureStream(0);const vt=s.getVideoTracks()[0];const r=new MediaRecorder(s,{mimeType:'video/webm;codecs=vp8'});const ch=[];r.ondataavailable=e=>ch.push(e.data);const stop=new Promise(x=>r.onstop=x);const t0=performance.now();r.start(100);
      await new Promise(res=>{(function f(){const t=(performance.now()-t0)/1000;g.fillStyle='hsl('+hue+',55%,38%)';g.fillRect(0,0,320,180);g.fillStyle='#fff';g.fillRect(20+t*80,100,40,40);vt.requestFrame();if(t<seconds)setTimeout(f,33);else res();})();});
      r.stop();await Promise.race([stop,new Promise(x=>setTimeout(x,3000))]);return new File(ch,name+'.webm',{type:'video/webm',lastModified:hue});};1`);

  // ---- (a) one settings column width, on the right
  const COLS = { join: '#right', compare: 'aside#panel', grid: 'aside#panel', sheet: 'aside#panel', flipbook: '#sidebar', textures: 'aside.rules', texgen: '#texgen-panelbox' };
  for (const [w, h] of [[1920, 1080], [1280, 720]]) {
    await size(w, h);
    const widths = {}, sides = {};
    for (const id of Object.keys(COLS)) {
      await show(id);
      if (id === 'texgen') await delay(1500);
      const r = await W(id, `(()=>{const e=document.querySelector(${J(COLS[id])});if(!e)return null;const b=e.getBoundingClientRect();return {w:Math.round(b.width),right:Math.round(innerWidth-b.right),left:Math.round(b.left)}})()`);
      widths[id] = r && r.w; sides[id] = r && r.right;
    }
    const ws = Object.values(widths).filter(Boolean);
    chk(`(a) settings column: same width in all seven modes at ${w}`, ws.length === 7 && Math.max(...ws) - Math.min(...ws) <= 2, widths);
    chk(`(a) settings column sits at the right edge at ${w}`, Object.values(sides).every(v => v !== null && v <= 20), sides);
  }

  // ---- (b) empty states
  await size(1440, 900);
  const empties = {};
  for (const id of ['join', 'compare', 'grid', 'sheet', 'flipbook', 'annotate', 'textures']) {
    await show(id);
    empties[id] = await W(id, `(()=>{const vis=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden'};
      const cards=[...document.querySelectorAll('.kit-empty .card')].filter(vis);
      return cards.map(c=>({icon:!!c.querySelector('.ke-ic svg'),title:!!c.querySelector('b')&&c.querySelector('b').textContent.length>3,btn:c.querySelectorAll('button').length,
        ok:(()=>{const r=c.getBoundingClientRect(),s=(c.closest('.kit-empty')||c).getBoundingClientRect();return r.left>=s.left&&r.right<=s.right&&r.top>=s.top&&r.bottom<=s.bottom})()}))})()`);
  }
  for (const id of Object.keys(empties)) {
    const cards = empties[id], want = id === 'compare' ? 2 : 1;
    chk(`(b) ${id}: ${want} centred kit card with icon, title and a button`, cards.length === want && cards.every(c => c.icon && c.title && c.btn >= 1 && c.ok), cards);
  }

  // ---- (c) shared parts
  const parts = { join: ['.kit-transport'], compare: ['.kit-transport'], grid: ['.kit-transport', '.kit-viewbar'], sheet: ['.kit-status'], flipbook: ['.kit-transport', '.kit-tools'], annotate: ['.kit-tools', '.kit-viewbar', '.kit-status'], textures: ['.kit-status'] };
  for (const id of Object.keys(parts)) {
    await show(id);
    const miss = await W(id, `${J(parts[id])}.filter(s=>!document.querySelector(s))`);
    chk(`(c) ${id} uses ${parts[id].join(' ')}`, miss.length === 0, miss);
  }
  const dim = await ev(`(()=>{const c=s=>{const m=/(\\d+)/g;const t=document.createElement('canvas').getContext('2d');t.fillStyle=s;t.fillRect(0,0,1,1);return [...t.getImageData(0,0,1,1).data].slice(0,3)};
    const L=a=>{const f=v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)};return .2126*f(a[0])+.7152*f(a[1])+.0722*f(a[2])};
    const cs=getComputedStyle(document.documentElement),d=cs.getPropertyValue('--dim').trim(),p=cs.getPropertyValue('--panel3').trim();
    const a=L(c(d)),b=L(c(p));return {dim:d,panel3:p,ratio:+((Math.max(a,b)+.05)/(Math.min(a,b)+.05)).toFixed(2)}})()`);
  chk('(c) kit --dim reads at 5:1 or better on the raised panel', dim.ratio >= 5, dim);

  // ---- (d) host header
  const heads = {};
  for (const id of ['join', 'compare', 'grid', 'flipbook', 'annotate', 'texgen']) {
    await show(id);
    heads[id] = await ev(`[...document.querySelectorAll('#actions button')].map(b=>b.dataset.action+(b.classList.contains('short')||b.classList.contains('ibtn')?'~':''))`);
  }
  chk('(d) Join and Annotate: Undo and Redo are icon only', ['undo~', 'redo~'].every(x => heads.join.includes(x) && heads.annotate.includes(x)), heads);
  chk('(d) Compare, Grid and Flipbook: no Play, Stop or Fit in the Studio header', ['compare', 'grid', 'flipbook'].every(id => !heads[id].some(x => /^(play|stop|fit)/.test(x))), heads);

  // ---- (e) keys
  await show('join');
  await ev(`Kit.keys.close();1`);
  await key('join', '?');
  chk('(e) ? opens the host shortcut list (Join)', await ev('Kit.keys.isOpen()'));
  await ev(`Kit.keys.close();1`);
  await show('annotate');
  await key('annotate', '?');
  chk('(e) ? opens the host shortcut list (Annotate), and the page opened no list of its own', await ev('Kit.keys.isOpen()') && await W('annotate', `!document.querySelector('.kit-keys')`));
  await ev(`Kit.keys.close();1`);
  await show('texgen');
  await key('texgen', '?');
  chk('(e) ? opens the host shortcut list (TexGen)', await ev('Kit.keys.isOpen()'));
  await ev(`Kit.keys.close();1`);

  await show('join');
  await W('join', `window.__clicks=[];const c0=HTMLInputElement.prototype.click;HTMLInputElement.prototype.click=function(){window.__clicks.push(this.id||this.type);};1`);
  await key('join', 'o', { ctrlKey: true });
  chk('(e) Ctrl+O opens the file picker in Join', (await W('join', 'window.__clicks')).includes('fileIn'));
  await show('flipbook');
  await W('flipbook', `window.__clicks=[];window.showOpenFilePicker=undefined;HTMLInputElement.prototype.click=function(){window.__clicks.push(this.id||this.type);};1`);
  await key('flipbook', 'o', { ctrlKey: true });
  chk('(e) Ctrl+O opens the file picker in Flipbook', (await W('flipbook', 'window.__clicks')).length > 0, await W('flipbook', 'window.__clicks'));

  // export / save keys: both Ctrl+E and Ctrl+S, the download is caught
  const spyDl = id => W(id, `window.__dl=[];HTMLAnchorElement.prototype.click=function(){if(this.download)window.__dl.push(this.download);};1`);
  await ev(`(async()=>{window.__M={img:await __png('one.png',640,360,30),vid:await __mk('clip',1.2,200)};return 1})()`);
  await ev(`Studio.send('sheet',[__M.img]);1`);
  await show('sheet');
  await until(() => W('sheet', 'Sheet.S.images.length===1'), 'sheet image');
  await delay(600);
  await spyDl('sheet');
  await key('sheet', 'e', { ctrlKey: true });
  await until(async () => (await W('sheet', 'window.__dl.length')) >= 1, 'sheet Ctrl+E download');
  const d1 = await W('sheet', 'window.__dl.length');
  await key('sheet', 's', { ctrlKey: true });
  await until(async () => (await W('sheet', 'window.__dl.length')) > d1, 'sheet Ctrl+S download');
  chk('(e) Ctrl+E and Ctrl+S both export the Sheet', true);
  await W('sheet', `Sheet.view&&1`);
  await key('sheet', '0'); await delay(500);
  chk('(e) 0 shows the Sheet at 100%', /^100%/.test(await W('sheet', `document.getElementById('zoomV').textContent`)));

  await ev(`Studio.send('annotate',[__M.img]);1`);
  await show('annotate');
  await until(() => W('annotate', `!document.getElementById('save').disabled`), 'annotate image');
  await spyDl('annotate');
  await key('annotate', 'e', { ctrlKey: true });
  await until(async () => (await W('annotate', 'window.__dl.length')) >= 1, 'annotate Ctrl+E download');
  const a1 = await W('annotate', 'window.__dl.length');
  await key('annotate', 's', { ctrlKey: true });
  await until(async () => (await W('annotate', 'window.__dl.length')) > a1, 'annotate Ctrl+S download');
  chk('(e) Ctrl+E and Ctrl+S both save the Annotate PNG', true);
  const zt = async () => { await delay(300); return W('annotate', `document.getElementById('zoomV').textContent`); };
  await key('annotate', '0'); const z0 = await zt();
  await key('annotate', '+'); const z1 = await zt();
  await key('annotate', '-'); await key('annotate', '-'); const z2 = await zt();
  await key('annotate', 'f'); const z3 = await zt();
  chk('(e) Annotate: 0 is 100%, + zooms in, - zooms out, F fits', z0 === '100%' && parseInt(z1) > 100 && parseInt(z2) < 100 && z3 !== '100%' && z3 !== z2, [z0, z1, z2, z3]);

  await ev(`Studio.send('grid',[__M.vid]);1`);
  await show('grid');
  await until(() => W('grid', `document.getElementById('vGrid').classList.contains('empty')===false`), 'grid clip', 30000);
  await delay(500);
  const gz = async () => { await delay(300); return W('grid', `document.getElementById('gvZoomPct').textContent`); };
  await key('grid', '0'); const g0 = await gz();
  await key('grid', '+'); const g1 = await gz();
  await key('grid', '-'); await key('grid', '-'); const g2 = await gz();
  await key('grid', 'f'); const g3 = await gz();
  chk('(e) Grid: 0 is 100%, + zooms in, - zooms out, F fits', g0 === '100%' && parseInt(g1) > 100 && parseInt(g2) < 100 && g3 !== g2, [g0, g1, g2, g3]);

  await size(1280, 720);
  out.shots.push(await capture('studio-consistency-1280'));
  return out;
};
