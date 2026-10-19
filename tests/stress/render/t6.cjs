const {setup}=require('./common.cjs');
module.exports=async({ev,capture})=>{
  await setup(ev);
  const r=await ev(`(()=>{ const res={}; for(const f of FORMATS){ const L=state.layouts[f.id]; L.shot.panels=3;
     const cc=document.createElement('canvas'); cc.width=f.w; cc.height=f.h; const c=cc.getContext('2d',{willReadFrequently:false});
     const ts=[]; for(let k=0;k<3;k++){ const t=performance.now(); renderTo(c,f,L,false); c.getImageData(0,0,1,1); ts.push(Math.round(performance.now()-t)); }
     const t=performance.now(); state.active=f.id; render(); ctx.getImageData(0,0,1,1); res[f.id]=[ts,'preview '+Math.round(performance.now()-t), PW+'x'+PH]; } return res; })()`);
  await ev(`state.active='unity_cover'; render(); 1`);
  await capture('cover');
  return r;
};
