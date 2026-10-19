const {setup}=require('./common.cjs');
module.exports=async({ev})=>{
  await setup(ev);
  return ev(`(()=>{ const out=[]; state.active='unity_cover';
    const cur=variantSnap('cur'); const old=variantSnap('old'); delete old.layouts.unity_cover.frame; old.pack.title='OLD VARIANT TITLE';
    state.variants=[cur,old]; const origPack=state.pack, origLayouts=state.layouts;
    let err=null; try{ compareSheet(); }catch(e){ err=String(e).slice(0,100); }
    out.push('error: '+err);
    out.push('state.pack restored: '+(state.pack===origPack)+' layouts restored: '+(state.layouts===origLayouts)+' title now: '+state.pack.title);
    return out; })()`);
};
