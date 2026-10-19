const fs=require('fs'),path=require('path');
const {setup}=require('./common.cjs');
const lib=fs.readFileSync(path.join(__dirname,'fuzzlib.js'),'utf8');
module.exports=async({ev,log})=>{
  await setup(ev); await ev(lib+';1');
  await ev(`(()=>{ for(const f of FORMATS){ const L=state.layouts[f.id]; L.layers=[];
      SHAPE_KINDS.forEach(k=>{ const l=layerDefaults('shape',k); l.kind=k; l.on=true; l.x=0.3;l.y=0.3; L.layers.push(l); });
      ['text','grid'].forEach(t=>{ const l=layerDefaults(t,t); l.on=true; L.layers.push(l); });
      L.shot.panels=3; L.shot.edgeOn=true; L.row.sepOn=true; L.accent.segments=3; L.accent.glow=0.5; L.logo.outOn=true; L.band.on=true; L.badges.on=true; L.version.on=true; L.frame.on=true; L.grad.on=true;
      ['grad','band','accent','logo','row','version','badges','frame'].forEach(k=>{ L[k].shadowOn=true; }); }
    window.BASE=JSON.stringify({layouts:state.layouts}); return 1;})()`);
  const rows=await ev(`(()=>{ const R=[]; const L=state.layouts.unity_cover;
    PARTS.forEach(p=>(p.rows||[]).forEach(r=>{ if(r.type==='range'&&r.p) R.push({p:r.p,min:r.min,max:r.max}); }));
    shadowRows('x'); L.layers.forEach((l,i)=>{ layerRows(l).forEach(r=>{ if(r.type==='range'&&r.p){ R.push({p:r.p.replace(/^[^.]+\./,'layers.'+i+'.'),min:r.min,max:r.max}); } }); });
    return R;})()`);
  log('rows',rows.length, JSON.stringify(rows.filter(r=>/layers\.0\./.test(r.p)).slice(0,3)));
  const res={exc:{},nan:{},slow:[],leak:[]};
  const fmts=await ev('FORMATS.map(f=>f.id)');
  for(const fid of fmts){
    const chunk=40;
    for(let i=0;i<rows.length;i+=chunk){
      const r=await ev(`(()=>{ const out=[]; const f=FORMATS.find(x=>x.id==${JSON.stringify(fid)});
        const sz=outSize(f); const cc=document.createElement('canvas'); cc.width=f.w; cc.height=f.h; const c=cc.getContext('2d');
        for(const row of ${JSON.stringify(rows.slice(i,i+chunk))}){
          for(const which of ['min','max']){
            state.layouts=JSON.parse(BASE).layouts; const L=state.layouts[f.id]; const P=row.p.split('.'); let o=L; for(let k=0;k<P.length-1;k++) o=o[P[k]]; if(!o) continue;
            o[P[P.length-1]]=row[which];
            FZ.reset(); let err=null; const t=performance.now();
            try{ renderTo(c,f,L,false);}catch(e){err=String(e&&e.stack||e).slice(0,200);}
            const dt=performance.now()-t;
            const tr=c.getTransform(); const dirty=!(tr.a===1&&tr.b===0&&tr.c===0&&tr.d===1&&tr.e===0&&tr.f===0)||c.globalAlpha!==1;
            out.push([row.p+'='+row[which],err,FZ.bad.slice(0,2),Math.round(dt),dirty,FZ.ctr.save-FZ.ctr.restore]);
          }
        }
        return out;})()`);
      for(const [tag,err,bad,dt,dirty,sr] of r){
        if(err) (res.exc[err.slice(0,100)]??=[]).push(fid+' '+tag);
        if(bad.length) (res.nan[bad[0]]??=[]).push(fid+' '+tag);
        if(dt>200) res.slow.push([fid,tag,dt]);
        if(dirty||sr) res.leak.push([fid,tag,dirty,sr]);
      }
    }
    log(fid,'done');
  }
  fs.writeFileSync(path.join(__dirname,'t4-out.json'),JSON.stringify(res,null,1));
  return {exc:Object.fromEntries(Object.entries(res.exc).map(([k,v])=>[k,v.length+' '+v.slice(0,4).join(' ; ')])),nan:Object.fromEntries(Object.entries(res.nan).map(([k,v])=>[k,v.length+' '+v.slice(0,4).join(' ; ')])),slow:res.slow.slice(0,40),slowN:res.slow.length,leakN:res.leak.length,leak:res.leak.slice(0,5)};
};
