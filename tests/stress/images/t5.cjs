const {setup}=require('./pre.cjs');
module.exports = async ({ev,log})=>{
await setup(ev);const R={};
const T=async(name,expr)=>{try{R[name]=await ev(`(async()=>{${expr}})()`);}catch(e){R[name]='EXC '+e.message;}};
await T('k8',`SHOTS=[];imgShot=null;const fs=[];for(let i=0;i<8;i++)fs.push(await mk('k'+i+'.png',7680,4320,'image/png',i*30,i));
const t=performance.now();const r=await add(fs);const a=Math.round(performance.now()-t);const t2=performance.now();render();return {r,addMs:a,renderMs:Math.round(performance.now()-t2),urls:urlLog};`);
await T('logo',`const bad=new File(['zz'],'l.png',{type:'image/png'});const zero=new File([],'z.png',{type:'image/png'});
const before=imgLogo;let ok=await mk('logo.png',200,100,'image/png',50,9);
caricaLogoFile(bad);caricaLogoFile(zero);await wait(500);const same=imgLogo===before;
caricaLogoFile(ok);await wait(500);const changed=imgLogo!==before;
const sv=new File(['<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20"/></svg>'],'l.svg',{type:'image/svg+xml'});
caricaLogoFile(sv);await wait(500);
return {same,changed,toast:document.getElementById('toast').textContent,logoW:imgLogo&&imgLogo.width};`);
log(JSON.stringify(R,null,1));return R;};
