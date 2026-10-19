const {setup}=require('./common.cjs');
module.exports=async({ev})=>{
  await setup(ev);
  return ev(`(async()=>{ const out=[];
    const rows=[]; PARTS.forEach(p=>(p.rows||[]).forEach(r=>{ if(r.type==='range'&&r.p&&!/^(row|version|badges)\./.test(r.p)) rows.push(r); }));
    for(const f of FORMATS){ const L=state.layouts[f.id]; L.shot.panels=6; L.shot.edgeOn=true; L.logo.outOn=true; L.band.on=true; L.accent.segments=24;
      rows.forEach(r=>{ const P=r.p.split('.'); let o=L; for(let k=0;k<P.length-1;k++) o=o[P[k]]; if(o&&/blur|glow|Blur|zoom|spin|vignette|feather|Feather|edgeBlur/.test(P[P.length-1])) o[P[P.length-1]]=r.max; });
      L.layers=[]; SHAPE_KINDS.forEach(k=>{ const l=layerDefaults('shape',k); l.kind=k; l.shadowOn=true; l.shadowBlur=0.2; L.layers.push(l); }); const g=layerDefaults('grid','g'); g.shadowOn=true; g.shadowBlur=0.2; L.layers.push(g);
      ['band','accent','logo','row','grad','frame'].forEach(k=>{ L[k].shadowOn=true; L[k].shadowBlur=0.2; });
      for(const scale of [1,0.5]){ state.export.scale=scale;
        svuotaMemoriaSchermate(); const t=performance.now(); await new Promise(r=>renderFormatToBlob(f,r)); out.push(f.id+' x'+scale+' cold export '+Math.round(performance.now()-t)+'ms'); }
      state.export.scale=1; state.active=f.id; svuotaMemoriaSchermate(); let t=performance.now(); render(); ctx.getImageData(0,0,1,1); out.push(f.id+' preview cold '+Math.round(performance.now()-t)); t=performance.now(); render(); ctx.getImageData(0,0,1,1); out.push(f.id+' preview warm '+Math.round(performance.now()-t));
      vistaNitida=true; t=performance.now(); try{render(); ctx.getImageData(0,0,1,1);}finally{vistaNitida=false;} out.push(f.id+' sharp '+Math.round(performance.now()-t)+' '+PW+'x'+PH);
    }
    return out; })()`);
};
