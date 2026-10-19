module.exports=async({ev,reload,delay})=>{
 await ev(`window.mk=async(n,h)=>{const c=document.createElement('canvas');c.width=200;c.height=100;const g=c.getContext('2d');g.fillStyle='hsl('+h+',60%,40%)';g.fillRect(0,0,200,100);return new File([await new Promise(r=>c.toBlob(r,'image/png'))],n,{type:'image/png',lastModified:h});};1`);
 await ev(`(async()=>{const fl=[await mk('Sch \u00e9 \u65e5\u672c #1.png',10),await mk('B.png',200)];SHOTS=[];imgShot=null;await new Promise(r=>addShots(fl,r));
  state.pack.title='T \u65e5 "q" '+String.fromCharCode(92)+String.fromCharCode(10);FORMATS.forEach(f=>{state.layouts[f.id].shot.panels=3;state.layouts[f.id].shot.src=[1,0,1,-1,-1,-1]});
  state.variants=[{name:'v1',layouts:{}}];window.before=snapState();window.text=await testoProgetto();return 1})()`);
 console.log('rt',JSON.stringify(await ev(`(async()=>{SHOTS=[];state.pack.title='zz';caricaPresetFile(new File([text],'p.json'));await new Promise(r=>setTimeout(r,2500));return {same:snapState()===before,names:SHOTS.map(x=>x.name),title:state.pack.title}})()`)));
 // reload-in-debounce: change then reload within 100ms
 await ev(`state.pack.title='DEBOUNCE';autoSave();1`);
 await reload();await delay(1500);
 console.log('afterReload',JSON.stringify(await ev(`({t:state.pack.title,n:SHOTS.length,names:SHOTS.map(x=>x.name)})`)));
 // remove image then immediately reload (db debounce 400ms)
 await ev(`SHOTS.pop();imgShot=SHOTS[0]&&SHOTS[0].img;dbSalva();1`);
 await reload();await delay(1500);
 console.log('afterRemoveReload',JSON.stringify(await ev(`({n:SHOTS.length})`)));
 return 1};
