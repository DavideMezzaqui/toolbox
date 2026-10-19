module.exports.setup = async (ev)=>{ await ev(`window.mk=async(name,w,h,type='image/png',hue=100,lm)=>{const c=document.createElement('canvas');c.width=w;c.height=h;const g=c.getContext('2d');g.fillStyle='hsl('+hue+',60%,40%)';g.fillRect(0,0,w,h);g.fillStyle='#fff';g.fillRect(0,0,Math.min(w,50),Math.min(h,50));
 const b=await new Promise(r=>c.toBlob(r,type,0.8));return new File([b],name,{type,lastModified:lm===undefined?hue:lm});};
window.add=(files)=>new Promise(r=>{const t=performance.now();addShots(files,(n,rot,mot)=>r({n,rot,mot,ms:Math.round(performance.now()-t)}));});
window.dropFiles=(files,x,y)=>{const dt=new DataTransfer();files.forEach(f=>dt.items.add(f));const o={dataTransfer:dt,bubbles:true,cancelable:true,clientX:x||5,clientY:y||5};window.dispatchEvent(new DragEvent('dragenter',o));window.dispatchEvent(new DragEvent('dragover',o));window.dispatchEvent(new DragEvent('drop',o));};
window.wait=ms=>new Promise(r=>setTimeout(r,ms));
window.urlLog={c:0,r:0};const oc=URL.createObjectURL.bind(URL),or=URL.revokeObjectURL.bind(URL);URL.createObjectURL=b=>{urlLog.c++;return oc(b)};URL.revokeObjectURL=u=>{urlLog.r++;return or(u)};
1`);};
