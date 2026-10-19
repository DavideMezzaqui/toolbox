const {setup}=require('./common.cjs');
module.exports=async({ev,reload,delay})=>{
  const out=[];
  for(const off of [null,'band','logo','row','version','badges','grad','shot','accent','frame']){
    await reload(); await delay(300); await setup(ev);
    out.push(await ev(`(async()=>{ const f=FORMATS[0]; const big=FORMATS[1];
    const draw=(fm)=>{ const c=document.createElement('canvas'); c.width=fm.w;c.height=fm.h; renderTo(c.getContext('2d'),fm,state.layouts[fm.id],false); return c.getContext('2d').getImageData(0,0,fm.w,fm.h); };
    const nd=(a,b)=>{ let n=0; for(let i=0;i<a.data.length;i+=4){ if(a.data[i]!==b.data[i]||a.data[i+1]!==b.data[i+1]||a.data[i+2]!==b.data[i+2]) n++; } return n; };
      for(const fm of FORMATS){ state.layouts[fm.id].accent.glow=0.8; if(${JSON.stringify(off)}) state.layouts[fm.id][${JSON.stringify(off)}].on=false; }
      const A=draw(f); draw(big); const B=draw(f); draw(big); const C=draw(f); return ${JSON.stringify(off)}+' A-B '+nd(A,B)+' B-C '+nd(B,C); })()`));
  }
  return out;
};
