(async(FI,TI)=>{
    const bad=[];const errs=window.qaErrors;
    function walk(o,p,seen){ if(o===null||typeof o!=='object'){ if(typeof o==='number'&&!isFinite(o)) bad.push(p+'='+o); return;} if(seen.has(o))return; seen.add(o); for(const k in o) walk(o[k],p+'.'+k,seen); }
    const chk=(tag)=>{ const n=bad.length; walk(state.layouts,'L',new Set()); walk(state.theme,'theme',new Set()); walk(state.pack,'pack',new Set()); if(bad.length>n) bad.push('^ after '+tag); };
    const vals=['','abc','-','-0','1e999','-1e999','1e-999','99999999999','-99999999999','0','.','1.5.5','NaN','Infinity','e'];
    const setNum=(el,v)=>{ el.value=v; el.dispatchEvent(new Event('change',{bubbles:true})); };
    const log=[];
    for(const f of [FORMATS[FI]]){
      state.active=f.id;
      for(const t of [TABS[TI]]){
        activeTab=t.id; buildControls();
        SECTIONS.forEach((s,i)=>openSecs[i]=true); buildControls();
        const els=[...document.querySelectorAll('#controls [data-path]')];
        for(const el of els){
          const path=el.getAttribute('data-path');
          if(el.classList.contains('val')) continue;
          const row=el.parentNode; const num=row.querySelector('input.val');
          try{
          if(num){ for(const v of vals){ setNum(num,v); chk(f.id+'/'+path+' num '+v); } }
          if(el.type==='range'){ for(const v of [el.min,el.max,(+el.min+ +el.max)/2]){ el.value=v; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); chk(path+' range'); } }
          else if(el.type==='checkbox'){ for(let i=0;i<3;i++){ el.checked=!el.checked; el.dispatchEvent(new Event('change',{bubbles:true})); chk(path+' chk'); } }
          else if(el.tagName==='SELECT'){ for(const o of [...el.options]){ el.value=o.value; el.dispatchEvent(new Event('change',{bubbles:true})); chk(path+' sel '+o.value); } }
          else if(el.type==='color'){ el.value='#12ab34'; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); }
          else { for(const v of ['', 'x'.repeat(5000), '<b>"&\u0000\n']){ el.value=v; el.dispatchEvent(new Event('input',{bubbles:true})); } }
          }catch(e){ log.push(f.id+'/'+path+': '+e.message); }
        }
      }
    }
    return {bad:bad.slice(0,30),log:log.slice(0,30),errs:errs.slice(0,10),n:bad.length};
})(FI_,TI_)