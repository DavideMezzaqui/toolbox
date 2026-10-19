const {setup}=require('./common.cjs');
module.exports=async({ev,reload,delay})=>{
  await setup(ev);
  const r1=await ev(`(async()=>{ const root=await navigator.storage.getDirectory(); for await (const [n] of root.entries()) await root.removeEntry(n,{recursive:true}); cartellaExport=root;
    const P=[]; state.active='unity_cover'; for(let i=0;i<4;i++){ P.push(document.getElementById('bExp').onclick()); P.push(document.getElementById('bZip').onclick()); }
    state.active='yt_thumb'; P.push(document.getElementById('bExp').onclick());
    await Promise.all(P); const out=[]; for await (const [n,h] of root.entries()){ const f=await h.getFile(); out.push(n+':'+f.size); } return out.sort(); })()`);
  // reload in the middle of Export all
  await ev(`(async()=>{ const root=await navigator.storage.getDirectory(); for await (const [n] of root.entries()) await root.removeEntry(n,{recursive:true}); cartellaExport=root; for(const f of FORMATS){state.layouts[f.id].shot.panels=3; state.layouts[f.id].accent.glow=0.5;} window.__p=document.getElementById('bZip').onclick(); return 1; })()`);
  await delay(120);
  await reload(); await delay(500);
  const r2=await ev(`(async()=>{ const root=await navigator.storage.getDirectory(); const out=[]; for await (const [n,h] of root.entries()){ const f=await h.getFile(); out.push(n+':'+f.size); } return {files:out, shots:SHOTS.length, active:state.active}; })()`);
  return {r1,r2};
};
