// page-side helpers; installed via ev(LIB)
module.exports = `
window.F = (()=>{
  let seed = 1;
  const rnd = ()=>{ seed = (seed*1664525 + 1013904223) >>> 0; return seed/4294967296; };
  const ri = n => Math.floor(rnd()*n);
  const pick = a => a[ri(a.length)];
  const fire = (el, t, init)=> el.dispatchEvent(new Event(t, Object.assign({bubbles:true}, init||{})));
  const mouse = (target, t, x, y, o)=> target.dispatchEvent(new MouseEvent(t, Object.assign({bubbles:true, cancelable:true, clientX:x, clientY:y, view:window}, o||{})));
  const key = (k, o, target)=> (target||document.body).dispatchEvent(new KeyboardEvent('keydown', Object.assign({key:k, bubbles:true, cancelable:true}, o||{})));
  function fp(){
    const idx = img => SHOTS.findIndex(x=>x.img===img);
    return JSON.stringify({s: JSON.parse(snapState()), shots: SHOTS.map(x=>x.name+'|'+(x.blob&&x.blob.size)), main: idx(imgShot), logo: imgLogo? 'L':null,
      proj: nomeProgetto});
  }
  function invariants(){
    const bad = [];
    const chk = (layouts, where)=> Object.keys(layouts||{}).forEach(id=>{
      const S = layouts[id] && layouts[id].shot; if(!S||!Array.isArray(S.src)) return;
      S.src.forEach((v,p)=>{ if(false) bad.push(where+':'+id+' panel'+p+' -> '+v+' (SHOTS '+SHOTS.length+')'); });
    });
    chk(state.layouts,'layouts'); (state.variants||[]).forEach((v,i)=>chk(v.layouts,'variant'+i));
    if(imgShot && !SHOTS.some(x=>x.img===imgShot)) bad.push('imgShot not in SHOTS');
    if(!imgShot && SHOTS.length) bad.push('imgShot null with SHOTS');
    if(undoStack.length!==undoShots.length) bad.push('undo stacks len '+undoStack.length+'/'+undoShots.length);
    if(redoStack.length!==redoShots.length) bad.push('redo stacks len '+redoStack.length+'/'+redoShots.length);
    const u=document.getElementById('bUndo'), r=document.getElementById('bRedo');
    if(u.disabled !== !undoStack.length) bad.push('undo btn state');
    if(r.disabled !== !redoStack.length) bad.push('redo btn state');
    return bad;
  }
  async function mkFiles(n, tag){
    const out=[];
    for(let i=0;i<n;i++){
      const c=document.createElement('canvas'); c.width=320+ri(200); c.height=180+ri(100);
      const g=c.getContext('2d'); g.fillStyle='hsl('+ri(360)+',70%,50%)'; g.fillRect(0,0,c.width,c.height); g.fillStyle='#fff'; g.fillText(tag+i+'_'+ri(1e6),20,40);
      out.push(new File([await new Promise(r=>c.toBlob(r,'image/png'))], (tag||'t')+i+'_'+ri(1e6)+'.png', {type:'image/png', lastModified: 1e12+ri(1e9)}));
    }
    return out;
  }
  const cvPt = (fx,fy)=>{ const r=cv.getBoundingClientRect(); return [r.left+fx*r.width, r.top+fy*r.height]; };
  function drag(x0,y0,x1,y1,o){
    const [a,b]=cvPt(x0,y0),[c,d]=cvPt(x1,y1);
    mouse(cv,'mousedown',a,b,o); const n=3;
    for(let i=1;i<=n;i++) mouse(window,'mousemove',a+(c-a)*i/n,b+(d-b)*i/n,o);
    mouse(window,'mouseup',c,d,o);
  }
  function ctrlInputs(){ return [...document.querySelectorAll('#controls input[data-path],#controls select[data-path]')]; }
  function setRange(inp){
    const mn=+inp.min, mx=+inp.max; const v = mn + rnd()*(mx-mn);
    inp.value = v; fire(inp,'input'); fire(inp,'change');
  }
  const log = [];
  async function op(name){
    const L = n=>log.push(n);
    switch(name){
      case 'drag': { const o={shiftKey: rnd()<0.1}; drag(rnd(),rnd(),rnd(),rnd(),o); L('drag'); break; }
      case 'click': { const [a,b]=cvPt(rnd(),rnd()); mouse(cv,'mousedown',a,b); mouse(window,'mouseup',a,b); L('click'); break; }
      case 'handle': { const hr = handleRect(PW,PH); if(hr){ const r=cv.getBoundingClientRect(); const x0=r.left+(hr.x+hr.w/2)/PW*r.width, y0=r.top+(hr.y+hr.h/2)/PH*r.height;
          mouse(cv,'mousedown',x0,y0); mouse(window,'mousemove',x0+rnd()*80-40,y0+rnd()*80-40); mouse(window,'mouseup',x0,y0); } L('handle'); break; }
      case 'ctrl': { const a=ctrlInputs().filter(i=>!i.classList.contains('val')); const i=pick(a); if(!i) break;
          if(i.type==='range') setRange(i); else if(i.type==='checkbox'){ i.checked=!i.checked; fire(i,'change'); }
          else if(i.tagName==='SELECT'){ i.selectedIndex = ri(i.options.length); fire(i,'change'); }
          else if(i.type==='color'){ i.value='#'+ri(0xffffff).toString(16).padStart(6,'0'); fire(i,'input'); fire(i,'change'); }
          L('ctrl '+i.getAttribute('data-path')); break; }
      case 'num': { const a=[...document.querySelectorAll('#controls input.val')]; const i=pick(a); if(!i) break; i.value=(rnd()*100).toFixed(2); fire(i,'change'); L('num'); break; }
      case 'text': { const a=[...document.querySelectorAll('#controls input[type=text][data-path],#controls textarea')]; const i=pick(a); if(!i) break; i.focus(); i.value='x'+ri(999); fire(i,'input'); i.blur(); L('text'); break; }
      case 'panels': { const i=document.querySelector('[data-path="shot.panels"]'); if(i){ i.value=1+ri(6); fire(i,'input'); fire(i,'change'); } L('panels'); break; }
      case 'fmt': { const f=pick(FORMATS); state.active=f.id; buildFormats(); buildControls(); render(); L('fmt'); break; }
      case 'add': { const fs=await mkFiles(1+ri(3),'a'); await new Promise(r=>addShots(fs,r)); L('add'); break; }
      case 'card': { const c=document.querySelectorAll('#imgs .card'); if(c.length){ const e=pick([...c]); e.dispatchEvent(new MouseEvent('click',{bubbles:true,altKey:rnd()<0.2})); } L('card'); break; }
      case 'remove': { if(SHOTS.length){ togliImmagine(ri(SHOTS.length)); } L('remove'); break; }
      case 'move': { if(SHOTS.length>1){ spostaImmagine(ri(SHOTS.length), ri(SHOTS.length+1)); } L('move'); break; }
      case 'varload': { const b=[...document.querySelectorAll('#controls button')].filter(b=>b.title.startsWith('Load "')); if(b.length) pick(b).click(); L('varload'); break; }
      case 'vardel': { const b=[...document.querySelectorAll('#controls button')].filter(b=>b.title.startsWith('Delete this variant')); if(b.length) pick(b).click(); L('vardel'); break; }
      case 'varupd': { const b=[...document.querySelectorAll('#controls button')].find(b=>b.textContent.trim()==='Update selected variant'); if(b) b.click(); L('varupd'); break; }
      case 'ur': { const f=fp(); const n=1+ri(4); let k=0; for(let i=0;i<n&&undoStack.length;i++){ key('z',{ctrlKey:true}); k++; } for(let i=0;i<k;i++){ if(rnd()<0.5) key('y',{ctrlKey:true}); else key('Z',{ctrlKey:true,shiftKey:true}); } L('ur'); if(fp()!==f) throw new Error('undo/redo roundtrip mismatch k='+k); break; }
      case 'clear': { if(SHOTS.length) runAction('shotsClear'); L('clear'); break; }
      case 'variant': { const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Save current as new variant'); if(b) b.click(); L('variant'); break; }
      case 'arrow': { key(pick(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown']), {shiftKey: rnd()<0.3}); L('arrow'); break; }
      case 'del': { key('Delete'); L('del'); break; }
      case 'addlayer': { const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='+ Shape'); if(b) b.click(); L('addlayer'); break; }
      case 'wheel': { const st=document.getElementById('stage')||cvwrap; st.dispatchEvent(new WheelEvent('wheel',{deltaY:-100,altKey:true,bubbles:true,cancelable:true,clientX:300,clientY:300})); L('wheel'); break; }
      case 'tab': { const t=pick([...document.querySelectorAll('button')].filter(b=>['Design','Image','Content','Variants','Output'].includes(b.textContent.trim()))); if(t) t.click(); L('tab'); break; }
    }
  }
  return {rnd, ri, pick, fp, invariants, mkFiles, op, log, setSeed:s=>{seed=s;}, key, fire, mouse, drag, cvPt};
})(); 1`;
