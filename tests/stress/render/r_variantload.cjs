const {setup}=require('./common.cjs');
module.exports=async({ev})=>{
  await setup(ev);
  return ev(`(()=>{ const out=[]; state.active='unity_cover';
    const old=variantSnap('old'); delete old.layouts.unity_cover.frame; delete old.layouts.fab_gallery; old.pack.title='OLD'; state.variants=[old];
    let err=null; try{ variantLoad(0); }catch(e){ err=String(e).slice(0,100); }
    out.push('variantLoad error: '+err); out.push('layouts has fab_gallery: '+!!state.layouts.fab_gallery+' frame: '+!!(state.layouts.unity_cover&&state.layouts.unity_cover.frame));
    let e2=null; try{ for(const f of FORMATS){ state.active=f.id; render(); } }catch(e){ e2=String(e).slice(0,100); } out.push('render all: '+e2);
    // scale
    const res=[]; for(const s of [0,-2,null,'abc',NaN,0.5]){ state.export.scale=s; res.push(JSON.stringify(outSize(FORMATS[0]))); } out.push(res.join(' '));
    return out; })()`);
};
