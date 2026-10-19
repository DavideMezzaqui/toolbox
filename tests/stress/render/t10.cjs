const {setup}=require('./common.cjs');
module.exports=async({ev})=>{
  await setup(ev);
  return ev(`(async()=>{ const out=[]; const root=await navigator.storage.getDirectory(); for await (const [n] of root.entries()) await root.removeEntry(n,{recursive:true}); cartellaExport=root;
    const f=FORMATS.find(x=>x.id==='unity_cover'); state.active=f.id;
    const toasts=[]; const tt=window.toast; window.toast=(m)=>{toasts.push(String(m).slice(0,120)); return tt&&tt(m);};
    for(const s of [0,-1,null,'abc','0.5',0.001,3,8,100,1e9,Infinity,NaN]){
      state.export.scale=s; toasts.length=0; const t=performance.now(); let e=null;
      try{ await document.getElementById('bExp').onclick(); }catch(x){e=String(x);}
      const files=[]; for await (const [n,h] of root.entries()){ const fl=await h.getFile(); let w=0,hh=0; try{const bm=await createImageBitmap(fl); w=bm.width;hh=bm.height;}catch(x){} files.push(n+' '+fl.size+' '+w+'x'+hh); await root.removeEntry(n); }
      out.push([String(s),Math.round(performance.now()-t),e,toasts.slice(),files, JSON.stringify(outSize(f))]);
    }
    state.export.scale=1;
    for(const q of [0,-1,5,NaN,null,'x']){ state.export.format='JPEG'; state.export.quality=q; toasts.length=0; await document.getElementById('bExp').onclick(); const files=[]; for await (const [n,h] of root.entries()){ const fl=await h.getFile(); files.push(n+' '+fl.size+' '+fl.type); await root.removeEntry(n);} out.push(['q='+q,toasts.slice(),files]); }
    state.export.format='PNG (lossless)'; state.export.quality=0.92;
    // 1080p variant
    const sh=FORMATS.find(x=>x.id==='unity_shot'); state.layouts.unity_shot.res='1080p'; state.active='unity_shot'; toasts.length=0; await document.getElementById('bExp').onclick();
    for await (const [n,h] of root.entries()){ const fl=await h.getFile(); const bm=await createImageBitmap(fl); out.push(['1080p',n,bm.width,bm.height]); await root.removeEntry(n);}
    state.layouts.unity_shot.res='bogus'; out.push(['bogus res',JSON.stringify(outSize(sh))]);
    state.layouts.unity_shot.res=undefined; out.push(['undef res',JSON.stringify(outSize(sh))]);
    return out; })()`);
};
