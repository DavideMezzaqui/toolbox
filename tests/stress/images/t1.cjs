module.exports = async ({ev,log,delay,capture})=>{
const R={};
await ev(`window.mk=async(name,w,h,type='image/png',hue=100,lm)=>{const c=document.createElement('canvas');c.width=w;c.height=h;const g=c.getContext('2d');g.fillStyle='hsl('+hue+',60%,40%)';g.fillRect(0,0,w,h);g.fillStyle='#fff';g.fillRect(0,0,Math.min(w,50),Math.min(h,50));
 const b=await new Promise(r=>c.toBlob(r,type,0.8));return new File([b],name,{type,lastModified:lm||hue});};
window.add=(files)=>new Promise(r=>{const t=performance.now();addShots(files,(n,rot,mot)=>r({n,rot,mot,ms:Math.round(performance.now()-t)}));});
window.dropFiles=(files,x,y)=>{const dt=new DataTransfer();files.forEach(f=>dt.items.add(f));const o={dataTransfer:dt,bubbles:true,cancelable:true,clientX:x||5,clientY:y||5};window.dispatchEvent(new DragEvent('dragenter',o));window.dispatchEvent(new DragEvent('dragover',o));window.dispatchEvent(new DragEvent('drop',o));};
window.wait=ms=>new Promise(r=>setTimeout(r,ms));1`);
const T=async(name,expr)=>{try{R[name]=await ev(`(async()=>{${expr}})()`);}catch(e){R[name]='EXC '+e.message;}};
// 1 bad files
await T('bad',`SHOTS=[];imgShot=null;
const png=await mk('ok.png',64,64);
const buf=new Uint8Array(await png.arrayBuffer());
const corrupt=new File([buf.slice(0,40)],'trunc.png',{type:'image/png'});
const mid=buf.slice();for(let i=60;i<mid.length-20;i++)mid[i]^=0x5a;
const corrupt2=new File([mid],'mid.png',{type:'image/png'});
const zero=new File([],'zero.png',{type:'image/png'});
const txt=new File(['hello'],'a.png',{type:'image/png'});
const svg=new File(['<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="red"/></svg>'],'s.svg',{type:'image/svg+xml'});
const svgNoSize=new File(['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="red"/></svg>'],'s2.svg',{type:'image/svg+xml'});
const webp=await mk('w.webp',100,50,'image/webp');const jpg=await mk('j.jpg',100,50,'image/jpeg');
const gif=new File([Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'),c=>c.charCodeAt(0))],'g.gif',{type:'image/gif'});
const r=await add([corrupt,corrupt2,zero,txt,svg,svgNoSize,webp,jpg,gif,png]);
return {r,names:SHOTS.map(s=>s.name+':'+s.img.width+'x'+s.img.height)};`);
await T('sizes',`SHOTS=[];imgShot=null;
const a=await mk('wide.png',10000,10);const b=await mk('tall.png',10,10000);const c=await mk('one.png',1,1);
const r=await add([a,b,c]);render();
return {r,names:SHOTS.map(s=>s.name+':'+s.img.width+'x'+s.img.height), cards:document.querySelectorAll('#imgs .card').length};`);
log(JSON.stringify(R,null,1));
return R;};
