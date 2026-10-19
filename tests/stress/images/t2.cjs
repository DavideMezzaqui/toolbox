const {setup}=require('./pre.cjs');
module.exports = async ({ev,log,delay,capture})=>{
await setup(ev);const R={};
const T=async(name,expr)=>{try{R[name]=await ev(`(async()=>{${expr}})()`);}catch(e){R[name]='EXC '+e.message;}};
await T('dupBatch',`SHOTS=[];imgShot=null;const a=await mk('a.png',50,50,'image/png',10,5);
const r=await add([a,a,a]);return {r,n:SHOTS.length};`);
await T('dupTwice',`const a=await mk('a.png',50,50,'image/png',10,5);const r=await add([a]);return {r,n:SHOTS.length};`);
await T('sameNameDiff',`SHOTS=[];imgShot=null;const a=await mk('x.png',50,50,'image/png',10,5);const b=await mk('x.png',60,60,'image/png',200,5);
const r=await add([a,b]);return {r,n:SHOTS.length,sizes:SHOTS.map(s=>s.img.width)};`);
await T('names',`SHOTS=[];imgShot=null;const long='n'.repeat(300)+'.png';
const fs=[await mk('日本語 ñandú 😀.png',20,20,'image/png',1),await mk('with   spaces  .png',20,20,'image/png',2),await mk(long,20,20,'image/png',3),await mk('a<b>:c|d?.png',20,20,'image/png',4)];
const r=await add(fs);render();return {r,n:SHOTS.length,cards:document.querySelectorAll('#imgs .card').length};`);
// drop events
await T('drop',`SHOTS=[];imgShot=null;const fs=[await mk('d1.png',30,30,'image/png',1),await mk('d2.jpg',30,30,'image/jpeg',2),new File(['x'],'bad.png',{type:'image/png'}),new File(['x'],'t.txt',{type:'text/plain'})];
dropFiles(fs);await wait(600);return {n:SHOTS.length,toast:document.getElementById('toast').textContent,drop:document.getElementById('dropzone').classList.contains('on')};`);
await T('dropOnlyTxt',`dropFiles([new File(['x'],'t.txt',{type:'text/plain'})]);await wait(100);return document.getElementById('toast').textContent;`);
// 100 images
await T('many',`SHOTS=[];imgShot=null;const fs=[];for(let i=0;i<120;i++)fs.push(await mk('m'+i+'.png',1920,1080,'image/png',i*3,i));
const t0=performance.now();const r=await add(fs);const t1=performance.now();
const tr=performance.now();for(let i=0;i<5;i++)render();const rms=(performance.now()-tr)/5;
const tb=performance.now();buildControls();const bms=performance.now()-tb;
return {r,n:SHOTS.length,addMs:Math.round(t1-t0),renderMs:Math.round(rms),buildMs:Math.round(bms),cards:document.querySelectorAll('#imgs .card').length,mem:performance.memory&&Math.round(performance.memory.usedJSHeapSize/1e6)};`);
await T('urls',`return urlLog;`);
log(JSON.stringify(R,null,1));
return R;};
