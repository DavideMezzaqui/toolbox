const {setup}=require('./pre.cjs');
module.exports = async ({ev,log,delay,capture,reload})=>{
await setup(ev);const R={};
const T=async(name,expr)=>{try{R[name]=await ev(`(async()=>{${expr}})()`);}catch(e){R[name]='EXC '+e.message;}};
// persistence after normal wait
await T('p1',`SHOTS=[];imgShot=null;const fs=[];for(let i=0;i<5;i++)fs.push(await mk('p'+i+'.png',100+i,50,'image/png',i*40,i));
await add(fs);spostaImmagine(4,0);usaImmagine(2,false);await wait(1500);return SHOTS.map(s=>s.name);`);
await reload();await setup(ev);
R.p1after=await ev(`(async()=>{await wait(2500);return {names:SHOTS.map(s=>s.name),cards:document.querySelectorAll('#imgs .card').length}})()`);
// add then reload immediately
await T('p2',`runAction('shotsClear');await wait(1000);const fs=[await mk('q0.png',90,50,'image/png',3,3),await mk('q1.png',91,50,'image/png',4,4)];await add(fs);usaImmagine(1,false);return SHOTS.length;`);
await ev(`1`);
await reload();await setup(ev);
R.p2after=await ev(`(async()=>{await wait(2500);const S=state.layouts[state.active].shot;return {names:SHOTS.map(s=>s.name),src:S.src,toast:document.getElementById('toast').textContent}})()`);
log(JSON.stringify(R,null,1));
return R;};
