/* injected into page */
window.FZ = (()=>{
  const P = CanvasRenderingContext2D.prototype;
  const bad = [];            // non-finite args
  let depth = 0, maxNeg = 0;
  const ctr = {save:0, restore:0};
  const names = ['fillRect','strokeRect','clearRect','drawImage','arc','arcTo','ellipse','rect','roundRect','moveTo','lineTo','quadraticCurveTo','bezierCurveTo','translate','scale','rotate','transform','setTransform','fillText','strokeText','createLinearGradient','createRadialGradient','createConicGradient','createPattern','getImageData','putImageData','createImageData'];
  names.forEach(n=>{ const o = P[n]; if(!o) return;
    P[n] = function(...a){ for(let i=0;i<a.length;i++){ const v=a[i]; if(typeof v==='number' && !isFinite(v)) { bad.push(n+'#'+i+'='+v); break; } }
      return o.apply(this,a); }; });
  const os=P.save, orr=P.restore;
  P.save=function(){ ctr.save++; return os.call(this); };
  P.restore=function(){ ctr.restore++; return orr.call(this); };
  ['fillStyle','strokeStyle'].forEach(n=>{});
  const props = ['lineWidth','globalAlpha','shadowBlur','shadowOffsetX','shadowOffsetY','font','letterSpacing'];
  props.forEach(n=>{ const d = Object.getOwnPropertyDescriptor(P,n); if(!d||!d.set) return;
    Object.defineProperty(P,n,{get:d.get,set(v){ if(typeof v==='number' && !isFinite(v)) bad.push('set '+n+'='+v); else if(typeof v==='string' && /NaN|Infinity|undefined|null/.test(v)) bad.push('set '+n+'='+v); d.set.call(this,v);} ,configurable:true}); });
  return {bad, ctr, reset(){ bad.length=0; ctr.save=0; ctr.restore=0; }};
})();
