module.exports=async({ev,log})=>{
 log(JSON.stringify(await ev(`(()=>{const o={};
 SECTIONS.forEach((s,i)=>openSecs[i]=true);activeTab='design';buildControls();
 const box=document.getElementById('controls');
 // find rows whose change triggers buildControls
 const els=[...box.querySelectorAll('[data-path]')].filter(e=>e.type==='checkbox'||e.tagName==='SELECT'||e.classList.contains('val')||e.type==='range');
 const lost=[];box.scrollTop=400;const st0=box.scrollTop;
 for(const el of els){ const path=el.getAttribute('data-path'); const target=el.classList.contains('val')?el.parentNode.querySelector('[type=range]').getAttribute('data-path'):path;
   const cur=document.querySelector('#controls [data-path="'+path+'"]'); if(!cur) continue;
   cur.focus(); const before=document.activeElement===cur; box.scrollTop=300;
   if(cur.type==='checkbox'){cur.checked=!cur.checked;cur.dispatchEvent(new Event('change',{bubbles:true}));}
   else if(cur.tagName==='SELECT'){cur.selectedIndex=(cur.selectedIndex+1)%cur.options.length;cur.dispatchEvent(new Event('change',{bubbles:true}));}
   else if(cur.classList.contains('val')){cur.value=cur.value;cur.dispatchEvent(new Event('change',{bubbles:true}));}
   const now=document.querySelector('#controls [data-path="'+path+'"]');
   if(before && document.activeElement!==now) lost.push([path,cur.type||cur.tagName, document.activeElement.tagName, box.scrollTop]);
 }
 o.focusLost=lost; o.n=els.length;
 // shortcuts
 const key=(el,k,extra)=>{const ev=new KeyboardEvent('keydown',Object.assign({key:k,bubbles:true,cancelable:true},extra||{}));el.dispatchEvent(ev);return ev.defaultPrevented};
 const ti=document.getElementById('secFilter');ti.focus();
 const a0=state.active, snap0=state.snap.on, lock0=selLocked, z0=view.z;
 ['Tab','g','l','c','0','+','-','Delete','Backspace',' ','ArrowLeft'].forEach(k=>key(ti,k));
 o.typing={active:state.active===a0,snap:state.snap.on===snap0,lock:selLocked===lock0,z:view.z===z0};
 const ta=document.querySelector('#controls textarea');if(ta){ta.focus();['Tab','g','l','Delete','ArrowLeft'].forEach(k=>key(ta,k));o.ta={active:state.active===a0,snap:state.snap.on===snap0};}
 const sel=document.querySelector('#controls select');sel.focus();['g','l','Tab','Delete'].forEach(k=>key(sel,k));o.select={active:state.active===a0,snap:state.snap.on===snap0};
 const btn=document.querySelector('#controls button');btn.focus();key(btn,'Tab');o.btnTabChangesFormat=state.active!==a0;
 state.active=a0;
 return o})()`)));
};
