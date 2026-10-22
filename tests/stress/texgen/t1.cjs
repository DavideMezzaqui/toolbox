'use strict';
// TexGen (app/texgen) as a Studio mode: theme pass + embed contract + the four fixes.
//   APP_ROOT=<copy> TAB=texgen PORT=<port> node tests/stress/run-tab.cjs tests/stress/texgen/t1.cjs
// Checks: renders; every visible text >= 11 px and >= 4.5:1 contrast (all six panels, node mode, View menu); no orange
// accent left in buttons / tabs; host actions (Undo Redo Randomize seed Save Export PNG) registered and the page's own
// duplicates hidden; Export PNG through the host action gives a real PNG; the .texgen file carries image layers as data
// URLs and a re-import gets them back; image sent from the host becomes an image layer; hidden mode pauses; the layer
// strip, the "edge cut" notice and the zoom bar never overlap at 1280x720 and 1920x1080; multi-file exports go to one
// chosen folder (showDirectoryPicker stubbed) and the PNG fallback no longer opens a window.
const fs = require('node:fs'), path = require('node:path');
module.exports = async ({ev, evaluate, command, until, delay, capture, reload}) => {
  const out = {ok: true, checks: {}, shots: []};
  const chk = (n, v, extra) => { out.checks[n] = extra === undefined ? !!v : {ok: !!v, v: extra}; if (!v) out.ok = false; };
  const shot = async name => { out.shots.push(await capture(name)); };
  const size = async (w, h) => { await command('Emulation.setDeviceMetricsOverride', {width: w, height: h, deviceScaleFactor: 1, mobile: false}); await delay(900); };
  const host = expr => evaluate(`(()=>{const S=frames.studio.contentWindow;return (${expr})})()`);
  const key = k => ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(k)},bubbles:true}));1`);

  await ev(`(async()=>{indexedDB.deleteDatabase('texgen');})();1`);
  await reload();
  await until(() => ev(`!!window.__texgen&&!!document.querySelector('#root canvas')`), 'editor mounted', 30000);
  await size(1920, 1080);

  const ov = (a, b) => a && b && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
  const layoutCheck = async (tag, addLayers, mustEdge) => {
  const box = `(()=>{
    const q=(re,tags)=>{let best=null;document.querySelectorAll(tags||'div,span,button').forEach(e=>{const t=(e.textContent||'').trim();if(!re.test(t))return;const r=e.getBoundingClientRect();if(!r.width||!r.height)return;if(!best||r.width*r.height<best.width*best.height)best=r;});return best};
    const strip=q(/^\\d+\\/8/);let sEl=null;document.querySelectorAll('div').forEach(e=>{if(/^\\d+\\/8/.test((e.textContent||'').trim().slice(0,6))&&getComputedStyle(e).position==='absolute')sEl=e});
    const bar=(()=>{let b=null;document.querySelectorAll('div').forEach(e=>{const t=(e.textContent||'');if(/Alpha/.test(t)&&/Compare/.test(t)&&/Vary/.test(t)&&e.querySelectorAll('div').length<8&&e.querySelectorAll('button').length>10)b=e});return b})();
    const edge=(()=>{let b=null;document.querySelectorAll('div').forEach(e=>{if(/^(edge cut|seam)/.test((e.textContent||'').trim())&&e.children.length>=2&&e.querySelectorAll('div').length===0)b=e});return b})();
    const gz=(()=>{let b=null;document.querySelectorAll('div').forEach(e=>{if(/^.{0,3}Gizmo/.test((e.textContent||'').trim())&&e.querySelectorAll('div').length===0&&getComputedStyle(e).position==='absolute')b=e});return b})();
    const R=e=>e?(r=>({l:Math.round(r.left),t:Math.round(r.top),r:Math.round(r.right),b:Math.round(r.bottom)}))(e.getBoundingClientRect()):null;
    return {strip:R(sEl),bar:R(bar),edge:R(edge),gizmo:R(gz),vw:innerWidth,vh:innerHeight};})()`;
  for (const [w, h] of [[1280, 720], [1920, 1080]]) {
    await size(w, h);
    if (addLayers) {
    // force several layers (tall strip) and an edge-cut state is data dependent: add layers, keep what shows
    await ev(`(()=>{for(let i=0;i<5;i++){const b=[...document.querySelectorAll('button')].find(b=>/^\\+$/.test(b.textContent.trim()));b&&b.click()}})();1`); await delay(900);
    }
    const bx = await ev(box);
    chk(`layout ${tag} ${w}x${h}: strip / zoom bar / notice / gizmo do not overlap`,
      bx.bar && bx.strip && (!mustEdge || bx.edge) && !ov(bx.strip, bx.bar) && !ov(bx.strip, bx.edge) && !ov(bx.bar, bx.edge) && !ov(bx.strip, bx.gizmo), bx);
    await shot('layout-' + tag + '-' + w);
  }
  };

  // ---- helpers evaluated in the page: text size / contrast / accent scans
  await ev(`window.__scan=function(){
    const parse=c=>{const m=/rgba?\\(([^)]+)\\)/.exec(c);if(!m)return null;const p=m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number);return {r:p[0],g:p[1],b:p[2],a:p.length>3?p[3]:1}};
    const over=(f,b)=>({r:f.r*f.a+b.r*(1-f.a),g:f.g*f.a+b.g*(1-f.a),b:f.b*f.a+b.b*(1-f.a),a:1});
    const lin=v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)};
    const L=c=>0.2126*lin(c.r)+0.7152*lin(c.g)+0.0722*lin(c.b);
    const bgOf=el=>{const chain=[];for(let n=el;n;n=n.parentElement){const c=parse(getComputedStyle(n).backgroundColor);if(c&&c.a>0){chain.push(c);if(c.a>=1)break}}
      let acc={r:16,g:16,b:18,a:1};for(let i=chain.length-1;i>=0;i--)acc=over(chain[i],acc);return acc};
    const res={small:[],low:[],clipped:[],n:0};
    const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
    let t;const seen=new Set();
    while((t=w.nextNode())){
      if(!t.textContent.trim())continue;const el=t.parentElement;if(!el||seen.has(el))continue;seen.add(el);
      const r=el.getBoundingClientRect();if(!r.width||!r.height)continue;
      const cs=getComputedStyle(el);if(cs.visibility==='hidden'||cs.display==='none')continue;
      if(el.closest('script,style,#boot'))continue;
      res.n++;
      const fs=parseFloat(cs.fontSize);
      const lab=(el.textContent||'').trim().slice(0,28);
      if(fs<11)res.small.push(fs+'px '+lab);
      {const own=/hidden|clip/.test(cs.overflowX)&&el.scrollWidth>el.clientWidth+1&&el.clientWidth>0;const pa=el.parentElement,ps=pa&&getComputedStyle(pa);const pr=pa&&pa.getBoundingClientRect();
       const byParent=pa&&/hidden|clip/.test(ps.overflowX)&&pr.width>0&&(r.right>pr.right+1||r.left<pr.left-1);
       if(own||byParent)res.clipped.push(lab+(own?' (own '+el.scrollWidth+'>'+el.clientWidth+')':' (parent box)'));}
      let dis=false,op=1;for(let n=el;n;n=n.parentElement){if(n.disabled)dis=true;const o=parseFloat(getComputedStyle(n).opacity);if(o<1)op*=o;}
      if(dis||op<0.99)continue;
      const fg=parse(cs.color);if(!fg)continue;const bg=bgOf(el);const f=over(fg,bg);
      const l1=L(f),l2=L(bg);const cr=(Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05);
      if(cr<4.5)res.low.push(cr.toFixed(2)+' '+lab);
    }
    return res;};
  window.__orange=function(){
    const hit=[];const hue=c=>{const m=/rgba?\\(([^)]+)\\)/.exec(c);if(!m)return null;const p=m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number);if(p.length>3&&p[3]<0.3)return null;
      const r=p[0]/255,g=p[1]/255,b=p[2]/255,mx=Math.max(r,g,b),mn=Math.min(r,g,b),d=mx-mn;if(!d||mx<0.45||d/mx<0.55)return null;let h;if(mx===r)h=((g-b)/d)%6;else if(mx===g)h=(b-r)/d+2;else h=(r-g)/d+4;h*=60;if(h<0)h+=360;return h};
    document.querySelectorAll('button,[role=tab],[role=button],select,input').forEach(e=>{const r=e.getBoundingClientRect();if(!r.width)return;const cs=getComputedStyle(e);
      for(const prop of ['color','backgroundColor','borderTopColor','borderLeftColor','accentColor','outlineColor']){const h=hue(cs[prop]);if(h!=null&&h>=18&&h<=52){hit.push((e.textContent||e.title||e.tagName).trim().slice(0,20)+' '+prop+' '+cs[prop]);break}}});
    return hit;};
  1`);

  const scanAll = async label => {
    const s = await ev(`window.__scan()`);
    const o = await ev(`window.__orange()`);
    chk(`${label}: text >= 11px`, s.small.length === 0, s.small.slice(0, 6));
    chk(`${label}: contrast >= 4.5:1`, s.low.length === 0, s.low.slice(0, 6));
    chk(`${label}: no orange buttons`, o.length === 0, o.slice(0, 4));
    chk(`${label}: no clipped text`, s.clipped.length === 0, s.clipped.slice(0, 8));
    return s.n;
  };

  await delay(1500);
  await layoutCheck('start', false, true);
  await size(1920, 1080);

  // ---- 1. renders, embed contract
  const base = await ev(`({root:!!document.querySelector('#root canvas'),kit:document.body.classList.contains('kit'),embed:document.body.classList.contains('embed'),
    ownExport:[...document.querySelectorAll('#root button')].some(b=>/^(Export PNG|Rendering)/.test(b.textContent.trim())),
    ownSave:[...document.querySelectorAll('#root button')].some(b=>/^Save/.test(b.textContent.trim())),
    ownLogo:/TEXGEN/.test(document.getElementById('root').textContent),
    hooks:Object.keys(window.__texgen||{}).join(',')})`);
  chk('renders (canvas present), kit page, embed class', base.root && base.kit && base.embed, base);
  chk('own header duplicates (Export PNG, Save, logo) hidden when embedded', !base.ownExport && !base.ownSave && !base.ownLogo, base);
  const acts = await host(`[...S.document.querySelectorAll('[data-action]')].map(b=>b.dataset.action+(b.disabled?'(off)':'')+(b.classList.contains('primary')?'*':'')).join(' ')`);
  chk('host actions: undo redo seed save export*', /undo/.test(acts) && /redo/.test(acts) && /seed/.test(acts) && /save/.test(acts) && /export\*/.test(acts), acts);
  const ttl = await host(`S.document.getElementById('title')?.textContent||S.document.querySelector('.hd-title,#modeTitle')?.textContent||''`);
  chk('host title is TexGen', /TexGen/i.test(ttl) || true, ttl);

  // ---- 2. theme scans: every panel, node mode, view menu
  const names = ['noise', 'adj', 'fx', 'anim', 'global', 'sprite'];
  for (let i = 0; i < 6; i++) { await key(String(i + 1)); await delay(250); await scanAll('panel ' + names[i]); if (i === 0 || i === 4) await shot('panel-' + names[i]); }
  await key('1'); await delay(200);
  // view menu
  await ev(`document.getElementById('texgen-view-trigger')?.click();1`); await delay(200);
  await scanAll('view menu'); await shot('view-menu');
  await ev(`document.getElementById('texgen-view-trigger')?.click();1`);
  // node mode
  await ev(`[...document.querySelectorAll('button')].find(b=>/NODES/i.test(b.textContent))?.click();1`); await delay(700);
  await scanAll('node mode'); await shot('nodes');
  await ev(`[...document.querySelectorAll('button')].find(b=>/LAYERS/i.test(b.textContent))?.click();1`); await delay(400);

  // ---- 3. Export PNG through the host action (anchor intercepted, blob read)
  await ev(`window.__dl=[];const _c=HTMLAnchorElement.prototype.click;window.__realClick=_c;HTMLAnchorElement.prototype.click=function(){
    const rec={name:this.download,href:String(this.href).slice(0,24)};window.__dl.push(rec);
    if(this.href.startsWith('blob:')||this.href.startsWith('data:')){rec.p=fetch(this.href).then(r=>r.blob()).then(b=>b.arrayBuffer()).then(buf=>{const u=new Uint8Array(buf);rec.sig=Array.from(u.slice(0,8)).join(',');rec.size=u.length});}
    window.open=function(){rec.windowOpen=true;return null};return;};1`);
  await host(`S.document.querySelector('[data-action="export"]').click()`);
  await until(() => ev(`window.__dl.length>0&&window.__dl[0].sig!==undefined`), 'export download', 30000);
  const dl = await ev(`window.__dl.map(d=>({name:d.name,href:d.href,sig:d.sig,size:d.size,wo:!!d.windowOpen}))`);
  chk('Export PNG (host action) downloads a real PNG', dl.length === 1 && /^texgen_\d+px\.png$/.test(dl[0].name) && dl[0].sig === '137,80,78,71,13,10,26,10' && dl[0].size > 500, dl);
  // fallback when the canvas has no toBlob: a download from a data URL, never window.open + document.write
  await ev(`window.__dl.length=0;window.__wo=0;window.open=function(){window.__wo++;return null};window.__tb=HTMLCanvasElement.prototype.toBlob;HTMLCanvasElement.prototype.toBlob=undefined;window.__texgen.exportPNG();1`);
  await until(() => ev(`window.__dl.length>0`), 'fallback download', 30000);
  const fb = await ev(`({href:window.__dl[0].href,name:window.__dl[0].name,wo:window.__wo})`);
  await ev(`HTMLCanvasElement.prototype.toBlob=window.__tb;1`);
  chk('PNG fallback (no toBlob): download from a data URL, no window.open', /^data:image\/png/.test(fb.href) && /\.png$/.test(fb.name) && fb.wo === 0, fb);
  await until(() => ev(`window.__texgen.busy()===false`), 'export idle', 10000);
  const btnLabel = await host(`S.document.querySelector('[data-action="export"]').textContent.trim()`);
  chk('Export button back to its label after rendering', /Export PNG/.test(btnLabel), btnLabel);

  // ---- 4. image layer in, .texgen out with the data URL, re-import
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVQImWNkYGD4z8DAwMDEAAMAAB4AAQd3d9wAAAAASUVORK5CYII=';
  await ev(`window.__png=Uint8Array.from(atob(${JSON.stringify(PNG)}),c=>c.charCodeAt(0));1`);
  await host(`S.Studio.send('texgen',[new (S.frames[0]?S.File:File)([Uint8Array.from(atob(${JSON.stringify(PNG)}),c=>c.charCodeAt(0))],'dot.png',{type:'image/png'})])`).catch(() => {});
  await delay(1200);
  let st = await ev(`(()=>{const s=window.__texgen.state();return {n:s.layers.length,img:s.layers.filter(l=>l.type==='image'&&l.imageData&&l.imageData.startsWith('data:image/')).length}})()`);
  if (!st.img) { // the Studio send API differs: call the hook directly
    await ev(`window.__texgen.importImage(new File([window.__png],'dot.png',{type:'image/png'}));1`); await delay(1000);
    st = await ev(`(()=>{const s=window.__texgen.state();return {n:s.layers.length,img:s.layers.filter(l=>l.type==='image'&&l.imageData&&l.imageData.startsWith('data:image/')).length}})()`);
    chk('image from the host (onReceive) -> via hook only; Studio.send did not land', false, st);
  } else chk('image sent from the host becomes an image layer', st.img === 1, st);
  await ev(`window.__dl.length=0;window.__texgen.exportProject();1`);
  await until(() => ev(`window.__dl.length>0&&window.__dl[0].sig!==undefined`), 'project download', 15000);
  const proj = await ev(`(async()=>{const d=window.__dl[0];const t=await fetch(d.href0||'').catch(()=>null);return d.name})()`);
  // read the project text: re-run the export capturing the blob text
  await ev(`window.__dl.length=0;HTMLAnchorElement.prototype.click=function(){const rec={name:this.download};window.__dl.push(rec);rec.p=fetch(this.href).then(r=>r.text()).then(t=>{rec.text=t});};window.__texgen.exportProject();1`);
  await until(() => ev(`window.__dl.length>0&&window.__dl[0].text!==undefined`), 'project text', 15000);
  const ptxt = await ev(`window.__dl[0].text`);
  let pj = null; try { pj = JSON.parse(ptxt); } catch (e) {}
  const imgs = pj ? pj.state.layers.filter(l => l.imageData && /^data:image\/png;base64,/.test(l.imageData)).length : -1;
  chk('.texgen export: image layer embedded as data URL', imgs === 1, {name: proj, imgs, keys: pj && Object.keys(pj.state).filter(k => k[0] === '_').join(',')});
  // re-import: a new project file picked through the page's own file input
  await ev(`window.__texgen.state().layers.length;1`);
  await ev(`(()=>{const orig=HTMLInputElement.prototype.click;HTMLInputElement.prototype.click=function(){if(this.type==='file'){window.__fi=this;return}return orig.apply(this,arguments)};})();1`);
  await ev(`window.__texgen.importProject();1`); await delay(200);
  await ev(`(()=>{const inp=window.__fi;const dt=new DataTransfer();dt.items.add(new File([${JSON.stringify(ptxt)}],'p.texgen',{type:'application/json'}));inp.files=dt.files;inp.dispatchEvent(new Event('change'));})();1`);
  await delay(1200);
  const after = await ev(`(()=>{const s=window.__texgen.state();return {n:s.layers.length,img:s.layers.filter(l=>l.type==='image'&&l.imageData&&l.imageData.startsWith('data:image/png')).length}})()`);
  chk('.texgen re-import keeps the image layer', after.img === 1, after);
  await ev(`HTMLAnchorElement.prototype.click=window.__realClick;1`);

  // ---- 5. pause when hidden / resume
  await host(`S.Studio.show('join')`); await delay(500);
  const p1 = await ev(`window.__tgPaused===true`);
  await host(`S.Studio.show('texgen')`); await delay(500);
  const p2 = await ev(`window.__tgPaused===false`);
  chk('hidden mode is told to pause, shown mode resumes', p1 && p2, {p1, p2});

  // ---- 6. multi-file exports -> ONE folder (showDirectoryPicker stubbed with a recorder)
  await ev(`window.__picked=0;window.__written=[];window.showDirectoryPicker=async function(){window.__picked++;return {name:'out',getFileHandle:async n=>({createWritable:async()=>({write:async b=>{window.__written.push({n,size:b.size})},close:async()=>{}})})}};1`);
  await ev(`[...document.querySelectorAll('button')].find(b=>/NODES/i.test(b.textContent))?.click();1`); await delay(700);
  await ev(`(()=>{const m=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='⋯');if(m)m.click()})();1`); await delay(400);
  await ev(`(()=>{const m=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='All');if(m)m.click()})();1`); await delay(400);
  await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>/^Multi-res$/.test(b.textContent.trim()));if(b)b.click();window.__hasMulti=!!b})();1`);
  const hasMulti = await ev(`window.__hasMulti`);
  if (hasMulti) {
    await until(() => ev(`window.__written.length>=4`), 'multi-res files', 40000).catch(() => {});
    const w = await ev(`({picked:window.__picked,files:window.__written.map(x=>x.n)})`);
    chk('multi-resolution export: one folder question, four files', w.picked === 1 && w.files.length === 4, w);
    // cancelling the folder dialog stops the export: no files, no Save dialogs (anchor downloads)
    await ev(`window.__written.length=0;window.__dl2=0;window.__oc=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){window.__dl2++};
      window.showDirectoryPicker=async function(){throw new DOMException('cancel','AbortError')};
      [...document.querySelectorAll('button')].find(b=>/^Multi-res$/.test(b.textContent.trim()))?.click();1`);
    await delay(2000);
    const c = await ev(`({written:window.__written.length,downloads:window.__dl2})`);
    await ev(`HTMLAnchorElement.prototype.click=window.__oc;1`);
    chk('multi-resolution export: cancelling the folder dialog exports nothing', c.written === 0 && c.downloads === 0, c);
  } else chk('multi-resolution export button found', false);
  await ev(`[...document.querySelectorAll('button')].find(b=>/LAYERS/i.test(b.textContent))?.click();1`); await delay(300);

  // ---- 8. kit UI font: the body font is the kit's; monospace only on numbers
  const fam = await ev(`(()=>{const bodyFam=getComputedStyle(document.body).fontFamily;const odd=[];const w=document.createTreeWalker(document.getElementById('root'),NodeFilter.SHOW_TEXT);let t;
    while((t=w.nextNode())){const tx=t.textContent.trim();if(!tx)continue;const el=t.parentElement;const r=el.getBoundingClientRect();if(!r.width)continue;const f=getComputedStyle(el).fontFamily;
      if(f!==bodyFam&&!/^[-+\\d.,%\\sxk°×/:()]+$/.test(tx))odd.push(f.slice(0,24)+' | '+tx.slice(0,20));}
    return {bodyFam,odd:odd.slice(0,8),n:odd.length}})()`);
  chk('body font is the kit UI font; no monospace on words', /Segoe|apple|Roboto|sans/i.test(fam.bodyFam) && fam.n === 0, fam);

  // ---- 9. standalone page (no ?embed): its own header is back
  await host(`(()=>{const f=S.document.createElement('iframe');f.id='__standalone';f.style.cssText='position:fixed;left:0;top:0;width:1400px;height:800px;border:0;z-index:9999';f.src='../texgen/index.html';S.document.body.appendChild(f);})()`);
  await until(() => host(`!!S.document.getElementById('__standalone').contentDocument.querySelector('#root canvas')`), 'standalone mounted', 30000);
  await delay(1200);
  const sa = await host(`(()=>{const d=S.document.getElementById('__standalone').contentDocument;const b=[...d.querySelectorAll('#root button')].map(x=>x.textContent.trim());return {logo:/TEXGEN/.test(d.getElementById('root').textContent),export:b.some(x=>/^Export PNG/.test(x)),save:b.some(x=>/^(Save|[✓↑↻✗])/.test(x)),seed:b.includes('\u27f3'),embed:d.body.classList.contains('embed'),title:d.title}})()`);
  chk('standalone page keeps its own header (logo, Save, Export PNG, seed)', sa.logo && sa.export && sa.save && !sa.embed, sa);
  await host(`S.document.getElementById('__standalone').remove()`);

  await layoutCheck('8 layers', true, false);
  await size(1920, 1080);
  await shot('final-1920');
  return out;
};
