const fs=require('fs'),path=require('path');
const {setup}=require('./common.cjs');
const lib=fs.readFileSync(path.join(__dirname,'fuzzlib.js'),'utf8');
module.exports=async({ev,log})=>{
  await setup(ev);
  await ev(lib+';1');
  await ev(`(()=>{ for(const f of FORMATS){ const L=state.layouts[f.id]; L.layers=[];
      SHAPE_KINDS.forEach(k=>{ const l=layerDefaults('shape',k); l.kind=k; l.on=true; l.x=0.3;l.y=0.3; L.layers.push(l); });
      ['text','grid'].forEach(t=>{ const l=layerDefaults(t,t); l.on=true; L.layers.push(l); });
      L.layers.push(Object.assign(layerDefaults('text','tf'),{front:true})); }
    window.BASE=JSON.stringify({layouts:state.layouts,pack:state.pack,theme:state.theme,exp:state.export,naming:state.naming}); return 1;})()`);
  const paths=await ev(`(()=>{const o=[];const walk=(v,p)=>{ if(v&&typeof v==='object'){ for(const k of Object.keys(v)) walk(v[k],p.concat(k)); } else o.push({p:p,t:typeof v}); }; walk(state.layouts.unity_cover,[]);
     // layers: take first of each type
     const L=state.layouts.unity_cover.layers; return o.filter(x=>x.p[0]!=='layers');})()`);
  const only=process.env.ONLY;
  const results={exc:{},nan:{},slow:{},leak:{}};
  const fmts=await ev('FORMATS.map(f=>f.id)');
  const layerPaths=await ev(`(()=>{const o=[];const L=state.layouts.unity_cover.layers;
    const seen={}; L.forEach((l,i)=>{ const key=l.type+(l.type==='shape'?':'+l.kind:''); const walk=(v,p)=>{ if(v&&typeof v==='object'){ for(const k of Object.keys(v)) walk(v[k],p.concat(k)); } else o.push({p:['layers',i].concat(p),t:typeof v}); }; walk(l,[]); }); return o;})()`);
  const all=paths.concat(layerPaths);
  log('leaves',all.length);
  const vals={number:['0','-1','-1e6','1e6','1e300','NaN','Infinity','1e-12','null','"abc"','-0.5','100','0.5'],
    string:require('./strs.json').map(x=>({s:x})).concat(['null','12']),
    boolean:['!cur','null']};
  const t0=Date.now();
  for(const fid of (only?only.split(','):fmts)){
    for(const leaf of all){
      const key=leaf.p.join('.');
      if(key==='misure'||key==='on') continue; fs.writeFileSync(path.join(__dirname,'t3-last.txt'),fid+' '+key);
      const r=await ev(`(()=>{
        const out=[]; const f=FORMATS.find(x=>x.id==${JSON.stringify(fid)});
        const B=JSON.parse(BASE);
        for(const vs of ${JSON.stringify(vals[leaf.t]||vals.string)}){
          state.layouts=JSON.parse(BASE).layouts; state.pack=JSON.parse(BASE).pack;
          let o=state.layouts[f.id]; const P=${JSON.stringify(leaf.p)}; for(let i=0;i<P.length-1;i++) o=o[P[i]];
          const cur=o[P[P.length-1]]; let v; try{ v=(typeof vs==='object')?vs.s:eval(vs);}catch(e){continue;} o[P[P.length-1]]=v; state.layouts[f.id]=mergeLayout(f, JSON.parse(JSON.stringify(state.layouts[f.id])));
          FZ.reset(); const cc=document.createElement('canvas'); cc.width=f.w>1000?Math.round(f.w/4):f.w; cc.height=f.w>1000?Math.round(f.h/4):f.h;
          const shim=Object.assign({},f,{w:cc.width,h:cc.height}); const c=cc.getContext('2d');
          let err=null; const t=performance.now();
          try{ renderTo(c,shim,state.layouts[f.id],false); }catch(e){ err=String(e&&e.stack||e).slice(0,300); }
          const dt=performance.now()-t;
          const tr=c.getTransform(); const dirty = !(tr.a===1&&tr.b===0&&tr.c===0&&tr.d===1&&tr.e===0&&tr.f===0)||c.globalAlpha!==1||c.globalCompositeOperation!=='source-over';
          out.push({v:(typeof vs==='object'?JSON.stringify(vs.s):String(vs)).slice(0,30),err,bad:FZ.bad.slice(0,3),dt:Math.round(dt),dirty,sr:FZ.ctr.save-FZ.ctr.restore});
        }
        return out;})()`);
      for(const x of r){
        const tag=fid+' '+key+'='+x.v;
        if(x.err) (results.exc[x.err.slice(0,120)]??=[]).push(tag);
        if(x.bad.length) (results.nan[x.bad[0]+' <- '+key]??=[]).push(fid+'='+x.v);
        if(x.dt>200) results.slow[tag]=x.dt;
        if(x.dirty||x.sr!==0) results.leak[tag]=[x.dirty,x.sr];
      }
    }
    log(fid,'done',Math.round((Date.now()-t0)/1000)+'s');
  }
  const sum=o=>Object.fromEntries(Object.entries(o).map(([k,v])=>[k,Array.isArray(v)?(v.length+' e.g. '+v.slice(0,3).join(' ; ')):v]));
  fs.writeFileSync(path.join(__dirname,'t3-out.json'),JSON.stringify(results,null,1));
  return {exc:sum(results.exc),nanKeys:Object.keys(results.nan).length,slow:results.slow,leak:Object.keys(results.leak).length};
};
