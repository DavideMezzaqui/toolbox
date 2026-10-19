module.exports=async({ev})=>{
 await ev(`window.mk=async(n,h)=>{const c=document.createElement('canvas');c.width=200;c.height=100;const g=c.getContext('2d');g.fillStyle='hsl('+h+',60%,40%)';g.fillRect(0,0,200,100);return new File([await new Promise(r=>c.toBlob(r,'image/png'))],n,{type:'image/png',lastModified:h});};1`);
 await ev(`(async()=>{const fl=[await mk('A.png',10),await mk('B.png',200)];SHOTS=[];imgShot=null;await new Promise(r=>addShots(fl,r));
  state.pack.title='T 65e5 "q" '+String.fromCharCode(92)+String.fromCharCode(10);FORMATS.forEach(f=>{state.layouts[f.id].shot.panels=3;state.layouts[f.id].shot.src=[1,0,1,-1,-1,-1]});
  window.before=snapState();window.text=await testoProgetto();state.pack.title='qq';SHOTS=[];caricaPresetFile(new File([text],'p.json'));await new Promise(r=>setTimeout(r,1500));1})()`);
 console.log(await ev(`(()=>{const a=JSON.parse(before),b=JSON.parse(snapState());const d=[];const w=(x,y,p)=>{if(d.length>15)return;if(x&&y&&typeof x==='object'&&typeof y==='object'){new Set([...Object.keys(x),...Object.keys(y)]).forEach(k=>w(x[k],y[k],p+'.'+k))}else if(JSON.stringify(x)!==JSON.stringify(y))d.push(p+': '+JSON.stringify(x)+' -> '+JSON.stringify(y))};w(a,b,'');return d})()`));
 return 1};
