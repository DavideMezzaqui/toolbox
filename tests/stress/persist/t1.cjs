const {soft}={soft:()=>null};
module.exports=async({ev,evaluate,delay,reload})=>{
  const rl=reload;const out=[];
  const J=(o)=>`JSON.stringify(${o})`;
  const sn=(o)=>`JSON.stringify({v:1,at:1,snap:JSON.stringify(${o})})`;
  const variants={
    truncated:`'{"v":"1","at":1,"snap":"{\\\\"pack\\\\":{'`,
    notjson:`'garbage<<'`,
    nullObj:`'null'`,
    noSnap:J(`{v:1,at:1}`),
    snapEmpty:J(`{v:1,at:1,snap:'{}'}`),
    snapNoPack:sn(`{layouts:{}}`),
    snapNull:J(`{v:1,at:1,snap:'null'}`),
    layoutNull:sn(`{pack:{title:'X'},layouts:{unity_cover:null}}`),
    layoutString:sn(`{pack:{title:'X'},layouts:{unity_cover:"abc"}}`),
    layoutsArray:sn(`{pack:{title:'X'},layouts:[1,2]}`),
    packOnly:sn(`{pack:{title:'OnlyPack'}}`),
    badActive:J(`{v:1,at:1,active:'zzz',colori:'x',snap:JSON.stringify({pack:{title:'B'},layouts:{}})}`),
    layersBad:sn(`{pack:{title:'L'},layouts:{unity_cover:{layers:[null,5,"x",{}]}}}`),
    shotBad:sn(`{pack:{title:'S'},layouts:{unity_cover:{shot:{panels:"x",src:"y",px:5}}}}`),
    variantsBad:sn(`{pack:{title:'V'},variants:[null,1]}`),
    packNull:sn(`{pack:null,layouts:{}}`),
  };
  console.log("start");for(const [k,expr] of Object.entries(variants)){console.log("v",k);
    await ev(`autoArmed=false; localStorage.setItem(AUTOKEY, ${expr}); 1`);
    const ok=await rl();
    if(!ok){const m=`${k}: BOOT NEVER ARMED`;out.push(m);console.log(m);await ev('localStorage.removeItem(AUTOKEY);1').catch(()=>{});await rl();continue;}
    await delay(1200);
    const r=await ev(`(()=>{let ok=true,err='';try{render();buildControls();FORMATS.forEach(f=>{state.active=f.id;render();});}catch(e){ok=false;err=String(e.stack||e).slice(0,200);}
      return {ok,err,pack:state.pack&&state.pack.title,lays:Object.keys(state.layouts).length,active:state.active,errs:qaErrors.slice(0,3),
        stored:(localStorage.getItem(AUTOKEY)||'').slice(0,50), rot:ripristinoRotto}})()`);
    const m=k+': '+JSON.stringify(r);out.push(m);console.log(m);
  }
  return out.length;
};
