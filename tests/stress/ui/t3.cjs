module.exports=async({ev,log})=>{
 const r={};
 r.setup=await ev(`(()=>{state.active='unity_cover';buildFormats();buildControls();render();const b=cv.getBoundingClientRect();return [b.left,b.top,b.width,b.height,state.sel,view.z]})()`);
 const mk=(type,o)=>`window.dispatchEvent(new MouseEvent('${type}',Object.assign({bubbles:true,clientX:0,clientY:0},${JSON.stringify(o)})))`;
 // find a hit position of the band/title: use hitTest
 r.hit=await ev(`(()=>{const b=cv.getBoundingClientRect();const out=[];for(let i=1;i<20;i++)for(let j=1;j<20;j++){const k=hitTest(i/20*PW,j/20*PH);if(k&&k!=='shot'){out.push([i/20,j/20,k]);}}return out.slice(0,3)})()`);
 log(JSON.stringify(r.hit));
 const [hx,hy,hk]=r.hit[0]||[0.5,0.5,'shot'];
 // 1. drag, mouse buttons=0 move (released outside iframe) -> still dragging?
 r.t1=await ev(`(()=>{const b=cv.getBoundingClientRect();const X=b.left+${hx}*b.width,Y=b.top+${hy}*b.height;
   cv.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:X,clientY:Y,button:0,buttons:1}));
   const d0=dragging;
   window.dispatchEvent(new MouseEvent('mousemove',{clientX:X+30,clientY:Y,buttons:0}));
   const moved=dragging; endDrag(); return {d0,stillDraggingAfterMoveWithNoButton:moved}})()`);
 // 2. right-button mousedown starts a drag
 r.t2=await ev(`(()=>{const b=cv.getBoundingClientRect();const X=b.left+${hx}*b.width,Y=b.top+${hy}*b.height;
   cv.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:X,clientY:Y,button:2,buttons:2}));
   const d=dragging; endDrag(); return {rightDown_dragging:d}})()`);
 r.t3=await ev(`(()=>{const b=cv.getBoundingClientRect();const X=b.left+${hx}*b.width,Y=b.top+${hy}*b.height;
   cv.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:X,clientY:Y,button:1,buttons:4}));
   const d=dragging, pan=panFrom; endDrag(); return {midDown_dragging:d}})()`);
 // 4 touchcancel
 r.t4=await ev(`(()=>{const b=cv.getBoundingClientRect();const X=b.left+${hx}*b.width,Y=b.top+${hy}*b.height;
   const t=new Touch({identifier:1,target:cv,clientX:X,clientY:Y});
   cv.dispatchEvent(new TouchEvent('touchstart',{bubbles:true,cancelable:true,touches:[t],targetTouches:[t],changedTouches:[t]}));
   const d=dragging;
   window.dispatchEvent(new TouchEvent('touchcancel',{bubbles:true,touches:[],changedTouches:[t]}));
   const after=dragging; const cls=cv.className; endDrag(); return {d,afterCancel:after,cls}})()`);
 // 5 touchmove with empty touches
 r.t5=await ev(`(()=>{const b=cv.getBoundingClientRect();const X=b.left+${hx}*b.width,Y=b.top+${hy}*b.height;
   const t=new Touch({identifier:1,target:cv,clientX:X,clientY:Y});
   cv.dispatchEvent(new TouchEvent('touchstart',{bubbles:true,cancelable:true,touches:[t],targetTouches:[t],changedTouches:[t]}));
   let err=null;try{window.dispatchEvent(new TouchEvent('touchmove',{bubbles:true,cancelable:true,touches:[],changedTouches:[t]}));}catch(e){err=e.message}
   endDrag(); return {err, qa: window.qaErrors}})()`);
 // 6 dblclick, wheel
 r.t6=await ev(`(()=>{const st=document.getElementById('stage')||cvwrap;const z0=view.z;
   for(let i=0;i<200;i++) st.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:-100,clientX:200,clientY:200}));
   const z1=view.z;
   for(let i=0;i<400;i++) st.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:100,clientX:200,clientY:200}));
   const z2=view.z; const dbl=(()=>{try{cv.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));return 'ok'}catch(e){return e.message}})();
   return {z0,z1,z2,tx:view.tx,ty:view.ty,dbl}})()`);
 r.nan=await ev(`JSON.stringify([view.z,view.tx,view.ty])`);
 log(JSON.stringify(r,null,1)); return 1;
};
