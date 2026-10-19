const {setup}=require('./common.cjs');
module.exports=async({ev})=>{
  await setup(ev);
  return ev(`(()=>{ const NLC=String.fromCharCode(10); const out=[]; const f=FORMATS[1]; const L=state.layouts[f.id]; const base=JSON.stringify(state.pack);
    const cc=document.createElement('canvas'); cc.width=f.w; cc.height=f.h; const c=cc.getContext('2d');
    const T=(name,fn)=>{ fn(); const t=performance.now(); let e=null; try{renderTo(c,f,L,false); c.getImageData(0,0,1,1);}catch(x){e=String(x).slice(0,80);} out.push(name+' '+Math.round(performance.now()-t)+'ms '+(e||'')); state.pack=JSON.parse(base); };
    T('title 2000 lines',()=>{state.pack.title=("Line"+NLC).repeat(2000);});
    T('title 200k chars',()=>{state.pack.title='W'.repeat(200000);});
    T('badges 3000 items',()=>{state.pack.badges=Array.from({length:3000},(_,i)=>'B'+i).join(', ');});
    T('version 500k',()=>{state.pack.version='9'.repeat(500000);});
    const g=layerDefaults('grid','g'); g.on=true; L.layers=[g];
    T('grid 5000 cells',()=>{ g.text=Array.from({length:5000},(_,i)=>'Cell '+i).join(NLC); });
    T('grid 50000 cells',()=>{ g.text=Array.from({length:50000},(_,i)=>'Cell '+i).join(NLC); });
    const t=layerDefaults('text','t'); t.on=true; L.layers=[t];
    T('text layer 100k lines',()=>{ t.text=("x"+NLC).repeat(100000); });
    T('text layer 1M chars',()=>{ t.text='y'.repeat(1000000); });
    return out; })()`);
};
