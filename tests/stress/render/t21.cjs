const {setup}=require('./common.cjs');
const txt=require('./txt.json');
module.exports=async({ev})=>{
  await setup(ev);
  return ev(`(async()=>{ const out=[]; const T=${JSON.stringify(txt)}; const root=await navigator.storage.getDirectory(); for await (const [n] of root.entries()) await root.removeEntry(n,{recursive:true}); cartellaExport=root;
    const pats=['{format}','{title}_{format}','{title}/{format}','..','{title}','','{nope}','{w}x{h}-{date}-{index}','CON','{title}.{format}.'];
    const f=FORMATS[0]; let n=0; const toasts=[]; const tt=window.toast; window.toast=m=>{toasts.push(String(m)); return tt(m);};
    for(const p of pats) for(const t of T){ state.naming.pattern=p; state.pack.title=t; state.pack.brand=t; state.naming.folder='{title}';
       const fn=fileNameFor(f,state.pack,1), fo=folderFor(f,state.pack,1);
       if(/[^A-Za-z0-9._-]/.test(fn.slice(0,-4)) || !fn.endsWith(".png") || fn.length>200 || (fo && (!fo.endsWith(String.fromCharCode(47)) || /[^A-Za-z0-9._-]/.test(fo.slice(0,-1)))) || fo.length>200) out.push(['badname',p,JSON.stringify(t).slice(0,20),fn.slice(0,60),fo.slice(0,60)]);
       state.active=f.id; toasts.length=0; await document.getElementById('bExp').onclick(); if(toasts.some(x=>/failed/i.test(x))) out.push(['export failed',p,JSON.stringify(t).slice(0,20),toasts.join('|').slice(0,100)]); n++;
       for await (const [nm] of root.entries()) await root.removeEntry(nm);
    }
    return {n,out:out.slice(0,20),nOut:out.length}; })()`);
};
