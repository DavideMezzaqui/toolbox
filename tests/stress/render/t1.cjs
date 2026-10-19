const {setup}=require('./common.cjs');
module.exports=async({ev})=>{
  await setup(ev);
  return ev(`(async()=>{
    const out={times:{},dims:[],idem:{}};
    for(const f of FORMATS){
      state.active=f.id;
      let t=performance.now(); render(); out.times[f.id]=Math.round(performance.now()-t);
      render(); const a=cv.toDataURL();
      render(); out.idem[f.id]= a===cv.toDataURL();
      for(const k of [0.25,0.5,0.75,1]){
        state.export.scale=k;
        const t0=performance.now();
        const blob=await new Promise(r=>renderFormatToBlob(f,r));
        const dt=Math.round(performance.now()-t0);
        const bm=await createImageBitmap(blob); const o=outSize(f);
        out.dims.push([f.id,k,bm.width,bm.height,o.w,o.h,dt, (bm.width===o.w&&bm.height===o.h)?'':'MISMATCH']);
      }
      state.export.scale=1;
    }
    return out;})()`);
};
