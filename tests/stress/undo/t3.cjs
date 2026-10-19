const LIB=require('./lib.cjs');
module.exports=async({ev})=>{
  await ev(LIB);
  const R={};
  const reset=`(()=>{undoStack.length=0;redoStack.length=0;undoShots.length=0;redoShots.length=0;updateHistBtns();})()`;
  await ev(`(async()=>{ const fs=await F.mkFiles(3,'b'); await new Promise(r=>addShots(fs,r)); ${reset}; })()`);
  R.boxes=await ev(`Object.keys(BOXES).map(k=>k+':'+JSON.stringify(BOXES[k])).join(' | ')`);
  const click=`(k)=>{ const b=BOXES[k]; const [a,c]=F.cvPt((b.x+b.w/2)/PW,(b.y+b.h/2)/PH); return [a,c]; }`;
  // T1: click-only on an element after undo wipes redo
  R.t1=await ev(`(async()=>{ ${reset}; const pt=${click}; const L=state.layouts[state.active];
    L.row.x=0.2; pushUndo(); L.row.x=0.3; undo(); const before={u:undoStack.length,r:redoStack.length};
    const [a,b]=pt('row'); F.mouse(cv,'mousedown',a,b); F.mouse(window,'mouseup',a,b);
    return {sel:state.sel, before, after:{u:undoStack.length,r:redoStack.length}}; })()`);
  // T6: ctrl+z mid-drag
  R.t6=await ev(`(async()=>{ ${reset}; const pt=${click}; const L=state.layouts[state.active]; L.row.x=0.3;
    const [a,b]=pt('row'); const x0=L.row.x;
    F.mouse(cv,'mousedown',a,b); F.mouse(window,'mousemove',a+30,b+10); const xm=L.row.x; F.key('z',{ctrlKey:true}); const xu=state.layouts[state.active].row.x;
    F.mouse(window,'mousemove',a+60,b+20); F.mouse(window,'mouseup',a+60,b+20);
    const L2=state.layouts[state.active];
    return {sel:state.sel,x0,xm,xu,xend:L2.row.x, undo:undoStack.length, redo:redoStack.length, dragging}; })()`);
  // T7: wheel gesture undo steps
  R.t7=await ev(`(async()=>{ ${reset}; state.sel='shot'; const st=document.getElementById('stage')||cvwrap; const n0=undoStack.length;
    for(let i=0;i<5;i++) st.dispatchEvent(new WheelEvent('wheel',{deltaY:-100,altKey:true,bubbles:true,cancelable:true,clientX:300,clientY:300}));
    return {pushed:undoStack.length-n0}; })()`);
  // T8: image remove then reload persistence after undo
  R.t8=await ev(`(async()=>{ ${reset}; const n=SHOTS.length; togliImmagine(0); const n1=SHOTS.length; undo(); const n2=SHOTS.length; await new Promise(r=>setTimeout(r,1500)); return {n,n1,n2}; })()`);
  return R;
};
