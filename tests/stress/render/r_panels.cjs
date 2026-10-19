const {setup}=require('./common.cjs');
module.exports=async({ev})=>{
  await setup(ev);
  return ev(`(()=>{const o={};const f=FORMATS[0];
   for(const n of [6,50,200,1000]){ state.layouts[f.id].shot.panels=n; const t=performance.now(); try{renderTo(ctx,f,state.layouts[f.id],false);}catch(e){o['e'+n]=String(e)}; o[n]=Math.round(performance.now()-t);}
   state.layouts[f.id].shot.panels=6; return o;})()`);
};
