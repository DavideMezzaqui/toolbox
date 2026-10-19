const {setup}=require('./common.cjs');
module.exports=async({ev})=>{
  await setup(ev);
  return ev(`(()=>{ const res=[]; const base=JSON.parse(JSON.stringify(state.pack));
   const cases=[['badges','URP, HDRP, Built-in RP'],['badges','URP, HDRP, Built-in, Unity 2022, Unity 6000'],['version','v1.0.0-beta.12 (2026-10-13)'],['version','Version 12.4.1 Release Candidate'],['brand','DAVFX Studios International'],['title','Realistic Impacts Pack Ultimate Edition Volume 2 With Extras']];
   for(const [k,v] of cases){ for(const f of FORMATS){ state.pack=Object.assign({},base,{[k]:v}); const L=state.layouts[f.id];
     const cc=document.createElement('canvas'); cc.width=f.w; cc.height=f.h; const B=renderTo(cc.getContext('2d'),f,L,false);
     const b=B[k==='title'||k==='brand'?'row':k]; if(!b) continue; const r=(b.x+b.w)/f.w, l=b.x/f.w;
     if(r>1.0||l<0) res.push(k+'='+v.slice(0,25)+' '+f.id+' l='+l.toFixed(3)+' r='+r.toFixed(3));
     let pf=null; try{ state.active=f.id; pf=preflight().filter(x=>x.tipo==='errore').map(x=>x.testo).slice(0,2);}catch(e){pf='ERR '+e;} if(pf&&pf.length&&(r>1||l<0)) res.push('   preflight: '+JSON.stringify(pf));
   } }
   state.pack=base; return res; })()`);
};
