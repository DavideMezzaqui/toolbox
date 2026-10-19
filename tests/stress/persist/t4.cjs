module.exports=async({ev,reload,delay})=>{
 const idem=await ev(`(()=>{const bad=[];let seed=7;const rnd=()=>(seed=(seed*16807)%2147483647)/2147483647;
  const fuzz=(o,d)=>{if(Array.isArray(o)){o.forEach((v,i)=>{o[i]=fuzz(v,d+1)});return o}if(o&&typeof o==='object'){for(const k of Object.keys(o)){if(k==='layers')continue;o[k]=fuzz(o[k],d+1)}return o}
   if(typeof o==='number'&&rnd()<.3)return rnd()<.5?o:+(rnd()).toFixed(3);if(typeof o==='boolean'&&rnd()<.3)return !o;return o};
  for(let n=0;n<150;n++)FORMATS.forEach(f=>{let L=JSON.parse(JSON.stringify(defLayout(f)));
   if(rnd()<.5){const old=MISURE_PRIMA[f.id];if(old)Object.keys(old).forEach(p=>{const[k,q]=p.split('.');if(L[k])L[k][q]=old[p]});}
   fuzz(L,0);if(rnd()<.3)delete L.misure; if(rnd()<.3)delete L.shot.px;
   const a=mergeLayout(f,JSON.parse(JSON.stringify(L)));const b=mergeLayout(f,JSON.parse(JSON.stringify(a)));
   if(JSON.stringify(a)!==JSON.stringify(b))bad.push(f.id);});
  // migraSalvataggio idempotence
  const s0={theme:state.theme,layouts:JSON.parse(JSON.stringify(state.layouts))};const s1=JSON.parse(JSON.stringify(migraSalvataggio(JSON.parse(JSON.stringify(s0)))));const s2=migraSalvataggio(JSON.parse(JSON.stringify(s1)));
  if(JSON.stringify(s1)!==JSON.stringify(s2))bad.push('migraSalvataggio');
  return bad.slice(0,10)})()`);
 console.log('idempotence bad:',JSON.stringify(idem));
 // round trip of project incl. unicode and variants and logo
 const rt=await ev(`(async()=>{const mk=async(n,h)=>{const c=document.createElement('canvas');c.width=200;c.height=100;const g=c.getContext('2d');g.fillStyle='hsl('+h+',60%,40%)';g.fillRect(0,0,200,100);return new File([await new Promise(r=>c.toBlob(r,'image/png'))],n,{type:'image/png',lastModified:h});};
  const fl=[await mk('Schermata é 日本 #1.png',10),await mk('B.png',200)];SHOTS=[];imgShot=null;await new Promise(r=>addShots(fl,r));
  state.pack.title='Tïtle 日本 "q" \\ \n';FORMATS.forEach(f=>{state.layouts[f.id].shot.panels=3;state.layouts[f.id].shot.src=[1,0,1,-1,-1,-1]});
  const before=snapState();const text=await testoProgetto();
  SHOTS=[];state.pack.title='zz';
  await new Promise(r=>{caricaPresetFile(new File([text],'p.json'));setTimeout(r,2000)});
  return {same:snapState()===before,names:SHOTS.map(x=>x.name),title:state.pack.title}})()`);
 console.log('roundtrip',JSON.stringify(rt));
 if(!rt.same){const d=await ev(`(()=>{const a=JSON.parse(snapState());return 'x'})()`);}
 return 1};
