const LIB=require('./lib.cjs');
module.exports=async({ev})=>{
  await ev(LIB);
  const R={};
  const reset=`(()=>{undoStack.length=0;redoStack.length=0;undoShots.length=0;redoShots.length=0;updateHistBtns();})()`;
  // T1: click-only on canvas after an undo wipes redo
  R.t1=await ev(`(async()=>{ ${reset};
    state.layouts[state.active].row.x=0.2; pushUndo(); state.layouts[state.active].row.x=0.3;
    undo(); const before={u:undoStack.length,r:redoStack.length};
    const [a,b]=F.cvPt(0.5,0.5); F.mouse(cv,'mousedown',a,b); F.mouse(window,'mouseup',a,b);
    return {before, after:{u:undoStack.length,r:redoStack.length, redoBtnDisabled:document.getElementById('bRedo').disabled}}; })()`);
  // T2: variant delete index shift / currentVariant after undo
  R.t2=await ev(`(async()=>{ ${reset}; state.variants=[]; state.currentVariant=null;
    state.pack.title='A'; variantAdd(); state.pack.title='B'; variantAdd(); state.pack.title='C'; variantAdd();
    variantLoad(1); const cur1=state.currentVariant; // B selected
    variantDelete(0);  // delete A
    const afterDel={cur:state.currentVariant, names:state.variants.map(v=>v.name), highlighted: state.variants[state.currentVariant]&&state.variants[state.currentVariant].name};
    undo(); const afterUndo={cur:state.currentVariant, names:state.variants.map(v=>v.name)};
    return {cur1, afterDel, afterUndo}; })()`);
  // T3: gesture flag stuck on text input after canvas drag
  R.t3=await ev(`(async()=>{ ${reset};
    const ta=document.querySelector('#controls input[type=text][data-path]'); ta.focus();
    ta.value='aaa'; F.fire(ta,'input'); const u1=undoStack.length;
    F.drag(0.3,0.3,0.5,0.5); const u2=undoStack.length;  // canvas drag, preventDefault keeps focus?
    const focusKept = document.activeElement===ta;
    const ta2=document.querySelector('#controls input[type=text][data-path="'+ta.getAttribute('data-path')+'"]');
    ta2.value='bbb'; F.fire(ta2,'input'); const u3=undoStack.length;
    return {u1,u2,u3,focusKept, sameEl: ta===ta2}; })()`);
  // T4: keyboard hijack in text input / textarea / number
  R.t4=await ev(`(async()=>{ ${reset};
    state.layouts[state.active].row.x=0.2; pushUndo(); state.layouts[state.active].row.x=0.4;
    const out={};
    for(const sel of ['#controls textarea','#controls input[type=text][data-path]','#controls input.val','#controls input[type=range]','#controls select']){
      const el=document.querySelector(sel); if(!el){out[sel]='none';continue;}
      el.focus(); const n0=undoStack.length; const ev1=new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true,cancelable:true}); el.dispatchEvent(ev1);
      out[sel]={prevented:ev1.defaultPrevented, undoDelta:undoStack.length-n0};
      if(undoStack.length<n0){ redo(); }
    }
    const el=document.querySelector('#controls textarea'); el.focus();
    const e2=new KeyboardEvent('keydown',{key:'Delete',bubbles:true,cancelable:true}); el.dispatchEvent(e2); out.delInTextarea=e2.defaultPrevented;
    const e3=new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true,cancelable:true}); el.dispatchEvent(e3); out.arrowInTextarea=e3.defaultPrevented;
    return out; })()`);
  // T5: arrow key with nothing selected / locked: pushes empty undo steps?
  R.t5=await ev(`(async()=>{ ${reset}; document.activeElement&&document.activeElement.blur&&document.activeElement.blur();
    const f0=snapState(); F.key('ArrowLeft'); const n=undoStack.length; const same=snapState()===f0;
    selLocked=false; return {pushed:n, stateUnchanged:same, sel:state.sel}; })()`);
  // T6: ctrl+z mid-drag
  R.t6=await ev(`(async()=>{ ${reset}; const L=state.layouts[state.active]; state.sel='row'; L.row.x=0.2;
    const [a,b]=F.cvPt(0.5,0.5); const sx=L.row.x;
    selectEl('row'); const hit=hitTest(PW*0.5,PH*0.5);
    F.mouse(cv,'mousedown',a,b); F.mouse(window,'mousemove',a+30,b+10); F.key('z',{ctrlKey:true}); F.mouse(window,'mousemove',a+60,b+20); F.mouse(window,'mouseup',a+60,b+20);
    return {hit, undo:undoStack.length, redo:redoStack.length, x:L.row.x, x2:state.layouts[state.active].row.x, sx, dragging}; })()`);
  return R;
};
