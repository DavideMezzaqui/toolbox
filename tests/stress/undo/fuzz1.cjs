const LIB=require('./lib.cjs');
const OPS=(process.env.OPS||'drag,click,handle,ctrl,ctrl,ctrl,num,text,panels,fmt,add,card,card,remove,move,variant,arrow,del,addlayer,tab,wheel').split(',');
module.exports=async({ev})=>{
  await ev(LIB);
  const res=[];
  const runs=+process.env.RUNS||10;
  for(let run=0; run<runs; run++){
    const r=await ev(`(async()=>{
      F.setSeed(${run*7919+13}); F.log.length=0;
      const reset=()=>{undoStack.length=0;redoStack.length=0;undoShots.length=0;redoShots.length=0;updateHistBtns();};
      if(SHOTS.length<2){ const fs=await F.mkFiles(3,'base'); await new Promise(r=>addShots(fs,r)); }
      reset();
      const OPS=${JSON.stringify(OPS)};
      const diff=(a,b)=>{ let i=0; while(i<a.length&&a[i]===b[i]) i++; return {at:i, a:a.slice(Math.max(0,i-80),i+120), b:b.slice(Math.max(0,i-80),i+120)}; };
      const f0=F.fp(); const out={run:${run}, bad:[]};
      let steps=0;
      while(undoStack.length<45 && steps<200){
        steps++; const name=F.pick(OPS);
        try{ await F.op(name);}catch(e){ out.bad.push('EXC '+name+': '+e.message); }
        const iv=F.invariants(); if(iv.length) out.bad.push(name+': '+iv.join('; '));
      }
      out.depth=undoStack.length; out.steps=steps;
      const fFinal=F.fp(); const nUndo=undoStack.length;
      for(let i=0;i<nUndo+3;i++){ undo(); const iv=F.invariants(); if(iv.length) out.bad.push('undo#'+i+': '+iv.join('; ')); }
      const f1=F.fp();
      if(f1!==f0){ out.bad.push('UNDO-ALL != initial'); out.diff=diff(f0,f1); }
      out.btn1=[document.getElementById('bUndo').disabled, document.getElementById('bRedo').disabled];
      for(let i=0;i<nUndo+3;i++){ redo(); const iv=F.invariants(); if(iv.length) out.bad.push('redo#'+i+': '+iv.join('; ')); }
      const f2=F.fp();
      if(f2!==fFinal){ out.bad.push('REDO-ALL != final'); out.diff2=diff(fFinal,f2); }
      out.btn2=[document.getElementById('bUndo').disabled, document.getElementById('bRedo').disabled];
      out.bad=[...new Set(out.bad)].slice(0,8);
      return out;
    })()`);
    res.push(r);
  }
  return res;
};
