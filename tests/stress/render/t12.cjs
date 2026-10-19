const {setup}=require('./common.cjs');
module.exports=async({ev})=>{
  await setup(ev);
  return ev(`(async()=>{ const out=[]; const snap=()=>{ const c=document.createElement('canvas'); c.width=cv.width;c.height=cv.height; const g=c.getContext('2d'); g.drawImage(cv,0,0); return g.getImageData(0,0,c.width,c.height); };
    const diff=(a,b)=>{ if(a.width!==b.width||a.height!==b.height) return 'size '+a.width+'x'+a.height+' vs '+b.width+'x'+b.height; let n=0,mx=0,first=null; for(let i=0;i<a.data.length;i+=4){ const d=Math.max(Math.abs(a.data[i]-b.data[i]),Math.abs(a.data[i+1]-b.data[i+1]),Math.abs(a.data[i+2]-b.data[i+2]),Math.abs(a.data[i+3]-b.data[i+3])); if(d){n++; mx=Math.max(mx,d); if(!first) first=[(i/4)%a.width,Math.floor(i/4/a.width)];} } return n+' px differ max '+mx+' first '+first; };
    for(const f of FORMATS){ const L=state.layouts[f.id]; L.shot.panels=3; L.fx.blur=0.3; L.fx.tintOn=true; L.fx.zoomBlur=0.3; L.fx.spinBlur=0.2; L.fx.vignette=0.5; }
    state.active='unity_cover'; render(); const A1=snap(); render(); const A1b=snap(); out.push('repeat: '+diff(A1,A1b));
    state.active='unity_shot'; render(); state.active='unity_cover'; render(); out.push('A-B-A: '+diff(A1,snap()));
    // which feature?
    for(const k of ['blur','tintOn','zoomBlur','spinBlur','vignette']){ for(const f of FORMATS){ const L=state.layouts[f.id]; L.fx.blur=0; L.fx.tintOn=false; L.fx.zoomBlur=0; L.fx.spinBlur=0; L.fx.vignette=0; }
      for(const f of FORMATS){ const L=state.layouts[f.id]; L.fx[k]= k==='tintOn'?true:0.4; }
      state.active='unity_cover'; render(); const a=snap(); state.active='unity_shot'; render(); state.active='unity_cover'; render(); out.push(k+': '+diff(a,snap())); }
    return out; })()`);
};
