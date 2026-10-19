module.exports=async({ev,log})=>{
 log(JSON.stringify(await ev(`(()=>{const b=cv.getBoundingClientRect();const X=b.left+0.5*b.width,Y=b.top+0.5*b.height;
 const o={};selLocked=true;
 const md=(btn)=>cv.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:X,clientY:Y,button:btn,buttons:1<<btn}));
 const mm=(bs)=>window.dispatchEvent(new MouseEvent('mousemove',{clientX:X+30,clientY:Y+10,buttons:bs}));
 md(0); mm(1); o.dragWithButton=dragging; mm(0); o.afterNoButtonMove=dragging; window.dispatchEvent(new MouseEvent('mouseup',{}));
 md(2); o.right=dragging; window.dispatchEvent(new MouseEvent('mouseup',{}));
 md(1); o.mid=dragging; window.dispatchEvent(new MouseEvent('mouseup',{}));
 selLocked=false; md(0); o.box=!!boxSel; mm(0); o.boxAfter=!!boxSel; window.dispatchEvent(new MouseEvent('mouseup',{}));
 selLocked=true;
 const t=new Touch({identifier:1,target:cv,clientX:X,clientY:Y});
 cv.dispatchEvent(new TouchEvent('touchstart',{bubbles:true,cancelable:true,touches:[t],targetTouches:[t],changedTouches:[t]}));
 o.td=dragging; window.dispatchEvent(new TouchEvent('touchcancel',{bubbles:true,touches:[],changedTouches:[t]})); o.afterCancel=dragging;
 cv.dispatchEvent(new TouchEvent('touchstart',{bubbles:true,cancelable:true,touches:[t],targetTouches:[t],changedTouches:[t]}));
 window.dispatchEvent(new TouchEvent('touchmove',{bubbles:true,cancelable:true,touches:[],changedTouches:[t]}));endDrag();
 o.qa=window.qaErrors; return o})()`)));
};
