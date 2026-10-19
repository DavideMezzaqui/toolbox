const {setup}=require('./common.cjs');
module.exports=async({ev,command,delay})=>{
  await setup(ev);
  await ev(`(async()=>{ const root=await navigator.storage.getDirectory(); for await (const [n] of root.entries()) await root.removeEntry(n,{recursive:true}); cartellaExport=root; for(const f of FORMATS){ const L=state.layouts[f.id]; L.shot.panels=3; L.accent.glow=0.5; L.fx.blur=0.2; } return 1; })()`);
  const rows=[];
  for(let round=0;round<6;round++){
    const r=await ev(`(async()=>{ const root=await navigator.storage.getDirectory();
      for(let i=0;i<5;i++){ await document.getElementById('bZip').onclick(); for(const f of FORMATS.slice(0,3)){ state.active=f.id; await document.getElementById('bExp').onclick(); } state.active='unity_cover'; render(); for await (const [n] of root.entries()) await root.removeEntry(n,{recursive:true}); }
      await new Promise(r=>setTimeout(r,300));
      return {heap:Math.round(performance.memory.usedJSHeapSize/1e6), total:Math.round(performance.memory.totalJSHeapSize/1e6), shotCache:_shotCache.length, scratch:_scratch.filter(Boolean).length, scratchPx:Math.round(_scratch.filter(Boolean).reduce((a,c)=>a+c.width*c.height,0)/1e6)}; })()`);
    rows.push(r);
  }
  await command('HeapProfiler.collectGarbage').catch(()=>{});
  const after=await ev('Math.round(performance.memory.usedJSHeapSize/1e6)');
  return {rows,afterGC:after};
};
