const {setup}=require('./common.cjs');
module.exports=async({ev})=>{
  await setup(ev);
  return ev(`(async()=>{ const out=[]; const f=FORMATS[0];
    for(const [k,v] of [['shot.panels',100000],['accent.segments',3e6],['row.sepCount',3e5]]){
      const d={pack:state.pack,layouts:{unity_cover:JSON.parse(JSON.stringify(state.layouts.unity_cover))}};
      const [g,q]=k.split('.'); d.layouts.unity_cover[g][q]=v; if(k==='row.sepCount') d.layouts.unity_cover.row.sepOn=true;
      caricaPresetFile(new File([JSON.stringify(d)],'p.json')); await new Promise(r=>setTimeout(r,800));
      state.active='unity_cover'; const t=performance.now(); try{ render(); ctx.getImageData(0,0,1,1);}catch(e){out.push('err '+e);} out.push(k+'='+v+' stored '+JSON.stringify(state.layouts.unity_cover[g][q])+' render '+Math.round(performance.now()-t)+'ms'); }
    return out; })()`);
};
