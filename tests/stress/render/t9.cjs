const {setup}=require('./common.cjs');
module.exports=async({ev,log,delay})=>{
  await setup(ev);
  await ev(`window.__zipHelper = async (blob)=>{ const u=new Uint8Array(await blob.arrayBuffer()); const dv=new DataView(u.buffer); let e=u.length-22; while(e>=0&&dv.getUint32(e,true)!==0x06054b50) e--; const n=dv.getUint16(e+10,true); let p=dv.getUint32(e+16,true); const out=[];
     for(let i=0;i<n;i++){ const sz=dv.getUint32(p+24,true), nl=dv.getUint16(p+28,true), off=dv.getUint32(p+42,true); const name=new TextDecoder().decode(u.slice(p+46,p+46+nl)); const l2=dv.getUint16(off+26,true); const data=u.slice(off+30+l2,off+30+l2+sz);
       let w=0,h=0; try{ const bm=await createImageBitmap(new Blob([data])); w=bm.width;h=bm.height; bm.close(); }catch(x){}
       out.push([name,sz,w,h]); p+=46+nl; } return out; }; 1`);
  const res={single:[],zip:[]};
  // fresh OPFS dir
  await ev(`(async()=>{ const root=await navigator.storage.getDirectory(); for await (const [n] of root.entries()) await root.removeEntry(n,{recursive:true}); cartellaExport=root; return typeof window.showDirectoryPicker; })()`).then(x=>log('picker',x));
  for(const fmt of ['PNG (lossless)','JPEG','WebP']){
   for(const k of [0.25,0.5,0.75,1]){
    const r=await ev(`(async()=>{ state.export.format=${JSON.stringify(fmt)}; state.export.scale=${k}; const out={single:[],zip:null,toasts:[]};
      const root=await navigator.storage.getDirectory(); for await (const [n] of root.entries()) await root.removeEntry(n,{recursive:true});
      for(const f of FORMATS){ state.active=f.id; await document.getElementById('bExp').onclick(); }
      for await (const [n,h] of root.entries()){ const fl=await h.getFile(); let w=0,hh=0; try{const bm=await createImageBitmap(fl); w=bm.width;hh=bm.height;}catch(e){} out.single.push([n,fl.size,w,hh,fl.type]); }
      for await (const [n] of root.entries()) await root.removeEntry(n,{recursive:true});
      await document.getElementById('bZip').onclick();
      for await (const [n,h] of root.entries()){ const fl=await h.getFile(); out.zip=[n,fl.size,await __zipHelper(fl)]; }
      out.expect=FORMATS.map(f=>{const o=outSize(f);return f.id+':'+o.w+'x'+o.h;});
      return out; })()`);
    res.single.push({fmt,k,r});
   }
  }
  // summarize mismatches
  const bad=[];
  for(const {fmt,k,r} of res.single){
    const exp=r.expect.map(s=>s.split(':')[1]);
    const got=r.single.map(x=>x[2]+'x'+x[3]);
    if(r.single.length!==8) bad.push([fmt,k,'single files',r.single.length]);
    if(JSON.stringify(exp.slice().sort())!==JSON.stringify(got.slice().sort())) bad.push([fmt,k,'single dims',got.join(',')]);
    if(!r.zip) bad.push([fmt,k,'no zip']); else { const g=r.zip[2].map(x=>x[2]+'x'+x[3]); if(JSON.stringify(exp.slice().sort())!==JSON.stringify(g.slice().sort())) bad.push([fmt,k,'zip dims',g.join(','),r.zip[2].map(x=>x[0]).join(',')]); }
  }
  return {bad,sample:res.single[0].r.zip, singles:res.single[0].r.single.map(x=>x[0]+' '+x[4])};
};
