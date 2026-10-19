const fs=require('fs'),path=require('path');
const {setup}=require('./common.cjs');
const lib=fs.readFileSync(path.join(__dirname,'fuzzlib.js'),'utf8');
module.exports=async({ev,log,capture})=>{
  await setup(ev); await ev(lib+';1');
  await ev(`(()=>{ for(const f of FORMATS){ const L=state.layouts[f.id]; L.layers=[];
      SHAPE_KINDS.forEach(k=>{ const l=layerDefaults('shape',k); l.kind=k; l.on=true; l.x=0.3;l.y=0.3; L.layers.push(l); });
      ['text','grid'].forEach(t=>{ const l=layerDefaults(t,t); l.on=true; L.layers.push(l); });
      L.shot.panels=3; L.shot.edgeOn=true; L.row.sepOn=true; L.accent.segments=3; L.logo.outOn=true; L.band.on=true; L.badges.on=true; L.version.on=true; L.frame.on=true; L.grad.on=true;
      ['grad','band','accent','logo','row','version','badges','frame'].forEach(k=>{ L[k].shadowOn=true; }); }
    window.BASE=JSON.stringify({layouts:state.layouts}); return 1;})()`);
  const rows=await ev(`(()=>{ const R=[]; const L=state.layouts.unity_cover;
    PARTS.forEach(p=>(p.rows||[]).forEach(r=>{ if(r.type==='range'&&r.p) R.push({p:r.p,min:r.min,max:r.max}); }));
    L.layers.forEach((l,i)=>{ layerRows(l).forEach(r=>{ if(r.type==='range'&&r.p){ R.push({p:r.p.replace(/^[^.]+\./,'layers.'+i+'.'),min:r.min,max:r.max}); } }); });
    return R;})()`);
  const out={};
  for(const which of ['min','max','alt']){
    out[which]=await ev(`(()=>{ const res={}; for(const f of FORMATS){ state.layouts=JSON.parse(BASE).layouts; const L=state.layouts[f.id];
      ${JSON.stringify(rows)}.forEach((row,i)=>{ const P=row.p.split('.'); let o=L; for(let k=0;k<P.length-1;k++) o=o[P[k]]; if(!o) return; o[P[P.length-1]]=${JSON.stringify(which)}==='alt'?(i%2?row.max:row.min):row[${JSON.stringify(which)}]; });
      const cc=document.createElement('canvas'); cc.width=f.w; cc.height=f.h; const c=cc.getContext('2d'); FZ.reset();
      const ts=[]; let err=null; for(let k=0;k<3;k++){ const t=performance.now(); try{renderTo(c,f,L,false);}catch(e){err=String(e).slice(0,150);} ts.push(Math.round(performance.now()-t)); }
      res[f.id]={ts,err,bad:FZ.bad.slice(0,3),sr:FZ.ctr.save-FZ.ctr.restore}; } return res; })()`);
  }
  return out;
};
