const {setup}=require('./common.cjs');
module.exports=async({ev})=>{
  await setup(ev);
  return ev(`(async()=>{ const out=[]; const snap=()=>{ const c=document.createElement('canvas'); c.width=cv.width;c.height=cv.height; const g=c.getContext('2d'); g.drawImage(cv,0,0); return g.getImageData(0,0,c.width,c.height); };
    const diff=(a,b)=>{ if(a.width!==b.width||a.height!==b.height) return 'size '+a.width+'x'+a.height+' vs '+b.width+'x'+b.height; let n=0,mx=0,first=null; for(let i=0;i<a.data.length;i+=4){ const d=Math.max(Math.abs(a.data[i]-b.data[i]),Math.abs(a.data[i+1]-b.data[i+1]),Math.abs(a.data[i+2]-b.data[i+2]),Math.abs(a.data[i+3]-b.data[i+3])); if(d){n++; mx=Math.max(mx,d); if(!first) first=[(i/4)%a.width,Math.floor(i/4/a.width)];} } return n+' px differ max '+mx+' first '+first; };
    const base=JSON.stringify(state.layouts);
    const feats={glow:L=>{L.accent.glow=0.8;}, logoOut:L=>{L.logo.outOn=true;L.logo.glow=0.5;}, shadow:L=>{L.row.shadowOn=true;}, edge:L=>{L.shot.edgeOn=true;L.shot.panels=3;}, layers:L=>{const l=layerDefaults('text','t'); l.boxOn=true; L.layers=[l, layerDefaults('grid','g')];}, blur:L=>{L.fx.blur=0.3;}, none:L=>{}};
    for(const [name,fn] of Object.entries(feats)){
      state.layouts=JSON.parse(base); for(const f of FORMATS) fn(state.layouts[f.id]);
      state.active='unity_cover'; render(); const A1=snap();
      state.active='unity_shot'; render(); state.active='unity_cover'; render(); out.push(name+' plain: '+diff(A1,snap()));
      state.active='unity_shot'; render(); await new Promise(r=>renderFormatToBlob(FORMATS.find(x=>x.id==='unity_shot'),r)); state.active='unity_cover'; render(); out.push(name+' with export between: '+diff(A1,snap()));
    }
    return out; })()`);
};
