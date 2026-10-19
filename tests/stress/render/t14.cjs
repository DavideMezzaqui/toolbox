const {setup}=require('./common.cjs');
module.exports=async({ev})=>{
  await setup(ev);
  return ev(`(async()=>{ const out=[]; const h=async b=>{ const d=await crypto.subtle.digest('SHA-1',await b.arrayBuffer()); return Array.from(new Uint8Array(d)).slice(0,6).map(x=>x.toString(16).padStart(2,'0')).join(''); };
    const get=id=>new Promise(r=>renderFormatToBlob(FORMATS.find(x=>x.id===id),r));
    const base=JSON.stringify(state.layouts);
    const feats={accentGlow:L=>{L.accent.glow=0.8;}, logoGlow:L=>{L.logo.outOn=true;L.logo.glow=0.6;}, blur:L=>{L.fx.blur=0.2;}, none:L=>{}};
    for(const [n,fn] of Object.entries(feats)){ state.layouts=JSON.parse(base); for(const f of FORMATS) fn(state.layouts[f.id]);
      const id='unity_cover'; const a=await h(await get(id)); await get('unity_shot'); const a3=await h(await get(id)); const a4=await h(await get(id)); out.push(n+' '+a+' '+a3+' '+a4+(a===a3?' same':' DIFF')); }
    return out; })()`);
};
