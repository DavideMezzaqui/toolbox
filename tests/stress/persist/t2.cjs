// malformed project open with existing work: must not wipe/half-apply
module.exports=async({ev,delay})=>{
  const mkimgs=`(async()=>{const mk=async(n,h)=>{const c=document.createElement('canvas');c.width=320;c.height=180;const g=c.getContext('2d');g.fillStyle='hsl('+h+',60%,40%)';g.fillRect(0,0,320,180);return new File([await new Promise(r=>c.toBlob(r,'image/png'))],n+'.png',{type:'image/png',lastModified:h});};
    SHOTS=[];imgShot=null;const fl=[await mk('A',10),await mk('B',100)];await new Promise(r=>addShots(fl,r));state.pack.title='MyWork';render();return SHOTS.length})()`;
  const png=await ev(`(async()=>{const c=document.createElement('canvas');c.width=8;c.height=8;const b=await new Promise(r=>c.toBlob(r,'image/png'));return await blobInBase64(b)})()`);
  const P=(o)=>JSON.stringify(o);
  const variants={
    layoutNull:{pack:{title:'NEW'},layouts:{unity_cover:null},images:[{name:'z.png',type:'image/png',data:png}]},
    layoutStr:{pack:{title:'NEW'},layouts:{unity_cover:"x"},images:[{name:'z.png',type:'image/png',data:png}]},
    layoutsStr:{pack:{title:'NEW'},layouts:"abc",images:[{name:'z.png',type:'image/png',data:png}]},
    packStr:{pack:"abc",images:[{name:'z.png',type:'image/png',data:png}]},
    variantsBad:{pack:{title:'NEW'},variants:[null,3],images:[]},
    imagesBroken:{pack:{title:'NEW'},images:[{name:'z.png',type:'image/png',data:'AAAA'},null,{data:5}]},
    imagesNotArr:{pack:{title:'NEW'},images:{a:1}},
    onlyActiveBad:{pack:{title:'NEW'},active:5},
    arrayRoot:[1,2],
    num:5, nullroot:null,
    wrongApp:{app:'other',layouts:{}},
    emptyObj:{},
  };
  const out=[];console.log("go");
  for(const [k,v] of Object.entries(variants)){
    console.log("mk",k);await ev(mkimgs);console.log("mkd");
    const before=await ev(`({n:SHOTS.length,t:state.pack.title,u:undoStack.length})`);
    const text=P(v);
    const r=await ev(`(async()=>{window.qaErrors.length=0;const msgs=[];const ot=toast;
      caricaPresetFile(new File([${JSON.stringify(text)}],'p.json'));await new Promise(r=>setTimeout(r,1200));
      let ok=true,err='';try{render();buildControls();FORMATS.forEach(f=>{state.active=f.id;render();});}catch(e){ok=false;err=String(e).slice(0,150);}
      return {n:SHOTS.length,t:state.pack&&state.pack.title,u:undoStack.length,ok,err,errs:qaErrors.slice(0,2),toast:(document.getElementById('toast')||{}).textContent}})()`);
    out.push(k+': '+JSON.stringify(before)+' -> '+JSON.stringify(r));console.log(k,JSON.stringify(before),JSON.stringify(r));
  }
  return 1;
};
