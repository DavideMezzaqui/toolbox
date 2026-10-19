const {setup}=require('./pre.cjs');
module.exports = async ({ev,log,delay,capture,reload})=>{
await setup(ev);const R={};
const T=async(name,expr)=>{try{R[name]=await ev(`(async()=>{${expr}})()`);}catch(e){R[name]='EXC '+e.message;}};
await T('fuzz',`SHOTS=[];imgShot=null;const fs=[];for(let i=0;i<12;i++)fs.push(await mk('f'+i+'.png',64+i,48,'image/png',i*25,i));
await add(fs);state.active='unity_cover';state.layouts.unity_cover.shot.panels=3;
// make a variant too
const bad=[];let seed=12345;const rnd=n=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed%n;};
const check=(tag)=>{
  const cards=document.querySelectorAll('#imgs .card').length;
  if(cards!==SHOTS.length)bad.push(tag+': cards '+cards+' vs '+SHOTS.length);
  const set=new Set(SHOTS.map(s=>s.img));
  if(imgShot&&!set.has(imgShot))bad.push(tag+': imgShot not in SHOTS');
  if(!imgShot&&SHOTS.length)bad.push(tag+': imgShot null with shots');
  const chk=layouts=>Object.keys(layouts).forEach(id=>{const S=layouts[id].shot;(S.src||[]).forEach((v,i)=>{if(v>=SHOTS.length)bad.push(tag+': '+id+' src['+i+']='+v+' >= '+SHOTS.length);});});
  chk(state.layouts);(state.variants||[]).forEach(v=>chk(v.layouts));
  // panels draw
  const S=state.layouts[state.active].shot;for(let p=0;p<3;p++){const im=shotByIndex(panelSrc(S,p));if(im&&!set.has(im))bad.push(tag+': panel '+p+' shows removed image');}
};
let log=[];
for(let it=0;it<400;it++){
  const op=rnd(9);log.push(op);
  try{
  if(op===0&&SHOTS.length)togliImmagine(rnd(SHOTS.length));
  else if(op===1&&SHOTS.length>1)spostaImmagine(rnd(SHOTS.length),rnd(SHOTS.length+1));
  else if(op===2&&SHOTS.length)usaImmagine(rnd(SHOTS.length),rnd(2)===0);
  else if(op===3){const f=await mk('n'+it+'.png',40,40,'image/png',rnd(360),it);await add([f]);}
  else if(op===4)undo();
  else if(op===5)redo();
  else if(op===6){state.layouts.unity_cover.shot.panels=1+rnd(5);buildControls();render();}
  else if(op===7&&rnd(6)===0)runAction('shotsClear');
  else if(op===8){state.active=FORMATS[rnd(FORMATS.length)].id;buildControls();render();}
  }catch(e){bad.push('EXC op'+op+' '+e.message);}
  check('it'+it+' op'+op);
  if(bad.length>8)break;
}
return {bad,final:SHOTS.length,undo:undoStack.length};`);
log(JSON.stringify(R,null,1));
return R;};
