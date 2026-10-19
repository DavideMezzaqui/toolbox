const {setup}=require('./common.cjs');
module.exports=async({ev})=>{
  await setup(ev);
  return ev(`(async()=>{ const out=[];
    for(const f of FORMATS){ state.layouts[f.id].accent.glow=0.8; }
    const f=FORMATS[0]; const draw=()=>{ const c=document.createElement('canvas'); c.width=f.w;c.height=f.h; renderTo(c.getContext('2d'),f,state.layouts[f.id],false); return c.getContext('2d').getImageData(0,0,f.w,f.h); };
    const A=draw(); const A2=draw();
    const big=FORMATS[1]; const cb=document.createElement('canvas'); cb.width=big.w;cb.height=big.h; renderTo(cb.getContext('2d'),big,state.layouts[big.id],false);
    const B=draw();
    const diff=(a,b)=>{ let n=0,mx=0,x0=1e9,x1=-1,y0=1e9,y1=-1; for(let i=0;i<a.data.length;i+=4){ const d=Math.max(Math.abs(a.data[i]-b.data[i]),Math.abs(a.data[i+1]-b.data[i+1]),Math.abs(a.data[i+2]-b.data[i+2])); if(d){n++;mx=Math.max(mx,d); const x=(i/4)%a.width,y=Math.floor(i/4/a.width); x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);} } return [n,mx,x0,x1,y0,y1]; };
    out.push('A vs A2 '+diff(A,A2)); out.push('A vs B '+diff(A,B));
    // direct test of scratch
    const t=(w,h)=>{ const g=scratch(9,w,h); g.filter='blur(5px)'; g.fillStyle='#fff'; g.fillRect(40,40,100,30); g.filter='none'; return g.getImageData(0,0,w,h).data.slice(); };
    const s1=t(300,150); t(1000,500); const s2=t(300,150); let nd=0; for(let i=0;i<s1.length;i++) if(s1[i]!==s2[i]) nd++; out.push('scratch resize diffs '+nd);
    return out; })()`);
};
