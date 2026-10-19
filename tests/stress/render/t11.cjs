const {setup}=require('./common.cjs');
module.exports=async({ev})=>{
  await setup(ev);
  return ev(`(async()=>{ const out=[]; const shot=()=>{ const c=document.createElement('canvas'); c.width=cv.width;c.height=cv.height; c.getContext('2d').drawImage(cv,0,0); return c.toDataURL(); };
    const fx=['unity_cover','unity_shot','unity_card','unity_icon','unity_social','yt_thumb'];
    // enable heavy features
    for(const f of FORMATS){ const L=state.layouts[f.id]; L.shot.panels=3; L.fx.blur=0.3; L.fx.tintOn=true; L.fx.zoomBlur=0.3; L.fx.spinBlur=0.2; L.fx.vignette=0.5; L.accent.glow=0.8; L.logo.outOn=true; L.logo.glow=0.5; L.row.shadowOn=true; L.shot.edgeOn=true;
       const l=layerDefaults('text','t'); l.boxOn=true; L.layers=[l, layerDefaults('grid','g')]; }
    for(const a of fx) for(const b of fx){ if(a===b) continue;
      state.active=a; render(); const A1=shot();
      state.active=b; render(); const B1=shot();
      // exports in between at several scales
      for(const k of [0.5,1]){ state.export.scale=k; await new Promise(r=>renderFormatToBlob(FORMATS.find(x=>x.id===b),r)); } state.export.scale=1;
      state.active=b; compareMode=false; vistaNitida=true; try{render();}finally{vistaNitida=false;}
      state.active=a; render(); const A2=shot();
      if(A1!==A2) out.push('A-B-A differs '+a+' '+b);
      state.active=b; render(); if(shot()!==B1) out.push('B differs after '+a+' '+b);
    }
    // mutate and revert
    state.active='unity_cover'; render(); const R1=shot(); const L=state.layouts.unity_cover; const old=JSON.stringify(L);
    L.shot.sc[0]=2; L.fx.blur=0; L.accent.segments=5; render(); const R2=shot();
    state.layouts.unity_cover=JSON.parse(old); render(); const R3=shot();
    out.push('mutation visible: '+(R1!==R2)+' revert identical: '+(R1===R3));
    // image swap: change SHOTS image object
    return out; })()`);
};
