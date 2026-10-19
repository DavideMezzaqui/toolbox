module.exports=async({ev,log})=>{
 log(JSON.stringify(await ev(`(()=>{const b=cv.getBoundingClientRect();const X=b.left+0.5*b.width,Y=b.top+0.5*b.height;
 const o={};selLocked=true;
 const md=(btn)=>cv.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:X,clientY:Y,button:btn,buttons:1<<btn}));
 const mm=(bs)=>window.dispatchEvent(new MouseEvent('mousemove',{clientX:X+30,clientY:Y+10,buttons:bs}));
 const x0=state.layouts[state.active].row.x;
 md(0); o.left=dragging; mm(0); o.afterNoButtonMove=dragging; o.dx=state.layouts[state.active].row.x-x0; window.dispatchEvent(new MouseEvent('mouseup',{}));
 md(2); o.right=dragging; window.dispatchEvent(new MouseEvent('mouseup',{}));
 md(1); o.mid=dragging; o.midPan=typeof panFrom!=='undefined'&&panFrom; window.dispatchEvent(new MouseEvent('mouseup',{}));
 selLocked=false;
 // box select with no button move
 selLocked=false; md(0); o.box=!!boxSel; mm(0); o.boxAfter=!!boxSel; window.dispatchEvent(new MouseEvent('mouseup',{}));
 return o})()`)));
};
