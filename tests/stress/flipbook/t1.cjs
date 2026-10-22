'use strict';
// Flipbook previewer (app/flipbook, Studio mode "flipbook") inside the real app.
//   (a) kit look: no blue accent, readable sizes, dim text contrast >= 4.5, ids kept
//   (b) a generated sheet fire_4x4.png added through the host (onReceive): grid read from the name (4x4), 16 frames
//   (c) play / pause: exactly one icon at a time, button state, host action label, Space tap
//   (d) several sheets at once (onReceive and a real drop event) are laid out side by side, not stacked
//   (e) a TGA file is refused with a clear message
//   (f) the scene is saved (IndexedDB flipbookStudio / scene) and restored after a reload: sheets (stored copies),
//       instances, grid, tint, background, fps, blend, view
//   (g) a sheet behind a file handle (OPFS) whose read permission needs a click: no prompt at load,
//       a "Restore last scene" button, one click restores
//   (h) a view that came from Fit refits when the window changes size; a manual view does not
//   (i) no clipped text at 1280 and 1920, toolbar and stats do not overlap, Embed contract registered
//   (j) screenshots at 1920 and 1280
//   APP_ROOT=<copy> TAB=flipbook PORT=<port> node tests/stress/run-tab.cjs tests/stress/flipbook/t1.cjs
module.exports = async ({ ev, evaluate, command, until, delay, capture, reload }) => {
  const out = { ok: true, checks: {}, shots: [] };
  const chk = (n, v, extra) => { out.checks[n] = extra === undefined ? !!v : { ok: !!v, v: extra }; if (!v) { out.ok = false; console.log('FAIL', n, extra === undefined ? '' : JSON.stringify(extra)); } };
  const shot = async name => { await host('S.Kit.toast.hide()'); await delay(350); out.shots.push(await capture(name)); };
  const size = (w, h) => command('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
  const host = x => evaluate(`(()=>{const S=frames.studio.contentWindow;return (${x})})()`);

  // ---- helpers living in the page
  const helpers = async () => ev(`window.__mk = (name, cols, rows, cell, hue) => new Promise(res => {
      const c = document.createElement('canvas'); c.width = cols * cell; c.height = rows * cell;
      const g = c.getContext('2d');
      for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
        const i = r * cols + q, t = i / Math.max(1, cols * rows - 1);
        const cx = q * cell + cell / 2, cy = r * cell + cell / 2, rad = cell * (0.16 + 0.3 * Math.sin(Math.PI * t));
        const gr = g.createRadialGradient(cx, cy, 0, cx, cy, rad + 2);
        gr.addColorStop(0, 'hsla(' + (hue + 50 * t) + ',100%,72%,1)'); gr.addColorStop(1, 'hsla(' + (hue + 50 * t) + ',100%,50%,0)');
        g.fillStyle = gr; g.fillRect(q * cell, r * cell, cell, cell);
        g.fillStyle = 'rgba(255,255,255,.85)'; g.font = Math.max(8, cell / 5) + 'px Arial'; g.fillText(String(i + 1), q * cell + 4, r * cell + cell / 5 + 2);
      }
      c.toBlob(b => res(new File([b], name, { type: 'image/png' })), 'image/png');
    });
    window.__spec = () => parent.Studio.modes.find(m => m.id === 'flipbook').spec;
    1`);
  const flush = () => ev('flushScene().then(()=>1)');
  const idbScene = () => ev(`(async()=>{const db=await idb();const r=await new Promise(res=>{const q=db.transaction('scene').objectStore('scene').get('last');q.onsuccess=()=>res(q.result);q.onerror=()=>res(null)});
      const keys=await new Promise(res=>{const q=db.transaction('blobs').objectStore('blobs').getAllKeys();q.onsuccess=()=>res(q.result)});db.close();
      return r?{n:r.textures.length,names:r.textures.map(t=>t.name),handles:r.textures.map(t=>!!t.handle),inst:r.instances.length,fps:r.settings.fps,bg:r.bg.color,blobs:keys.length}:null})()`);

  await until(() => ev('document.readyState==="complete"&&typeof state==="object"'), 'page');
  await size(1700, 1000);
  await helpers();
  await ev(`indexedDB.deleteDatabase('flipbookStudio');localStorage.removeItem('flipbookStudio.ui');1`);
  await reload();
  await helpers();

  // ---- (a) look, before anything is loaded
  const look = await ev(`(()=>{
    const cs = getComputedStyle(document.body);
    const blue = [...document.querySelectorAll('*')].some(e => { const c = getComputedStyle(e); return /47, 155, 255|2f9bff/i.test(c.borderTopColor + c.backgroundColor + c.color + c.outlineColor); });
    const src = document.documentElement.outerHTML;
    const secs = [...document.querySelectorAll('#sidebar .sec:not([hidden])>.hd b')].map(b => b.textContent);
    const ids = ['mainCanvas','fileInput','bgFileInput','playBtn','restartBtn','frameSlider','texThumbs','libList','colsInput','rowsInput','totalFramesInput','tintColor','tintSlider',
      'bgColor','bgFit','fpsSlider','blendSelect','nearestCheck','brSlider','coSlider','satSlider','invertCheck','baseScaleSlider','autoEmitCheck','emitRateSlider','selPosX','selScaleUni','selRot','emitFadeCheck'].filter(i => !document.getElementById(i));
    const small = [...document.querySelectorAll('body *')].filter(e => { if (!e.offsetParent && e.tagName !== 'BODY') return false; const t = [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()); return t && parseFloat(getComputedStyle(e).fontSize) < 11 && !/^(SCRIPT|STYLE)$/.test(e.tagName); }).map(e => e.tagName + '.' + e.className + ' ' + getComputedStyle(e).fontSize);
    const lum = c => { const m = c.match(/\\d+/g).map(Number); const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }; return .2126 * f(m[0]) + .7152 * f(m[1]) + .0722 * f(m[2]); };
    const dim = getComputedStyle(document.documentElement).getPropertyValue('--dim').trim();
    const tmp = document.createElement('i'); tmp.style.color = dim; document.body.appendChild(tmp); const dimRgb = getComputedStyle(tmp).color; tmp.remove();
    const panel = getComputedStyle(document.getElementById('sidebar')).backgroundColor;
    const ratio = (lum(dimRgb) + .05) / (lum(panel) + .05);
    return { kit: document.body.classList.contains('kit'), bg: cs.backgroundColor, blue, secs, ids, small, ratio: +ratio.toFixed(2), embed: document.body.classList.contains('embed'),
      headHidden: getComputedStyle(document.getElementById('head')).display === 'none',
      oldHidden: !!document.querySelector('svg[hidden]') };
  })()`);
  chk('kit page, embedded, own header hidden', look.kit && look.embed && look.headHidden && look.bg === 'rgb(16, 16, 18)', look);
  chk('no blue accent', !look.blue);
  chk('sections', look.secs.join() === 'Textures,Texture library,Active texture,Background,Playback & material,Post process,Scatter & emitter', look.secs);
  chk('old control ids still present', look.ids.length === 0, look.ids);
  chk('no text under 11 px', look.small.length === 0, look.small);
  chk('dim text contrast >= 4.5', look.ratio >= 4.5, look.ratio);
  chk('no svg[hidden] toggles left', !look.oldHidden);

  // ---- (b) a generated sheet through the host
  const reg = await host(`(()=>{const m=S.Studio.modes.find(m=>m.id==='flipbook');return {state:m.state,title:m.spec&&m.spec.title,acts:m.actions.map(a=>a.id||'sep').join(),acc:m.spec&&m.spec.accepts&&m.spec.accepts.join(),keys:m.spec&&m.spec.shortcuts.map(g=>g[0]).join(),has:['onReceive','onShow','onHide'].filter(k=>m.spec&&typeof m.spec[k]==='function').join()}})()`);
  chk('registered with the host', reg.state === 'ready' && reg.title === 'Flipbook previewer' && reg.acts === 'add,reimport,sep,clear' && reg.acc === 'image/*' && reg.has === 'onReceive,onShow,onHide' && /Tools,Playback,View,Selection/.test(reg.keys), reg);
  const dis0 = await host(`S.Studio.modes.find(m=>m.id==='flipbook').actions.filter(a=>a.disabled).map(a=>a.id).join()`);
  chk('actions that need a sheet start disabled', dis0 === 'reimport,clear', dis0);

  await ev(`(async()=>{const f=await __mk('fire_4x4.png',4,4,128,18);__spec().onReceive([f]);return 1})()`);
  await until(() => ev('state.textures.length===1&&state.instances.length===1'), 'first sheet');
  const t1 = await ev(`({n:state.textures[0].name,c:state.textures[0].cols,r:state.textures[0].rows,f:state.textures[0].totalFrames,sl:+frameSlider.max,
     inst:state.instances.length,loaded:state.isLoaded,tl:document.getElementById('timeline').classList.contains('show'),stat:document.getElementById('statSrcRes').textContent,
     thumbs:document.querySelectorAll('#texThumbs .thumb:not(.add)').length})`);
  chk('grid read from fire_4x4.png: 4x4, 16 frames', t1.c === 4 && t1.r === 4 && t1.f === 16 && t1.sl === 15 && t1.stat === '512×512', t1);
  chk('first sheet: one instance, timeline shown, one thumbnail', t1.inst === 1 && t1.tl && t1.thumbs === 1, t1);
  const dis1 = await host(`S.Studio.modes.find(m=>m.id==='flipbook').actions.filter(a=>a.disabled).map(a=>a.id).join()`);
  chk('actions enabled once a sheet is in', dis1 === '', dis1);
  chk('host status line', (await host(`S.document.getElementById('status').textContent`)) === '1 sheet, 1 instance');

  // ---- (c) play / pause icon
  const pp = () => ev(`({st:playBtn.dataset.state,svgs:playBtn.querySelectorAll('svg').length,d:playBtn.querySelector('svg path').getAttribute('d'),playing:state.isPlaying,
      title:playBtn.title,hostHas:!!parent.document.querySelector('#actions [data-action="play"]')})`);
  const p0 = await pp();
  chk('playing: one icon (pause), state playing, the host header has no Play action', p0.st === 'playing' && p0.svgs === 1 && p0.playing && !p0.hostHas && /^M4\.5 3/.test(p0.d), p0);
  await ev(`playBtn.click();1`);
  const p1 = await pp();
  chk('paused: one icon (play), state paused, ', p1.st === 'paused' && p1.svgs === 1 && !p1.playing && /^M5 2\.8/.test(p1.d), p1);
  await ev(`window.dispatchEvent(new KeyboardEvent('keydown',{code:'Space',bubbles:true}));window.dispatchEvent(new KeyboardEvent('keyup',{code:'Space',bubbles:true}));1`);
  const p2 = await pp();
  chk('Space tap plays again', p2.st === 'playing' && p2.svgs === 1 && p2.playing, p2);
  await ev(`playBtn.click();1`);
  const p3 = await pp();
  chk('the transport Play/Pause button toggles the page', p3.st === 'paused' && !p3.playing, p3);
  await ev(`togglePlay();1`);

  // ---- (d) several sheets at once
  const before = await ev('state.instances.length');
  await ev(`(async()=>{const a=await __mk('water_2x2.png',2,2,200,200),b=await __mk('smoke_8x8.png',8,8,64,0),c=await __mk('spark_4x2.png',4,2,100,60);__spec().onReceive([a,b,c]);return 1})()`);
  await until(() => ev('state.textures.length===4'), 'three more sheets');
  const lay = await ev(`(()=>{const ins=state.instances.slice(1);const rects=ins.map(i=>{const s=instSize(i);return {id:state.textures.find(t=>t.id===i.texId).name,x:i.x,y:i.y,l:i.x-s.w/2,r:i.x+s.w/2,t:i.y-s.h/2,b:i.y+s.h/2}});
     let overlap=false;for(let i=0;i<rects.length;i++)for(let j=i+1;j<rects.length;j++){const a=rects[i],b=rects[j];if(a.l<b.r&&b.l<a.r&&a.t<b.b&&b.t<a.b)overlap=true}
     return {n:ins.length,names:rects.map(r=>r.id).join(),xs:rects.map(r=>Math.round(r.x)),ys:rects.map(r=>Math.round(r.y)),overlap,fit:state.viewFit,scale:state.scale}})()`);
  chk('three sheets: three instances, in the given order, left to right', lay.n === 3 && lay.names === 'water_2x2.png,smoke_8x8.png,spark_4x2.png' && lay.xs[0] < lay.xs[1] && lay.xs[1] < lay.xs[2], lay);
  chk('three sheets do not overlap, share a row, view fitted to them', !lay.overlap && lay.ys[0] === lay.ys[1] && lay.ys[1] === lay.ys[2] && lay.fit, lay);
  const grid2 = await ev(`state.textures.map(t=>t.cols+'x'+t.rows).join()`);
  chk('grids from the names', grid2 === '4x4,2x2,8x8,4x2', grid2);

  // a real drop event with two files (through the kit veil path)
  await ev(`(async()=>{const a=await __mk('ice_4x4.png',4,4,64,190),b=await __mk('dust_2x2.png',2,2,100,30);const dt=new DataTransfer();dt.items.add(a);dt.items.add(b);
     document.body.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt,clientX:400,clientY:400}));return 1})()`);
  await until(() => ev('state.textures.length===6'), 'dropped sheets');
  const lay2 = await ev(`(()=>{const ins=state.instances.slice(-2);const s=ins.map(i=>instSize(i));return {x0:ins[0].x,x1:ins[1].x,gap:(ins[1].x-s[1].w/2)-(ins[0].x+s[0].w/2),y0:ins[0].y,y1:ins[1].y}})()`);
  chk('two files dropped: side by side with a gap, same row', lay2.x0 < lay2.x1 && lay2.gap > 0 && near(lay2.y0, lay2.y1, 1e-6), lay2);

  // ---- (e) TGA
  await ev(`(async()=>{await addTextureItems([{file:new File([new Uint8Array(18)],'sheet_4x4.tga',{type:''})}]);return 1})()`);
  const tga = await ev('({n:state.textures.length})');
  const tgaToast = await host(`S.document.querySelector('.kit-toast')&&S.document.querySelector('.kit-toast').textContent`);
  chk('TGA refused, nothing added, clear message', tga.n === 6 && /TGA/.test(tgaToast || '') && /PNG/.test(tgaToast || ''), { n: tga.n, tgaToast });
  const accTypes = await ev(`(()=>{const h=addTextures.toString();return /tga/i.test(h)})()`);
  chk('the picker does not offer .tga', !accTypes);

  // ---- (f) settings, save, reload, restore
  await ev(`(()=>{
    state.activeTexId = state.textures[0].id; setTint({color:'#ff4423', amount:0.6});
    setBgColor('#123456'); state.fps = 24; state.blendMode = 'lighter'; state.brightness = 1.2; state.baseScale = 2;
    state.textures[0].channel = 'g'; state.textures[1].cols = 1; state.textures[1].rows = 4; state.textures[1].totalFrames = 4;
    state.instances[1].x += 37.5; state.instances[1].rotation = 0.5; state.instances[1].flipX = true;
    state.scale = 0.7; state.offsetX = 25; state.offsetY = -14; state.viewFit = false; invalidate(); ui.playRows.sync(); 1})()`);
  await flush();
  const saved = await idbScene();
  chk('scene written to IndexedDB flipbookStudio/scene', saved && saved.n === 6 && saved.inst === 6 && saved.fps === 24 && saved.bg === '#123456' && saved.blobs === 6 && saved.handles.every(h => !h), saved);
  const snap = await ev(`JSON.stringify({names:state.textures.map(t=>[t.name,t.cols,t.rows,t.totalFrames,t.channel,t.tint,t.tintAmount]),inst:state.instances.map(i=>[state.textures.findIndex(t=>t.id===i.texId),i.x,i.y,i.scaleX,i.scaleY,i.rotation,i.flipX]),
     v:[state.scale,state.offsetX,state.offsetY],bg:state.bg.color,fps:state.fps,blend:state.blendMode,br:state.brightness,base:state.baseScale,active:state.textures.findIndex(t=>t.id===state.activeTexId)})`);
  await reload();
  await helpers();
  await until(() => ev('state.textures.length===6&&state.isLoaded&&state.instances.length===6'), 'scene restored', 20000);
  const snap2 = await ev(`JSON.stringify({names:state.textures.map(t=>[t.name,t.cols,t.rows,t.totalFrames,t.channel,t.tint,t.tintAmount]),inst:state.instances.map(i=>[state.textures.findIndex(t=>t.id===i.texId),i.x,i.y,i.scaleX,i.scaleY,i.rotation,i.flipX]),
     v:[state.scale,state.offsetX,state.offsetY],bg:state.bg.color,fps:state.fps,blend:state.blendMode,br:state.brightness,base:state.baseScale,active:state.textures.findIndex(t=>t.id===state.activeTexId)})`);
  chk('scene restored after reload: sheets, grid, channel, tint, instances, view, background, fps, blend, post, defaults', snap === snap2, { a: snap, b: snap2 });
  const ui2 = await ev(`({fpsRow:+document.getElementById('fpsSlider').value,blend:document.getElementById('blendSelect').value,bgc:document.getElementById('bgColor').value,tint:document.getElementById('tintColor').value,
     timeline:document.getElementById('timeline').classList.contains('show'),playing:playBtn.dataset.state,pending:!!pendingScene,thumbs:document.querySelectorAll('#texThumbs .thumb:not(.add)').length,
     restoreBar:!document.getElementById('sidebar').querySelector('.restore').hidden,tex:document.getElementById('statFilename').textContent})`);
  chk('controls show the restored values, no restore button needed', ui2.fpsRow === 24 && ui2.blend === 'lighter' && ui2.bgc === '#123456' && ui2.tint === '#ff4423' && ui2.timeline && ui2.thumbs === 6 && !ui2.pending && !ui2.restoreBar && ui2.tex === 'fire_4x4.png', ui2);
  const errs0 = await ev('qaErrors');
  chk('no page errors so far', errs0.length === 0, errs0);

  // ---- (g) a handle whose permission needs a click
  const opfs = await ev(`(async()=>{
    const root = await navigator.storage.getDirectory();
    const fh = await root.getFileHandle('opfs_2x2.png', { create: true });
    const f = await __mk('opfs_2x2.png', 2, 2, 90, 300);
    const w = await fh.createWritable(); await w.write(f); await w.close();
    await addTextureItems([{ file: await fh.getFile(), handle: fh }]);
    await flushScene();
    return { n: state.textures.length, h: !!state.textures[state.textures.length - 1].handle };
  })()`);
  chk('sheet with a file handle added', opfs.n === 7 && opfs.h, opfs);
  const sc2 = await idbScene();
  chk('handle stored in the scene, no copy stored for it', sc2 && sc2.handles.filter(Boolean).length === 1 && sc2.blobs === 6, sc2);
  const patch = await command('Page.addScriptToEvaluateOnNewDocument', { source: `try{FileSystemHandle.prototype.queryPermission=async function(){return 'prompt'};FileSystemHandle.prototype.requestPermission=async function(){window.__asked=(window.__asked||0)+1;return 'granted'}}catch(e){}` });
  await reload();
  await helpers();
  await until(() => ev('typeof pendingScene!=="undefined"&&sceneReady===true'), 'scene looked at', 20000);
  await delay(600);
  const pend = await ev(`({pending:!!pendingScene,textures:state.textures.length,loaded:state.isLoaded,asked:window.__asked||0,bar:!document.querySelector('.restore').hidden,btn:!document.getElementById('emptyRestore').hidden,
     empty:!document.getElementById('emptyState').classList.contains('hidden')})`);
  chk('permission needed: nothing loaded, nothing asked, Restore last scene offered', pend.pending && pend.textures === 0 && !pend.loaded && pend.asked === 0 && pend.bar && pend.btn && pend.empty, pend);
  await shot('flipbook-restore-offer');
  await ev(`document.getElementById('emptyRestore').click();1`);
  await until(() => ev('state.textures.length===7&&state.isLoaded'), 'restored by click', 20000);
  const rest = await ev(`({asked:window.__asked||0,pending:!!pendingScene,names:state.textures.map(t=>t.name).join(),bar:!document.querySelector('.restore').hidden,tl:document.getElementById('timeline').classList.contains('show')})`);
  chk('one click: permission asked, 7 sheets back, offer gone', rest.asked >= 1 && !rest.pending && /opfs_2x2.png$/.test(rest.names) && !rest.bar && rest.tl, rest);
  await command('Page.removeScriptToEvaluateOnNewDocument', { identifier: patch.identifier });

  // ---- (l) controls are wired: keys, Active texture, Selection, Background, Post process, emitter, Reimport
  const J = JSON.stringify;
  const key = (code, mods = {}) => ev(`(()=>{const o=Object.assign({code:${J(code)},bubbles:true,cancelable:true},${J(mods)});window.dispatchEvent(new KeyboardEvent('keydown',o));window.dispatchEvent(new KeyboardEvent('keyup',o));return 1})()`);
  const setIn = (id, v) => ev(`(()=>{const e=document.getElementById(${J(id)});e.value=${J(String(v))};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return 1})()`);
  const segClick = (rowLabel, text) => ev(`(()=>{const r=[...document.querySelectorAll('#sidebar .row')].find(r=>r.querySelector('label')&&r.querySelector('label').textContent===${J(rowLabel)});[...r.querySelectorAll('.seg button')].find(b=>b.textContent===${J(text)}).click();return 1})()`);
  await key('KeyB'); const k1 = await ev('state.tool');
  await key('KeyH'); const k2 = await ev('state.tool');
  await key('KeyV'); const k3 = await ev('state.tool');
  await key('KeyG'); const k4 = await ev('state.showGrid');
  await key('KeyG');
  await key('KeyP'); const k5 = await ev('state.nearest');
  await key('KeyP');
  chk('keys V B H G P', k1 === 'scatter' && k2 === 'pan' && k3 === 'select' && k4 === true && k5 === true, { k1, k2, k3, k4, k5 });
  await key('KeyA', { ctrlKey: true });
  const selAll = await ev('state.selection.length===state.instances.length');
  await key('KeyD', { ctrlKey: true });
  const dup = await ev('({n:state.instances.length,sel:state.selection.length})');
  chk('Ctrl+A selects all, Ctrl+D duplicates the selection', selAll && dup.n === 14 && dup.sel === 7, dup);
  await key('Delete');
  chk('Delete removes the selection', (await ev('state.instances.length')) === 7);

  await ev('setSelection([state.instances[0]]);1');
  chk('Selection section appears', await ev('!ui.selSection.hidden'));
  await setIn('selPosX', 123);
  await setIn('selRot', 90);
  const s0 = await ev('({sx:state.instances[0].scaleX,sy:state.instances[0].scaleY})');
  await setIn('selScaleUni', 2);
  await ev("document.getElementById('selFlipY').click();1");
  const selr = await ev("(()=>{const i=state.instances[0];return {x:i.x,rot:i.rotation,sx:i.scaleX,sy:i.scaleY,fy:i.flipY,uni:+document.getElementById('selScaleUni').value,sxv:+document.getElementById('selScaleX').value}})()");
  const mx = Math.max(s0.sx, s0.sy);
  chk('Selection rows move, rotate, scale uniformly, flip', near(selr.x, 123, 1e-6) && near(selr.rot, Math.PI / 2, 1e-9) && near(selr.sx, s0.sx * 2 / mx, 1e-6) && selr.fy && near(selr.sxv, selr.sx, 0.01), { s0, selr });
  await key('Escape');

  const th = await ev(`(()=>{const tiles=[...document.querySelectorAll('#texThumbs .thumb:not(.add)')];tiles[2].querySelector('.pick').click();return {n:tiles.length,btns:tiles[0].querySelectorAll('button').length,active:state.textures.findIndex(t=>t.id===state.activeTexId),on:document.querySelectorAll('#texThumbs .thumb.on').length,pressed:document.querySelectorAll('#texThumbs .pick[aria-pressed=true]').length}})()`);
  chk('thumbnail strip: one tile per sheet, three real buttons each, a click picks the sheet', th.n === 7 && th.btns === 3 && th.active === 2 && th.on === 1 && th.pressed === 1, th);

  await ev('state.activeTexId=state.textures[0].id;loadActiveTextureSettings();1');
  await setIn('colsInput', 3);
  const g1 = await ev("({c:state.textures[0].cols,t:state.textures[0].totalFrames,tin:+document.getElementById('totalFramesInput').value})");
  await ev("[...document.querySelectorAll('#presetRow button')].find(b=>b.dataset.preset==='4,4').click();1");
  const g2 = await ev('({c:state.textures[0].cols,r:state.textures[0].rows,t:state.textures[0].totalFrames,on:[...document.querySelectorAll("#presetRow button.on")].map(b=>b.dataset.preset).join()})');
  await setIn('totalFramesInput', 10);
  const g3 = await ev('state.textures[0].totalFrames');
  await segClick('Channel', 'B');
  const g4 = await ev('state.textures[0].channel');
  await segClick('Channel', 'RGB');
  chk('Active texture: columns, preset, total frames, channel', g1.c === 3 && g1.t === 12 && g1.tin === 12 && g2.c === 4 && g2.r === 4 && g2.t === 16 && g2.on === '4,4' && g3 === 10 && g4 === 'b', { g1, g2, g3, g4 });
  await setIn('totalFramesInput', 16);

  await segClick('Mode', 'Checker');
  const b1 = await ev('state.bg.mode');
  await ev("document.querySelector('#sidebar .swatches [data-color=\"#808080\"]').click();1");
  const b2 = await ev('({m:state.bg.mode,c:state.bg.color,q:[...document.querySelectorAll("[data-quickbg].on")].length})');
  await setIn('brSlider', 150);
  const b3 = await ev('state.brightness');
  await ev("[...document.querySelectorAll('#sidebar button')].find(b=>b.textContent==='Reset all').click();1");
  const b4 = await ev('({br:state.brightness,v:+document.getElementById("brSlider").value})');
  chk('Background and Post process rows', b1 === 'checker' && b2.m === 'checker' && b2.c === '#808080' && b3 === 1.5 && b4.br === 1 && b4.v === 100, { b1, b2, b3, b4 });

  await ev("document.getElementById('autoEmitCheck').click();1");
  await delay(900);
  const em = await ev('({auto:state.autoEmit,fin:state.instances.filter(i=>i.lifespan!==Infinity).length,dis:document.getElementById("emitRateSlider").disabled})');
  await flush();
  const emSaved = await idbScene();
  await ev("document.getElementById('autoEmitCheck').click();state.instances=state.instances.filter(i=>i.lifespan===Infinity);1");
  chk('emitter: enable un-greys its rows, particles spawn, they are not saved', em.auto && em.fin > 0 && !em.dis && emSaved.inst === 7, { em, emSaved });

  // Reimport pulls fresh pixels off disk through the handle (OPFS stands in for a file on disk)
  const rei = await ev(`(async()=>{
    const root = await navigator.storage.getDirectory();
    const fh = await root.getFileHandle('opfs_2x2.png');
    const tex = state.textures.find(t => t.name === 'opfs_2x2.png');
    const before = [tex.img.width, tex.handle ? 1 : 0, state.instances.filter(i => i.texId === tex.id).length];
    const f = await __mk('opfs_2x2.png', 2, 2, 150, 100);
    const w = await fh.createWritable(); await w.write(f); await w.close();
    tex.tint = '#00ff00'; tex.tintAmount = 1;
    await reimportAll();
    return { before, after: tex.img.width, tint: tex.tint, inst: state.instances.filter(i => i.texId === tex.id).length, cols: tex.cols };
  })()`);
  chk('Reimport all re-reads the handle: new pixels, tint / grid / instances kept', rei.before[0] === 180 && rei.before[1] === 1 && rei.after === 300 && rei.tint === '#00ff00' && rei.inst === rei.before[2] && rei.cols === 2, rei);

  // ---- (h) fit refits on resize, a manual view does not
  await size(1700, 1000);
  await delay(300);
  await ev(`fitView();1`);
  await delay(100);
  const f0 = await ev('({s:state.scale,fit:state.viewFit,w:view.w})');
  await size(1280, 800);
  await delay(700);
  const f1 = await ev('({s:state.scale,fit:state.viewFit,w:view.w})');
  chk('fitted view refits when the window shrinks', f0.fit && f1.fit && f1.w < f0.w && f1.s < f0.s - 1e-4, { f0, f1 });
  await ev(`zoomBy(0.2);1`);
  const m0 = await ev('({s:state.scale,fit:state.viewFit})');
  await size(1700, 1000);
  await delay(700);
  const m1 = await ev('({s:state.scale,fit:state.viewFit})');
  chk('a view changed by hand is left alone on resize', !m0.fit && !m1.fit && near(m0.s, m1.s), { m0, m1 });
  await ev(`fitView();1`);

  // clear canvas + undo
  await ev(`clearCanvas();1`);
  const cl = await ev('state.instances.length');
  const cltoast = await host(`S.document.querySelector('.kit-toast.on')&&S.document.querySelector('.kit-toast.on').textContent`);
  chk('Clear canvas empties the canvas and offers Undo', cl === 0 && /Undo/.test(cltoast || ''), { cl, cltoast });
  await host(`[...S.document.querySelectorAll('.kit-toast.on button')].find(b=>b.textContent==='Undo').click()`);
  chk('Undo brings the sprites back', (await ev('state.instances.length')) === 7);

  // ---- (i) layout checks at 1280 and 1920
  const layout = () => ev(`(()=>{
    const bad = [];
    for (const e of document.querySelectorAll('body *')) {
      if (!e.offsetParent && e.tagName !== 'BODY') continue;
      const hasText = [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
      if (!hasText) continue;
      const cs = getComputedStyle(e);
      if (e.scrollWidth > e.clientWidth + 1 && cs.overflowX !== 'visible' && cs.textOverflow !== 'ellipsis' && !e.closest('.libfiles') && e.tagName !== 'INPUT')
        bad.push(e.tagName + '.' + e.className + ' ' + e.scrollWidth + '>' + e.clientWidth + ' ' + e.textContent.slice(0, 30));
    }
    const sb = document.getElementById('sidebar');
    const r = id => { const q = document.getElementById(id) || document.querySelector(id); const b = q.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom }; };
    const tb = [...document.querySelectorAll('#toolbar>*')].map(e => e.getBoundingClientRect()).filter(b => b.width > 0);
    const st = document.getElementById('stats').getBoundingClientRect();
    const hit = tb.some(b => b.left < st.right && st.left < b.right && b.top < st.bottom && st.top < b.bottom);
    const sbRows = [...sb.querySelectorAll('.sec.open .row')].filter(x => x.offsetParent).map(x => ({ w: x.scrollWidth, c: x.clientWidth })).filter(x => x.w > x.c + 1).length;
    return { bad, sbScroll: sb.scrollWidth > sb.clientWidth + 1, toolbarHitsStats: hit, rowsOverflow: sbRows, canvas: [canvas.width, canvas.height, view.w, view.h],
      headOver: (() => { const h = parent.document.getElementById('head'); return h.scrollWidth > h.clientWidth + 1; })() };
  })()`);
  await ev(`state.instances.length;1`);
  for (const [w, h] of [[1280, 800], [1920, 1080]]) {
    await size(w, h);
    await delay(700);
    await ev(`(()=>{ for (const s of document.querySelectorAll('#sidebar .sec')) { if (!s.classList.contains('open') && s.querySelector('.hd b').textContent!=='Texture library') s.querySelector('.hd').click(); } setSelection([state.instances[2]]); fitView({quiet:true}); 1})()`);
    await delay(500);
    const L = await layout();
    chk(`no clipped text at ${w}`, L.bad.length === 0, L.bad);
    chk(`sidebar has no sideways scroll or squeezed rows at ${w}`, !L.sbScroll && L.rowsOverflow === 0, L);
    chk(`toolbar and stats do not overlap at ${w}`, !L.toolbarHitsStats, L);
    chk(`host header fits at ${w}`, !L.headOver);
    chk(`canvas matches its box at ${w}`, Math.abs(L.canvas[0] - L.canvas[2]) <= 1 && Math.abs(L.canvas[1] - L.canvas[3]) <= 1, L.canvas);
    await shot(`flipbook-${w}`);
  }

  // a library folder card, the open sections, an emitter running
  await size(1920, 1080);
  await delay(400);
  await ev(`(()=>{ state.autoEmit = true; ui.scatterRows.sync(); setTool('select'); 1})()`);
  await ev(`(()=>{ library = [normalizeEntry({id:1,name:'Fire sheets',picks:['a.png']})]; library[0].expanded = true; library[0].files = [{name:'a.png'},{name:'b_8x8.png'},{name:'very_long_explosion_sheet_name_8x8_v02.png'}]; renderLibrary(); ui.librarySec.toggle(true); 1})()`);
  await delay(900);
  await shot('flipbook-1920-emitter-library');
  await ev(`(()=>{ state.autoEmit = false; library = []; renderLibrary(); ui.scatterRows.sync(); state.instances = state.instances.filter(i=>i.lifespan===Infinity); 1})()`);

  // ---- (k) keyboard keeps working after a slider was used with the mouse
  await ev(`(()=>{ const s = document.getElementById('brSlider'); s.focus(); s.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true})); s.dispatchEvent(new Event('change',{bubbles:true})); 1})()`);
  const act = await ev('document.activeElement && document.activeElement.id');
  chk('a slider used with the mouse gives the keyboard back', act !== 'brSlider', act);

  const errs = await ev('qaErrors');
  chk('no page errors', errs.length === 0, errs);
  out.counts = await ev('({textures:state.textures.length,instances:state.instances.length})');
  return out;
};
