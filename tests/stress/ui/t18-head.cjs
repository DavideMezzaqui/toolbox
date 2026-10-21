'use strict';
// Z3a: right panel head (strip + tabs + search) - height, one row for tabs and search, whole rows in the strip,
// no clipped text, calm cards, labelled "Remove all", rows saved by the handle.
module.exports = async ({ev, command, delay, capture, until}) => {
  const bad = [], R = {};
  const chk = (n, ok, info) => { if(!ok){ bad.push(n); console.log('FAIL', n, JSON.stringify(info)); } };
  await ev(`(async()=>{
    const fs=[];
    for(let i=0;i<13;i++){
      const c=document.createElement('canvas');c.width=640;c.height=360;const g=c.getContext('2d');
      g.fillStyle='hsl('+(i*27)+',55%,35%)';g.fillRect(0,0,640,360);g.fillStyle='#fff';g.font='bold 120px sans-serif';g.fillText(String(i+1),40,220);
      const b=await new Promise(r=>c.toBlob(r,'image/png'));fs.push(new File([b],'shot'+(i+1)+'.png',{type:'image/png'}));
    }
    addShots(fs);return 1})()`);
  await until(async()=>(await ev('SHOTS.length'))===13, '13 images');
  await delay(800);
  const measure = () => ev(`(()=>{
    const a=document.querySelector('aside.right'),h=a.querySelector('.phead'),l=a.querySelector('.lib'),t=a.querySelector('.tabs'),f=a.querySelector('#secFilter'),c=a.querySelector('#secClose');
    const r=e=>e.getBoundingClientRect(), card=l.querySelector('.card');
    const clipped=[...h.querySelectorAll('button,b,.tl')].filter(e=>e.offsetParent&&e.scrollWidth>e.clientWidth+1).map(e=>e.textContent.trim()||e.title);
    const ra=[...h.querySelectorAll('#imgs .ih button')].find(b=>/Remove all/.test(b.textContent));
    return {panelH:r(a).height, headH:r(h).height, libH:r(l).height, cardH:r(card).height, cardW:r(card).width,
      rows:Math.round((r(l).height)/(r(card).height+4)), tabsTop:r(t).top, tabsBot:r(t).bottom, fTop:r(f).top, fBot:r(f).bottom,
      tabsRight:r(t).right, fLeft:r(f).left, closeW:r(c).width, closeVisible:r(c).right<=r(h).right+1,
      libScrollW:l.scrollWidth, libClientW:l.clientWidth, clipped, removeAll:!!ra&&ra.offsetWidth>30, removeAllText:ra&&ra.textContent.trim(),
      inUse:[...l.querySelectorAll('.pan')].map(x=>x.textContent), usesOpacity:[...l.querySelectorAll('.uses')].map(x=>getComputedStyle(x).opacity),
      tabTexts:[...t.querySelectorAll('button')].map(b=>b.textContent)}})()`);
  const SZ = [[1280,720,.24,1],[1920,1080,.18,2],[2560,1440,.18,2]];
  for(const [w,h,lim,rows] of SZ){
    await command('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile:false});
    await delay(700);
    const m = await measure(); R[w] = m;
    chk('head share '+w, m.headH/m.panelH <= lim, [m.headH, m.panelH, m.headH/m.panelH]);
    chk('tabs and search on one row '+w, Math.abs(m.tabsTop-m.fTop) < 6 && m.tabsRight <= m.fLeft && m.closeVisible, m);
    chk('strip is whole rows '+w, m.rows===rows && Math.abs(m.libH-m.rows*(m.cardH+4)) <= 1.5, m);
    chk('no horizontal scroll in strip '+w, m.libScrollW <= m.libClientW+1, m);
    chk('no clipped text in head '+w, m.clipped.length===0, m.clipped);
    chk('Remove all has its label '+w, m.removeAll && m.removeAllText==='Remove all', m);
    chk('no IN USE pill, usage only on hover '+w, m.inUse.length===0 && m.usesOpacity.every(o=>o==='0'), m);
    chk('tab texts kept '+w, m.tabTexts.join('|')==='Design|Image|Pack & export', m.tabTexts);
    if(w!==2560) await capture('t18-head-'+w);
  }
  // scrolling the strip stops on whole rows
  await command('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});
  await delay(500);
  const snap = await ev(`(async()=>{const l=document.querySelector('#imgs .lib'),card=l.querySelector('.card'),st=card.getBoundingClientRect().height+4;
    l.scrollTop=st*0.4;await new Promise(r=>setTimeout(r,300));const a=l.scrollTop;l.scrollTop=st*1.3;await new Promise(r=>setTimeout(r,300));const b=l.scrollTop;
    return {st,a,b,okA:Math.min(a%st,st-a%st)<1.5,okB:Math.min(b%st,st-b%st)<1.5||b+1>=l.scrollHeight-l.clientHeight}})()`);
  chk('strip scroll lands on row start', snap.okA && snap.okB, snap);
  // handle: rows change in whole steps, are saved as rows, double click resets
  const hd = await ev(`(()=>{const l=document.querySelector('#imgs .lib'),h=document.querySelector('#imgs .rzh'),st=l.querySelector('.card').getBoundingClientRect().height+4;
    const mk=(t,y)=>new PointerEvent(t,{clientX:100,clientY:y,pointerId:9,button:0,bubbles:true,cancelable:true});
    h.dispatchEvent(mk('pointerdown',300));h.dispatchEvent(mk('pointermove',300+st));h.dispatchEvent(mk('pointerup',300+st));
    const r3=Math.round(l.getBoundingClientRect().height/st);const saved=JSON.parse(localStorage.getItem('davfx-store-graphics-panels')||'{}');
    h.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));const r2=Math.round(l.getBoundingClientRect().height/st);
    return {r3,r2,savedRows:saved.libRows,after:JSON.parse(localStorage.getItem('davfx-store-graphics-panels')||'{}').libRows, st, h:l.getBoundingClientRect().height}})()`);
  chk('handle adds one row, saved as rows', hd.r3===3 && hd.savedRows===3, hd);
  chk('double click back to default', hd.r2===2 && hd.after===undefined, hd);
  // multi panel: card shows which panel
  const mp = await ev(`(()=>{state.layouts[state.active].shot.panels=2;buildControls();return [...document.querySelectorAll('#imgs .pan')].map(x=>x.textContent)})()`);
  chk('panel label only with several panels', mp.length>=1 && mp.every(t=>/^P\d/.test(t)), mp);
  await ev('state.layouts[state.active].shot.panels=1;buildControls();1');
  // tabs still work and search finds across tabs
  await ev(`document.querySelector('.tabs button[data-tab="image"]').click();1`);
  chk('tab click works', (await ev('activeTab'))==='image');
  await ev(`(()=>{const f=document.getElementById('secFilter');f.value='blur';f.dispatchEvent(new Event('input',{bubbles:true}));return 1})()`);
  chk('search still works', await ev(`!!document.querySelector('.sec[data-title="Blur effects"]') && getComputedStyle(document.querySelector('.sec[data-title="Blur effects"]')).display!=='none'`));
  await ev(`(()=>{const f=document.getElementById('secFilter');f.value='';f.dispatchEvent(new Event('input',{bubbles:true}));return 1})()`);
  // empty project: head still compact
  await ev(`runAction('shotsClear');1`); await delay(400);
  const em = await ev(`(()=>{const a=document.querySelector('aside.right'),h=a.querySelector('.phead');return {r:h.getBoundingClientRect().height/a.getBoundingClientRect().height, rma:!![...h.querySelectorAll('button')].find(b=>/Remove all/.test(b.textContent))}})()`);
  chk('empty head compact and without Remove all', em.r<.18 && !em.rma, em);
  await command('Emulation.setDeviceMetricsOverride',{width:1700,height:1000,deviceScaleFactor:1,mobile:false});
  return {ok:bad.length===0, bad, R};
};
