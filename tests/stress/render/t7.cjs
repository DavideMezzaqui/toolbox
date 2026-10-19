const fs=require('fs'),path=require('path');
const {setup}=require('./common.cjs');
const txt=require('./txt.json');
module.exports=async({ev,log})=>{
  await setup(ev);
  const out=[];
  for(const field of ['title','category','brand','version','badges']){
    for(let ti=0;ti<txt.length;ti++){
      const r=await ev(`(()=>{ const res=[]; const T=${JSON.stringify(txt[ti])};
        const base=JSON.parse(JSON.stringify(state.pack));
        for(const f of FORMATS){ state.pack=Object.assign({},base); state.pack[${JSON.stringify(field)}]=T; const L=state.layouts[f.id];
          const cc=document.createElement('canvas'); cc.width=f.w>1000?Math.round(f.w/2):f.w; cc.height=f.w>1000?Math.round(f.h/2):f.h; const k=cc.width/f.w; const sh=Object.assign({},f,{w:cc.width,h:cc.height});
          let err=null; const t=performance.now(); let box=null,vbox=null;
          try{ renderTo(cc.getContext('2d'),sh,L,false); cc.getContext('2d').getImageData(0,0,1,1);
               const B=renderTo(cc.getContext("2d"),sh,L,false); box={}; for(const k of ["row","version","badges"]){ const b=B[k]; if(b) box[k]=[+(b.x/sh.w).toFixed(3),+((b.x+b.w)/sh.w).toFixed(3),+(b.y/sh.h).toFixed(3),+((b.y+b.h)/sh.h).toFixed(3)]; } }catch(e){ err=String(e&&e.stack||e).slice(0,200); }
          const dt=Math.round(performance.now()-t);
          res.push({f:f.id,err,dt,box});
        }
        state.pack=base; return res; })()`);
      for(const x of r){
        let over=null; if(x.box) for(const [k,b] of Object.entries(x.box)) if(b[0]<-0.001||b[1]>1.001||b[2]<-0.001||b[3]>1.001){ over=(over||{}); over[k]=b; }
        if(x.err||x.dt>200||over) out.push([field,ti,JSON.stringify(txt[ti]).slice(0,30),x.f,x.err,x.dt,over?x.box:null]);
      }
    }
    log(field,'done');
  }
  return out.map(o=>JSON.stringify(o));
};
