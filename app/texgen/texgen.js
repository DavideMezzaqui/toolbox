import React, { useState, useRef, useEffect, useContext } from "react";

// CSS injection is handled by injectSpinnerCSS(), called at TexGen mount.

// ═══ MATH ═══════════════════════════════════════════════════════
function lerp(a,b,t){return a+(b-a)*t;}
function clamp(v,lo,hi){lo=lo==null?0:lo;hi=hi==null?1:hi;return Math.max(lo,Math.min(hi,v));}
function fade(t){return t*t*t*(t*(t*6-15)+10);}
// sRGB conversion via 1025-entry LUT — replaces per-pixel Math.pow with array lookup.
// Quantization error <0.5/255, imperceptible. Cuts toSRGB cost by ~15x.
var _srgbLUT=null;
function buildSRGBLUTs(){
  _srgbLUT=new Float32Array(1025);
  for(var i=0;i<=1024;i++){
    var c=i/1024;
    var v=c<=0.0031308?c*12.92:1.055*Math.pow(c,1/2.4)-0.055;
    _srgbLUT[i]=v;
  }
}
buildSRGBLUTs();
function toSRGB(v){var c=v<0?0:v>1?1:v;return _srgbLUT[(c*1024)|0];}
function lumin(r,g,b){return 0.299*r+0.587*g+0.114*b;}

// ═══ BUFFER POOL ═══════════════════════════════════════════════
// Reuses Float32Array buffers to eliminate per-render GC stutter.
// A 256x256 render allocates a 1MB buffer; at 60fps that's 60MB/sec
// of garbage — enough to trigger GC pauses mid-drag. Pool caps at 8
// buffers per size (covers typical concurrent use: layerBuf + ptBuf +
// layerDistBufs + filter temps + glow temp).
var _bufPool={};
function getBuf(n){
  var pool=_bufPool[n];
  if(pool&&pool.length>0){
    var b=pool.pop();b.fill(0);
    return b;
  }
  return new Float32Array(n); // auto-zeroed by spec
}
function releaseBuf(buf){
  if(!buf)return;
  var n=buf.length,pool=_bufPool[n]||(_bufPool[n]=[]);
  // Cap at 8 per size — enough for typical concurrent use without unbounded growth
  if(pool.length<8)pool.push(buf);
}
// Drains the pool — useful when switching preview resolution to free old-size buffers
function drainBufPool(){_bufPool={};}

// ═══ GAUSSIAN BLUR (separable, verified correct) ════════════════
var _kernelCache={};
function gaussKernel(radius){
  if(_kernelCache[radius])return _kernelCache[radius];
  var sigma=radius/3,size=radius*2+1,k=new Float32Array(size),sum=0;
  for(var i=0;i<size;i++){var x=i-radius;k[i]=Math.exp(-(x*x)/(2*sigma*sigma));sum+=k[i];}
  for(var i=0;i<size;i++)k[i]/=sum;
  _kernelCache[radius]=k;
  return k;
}
var _blurTmpBuf=null;
function gaussBlur(buf,w,h,radius){
  if(radius<1)return;
  var k=gaussKernel(radius),needed=buf.length;
  if(!_blurTmpBuf||_blurTmpBuf.length<needed)_blurTmpBuf=new Float32Array(needed);
  var tmp=_blurTmpBuf,klen=k.length,r2=radius;
  // Horizontal pass: interior columns skip clamping (hot path)
  for(var y=0;y<h;y++){
    var rowOff=y*w;
    // Edge left
    for(var x=0;x<r2&&x<w;x++){
      var r=0,g=0,b=0,a=0;
      for(var ki=0;ki<klen;ki++){var sx=x+ki-r2;if(sx<0)sx=0;else if(sx>=w)sx=w-1;var ii=(rowOff+sx)*4,kv=k[ki];r+=buf[ii]*kv;g+=buf[ii+1]*kv;b+=buf[ii+2]*kv;a+=buf[ii+3]*kv;}
      var oi=(rowOff+x)*4;tmp[oi]=r;tmp[oi+1]=g;tmp[oi+2]=b;tmp[oi+3]=a;
    }
    // Interior (no clamping needed)
    for(var x=r2;x<w-r2;x++){
      var r=0,g=0,b=0,a=0,base=(rowOff+x-r2)*4;
      for(var ki=0;ki<klen;ki++){var ii=base+ki*4,kv=k[ki];r+=buf[ii]*kv;g+=buf[ii+1]*kv;b+=buf[ii+2]*kv;a+=buf[ii+3]*kv;}
      var oi=(rowOff+x)*4;tmp[oi]=r;tmp[oi+1]=g;tmp[oi+2]=b;tmp[oi+3]=a;
    }
    // Edge right
    for(var x=Math.max(r2,w-r2);x<w;x++){
      var r=0,g=0,b=0,a=0;
      for(var ki=0;ki<klen;ki++){var sx=x+ki-r2;if(sx<0)sx=0;else if(sx>=w)sx=w-1;var ii=(rowOff+sx)*4,kv=k[ki];r+=buf[ii]*kv;g+=buf[ii+1]*kv;b+=buf[ii+2]*kv;a+=buf[ii+3]*kv;}
      var oi=(rowOff+x)*4;tmp[oi]=r;tmp[oi+1]=g;tmp[oi+2]=b;tmp[oi+3]=a;
    }
  }
  // Vertical pass: interior rows skip clamping
  for(var x=0;x<w;x++){
    // Edge top
    for(var y=0;y<r2&&y<h;y++){
      var r=0,g=0,b=0,a=0;
      for(var ki=0;ki<klen;ki++){var sy=y+ki-r2;if(sy<0)sy=0;else if(sy>=h)sy=h-1;var ii=(sy*w+x)*4,kv=k[ki];r+=tmp[ii]*kv;g+=tmp[ii+1]*kv;b+=tmp[ii+2]*kv;a+=tmp[ii+3]*kv;}
      var oi=(y*w+x)*4;buf[oi]=r;buf[oi+1]=g;buf[oi+2]=b;buf[oi+3]=a;
    }
    // Interior
    for(var y=r2;y<h-r2;y++){
      var r=0,g=0,b=0,a=0;
      for(var ki=0;ki<klen;ki++){var ii=((y+ki-r2)*w+x)*4,kv=k[ki];r+=tmp[ii]*kv;g+=tmp[ii+1]*kv;b+=tmp[ii+2]*kv;a+=tmp[ii+3]*kv;}
      var oi=(y*w+x)*4;buf[oi]=r;buf[oi+1]=g;buf[oi+2]=b;buf[oi+3]=a;
    }
    // Edge bottom
    for(var y=Math.max(r2,h-r2);y<h;y++){
      var r=0,g=0,b=0,a=0;
      for(var ki=0;ki<klen;ki++){var sy=y+ki-r2;if(sy<0)sy=0;else if(sy>=h)sy=h-1;var ii=(sy*w+x)*4,kv=k[ki];r+=tmp[ii]*kv;g+=tmp[ii+1]*kv;b+=tmp[ii+2]*kv;a+=tmp[ii+3]*kv;}
      var oi=(y*w+x)*4;buf[oi]=r;buf[oi+1]=g;buf[oi+2]=b;buf[oi+3]=a;
    }
  }
}
// applyGlow: opts = {intensity, threshold, tintR, tintG, tintB, blend}
// blend: "add" (default, bright emissive) | "screen" (softer)
function applyGlow(buf,size,radius,intensity,opts){
  if(radius<1||intensity<=0)return;
  opts=opts||{};
  var threshold=opts.threshold!=null?opts.threshold:0;
  var tintR=opts.tintR!=null?opts.tintR:1;
  var tintG=opts.tintG!=null?opts.tintG:1;
  var tintB=opts.tintB!=null?opts.tintB:1;
  var useScreen=opts.blend==="screen";
  // Build glow source: apply threshold first
  var g=getBuf(buf.length);
  for(var _gi=0;_gi<buf.length;_gi++)g[_gi]=buf[_gi];
  if(threshold>0){
    for(var i=0;i<size*size;i++){
      var ii=i*4,lum=0.299*g[ii]+0.587*g[ii+1]+0.114*g[ii+2];
      var t=threshold>0?(lum<threshold?0:(lum-threshold)/(1-threshold)):1;
      g[ii]*=t;g[ii+1]*=t;g[ii+2]*=t;
    }
  }
  gaussBlur(g,size,size,Math.round(radius));
  var gi=intensity*2;
  for(var i=0;i<size*size;i++){
    var ii=i*4;
    var gr=g[ii]*tintR*gi, gg2=g[ii+1]*tintG*gi, gb=g[ii+2]*tintB*gi;
    if(useScreen){
      buf[ii  ]=1-(1-buf[ii  ])*(1-gr);
      buf[ii+1]=1-(1-buf[ii+1])*(1-gg2);
      buf[ii+2]=1-(1-buf[ii+2])*(1-gb);
    } else {
      // Additive (emissive, like Illugen/SD bloom)
      buf[ii  ]=clamp(buf[ii  ]+gr);
      buf[ii+1]=clamp(buf[ii+1]+gg2);
      buf[ii+2]=clamp(buf[ii+2]+gb);
    }
  }
  releaseBuf(g);
}

// ═══ SD-STYLE FILTERS ═══════════════════════════════════════════
function conv3s(buf,w,h,kern,bias){
  bias=bias||0;
  var out=getBuf(buf.length);
  for(var y=0;y<h;y++)for(var x=0;x<w;x++){
    var rv=0,gv=0,bv=0;
    for(var ky=0;ky<3;ky++)for(var kx=0;kx<3;kx++){
      var sx=Math.min(w-1,Math.max(0,x+kx-1)),sy=Math.min(h-1,Math.max(0,y+ky-1)),ii=(sy*w+sx)*4,kv=kern[ky*3+kx];
      rv+=buf[ii]*kv;gv+=buf[ii+1]*kv;bv+=buf[ii+2]*kv;
    }
    var oi=(y*w+x)*4;out[oi]=clamp(rv+bias);out[oi+1]=clamp(gv+bias);out[oi+2]=clamp(bv+bias);out[oi+3]=buf[oi+3];
  }
  for(var i=0;i<buf.length;i++)buf[i]=out[i];
  releaseBuf(out);
}
var SX=[-1,0,1,-2,0,2,-1,0,1],SY=[-1,-2,-1,0,0,0,1,2,1];

// ── Directional Blur ─────────────────────────────────────────────────────
// Blur along a specific angle (motion blur effect)
function fDirectionalBlur(buf,w,h,samples,amount,angle){
  samples=Math.max(2,Math.round(samples||8));
  var rad=(angle||0)*Math.PI/180;
  var dx=Math.cos(rad)*amount, dy=Math.sin(rad)*amount;
  var out=new Float32Array(buf.length);
  for(var y=0;y<h;y++)for(var x=0;x<w;x++){
    var r=0,g=0,b=0,a=0;
    for(var s=0;s<samples;s++){
      var t=(s/(samples-1)-0.5);
      var sx=Math.max(0,Math.min(w-1,Math.round(x+dx*t))|0);
      var sy=Math.max(0,Math.min(h-1,Math.round(y+dy*t))|0);
      var ii=(sy*w+sx)*4;
      r+=buf[ii];g+=buf[ii+1];b+=buf[ii+2];a+=buf[ii+3];
    }
    var oi=(y*w+x)*4;
    out[oi]=r/samples;out[oi+1]=g/samples;out[oi+2]=b/samples;out[oi+3]=a/samples;
  }
  for(var i=0;i<buf.length;i++)buf[i]=out[i];
}

// ── Box Blur ─────────────────────────────────────────────────────────────
// Simple box (mean) blur — faster than gaussian, good for pixelated look
function fBoxBlur(buf,w,h,radius){
  var r=Math.max(1,Math.round(radius||3));
  var out=new Float32Array(buf.length);
  var diam=(2*r+1), area=diam*diam;
  for(var y=0;y<h;y++)for(var x=0;x<w;x++){
    var sr=0,sg=0,sb=0,sa=0;
    for(var ky=-r;ky<=r;ky++)for(var kx=-r;kx<=r;kx++){
      var sx=Math.max(0,Math.min(w-1,x+kx));
      var sy=Math.max(0,Math.min(h-1,y+ky));
      var ii=(sy*w+sx)*4;
      sr+=buf[ii];sg+=buf[ii+1];sb+=buf[ii+2];sa+=buf[ii+3];
    }
    var oi=(y*w+x)*4;
    out[oi]=sr/area;out[oi+1]=sg/area;out[oi+2]=sb/area;out[oi+3]=sa/area;
  }
  for(var i=0;i<buf.length;i++)buf[i]=out[i];
}

// ── Zoom Blur ────────────────────────────────────────────────────────────
// Radial blur expanding from center (speed/zoom effect)
function fZoomBlur(buf,w,h,samples,amount,cxN,cyN){
  samples=Math.max(2,Math.round(samples||8));
  var cx=w*(cxN!=null?cxN:0.5),cy=h*(cyN!=null?cyN:0.5);
  var out=new Float32Array(buf.length);
  for(var y=0;y<h;y++)for(var x=0;x<w;x++){
    var r=0,g=0,b=0,a=0;
    var dx=x-cx,dy=y-cy;
    for(var s=0;s<samples;s++){
      var t=s/(samples-1)*amount;
      var sx=Math.max(0,Math.min(w-1,Math.round(x-dx*t))|0);
      var sy=Math.max(0,Math.min(h-1,Math.round(y-dy*t))|0);
      var ii=(sy*w+sx)*4;
      r+=buf[ii];g+=buf[ii+1];b+=buf[ii+2];a+=buf[ii+3];
    }
    var oi=(y*w+x)*4;
    out[oi]=r/samples;out[oi+1]=g/samples;out[oi+2]=b/samples;out[oi+3]=a/samples;
  }
  for(var i=0;i<buf.length;i++)buf[i]=out[i];
}

// ── Spin Blur ────────────────────────────────────────────────────────────
// Circular motion blur around center
function fSpinBlur(buf,w,h,samples,angle,cxN,cyN){
  samples=Math.max(2,Math.round(samples||8));
  var cx=w*(cxN!=null?cxN:0.5),cy=h*(cyN!=null?cyN:0.5);
  var rad=(angle||5)*Math.PI/180;
  var out=new Float32Array(buf.length);
  for(var y=0;y<h;y++)for(var x=0;x<w;x++){
    var r=0,g=0,b=0,a=0;
    var dx=x-cx,dy=y-cy;
    var rr=Math.sqrt(dx*dx+dy*dy)||0.001;
    var baseAng=Math.atan2(dy,dx);
    for(var s=0;s<samples;s++){
      var t=(s/(samples-1)-0.5)*rad;
      var na=baseAng+t;
      var sx=Math.max(0,Math.min(w-1,Math.round(cx+Math.cos(na)*rr))|0);
      var sy=Math.max(0,Math.min(h-1,Math.round(cy+Math.sin(na)*rr))|0);
      var ii=(sy*w+sx)*4;
      r+=buf[ii];g+=buf[ii+1];b+=buf[ii+2];a+=buf[ii+3];
    }
    var oi=(y*w+x)*4;
    out[oi]=r/samples;out[oi+1]=g/samples;out[oi+2]=b/samples;out[oi+3]=a/samples;
  }
  for(var i=0;i<buf.length;i++)buf[i]=out[i];
}

// ── Gaussian Blur (filter version) ──────────────────────────────────────
// Calls the existing gaussBlur with configurable radius
function fGaussBlur(buf,w,h,radius){
  var r=Math.max(1,Math.round(radius||4));
  gaussBlur(buf,w,h,r);
}

function fEdge(buf,w,h,s){
  var out=new Float32Array(buf.length);
  for(var y=0;y<h;y++)for(var x=0;x<w;x++){
    var gx=0,gy=0;
    for(var ky=0;ky<3;ky++)for(var kx=0;kx<3;kx++){var sx=Math.min(w-1,Math.max(0,x+kx-1)),sy=Math.min(h-1,Math.max(0,y+ky-1)),ii=(sy*w+sx)*4,L=lumin(buf[ii],buf[ii+1],buf[ii+2]);gx+=L*SX[ky*3+kx];gy+=L*SY[ky*3+kx];}
    var mag=clamp(Math.sqrt(gx*gx+gy*gy)*(s||1)),oi=(y*w+x)*4;out[oi]=mag;out[oi+1]=mag;out[oi+2]=mag;out[oi+3]=buf[oi+3];
  }
  for(var i=0;i<buf.length;i++)buf[i]=out[i];
}
function fNormal(buf,w,h,s){
  function ht(x,y){var sx=Math.min(w-1,Math.max(0,x)),sy=Math.min(h-1,Math.max(0,y)),ii=(sy*w+sx)*4;return lumin(buf[ii],buf[ii+1],buf[ii+2]);}
  var out=new Float32Array(buf.length),str=s||4;
  for(var y=0;y<h;y++)for(var x=0;x<w;x++){
    var dx=(ht(x+1,y)-ht(x-1,y))*str,dy=(ht(x,y+1)-ht(x,y-1))*str,dz=1,len=Math.sqrt(dx*dx+dy*dy+dz*dz),oi=(y*w+x)*4;
    out[oi]=(dx/len+1)*0.5;out[oi+1]=(dy/len+1)*0.5;out[oi+2]=(dz/len+1)*0.5;out[oi+3]=buf[oi+3];
  }
  for(var i=0;i<buf.length;i++)buf[i]=out[i];
}
function fSharpen(buf,w,h,s){var q=s||0.5;conv3s(buf,w,h,[0,-q,0,-q,1+4*q,-q,0,-q,0],0);}
function fEmboss(buf,w,h,s,ang){
  var a=(ang!=null?ang:45)*Math.PI/180,c=Math.cos(a),sn=Math.sin(a),str=s||1;
  conv3s(buf,w,h,[(-c-sn)*str,-sn*str,(c-sn)*str,-c*str,1*str,c*str,(-c+sn)*str,sn*str,(c+sn)*str],0.5);
}
function fPosterize(buf,w,h,L){var lv=Math.max(2,Math.round(L));for(var i=0;i<h*w;i++){var ii=i*4;buf[ii]=Math.round(buf[ii]*(lv-1))/(lv-1);buf[ii+1]=Math.round(buf[ii+1]*(lv-1))/(lv-1);buf[ii+2]=Math.round(buf[ii+2]*(lv-1))/(lv-1);}}
function fThreshold(buf,w,h,cut,soft){var c=cut||0.5,s=Math.max(0.001,soft||0.02);for(var i=0;i<h*w;i++){var ii=i*4,Lv=lumin(buf[ii],buf[ii+1],buf[ii+2]),v=clamp((Lv-c+s)/(2*s));buf[ii]=v;buf[ii+1]=v;buf[ii+2]=v;}}
function fAutoLevels(buf,w,h){
  var n=w*h;
  // black/white points from luminance (ignore 0.2% tail each side)
  var bins=256,hist=new Float32Array(bins);
  for(var i=0;i<n;i++){var ii=i*4;var L=buf[ii]*0.299+buf[ii+1]*0.587+buf[ii+2]*0.114;var bi=L<0?0:L>=1?255:(L*255)|0;hist[bi]++;}
  var tail=Math.max(1,Math.floor(n*0.002)),lo=0,hi=255,acc=0;
  for(var a=0;a<bins;a++){acc+=hist[a];if(acc>tail){lo=a;break;}}
  acc=0;for(var b=bins-1;b>=0;b--){acc+=hist[b];if(acc>tail){hi=b;break;}}
  lo/=255;hi/=255;
  var range=hi-lo;
  if(range<0.004)return; // already flat or single tone — nothing to stretch
  var inv=1/range;
  for(var i=0;i<n;i++){var ii=i*4;
    buf[ii]=clamp((buf[ii]-lo)*inv);
    buf[ii+1]=clamp((buf[ii+1]-lo)*inv);
    buf[ii+2]=clamp((buf[ii+2]-lo)*inv);
  }
}
function fHistoEq(buf,w,h){var hist=new Float32Array(256),n=w*h;for(var i=0;i<n;i++){var ii=i*4;hist[Math.min(255,lumin(buf[ii],buf[ii+1],buf[ii+2])*255|0)]++;}var cdf=new Float32Array(256),acc=0;for(var i=0;i<256;i++){acc+=hist[i];cdf[i]=acc/n;}for(var i=0;i<n;i++){var ii=i*4,m=cdf[Math.min(255,lumin(buf[ii],buf[ii+1],buf[ii+2])*255|0)];buf[ii]=m;buf[ii+1]=m;buf[ii+2]=m;}}
function fCurv(buf,w,h,s){var q=s||1;conv3s(buf,w,h,[0,q,0,q,-4*q,q,0,q,0],0.5);}
function fBevel(buf,w,h,s,br){var tmp=buf.slice();gaussBlur(tmp,w,h,Math.round(br||3));fEmboss(tmp,w,h,s||1,45);for(var i=0;i<h*w;i++){var ii=i*4;buf[ii]=1-(1-buf[ii])*(1-tmp[ii]*0.8);buf[ii+1]=1-(1-buf[ii+1])*(1-tmp[ii+1]*0.8);buf[ii+2]=1-(1-buf[ii+2])*(1-tmp[ii+2]*0.8);}}

// ── Alpha edge bleed (dilate) ────────────────────────────────────
// Fills RGB of (near-)transparent pixels with a coverage-weighted average of
// opaque neighbours. Stops dark halos at alpha edges when the canvas is scaled.
// passes = how far the colour spreads. Operates in place.
function bleedAlphaEdges(buf,w,h,passes){
  passes=Math.max(1,passes||2);
  var src=new Float32Array(buf.length);
  for(var p=0;p<passes;p++){
    src.set(buf);
    for(var y=0;y<h;y++){
      for(var x=0;x<w;x++){
        var i=(y*w+x)*4;
        if(src[i+3]>0.5)continue; // already opaque-ish, keep its colour
        var r=0,g=0,b=0,wsum=0;
        for(var oy=-1;oy<=1;oy++){
          var yy=y+oy; if(yy<0||yy>=h)continue;
          for(var ox=-1;ox<=1;ox++){
            var xx=x+ox; if(xx<0||xx>=w)continue;
            var j=(yy*w+xx)*4, aw=src[j+3];
            if(aw<=src[i+3])continue; // only pull from MORE opaque neighbours
            r+=src[j]*aw; g+=src[j+1]*aw; b+=src[j+2]*aw; wsum+=aw;
          }
        }
        if(wsum>0){ buf[i]=r/wsum; buf[i+1]=g/wsum; buf[i+2]=b/wsum; }
      }
    }
  }
}

// ── FXAA: edge-aware anti-aliasing ───────────────────────────────
// Approximate FXAA: where local luma contrast is high (an edge), blend the
// pixel toward the average along the perceived edge direction. Flat regions
// (low contrast) are left untouched, so detail is preserved while hard stair-
// step edges soften. strength scales the blend (0..1.5). Samples wrap for tiling.
function fFXAA(buf,w,h,strength){
  var amt=strength!=null?strength:1; if(amt<=0)return;
  var src=new Float32Array(buf.length); src.set(buf);
  var EDGE_MIN=0.03, EDGE_MAX=0.20; // contrast thresholds
  function L(x,y){
    var xx=((x%w)+w)%w, yy=((y%h)+h)%h, i=(yy*w+xx)*4;
    return src[i]*0.299+src[i+1]*0.587+src[i+2]*0.114;
  }
  for(var y=0;y<h;y++){
    for(var x=0;x<w;x++){
      var lC=L(x,y),lN=L(x,y-1),lS=L(x,y+1),lW=L(x-1,y),lE=L(x+1,y);
      var lMin=Math.min(lC,lN,lS,lW,lE), lMax=Math.max(lC,lN,lS,lW,lE);
      var range=lMax-lMin;
      // Skip flat areas — no edge, no AA
      if(range<EDGE_MIN){continue;}
      // Edge orientation: compare horizontal vs vertical gradients
      var gH=Math.abs(lW+lE-2*lC), gV=Math.abs(lN+lS-2*lC);
      var blend=Math.min(1,(range-EDGE_MIN)/(EDGE_MAX-EDGE_MIN))*amt;
      blend=blend>1?1:blend;
      var i=(y*w+x)*4;
      // Sample the two neighbors ACROSS the edge (perpendicular = where the
      // stair-step is) and average. Horizontal edge → blend vertically.
      var ax,ay,bx,by;
      if(gV>=gH){ ax=x;ay=y-1; bx=x;by=y+1; } // vertical gradient → smooth N/S
      else      { ax=x-1;ay=y; bx=x+1;by=y; } // horizontal gradient → smooth W/E
      var aox=((ax%w)+w)%w, aoy=((ay%h)+h)%h, ai=(aoy*w+aox)*4;
      var box=((bx%w)+w)%w, boy=((by%h)+h)%h, bi=(boy*w+box)*4;
      for(var c=0;c<4;c++){
        var avg=(src[ai+c]+src[bi+c])*0.5;
        buf[i+c]=src[i+c]+(avg-src[i+c])*blend;
      }
    }
  }
}

// ── Radial Blur ───────────────────────────────────────────────────
// Blur radiating from center — each pixel smears toward/from center
function fRadialBlur(buf,w,h,samples,amount,cxN,cyN){
  samples=Math.max(2,Math.round(samples||8));
  amount=amount||0.3;
  var out=new Float32Array(buf.length);
  var cx=w*(cxN!=null?cxN:0.5),cy=h*(cyN!=null?cyN:0.5);
  for(var y=0;y<h;y++)for(var x=0;x<w;x++){
    var r=0,g=0,b=0,a=0;
    var dx=x-cx,dy=y-cy;
    for(var s=0;s<samples;s++){
      var t=s/(samples-1)*amount;
      var sx=Math.max(0,Math.min(w-1,Math.round(cx+dx*(1-t)))|0);
      var sy=Math.max(0,Math.min(h-1,Math.round(cy+dy*(1-t)))|0);
      var ii=(sy*w+sx)*4;
      r+=buf[ii];g+=buf[ii+1];b+=buf[ii+2];a+=buf[ii+3];
    }
    var oi=(y*w+x)*4;
    out[oi]=r/samples;out[oi+1]=g/samples;out[oi+2]=b/samples;out[oi+3]=a/samples;
  }
  for(var i=0;i<buf.length;i++)buf[i]=out[i];
}

// ── Slope Blur ────────────────────────────────────────────────────
// Blur direction driven by luminance gradient (like SD Slope Blur)
function fSlopeBlur(buf,w,h,samples,amount,mode){
  samples=Math.max(2,Math.round(samples||8));
  amount=amount||8;
  var out=new Float32Array(buf.length);
  function lum(x,y){var ii=(y*w+x)*4;return 0.299*buf[ii]+0.587*buf[ii+1]+0.114*buf[ii+2];}
  var e=1;
  for(var y=0;y<h;y++)for(var x=0;x<w;x++){
    // Gradient of luminance at this pixel
    var gx=lum(Math.min(w-1,x+e),y)-lum(Math.max(0,x-e),y);
    var gy=lum(x,Math.min(h-1,y+e))-lum(x,Math.max(0,y-e));
    var len=Math.sqrt(gx*gx+gy*gy)||1;
    if(mode==="tangent"){var tmp=gx;gx=-gy;gy=tmp;len=Math.sqrt(gx*gx+gy*gy)||1;}
    var r=0,g=0,b=0,a=0;
    for(var s=0;s<samples;s++){
      var t=(s/(samples-1)-0.5)*amount;
      var sx=Math.max(0,Math.min(w-1,Math.round(x+gx/len*t))|0);
      var sy=Math.max(0,Math.min(h-1,Math.round(y+gy/len*t))|0);
      var ii=(sy*w+sx)*4;
      r+=buf[ii];g+=buf[ii+1];b+=buf[ii+2];a+=buf[ii+3];
    }
    var oi=(y*w+x)*4;
    out[oi]=r/samples;out[oi+1]=g/samples;out[oi+2]=b/samples;out[oi+3]=a/samples;
  }
  for(var i=0;i<buf.length;i++)buf[i]=out[i];
}

// ── Chromatic Aberration ──────────────────────────────────────────
// Offset R/G/B channels radially from center (lens CA simulation)
function fChromaticAb(buf,w,h,amount,mode){
  if(!buf)return;
  amount=amount||5;
  var out=new Float32Array(buf.length); // fresh output, not a slice (avoids any ref issues)
  var cx=w*0.5,cy=h*0.5;
  var wm1=w-1,hm1=h-1;
  var isBarrel=mode!=="lateral";
  var sc=amount*0.012; // barrel scale
  var sh=Math.round(amount*0.5); // lateral shift in pixels
  for(var y=0;y<h;y++){
    for(var x=0;x<w;x++){
      var oi=(y*w+x)*4;
      var srxR,sryR,srxB,sryB; // source positions for R and B channels
      if(isBarrel){
        var dx=(x-cx)/w,dy=(y-cy)/h;
        srxR=cx+(dx*(1+sc))*w; sryR=cy+(dy*(1+sc))*h;
        srxB=cx+(dx*(1-sc))*w; sryB=cy+(dy*(1-sc))*h;
      } else {
        srxR=x-sh; sryR=y;
        srxB=x+sh; sryB=y;
      }
      // Sample R from expanded/left-shifted position
      var sxR=srxR<0?0:srxR>wm1?wm1:Math.round(srxR)|0;
      var syR=sryR<0?0:sryR>hm1?hm1:Math.round(sryR)|0;
      out[oi  ]=buf[(syR*w+sxR)*4];
      // G unchanged
      out[oi+1]=buf[oi+1];
      // Sample B from contracted/right-shifted position
      var sxB=srxB<0?0:srxB>wm1?wm1:Math.round(srxB)|0;
      var syB=sryB<0?0:sryB>hm1?hm1:Math.round(sryB)|0;
      out[oi+2]=buf[(syB*w+sxB)*4+2];
      // Alpha always preserved
      out[oi+3]=buf[oi+3];
    }
  }
  for(var i=0;i<buf.length;i++)buf[i]=out[i];
}

// ── Make Tileable — improved 4-way bilinear + optional 2nd pass ─────
// Pass 1: 4-way bilinear with quintic smoothstep (minimal Gibbs ringing).
// Pass 2 (when passes=2): second offset by (w/4, h/4) to smooth the
// residual artifacts that appear at 1/4 positions after pass 1.
// Default blendWidth 32%: enough to cover seams without visible blur.
function fMakeTileable(buf,w,h,blendWidth,passes){
  passes=passes||1;
  blendWidth=Math.max(4,Math.round(blendWidth!=null?blendWidth:w*0.32));
  function quintic(t){return t*t*t*(t*(t*6-15)+10);}

  function onePass(b,ox,oy){
    // ox,oy: offset in pixels (half of w,h for main pass; quarter for 2nd pass)
    var out=new Float32Array(b.length);
    var hw=ox||w>>1,hh=oy||h>>1;
    for(var y=0;y<h;y++){
      // Distance from nearest vertical seam — seams at y=0 and y=h
      var ey=Math.min(y,h-1-y);
      var wy=ey>=blendWidth?1.0:quintic(ey/blendWidth);
      for(var x=0;x<w;x++){
        var ex=Math.min(x,w-1-x);
        var wx=ex>=blendWidth?1.0:quintic(ex/blendWidth);
        var x2=(x+hw)%w,y2=(y+hh)%h;
        var i1=(y *w+x )*4,i2=(y *w+x2)*4;
        var i3=(y2*w+x )*4,i4=(y2*w+x2)*4;
        var wx1=1-wx,wy1=1-wy,oi=i1;
        out[oi  ]=b[i1  ]*wx*wy+b[i2  ]*wx1*wy+b[i3  ]*wx*wy1+b[i4  ]*wx1*wy1;
        out[oi+1]=b[i1+1]*wx*wy+b[i2+1]*wx1*wy+b[i3+1]*wx*wy1+b[i4+1]*wx1*wy1;
        out[oi+2]=b[i1+2]*wx*wy+b[i2+2]*wx1*wy+b[i3+2]*wx*wy1+b[i4+2]*wx1*wy1;
        out[oi+3]=b[i1+3];
      }
    }
    for(var i=0;i<b.length;i++)b[i]=out[i];
  }

  onePass(buf,w>>1,h>>1);
  if(passes>=2){
    // Second pass at quarter-offset: targets the 1/4-point artifacts
    // Use half the blend width to avoid over-blurring
    var bw2=Math.max(2,blendWidth>>1);
    var tmp=new Float32Array(buf.length);for(var i=0;i<buf.length;i++)tmp[i]=buf[i];
    var out2=new Float32Array(buf.length);
    var qw=w>>2,qh=h>>2;
    var qs=Math.max(2,bw2);
    for(var y=0;y<h;y++){
      var ey=(y+qh)%h;ey=Math.min(ey,h-1-ey);
      var wy=ey>=qs?1.0:quintic(ey/qs);
      for(var x=0;x<w;x++){
        var ex=(x+qw)%w;ex=Math.min(ex,w-1-ex);
        var wx2=ex>=qs?1.0:quintic(ex/qs);
        var x2=(x+qw)%w,y2=(y+qh)%h;
        var i1=(y*w+x)*4,i2=(y*w+x2)*4,i3=(y2*w+x)*4,i4=(y2*w+x2)*4;
        var wx1=1-wx2,wy1=1-wy,oi=i1;
        out2[oi  ]=tmp[i1  ]*wx2*wy+tmp[i2  ]*wx1*wy+tmp[i3  ]*wx2*wy1+tmp[i4  ]*wx1*wy1;
        out2[oi+1]=tmp[i1+1]*wx2*wy+tmp[i2+1]*wx1*wy+tmp[i3+1]*wx2*wy1+tmp[i4+1]*wx1*wy1;
        out2[oi+2]=tmp[i1+2]*wx2*wy+tmp[i2+2]*wx1*wy+tmp[i3+2]*wx2*wy1+tmp[i4+2]*wx1*wy1;
        out2[oi+3]=tmp[i1+3];
      }
    }
    for(var i=0;i<buf.length;i++)buf[i]=out2[i];
  }
}

// ── Math-tiling feasibility ──────────────────────────────────────
// Math (lattice) tiling is only mathematically valid when every sampling
// step is periodic in UV. This helper is the single source of truth used by
// BOTH the renderer (to auto-fall-back to edge blending) and the UI (to tell
// the user why). Returns null when math tiling is valid, else a short reason.
var _MATH_TILEABLE={perlin:1,value:1,fbm:1,domainWarp:1,curl:1,white:1,blue:1,
  worley:1,voronoi:1,crystals:1,iqcell:1,caustics:1,cloud:1,plasma:1,wood:1,
  marble:1,gabor:1,sparse:1,gaussian:1,highpass:1,directional:1,
  scratches:1,sparkle:1,truchet:1,dust:1,debris:1,grain:1,hex:1};
// UV warp types whose fields can be made periodic (see distDelta): OK for math
// tiling. Center-based warps (swirl/pinch/...) are inherently non-periodic.
var _PERIODIC_DISTS={noise:1,fbmNoise:1,fbm:1,ridged:1,turbulence:1,voronoi:1,ripple:1,none:1};
function mathTileBlocker(L){
  var t=L.type||"perlin";
  if(!_MATH_TILEABLE[t]){
    // Angle-driven types tile only at angle 0 (their internal rotation
    // otherwise breaks square-lattice periodicity)
    var angleTypes={fiber:1,streaks:1,crosshatch:1,rippleDir:1,flowLines:1,waveStroke:1};
    if(angleTypes[t]&&!(L.fiberAngle||0))return null;
    return "this noise type";
  }
  if(L.rotation)return "rotation";
  if(L.skewX||L.skewY)return "skew";
  var ds=L.uvDists||[];
  for(var i=0;i<ds.length;i++){
    var d=ds[i];
    if(d&&d.type&&d.type!=="none"&&(d.amt||0)>0&&!_PERIODIC_DISTS[d.type])
      return "the \""+d.type+"\" warp";
  }
  return null;
}

// Cross-blend: apply seamless 4-way blend to a layer buffer (post-process)
// Used when seamlessMode === "blend" — works with ANY noise type
function applyLayerCrossBlend(buf,size,blendPct){
  var bw=Math.max(4,Math.round(size*Math.min(0.48,blendPct!=null?blendPct:0.28)));
  fMakeTileable(buf,size,size,bw);
}

// ── Polar Transform ───────────────────────────────────────────────
// Wrap texture into polar/cartesian space
function fPolarTransform(buf,w,h,mode){
  var out=new Float32Array(buf.length);
  function sampleBilinear(ux,uy){
    var px=((ux%1+1)%1)*w,py=((uy%1+1)%1)*h;
    var x0=Math.floor(px)|0,y0=Math.floor(py)|0;
    var fx=px-x0,fy=py-y0;
    var x1=(x0+1)%w,y1=(y0+1)%h;
    var i00=(y0*w+x0)*4,i10=(y0*w+x1)*4,i01=(y1*w+x0)*4,i11=(y1*w+x1)*4;
    var r=lerp(lerp(buf[i00],buf[i10],fx),lerp(buf[i01],buf[i11],fx),fy);
    var g=lerp(lerp(buf[i00+1],buf[i10+1],fx),lerp(buf[i01+1],buf[i11+1],fx),fy);
    var b=lerp(lerp(buf[i00+2],buf[i10+2],fx),lerp(buf[i01+2],buf[i11+2],fx),fy);
    var a=lerp(lerp(buf[i00+3],buf[i10+3],fx),lerp(buf[i01+3],buf[i11+3],fx),fy);
    return[r,g,b,a];
  }
  for(var y=0;y<h;y++)for(var x=0;x<w;x++){
    var oi=(y*w+x)*4,px,py;
    if(mode==="toPolar"){
      var cx=(x/w-0.5)*2,cy=(y/h-0.5)*2;
      var r=Math.sqrt(cx*cx+cy*cy);
      var a=(Math.atan2(cy,cx)+Math.PI)/(2*Math.PI);
      px=a;py=r*0.5;
    } else {
      var a2=(x/w)*2*Math.PI,r2=(y/h);
      px=(Math.cos(a2)*r2*0.5+0.5);py=(Math.sin(a2)*r2*0.5+0.5);
    }
    var s=sampleBilinear(px,py);
    out[oi]=s[0];out[oi+1]=s[1];out[oi+2]=s[2];out[oi+3]=s[3];
  }
  for(var i=0;i<buf.length;i++)buf[i]=out[i];
}

// Apply UV distortion to a buffer before filter processing
// Creates a warped copy: each output pixel samples from a distorted input position
function applyFilterUVDist(buf,size,distType,amt,freq,seed){
  if(!distType||distType==="none"||!amt)return;
  var out=new Float32Array(buf.length);
  var inv=1/size;
  var dseed=seed||12345;
  for(var y=0;y<size;y++){
    for(var x=0;x<size;x++){
      var u=x*inv,v=y*inv;
      var dd=distDelta(u,v,distType,amt,freq||3,dseed,{});
      var su=u+dd[0],sv=v+dd[1];
      var sx=Math.max(0,Math.min(size-1,Math.round(su*size))|0);
      var sy=Math.max(0,Math.min(size-1,Math.round(sv*size))|0);
      var src=(sy*size+sx)*4,dst=(y*size+x)*4;
      out[dst]=buf[src];out[dst+1]=buf[src+1];out[dst+2]=buf[src+2];out[dst+3]=buf[src+3];
    }
  }
  for(var i=0;i<buf.length;i++)buf[i]=out[i];
}

// ── Hue / Saturation / Value adjustment ──────────────────────────
// hue in degrees (-180..180), sat and val as multipliers (1 = unchanged).
// Alpha untouched. Uses the same _hue2rgb as the layer hue path.
function fHueSat(buf,w,h,hue,sat,val){
  var hs=(hue||0)/360;
  var sm=sat!=null?sat:1, vm=val!=null?val:1;
  if(hs===0&&sm===1&&vm===1)return;
  for(var i=0;i<w*h;i++){
    var ii=i*4,r=buf[ii],g=buf[ii+1],b=buf[ii+2];
    var max=Math.max(r,g,b),min=Math.min(r,g,b),l=(max+min)*0.5,d=max-min,hh=0,s=0;
    if(d>0){
      s=l>0.5?d/(2-max-min):d/(max+min);
      if(max===r)hh=(g-b)/d+(g<b?6:0);
      else if(max===g)hh=(b-r)/d+2;
      else hh=(r-g)/d+4;
      hh/=6;
    }
    hh=(hh+hs+1)%1;
    s=Math.min(1,s*sm);
    l=Math.min(1,Math.max(0,l*vm));
    if(s===0){buf[ii]=l;buf[ii+1]=l;buf[ii+2]=l;continue;}
    var q=l<0.5?l*(1+s):l+s-l*s,p=2*l-q;
    buf[ii  ]=_hue2rgb(p,q,hh+0.3333);
    buf[ii+1]=_hue2rgb(p,q,hh);
    buf[ii+2]=_hue2rgb(p,q,hh-0.3333);
  }
}

// ── Brightness / Contrast / Gamma ────────────────────────────────
// brightness additive (-1..1), contrast multiplier around 0.5 pivot,
// gamma as power curve. Alpha untouched.
function fBrightCon(buf,w,h,bright,con,gam){
  var br=bright||0, cn=con!=null?con:1, gm=gam!=null?gam:1;
  if(br===0&&cn===1&&gm===1)return;
  var invG=1/gm;
  for(var i=0;i<w*h;i++){
    var ii=i*4;
    for(var c=0;c<3;c++){
      var v=(buf[ii+c]-0.5)*cn+0.5+br;
      v=v<0?0:v>1?1:v;
      if(gm!==1)v=Math.pow(v,invG);
      buf[ii+c]=v;
    }
  }
}

// ── Tint: straight per-channel multiply (1 = unchanged) ──────────
function fTint(buf,w,h,tr,tg,tb){
  var r=tr!=null?tr:1,g=tg!=null?tg:1,b=tb!=null?tb:1;
  if(r===1&&g===1&&b===1)return;
  for(var i=0;i<w*h;i++){
    var ii=i*4;
    buf[ii  ]=Math.min(1,buf[ii  ]*r);
    buf[ii+1]=Math.min(1,buf[ii+1]*g);
    buf[ii+2]=Math.min(1,buf[ii+2]*b);
  }
}

// ── Pixelize: hard nearest-neighbor blocks (point filtering, zero smoothing).
// Each block of ps×ps pixels takes the value of ONE point sample at the block
// center — exactly like rendering at low res and upscaling with point filter.
function fPixelize(buf,w,h,ps){
  ps=Math.max(2,Math.round(ps||8));
  var src=getBuf(buf.length);
  for(var i=0;i<buf.length;i++)src[i]=buf[i];
  for(var by=0;by<h;by+=ps){
    for(var bx=0;bx<w;bx+=ps){
      // Point sample at block center — sharp, no averaging
      var sx=Math.min(w-1,bx+(ps>>1)),sy=Math.min(h-1,by+(ps>>1));
      var si=(sy*w+sx)*4;
      var r=src[si],g=src[si+1],b=src[si+2],a=src[si+3];
      var yMax=Math.min(h,by+ps),xMax=Math.min(w,bx+ps);
      for(var y=by;y<yMax;y++){
        var row=y*w;
        for(var x=bx;x<xMax;x++){
          var oi=(row+x)*4;
          buf[oi]=r;buf[oi+1]=g;buf[oi+2]=b;buf[oi+3]=a;
        }
      }
    }
  }
  releaseBuf(src);
}

// ── Quantize: snap each RGB channel to N levels, with optional ordered
// (Bayer 4×4) dithering. dither=0 gives hard bands; dither=1 full retro
// dithering. Alpha untouched. Pairs with Pixelize for pixel-art looks.
var _BAYER4=[0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5]; // /16 at use site
function fQuantize(buf,w,h,levels,dither){
  var L=Math.max(2,Math.round(levels||4)),Lm=L-1;
  var d=dither||0;
  for(var y=0;y<h;y++){
    var row=y*w,byRow=(y&3)<<2;
    for(var x=0;x<w;x++){
      var ii=(row+x)*4;
      // Bayer threshold in [-0.5,0.5), scaled by dither amount
      var th=d?((_BAYER4[byRow|(x&3)]+0.5)/16-0.5)*d:0;
      var r=buf[ii]+th/Lm,g=buf[ii+1]+th/Lm,b=buf[ii+2]+th/Lm;
      buf[ii  ]=Math.round((r<0?0:r>1?1:r)*Lm)/Lm;
      buf[ii+1]=Math.round((g<0?0:g>1?1:g)*Lm)/Lm;
      buf[ii+2]=Math.round((b<0?0:b>1?1:b)*Lm)/Lm;
    }
  }
}

function applyGlobalAdjust(buf,size,st){
  var br=st.gBrightness||0, con=st.gContrast!=null?st.gContrast:1;
  var sat=st.gSaturation!=null?st.gSaturation:1, hue=(st.gHue||0)*Math.PI/180, vig=st.gVignette||0;
  var doTone=(br!==0||con!==1), doColor=(sat!==1||hue!==0), doVig=vig>0;
  if(!doTone&&!doColor&&!doVig)return;
  var n=size*size;
  // Hue rotation matrix coefficients (YIQ-style) computed once
  var cosH=Math.cos(hue),sinH=Math.sin(hue);
  for(var i=0;i<n;i++){
    var ii=i*4, r=buf[ii],g=buf[ii+1],b=buf[ii+2];
    if(doTone){
      r=(r-0.5)*con+0.5+br; g=(g-0.5)*con+0.5+br; b=(b-0.5)*con+0.5+br;
    }
    if(doColor){
      var L=0.299*r+0.587*g+0.114*b;
      // saturation: lerp from luma
      if(sat!==1){ r=L+(r-L)*sat; g=L+(g-L)*sat; b=L+(b-L)*sat; }
      if(hue!==0){
        // rotate chroma around luma axis (approx via YIQ I/Q)
        var I=0.596*r-0.274*g-0.322*b;
        var Q=0.211*r-0.523*g+0.312*b;
        var I2=I*cosH-Q*sinH, Q2=I*sinH+Q*cosH;
        var Y=0.299*r+0.587*g+0.114*b;
        r=Y+0.956*I2+0.621*Q2; g=Y-0.272*I2-0.647*Q2; b=Y-1.106*I2+1.703*Q2;
      }
    }
    if(doVig){
      var x=(i%size)/(size-1)-0.5, y=((i/size)|0)/(size-1)-0.5;
      var d=Math.sqrt(x*x+y*y)*1.41421356; // 0 center → ~1 corner
      var f=1-vig*d*d; if(f<0)f=0;
      r*=f; g*=f; b*=f;
    }
    buf[ii]=r<0?0:r>1?1:r; buf[ii+1]=g<0?0:g>1?1:g; buf[ii+2]=b<0?0:b>1?1:b;
  }
}
function applyGlobalFiltersPost(buf,size,globalLF){
  if(!globalLF||!globalLF.length)return;
  for(var i=0;i<globalLF.length;i++){if(globalLF[i]&&globalLF[i].enabled)applyFilter(buf,size,globalLF[i]);}
}
function applyFilter(buf,size,f){
  if(!f||!f.enabled)return;
  // Apply UV distortion BEFORE the filter if configured
  if(f.uvDistType&&f.uvDistType!=="none"&&(f.uvDistAmt||0)>0){
    applyFilterUVDist(buf,size,f.uvDistType,f.uvDistAmt||0,f.uvDistFreq||3,f.uvDistSeed||9999);
  }
  if(f.type==="edgeDetect") fEdge(buf,size,size,f.strength);
  else if(f.type==="normalMap") fNormal(buf,size,size,f.strength);
  else if(f.type==="sharpen")   fSharpen(buf,size,size,f.strength);
  else if(f.type==="fxaa")      fFXAA(buf,size,size,f.strength);
  else if(f.type==="emboss")    fEmboss(buf,size,size,f.strength,f.angle);
  else if(f.type==="posterize") fPosterize(buf,size,size,f.levels);
  else if(f.type==="threshold") fThreshold(buf,size,size,f.cutoff,f.softness);
  else if(f.type==="histoEq")   fHistoEq(buf,size,size);
  else if(f.type==="autoLevels") fAutoLevels(buf,size,size);
  else if(f.type==="edgeFade")  fEdgeFade(buf,size,size,f.falloff!=null?f.falloff:0.18);
  else if(f.type==="curvature") fCurv(buf,size,size,f.strength);
  else if(f.type==="bevel")     fBevel(buf,size,size,f.strength,f.blur);
  else if(f.type==="grayscale") for(var i=0;i<size*size;i++){var ii=i*4,L=lumin(buf[ii],buf[ii+1],buf[ii+2]);buf[ii]=L;buf[ii+1]=L;buf[ii+2]=L;}
  else if(f.type==="invert")    for(var i=0;i<size*size;i++){var ii=i*4;buf[ii]=1-buf[ii];buf[ii+1]=1-buf[ii+1];buf[ii+2]=1-buf[ii+2];}
  else if(f.type==="radialBlur")   fRadialBlur(buf,size,size,f.samples||8,f.amount||0.3,f.centerX,f.centerY);
  else if(f.type==="slopeBlur")    fSlopeBlur(buf,size,size,f.samples||8,f.amount||8,f.slopeMode||"gradient");
  else if(f.type==="chromatic")    fChromaticAb(buf,size,size,f.amount||5,f.caMode||"barrel");
  else if(f.type==="makeTileable") fMakeTileable(buf,size,size,f.blendWidth||0,f.passes||1);
  else if(f.type==="polarWrap")    fPolarTransform(buf,size,size,f.polarMode||"toPolar");
  else if(f.type==="directionalBlur") fDirectionalBlur(buf,size,size,f.samples||8,f.amount||30,f.angle||0);
  else if(f.type==="boxBlur")      fBoxBlur(buf,size,size,f.blur||4);
  else if(f.type==="zoomBlur")     fZoomBlur(buf,size,size,f.samples||8,f.amount||0.3,f.centerX,f.centerY);
  else if(f.type==="spinBlur")     fSpinBlur(buf,size,size,f.samples||8,f.angle||10,f.centerX,f.centerY);
  else if(f.type==="gaussBlur")    fGaussBlur(buf,size,size,f.blur||4);
  else if(f.type==="pixelize")     fPixelize(buf,size,size,f.pixelSize||8);
  else if(f.type==="quantize")     fQuantize(buf,size,size,f.levels||4,f.dither||0);
  else if(f.type==="hueSat")       fHueSat(buf,size,size,f.hue||0,f.saturation!=null?f.saturation:1,f.value!=null?f.value:1);
  else if(f.type==="brightCon")    fBrightCon(buf,size,size,f.brightness||0,f.contrast!=null?f.contrast:1,f.gamma!=null?f.gamma:1);
  else if(f.type==="tint")         fTint(buf,size,size,f.tintR!=null?f.tintR:1,f.tintG!=null?f.tintG:1,f.tintB!=null?f.tintB:1);
}

// ═══ PERMUTATION ════════════════════════════════════════════════
function buildPerm(seed){
  var p=[];for(var i=0;i<256;i++)p[i]=i;
  var s=((seed*1234567891+987654321)^0xdeadbeef)>>>0||1;
  for(var i=255;i>0;i--){s=(Math.imul(s,1664525)+1013904223)>>>0;var j=s%(i+1),t=p[i];p[i]=p[j];p[j]=t;}
  return p.concat(p);
}
// LRU cache for permutation tables.
// Each Uint8 perm table is 512 bytes; cap at 256 entries = 128KB max.
// Old approach (flush-all at 512) caused cache misses on every active
// layer/dist after a flush. LRU keeps recently-used seeds hot.
var _pc=new Map(); // Map preserves insertion order — perfect for LRU
var _PC_MAX=256;
function getPerm(seed){
  var p=_pc.get(seed);
  if(p!==undefined){
    // Touch: move to end (most recently used)
    _pc.delete(seed);
    _pc.set(seed,p);
    return p;
  }
  p=buildPerm(seed);
  _pc.set(seed,p);
  // Evict oldest entries if over capacity
  if(_pc.size>_PC_MAX){
    var firstKey=_pc.keys().next().value;
    _pc.delete(firstKey);
  }
  return p;
}var _G2X=[1,-1,1,-1,1,-1,0,0],_G2Y=[1,1,-1,-1,0,0,1,-1];
function grad2(h,x,y){var g=h&7;return _G2X[g]*x+_G2Y[g]*y;}

// Reusable fBm option objects — avoids allocation inside noise functions called per-pixel
var _foNorm4={base:"perlin",oct:4,lac:2,gain:0.5,mode:"normal"};
var _foNorm5={base:"perlin",oct:5,lac:2,gain:0.5,mode:"normal"};
var _foNorm6={base:"perlin",oct:6,lac:2,gain:0.5,mode:"normal"};
var _foBillow={base:"perlin",oct:5,lac:2,gain:0.5,mode:"billow"};
// Shared mutable options object for distDelta — module-scope so it's allocated once, not per pixel.
// distDelta is called up to size*size times per render when UV distortion is active.
var _distFo={base:"perlin",oct:4,lac:2,gain:0.5,mode:"normal"};
// HSL hue helper — module-scope so V8 can inline/optimize without closure capture.
function _hue2rgb(_hp,_hq,t){t=(t%1+1)%1;if(t<0.1667)return _hp+(_hq-_hp)*6*t;if(t<0.5)return _hq;if(t<0.6667)return _hp+(_hq-_hp)*(0.6667-t)*6;return _hp;}

// ═══ NOISE ══════════════════════════════════════════════════════
// tileX/tileY: if > 0, wrap cell indices for seamless tiling
function perlin(x,y,pm,tx,ty){
  var X0=Math.floor(x),Y0=Math.floor(y),xf=x-X0,yf=y-Y0;
  var u=xf*xf*xf*(xf*(xf*6-15)+10),v=yf*yf*yf*(yf*(yf*6-15)+10); // inline fade
  var X=tx>0?((X0%tx+tx)%tx):X0&255, Y=ty>0?((Y0%ty+ty)%ty):Y0&255;
  var X1=tx>0?((X+1)%tx):((X0+1)&255), Y1=ty>0?((Y+1)%ty):((Y0+1)&255);
  // Inline grad2 and lerp — avoids 8 function calls per pixel
  var h00=pm[(pm[X&255]+Y)&255]&7,h10=pm[(pm[X1&255]+Y)&255]&7;
  var h01=pm[(pm[X&255]+Y1)&255]&7,h11=pm[(pm[X1&255]+Y1)&255]&7;
  var g00=_G2X[h00]*xf   +_G2Y[h00]*yf;
  var g10=_G2X[h10]*(xf-1)+_G2Y[h10]*yf;
  var g01=_G2X[h01]*xf   +_G2Y[h01]*(yf-1);
  var g11=_G2X[h11]*(xf-1)+_G2Y[h11]*(yf-1);
  var ui=1-u;
  return (((g00*ui+g10*u)*(1-v)+(g01*ui+g11*u)*v)*0.5+0.5);
}
function valueNoise(x,y,pm,tx,ty){
  var X0=Math.floor(x),Y0=Math.floor(y),xf=x-X0,yf=y-Y0,u=fade(xf),v=fade(yf);
  var X=tx>0?((X0%tx+tx)%tx):X0&255, Y=ty>0?((Y0%ty+ty)%ty):Y0&255;
  var X1=tx>0?((X+1)%tx):((X0+1)&255), Y1=ty>0?((Y+1)%ty):((Y0+1)&255);
  return lerp(lerp(pm[(pm[X&255]+Y)&255]/255,pm[(pm[X1&255]+Y)&255]/255,u),lerp(pm[(pm[X&255]+Y1)&255]/255,pm[(pm[X1&255]+Y1)&255]/255,u),v);
}
function simplex2(x,y,pm,_tx,_ty){
  var F2=0.5*(Math.sqrt(3)-1),G2=(3-Math.sqrt(3))/6,s=(x+y)*F2,i=Math.floor(x+s),j=Math.floor(y+s),t_=(i+j)*G2;
  var x0=x-(i-t_),y0=y-(j-t_),i1=x0>y0?1:0,j1=x0>y0?0:1;
  var x1=x0-i1+G2,y1=y0-j1+G2,x2=x0-1+2*G2,y2=y0-1+2*G2;
  var ii=i&255,jj=j&255,n0=0,n1=0,n2=0;
  var t0=0.5-x0*x0-y0*y0;if(t0>=0){t0*=t0;n0=t0*t0*grad2(pm[ii+pm[jj]],x0,y0);}
  var t1=0.5-x1*x1-y1*y1;if(t1>=0){t1*=t1;n1=t1*t1*grad2(pm[ii+i1+pm[jj+j1]],x1,y1);}
  var t2=0.5-x2*x2-y2*y2;if(t2>=0){t2*=t2;n2=t2*t2*grad2(pm[ii+1+pm[jj+1]],x2,y2);}
  return clamp(0.5+35*(n0+n1+n2));
}
function fbm(x,y,pm,o,tx,ty){
  var val=0,a=0.5,f=1,tot=0;
  var mR=o.mode==="ridged",mA=o.mode==="turbulence"||o.mode==="billow";
  // Resolve noise fn once — avoids string compare inside hot octave loop
  var bfn=o.base==="value"?valueNoise:o.base==="simplex"?simplex2:perlin;
  var useTile=tx||ty; // only pass tile params if needed
  // TILING RELIABILITY: octave tile period is tx*lac^i. The lattice wrap only
  // works with INTEGER periods, so a non-integer lacunarity (e.g. 2.1) breaks
  // every octave above the first → seams. Snap lacunarity in tiled mode only;
  // non-tiled output is untouched.
  var lacE=useTile?Math.max(2,Math.round(o.lac||2)):(o.lac||2);
  // Per-octave lattice offsets — empirically tuned. With integer lacunarity
  // all octave lattices align on integer gridlines, where variance drops to
  // ~60% (a faint axis-aligned grid in the texture). Offsets spread each
  // octave's low-variance lines across the cell: measured worst-case
  // variance spread improves from 3.2x to 1.8x. Constant offsets preserve
  // seamless tiling exactly. Full elimination would need per-octave domain
  // rotation, which would break tiling — not worth it for this tool.
  var ox=5.733,oy=3.056;
  for(var i=0;i<o.oct;i++){
    var n=useTile?bfn(x*f+ox,y*f+oy,pm,tx?tx*f:0,ty?ty*f:0):bfn(x*f+ox,y*f+oy,pm,0,0);
    if(mR)n=1-Math.abs(n*2-1);else if(mA)n=Math.abs(n*2-1);
    val+=n*a;tot+=a;f*=lacE;a*=o.gain;
    ox+=9.317;oy+=4.966;
  }
  return val/tot;
}
var _foWarp={base:"perlin",oct:5,lac:2,gain:0.5,mode:"normal"};
// o = {base,oct,lac,gain,warpStr, levels(1|2), warp2(0..3), mode("normal"|"ridged"|"swirl")}
//   levels=2 adds Inigo Quilez "warp of warp" for highly organic flow
//   warp2  : strength of the second warp level
//   mode   : applies a final shaping (ridged = |2v-1| ridges; swirl boosts q)
// Tiling: warp offsets come from fBm at the same tile period, so wrapping holds.
function domWarp(x,y,pm,o,tx,ty){
  _foWarp.base=o.base;_foWarp.oct=o.oct;_foWarp.lac=o.lac;_foWarp.gain=o.gain;
  _foWarp.mode=(o.mode==="ridged")?"ridged":"normal";
  var levels=o.levels||1, warp2=o.warp2!=null?o.warp2:0.8, swirl=o.mode==="swirl";
  // Level 1 warp vector
  var qx=fbm(x,y,pm,_foWarp,tx,ty),qy=fbm(x+5.2,y+1.3,pm,_foWarp,tx,ty);
  var wx=x+o.warpStr*(qx-0.5)*2, wy=y+o.warpStr*(qy-0.5)*2;
  if(levels>=2){
    // Level 2: warp the warped coords again (IQ pattern)
    var rx=fbm(wx+1.7,wy+9.2,pm,_foWarp,tx,ty), ry=fbm(wx+8.3,wy+2.8,pm,_foWarp,tx,ty);
    var w2=warp2*(swirl?1.4:1);
    wx+=o.warpStr*w2*(rx-0.5)*2; wy+=o.warpStr*w2*(ry-0.5)*2;
  }
  var v=fbm(wx,wy,pm,_foWarp,tx,ty);
  return v;
}
function cellHash(cx,cy,seed){var h=(Math.imul(cx,1619)^Math.imul(cy,31337)^Math.imul(seed|1,1000003))|0;h=Math.imul(h^(h>>>17),0x45d9f3b);return(h^(h>>>13))>>>0;}
// Map a worley result (wr) + mode + contrast to a 0..1 value. One place so the
// perf render path and the thumbnail path can never drift apart.
function worleyValue(wr,mode,scale){
  var s=scale||1;
  if(mode==="f1")        return clamp(1-wr.d1*1.8*s);
  if(mode==="f2")        return clamp(1-wr.d2*1.4*s);
  if(mode==="f3")        return clamp(1-wr.d3*1.1*s);          // third-nearest: layered look
  if(mode==="f2-f1")     return clamp((wr.d2-wr.d1)*3.5*s);    // cracks / edges
  if(mode==="f3-f1")     return clamp((wr.d3-wr.d1)*2.0*s);    // wider borders
  if(mode==="f1+f2")     return clamp(1-(wr.d1+wr.d2)*0.7*s);
  if(mode==="f1*f2")     return clamp(1-(wr.d1*wr.d2)*2.2*s);
  if(mode==="smooth")    return clamp(1-wr.sd1*1.8*s);         // smooth-min: rounded blobs
  if(mode==="smoothCracks")return clamp((wr.d2-wr.sd1)*3.2*s); // soft organic cracks
  if(mode==="cell")      return wr.cell;                       // flat per-cell value
  if(mode==="cellEdges") return clamp(1-(wr.d2-wr.d1)*3.5*s);  // inverted f2-f1: bright cells, dark edges
  if(mode==="cellShaded")return clamp(wr.cell*(1-wr.d1*1.2*s)+0.05); // per-cell value with a falloff
  if(mode==="cellRound") return clamp(wr.cell*(1-wr.sd1*1.0*s)+0.05); // per-cell value, rounded falloff
  if(mode==="edges")     return clamp(1-wr.edge*6*s);                 // TRUE uniform-width borders (bright lines)
  if(mode==="edgesInv")  return clamp(wr.edge*6*s);                   // uniform borders, dark lines on bright cells
  if(mode==="cellWalls") return clamp(wr.cell*clamp(wr.edge*5*s));     // per-cell tone with crisp uniform walls
  return clamp(1-wr.d1*1.8*s);
}
function cellDist(dx,dy,metric){if(metric==="manhattan")return Math.abs(dx)+Math.abs(dy);if(metric==="chebyshev")return Math.max(Math.abs(dx),Math.abs(dy));if(metric==="mink3")return Math.pow(Math.pow(Math.abs(dx),3)+Math.pow(Math.abs(dy),3),1/3);return Math.hypot(dx,dy);}
var _wrOut={d1:0,d2:0,d3:0,sd1:0,edge:0,cell:0,fhx:0,fhy:0};
// r=1: 3x3 search (F1 only, euclidean), r=2: 5x5 (F2 or non-euclidean)
// jit: 0..1 controls how far each feature point strays from its cell center
// (1 = classic random Worley, 0 = perfectly regular grid). Default 1.
// Tracks the F1 cell hash (for per-cell colour) and the F1 feature point so
// callers can compute a cheap cell-edge distance. Tiling preserved: cell
// indices still wrap modulo tx/ty so opposite borders share feature points.
var _cwOut=[0,0];
function cellWarp(nx,ny,seed,amt,tx,ty){
  // Two decorrelated fbm fields drive x/y displacement. Tile-safe: fbm wraps at
  // tx/ty so the warped field tiles too. amt is in cell units.
  if(!amt){_cwOut[0]=nx;_cwOut[1]=ny;return _cwOut;}
  var fo=_foNorm4;
  var wx=fbm(nx*0.5+11.3,ny*0.5+5.7,"perlin",fo,tx?tx*0.5:0,ty?ty*0.5:0)-0.5;
  var wy=fbm(nx*0.5+2.1,ny*0.5+9.4,"perlin",fo,tx?tx*0.5:0,ty?ty*0.5:0)-0.5;
  _cwOut[0]=nx+wx*amt*2;_cwOut[1]=ny+wy*amt*2;return _cwOut;
}
function worley(nx,ny,seed,metric,tx,ty,r,jit,smooth,edge){
  var cx0=Math.floor(nx),cy0=Math.floor(ny),d1=1e9,d2=1e9,d3=1e9;
  var R=r||2;
  var J=jit==null?1:jit;
  var SM=smooth||0; // 0 = hard cells, >0 = smooth-min blends nearby points (rounded/organic)
  var EDGE=!!edge;  // when true, compute the TRUE Voronoi edge distance (uniform-width borders)
  var euclid=metric!=="manhattan"&&metric!=="chebyshev"&&metric!=="mink3";
  var f1h=0,f1px=0,f1py=0;
  // For smooth-min we need actual distances (not squared) accumulated softly.
  var smAcc=0,smW=0;
  for(var dy=-R;dy<=R;dy++)for(var dx=-R;dx<=R;dx++){
    var cx=cx0+dx,cy=cy0+dy;
    var wcx=tx>0?((cx%tx+tx)%tx):cx,wcy=ty>0?((cy%ty+ty)%ty):cy;
    var h=cellHash(wcx,wcy,seed);
    // jitter blends from cell-center (0.5,0.5) toward the random position
    var jx=0.5+((h&0xffff)/65535-0.5)*J, jy=0.5+(((h>>>16)&0xffff)/65535-0.5)*J;
    var px=cx+jx,py=cy+jy;
    var ddx=nx-px,ddy=ny-py;
    var d;
    if(euclid)d=ddx*ddx+ddy*ddy; // compare d² — sqrt only the winners at the end
    else if(metric==="manhattan")d=Math.abs(ddx)+Math.abs(ddy);
    else if(metric==="chebyshev")d=Math.abs(ddx)>Math.abs(ddy)?Math.abs(ddx):Math.abs(ddy);
    else d=Math.pow(Math.pow(Math.abs(ddx),3)+Math.pow(Math.abs(ddy),3),0.3333);
    // track three nearest (d1<=d2<=d3)
    if(d<d1){d3=d2;d2=d1;d1=d;f1h=cellHash(wcx+1337,wcy+7919,seed^0xbeef);f1px=px;f1py=py;}
    else if(d<d2){d3=d2;d2=d;}
    else if(d<d3){d3=d;}
    if(SM>0){var dd=euclid?Math.sqrt(d):d;var w=Math.exp(-dd/Math.max(0.02,SM));smAcc+=dd*w;smW+=w;}
  }
  // TRUE edge distance (Inigo Quilez): second pass over the same neighbourhood,
  // distance from the sample to the perpendicular bisector between F1's point and
  // each other point. The minimum is the distance to the nearest Voronoi border,
  // giving borders of uniform width (unlike F2-F1 which thins at triple points).
  var edgeD=1e9;
  if(EDGE){
    for(var ey=-R;ey<=R;ey++)for(var ex=-R;ex<=R;ex++){
      var ecx=cx0+ex,ecy=cy0+ey;
      var ewcx=tx>0?((ecx%tx+tx)%tx):ecx,ewcy=ty>0?((ecy%ty+ty)%ty):ecy;
      var eh=cellHash(ewcx,ewcy,seed);
      var ejx=0.5+((eh&0xffff)/65535-0.5)*J, ejy=0.5+(((eh>>>16)&0xffff)/65535-0.5)*J;
      var epx=ecx+ejx,epy=ecy+ejy;
      var rx=epx-f1px, ry=epy-f1py;
      var rl=rx*rx+ry*ry;
      if(rl<1e-7)continue; // this is F1 itself (or coincident)
      // distance from sample to the bisector plane between F1 and this point
      var mx=(f1px+epx)*0.5, my=(f1py+epy)*0.5;
      var rlen=Math.sqrt(rl);
      var nrx=rx/rlen, nry=ry/rlen;
      var ed=(nx-mx)*nrx+(ny-my)*nry;
      if(ed<edgeD)edgeD=ed;
    }
    if(edgeD<0)edgeD=0;
  }
  if(euclid){d1=Math.sqrt(d1);d2=Math.sqrt(d2);d3=Math.sqrt(d3);}
  // Smooth F1: weighted soft-min of all distances → rounded, blobby cells.
  var sd1=(SM>0&&smW>0)?(smAcc/smW):d1;
  _wrOut.d1=d1;_wrOut.d2=d2;_wrOut.d3=d3;_wrOut.sd1=sd1;_wrOut.edge=EDGE?edgeD:(d2-d1);
  _wrOut.cell=(f1h&0xffffff)/0xffffff;_wrOut.fhx=f1px;_wrOut.fhy=f1py;return _wrOut;
}
// Curl noise - uses fBm potential field, returns magnitude or angular
var _foCurl={base:"perlin",oct:4,lac:2,gain:0.5,mode:"normal"};
// o = {scale, mode("magnitude"|"angular"|"x"|"y"|"flow"|"swirl"), oct(1..6)}
//   flow  : samples fBm advected along the curl field → silky flow streaks
//   swirl : magnitude of a higher-octave curl for tighter vortices
function curlNoise(x,y,pm,scale,o,tx,ty){
  var mode,oct;
  if(typeof o==="object"&&o){mode=o.mode||"magnitude";oct=o.oct||4;}
  else {mode=o||"magnitude";oct=4;}     // back-compat: o may be a mode string
  var e=0.0005;
  _foCurl.oct=Math.max(1,Math.round(oct));var fo=_foCurl;
  var p1_dy=(fbm(x,y+e,pm,fo,tx,ty)-fbm(x,y-e,pm,fo,tx,ty))/(2*e);
  var p1_dx=(fbm(x+e,y,pm,fo,tx,ty)-fbm(x-e,y,pm,fo,tx,ty))/(2*e);
  var vx=p1_dy*scale, vy=-p1_dx*scale;
  if(mode==="angular") return (Math.atan2(vy,vx)+Math.PI)/(2*Math.PI);
  if(mode==="x")       return clamp(vx*0.5+0.5);
  if(mode==="y")       return clamp(vy*0.5+0.5);
  if(mode==="flow"){
    // advect a sample point a small step along the curl, read fBm there → streaks.
    // step magnitude scaled so it stays well under one tile cell (seamless-safe).
    var L=Math.hypot(vx,vy)+1e-6, sx=vx/L, sy=vy/L;
    var step=0.06;
    var s1=fbm(x+sx*step,y+sy*step,pm,fo,tx,ty);
    var s2=fbm(x-sx*step,y-sy*step,pm,fo,tx,ty);
    return clamp((s1+s2)*0.5);
  }
  if(mode==="swirl") return clamp(Math.hypot(vx,vy)*1.4);
  return clamp(Math.hypot(vx,vy));
}

// Voronoi: like Worley F1 but each cell gets a unique random value
// Great for rock/pebble/cell-coloring patterns
// varMode: "flat" (one value per cell), "dist" (darken toward cell edges),
// "radial" (bright center fading out), "smooth" (cell value modulated by F1).
function voronoiNoise(nx,ny,seed,metric,tx,ty,jit,varMode,contrast){
  var cx0=Math.floor(nx),cy0=Math.floor(ny),d1=1e9,d2=1e9,cellVal=0,bestPx=0,bestPy=0;
  var J=jit==null?1:jit;
  var euclid=metric!=="manhattan"&&metric!=="chebyshev"&&metric!=="mink3";
  for(var dy=-2;dy<=2;dy++)for(var dx=-2;dx<=2;dx++){
    var cx=cx0+dx,cy=cy0+dy;
    var wcx=tx>0?((cx%tx+tx)%tx):cx,wcy=ty>0?((cy%ty+ty)%ty):cy;
    var h=cellHash(wcx,wcy,seed);
    var jx=0.5+((h&0xffff)/65535-0.5)*J, jy=0.5+(((h>>>16)&0xffff)/65535-0.5)*J;
    var px=cx+jx,py=cy+jy;
    var ddx=nx-px,ddy=ny-py;
    var d=euclid?(ddx*ddx+ddy*ddy):cellDist(ddx,ddy,metric);
    if(d<d1){
      d2=d1;d1=d;bestPx=px;bestPy=py;
      var h2=cellHash(wcx+1337,wcy+7919,seed^0xbeef);
      cellVal=(h2&0xffffff)/0xffffff;
    } else if(d<d2){d2=d;}
  }
  var C=contrast||1;
  if(!varMode||varMode==="flat")return clamp((cellVal-0.5)*C+0.5);
  var dist=euclid?Math.sqrt(d1):d1;
  var dist2=euclid?Math.sqrt(d2):d2;
  if(varMode==="dist")  return clamp(cellVal*(1-dist*1.3*C));            // darker toward edges
  if(varMode==="radial")return clamp((1-dist*1.6*C));                     // bright centers
  if(varMode==="smooth")return clamp(((cellVal-0.5)*C+0.5)*(1-dist*0.6)); // cell value w/ soft falloff
  if(varMode==="crystal")return clamp(cellVal*0.4+(dist2-dist)*2.2*C);    // faceted crystal: cell tone + sharp edge ridges
  if(varMode==="borders")return clamp(1-(dist2-dist)*4*C);                // thin bright cell borders on dark
  if(varMode==="bevel") return clamp(cellVal*(0.5+0.5*(dist2-dist)*3*C)); // cell tone with raised edges (bevel)
  return clamp((cellVal-0.5)*C+0.5);
}

// ── Gaussian noise ───────────────────────────────────────────────
// Box-Muller transform on white noise: normally distributed, σ=0.18, centered at 0.5
function gaussianNoise(px,py,seed){
  var u1=whiteHash(px,py,seed);
  var u2=whiteHash(px^12345,py^67890,seed^0xdeadbeef);
  if(u1<0.0001)u1=0.0001;
  var z=Math.sqrt(-2*Math.log(u1))*Math.cos(6.2831853*u2);
  return clamp(z*0.18+0.5);
}

// ── Sparse convolution noise ──────────────────────────────────────
// Random Gaussian impulses — uses nx,ny (scaled space, cell=1 unit)
// o = {density, sizeVar(0..1), intensity(0..1 random per impulse), falloff("gauss"|"disc"|"ring"|"spike")}
function sparseNoise(nx,ny,seed,o,tx,ty){
  o=o||{};
  var density=o.density||4, sizeVar=o.sizeVar||0, intVar=o.intensity||0, falloff=o.falloff||"gauss";
  var sigmaBase=0.35/Math.max(0.5,Math.sqrt(density)),val=0;
  var maxSigma=sigmaBase*(1+sizeVar);
  var cutoff=6*(2*maxSigma*maxSigma);
  var cx0=Math.floor(nx),cy0=Math.floor(ny);
  for(var dy=-2;dy<=2;dy++)for(var dx=-2;dx<=2;dx++){
    var cx=cx0+dx,cy=cy0+dy;
    var wcx=tx>0?((cx%tx+tx)%tx):cx, wcy=ty>0?((cy%ty+ty)%ty):cy;
    var h=cellHash(wcx,wcy,seed);
    var px2=cx+(h&0xff)/255,py2=cy+((h>>>8)&0xff)/255;
    var dist2=(nx-px2)*(nx-px2)+(ny-py2)*(ny-py2);
    if(dist2>cutoff)continue;
    // per-impulse size + intensity from more hash bits
    var szr=1+(((h>>>16&0xff)/255-0.5)*2*sizeVar);
    var sg=sigmaBase*Math.max(0.2,szr), sg2=2*sg*sg;
    var amp=1-(((h>>>24&0xff)/255)*intVar);
    var dist=Math.sqrt(dist2), nd=dist/(sg*2.5);
    var contrib;
    if(falloff==="disc")      contrib=nd<1?1:0;
    else if(falloff==="ring") contrib=clamp(1-Math.abs(nd-0.7)/0.3);
    else if(falloff==="spike")contrib=Math.exp(-dist2/sg2*2.2);
    else                      contrib=Math.exp(-dist2/sg2);
    val+=contrib*amp;
  }
  return clamp(val*0.6);
}

// ── Plasma: tileable via integer-frequency waves ──────────────────
// Per-seed constant cache: the perm lookup and the 8 trig values below
// depend only on (seed), not the pixel — computing them per pixel was
// 3 Map ops + 8 trig calls of pure waste.
var _plasmaCache={},_plasmaCacheN=0;
function _plasmaConsts(seed){
  var c=_plasmaCache[seed];
  if(c)return c;
  if(_plasmaCacheN>64){_plasmaCache={};_plasmaCacheN=0;}
  var pm2=getPerm(seed);
  var a1=(pm2[1]/255)*6.2831853, a2=(pm2[3]/255)*6.2831853;
  var a3=(pm2[5]/255)*6.2831853, a4=(pm2[7]/255)*6.2831853;
  c={pm:pm2,
     c1:Math.cos(a1),s1:Math.sin(a1),c2:Math.cos(a2),s2:Math.sin(a2),
     c3:Math.cos(a3),s3:Math.sin(a3),c4:Math.cos(a4),s4:Math.sin(a4)};
  _plasmaCache[seed]=c;_plasmaCacheN++;
  return c;
}
// o = {waves(3..8), warp(0..1.5), mode("classic"|"rings"|"interference"), turbI(0..2)}
//   waves : number of summed sine waves (more = busier plasma)
//   warp  : self-distortion strength (each wave bends the next, organic look)
//   mode  : classic plasma, concentric rings, or interference (|sin| ridges)
// Tiling: all wave frequencies are integers over the tile period → exact wrap,
// and the warp term itself is built from integer-frequency waves so it tiles too.
function plasmaNoise(nx,ny,seed,tx,ty,o){
  o=o||{};
  var waves=Math.max(3,Math.min(8,Math.round(o.waves||4)));
  var warp=o.warp!=null?o.warp:0, mode=o.mode||"classic";
  var _pc2=_plasmaConsts(seed);
  var pm2=_pc2.pm, pi2=Math.PI*2;
  if(tx>0){
    var T=tx;
    // optional warp: an integer-frequency wave pair that shifts the domain
    var wnx=nx, wny=ny;
    if(warp>0){
      var wkx=(pm2[10]%T+1),wky=(pm2[11]%T+1),wkx2=(pm2[12]%T+1),wky2=(pm2[13]%T+1);
      wnx=nx+Math.sin(pi2*(wkx*nx+wky*ny)/T)*warp;
      wny=ny+Math.sin(pi2*(wkx2*nx+wky2*ny)/T)*warp;
    }
    var v=0;
    for(var i=0;i<waves;i++){
      var kx=(pm2[(i*2)%256]%T)+ (i%2), ky=(pm2[(i*2+1)%256]%T)+((i+1)%2);
      v+=Math.sin(pi2*(kx*wnx+ky*wny)/T);
    }
    v/=waves;
    if(mode==="rings"){
      // radial standing wave — must use integer freq on a centered, wrapped coord
      var rk=Math.max(1,Math.round((pm2[8]%4)+2));
      v=(v+Math.sin(pi2*rk*(Math.sin(pi2*nx/T)+Math.sin(pi2*ny/T))*0.5))*0.5;
    } else if(mode==="interference"){
      return Math.pow(Math.abs(v),0.6); // |sin| gives bright interference ridges
    }
    return v*0.5+0.5;
  }
  // non-tiled fallback
  var vv=0;
  for(var j=0;j<waves;j++){var ca=_pc2["c"+((j%4)+1)],sa=_pc2["s"+((j%4)+1)];vv+=Math.sin(nx*ca*(1+j*0.3)+ny*sa*(1+j*0.2));}
  vv/=waves;
  if(mode==="interference")return Math.pow(Math.abs(vv),0.6);
  return vv*0.5+0.5;
}

// ── Caustics — double-warp Worley for complex caustic lines ──────
// Two fBm warp passes give branching, organic caustic patterns.
// oct/gain are now passed from layer settings.
var _foCaustics={base:"perlin",oct:4,lac:2,gain:0.5,mode:"normal"};
// o = {oct, gain, warp(0..2.5), fold(0..1.5), sharp(2..12), bright(0.1..0.6),
//       mode("lines"|"cells"|"web")}
//   warp  : strength of the first domain-warp pass (overall distortion)
//   fold  : strength of the second pass (branching complexity)
//   sharp : how tight the caustic lines are (F2-F1 multiplier)
//   bright: power curve exponent (<1 brightens; lower = more glow)
//   mode  : lines (classic), cells (filled regions), web (thin bright net)
// Seamless: both warp passes use the exact tile period; final worley wraps too.
function causticsNoise(nx,ny,pm,seed,tx,ty,o){
  o=o||{};
  _foCaustics.oct=o.oct||4;_foCaustics.gain=o.gain||0.5;
  var itx=tx>0?Math.max(1,Math.round(tx)):0,ity=ty>0?Math.max(1,Math.round(ty)):0;
  var fo=_foCaustics;
  var warp=o.warp!=null?o.warp:1.1, fold=o.fold!=null?o.fold:0.4;
  var sharp=o.sharp!=null?o.sharp:6, bright=o.bright!=null?o.bright:0.28;
  var mode=o.mode||"lines";
  var wx1=(fbm(nx,ny,pm,fo,itx,ity)-0.5)*warp;
  var wy1=(fbm(nx+(itx||5.2)*0.37,ny+(ity||1.9)*0.13,pm,fo,itx,ity)-0.5)*warp;
  var wx2=(fbm(nx+wx1,ny+wy1,pm,fo,itx,ity)-0.5)*fold;
  var wy2=(fbm(nx+wx1+(itx||2.7)*0.57,ny+wy1+(ity||5.3)*0.41,pm,fo,itx,ity)-0.5)*fold;
  var wr=worley(nx+wx1+wx2,ny+wy1+wy2,seed,"euclidean",tx,ty,2);
  if(mode==="cells"){
    // filled cells with bright rims
    var edge=clamp((wr.d2-wr.d1)*sharp);
    return clamp(Math.pow(edge,bright)*0.6+wr.cell*0.4);
  }
  if(mode==="web"){
    // thin bright net: invert F2-F1 so only the thin ridges glow
    var ridge=clamp(1-(wr.d2-wr.d1)*sharp*0.5);
    return Math.pow(ridge,bright*1.6);
  }
  // classic caustic lines
  var v=clamp((wr.d2-wr.d1)*sharp);
  return Math.pow(v,bright);
}

// ── Wood rings — fixed tileable version ──────────────────────────
// OLD BUG: used scx*0.6 with wrong tile period, creating visible seams.
// FIX: convert to [0,txI] range (nx = scx + txI/2), use scale=1 for
// warp fBm (matches tile period exactly), snap ring count to integer.
function woodNoise(scx,scy,pm,rings,turbulence,tx,ty){
  if(tx>0){
    var fo=_foNorm4;
    var txI=Math.max(1,Math.round(tx));
    var tyI=Math.max(1,Math.round(ty||tx));
    // Convert centered coords to [0,txI] — required for periodic fBm
    var nx=scx+txI*0.5, ny=scy+tyI*0.5;
    // Warp at scale 1.0 with exact tile period — guaranteed seamless
    var warpX=fbm(nx,ny,pm,fo,txI,tyI)*(turbulence*0.6);
    var warpY=fbm(nx+txI*0.373,ny+tyI*0.127,pm,fo,txI,tyI)*(turbulence*0.3);
    // Snap ring count so exactly N sine periods fit over [0,txI]
    var N=Math.max(1,Math.round(rings));
    return (Math.sin((nx+ny*0.4+warpX+warpY)*(Math.PI*2*N/txI))+1)*0.5;
  }
  // Non-seamless: classic radial rings
  var dist=Math.sqrt(scx*scx+scy*scy);
  var pert=(perlin(scx*0.4+1.7,scy*0.4+3.1,pm,0,0)-0.5)*turbulence;
  return (Math.sin((dist+pert)*rings*6.2831853)+1)*0.5;
}

// ── Marble veins — fixed seamless version ────────────────────────
// OLD BUG: warp used half-scale fBm (not seamless), vf not correctly
// snapped → visible seam when tiling.
// FIX: warp uses full-period seamless fBm, vf snapped to integer cycles.
var _foMarble={base:"perlin",oct:6,lac:2,gain:0.5,mode:"normal"};
// o = {freq, turb, oct, angle(turns), sharp(1..6)}
//   angle : orientation of the vein bands (turns)
//   sharp : vein contrast — power curve on the final sine (1=soft, 6=tight veins)
function marbleNoise(nx,ny,pm,o,tx,ty){
  o=o||{};
  var veinFreq=o.freq||3, turbulence=o.turb!=null?o.turb:4, sharp=o.sharp||1;
  var angle=(o.angle||0)*6.2831853;
  _foMarble.oct=o.oct||6; var fo=_foMarble;
  var txI=tx>0?Math.max(1,Math.round(tx)):0;
  var tyI=ty>0?Math.max(1,Math.round(ty)):0;
  // Vein direction: project (nx,ny) onto an angle. To keep tiling exact the
  // projection must use INTEGER weights over the tile, so we snap cos/sin*freq
  // to integer cycle counts per axis instead of an arbitrary continuous angle.
  var ca=Math.cos(angle),sa=Math.sin(angle);
  var vf,kxN,kyN;
  if(txI>0){
    var totalCyc=Math.max(1,Math.round(veinFreq*txI*0.5));
    kxN=Math.round(totalCyc*ca); kyN=Math.round(totalCyc*sa);
    if(kxN===0&&kyN===0)kxN=totalCyc; // avoid a degenerate zero-frequency band
    vf=1; // frequency folded into integer kxN/kyN
  } else { vf=veinFreq; kxN=ca; kyN=sa; }
  var warpX=(fbm(nx,ny,pm,fo,txI,tyI)-0.5)*turbulence;
  var warpY=(fbm(nx+(txI||5.2)*0.37,ny+(tyI||1.3)*0.13,pm,fo,txI,tyI)-0.5)*turbulence*0.6;
  var phase;
  if(txI>0){
    // integer-frequency projected wave → seamless at any angle
    phase=Math.PI*2*(kxN*(nx+warpX)+kyN*(ny))/txI + warpY*Math.PI;
  } else {
    phase=(nx*kxN+ny*kyN+warpX)*Math.PI*vf + warpY*Math.PI;
  }
  var s=(Math.sin(phase)+1)*0.5;
  if(sharp>1)s=Math.pow(s,sharp); // tighten the veins
  return clamp(s);
}

// ── IQ Smooth Cellular ───────────────────────────────────────────
// o = {blend(0..1 cell-vs-distance), smoothK(metaball merge 0..1), metric,
//       jitter(0..1), mode("smooth"|"metaballs"|"cells"|"glow"), contrast}
// smoothK drives a polynomial smooth-min over the nearest feature points, which
// merges cells into organic blobs (the signature "IQ" look). Tiling preserved.
function iqCellular(nx,ny,seed,o,tx,ty){
  o=o||{};
  var blend=o.blend!=null?o.blend:0.5;
  var smoothK=o.smoothK!=null?o.smoothK:0.4;
  var metric=o.metric||"euclidean";
  var J=o.jitter!=null?o.jitter:1;
  var mode=o.mode||"smooth";
  var C=o.contrast||1;
  var euclid=metric!=="manhattan"&&metric!=="chebyshev";
  var cx0=Math.floor(nx),cy0=Math.floor(ny);
  var d1=1e9,cellV=0;
  // Smooth-min accumulation (exponential smin): sum exp(-k*d) over points
  var k=4+smoothK*22;       // higher k = sharper (less merge); we invert below
  var expSum=0, wSum=0, cellAcc=0;
  for(var dy=-2;dy<=2;dy++)for(var dx=-2;dx<=2;dx++){
    var cx=cx0+dx,cy=cy0+dy;
    var wcx=tx>0?((cx%tx+tx)%tx):cx, wcy=ty>0?((cy%ty+ty)%ty):cy;
    var h=cellHash(wcx,wcy,seed);
    var jx=0.5+((h&0xffff)/65535-0.5)*J, jy=0.5+(((h>>>16)&0xffff)/65535-0.5)*J;
    var px2=cx+jx,py2=cy+jy;
    var ddx=nx-px2,ddy=ny-py2;
    var d=euclid?Math.sqrt(ddx*ddx+ddy*ddy):(metric==="manhattan"?Math.abs(ddx)+Math.abs(ddy):Math.max(Math.abs(ddx),Math.abs(ddy)));
    var h2=cellHash(wcx^1337,wcy^7919,seed^0xabcd);var cv=(h2>>>0)/0xffffffff;
    if(d<d1){d1=d;cellV=cv;}
    // exponential weights for smooth blending of distance + per-cell value
    var w=Math.exp(-k*d);
    expSum+=w; cellAcc+=w*cv;
  }
  // smooth distance field: -log(sum exp(-k*d))/k ≈ soft minimum distance
  var dSmooth=expSum>1e-9?(-Math.log(expSum)/k):d1;
  var smoothCell=expSum>1e-9?cellAcc/expSum:cellV;    // distance-weighted cell value
  if(mode==="metaballs"){return clamp((1-dSmooth*1.6)*C);}        // merged blobs
  if(mode==="cells"){return clamp((smoothCell-0.5)*C+0.5);}       // soft-blended cell colours
  if(mode==="glow"){return clamp(Math.pow(clamp(1-dSmooth*1.4),0.5*C+0.3));} // glowing cores
  // default "smooth": blend the smooth distance field with the smooth cell value
  var distV=clamp(1-dSmooth*1.7);
  return clamp(lerp(distV,smoothCell,blend)*C-(C-1)*0.5);
}

// ── Gabor noise ──────────────────────────────────────────────────
// Gabor noise — sum of randomly-placed Gabor kernels (gaussian-windowed cosine).
// o = {bw, orient(turns), spread(0..1), aniso(0..0.95), harmonics, phase(0..1)}.
//   orient  : base orientation of the wave fronts (turns, 0..1)
//   spread  : 0 = every kernel uses `orient` (clean striped/anisotropic look),
//             1 = fully random orientation (classic isotropic Gabor)
//   aniso   : stretches the gaussian envelope along the wave direction, giving
//             elongated streaks instead of round blobs
//   harmonics: 1..3 extra cosine harmonics for a richer, less pure-tone texture
// Tiling: kernel cells wrap modulo tx/ty exactly as before, so it stays seamless.
function gaborNoise(nx,ny,pm,seed,freq,o,tx,ty){
  var bw=(o&&o.bw)||2; freq=freq||3;
  var orient=(o&&o.orient!=null?o.orient:0)*6.2831853;
  var spread=o&&o.spread!=null?o.spread:1;
  var aniso=o&&o.aniso?Math.min(0.95,o.aniso):0;
  var harm=o&&o.harmonics?Math.max(1,Math.round(o.harmonics)):1;
  var phase=(o&&o.phase||0)*6.2831853;
  var sigma=0.5/Math.max(0.1,bw),sigma2=2*sigma*sigma,val=0;
  // anisotropy: envelope is tighter across the wave (factor 1/(1-aniso)) and
  // looser along it. Cutoff uses the loosest axis so we never clip a kernel.
  var along=sigma2*(1+aniso*3), across=sigma2*(1-aniso*0.85);
  var cutoff=6*Math.max(along,across);
  var R=cutoff>4?3:2; // widen search if kernels are stretched far
  var cx0=Math.floor(nx),cy0=Math.floor(ny);
  for(var dy=-R;dy<=R;dy++)for(var dx=-R;dx<=R;dx++){
    var cx=cx0+dx,cy=cy0+dy;
    var wcx=tx>0?((cx%tx+tx)%tx):cx, wcy=ty>0?((cy%ty+ty)%ty):cy;
    var h=cellHash(wcx,wcy,seed);
    var kx=cx+(h&0xff)/255,ky=cy+((h>>>8)&0xff)/255;
    var rx=nx-kx,ry=ny-ky;
    var dist2=rx*rx+ry*ry;
    if(dist2>cutoff)continue;
    // Per-kernel orientation: blend base orient with a random angle by `spread`
    var rand=((h>>>16)&0xffff)/65535*6.2831853;
    var angle=orient+(rand-orient)*spread; // spread=0 -> orient, =1 -> rand
    var ca=Math.cos(angle),sa=Math.sin(angle);
    // project into along/across-wave axes for the anisotropic envelope
    var pAlong=rx*ca+ry*sa, pAcross=-rx*sa+ry*ca;
    var gauss=Math.exp(-(pAlong*pAlong/along + pAcross*pAcross/across));
    var wave=Math.cos(pAlong*freq*6.2831853+phase);
    if(harm>1)wave=(wave+0.5*Math.cos(pAlong*freq*2*6.2831853+phase))/1.5;
    if(harm>2)wave=(wave*1.5+0.33*Math.cos(pAlong*freq*3*6.2831853+phase))/1.83;
    val+=gauss*wave;
  }
  return clamp(val*0.4+0.5);
}

// ── Crystals ─────────────────────────────────────────────────────
// o = {sharp, jitter, metric, mode("facets"|"shards"|"veins"|"plates")}
function crystalsNoise(nx,ny,seed,o,tx,ty){
  o=o||{};
  var sharp=o.sharp||4, J=o.jitter!=null?o.jitter:1, metric=o.metric||"manhattan";
  var mode=o.mode||"facets";
  var euclid=metric==="euclidean", cheb=metric==="chebyshev";
  var cx0=Math.floor(nx),cy0=Math.floor(ny),d1=1e9,d2=1e9,f1c=0;
  for(var dy=-2;dy<=2;dy++)for(var dx=-2;dx<=2;dx++){
    var cx=cx0+dx,cy=cy0+dy;
    var wcx=tx>0?((cx%tx+tx)%tx):cx, wcy=ty>0?((cy%ty+ty)%ty):cy;
    var h=cellHash(wcx,wcy,seed);
    var jx=0.5+((h&0xffff)/65535-0.5)*J, jy=0.5+(((h>>>16)&0xffff)/65535-0.5)*J;
    var px2=cx+jx,py2=cy+jy, adx=Math.abs(nx-px2),ady=Math.abs(ny-py2);
    var d=euclid?Math.sqrt(adx*adx+ady*ady):cheb?Math.max(adx,ady):adx+ady;
    if(d<d1){d2=d1;d1=d;var h2=cellHash(wcx^555,wcy^999,seed^0x1234);f1c=(h2&0xffffff)/0xffffff;}else if(d<d2)d2=d;
  }
  var edge=d2-d1;
  if(mode==="shards")  return clamp(Math.pow(edge*sharp,0.35));      // sharper, glassier
  if(mode==="veins")   return clamp(1-Math.pow(edge*sharp,0.55));    // inverted: bright veins
  if(mode==="plates")  return clamp(Math.pow(edge*sharp,0.55)*0.6+f1c*0.4); // faceted with per-plate tone
  return clamp(Math.pow(edge*sharp,0.55));                            // facets (classic)
}

// ── Highpass ─────────────────────────────────────────────────────
var _foHighpass={base:"perlin",oct:5,lac:2,gain:0.5,mode:"normal"};
function highpassNoise(u,v,pm,scaleHi,blurRatio,oct,tx,ty){
  _foHighpass.oct=oct||5;var fo=_foHighpass;
  var scaleLo=Math.max(1,Math.round(scaleHi*Math.max(0.05,blurRatio)));
  var detail=fbm(u*scaleHi,v*scaleHi,pm,fo,tx,ty);
  var blurred=fbm(u*scaleLo,v*scaleLo,pm,fo,tx>0?scaleLo:0,ty>0?scaleLo:0);
  return clamp((detail-blurred)*2.5+0.5);
}

// ── Directional / Anisotropic noise ──────────────────────────────
var _foDir={base:"perlin",oct:5,lac:2,gain:0.5,mode:"normal"};
function dirNoise(u,v,pm,scaleX,scaleY,oct,tx,ty){
  _foDir.oct=oct||5;
  // RELIABILITY FIX: the caller passes the layer's tile period, but this noise
  // samples at its own dirScaleX/Y — the mismatch guaranteed a seam. When
  // tiling, snap the directional scales to integers and use THOSE as periods,
  // so the fbm is periodic in u,v with period exactly 1.
  if(tx>0||ty>0){
    scaleX=Math.max(1,Math.round(scaleX));
    scaleY=Math.max(1,Math.round(scaleY));
    return fbm(u*scaleX,v*scaleY,pm,_foDir,scaleX,scaleY);
  }
  return fbm(u*scaleX,v*scaleY,pm,_foDir,0,0);
}

// ── Wave Stroke / Trail ──────────────────────────────────────────────────
// Draws a SINGLE wave/line across the canvas.
// angle: stroke direction; amp: wave amplitude (0=straight line);
// warp: organic noise warp along axis; thick: stroke thickness (0..1);
// offset: vertical position of stroke (0=center); falloff: edge fade
var _foWave={base:"perlin",oct:3,lac:2,gain:0.5,mode:"normal"};
function waveStrokeNoise(u,v,pm,angle,amp,warp,thick,offset,tx,ty,contrast){
  contrast=contrast!=null?contrast:1;
  var rad=angle*Math.PI/180;
  var cr=Math.cos(rad),sr=Math.sin(rad);
  // Rotate: su = along stroke, sv = across stroke
  var su= u*cr+v*sr;
  var sv=-u*sr+v*cr;
  // Organic warp along the stroke axis for non-sine variation
  _foWave.oct=3;
  // Tiled: sampling scale is 3, tile period must be exactly 3 (the old
  // ceil(tx*3) gave period tx in UV space → seam for any layer scale > 1)
  var warpN=warp>0?fbm(su*3,sv*3,pm,_foWave,tx?3:0,ty?3:0)*warp:0;
  // Single wave: sine of along-axis position, modulated by warp
  var wave=Math.sin(su*Math.PI*2+warpN*Math.PI*2)*amp;
  // Across-axis distance to the wave line, WRAPPED in v so the stroke repeats
  // seamlessly across the tile edge (raw distance left a seam at the v border).
  var rel=(sv+offset)-wave;
  rel=rel-Math.floor(rel);          // wrap into [0,1)
  var distFromLine=Math.min(Math.abs(rel-0.5),0.5); // distance to nearest line at 0.5
  // Convert distance to stroke value: 1 = on stroke, 0 = far from stroke
  var halfThick=Math.max(0.005,thick*0.5);
  var strokeVal=1-clamp(distFromLine/halfThick);
  // Smooth falloff: squared for soft edges
  var _r=clamp(strokeVal*strokeVal);
  return contrast!==1?clamp((_r-0.5)*contrast+0.5):_r;
}

// ── Fiber noise — elongated directional fibers (thread/hair/grain) ─────────
var _foFiber={base:"perlin",oct:5,lac:2.1,gain:0.5,mode:"normal"};
function fiberNoise(u,v,pm,angle,stretch,oct,tx,ty,contrast,cross){
  var rad=angle*Math.PI/180;
  var cr=Math.cos(rad),sr=Math.sin(rad);
  var fu= u*cr+v*sr;
  var fv=-u*sr+v*cr;
  contrast=contrast!=null?contrast:1; cross=cross!=null?cross:0.15;
  _foFiber.oct=oct||5;
  var res;
  if(tx>0||ty>0){
    var st=Math.max(1,Math.round(stretch));
    var sc=Math.max(1,Math.round(stretch*0.3));
    var n1t=fbm(fu*st,fv,pm,_foFiber,st,1);
    var n2t=fbm(fu,fv*sc,pm,_foFiber,1,sc)*cross;
    res=n1t*(1-cross*0.97)+n2t;
  } else {
    var n1=fbm(fu*stretch,fv,pm,_foFiber,0,0);
    var n2=fbm(fu,fv*stretch*0.3,pm,_foFiber,0,0)*cross;
    res=n1*(1-cross*0.97)+n2;
  }
  if(contrast!==1)res=clamp((res-0.5)*contrast+0.5);
  return clamp(res);
}

// ── Streaks noise — directional streaks with variable length/density ─────
var _foStreak={base:"perlin",oct:3,lac:2,gain:0.5,mode:"normal"};
function streaksNoise(u,v,pm,angle,length,density,tx,ty,contrast){
  contrast=contrast!=null?contrast:1;
  function _C(x){return contrast!==1?clamp((x-0.5)*contrast+0.5):x;}
  var rad=angle*Math.PI/180;
  var cr=Math.cos(rad),sr=Math.sin(rad);
  var su= u*cr+v*sr;
  var sv=-u*sr+v*cr;
  // Long axis = streak direction, short axis = streak width
  _foStreak.oct=3;
  if(tx>0||ty>0){
    // Snap both sampling scales to integers and use them as the tile periods
    var dx=Math.max(1,Math.round(density));
    var dy=Math.max(1,Math.round(density*length));
    return _C(clamp(Math.pow(fbm(su*dx,sv*dy,pm,_foStreak,dx,dy),0.6)));
  }
  var base=fbm(su*density,sv*density*length,pm,_foStreak,0,0);
  // Sharpen to create streak bands
  return _C(clamp(Math.pow(base,0.6)));
}

// ── Crosshatch — two angled sets of lines ────────────────────────────────
var _foCross={base:"perlin",oct:3,lac:2,gain:0.5,mode:"normal"};
// Inlined to avoid per-pixel function allocation
function _crossBand(su,sv,tfreq,thick,pm,tx,ty){
  // Tiled: warp must be periodic with period 1 in su,sv → integer sampling
  // scale (2) with matching tile. Non-tiled keeps the original 1.5 look.
  var warp=(tx>0||ty>0)
    ? fbm(su*2,sv*2,pm,_foCross,2,2)*0.2
    : fbm(su*1.5,sv*1.5,pm,_foCross,0,0)*0.2;
  var band=((su*tfreq+warp)%1+1)%1;
  var pulse=Math.abs(band-0.5)*2;
  return 1-clamp((pulse-thick)/(1-thick+0.01));
}
function crosshatchNoise(u,v,pm,angle,freq,thick,tx,ty,contrast){
  contrast=contrast!=null?contrast:1;
  var rad=angle*Math.PI/180;
  var cr=Math.cos(rad),sr=Math.sin(rad);
  var u1=u*cr+v*sr, v1=-u*sr+v*cr;
  var u2=u*sr-v*cr, v2=u*cr+v*sr;
  _foCross.oct=3;
  var tfreq=tx>0?Math.max(1,Math.round(freq)):freq;
  var s1=_crossBand(u1,v1,tfreq,thick,pm,tx,ty);
  var s2=_crossBand(u2,v2,tfreq,thick,pm,tx,ty);
  var _r=clamp(1-(1-Math.pow(s1,0.6))*(1-Math.pow(s2,0.6)));
  return contrast!==1?clamp((_r-0.5)*contrast+0.5):_r;
}

// ── Ripple Directional — corrugated/fabric/corrugated metal ──────────────
function rippleDirNoise(u,v,pm,angle,freq,warp,tx,ty,contrast){
  contrast=contrast!=null?contrast:1;
  var rad=angle*Math.PI/180;
  var cr=Math.cos(rad),sr=Math.sin(rad);
  var su=u*cr+v*sr, sv=-u*sr+v*cr;
  var _fo=_foDir; _fo.oct=4;
  // Tiled: periodic warp (integer scale + matching tile); the old layer-tile
  // mismatch left a seam whenever warp > 0
  var warpN=warp>0?((tx>0||ty>0)?fbm(su*2,sv*2,pm,_fo,2,2):fbm(su*1.5,sv*1.5,pm,_fo,0,0))*warp:0;
  var tfreq=tx>0?Math.max(1,Math.round(freq)):freq;
  // Smooth sinusoidal bands with noise warp across axis
  var _r=(Math.sin((sv+warpN)*tfreq*Math.PI*2)+1)*0.5;
  return contrast!==1?clamp((_r-0.5)*contrast+0.5):_r;
}

// ── Flow Lines — smooth organic flow (like field lines) ──────────────────
var _foFlow={base:"perlin",oct:5,lac:2,gain:0.5,mode:"normal"};
function flowLinesNoise(u,v,pm,angle,freq,warp,tx,ty,contrast){
  contrast=contrast!=null?contrast:1;
  var rad=angle*Math.PI/180;
  var cr=Math.cos(rad),sr=Math.sin(rad);
  var su=u*cr+v*sr, sv=-u*sr+v*cr;
  _foFlow.oct=4;
  // Multi-octave warp for organic flow. Tiled: the sampling scale is 2, so the
  // tile period must be 2 (the layer tile gave period tx/2 → seam).
  var _ft=(tx>0||ty>0)?2:0;
  var wx=fbm(su*2,sv*2,pm,_foFlow,_ft,_ft)*warp;
  var wy=fbm(su*2+3.7,sv*2+1.3,pm,_foFlow,_ft,_ft)*warp;
  var tfreq=tx>0?Math.max(1,Math.round(freq)):freq;
  // Flow lines along warped axis
  var band=((sv+wx)*tfreq)%1; if(band<0)band+=1;
  // Soft gradient bands
  var v2=Math.abs(band-0.5)*2;
  var _r=clamp(1-v2*v2);
  return contrast!==1?clamp((_r-0.5)*contrast+0.5):_r;
}

// ── Cloud noise (SD: "Cloud") ─────────────────────────────────────
// fBm in Billow mode — soft puffy clouds. Tileable via tsx/tsy.
// o = {oct,lac,gain, coverage(0..1), softness(0..1), mode("billow"|"wisps"|"puffy")}
//   coverage : remaps the fBm so more/less of it reads as "cloud"
//   softness : how soft the cloud edges are (low = crisp puffs, high = haze)
function cloudNoise(nx,ny,pm,oct,lac,gain,tsx,tsy,o){
  o=o||{};
  var cov=o.coverage!=null?o.coverage:0.5, soft=o.softness!=null?o.softness:0.5, mode=o.mode||"billow";
  _foBillow.oct=oct||5;_foBillow.lac=lac||2;_foBillow.gain=gain||0.5;
  _foBillow.mode=(mode==="wisps")?"ridged":"billow";
  var fo=_foBillow;
  var v=fbm(nx,ny,pm,fo,tsx,tsy);
  // Higher coverage = more cloud. We pick a threshold that DROPS as coverage
  // rises (cov=1 → threshold ~0 → everything is cloud; cov=0 → high threshold →
  // almost nothing). softness sets the smoothstep transition width.
  var thr=(1-cov)*0.6;            // usable range tuned to billow's low skew
  var hw=Math.max(0.001,soft*0.45);
  var lo=thr-hw, hi=thr+hw;
  var t=hi>lo?(v-lo)/(hi-lo):(v>thr?1:0);
  t=t<0?0:t>1?1:t;
  t=t*t*(3-2*t); // smoothstep
  if(mode==="puffy")t=Math.pow(t,0.7); // brighter, fuller puffs
  return clamp(t);
}

// ── Polar Scatter (SD: "Tile Sampler" polar mode / FX-Map radial) ─
// Repeats a radial gradient N times around a circle of radius R
// at angle offsets — creates flower/mandala/splatter patterns.
// Uses scx, scy (centered scaled coords)
function polarScatterNoise(scx,scy,pm,seed,count,radius,spread,innerR,mode){
  count=Math.max(1,Math.round(count)||6);
  radius=radius||0.35;
  spread=spread||0.18;
  innerR=innerR||0.0;
  var TWO_PI=6.2831853;
  var best=1e9;
  var bestVal=0;
  // Evaluate contribution from each petal center
  for(var k=0;k<count;k++){
    // Hash-jitter per petal for organic look
    var h=cellHash(k,seed,42);
    var jitterA=((h&0xff)/255-0.5)*0.4*(1-spread*2);
    var jitterR=((h>>>8&0xff)/255-0.5)*spread*0.5;
    var ang=(k/count+jitterA)*TWO_PI;
    var pr=radius+jitterR;
    // Petal center in scaled coords
    var px=Math.cos(ang)*pr,py=Math.sin(ang)*pr;
    var dx=scx-px,dy=scy-py;
    var d=Math.sqrt(dx*dx+dy*dy);
    if(d<best){best=d;}
    // Spot contribution: gaussian blob at each petal
    var blob=Math.exp(-d*d/(2*spread*spread));
    bestVal=Math.max(bestVal,blob);
  }
  // Inner fill
  var center=Math.hypot(scx,scy);
  if(innerR>0){
    var fill=Math.exp(-center*center/(2*innerR*innerR));
    bestVal=Math.max(bestVal,fill);
  }
  if(mode==="distance")return clamp(1-best/(spread*3));
  return clamp(bestVal);
}

// ── Seamless Scatter ─────────────────────────────────────────────
// Distributes one primitive per grid cell with per-cell random offset, size,
// and rotation. Tiles seamlessly: cell indices wrap modulo `grid`, and the 3x3
// neighborhood is sampled so elements near a border reappear on the opposite
// side. mode: "disc" (soft circle), "shape" (uses sp/kind), "ring".
// u,v are in [0,1]. Returns 0..1 coverage (max over overlapping elements).
// o = options:
//  grid, density, jitter
//  sizeBase, scaleXMin/scaleXMax, scaleYMin/scaleYMax (per-element scale ranges)
//  rotMin/rotMax (turns), intensityMin/intensityMax (per-element brightness)
//  mode ("disc"|"ring"|"shape"|"sample"), kind+sp (shape mode)
//  blend ("max"|"add"|"mean"), sampler(lx,ly)->0..1 (for "sample" mode: any layer)
// Seamless: cell indices wrap modulo grid; element scale is clamped so its
// footprint can't exceed the 3x3 neighbourhood, keeping the tile exact.
function scatterNoise(u,v,seed,o){
  o=o||{};
  var grid=Math.max(1,Math.round(o.grid)||4);
  var density=o.density!=null?o.density:1;
  var jitter=o.jitter!=null?o.jitter:0.8;
  var sizeBase=o.sizeBase||0.5;
  var sxMin=o.scaleXMin!=null?o.scaleXMin:1, sxMax=o.scaleXMax!=null?o.scaleXMax:1;
  var syMin=o.scaleYMin!=null?o.scaleYMin:1, syMax=o.scaleYMax!=null?o.scaleYMax:1;
  var rotMin=o.rotMin||0, rotMax=o.rotMax!=null?o.rotMax:0;
  var inMin=o.intensityMin!=null?o.intensityMin:1, inMax=o.intensityMax!=null?o.intensityMax:1;
  var mode=o.mode||"disc", kind=o.kind||"circle", sp=o.sp, sampler=o.sampler, blend=o.blend||"max";
  var best=0, acc=0, cnt=0;
  var gu=u*grid, gv=v*grid;
  var cu=Math.floor(gu), cv=Math.floor(gv);
  for(var oy=-1;oy<=1;oy++){
    for(var ox=-1;ox<=1;ox++){
      var ci=cu+ox, cj=cv+oy;
      var wi=((ci%grid)+grid)%grid, wj=((cj%grid)+grid)%grid;
      var hh=cellHash(wi,wj,seed);
      if((hh&0xff)/255>density)continue;
      // Decorrelated random draws from different bytes/rehashes of the hash
      var r1=(hh>>>8&0xff)/255, r2=(hh>>>16&0xff)/255, r3=(hh>>>24&0xff)/255;
      var hh2=cellHash(wi+131,wj+57,seed^0x5bd1e995);
      var r4=(hh2&0xff)/255, r5=(hh2>>>8&0xff)/255, r6=(hh2>>>16&0xff)/255, r7=(hh2>>>24&0xff)/255;
      var jx=(r1-0.5)*jitter, jy=(r2-0.5)*jitter;
      var ex=ci+0.5+jx, ey=cj+0.5+jy;
      // Per-element scale on each axis (independent ranges)
      var scX=sxMin+(sxMax-sxMin)*r3, scY=syMin+(syMax-syMin)*r4;
      // Per-element rotation in the chosen range
      var rot=(rotMin+(rotMax-rotMin)*r5)*6.2831853;
      // Per-element intensity
      var inten=inMin+(inMax-inMin)*r6;
      // Clamp footprint to < 1.5 cells so an element never reaches beyond the
      // sampled 3x3 neighborhood — this is what keeps tiling exact at any scale.
      var radX=Math.max(0.0001,Math.min(1.45,sizeBase*0.5*scX)), radY=Math.max(0.0001,Math.min(1.45,sizeBase*0.5*scY));
      var dx=gu-ex, dy=gv-ey;
      // Rotate the sample into element-local space, then normalize per-axis
      var rc=Math.cos(-rot),rs=Math.sin(-rot);
      var rx=dx*rc-dy*rs, ry=dx*rs+dy*rc;
      var lx=rx/(radX*2), ly=ry/(radY*2);   // element-local, ~[-0.5,0.5] at edge
      var val=0;
      if(mode==="sample"&&sampler){
        // Use another layer: sample it in element-local UV (0..1), outside = 0
        var su=lx+0.5, sv=ly+0.5;
        if(su>=0&&su<=1&&sv>=0&&sv<=1)val=sampler(su,sv);
      } else if(mode==="shape"&&sp){
        val=computeShape(lx,ly,kind,sp);
      } else if(mode==="ring"){
        var t=Math.sqrt(lx*lx+ly*ly)/0.5;
        val=clamp(1-Math.abs(t-0.7)/0.3);
      } else {
        var d2=Math.sqrt(lx*lx+ly*ly);
        val=clamp(1-(d2-0.42)/0.15);
      }
      val*=inten;
      if(val>0){
        if(blend==="add"){acc+=val;}
        else if(blend==="mean"){acc+=val;cnt++;}
        else {if(val>best)best=val;}
      }
    }
  }
  if(blend==="add")return clamp(acc);
  if(blend==="mean")return cnt>0?clamp(acc/cnt):0;
  return best;
}

// ── Slope Gradient (SD: "Slope Gradient") ─────────────────────────
// Directional ramp at a controllable angle — simpler than Gradient node
function slopeGradNoise(scx,scy,angle){
  var rad=angle*0.01745329;
  return clamp((Math.cos(rad)*scx+Math.sin(rad)*scy)*2+0.5);
}

function whiteHash(px,py,seed){var h=(Math.imul(px,374761393)^Math.imul(py,668265263)^seed)>>>0;h=(Math.imul(h,2246822519)^(h>>>13))>>>0;return(h>>>0)/0xffffffff;}

// ── High-frequency detail noises (dust / debris / dirt / grain) ──────
// All operate in scaled cell space (nx,ny) and wrap cells modulo tx/ty so they
// tile seamlessly, exactly like worley/gabor.

// DUST: sparse fine specks. Each grid cell may hold one speck (thresholded by
// coverage); within a covered cell a small soft dot is drawn. amount=coverage
// 0..1, grainSize relative dot radius. Great layered with low opacity for dirt.
function dustNoise(nx,ny,seed,coverage,grainSize,tx,ty){
  coverage=coverage!=null?coverage:0.5; grainSize=grainSize||0.5;
  var cx0=Math.floor(nx),cy0=Math.floor(ny),best=0;
  var rad=0.12+grainSize*0.32;
  for(var dy=-1;dy<=1;dy++)for(var dx=-1;dx<=1;dx++){
    var cx=cx0+dx,cy=cy0+dy;
    var wcx=tx>0?((cx%tx+tx)%tx):cx, wcy=ty>0?((cy%ty+ty)%ty):cy;
    var h=cellHash(wcx,wcy,seed);
    if((h&0xff)/255>coverage)continue;          // empty cell
    var px=cx+((h>>>8&0xff)/255), py=cy+((h>>>16&0xff)/255);
    var d=Math.hypot(nx-px,ny-py);
    var v=1-d/rad;
    if(v>best)best=v*((h>>>24&0xff)/255*0.5+0.5); // vary speck brightness
  }
  return clamp(best);
}

// DEBRIS: irregular angular fragments at mixed sizes. Built from a thresholded
// worley F2-F1 across two octaves so you get scattered chips/flakes of varying
// size. density raises/lowers how much survives the threshold.
function debrisNoise(nx,ny,seed,density,sharp,tx,ty){
  density=density!=null?density:0.5; sharp=sharp||2;
  // octave 1
  var w1=worley(nx,ny,seed,"euclidean",tx,ty,2,1);
  var e1=(w1.d2-w1.d1); // edge-ish field; high inside cells
  // octave 2 (double frequency: double the tile period too so it stays seamless)
  var w2=worley(nx*2,ny*2,seed^0x9e37,"euclidean",tx>0?tx*2:0,ty>0?ty*2:0,2,1);
  var e2=(w2.d2-w2.d1);
  var frag=e1*0.65+e2*0.35;
  // threshold → angular fragments; sharp controls edge hardness
  var t=(frag-(1-density)*0.6)*sharp;
  return clamp(t);
}

// GRAIN: fine high-frequency fractal grain (film grain / fine dirt). Sums a few
// high-octave value-noise layers at integer-multiplied frequencies (seamless),
// then applies contrast. roughness shifts energy toward the finest octave.
var _foGrain={base:"value",oct:2,lac:2,gain:0.5,mode:"normal"};
function grainNoise(nx,ny,pm,roughness,contrast,tx,ty){
  roughness=roughness!=null?roughness:0.5; contrast=contrast||1.5;
  // three integer-frequency value-noise layers; high freqs dominate
  var g1=valueNoise(nx,ny,pm,tx,ty);
  var g2=valueNoise(nx*2,ny*2,pm,tx>0?tx*2:0,ty>0?ty*2:0);
  var g3=valueNoise(nx*4,ny*4,pm,tx>0?tx*4:0,ty>0?ty*4:0);
  var wHi=0.3+roughness*0.5;
  var v=g1*(1-wHi)*0.5+g2*0.35+g3*wHi;
  v=(v-0.5)*contrast+0.5;
  return clamp(v);
}

// ── Hexagonal / Triangular grid ──────────────────────────────────
// Regular hex lattice. Seamless when the hex count divides the tile period.
// o = {mode("edges"|"cells"|"value"|"dots"), thickness, jitter}
//   edges : honeycomb wireframe (mortar lines between hexes)
//   cells : filled hexes with a small gap
//   value : flat random tone per hex (scales / tech panels)
//   dots  : a soft dot at each hex center
// Coords are in scaled cell space; one hex column ~ 1 unit. We find the nearest
// hex center using axial rounding, then derive distance to center / edge.
function hexNoise(nx,ny,seed,o,tx,ty){
  o=o||{};
  var mode=o.mode||"edges", thick=o.thickness!=null?o.thickness:0.12, J=o.jitter||0;
  // Pointy-top hexes. Centers are 1 apart horizontally; alternate rows shift by
  // 0.5 and sit 0.866 apart vertically. We DON'T rescale ny here — the tile
  // period ty already accounts for the row count, and rescaling would break the
  // exact-wrap. Regular hexes appear when the layer's Y scale ~ X scale*0.866;
  // the UI hint tells the user. rowH stays the true ratio for correct geometry.
  // Vertical tiling: fit an INTEGER, EVEN number of hex rows into the tile
  // period ty so the stagger (odd/even row offset) also matches at the seam.
  // rowH then deviates from the ideal 0.866 by at most a few percent.
  var rowH=0.8660254, nRows=0;
  if(ty>0){
    nRows=Math.max(2,Math.round(ty/0.8660254));
    if(nRows&1)nRows++;            // force even so row-parity offset wraps cleanly
    rowH=ty/nRows;                  // exact: nRows*rowH === ty
  }
  var gy=ny/rowH, row=Math.floor(gy+0.5);
  var offset=(row&1)?0.5:0;
  var gx=nx-offset, col=Math.floor(gx+0.5);
  // Check this cell + neighbours to find the true nearest hex center (handles
  // the hexagonal Voronoi boundary correctly). 3x3 candidate rows/cols.
  var bestD=1e9,bestD2=1e9,bestH=0;
  for(var dr=-1;dr<=1;dr++){
    var r=row+dr, off=(r&1)?0.5:0;
    for(var dc=-1;dc<=1;dc++){
      var c=col+dc;
      // wrap for tiling: hex centers repeat every tx columns / ty rows
      var wc=tx>0?((c%tx+tx)%tx):c, wr=ty>0?((r%nRows+nRows)%nRows):r;
      var jh=cellHash(wc,wr,seed);
      var jxoff=J?((jh&0xff)/255-0.5)*J*0.5:0, jyoff=J?(((jh>>>8)&0xff)/255-0.5)*J*0.5:0;
      var hxc=(c+off)+jxoff, hyc=r*rowH+jyoff;
      var ddx=nx-hxc, ddy=ny-hyc, d=Math.sqrt(ddx*ddx+ddy*ddy);
      if(d<bestD){bestD2=bestD;bestD=d;bestH=(cellHash(wc+71,wr+131,seed^0x77)&0xffffff)/0xffffff;}
      else if(d<bestD2)bestD2=d;
    }
  }
  if(mode==="value")  return bestH;
  if(mode==="dots")   return clamp(1-bestD/(0.5*(1-thick)+0.0001));
  if(mode==="cells"){ // filled hex with gap = edge band removed
    var edgeC=bestD2-bestD;
    return clamp(edgeC/(thick+0.0001));
  }
  // edges (honeycomb): bright thin lines on the hex borders
  var edge=bestD2-bestD; // ~0 on a border, grows toward center
  return clamp(1-edge/(thick+0.0001));
}

// ── Scratches ────────────────────────────────────────────────────
// Thin directional scratches scattered over the surface (worn metal, glass,
// brushed wear). Each grid cell may spawn one short line segment at a jittered
// position/angle; we take the max coverage over the 3x3 neighbourhood so a
// scratch crossing a cell or tile border continues seamlessly.
// o = {density, length, thickness, angle(turns base), angleVar(0..1), taper}
function scratchNoise(nx,ny,seed,o,tx,ty){
  o=o||{};
  var density=o.density!=null?o.density:0.5;
  var length=o.length!=null?o.length:0.6;     // fraction of a cell
  var thick=o.thickness!=null?o.thickness:0.04;
  var baseAng=(o.angle||0)*6.2831853;
  var angVar=o.angleVar!=null?o.angleVar:1;    // 1 = any direction, 0 = all parallel
  var taper=o.taper!=null?o.taper:1;           // fade ends
  var best=0;
  var cx0=Math.floor(nx),cy0=Math.floor(ny);
  for(var dy=-1;dy<=1;dy++)for(var dx=-1;dx<=1;dx++){
    var ci=cx0+dx, cj=cy0+dy;
    var wi=tx>0?((ci%tx+tx)%tx):ci, wj=ty>0?((cj%ty+ty)%ty):cj;
    var h=cellHash(wi,wj,seed);
    if((h&0xff)/255>density)continue;            // empty cell
    // scratch center (jittered) using UNWRAPPED index for continuity
    var sxC=ci+0.5+((h>>>8&0xff)/255-0.5)*0.8;
    var syC=cj+0.5+((h>>>16&0xff)/255-0.5)*0.8;
    // angle = base + random spread
    var rA=((h>>>24&0xff)/255-0.5)*Math.PI*2*angVar;
    var ang=baseAng+rA;
    var ca=Math.cos(ang),sa=Math.sin(ang);
    var halfLen=length*0.5*(0.6+((h>>>4&0xf)/15)*0.8); // per-scratch length variation
    // project point onto the scratch line (centered at sxC,syC)
    var rx=nx-sxC, ry=ny-syC;
    var along=rx*ca+ry*sa, across=-rx*sa+ry*ca;
    if(along<-halfLen||along>halfLen)continue;
    var aw=Math.abs(across);
    var v=1-aw/(thick+0.0001);
    if(v<=0)continue;
    if(taper>0){ // fade toward the ends
      var endFade=1-Math.pow(Math.abs(along)/halfLen,1+taper*3);
      v*=clamp(endFade);
    }
    if(v>best)best=v;
  }
  return clamp(best);
}

// ── Sparkle field ────────────────────────────────────────────────
// Bright points with a soft glow/halo — sparks, glitter, stars. Each cell may
// hold one sparkle (thresholded by density); the sparkle has a tiny bright core
// plus a wider falloff halo, with optional 4-point star streaks. Seamless via
// wrapped cell indices.
// o = {density, size, glow, streak(0..1 star rays), twinkle(0..1 brightness var)}
function sparkleNoise(nx,ny,seed,o,tx,ty){
  o=o||{};
  var density=o.density!=null?o.density:0.4;
  var size=o.size!=null?o.size:0.4;
  var glow=o.glow!=null?o.glow:0.5;
  var streak=o.streak!=null?o.streak:0;
  var twinkle=o.twinkle!=null?o.twinkle:0.6;
  var best=0;
  var coreR=0.04+size*0.16, haloR=coreR+0.05+glow*0.4;
  var cx0=Math.floor(nx),cy0=Math.floor(ny);
  for(var dy=-1;dy<=1;dy++)for(var dx=-1;dx<=1;dx++){
    var ci=cx0+dx, cj=cy0+dy;
    var wi=tx>0?((ci%tx+tx)%tx):ci, wj=ty>0?((cj%ty+ty)%ty):cj;
    var h=cellHash(wi,wj,seed);
    if((h&0xff)/255>density)continue;
    var px=ci+((h>>>8&0xff)/255), py=cj+((h>>>16&0xff)/255);
    var rx=nx-px, ry=ny-py;
    var d=Math.sqrt(rx*rx+ry*ry);
    var bright=1-(((h>>>24&0xff)/255)*twinkle); // per-sparkle brightness
    var v=0;
    // bright core
    if(d<coreR)v=1;
    else if(d<haloR)v=Math.pow(1-(d-coreR)/(haloR-coreR),2); // soft halo
    // star streaks (4-point): bright along the axes through the center
    if(streak>0){
      var ax=Math.abs(rx),ay=Math.abs(ry);
      var rayLen=haloR*(1+streak*1.5);
      var onX=ay<coreR*0.5&&ax<rayLen, onY=ax<coreR*0.5&&ay<rayLen;
      if(onX)v=Math.max(v,(1-ax/rayLen)*streak);
      if(onY)v=Math.max(v,(1-ay/rayLen)*streak);
    }
    v*=bright;
    if(v>best)best=v;
  }
  return clamp(best);
}

// ── Truchet tiles ────────────────────────────────────────────────
// Each cell randomly picks one of two quarter-arc orientations. Adjacent arcs
// meet at cell edge midpoints, so they always connect into continuous flowing
// curves (mazes, circuits, organic networks). Inherently seamless: arcs only
// touch edges at midpoints, and cell choice wraps modulo tx/ty.
// o = {thickness, mode("arcs"|"lines"|"maze"), fill(0..1)}
function truchetNoise(nx,ny,seed,o,tx,ty){
  o=o||{};
  var thick=o.thickness!=null?o.thickness:0.18, mode=o.mode||"arcs";
  var ci=Math.floor(nx), cj=Math.floor(ny);
  var fx=nx-ci, fy=ny-cj;           // local 0..1 within cell
  var wi=tx>0?((ci%tx+tx)%tx):ci, wj=ty>0?((cj%ty+ty)%ty):cj;
  var h=cellHash(wi,wj,seed);
  var flip=(h&1)===1;               // two orientations
  var d;
  if(mode==="lines"){
    // straight connector: either horizontal or vertical band through the cell
    d=flip?Math.abs(fy-0.5):Math.abs(fx-0.5);
    return clamp(1-d/(thick+0.0001));
  }
  // arcs / maze: two quarter circles radius 0.5 centered on opposite corners.
  // flip chooses which diagonal pair of corners.
  var d1,d2;
  if(!flip){
    d1=Math.abs(Math.sqrt(fx*fx+fy*fy)-0.5);             // corner (0,0)
    d2=Math.abs(Math.sqrt((1-fx)*(1-fx)+(1-fy)*(1-fy))-0.5); // corner (1,1)
  } else {
    d1=Math.abs(Math.sqrt((1-fx)*(1-fx)+fy*fy)-0.5);     // corner (1,0)
    d2=Math.abs(Math.sqrt(fx*fx+(1-fy)*(1-fy))-0.5);     // corner (0,1)
  }
  d=Math.min(d1,d2);
  var line=clamp(1-d/(thick+0.0001));
  if(mode==="maze"){
    // fill one side of the arc for a solid maze-wall look
    return clamp(line>0.01?1:0);
  }
  return line;
}

// ═══ HISTOGRAM ═══════════════════════════════════════════════════
// Updated each render cycle. Module-level for speed.
var _lastHistogram=new Float32Array(64); // kept for compat
var _lastEdgeAnalysis={seamX:0,seamY:0,maxEdge:0,worst:0,clipped:false};
var _edgeCheckMode="cut"; // "cut" = effect runs off edge, "seam" = opposite borders mismatch
var _lastHistR=new Float32Array(64),_lastHistG=new Float32Array(64),_lastHistB=new Float32Array(64),_lastHistA=new Float32Array(64);
function updateHistogram(buf,size){
  // Single-pass: compute all 4 channel histograms + luminance approximation
  // in one loop instead of 5 separate passes. For 256x256 this is 65k iterations
  // instead of 327k, plus better cache locality (each pixel read once).
  var hR=_lastHistR,hG=_lastHistG,hB=_lastHistB,hA=_lastHistA,hL=_lastHistogram;
  for(var i=0;i<64;i++){hR[i]=0;hG[i]=0;hB[i]=0;hA[i]=0;}
  var n=size*size;
  for(var i=0;i<n;i++){
    var ii=i*4;
    var r=buf[ii],g=buf[ii+1],b=buf[ii+2],a=buf[ii+3];
    // Clamp + scale to 0..63 — bit-or with 0 floors, then min via comparison
    var rb=r<0?0:r>=1?63:(r*63)|0;
    var gb=g<0?0:g>=1?63:(g*63)|0;
    var bb=b<0?0:b>=1?63:(b*63)|0;
    var ab=a<0?0:a>=1?63:(a*63)|0;
    hR[rb]++;hG[gb]++;hB[bb]++;hA[ab]++;
  }
  // Normalize each histogram to [0,1] by max bucket
  var mxR=0,mxG=0,mxB=0,mxA=0;
  for(var j=0;j<64;j++){
    if(hR[j]>mxR)mxR=hR[j];
    if(hG[j]>mxG)mxG=hG[j];
    if(hB[j]>mxB)mxB=hB[j];
    if(hA[j]>mxA)mxA=hA[j];
  }
  var iR=mxR>0?1/mxR:0,iG=mxG>0?1/mxG:0,iB=mxB>0?1/mxB:0,iA=mxA>0?1/mxA:0;
  for(var j=0;j<64;j++){
    hR[j]*=iR;hG[j]*=iG;hB[j]*=iB;hA[j]*=iA;
    // Luminance approximation directly from normalized channel histograms
    hL[j]=hR[j]*0.299+hG[j]*0.587+hB[j]*0.114;
  }
}
// Analyze the rendered buffer's borders. A glow or shape that runs off the
// canvas edge leaves the opposite edge mismatched, so when the texture tiles you
// get a visible cut/seam. We measure the worst luminance mismatch between
// opposite edges (seamX = left vs right, seamY = top vs bottom) and how bright
// the edges are overall. Returns values in 0..1.
function analyzeEdges(buf,size,mode){
  function lum(i){var ii=i*4;return buf[ii]*0.299+buf[ii+1]*0.587+buf[ii+2]*0.114;}
  mode=mode||"cut";
  // Per-border mean brightness.
  var sL=0,sR=0,sT=0,sB=0;
  for(var y=0;y<size;y++){sL+=lum(y*size+0);sR+=lum(y*size+(size-1));}
  for(var x=0;x<size;x++){sT+=lum(0*size+x);sB+=lum((size-1)*size+x);}
  var mL=sL/size,mR=sR/size,mT=sT/size,mB=sB/size;
  // Per-border mismatch with the opposite side.
  var dH=0,dV=0;
  for(var y2=0;y2<size;y2++){dH+=Math.abs(lum(y2*size+0)-lum(y2*size+(size-1)));}
  for(var x2=0;x2<size;x2++){dV+=Math.abs(lum(0*size+x2)-lum((size-1)*size+x2));}
  var seamH=dH/size, seamV=dV/size;
  var edges,maxEdge,cutCount,names=[];
  if(mode==="seam"){
    // Tiling check: opposite borders must match. A uniform-bright texture passes.
    var THRs=0.18;
    edges={left:seamH>THRs,right:seamH>THRs,top:seamV>THRs,bottom:seamV>THRs};
    maxEdge=Math.max(seamH,seamV);
    cutCount=(seamH>THRs?1:0)+(seamV>THRs?1:0);
    if(seamH>THRs)names.push("left/right"); if(seamV>THRs)names.push("top/bottom");
  } else {
    // "cut" mode (default): an isolated effect (glow, spark) should fade to ~0
    // before the edge. A border still bright = the effect is chopped there.
    // To avoid false alarms on full textures, a bright border only counts when it
    // ALSO differs from the opposite side (a uniform fill has matching edges and
    // is left alone).
    var THR=0.12, MATCH=0.06;
    edges={left:mL>THR&&seamH>MATCH,right:mR>THR&&seamH>MATCH,top:mT>THR&&seamV>MATCH,bottom:mB>THR&&seamV>MATCH};
    maxEdge=Math.max(mL,mR,mT,mB);
    cutCount=(edges.left?1:0)+(edges.right?1:0)+(edges.top?1:0)+(edges.bottom?1:0);
    if(edges.top)names.push("top"); if(edges.bottom)names.push("bottom");
    if(edges.left)names.push("left"); if(edges.right)names.push("right");
  }
  var clipped=cutCount>0;
  return {means:{left:mL,right:mR,top:mT,bottom:mB},edges:edges,maxEdge:maxEdge,
          cutCount:cutCount,sides:names.join(", "),clipped:clipped,seamH:seamH,seamV:seamV,mode:mode};
}

// Auto-fix for a non-tileable cut: fade the borders to zero with a smooth
// vignette so the effect no longer hits a hard edge. falloff = fraction of the
// image (from each edge) over which it ramps to zero. Multiplies all channels.
function fEdgeFade(buf,w,h,falloff){
  falloff=falloff!=null?falloff:0.18;
  var fw=Math.max(0.02,falloff);
  for(var y=0;y<h;y++){
    var ny=y/(h-1); // 0..1
    var fy=Math.min(ny,1-ny)/fw; if(fy>1)fy=1;
    for(var x=0;x<w;x++){
      var nx=x/(w-1);
      var fx=Math.min(nx,1-nx)/fw; if(fx>1)fx=1;
      // smoothstep on the smaller of the two axis falloffs
      var t=Math.min(fx,fy); t=t*t*(3-2*t);
      var ii=(y*w+x)*4;
      buf[ii]*=t; buf[ii+1]*=t; buf[ii+2]*=t;
      // fade alpha too so transparency follows the glow (if present)
      buf[ii+3]*=t;
    }
  }
}

// Compute the black/white points of the final image from the luminance
// histogram, for Auto Levels. Returns {lo,hi} in 0..1 — the darkest and
// brightest meaningful values (ignoring a tiny 0.2% tail so single stray pixels
// don't ruin the stretch). If the image already fills the range, lo~0 hi~1.

function Histogram(p){
  var canvasRef=useRef(null);
  var tick=p.tick||0;
  var chanMode=p.chanMode||null;
  useEffect(function(){
    var cv=canvasRef.current;if(!cv)return;
    cv.width=148;cv.height=48;
    var ctx=cv.getContext("2d");
    ctx.fillStyle="#0d0d0d";ctx.fillRect(0,0,148,48);
    var bw=148/64;
    // Channel colors
    var draws=chanMode==="r"?[{h:_lastHistR,c:"rgba(255,100,100,0.75)"}]:
              chanMode==="g"?[{h:_lastHistG,c:"rgba(100,220,100,0.75)"}]:
              chanMode==="b"?[{h:_lastHistB,c:"rgba(80,180,255,0.75)"}]:
              chanMode==="a"?[{h:_lastHistA,c:"rgba(200,140,255,0.75)"}]:
              [{h:_lastHistR,c:"rgba(255,80,80,0.35)"},{h:_lastHistG,c:"rgba(80,220,80,0.35)"},{h:_lastHistB,c:"rgba(80,160,255,0.35)"}];
    draws.forEach(function(d){
      ctx.fillStyle=d.c;
      for(var i=0;i<64;i++){var h=d.h[i]*44;ctx.fillRect(i*bw,48-h,Math.max(1,bw-1),h);}
    });
    ctx.strokeStyle="#1c1c1c";ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(0,47);ctx.lineTo(148,47);ctx.stroke();
  },[tick,chanMode]);
  return React.createElement("div",{style:{marginBottom:10}},
    React.createElement("span",{style:{fontSize:9,color:"#555",textTransform:"uppercase",letterSpacing:1.2,display:"block",marginBottom:4}},
      chanMode?chanMode.toUpperCase()+" Channel — Histogram":"Histogram"
    ),
    React.createElement("canvas",{ref:canvasRef,style:{display:"block",width:148,height:48,borderRadius:3,border:"1px solid #1c1c1c",imageRendering:"auto"}})
  );
}

// ═══ CURVE MATH (monotone cubic spline) ════════════════════════
function evalCurveLUT(pts,mode){
  // pts: sorted [{x,y},...] with x,y in [0,1]
  // mode: "smooth" (default) | "linear" | "step"
  var n=pts.length;
  var lut=new Float32Array(256);
  if(n<2){for(var i=0;i<256;i++)lut[i]=i/255;return lut;}
  var curveMode=mode||"smooth";

  if(curveMode==="linear"){
    for(var si=0;si<256;si++){
      var t=si/255;
      if(t<=pts[0].x){lut[si]=clamp(pts[0].y);continue;}
      if(t>=pts[n-1].x){lut[si]=clamp(pts[n-1].y);continue;}
      var seg=0;
      for(var j=0;j<n-1;j++){if(t>=pts[j].x&&t<=pts[j+1].x){seg=j;break;}}
      var tt=(t-pts[seg].x)/Math.max(pts[seg+1].x-pts[seg].x,0.0001);
      lut[si]=clamp(pts[seg].y+(pts[seg+1].y-pts[seg].y)*tt);
    }
    return lut;
  }
  if(curveMode==="step"){
    for(var si=0;si<256;si++){
      var t=si/255;
      if(t>=pts[n-1].x){lut[si]=clamp(pts[n-1].y);continue;}
      var seg=0;
      for(var j=n-2;j>=0;j--){if(t>=pts[j].x){seg=j;break;}}
      lut[si]=clamp(pts[seg].y);
    }
    return lut;
  }
  // Smooth: Fritsch-Carlson monotone cubic
  var d=[],m=new Array(n);
  for(var i=0;i<n-1;i++) d[i]=(pts[i+1].y-pts[i].y)/Math.max(pts[i+1].x-pts[i].x,0.0001);
  m[0]=d[0]; m[n-1]=d[n-2];
  for(var i=1;i<n-1;i++) m[i]=d[i-1]*d[i]<=0?0:(d[i-1]+d[i])/2;
  for(var i=0;i<n-1;i++){
    if(Math.abs(d[i])<0.0001){m[i]=m[i+1]=0;continue;}
    var a=m[i]/d[i],b=m[i+1]/d[i],s=a*a+b*b;
    if(s>9){var tau=3/Math.sqrt(s);m[i]=tau*a*d[i];m[i+1]=tau*b*d[i];}
  }
  for(var si=0;si<256;si++){
    var t=si/255;
    if(t<=pts[0].x){lut[si]=clamp(pts[0].y);continue;}
    if(t>=pts[n-1].x){lut[si]=clamp(pts[n-1].y);continue;}
    var seg=0;
    for(var j=0;j<n-1;j++){if(t>=pts[j].x&&t<=pts[j+1].x){seg=j;break;}}
    var x0=pts[seg].x,x1=pts[seg+1].x,y0=pts[seg].y,y1=pts[seg+1].y;
    var h=Math.max(x1-x0,0.0001),tt=(t-x0)/h;
    var tt2=tt*tt,tt3=tt2*tt;
    var v=(2*tt3-3*tt2+1)*y0+(tt3-2*tt2+tt)*h*m[seg]+(-2*tt3+3*tt2)*y1+(tt3-tt2)*h*m[seg+1];
    lut[si]=clamp(v);
  }
  return lut;
}
// Default identity curve points
var DEFAULT_CURVE=[{x:0,y:0},{x:1,y:1}];

// ── Animation track context — allows any Slider to add a track ────────────
var AnimTrackContext=React.createContext(null);
// ── Touch active context — passes "touchActive" (touchMode||isMobile) to any
// component that needs to enlarge interactive handles (CurveEditor, GradientRamp).
// Avoids prop drilling through 5 levels of panels.
var TouchActiveContext=React.createContext(false);
// Usage in TexGen: <AnimTrackContext.Provider value={addTrackFn}>
// In Slider: var addTrack=React.useContext(AnimTrackContext);

function isCurveIdentity(pts){return !pts||pts.length===2&&pts[0].x===0&&pts[0].y===0&&pts[1].x===1&&pts[1].y===1;}

// ═══ SEED HISTORY ═══════════════════════════════════════════════
// Circular buffer: last 10 seeds per layer index.
// Key = layer label+idx to avoid collision when layers are reordered.
var _seedHistory={}; // { key: [seed, seed, ...] }
var SEED_HIST_MAX=10;
function recordSeed(key,seed){
  if(!_seedHistory[key])_seedHistory[key]=[];
  var h=_seedHistory[key];
  // Don't push duplicate of last entry
  if(h.length>0&&h[h.length-1]===seed)return;
  h.push(seed);
  if(h.length>SEED_HIST_MAX)h.shift();
}
function getSeedHistory(key){return _seedHistory[key]||[];}

// Seed history mini-widget — shown inline below the seed slider
function SeedHistory(p){
  var hist=getSeedHistory(p.histKey)||[];
  var current=p.current;
  if(hist.length<=1)return null; // nothing useful to show
  // Show up to last 8, most recent last, current highlighted
  var visible=hist.slice(-8);
  return React.createElement("div",{style:{
    display:"flex",gap:2,flexWrap:"wrap",marginTop:4,marginBottom:2
  }},
    React.createElement("span",{style:{fontSize:7,color:"#333",letterSpacing:0.8,
      textTransform:"uppercase",alignSelf:"center",marginRight:2}},"History:"),
    visible.map(function(s,i){
      var isCur=s===current;
      return React.createElement("button",{key:i,
        onClick:function(){p.onChange(s);},
        title:"Restore seed "+s,
        style:{
          padding:"2px 5px",fontSize:8,fontFamily:"monospace",
          background:isCur?"#e8900a":"#141414",
          color:isCur?"#000":"#555",
          border:"1px solid "+(isCur?"#e8900a":"#1e1e1e"),
          borderRadius:2,cursor:"pointer",lineHeight:1,
          transition:"all 0.08s"
        },
        onMouseEnter:isCur?null:function(e){e.currentTarget.style.borderColor="#e8900a";e.currentTarget.style.color="#e8900a";},
        onMouseLeave:isCur?null:function(e){e.currentTarget.style.borderColor="#1e1e1e";e.currentTarget.style.color="#555";}
      },s);
    })
  );
}
var _imgCache={};
function getImgPixels(imageData){
  if(!imageData)return null;
  var key=imageData.length+"_"+imageData.substring(0,80);
  return _imgCache[key]||null;
}
function preDecodeImage(imageData,cb){
  if(!imageData){cb&&cb(null);return;}
  var key=imageData.length+"_"+imageData.substring(0,80);
  if(_imgCache[key]){cb&&cb(_imgCache[key]);return;}
  var img=new Image();
  img.onload=function(){
    URL.revokeObjectURL(img.src); // revoke immediately — image data is already decoded
    var c=document.createElement("canvas");c.width=img.width;c.height=img.height;
    c.getContext("2d").drawImage(img,0,0);
    var px=c.getContext("2d").getImageData(0,0,img.width,img.height);
    _imgCache[key]={data:px.data,w:img.width,h:img.height};
    cb&&cb(_imgCache[key]);
  };
  img.onerror=function(){console.warn("preDecodeImage: failed to load image");cb&&cb(null);};
  img.src=imageData;
}

// ═══ UV DISTORTION ══════════════════════════════════════════════
// Reusable 2-element buffer for distDelta output — avoids allocation per call
var _ddOut=[0,0];
var _uvOut=[0,0];
// distDelta: d = {type, amt, freq, oct, gain, lac, base, seed}
// IMPORTANT: X and Y channels use completely independent perm tables to
// prevent correlated large-scale bias that would shift all pixels in one direction.
// Bilinear-sample luminance from an RGBA Float32 buffer at wrapped UV.
// Used by Layer Warp distortion to read the pre-rendered source layer.
function sampleBufLum(b,size,u,v){
  var uw=((u%1)+1)%1,vw=((v%1)+1)%1;
  var fx=uw*size,fy=vw*size;
  var x0=Math.floor(fx)%size,y0=Math.floor(fy)%size;
  var x1=(x0+1)%size,y1=(y0+1)%size;
  var tx=fx-Math.floor(fx),ty=fy-Math.floor(fy);
  var i00=(y0*size+x0)*4,i10=(y0*size+x1)*4,i01=(y1*size+x0)*4,i11=(y1*size+x1)*4;
  var l00=0.299*b[i00]+0.587*b[i00+1]+0.114*b[i00+2];
  var l10=0.299*b[i10]+0.587*b[i10+1]+0.114*b[i10+2];
  var l01=0.299*b[i01]+0.587*b[i01+1]+0.114*b[i01+2];
  var l11=0.299*b[i11]+0.587*b[i11+1]+0.114*b[i11+2];
  return (l00*(1-tx)+l10*tx)*(1-ty)+(l01*(1-tx)+l11*tx)*ty;
}

// Perm-pair cache for distDelta: getPerm's LRU touch costs 3 Map ops per call.
// distDelta runs per pixel, so caching the (pmX,pmY) pair per seed in a plain
// object cuts 6 Map ops/pixel from every render with active distortion.
// Perm tables are deterministic per seed, so entries never go stale.
var _ddPmCache={},_ddPmCacheN=0;
function distDelta(u0,v0,dt,amt,freq,dseed,d,tpx,tpy){
  if(!dt||dt==="none"||!amt){_ddOut[0]=0;_ddOut[1]=0;return _ddOut;}
  var cx=u0-0.5,cy=v0-0.5,u1=u0,v1=v0;
  var f=freq||3;
  // Seamless layer: the warp field itself must be periodic in UV with period 1,
  // i.e. the noise must tile with integer period f. Snap f and derive the tile.
  var _tw=0;
  if(tpx||tpy){f=Math.max(1,Math.round(f));_tw=f;}
  var oct=(d&&d.oct)||4, lac=(d&&d.lac)||2, gain=(d&&d.gain)||0.5;
  var base=(d&&d.base)||"perlin";
  var s=dseed||9999;
  // Independent perm tables per channel — critical for zero-mean warp
  var _pp=_ddPmCache[s];
  if(!_pp){
    if(_ddPmCacheN>64){_ddPmCache={};_ddPmCacheN=0;}
    _pp=[getPerm(s),getPerm((s*1664525+1013904223)&0x7fffffff||1)];
    _ddPmCache[s]=_pp;_ddPmCacheN++;
  }
  var pmX=_pp[0],pmY=_pp[1];

  if(dt==="noise"){
    u1=u0+(perlin(u0*f,      v0*f,      pmX,_tw,_tw)-0.5)*amt;
    v1=v0+(perlin(u0*f+31.7, v0*f+57.3, pmY,_tw,_tw)-0.5)*amt;
  }
  else if(dt==="fbmNoise"||dt==="fbm"){
    _distFo.base=base;_distFo.oct=oct;_distFo.lac=lac;_distFo.gain=gain;_distFo.mode="normal";
    u1=u0+(fbm(u0*f,        v0*f,        pmX,_distFo,_tw,_tw)-0.5)*amt;
    v1=v0+(fbm(u0*f+31.7,   v0*f+57.3,   pmY,_distFo,_tw,_tw)-0.5)*amt;
  }
  else if(dt==="ridged"){
    _distFo.base=base;_distFo.oct=oct;_distFo.lac=lac;_distFo.gain=gain;_distFo.mode="ridged";
    u1=u0+(fbm(u0*f,        v0*f,        pmX,_distFo,_tw,_tw)-0.5)*amt;
    v1=v0+(fbm(u0*f+31.7,   v0*f+57.3,   pmY,_distFo,_tw,_tw)-0.5)*amt;
  }
  else if(dt==="turbulence"){
    _distFo.base=base;_distFo.oct=oct;_distFo.lac=lac;_distFo.gain=gain;_distFo.mode="turbulence";
    var TMEAN=0.35;
    u1=u0+(fbm(u0*f,        v0*f,        pmX,_distFo,_tw,_tw)-TMEAN)*amt;
    v1=v0+(fbm(u0*f+31.7,   v0*f+57.3,   pmY,_distFo,_tw,_tw)-TMEAN)*amt;
  }
  else if(dt==="voronoi"){
    var wr=worley(u0*f,        v0*f,        s,           "euclidean",_tw,_tw);
    var wr2=worley(u0*f+31.7,  v0*f+57.3,   s^0xdeadbeef,"euclidean",_tw,_tw);
    u1=u0+(wr.d1 -0.5)*amt;
    v1=v0+(wr2.d1-0.5)*amt;
  }
  else if(dt==="swirl"){
    // Swirl: angle strongest at center, falls off outward
    // falloffRadius controls the falloff distance (0.5 = half canvas, 1.0 = full canvas)
    var r=Math.hypot(cx,cy);
    var fo=d&&d.falloff||"center";
    var fr=d&&d.falloffRadius>0?d.falloffRadius:0.5;
    var rn=r/fr; // normalize by radius
    var fv=fo==="edge"?clamp(rn):clamp(1-rn);
    var angle=amt*Math.PI*2*fv;
    var sc2=Math.cos(angle),ss2=Math.sin(angle);
    u1=0.5+cx*sc2-cy*ss2;v1=0.5+cx*ss2+cy*sc2;
  }
  else if(dt==="twist"){
    // Twist: angle increases with radius (outside spins, center stable)
    var r=Math.hypot(cx,cy);
    var fo=d&&d.falloff||"center";
    var fr=d&&d.falloffRadius>0?d.falloffRadius:0.5;
    var rn=r/fr;
    var fv=fo==="edge"?clamp(1-rn):clamp(rn);
    var angle=amt*Math.PI*4*fv;
    var sc2=Math.cos(angle),ss2=Math.sin(angle);
    u1=0.5+cx*sc2-cy*ss2;v1=0.5+cx*ss2+cy*sc2;
  }
  else if(dt==="pinch"){
    var r=Math.hypot(cx,cy);if(r>0){var nr=Math.pow(r,1+amt);u1=0.5+(cx/r)*nr;v1=0.5+(cy/r)*nr;}
  }
  else if(dt==="bulge"){
    var r=Math.hypot(cx,cy);if(r>0){var nr=Math.pow(r,1-amt*0.8);u1=0.5+(cx/r)*nr;v1=0.5+(cy/r)*nr;}
  }
  else if(dt==="ripple"){
    u1=u0+Math.sin(v0*f*Math.PI*2)*amt*0.5;v1=v0+Math.sin(u0*f*Math.PI*2)*amt*0.5;
  }
  else if(dt==="fisheye"){
    var r=Math.hypot(cx,cy)*2,kv=1+amt*(r*r);u1=0.5+cx*kv;v1=0.5+cy*kv;
  }
  else if(dt==="radial"){
    // Polar displacement: moves pixels along radial and/or tangential direction.
    // Mode: "radial" = pure in/out, "tangential" = circular (no in/out), "spiral" = mix of both
    // Profile: how strength varies with radius
    // cx/cy are centered coordinates (relative to distortion center)
    var r=Math.hypot(cx,cy);
    if(r<0.0001){_ddOut[0]=0;_ddOut[1]=0;return _ddOut;}
    var fr=d&&d.falloffRadius>0?d.falloffRadius:0.4;
    var profile=d&&d.profile||"linear";
    var rn=r/fr;
    // Radial profile (controls amplitude vs distance)
    var fv;
    if(profile==="flat")    fv=1;
    else if(profile==="inverse") fv=clamp(1-rn);
    else if(profile==="gauss")   fv=Math.exp(-rn*rn*2.5);
    else if(profile==="ring")    fv=Math.exp(-Math.pow((rn-1)*3,2));
    else /* linear */            fv=clamp(1-rn);
    // Mode: direction of displacement
    var mode=d&&d.mode||"radial";
    var radX=cx/r, radY=cy/r;   // unit radial vector (outward)
    var tanX=-cy/r, tanY=cx/r;  // unit tangential vector (counter-clockwise)
    var dispR=0,dispT=0;
    if(mode==="radial"){
      dispR=1;
    } else if(mode==="tangential"){
      dispT=1;
    } else if(mode==="spiral"){
      // blend: half radial, half tangential → diagonal spiral
      var spiralAngle=(d&&d.spiralBias!=null?d.spiralBias:0.5)*Math.PI*0.5;
      dispR=Math.cos(spiralAngle);
      dispT=Math.sin(spiralAngle);
    }
    // Noise modulation (optional — uses fBm)
    var mod=1;
    if(d&&d.modulate){
      _distFo.base=base;_distFo.oct=oct;_distFo.lac=lac;_distFo.gain=gain;
      _distFo.mode=d.noiseMode||"normal";
      var noiseAmt=d.noiseAmt!=null?d.noiseAmt:0.7;
      var n=fbm(cx*f,cy*f,pmX,_distFo,0,0);
      mod=(1-noiseAmt)+n*noiseAmt*1.6;
    }
    var dir=(d&&d.direction==="inward")?-1:1;
    var disp=amt*fv*mod*dir;
    u1=u0+(radX*dispR+tanX*dispT)*disp;
    v1=v0+(radY*dispR+tanY*dispT)*disp;
  }
  else if(dt==="directional"){
    // Uniform directional shift, modulated by fBm noise field
    var ang=(d&&d.angle!=null?d.angle:0)*Math.PI/180;
    var dx=Math.cos(ang),dy=Math.sin(ang);
    // Noise amount varies per-pixel along perpendicular axis for organic look
    var mod=1;
    if(d&&d.modulate){
      _distFo.base=base;_distFo.oct=oct;_distFo.lac=lac;_distFo.gain=gain;_distFo.mode="normal";
      mod=0.3+fbm(u0*f,v0*f,pmX,_distFo)*1.4;
    }
    u1=u0+dx*amt*mod;
    v1=v0+dy*amt*mod;
  }
  else if(dt==="multidirectional"){
    // Multiple directional shifts blended, each rotated around the ring
    var N=Math.max(2,Math.round((d&&d.count)||4));
    var spread=d&&d.spread!=null?d.spread:1; // 0=all same dir, 1=full 360
    var baseAng=(d&&d.angle!=null?d.angle:0)*Math.PI/180;
    var falloff=d&&d.falloff||"none"; // "none" | "center" | "edge"
    var r2=Math.hypot(cx,cy);
    var fr2=d&&d.falloffRadius>0?d.falloffRadius:0.5;
    var fv2=1;
    if(falloff==="center"){fv2=clamp(1-r2/fr2);}
    else if(falloff==="edge"){fv2=clamp(r2/fr2);}
    var du2=0,dv2=0;
    _distFo.base=base;_distFo.oct=oct;_distFo.lac=lac;_distFo.gain=gain;_distFo.mode="normal";
    for(var k=0;k<N;k++){
      var a=baseAng+(k/N)*Math.PI*2*spread;
      var dx=Math.cos(a),dy=Math.sin(a);
      // Each direction weighted by a noise field sampled at its own phase
      var w=fbm(u0*f+k*7.3,v0*f+k*4.1,pmX,_distFo);
      du2+=dx*w;
      dv2+=dy*w;
    }
    var scale=amt*fv2/N;
    u1=u0+du2*scale;
    v1=v0+dv2*scale;
  }
  _ddOut[0]=u1-u0;_ddOut[1]=v1-v0;return _ddOut;
}
function applyUVDists(u0,v0,dists,baseSeed){
  if(!dists||!dists.length){_uvOut[0]=u0;_uvOut[1]=v0;return _uvOut;}
  var du=0,dv=0;
  for(var i=0;i<dists.length;i++){
    var d=dists[i];
    if(!d||!d.type||d.type==="none"||!d.amt)continue;
    // Apply per-dist UV offset before sampling noise
    var su=u0+(d.offsetX||0), sv=v0+(d.offsetY||0);
    var delta=distDelta(su,sv,d.type,d.amt,d.freq||3,(baseSeed||1)+777+i*333,d);
    du+=delta[0];dv+=delta[1];
  }
  _uvOut[0]=u0+du;_uvOut[1]=v0+dv;return _uvOut;
}

var _uvT={u:0,v:0,nx:0,ny:0,cx:0,cy:0,tsx:0,tsy:0};
// ═══ FULL UV TRANSFORM ══════════════════════════════════════════
function transformUV(ux,uy,L){
  var u=ux+(L.offsetX||0),v=uy+(L.offsetY||0);
  // UV dists (additive deltas from same base)
  var uv2=applyUVDists(u,v,L.uvDists||[],L.seed||1);u=uv2[0];v=uv2[1];
  // Rotation
  var rot=L.rotation||0;
  if(rot){var rad=rot*Math.PI/180,cr=Math.cos(rad),sr=Math.sin(rad),cu=u-0.5,cv=v-0.5;u=0.5+cu*cr-cv*sr;v=0.5+cu*sr+cv*cr;}
  var sx=L.scaleX||3.5,sy=L.scaleLinked?sx:(L.scaleY||sx);
  // Seamless: snap to integer for tiling
  var tsx=0,tsy=0;
  if(L.seamless){sx=Math.round(sx)||1;sy=Math.round(sy)||1;tsx=sx;tsy=sy;}
  _uvT.u=u;_uvT.v=v;_uvT.nx=u*sx;_uvT.ny=v*sy;_uvT.cx=(u-0.5)*sx;_uvT.cy=(v-0.5)*sy;_uvT.tsx=tsx;_uvT.tsy=tsy;return _uvT;
}

// ═══ GRADIENT ═══════════════════════════════════════════════════
// Gradient generator with artist-facing parameters.
// sc: size/falloff multiplier (default 1 = legacy radius)
// fq: frequency multiplier for bands/rings/rays (default 1 = legacy counts)
// pw: gamma curve applied at the end (default 1 = linear)
// All defaults reproduce the pre-parameter output exactly, so old saves render identically.
function computeGrad(cx,cy,type,sc,fq,pw){
  sc=sc||1;fq=fq||1;pw=pw||1;
  var r=Math.hypot(cx,cy),a=(Math.atan2(cy,cx)+Math.PI)/(2*Math.PI);
  var val;
  if(type==="radial")          val=clamp(1-r*2/sc);
  else if(type==="linear")     val=clamp((cx/sc)+0.5);
  else if(type==="linearY")    val=clamp((cy/sc)+0.5);
  else if(type==="angular")    val=a;
  else if(type==="diamond")    val=clamp(1-(Math.abs(cx)+Math.abs(cy))*2/sc);
  else if(type==="cone")       val=Math.pow(clamp(1-r*2/sc),0.5);
  else if(type==="square")     val=clamp(1-Math.max(Math.abs(cx),Math.abs(cy))*2/sc);
  else if(type==="spiral")     val=clamp((a+r*2*fq)%1);
  // Rings (concentric bands)
  else if(type==="rings")      val=clamp(1-Math.abs((r*4*fq/sc%1)*2-1));
  // Sine radial (smooth concentric)
  else if(type==="sineRadial") val=(Math.sin(r*Math.PI*6*fq/sc)+1)*0.5;
  // Sine linear
  else if(type==="sineBands")  val=(Math.sin((cx/sc+0.5)*Math.PI*8*fq)+1)*0.5;
  // Angular bands (like pie slices)
  else if(type==="angBands")   val=clamp((a*8*fq%1)*1);
  // Sawtooth radial
  else if(type==="sawtooth")   val=1-(r*3*fq/sc%1);
  // Stepped (posterize-like): fq scales the level count (5 base)
  else if(type==="stepped"){var _st=Math.max(2,Math.round(5*fq));val=Math.round(clamp(1-r*2/sc)*_st)/_st;}
  // Star burst (angular sine): fq scales ray count (10 base)
  else if(type==="starBurst")  val=clamp((Math.sin(a*Math.PI*10*fq)+1)*0.5*(1-r*2/sc));
  // Pulse ring: a single soft ring at mid-radius — great for shockwaves
  else if(type==="pulseRing"){var _rr=r*2/sc;val=clamp(1-Math.abs(_rr-0.5)*4/Math.max(0.05,1/fq));}
  // Radial glow squared: very soft falloff, hot core
  else if(type==="glowCore"){var _g=clamp(1-r*2/sc);val=_g*_g*_g;}
  // Cross / plus gradient: bright along both axes
  else if(type==="cross"){var _cx=1-Math.abs(cx)*2*fq/sc,_cy=1-Math.abs(cy)*2*fq/sc;val=clamp(Math.max(_cx,_cy));}
  // Spiral arms (logarithmic-ish): rotating arms from center
  else if(type==="spiralArms"){var _sa=(a+r*fq*3/sc);val=(Math.sin(_sa*Math.PI*2*Math.max(1,Math.round(fq*3)))+1)*0.5*clamp(1-r*1.5/sc);}
  // Hexagonal radial (6-fold symmetric distance) — crystalline look
  else if(type==="hexRadial"){var _ha=Math.atan2(cy,cx);var _hr=r/Math.cos((((_ha%(Math.PI/3))+Math.PI/3)%(Math.PI/3))-Math.PI/6);val=clamp(1-_hr*2/sc);}
  // Ripple (decaying sine rings) — water/energy
  else if(type==="ripple"){var _rp=r*2/sc;val=clamp((Math.sin(_rp*Math.PI*6*fq)*0.5+0.5)*Math.max(0,1-_rp));}
  else val=clamp(cx+0.5);
  if(pw!==1){val=val<0?0:val>1?1:val;val=Math.pow(val,pw);}
  return val;
}

// ═══ SDF SHAPES ═════════════════════════════════════════════════
function sdfToV(s,soft){return clamp(0.5-s/Math.max(soft,0.001));}
// Distance from point (px,py) to segment (ax,ay)-(bx,by) — used by stroke-based shapes
function _segDist(px,py,ax,ay,bx,by){
  var vx=bx-ax,vy=by-ay,wx=px-ax,wy=py-ay;
  var c1=vx*wx+vy*wy, c2=vx*vx+vy*vy;
  var t=c2>0?Math.max(0,Math.min(1,c1/c2)):0;
  return Math.hypot(px-(ax+vx*t),py-(ay+vy*t));
}
function computeShape(cx,cy,kind,sp){
  // Rotation: spin the sampling coords by sp.rot (turns, 0..1). Cheap and works
  // for every shape since it happens before the SDF is evaluated.
  if(sp.rot){
    var _ra=sp.rot*6.2831853,_rc=Math.cos(_ra),_rs=Math.sin(_ra);
    var _ox=cx*_rc-cy*_rs, _oy=cx*_rs+cy*_rc; cx=_ox; cy=_oy;
  }
  var r1=sp.r1!=null?sp.r1:0.38;
  var r2=sp.r2!=null?sp.r2:0.18;
  var thick=sp.thick!=null?sp.thick:0.06;
  var corner=sp.corner!=null?sp.corner:0.5;
  var soft=sp.soft!=null?sp.soft:0.022;
  var gearTeeth=sp.gearTeeth!=null?Math.max(2,Math.round(sp.gearTeeth)):6;
  var petalN=sp.petalCount!=null?Math.max(2,Math.round(sp.petalCount)):5;
  var s=0;

  if(kind==="circle")  s=Math.hypot(cx,cy)-r1;
  else if(kind==="ring")    s=Math.abs(Math.hypot(cx,cy)-r1)-thick;
  else if(kind==="box"){var qx=Math.abs(cx)-r1,qy=Math.abs(cy)-r1;s=Math.hypot(Math.max(qx,0),Math.max(qy,0))+Math.min(Math.max(qx,qy),0);}
  else if(kind==="rbox"){var qx=Math.abs(cx)-r1+corner*0.1,qy=Math.abs(cy)-r1+corner*0.1;s=Math.hypot(Math.max(qx,0),Math.max(qy,0))-corner*0.1+Math.min(Math.max(qx,qy),0);}
  else if(kind==="diamond") s=Math.abs(cx)+Math.abs(cy)-r1;
  else if(kind==="ellipse") s=Math.hypot(cx/Math.max(r1,0.01),cy/Math.max(r2,0.01))-1;
  else if(kind==="capsule"){var h=r1*0.5,qy=Math.abs(cy)-h;s=Math.hypot(cx,qy>0?qy:0)-thick;}
  else if(kind==="moon"){var d=r1*corner*2;s=Math.max(Math.hypot(cx,cy)-r1,-(Math.hypot(cx-d,cy)-r2));}
  else if(kind==="cross"){
    var qx=Math.abs(cx),qy=Math.abs(cy);
    if(qx>qy){var t=qx;qx=qy;qy=t;}
    var b=r1*thick*4,a2=r1;
    s=Math.hypot(Math.max(qy-a2,0),Math.max(qx-b,0))+Math.min(Math.max(qy-a2,qx-b),0);
  }
  else if(kind==="tri"||kind==="pent"||kind==="hex"||kind==="oct"){
    var n=kind==="tri"?3:kind==="pent"?5:kind==="hex"?6:8;
    var a2=Math.PI*2/n,ang=Math.atan2(cx,cy),sec=Math.round(ang/a2)*a2;
    s=Math.hypot(cx,cy)*Math.cos(ang-sec)-r1*Math.cos(a2*0.5);
  }
  else if(kind==="star4"||kind==="star5"||kind==="star6"){
    var n=kind==="star4"?4:kind==="star5"?5:6;
    var step=Math.PI/n,a=Math.atan2(cx,cy),sec=Math.round(a/step)*step;
    s=Math.hypot(cx,cy)-lerp(r1,r2,Math.abs(a-sec)/step);
  }
  // ── Advanced shapes ────────────────────────────────────────────
  else if(kind==="heart"){
    // IQ heart SDF — r1 controls size, corner controls vertical offset
    var hcx=cx/r1, hcy=(-cy+(r1*(corner-0.5)))/r1;
    var len=Math.sqrt(hcx*hcx+hcy*hcy);
    var hcx2=hcx,hcy2=hcy;
    if(hcy2+Math.abs(hcx2)>0){
      s=(Math.sqrt(hcx2*hcx2+hcy2*hcy2)-0.5)*r1;
    } else {
      var v=Math.sqrt(hcx2*hcx2+hcy2*hcy2);
      s=(Math.sqrt((hcx2+1)*(hcx2+1)+hcy2*hcy2)+Math.sqrt((hcx2-1)*(hcx2-1)+hcy2*hcy2))*0.5-1;
      s*=r1;
    }
  }
  else if(kind==="flower"){
    // SDF flower: r1=outer radius, r2=inner/petal depth, petalN=count
    var ang=Math.atan2(cy,cx);
    var rad=Math.hypot(cx,cy);
    var petal=r2*Math.cos(ang*petalN); // sinusoidal modulation
    s=rad-(r1-r2+petal);
  }
  else if(kind==="gear"){
    // Gear: base circle ± tooth bumps via cosine
    var ang=Math.atan2(cy,cx);
    var rad=Math.hypot(cx,cy);
    var toothAmp=r1*thick; // thick controls tooth height
    var baseR=r1-toothAmp;
    var tooth=toothAmp*(Math.cos(ang*gearTeeth)>corner*2-1?1:-1);
    s=rad-(baseR+toothAmp+tooth)*0.5;
    // Add inner hole
    var hole=Math.hypot(cx,cy)-r2;
    s=Math.max(s,-hole);
  }
  else if(kind==="frame"){
    // Hollow box frame: r1=outer half-size, thick=border width
    var qx=Math.abs(cx)-r1,qy=Math.abs(cy)-r1;
    var outer=Math.hypot(Math.max(qx,0),Math.max(qy,0))+Math.min(Math.max(qx,qy),0);
    var inner=r1-thick*r1*2;
    var iqx=Math.abs(cx)-inner,iqy=Math.abs(cy)-inner;
    var innerS=Math.hypot(Math.max(iqx,0),Math.max(iqy,0))+Math.min(Math.max(iqx,iqy),0);
    s=Math.max(outer,-innerS);
  }
  else if(kind==="horseshoe"){
    // Open arc: r1=radius, thick=arm thickness, corner=opening (0..1)
    var halfOpen=corner*Math.PI; // how wide the gap is
    var ang=Math.atan2(cy,cx);
    var rad=Math.hypot(cx,cy);
    var inGap=Math.abs(ang)>Math.PI-halfOpen;
    if(inGap){
      // Distance to nearest arc endpoint
      var ea=Math.PI-halfOpen;
      var ex=Math.cos(ea)*r1,ey=Math.sin(ea)*r1;
      var d1=Math.hypot(cx-ex,cy-ey),d2=Math.hypot(cx-ex,cy+ey);
      s=Math.min(d1,d2)-thick;
    } else {
      s=Math.abs(rad-r1)-thick;
    }
  }
  else if(kind==="pie"){
    // Pie/sector: r1=radius, corner=half-angle 0..1 (maps to 0..PI)
    var pa=corner*Math.PI; // half-angle
    var c2=Math.cos(pa),s2=Math.sin(pa);
    var rad=Math.hypot(cx,cy);
    // Mirror to upper half
    var acx=cx,acy=cy;
    if(acx*s2-acy*c2>0){acy=-acy;} // mirror
    var edgeDist=(Math.abs(acx*c2+acy*s2)-r1)*c2;
    var pointDist=Math.hypot(cx,cy>0?cy:-cy)-r1;
    if(pa>0&&pa<Math.PI){
      // blend: inside sector = max of two edge planes
      var d1=-(c2*cx-s2*Math.abs(cy));
      var d2=-(c2*cx+s2*Math.abs(cy));
      if(pa<Math.PI*0.5){
        s=Math.max(d1,d2,rad-r1);
      } else {
        s=Math.max(Math.min(d1,d2),rad-r1);
      }
    } else {
      s=rad-r1;
    }
  }
  else if(kind==="egg"){
    // Egg: r1=width, r2=height bottom, corner=asymmetry 0..1
    // Uses a smooth quartic approximation
    var ry=r2+(r1-r2)*(1-corner)*(cy<0?0:1);
    s=Math.hypot(cx/Math.max(r1,0.01),cy/Math.max(ry,0.01))-1;
  }
  else if(kind==="vesica"){
    // Vesica piscis: r1=radius, corner=separation (0..1)
    var d=r1*corner;
    s=Math.max(Math.hypot(cx-d,cy)-r1,Math.hypot(cx+d,cy)-r1);
  }
  else if(kind==="stroke"){
    // Stroked wave: r1=x-extent, thick=line thickness, gearTeeth=frequency, corner=amplitude (0..1)
    var waveAmp=r1*corner;
    var waveFreq=gearTeeth;
    var wave=Math.sin(cx/Math.max(r1,0.001)*Math.PI*waveFreq)*waveAmp;
    // Clamp x to extent
    var qx2=Math.abs(cx)-r1;
    var lineD=Math.abs(cy-wave)-thick;
    s=Math.max(lineD,qx2>0?qx2:0);
  }
  else if(kind==="teardrop"){
    // Teardrop: full circle at the bottom, tapering to a sharp tip at the top.
    // Standard construction: a circle whose radius shrinks toward the tip,
    // with the tip placed at cy=-r1 and the fat bottom at cy=+r1*0.5.
    var tipY=-r1, cenY=r1*0.35, rad=r1*0.6;
    if(cy>=cenY){
      s=Math.hypot(cx,cy-cenY)-rad;           // bottom: plain circle
    } else {
      // top: linear taper of the half-width from rad (at cenY) to 0 (at tipY)
      var frac=(cy-tipY)/(cenY-tipY);          // 0 at tip, 1 at circle center
      frac=frac<0?0:frac>1?1:frac;
      var w=rad*frac;
      // perpendicular distance to the tapered side
      var dx=cenY-tipY, dy=rad;
      var len=Math.hypot(dx,dy);
      s=(Math.abs(cx)*dx-(cy-tipY)*dy)/len;    // signed dist to sloped edge
      s=Math.max(s, tipY-cy);
    }
  }
  else if(kind==="arrow"){
    // Up-pointing arrow: triangular head (top) + rectangular shaft (bottom).
    // In screen space cy increases downward, so the tip is at cy = -r1.
    var ax=Math.abs(cx);
    var shaftW=r1*Math.max(0.12,thick*2.2);
    var headW=r1*(0.4+corner*0.45);  // half-width of the head base (corner-driven)
    var headTopY=-r1;           // tip
    var headBaseY=-r1*0.05;     // where head meets shaft
    // Head as a triangle SDF (tip up): width grows from 0 at tip to headW at base
    var headS;
    {
      var ht=headBaseY-headTopY;
      var frac=(cy-headTopY)/ht;            // 0 at tip, 1 at base
      var edge=ax-headW*frac;               // horizontal distance past the sloped edge
      // signed: inside when edge<0 and within vertical band
      var slopeLen=Math.hypot(headW,ht);
      var dEdge=edge*ht/slopeLen;           // perpendicular dist to the slope
      headS=Math.max(dEdge, headTopY-cy, cy-headBaseY);
    }
    // Shaft box from headBaseY down to r1
    var shaftTop=headBaseY, shaftBot=r1;
    var scy=cy-(shaftTop+shaftBot)*0.5, shaftH=(shaftBot-shaftTop)*0.5;
    var sqx=ax-shaftW, sqy=Math.abs(scy)-shaftH;
    var shaftS=Math.hypot(Math.max(sqx,0),Math.max(sqy,0))+Math.min(Math.max(sqx,sqy),0);
    s=Math.min(headS,shaftS);
  }
  else if(kind==="bolt"){
    // Realistic lightning. The main channel is an irregular path top→bottom
    // whose horizontal position is the sum of two incommensurate sines (a cheap
    // fractal), so segments are unevenly jagged rather than a tidy zig-zag.
    // Width TAPERS from thick at the top to a fine point at the tip, and two
    // short forked branches split off, like a real strike.
    // gearTeeth = channel segments, corner = jaggedness, thick = max width.
    var bMaxW=r1*Math.max(0.05,thick*2.0);
    var bAmp=r1*(0.12+corner*0.55);
    var bN=Math.max(5,Math.min(12,Math.round(gearTeeth*1.5)));
    // Stable hash-based offset for node i (deterministic, no per-pixel cost
    // because we recompute the same path every pixel — it's only ~10 nodes).
    function _bx(i){
      var t=i/(bN-1);
      // two sines at unrelated freqs + a hashed jitter = irregular but stable
      var base=Math.sin(t*7.0+1.3)*0.6+Math.sin(t*17.0)*0.3;
      var jit=(((Math.sin(i*91.7)*43758.5453)%1+1)%1-0.5)*0.7;
      // taper the horizontal wander slightly toward the tip
      return (base+jit)*bAmp;
    }
    function _by(i){return -r1+(i/(bN-1))*2*r1;}
    function _wAt(t){return bMaxW*(1-t)*(1-t)+r1*0.012;} // quadratic taper to a point
    var bd=1e9;
    var pX=_bx(0),pY=_by(0);
    for(var bi=1;bi<bN;bi++){
      var nX=_bx(bi),nY=_by(bi);
      var d=_segDist(cx,cy,pX,pY,nX,nY);
      // local width = taper at this height
      var wd=d-_wAt(bi/(bN-1));
      if(wd<s||bi===1)s=wd; // accumulate as union (min)
      if(d-_wAt(bi/(bN-1))<bd)bd=d-_wAt(bi/(bN-1));
      pX=nX;pY=nY;
    }
    s=bd;
    // Two forks: short branches splitting from upper-mid nodes, thinner.
    var forks=[[Math.round(bN*0.35),1],[Math.round(bN*0.6),-1]];
    for(var fk=0;fk<forks.length;fk++){
      var fi=forks[fk][0],dir=forks[fk][1];
      var fx0=_bx(fi),fy0=_by(fi);
      var flen=r1*(0.35+corner*0.3);
      var fx1=fx0+dir*flen*0.8,fy1=fy0+flen*0.7;
      var fx2=fx1+dir*flen*0.4,fy2=fy1+flen*0.5;
      var fdA=_segDist(cx,cy,fx0,fy0,fx1,fy1)-bMaxW*0.45;
      var fdB=_segDist(cx,cy,fx1,fy1,fx2,fy2)-bMaxW*0.28;
      var fd=Math.min(fdA,fdB);
      if(fd<s)s=fd;
    }
  }
  else if(kind==="hexagram"){
    // Six-pointed star (two overlapping triangles).
    var hr=r1*Math.cos(Math.PI/6);
    function _tri(px,py,rot){
      var ca=Math.cos(rot),sa=Math.sin(rot);
      var rx=px*ca-py*sa, ry=px*sa+py*ca;
      var n=3,a2=Math.PI*2/n,ang=Math.atan2(rx,ry),sec=Math.round(ang/a2)*a2;
      return Math.hypot(rx,ry)*Math.cos(ang-sec)-hr*Math.cos(a2*0.5);
    }
    s=Math.min(_tri(cx,cy,0),_tri(cx,cy,Math.PI));
  }
  else if(kind==="gem"){
    // Brilliant-cut gem: a flat-topped crown over a pointed pavilion, fully
    // symmetric. Convex polygon SDF via max of half-plane distances.
    var gx=Math.abs(cx);
    var tableY=-r1*0.55;   // flat top
    var girdleY=-r1*0.15;  // widest line
    var tipY=r1;           // bottom point
    var halfW=r1*0.78;     // half width at the girdle
    var tableHalf=r1*0.42; // half width of the top table
    // Crown edge: line from table corner (tableHalf,tableY) to girdle (halfW,girdleY)
    var crownDx=halfW-tableHalf, crownDy=girdleY-tableY;
    var crownLen=Math.hypot(crownDx,crownDy);
    var crownD=((gx-tableHalf)*crownDy-(cy-tableY)*crownDx)/crownLen;
    // Pavilion edge: from girdle (halfW,girdleY) to tip (0,tipY)
    var pavDx=0-halfW, pavDy=tipY-girdleY;
    var pavLen=Math.hypot(pavDx,pavDy);
    var pavD=((gx-halfW)*pavDy-(cy-girdleY)*pavDx)/pavLen;
    s=Math.max(crownD,pavD,tableY-cy);
  }
  else if(kind==="plus"){
    // Solid plus / thick cross. thick controls arm width.
    var pqx=Math.abs(cx),pqy=Math.abs(cy);
    var arm=r1*Math.max(0.15,thick*3),ext=r1;
    var bx2=Math.hypot(Math.max(pqx-ext,0),Math.max(pqy-arm,0))+Math.min(Math.max(pqx-ext,pqy-arm),0);
    var by2=Math.hypot(Math.max(pqx-arm,0),Math.max(pqy-ext,0))+Math.min(Math.max(pqx-arm,pqy-ext),0);
    s=Math.min(bx2,by2);
  }
  else if(kind==="burst"){
    // Spiky burst: many sharp rays. gearTeeth = ray count.
    var bang=Math.atan2(cy,cx),brad=Math.hypot(cx,cy);
    var bn2=Math.max(3,gearTeeth);
    var spikes=Math.abs(Math.cos(bang*bn2*0.5));
    s=brad-lerp(r2,r1,Math.pow(spikes,3));
  }
  else if(kind==="shield"){
    // Heraldic shield: flat top edge, vertical upper sides, then sweeping in to
    // a rounded point at the bottom. Width=r1, top at -r1, tip at +r1.
    var shx=Math.abs(cx);
    var topY=-r1*0.92, shoulderY=-r1*0.1, tipY=r1*0.95;
    var halfW=r1*0.72;
    // Upper rectangle (flat top + straight sides)
    var rqx=shx-halfW, rqy=Math.max(topY-cy,cy-shoulderY);
    var rectS=Math.hypot(Math.max(rqx,0),Math.max(rqy,0))+Math.min(Math.max(rqx,rqy),0);
    // Lower elliptical sweep to the tip
    var frac=(cy-shoulderY)/(tipY-shoulderY);
    frac=frac<0?0:frac>1?1:frac;
    var w=halfW*Math.sqrt(Math.max(0,1-frac*frac));
    var lowS=Math.max(shx-w, cy-tipY, shoulderY-cy);
    // Union of the two halves (min); the overlap at the shoulder removes the seam
    s=Math.min(rectS,lowS);
  }
  else if(kind==="squircle"){
    // Superellipse |x|^n+|y|^n=r^n with n=4 — soft square, very common in UI/VFX.
    var sqn=4;
    s=Math.pow(Math.pow(Math.abs(cx),sqn)+Math.pow(Math.abs(cy),sqn),1/sqn)-r1;
  }
  else if(kind==="blob"){
    // Organic wobbly circle: radius modulated by a couple of sine harmonics.
    var bang2=Math.atan2(cy,cx),brad2=Math.hypot(cx,cy);
    var wob=r1*(1+0.12*Math.sin(bang2*3)+0.07*Math.sin(bang2*5+1.3));
    s=brad2-wob;
  }
  else if(kind==="droplet"){
    // Splat/droplet: a circle with a few rounded bumps — good for liquid VFX.
    var dang=Math.atan2(cy,cx),drad=Math.hypot(cx,cy);
    var bumps=Math.max(3,gearTeeth);
    var dl=r1*(0.82+0.18*Math.pow(Math.max(0,Math.cos(dang*bumps*0.5)),2));
    s=drad-dl;
  }
  else if(kind==="sun"){
    // Sun: solid disc with smooth triangular rays around it.
    var sang=Math.atan2(cy,cx),srad=Math.hypot(cx,cy);
    var rays=Math.max(4,gearTeeth);
    var tri=Math.abs(((sang*rays/(2*Math.PI))%1)*2-1); // 0..1 triangle per ray
    var coreR=r2, rayR=lerp(r2,r1,tri);
    // Inside the core radius it's solid; outside, the triangular rays define reach.
    s=srad-(srad<coreR?coreR:rayR);
  }
  else if(kind==="spark"){
    // 4-point sparkle/twinkle with thin concave rays (like a lens sparkle).
    var spa=Math.atan2(cy,cx),spr=Math.hypot(cx,cy);
    var arm=Math.pow(Math.abs(Math.cos(spa*2)),0.35); // pinched 4-fold
    s=spr-lerp(r2*0.3,r1,arm);
  }
  else s=Math.hypot(cx,cy)-r1;

  // Outline mode: turn the solid shape into a stroked band of width sp.outline.
  // abs(SDF) - halfWidth gives the classic hollow-outline distance field.
  if(sp.outline&&sp.outline>0)s=Math.abs(s)-sp.outline*0.5;
  return sdfToV(s,soft);
}

var _foLayerV={base:"perlin",oct:5,lac:2,gain:0.5,mode:"normal"};
var _foWarpV={base:"perlin",oct:5,lac:2,gain:0.5,warpStr:1.5};
// ═══ LAYER VALUE ════════════════════════════════════════════════
function layerV(px,py,ux,uy,L,imgPix){
  var uv=transformUV(ux,uy,L);
  var u=uv.u,v=uv.v,nx=uv.nx,ny=uv.ny,cx=uv.cx,cy=uv.cy,tsx=uv.tsx,tsy=uv.tsy;
  var seed=L.seed||1,pm=getPerm(seed);
  // Reuse module-level object to avoid per-pixel alloc in thumbnail/anim paths
  _foLayerV.base=L.fbmBase||"perlin";_foLayerV.oct=L.octaves||5;
  _foLayerV.lac=L.lacunarity||2;_foLayerV.gain=L.gain||0.5;_foLayerV.mode=L.fbmMode||"normal";
  var fo=_foLayerV;
  var val=0,t=L.type;

  if(t==="perlin")     val=perlin(nx,ny,pm,tsx,tsy);
  else if(t==="value") val=valueNoise(nx,ny,pm,tsx,tsy);
  else if(t==="simplex") val=simplex2(nx,ny,pm);
  else if(t==="fbm")   val=fbm(nx,ny,pm,fo,tsx,tsy);
  else if(t==="domainWarp"){_foWarpV.base=L.warpBase||"perlin";_foWarpV.oct=L.octaves||5;_foWarpV.lac=L.lacunarity||2;_foWarpV.gain=L.gain||0.5;_foWarpV.warpStr=L.warpStr||1.5;_foWarpV.levels=L.warpLevels||1;_foWarpV.warp2=L.warp2!=null?L.warp2:0.8;_foWarpV.mode=L.warpMode||"normal";val=domWarp(nx,ny,pm,_foWarpV,tsx,tsy);}
  else if(t==="curl")  val=curlNoise(nx,ny,pm,L.curlScale||5,{mode:L.curlMode||"magnitude",oct:L.curlOct||4},tsx,tsy);
  else if(t==="white") {var wx=Math.floor(u*(L.scaleX||3.5))|0,wy=Math.floor(v*(L.scaleY||3.5))|0;val=whiteHash(wx,wy,seed);}
  else if(t==="blue")  {var sx3=L.scaleX||3.5,wx=Math.floor(u*sx3)|0,wy=Math.floor(v*sx3)|0,w2=whiteHash(wx,wy,seed),wd=worley(nx,ny,seed,"euclidean",tsx,tsy);val=w2*0.5+clamp(1-wd.d1*1.8)*0.5;}
  else if(t==="worley"){
    var _wjit=L.worleyJitter!=null?L.worleyJitter:1;
    var _wm=L.worleyMode||"f1";
    var _needEdge=(_wm==="edges"||_wm==="edgesInv"||_wm==="cellWalls");
    var _wnx=nx,_wny=ny; if(L.worleyWarp){var _cw=cellWarp(nx,ny,seed,L.worleyWarp,tsx,tsy);_wnx=_cw[0];_wny=_cw[1];}
    var wr=worley(_wnx,_wny,seed,L.worleyMetric||"euclidean",tsx,tsy,2,_wjit,L.worleySmooth||0,_needEdge);
    val=worleyValue(wr,_wm,L.worleyContrast!=null?L.worleyContrast:1);
  }
  else if(t==="voronoi")    {var _vnx=nx,_vny=ny;if(L.worleyWarp){var _cwv=cellWarp(nx,ny,seed,L.worleyWarp,tsx,tsy);_vnx=_cwv[0];_vny=_cwv[1];}val=voronoiNoise(_vnx,_vny,seed,L.worleyMetric||"euclidean",tsx,tsy,L.worleyJitter!=null?L.worleyJitter:1,L.voronoiVarMode||"flat",L.worleyContrast!=null?L.worleyContrast:1);}
  else if(t==="crystals")   val=crystalsNoise(nx,ny,seed,{sharp:L.crystalSharp||4,jitter:L.crystalJitter!=null?L.crystalJitter:1,metric:L.crystalMetric||"manhattan",mode:L.crystalMode||"facets"},tsx,tsy);
  else if(t==="iqcell")     val=iqCellular(nx,ny,seed,{blend:L.iqSmooth!=null?L.iqSmooth:0.5,smoothK:L.iqSmoothK!=null?L.iqSmoothK:0.4,metric:L.iqMetric||"euclidean",jitter:L.iqJitter!=null?L.iqJitter:1,mode:L.iqMode||"smooth",contrast:L.iqContrast||1},tsx,tsy);
  else if(t==="caustics")   val=causticsNoise(nx,ny,pm,seed,tsx,tsy,{oct:L.octaves||4,gain:L.gain||0.5,warp:L.causWarp!=null?L.causWarp:1.1,fold:L.causFold!=null?L.causFold:0.4,sharp:L.causSharp!=null?L.causSharp:6,bright:L.causBright!=null?L.causBright:0.28,mode:L.causMode||"lines"});
  else if(t==="cloud")       val=cloudNoise(nx,ny,pm,L.octaves||5,L.lacunarity||2,L.gain||0.5,tsx,tsy,{coverage:L.cloudCov!=null?L.cloudCov:0.5,softness:L.cloudSoft!=null?L.cloudSoft:0.5,mode:L.cloudMode||"billow"});
  else if(t==="polarScatter")val=polarScatterNoise(cx,cy,pm,seed,L.polarCount||6,L.polarRadius||0.35,L.polarSpread||0.18,L.polarInner||0,L.polarMode||"blob");
  else if(t==="scatter")val=scatterNoise(u,v,seed,{grid:L.scGrid!=null?L.scGrid:4,density:L.scDensity!=null?L.scDensity:1,jitter:L.scJitter!=null?L.scJitter:0.8,sizeBase:L.scSize!=null?L.scSize:0.5,scaleXMin:L.scScaleXMin!=null?L.scScaleXMin:(1-(L.scSizeVar||0)),scaleXMax:L.scScaleXMax!=null?L.scScaleXMax:(1+(L.scSizeVar||0)),scaleYMin:L.scScaleYMin!=null?L.scScaleYMin:(1-(L.scSizeVar||0)),scaleYMax:L.scScaleYMax!=null?L.scScaleYMax:(1+(L.scSizeVar||0)),rotMin:L.scRotMin||0,rotMax:L.scRotMax!=null?L.scRotMax:0,intensityMin:L.scIntMin!=null?L.scIntMin:1,intensityMax:L.scIntMax!=null?L.scIntMax:1,mode:(L.scMode==="sample"?"disc":(L.scMode||"disc")),kind:L.scShape||"circle",sp:L.scShapeP||DSP,blend:L.scBlend||"max"});
  else if(t==="slopeGrad")   val=slopeGradNoise(cx,cy,L.slopeAngle||0);
  else if(t==="plasma")     val=plasmaNoise(nx,ny,seed,tsx,tsy,{waves:L.plasmaWaves||4,warp:L.plasmaWarp||0,mode:L.plasmaMode||"classic"});
  else if(t==="wood")       val=woodNoise(cx,cy,pm,L.woodRings||8,L.woodTurb||1.2,tsx,tsy);
  else if(t==="marble")     val=marbleNoise(nx,ny,pm,{freq:L.marbleFreq||3,turb:L.marbleTurb||4,oct:L.octaves||6,angle:L.marbleAngle||0,sharp:L.marbleSharp||1},tsx,tsy);
  else if(t==="gabor")      val=gaborNoise(nx,ny,pm,seed,L.gaborFreq||16,{bw:L.gaborBW!=null?L.gaborBW:2,orient:L.gaborOrient||0,spread:L.gaborSpread!=null?L.gaborSpread:1,aniso:L.gaborAniso||0,harmonics:L.gaborHarm||1,phase:L.gaborPhase||0},tsx,tsy);
  else if(t==="dust")       val=dustNoise(nx,ny,seed,L.dustCoverage!=null?L.dustCoverage:0.5,L.dustSize!=null?L.dustSize:0.5,tsx,tsy);
  else if(t==="debris")     val=debrisNoise(nx,ny,seed,L.debrisDensity!=null?L.debrisDensity:0.5,L.debrisSharp||2,tsx,tsy);
  else if(t==="grain")      val=grainNoise(nx,ny,pm,L.grainRough!=null?L.grainRough:0.5,L.grainContrast||1.5,tsx,tsy);
  else if(t==="hex")        val=hexNoise(nx,ny,seed,{mode:L.hexMode||"edges",thickness:L.hexThick!=null?L.hexThick:0.12,jitter:L.hexJitter||0},tsx,tsy);
  else if(t==="scratches")  val=scratchNoise(nx,ny,seed,{density:L.scrDensity!=null?L.scrDensity:0.5,length:L.scrLength!=null?L.scrLength:0.6,thickness:L.scrThick!=null?L.scrThick:0.04,angle:L.scrAngle||0,angleVar:L.scrAngleVar!=null?L.scrAngleVar:1,taper:L.scrTaper!=null?L.scrTaper:1},tsx,tsy);
  else if(t==="sparkle")    val=sparkleNoise(nx,ny,seed,{density:L.spkDensity!=null?L.spkDensity:0.4,size:L.spkSize!=null?L.spkSize:0.4,glow:L.spkGlow!=null?L.spkGlow:0.5,streak:L.spkStreak||0,twinkle:L.spkTwinkle!=null?L.spkTwinkle:0.6},tsx,tsy);
  else if(t==="truchet")    val=truchetNoise(nx,ny,seed,{thickness:L.truThick!=null?L.truThick:0.18,mode:L.truMode||"arcs"},tsx,tsy);
  else if(t==="sparse")     val=sparseNoise(nx,ny,seed,{density:L.sparseDens||4,sizeVar:L.sparseSizeVar||0,intensity:L.sparseIntVar||0,falloff:L.sparseFalloff||"gauss"},tsx,tsy);
  else if(t==="gaussian"){var wx=Math.floor(u*(L.scaleX||3.5))|0,wy=Math.floor(v*(L.scaleY||3.5))|0;val=gaussianNoise(wx,wy,seed);}
  else if(t==="highpass")   val=highpassNoise(ux,uy,pm,L.scaleX||3.5,L.hpBlur||0.5,L.octaves||5);
  else if(t==="directional")val=dirNoise(ux,uy,pm,L.dirScaleX||8,L.dirScaleY||1,L.octaves||5);
  else if(t==="waveStroke")val=waveStrokeNoise(ux,uy,pm,L.fiberAngle||0,L.waveAmp!=null?L.waveAmp:0.35,L.waveWarp!=null?L.waveWarp:0.5,L.waveThick!=null?L.waveThick:0.06,L.waveOffset||0,tsx,tsy,L.dirContrast||1);
  else if(t==="fiber")   val=fiberNoise(ux,uy,pm,L.fiberAngle||0,L.fiberStretch!=null?L.fiberStretch:12,L.octaves||5,tsx,tsy,L.dirContrast||1,L.fiberCross!=null?L.fiberCross:0.15);
  else if(t==="streaks") val=streaksNoise(ux,uy,pm,L.fiberAngle||0,L.streakLength||8,L.streakDensity||4,tsx,tsy,L.dirContrast||1);
  else if(t==="crosshatch")val=crosshatchNoise(ux,uy,pm,L.fiberAngle||30,L.waveFreq||6,L.waveThick||0.25,tsx,tsy,L.dirContrast||1);
  else if(t==="rippleDir") val=rippleDirNoise(ux,uy,pm,L.fiberAngle||0,L.waveFreq||6,L.waveWarp||0.3,tsx,tsy,L.dirContrast||1);
  else if(t==="flowLines") val=flowLinesNoise(ux,uy,pm,L.fiberAngle||0,L.waveFreq||5,L.waveWarp||0.8,tsx,tsy,L.dirContrast||1);
  else if(t==="gradient")   val=computeGrad(cx,cy,L.gradientType||"radial",L.gradScale||1,L.gradFreq||1,L.gradPow||1);
  else if(t==="shape")    val=computeShape(cx,cy,L.shapeKind||"circle",L.shapeP);
  else if(t==="image"){
    if(imgPix){
      var uw=(u%1+1)%1,vw=(v%1+1)%1;
      var sx=Math.floor(uw*imgPix.w)%imgPix.w,sy=Math.floor(vw*imgPix.h)%imgPix.h;
      var ii=(sy*imgPix.w+sx)*4;
      val=lumin(imgPix.data[ii]/255,imgPix.data[ii+1]/255,imgPix.data[ii+2]/255);
    } else val=0.5;
  }
  else val=0.5;

  // ── 0. Curve mapping (applied first, like SD's Curve node) ─────
  if(L.curvePoints&&!isCurveIdentity(L.curvePoints)){
    var lut=evalCurveLUT(L.curvePoints.slice().sort(function(a,b){return a.x-b.x;}),L.curveMode||"smooth");
    val=lut[Math.min(255,Math.floor(clamp(val)*255))];
  }
  // ── 1. Power / S-Curve contrast ───────────────────────────────
  var contrastMode=L.contrastMode||"power";
  var cont=L.contrast!=null?L.contrast:1;
  if(contrastMode==="power"){
    // Power node: v^gamma. gamma=1 neutral, <1 brightens, >1 darkens
    val=Math.pow(clamp(val),Math.max(0.001,cont));
  } else {
    // S-Curve: symmetric sigmoid contrast around 0.5
    // cont=1 neutral, >1 steeper S, <1 flatter
    val=clamp(val);
    if(cont!==1){var c2=Math.max(0.001,cont)*2;val=val<0.5?Math.pow(val*2,c2)*0.5:1-Math.pow((1-val)*2,c2)*0.5;}
  }
  // ── 2. Midpoint / gamma pivot ──────────────────────────────────
  var mid=L.midpoint!=null?L.midpoint:0.5;
  if(mid!==0.5&&mid>0&&mid<1){val=Math.pow(clamp(val),Math.log(0.5)/Math.log(mid));}
  // ── 3. Brightness (offset) ─────────────────────────────────────
  val=clamp(val+((L.brightness!=null?L.brightness:0.5)-0.5)*1.5);
  // ── 4. Invert ──────────────────────────────────────────────────
  if(L.invert)val=1-val;
  // ── 5. Remap input levels ──────────────────────────────────────
  var ri0=L.remapIn0||0,ri1=L.remapIn1!=null?L.remapIn1:1;
  val=clamp((val-ri0)/Math.max(ri1-ri0,0.001));
  // ── 6. Step (smooth posterize) ─────────────────────────────────
  var steps=L.steps!=null?L.steps:0;
  if(steps>=2){var s2=Math.round(steps);val=Math.round(val*(s2-1))/(s2-1);}
  // ── 7. Multiplier ──────────────────────────────────────────────
  val=clamp(val*(L.multiplier!=null?L.multiplier:1));
  // ── 8. Output levels ───────────────────────────────────────────
  var outLo=L.outputLo!=null?L.outputLo:0,outHi=L.outputHi!=null?L.outputHi:1;
  val=lerp(outLo,outHi,val);
  return val;
}

// ═══ BLEND ══════════════════════════════════════════════════════
function blendV(dst,src,mode){
  if(mode==="add")         return clamp(dst+src);
  if(mode==="linearDodge") return clamp(dst+src);  // alias for add
  if(mode==="subtract")    return clamp(dst-src);
  if(mode==="multiply")    return dst*src;
  if(mode==="divide")      return clamp(dst/(src+0.001));
  if(mode==="screen")      return 1-(1-dst)*(1-src);
  if(mode==="lighten")     return Math.max(dst,src);
  if(mode==="darken")      return Math.min(dst,src);
  if(mode==="overlay")     return dst<0.5?2*dst*src:1-2*(1-dst)*(1-src);
  if(mode==="softlight")   return dst<0.5?2*dst*src+dst*dst*(1-2*src):Math.sqrt(dst)*(2*src-1)+2*dst*(1-src);
  if(mode==="hardlight")   return src<0.5?2*dst*src:1-2*(1-dst)*(1-src);
  if(mode==="difference")  return Math.abs(dst-src);
  if(mode==="exclusion")   return dst+src-2*dst*src;
  if(mode==="dissolve")    return Math.random()<src?1:dst; // stochastic
  if(mode==="max")         return Math.max(dst,src);
  if(mode==="min")         return Math.min(dst,src);
  return src;
}
function hexF(hex){return[parseInt(hex.slice(1,3),16)/255,parseInt(hex.slice(3,5),16)/255,parseInt(hex.slice(5,7),16)/255];}

// Note: applyHue was removed (never called). HSL rotation is done
// inline in the hot render path (renderLayersToBuf) via _hue2rgb.

// ═══ RENDER LAYERS → BUFFER (optimized — all constants hoisted) ═
// Fold group state (enabled + opacity) into a flat layer list so the renderer
// needs no group awareness. Layers in a disabled group are dropped; a layer's
// opacity is multiplied by its group's opacity. groups: [{id,name,enabled,opacity,collapsed}].
// Fields a reference layer ALWAYS keeps as its own (identity/structure), so it
// stays a distinct, movable entry and can't collide.
var _REF_LOCAL_FIELDS={uid:1,refUid:1,label:1,groupId:1,enabled:1,
  refLocalXform:1,refLocalBlend:1,refLocalAdjust:1};
// Optional local groups — when the matching flag is set on the reference, these
// fields are taken from the reference itself instead of the source.
var _REF_GROUP_XFORM=["rotation","skewX","skewY","offsetX","offsetY","scaleX","scaleY","scaleLinked","postTX","postTY","postSX","postSY","postRot","flipH","flipV","mirrorH","mirrorV"];
var _REF_GROUP_BLEND=["blendMode","opacity","channels"];
var _REF_GROUP_ADJUST=["contrast","contrastMode","midpoint","brightness","invert","curvePoints","curveMode","saturation","hueShift","remapIn0","remapIn1","steps","multiplier","outputLo","outputHi"];
function resolveReferences(layers){
  if(!layers||!layers.length)return layers;
  // index by uid
  var byUid={}; for(var i=0;i<layers.length;i++){if(layers[i].uid!=null)byUid[layers[i].uid]=layers[i];}
  var anyRef=false; for(var k=0;k<layers.length;k++){if(layers[k].refUid!=null){anyRef=true;break;}}
  if(!anyRef)return layers;
  // Resolve a single layer's effective source, following ref chains with a
  // visited-set so a cycle can't loop forever.
  function sourceFor(L){
    var seen={}, cur=L, guard=0;
    while(cur&&cur.refUid!=null&&guard++<32){
      if(seen[cur.uid])return null;            // cycle → no valid source
      seen[cur.uid]=1;
      var nxt=byUid[cur.refUid];
      if(!nxt||nxt.uid===L.uid)return null;     // missing or points back to self
      cur=nxt;
    }
    return (cur&&cur.refUid==null)?cur:null;    // resolved to a concrete layer
  }
  var out=new Array(layers.length);
  for(var j=0;j<layers.length;j++){
    var L=layers[j];
    if(L.refUid==null){out[j]=L;continue;}
    var src=sourceFor(L);
    if(!src){out[j]=L;continue;}                 // broken/cyclic ref → render as-is
    // Inherit everything from src, then restore always-local fields, then
    // restore any opt-out groups the user chose to keep local on this reference.
    var merged=Object.assign({},src);
    for(var f in _REF_LOCAL_FIELDS){if(L[f]!==undefined)merged[f]=L[f];}
    if(L.refLocalXform){for(var a=0;a<_REF_GROUP_XFORM.length;a++){var kx=_REF_GROUP_XFORM[a];if(L[kx]!==undefined)merged[kx]=L[kx];}}
    if(L.refLocalBlend){for(var b=0;b<_REF_GROUP_BLEND.length;b++){var kb=_REF_GROUP_BLEND[b];if(L[kb]!==undefined)merged[kb]=L[kb];}}
    if(L.refLocalAdjust){for(var c=0;c<_REF_GROUP_ADJUST.length;c++){var kc=_REF_GROUP_ADJUST[c];if(L[kc]!==undefined)merged[kc]=L[kc];}}
    out[j]=merged;
  }
  return out;
}

function resolveGroups(layers,groups){
  if(!groups||!groups.length)return layers;
  var byId={}; for(var i=0;i<groups.length;i++)byId[groups[i].id]=groups[i];
  var out=[];
  for(var j=0;j<layers.length;j++){
    var L=layers[j];
    var g=L.groupId!=null?byId[L.groupId]:null;
    if(g){
      if(g.enabled===false)continue; // whole group hidden
      var go=g.opacity!=null?g.opacity:1;
      var gBr=g.brightness||0, gCon=g.contrast!=null?g.contrast:1;
      if(go!==1||gBr!==0||gCon!==1){
        var patch={};
        if(go!==1)patch.opacity=(L.opacity!=null?L.opacity:1)*go;
        // Combine group brightness (additive) and contrast (multiplicative) with
        // the layer's own values, so a group acts like a shared adjustment.
        if(gBr!==0)patch.brightness=(L.brightness!=null?L.brightness:0.5)+gBr;
        if(gCon!==1)patch.contrast=(L.contrast!=null?L.contrast:1)*gCon;
        L=Object.assign({},L,patch);
      }
    }
    out.push(L);
  }
  return out;
}

function renderLayersToBuf(buf,size,layers,mask,globalLF){
  for(var i=3;i<buf.length;i+=4)buf[i]=1;
  var imgPixMap={};
  for(var li=0;li<layers.length;li++){var LL=layers[li];if(LL.type==="image"&&LL.imageData)imgPixMap[li]=getImgPixels(LL.imageData);}
  var inv1=1/size;

  for(var li=0;li<layers.length;li++){
    var L=layers[li];if(!L.enabled)continue;
    var imgPix=imgPixMap[li]||null;

    // Hoist all L.* reads before pixel loop
    var Ltype=L.type||"fbm";
    var Lseed=L.seed||1,Lpm=getPerm(Lseed);
    var LscaleX=L.scaleX||3.5;
    var LscaleY=L.scaleLinked?LscaleX:(L.scaleY||LscaleX);
    var Lseamless=!!L.seamless;
    var LseamlessMode=L.seamlessMode||"math";
    var LseamlessBlendW=L.seamlessBlendW!=null?L.seamlessBlendW:0.28;
    var LuseMathTile=Lseamless&&LseamlessMode!=="blend"&&LseamlessMode!=="mirror";
    var LuseCrossBlend=Lseamless&&LseamlessMode==="blend";
    // Mirror: mathematically perfect seamless — no snapping needed, UV folds at boundary
    var LuseMirror=Lseamless&&LseamlessMode==="mirror";
    // RELIABILITY: math tiling silently produced seams whenever any sampling
    // step was non-periodic (rotation, skew, center-based UV warps, or a type
    // that can't lattice-tile, e.g. simplex). Now: if math tiling is invalid,
    // fall back to edge cross-blending — always seam-free.
    if(LuseMathTile&&mathTileBlocker(L)){LuseMathTile=false;LuseCrossBlend=true;}
    // Math tile: snap scale to integer so period = scale
    if(LuseMathTile){LscaleX=Math.round(LscaleX)||1;LscaleY=Math.round(LscaleY)||1;}
    var LtileX=LuseMathTile?LscaleX:0,LtileY=LuseMathTile?LscaleY:0;
    var Lrot=L.rotation||0,LhasRot=Lrot!==0;
    var LrotC=LhasRot?Math.cos(Lrot*Math.PI/180):1,LrotS=LhasRot?Math.sin(Lrot*Math.PI/180):0;
    var LskewX=L.skewX||0,LskewY=L.skewY||0;
    var LoffX=L.offsetX||0,LoffY=L.offsetY||0;
    var LuvDists=L.uvDists||[];
    var LhasUV=false;
    for(var di2=0;di2<LuvDists.length;di2++){if(LuvDists[di2]&&LuvDists[di2].type&&LuvDists[di2].type!=="none"&&LuvDists[di2].amt){LhasUV=true;break;}}
    var Lfo={base:L.fbmBase||"perlin",oct:L.octaves||5,lac:L.lacunarity||2,gain:L.gain||0.5,mode:L.fbmMode||"normal"};
    var LwarpObj={base:L.warpBase||"perlin",oct:L.octaves||5,lac:L.lacunarity||2,gain:L.gain||0.5,warpStr:L.warpStr||1.5,levels:L.warpLevels||1,warp2:L.warp2!=null?L.warp2:0.8,mode:L.warpMode||"normal"};
    var LwMode=L.worleyMode||"f1",LwMetric=L.worleyMetric||"euclidean";
    var LwJit=L.worleyJitter!=null?L.worleyJitter:1;
    var LwSmooth=L.worleySmooth||0;
    var LwWarp=L.worleyWarp||0;
    var LwContrast=L.worleyContrast!=null?L.worleyContrast:1;
    var LwVarMode=L.voronoiVarMode||"flat";
    var LiqObj={blend:L.iqSmooth!=null?L.iqSmooth:0.5,smoothK:L.iqSmoothK!=null?L.iqSmoothK:0.4,metric:L.iqMetric||"euclidean",jitter:L.iqJitter!=null?L.iqJitter:1,mode:L.iqMode||"smooth",contrast:L.iqContrast||1};
    var LcausObj={oct:Lfo.oct,gain:Lfo.gain,warp:L.causWarp!=null?L.causWarp:1.1,fold:L.causFold!=null?L.causFold:0.4,sharp:L.causSharp!=null?L.causSharp:6,bright:L.causBright!=null?L.causBright:0.28,mode:L.causMode||"lines"};
    var LplasmaObj={waves:L.plasmaWaves||4,warp:L.plasmaWarp||0,mode:L.plasmaMode||"classic"};
    var LcurlS=L.curlScale||5,LcurlM=L.curlMode||"magnitude";
    var LcurlObj={mode:LcurlM,oct:L.curlOct||4};
    var LcloudObj={coverage:L.cloudCov!=null?L.cloudCov:0.5,softness:L.cloudSoft!=null?L.cloudSoft:0.5,mode:L.cloudMode||"billow"};
    var LhexObj={mode:L.hexMode||"edges",thickness:L.hexThick!=null?L.hexThick:0.12,jitter:L.hexJitter||0};
    var LscrObj={density:L.scrDensity!=null?L.scrDensity:0.5,length:L.scrLength!=null?L.scrLength:0.6,thickness:L.scrThick!=null?L.scrThick:0.04,angle:L.scrAngle||0,angleVar:L.scrAngleVar!=null?L.scrAngleVar:1,taper:L.scrTaper!=null?L.scrTaper:1};
    var LspkObj={density:L.spkDensity!=null?L.spkDensity:0.4,size:L.spkSize!=null?L.spkSize:0.4,glow:L.spkGlow!=null?L.spkGlow:0.5,streak:L.spkStreak||0,twinkle:L.spkTwinkle!=null?L.spkTwinkle:0.6};
    var LtruObj={thickness:L.truThick!=null?L.truThick:0.18,mode:L.truMode||"arcs"};
    // Polar scatter / slope gradient hoisted params
    var LpolarCount=L.polarCount||6,LpolarR=L.polarRadius||0.35,LpolarSp=L.polarSpread||0.18,LpolarIn=L.polarInner||0,LpolarM=L.polarMode||"blob";
    var LslopeAng=L.slopeAngle||0;
    var LgradT=L.gradientType||"radial",LshapeK=L.shapeKind||"circle",LshapeP=L.shapeP;
    var LgradScale=L.gradScale||1,LgradFreq=L.gradFreq||1,LgradPow=L.gradPow||1;
    // Shape size curve: remaps shape SDF output through a spline (like a per-shape level/remap)
    var LshapeCurvePts=L.shapeCurvePoints||DEFAULT_CURVE;
    var LshapeCurveLUT=isCurveIdentity(LshapeCurvePts)?null:evalCurveLUT(LshapeCurvePts.slice().sort(function(a,b){return a.x-b.x;}),L.shapeCurveMode||"smooth");
    var LshapeWidthPts=L.shapeWidthCurvePoints||DEFAULT_CURVE;
    var LshapeWidthLUT=isCurveIdentity(LshapeWidthPts)?null:evalCurveLUT(LshapeWidthPts.slice().sort(function(a,b){return a.x-b.x;}),L.shapeWidthCurveMode||"smooth");
    // New noise hoisted params
    var LwoodRings=L.woodRings!=null?L.woodRings:8,LwoodTurb=L.woodTurb!=null?L.woodTurb:1.2;
    var LmarbleFreq=L.marbleFreq!=null?L.marbleFreq:3,LmarbleTurb=L.marbleTurb!=null?L.marbleTurb:4;
    var LmarbleObj={freq:LmarbleFreq,turb:LmarbleTurb,oct:Lfo.oct,angle:L.marbleAngle||0,sharp:L.marbleSharp||1};
    var LgaborFreq=L.gaborFreq!=null?L.gaborFreq:16;
    var LgaborObj={bw:L.gaborBW!=null?L.gaborBW:2,orient:L.gaborOrient||0,spread:L.gaborSpread!=null?L.gaborSpread:1,aniso:L.gaborAniso||0,harmonics:L.gaborHarm||1,phase:L.gaborPhase||0};
    var LcrystalSharp=L.crystalSharp!=null?L.crystalSharp:4;
    var LcrystalObj={sharp:LcrystalSharp,jitter:L.crystalJitter!=null?L.crystalJitter:1,metric:L.crystalMetric||"manhattan",mode:L.crystalMode||"facets"};
    var LhpBlur=L.hpBlur!=null?L.hpBlur:0.5;
    var LsparseDens=L.sparseDens!=null?L.sparseDens:8;
    var LsparseObj={density:LsparseDens,sizeVar:L.sparseSizeVar||0,intensity:L.sparseIntVar||0,falloff:L.sparseFalloff||"gauss"};
    var LdirScaleX=L.dirScaleX!=null?L.dirScaleX:8,LdirScaleY=L.dirScaleY!=null?L.dirScaleY:1;
    var LfiberAngle=L.fiberAngle!=null?L.fiberAngle:0;
    var LfiberStretch=L.fiberStretch!=null?L.fiberStretch:12;
    var LwaveAmp=L.waveAmp!=null?L.waveAmp:0.35;
    var LwaveWarp=L.waveWarp!=null?L.waveWarp:0.5;
    var LwaveThick=L.waveThick!=null?L.waveThick:0.06;
    var LwaveOffset=L.waveOffset||0;
    var LwaveFreq=L.waveFreq!=null?L.waveFreq:6;  // used by crosshatch/ripple/flow
    var LstreakLength=L.streakLength!=null?L.streakLength:8;
    var LstreakDensity=L.streakDensity!=null?L.streakDensity:4;
    // Image layer hoisted
    var LimgColorMode=L.imageColorMode||"luma"; // "luma" | "rgb"
    var LimgBilinear=L.imageBilinear!==false; // default true
    var LimgW=imgPix?imgPix.w:1,LimgH=imgPix?imgPix.h:1;
    var LimgIsRGB=LimgColorMode==="rgb"&&Ltype==="image";
    // Per-pixel image RGB storage (only used when LimgIsRGB)
    var _imgR=0,_imgG=0,_imgB=0;

    // Curve LUT (hoist before pixel loop)
    var LcurvePts=L.curvePoints||DEFAULT_CURVE;
    var LcurveLUT=isCurveIdentity(LcurvePts)?null:evalCurveLUT(LcurvePts.slice().sort(function(a,b){return a.x-b.x;}),L.curveMode||"smooth");
    // Adjust constants
    var Lcont=L.contrast!=null?L.contrast:1,LcIsPow=(L.contrastMode||"power")==="power";
    var Lmid=L.midpoint!=null?L.midpoint:0.5;
    var LmidExp=Lmid!==0.5&&Lmid>0&&Lmid<1?Math.log(0.5)/Math.log(Lmid):1,LhasMid=LmidExp!==1;
    var Lbright=((L.brightness!=null?L.brightness:0.5)-0.5)*1.5;
    var Linvert=!!L.invert;
    var Lri0=L.remapIn0||0,Lri1=L.remapIn1!=null?L.remapIn1:1;
    var LriRange=1/Math.max(Lri1-Lri0,0.001);
    var Lsteps=L.steps!=null?Math.round(L.steps):0,LstepsN=Lsteps>=2?Lsteps-1:0;
    var Lmult=L.multiplier!=null?L.multiplier:1;
    var LoutLo=L.outputLo||0,LoutHi=L.outputHi!=null?L.outputHi:1,LoutRange=LoutHi-LoutLo;

    // Color constants — multi-stop gradient LUT (256 entries)
    var LcolorStops=(L.colorStops&&L.colorStops.length>=2)?L.colorStops.slice().sort(function(a,b){return a.pos-b.pos;}):null;
    // Fallback to colorA/B for backwards compat
    var _ca=hexF(L.colorA||"#000000"),_cb=hexF(L.colorB||"#ffffff");
    var LgradLUT=null;
    if(LcolorStops){
      LgradLUT=new Float32Array(256*3);
      for(var _gi=0;_gi<256;_gi++){
        var _gv=_gi/255;
        // Find surrounding stops
        var _glo=LcolorStops[0],_ghi=LcolorStops[LcolorStops.length-1];
        for(var _gj=0;_gj<LcolorStops.length-1;_gj++){if(_gv>=LcolorStops[_gj].pos&&_gv<=LcolorStops[_gj+1].pos){_glo=LcolorStops[_gj];_ghi=LcolorStops[_gj+1];break;}}
        var _gt=(_ghi.pos-_glo.pos)>0?(_gv-_glo.pos)/(_ghi.pos-_glo.pos):0;
        _gt=_gt<0?0:_gt>1?1:_gt;
        var _clo=hexF(_glo.color||"#000"),_chi=hexF(_ghi.color||"#fff");
        LgradLUT[_gi*3  ]=_clo[0]+_gt*(_chi[0]-_clo[0]);
        LgradLUT[_gi*3+1]=_clo[1]+_gt*(_chi[1]-_clo[1]);
        LgradLUT[_gi*3+2]=_clo[2]+_gt*(_chi[2]-_clo[2]);
      }
    }
    // Backwards-compat 2-color lerp
    var Lr1=_ca[0],Lg1=_ca[1],Lb1=_ca[2],Lr2=_cb[0],Lg2=_cb[1],Lb2=_cb[2];
    var LrR=Lr2-Lr1,LgR=Lg2-Lg1,LbR=Lb2-Lb1;
    var Lsat=L.saturation!=null?L.saturation:1,LsatOff=Lsat!==1;
    var Lhue=L.hueShift!=null?L.hueShift:0;

    // Blend constants
    var Lop=L.opacity!=null?L.opacity:1;
    var Lbm=L.blendMode||"normal",LbmNorm=Lbm==="normal";
    var Lch=L.channels||"rgb";
    var LchSingle=Lch==="r"||Lch==="g"||Lch==="b"||Lch==="a";
    var LchIdx=Lch==="r"?0:Lch==="g"?1:Lch==="b"?2:3;
    var LdoR=!LchSingle&&(Lch==="rgb"||Lch==="rgba"||Lch==="rg"||Lch==="rb");
    var LdoG=!LchSingle&&(Lch==="rgb"||Lch==="rgba"||Lch==="rg"||Lch==="gb");
    var LdoB=!LchSingle&&(Lch==="rgb"||Lch==="rgba"||Lch==="rb"||Lch==="gb");
    var LdoA=!LchSingle&&Lch==="rgba";

    // Per-layer blur/glow: render to temp buffer if needed
    var LlayerBlur=L.layerBlur||0,LlayerGlow=L.layerGlow||0,LlayerGlowI=L.layerGlowIntensity!=null?L.layerGlowIntensity:0.5;
    var LpostTX=L.postTX||0,LpostTY=L.postTY||0;
    var LpostSX=L.postSX!=null?L.postSX:1,LpostSY=L.postSY!=null?L.postSY:1;
    var LpostRot=L.postRot||0;
    var LhasPost=LpostTX!==0||LpostTY!==0||LpostSX!==1||LpostSY!==1||LpostRot!==0;
    var LscOpts=null;
    if((L.type||"")==="scatter"){
      LscOpts={
        grid:L.scGrid!=null?L.scGrid:4, density:L.scDensity!=null?L.scDensity:1,
        jitter:L.scJitter!=null?L.scJitter:0.8, sizeBase:L.scSize!=null?L.scSize:0.5,
        scaleXMin:L.scScaleXMin!=null?L.scScaleXMin:(1-(L.scSizeVar||0)),
        scaleXMax:L.scScaleXMax!=null?L.scScaleXMax:(1+(L.scSizeVar||0)),
        scaleYMin:L.scScaleYMin!=null?L.scScaleYMin:(1-(L.scSizeVar||0)),
        scaleYMax:L.scScaleYMax!=null?L.scScaleYMax:(1+(L.scSizeVar||0)),
        rotMin:L.scRotMin||0, rotMax:L.scRotMax!=null?L.scRotMax:0,
        intensityMin:L.scIntMin!=null?L.scIntMin:1, intensityMax:L.scIntMax!=null?L.scIntMax:1,
        mode:L.scMode||"disc", kind:L.scShape||"circle", sp:L.scShapeP||DSP,
        blend:L.scBlend||"max"
      };
      // "Use another layer" as the scattered element. The source is another
      // layer in this same stack, addressed by index. We sample its raw value
      // through layerV (no compositing) in element-local UV.
      if((L.scMode==="sample")){
        var _srcIdx=L.scSourceIdx!=null?L.scSourceIdx:-1;
        var _srcL=(_srcIdx>=0&&_srcIdx<layers.length&&_srcIdx!==li)?layers[_srcIdx]:null;
        if(_srcL){
          var _srcImg=imgPixMap[_srcIdx]||null;
          LscOpts.sampler=function(su,sv){return layerV(0,0,su,sv,_srcL,_srcImg);};
        } else {
          // no valid source → fall back to disc so the layer isn't blank
          LscOpts.mode="disc";
        }
      }
    }
    var LlayerFilters=L.layerFilters||[];
    var LlayerMask=(L.mask&&L.mask.type&&L.mask.type!=="none")?L.mask:null;
    var LuseTemp=LlayerBlur>0||LlayerGlow>0||LlayerFilters.length>0||LhasPost||(globalLF&&globalLF.length>0)||LuseCrossBlend||!!LlayerMask;
    // Flip / Mirror / Radial constants
    var LflipH=!!L.flipH,LflipV=!!L.flipV,LmirrorH=!!L.mirrorH,LmirrorV=!!L.mirrorV;
    var LradialTile=!!L.radialTile;
    var LradialN=Math.max(2,Math.round(L.radialCount||6));
    var LradialOffX=L.radialOffsetX||0,LradialOffY=L.radialOffsetY||0;
    var LradialRadius=L.radialRadius!=null?L.radialRadius:0.25;
    var LradialAngOff=(L.radialAngleOffset||0)*Math.PI/180;
    var layerBuf=LuseTemp?getBuf(size*size*4):null;
    if(LuseTemp){for(var _i=0;_i<size*size;_i++)layerBuf[_i*4+3]=1;}

    // Pre-render any layers referenced as UV distortion sources.
    // Only needed when a "layer" type UV dist slot is active.
    var _layerDistBufs={};
    for(var _ldi=0;_ldi<LuvDists.length;_ldi++){
      var _ldd=LuvDists[_ldi];
      if(_ldd&&_ldd.type==="layer"&&(_ldd.amt||0)>0){
        var _lsi=_ldd.sourceLayerIdx!=null?_ldd.sourceLayerIdx:-1;
        if(_lsi>=0&&_lsi!==li&&_lsi<layers.length&&!_layerDistBufs[_lsi]){
          var _lbuf=getBuf(size*size*4);
          // Render source solo: force enabled, full opacity, normal blend
          // (same pattern as SoloPreview) so the warp map is always valid
          var _lsrc=Object.assign({},layers[_lsi],{enabled:true,opacity:1,blendMode:"normal",channels:"rgb"});
          renderLayersToBuf(_lbuf,size,[_lsrc],null,[]);
          _layerDistBufs[_lsi]=_lbuf;
        }
      }
    }

    for(var py=0;py<size;py++){
      var uyB=py*inv1;
      for(var px=0;px<size;px++){
        var u=px*inv1+LoffX,v=uyB+LoffY;

        if(LhasUV){
          var du=0,dv=0;
          for(var di=0;di<LuvDists.length;di++){
            var dd2=LuvDists[di];
            if(!dd2||!dd2.type||dd2.type==="none"||!dd2.amt)continue;
            // Apply per-dist offset before sampling noise (same as applyUVDists helper)
            var _dsu=u+(dd2.offsetX||0), _dsv=v+(dd2.offsetY||0);
            if(dd2.type==="layer"){
              // Layer Warp: use another layer's luminance as a displacement map.
              // Two decorrelated samples (main + half-UV offset) drive du/dv —
              // same dual-field pattern as the "noise" warp type.
              var _lwb=_layerDistBufs[dd2.sourceLayerIdx!=null?dd2.sourceLayerIdx:-1];
              if(_lwb){
                var _lw1=sampleBufLum(_lwb,size,_dsu,_dsv);
                var _lw2=sampleBufLum(_lwb,size,_dsu+0.5,_dsv+0.5);
                du+=(_lw1-0.5)*dd2.amt;dv+=(_lw2-0.5)*dd2.amt;
              }
              continue;
            }
            var ddv=distDelta(_dsu,_dsv,dd2.type,dd2.amt,dd2.freq||3,Lseed+777+di*333,dd2,LuseMathTile?1:0,LuseMathTile?1:0);
            du+=ddv[0];dv+=ddv[1];
          }
          u+=du;v+=dv;
        }
        if(LhasRot){var cu=u-0.5,cv=v-0.5;u=0.5+cu*LrotC-cv*LrotS;v=0.5+cu*LrotS+cv*LrotC;}
        // Skew / shear (use pre-skew coords for both to avoid cross-dependency)
        if(LskewX||LskewY){var _uPrSk=u,_vPrSk=v;if(LskewX)u=_uPrSk+(_vPrSk-0.5)*LskewX;if(LskewY)v=_vPrSk+(_uPrSk-0.5)*LskewY;}

        // Mirror UV: fold at 0.5 with triangle wave — mathematically seamless,
        // no blend needed. u in [0,1] → u' in [0,1] mirrored: 0→1→0→1→...
        // Works for ANY scale, not just integers. Implemented before flip/mirror
        // layer controls so they compose correctly on top.
        if(LuseMirror){
          // Fold u: triangle wave with period 2 (0→1 then 1→0)
          var _mu=((u%1)+1)%1*2; // wrap to [0,2)
          u=_mu>1?2-_mu:_mu;     // fold: [0,1] stays, [1,2] mirrors back
          var _mv=((v%1)+1)%1*2;
          v=_mv>1?2-_mv:_mv;
        }

        // Save UV before flip/mirror — radial SDF needs pre-distortion coords
        var _uPre=u,_vPre=v;

        // ── Flip / Mirror ────────────────────────────────────────
        if(LflipH)u=1-u;
        if(LflipV)v=1-v;
        if(LmirrorH)u=u<0.5?u*2:(1-u)*2;
        if(LmirrorV)v=v<0.5?v*2:(1-v)*2;

        // ── Radial Tiling (noise/non-SDF types: UV fold) ─────────
        var _ru=u,_rv=v;
        if(LradialTile){
          var _rcx=u-0.5+LradialOffX,_rcy=v-0.5+LradialOffY;
          var _ang=Math.atan2(_rcy,_rcx)+LradialAngOff;
          var _step=Math.PI*2/LradialN;
          var _sec=((_ang%_step)+_step)%_step;
          if(_sec>_step*0.5)_sec=_step-_sec;
          var _r=Math.hypot(_rcx,_rcy);
          _ru=0.5+Math.cos(_sec)*_r;
          _rv=0.5+Math.sin(_sec)*_r;
        }
        var nx=_ru*LscaleX,ny=_rv*LscaleY,scx=(_ru-0.5)*LscaleX,scy=(_rv-0.5)*LscaleY;

        // ── SDF coordinates for shape/gradient ──────────────────
        // Always computed from _uPre/_vPre (pre-flip/mirror) to avoid
        // mirror doubling UV frequency and compressing the shape.
        // Flip/mirror applied semantically in SDF space instead.
        var _sdfCx,_sdfCy;
        if(Ltype==="shape"||Ltype==="gradient"){
          if(LradialTile){
            // SDF polar repetition in UV space (isometric — no scale distortion)
            var _pu=_uPre-0.5+LradialOffX, _pv=_vPre-0.5+LradialOffY;
            var _pang=Math.atan2(_pv,_pu)+LradialAngOff;
            var _pstep=Math.PI*2/LradialN;
            var _psec=((_pang%_pstep)+_pstep)%_pstep-_pstep*0.5;
            var _pr=Math.hypot(_pu,_pv);
            _sdfCx=(_pr*Math.cos(_psec)-LradialRadius)*LscaleX;
            _sdfCy= _pr*Math.sin(_psec)               *LscaleY;
          } else {
            // No radial: apply flip/mirror using _uPre (pre-flip coords)
            // Flip: reverse UV (flips shape orientation, same size, no copies)
            // Mirror: UV fold + 0.5 scale compensation = same apparent size, 2 copies
            //   UV fold doubles frequency → shapes appear half-sized
            //   * 0.5 scale compensates → net: original size per copy
            var _ub=_uPre,_vb=_vPre;
            if(LflipH)_ub=1-_ub;
            if(LflipV)_vb=1-_vb;
            var _mSX=1.0,_mSY=1.0;
            if(LmirrorH){_ub=_ub<0.5?_ub*2:(1-_ub)*2;_mSX=0.5;}
            if(LmirrorV){_vb=_vb<0.5?_vb*2:(1-_vb)*2;_mSY=0.5;}
            _sdfCx=(_ub-0.5)*LscaleX*_mSX;
            _sdfCy=(_vb-0.5)*LscaleY*_mSY;
          }
        } else {
          _sdfCx=scx;_sdfCy=scy; // noise types: use UV-folded scx/scy as before
        }
        var val;

        if     (Ltype==="perlin")    val=perlin(nx,ny,Lpm,LtileX,LtileY);
        else if(Ltype==="value")     val=valueNoise(nx,ny,Lpm,LtileX,LtileY);
        else if(Ltype==="simplex")   val=simplex2(nx,ny,Lpm);
        else if(Ltype==="fbm")       val=fbm(nx,ny,Lpm,Lfo,LtileX,LtileY);
        else if(Ltype==="domainWarp")val=domWarp(nx,ny,Lpm,LwarpObj,LtileX,LtileY);
        else if(Ltype==="curl")      val=curlNoise(nx,ny,Lpm,LcurlS,LcurlObj,LtileX,LtileY);
        else if(Ltype==="white"){var _wx=Math.floor(_ru*LscaleX)|0,_wy=Math.floor(_rv*LscaleY)|0;if(LtileX)_wx=((_wx%LtileX)+LtileX)%LtileX;if(LtileY)_wy=((_wy%LtileY)+LtileY)%LtileY;val=whiteHash(_wx,_wy,Lseed);}
        else if(Ltype==="blue"){var _wx=Math.floor(_ru*LscaleX)|0,_wy=Math.floor(_rv*LscaleY)|0;if(LtileX)_wx=((_wx%LtileX)+LtileX)%LtileX;if(LtileY)_wy=((_wy%LtileY)+LtileY)%LtileY;var w2=whiteHash(_wx,_wy,Lseed),wd2=worley(nx,ny,Lseed,"euclidean",LtileX,LtileY);val=w2*0.5+clamp(1-wd2.d1*1.8)*0.5;}
        else if(Ltype==="worley"){
          // r=1 (3x3) suffices for plain F1 euclidean; F2/F3/smooth/edges/non-euclidean & jitter<1 need 5x5
          var _wNeedEdge=(LwMode==="edges"||LwMode==="edgesInv"||LwMode==="cellWalls");
          var _w1only=(LwMode==="f1"||LwMode==="cell"||LwMode==="cellShaded")&&LwMetric==="euclidean"&&LwJit>=0.999&&LwSmooth<=0&&!_wNeedEdge&&!LwWarp;
          var _wnx=nx,_wny=ny; if(LwWarp){var _cw=cellWarp(nx,ny,Lseed,LwWarp,LtileX,LtileY);_wnx=_cw[0];_wny=_cw[1];}
          var _wr=worley(_wnx,_wny,Lseed,LwMetric,LtileX,LtileY,_w1only?1:2,LwJit,LwSmooth,_wNeedEdge);
          val=worleyValue(_wr,LwMode,LwContrast);
        }
        else if(Ltype==="voronoi"){
          var _vnx=nx,_vny=ny; if(LwWarp){var _cwv=cellWarp(nx,ny,Lseed,LwWarp,LtileX,LtileY);_vnx=_cwv[0];_vny=_cwv[1];}
          val=voronoiNoise(_vnx,_vny,Lseed,LwMetric,LtileX,LtileY,LwJit,LwVarMode,LwContrast);
        }
        else if(Ltype==="crystals")  val=crystalsNoise(nx,ny,Lseed,LcrystalObj,LtileX,LtileY);
        else if(Ltype==="iqcell")    val=iqCellular(nx,ny,Lseed,LiqObj,LtileX,LtileY);
        else if(Ltype==="caustics")  val=causticsNoise(nx,ny,Lpm,Lseed,LtileX,LtileY,LcausObj);
        else if(Ltype==="cloud")       val=cloudNoise(nx,ny,Lpm,Lfo.oct,Lfo.lac,Lfo.gain,LtileX,LtileY,LcloudObj);
        else if(Ltype==="polarScatter")val=polarScatterNoise(scx,scy,Lpm,Lseed,LpolarCount,LpolarR,LpolarSp,LpolarIn,LpolarM);
        else if(Ltype==="scatter")    val=scatterNoise(_ru,_rv,Lseed,LscOpts);
        else if(Ltype==="slopeGrad")   val=slopeGradNoise(scx,scy,LslopeAng);
        else if(Ltype==="plasma")    val=plasmaNoise(nx,ny,Lseed,LtileX,LtileY,LplasmaObj);
        else if(Ltype==="wood")      val=woodNoise(scx,scy,Lpm,LwoodRings,LwoodTurb,LtileX,LtileY);
        else if(Ltype==="marble")    val=marbleNoise(nx,ny,Lpm,LmarbleObj,LtileX,LtileY);
        else if(Ltype==="gabor")     val=gaborNoise(nx,ny,Lpm,Lseed,LgaborFreq,LgaborObj,LtileX,LtileY);
        else if(Ltype==="dust")      val=dustNoise(nx,ny,Lseed,L.dustCoverage!=null?L.dustCoverage:0.5,L.dustSize!=null?L.dustSize:0.5,LtileX,LtileY);
        else if(Ltype==="debris")    val=debrisNoise(nx,ny,Lseed,L.debrisDensity!=null?L.debrisDensity:0.5,L.debrisSharp||2,LtileX,LtileY);
        else if(Ltype==="grain")     val=grainNoise(nx,ny,Lpm,L.grainRough!=null?L.grainRough:0.5,L.grainContrast||1.5,LtileX,LtileY);
        else if(Ltype==="hex")       val=hexNoise(nx,ny,Lseed,LhexObj,LtileX,LtileY);
        else if(Ltype==="scratches") val=scratchNoise(nx,ny,Lseed,LscrObj,LtileX,LtileY);
        else if(Ltype==="sparkle")   val=sparkleNoise(nx,ny,Lseed,LspkObj,LtileX,LtileY);
        else if(Ltype==="truchet")   val=truchetNoise(nx,ny,Lseed,LtruObj,LtileX,LtileY);
        else if(Ltype==="sparse")    val=sparseNoise(nx,ny,Lseed,LsparseObj,LtileX,LtileY);
        else if(Ltype==="gaussian"){var _wx=Math.floor(_ru*LscaleX)|0,_wy=Math.floor(_rv*LscaleY)|0;if(LtileX)_wx=((_wx%LtileX)+LtileX)%LtileX;if(LtileY)_wy=((_wy%LtileY)+LtileY)%LtileY;val=gaussianNoise(_wx,_wy,Lseed);}
        else if(Ltype==="highpass")  val=highpassNoise(u,v,Lpm,LscaleX,LhpBlur,Lfo.oct,LtileX,LtileY);
        else if(Ltype==="directional")val=dirNoise(u,v,Lpm,LdirScaleX,LdirScaleY,Lfo.oct,LtileX,LtileY);
        else if(Ltype==="waveStroke")val=waveStrokeNoise(u,v,Lpm,LfiberAngle,LwaveAmp,LwaveWarp,LwaveThick,LwaveOffset,LtileX,LtileY,L.dirContrast||1);
        else if(Ltype==="fiber")   val=fiberNoise(u,v,Lpm,LfiberAngle,LfiberStretch,Lfo.oct,LtileX,LtileY,L.dirContrast||1,L.fiberCross!=null?L.fiberCross:0.15);
        else if(Ltype==="streaks") val=streaksNoise(u,v,Lpm,LfiberAngle,LstreakLength,LstreakDensity,LtileX,LtileY,L.dirContrast||1);
        else if(Ltype==="crosshatch")val=crosshatchNoise(u,v,Lpm,LfiberAngle,LwaveFreq,LwaveThick,LtileX,LtileY,L.dirContrast||1);
        else if(Ltype==="rippleDir") val=rippleDirNoise(u,v,Lpm,LfiberAngle,LwaveFreq,LwaveWarp,LtileX,LtileY,L.dirContrast||1);
        else if(Ltype==="flowLines") val=flowLinesNoise(u,v,Lpm,LfiberAngle,LwaveFreq,LwaveWarp,LtileX,LtileY,L.dirContrast||1);
        else if(Ltype==="gradient"){
          val=computeGrad(_sdfCx,_sdfCy,LgradT,LgradScale,LgradFreq,LgradPow);
        }
        else if(Ltype==="shape"){
          val=computeShape(_sdfCx,_sdfCy,LshapeK,LshapeP);
          // Width curve: physically scales the shape at each angle
          // Evaluates shape at angle-modulated coordinates before the SDF
          // curve=1.0 → normal; <1.0 → narrower; >1.0 → wider at that angle
          if(LshapeWidthLUT&&(_sdfCx!==0||_sdfCy!==0)){
            var _wAng=Math.atan2(_sdfCy,_sdfCx);
            var _wPos=(_wAng+Math.PI)/(Math.PI*2); // 0..1
            var _wIdx=_wPos<0?0:_wPos>1?255:Math.floor(_wPos*255);
            var _wMul=LshapeWidthLUT[_wIdx]; // 0..1
            // Remap: curve=0.5 (midpoint) → no change; curve<0.5 → narrower; >0.5 → wider
            var _wScale=_wMul>0.01?1/(Math.max(0.01,_wMul)):100;
            val=computeShape(_sdfCx*_wScale,_sdfCy*_wScale,LshapeK,LshapeP);
          }
          if(LshapeCurveLUT)val=LshapeCurveLUT[val<0?0:val>1?1:Math.floor(val*255)];
        }
        else if(Ltype==="image"){
          if(imgPix){
            var uw=(_ru%1+1)%1,vw2=(_rv%1+1)%1;
            if(LimgBilinear){
              // Bilinear sampling
              var fx=uw*LimgW,fy=vw2*LimgH;
              var x0=Math.floor(fx)%LimgW,y0=Math.floor(fy)%LimgH;
              var x1=(x0+1)%LimgW,y1=(y0+1)%LimgH;
              var tx2=fx-Math.floor(fx),ty2=fy-Math.floor(fy);
              var i00=(y0*LimgW+x0)*4,i10=(y0*LimgW+x1)*4;
              var i01=(y1*LimgW+x0)*4,i11=(y1*LimgW+x1)*4;
              var d=imgPix.data;
              if(LimgIsRGB){
                _imgR=(d[i00]/255*(1-tx2)*(1-ty2)+d[i10]/255*tx2*(1-ty2)+d[i01]/255*(1-tx2)*ty2+d[i11]/255*tx2*ty2);
                _imgG=(d[i00+1]/255*(1-tx2)*(1-ty2)+d[i10+1]/255*tx2*(1-ty2)+d[i01+1]/255*(1-tx2)*ty2+d[i11+1]/255*tx2*ty2);
                _imgB=(d[i00+2]/255*(1-tx2)*(1-ty2)+d[i10+2]/255*tx2*(1-ty2)+d[i01+2]/255*(1-tx2)*ty2+d[i11+2]/255*tx2*ty2);
                val=0.299*_imgR+0.587*_imgG+0.114*_imgB;
              } else {
                var r00=lumin(d[i00]/255,d[i00+1]/255,d[i00+2]/255);
                var r10=lumin(d[i10]/255,d[i10+1]/255,d[i10+2]/255);
                var r01=lumin(d[i01]/255,d[i01+1]/255,d[i01+2]/255);
                var r11=lumin(d[i11]/255,d[i11+1]/255,d[i11+2]/255);
                val=r00*(1-tx2)*(1-ty2)+r10*tx2*(1-ty2)+r01*(1-tx2)*ty2+r11*tx2*ty2;
              }
            } else {
              // Nearest-neighbor
              var isx2=Math.floor(uw*LimgW)%LimgW,isy2=Math.floor(vw2*LimgH)%LimgH;
              var iii=(isy2*LimgW+isx2)*4;
              if(LimgIsRGB){
                _imgR=imgPix.data[iii]/255;_imgG=imgPix.data[iii+1]/255;_imgB=imgPix.data[iii+2]/255;
                val=0.299*_imgR+0.587*_imgG+0.114*_imgB;
              } else {
                val=lumin(imgPix.data[iii]/255,imgPix.data[iii+1]/255,imgPix.data[iii+2]/255);
              }
            }
          } else val=0.5;
        }
        else val=0.5;

        // Adjust (all local vars, no L. access)
        // 0. Curve LUT
        if(LcurveLUT)val=LcurveLUT[val<0?0:val>1?1:Math.floor(val*255)];
        if(LcIsPow){if(val<0)val=0;else if(val>1)val=1;if(Lcont!==1)val=Math.pow(val,Lcont);}
        else{if(val<0)val=0;else if(val>1)val=1;if(Lcont!==1){var c2=Lcont*2;val=val<0.5?Math.pow(val*2,c2)*0.5:1-Math.pow((1-val)*2,c2)*0.5;}}
        if(LhasMid){if(val<0)val=0;else if(val>1)val=1;val=Math.pow(val,LmidExp);}
        val+=Lbright;if(val<0)val=0;else if(val>1)val=1;
        if(Linvert)val=1-val;
        val=(val-Lri0)*LriRange;if(val<0)val=0;else if(val>1)val=1;
        if(LstepsN)val=Math.round(val*LstepsN)/LstepsN;
        val*=Lmult;if(val<0)val=0;else if(val>1)val=1;
        val=LoutLo+val*LoutRange;

        var idx=(py*size+px)*4;
        if(LchSingle){
          var sv=val;
          if(!LuseTemp){sv=LbmNorm?val:blendV(buf[idx+LchIdx],val,Lbm);buf[idx+LchIdx]+=Lop*(sv-buf[idx+LchIdx]);}
          else{layerBuf[idx+LchIdx]=val;}
        } else {
          // Color: use ramp by default, bypass if image RGB mode
          var cr,cg,cbv;
          if(LimgIsRGB){cr=_imgR;cg=_imgG;cbv=_imgB;}
          else if(LgradLUT){var _li=val<0?0:val>1?255:Math.floor(val*255);cr=LgradLUT[_li*3];cg=LgradLUT[_li*3+1];cbv=LgradLUT[_li*3+2];}
          else{cr=Lr1+LrR*val;cg=Lg1+LgR*val;cbv=Lb1+LbR*val;}
          if(LsatOff){var lv3=0.299*cr+0.587*cg+0.114*cbv,sd=1-Lsat;cr-=lv3*sd;cg-=lv3*sd;cbv-=lv3*sd;if(cr<0)cr=0;else if(cr>1)cr=1;if(cg<0)cg=0;else if(cg>1)cg=1;if(cbv<0)cbv=0;else if(cbv>1)cbv=1;}
          if(Lhue!==0){
            // Inline HSL rotate - avoids 2 array allocations per pixel
            var _mx=cr>cg?(cr>cbv?cr:cbv):(cg>cbv?cg:cbv);
            var _mn=cr<cg?(cr<cbv?cr:cbv):(cg<cbv?cg:cbv);
            var _l=(_mx+_mn)*0.5,_d=_mx-_mn,_h=0,_s=0;
            if(_d>0){
              _s=_l>0.5?_d/(2-_mx-_mn):_d/(_mx+_mn);
              if(_mx===cr)_h=(cg-cbv)/_d+(cg<cbv?6:0);
              else if(_mx===cg)_h=(cbv-cr)/_d+2;
              else _h=(cr-cg)/_d+4;
              _h=(_h/6+Lhue/360+1)%1;
            }
            if(_s===0){cr=_l;cg=_l;cbv=_l;}
            else{
              var _q=_l<0.5?_l*(1+_s):_l+_s-_l*_s,_p=2*_l-_q;
              cr=_hue2rgb(_p,_q,_h+0.3333);cg=_hue2rgb(_p,_q,_h);cbv=_hue2rgb(_p,_q,_h-0.3333);
            }
          }
          if(LuseTemp){
            // Write raw to temp (no blend yet)
            if(LdoR)layerBuf[idx  ]=cr;
            if(LdoG)layerBuf[idx+1]=cg;
            if(LdoB)layerBuf[idx+2]=cbv;
            if(LdoA)layerBuf[idx+3]=val;
          } else if(LbmNorm){
            if(LdoR)buf[idx  ]+=Lop*(cr -buf[idx  ]);
            if(LdoG)buf[idx+1]+=Lop*(cg -buf[idx+1]);
            if(LdoB)buf[idx+2]+=Lop*(cbv-buf[idx+2]);
            if(LdoA)buf[idx+3]+=Lop*(val-buf[idx+3]);
          } else {
            if(LdoR)buf[idx  ]+=Lop*(blendV(buf[idx  ],cr, Lbm)-buf[idx  ]);
            if(LdoG)buf[idx+1]+=Lop*(blendV(buf[idx+1],cg, Lbm)-buf[idx+1]);
            if(LdoB)buf[idx+2]+=Lop*(blendV(buf[idx+2],cbv,Lbm)-buf[idx+2]);
            if(LdoA)buf[idx+3]+=Lop*(blendV(buf[idx+3],val,Lbm)-buf[idx+3]);
          }
        }
      }
    }

    // Post-process temp buffer + composite into buf
    if(LuseTemp){
      if(LlayerBlur>0)gaussBlur(layerBuf,size,size,Math.max(1,Math.round(LlayerBlur)));
      if(LlayerGlow>0)applyGlow(layerBuf,size,LlayerGlow,LlayerGlowI);
      // Cross-blend seamless: apply 4-way bilinear blend to make ANY layer tile-ready
      if(LuseCrossBlend)applyLayerCrossBlend(layerBuf,size,LseamlessBlendW);
      // Apply per-layer filters
      for(var _fi=0;_fi<LlayerFilters.length;_fi++){if(LlayerFilters[_fi]&&LlayerFilters[_fi].enabled)applyFilter(layerBuf,size,LlayerFilters[_fi]);}
      // (Global filters moved to POST-MERGE so they affect the whole composite
      //  including the global glow — see applyGlobalFiltersPost below.)
      // Per-layer mask: multiplies only THIS layer's pixels (global mask still
      // applies later to the whole composite). Same engine as the global mask.
      if(LlayerMask)applyMaskToBuf(layerBuf,size,LlayerMask);
      // Post-transform: inverse-map pixels for scale/rotate/translate
      if(LhasPost){
        var ptBuf=getBuf(size*size*4);
        var ptCos=Math.cos(-LpostRot*Math.PI/180),ptSin=Math.sin(-LpostRot*Math.PI/180);
        var ptInvSX=LpostSX>0?1/LpostSX:1,ptInvSY=LpostSY>0?1/LpostSY:1;
        var szm1=size-1;
        for(var ptY=0;ptY<size;ptY++){for(var ptX=0;ptX<size;ptX++){
          var pcu=ptX*inv1-0.5-LpostTX, pcv=ptY*inv1-0.5-LpostTY;
          var pru=pcu*ptCos-pcv*ptSin, prv=pcu*ptSin+pcv*ptCos;
          var psu=(pru*ptInvSX)+0.5, psv=(prv*ptInvSY)+0.5;
          if(psu<0||psu>1||psv<0||psv>1)continue;
          var pfx=psu*szm1,pfy=psv*szm1;
          var px0=pfx|0,py0=pfy|0,px1=Math.min(px0+1,szm1),py1=Math.min(py0+1,szm1);
          var ptx=pfx-px0,pty=pfy-py0,ptxi=1-ptx,ptyi=1-pty;
          var pi00=(py0*size+px0)*4,pi10=(py0*size+px1)*4;
          var pi01=(py1*size+px0)*4,pi11=(py1*size+px1)*4;
          var pto=(ptY*size+ptX)*4;
          for(var ch4=0;ch4<4;ch4++){
            ptBuf[pto+ch4]=(layerBuf[pi00+ch4]*ptxi+layerBuf[pi10+ch4]*ptx)*ptyi
                          +(layerBuf[pi01+ch4]*ptxi+layerBuf[pi11+ch4]*ptx)*pty;
          }
        }}
        releaseBuf(layerBuf);
        layerBuf=ptBuf;
      }
      // Composite layerBuf into buf using layer blend/opacity
      for(var _ci=0;_ci<size*size;_ci++){
        var _ii=_ci*4;
        if(LchSingle){
          var _sv=LbmNorm?layerBuf[_ii+LchIdx]:blendV(buf[_ii+LchIdx],layerBuf[_ii+LchIdx],Lbm);
          buf[_ii+LchIdx]+=Lop*(_sv-buf[_ii+LchIdx]);
        } else {
          if(LbmNorm){
            if(LdoR)buf[_ii  ]+=Lop*(layerBuf[_ii  ]-buf[_ii  ]);
            if(LdoG)buf[_ii+1]+=Lop*(layerBuf[_ii+1]-buf[_ii+1]);
            if(LdoB)buf[_ii+2]+=Lop*(layerBuf[_ii+2]-buf[_ii+2]);
            if(LdoA)buf[_ii+3]+=Lop*(layerBuf[_ii+3]-buf[_ii+3]);
          } else {
            if(LdoR)buf[_ii  ]+=Lop*(blendV(buf[_ii  ],layerBuf[_ii  ],Lbm)-buf[_ii  ]);
            if(LdoG)buf[_ii+1]+=Lop*(blendV(buf[_ii+1],layerBuf[_ii+1],Lbm)-buf[_ii+1]);
            if(LdoB)buf[_ii+2]+=Lop*(blendV(buf[_ii+2],layerBuf[_ii+2],Lbm)-buf[_ii+2]);
            if(LdoA)buf[_ii+3]+=Lop*(blendV(buf[_ii+3],layerBuf[_ii+3],Lbm)-buf[_ii+3]);
          }
        }
      }
      // Release layerBuf back to pool — composited into buf, no longer needed
      releaseBuf(layerBuf);
    }
    // Release any per-layer-dist source buffers
    for(var _ldk in _layerDistBufs){if(_layerDistBufs[_ldk])releaseBuf(_layerDistBufs[_ldk]);}

  } // end for li (layer loop)

} // end renderLayersToBuf

// Global mask applied separately AFTER all filters — mask must be last
function applyMaskToBuf(buf,size,mask){
  if(!mask||mask.type==="none")return;
  var inv1=1/size;
  var mtype=mask.type;
  var mstr=mask.strength!=null?mask.strength:1;
  var mrad=mask.radius!=null?mask.radius:0.5;
  var mhard=mask.hardness!=null?mask.hardness:0;
  var mox=mask.offsetX||0,moy=mask.offsetY||0;
  var mscX=mask.scaleX!=null?mask.scaleX:1,mscY=mask.scaleY!=null?mask.scaleY:1;
  var minv=!!mask.invert;
  var muvt=mask.uvDistType||"none",muva=mask.uvDistAmt||0,muvf=mask.uvDistFreq||3;
  var mhasUV=muvt!=="none"&&muva>0;
  var mangle=(mask.angle||0)*Math.PI/180;
  var mac=Math.cos(mangle),mas=Math.sin(mangle);
  var mhw=Math.max((1-mhard)*0.5,0.0005);
  var minner=mrad-mhw,mouter=mrad+mhw,mfallW=mouter-minner;
  var mapply=mask.apply||"both";
  for(var py=0;py<size;py++)for(var px=0;px<size;px++){
    var ux=px*inv1,uy=py*inv1,mux=ux,muy=uy;
    if(mhasUV){var muv2=applyUVDists(ux,uy,[{type:muvt,amt:muva,freq:muvf}],1234);mux=muv2[0];muy=muv2[1];}
    var mcx=(mux-0.5-mox),mcy=(muy-0.5-moy);
    var rcx=mangle!==0?mcx*mac-mcy*mas:mcx;
    var rcy=mangle!==0?mcx*mas+mcy*mac:mcy;
    var d;
    if(mtype==="vignette"||mtype==="ellipse"){
      d=Math.sqrt((rcx/Math.max(mscX,0.01))*(rcx/Math.max(mscX,0.01))+(rcy/Math.max(mscY,0.01))*(rcy/Math.max(mscY,0.01)));
    } else if(mtype==="box"){
      d=Math.max(Math.abs(rcx/Math.max(mscX,0.01)),Math.abs(rcy/Math.max(mscY,0.01)));
    } else if(mtype==="diamond"){
      d=(Math.abs(rcx/Math.max(mscX,0.01))+Math.abs(rcy/Math.max(mscY,0.01)))*0.5;
    } else if(mtype==="radial"){
      d=0.5-Math.sqrt(rcx*rcx+rcy*rcy);
    } else if(mtype==="linear"){
      d=rcx+0.5;
    } else {
      var ex2=mux<1-mux?mux:1-mux,ey2=muy<1-muy?muy:1-muy;
      d=Math.min(ex2,ey2)*2;
    }
    var m=(d-minner)/mfallW;
    if(m<0)m=0;else if(m>1)m=1;
    if(minv)m=1-m;
    m*=mstr;if(m<0)m=0;else if(m>1)m=1;
    var ii=(py*size+px)*4;
    if(mapply==="both"||mapply==="color"){buf[ii]*=m;buf[ii+1]*=m;buf[ii+2]*=m;}
    if(mapply==="both"||mapply==="alpha"){buf[ii+3]*=m;}
  }
}

// ═══ MAIN RENDER ════════════════════════════════════════════════
var PREVIEW_HI=256; // idle preview size
var PREVIEW_LO=128; // dragging preview size (4x fewer pixels = 4x faster)

function renderAll(canvas,state,size,chanMode,bleedForAlpha){
  size=size||PREVIEW_HI;
  var colorSpace=state.colorSpace;
  canvas.width=canvas.height=size;
  var ctx=canvas.getContext("2d");
  var buf=getBuf(size*size*4);

  if(state.spritesheetMode){
    var half=size/2;
    var offsets=[[0,0],[half,0],[0,half],[half,half]];
    for(var si2=0;si2<4;si2++){
      var slot=state.slots[si2],slotBuf=getBuf(half*half*4);
      renderLayersToBuf(slotBuf,half,resolveReferences(slot.layers),null,state.globalLayerFilters||[]);
      var slotMask=slot.mask||state.mask;
      var blurR2=state.blurRadius||0;
      if(blurR2>=1)gaussBlur(slotBuf,half,half,Math.max(1,Math.round(blurR2)));
      if((state.glowRadius||0)>0&&(state.glowIntensity||0)>0)applyGlow(slotBuf,half,state.glowRadius,state.glowIntensity,{threshold:state.glowThreshold||0,tintR:state.glowTintR!=null?state.glowTintR:1,tintG:state.glowTintG!=null?state.glowTintG:1,tintB:state.glowTintB!=null?state.glowTintB:1,blend:state.glowBlend||"add"});
      applyGlobalAdjust(slotBuf,half,state); // global tone/color after glow
      applyGlobalFiltersPost(slotBuf,half,state.globalLayerFilters||[]); // global FX after glow
      if(state.filters&&state.filters.length)for(var fi2=0;fi2<state.filters.length;fi2++)applyFilter(slotBuf,half,state.filters[fi2]);
      applyMaskToBuf(slotBuf,half,slotMask);
      var ox=offsets[si2][0],oy=offsets[si2][1];
      for(var py=0;py<half;py++)for(var px=0;px<half;px++){
        var src=(py*half+px)*4,dst=((oy+py)*size+(ox+px))*4;
        buf[dst]=slotBuf[src];buf[dst+1]=slotBuf[src+1];buf[dst+2]=slotBuf[src+2];buf[dst+3]=slotBuf[src+3];
      }
      releaseBuf(slotBuf);
    }
  } else {
    renderLayersToBuf(buf,size,resolveGroups(resolveReferences(state.layers),state.layerGroups),null,state.globalLayerFilters||[]);
    var blurR=state.blurRadius||0;
    if(blurR>=1)gaussBlur(buf,size,size,Math.max(1,Math.round(blurR)));
    if((state.glowRadius||0)>0&&(state.glowIntensity||0)>0)applyGlow(buf,size,state.glowRadius,state.glowIntensity,{threshold:state.glowThreshold||0,tintR:state.glowTintR!=null?state.glowTintR:1,tintG:state.glowTintG!=null?state.glowTintG:1,tintB:state.glowTintB!=null?state.glowTintB:1,blend:state.glowBlend||"add"});
    applyGlobalAdjust(buf,size,state); // global tone/color after glow
    applyGlobalFiltersPost(buf,size,state.globalLayerFilters||[]); // global FX after glow
    if(state.filters&&state.filters.length)for(var fi=0;fi<state.filters.length;fi++)applyFilter(buf,size,state.filters[fi]);
    applyMaskToBuf(buf,size,state.mask); // mask LAST — after all filters
  }

  // Alpha edge bleed for display: only when requested and the texture actually
  // has transparency. Done on the live buf just before conversion; the buf is
  // released right after, so exports (which re-render) are unaffected.
  if(bleedForAlpha&&!chanMode){
    var _hasAlpha=false;
    for(var _ai=3;_ai<buf.length;_ai+=4){if(buf[_ai]<0.996){_hasAlpha=true;break;}}
    if(_hasAlpha)bleedAlphaEdges(buf,size,size,2);
  }
  var img=ctx.createImageData(size,size),data=img.data,doSRGB=colorSpace==="srgb";
  for(var i=0;i<size*size;i++){
    var r=clamp(buf[i*4]),g=clamp(buf[i*4+1]),b=clamp(buf[i*4+2]),a=clamp(buf[i*4+3]);
    if(chanMode){
      if(doSRGB){r=toSRGB(r);g=toSRGB(g);b=toSRGB(b);}
      // Channel isolation: show selected channel as greyscale
      var cv=chanMode==="r"?r:chanMode==="g"?g:chanMode==="b"?b:(doSRGB?toSRGB(a):a);
      r=cv;g=cv;b=cv;a=1;
    } else {
      if(doSRGB){r=toSRGB(r);g=toSRGB(g);b=toSRGB(b);}
    }
    data[i*4]=r*255+0.5|0;data[i*4+1]=g*255+0.5|0;data[i*4+2]=b*255+0.5|0;data[i*4+3]=a*255+0.5|0;
  }
  ctx.putImageData(img,0,0);
  updateHistogram(buf,size);
  // Edge-cut analysis for the seam/clip warning (cheap: 4 edges only)
  _lastEdgeAnalysis=analyzeEdges(buf,size,_edgeCheckMode);
  releaseBuf(buf);

  if(state.spritesheetMode){
    var h2=size/2;
    ctx.strokeStyle="rgba(232,144,10,0.4)";ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(h2,0);ctx.lineTo(h2,size);ctx.moveTo(0,h2);ctx.lineTo(size,h2);ctx.stroke();
    var lbs=["1","2","3","4"],lx=[h2*0.5,h2*1.5,h2*0.5,h2*1.5],ly=[h2*0.07+10,h2*0.07+10,h2*1.07+10,h2*1.07+10];
    ctx.textAlign="center";ctx.font="bold "+(h2*0.08)+"px monospace";
    for(var i=0;i<4;i++){ctx.fillStyle=i===state.activeSlotIdx?"rgba(232,144,10,0.9)":"rgba(232,144,10,0.2)";ctx.fillText(lbs[i],lx[i],ly[i]);}
  }
}

// Export at full requested size
// ── Seamless loop maker ──────────────────────────────────────────
// Crossfades the tail of the sequence into the head so playback loops with
// no visible jump. overlap = N frames: output length is M-N, where the first
// N output frames are tail→head blends. Continuity is exact at both ends:
// out[0] === frame[M-N] (natural continuation of the last output frame) and
// out[N-1] === frame[N-1] (flows into the untouched middle).
// Pure frames are passed by reference (no copy) — only N new buffers.
// blendMode: "linear" (straight dissolve), "smooth" (smoothstep-weighted
// dissolve — softer at both ends), "additive" (weighted sum — keeps fire/spark
// brightness that a dissolve would dip in the middle). Alpha ALWAYS uses the
// linear crossfade weight so compositing coverage stays clean 0..1 tail→head.
function makeLoopFrames(frames,overlap,blendMode){
  var M=frames.length;
  var N=Math.max(1,Math.min(Math.floor((M-1)/2),Math.round(overlap||4)));
  var mode=blendMode||"linear";
  var out=new Array(M-N);
  for(var k=0;k<M-N;k++){
    if(k<N){
      var w=N>1?k/(N-1):1; // 0 = pure tail, 1 = pure head
      var wc=w; // color weight
      if(mode==="smooth")wc=w*w*(3-2*w); // smoothstep
      var head=frames[k],tail=frames[M-N+k];
      var nb=new Float32Array(head.length);
      for(var i=0;i<head.length;i+=4){
        if(mode==="additive"){
          // Weighted sum, clamped. Bright overlaps stay bright instead of
          // dipping at the midpoint like a dissolve.
          nb[i  ]=Math.min(1,tail[i  ]*(1-wc)+head[i  ]*wc);
          nb[i+1]=Math.min(1,tail[i+1]*(1-wc)+head[i+1]*wc);
          nb[i+2]=Math.min(1,tail[i+2]*(1-wc)+head[i+2]*wc);
          // additive boost: add a fraction of the fading-out frame back so the
          // total energy curve is flat across the crossfade
          var boost=wc*(1-wc); // peaks at the midpoint
          nb[i  ]=Math.min(1,nb[i  ]+tail[i  ]*boost);
          nb[i+1]=Math.min(1,nb[i+1]+tail[i+1]*boost);
          nb[i+2]=Math.min(1,nb[i+2]+tail[i+2]*boost);
        } else {
          nb[i  ]=tail[i  ]*(1-wc)+head[i  ]*wc;
          nb[i+1]=tail[i+1]*(1-wc)+head[i+1]*wc;
          nb[i+2]=tail[i+2]*(1-wc)+head[i+2]*wc;
        }
        // Alpha: always linear crossfade (coverage must stay clean)
        nb[i+3]=tail[i+3]*(1-w)+head[i+3]*w;
      }
      out[k]=nb;
    } else out[k]=frames[k];
  }
  return out;
}

// ── Box-filter downscale for a square RGBA frame ─────────────────
// Exact average over each destination texel's source footprint — correct for
// any integer or fractional ratio, alpha included. Downscale only.
function resizeFrameBuf(src,ss,ds){
  if(ds>=ss)return src;
  var out=new Float32Array(ds*ds*4);
  var ratio=ss/ds;
  for(var y=0;y<ds;y++){
    var y0=Math.floor(y*ratio),y1=Math.min(ss,Math.max(y0+1,Math.ceil((y+1)*ratio)));
    for(var x=0;x<ds;x++){
      var x0=Math.floor(x*ratio),x1=Math.min(ss,Math.max(x0+1,Math.ceil((x+1)*ratio)));
      var r=0,g=0,b=0,a=0,n=0;
      for(var sy=y0;sy<y1;sy++){var row=sy*ss;
        for(var sx=x0;sx<x1;sx++){var ii=(row+sx)*4;r+=src[ii];g+=src[ii+1];b+=src[ii+2];a+=src[ii+3];n++;}}
      var oi=(y*ds+x)*4;out[oi]=r/n;out[oi+1]=g/n;out[oi+2]=b/n;out[oi+3]=a/n;
    }
  }
  return out;
}

// ── Flipbook retiming ────────────────────────────────────────────
// Computes the EFFECTIVE frame sequence from an imported flipbook's retiming
// settings: trim range [rangeIn..rangeOut], frame step (keep every Nth), and
// play mode (forward / reverse / pingpong). Every consumer (playback loop,
// canvas render, scrubber, export) maps through this one function, so they
// can never disagree.
function fbSequence(fb){
  if(!fb||!fb.totalFrames)return[];
  var n=fb.totalFrames;
  var i0=Math.max(0,Math.min(n-1,fb.rangeIn!=null?fb.rangeIn:0));
  var i1=Math.max(i0,Math.min(n-1,fb.rangeOut!=null?fb.rangeOut:n-1));
  var step=Math.max(1,Math.round(fb.frameStep||1));
  var seq=[];
  for(var i=i0;i<=i1;i+=step)seq.push(i);
  // Time remap curve: x = output (playback) time, y = source position within
  // the trimmed sequence, both normalized. Evaluated with the SAME
  // evalCurveLUT as every other curve in the app, so the feel is identical.
  // Output length is unchanged — a flat segment freezes, a steep one speeds up.
  if(fb.timeCurve&&fb.timeCurve.length>=2&&seq.length>1){
    var lut=evalCurveLUT(fb.timeCurve,fb.timeCurveMode||"smooth");
    var M=seq.length,out=new Array(M);
    for(var k=0;k<M;k++){
      var t=lut[Math.round(k/(M-1)*255)];
      out[k]=seq[Math.round((t<0?0:t>1?1:t)*(M-1))];
    }
    seq=out;
  }
  if(fb.playMode==="reverse")seq.reverse();
  else if(fb.playMode==="pingpong"){
    // forward then back, without repeating the endpoints
    for(var k=seq.length-2;k>=1;k--)seq.push(seq[k]);
  }
  return seq;
}

// Convert a rendered height buffer (luminance) to a tangent-space normal map
// in place. Sobel gradients with wrap-around sampling (correct for tiling
// textures), encoded as RGB = normal*0.5+0.5, alpha=1. OpenGL convention
// (green = up); Unity's default. strength scales the bump intensity.
// Export the 4 spritesheet slots channel-packed into a single RGBA texture:
// slot 1 luminance -> R, slot 2 -> G, slot 3 -> B, slot 4 -> A.
// Each slot gets the full per-slot post chain (blur/glow/filters/mask), same as
// the spritesheet atlas path, but rendered at FULL export resolution.
// This is the classic packed-mask workflow for game VFX shaders
// (e.g. R=erosion, G=dissolve, B=detail, A=alpha).
function exportPackedRGBA(state){
  return new Promise(function(resolve){
    var size=state.exportSize||state.size||512;
    var c=document.createElement("canvas");c.width=c.height=size;
    var ctx=c.getContext("2d");
    var img=ctx.createImageData(size,size),data=img.data;
    var n=size*size;
    for(var si2=0;si2<4;si2++){
      var slot=state.slots[si2];
      var slotBuf=getBuf(size*size*4);
      renderLayersToBuf(slotBuf,size,resolveReferences(slot.layers),null,state.globalLayerFilters||[]);
      var blurR2=state.blurRadius||0;
      if(blurR2>=1)gaussBlur(slotBuf,size,size,Math.max(1,Math.round(blurR2)));
      if((state.glowRadius||0)>0&&(state.glowIntensity||0)>0)applyGlow(slotBuf,size,state.glowRadius,state.glowIntensity,{threshold:state.glowThreshold||0,tintR:state.glowTintR!=null?state.glowTintR:1,tintG:state.glowTintG!=null?state.glowTintG:1,tintB:state.glowTintB!=null?state.glowTintB:1,blend:state.glowBlend||"add"});
      applyGlobalAdjust(slotBuf,size,state); // global tone/color after glow
      applyGlobalFiltersPost(slotBuf,size,state.globalLayerFilters||[]); // global FX after glow
      if(state.filters&&state.filters.length)for(var fi2=0;fi2<state.filters.length;fi2++)applyFilter(slotBuf,size,state.filters[fi2]);
      applyMaskToBuf(slotBuf,size,slot.mask||state.mask);
      // Pack luminance into this slot's channel. Mask data stays linear —
      // packed channels are data, not color, so no sRGB encoding.
      for(var i=0;i<n;i++){
        var ii=i*4;
        var lum=0.299*slotBuf[ii]+0.587*slotBuf[ii+1]+0.114*slotBuf[ii+2];
        lum=lum<0?0:lum>1?1:lum;
        data[ii+si2]=lum*255+0.5|0;
      }
      releaseBuf(slotBuf);
    }
    ctx.putImageData(img,0,0);
    resolve(c);
  });
}

function heightToNormal(buf,size,strength){
  var s=strength!=null?strength:2;
  // Extract luminance into a temp single-channel buffer first
  var lum=getBuf(size*size); // getBuf zeroes
  for(var i=0;i<size*size;i++){
    var ii=i*4;
    lum[i]=0.299*buf[ii]+0.587*buf[ii+1]+0.114*buf[ii+2];
  }
  var sm1=size-1;
  for(var y=0;y<size;y++){
    var yu=y===0?sm1:y-1, yd=y===sm1?0:y+1; // wrap
    for(var x=0;x<size;x++){
      var xl=x===0?sm1:x-1, xr=x===sm1?0:x+1; // wrap
      // Sobel X and Y on the height field
      var tl=lum[yu*size+xl],t=lum[yu*size+x],tr=lum[yu*size+xr];
      var l =lum[y *size+xl],            r2=lum[y *size+xr];
      var bl=lum[yd*size+xl],b=lum[yd*size+x],br=lum[yd*size+xr];
      var dx=(tr+2*r2+br)-(tl+2*l+bl);
      var dy=(bl+2*b+br)-(tl+2*t+tr);
      // Normal: (-dx*s, -dy*s, 1) normalized; flip dy for OpenGL green-up
      var nx=-dx*s,ny=dy*s,nz=1;
      var inv=1/Math.sqrt(nx*nx+ny*ny+nz*nz);
      var oi=(y*size+x)*4;
      buf[oi  ]=nx*inv*0.5+0.5;
      buf[oi+1]=ny*inv*0.5+0.5;
      buf[oi+2]=nz*inv*0.5+0.5;
      buf[oi+3]=1;
    }
  }
  releaseBuf(lum);
}

function exportFull(state,opts){
  return new Promise(function(resolve,reject){
    var size=state.exportSize||state.size||512;
    var c=document.createElement("canvas");c.width=c.height=size;
    var ctx=c.getContext("2d");
    var buf=new Float32Array(size*size*4);
    for(var _ai=3;_ai<buf.length;_ai+=4)buf[_ai]=1;
    // NODE MODE export: evaluate the graph at full resolution and draw its output.
    if(opts&&opts.nodeGraph){
      try{
        var _res=evaluate(opts.nodeGraph,size,makeNodeEvaluator(size));
        if(_res.buffer){
          var _img=ctx.createImageData(size,size);
          for(var _ni=0;_ni<size*size;_ni++){
            _img.data[_ni*4]=Math.round((_res.buffer[_ni*4]||0)*255);
            _img.data[_ni*4+1]=Math.round((_res.buffer[_ni*4+1]||0)*255);
            _img.data[_ni*4+2]=Math.round((_res.buffer[_ni*4+2]||0)*255);
            _img.data[_ni*4+3]=255;
          }
          ctx.putImageData(_img,0,0);
        }
      }catch(_e){
        // Swallowing this produced a blank PNG with no indication anything
        // went wrong. Every caller has a .catch, so surface it instead.
        reject(_e instanceof Error ? _e : new Error(String(_e)));
        return;
      }
      resolve(c); return;
    }
    if(state.spritesheetMode){
      var half=size/2,offsets=[[0,0],[half,0],[0,half],[half,half]];
      for(var si2=0;si2<4;si2++){
        var slot=state.slots[si2],slotBuf=new Float32Array(half*half*4);
        renderLayersToBuf(slotBuf,half,resolveReferences(slot.layers),null,state.globalLayerFilters||[]);
        // Apply the same post-processing as renderAll's spritesheet path
        var blurR2=state.blurRadius||0;
        if(blurR2>=1)gaussBlur(slotBuf,half,half,Math.max(1,Math.round(blurR2)));
        if((state.glowRadius||0)>0&&(state.glowIntensity||0)>0)applyGlow(slotBuf,half,state.glowRadius,state.glowIntensity,{threshold:state.glowThreshold||0,tintR:state.glowTintR!=null?state.glowTintR:1,tintG:state.glowTintG!=null?state.glowTintG:1,tintB:state.glowTintB!=null?state.glowTintB:1,blend:state.glowBlend||"add"});
        applyGlobalAdjust(slotBuf,half,state); // global tone/color after glow
        applyGlobalFiltersPost(slotBuf,half,state.globalLayerFilters||[]); // global FX after glow
        if(state.filters&&state.filters.length)for(var fi2=0;fi2<state.filters.length;fi2++)applyFilter(slotBuf,half,state.filters[fi2]);
        applyMaskToBuf(slotBuf,half,slot.mask||state.mask);
        var ox=offsets[si2][0],oy=offsets[si2][1];
        for(var py=0;py<half;py++)for(var px=0;px<half;px++){var src=(py*half+px)*4,dst=((oy+py)*size+(ox+px))*4;buf[dst]=slotBuf[src];buf[dst+1]=slotBuf[src+1];buf[dst+2]=slotBuf[src+2];buf[dst+3]=slotBuf[src+3];}
      }
    } else {
      renderLayersToBuf(buf,size,resolveGroups(resolveReferences(state.layers),state.layerGroups),null,state.globalLayerFilters||[]);
      // Global post-process only for non-spritesheet mode.
      // In spritesheet mode each slot already had blur/glow/filters/mask applied above.
      var blurR=state.blurRadius||0;
      if(blurR>=1)gaussBlur(buf,size,size,Math.max(1,Math.round(blurR)));
      if((state.glowRadius||0)>0&&(state.glowIntensity||0)>0)applyGlow(buf,size,state.glowRadius,state.glowIntensity,{threshold:state.glowThreshold||0,tintR:state.glowTintR!=null?state.glowTintR:1,tintG:state.glowTintG!=null?state.glowTintG:1,tintB:state.glowTintB!=null?state.glowTintB:1,blend:state.glowBlend||"add"});
      applyGlobalAdjust(buf,size,state); // global tone/color after glow
      applyGlobalFiltersPost(buf,size,state.globalLayerFilters||[]); // global FX after glow
      if(state.filters&&state.filters.length)for(var fi=0;fi<state.filters.length;fi++)applyFilter(buf,size,state.filters[fi]);
      applyMaskToBuf(buf,size,state.mask); // mask LAST
    }
    // Normal map mode: convert the composed height to normals.
    // Normal data is vector data — never sRGB-encode it.
    var doSRGB=state.colorSpace==="srgb";
    if(opts&&opts.normalMap){heightToNormal(buf,size,opts.normalStrength);doSRGB=false;}
    var img=ctx.createImageData(size,size),data=img.data;
    // Anti-banding dither: TPDF noise at +/- (dAmt) LSB applied to the 0..255
    // value before rounding. Triangular PDF = two uniform randoms summed; this
    // is the standard dither that removes visible banding in smooth gradients
    // without adding obvious grain. Normal maps are never dithered (vector data).
    var dAmt=(opts&&opts.normalMap)?0:(state.exportDither!=null?state.exportDither:0);
    if(dAmt>0){
      for(var i=0;i<size*size;i++){
        var r=clamp(buf[i*4]),g=clamp(buf[i*4+1]),b=clamp(buf[i*4+2]),a=clamp(buf[i*4+3]);
        if(doSRGB){r=toSRGB(r);g=toSRGB(g);b=toSRGB(b);}
        // independent TPDF per channel
        var dr=(Math.random()-Math.random())*dAmt, dg=(Math.random()-Math.random())*dAmt, db=(Math.random()-Math.random())*dAmt;
        var da=(Math.random()-Math.random())*dAmt;
        var R=r*255+dr, G=g*255+dg, B=b*255+db, A=a*255+da;
        data[i*4]=R<0?0:R>255?255:R+0.5|0;
        data[i*4+1]=G<0?0:G>255?255:G+0.5|0;
        data[i*4+2]=B<0?0:B>255?255:B+0.5|0;
        data[i*4+3]=A<0?0:A>255?255:A+0.5|0;
      }
    } else {
      for(var i=0;i<size*size;i++){var r=clamp(buf[i*4]),g=clamp(buf[i*4+1]),b=clamp(buf[i*4+2]),a=clamp(buf[i*4+3]);if(doSRGB){r=toSRGB(r);g=toSRGB(g);b=toSRGB(b);}data[i*4]=r*255+0.5|0;data[i*4+1]=g*255+0.5|0;data[i*4+2]=b*255+0.5|0;data[i*4+3]=a*255+0.5|0;}
    }
    ctx.putImageData(img,0,0);
    resolve(c);
  });
}

// ═══ DEFAULTS ═══════════════════════════════════════════════════
var DSP={r1:0.38,r2:0.22,thick:0.08,soft:0.022,freq:6,mortar:0.05,corner:0.5,gearTeeth:6,petalCount:5,rot:0,outline:0};
function mkDist(ov){var b={type:"none",amt:0,freq:3,freqX:null,freqY:null,freqLinked:true,sourceLayerIdx:0,offsetX:0,offsetY:0,falloff:"center",falloffRadius:0.5};if(ov)Object.assign(b,ov);return b;}
var _uidCounter=1;
function newUid(){return "L"+(Date.now().toString(36))+"_"+(_uidCounter++);}
function mkL(idx,seed,ov){
  var base={
    uid:newUid(),
    enabled:idx===0,label:"L"+(idx+1),type:"fbm",fbmBase:"perlin",fbmMode:"normal",
    seed:(seed||42)+idx*1000,scaleX:3.5,scaleY:3.5,scaleLinked:true,    seamless:false,seamlessMode:"math",seamlessBlendW:0.28,
    rotation:0,skewX:0,skewY:0,offsetX:0,offsetY:0,octaves:5,lacunarity:2,gain:0.5,
    worleyMode:"f1",worleyMetric:"euclidean",gradientType:"radial",shapeKind:"circle",
    shapeP:Object.assign({},DSP),warpStr:1.5,warpBase:"perlin",curlScale:5,
    postTX:0,postTY:0,postSX:1,postSY:1,postRot:0,
    layerBlur:0,layerGlow:0,layerGlowIntensity:0.5,
    layerFilters:[],
    curvePoints:DEFAULT_CURVE,
    contrast:1,contrastMode:"power",midpoint:0.5,brightness:0.5,invert:false,
    remapIn0:0,remapIn1:1,steps:0,multiplier:1,outputLo:0,outputHi:1,
    saturation:1,hueShift:0,
    colorA:"#000000",colorB:"#ffffff",colorStops:[{pos:0,color:"#000000"},{pos:1,color:"#ffffff"}],opacity:1,blendMode:"normal",channels:"rgb",
    uvDists:[mkDist()],imageData:null,imageColorMode:"luma",imageBilinear:true,
    flipH:false,flipV:false,mirrorH:false,mirrorV:false,
    waveAmp:0.35,waveWarp:0.5,waveThick:0.06,waveOffset:0,waveFreq:4,
    fiberAngle:0,fiberStretch:12,streakLength:8,streakDensity:4,
    radialTile:false,radialCount:6,radialOffsetX:0,radialOffsetY:0,radialAngleOffset:0,radialRadius:0.25,
    shapeCurvePoints:DEFAULT_CURVE,shapeCurveMode:"smooth",
    shapeWidthCurvePoints:DEFAULT_CURVE,shapeWidthCurveMode:"smooth"
  };
  if(ov){if(ov.uvDistType){base.uvDists=[mkDist({type:ov.uvDistType,amt:ov.uvDistAmt||0,freq:ov.uvDistFreq||3})];delete ov.uvDistType;delete ov.uvDistAmt;delete ov.uvDistFreq;}Object.assign(base,ov);if(!base.uvDists||!base.uvDists.length)base.uvDists=[mkDist()];}
  return base;
}
function mkMask(ov){var b={type:"none",strength:1,radius:0.5,hardness:0,offsetX:0,offsetY:0,scaleX:1,scaleY:1,invert:false,angle:0,apply:"both",uvDistType:"none",uvDistAmt:0,uvDistFreq:3};if(ov)Object.assign(b,ov);return b;}
function mkSlot(idx,seed){return{layers:[mkL(0,(seed||42)+idx*500)],activeLayerIdx:0,mask:mkMask()};}
function mkFilter(type){return{enabled:true,type:type,uvDistType:"none",uvDistAmt:0,uvDistFreq:3,uvDistSeed:9999,centerX:0.5,centerY:0.5,pixelSize:8,dither:0,hue:0,saturation:1,value:1,brightness:0,contrast:1,gamma:1,tintR:1,tintG:1,tintB:1,strength:type==="normalMap"?4:type==="sharpen"?0.5:1,angle:45,levels:4,cutoff:0.5,softness:0.02,blur:3,amount:type==="chromatic"?5:type==="radialBlur"||type==="slopeBlur"?0.3:0,samples:type==="radialBlur"?24:16,caMode:"barrel",slopeMode:"gradient"};}
function mkState(){return{layers:[mkL(0,42)],exportSize:512,exportDither:1,blurRadius:0,colorSpace:"linear",glowRadius:0,glowIntensity:0.5,glowThreshold:0,glowTintR:1,glowTintG:1,glowTintB:1,glowBlend:"add",globalLayerFilters:[],mask:mkMask(),filters:[],spritesheetMode:false,quickActions:[],activeSlotIdx:0,slots:[mkSlot(0,42),mkSlot(1,100),mkSlot(2,200),mkSlot(3,300)],favorites:[],sliderBounds:{},layerGroups:[],_batchVariants:[0,1,2,3],_batchSize:1024};}

// ═══ CONSTANTS ══════════════════════════════════════════════════
// Discrete zoom steps for canvas preview zoom
var ZOOM_STEPS=[0.25,0.5,0.75,1,1.5,2,3,4];

// 8-color palette for layer color coding — used in NoisePanel, quick strip, nav bar
var LC8=["#e8900a","#4ab4ff","#a0e060","#ff6699","#cc88ff","#ffdd44","#44ddcc","#ff8844"];

// Tiny haptic tap on devices that support it (Android Chrome; iOS Safari ignores it).
// Used on slider commit, long-press menu, layer reorder, divider release.
function haptic(ms){
  if(typeof navigator!=="undefined"&&navigator.vibrate){try{navigator.vibrate(ms||10);}catch(e){}}
}

// Default scale/params per noise type (applied on type change)
var TYPE_DEFAULTS={
  perlin:{scaleX:4,scaleY:4},value:{scaleX:4,scaleY:4},simplex:{scaleX:4,scaleY:4},
  fbm:{scaleX:4,scaleY:4,octaves:5},
  domainWarp:{scaleX:3,scaleY:3,warpStr:1.5,warpLevels:1,warp2:0.8,warpMode:"normal"},
  curl:{scaleX:4,scaleY:4,curlScale:5,curlOct:4,curlMode:"magnitude"},
  cloud:{scaleX:4,scaleY:4,octaves:5,gain:0.5,cloudCov:0.5,cloudSoft:0.5,cloudMode:"billow"},
  worley:{scaleX:4,scaleY:4},voronoi:{scaleX:4,scaleY:4},
  crystals:{scaleX:4,scaleY:4,crystalSharp:4,crystalJitter:1,crystalMetric:"manhattan",crystalMode:"facets"},
  iqcell:{scaleX:4,scaleY:4,iqSmooth:0.5,iqSmoothK:0.4,iqMetric:"euclidean",iqJitter:1,iqMode:"smooth",iqContrast:1},
  caustics:{scaleX:4,scaleY:4,octaves:4,gain:0.5,causWarp:1.1,causFold:0.4,causSharp:6,causBright:0.28,causMode:"lines"},
  plasma:{scaleX:10,scaleY:10,plasmaWaves:4,plasmaWarp:0,plasmaMode:"classic"},
  wood:{scaleX:3,scaleY:3,woodRings:8,woodTurb:1.2},
  marble:{scaleX:3,scaleY:3,marbleFreq:3,marbleTurb:4,marbleAngle:0,marbleSharp:1},
  gabor:{scaleX:6,scaleY:6,gaborFreq:3,gaborBW:2,gaborOrient:0,gaborSpread:1,gaborAniso:0,gaborHarm:1,gaborPhase:0},
  dust:{scaleX:48,scaleY:48,dustCoverage:0.4,dustSize:0.4},
  debris:{scaleX:16,scaleY:16,debrisDensity:0.45,debrisSharp:2.5},
  grain:{scaleX:64,scaleY:64,grainRough:0.6,grainContrast:1.6},
  hex:{scaleX:6,scaleY:5,hexMode:"edges",hexThick:0.12,hexJitter:0},
  scratches:{scaleX:8,scaleY:8,scrDensity:0.5,scrLength:0.6,scrThick:0.04,scrAngle:0,scrAngleVar:1,scrTaper:1},
  sparkle:{scaleX:10,scaleY:10,spkDensity:0.4,spkSize:0.4,spkGlow:0.5,spkStreak:0,spkTwinkle:0.6},
  truchet:{scaleX:6,scaleY:6,truThick:0.18,truMode:"arcs"},
  sparse:{scaleX:5,scaleY:5,sparseDens:4,sparseSizeVar:0,sparseIntVar:0,sparseFalloff:"gauss"},
  highpass:{scaleX:5,scaleY:5,hpBlur:0.25},
  directional:{dirScaleX:10,dirScaleY:1},
  waveStroke:{fiberAngle:0,waveAmp:0.35,waveWarp:0.5,waveThick:0.06,waveOffset:0},
  fiber:{fiberAngle:0,fiberStretch:14,octaves:5},
  streaks:{fiberAngle:0,streakLength:10,streakDensity:5,octaves:3},
  crosshatch:{fiberAngle:30,waveFreq:6,waveThick:0.25},
  rippleDir:{fiberAngle:0,waveFreq:6,waveWarp:0.3},
  flowLines:{fiberAngle:0,waveFreq:5,waveWarp:0.8},
  cloud:{scaleX:4,scaleY:4,octaves:5},
  polarScatter:{scaleX:2,scaleY:2,polarCount:6,polarRadius:0.35,polarSpread:0.18},
  scatter:{scaleX:1,scaleY:1,scGrid:4,scDensity:0.85,scSize:0.5,scSizeVar:0.3,scJitter:0.8,scMode:"disc",scShape:"circle",scShapeP:Object.assign({},DSP)},
  slopeGrad:{scaleX:1,scaleY:1,slopeAngle:45},
  white:{scaleX:1,scaleY:1},gaussian:{scaleX:1,scaleY:1},blue:{scaleX:1,scaleY:1},
  gradient:{scaleX:1,scaleY:1},shape:{scaleX:1,scaleY:1},image:{scaleX:1,scaleY:1}
};

// Reorganized: semantically grouped by how they generate patterns
var TG=[
  {label:"GRADIENT",   types:[{id:"perlin",label:"Perlin"},{id:"simplex",label:"Simplex"},{id:"value",label:"Value"}]},
  {label:"FRACTAL",    types:[{id:"fbm",label:"fBm (Normal/Ridged/Billow)"},{id:"cloud",label:"Cloud"},{id:"domainWarp",label:"Domain Warp"},{id:"curl",label:"Curl"}]},
  {label:"DETAIL",     types:[{id:"highpass",label:"Highpass"},{id:"directional",label:"Anisotropic"},{id:"gabor",label:"Gabor"}]},
  {label:"HIGH-FREQ",  types:[{id:"dust",label:"Dust"},{id:"debris",label:"Debris"},{id:"grain",label:"Grain"},{id:"scratches",label:"Scratches"}]},
  {label:"GEOMETRIC",  types:[{id:"hex",label:"Hexagonal"},{id:"truchet",label:"Truchet"},{id:"sparkle",label:"Sparkle"}]},
  {label:"CELLULAR",   types:[{id:"worley",label:"Worley"},{id:"voronoi",label:"Voronoi"},{id:"crystals",label:"Crystals"},{id:"iqcell",label:"IQ Smooth"},{id:"caustics",label:"Caustics"}]},
  {label:"ORGANIC",    types:[{id:"marble",label:"Marble"},{id:"wood",label:"Wood"},{id:"plasma",label:"Plasma"}]},
  {label:"DIRECTIONAL",types:[{id:"fiber",label:"Fiber"},{id:"streaks",label:"Streaks"},{id:"crosshatch",label:"Crosshatch"},{id:"rippleDir",label:"Ripple"},{id:"flowLines",label:"Flow Lines"},{id:"waveStroke",label:"Wave Stroke"}]},
  {label:"SCATTER",    types:[{id:"scatter",label:"Scatter"},{id:"polarScatter",label:"Polar Scatter"},{id:"sparse",label:"Sparse"},{id:"slopeGrad",label:"Slope Gradient"}]},
  {label:"STOCHASTIC", types:[{id:"white",label:"White"},{id:"gaussian",label:"Gaussian"},{id:"blue",label:"Blue"}]},
  {label:"SHAPE",      types:[{id:"gradient",label:"Gradient"},{id:"shape",label:"Shape"}]},
  {label:"IMAGE",      types:[{id:"image",label:"Image"}]}
];
var SHAPES=[
  // Basic
  {id:"circle",l:"Circle"},{id:"ring",l:"Ring"},{id:"box",l:"Square"},
  {id:"rbox",l:"Rounded Rect"},{id:"diamond",l:"Diamond"},{id:"ellipse",l:"Ellipse"},
  {id:"capsule",l:"Capsule"},{id:"moon",l:"Moon"},{id:"cross",l:"Cross"},
  // Polygons
  {id:"tri",l:"Triangle"},{id:"pent",l:"Pentagon"},{id:"hex",l:"Hexagon"},{id:"oct",l:"Octagon"},
  // Stars
  {id:"star4",l:"Star 4pt"},{id:"star5",l:"Star 5pt"},{id:"star6",l:"Star 6pt"},
  // Advanced
  {id:"heart",l:"Heart"},{id:"flower",l:"Flower"},{id:"gear",l:"Gear"},
  {id:"frame",l:"Frame"},{id:"horseshoe",l:"Horseshoe"},{id:"pie",l:"Pie Slice"},
  {id:"egg",l:"Egg"},{id:"vesica",l:"Vesica"},
  // New
  {id:"teardrop",l:"Teardrop"},{id:"arrow",l:"Arrow"},{id:"bolt",l:"Lightning"},
  {id:"hexagram",l:"Hexagram"},{id:"gem",l:"Gem"},{id:"plus",l:"Plus"},
  {id:"burst",l:"Burst"},{id:"shield",l:"Shield"},
  // VFX
  {id:"squircle",l:"Squircle"},{id:"blob",l:"Blob"},{id:"droplet",l:"Droplet"},
  {id:"sun",l:"Sun"},{id:"spark",l:"Sparkle"}
];
var BM=["normal","dissolve","add","screen","lighten","linearDodge","multiply","darken","overlay","softlight","hardlight","difference","exclusion","subtract","divide","max","min"];
var CH=["rgb","r","g","b","a","rg","rb","gb","rgba"],CHL={rgb:"RGB",r:"R",g:"G",b:"B",a:"A",rg:"RG",rb:"RB",gb:"GB",rgba:"RGBA"};
var UVT=[
  {v:"none",l:"None"},
  {v:"layer",l:"Layer Warp"},
  {v:"noise",l:"Perlin Warp"},
  {v:"fbmNoise",l:"fBm Warp"},
  {v:"ridged",l:"Ridged fBm Warp"},
  {v:"turbulence",l:"Turbulence Warp"},
  {v:"voronoi",l:"Voronoi Warp"},
  {v:"radial",l:"Radial Push/Pull"},
  {v:"directional",l:"Directional"},
  {v:"multidirectional",l:"Multidirectional"},
  {v:"swirl",l:"Swirl"},
  {v:"twist",l:"Twist"},
  {v:"pinch",l:"Pinch"},
  {v:"bulge",l:"Bulge"},
  {v:"ripple",l:"Ripple"},
  {v:"fisheye",l:"Fisheye"}
];
var FT=[{v:"edgeDetect",l:"Edge Detect"},{v:"normalMap",l:"Normal Map"},{v:"sharpen",l:"Sharpen"},{v:"emboss",l:"Emboss"},{v:"curvature",l:"Curvature"},{v:"bevel",l:"Bevel"},{v:"posterize",l:"Posterize"},{v:"threshold",l:"Threshold"},{v:"histoEq",l:"Histogram Eq"},{v:"autoLevels",l:"Auto Levels"},{v:"edgeFade",l:"Edge Fade (vignette)"},{v:"grayscale",l:"Grayscale"},{v:"invert",l:"Invert"},{v:"gaussBlur",l:"Gaussian Blur"},{v:"boxBlur",l:"Box Blur"},{v:"directionalBlur",l:"Directional Blur"},{v:"radialBlur",l:"Radial Blur"},{v:"zoomBlur",l:"Zoom Blur"},{v:"spinBlur",l:"Spin Blur"},{v:"slopeBlur",l:"Slope Blur"},{v:"chromatic",l:"Chromatic Aberration"},{v:"fxaa",l:"FXAA (Anti-alias)"},{v:"makeTileable",l:"Make Tileable"},{v:"polarWrap",l:"Polar Transform"},{v:"pixelize",l:"Pixelize"},{v:"quantize",l:"Quantize"},{v:"hueSat",l:"Hue / Saturation"},{v:"brightCon",l:"Brightness / Contrast"},{v:"tint",l:"Tint"}];

// ═══ PERFORMANCE: Drag-resolution downgrade ══════════════════════
// While any slider is being moved, render at 64px (instant).
// When slider is released, render at full requested resolution.
// ── Edit history: recent slider changes, re-editable from a side panel ──
// Each entry is keyed by label so repeated edits to the same control collapse
// into one (most-recent) row. liveRef holds the current onChange + bounds,
// refreshed on every Slider render, so re-editing from the panel always drives
// the real, current control even after re-renders.
var _editHistory=[];           // [{key,label,value,ts}] newest last
var _editLive={};              // key -> {onChange,min,max,step,fmt,value}
var _editHistSubs=[];
var _EDIT_HIST_MAX=12;
function _editHistSub(fn){_editHistSubs.push(fn);return function(){_editHistSubs=_editHistSubs.filter(function(f){return f!==fn;});};}
function _editHistNotify(){for(var i=0;i<_editHistSubs.length;i++)_editHistSubs[i]();}
function _recordEdit(key,label,value){
  // Collapse: drop any existing entry for this key, push newest to the end
  for(var i=_editHistory.length-1;i>=0;i--)if(_editHistory[i].key===key)_editHistory.splice(i,1);
  _editHistory.push({key:key,label:label,value:value,ts:Date.now()});
  if(_editHistory.length>_EDIT_HIST_MAX)_editHistory.shift();
  _editHistNotify();
}

var _isSliderActive = false;       // true while any slider is being dragged
var _sliderEndTimer = null;        // timer to clear the flag after release
var _rafPending = false;           // prevents stacking RAF calls

function _onSliderStart() {
  _isSliderActive = true;
  if (_sliderEndTimer) { clearTimeout(_sliderEndTimer); _sliderEndTimer = null; }
}
function _onSliderEnd(bumpFn) {
  // Short delay so the last onChange value settles before clearing
  if (_sliderEndTimer) clearTimeout(_sliderEndTimer);
  _sliderEndTimer = setTimeout(function() {
    _isSliderActive = false;
    _sliderEndTimer = null;
    // Trigger a full-res re-render now that drag ended
    if (bumpFn) bumpFn();
  }, 80);
}

// ═══ SUPPRESS NUMBER INPUT SPINNERS ══════════════════════════════
// React doesn't support ::webkit-inner-spin-button so we inject CSS once
var _spinnerCSSInjected = false;
function injectSpinnerCSS(){
  if(_spinnerCSSInjected) return;
  _spinnerCSSInjected = true;
  var s = document.createElement("style");
  s.textContent = [
    // ── Number spinners ─────────────────────────────────────
    "input[type=number]::-webkit-inner-spin-button,input[type=number]::-webkit-outer-spin-button{-webkit-appearance:none;margin:0;}",
    "input[type=number]{-moz-appearance:textfield;}",
    // ── Range: strip native appearance completely ────────────
    "input[type=range]{-webkit-appearance:none;appearance:none;outline:none;border:none;background:transparent;cursor:pointer;}",
    // Track WebKit — filled via --fill / --fc custom props set inline
    "input[type=range]::-webkit-slider-runnable-track{height:3px;border-radius:2px;background:linear-gradient(to right,var(--fc,#e8900a) var(--fill,0%),#1c1c1c var(--fill,0%));}",
    // Track Firefox
    "input[type=range]::-moz-range-track{height:3px;border-radius:2px;background:linear-gradient(to right,var(--fc,#e8900a) var(--fill,0%),#1c1c1c var(--fill,0%));}",
    // Thumb WebKit
    "input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:12px;height:12px;border-radius:50%;background:var(--fc,#e8900a);cursor:pointer;margin-top:-4.5px;border:1.5px solid #080808;box-shadow:0 0 0 0px var(--fc,#e8900a);transition:box-shadow 0.15s,transform 0.12s;}",
    "input[type=range]:hover::-webkit-slider-thumb{box-shadow:0 0 0 5px rgba(232,144,10,0.18);}",
    "input[type=range]:active::-webkit-slider-thumb{transform:scale(1.2);box-shadow:0 0 0 7px rgba(232,144,10,0.14);}",
    // Thumb Firefox
    "input[type=range]::-moz-range-thumb{width:12px;height:12px;border-radius:50%;background:var(--fc,#e8900a);cursor:pointer;border:1.5px solid #080808;transition:box-shadow 0.15s;}",
    "input[type=range]::-moz-range-thumb:hover{box-shadow:0 0 0 5px rgba(232,144,10,0.18);}",
    // Touch mode — bigger targets (manual .tm class)
    ".tm input[type=range]{height:30px;padding:0;box-sizing:content-box;}",
    ".tm input[type=range]::-webkit-slider-runnable-track{height:5px;}",
    ".tm input[type=range]::-webkit-slider-thumb{width:26px;height:26px;margin-top:-11px;}",
    ".tm input[type=range]::-moz-range-thumb{width:26px;height:26px;}",
    // AUTOMATIC touch mode: any device whose primary pointer is a finger gets
    // finger-sized controls without having to switch anything on. A 12px thumb
    // is unusable with a fingertip; 26px is the accepted minimum.
    "@media (pointer: coarse){",
    "  input[type=range]{height:32px;padding:0;box-sizing:content-box;}",
    "  input[type=range]::-webkit-slider-runnable-track{height:6px;}",
    "  input[type=range]::-webkit-slider-thumb{width:28px;height:28px;margin-top:-11px;}",
    "  input[type=range]::-moz-range-thumb{width:28px;height:28px;}",
    "  input[type=range]::-moz-range-track{height:6px;}",
    "  input[type=color]{min-width:40px;min-height:32px;}",
    "  input[type=text],input[type=number],textarea,select{min-height:36px;font-size:12px;}",
    "  button{min-height:30px;}",
    "}",
    // Touch devices have no hover: make the :active state the visible feedback.
    "@media (hover: none){",
    "  button:active{filter:brightness(1.55);transform:scale(0.94);}",
    "  input[type=range]:active::-webkit-slider-thumb{transform:scale(1.15);}",
    "}",
    // ── Buttons ─────────────────────────────────────────────
    "button{transition:filter 0.07s,transform 0.07s;}",
    "button:active{filter:brightness(1.45);transform:scale(0.93);}",
    // ── Scrollbar ───────────────────────────────────────────
    "::-webkit-scrollbar{width:3px;height:3px;}",
    "::-webkit-scrollbar-track{background:transparent;}",
    "::-webkit-scrollbar-thumb{background:#1e1e1e;border-radius:3px;}",
    "::-webkit-scrollbar-thumb:hover{background:#2c2c2c;}",
    "::-webkit-scrollbar-button{display:none;height:0;width:0;}",
    "::-webkit-scrollbar-corner{background:transparent;}",
    "*{scrollbar-width:thin;scrollbar-color:#1e1e1e transparent;}",
    // ── Select ──────────────────────────────────────────────
    "select:focus{outline:1px solid rgba(232,144,10,0.3);}",
  ].join("");
  document.head.appendChild(s);
}

// ═══ NODE GRAPH ENGINE ═══════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════
// NODE GRAPH ENGINE (standalone, testable)
// ───────────────────────────────────────────────────────────────────────
// A node graph is a DAG. Each node has typed input ports and one output.
// Output of every node is a Float32Array buffer of size*size*4 (RGBA, 0..1),
// the same format renderLayersToBuf already produces, so node types can reuse
// the existing noise/filter engine directly.
//
// This file is pure logic: no React, no DOM. It can be imported in a test
// harness. When wired into TexGen, the same functions live inside the bundle.
// ═══════════════════════════════════════════════════════════════════════

// ── ID generation ──────────────────────────────────────────────────────
var _nodeUidCounter = 1;
function newNodeId() { return "n" + (Date.now().toString(36)) + "_" + (_nodeUidCounter++); }
function newEdgeId() { return "e" + (Date.now().toString(36)) + "_" + (_nodeUidCounter++); }

// ── Node type registry ─────────────────────────────────────────────────
// Each node type declares: inputs (array of port names), a category, and an
// "eval" contract documented per-type. eval is supplied by the host (TexGen)
// because it needs the render engine; the engine here only orchestrates.
//
// inputs: list of input port ids (strings). Output is always a single buffer.
// params: default parameter object for a fresh node of this type.
//
// ── HOW TO ADD A NEW NODE TYPE (4 steps) ─────────────────────────────────
//   1. Add an entry here in NODE_TYPES: { cat, inputs, title, params }.
//   2. Add an evaluator in NODE_EVALUATORS (type -> fn(node,inputs,size)->buffer).
//   3. Add it to NODE_META + NODE_CATEGORIES (inside NodeCanvas) for palette/colour.
//   4. Add a panel branch in buildNodePanel (small overlay) OR, for big panels,
//      route it through the side panel like source/filter. That's it.
// Save/load, export, thumbnails, auto-connect and the menu all pick it up
// automatically from the registry — no other wiring needed.
var NODE_TYPES = {
  // SOURCES (no inputs) — produce a buffer from parameters
  source: { cat: "source", inputs: [], title: "Source", params: { layer: null } },
  // OUTPUT (one input) — the graph's final result; exactly one should exist
  output: { cat: "output", inputs: ["in"], title: "Output", params: {} },
  // BLEND (two inputs) — combine A over B with a blend mode + opacity
  blend: { cat: "combine", inputs: ["a", "b"], title: "Blend", params: { mode: "normal", opacity: 1 } },
  // ADJUST (one input) — brightness/contrast/invert on the incoming buffer
  adjust: { cat: "filter", inputs: ["in"], title: "Adjust", params: { brightness: 0, contrast: 1, saturation: 1, hue: 0, gamma: 1, invert: false } },
  // MASK (three inputs) — pick A or B per-pixel by a mask buffer's luminance
  mask: { cat: "combine", inputs: ["a", "b", "mask"], title: "Mask Mix", params: { invertMask: false, maskContrast: 1 } },
  // BLUR (one input) — gaussian blur the incoming buffer
  blur: { cat: "filter", inputs: ["in"], title: "Blur", params: { radius: 3 } },
  // GLOW (one input) — bloom/glow on bright areas
  glow: { cat: "filter", inputs: ["in"], title: "Glow", params: { radius: 8, intensity: 0.8, threshold: 0.5 } },
  // GRADIENT MAP (one input) — remap luminance to a two-colour gradient
  gradmap: { cat: "filter", inputs: ["in"], title: "Gradient Map", params: { colorA: "#000000", colorB: "#ff8800", colorMid: null, useStops: false, colorStops: [{pos:0,color:"#000000"},{pos:0.5,color:"#ff4400"},{pos:1,color:"#ffee88"}] } },
  // FILTER (one input) — a stack of any of the 29 layer filters, applied in order
  filter: { cat: "filter", inputs: ["in"], title: "Filter", params: { filters: [] } },
  // WARP (one input) — UV distortion / domain warp
  warp: { cat: "warp", inputs: ["in"], title: "Warp", params: { warpType: "fbmNoise", amount: 0.1, freq: 3, seed: 1234 } },
  // TRANSFORM (one input) — scale / rotate / offset / mirror / tiling
  transform: { cat: "warp", inputs: ["in"], title: "Transform", params: { scale: 1, rotate: 0, offsetX: 0, offsetY: 0, mirrorX: false, mirrorY: false, tile: 1, sampling: "linear" } },
  // ALPHA MERGE (two inputs) — RGB from "rgb", alpha channel from "alpha" input's luminance
  alphaMerge: { cat: "channel", inputs: ["rgb", "alpha"], title: "Alpha Merge", params: {} },
  // ALPHA SPLIT (one input) — output a channel as a grayscale image (alpha or luminance)
  alphaSplit: { cat: "channel", inputs: ["in"], outputs: ["rgb","r","g","b","a"], title: "Alpha Split", params: {} },
  // FLIPBOOK (no inputs) — plays an imported sprite sheet; outputs the current frame
  flipbook: { cat: "source", inputs: [], title: "Flipbook", params: { sheet: null, cols: 5, rows: 5, fps: 24, offset: 0, frameStep: 1, playMode: "forward", rangeIn: 0, rangeOut: 24, playing: true } },
  // FLIPBOOK PACK (one input) — re-tiles all processed frames back into a sprite sheet
  flipbookPack: { cat: "output", inputs: ["in"], title: "Flipbook Pack", params: { cols: 5, rows: 5 } },
  // REROUTE — a tiny pass-through node just for organizing wires visually.
  reroute: { cat: "channel", inputs: ["in"], title: "Reroute", params: {} },
  levels: { cat: "adjust", inputs: ["in"], title: "Levels", params: { inBlack:0, inWhite:1, gamma:1, outBlack:0, outWhite:1 } },
  threshold: { cat: "adjust", inputs: ["in"], title: "Threshold", params: { level:0.5, softness:0 } },
  posterize: { cat: "adjust", inputs: ["in"], title: "Posterize", params: { levels:4 } },
  sharpen: { cat: "filter", inputs: ["in"], title: "Sharpen", params: { amount:1 } },
  emboss: { cat: "filter", inputs: ["in"], title: "Emboss", params: { amount:1, angle:45 } },
  normalmap: { cat: "filter", inputs: ["in"], title: "Normal Map", params: { strength:2 } },
  pixelate: { cat: "retro", inputs: ["in"], title: "Pixelate", params: { blockSize:8, mode:"average" } },
  palette: { cat: "retro", inputs: ["in"], title: "Palette", params: { palette:"gameboy", dither:0 } },
  outline: { cat: "retro", inputs: ["in"], title: "Outline", params: { source:"alpha", threshold:0.5, thickness:1, color:"#000000", mode:"outer" } },
  scanlines: { cat: "retro", inputs: ["in"], title: "Scanlines", params: { spacing:3, darkness:0.4, thickness:1, rgbMask:false, vignette:0 } },
  text: { cat: "source", inputs: [], title: "Text", params: { text:"TEXT", fontFamily:"monospace", fontSize:24, bold:true, italic:false, align:"center", x:0.5, y:0.5, color:"#ffffff", bgColor:"#000000", transparent:false, letterSpacing:0 } },
  morph: { cat: "filter", inputs: ["in"], title: "Expand / Shrink", params: { amount:1, source:"alpha", shape:"diamond" } },
  edgedetect: { cat: "filter", inputs: ["in"], title: "Edge Detect", params: { method:"sobel", amount:1, threshold:0, overlay:false, invert:false, color:"#ffffff" } },
  island: { cat: "filter", inputs: ["in"], title: "Island / Fill", params: { mode:"colorize", source:"luma", threshold:0.5, minSize:8, connectivity:4 } },
  colorgrade: { cat: "adjust", inputs: ["in"], title: "Master Color", params: { exposure:0, contrast:1, lift:0, gamma:1, gain:1, temperature:0, tint:0, saturation:1, vibrance:0, hueShift:0 } },
  shape: { cat: "source", inputs: [], title: "Shape", params: { shape:"circle", size:0.6, x:0.5, y:0.5, rotation:0, sides:5, inner:0.5, thickness:0.3, feather:0.01, aspect:1, invert:false, transparent:false, color:"#ffffff", bgColor:"#000000" } },
  gradient: { cat: "source", inputs: [], title: "Gradient", params: { gradType:"linear", angle:0, x:0.5, y:0.5, scale:1, repeat:1, mirror:false, invert:false, colorA:"#000000", colorB:"#ffffff" } },
  checker: { cat: "source", inputs: [], title: "Checker", params: { tilesX:8, tilesY:8, colorA:"#000000", colorB:"#ffffff" } },
  stripes: { cat: "source", inputs: [], title: "Stripes", params: { count:8, angle:0, width:0.5, softness:0, colorA:"#000000", colorB:"#ffffff" } },
  bricks: { cat: "source", inputs: [], title: "Bricks", params: { cols:4, rows:8, mortar:0.06, offset:0.5, bevel:0.1, colorA:"#ffffff", colorB:"#000000" } },
  mirror: { cat: "warp", inputs: ["in"], title: "Mirror", params: { mode:"x" } },
  offsetnode: { cat: "warp", inputs: ["in"], title: "Offset", params: { offsetX:0.5, offsetY:0.5 } },
  dirblur: { cat: "filter", inputs: ["in"], title: "Directional Blur", params: { angle:0, length:8, samples:12, wrap:false } },
  radialblur: { cat: "filter", inputs: ["in"], title: "Radial Blur", params: { mode:"zoom", amount:0.2, samples:12, x:0.5, y:0.5 } },
  vignette: { cat: "filter", inputs: ["in"], title: "Vignette", params: { amount:0.6, radius:0.75, softness:0.45, roundness:1, x:0.5, y:0.5, color:"#000000" } },
  mathnode: { cat: "combine", inputs: ["a","b"], title: "Math", params: { op:"add", factor:1, clamp:true } },
  mix: { cat: "combine", inputs: ["a","b","mask"], title: "Mix", params: { factor:0.5, useMask:true, invertMask:false } },
  polar: { cat: "warp", inputs: ["in"], title: "Polar", params: { mode:"toPolar", x:0.5, y:0.5, spin:0, zoom:1, repeat:1 } }
};

// ── Graph factory ──────────────────────────────────────────────────────
function mkGraph() {
  return { nodes: {}, edges: {}, version: 1 };
}

// Node: { id, type, x, y, params }
function mkNode(type, x, y, params) {
  var def = NODE_TYPES[type];
  if (!def) throw new Error("Unknown node type: " + type);
  var p = {};
  // deep-ish copy of defaults
  var dp = def.params || {};
  for (var k in dp) p[k] = dp[k];
  if (params) for (var k2 in params) p[k2] = params[k2];
  return { id: newNodeId(), type: type, x: x || 0, y: y || 0, params: p };
}

// Edge: { id, from: nodeId, to: nodeId, toPort: portId }
// (output port is implicit — every node has exactly one output)
function mkEdge(fromId, toId, toPort, fromPort) {
  return { id: newEdgeId(), from: fromId, to: toId, toPort: toPort, fromPort: fromPort || "out" };
}

function addNode(g, node) { g.nodes[node.id] = node; return node; }
function removeNode(g, nodeId) {
  delete g.nodes[nodeId];
  // drop any edges touching this node
  for (var eid in g.edges) {
    var e = g.edges[eid];
    if (e.from === nodeId || e.to === nodeId) delete g.edges[eid];
  }
}

// Connect, refusing duplicates on the same input port and self-loops.
// Returns the edge, or null if rejected (e.g. would create a cycle).
function connect(g, fromId, toId, toPort, fromPort) {
  if (fromId === toId) return null;                 // no self-loop
  if (!g.nodes[fromId] || !g.nodes[toId]) return null;
  var def = NODE_TYPES[g.nodes[toId].type];
  if (!def || def.inputs.indexOf(toPort) === -1) return null; // invalid port
  // An input port holds at most one connection: remove any existing.
  for (var eid in g.edges) {
    var e = g.edges[eid];
    if (e.to === toId && e.toPort === toPort) delete g.edges[eid];
  }
  var edge = mkEdge(fromId, toId, toPort, fromPort);
  g.edges[edge.id] = edge;
  // Cycle check: if adding this created a cycle, roll back.
  if (hasCycle(g)) { delete g.edges[edge.id]; return null; }
  return edge;
}

function disconnect(g, edgeId) { delete g.edges[edgeId]; }

// Return the edge feeding a given input port, or null.
function incomingEdge(g, nodeId, port) {
  for (var eid in g.edges) {
    var e = g.edges[eid];
    if (e.to === nodeId && e.toPort === port) return e;
  }
  return null;
}

// ── Cycle detection (DFS with colour marks) ────────────────────────────
function hasCycle(g) {
  var WHITE = 0, GRAY = 1, BLACK = 2;
  var color = {};
  for (var id in g.nodes) color[id] = WHITE;
  // adjacency: from -> [to...]
  var adj = {};
  for (var nid in g.nodes) adj[nid] = [];
  for (var eid in g.edges) { var e = g.edges[eid]; if (adj[e.from]) adj[e.from].push(e.to); }
  var stack = [];
  function dfs(u) {
    // iterative DFS to avoid blowing the call stack on big graphs
    stack.push({ u: u, i: 0 });
    color[u] = GRAY;
    while (stack.length) {
      var top = stack[stack.length - 1];
      var neighbours = adj[top.u] || [];
      if (top.i < neighbours.length) {
        var v = neighbours[top.i++];
        if (color[v] === GRAY) return true;       // back-edge → cycle
        if (color[v] === WHITE) { color[v] = GRAY; stack.push({ u: v, i: 0 }); }
      } else {
        color[top.u] = BLACK;
        stack.pop();
      }
    }
    return false;
  }
  for (var sid in g.nodes) {
    if (color[sid] === WHITE) { if (dfs(sid)) return true; }
  }
  return false;
}

// ── Topological order (Kahn's algorithm) ───────────────────────────────
// Returns an array of node ids in evaluation order, or null if cyclic.
function topoOrder(g) {
  var indeg = {};
  for (var id in g.nodes) indeg[id] = 0;
  var adj = {};
  for (var nid in g.nodes) adj[nid] = [];
  for (var eid in g.edges) {
    var e = g.edges[eid];
    if (g.nodes[e.from] && g.nodes[e.to]) { adj[e.from].push(e.to); indeg[e.to]++; }
  }
  var queue = [];
  for (var i in indeg) if (indeg[i] === 0) queue.push(i);
  var order = [];
  while (queue.length) {
    var u = queue.shift();
    order.push(u);
    var nb = adj[u] || [];
    for (var k = 0; k < nb.length; k++) {
      if (--indeg[nb[k]] === 0) queue.push(nb[k]);
    }
  }
  // If we didn't cover every node, there is a cycle.
  var total = 0; for (var c in g.nodes) total++;
  if (order.length !== total) return null;
  return order;
}

// ── Evaluation ─────────────────────────────────────────────────────────
// evalNode(node, inputs, size) -> Float32Array buffer. Supplied by the host so
// it can reach the render engine. `inputs` is a map portId -> buffer (or null).
//
// evaluate() walks the graph in topo order, caching each node's output buffer,
// and returns the buffer of the (single) output node, or null.
// ── Keyframe animation ──────────────────────────────────────────────
// A node may carry node.anim = { paramKey: [{t,v}, ...] } where t is time in
// seconds and v the value. Keyframes are kept sorted by t. Values interpolate
// linearly (numbers) or step (non-numbers like strings/booleans).
function sampleKeyframes(kfs, t){
  if(!kfs||!kfs.length)return undefined;
  if(t<=kfs[0].t)return kfs[0].v;
  if(t>=kfs[kfs.length-1].t)return kfs[kfs.length-1].v;
  for(var i=0;i<kfs.length-1;i++){
    var k0=kfs[i],k1=kfs[i+1];
    if(t>=k0.t&&t<=k1.t){
      var span=k1.t-k0.t, f=span>0?(t-k0.t)/span:0;
      if(typeof k0.v==="number"&&typeof k1.v==="number")return k0.v+(k1.v-k0.v)*f;
      return f<1?k0.v:k1.v; // step for non-numeric
    }
  }
  return kfs[kfs.length-1].v;
}
// Does this graph have ANY keyframes? (cheap early-out for the static case.)
function graphHasAnim(g){
  for(var nid in g.nodes){var a=g.nodes[nid].anim; if(a){for(var k in a){if(a[k]&&a[k].length)return true;}}}
  return false;
}
// Return a node whose animated params are resolved at time t. If the node has no
// animation, the original node is returned unchanged (no allocation).
function resolveAnimNode(node, t){
  var a=node.anim; if(!a)return node;
  var anyActive=false; for(var k in a){if(a[k]&&a[k].length){anyActive=true;break;}}
  if(!anyActive)return node;
  var params=Object.assign({},node.params);
  for(var key in a){
    var kfs=a[key]; if(!kfs||!kfs.length)continue;
    var v=sampleKeyframes(kfs,t);
    if(v!==undefined)params[key]=v;
  }
  return {id:node.id,type:node.type,x:node.x,y:node.y,params:params,anim:a};
}

function evaluate(g, size, evalNode, time) {
  var order = topoOrder(g);
  if (!order) return { error: "cycle", buffer: null };
  var animated = (time!=null) && graphHasAnim(g);
  var cache = {};
  var sigs = {};   // node id -> signature, used to key the memo cache
  // Read a node's output buffer for a given output port. Evaluators may return
  // either a single Float32Array (the implicit "out" port) or an object mapping
  // output-port name -> buffer (multi-output nodes like Alpha Split).
  function readOut(nodeId, port){
    var c = cache[nodeId];
    if (c == null) return null;
    if (c && c.buffer && c.length != null) return c;        // a typed array → the single "out"
    if (c && typeof c === "object") return c[port||"out"] || c.out || null; // multi-output map
    return c;
  }
  for (var i = 0; i < order.length; i++) {
    var node = g.nodes[order[i]];
    if (animated) node = resolveAnimNode(node, time); // apply keyframes at time t
    var def = NODE_TYPES[node.type];
    var inputs = {};
    var inSigs = [];
    for (var pi = 0; pi < def.inputs.length; pi++) {
      var port = def.inputs[pi];
      var e = incomingEdge(g, node.id, port);
      inputs[port] = e ? readOut(e.from, e.fromPort) : null;
      inSigs.push(e ? (sigs[e.from]||"?")+":"+(e.fromPort||"out") : "_");
    }
    // Bypass/mute: a bypassed node passes its first input straight through
    // (or a black buffer if it has no inputs). Output nodes are never bypassed.
    if (node.bypass && def.inputs.length && def.cat !== "output") {
      cache[node.id] = inputs[def.inputs[0]] || new Float32Array(size*size*4);
      sigs[node.id] = nodeSignature(node, size, inSigs);
    } else {
      var sig = _evalCacheOn ? nodeSignature(node, size, inSigs) : null;
      if (sig && Object.prototype.hasOwnProperty.call(_evalCache, sig)) {
        cache[node.id] = _evalCache[sig];   // unchanged branch: reuse the result
      } else {
        cache[node.id] = evalNode(node, inputs, size);
        if (sig) _cachePut(sig, cache[node.id]);
      }
      sigs[node.id] = sig || ("u"+node.id+"_"+(_uncachedTick++));
    }
  }
  // primaryBuffer(nodeId): the buffer to show as a node's thumbnail / preview.
  function primaryBuffer(nodeId){ return readOut(nodeId, "out") || (function(){var c=cache[nodeId]; if(c&&typeof c==="object"&&!(c.buffer&&c.length!=null)){for(var k in c)return c[k];} return c;})(); }
  // build a flat cache of primary buffers for thumbnails (keeps drawNodeThumbs simple)
  var flat = {};
  for (var nid in cache) flat[nid] = primaryBuffer(nid);
  // find the output node (first of type "output" or "flipbookPack")
  for (var oid in g.nodes) {
    if (g.nodes[oid].type === "output" || g.nodes[oid].type === "flipbookPack") return { error: null, buffer: flat[oid] || null, cache: flat, rawCache: cache };
  }
  return { error: "no-output", buffer: null, cache: flat, rawCache: cache };
}

// Re-tile every processed frame into a sprite sheet. For a flipbookPack node,
// finds the upstream flipbook node, then for each frame: sets the flipbook's
// offset to that frame, evaluates the graph up to the pack's input, and draws
// the result into the grid. Returns a single packed buffer (cols*frameSize wide).
// evalNodeFactory(size) builds the per-size evaluator (so frames render at frameSize).
function bakeFlipbook(g, packId, evalNodeFactory){
  var pack=g.nodes[packId]; if(!pack)return null;
  // locate the upstream flipbook node (search the whole graph; first one found)
  var fbNode=null;
  for(var nid in g.nodes){ if(g.nodes[nid].type==="flipbook"){fbNode=g.nodes[nid];break;} }
  if(!fbNode||!fbNode.params.sheet||!fbNode.params.sheet.frames.length)return null;
  var sheet=fbNode.params.sheet;
  var cols=Math.max(1,Math.round(pack.params.cols||sheet.cols||1));
  var rows=Math.max(1,Math.round(pack.params.rows||sheet.rows||1));
  var frameSize=sheet.frameSize;
  var seq=fbSequence({totalFrames:sheet.frames.length,
    rangeIn:fbNode.params.rangeIn,rangeOut:fbNode.params.rangeOut,
    frameStep:fbNode.params.frameStep,playMode:fbNode.params.playMode});
  if(!seq.length)seq=[0];
  var nFrames=Math.min(seq.length,cols*rows);
  var sheetW=cols*frameSize, sheetH=rows*frameSize;
  var out=new Float32Array(sheetW*sheetH*4);
  var evalNode=evalNodeFactory(frameSize);
  // edge feeding the pack node
  var inEdge=incomingEdge(g,packId,"in");
  var savedOffset=fbNode.params.offset;
  for(var f=0;f<nFrames;f++){
    fbNode.params.offset=f; // flipbook resolves seq[f] internally via offset
    var res=evaluate(g,frameSize,evalNode);
    var frameBuf=inEdge?(res.cache[inEdge.from]||null):null;
    if(!frameBuf)continue;
    var col=f%cols, row=(f/cols)|0;
    var ox=col*frameSize, oy=row*frameSize;
    for(var y=0;y<frameSize;y++){
      for(var x=0;x<frameSize;x++){
        var si=(y*frameSize+x)*4;
        var di=((oy+y)*sheetW+(ox+x))*4;
        out[di]=frameBuf[si];out[di+1]=frameBuf[si+1];out[di+2]=frameBuf[si+2];out[di+3]=frameBuf[si+3];
      }
    }
  }
  fbNode.params.offset=savedOffset;
  return {buffer:out, width:sheetW, height:sheetH, cols:cols, rows:rows, frameSize:frameSize, frames:nFrames};
}

// Bake the KEYFRAME ANIMATION into a sprite sheet: evaluate the graph at N
// evenly spaced times across the duration and tile the frames into a grid.
// This is what turns a keyframed graph into a usable flipbook asset.
function bakeTimeline(g, opts, evalNodeFactory){
  opts=opts||{};
  var cols=Math.max(1,Math.round(opts.cols||5));
  var rows=Math.max(1,Math.round(opts.rows||5));
  var frames=Math.max(1,Math.round(opts.frames||(cols*rows)));
  frames=Math.min(frames,cols*rows);
  var frameSize=Math.max(1,Math.round(opts.frameSize||128));
  var dur=opts.duration>0?opts.duration:1;
  // find the output node to read the finished frame from
  var outId=null;
  for(var nid in g.nodes){ if(g.nodes[nid].type==="output"){outId=nid;break;} }
  if(!outId)return null;
  var sheetW=cols*frameSize, sheetH=rows*frameSize;
  var out=new Float32Array(sheetW*sheetH*4);
  var evalNode=evalNodeFactory(frameSize);
  for(var f=0;f<frames;f++){
    // last frame lands just before the loop point so the cycle is seamless
    var t=(frames>1)?(f/frames)*dur:0;
    var res=evaluate(g,frameSize,evalNode,t);
    var frameBuf=res&&res.cache?res.cache[outId]:null;
    if(!frameBuf)continue;
    var col=f%cols, row=(f/cols)|0;
    var ox=col*frameSize, oy=row*frameSize;
    for(var y=0;y<frameSize;y++)for(var x=0;x<frameSize;x++){
      var si=(y*frameSize+x)*4;
      var di=((oy+y)*sheetW+(ox+x))*4;
      out[di]=frameBuf[si];out[di+1]=frameBuf[si+1];out[di+2]=frameBuf[si+2];out[di+3]=frameBuf[si+3];
    }
  }
  return {buffer:out, width:sheetW, height:sheetH, cols:cols, rows:rows, frameSize:frameSize, frames:frames};
}

// ── Evaluation memoisation ────────────────────────────────────────
// Re-evaluating the whole graph for every slider nudge is wasteful: only the
// touched branch actually changes. Each node gets a signature built from its
// type, params, bypass flag, the render size and the signatures of its inputs,
// so an unchanged branch is served straight from the cache.
// Safety: no evaluator writes into its input buffer (they all allocate or copy
// first), so sharing a cached buffer between calls is safe. The eval_cache
// tests assert cached output is byte-identical to uncached output.
var _evalCache={}, _evalCacheKeys=[], EVAL_CACHE_MAX=140, _uncachedTick=0;
var _evalCacheOn=true;
function clearEvalCache(){ _evalCache={}; _evalCacheKeys=[]; _evalCacheBytes=0; }
function setEvalCacheEnabled(on){ _evalCacheOn=!!on; if(!on)clearEvalCache(); }
// Cheap but strong signature for a value that may be a typed array or ImageData.
function _bulkSig(arr){
  var n=arr.length, step=n>4096?Math.floor(n/4096):1, h=2166136261, cnt=0;
  for(var i=0;i<n;i+=step){
    var v=arr[i];
    // fold the float bits into the hash
    h^=(typeof v==="number"?(v*8191)|0:0); h=(h*16777619)>>>0; cnt++;
  }
  return "b"+n+"_"+h+"_"+cnt;
}
function _paramSig(v,depth){
  if(v==null)return "~";
  var t=typeof v;
  if(t==="number"||t==="boolean")return ""+v;
  if(t==="string")return v.length>64?("s"+v.length+"_"+v.slice(0,32)):v;
  if(t==="function")return "fn";
  if((depth||0)>6)return "deep";
  if(v.length!=null&&v.buffer)return _bulkSig(v);              // typed array
  if(typeof ImageData!=="undefined"&&v instanceof ImageData)return "img"+v.width+"x"+v.height+"_"+_bulkSig(v.data);
  if(v.data&&v.width!=null&&v.height!=null&&v.data.length!=null)return "img"+v.width+"x"+v.height+"_"+_bulkSig(v.data);
  if(Array.isArray(v)){
    var parts=[]; for(var i=0;i<v.length;i++)parts.push(_paramSig(v[i],(depth||0)+1));
    return "["+parts.join(",")+"]";
  }
  var keys=Object.keys(v).sort(), ps=[];
  for(var k=0;k<keys.length;k++)ps.push(keys[k]+":"+_paramSig(v[keys[k]],(depth||0)+1));
  return "{"+ps.join(",")+"}";
}
function nodeSignature(node,size,inputSigs){
  return node.type+"|"+size+"|"+(node.bypass?"B":"-")+"|"+_paramSig(node.params,0)+"|"+inputSigs.join("+");
}
// Evict by BYTES, not entry count: one 256px frame is 1MB, so a fixed entry
// count would blow the memory budget on a phone at high resolutions.
var EVAL_CACHE_BYTES_MAX=48*1024*1024, _evalCacheBytes=0;
function _valBytes(v){
  if(!v)return 0;
  if(v.length!=null&&v.BYTES_PER_ELEMENT)return v.length*v.BYTES_PER_ELEMENT;
  if(typeof v==="object"){ var t=0; for(var k in v){var e=v[k]; if(e&&e.length!=null&&e.BYTES_PER_ELEMENT)t+=e.length*e.BYTES_PER_ELEMENT;} return t; }
  return 0;
}
function _cachePut(sig,val){
  var bytes=_valBytes(val);
  if(bytes>EVAL_CACHE_BYTES_MAX)return;            // single result too big to cache
  if(!_evalCache[sig]){ _evalCacheKeys.push(sig); } else { _evalCacheBytes-=_valBytes(_evalCache[sig]); }
  _evalCache[sig]=val; _evalCacheBytes+=bytes;
  while(_evalCacheKeys.length&&(_evalCacheKeys.length>EVAL_CACHE_MAX||_evalCacheBytes>EVAL_CACHE_BYTES_MAX)){
    var k=_evalCacheKeys.shift();
    _evalCacheBytes-=_valBytes(_evalCache[k]);
    delete _evalCache[k];
  }
  if(_evalCacheBytes<0)_evalCacheBytes=0;
}

// ══ READY-MADE GRAPHS ═════════════════════════════════════════════
// Complete node graphs you can drop in and export straight away, or take apart
// to see how an effect is built. A node spec with `noise` becomes a Source
// layer; everything else is a plain node with its params overridden.
var GRAPH_PRESETS = [
  { name:"Lens Flare", cat:"VFX", hint:"Anamorphic streaks over a hot core",
    nodes:[
      {id:"ray",  type:"stripes",  x:60,  y:40,  params:{count:26,angle:90,width:0.10,softness:0.06,colorA:"#000000",colorB:"#ffffff"}},
      {id:"pol",  type:"polar",    x:250, y:40,  params:{mode:"toPolar",zoom:1,repeat:1}},
      {id:"fade", type:"gradient", x:250, y:210, params:{gradType:"radial",scale:1,colorA:"#ffffff",colorB:"#000000"}},
      {id:"mul",  type:"mathnode", x:440, y:120, params:{op:"multiply",factor:1}},
      {id:"core", type:"shape",    x:440, y:290, params:{shape:"circle",size:0.16,feather:0.30,color:"#ffffff",bgColor:"#000000"}},
      {id:"add",  type:"mathnode", x:620, y:200, params:{op:"screen",factor:1}},
      {id:"glow", type:"glow",     x:800, y:200, params:{radius:22,intensity:1.1,threshold:0.25}},
      {id:"col",  type:"colorgrade",x:960,y:200, params:{exposure:0.25,contrast:1.15,temperature:0.35,saturation:1.3}},
      {id:"am", type:"alphaMerge", x:1130, y:340, params:{}},
      {id:"out",  type:"output",   x:1310,y:200, params:{}}
    ],
    edges:[["ray","pol","in"],["pol","mul","a"],["fade","mul","b"],["mul","add","a"],["core","add","b"],
           ["add","glow","in"],["glow","col","in"],["col","am","rgb"],["col","am","alpha"],["am","out","in"]] },

  { name:"Light Flash", cat:"VFX", hint:"Blown-out burst with a soft halo",
    nodes:[
      {id:"g",   type:"gradient",  x:60,  y:60,  params:{gradType:"radial",scale:0.9,colorA:"#ffffff",colorB:"#000000"}},
      {id:"lv",  type:"levels",    x:250, y:60,  params:{inBlack:0.0,inWhite:0.55,gamma:0.55}},
      {id:"ray", type:"stripes",   x:60,  y:250, params:{count:40,angle:90,width:0.06,softness:0.10,colorA:"#000000",colorB:"#ffffff"}},
      {id:"pol", type:"polar",     x:250, y:250, params:{mode:"toPolar"}},
      {id:"rf",  type:"mathnode",  x:440, y:250, params:{op:"multiply",factor:1}},
      {id:"gf",  type:"gradient",  x:250, y:400, params:{gradType:"radial",scale:0.7,colorA:"#ffffff",colorB:"#000000"}},
      {id:"mix", type:"mathnode",  x:620, y:150, params:{op:"screen",factor:0.75}},
      {id:"gl",  type:"glow",      x:790, y:150, params:{radius:26,intensity:1.3,threshold:0.15}},
      {id:"am", type:"alphaMerge", x:960, y:290, params:{}},
      {id:"out", type:"output",    x:1140, y:150, params:{}}
    ],
    edges:[["g","lv","in"],["ray","pol","in"],["pol","rf","a"],["gf","rf","b"],
           ["lv","mix","a"],["rf","mix","b"],["mix","gl","in"],["gl","am","rgb"],["gl","am","alpha"],["am","out","in"]] },

  { name:"Shockwave Ring", cat:"VFX", hint:"Expanding ring with a rippled edge",
    nodes:[
      {id:"r",  type:"shape",  x:60,  y:60, params:{shape:"ring",size:0.86,inner:0.80,feather:0.10,color:"#ffffff",bgColor:"#000000"}},
      {id:"w",  type:"warp",   x:250, y:60, params:{warpType:"fbmNoise",amount:0.045,freq:7,seed:99}},
      {id:"b",  type:"blur",   x:430, y:60, params:{radius:4}},
      {id:"gl", type:"glow",   x:600, y:60, params:{radius:16,intensity:1.0,threshold:0.2}},
      {id:"c",  type:"colorgrade",x:770,y:60,params:{temperature:-0.3,saturation:1.2,exposure:0.2}},
      {id:"am", type:"alphaMerge", x:940, y:200, params:{}},
      {id:"o",  type:"output", x:1120, y:60, params:{}}
    ],
    edges:[["r","w","in"],["w","b","in"],["b","gl","in"],["gl","c","in"],["c","am","rgb"],["c","am","alpha"],["am","o","in"]] },

  { name:"Smoke Plume", cat:"VFX", hint:"Soft billowing smoke with alpha",
    nodes:[
      {id:"n",  type:"source", x:60,  y:60, noise:{type:"fbm",fbmBase:"perlin",scaleX:3,scaleY:3,octaves:6,gain:0.55}, seed:7},
      {id:"w",  type:"warp",   x:250, y:60, params:{warpType:"fbmNoise",amount:0.16,freq:2.5,seed:31}},
      {id:"m",  type:"shape",  x:60,  y:240, params:{shape:"circle",size:0.9,feather:0.6,color:"#ffffff",bgColor:"#000000"}},
      {id:"mu", type:"mathnode",x:430,y:120, params:{op:"multiply",factor:1}},
      {id:"lv", type:"levels", x:610, y:120, params:{inBlack:0.30,inWhite:0.85,gamma:1.1}},
      {id:"c",  type:"colorgrade",x:780,y:120,params:{saturation:0.25,contrast:1.1,lift:0.04}},
      {id:"am", type:"alphaMerge", x:950, y:260, params:{}},
      {id:"o",  type:"output", x:1130, y:120, params:{}}
    ],
    edges:[["n","w","in"],["w","mu","a"],["m","mu","b"],["mu","lv","in"],["lv","c","in"],["c","am","rgb"],["c","am","alpha"],["am","o","in"]] },

  { name:"Fire", cat:"VFX", hint:"Noise through a black-body ramp",
    nodes:[
      {id:"n",  type:"source", x:60,  y:60, noise:{type:"fbm",fbmBase:"perlin",scaleX:2.5,scaleY:5,octaves:6}, seed:12},
      {id:"w",  type:"warp",   x:250, y:60, params:{warpType:"fbmNoise",amount:0.11,freq:4,seed:5}},
      {id:"lv", type:"levels", x:430, y:60, params:{inBlack:0.28,inWhite:0.92,gamma:0.9}},
      {id:"gm", type:"gradmap",x:600, y:60, params:{colorA:"#000000",colorMid:"#e03000",colorB:"#ffe070"}},
      {id:"gl", type:"glow",   x:770, y:60, params:{radius:14,intensity:0.9,threshold:0.45}},
      {id:"am", type:"alphaMerge", x:940, y:200, params:{}},
      {id:"o",  type:"output", x:1120, y:60, params:{}}
    ],
    edges:[["n","w","in"],["w","lv","in"],["lv","gm","in"],["gm","gl","in"],["gl","am","rgb"],["gl","am","alpha"],["am","o","in"]] },

  { name:"Electric Arc", cat:"VFX", hint:"Thin crackling filaments",
    nodes:[
      {id:"n",  type:"source", x:60,  y:60, noise:{type:"curl",scaleX:4,scaleY:4,octaves:4}, seed:77},
      {id:"ed", type:"edgedetect",x:250,y:60, params:{method:"sobel",amount:2.2,threshold:0.10,color:"#bfe4ff"}},
      {id:"th", type:"threshold",x:430,y:60, params:{level:0.30,softness:0.06}},
      {id:"gm", type:"gradmap",x:600, y:60, params:{colorA:"#000000",colorMid:"#2060ff",colorB:"#ffffff"}},
      {id:"gl", type:"glow",   x:770, y:60, params:{radius:18,intensity:1.4,threshold:0.15}},
      {id:"am", type:"alphaMerge", x:940, y:200, params:{}},
      {id:"o",  type:"output", x:1120, y:60, params:{}}
    ],
    edges:[["n","ed","in"],["ed","th","in"],["th","gm","in"],["gm","gl","in"],["gl","am","rgb"],["gl","am","alpha"],["am","o","in"]] },

  { name:"Magic Sparkles", cat:"VFX", hint:"Glittering points with bloom",
    nodes:[
      {id:"n",  type:"source", x:60,  y:60, noise:{type:"sparkle",scaleX:16,scaleY:16}, seed:404},
      {id:"lv", type:"levels", x:250, y:60, params:{inBlack:0.10,inWhite:0.78,gamma:1.25}},
      {id:"gm", type:"gradmap",x:430, y:60, params:{colorA:"#000000",colorMid:"#8040ff",colorB:"#ffffff"}},
      {id:"gl", type:"glow",   x:600, y:60, params:{radius:20,intensity:1.5,threshold:0.20}},
      {id:"c",  type:"colorgrade",x:770,y:60,params:{saturation:1.5,exposure:0.2}},
      {id:"am", type:"alphaMerge", x:940, y:200, params:{}},
      {id:"o",  type:"output", x:1120, y:60, params:{}}
    ],
    edges:[["n","lv","in"],["lv","gm","in"],["gm","gl","in"],["gl","c","in"],["c","am","rgb"],["c","am","alpha"],["am","o","in"]] },

  { name:"Energy Orb", cat:"VFX", hint:"Caustic shell inside a glowing sphere",
    nodes:[
      {id:"ca", type:"source", x:60,  y:60, noise:{type:"caustics",scaleX:5,scaleY:5}, seed:21},
      {id:"sp", type:"shape",  x:60,  y:240, params:{shape:"circle",size:0.72,feather:0.22,color:"#ffffff",bgColor:"#000000"}},
      {id:"mu", type:"mathnode",x:250,y:140, params:{op:"multiply",factor:1}},
      {id:"gm", type:"gradmap",x:430, y:140, params:{colorA:"#000010",colorMid:"#0090ff",colorB:"#d0f8ff"}},
      {id:"gl", type:"glow",   x:600, y:140, params:{radius:24,intensity:1.2,threshold:0.25}},
      {id:"am", type:"alphaMerge", x:790, y:280, params:{}},
      {id:"o",  type:"output", x:970, y:140, params:{}}
    ],
    edges:[["ca","mu","a"],["sp","mu","b"],["mu","gm","in"],["gm","gl","in"],["gl","am","rgb"],["gl","am","alpha"],["am","o","in"]] },

  { name:"Impact Cracks", cat:"VFX", hint:"Fractured shards from cell edges",
    nodes:[
      {id:"v",  type:"source", x:60,  y:60, noise:{type:"voronoi",scaleX:6,scaleY:6,worleyMode:"f2f1"}, seed:9},
      {id:"th", type:"threshold",x:250,y:60, params:{level:0.22,softness:0.10}},
      {id:"mo", type:"morph",  x:430, y:60, params:{amount:-2,source:"luma",shape:"diamond"}},
      {id:"gm", type:"gradmap",x:600, y:60, params:{colorA:"#000000",colorMid:"#603020",colorB:"#ffd8a0"}},
      {id:"am", type:"alphaMerge", x:790, y:200, params:{}},
      {id:"o",  type:"output", x:970, y:60, params:{}}
    ],
    edges:[["v","th","in"],["th","mo","in"],["mo","gm","in"],["gm","am","rgb"],["gm","am","alpha"],["am","o","in"]] },

  { name:"Dust Motes", cat:"VFX", hint:"Floating specks, soft and sparse",
    nodes:[
      {id:"n",  type:"source", x:60,  y:60, noise:{type:"dust",scaleX:14,scaleY:14}, seed:55},
      {id:"b",  type:"blur",   x:250, y:60, params:{radius:2}},
      {id:"lv", type:"levels", x:430, y:60, params:{inBlack:0.06,inWhite:0.72,gamma:1.35}},
      {id:"gl", type:"glow",   x:600, y:60, params:{radius:16,intensity:1.2,threshold:0.15}},
      {id:"am", type:"alphaMerge", x:770, y:200, params:{}},
      {id:"o",  type:"output", x:950, y:60, params:{}}
    ],
    edges:[["n","b","in"],["b","lv","in"],["lv","gl","in"],["gl","am","rgb"],["gl","am","alpha"],["am","o","in"]] },

  { name:"Stone Wall", cat:"Texture", hint:"Bricks roughed up, with a normal map",
    nodes:[
      {id:"br", type:"bricks", x:60,  y:60, params:{cols:4,rows:8,mortar:0.05,offset:0.5,bevel:0.16,colorA:"#ffffff",colorB:"#101010"}},
      {id:"n",  type:"source", x:60,  y:250, noise:{type:"fbm",scaleX:14,scaleY:14,octaves:5,seamless:true}, seed:3},
      {id:"mu", type:"mathnode",x:250,y:140, params:{op:"multiply",factor:1}},
      {id:"gm", type:"gradmap",x:430, y:140, params:{colorA:"#2a2622",colorMid:"#6e675e",colorB:"#c8c0b4"}},
      {id:"o",  type:"output", x:620, y:140, params:{}}
    ],
    edges:[["br","mu","a"],["n","mu","b"],["mu","gm","in"],["gm","o","in"]] },

  { name:"Rusted Metal", cat:"Texture", hint:"Pitted surface with corroded colour",
    nodes:[
      {id:"n1", type:"source", x:60,  y:60, noise:{type:"fbm",scaleX:6,scaleY:6,octaves:6,seamless:true}, seed:17},
      {id:"n2", type:"source", x:60,  y:240, noise:{type:"worley",scaleX:9,scaleY:9,worleyMode:"f1",seamless:true}, seed:88},
      {id:"mx", type:"mix",    x:250, y:140, params:{factor:0.45,useMask:false}},
      {id:"lv", type:"levels", x:430, y:140, params:{inBlack:0.2,inWhite:0.9,gamma:1.15}},
      {id:"gm", type:"gradmap",x:600, y:140, params:{colorA:"#231610",colorMid:"#8a4a1e",colorB:"#e0a060"}},
      {id:"o",  type:"output", x:790, y:140, params:{}}
    ],
    edges:[["n1","mx","a"],["n2","mx","b"],["mx","lv","in"],["lv","gm","in"],["gm","o","in"]] },

  { name:"Wood Planks", cat:"Texture", hint:"Grain with plank separations",
    nodes:[
      {id:"w",  type:"source", x:60,  y:60, noise:{type:"fbm",fbmBase:"perlin",scaleX:2,scaleY:24,octaves:6,gain:0.55,seamless:true}, seed:23},
      {id:"lv", type:"levels", x:250, y:60, params:{inBlack:0.22,inWhite:0.80,gamma:1.0}},
      {id:"pl", type:"stripes",x:60,  y:270, params:{count:5,angle:90,width:0.94,softness:0.01,colorA:"#000000",colorB:"#ffffff"}},
      {id:"mu", type:"mathnode",x:440,y:150, params:{op:"multiply",factor:1}},
      {id:"gm", type:"gradmap",x:620, y:150, params:{colorA:"#2a1a0e",colorMid:"#8a5a2e",colorB:"#e6c090"}},
      {id:"o",  type:"output", x:800, y:150, params:{}}
    ],
    edges:[["w","lv","in"],["lv","mu","a"],["pl","mu","b"],["mu","gm","in"],["gm","o","in"]] },

  { name:"Hex Tech Grid", cat:"Texture", hint:"Glowing hexagonal panel lines",
    nodes:[
      {id:"h",  type:"source", x:60,  y:60, noise:{type:"hex",scaleX:7,scaleY:7,seamless:true}, seed:64},
      {id:"ed", type:"edgedetect",x:250,y:60, params:{method:"sobel",amount:2.5,threshold:0.12,color:"#40e0ff"}},
      {id:"gl", type:"glow",   x:430, y:60, params:{radius:14,intensity:1.2,threshold:0.15}},
      {id:"c",  type:"colorgrade",x:600,y:60,params:{saturation:1.4,exposure:0.15,temperature:-0.3}},
      {id:"o",  type:"output", x:790, y:60, params:{}}
    ],
    edges:[["h","ed","in"],["ed","gl","in"],["gl","c","in"],["c","o","in"]] },

  { name:"Caustics Water", cat:"Texture", hint:"Pool-bottom light patterns",
    nodes:[
      {id:"ca", type:"source", x:60,  y:60, noise:{type:"caustics",scaleX:4,scaleY:4,seamless:true}, seed:42},
      {id:"lv", type:"levels", x:250, y:60, params:{inBlack:0.30,inWhite:0.98,gamma:1.45}},
      {id:"gm", type:"gradmap",x:430, y:60, params:{colorA:"#02141e",colorMid:"#0d6a88",colorB:"#d0f4ff"}},
      {id:"gl", type:"glow",   x:600, y:60, params:{radius:10,intensity:0.45,threshold:0.75}},
      {id:"o",  type:"output", x:770, y:60, params:{}}
    ],
    edges:[["ca","lv","in"],["lv","gm","in"],["gm","gl","in"],["gl","o","in"]] },

  { name:"Retro Sprite", cat:"Retro", hint:"Chunky pixels, 4-tone palette, outline",
    nodes:[
      {id:"s",  type:"shape",   x:60,  y:60, params:{shape:"star",sides:5,size:0.78,inner:0.45,feather:0.02,color:"#ffffff",bgColor:"#000000"}},
      {id:"px", type:"pixelate",x:250, y:60, params:{blockSize:32,mode:"nearest"}},
      {id:"pa", type:"palette", x:430, y:60, params:{palette:"gameboy",dither:0.35}},
      {id:"ol", type:"outline", x:600, y:60, params:{source:"luma",threshold:0.35,thickness:6,color:"#0f380f",mode:"outer"}},
      {id:"o",  type:"output",  x:790, y:60, params:{}}
    ],
    edges:[["s","px","in"],["px","pa","in"],["pa","ol","in"],["ol","o","in"]] },

  { name:"CRT Screen", cat:"Retro", hint:"Scanlines, RGB mask and a curved vignette",
    nodes:[
      {id:"n",  type:"source",   x:60,  y:60, noise:{type:"fbm",scaleX:5,scaleY:5,octaves:4}, seed:19},
      {id:"gm", type:"gradmap",  x:250, y:60, params:{colorA:"#001800",colorMid:"#20b040",colorB:"#c8ffc8"}},
      {id:"sc", type:"scanlines",x:430, y:60, params:{spacing:12,darkness:0.55,thickness:5,rgbMask:true,vignette:0}},
      {id:"vg", type:"vignette", x:600, y:60, params:{amount:0.75,radius:0.55,softness:0.75,roundness:0.75}},
      {id:"o",  type:"output",   x:790, y:60, params:{}}
    ],
    edges:[["n","gm","in"],["gm","sc","in"],["sc","vg","in"],["vg","o","in"]] },

  { name:"Spiral Tunnel", cat:"Pattern", hint:"Stripes bent into a vortex",
    nodes:[
      {id:"st", type:"stripes", x:60,  y:60, params:{count:14,angle:35,width:0.5,softness:0.10,colorA:"#100820",colorB:"#a060ff"}},
      {id:"po", type:"polar",   x:250, y:60, params:{mode:"toPolar",zoom:1.4,repeat:1}},
      {id:"vg", type:"vignette",x:430, y:60, params:{amount:0.8,radius:0.35,softness:0.9}},
      {id:"gl", type:"glow",    x:600, y:60, params:{radius:14,intensity:0.8,threshold:0.4}},
      {id:"o",  type:"output",  x:770, y:60, params:{}}
    ],
    edges:[["st","po","in"],["po","vg","in"],["vg","gl","in"],["gl","o","in"]] },

  { name:"Kaleidoscope", cat:"Pattern", hint:"Symmetric mandala from noise",
    nodes:[
      {id:"n",  type:"source", x:60,  y:60, noise:{type:"marble",scaleX:5,scaleY:5,seamless:true}, seed:8},
      {id:"mi", type:"mirror", x:250, y:60, params:{mode:"kaleido"}},
      {id:"po", type:"polar",  x:430, y:60, params:{mode:"toPolar",repeat:6}},
      {id:"gm", type:"gradmap",x:600, y:60, params:{colorA:"#100020",colorMid:"#a02080",colorB:"#ffe0a0"}},
      {id:"o",  type:"output", x:790, y:60, params:{}}
    ],
    edges:[["n","mi","in"],["mi","po","in"],["po","gm","in"],["gm","o","in"]] },

  { name:"Seamless Check", cat:"Pattern", hint:"Offset view to spot tiling seams",
    nodes:[
      {id:"n",  type:"source",     x:60,  y:60, noise:{type:"fbm",scaleX:4,scaleY:4,octaves:5,seamless:true}, seed:1},
      {id:"of", type:"offsetnode", x:250, y:60, params:{offsetX:0.5,offsetY:0.5}},
      {id:"gm", type:"gradmap",    x:430, y:60, params:{colorA:"#101010",colorMid:"#808080",colorB:"#f0f0f0"}},
      {id:"o",  type:"output",     x:620, y:60, params:{}}
    ],
    edges:[["n","of","in"],["of","gm","in"],["gm","o","in"]] }
];

// Turn a preset spec into a real graph.
function buildPresetGraph(preset){
  var g=mkGraph(), map={};
  for(var i=0;i<preset.nodes.length;i++){
    var spec=preset.nodes[i];
    var nd=mkNode(spec.type,spec.x,spec.y);
    if(spec.noise)nd.params.layer=mkL(0,spec.seed||42,Object.assign({enabled:true},spec.noise));
    if(spec.params)for(var k in spec.params)nd.params[k]=spec.params[k];
    addNode(g,nd); map[spec.id]=nd.id;
  }
  for(var e=0;e<preset.edges.length;e++){
    var ed=preset.edges[e];
    if(map[ed[0]]&&map[ed[1]])connect(g,map[ed[0]],map[ed[1]],ed[2],ed[3]);
  }
  return g;
}

// ═══ END NODE GRAPH ENGINE ═══════════════════════════════════════
// ═══ NODE EVALUATION (bridges node types to the render engine) ════
// Renders a single source node's layer into a fresh buffer.
function nodeRenderSource(node,size){
  var buf=new Float32Array(size*size*4);
  for(var i=3;i<buf.length;i+=4)buf[i]=1;
  var L=node.params.layer;
  if(L)renderLayersToBuf(buf,size,[Object.assign({},L,{enabled:true,opacity:1,blendMode:"normal"})],null,[]);
  return buf;
}
// Blend buffer A over buffer B (per-pixel, per-channel) with mode + opacity.
function nodeBlend(bufA,bufB,mode,opacity){
  var size2=bufA?bufA.length:0;
  var out=new Float32Array(size2);
  var op=opacity==null?1:opacity;
  for(var i=0;i<size2;i+=4){
    var br=bufB?bufB[i]:0, bg=bufB?bufB[i+1]:0, bb=bufB?bufB[i+2]:0;
    var sr=bufA?bufA[i]:0, sg=bufA?bufA[i+1]:0, sbb=bufA?bufA[i+2]:0;
    var rr=blendV(br,sr,mode), rg=blendV(bg,sg,mode), rb=blendV(bb,sbb,mode);
    out[i]=br+(rr-br)*op; out[i+1]=bg+(rg-bg)*op; out[i+2]=bb+(rb-bb)*op; out[i+3]=1;
  }
  return out;
}
// Per-pixel brightness/contrast/invert on a buffer.
function nodeAdjust(buf,p){
  var size2=buf?buf.length:0; var out=new Float32Array(size2);
  var br=p.brightness||0, con=p.contrast!=null?p.contrast:1, inv=!!p.invert;
  var sat=p.saturation!=null?p.saturation:1;
  var hue=(p.hue||0)/360; // 0..1 rotation
  var gamma=p.gamma!=null?p.gamma:1; var ig=gamma>0?1/gamma:1;
  var doHue=Math.abs(p.hue||0)>0.001, doSat=Math.abs(sat-1)>0.001, doGamma=Math.abs(gamma-1)>0.001;
  for(var i=0;i<size2;i+=4){
    var r=buf[i],g=buf[i+1],b=buf[i+2];
    // brightness / contrast
    r=(r-0.5)*con+0.5+br; g=(g-0.5)*con+0.5+br; b=(b-0.5)*con+0.5+br;
    // gamma
    if(doGamma){ r=r<0?0:Math.pow(r,ig); g=g<0?0:Math.pow(g,ig); b=b<0?0:Math.pow(b,ig); }
    // saturation + hue via HSV
    if(doSat||doHue){
      var mx=Math.max(r,g,b),mn=Math.min(r,g,b),d=mx-mn;
      var h=0,s=mx>0?d/mx:0,vv=mx;
      if(d>0){
        if(mx===r)h=((g-b)/d)%6;
        else if(mx===g)h=(b-r)/d+2;
        else h=(r-g)/d+4;
        h/=6; if(h<0)h+=1;
      }
      if(doHue){h=(h+hue)%1; if(h<0)h+=1;}
      if(doSat){s=s*sat; if(s<0)s=0; if(s>1)s=1;}
      // back to rgb
      var hh=h*6,ii=Math.floor(hh),ff=hh-ii,pp=vv*(1-s),qq=vv*(1-s*ff),tt=vv*(1-s*(1-ff));
      switch(ii%6){
        case 0: r=vv;g=tt;b=pp;break; case 1: r=qq;g=vv;b=pp;break;
        case 2: r=pp;g=vv;b=tt;break; case 3: r=pp;g=qq;b=vv;break;
        case 4: r=tt;g=pp;b=vv;break; default: r=vv;g=pp;b=qq;break;
      }
    }
    if(inv){r=1-r;g=1-g;b=1-b;}
    out[i]=r<0?0:r>1?1:r; out[i+1]=g<0?0:g>1?1:g; out[i+2]=b<0?0:b>1?1:b; out[i+3]=1;
  }
  return out;
}
// Mask-mix: per pixel, lerp A and B by mask luminance.
function nodeMaskMix(bufA,bufB,bufM,p){
  p=p||{};
  var size2=bufA?bufA.length:(bufB?bufB.length:0); var out=new Float32Array(size2);
  var inv=!!p.invertMask, con=p.maskContrast!=null?p.maskContrast:1;
  for(var i=0;i<size2;i+=4){
    var m=bufM?(bufM[i]*0.299+bufM[i+1]*0.587+bufM[i+2]*0.114):0.5;
    if(con!==1)m=(m-0.5)*con+0.5;        // sharpen/soften the mask edge
    if(inv)m=1-m;
    if(m<0)m=0; if(m>1)m=1;
    for(var c=0;c<3;c++){var a=bufA?bufA[i+c]:0,b=bufB?bufB[i+c]:0;out[i+c]=b+(a-b)*m;}
    out[i+3]=1;
  }
  return out;
}
// Gaussian blur on a copy of the buffer.
function nodeBlur(buf,size,radius){
  var out=new Float32Array(buf.length); out.set(buf);
  // Scale to the render size, but never let a requested blur vanish entirely:
  // at preview sizes a sub-pixel radius would show no blur at all while the
  // export showed plenty, which is exactly the mismatch we are removing.
  var r=(radius>=1)?Math.max(1,Math.round(pxS(radius,size))):0;
  if(r>=1)gaussBlur(out,size,size,r);
  return out;
}
// Glow/bloom on a copy of the buffer.
function nodeGlow(buf,size,p){
  var out=new Float32Array(buf.length); out.set(buf);
  applyGlow(out,size,Math.max(1,Math.round(pxS(p.radius||8,size))),p.intensity!=null?p.intensity:0.8,{threshold:p.threshold||0,tintR:1,tintG:1,tintB:1,blend:"add"});
  return out;
}
// Gradient map: remap luminance to a colour ramp (A→[mid]→B).
// Sample a colour ramp (sorted stops [{pos,color}]) at t in 0..1. Returns [r,g,b].
function sampleGradStops(stops,t){
  if(t<=stops[0].pos)return hexF(stops[0].color);
  var last=stops[stops.length-1];
  if(t>=last.pos)return hexF(last.color);
  for(var i=0;i<stops.length-1;i++){
    var s0=stops[i],s1=stops[i+1];
    if(t>=s0.pos&&t<=s1.pos){
      var span=s1.pos-s0.pos; var f=span>0?(t-s0.pos)/span:0;
      var c0=hexF(s0.color),c1=hexF(s1.color);
      return [c0[0]+(c1[0]-c0[0])*f, c0[1]+(c1[1]-c0[1])*f, c0[2]+(c1[2]-c0[2])*f];
    }
  }
  return hexF(last.color);
}
function nodeGradMap(buf,size,p){
  var out=new Float32Array(buf.length);
  // Multi-stop gradient mode: use colorStops if present and there are >=2 stops.
  var useStops=p.useStops&&p.colorStops&&p.colorStops.length>=2;
  var stops=null;
  if(useStops){
    stops=p.colorStops.slice().sort(function(a,b){return a.pos-b.pos;});
  }
  var a=hexF(p.colorA||"#000000"), b=hexF(p.colorB||"#ffffff");
  var hasMid=!!p.colorMid, mid=hasMid?hexF(p.colorMid):null;
  for(var i=0;i<size*size;i++){
    var l=buf[i*4]*0.299+buf[i*4+1]*0.587+buf[i*4+2]*0.114;
    var r,g2,bl;
    if(useStops){
      var c=sampleGradStops(stops,l); r=c[0];g2=c[1];bl=c[2];
    } else if(hasMid){
      if(l<0.5){var t=l*2;r=a[0]+(mid[0]-a[0])*t;g2=a[1]+(mid[1]-a[1])*t;bl=a[2]+(mid[2]-a[2])*t;}
      else{var t2=(l-0.5)*2;r=mid[0]+(b[0]-mid[0])*t2;g2=mid[1]+(b[1]-mid[1])*t2;bl=mid[2]+(b[2]-mid[2])*t2;}
    } else { r=a[0]+(b[0]-a[0])*l;g2=a[1]+(b[1]-a[1])*l;bl=a[2]+(b[2]-a[2])*l; }
    out[i*4]=r;out[i*4+1]=g2;out[i*4+2]=bl;out[i*4+3]=1;
  }
  return out;
}
// Apply a stack of layer filters (the same 29 used in layer mode) in order.
function nodeFilterChain(buf,size,filters){
  var out=new Float32Array(buf.length); out.set(buf);
  if(filters&&filters.length){
    for(var i=0;i<filters.length;i++){
      var f=filters[i];
      if(f&&f.enabled!==false)applyFilter(out,size,Object.assign({},f,{enabled:true}));
    }
  }
  return out;
}
// Domain warp / UV distortion on a copy of the buffer (reuses the layer warp engine).
function nodeWarp(buf,size,p){
  var out=new Float32Array(buf.length); out.set(buf);
  if(p.warpType&&p.warpType!=="none"&&(p.amount||0)>0){
    applyFilterUVDist(out,size,p.warpType,p.amount||0,p.freq||3,p.seed||1234);
  }
  return out;
}
// Affine transform with seamless wrap: scale, rotate, offset, mirror, tiling.
function nodeTransform(buf,size,p){
  var out=new Float32Array(buf.length);
  var sc=p.scale!=null?p.scale:1; if(sc===0)sc=0.0001;
  var tile=p.tile!=null?p.tile:1;
  var ang=(p.rotate||0)*Math.PI/180, ca=Math.cos(ang), sa=Math.sin(ang);
  var ox=(p.offsetX||0), oy=(p.offsetY||0);
  var mx=p.mirrorX?-1:1, my=p.mirrorY?-1:1;
  var pointSample=(p.sampling||"linear")==="point";
  for(var y=0;y<size;y++){
    for(var x=0;x<size;x++){
      // normalized centered coords
      var u=(x/size)-0.5, v=(y/size)-0.5;
      // mirror
      u*=mx; v*=my;
      // rotate
      var ru=u*ca-v*sa, rv=u*sa+v*ca;
      // scale + tiling (more tiles = smaller features)
      ru=ru/sc*tile; rv=rv/sc*tile;
      // offset, back to 0..1
      var su=ru+0.5+ox, sv=rv+0.5+oy;
      // wrap for seamless tiling
      su=su-Math.floor(su); sv=sv-Math.floor(sv);
      // bilinear sample
      var fx=su*size, fy=sv*size;
      var x0=Math.floor(fx), y0=Math.floor(fy);
      var tx=fx-x0, ty=fy-y0;
      var x1=(x0+1)%size, y1=(y0+1)%size;
      x0=((x0%size)+size)%size; y0=((y0%size)+size)%size;
      var i00=(y0*size+x0)*4, i10=(y0*size+x1)*4, i01=(y1*size+x0)*4, i11=(y1*size+x1)*4;
      var o=(y*size+x)*4;
      if(pointSample){
        // nearest-neighbour: keeps pixel-art edges crisp instead of blurring them
        var nx=tx<0.5?x0:x1, ny=ty<0.5?y0:y1;
        var ni=(ny*size+nx)*4;
        out[o]=buf[ni]; out[o+1]=buf[ni+1]; out[o+2]=buf[ni+2];
      } else {
        for(var c=0;c<3;c++){
          var top=buf[i00+c]*(1-tx)+buf[i10+c]*tx;
          var bot=buf[i01+c]*(1-tx)+buf[i11+c]*tx;
          out[o+c]=top*(1-ty)+bot*ty;
        }
      }
      out[o+3]=1;
    }
  }
  return out;
}
// The host evalNode passed to evaluate(): dispatches by node type.
// Registry of node evaluators: type -> function(node, inputs, size) -> buffer.
// To add a new node type: register it in NODE_TYPES, add an evaluator here, and
// (for UI) add it to NODE_META/NODE_CATEGORIES. Nothing else needs to change.
// Alpha merge: RGB from bufRGB, alpha channel = luminance of bufA.
function nodeAlphaMerge(bufRGB,bufA,size){
  var n=size*size*4; var out=new Float32Array(n);
  for(var i=0;i<n;i+=4){
    out[i]=bufRGB?bufRGB[i]:0; out[i+1]=bufRGB?bufRGB[i+1]:0; out[i+2]=bufRGB?bufRGB[i+2]:0;
    var a=bufA?(bufA[i]*0.299+bufA[i+1]*0.587+bufA[i+2]*0.114):1;
    out[i+3]=a<0?0:a>1?1:a;
  }
  return out;
}
// ── New processing nodes ───────────────────────────────────────────
// Levels: remap input black/white points and gamma to output black/white.
function nodeLevels(buf,p){
  if(!buf)return new Float32Array(0);
  var n=buf.length; var out=new Float32Array(n);
  var ib=p.inBlack!=null?p.inBlack:0, iw=p.inWhite!=null?p.inWhite:1;
  var ob=p.outBlack!=null?p.outBlack:0, ow=p.outWhite!=null?p.outWhite:1;
  var gm=p.gamma!=null?p.gamma:1, ig=gm>0?1/gm:1;
  var span=(iw-ib)||1e-6;
  for(var i=0;i<n;i+=4){
    for(var c=0;c<3;c++){
      var v=(buf[i+c]-ib)/span; v=v<0?0:v>1?1:v;
      if(gm!==1)v=Math.pow(v,ig);
      v=ob+v*(ow-ob);
      out[i+c]=v<0?0:v>1?1:v;
    }
    out[i+3]=buf[i+3];
  }
  return out;
}
// Threshold: binary cut at a level, per luminance.
function nodeThreshold(buf,p){
  if(!buf)return new Float32Array(0);
  var n=buf.length; var out=new Float32Array(n);
  var t=p.level!=null?p.level:0.5; var soft=p.softness||0;
  for(var i=0;i<n;i+=4){
    var l=buf[i]*0.299+buf[i+1]*0.587+buf[i+2]*0.114, v;
    if(soft<=0)v=l>=t?1:0;
    else{ v=(l-(t-soft))/(2*soft); v=v<0?0:v>1?1:v; }
    out[i]=out[i+1]=out[i+2]=v; out[i+3]=buf[i+3];
  }
  return out;
}
// Posterize: quantize each channel to N levels (cel / stepped look).
function nodePosterize(buf,p){
  if(!buf)return new Float32Array(0);
  var n=buf.length; var out=new Float32Array(n);
  var lv=Math.max(2,Math.round(p.levels!=null?p.levels:4)); var step=lv-1;
  for(var i=0;i<n;i+=4){
    for(var c=0;c<3;c++){ out[i+c]=Math.round(buf[i+c]*step)/step; }
    out[i+3]=buf[i+3];
  }
  return out;
}
// Sharpen: unsharp mask via a 3x3 kernel; amount scales the effect.
function nodeSharpen(buf,size,p){
  if(!buf)return new Float32Array(0);
  var n=size*size*4; var out=new Float32Array(n); var amt=p.amount!=null?p.amount:1;
  function px(x,y,c){ x=x<0?0:x>=size?size-1:x; y=y<0?0:y>=size?size-1:y; return buf[(y*size+x)*4+c]; }
  for(var y=0;y<size;y++)for(var x=0;x<size;x++){
    var o=(y*size+x)*4;
    for(var c=0;c<3;c++){
      var center=px(x,y,c);
      var lap=center*5 - px(x-1,y,c) - px(x+1,y,c) - px(x,y-1,c) - px(x,y+1,c);
      var v=center+(lap-center)*amt;
      out[o+c]=v<0?0:v>1?1:v;
    }
    out[o+3]=buf[o+3];
  }
  return out;
}
// Emboss: directional relief from luminance gradient.
function nodeEmboss(buf,size,p){
  if(!buf)return new Float32Array(0);
  var n=size*size*4; var out=new Float32Array(n);
  var amt=p.amount!=null?p.amount:1; var ang=((p.angle||45)*Math.PI/180);
  var dx=Math.cos(ang), dy=Math.sin(ang);
  function lum(x,y){ x=x<0?0:x>=size?size-1:x; y=y<0?0:y>=size?size-1:y; var i=(y*size+x)*4; return buf[i]*0.299+buf[i+1]*0.587+buf[i+2]*0.114; }
  for(var y=0;y<size;y++)for(var x=0;x<size;x++){
    var gx=lum(x+1,y)-lum(x-1,y), gy=lum(x,y+1)-lum(x,y-1);
    var v=0.5+(gx*dx+gy*dy)*amt*2;
    v=v<0?0:v>1?1:v;
    var o=(y*size+x)*4; out[o]=out[o+1]=out[o+2]=v; out[o+3]=buf[o+3];
  }
  return out;
}
// Normal map: derive a tangent-space normal from a heightmap (luminance).
function nodeNormalMap(buf,size,p){
  if(!buf)return new Float32Array(0);
  var n=size*size*4; var out=new Float32Array(n); var str=p.strength!=null?p.strength:2;
  function lum(x,y){ x=(x+size)%size; y=(y+size)%size; var i=(y*size+x)*4; return buf[i]*0.299+buf[i+1]*0.587+buf[i+2]*0.114; }
  for(var y=0;y<size;y++)for(var x=0;x<size;x++){
    var gx=(lum(x-1,y)-lum(x+1,y))*str, gy=(lum(x,y-1)-lum(x,y+1))*str;
    var nz=1.0, len=Math.sqrt(gx*gx+gy*gy+nz*nz)||1;
    var o=(y*size+x)*4;
    out[o]=(gx/len)*0.5+0.5; out[o+1]=(gy/len)*0.5+0.5; out[o+2]=(nz/len)*0.5+0.5; out[o+3]=buf[o+3];
  }
  return out;
}
// ── Resolution-relative pixel sizes ───────────────────────────────
// Nodes like Pixelate, Blur or Expand take their amount in pixels. Tuned on a
// 128px preview and exported at 2048 the SAME number means something very
// different, so the export stops matching what you designed. With scaling on,
// those numbers mean "pixels at the reference resolution" and are scaled to the
// resolution actually being rendered, which makes the preview honest.
var PX_REF=512;            // the resolution the numbers are quoted at
var _pxScaleOn=true;
function setPixelScaling(on){ _pxScaleOn=!!on; clearEvalCache(); }
function getPixelScaling(){ return _pxScaleOn; }
// scale a pixel-valued parameter for the size actually being rendered
function pxS(v,size){
  if(!_pxScaleOn)return v;
  var s=v*(size/PX_REF);
  return s;
}
// same, but never collapses a visible feature to nothing
function pxS1(v,size){
  if(!_pxScaleOn)return Math.max(1,Math.round(v));
  return Math.max(1,Math.round(v*(size/PX_REF)));
}

// ══ SHAPE + PATTERN GENERATORS ════════════════════════════════════
// All shapes are built from a signed distance (negative inside), so the same
// feather control gives a clean hard edge or a soft falloff for every shape.
function _shapeSDF(type,rx,ry,r,sides,inner,thick){
  var rr=Math.sqrt(rx*rx+ry*ry);
  if(type==="circle")  return rr-r;
  if(type==="square"){ return Math.max(Math.abs(rx)-r,Math.abs(ry)-r); }
  if(type==="diamond") return (Math.abs(rx)+Math.abs(ry))-r;
  if(type==="ring")    return Math.max(rr-r, r*inner-rr);
  if(type==="cross"){
    var t=r*thick;
    var d1=Math.max(Math.abs(rx)-r,Math.abs(ry)-t);
    var d2=Math.max(Math.abs(rx)-t,Math.abs(ry)-r);
    return Math.min(d1,d2);
  }
  if(type==="capsule"){
    // horizontal pill: distance to a segment of half-length r, radius r*thick
    var hx=Math.max(0,Math.abs(rx)-r*(1-thick));
    return Math.sqrt(hx*hx+ry*ry)-r*thick;
  }
  if(type==="star"){
    var a=Math.atan2(ry,rx)+Math.PI/2;
    var n2=sides*2, seg2=Math.PI*2/n2;
    a=((a%(Math.PI*2))+Math.PI*2)%(Math.PI*2);
    var idx=Math.floor(a/seg2), f=(a-idx*seg2)/seg2;
    var r0=(idx%2===0)?r:r*inner, r1=(idx%2===0)?r*inner:r;
    return rr-(r0+(r1-r0)*f);
  }
  // regular polygon (triangle at sides=3, hexagon at 6, ...)
  var seg=Math.PI*2/sides;
  var an=Math.atan2(ry,rx)+Math.PI/2;
  an=((an%seg)+seg)%seg-seg*0.5;
  return rr*Math.cos(an)-r*Math.cos(seg*0.5);
}
function nodeShape(size,p){
  var out=new Float32Array(size*size*4);
  var type=p.shape||"circle";
  var cx=p.x!=null?p.x:0.5, cy=p.y!=null?p.y:0.5;
  var r=(p.size!=null?p.size:0.6)*0.5;
  var rot=(p.rotation||0)*Math.PI/180;
  var sides=Math.max(3,Math.round(p.sides!=null?p.sides:5));
  var inner=p.inner!=null?p.inner:0.5;
  var thick=p.thickness!=null?p.thickness:0.3;
  var feather=p.feather!=null?p.feather:0.01;
  var aspect=Math.max(0.05,p.aspect!=null?p.aspect:1);
  var inv=!!p.invert, transparent=!!p.transparent;
  var fg=hexF(p.color||"#ffffff"), bg=hexF(p.bgColor||"#000000");
  var cs=Math.cos(-rot), sn=Math.sin(-rot);
  for(var y=0;y<size;y++)for(var x=0;x<size;x++){
    var u=(x+0.5)/size-cx, v=(y+0.5)/size-cy;
    var rx=(u*cs-v*sn)/aspect, ry=u*sn+v*cs;
    var d=_shapeSDF(type,rx,ry,r,sides,inner,thick);
    var al = feather>0.0005 ? Math.max(0,Math.min(1,0.5-d/feather)) : (d<=0?1:0);
    if(inv)al=1-al;
    var i=(y*size+x)*4;
    if(transparent){ out[i]=fg[0];out[i+1]=fg[1];out[i+2]=fg[2];out[i+3]=al; }
    else { out[i]=bg[0]+(fg[0]-bg[0])*al; out[i+1]=bg[1]+(fg[1]-bg[1])*al;
           out[i+2]=bg[2]+(fg[2]-bg[2])*al; out[i+3]=1; }
  }
  return out;
}
// Gradient generator: linear, radial, angular (sweep) or diamond.
function nodeGradient(size,p){
  var out=new Float32Array(size*size*4);
  var type=p.gradType||"linear";
  var ang=(p.angle||0)*Math.PI/180;
  var cx=p.x!=null?p.x:0.5, cy=p.y!=null?p.y:0.5;
  var scale=p.scale!=null?p.scale:1; if(scale<=0)scale=0.0001;
  var rep=Math.max(1,Math.round(p.repeat||1));
  var mirror=!!p.mirror, inv=!!p.invert;
  var ca=hexF(p.colorA||"#000000"), cb=hexF(p.colorB||"#ffffff");
  var cs=Math.cos(ang), sn=Math.sin(ang);
  for(var y=0;y<size;y++)for(var x=0;x<size;x++){
    var u=(x+0.5)/size-cx, v=(y+0.5)/size-cy, t;
    if(type==="radial")      t=Math.sqrt(u*u+v*v)*2/scale;
    else if(type==="angular"){ t=(Math.atan2(v,u)/(Math.PI*2))+0.5; t/=scale; }
    else if(type==="diamond") t=(Math.abs(u)+Math.abs(v))*2/scale;
    else                      t=((u*cs+v*sn)/scale)+0.5;   // linear
    t*=rep;
    t=t-Math.floor(t);                                     // wrap into 0..1
    if(mirror){ var m=t*2; t=m>1?2-m:m; }
    if(inv)t=1-t;
    var i=(y*size+x)*4;
    out[i]=ca[0]+(cb[0]-ca[0])*t; out[i+1]=ca[1]+(cb[1]-ca[1])*t;
    out[i+2]=ca[2]+(cb[2]-ca[2])*t; out[i+3]=1;
  }
  return out;
}
// Checkerboard.
function nodeChecker(size,p){
  var out=new Float32Array(size*size*4);
  var tx=Math.max(1,Math.round(p.tilesX!=null?p.tilesX:8));
  var ty=Math.max(1,Math.round(p.tilesY!=null?p.tilesY:tx));
  var ca=hexF(p.colorA||"#000000"), cb=hexF(p.colorB||"#ffffff");
  for(var y=0;y<size;y++)for(var x=0;x<size;x++){
    var gx=Math.floor((x/size)*tx), gy=Math.floor((y/size)*ty);
    var on=(((gx+gy)&1)===0), c=on?ca:cb;
    var i=(y*size+x)*4;
    out[i]=c[0];out[i+1]=c[1];out[i+2]=c[2];out[i+3]=1;
  }
  return out;
}
// Parallel stripes at any angle, with duty cycle and soft edges.
function nodeStripes(size,p){
  var out=new Float32Array(size*size*4);
  var count=Math.max(1,p.count!=null?p.count:8);
  var ang=(p.angle||0)*Math.PI/180;
  var width=Math.max(0,Math.min(1,p.width!=null?p.width:0.5));
  var soft=Math.max(0,p.softness!=null?p.softness:0);
  var ca=hexF(p.colorA||"#000000"), cb=hexF(p.colorB||"#ffffff");
  var cs=Math.cos(ang), sn=Math.sin(ang);
  for(var y=0;y<size;y++)for(var x=0;x<size;x++){
    var u=(x+0.5)/size, v=(y+0.5)/size;
    var t=(u*cs+v*sn)*count; t=t-Math.floor(t);
    // distance into / out of the stripe, so softness feathers both edges
    var dEdge=Math.min(t,width-t);
    var al;
    if(soft<=0.0005)al=(t<width)?1:0;
    else al=Math.max(0,Math.min(1,0.5+dEdge/soft));
    var i=(y*size+x)*4;
    out[i]=ca[0]+(cb[0]-ca[0])*al; out[i+1]=ca[1]+(cb[1]-ca[1])*al;
    out[i+2]=ca[2]+(cb[2]-ca[2])*al; out[i+3]=1;
  }
  return out;
}
// Brick / tile wall with mortar gaps, row offset and a bevel ramp.
function nodeBricks(size,p){
  var out=new Float32Array(size*size*4);
  var cols=Math.max(1,Math.round(p.cols!=null?p.cols:4));
  var rows=Math.max(1,Math.round(p.rows!=null?p.rows:8));
  var mortar=Math.max(0,Math.min(0.49,p.mortar!=null?p.mortar:0.06));
  var shift=p.offset!=null?p.offset:0.5;
  var bevel=Math.max(0,Math.min(0.5,p.bevel!=null?p.bevel:0.1));
  var cBrick=hexF(p.colorA||"#ffffff"), cMortar=hexF(p.colorB||"#000000");
  for(var y=0;y<size;y++)for(var x=0;x<size;x++){
    var v=(y+0.5)/size*rows, row=Math.floor(v), fy=v-row;
    var u=(x+0.5)/size*cols+(row%2?shift:0), fx=u-Math.floor(u);
    // distance to the nearest brick edge in each axis, normalised
    var dx=Math.min(fx,1-fx), dy=Math.min(fy,1-fy);
    var d=Math.min(dx,dy);
    var al;
    if(d<mortar)al=0;                                   // mortar gap
    else if(bevel>0.0005)al=Math.max(0,Math.min(1,(d-mortar)/bevel));
    else al=1;
    var i=(y*size+x)*4;
    out[i]=cMortar[0]+(cBrick[0]-cMortar[0])*al;
    out[i+1]=cMortar[1]+(cBrick[1]-cMortar[1])*al;
    out[i+2]=cMortar[2]+(cBrick[2]-cMortar[2])*al;
    out[i+3]=1;
  }
  return out;
}
// ══ MORE PROCESSING NODES ═════════════════════════════════════════
// Mirror / kaleidoscope.
function nodeMirror(buf,size,p){
  if(!buf)return new Float32Array(0);
  var out=new Float32Array(size*size*4);
  var mode=p.mode||"x";
  for(var y=0;y<size;y++)for(var x=0;x<size;x++){
    var sx=x, sy=y;
    if(mode==="x"){ sx=x<size/2?x:size-1-x; }
    else if(mode==="y"){ sy=y<size/2?y:size-1-y; }
    else if(mode==="xy"){ sx=x<size/2?x:size-1-x; sy=y<size/2?y:size-1-y; }
    else if(mode==="diagonal"){ if(x>y){var t=sx;sx=sy;sy=t;} }
    else if(mode==="kaleido"){
      // fold into one quadrant then into the diagonal wedge
      sx=x<size/2?x:size-1-x; sy=y<size/2?y:size-1-y;
      if(sx>sy){var t2=sx;sx=sy;sy=t2;}
    }
    var si=(sy*size+sx)*4, di=(y*size+x)*4;
    out[di]=buf[si];out[di+1]=buf[si+1];out[di+2]=buf[si+2];out[di+3]=buf[si+3];
  }
  return out;
}
// Offset with wrap: shifts the image and wraps it around, which is how you
// check whether a texture actually tiles seamlessly.
function nodeOffset(buf,size,p){
  if(!buf)return new Float32Array(0);
  var out=new Float32Array(size*size*4);
  var ox=Math.round((p.offsetX!=null?p.offsetX:0.5)*size);
  var oy=Math.round((p.offsetY!=null?p.offsetY:0.5)*size);
  for(var y=0;y<size;y++)for(var x=0;x<size;x++){
    var sx=((x-ox)%size+size)%size, sy=((y-oy)%size+size)%size;
    var si=(sy*size+sx)*4, di=(y*size+x)*4;
    out[di]=buf[si];out[di+1]=buf[si+1];out[di+2]=buf[si+2];out[di+3]=buf[si+3];
  }
  return out;
}
// Directional (motion) blur: average along a line at a given angle.
function nodeDirBlur(buf,size,p){
  if(!buf)return new Float32Array(0);
  var out=new Float32Array(size*size*4);
  var ang=(p.angle||0)*Math.PI/180;
  var lenRaw=p.length!=null?p.length:8;
  var len=lenRaw>=1?Math.max(1,pxS(lenRaw,size)):0;
  var samples=Math.max(1,Math.min(48,Math.round(p.samples!=null?p.samples:12)));
  if(len<0.5||samples<2){ out.set(buf); return out; }
  var dx=Math.cos(ang), dy=Math.sin(ang);
  var wrap=!!p.wrap;
  for(var y=0;y<size;y++)for(var x=0;x<size;x++){
    var r=0,g2=0,b=0,a=0;
    for(var s=0;s<samples;s++){
      var f=(s/(samples-1)-0.5)*len;
      var sx=Math.round(x+dx*f), sy=Math.round(y+dy*f);
      if(wrap){ sx=((sx%size)+size)%size; sy=((sy%size)+size)%size; }
      else { sx=sx<0?0:sx>=size?size-1:sx; sy=sy<0?0:sy>=size?size-1:sy; }
      var si=(sy*size+sx)*4;
      r+=buf[si];g2+=buf[si+1];b+=buf[si+2];a+=buf[si+3];
    }
    var di=(y*size+x)*4;
    out[di]=r/samples;out[di+1]=g2/samples;out[di+2]=b/samples;out[di+3]=a/samples;
  }
  return out;
}
// Radial blur: zoom (along the ray from the centre) or spin (around it).
function nodeRadialBlur(buf,size,p){
  if(!buf)return new Float32Array(0);
  var out=new Float32Array(size*size*4);
  var amt=p.amount!=null?p.amount:0.2;
  var spin=(p.mode||"zoom")==="spin";
  var samples=Math.max(1,Math.min(48,Math.round(p.samples!=null?p.samples:12)));
  var cx=(p.x!=null?p.x:0.5)*size, cy=(p.y!=null?p.y:0.5)*size;
  if(Math.abs(amt)<0.001||samples<2){ out.set(buf); return out; }
  for(var y=0;y<size;y++)for(var x=0;x<size;x++){
    var r=0,g2=0,b=0,a=0;
    var px=x-cx, py=y-cy;
    for(var s=0;s<samples;s++){
      var f=(s/(samples-1)-0.5);
      var sx,sy;
      if(spin){
        var th=f*amt;
        var cs=Math.cos(th), sn=Math.sin(th);
        sx=Math.round(cx+px*cs-py*sn); sy=Math.round(cy+px*sn+py*cs);
      } else {
        var k=1+f*amt;
        sx=Math.round(cx+px*k); sy=Math.round(cy+py*k);
      }
      sx=sx<0?0:sx>=size?size-1:sx; sy=sy<0?0:sy>=size?size-1:sy;
      var si=(sy*size+sx)*4;
      r+=buf[si];g2+=buf[si+1];b+=buf[si+2];a+=buf[si+3];
    }
    var di=(y*size+x)*4;
    out[di]=r/samples;out[di+1]=g2/samples;out[di+2]=b/samples;out[di+3]=a/samples;
  }
  return out;
}
// Vignette: darken (or tint) toward the corners.
function nodeVignette(buf,size,p){
  if(!buf)return new Float32Array(0);
  var out=new Float32Array(size*size*4);
  var amt=p.amount!=null?p.amount:0.6;
  var rad=p.radius!=null?p.radius:0.75;
  var soft=Math.max(0.001,p.softness!=null?p.softness:0.45);
  var round=p.roundness!=null?p.roundness:1;
  var col=hexF(p.color||"#000000");
  var cx=p.x!=null?p.x:0.5, cy=p.y!=null?p.y:0.5;
  for(var y=0;y<size;y++)for(var x=0;x<size;x++){
    var u=((x+0.5)/size-cx)*2, v=((y+0.5)/size-cy)*2;
    var d;
    if(round>=1)d=Math.sqrt(u*u+v*v);
    else d=Math.pow(Math.pow(Math.abs(u),2/Math.max(0.05,round))+Math.pow(Math.abs(v),2/Math.max(0.05,round)),Math.max(0.05,round)/2);
    var t=Math.max(0,Math.min(1,(d-rad)/soft))*amt;
    var i=(y*size+x)*4;
    out[i]=buf[i]+(col[0]-buf[i])*t;
    out[i+1]=buf[i+1]+(col[1]-buf[i+1])*t;
    out[i+2]=buf[i+2]+(col[2]-buf[i+2])*t;
    out[i+3]=buf[i+3];
  }
  return out;
}
// Math: combine two inputs per channel.
function nodeMath(a,b,size,p){
  var n=size*size*4, out=new Float32Array(n);
  var op=p.op||"add";
  var k=p.factor!=null?p.factor:1;
  var clamp=p.clamp!==false;
  for(var i=0;i<n;i+=4){
    for(var ch=0;ch<3;ch++){
      var x=a?a[i+ch]:0, y=b?b[i+ch]:0, r;
      if(op==="add")r=x+y*k;
      else if(op==="subtract")r=x-y*k;
      else if(op==="multiply")r=x*(y*k);
      else if(op==="divide")r=Math.abs(y)<1e-6?x:x/(y*k||1e-6);
      else if(op==="min")r=Math.min(x,y);
      else if(op==="max")r=Math.max(x,y);
      else if(op==="difference")r=Math.abs(x-y)*k;
      else if(op==="screen")r=1-(1-x)*(1-y*k);
      else if(op==="power")r=Math.pow(Math.max(0,x),Math.max(0.001,y*k+0.001));
      else r=x;
      out[i+ch]=clamp?(r<0?0:r>1?1:r):r;
    }
    out[i+3]=a?a[i+3]:(b?b[i+3]:1);
  }
  return out;
}
// Mix: blend A and B by a constant factor, or per-pixel by a mask input.
function nodeMix(a,b,mask,size,p){
  var n=size*size*4, out=new Float32Array(n);
  var f=p.factor!=null?p.factor:0.5;
  var useMask=!!mask && (p.useMask!==false);
  var invM=!!p.invertMask;
  for(var i=0;i<n;i+=4){
    var t=f;
    if(useMask){
      t=mask[i]*0.299+mask[i+1]*0.587+mask[i+2]*0.114;
      if(invM)t=1-t;
      t*=f===0?0:1; if(p.factor!=null)t*=p.factor;
    }
    if(t<0)t=0; if(t>1)t=1;
    for(var ch=0;ch<4;ch++){
      var x=a?a[i+ch]:0, y=b?b[i+ch]:0;
      out[i+ch]=x+(y-x)*t;
    }
  }
  return out;
}
// Polar / cartesian remap. Turning stripes into rays, or a gradient into a
// tunnel, is a coordinate change: this is the node that unlocks starbursts,
// spirals and radial streaks from ordinary patterns.
function nodePolar(buf,size,p){
  if(!buf)return new Float32Array(0);
  var out=new Float32Array(size*size*4);
  var toPolar=(p.mode||"toPolar")==="toPolar";
  var cx=(p.x!=null?p.x:0.5), cy=(p.y!=null?p.y:0.5);
  var spin=(p.spin||0)*Math.PI/180;
  var zoom=p.zoom!=null?p.zoom:1; if(Math.abs(zoom)<1e-4)zoom=1e-4;
  var rep=Math.max(1,Math.round(p.repeat||1));
  for(var y=0;y<size;y++)for(var x=0;x<size;x++){
    var u=(x+0.5)/size, v=(y+0.5)/size, su, sv;
    if(toPolar){
      // destination x = angle, destination y = radius
      var du=u-cx, dv=v-cy;
      var ang=Math.atan2(dv,du)+spin;
      var rad=Math.sqrt(du*du+dv*dv)*2/zoom;
      su=((ang/(Math.PI*2))*rep+0.5); su=su-Math.floor(su);
      sv=rad; sv=sv<0?0:sv>1?1:sv;
    } else {
      // inverse: read the image as if x were the angle and y the radius
      var a2=(u-0.5)*Math.PI*2/rep-spin;
      var r2=v*zoom*0.5;
      su=cx+Math.cos(a2)*r2; sv=cy+Math.sin(a2)*r2;
      su=su-Math.floor(su); sv=sv-Math.floor(sv);
    }
    var sx=Math.min(size-1,Math.max(0,Math.round(su*size-0.5)));
    var sy=Math.min(size-1,Math.max(0,Math.round(sv*size-0.5)));
    var si=(sy*size+sx)*4, di=(y*size+x)*4;
    out[di]=buf[si];out[di+1]=buf[si+1];out[di+2]=buf[si+2];out[di+3]=buf[si+3];
  }
  return out;
}
// ══ MORPHOLOGY / ANALYSIS / GRADE NODES ═══════════════════════════
// Expand / Shrink (dilate / erode). A positive amount grows the filled area,
// negative shrinks it. Works on alpha or luminance. Diamond or square kernel.
function nodeMorph(buf,size,p){
  if(!buf)return new Float32Array(0);
  var amtRaw=p.amount!=null?p.amount:1;
  var amt=amtRaw===0?0:(amtRaw>0?pxS1(amtRaw,size):-pxS1(-amtRaw,size));
  var n=size*size*4; var out=new Float32Array(n);
  if(amt===0){ out.set(buf); return out; }
  var useAlpha=(p.source||"alpha")==="alpha";
  var diamond=(p.shape||"diamond")==="diamond";
  var grow=amt>0, r=Math.abs(amt);
  // value field we are growing/shrinking
  var fld=new Float32Array(size*size);
  for(var i=0;i<size*size;i++){
    var i4=i*4;
    fld[i]=useAlpha?buf[i4+3]:(buf[i4]*0.299+buf[i4+1]*0.587+buf[i4+2]*0.114);
  }
  // separable-ish: do r passes of a 1-step max (dilate) or min (erode)
  var cur=fld, next=new Float32Array(size*size);
  for(var pass=0;pass<r;pass++){
    for(var y=0;y<size;y++)for(var x=0;x<size;x++){
      var best=cur[y*size+x];
      for(var dy=-1;dy<=1;dy++)for(var dx=-1;dx<=1;dx++){
        if(dx===0&&dy===0)continue;
        if(diamond&&Math.abs(dx)+Math.abs(dy)>1)continue;
        var nx=x+dx, ny=y+dy;
        if(nx<0||ny<0||nx>=size||ny>=size)continue;
        var v=cur[ny*size+nx];
        if(grow){ if(v>best)best=v; } else { if(v<best)best=v; }
      }
      next[y*size+x]=best;
    }
    var tmp=cur; cur=next; next=tmp;
  }
  // write back: alpha mode keeps colour and rewrites alpha, luma mode outputs gray
  for(var j=0;j<size*size;j++){
    var o=j*4, v2=cur[j];
    if(useAlpha){ out[o]=buf[o];out[o+1]=buf[o+1];out[o+2]=buf[o+2];out[o+3]=v2; }
    else { out[o]=out[o+1]=out[o+2]=v2; out[o+3]=buf[o+3]; }
  }
  return out;
}
// Edge detect (Sobel or Laplacian) on luminance, with threshold and optional
// overlay of the edges onto the original.
function nodeEdgeDetect(buf,size,p){
  if(!buf)return new Float32Array(0);
  var n=size*size*4; var out=new Float32Array(n);
  var amt=p.amount!=null?p.amount:1;
  var thr=p.threshold!=null?p.threshold:0;
  var lap=(p.method||"sobel")==="laplacian";
  var overlay=!!p.overlay;
  var inv=!!p.invert;
  var col=hexF(p.color||"#ffffff");
  function lum(x,y){ x=x<0?0:x>=size?size-1:x; y=y<0?0:y>=size?size-1:y; var i=(y*size+x)*4; return buf[i]*0.299+buf[i+1]*0.587+buf[i+2]*0.114; }
  for(var y2=0;y2<size;y2++)for(var x2=0;x2<size;x2++){
    var e;
    if(lap){
      e=Math.abs(lum(x2,y2)*4-lum(x2-1,y2)-lum(x2+1,y2)-lum(x2,y2-1)-lum(x2,y2+1));
    } else {
      var gx=(lum(x2-1,y2-1)+2*lum(x2-1,y2)+lum(x2-1,y2+1))-(lum(x2+1,y2-1)+2*lum(x2+1,y2)+lum(x2+1,y2+1));
      var gy=(lum(x2-1,y2-1)+2*lum(x2,y2-1)+lum(x2+1,y2-1))-(lum(x2-1,y2+1)+2*lum(x2,y2+1)+lum(x2+1,y2+1));
      e=Math.sqrt(gx*gx+gy*gy);
    }
    e*=amt;
    if(thr>0)e=e>=thr?e:0;
    if(e<0)e=0; if(e>1)e=1;
    if(inv)e=1-e;
    var o=(y2*size+x2)*4;
    if(overlay){
      out[o]=buf[o]*(1-e)+col[0]*e;
      out[o+1]=buf[o+1]*(1-e)+col[1]*e;
      out[o+2]=buf[o+2]*(1-e)+col[2]*e;
    } else {
      out[o]=col[0]*e; out[o+1]=col[1]*e; out[o+2]=col[2]*e;
    }
    out[o+3]=buf[o+3];
  }
  return out;
}
// Island / flood fill: label connected regions of "filled" pixels and act on
// them. Modes: colorize each island, drop islands smaller than minSize, keep
// only the largest, or fill enclosed holes.
function nodeIsland(buf,size,p){
  if(!buf)return new Float32Array(0);
  var n=size*size*4; var out=new Float32Array(n);
  var thr=p.threshold!=null?p.threshold:0.5;
  var useAlpha=(p.source||"luma")==="alpha";
  var conn8=(p.connectivity||4)==8;
  var mode=p.mode||"colorize";
  var minSize=Math.max(1,Math.round((p.minSize!=null?p.minSize:8)*(_pxScaleOn?Math.pow(size/PX_REF,2):1)));
  var np=size*size;
  var fill=new Uint8Array(np);
  for(var i=0;i<np;i++){
    var i4=i*4;
    var v=useAlpha?buf[i4+3]:(buf[i4]*0.299+buf[i4+1]*0.587+buf[i4+2]*0.114);
    fill[i]=v>=thr?1:0;
  }
  // for fillHoles we flood the BACKGROUND from the border; anything unreached
  // is an enclosed hole and gets filled.
  var target=(mode==="fillHoles")?0:1;
  var label=new Int32Array(np); for(var l=0;l<np;l++)label[l]=-1;
  var sizes=[]; var nextLabel=0;
  var stack=new Int32Array(np); 
  for(var s=0;s<np;s++){
    if(fill[s]!==target||label[s]!==-1)continue;
    var sp=0; stack[sp++]=s; label[s]=nextLabel; var count=0;
    while(sp>0){
      var cur=stack[--sp]; count++;
      var cx=cur%size, cy=(cur-cx)/size;
      for(var d=0;d<(conn8?8:4);d++){
        var dx=[1,-1,0,0,1,1,-1,-1][d], dy=[0,0,1,-1,1,-1,1,-1][d];
        var nx=cx+dx, ny=cy+dy;
        if(nx<0||ny<0||nx>=size||ny>=size)continue;
        var ni=ny*size+nx;
        if(fill[ni]!==target||label[ni]!==-1)continue;
        label[ni]=nextLabel; stack[sp++]=ni;
      }
    }
    sizes.push(count); nextLabel++;
  }
  // find the largest island
  var largest=-1,largestN=-1;
  for(var q=0;q<sizes.length;q++)if(sizes[q]>largestN){largestN=sizes[q];largest=q;}
  // pseudo-random but stable colour per label
  function labColor(k){
    var h=(k*2654435761)>>>0;
    return [((h>>>16)&255)/255, ((h>>>8)&255)/255, (h&255)/255];
  }
  // is this background label touching the border? (for fillHoles)
  var touches={};
  if(mode==="fillHoles"){
    for(var b=0;b<size;b++){
      var t1=label[b], t2=label[(size-1)*size+b], t3=label[b*size], t4=label[b*size+size-1];
      if(t1>=0)touches[t1]=1; if(t2>=0)touches[t2]=1; if(t3>=0)touches[t3]=1; if(t4>=0)touches[t4]=1;
    }
  }
  for(var j=0;j<np;j++){
    var o=j*4, lb=label[j];
    if(mode==="colorize"){
      if(fill[j]&&lb>=0){ var cc=labColor(lb); out[o]=cc[0];out[o+1]=cc[1];out[o+2]=cc[2];out[o+3]=1; }
      else { out[o]=out[o+1]=out[o+2]=0; out[o+3]=buf[o+3]; }
    } else if(mode==="removeSmall"){
      var keep=fill[j]&&lb>=0&&sizes[lb]>=minSize;
      if(keep){ out[o]=buf[o];out[o+1]=buf[o+1];out[o+2]=buf[o+2];out[o+3]=buf[o+3]; }
      else { out[o]=out[o+1]=out[o+2]=0; out[o+3]=useAlpha?0:buf[o+3]; }
    } else if(mode==="keepLargest"){
      var keep2=fill[j]&&lb===largest;
      if(keep2){ out[o]=buf[o];out[o+1]=buf[o+1];out[o+2]=buf[o+2];out[o+3]=buf[o+3]; }
      else { out[o]=out[o+1]=out[o+2]=0; out[o+3]=useAlpha?0:buf[o+3]; }
    } else { // fillHoles
      var isHole=(fill[j]===0)&&lb>=0&&!touches[lb];
      if(fill[j]||isHole){ out[o]=1;out[o+1]=1;out[o+2]=1;out[o+3]=1; }
      else { out[o]=0;out[o+1]=0;out[o+2]=0;out[o+3]=buf[o+3]; }
    }
  }
  return out;
}
// Master colour grade: one node with the whole correction chain, applied in a
// sensible order (exposure -> contrast -> lift/gamma/gain -> temp/tint ->
// hue/sat/vibrance).
function nodeColorGrade(buf,p){
  if(!buf)return new Float32Array(0);
  var n=buf.length; var out=new Float32Array(n);
  var expo=p.exposure!=null?p.exposure:0;
  var con=p.contrast!=null?p.contrast:1;
  var lift=p.lift!=null?p.lift:0;
  var gam=p.gamma!=null?p.gamma:1; var ig=gam>0?1/gam:1;
  var gain=p.gain!=null?p.gain:1;
  var temp=p.temperature!=null?p.temperature:0;
  var tint=p.tint!=null?p.tint:0;
  var sat=p.saturation!=null?p.saturation:1;
  var vib=p.vibrance!=null?p.vibrance:0;
  var hue=(p.hueShift||0)/360;
  var expMul=Math.pow(2,expo);
  for(var i=0;i<n;i+=4){
    var r=buf[i],g=buf[i+1],b=buf[i+2];
    // exposure (stops)
    r*=expMul; g*=expMul; b*=expMul;
    // contrast around mid grey
    r=(r-0.5)*con+0.5; g=(g-0.5)*con+0.5; b=(b-0.5)*con+0.5;
    // lift / gamma / gain
    if(lift!==0){ r=r+lift*(1-r); g=g+lift*(1-g); b=b+lift*(1-b); }
    if(gam!==1){ r=r<0?0:Math.pow(r,ig); g=g<0?0:Math.pow(g,ig); b=b<0?0:Math.pow(b,ig); }
    if(gain!==1){ r*=gain; g*=gain; b*=gain; }
    // temperature (warm/cool) and tint (green/magenta)
    if(temp!==0){ r+=temp*0.15; b-=temp*0.15; }
    if(tint!==0){ g+=tint*0.15; r-=tint*0.05; b-=tint*0.05; }
    // clamp before hue/sat work
    r=r<0?0:r>1?1:r; g=g<0?0:g>1?1:g; b=b<0?0:b>1?1:b;
    if(hue!==0||sat!==1||vib!==0){
      var mx=Math.max(r,g,b), mn=Math.min(r,g,b), dd=mx-mn;
      var hh=0, ss=mx>0?dd/mx:0, vv=mx;
      if(dd>0){
        if(mx===r)hh=((g-b)/dd)%6;
        else if(mx===g)hh=(b-r)/dd+2;
        else hh=(r-g)/dd+4;
        hh/=6; if(hh<0)hh+=1;
      }
      hh=(hh+hue)%1; if(hh<0)hh+=1;
      // vibrance lifts low-saturation pixels more than already-saturated ones
      if(vib!==0)ss=ss+vib*(1-ss)*0.8;
      ss*=sat;
      if(ss<0)ss=0; if(ss>1)ss=1;
      var hi=Math.floor(hh*6)%6, f=hh*6-Math.floor(hh*6);
      var pv=vv*(1-ss), qv=vv*(1-f*ss), tv=vv*(1-(1-f)*ss);
      if(hi===0){r=vv;g=tv;b=pv;} else if(hi===1){r=qv;g=vv;b=pv;}
      else if(hi===2){r=pv;g=vv;b=tv;} else if(hi===3){r=pv;g=qv;b=vv;}
      else if(hi===4){r=tv;g=pv;b=vv;} else {r=vv;g=pv;b=qv;}
    }
    out[i]=r<0?0:r>1?1:r; out[i+1]=g<0?0:g>1?1:g; out[i+2]=b<0?0:b>1?1:b; out[i+3]=buf[i+3];
  }
  return out;
}
// Text: render a string into the texture. Rendering needs a canvas, so results
// are cached by a signature of the text settings. In a headless environment
// (tests) it returns a transparent buffer instead of throwing.
var _textCache={}; var _textCacheOrder=[];
function nodeText(size,p){
  var key=size+"|"+(p.text||"")+"|"+(p.fontFamily||"")+"|"+(p.fontSize||0)+"|"+(p.bold?1:0)+"|"+
    (p.italic?1:0)+"|"+(p.align||"")+"|"+(p.x||0)+"|"+(p.y||0)+"|"+(p.color||"")+"|"+
    (p.bgColor||"")+"|"+(p.transparent?1:0)+"|"+(p.letterSpacing||0);
  if(_textCache[key])return _textCache[key];
  var out=new Float32Array(size*size*4);
  if(typeof document==="undefined"||!document.createElement)return out; // headless
  try{
    var cv=document.createElement("canvas"); cv.width=size; cv.height=size;
    var ctx=cv.getContext("2d");
    if(!p.transparent){
      var bg=hexF(p.bgColor||"#000000");
      ctx.fillStyle="rgb("+Math.round(bg[0]*255)+","+Math.round(bg[1]*255)+","+Math.round(bg[2]*255)+")";
      ctx.fillRect(0,0,size,size);
    } else { ctx.clearRect(0,0,size,size); }
    var fs=Math.max(1,Math.round((p.fontSize!=null?p.fontSize:24)/100*size));
    var fam=p.fontFamily||"monospace";
    ctx.font=(p.italic?"italic ":"")+(p.bold?"bold ":"")+fs+"px "+fam;
    ctx.textAlign=p.align||"center";
    ctx.textBaseline="middle";
    ctx.fillStyle=p.color||"#ffffff";
    var px=(p.x!=null?p.x:0.5)*size, py=(p.y!=null?p.y:0.5)*size;
    var lines=String(p.text!=null?p.text:"TEXT").split("\n");
    var lh=fs*1.15;
    var startY=py-(lines.length-1)*lh/2;
    var ls=p.letterSpacing||0;
    for(var li=0;li<lines.length;li++){
      var ln=lines[li];
      if(ls===0){ ctx.fillText(ln,px,startY+li*lh); }
      else {
        // manual letter spacing (not supported on old canvas)
        var total=0, ws=[];
        for(var ci=0;ci<ln.length;ci++){var w=ctx.measureText(ln[ci]).width;ws.push(w);total+=w+ls*fs;}
        total-=ls*fs;
        var cx=px; 
        if((p.align||"center")==="center")cx=px-total/2;
        else if((p.align||"center")==="right")cx=px-total;
        var savedAlign=ctx.textAlign; ctx.textAlign="left";
        for(var ci2=0;ci2<ln.length;ci2++){ ctx.fillText(ln[ci2],cx,startY+li*lh); cx+=ws[ci2]+ls*fs; }
        ctx.textAlign=savedAlign;
      }
    }
    var img=ctx.getImageData(0,0,size,size);
    for(var i=0;i<size*size;i++){
      out[i*4]=img.data[i*4]/255; out[i*4+1]=img.data[i*4+1]/255;
      out[i*4+2]=img.data[i*4+2]/255; out[i*4+3]=img.data[i*4+3]/255;
    }
  }catch(e){ /* leave the transparent buffer */ }
  _textCache[key]=out; _textCacheOrder.push(key);
  while(_textCacheOrder.length>24){ delete _textCache[_textCacheOrder.shift()]; }
  return out;
}
// ══ RETRO / PIXEL-ART NODES ═══════════════════════════════════════
// Classic hardware palettes. Values are the real ones used by those systems.
var RETRO_PALETTES = {
  gameboy: ["#0f380f","#306230","#8bac0f","#9bbc0f"],
  gray4:   ["#000000","#555555","#aaaaaa","#ffffff"],
  mono:    ["#000000","#ffffff"],
  cga:     ["#000000","#55ffff","#ff55ff","#ffffff"],
  pico8:   ["#000000","#1d2b53","#7e2553","#008751","#ab5236","#5f574f","#c2c3c7","#fff1e8",
            "#ff004d","#ffa300","#ffec27","#00e436","#29adff","#83769c","#ff77a8","#ffccaa"],
  c64:     ["#000000","#ffffff","#880000","#aaffee","#cc44cc","#00cc55","#0000aa","#eeee77",
            "#dd8855","#664400","#ff7777","#333333","#777777","#aaff66","#0088ff","#bbbbbb"],
  nes:     ["#000000","#fcfcfc","#f8f8f8","#bcbcbc","#7c7c7c","#a4e4fc","#3cbcfc","#0078f8",
            "#0000fc","#b8b8f8","#6888fc","#f8b8f8","#f878f8","#f85898","#f8d878","#f87858"]
};
// 4x4 Bayer matrix for ordered dithering before palette snapping.
var BAYER4 = [[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]];

// Palette: snap every pixel to the nearest colour of a retro palette, with
// optional ordered dithering so gradients break up into classic pixel patterns.
function nodePalette(buf,size,p){
  if(!buf)return new Float32Array(0);
  var names=RETRO_PALETTES[p.palette]?p.palette:"gameboy";
  var hexes=RETRO_PALETTES[names];
  var pal=[]; for(var pi=0;pi<hexes.length;pi++)pal.push(hexF(hexes[pi]));
  var dith=p.dither!=null?p.dither:0;
  var n=size*size*4; var out=new Float32Array(n);
  for(var y=0;y<size;y++)for(var x=0;x<size;x++){
    var i=(y*size+x)*4;
    // ordered-dither offset in [-0.5,0.5) scaled by the dither amount
    var t=((BAYER4[y&3][x&3]+0.5)/16-0.5)*dith;
    var r=buf[i]+t, gg=buf[i+1]+t, b=buf[i+2]+t;
    var best=0,bestD=Infinity;
    for(var k=0;k<pal.length;k++){
      var dr=r-pal[k][0], dg=gg-pal[k][1], db=b-pal[k][2];
      var d=dr*dr+dg*dg+db*db;
      if(d<bestD){bestD=d;best=k;}
    }
    out[i]=pal[best][0]; out[i+1]=pal[best][1]; out[i+2]=pal[best][2]; out[i+3]=buf[i+3];
  }
  return out;
}
// Pixelate: collapse the image into blocks. "average" reads the block mean
// (smoother), "nearest" samples the block's top-left pixel (crisper, true to
// how a low-res sprite would look).
function nodePixelate(buf,size,p){
  if(!buf)return new Float32Array(0);
  var bs=pxS1(p.blockSize!=null?p.blockSize:8,size);
  var avg=(p.mode||"average")==="average";
  var n=size*size*4; var out=new Float32Array(n);
  for(var by=0;by<size;by+=bs)for(var bx=0;bx<size;bx+=bs){
    var r=0,g2=0,b=0,a=0;
    if(avg){
      var cnt=0;
      for(var yy=by;yy<by+bs&&yy<size;yy++)for(var xx=bx;xx<bx+bs&&xx<size;xx++){
        var j=(yy*size+xx)*4; r+=buf[j];g2+=buf[j+1];b+=buf[j+2];a+=buf[j+3];cnt++;
      }
      if(cnt){r/=cnt;g2/=cnt;b/=cnt;a/=cnt;}
    } else {
      var j0=(by*size+bx)*4; r=buf[j0];g2=buf[j0+1];b=buf[j0+2];a=buf[j0+3];
    }
    for(var y2=by;y2<by+bs&&y2<size;y2++)for(var x2=bx;x2<bx+bs&&x2<size;x2++){
      var o=(y2*size+x2)*4; out[o]=r;out[o+1]=g2;out[o+2]=b;out[o+3]=a;
    }
  }
  return out;
}
// Outline: draw a hard border around the "filled" area of a sprite, the way a
// pixel artist would. Fill is decided by alpha or by luminance threshold.
function nodeOutline(buf,size,p){
  if(!buf)return new Float32Array(0);
  var n=size*size*4; var out=new Float32Array(n);
  var th=p.threshold!=null?p.threshold:0.5;
  var thick=pxS1(p.thickness!=null?p.thickness:1,size);
  var useAlpha=(p.source||"alpha")==="alpha";
  var col=hexF(p.color||"#000000");
  var inner=(p.mode||"outer")==="inner";
  // filled mask
  var fill=new Uint8Array(size*size);
  for(var i2=0;i2<size*size;i2++){
    var i4=i2*4;
    var v=useAlpha?buf[i4+3]:(buf[i4]*0.299+buf[i4+1]*0.587+buf[i4+2]*0.114);
    fill[i2]=v>=th?1:0;
  }
  function filled(x,y){ if(x<0||y<0||x>=size||y>=size)return 0; return fill[y*size+x]; }
  for(var y=0;y<size;y++)for(var x=0;x<size;x++){
    var idx=y*size+x, o=idx*4;
    var me=fill[idx];
    var isEdge=false;
    // outer: I am empty and a filled pixel is within `thick`
    // inner: I am filled and an empty pixel is within `thick`
    for(var dy=-thick;dy<=thick&&!isEdge;dy++)for(var dx=-thick;dx<=thick;dx++){
      if(dx===0&&dy===0)continue;
      if(Math.abs(dx)+Math.abs(dy)>thick)continue; // diamond kernel = cleaner pixel outline
      var nb=filled(x+dx,y+dy);
      if(!inner && !me && nb){isEdge=true;break;}
      if(inner && me && !nb){isEdge=true;break;}
    }
    if(isEdge){ out[o]=col[0];out[o+1]=col[1];out[o+2]=col[2];out[o+3]=1; }
    else { out[o]=buf[o];out[o+1]=buf[o+1];out[o+2]=buf[o+2];out[o+3]=buf[o+3]; }
  }
  return out;
}
// Scanlines: CRT look. Darkens rows on a spacing, optional RGB stripe mask and
// a corner vignette.
function nodeScanlines(buf,size,p){
  if(!buf)return new Float32Array(0);
  var n=size*size*4; var out=new Float32Array(n);
  var spacing=Math.max(2,pxS1(p.spacing!=null?p.spacing:3,size));
  var dark=p.darkness!=null?p.darkness:0.4;
  var thick=pxS1(p.thickness!=null?p.thickness:1,size);
  var mask=!!p.rgbMask;
  var vig=p.vignette!=null?p.vignette:0;
  var half=size/2;
  for(var y=0;y<size;y++)for(var x=0;x<size;x++){
    var i=(y*size+x)*4;
    var r=buf[i],g2=buf[i+1],b=buf[i+2];
    // scanline darkening
    if((y%spacing)<thick){ r*=(1-dark); g2*=(1-dark); b*=(1-dark); }
    // RGB subpixel stripes
    if(mask){
      var ph=x%3;
      if(ph===0){ g2*=0.75; b*=0.75; }
      else if(ph===1){ r*=0.75; b*=0.75; }
      else { r*=0.75; g2*=0.75; }
    }
    // vignette
    if(vig>0){
      var dxv=(x-half)/half, dyv=(y-half)/half;
      var dist=Math.sqrt(dxv*dxv+dyv*dyv)/1.4142;
      var f=1-vig*dist*dist;
      if(f<0)f=0; r*=f; g2*=f; b*=f;
    }
    out[i]=r<0?0:r>1?1:r; out[i+1]=g2<0?0:g2>1?1:g2; out[i+2]=b<0?0:b>1?1:b; out[i+3]=buf[i+3];
  }
  return out;
}
// Alpha split: emit multiple named outputs at once — rgb (colour, opaque), and
// r/g/b/a as grayscale. Returns an object keyed by output-port name.
function nodeAlphaSplit(buf,size){
  var n=size*size*4;
  var rgb=new Float32Array(n), r=new Float32Array(n), g=new Float32Array(n), b=new Float32Array(n), a=new Float32Array(n);
  for(var i=0;i<n;i+=4){
    var R=buf?buf[i]:0, G=buf?buf[i+1]:0, B=buf?buf[i+2]:0, A=buf?(buf[i+3]!=null?buf[i+3]:1):1;
    rgb[i]=R;rgb[i+1]=G;rgb[i+2]=B;rgb[i+3]=1;
    r[i]=r[i+1]=r[i+2]=R;r[i+3]=1;
    g[i]=g[i+1]=g[i+2]=G;g[i+3]=1;
    b[i]=b[i+1]=b[i+2]=B;b[i+3]=1;
    a[i]=a[i+1]=a[i+2]=A;a[i+3]=1;
  }
  // "out" mirrors rgb so a plain connection still works.
  return {out:rgb, rgb:rgb, r:r, g:g, b:b, a:a};
}
// Flipbook: extract the current frame from the imported sheet, resampled to size.
// The current frame is resolved from the playback sequence + offset.
function nodeFlipbook(node,size){
  var p=node.params; var sheet=p.sheet;
  if(!sheet||!sheet.frames||!sheet.frames.length){
    // no sheet imported yet → mid-grey so the node is visibly "empty"
    var nb=new Float32Array(size*size*4);
    for(var k=0;k<size*size;k++){nb[k*4]=nb[k*4+1]=nb[k*4+2]=0.12;nb[k*4+3]=1;}
    return nb;
  }
  var seq=fbSequence({totalFrames:sheet.frames.length,
    rangeIn:p.rangeIn,rangeOut:p.rangeOut,frameStep:p.frameStep,playMode:p.playMode});
  if(!seq.length)seq=[0];
  var idx=seq[((Math.round(p.offset||0)%seq.length)+seq.length)%seq.length];
  var frame=sheet.frames[idx]||sheet.frames[0];
  var fs=sheet.frameSize;
  if(fs===size)return frame.slice();
  // resample (nearest) to the working size
  var out=new Float32Array(size*size*4);
  for(var y=0;y<size;y++){
    var sy=Math.min(fs-1,(y/size*fs)|0);
    for(var x=0;x<size;x++){
      var sx=Math.min(fs-1,(x/size*fs)|0);
      var si=(sy*fs+sx)*4, di=(y*size+x)*4;
      out[di]=frame[si];out[di+1]=frame[si+1];out[di+2]=frame[si+2];out[di+3]=frame[si+3];
    }
  }
  return out;
}
var NODE_EVALUATORS={
  source:    function(node,inputs,size){ return nodeRenderSource(node,size); },
  adjust:    function(node,inputs,size){ return nodeAdjust(inputs.in||new Float32Array(size*size*4),node.params); },
  blend:     function(node,inputs,size){ return nodeBlend(inputs.a,inputs.b,node.params.mode||"normal",node.params.opacity); },
  mask:      function(node,inputs,size){ return nodeMaskMix(inputs.a,inputs.b,inputs.mask,node.params); },
  blur:      function(node,inputs,size){ return nodeBlur(inputs.in||new Float32Array(size*size*4),size,node.params.radius!=null?node.params.radius:3); },
  glow:      function(node,inputs,size){ return nodeGlow(inputs.in||new Float32Array(size*size*4),size,node.params); },
  gradmap:   function(node,inputs,size){ return nodeGradMap(inputs.in||new Float32Array(size*size*4),size,node.params); },
  filter:    function(node,inputs,size){ return nodeFilterChain(inputs.in||new Float32Array(size*size*4),size,node.params.filters||[]); },
  warp:      function(node,inputs,size){ return nodeWarp(inputs.in||new Float32Array(size*size*4),size,node.params); },
  transform: function(node,inputs,size){ return nodeTransform(inputs.in||new Float32Array(size*size*4),size,node.params); },
  alphaMerge:function(node,inputs,size){ return nodeAlphaMerge(inputs.rgb,inputs.alpha,size); },
  alphaSplit:function(node,inputs,size){ return nodeAlphaSplit(inputs.in||new Float32Array(size*size*4),size); },
  flipbook:  function(node,inputs,size){ return nodeFlipbook(node,size); },
  // In live preview, Pack just passes the current processed frame through; the
  // real re-tiling of all frames happens in bakeFlipbook (export / bake button).
  flipbookPack: function(node,inputs,size){ return inputs.in||new Float32Array(size*size*4); },
  reroute: function(node,inputs,size){ return inputs.in||new Float32Array(size*size*4); },
  levels: function(node,inputs,size){ return nodeLevels(inputs.in||new Float32Array(size*size*4),node.params); },
  threshold: function(node,inputs,size){ return nodeThreshold(inputs.in||new Float32Array(size*size*4),node.params); },
  posterize: function(node,inputs,size){ return nodePosterize(inputs.in||new Float32Array(size*size*4),node.params); },
  sharpen: function(node,inputs,size){ return nodeSharpen(inputs.in||new Float32Array(size*size*4),size,node.params); },
  emboss: function(node,inputs,size){ return nodeEmboss(inputs.in||new Float32Array(size*size*4),size,node.params); },
  normalmap: function(node,inputs,size){ return nodeNormalMap(inputs.in||new Float32Array(size*size*4),size,node.params); },
  pixelate: function(node,inputs,size){ return nodePixelate(inputs.in||new Float32Array(size*size*4),size,node.params); },
  palette: function(node,inputs,size){ return nodePalette(inputs.in||new Float32Array(size*size*4),size,node.params); },
  outline: function(node,inputs,size){ return nodeOutline(inputs.in||new Float32Array(size*size*4),size,node.params); },
  scanlines: function(node,inputs,size){ return nodeScanlines(inputs.in||new Float32Array(size*size*4),size,node.params); },
  text: function(node,inputs,size){ return nodeText(size,node.params); },
  morph: function(node,inputs,size){ return nodeMorph(inputs.in||new Float32Array(size*size*4),size,node.params); },
  edgedetect: function(node,inputs,size){ return nodeEdgeDetect(inputs.in||new Float32Array(size*size*4),size,node.params); },
  island: function(node,inputs,size){ return nodeIsland(inputs.in||new Float32Array(size*size*4),size,node.params); },
  colorgrade: function(node,inputs,size){ return nodeColorGrade(inputs.in||new Float32Array(size*size*4),node.params); },
  shape: function(node,inputs,size){ return nodeShape(size,node.params); },
  gradient: function(node,inputs,size){ return nodeGradient(size,node.params); },
  checker: function(node,inputs,size){ return nodeChecker(size,node.params); },
  stripes: function(node,inputs,size){ return nodeStripes(size,node.params); },
  bricks: function(node,inputs,size){ return nodeBricks(size,node.params); },
  mirror: function(node,inputs,size){ return nodeMirror(inputs.in||new Float32Array(size*size*4),size,node.params); },
  offsetnode: function(node,inputs,size){ return nodeOffset(inputs.in||new Float32Array(size*size*4),size,node.params); },
  dirblur: function(node,inputs,size){ return nodeDirBlur(inputs.in||new Float32Array(size*size*4),size,node.params); },
  radialblur: function(node,inputs,size){ return nodeRadialBlur(inputs.in||new Float32Array(size*size*4),size,node.params); },
  vignette: function(node,inputs,size){ return nodeVignette(inputs.in||new Float32Array(size*size*4),size,node.params); },
  mathnode: function(node,inputs,size){ return nodeMath(inputs.a,inputs.b,size,node.params); },
  mix: function(node,inputs,size){ return nodeMix(inputs.a,inputs.b,inputs.mask,size,node.params); },
  polar: function(node,inputs,size){ return nodePolar(inputs.in||new Float32Array(size*size*4),size,node.params); },
  output:    function(node,inputs,size){ return inputs.in||null; }
};
function makeNodeEvaluator(size){
  return function(node,inputs){
    var fn=NODE_EVALUATORS[node.type];
    if(fn)return fn(node,inputs,size);
    // unknown type: pass through first input or black
    return inputs.in||new Float32Array(size*size*4);
  };
}

// ═══ UI ATOMS ═══════════════════════════════════════════════════
var LS={fontSize:9,color:"#555",letterSpacing:1.2,textTransform:"uppercase",marginBottom:3,display:"block"};
var SS={width:"100%",background:"#161616",border:"1px solid #252525",color:"#ccc",padding:"6px 8px",fontSize:12,fontFamily:"monospace",borderRadius:3,boxSizing:"border-box"};

// ─── Per-slider custom bounds (double-click label to edit) ──────
var _gBounds={};
function gBoundsKey(label){return label.toLowerCase().replace(/[^a-z0-9]+/g,"_");}

function Slider(p){
  var addToAnim=useContext(AnimTrackContext);
  var s=p.step!=null?p.step:0.01;
  var key=gBoundsKey(p.label);
  var _rev=useState(0);var setRev=_rev[1];
  var ov=_gBounds[key];
  var bMin=ov&&ov.min!=null?ov.min:p.min;
  var bMax=ov&&ov.max!=null?ov.max:p.max;
  var hasCustom=!!ov;
  var val=p.value<bMin?bMin:p.value>bMax?bMax:p.value;
  var d=p.fmt?p.fmt(p.value):(s<1?p.value.toFixed(2):""+Math.round(p.value));
  var _ed=useState(false);var editing=_ed[0],setEditing=_ed[1];
  var _lo=useState(bMin);var editMin=_lo[0],setEditMin=_lo[1];
  var _hi=useState(bMax);var editMax=_hi[0],setEditMax=_hi[1];
  // Direct value typing
  var _tv=useState(false);var typingVal=_tv[0],setTypingVal=_tv[1];
  var _sm=useState(false);var sliderMenu=_sm[0],setSliderMenu=_sm[1];
  var _lpTimer=useRef(null), _lpMoved=useRef(false), _lpOrigin=useRef(null);
  var _ts=useState("");var typeStr=_ts[0],setTypeStr=_ts[1];

  // Keep the history registry pointing at THIS render's live onChange + bounds,
  // so re-editing from the history panel always drives the current control.
  _editLive[key]={onChange:p.onChange,onCommit:p.onCommit,min:bMin,max:bMax,step:s,fmt:p.fmt,value:p.value,label:p.label};
  function openEdit(){setEditMin(bMin);setEditMax(bMax);setEditing(true);}
  // Touch parity: every mouse-only gesture on this control (double-click to set
  // a custom range, double-click the track to reset) also has a long-press path.
  function doResetValue(){
    var rt=p.resetTo!=null?p.resetTo:(bMin<0&&bMax>0?0:bMin);
    p.onChange(rt); if(p.onCommit)p.onCommit(); _onSliderEnd(p._bumpEpoch); _recordEdit(key,p.label,rt);
  }
  function lpStart(fn){
    return function(e){
      if(_lpTimer.current)clearTimeout(_lpTimer.current);
      _lpMoved.current=false;
      var sx=e.clientX, sy=e.clientY;
      _lpOrigin.current={x:sx,y:sy};
      _lpTimer.current=setTimeout(function(){
        _lpTimer.current=null;
        if(!_lpMoved.current){ haptic(14); fn(); }
      },480);
    };
  }
  function lpMove(e){
    if(!_lpTimer.current)return;
    var o=_lpOrigin.current;
    if(o&&(Math.abs(e.clientX-o.x)>7||Math.abs(e.clientY-o.y)>7)){
      _lpMoved.current=true; clearTimeout(_lpTimer.current); _lpTimer.current=null;
    }
  }
  function lpEnd(){ if(_lpTimer.current){clearTimeout(_lpTimer.current);_lpTimer.current=null;} }
  function applyEdit(){_gBounds[key]={min:editMin,max:editMax};setEditing(false);setRev(function(r){return r+1;});}
  function resetEdit(){delete _gBounds[key];setEditing(false);setRev(function(r){return r+1;});}
  function startTypeVal(){setTypeStr(p.value.toFixed(s<1?2:0));setTypingVal(true);}
  function commitTypeVal(){
    var n=parseFloat(typeStr);
    if(!isNaN(n)){var cv=Math.max(bMin,Math.min(bMax,n));p.onChange(cv);_recordEdit(key,p.label,cv);}
    setTypingVal(false);
  }
  function expandMax(){var nm=bMax<=0?1:bMax*2;_gBounds[key]={min:ov&&ov.min!=null?ov.min:p.min,max:nm};setRev(function(r){return r+1;});}
  function contractMax(){var nm=Math.max(bMin+(p.step||0.01)*4,bMax*0.5);_gBounds[key]={min:ov&&ov.min!=null?ov.min:p.min,max:nm};setRev(function(r){return r+1;});}
  function fmtB(v){var a=Math.abs(v);return a>=10000?Math.round(v/1000)+"k":a>=1000?Math.round(v)+"":a>=10?(v%1===0?""+v:v.toFixed(1)):v.toFixed(2);}

  return React.createElement("div",{style:{marginBottom:10,position:"relative"}},
    React.createElement("div",{style:{display:"flex",justifyContent:"space-between",marginBottom:4,alignItems:"center",gap:4}},
      React.createElement("span",{
        onDoubleClick:openEdit,
        onPointerDown:lpStart(function(){setSliderMenu(true);}),
        onPointerMove:lpMove, onPointerUp:lpEnd, onPointerCancel:lpEnd, onPointerLeave:lpEnd,
        title:"Double-click (or press and hold) for range and reset",
        style:{fontSize:9,color:hasCustom?"#ffdd44":"#555",letterSpacing:1.2,textTransform:"uppercase",
          cursor:"pointer",userSelect:"none",touchAction:"none",padding:"3px 0"}
      },p.label+(hasCustom?" *":"")),
      addToAnim&&p.animParam?React.createElement("span",{
        onClick:function(){addToAnim(p.animParam,val);},
        title:"Add to animation track",
        style:{cursor:"pointer",fontSize:7,color:"#2a2a2a",padding:"1px 4px",lineHeight:1,
          letterSpacing:0.3,fontFamily:"monospace",borderRadius:2,
          border:"1px solid #222",background:"#111",
          transition:"all 0.1s",flexShrink:0,userSelect:"none"},
        onMouseEnter:function(e){e.currentTarget.style.color="#e8900a";e.currentTarget.style.borderColor="#e8900a";},
        onMouseLeave:function(e){e.currentTarget.style.color="#2a2a2a";e.currentTarget.style.borderColor="#222";}
      },"+ anim"):null,
      typingVal
        ?React.createElement("input",{type:"number",value:typeStr,step:s,autoFocus:true,
            onChange:function(e){setTypeStr(e.target.value);},
            onBlur:commitTypeVal,
            onKeyDown:function(e){if(e.key==="Enter")commitTypeVal();if(e.key==="Escape")setTypingVal(false);},
            style:{width:52,background:"#0e0e0e",border:"1px solid #e8900a",color:"#e8900a",padding:"1px 4px",fontSize:10,fontFamily:"monospace",borderRadius:2,textAlign:"right",outline:"none",WebkitAppearance:"none",MozAppearance:"textfield"}})
        :React.createElement("span",{
            onClick:startTypeVal,
            title:"Click to type value",
            style:{fontSize:11,color:"#e8900a",fontFamily:"monospace",cursor:"text",minWidth:36,textAlign:"right",userSelect:"none",flexShrink:0}
          },d),
      (function(){
        var rt=p.resetTo!=null?p.resetTo:0;
        if(Math.abs(p.value-rt)<(s||0.01)*0.5)return null; // already at reset
        return React.createElement("button",{
          onClick:function(){p.onChange(rt);if(p.onCommit)p.onCommit();_recordEdit(key,p.label,rt);},
          title:"Reset to "+(p.fmt?p.fmt(rt):rt),
          style:{width:15,height:15,padding:0,flexShrink:0,marginLeft:1,background:"none",border:"none",
            color:"#3a3a3a",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"},
          onMouseEnter:function(e){e.currentTarget.style.color="#e8900a";},
          onMouseLeave:function(e){e.currentTarget.style.color="#3a3a3a";}
        },React.createElement("svg",{width:10,height:10,viewBox:"0 0 12 12",fill:"none",stroke:"currentColor",strokeWidth:1.4,strokeLinecap:"round",strokeLinejoin:"round"},
          React.createElement("path",{d:"M2.5 6a3.5 3.5 0 1 1 1 2.5"}),
          React.createElement("polyline",{points:"1.2,5.2 2.6,6.2 3.6,4.6"})
        ));
      })()
    ),
    React.createElement("div",{style:{display:"flex",alignItems:"center",gap:4}},
      React.createElement("button",{
        onClick:contractMax,title:"Halve ceiling  "+fmtB(bMax)+" → "+fmtB(Math.max(bMin+(p.step||0.01)*4,bMax*0.5)),
        style:{width:16,height:16,padding:0,flexShrink:0,background:"#111",border:"1px solid #222",
               color:"#3a3a3a",cursor:"pointer",borderRadius:3,display:"flex",alignItems:"center",justifyContent:"center",
               transition:"color 0.08s,border-color 0.08s,background 0.08s"},
        onMouseEnter:function(e){e.currentTarget.style.color="#ff9966";e.currentTarget.style.borderColor="#ff9966";e.currentTarget.style.background="#1e1a17";},
        onMouseLeave:function(e){e.currentTarget.style.color="#3a3a3a";e.currentTarget.style.borderColor="#222";e.currentTarget.style.background="#111";}
      },React.createElement("svg",{width:7,height:7,viewBox:"0 0 7 7",fill:"none",stroke:"currentColor",strokeWidth:2,strokeLinecap:"round",strokeLinejoin:"round"},
        React.createElement("polyline",{points:"1,2.5 3.5,5 6,2.5"})
      )),
      React.createElement("input",{type:"range",min:bMin,max:bMax,step:s,value:val,
        onChange:function(e){_onSliderStart();p.onChange(parseFloat(e.target.value));},
        onWheel:function(e){
          // Scroll wheel nudges the value (Shift = 10× step for coarse moves).
          e.preventDefault();
          var stp=s*(e.shiftKey?10:1);var dir=e.deltaY<0?1:-1;
          var nv=p.value+dir*stp; if(nv<bMin)nv=bMin; if(nv>bMax)nv=bMax;
          // round to step grid to avoid float drift
          nv=Math.round(nv/s)*s;
          p.onChange(nv);if(p.onCommit)p.onCommit();
        },
        onDoubleClick:function(){var rt=p.resetTo!=null?p.resetTo:(bMin<0&&bMax>0?0:bMin);p.onChange(rt);if(p.onCommit)p.onCommit();_onSliderEnd(p._bumpEpoch);},
        onPointerUp:function(){if(p.onCommit)p.onCommit();haptic(8);_onSliderEnd(p._bumpEpoch);_recordEdit(key,p.label,p.value);},
        onPointerDown:function(){_onSliderStart();},
        onKeyUp:function(){if(p.onCommit)p.onCommit();_onSliderEnd(p._bumpEpoch);_recordEdit(key,p.label,p.value);},
        style:{"--fill":(bMax>bMin?Math.max(0,Math.min(100,(val-bMin)/(bMax-bMin)*100)).toFixed(1):"0")+"%","--fc":hasCustom?"#ffdd44":"#e8900a",flex:1,height:3,cursor:"pointer"}}),
      React.createElement("button",{
        onClick:expandMax,title:"Double ceiling  "+fmtB(bMax)+" → "+fmtB(bMax<=0?1:bMax*2),
        style:{width:16,height:16,padding:0,flexShrink:0,background:"#111",border:"1px solid #222",
               color:"#3a3a3a",cursor:"pointer",borderRadius:3,display:"flex",alignItems:"center",justifyContent:"center",
               transition:"color 0.08s,border-color 0.08s,background 0.08s"},
        onMouseEnter:function(e){e.currentTarget.style.color="#a0e060";e.currentTarget.style.borderColor="#a0e060";e.currentTarget.style.background="#131a10";},
        onMouseLeave:function(e){e.currentTarget.style.color="#3a3a3a";e.currentTarget.style.borderColor="#222";e.currentTarget.style.background="#111";}
      },React.createElement("svg",{width:7,height:7,viewBox:"0 0 7 7",fill:"none",stroke:"currentColor",strokeWidth:2,strokeLinecap:"round",strokeLinejoin:"round"},
        React.createElement("polyline",{points:"1,4.5 3.5,2 6,4.5"})
      ))
    ),
    React.createElement("div",{style:{display:"flex",justifyContent:"space-between",marginTop:2,padding:"0 20px"}},
      React.createElement("span",{style:{fontSize:7,color:"#252525",fontFamily:"monospace",letterSpacing:0.3}},fmtB(bMin)),
      React.createElement("span",{style:{fontSize:7,color:hasCustom?"rgba(255,221,68,0.45)":"#252525",fontFamily:"monospace",letterSpacing:0.3}},fmtB(bMax))
    ),
    // Quick-set preset chips (e.g. rotation 45/90/180). Each sets the value and
    // commits. Active chip highlights when the value matches.
    p.presets?React.createElement("div",{style:{display:"flex",gap:3,marginTop:4,flexWrap:"wrap"}},
      p.presets.map(function(ps){
        var pv=ps.v!=null?ps.v:ps;
        var pl=ps.l!=null?ps.l:(p.fmt?p.fmt(pv):(""+pv));
        var on=Math.abs(p.value-pv)<(s||0.01)*0.5;
        return React.createElement("button",{key:pl,
          onClick:function(){p.onChange(pv);if(p.onCommit)p.onCommit();_recordEdit(key,p.label,pv);haptic(8);},
          style:{padding:"2px 7px",fontSize:8,fontFamily:"monospace",cursor:"pointer",borderRadius:3,
            background:on?"#e8900a":"#161616",color:on?"#000":"#777",
            border:"1px solid "+(on?"#e8900a":"#282828")}},pl);
      })
    ):null,
    sliderMenu?React.createElement("div",{style:{display:"flex",gap:5,marginTop:5,alignItems:"center",
      background:"#141414",borderRadius:6,padding:"6px 7px",border:"1px solid #333",flexWrap:"wrap"}},
      React.createElement("button",{onClick:function(){setSliderMenu(false);doResetValue();},
        style:{minHeight:30,padding:"0 10px",fontSize:9,fontFamily:"monospace",fontWeight:700,background:"#1c1c1c",
          color:"#cbb",border:"1px solid #333",borderRadius:5,cursor:"pointer",touchAction:"manipulation"}},"Reset value"),
      React.createElement("button",{onClick:function(){setSliderMenu(false);openEdit();},
        style:{minHeight:30,padding:"0 10px",fontSize:9,fontFamily:"monospace",fontWeight:700,background:"#1c1c1c",
          color:"#ffdd44",border:"1px solid #4a4020",borderRadius:5,cursor:"pointer",touchAction:"manipulation"}},"Custom range"),
      hasCustom?React.createElement("button",{onClick:function(){setSliderMenu(false);resetEdit();},
        style:{minHeight:30,padding:"0 10px",fontSize:9,fontFamily:"monospace",background:"none",
          color:"#999",border:"1px solid #333",borderRadius:5,cursor:"pointer",touchAction:"manipulation"}},"Default range"):null,
      React.createElement("button",{onClick:function(){setSliderMenu(false);},
        style:{marginLeft:"auto",minHeight:30,minWidth:30,fontSize:12,fontFamily:"monospace",background:"none",
          color:"#888",border:"1px solid #333",borderRadius:5,cursor:"pointer",touchAction:"manipulation"}},"\u00d7")):null,
    editing?React.createElement("div",{style:{display:"flex",gap:4,marginTop:5,alignItems:"center",background:"#141414",borderRadius:3,padding:"5px 6px",border:"1px solid #252525"}},
      React.createElement("span",{style:{fontSize:8,color:"#555",flexShrink:0}},"Min"),
      React.createElement("input",{type:"number",value:editMin,step:s,
        onChange:function(e){setEditMin(parseFloat(e.target.value));},
        style:{flex:1,background:"#0e0e0e",border:"1px solid #2a2a2a",color:"#ffdd44",padding:"2px 4px",fontSize:9,fontFamily:"monospace",borderRadius:2,textAlign:"center"}}),
      React.createElement("span",{style:{fontSize:8,color:"#555",flexShrink:0}},"Max"),
      React.createElement("input",{type:"number",value:editMax,step:s,
        onChange:function(e){setEditMax(parseFloat(e.target.value));},
        style:{flex:1,background:"#0e0e0e",border:"1px solid #2a2a2a",color:"#ffdd44",padding:"2px 4px",fontSize:9,fontFamily:"monospace",borderRadius:2,textAlign:"center"}}),
      React.createElement("button",{onClick:applyEdit,
        style:{padding:"2px 7px",background:"#ffdd44",border:"none",color:"#000",fontFamily:"monospace",fontSize:8,fontWeight:700,cursor:"pointer",borderRadius:2,flexShrink:0}},"OK"),
      hasCustom?React.createElement("button",{onClick:resetEdit,
        style:{padding:"2px 6px",background:"none",border:"1px solid #333",color:"#888",fontFamily:"monospace",fontSize:8,cursor:"pointer",borderRadius:2,flexShrink:0}},"↺"):null
    ):null
  );
}
function Sel(p){
  var opts=p.opts.map(function(o){
    var v=o.v!=null?o.v:o.id!=null?o.id:o;
    var l=o.l!=null?o.l:o.label!=null?o.label:o;
    return{v:v,l:l};
  });
  var useGrid=p.grid===true||(opts.length>=4&&opts.some(function(o){return o.l.length>8;}));
  var col=p.color||"#e8900a";
  var hr=parseInt(col.slice(1,3),16)||232,hg=parseInt(col.slice(3,5),16)||144,hb=parseInt(col.slice(5,7),16)||10;
  return React.createElement("div",{style:{marginBottom:10}},
    p.label?React.createElement("span",{style:LS},p.label):null,
    React.createElement("div",{style:{display:useGrid?"grid":"flex",gridTemplateColumns:useGrid?("repeat("+(p.cols||2)+",1fr)"):null,flexWrap:useGrid?null:"wrap",gap:3}},
      opts.map(function(o){
        var active=p.value===o.v;
        return React.createElement("button",{key:o.v,onClick:function(){p.onChange(o.v);},title:o.l,
          style:{
            flex:useGrid?null:"1 0 auto",
            padding:"5px 8px",fontSize:9,fontFamily:"monospace",
            background:active?col:"#111",
            color:active?"#000":"#484848",
            border:"1px solid "+(active?col:"#191919"),
            borderRadius:3,cursor:"pointer",textAlign:"center",lineHeight:1.25,
            whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",
            transition:"background 0.1s,color 0.1s,border-color 0.1s"
          },
          onMouseEnter:active?null:function(e){
            var s=e.currentTarget.style;
            s.background="rgba("+hr+","+hg+","+hb+",0.13)";
            s.borderColor="rgba("+hr+","+hg+","+hb+",0.4)";
            s.color=col;
          },
          onMouseLeave:active?null:function(e){
            var s=e.currentTarget.style;
            s.background="#111";s.borderColor="#191919";s.color="#484848";
          }
        },o.l);
      })
    )
  );
}

// Collapsible section wrapper — click header to toggle
function Collapse(p){
  var storageKey="col_"+(p.id||p.title||"");
  var _o=useState(function(){
    if(p.defaultOpen!=null)return p.defaultOpen;
    if(_collapseState[storageKey]!=null)return _collapseState[storageKey];
    return p.defaultOpen!==false;
  });
  var open=_o[0],setOpen=_o[1];
  var color=p.color||"#e8900a";
  function toggle(){var next=!open;setOpen(next);_collapseState[storageKey]=next;}
  return React.createElement("div",{style:{
    background:"#111",
    border:"1px solid #1a1a1a",
    borderLeft:"2px solid "+(open?color:"#1e1e1e"),
    borderRadius:4,marginBottom:8,overflow:"hidden",
    transition:"border-left-color 0.18s"
  }},
    React.createElement("div",{onClick:toggle,
      style:{display:"flex",justifyContent:"space-between",alignItems:"center",
             padding:"7px 10px 7px 8px",cursor:"pointer",userSelect:"none",
             background:open?"rgba(255,255,255,0.015)":"transparent",transition:"background 0.1s"},
      onMouseEnter:function(e){e.currentTarget.style.background="rgba(255,255,255,0.025)";},
      onMouseLeave:function(e){e.currentTarget.style.background=open?"rgba(255,255,255,0.015)":"transparent";}
    },
      React.createElement("div",{style:{display:"flex",alignItems:"center",gap:6,flex:1,minWidth:0}},
        React.createElement("span",{style:{fontSize:9,color:open?color:"#3a3a3a",letterSpacing:1.5,
          textTransform:"uppercase",transition:"color 0.12s",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}},
          p.title),
        p.badge?React.createElement("span",{style:{
          fontSize:7,color:open?color:"#3a3a3a",fontFamily:"monospace",flexShrink:0,
          background:"rgba(255,255,255,0.04)",padding:"1px 6px",borderRadius:8,
          border:"1px solid rgba(255,255,255,0.06)",letterSpacing:0.3
        }},p.badge):null
      ),
      React.createElement("svg",{width:9,height:9,viewBox:"0 0 9 9",fill:"none",
        stroke:open?color:"#2e2e2e",strokeWidth:1.8,strokeLinecap:"round",strokeLinejoin:"round",
        style:{flexShrink:0,transition:"transform 0.18s,stroke 0.12s",transform:open?"rotate(0deg)":"rotate(-90deg)"}},
        React.createElement("polyline",{points:"1.5,3 4.5,6.5 7.5,3"})
      )
    ),
    open?React.createElement("div",{style:{padding:"4px 10px 10px 10px"}},p.children):null
  );
}
// Module-level persistence for collapse state across re-renders
var _collapseState={};
function Tog(p){
  var col=p.color||"#e8900a";
  var on=!!p.value;
  return React.createElement("div",{
    onClick:function(){p.onChange(!p.value);},
    style:{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10,cursor:"pointer",userSelect:"none",gap:10},
    onMouseEnter:function(e){var t=e.currentTarget.children[1];if(t)t.style.boxShadow="0 0 0 4px rgba(232,144,10,0.15)";},
    onMouseLeave:function(e){var t=e.currentTarget.children[1];if(t)t.style.boxShadow="none";}
  },
    React.createElement("span",{style:{
      fontSize:9,letterSpacing:1.2,textTransform:"uppercase",flex:1,
      color:on?col:"#484848",transition:"color 0.18s"
    }},p.label),
    React.createElement("div",{style:{
      width:38,height:22,borderRadius:11,flexShrink:0,position:"relative",
      background:on?col:"#161616",
      border:"1px solid "+(on?col:"#222"),
      transition:"background 0.2s,border-color 0.2s,box-shadow 0.15s",
      boxShadow:"inset 0 1px 4px rgba(0,0,0,0.45)"
    }},
      React.createElement("div",{style:{
        position:"absolute",width:16,height:16,borderRadius:8,
        background:on?"#fff":"#2e2e2e",
        top:2,left:on?19:2,
        transition:"left 0.2s,background 0.2s",
        boxShadow:"0 1px 4px rgba(0,0,0,0.55),0 0 0 0.5px rgba(0,0,0,0.15)"
      }})
    )
  );
}
function Sep(){return React.createElement("div",{style:{height:1,background:"linear-gradient(to right,transparent,#252525 20%,#252525 80%,transparent)",margin:"10px 0"}});}
function TBtn(p){return React.createElement("button",{onClick:p.onClick,style:{padding:p.small?"4px 7px":"6px 8px",fontSize:11,fontFamily:"monospace",background:p.active?(p.color||"#e8900a"):"#141414",color:p.active?"#000":"#555",border:"1px solid "+(p.active?(p.color||"#e8900a"):"#222"),borderRadius:3,cursor:"pointer",transition:"all 0.12s",whiteSpace:"nowrap"}},p.children);}
function SHead(p){
  var col=p.color||"#e8900a";
  return React.createElement("div",{style:{
    fontSize:9,color:col,letterSpacing:2,textTransform:"uppercase",marginBottom:8,paddingBottom:5,
    backgroundImage:"linear-gradient(to right,"+col+"44,transparent 70%)",
    backgroundSize:"100% 1px",backgroundRepeat:"no-repeat",backgroundPosition:"bottom"
  }},p.children);
}
function SmBtn(p){return React.createElement("button",{onClick:p.onClick,title:p.title,style:{padding:"3px 7px",fontSize:10,fontFamily:"monospace",background:"#141414",color:p.color||"#555",border:"1px solid #1e1e1e",borderRadius:3,cursor:"pointer",lineHeight:1,transition:"all 0.08s"},onMouseEnter:function(e){e.currentTarget.style.borderColor=p.color||"#444";e.currentTarget.style.color=p.color||"#aaa";},onMouseLeave:function(e){e.currentTarget.style.borderColor="#1e1e1e";e.currentTarget.style.color=p.color||"#555";}},p.children);}

// ═══ LAYER THUMBNAIL ════════════════════════════════════════════
function LayerThumb(p){
  var canvasRef=useRef(null);
  // If this layer references another, render the RESOLVED layer so the thumbnail
  // matches what's drawn on canvas. We resolve via the full list when provided.
  var lay0=p.layer;
  var resolvedLay=lay0;
  if(lay0&&lay0.refUid!=null&&p.allLayers){
    var rr=resolveReferences(p.allLayers);
    for(var _ri=0;_ri<p.allLayers.length;_ri++){if(p.allLayers[_ri]===lay0){resolvedLay=rr[_ri];break;}}
  }
  // Dependency token: include the source layer's identity so a change to the
  // source re-runs this effect (the ref object itself wouldn't change).
  var _srcTok="";
  if(lay0&&lay0.refUid!=null&&p.allLayers){var sObj=p.allLayers.find(function(z){return z.uid===lay0.refUid;});if(sObj)_srcTok=JSON.stringify(sObj);}
  useEffect(function(){
    var c=canvasRef.current;if(!c)return;
    var lay=resolvedLay;
    var size=36,buf=new Float32Array(size*size*4);
    var imgPix=lay.imageData?getImgPixels(lay.imageData):null;
    var isRGB=lay.imageColorMode==="rgb"&&lay.type==="image"&&imgPix;
    var ca=hexF(lay.colorA||"#000"),cb=hexF(lay.colorB||"#fff");
    var r1=ca[0],g1=ca[1],b1=ca[2],r2=cb[0],g2=cb[1],b2=cb[2];
    var inv=1/size;
    for(var py=0;py<size;py++)for(var px=0;px<size;px++){
      var v=layerV(px,py,px*inv,py*inv,lay,imgPix);
      var idx=(py*size+px)*4;
      if(isRGB){
        var ux2=(px*inv%1+1)%1,uy2=(py*inv%1+1)%1;
        var fx2=ux2*imgPix.w,fy2=uy2*imgPix.h;
        var x0=Math.floor(fx2)%imgPix.w,y0=Math.floor(fy2)%imgPix.h;
        var x1=(x0+1)%imgPix.w,y1=(y0+1)%imgPix.h;
        var tx2=fx2-Math.floor(fx2),ty2=fy2-Math.floor(fy2);
        var d2=imgPix.data;
        var i00=(y0*imgPix.w+x0)*4,i10=(y0*imgPix.w+x1)*4;
        var i01=(y1*imgPix.w+x0)*4,i11=(y1*imgPix.w+x1)*4;
        var cr2=(d2[i00]/255*(1-tx2)+d2[i10]/255*tx2)*(1-ty2)+(d2[i01]/255*(1-tx2)+d2[i11]/255*tx2)*ty2;
        var cg2=(d2[i00+1]/255*(1-tx2)+d2[i10+1]/255*tx2)*(1-ty2)+(d2[i01+1]/255*(1-tx2)+d2[i11+1]/255*tx2)*ty2;
        var cb3=(d2[i00+2]/255*(1-tx2)+d2[i10+2]/255*tx2)*(1-ty2)+(d2[i01+2]/255*(1-tx2)+d2[i11+2]/255*tx2)*ty2;
        buf[idx  ]=cr2*255+0.5|0;
        buf[idx+1]=cg2*255+0.5|0;
        buf[idx+2]=cb3*255+0.5|0;
      } else {
        buf[idx  ]=lerp(r1,r2,v)*255+0.5|0;
        buf[idx+1]=lerp(g1,g2,v)*255+0.5|0;
        buf[idx+2]=lerp(b1,b2,v)*255+0.5|0;
      }
      buf[idx+3]=255;
    }
    c.width=c.height=size;
    var ctx2d=c.getContext("2d");
    var img=ctx2d.createImageData(size,size);
    for(var i=0;i<buf.length;i++)img.data[i]=buf[i];
    ctx2d.putImageData(img,0,0);
  },[p.layer,resolvedLay,_srcTok]);
  return React.createElement("canvas",{ref:canvasRef,style:{display:"block",width:36,height:36,imageRendering:"pixelated",borderRadius:2,opacity:p.layer.enabled?1:0.4}});
}

// ═══ SHAPE PREVIEW GRID ══════════════════════════════════════════
// Renders every shape as a live canvas thumbnail using computeShape directly.
// No full pipeline needed — pure SDF math per pixel.
var SHAPE_GROUPS=[
  {label:"Round",    ids:["circle","ring","ellipse","capsule","moon","egg","vesica","teardrop"]},
  {label:"Angular",  ids:["box","rbox","diamond","cross","frame","plus","gem"]},
  {label:"Polygon",  ids:["tri","pent","hex","oct","shield"]},
  {label:"Star",     ids:["star4","star5","star6","flower","hexagram","burst"]},
  {label:"Segment",  ids:["pie","horseshoe","stroke","arrow","bolt"]},
  {label:"Special",  ids:["heart","gear"]}
];

function ShapePreviewGrid(p){
  var sz=42;
  var canvases=useRef({});
  var prevActive=useRef(null);
  var activeKind=p.value||"circle";
  var activeCol=p.col||"#e8900a";
  var activeRGB=hexF(activeCol);

  function paintShape(c,id,sp,isActive){
    c.width=c.height=sz;
    var ctx=c.getContext("2d"),img=ctx.createImageData(sz,sz);
    var inv=1/sz;
    for(var py=0;py<sz;py++){
      for(var px=0;px<sz;px++){
        var cx=(px*inv-0.5),cy=(py*inv-0.5);
        var v=computeShape(cx,cy,id,sp||DSP);
        var ii=(py*sz+px)*4;
        if(isActive){img.data[ii]=10+v*activeRGB[0]*220+0.5|0;img.data[ii+1]=10+v*activeRGB[1]*220+0.5|0;img.data[ii+2]=10+v*activeRGB[2]*220+0.5|0;}
        else{img.data[ii]=10+v*210+0.5|0;img.data[ii+1]=10+v*200+0.5|0;img.data[ii+2]=10+v*185+0.5|0;}
        img.data[ii+3]=255;
      }
    }
    ctx.putImageData(img,0,0);
  }

  // Paint all shapes once (white) on mount
  useEffect(function(){
    var h=setTimeout(function(){
      SHAPES.forEach(function(sh){
        var c=canvases.current[sh.id];
        if(!c)return;
        paintShape(c,sh.id,DSP,sh.id===activeKind);
      });
      prevActive.current=activeKind;
    },40);
    return function(){clearTimeout(h);};
  },[]);

  // On activeKind change: reset old → white, paint new → colored
  useEffect(function(){
    if(prevActive.current&&prevActive.current!==activeKind){
      var cOld=canvases.current[prevActive.current];
      if(cOld)paintShape(cOld,prevActive.current,DSP,false);
    }
    var cNew=canvases.current[activeKind];
    if(cNew)paintShape(cNew,activeKind,p.shapeP||DSP,true);
    prevActive.current=activeKind;
  },[activeKind,p.shapeP,activeCol]);

  return React.createElement("div",{style:{marginBottom:10}},
    SHAPE_GROUPS.map(function(grp){
      var grpShapes=SHAPES.filter(function(sh){return grp.ids.indexOf(sh.id)>=0;});
      if(!grpShapes.length)return null;
      return React.createElement("div",{key:grp.label,style:{marginBottom:8}},
        React.createElement("span",{style:{fontSize:7,color:"#2a2a2a",letterSpacing:1.5,textTransform:"uppercase",display:"block",marginBottom:4}},grp.label),
        React.createElement("div",{style:{display:"flex",flexWrap:"wrap",gap:3}},
          grpShapes.map(function(sh){
            var isActive=activeKind===sh.id;
            return React.createElement("button",{key:sh.id,
              onClick:function(){p.onChange(sh.id);},
              title:sh.l,
              style:{display:"flex",flexDirection:"column",alignItems:"center",gap:2,
                padding:2,background:"#080808",
                border:"2px solid "+(isActive?activeCol:"#1c1c1c"),
                borderRadius:3,cursor:"pointer"},
              onMouseEnter:function(e){if(!isActive)e.currentTarget.style.borderColor="#333";},
              onMouseLeave:function(e){if(!isActive)e.currentTarget.style.borderColor="#1c1c1c";}
            },
              React.createElement("canvas",{
                ref:function(el){if(el)canvases.current[sh.id]=el;},
                style:{width:sz,height:sz,display:"block",imageRendering:"pixelated",borderRadius:2}
              }),
              React.createElement("span",{style:{fontSize:7,fontFamily:"monospace",color:isActive?activeCol:"#444",lineHeight:1,textAlign:"center",maxWidth:sz+4,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}},sh.l)
            );
          })
        )
      );
    })
  );
}
// Renders a single layer in isolation at 128px for quick inspection
// ── Edit history panel: floats over the preview canvas. Shows recent slider
// changes (newest first); each row has a live mini-slider that re-drives the
// actual control via its registered onChange, so you can re-tweak from here.
function EditHistoryPanel(p){
  var isMobile=p&&p.isMobile;
  var _r=useState(0); var setR=_r[1];
  useEffect(function(){
    return _editHistSub(function(){setR(function(v){return v+1;});});
  },[]);
  // Start collapsed on mobile so it doesn't cover the small preview
  var _open=useState(!isMobile); var open=_open[0],setOpen=_open[1];
  // Newest first
  var rows=_editHistory.slice().reverse();
  // Collapsed: a compact icon chip. Open: the full panel.
  if(!open)return React.createElement("button",{
    onClick:function(){setOpen(true);},
    title:"Recent edits — re-tweak recent properties",
    style:{position:"absolute",top:8,right:8,zIndex:8,width:28,height:24,
      background:"rgba(10,10,10,0.92)",border:"1px solid #232323",borderRadius:5,
      color:rows.length?"#999":"#555",cursor:"pointer",backdropFilter:"blur(3px)",
      display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,
      boxShadow:"0 4px 16px rgba(0,0,0,0.5)"}},
    "\u270e");
  return React.createElement("div",{style:{
    position:"absolute",top:8,right:8,width:isMobile?150:182,zIndex:8,
    maxWidth:isMobile?"60%":"none",
    background:"rgba(10,10,10,0.92)",border:"1px solid #232323",borderRadius:5,
    fontFamily:"monospace",backdropFilter:"blur(3px)",boxShadow:"0 4px 16px rgba(0,0,0,0.5)"}},
    React.createElement("div",{
      onClick:function(){setOpen(function(v){return!v;});},
      title:"Recently edited properties — re-tweak any of them here",
      style:{display:"flex",justifyContent:"space-between",alignItems:"center",
        padding:"5px 8px",cursor:"pointer",borderBottom:open&&rows.length?"1px solid #1d1d1d":"none"}},
      React.createElement("span",{style:{fontSize:8,color:"#888",textTransform:"uppercase",letterSpacing:1}},"\u270e Recent Edits"),
      React.createElement("div",{style:{display:"flex",gap:6,alignItems:"center"}},
        rows.length?React.createElement("span",{title:"Clear history",
          onClick:function(e){e.stopPropagation();_editHistory=[];_editHistNotify();},
          style:{fontSize:9,color:"#555",cursor:"pointer"}},"clear"):null,
        React.createElement("span",{style:{fontSize:9,color:"#555"}},open?"\u25be":"\u25b8")
      )
    ),
    open?React.createElement("div",{style:{maxHeight:isMobile?150:230,overflowY:"auto",WebkitOverflowScrolling:"touch",padding:rows.length?"4px 0":"0"}},
      rows.length===0?React.createElement("div",{style:{padding:"8px 10px",fontSize:8,color:"#444",lineHeight:1.5}},
        "Move any slider and it shows up here for quick re-tweaking."):
      rows.map(function(row){
        var live=_editLive[row.key];
        if(!live)return null;
        var mn=live.min,mx=live.max,st=live.step;
        var cur=live.value;
        var disp=live.fmt?live.fmt(cur):(st<1?cur.toFixed(2):""+Math.round(cur));
        return React.createElement("div",{key:row.key,style:{padding:"4px 8px",borderBottom:"1px solid #161616"}},
          React.createElement("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:2}},
            React.createElement("span",{style:{fontSize:8,color:"#aaa",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:120},title:row.label},row.label),
            React.createElement("span",{style:{fontSize:8,color:"#e8900a"}},disp)
          ),
          React.createElement("input",{type:"range",min:mn,max:mx,step:st,value:cur<mn?mn:cur>mx?mx:cur,
            onChange:function(e){
              var lv=_editLive[row.key]; if(!lv)return;
              var nv=parseFloat(e.target.value);
              lv.onChange(nv);
              if(lv.onCommit)lv.onCommit();
              // Update stored value so the row reflects the change immediately
              _editLive[row.key].value=nv;
              row.value=nv;
              _editHistNotify();
            },
            style:{width:"100%",height:3,cursor:"pointer",accentColor:"#e8900a"}})
        );
      })
    ):null
  );
}

// Renders a progressive composite of the first N layers (respects blend+opacity).
function StackPreview(p){
  var canvasRef=useRef(null);
  var layers=p.layers, upto=p.upto, thumbSize=p.size||96;
  var renderSize=Math.min(thumbSize,128);
  useEffect(function(){
    var c=canvasRef.current;if(!c)return;
    var size=renderSize;
    var sub=(layers||[]).slice(0,upto+1).map(function(L){return Object.assign({},L,{enabled:true});});
    var buf=new Float32Array(size*size*4);
    renderLayersToBuf(buf,size,sub,null,[]);
    c.width=c.height=size;
    var ctx=c.getContext("2d"),img=ctx.createImageData(size,size);
    for(var i=0;i<size*size;i++){var ii=i*4;
      img.data[ii]=clamp(buf[ii])*255+0.5|0;img.data[ii+1]=clamp(buf[ii+1])*255+0.5|0;
      img.data[ii+2]=clamp(buf[ii+2])*255+0.5|0;img.data[ii+3]=255;}
    ctx.putImageData(img,0,0);
  },[layers,upto,renderSize]);
  return React.createElement("canvas",{ref:canvasRef,style:{width:thumbSize,height:thumbSize,imageRendering:"pixelated",display:"block",borderRadius:2}});
}

// Generate a jittered copy of a layer set. variant index seeds the RNG so each
// tile is stable across re-renders. amt 0..1 controls how far params move.
// ── Chained operations engine ────────────────────────────────────
// A chain is an ordered list of op specs: {op:"duplicate"} etc. Each op is a
// pure transform over {layers, activeIdx}; the runner applies them in order and
// returns the final {layers, activeIdx}, so the caller commits ONE state update
// (one undo step) for the whole chain. Ops clamp to the 8-layer limit and never
// throw — an op that can't apply (e.g. duplicate at the cap) passes state through.
var CHAIN_OPS={
  duplicate:{label:"Duplicate",hint:"Copy the active layer",run:function(L,ai){
    if(L.length>=8)return{layers:L,activeIdx:ai};
    var nl=JSON.parse(JSON.stringify(L[ai]));
    nl.uid=newUid(); nl.refUid=null;
    nl.label=(nl.label||("L"+(ai+1)))+" copy"; nl.seed=Math.random()*99999|0;
    var out=L.slice(); out.splice(ai+1,0,nl); return{layers:out,activeIdx:ai+1};
  }},
  rotate90:{label:"Rotate 90°",hint:"Add 90° to the active layer",run:function(L,ai){
    var out=L.slice(); var l=Object.assign({},out[ai]);
    l.rotation=(((l.rotation||0)+90+180)%360)-180; out[ai]=l; return{layers:out,activeIdx:ai};
  }},
  rotate45:{label:"Rotate 45°",hint:"Add 45° to the active layer",run:function(L,ai){
    var out=L.slice(); var l=Object.assign({},out[ai]);
    l.rotation=(((l.rotation||0)+45+180)%360)-180; out[ai]=l; return{layers:out,activeIdx:ai};
  }},
  rotate180:{label:"Rotate 180°",hint:"Flip the active layer 180°",run:function(L,ai){
    var out=L.slice(); var l=Object.assign({},out[ai]);
    l.rotation=(((l.rotation||0)+180+180)%360)-180; out[ai]=l; return{layers:out,activeIdx:ai};
  }},
  reseed:{label:"Re-seed",hint:"New random seed",run:function(L,ai){
    var out=L.slice(); var l=Object.assign({},out[ai]); l.seed=Math.random()*99999|0; out[ai]=l; return{layers:out,activeIdx:ai};
  }},
  blendMultiply:{label:"Blend Multiply",hint:"Set blend to Multiply",run:function(L,ai){
    var out=L.slice(); out[ai]=Object.assign({},out[ai],{blendMode:"multiply"}); return{layers:out,activeIdx:ai};
  }},
  blendAdd:{label:"Blend Add",hint:"Set blend to Add",run:function(L,ai){
    var out=L.slice(); out[ai]=Object.assign({},out[ai],{blendMode:"add"}); return{layers:out,activeIdx:ai};
  }},
  blendScreen:{label:"Blend Screen",hint:"Set blend to Screen",run:function(L,ai){
    var out=L.slice(); out[ai]=Object.assign({},out[ai],{blendMode:"screen"}); return{layers:out,activeIdx:ai};
  }},
  blendOverlay:{label:"Blend Overlay",hint:"Set blend to Overlay",run:function(L,ai){
    var out=L.slice(); out[ai]=Object.assign({},out[ai],{blendMode:"overlay"}); return{layers:out,activeIdx:ai};
  }},
  halfOpacity:{label:"50% Opacity",hint:"Set layer opacity to 50%",run:function(L,ai){
    var out=L.slice(); out[ai]=Object.assign({},out[ai],{opacity:0.5}); return{layers:out,activeIdx:ai};
  }},
  invert:{label:"Invert",hint:"Swap the layer's colours",run:function(L,ai){
    var out=L.slice(); var l=Object.assign({},out[ai]);
    var a=l.colorA,b=l.colorB; l.colorA=b!=null?b:"#ffffff"; l.colorB=a!=null?a:"#000000"; out[ai]=l; return{layers:out,activeIdx:ai};
  }},
  scaleUp:{label:"Scale ×2",hint:"Double the layer scale",run:function(L,ai){
    var out=L.slice(); var l=Object.assign({},out[ai]);
    if(l.scaleX!=null)l.scaleX=Math.min(64,l.scaleX*2); if(l.scaleY!=null)l.scaleY=Math.min(64,l.scaleY*2); out[ai]=l; return{layers:out,activeIdx:ai};
  }},
  scaleDown:{label:"Scale ÷2",hint:"Halve the layer scale",run:function(L,ai){
    var out=L.slice(); var l=Object.assign({},out[ai]);
    if(l.scaleX!=null)l.scaleX=Math.max(0.3,l.scaleX/2); if(l.scaleY!=null)l.scaleY=Math.max(0.3,l.scaleY/2); out[ai]=l; return{layers:out,activeIdx:ai};
  }},
  // ── Flips & mirrors (fields already honoured by the renderer) ──
  flipH:{label:"Flip H",hint:"Mirror the layer horizontally",run:function(L,ai){
    var out=L.slice(); out[ai]=Object.assign({},out[ai],{flipH:!out[ai].flipH}); return{layers:out,activeIdx:ai};
  }},
  flipV:{label:"Flip V",hint:"Mirror the layer vertically",run:function(L,ai){
    var out=L.slice(); out[ai]=Object.assign({},out[ai],{flipV:!out[ai].flipV}); return{layers:out,activeIdx:ai};
  }},
  mirror:{label:"Mirror (dup+flip)",hint:"Duplicate and flip horizontally for symmetry",run:function(L,ai){
    if(L.length>=8)return{layers:L,activeIdx:ai};
    var nl=JSON.parse(JSON.stringify(L[ai])); nl.uid=newUid(); nl.refUid=null; nl.label=(nl.label||("L"+(ai+1)))+" mirror";
    nl.flipH=!nl.flipH; nl.seed=L[ai].seed; // keep seed so it lines up as a true mirror
    var out=L.slice(); out.splice(ai+1,0,nl); return{layers:out,activeIdx:ai+1};
  }},
  mirrorV:{label:"Mirror V (dup+flip)",hint:"Duplicate and flip vertically",run:function(L,ai){
    if(L.length>=8)return{layers:L,activeIdx:ai};
    var nl=JSON.parse(JSON.stringify(L[ai])); nl.uid=newUid(); nl.refUid=null; nl.label=(nl.label||("L"+(ai+1)))+" mirrorV";
    nl.flipV=!nl.flipV; nl.seed=L[ai].seed;
    var out=L.slice(); out.splice(ai+1,0,nl); return{layers:out,activeIdx:ai+1};
  }},
  // ── More blend modes ──
  blendSubtract:{label:"Blend Subtract",hint:"Set blend to Subtract",run:function(L,ai){var o=L.slice();o[ai]=Object.assign({},o[ai],{blendMode:"subtract"});return{layers:o,activeIdx:ai};}},
  blendDifference:{label:"Blend Difference",hint:"Set blend to Difference",run:function(L,ai){var o=L.slice();o[ai]=Object.assign({},o[ai],{blendMode:"difference"});return{layers:o,activeIdx:ai};}},
  blendLighten:{label:"Blend Lighten",hint:"Set blend to Lighten",run:function(L,ai){var o=L.slice();o[ai]=Object.assign({},o[ai],{blendMode:"lighten"});return{layers:o,activeIdx:ai};}},
  blendDarken:{label:"Blend Darken",hint:"Set blend to Darken",run:function(L,ai){var o=L.slice();o[ai]=Object.assign({},o[ai],{blendMode:"darken"});return{layers:o,activeIdx:ai};}},
  blendSoftLight:{label:"Blend Soft Light",hint:"Set blend to Soft Light",run:function(L,ai){var o=L.slice();o[ai]=Object.assign({},o[ai],{blendMode:"softlight"});return{layers:o,activeIdx:ai};}},
  blendHardLight:{label:"Blend Hard Light",hint:"Set blend to Hard Light",run:function(L,ai){var o=L.slice();o[ai]=Object.assign({},o[ai],{blendMode:"hardlight"});return{layers:o,activeIdx:ai};}},
  blendExclusion:{label:"Blend Exclusion",hint:"Set blend to Exclusion",run:function(L,ai){var o=L.slice();o[ai]=Object.assign({},o[ai],{blendMode:"exclusion"});return{layers:o,activeIdx:ai};}},
  blendDivide:{label:"Blend Divide",hint:"Set blend to Divide",run:function(L,ai){var o=L.slice();o[ai]=Object.assign({},o[ai],{blendMode:"divide"});return{layers:o,activeIdx:ai};}},
  blendNormal:{label:"Blend Normal",hint:"Reset blend to Normal",run:function(L,ai){var o=L.slice();o[ai]=Object.assign({},o[ai],{blendMode:"normal"});return{layers:o,activeIdx:ai};}},
  // ── Adjustments ──
  contrastUp:{label:"Contrast +",hint:"Increase contrast",run:function(L,ai){var o=L.slice();var l=Object.assign({},o[ai]);l.contrast=Math.min(4,(l.contrast!=null?l.contrast:1)+0.3);o[ai]=l;return{layers:o,activeIdx:ai};}},
  contrastDown:{label:"Contrast −",hint:"Decrease contrast",run:function(L,ai){var o=L.slice();var l=Object.assign({},o[ai]);l.contrast=Math.max(0.2,(l.contrast!=null?l.contrast:1)-0.3);o[ai]=l;return{layers:o,activeIdx:ai};}},
  brightUp:{label:"Brightness +",hint:"Brighten the layer",run:function(L,ai){var o=L.slice();var l=Object.assign({},o[ai]);l.brightness=Math.min(2,(l.brightness!=null?l.brightness:0.5)+0.15);o[ai]=l;return{layers:o,activeIdx:ai};}},
  brightDown:{label:"Brightness −",hint:"Darken the layer",run:function(L,ai){var o=L.slice();var l=Object.assign({},o[ai]);l.brightness=Math.max(-1,(l.brightness!=null?l.brightness:0.5)-0.15);o[ai]=l;return{layers:o,activeIdx:ai};}},
  huePlus:{label:"Hue +30°",hint:"Rotate hue +30°",run:function(L,ai){var o=L.slice();var l=Object.assign({},o[ai]);var h=(l.hueShift||0)+30;l.hueShift=h>180?h-360:h;o[ai]=l;return{layers:o,activeIdx:ai};}},
  hueMinus:{label:"Hue −30°",hint:"Rotate hue −30°",run:function(L,ai){var o=L.slice();var l=Object.assign({},o[ai]);var h=(l.hueShift||0)-30;l.hueShift=h<-180?h+360:h;o[ai]=l;return{layers:o,activeIdx:ai};}},
  fullOpacity:{label:"100% Opacity",hint:"Set opacity to 100%",run:function(L,ai){var o=L.slice();o[ai]=Object.assign({},o[ai],{opacity:1});return{layers:o,activeIdx:ai};}},
  quarterOpacity:{label:"25% Opacity",hint:"Set opacity to 25%",run:function(L,ai){var o=L.slice();o[ai]=Object.assign({},o[ai],{opacity:0.25});return{layers:o,activeIdx:ai};}},
  // ── Structure ──
  toggleSeamless:{label:"Toggle Seamless",hint:"Flip the layer's seamless flag",run:function(L,ai){var o=L.slice();o[ai]=Object.assign({},o[ai],{seamless:!o[ai].seamless});return{layers:o,activeIdx:ai};}},
  disable:{label:"Disable Layer",hint:"Turn the layer off",run:function(L,ai){var o=L.slice();o[ai]=Object.assign({},o[ai],{enabled:false});return{layers:o,activeIdx:ai};}},
  enable:{label:"Enable Layer",hint:"Turn the layer on",run:function(L,ai){var o=L.slice();o[ai]=Object.assign({},o[ai],{enabled:true});return{layers:o,activeIdx:ai};}},
  moveUp:{label:"Move Up",hint:"Move the layer up the stack",run:function(L,ai){if(ai<=0)return{layers:L,activeIdx:ai};var o=L.slice();var t=o[ai];o[ai]=o[ai-1];o[ai-1]=t;return{layers:o,activeIdx:ai-1};}},
  moveDown:{label:"Move Down",hint:"Move the layer down the stack",run:function(L,ai){if(ai>=L.length-1)return{layers:L,activeIdx:ai};var o=L.slice();var t=o[ai];o[ai]=o[ai+1];o[ai+1]=t;return{layers:o,activeIdx:ai+1};}}
};
// Optional grouping for the UI (keeps the op palette navigable).
var CHAIN_OP_GROUPS=[
  {label:"Layer",ops:["duplicate","mirror","mirrorV","moveUp","moveDown","disable","enable"]},
  {label:"Transform",ops:["rotate45","rotate90","rotate180","flipH","flipV","scaleUp","scaleDown","toggleSeamless"]},
  {label:"Blend",ops:["blendNormal","blendMultiply","blendAdd","blendScreen","blendOverlay","blendSubtract","blendDifference","blendLighten","blendDarken","blendSoftLight","blendHardLight","blendExclusion","blendDivide"]},
  {label:"Adjust",ops:["reseed","invert","contrastUp","contrastDown","brightUp","brightDown","huePlus","hueMinus","halfOpacity","quarterOpacity","fullOpacity"]}
];
// Run a chain (array of op ids) over a starting layer set; returns final state.
function runChain(opIds,layers,activeIdx){
  var st={layers:layers.slice(),activeIdx:activeIdx};
  for(var i=0;i<opIds.length;i++){
    var spec=CHAIN_OPS[opIds[i]];
    if(!spec)continue;
    st=spec.run(st.layers,st.activeIdx);
  }
  return st;
}
// Built-in recipes: common multi-step combos, one click each.
var CHAIN_PRESETS=[
  {id:"dupRotMul",label:"Duplicate + Rotate 90° + Multiply",ops:["duplicate","rotate90","blendMultiply"]},
  {id:"dupRotScreen",label:"Duplicate + Rotate 45° + Screen",ops:["duplicate","rotate45","blendScreen"]},
  {id:"dupReseedAdd",label:"Duplicate + Re-seed + Add",ops:["duplicate","reseed","blendAdd"]},
  {id:"dupScaleOvl",label:"Duplicate + Scale ×2 + Overlay",ops:["duplicate","scaleUp","blendOverlay"]},
  {id:"dupInvHalf",label:"Duplicate + Invert + 50%",ops:["duplicate","invert","halfOpacity"]}
];

function jitterLayers(layers,variantIdx,amt){
  // Simple stable PRNG seeded by variant index
  var s=(variantIdx*2654435761)>>>0;
  function rnd(){s=(Math.imul(s^(s>>>15),2246822519))>>>0;return(s>>>0)/0xffffffff;}
  function jit(v,frac,lo,hi){var d=(rnd()*2-1)*frac*amt;var nv=v+d*(hi-lo);return nv<lo?lo:nv>hi?hi:nv;}
  return layers.map(function(L){
    var nL=Object.assign({},L);
    nL.seed=(L.seed||1)+variantIdx*1013+Math.floor(rnd()*9999); // always reseed
    // Perturb a handful of impactful params if present
    if(L.scaleX!=null)nL.scaleX=jit(L.scaleX,0.35,0.3,32);
    if(L.scaleY!=null&&!L.scaleLinked)nL.scaleY=jit(L.scaleY,0.35,0.3,32);
    if(L.octaves!=null)nL.octaves=Math.max(1,Math.min(8,Math.round(L.octaves+(rnd()*2-1)*2*amt)));
    if(L.warpStr!=null&&L.warpStr>0)nL.warpStr=jit(L.warpStr,0.5,0,4);
    if(L.contrast!=null)nL.contrast=jit(L.contrast,0.3,0.2,3);
    if(L.gain!=null)nL.gain=jit(L.gain,0.25,0.2,0.8);
    return nL;
  });
}

// Variations explorer: shows N jittered versions of the current layer stack as
// clickable thumbnails. Clicking one applies it. Re-roll regenerates. Each
// thumbnail renders the FULL composite at low res (StackPreview-style).
function VariationsExplorer(p){
  var _amt=useState(0.5); var amt=_amt[0],setAmt=_amt[1];
  var _roll=useState(0); var roll=_roll[0],setRoll=_roll[1];
  var COUNT=9;
  var variants=[];
  for(var vi=0;vi<COUNT;vi++){
    // roll offsets the variant index space so "re-roll" gives a fresh batch
    variants.push(jitterLayers(p.layers||[],vi+1+roll*COUNT,amt));
  }
  var cell=120;
  return React.createElement("div",{style:{position:"absolute",inset:0,zIndex:8,background:"rgba(8,8,8,0.97)",
    display:"flex",flexDirection:"column",alignItems:"center",padding:14,overflow:"auto"}},
    React.createElement("div",{style:{display:"flex",alignItems:"center",gap:12,marginBottom:12,flexWrap:"wrap",justifyContent:"center"}},
      React.createElement("span",{style:{fontSize:11,color:"#e8900a",fontFamily:"monospace",letterSpacing:1}},"VARIATIONS"),
      React.createElement("div",{style:{display:"flex",alignItems:"center",gap:6}},
        React.createElement("span",{style:{fontSize:8,color:"#777",fontFamily:"monospace"}},"Amount"),
        React.createElement("input",{type:"range",min:0.1,max:1,step:0.05,value:amt,
          onChange:function(e){setAmt(parseFloat(e.target.value));},
          style:{width:100,accentColor:"#e8900a"}}),
        React.createElement("span",{style:{fontSize:8,color:"#999",fontFamily:"monospace",width:28}},Math.round(amt*100)+"%")
      ),
      React.createElement("button",{onClick:function(){setRoll(function(v){return v+1;});},
        style:{padding:"5px 12px",fontSize:9,fontFamily:"monospace",background:"#1a1a1a",color:"#e8900a",
          border:"1px solid #e8900a",borderRadius:3,cursor:"pointer"}},"⟳ Re-roll"),
      React.createElement("button",{onClick:p.onClose,
        style:{padding:"5px 12px",fontSize:9,fontFamily:"monospace",background:"#1a1a1a",color:"#888",
          border:"1px solid #333",borderRadius:3,cursor:"pointer"}},"✕ Close")
    ),
    React.createElement("div",{style:{display:"grid",gridTemplateColumns:"repeat(3,auto)",gap:8,justifyContent:"center"}},
      variants.map(function(vl,vi){
        return React.createElement("div",{key:vi,style:{display:"flex",flexDirection:"column",alignItems:"center",gap:3,
          cursor:"pointer",padding:4,borderRadius:5,border:"1px solid #1c1c1c",background:"#0c0c0c"},
          title:"Click to apply this variation",
          onClick:function(){p.onApply(vl);},
          onMouseEnter:function(e){e.currentTarget.style.borderColor="#e8900a";},
          onMouseLeave:function(e){e.currentTarget.style.borderColor="#1c1c1c";}},
          React.createElement(StackPreview,{layers:vl,upto:vl.length-1,size:cell}),
          React.createElement("span",{style:{fontSize:7,color:"#555",fontFamily:"monospace"}},"#"+(vi+1))
        );
      })
    ),
    React.createElement("div",{style:{marginTop:10,fontSize:8,color:"#555",fontFamily:"monospace",textAlign:"center"}},
      "Click a tile to apply it · Amount controls how different they are · Re-roll for a new batch")
  );
}

// Side-by-side comparison of all layers (solo each, or progressive stack).
function LayerCompareGrid(p){
  var _m=useState("solo"); var mode=_m[0],setMode=_m[1];
  var layers=(p.layers||[]).map(function(L,i){return {L:L,i:i};}).filter(function(o){return o.L.enabled;});
  if(layers.length===0)return React.createElement("div",{style:{padding:20,fontSize:10,color:"#555",fontFamily:"monospace"}},"No enabled layers to compare.");
  // Fit a square-ish grid; cap cell size so many layers still fit.
  var n=layers.length;
  var cols=Math.ceil(Math.sqrt(n));
  var cell=Math.max(64,Math.min(150,Math.floor(440/cols)));
  return React.createElement("div",{style:{
    position:"absolute",inset:0,zIndex:6,background:"rgba(8,8,8,0.96)",
    display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
    padding:12,overflow:"auto"}},
    React.createElement("div",{style:{display:"flex",gap:6,marginBottom:10}},
      [["solo","Each Layer Alone"],["stack","Progressive Stack"]].map(function(o){
        var act=mode===o[0];
        return React.createElement("button",{key:o[0],onClick:function(){setMode(o[0]);},
          title:o[0]==="solo"?"Each layer rendered by itself (ignores blend & opacity)":"Cumulative composite: layer 1, then 1+2, then 1+2+3...",
          style:{padding:"4px 10px",fontSize:9,fontFamily:"monospace",background:act?"#e8900a":"#161616",
            color:act?"#000":"#777",border:"1px solid "+(act?"#e8900a":"#252525"),borderRadius:3,cursor:"pointer"}},o[1]);
      })
    ),
    React.createElement("div",{style:{display:"grid",gridTemplateColumns:"repeat("+cols+",auto)",gap:8,justifyContent:"center"}},
      layers.map(function(o){
        var L=o.L,i=o.i;
        var labelTxt=(i+1)+": "+(L.label||L.type||"Layer")+(mode==="stack"&&i>0&&L.blendMode&&L.blendMode!=="normal"?" ["+L.blendMode+"]":"");
        return React.createElement("div",{key:i,style:{display:"flex",flexDirection:"column",alignItems:"center",gap:3,
          cursor:"pointer",padding:4,borderRadius:4,border:"1px solid "+(p.activeIdx===i?"#e8900a":"#1c1c1c"),
          background:p.activeIdx===i?"rgba(232,144,10,0.08)":"transparent"},
          onClick:function(){p.onPick&&p.onPick(i);}},
          mode==="stack"
            ?React.createElement(StackPreview,{layers:p.layers,upto:i,size:cell})
            :React.createElement(SoloPreview,{layer:L,size:cell,allLayers:p.layers}),
          React.createElement("span",{style:{fontSize:8,fontFamily:"monospace",color:p.activeIdx===i?"#e8900a":"#888",
            maxWidth:cell,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}},labelTxt)
        );
      })
    ),
    React.createElement("div",{style:{marginTop:10,fontSize:8,color:"#555",fontFamily:"monospace"}},
      n+" layer"+(n>1?"s":"")+" · click one to edit it · press the ▥ button again to close")
  );
}

function SoloPreview(p){
  var canvasRef=useRef(null);
  var layer0=p.layer;
  // Resolve a reference layer so the preview matches the canvas.
  var layer=layer0;
  if(layer0&&layer0.refUid!=null&&p.allLayers){
    var rr=resolveReferences(p.allLayers);
    for(var _ri=0;_ri<p.allLayers.length;_ri++){if(p.allLayers[_ri]===layer0){layer=rr[_ri];break;}}
  }
  var _srcTok="";
  if(layer0&&layer0.refUid!=null&&p.allLayers){var sObj=p.allLayers.find(function(z){return z.uid===layer0.refUid;});if(sObj)_srcTok=JSON.stringify(sObj);}
  var thumbSize=p.size||128;
  var renderSize=Math.min(thumbSize,128); // cap internal render at 128px for speed
  useEffect(function(){
    if(!layer)return;
    var c=canvasRef.current;if(!c)return;
    var size=renderSize;
    // Build a minimal state with just this one layer (opacity=1, blend=normal)
    var solo=Object.assign({},layer,{opacity:1,blendMode:"normal",channels:"rgb",enabled:true});
    var buf=new Float32Array(size*size*4);
    // Use renderLayersToBuf with just this layer
    renderLayersToBuf(buf,size,[solo],null,[]);
    c.width=c.height=size;
    var ctx=c.getContext("2d"),img=ctx.createImageData(size,size);
    for(var i=0;i<size*size;i++){
      var ii=i*4;
      img.data[ii  ]=clamp(buf[ii  ])*255+0.5|0;
      img.data[ii+1]=clamp(buf[ii+1])*255+0.5|0;
      img.data[ii+2]=clamp(buf[ii+2])*255+0.5|0;
      img.data[ii+3]=255;
    }
    ctx.putImageData(img,0,0);
  },[layer,renderSize,_srcTok]);
  return React.createElement("canvas",{ref:canvasRef,style:{
    width:thumbSize,height:thumbSize,imageRendering:"pixelated",display:"block",borderRadius:2
  }});
}

// ═══ CURVE EDITOR ════════════════════════════════════════════════
// Interactive monotone-spline curve editor (like SD's Curve node)
// points: [{x,y},...] in [0,1]. onChange(newPoints).
// Curve presets
var CURVE_PRESETS=[
  {id:"linear",    label:"Linear",    pts:[{x:0,y:0},{x:1,y:1}]},
  {id:"easeIn",    label:"Ease In",   pts:[{x:0,y:0},{x:0.7,y:0.1},{x:1,y:1}]},
  {id:"easeOut",   label:"Ease Out",  pts:[{x:0,y:0},{x:0.3,y:0.9},{x:1,y:1}]},
  {id:"easeInOut", label:"S-Curve",   pts:[{x:0,y:0},{x:0.25,y:0.05},{x:0.75,y:0.95},{x:1,y:1}]},
  {id:"fastStart", label:"Fast",      pts:[{x:0,y:0},{x:0.1,y:0.75},{x:1,y:1}]},
  {id:"slowEnd",   label:"Slow End",  pts:[{x:0,y:0},{x:0.9,y:0.25},{x:1,y:1}]},
  {id:"bell",      label:"Bell",      pts:[{x:0,y:0},{x:0.5,y:1},{x:1,y:0}]},
];

function CurveEditor(p){
  var points=p.points||DEFAULT_CURVE;
  var onChange=p.onChange;
  var curveMode=p.mode||"smooth";
  var onModeChange=p.onModeChange;
  var baseSz=p.size||148;
  // Read from context if not explicitly passed — avoids prop drilling
  var ctxTouch=useContext(TouchActiveContext);
  var touchActive=p.touchActive!=null?!!p.touchActive:!!ctxTouch;
  // Point sizes — bigger on touch for easier dragging
  var ptR=touchActive?7:4.5;
  var ptRdrag=touchActive?9:7;
  var ptRhover=touchActive?8:6;
  // Hit threshold for nearestPt — larger on touch
  var hitThresh=touchActive?0.10:0.08;
  var canvasRef=useRef(null);
  var dragging=useRef(-1);
  var _bump=useState(0); var bump=_bump[0],setBump=_bump[1];
  var _big=useState(false); var big=_big[0],setBig=_big[1];
  var _hover=useState(-1); var hoverPt=_hover[0],setHoverPt=_hover[1];
  var _drag=useState(null); var dragCoord=_drag[0],setDragCoord=_drag[1];
  var sz=big?256:baseSz;

  useEffect(function(){
    var cv=canvasRef.current;if(!cv)return;
    cv.width=cv.height=sz;
    var ctx=cv.getContext("2d");
    // Background
    ctx.fillStyle="#0d0d0d";ctx.fillRect(0,0,sz,sz);
    // Grid
    ctx.strokeStyle="#171717";ctx.lineWidth=1;
    for(var gi=1;gi<4;gi++){
      ctx.beginPath();ctx.moveTo(gi*sz/4,0);ctx.lineTo(gi*sz/4,sz);
      ctx.moveTo(0,gi*sz/4);ctx.lineTo(sz,gi*sz/4);ctx.stroke();
    }
    // Identity diagonal
    ctx.strokeStyle="#1e1e1e";ctx.lineWidth=1;ctx.setLineDash([3,3]);
    ctx.beginPath();ctx.moveTo(0,sz);ctx.lineTo(sz,0);ctx.stroke();
    ctx.setLineDash([]);
    // Curve
    var sorted=points.slice().sort(function(a,b){return a.x-b.x;});
    if(sorted.length>=2){
      var lut=evalCurveLUT(sorted,curveMode);
      // Step mode: draw as horizontal lines
      if(curveMode==="step"){
        ctx.strokeStyle="#e8900a";ctx.lineWidth=2;
        ctx.beginPath();
        for(var si2=0;si2<256;si2++){
          var px2=(si2/255)*sz,py2=(1-lut[si2])*sz;
          if(si2===0)ctx.moveTo(px2,py2);else ctx.lineTo(px2,py2);
        }
        ctx.stroke();
        // Draw step risers
        ctx.strokeStyle="rgba(232,144,10,0.3)";ctx.lineWidth=1;ctx.setLineDash([2,2]);
        for(var pi3=1;pi3<sorted.length-1;pi3++){
          var sx3=sorted[pi3].x*sz,sy3=(1-sorted[pi3].y)*sz,prev3=(1-sorted[pi3-1].y)*sz;
          ctx.beginPath();ctx.moveTo(sx3,prev3);ctx.lineTo(sx3,sy3);ctx.stroke();
        }
        ctx.setLineDash([]);
      } else {
        ctx.strokeStyle="#e8900a";ctx.lineWidth=2;
        ctx.beginPath();
        for(var li=0;li<256;li++){
          var px2=(li/255)*sz,py2=(1-lut[li])*sz;
          if(li===0)ctx.moveTo(px2,py2);else ctx.lineTo(px2,py2);
        }
        ctx.stroke();
      }
    }
    // Control points
    for(var pi2=0;pi2<points.length;pi2++){
      var pt=points[pi2];
      var isEnd=pi2===0||pi2===points.length-1;
      var isDrag=dragging.current===pi2;
      var isHov=hoverPt===pi2&&!isDrag;
      ctx.beginPath();
      ctx.arc(pt.x*sz,(1-pt.y)*sz,isDrag?ptRdrag:isHov?ptRhover:ptR,0,6.2831853);
      ctx.fillStyle=isDrag?"#fff":isEnd?"#e8900a":"#ffcc44";
      ctx.globalAlpha=isHov&&!isDrag?0.85:1;
      ctx.fill();
      ctx.strokeStyle="#0d0d0d";ctx.lineWidth=1.5;ctx.stroke();
      ctx.globalAlpha=1;
    }
    // Axis labels
    ctx.fillStyle="#2a2a2a";ctx.font="8px monospace";ctx.textAlign="left";
    ctx.fillText("0",2,sz-2);ctx.textAlign="right";ctx.fillText("1",sz-2,sz-2);
    ctx.fillText("1",sz-2,10);
  },[points,bump,sz,curveMode,hoverPt]);

  function ptFromEvent(e){
    var rect=canvasRef.current.getBoundingClientRect();
    // Support both mouse and touch events
    var src=e.touches&&e.touches.length>0?e.touches[0]:(e.changedTouches&&e.changedTouches.length>0?e.changedTouches[0]:e);
    return{
      x:Math.max(0,Math.min(1,(src.clientX-rect.left)/rect.width)),
      y:Math.max(0,Math.min(1,1-(src.clientY-rect.top)/rect.height))
    };
  }
  // Touch handlers — delegate to mouse handlers after extracting coords.
  // Deleting a point is right-click on a mouse, which touch has no equivalent
  // for, so press-and-hold on a point deletes it. Moving cancels the delete so
  // an ordinary drag is unaffected.
  var _ptLp=useRef(null), _ptLpMoved=useRef(false), _ptLpStart=useRef(null);
  function deletePointAt(pt){
    var idx=nearestPt(pt,0.1);
    if(idx>0&&idx<points.length-1){
      var np=points.slice(); np.splice(idx,1); onChange(np); _curveCommit();
      dragging.current=null; haptic(16);
      setBump(function(b){return b+1;});
      return true;
    }
    return false;
  }
  function onTouchStart(e){
    e.preventDefault();
    var t=e.touches&&e.touches[0];
    if(t){
      _ptLpMoved.current=false; _ptLpStart.current={x:t.clientX,y:t.clientY};
      var pt=ptFromEvent(e);
      if(_ptLp.current)clearTimeout(_ptLp.current);
      _ptLp.current=setTimeout(function(){
        _ptLp.current=null;
        if(!_ptLpMoved.current)deletePointAt(pt);
      },500);
    }
    onDown(e);
  }
  function onTouchMove(e){
    e.preventDefault();
    var t=e.touches&&e.touches[0], st=_ptLpStart.current;
    if(_ptLp.current&&t&&st&&(Math.abs(t.clientX-st.x)>7||Math.abs(t.clientY-st.y)>7)){
      _ptLpMoved.current=true; clearTimeout(_ptLp.current); _ptLp.current=null;
    }
    onMove(e);
  }
  function onTouchEnd(e){
    e.preventDefault();
    if(_ptLp.current){clearTimeout(_ptLp.current);_ptLp.current=null;}
    onUp();
  }
  function nearestPt(pt,threshold){
    var best=-1,bestD=threshold||hitThresh;
    for(var i=0;i<points.length;i++){
      var d=Math.hypot(points[i].x-pt.x,points[i].y-pt.y);
      if(d<bestD){bestD=d;best=i;}
    }
    return best;
  }
  function onDown(e){
    e.preventDefault();
    var pt=ptFromEvent(e);
    if(e.button===2){
      var idx=nearestPt(pt,0.1);
      // Delete interior point — endpoints (first/last) are locked
      if(idx>0&&idx<points.length-1){var np=points.slice();np.splice(idx,1);onChange(np);_curveCommit();}
      return;
    }
    var idx=nearestPt(pt);
    if(idx>=0){dragging.current=idx;setDragCoord({x:points[idx].x,y:points[idx].y});}
    else{
      // pt is a fresh object literal — use indexOf (reference equality) after concat+sort
      // to find the new point unambiguously, regardless of coordinate proximity to others.
      var np2=points.concat([pt]).sort(function(a,b){return a.x-b.x;});
      onChange(np2);
      dragging.current=np2.indexOf(pt);
      setDragCoord({x:pt.x,y:pt.y});
    }
    setBump(function(b){return b+1;});
  }
  function onMove(e){
    var pt=ptFromEvent(e);
    if(dragging.current<0){
      // Hover highlight — wider threshold on touch
      var h=nearestPt(pt,touchActive?0.09:0.06);
      setHoverPt(h);
      return;
    }
    e.preventDefault();
    var np=points.slice(),i=dragging.current;
    if(i===0)pt.x=0;
    else if(i===points.length-1)pt.x=1;
    else{pt.x=Math.max(points[i-1].x+0.01,Math.min(points[i+1].x-0.01,pt.x));}
    np[i]=pt;
    onChange(np);
    setDragCoord({x:pt.x,y:pt.y});
    setBump(function(b){return b+1;});
  }
  function onUp(){
    var wasDrag=dragging.current>=0;
    dragging.current=-1;setDragCoord(null);setBump(function(b){return b+1;});
    if(wasDrag&&p.onCommit)p.onCommit();
  }
  function onLeave(){
    var wasDrag=dragging.current>=0;
    dragging.current=-1;setHoverPt(-1);setDragCoord(null);setBump(function(b){return b+1;});
    if(wasDrag&&p.onCommit)p.onCommit();
  }

  // Shared commit helper — all discrete curve operations (invert/mirror/reset/preset) must snapshot undo.
  function _curveCommit(){if(p.onCommit)p.onCommit();}
  function invertCurve(){onChange(points.map(function(p2){return{x:p2.x,y:1-p2.y};}));_curveCommit();}
  function mirrorCurve(){
    var np=points.map(function(p2){return{x:1-p2.x,y:p2.y};}).sort(function(a,b){return a.x-b.x;});
    np[0].x=0;np[np.length-1].x=1;
    onChange(np);_curveCommit();
  }
  function resetCurve(){onChange(DEFAULT_CURVE.map(function(p2){return Object.assign({},p2);}));_curveCommit();}

  // Build SVG path string for a preset's mini preview (smooth interp, 32 samples)
  function miniPath(pts,w,h){
    var sorted=pts.slice().sort(function(a,b){return a.x-b.x;});
    var lut=evalCurveLUT(sorted,"smooth");
    var d="";
    for(var i=0;i<32;i++){
      var lx=(i/31)*w,ly=(1-lut[Math.round(i/31*255)])*h;
      d+=(i===0?"M":"L")+lx.toFixed(1)+","+ly.toFixed(1)+" ";
    }
    return d;
  }

  var b0={background:"none",border:"none",cursor:"pointer",padding:0,fontFamily:"monospace"};
  var bMd={fontSize:8,padding:"3px 8px",borderRadius:2,cursor:"pointer",fontFamily:"monospace"};

  return React.createElement("div",{style:{marginBottom:10}},

    // ── Row 1: label/coords + expand + reset ────────────────
    React.createElement("div",{style:{display:"flex",alignItems:"center",marginBottom:5}},
      React.createElement("span",{style:{fontSize:9,color:"#555",textTransform:"uppercase",letterSpacing:1.2,flex:1}},
        dragCoord?"("+dragCoord.x.toFixed(2)+","+dragCoord.y.toFixed(2)+")":"Curve"
      ),
      React.createElement("button",{onClick:invertCurve,title:"Invert Y — flip curve vertically",
        style:{fontSize:11,background:"none",border:"none",color:"#555",cursor:"pointer",padding:"0 5px",lineHeight:1}},"↕"),
      React.createElement("button",{onClick:mirrorCurve,title:"Mirror X — flip curve horizontally",
        style:{fontSize:11,background:"none",border:"none",color:"#555",cursor:"pointer",padding:"0 5px",lineHeight:1}},"↔"),
      React.createElement("button",{onClick:resetCurve,title:"Reset to linear",
        style:{fontSize:10,background:"none",border:"none",color:"#555",cursor:"pointer",padding:"0 5px",lineHeight:1}},"↺"),
      React.createElement("button",{onClick:function(){setBig(function(v){return!v;});},title:big?"Collapse":"Expand",
        style:{fontSize:10,background:"none",border:"none",color:big?"#e8900a":"#555",cursor:"pointer",padding:"0 3px",lineHeight:1}},big?"⊟":"⊞")
    ),

    // ── Row 2: interp mode pills ─────────────────────────────
    React.createElement("div",{style:{display:"flex",gap:3,marginBottom:8}},
      ["smooth","linear","step"].map(function(m){
        var active=curveMode===m;
        var lbl=m==="smooth"?"Smooth":m==="linear"?"Linear":"Step";
        return React.createElement("button",{key:m,
          onClick:function(){onModeChange&&onModeChange(m);},
          style:Object.assign({},bMd,{
            background:active?"#e8900a":"#161616",
            color:active?"#000":"#555",
            border:"1px solid "+(active?"#e8900a":"#1e1e1e")
          })
        },lbl);
      }),
      React.createElement("div",{style:{flex:1}})
    ),

    // ── Row 3: preset thumbnails ─────────────────────────────
    React.createElement("div",{style:{display:"flex",gap:4,marginBottom:6,flexWrap:"wrap"}},
      CURVE_PRESETS.map(function(pr){
        var pw=34,ph=28;
        var path=miniPath(pr.pts,pw,ph);
        return React.createElement("button",{key:pr.id,
          onClick:function(){onChange(pr.pts.map(function(p2){return Object.assign({},p2);}));_curveCommit();},
          title:pr.label,
          style:{
            display:"flex",flexDirection:"column",alignItems:"center",gap:2,
            background:"#111",border:"1px solid #222",borderRadius:3,
            padding:"4px 4px 3px",cursor:"pointer",
            transition:"border-color 0.1s"
          },
          onMouseEnter:function(e){e.currentTarget.style.borderColor="#e8900a";},
          onMouseLeave:function(e){e.currentTarget.style.borderColor="#222";}
        },
          React.createElement("svg",{width:pw,height:ph,style:{display:"block",overflow:"visible"}},
            React.createElement("rect",{x:0,y:0,width:pw,height:ph,fill:"#0d0d0d",rx:1}),
            // identity diagonal (faint)
            React.createElement("line",{x1:0,y1:ph,x2:pw,y2:0,stroke:"#1e1e1e",strokeWidth:1,strokeDasharray:"2 2"}),
            // curve
            React.createElement("path",{d:path,fill:"none",stroke:"#e8900a",strokeWidth:1.5,strokeLinecap:"round",strokeLinejoin:"round"})
          ),
          React.createElement("span",{style:{fontSize:7,color:"#555",fontFamily:"monospace",letterSpacing:0.3,whiteSpace:"nowrap"}},
            pr.label
          )
        );
      })
    ),

    // ── Canvas ──────────────────────────────────────────────
    // Coordinate tooltip during drag
    dragCoord?React.createElement("div",{style:{
      fontSize:8,color:"#e8900a",fontFamily:"monospace",textAlign:"center",
      marginBottom:3,letterSpacing:0.5,minHeight:12
    }},"x:"+dragCoord.x.toFixed(3)+"y:"+dragCoord.y.toFixed(3)):React.createElement("div",{style:{minHeight:12}}),
    React.createElement("canvas",{ref:canvasRef,
      style:{display:"block",width:sz+"px",height:sz+"px",cursor:"crosshair",borderRadius:3,
             border:"1px solid #252525",imageRendering:"auto",touchAction:"none"},
      onMouseDown:onDown,onMouseMove:onMove,onMouseUp:onUp,onMouseLeave:onLeave,
      onTouchStart:onTouchStart,onTouchMove:onTouchMove,onTouchEnd:onTouchEnd,
      onContextMenu:function(e){e.preventDefault();onDown(e);}
    }),
    React.createElement("div",{style:{fontSize:7,color:"#2a2a2a",marginTop:3}},
      "Tap add  ·  Drag move  ·  Hold to delete"
    )
  );
}

// ═══ LAYER LABEL (inline editable) ════════════════════════════
function LayerLabel(p){
  var _e=useState(false); var editing=_e[0],setEditing=_e[1];
  var _v=useState(p.label); var val=_v[0],setVal=_v[1];
  var inputRef=useRef(null);
  var _rnLp=useRef(null), _rnMoved=useRef(false), _rnOrigin=useRef(null);
  useEffect(function(){if(editing&&inputRef.current){inputRef.current.focus();inputRef.current.select();}},[editing]);
  if(editing){
    return React.createElement("input",{
      ref:inputRef,
      value:val,
      onChange:function(e){setVal(e.target.value);},
      onBlur:function(){p.onChange(val||p.label);setEditing(false);},
      onKeyDown:function(e){if(e.key==="Enter"){p.onChange(val||p.label);setEditing(false);}if(e.key==="Escape"){setVal(p.label);setEditing(false);}e.stopPropagation();},
      style:{
        fontSize:8,color:p.color||"#e8900a",letterSpacing:0.5,
        background:"#1a1a1a",border:"1px solid "+(p.color||"#e8900a"),
        borderRadius:2,padding:"1px 3px",width:36,fontFamily:"monospace",
        outline:"none",textAlign:"center"
      }
    });
  }
  // Renaming is double-click on a mouse; touch gets press-and-hold.
  function beginRename(){ setVal(p.label); setEditing(true); }
  return React.createElement("span",{
    onDoubleClick:function(e){e.stopPropagation();beginRename();},
    onPointerDown:function(e){
      if(_rnLp.current)clearTimeout(_rnLp.current);
      _rnMoved.current=false; _rnOrigin.current={x:e.clientX,y:e.clientY};
      _rnLp.current=setTimeout(function(){
        _rnLp.current=null;
        if(!_rnMoved.current){ haptic(14); beginRename(); }
      },500);
    },
    onPointerMove:function(e){
      var o=_rnOrigin.current;
      if(_rnLp.current&&o&&(Math.abs(e.clientX-o.x)>7||Math.abs(e.clientY-o.y)>7)){
        _rnMoved.current=true; clearTimeout(_rnLp.current); _rnLp.current=null;
      }
    },
    onPointerUp:function(){ if(_rnLp.current){clearTimeout(_rnLp.current);_rnLp.current=null;} },
    onPointerCancel:function(){ if(_rnLp.current){clearTimeout(_rnLp.current);_rnLp.current=null;} },
    title:"Double-click or press and hold to rename",
    style:{fontSize:8,color:p.color||"#e8900a",letterSpacing:0.5,cursor:"text",userSelect:"none",
      touchAction:"none",padding:"2px 0"}
  },p.label);
}

// ═══ UV DIST STACK ══════════════════════════════════════════════
function UVDistStack(p){
  var dists=p.dists&&p.dists.length?p.dists:[mkDist()];
  var hasActive=dists.some(function(d){return d.type&&d.type!=="none"&&d.amt>0;});
  function upd(i,k,v){var nd=dists.slice();nd[i]=Object.assign({},nd[i]);nd[i][k]=v;p.setDists(nd);}
  function add(){if(dists.length>=3)return;p.setDists(dists.concat([mkDist()]));}
  function rem(i){var nd=dists.slice();nd.splice(i,1);p.setDists(nd.length?nd:[mkDist()]);}
  var NOISE_T=["noise","fbmNoise","ridged","turbulence","voronoi","directional","multidirectional"];
  var FBM_T=["fbmNoise","ridged","turbulence","directional","multidirectional"];
  return React.createElement(Collapse,{
    id:"uvdist_stack",
    title:"UV Distortion"+(hasActive?" ●":""),
    defaultOpen:hasActive,
    color:hasActive?"#e8900a":"#555",
    badge:hasActive?(dists.filter(function(d){return d.type&&d.type!=="none"&&d.amt>0;}).length+" active"):null
  },
    React.createElement("div",{style:{fontSize:8,color:"#444",marginBottom:8,lineHeight:1.5}},"Distorts UVs before noise sampling. Multiple dists add together."),
    dists.map(function(d,i){
      var isNoise=NOISE_T.indexOf(d.type||"none")!==-1;
      var isFBM=FBM_T.indexOf(d.type||"none")!==-1;
      return React.createElement("div",{key:i,style:{marginBottom:i<dists.length-1?12:0,paddingBottom:i<dists.length-1?12:0,borderBottom:i<dists.length-1?"1px solid #1e1e1e":"none"}},
        React.createElement("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}},
          React.createElement("span",{style:{fontSize:9,color:"#555",letterSpacing:1}},"DIST "+(i+1)),
          dists.length>1?React.createElement(SmBtn,{onClick:function(){rem(i);}},"×"):null
        ),
        React.createElement(Sel,{value:d.type||"none",opts:UVT,onChange:function(v){upd(i,"type",v);},grid:true,cols:3}),
        d.type!=="none"?React.createElement(Slider,{label:"Amount",value:d.amt||0,min:-5,max:5,step:0.02,onChange:function(v){upd(i,"amt",v);}}):null,
        // Layer Warp: pick which layer drives the displacement
        d.type==="layer"&&p.layers?React.createElement("div",{style:{marginBottom:8}},
          React.createElement(Sel,{label:"Source Layer",value:d.sourceLayerIdx!=null?d.sourceLayerIdx:0,
            opts:p.layers.map(function(ll,idx){return{v:idx,l:(idx+1)+": "+(ll.label||"L"+(idx+1))+(idx===p.si?" (self)":"")};}),
            onChange:function(v){upd(i,"sourceLayerIdx",v);},grid:true,cols:2}),
          React.createElement("div",{style:{fontSize:8,color:"#444",lineHeight:1.5}},
            "Uses the source layer's luminance as a displacement map. Selecting the layer itself does nothing (self-warp is skipped).")
        ):null,
        (d.type==="swirl"||d.type==="twist")?React.createElement("div",{style:{marginBottom:8}},
          React.createElement("span",{style:{fontSize:9,color:"#555",letterSpacing:1.2,textTransform:"uppercase",display:"block",marginBottom:4}},"Falloff"),
          React.createElement("div",{style:{display:"flex",gap:4,marginBottom:6}},
            [{v:"center",l:"Center"},{v:"edge",l:"Edge"}].map(function(opt){
              var active=(d.falloff||"center")===opt.v;
              return React.createElement("button",{key:opt.v,onClick:function(){upd(i,"falloff",opt.v);},
                style:{flex:1,padding:"4px 0",fontSize:9,fontFamily:"monospace",
                  background:active?"#e8900a":"#161616",color:active?"#000":"#555",
                  border:"1px solid "+(active?"#e8900a":"#252525"),borderRadius:2,cursor:"pointer"}},opt.l);
            })
          ),
          React.createElement(Slider,{label:"Falloff Radius",value:d.falloffRadius!=null?d.falloffRadius:0.5,min:0.05,max:1.5,step:0.01,
            fmt:function(v){return v.toFixed(2);},onChange:function(v){upd(i,"falloffRadius",v);}})
        ):null,
        // ── Radial polar displacement controls ───────────────
        d.type==="radial"?React.createElement("div",{style:{marginBottom:8}},
          // Mode selector
          React.createElement("span",{style:{fontSize:9,color:"#555",letterSpacing:1.2,textTransform:"uppercase",display:"block",marginBottom:4}},"Mode"),
          React.createElement("div",{style:{display:"flex",gap:3,marginBottom:8}},
            [{v:"radial",l:"Radial"},{v:"tangential",l:"Tangential"},{v:"spiral",l:"Spiral"}].map(function(opt){
              var active=(d.mode||"radial")===opt.v;
              return React.createElement("button",{key:opt.v,onClick:function(){upd(i,"mode",opt.v);},
                style:{flex:1,padding:"5px 0",fontSize:9,fontFamily:"monospace",
                  background:active?"#e8900a":"#161616",color:active?"#000":"#555",
                  border:"1px solid "+(active?"#e8900a":"#252525"),borderRadius:2,cursor:"pointer"}
              },opt.l);
            })
          ),
          // Spiral bias only shown for spiral mode
          (d.mode==="spiral")?React.createElement(Slider,{
            label:"Spiral Bias (0=radial, 1=tangential)",
            value:d.spiralBias!=null?d.spiralBias:0.5,min:0,max:1,step:0.01,
            fmt:function(v){return v.toFixed(2);},onChange:function(v){upd(i,"spiralBias",v);}
          }):null,
          // Direction (only for radial mode)
          (d.mode==="radial"||!d.mode)?React.createElement("div",null,
            React.createElement("span",{style:{fontSize:9,color:"#555",letterSpacing:1.2,textTransform:"uppercase",display:"block",marginBottom:4}},"Direction"),
            React.createElement("div",{style:{display:"flex",gap:4,marginBottom:8}},
              [{v:"outward",l:"Push Out"},{v:"inward",l:"Pull In"}].map(function(opt){
                var active=(d.direction||"outward")===opt.v;
                return React.createElement("button",{key:opt.v,onClick:function(){upd(i,"direction",opt.v);},
                  style:{flex:1,padding:"4px 0",fontSize:9,fontFamily:"monospace",
                    background:active?"#e8900a":"#161616",color:active?"#000":"#555",
                    border:"1px solid "+(active?"#e8900a":"#252525"),borderRadius:2,cursor:"pointer"}},opt.l);
              })
            )
          ):null,
          // Falloff profile
          React.createElement("span",{style:{fontSize:9,color:"#555",letterSpacing:1.2,textTransform:"uppercase",display:"block",marginBottom:4}},"Falloff Profile"),
          React.createElement("div",{style:{display:"grid",gridTemplateColumns:"1fr 1fr",gap:3,marginBottom:8}},
            [{v:"linear",l:"Linear"},{v:"inverse",l:"Inverse (center)"},{v:"flat",l:"Flat (uniform)"},{v:"gauss",l:"Gaussian"},{v:"ring",l:"Ring"}].map(function(opt){
              var active=(d.profile||"linear")===opt.v;
              return React.createElement("button",{key:opt.v,onClick:function(){upd(i,"profile",opt.v);},
                style:{padding:"4px 4px",fontSize:9,fontFamily:"monospace",textAlign:"center",
                  background:active?"#e8900a":"#161616",color:active?"#000":"#555",
                  border:"1px solid "+(active?"#e8900a":"#252525"),borderRadius:2,cursor:"pointer"}},opt.l);
            })
          ),
          React.createElement(Slider,{label:"Falloff Radius",value:d.falloffRadius!=null?d.falloffRadius:0.4,min:0.05,max:1.5,step:0.01,
            fmt:function(v){return v.toFixed(2);},onChange:function(v){upd(i,"falloffRadius",v);}}),
          // Noise modulation
          React.createElement(Tog,{label:"Noise modulation",value:!!d.modulate,onChange:function(v){upd(i,"modulate",v);}}),
          d.modulate?React.createElement("div",{style:{paddingTop:8,marginTop:4,borderTop:"1px solid #1e1e1e"}},
            React.createElement(Slider,{label:"Noise Amount",value:d.noiseAmt!=null?d.noiseAmt:0.7,min:0,max:1.5,step:0.02,onChange:function(v){upd(i,"noiseAmt",v);}}),
            React.createElement(Slider,{label:"Frequency",value:d.freq||3,min:0.2,max:20,step:0.1,onChange:function(v){upd(i,"freq",v);}}),
            React.createElement(Sel,{label:"Mode",value:d.noiseMode||"normal",
              opts:[{v:"normal",l:"Normal"},{v:"ridged",l:"Ridged"},{v:"turbulence",l:"Turbulence"},{v:"billow",l:"Billow"}],
              onChange:function(v){upd(i,"noiseMode",v);}}),
            React.createElement(Slider,{label:"Octaves",value:d.oct||4,min:1,max:8,step:1,fmt:Math.round,onChange:function(v){upd(i,"oct",Math.round(v));}}),
            React.createElement(Slider,{label:"Gain",value:d.gain||0.5,min:0.1,max:0.9,step:0.01,onChange:function(v){upd(i,"gain",v);}})
          ):null
        ):null,
        // ── Directional controls ──────────────────────────────
        d.type==="directional"?React.createElement("div",{style:{marginBottom:8}},
          React.createElement(Slider,{label:"Angle",value:d.angle||0,min:-180,max:180,step:1,presets:[{v:0,l:"0°"},{v:45,l:"45°"},{v:90,l:"90°"},{v:135,l:"135°"},{v:180,l:"180°"}],
            fmt:function(v){return Math.round(v)+"°";},onChange:function(v){upd(i,"angle",v);}}),
          React.createElement(Tog,{label:"Modulate by noise",value:!!d.modulate,onChange:function(v){upd(i,"modulate",v);}})
        ):null,
        // ── Multidirectional controls ─────────────────────────
        d.type==="multidirectional"?React.createElement("div",{style:{marginBottom:8}},
          React.createElement(Slider,{label:"Directions",value:d.count||4,min:2,max:16,step:1,fmt:Math.round,onChange:function(v){upd(i,"count",Math.round(v));}}),
          React.createElement(Slider,{label:"Base Angle",value:d.angle||0,min:-180,max:180,step:1,
            fmt:function(v){return Math.round(v)+"°";},onChange:function(v){upd(i,"angle",v);}}),
          React.createElement(Slider,{label:"Spread",value:d.spread!=null?d.spread:1,min:0,max:1,step:0.01,
            fmt:function(v){return v===0?"0 (parallel)":v===1?"1 (full 360°)":v.toFixed(2);},
            onChange:function(v){upd(i,"spread",v);}}),
          React.createElement("span",{style:{fontSize:9,color:"#555",letterSpacing:1.2,textTransform:"uppercase",display:"block",marginBottom:4}},"Falloff"),
          React.createElement("div",{style:{display:"flex",gap:3,marginBottom:6}},
            [{v:"none",l:"None"},{v:"center",l:"Center"},{v:"edge",l:"Edge"}].map(function(opt){
              var active=(d.falloff||"none")===opt.v;
              return React.createElement("button",{key:opt.v,onClick:function(){upd(i,"falloff",opt.v);},
                style:{flex:1,padding:"4px 0",fontSize:9,fontFamily:"monospace",
                  background:active?"#e8900a":"#161616",color:active?"#000":"#555",
                  border:"1px solid "+(active?"#e8900a":"#252525"),borderRadius:2,cursor:"pointer"}},opt.l);
            })
          ),
          (d.falloff==="center"||d.falloff==="edge")?React.createElement(Slider,{label:"Falloff Radius",value:d.falloffRadius!=null?d.falloffRadius:0.5,min:0.05,max:1.5,step:0.01,
            fmt:function(v){return v.toFixed(2);},onChange:function(v){upd(i,"falloffRadius",v);}}):null
        ):null,
        isNoise?React.createElement(Slider,{label:"Frequency",value:d.freq||3,min:0.2,max:20,step:0.1,onChange:function(v){upd(i,"freq",v);}}):null,
        d.type==="ripple"?React.createElement(Slider,{label:"Frequency",value:d.freq||6,min:0.5,max:20,step:0.1,onChange:function(v){upd(i,"freq",v);}}):null,
        d.type!=="none"?React.createElement("div",{style:{display:"flex",gap:6}},
          React.createElement("div",{style:{flex:1}},React.createElement(Slider,{label:"Offset X",value:d.offsetX||0,min:-1,max:1,step:0.01,onChange:function(v){upd(i,"offsetX",v);}})),
          React.createElement("div",{style:{flex:1}},React.createElement(Slider,{label:"Offset Y",value:d.offsetY||0,min:-1,max:1,step:0.01,onChange:function(v){upd(i,"offsetY",v);}}))
        ):null,
        isFBM?React.createElement("div",null,
          React.createElement(Sel,{label:"Base noise",value:d.base||"perlin",
            opts:[{v:"perlin",l:"Perlin"},{v:"value",l:"Value"},{v:"simplex",l:"Simplex"}],
            onChange:function(v){upd(i,"base",v);}}),
          React.createElement(Slider,{label:"Octaves",value:d.oct||4,min:1,max:8,step:1,fmt:Math.round,onChange:function(v){upd(i,"oct",Math.round(v));}}),
          React.createElement(Slider,{label:"Roughness (gain)",value:d.gain||0.5,min:0.1,max:0.9,step:0.01,onChange:function(v){upd(i,"gain",v);}}),
          React.createElement(Slider,{label:"Lacunarity",value:d.lac||2,min:1,max:4,step:0.05,onChange:function(v){upd(i,"lac",v);}})
        ):null
      );
    }),
    dists.length<3?React.createElement("button",{onClick:add,style:{marginTop:8,padding:"5px 10px",background:"#1a1a1a",border:"1px solid #282828",color:"#777",fontFamily:"monospace",fontSize:10,cursor:"pointer",borderRadius:3,width:"100%"}},"+  Add distortion"):null
  );
}

// ═══ GRADIENT TYPE PREVIEW GRID ══════════════════════════════════
// Shows live canvas thumbnails for each gradient subtype.
var GRAD_TYPES=[
  {id:"radial",l:"Radial"},{id:"linear",l:"Linear H"},{id:"linearY",l:"Linear V"},
  {id:"diamond",l:"Diamond"},{id:"square",l:"Square"},{id:"cone",l:"Cone"},
  {id:"angular",l:"Angular"},{id:"spiral",l:"Spiral"},
  {id:"rings",l:"Rings"},{id:"sineRadial",l:"Sine Radial"},{id:"sineBands",l:"Sine Bands"},
  {id:"angBands",l:"Ang Bands"},{id:"sawtooth",l:"Sawtooth"},{id:"stepped",l:"Stepped"},
  {id:"starBurst",l:"Star Burst"},
  {id:"pulseRing",l:"Pulse Ring"},{id:"glowCore",l:"Glow Core"},{id:"cross",l:"Cross"},
  {id:"spiralArms",l:"Spiral Arms"},{id:"hexRadial",l:"Hex Radial"},{id:"ripple",l:"Ripple"}
];
function GradientPreviewGrid(p){
  var sz=42;
  var canvases=useRef({});
  var prevActive=useRef(null);
  var activeKind=p.value||"radial";
  var activeCol=p.col||"#e8900a";
  var activeRGB=hexF(activeCol);
  function paintGrad(c,id,isActive){
    c.width=c.height=sz;
    var ctx=c.getContext("2d"),img=ctx.createImageData(sz,sz);
    var inv=1/sz;
    for(var py=0;py<sz;py++){
      for(var px=0;px<sz;px++){
        var cx=(px*inv-0.5),cy=(py*inv-0.5);
        var v=computeGrad(cx,cy,id);
        var ii=(py*sz+px)*4;
        if(isActive){img.data[ii]=10+v*activeRGB[0]*220+0.5|0;img.data[ii+1]=10+v*activeRGB[1]*220+0.5|0;img.data[ii+2]=10+v*activeRGB[2]*220+0.5|0;}
        else{img.data[ii]=10+v*210+0.5|0;img.data[ii+1]=10+v*200+0.5|0;img.data[ii+2]=10+v*185+0.5|0;}
        img.data[ii+3]=255;
      }
    }
    ctx.putImageData(img,0,0);
  }
  useEffect(function(){
    var h=setTimeout(function(){
      GRAD_TYPES.forEach(function(g){var c=canvases.current[g.id];if(c)paintGrad(c,g.id,g.id===activeKind);});
      prevActive.current=activeKind;
    },40);
    return function(){clearTimeout(h);};
  },[]);
  useEffect(function(){
    if(prevActive.current&&prevActive.current!==activeKind){
      var cOld=canvases.current[prevActive.current];if(cOld)paintGrad(cOld,prevActive.current,false);
    }
    var cNew=canvases.current[activeKind];if(cNew)paintGrad(cNew,activeKind,true);
    prevActive.current=activeKind;
  },[activeKind,activeCol]);
  return React.createElement("div",{style:{marginBottom:10}},
    React.createElement("div",{style:{display:"flex",flexWrap:"wrap",gap:3}},
      GRAD_TYPES.map(function(g){
        var isActive=activeKind===g.id;
        return React.createElement("button",{key:g.id,onClick:function(){p.onChange(g.id);},title:g.l,
          style:{display:"flex",flexDirection:"column",alignItems:"center",gap:2,padding:2,background:"#080808",
            border:"2px solid "+(isActive?activeCol:"#1c1c1c"),borderRadius:3,cursor:"pointer"},
          onMouseEnter:function(e){if(!isActive)e.currentTarget.style.borderColor="#333";},
          onMouseLeave:function(e){if(!isActive)e.currentTarget.style.borderColor="#1c1c1c";}
        },
          React.createElement("canvas",{ref:function(el){if(el)canvases.current[g.id]=el;},
            style:{width:sz,height:sz,display:"block",imageRendering:"pixelated",borderRadius:2}}),
          React.createElement("span",{style:{fontSize:7,fontFamily:"monospace",color:isActive?activeCol:"#444",lineHeight:1,textAlign:"center",maxWidth:sz+4,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}},g.l)
        );
      })
    )
  );
}

// ═══ BLEND PREVIEW ROW ══════════════════════════════════════════
// Live thumbnails showing what each blend mode would produce if user added
// a new layer with that blend. Debounced so slider drags don't recompute.
var BLEND_PREVIEW_LIST=[
  {bm:"normal",   l:"Normal",  col:"#e8900a", icon:"+"},
  {bm:"add",      l:"Add",     col:"#44ddcc", icon:"＋"},
  {bm:"subtract", l:"Sub",     col:"#ff6699", icon:"−"},
  {bm:"multiply", l:"Mul",     col:"#cc88ff", icon:"×"},
  {bm:"screen",   l:"Scr",     col:"#ffdd44", icon:"S"},
  {bm:"overlay",  l:"Ovl",     col:"#a0e060", icon:"Ov"}
];

function BlendPreviewRow(p){
  var size=38;
  var canvases=useRef([]);
  var layers=p.layers;
  var canAdd=layers.length<8;

  useEffect(function(){
    if(_isSliderActive)return; // skip during drag
    // Debounce: only compute 250ms after last state change
    var handle=setTimeout(function(){
      if(_isSliderActive)return; // double-check at fire time
      try{
        // 1. Render current composite ONCE (this is the expensive part)
        var baseBuf=new Float32Array(size*size*4);
        renderLayersToBuf(baseBuf,size,layers,null,[]);

        // 2. Render two overlay candidates ONCE:
        //    - shape (circle) for subtract/multiply (shows carving effect clearly)
        //    - fbm for everything else (shows tonal blend)
        var shapeOv=mkL(0,12345,{type:"shape",shapeKind:"circle",enabled:true,blendMode:"normal"});
        shapeOv.shapeP=Object.assign({},DSP,{r1:0.32,soft:0.04});
        shapeOv.colorA="#000000";shapeOv.colorB="#ffffff";
        shapeOv.colorStops=[{pos:0,color:"#000000"},{pos:1,color:"#ffffff"}];
        var shapeBuf=new Float32Array(size*size*4);
        renderLayersToBuf(shapeBuf,size,[shapeOv],null,[]);

        var fbmOv=mkL(0,12345,{type:"fbm",enabled:true,blendMode:"normal"});
        Object.assign(fbmOv,TYPE_DEFAULTS.fbm||{});
        fbmOv.scaleX=4;fbmOv.scaleY=4;
        fbmOv.colorA="#000000";fbmOv.colorB="#ffffff";
        fbmOv.colorStops=[{pos:0,color:"#000000"},{pos:1,color:"#ffffff"}];
        var fbmBuf=new Float32Array(size*size*4);
        renderLayersToBuf(fbmBuf,size,[fbmOv],null,[]);

        // 3. For each blend mode, composite base + overlay using blendV
        //    This is cheap — just per-pixel blend math, no noise evaluation
        BLEND_PREVIEW_LIST.forEach(function(b,idx){
          var c=canvases.current[idx];if(!c)return;
          var useShape=b.bm==="subtract"||b.bm==="multiply";
          var ov=useShape?shapeBuf:fbmBuf;
          c.width=c.height=size;
          var ctx=c.getContext("2d"),img=ctx.createImageData(size,size);
          for(var i=0;i<size*size;i++){
            var ii=i*4;
            var r=clamp(blendV(baseBuf[ii  ],ov[ii  ],b.bm));
            var g=clamp(blendV(baseBuf[ii+1],ov[ii+1],b.bm));
            var B=clamp(blendV(baseBuf[ii+2],ov[ii+2],b.bm));
            img.data[ii  ]=r*255+0.5|0;
            img.data[ii+1]=g*255+0.5|0;
            img.data[ii+2]=B*255+0.5|0;
            img.data[ii+3]=255;
          }
          ctx.putImageData(img,0,0);
        });
      }catch(e){console.error("blend preview:",e);}
    },280);
    return function(){clearTimeout(handle);};
  },[layers,p.canvasEpoch]);

  return React.createElement("div",{style:{marginBottom:8}},
    React.createElement("div",{style:{fontSize:7,color:"#333",letterSpacing:1,textTransform:"uppercase",marginBottom:4,display:"flex",alignItems:"center",gap:6}},
      React.createElement("span",null,"Quick Add with Blend"),
      !canAdd?React.createElement("span",{style:{color:"#664400"}},"(max 8 layers)"):null
    ),
    React.createElement("div",{style:{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:3}},
      BLEND_PREVIEW_LIST.map(function(b,idx){
        return React.createElement("button",{key:b.bm,
          onClick:function(){if(canAdd)p.onAdd(b.bm);},
          disabled:!canAdd,
          title:"Add new layer with "+b.l+" blend\n(preview shows actual result with a "+(b.bm==="subtract"||b.bm==="multiply"?"shape":"fbm noise")+" layer)",
          style:{
            padding:3,background:"#0a0a0a",
            border:"1px solid "+(canAdd?(b.col+"66"):"#1a1a1a"),
            borderRadius:3,cursor:canAdd?"pointer":"not-allowed",
            display:"flex",flexDirection:"column",alignItems:"center",gap:2,
            opacity:canAdd?1:0.4,
            transition:"border-color 0.12s,transform 0.1s"
          },
          onMouseEnter:canAdd?function(e){e.currentTarget.style.borderColor=b.col;e.currentTarget.style.transform="translateY(-1px)";}:null,
          onMouseLeave:canAdd?function(e){e.currentTarget.style.borderColor=b.col+"66";e.currentTarget.style.transform="none";}:null
        },
          React.createElement("canvas",{
            ref:function(el){canvases.current[idx]=el;},
            style:{width:size,height:size,display:"block",imageRendering:"pixelated",borderRadius:2}
          }),
          React.createElement("span",{style:{
            fontSize:8,color:b.col,fontFamily:"monospace",
            letterSpacing:0.3,fontWeight:600,lineHeight:1
          }},b.l)
        );
      })
    )
  );
}

// ═══ BLEND MODE PICKER — thumbnails per blend mode ════════════════
// Shows live preview of what each blend mode does with current layer.
// Base = all layers below si composited.
// Overlay = current layer rendered alone (normal blend, opacity 1).
// Each cell = blendV(base, overlay, blendMode).
// Debounced like BlendPreviewRow (280ms, skips during slider drag).

var BM_GROUPS_FULL=[
  {label:"Basic",     modes:[["normal","Normal"],["dissolve","Dissolve"]]},
  {label:"Lighten",   modes:[["add","Add"],["screen","Screen"],["lighten","Lighten"],["linearDodge","Lin.Dodge"]]},
  {label:"Darken",    modes:[["multiply","Multiply"],["darken","Darken"]]},
  {label:"Contrast",  modes:[["overlay","Overlay"],["softlight","Soft Light"],["hardlight","Hard Light"]]},
  {label:"Inversion", modes:[["difference","Diff."],["exclusion","Exclusion"],["subtract","Subtract"],["divide","Divide"]]},
  {label:"Math",      modes:[["max","Max"],["min","Min"]]}
];

function BlendModePicker(props){
  var sz=32; // thumbnail size
  var value=props.value||"normal";
  var canvases=useRef({});
  var activeCol=props.col||"#e8900a";

  useEffect(function(){
    if(_isSliderActive)return;
    var handle=setTimeout(function(){
      if(_isSliderActive)return;
      try{
        // Base: all layers below si
        var baseBuf=new Float32Array(sz*sz*4);
        if(props.si>0&&props.layers&&props.layers.length>props.si){
          renderLayersToBuf(baseBuf,sz,props.layers.slice(0,props.si),null,[]);
        }
        // Overlay: current layer alone, normal blend, opacity 1
        var curBuf=new Float32Array(sz*sz*4);
        if(props.layers&&props.layers[props.si]){
          var solo=Object.assign({},props.layers[props.si],{blendMode:"normal",opacity:1,enabled:true});
          renderLayersToBuf(curBuf,sz,[solo],null,[]);
        } else {
          // Fallback: diagonal gradient so you can see blend effect even on layer 0
          for(var _i=0;_i<sz*sz;_i++){
            var _u=(_i%sz)/sz, _v=Math.floor(_i/sz)/sz;
            var _v2=(_u+_v)*0.5;
            curBuf[_i*4]=_v2;curBuf[_i*4+1]=_v2*0.6;curBuf[_i*4+2]=_v2*0.3;curBuf[_i*4+3]=1;
          }
        }
        // Composite each blend mode
        BM_GROUPS_FULL.forEach(function(grp){
          grp.modes.forEach(function(m){
            var bm=m[0],c=canvases.current[bm];
            if(!c)return;
            c.width=c.height=sz;
            var ctx=c.getContext("2d"),img=ctx.createImageData(sz,sz);
            for(var i=0;i<sz*sz;i++){
              var ii=i*4;
              img.data[ii  ]=clamp(blendV(baseBuf[ii  ],curBuf[ii  ],bm))*255+0.5|0;
              img.data[ii+1]=clamp(blendV(baseBuf[ii+1],curBuf[ii+1],bm))*255+0.5|0;
              img.data[ii+2]=clamp(blendV(baseBuf[ii+2],curBuf[ii+2],bm))*255+0.5|0;
              img.data[ii+3]=255;
            }
            ctx.putImageData(img,0,0);
          });
        });
      }catch(e){console.error("BlendModePicker:",e);}
    },280);
    return function(){clearTimeout(handle);};
  },[props.layers,props.si,props.canvasEpoch]);

  return React.createElement("div",null,
    BM_GROUPS_FULL.map(function(grp){
      return React.createElement("div",{key:grp.label,style:{marginBottom:8}},
        React.createElement("span",{style:{
          fontSize:7,color:"#2a2a2a",letterSpacing:1.5,textTransform:"uppercase",
          display:"block",marginBottom:4
        }},grp.label),
        React.createElement("div",{style:{display:"flex",flexWrap:"wrap",gap:3}},
          grp.modes.map(function(m){
            var bm=m[0],label=m[1],isActive=value===bm;
            return React.createElement("button",{key:bm,
              onClick:function(){props.onChange(bm);},
              title:"Blend mode: "+label+(props.si===0?" (layer 0: base has no layers below, preview shows layer alone)":""),
              style:{
                display:"flex",flexDirection:"column",alignItems:"center",gap:2,
                padding:3,
                background:isActive?"rgba(232,144,10,0.12)":"#0a0a0a",
                border:"2px solid "+(isActive?activeCol:"#1c1c1c"),
                borderRadius:3,cursor:"pointer",
                transition:"border-color 0.1s,transform 0.1s",
                minWidth:sz+6
              },
              onMouseEnter:function(e){if(!isActive){e.currentTarget.style.borderColor="#3a3a3a";e.currentTarget.style.transform="translateY(-1px)";}},
              onMouseLeave:function(e){if(!isActive){e.currentTarget.style.borderColor="#1c1c1c";e.currentTarget.style.transform="none";}}
            },
              React.createElement("canvas",{
                ref:function(el){if(el)canvases.current[bm]=el;},
                style:{width:sz,height:sz,display:"block",imageRendering:"pixelated",borderRadius:2,
                  outline:isActive?"2px solid "+activeCol+"88":"none"}
              }),
              React.createElement("span",{style:{
                fontSize:7,fontFamily:"monospace",
                color:isActive?activeCol:"#444",
                letterSpacing:0.2,lineHeight:1,textAlign:"center",
                maxWidth:sz+6,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"
              }},label)
            );
          })
        )
      );
    })
  );
}

// ═══ NOISE PANEL ════════════════════════════════════════════════
// ═══ COLLAPSIBLE TYPE SELECTOR ══════════════════════════════════
// Tiny preview of what a noise TYPE looks like with its default params, shown
// on each type button so you can recognise it before selecting. Renders once
// per (id) at a small fixed size with a fixed seed — cheap and stable.
function NoiseTypeThumb(p){
  var canvasRef=useRef(null);
  var id=p.id, TD=p.TD, size=p.size||22;
  useEffect(function(){
    var c=canvasRef.current;if(!c)return;
    // Build a minimal layer: type defaults + sensible base so every type shows
    // something representative. Fixed seed for a stable, recognisable thumbnail.
    var defs=(TD&&TD[id])||{};
    var L=Object.assign({
      type:id,seed:12345,scaleX:defs.scaleX||4,scaleY:defs.scaleY||4,scaleLinked:true,
      octaves:5,lacunarity:2,gain:0.5,opacity:1,blendMode:"normal",channels:"rgb",
      enabled:true,colorA:"#000000",colorB:"#ffffff",contrast:1,contrastMode:"power",
      midpoint:0.5,brightness:0.5,curvePoints:DEFAULT_CURVE,uvDists:[mkDist()],
      colorStops:[{pos:0,color:"#000000"},{pos:1,color:"#ffffff"}],shapeP:Object.assign({},DSP),
      gradientType:"radial",shapeKind:"circle"
    },defs,{type:id,seed:12345});
    try{
      var buf=new Float32Array(size*size*4);
      renderLayersToBuf(buf,size,[L],null,[]);
      c.width=c.height=size;
      var ctx=c.getContext("2d"),img=ctx.createImageData(size,size);
      for(var i=0;i<size*size;i++){var ii=i*4;
        img.data[ii]=clamp(buf[ii])*255+0.5|0;img.data[ii+1]=clamp(buf[ii+1])*255+0.5|0;
        img.data[ii+2]=clamp(buf[ii+2])*255+0.5|0;img.data[ii+3]=255;}
      ctx.putImageData(img,0,0);
    }catch(e){/* type may need data we don't have (image) — leave blank */}
  },[id,size]);
  return React.createElement("canvas",{ref:canvasRef,style:{
    width:size,height:size,imageRendering:"pixelated",display:"block",borderRadius:2,
    margin:"0 auto 3px"
  }});
}

function CollapsibleTypeSelector(p){
  var L=p.L,setL=p.setL,TG=p.TG,TD=p.TYPE_DEFAULTS;
  var _srch=useState(""); var typeSearch=_srch[0],setTypeSearch=_srch[1];
  // Which category contains the active type
  var activeGroup=null;
  TG.forEach(function(g){g.types.forEach(function(t){if(t.id===L.type)activeGroup=g.label;});});
  // Collapsed state per group — default: active group open, others closed
  var _col=useState(function(){
    var s={};
    TG.forEach(function(g){s[g.label]=(g.label===activeGroup);});
    return s;
  });
  var collapsed=_col[0],setCollapsed=_col[1];

  function toggle(label){
    setCollapsed(function(prev){var n=Object.assign({},prev);n[label]=!n[label];return n;});
  }
  // Filter types by search
  var searchLow=typeSearch.toLowerCase().trim();
  var filteredTG=searchLow?TG.map(function(g){
    var types=g.types.filter(function(t){return t.label.toLowerCase().indexOf(searchLow)>=0||t.id.toLowerCase().indexOf(searchLow)>=0;});
    return types.length?Object.assign({},g,{types:types}):null;
  }).filter(Boolean):TG;
  function selectType(id){
    var defs=TD[id]||{},updates={type:id};
    Object.keys(defs).forEach(function(dk){updates[dk]=defs[dk];});
    Object.keys(updates).forEach(function(dk){setL(dk,updates[dk]);});
    // Auto-open the group that was clicked
    TG.forEach(function(g){
      g.types.forEach(function(t){
        if(t.id===id)setCollapsed(function(prev){var n=Object.assign({},prev);n[g.label]=true;return n;});
      });
    });
  }

  return React.createElement("div",{style:{marginBottom:10}},
    // Search bar
    React.createElement("div",{style:{position:"relative",marginBottom:6}},
      React.createElement("input",{type:"text",placeholder:"Search types…",value:typeSearch,
        onChange:function(e){setTypeSearch(e.target.value);},
        style:{width:"100%",background:"#111",border:"1px solid #252525",color:"#ccc",
          padding:"5px 24px 5px 8px",fontSize:9,fontFamily:"monospace",borderRadius:3,
          boxSizing:"border-box",outline:"none"},
        onKeyDown:function(e){
          if(e.key==="Escape"){setTypeSearch("");e.preventDefault();}
          if(e.key==="Enter"&&filteredTG.length>0&&filteredTG[0].types.length>0){
            selectType(filteredTG[0].types[0].id);setTypeSearch("");e.preventDefault();
          }
        }
      }),
      typeSearch?React.createElement("span",{onClick:function(){setTypeSearch("");},style:{
        position:"absolute",right:6,top:"50%",transform:"translateY(-50%)",
        cursor:"pointer",fontSize:11,color:"#555",lineHeight:1
      }},"×"):null
    ),
    filteredTG.length===0?React.createElement("div",{style:{padding:"12px 8px",fontSize:9,color:"#444",textAlign:"center",fontFamily:"monospace"}},'No types match "'+typeSearch+'"'):null,
    filteredTG.map(function(g){
      var isOpen=typeSearch?true:!!collapsed[g.label];
      var hasActive=g.types.some(function(t){return t.id===L.type;});
      return React.createElement("div",{key:g.label,style:{marginBottom:2}},
        // Category header — click to toggle
        React.createElement("div",{
          onClick:function(){toggle(g.label);},
          style:{
            display:"flex",justifyContent:"space-between",alignItems:"center",
            padding:"4px 5px",cursor:"pointer",borderRadius:2,
            background:hasActive?"rgba(232,144,10,0.07)":"transparent",
            userSelect:"none"
          }
        },
          React.createElement("span",{style:{
            fontSize:8,color:hasActive?"#e8900a":"#3a3a3a",
            letterSpacing:1.5,textTransform:"uppercase"
          }},
            hasActive?React.createElement("span",null,"● ",g.label):g.label
          ),
          React.createElement("span",{style:{fontSize:9,color:"#333",lineHeight:1}},isOpen?"▾":"▸")
        ),
        // Buttons — only shown when open
        isOpen?React.createElement("div",{style:{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:2,marginTop:3,marginBottom:3}},
          g.types.map(function(t){
            var isActive=L.type===t.id;
            return React.createElement("button",{key:t.id,onClick:function(){selectType(t.id);},style:{
              padding:"4px 2px 5px",fontSize:8,fontFamily:"monospace",textAlign:"center",
              lineHeight:1.15,
              background:isActive?"#e8900a":"#161616",
              color:isActive?"#000":"#888",
              border:"1px solid "+(isActive?"#e8900a":"#1e1e1e"),
              borderRadius:3,cursor:"pointer",
              display:"flex",flexDirection:"column",alignItems:"center",
              transition:"background 0.08s,color 0.08s"
            }},
              React.createElement(NoiseTypeThumb,{id:t.id,TD:TD,size:30}),
              React.createElement("span",{style:{whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:"100%",display:"block"}},t.label)
            );
          })
        ):null
      );
    })
  );
}

function NoisePanel(p){
  var L=p.L,si=p.si,layers=p.layers,setL=p.setL,setLSP=p.setLSP;
  var _chain=useState([]); var customChain=_chain[0],setCustomChain=_chain[1];
  var _chainOpen=useState(false); var chainOpen=_chainOpen[0],setChainOpen=_chainOpen[1];
  var _grpOpen=useState(false); var grpOpen=_grpOpen[0],setGrpOpen=_grpOpen[1];
  var onCommit=p.onCommit||function(){};
  var bumpEpoch=p._bumpEpoch||function(){};
  function SliderC(sp){
    var _ap=sp.animParam!==undefined?sp.animParam:undefined;
    if(_ap===undefined&&sp.id&&ANIM_PARAM_SET[sp.id])_ap=sp.id;
    if(_ap===undefined&&sp.label){
      var _match=ANIM_PARAMS.find(function(x){return x.label===sp.label||x.id===sp.label.toLowerCase().replace(/ /g,"");});
      if(_match)_ap=_match.id;
    }
    return React.createElement(Slider,Object.assign({},sp,{onCommit:onCommit,animParam:_ap,_bumpEpoch:bumpEpoch}));
  }
  var linked=L.scaleLinked!=null?L.scaleLinked:true;
  var shapeR2=["ring","rbox","ellipse","star4","star5","star6","moon"],shapeThick=["ring","cross","capsule"];
  var _hov=useState(-1);var hovIdx=_hov[0],setHovIdx=_hov[1];
  var _solo=useState(false);var soloMode=_solo[0],setSoloMode=_solo[1];

  // Solo preview strip: shows below layer tabs when soloMode is on
  var thumbSz=p.soloThumbSize||128;
  var soloPanel=soloMode?React.createElement("div",{style:{
    background:"#0d0d0d",border:"1px solid #1e1e1e",borderRadius:4,
    padding:8,marginBottom:8
  }},
    // Size controls
    React.createElement("div",{style:{display:"flex",gap:4,marginBottom:6,alignItems:"center"}},
      React.createElement("span",{style:{fontSize:8,color:"#555",letterSpacing:1,textTransform:"uppercase",flex:1}},"Preview Size"),
      [64,128,256].map(function(sz){return React.createElement("button",{key:sz,onClick:function(){p.setSoloThumbSize&&p.setSoloThumbSize(sz);},style:{padding:"2px 6px",fontSize:8,fontFamily:"monospace",background:thumbSz===sz?"#e8900a":"#1a1a1a",color:thumbSz===sz?"#000":"#666",border:"1px solid "+(thumbSz===sz?"#e8900a":"#282828"),borderRadius:2,cursor:"pointer"}},sz+"px");})
    ),
    React.createElement("div",{style:{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax("+(thumbSz+8)+"px,1fr))",gap:6}},
    layers.map(function(lay,i){
      return React.createElement("div",{key:i,
        onClick:function(){p.setActiveL(i);},
        style:{
          cursor:"pointer",
          borderRadius:3,
          border:"2px solid "+(si===i?LC8[i%8]:"#252525"),
          overflow:"hidden",
          position:"relative",
          opacity:lay.enabled?1:0.4
        }},
        React.createElement(SoloPreview,{layer:lay,size:thumbSz,allLayers:curLayers}),
        React.createElement("div",{style:{
          position:"absolute",bottom:0,left:0,right:0,
          background:"rgba(0,0,0,0.72)",
          fontSize:8,color:si===i?LC8[i%8]:"#888",
          textAlign:"center",padding:"2px 0",letterSpacing:0.5
        }},lay.label||("L"+(i+1)))
      );
    }))
  ):null;

  var layerTabs=React.createElement("div",null,
    // Layer thumbnail row with blend dependency arrows
    React.createElement("div",{style:{position:"relative",marginBottom:6}},
      React.createElement("div",{style:{display:"flex",gap:4,alignItems:"flex-start",flexWrap:"wrap"}},
        layers.map(function(lay,i){
          var col=LC8[i%8];
          var isSolo=p.soloIdx===i;
          var hasCustomBlend=lay.blendMode&&lay.blendMode!=="normal"&&i>0;
          // Blend icon — shown on top of thumb if blend != normal
          var blendIcon={
            add:"+",subtract:"−",multiply:"×",divide:"÷",screen:"S",
            overlay:"Ov",softlight:"s",hardlight:"H",lighten:"↑",darken:"↓",
            linearDodge:"+",difference:"△",exclusion:"⊕",dissolve:"·",
            max:"▲",min:"▼"
          }[lay.blendMode]||"?";
          return React.createElement("div",{key:i,
            onClick:function(){p.setActiveL(i);},
            onMouseEnter:function(){setHovIdx(i);},
            onMouseLeave:function(){setHovIdx(-1);},
            style:{
              display:"flex",flexDirection:"column",alignItems:"center",gap:3,
              cursor:"pointer",opacity:lay.enabled?1:0.5,
              padding:"3px 4px",borderRadius:3,
              background:si===i?"#1e1e1e":"transparent",
              border:"1px solid "+(si===i?col:"transparent"),
              position:"relative"
            }},
            // Blend indicator badge — shows what this layer does to what's below
            hasCustomBlend?React.createElement("div",{
              title:"Blend: "+lay.blendMode+" (affects layers below)",
              style:{
                position:"absolute",top:0,right:0,
                width:14,height:14,borderRadius:"50%",
                background:col,color:"#000",
                fontSize:9,fontWeight:700,fontFamily:"monospace",
                display:"flex",alignItems:"center",justifyContent:"center",
                zIndex:2,lineHeight:1
              }
            },blendIcon):null,
            React.createElement(LayerThumb,{layer:lay,allLayers:p.layers}),
            React.createElement(LayerLabel,{label:lay.label||("L"+(i+1)),color:col,onChange:function(newLabel){
              p.onRenameLayer(i,newLabel);
            }}),
            // Solo button — always visible, prominent
            React.createElement("button",{
              onClick:function(e){e.stopPropagation();p.setSoloIdx(isSolo?-1:i);},
              title:isSolo?"Exit solo":"Solo this layer (hide others)",
              style:{
                padding:"1px 6px",fontSize:7,fontFamily:"monospace",letterSpacing:0.5,
                background:isSolo?"#ffdd44":"transparent",
                color:isSolo?"#000":"#555",
                border:"1px solid "+(isSolo?"#ffdd44":"#2a2a2a"),
                borderRadius:2,cursor:"pointer",marginTop:1,
                fontWeight:isSolo?700:400
              }
            },isSolo?"● SOLO":"SOLO")
          );
        })
      )
    ),
    // ── Dependency graph — draws arrow from current layer to layer below ──
    // Only shown when current layer has non-normal blend mode
    L.blendMode&&L.blendMode!=="normal"&&si>0?React.createElement("div",{style:{
      fontSize:8,color:"#888",fontFamily:"monospace",
      padding:"5px 8px",marginBottom:5,
      background:"rgba(74,180,255,0.05)",border:"1px solid rgba(74,180,255,0.2)",
      borderRadius:3,lineHeight:1.4
    }},
      React.createElement("span",{style:{color:LC8[si%8],fontWeight:700}},(L.label||"L"+(si+1))),
      React.createElement("span",{style:{color:"#4ab4ff"}}," ─["+L.blendMode.toUpperCase()+"]→ "),
      "accumulated stack of ",
      React.createElement("span",{style:{color:"#888"}},si+" layer"+(si>1?"s":"")," below")
    ):null,
  // ─── Action bar: Copy button was removed accidentally — restore it ──
  // Plus: randomize all seeds shortcut
  React.createElement("div",{style:{display:"flex",gap:3,flexWrap:"wrap",borderTop:"1px solid #1c1c1c",paddingTop:6,marginBottom:6}},
    // Quick-add with blend preset
    React.createElement("div",{style:{display:"flex",gap:2,alignItems:"center",flexWrap:"wrap"}},
      React.createElement("span",{style:{fontSize:7,color:"#2a2a2a",letterSpacing:0.8,marginRight:2}},"Add:"),
      [
        {bm:"normal",l:"+",col:"#e8900a"},
        {bm:"add",l:"Add",col:"#44ddcc"},
        {bm:"subtract",l:"Sub",col:"#ff6699"},
        {bm:"multiply",l:"Mul",col:"#cc88ff"},
        {bm:"screen",l:"Scr",col:"#ffdd44"},
        {bm:"overlay",l:"Ovl",col:"#a0e060"}
      ].map(function(pr){
        return React.createElement("button",{key:pr.bm,
          onClick:function(){p.addLayerWithBlend(pr.bm);},
          disabled:layers.length>=8,
          title:"Add layer with "+pr.bm+" blend",
          style:{padding:"3px 7px",fontSize:8,fontFamily:"monospace",
            background:"transparent",color:pr.col,
            border:"1px solid "+pr.col+"55",
            borderRadius:2,cursor:layers.length>=8?"not-allowed":"pointer",
            opacity:layers.length>=8?0.3:1}
        },pr.l);
      })
    ),
    React.createElement("div",{style:{flex:1}}),
    layers.length>1?React.createElement("button",{onClick:p.removeLayer,title:"Remove active layer",style:{padding:"4px 7px",background:"#1a1a1a",border:"1px solid #282828",color:"#555",fontFamily:"monospace",fontSize:9,cursor:"pointer",borderRadius:3}},"✕"):null,
    layers.length<8?React.createElement("button",{onClick:p.duplicateLayer,title:"Duplicate (D)",style:{padding:"4px 7px",background:"#1a1a1a",border:"1px solid #282828",color:"#666",fontFamily:"monospace",fontSize:9,cursor:"pointer",borderRadius:3}},"⧉"):null,
    // Copy/Paste
    React.createElement("button",{onClick:p.copyLayer,title:"Copy layer (C)",style:{padding:"4px 7px",background:"#1a1a1a",border:"1px solid #282828",color:"#888",fontFamily:"monospace",fontSize:9,cursor:"pointer",borderRadius:3}},"Copy"),
    p.hasCopied?React.createElement("button",{onClick:p.pasteLayer,title:"Paste (V)",style:{padding:"4px 7px",background:"#1a1a1a",border:"1px solid #4ab4ff",color:"#4ab4ff",fontFamily:"monospace",fontSize:9,cursor:"pointer",borderRadius:3}},"Paste"):null,
    React.createElement("button",{onClick:function(){p.setL("seed",Math.random()*99999|0);},title:"Randomize seed (R)",style:{padding:"4px 7px",background:"#1a1a1a",border:"1px solid #282828",color:"#555",fontFamily:"monospace",fontSize:9,cursor:"pointer",borderRadius:3}},"⟳"),
          React.createElement("button",{onClick:p.randomizeAll,title:"Randomize ALL layer seeds (A)",style:{padding:"4px 7px",background:"#1a1a1a",border:"1px solid #282828",color:"#444",fontFamily:"monospace",fontSize:9,cursor:"pointer",borderRadius:3}},"All ⟳"),
    React.createElement("button",{onClick:p.resetLayer,title:"Reset to defaults (X)",style:{padding:"4px 7px",background:"#1a1a1a",border:"1px solid #282828",color:"#444",fontFamily:"monospace",fontSize:9,cursor:"pointer",borderRadius:3}},"↺")
  )
  );

  // ── Groups manager ──────────────────────────────────────────────
  var groupsUI=p.groupsEnabled?(function(){
    var groups=p.groups||[];
    var curGroupId=L.groupId!=null?L.groupId:null;
    if(!grpOpen)return null; // panel shown only when the Groups button is active
    return React.createElement("div",{style:{marginBottom:8,padding:8,background:"#0e0e0e",border:"1px solid #1c1c1c",borderRadius:4}},
      React.createElement("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:groups.length?6:0}},
        React.createElement("span",{style:{fontSize:8,color:"#888",textTransform:"uppercase",letterSpacing:1,fontFamily:"monospace"}},"Groups"),
        React.createElement("button",{onClick:p.addGroup,title:"Create a group and put this layer in it",
          style:{padding:"2px 8px",fontSize:8,fontFamily:"monospace",background:"#1a1a1a",color:"#a0e060",border:"1px solid #2a2a2a",borderRadius:3,cursor:"pointer"}},"+ Group")
      ),
      groups.map(function(g){
        return React.createElement("div",{key:g.id,style:{marginBottom:5,padding:6,background:"#131313",borderRadius:3,border:"1px solid "+(curGroupId===g.id?"#3a5a3a":"#1a1a1a")}},
          React.createElement("div",{style:{display:"flex",alignItems:"center",gap:6,marginBottom:4}},
            // enable toggle
            React.createElement("div",{onClick:function(){p.updGroup(g.id,"enabled",g.enabled===false);p.onCommit&&p.onCommit();},
              title:"Show/hide all layers in this group",
              style:{width:24,height:14,borderRadius:7,background:g.enabled===false?"#252525":"#a0e060",cursor:"pointer",position:"relative",flexShrink:0}},
              React.createElement("div",{style:{position:"absolute",width:10,height:10,borderRadius:5,background:"#fff",top:2,left:g.enabled===false?2:12,transition:"left 0.12s"}})),
            React.createElement("input",{type:"text",value:g.name,
              onChange:function(e){p.updGroup(g.id,"name",e.target.value);},
              style:{flex:1,minWidth:0,background:"#0a0a0a",border:"1px solid #222",color:"#bbb",fontSize:9,fontFamily:"monospace",padding:"2px 5px",borderRadius:2}}),
            React.createElement("button",{onClick:function(){p.removeGroup(g.id);},title:"Delete group (layers kept, ungrouped)",
              style:{padding:"1px 5px",fontSize:9,background:"none",border:"1px solid #2a2a2a",color:"#a55",borderRadius:2,cursor:"pointer"}},"✕")
          ),
          React.createElement("div",{style:{display:"flex",alignItems:"center",gap:6}},
            React.createElement("span",{style:{fontSize:7,color:"#555",fontFamily:"monospace",width:34}},"Opacity"),
            React.createElement("input",{type:"range",min:0,max:1,step:0.01,value:g.opacity!=null?g.opacity:1,
              onChange:function(e){p.updGroup(g.id,"opacity",parseFloat(e.target.value));},
              style:{flex:1,accentColor:"#a0e060"}}),
            // assign current layer toggle
            React.createElement("button",{onClick:function(){p.setLayerGroup(si,curGroupId===g.id?null:g.id);p.onCommit&&p.onCommit();},
              title:curGroupId===g.id?"Remove this layer from the group":"Add this layer to the group",
              style:{padding:"2px 6px",fontSize:8,fontFamily:"monospace",background:curGroupId===g.id?"#a0e060":"#1a1a1a",color:curGroupId===g.id?"#000":"#777",border:"1px solid "+(curGroupId===g.id?"#a0e060":"#2a2a2a"),borderRadius:2,cursor:"pointer",whiteSpace:"nowrap"}},
              curGroupId===g.id?"✓ in":"+ add")
          ),
          // Members: show which layers are in this group
          (function(){
            var members=[]; (p.layers||[]).forEach(function(ly,idx){if(ly.groupId===g.id)members.push(ly.label||("L"+(idx+1)));});
            return React.createElement("div",{style:{marginTop:5,display:"flex",flexWrap:"wrap",gap:3,alignItems:"center"}},
              React.createElement("span",{style:{fontSize:7,color:"#444",fontFamily:"monospace"}},members.length+" layer"+(members.length===1?"":"s")+":"),
              members.length?members.map(function(nm,k){
                return React.createElement("span",{key:k,style:{fontSize:7,fontFamily:"monospace",color:"#8a8",background:"#16201a",padding:"1px 5px",borderRadius:2}},nm);
              }):React.createElement("span",{style:{fontSize:7,color:"#555",fontStyle:"italic"}},"empty")
            );
          })(),
          // Group-level adjustments (applied to all layers in the group)
          React.createElement("div",{style:{marginTop:6,display:"flex",gap:6,alignItems:"center"}},
            React.createElement("span",{style:{fontSize:7,color:"#555",fontFamily:"monospace",width:34}},"Bright"),
            React.createElement("input",{type:"range",min:-1,max:1,step:0.02,value:g.brightness||0,
              onChange:function(e){p.updGroup(g.id,"brightness",parseFloat(e.target.value));},
              style:{flex:1,accentColor:"#66ccff"}}),
            React.createElement("span",{style:{fontSize:7,color:"#555",fontFamily:"monospace",width:34}},"Contr"),
            React.createElement("input",{type:"range",min:0,max:3,step:0.02,value:g.contrast!=null?g.contrast:1,
              onChange:function(e){p.updGroup(g.id,"contrast",parseFloat(e.target.value));},
              style:{flex:1,accentColor:"#66ccff"}})
          )
        );
      })
    );
  })():null;

  return React.createElement("div",null,
    React.createElement("div",{style:{marginBottom:10}},
      p.nodeMode?null:React.createElement("span",{style:LS},"Layers"),
      p.nodeMode?null:layerTabs,
      // Compact tool buttons: Groups + Chain (hidden in node mode)
      p.nodeMode?null:React.createElement("div",{style:{display:"flex",gap:5,marginBottom:8}},
        (p.groupsEnabled)?React.createElement("button",{onClick:function(){setGrpOpen(function(v){return!v;});},
          style:{flex:1,padding:"5px 0",fontSize:8,fontFamily:"monospace",letterSpacing:0.5,cursor:"pointer",borderRadius:3,
            background:grpOpen?"#1d2a1a":"#141414",color:grpOpen?"#a0e060":"#777",
            border:"1px solid "+(grpOpen?"#3a5a2a":"#252525")}},
          "\u229e Groups"+((p.groups&&p.groups.length)?" ("+p.groups.length+")":"")):null,
        (p.runChainOp)?React.createElement("button",{onClick:function(){setChainOpen(function(v){return!v;});},
          style:{flex:1,padding:"5px 0",fontSize:8,fontFamily:"monospace",letterSpacing:0.5,cursor:"pointer",borderRadius:3,
            background:chainOpen?"#1a1525":"#141414",color:chainOpen?"#cc88ff":"#777",
            border:"1px solid "+(chainOpen?"#3a2a55":"#252525")}},
          "\u26a1 Chain"+((customChain&&customChain.length)?" ("+customChain.length+")":"")):null
      ),
      groupsUI,
      // ── Chained Operations (shown only when the Chain button is active) ──
      (p.runChainOp&&chainOpen)?React.createElement("div",{style:{marginBottom:8,padding:8,background:"#0e0e0e",border:"1px solid #1c1c1c",borderRadius:4}},
        React.createElement("div",{style:{fontSize:8,color:"#cc88ff",textTransform:"uppercase",letterSpacing:1,fontFamily:"monospace",marginBottom:8}},"\u26a1 Chained Ops"),
        React.createElement("div",null,
          React.createElement("div",{style:{fontSize:7,color:"#555",marginBottom:6,lineHeight:1.5}},"Tap operations to build a chain, then run it on the active layer:"),
          CHAIN_OP_GROUPS.map(function(grp){
            return React.createElement("div",{key:grp.label,style:{marginBottom:7}},
              React.createElement("div",{style:{fontSize:7,color:"#444",marginBottom:3,letterSpacing:0.5,fontFamily:"monospace"}},grp.label),
              React.createElement("div",{style:{display:"flex",flexWrap:"wrap",gap:3}},
                grp.ops.map(function(opId){
                  return React.createElement("button",{key:opId,
                    onClick:function(){setCustomChain(function(c){return c.concat([opId]);});},
                    title:CHAIN_OPS[opId].hint,
                    style:{padding:"3px 6px",fontSize:8,fontFamily:"monospace",background:"#161616",color:"#888",border:"1px solid #282828",borderRadius:3,cursor:"pointer"},
                    onMouseEnter:function(e){e.currentTarget.style.borderColor="#cc88ff";e.currentTarget.style.color="#ddd";},
                    onMouseLeave:function(e){e.currentTarget.style.borderColor="#282828";e.currentTarget.style.color="#888";}},
                    "+ "+CHAIN_OPS[opId].label);
                })
              )
            );
          }),
          // Current chain preview
          customChain.length?React.createElement("div",{style:{display:"flex",flexWrap:"wrap",gap:3,alignItems:"center",marginBottom:8,padding:6,background:"#131313",borderRadius:3}},
            customChain.map(function(opId,i){
              return React.createElement("span",{key:i,style:{fontSize:8,fontFamily:"monospace",color:"#cc88ff",background:"#1d1526",padding:"2px 6px",borderRadius:3,whiteSpace:"nowrap"}},
                (i>0?"→ ":"")+CHAIN_OPS[opId].label);
            })
          ):React.createElement("div",{style:{fontSize:8,color:"#444",marginBottom:8,fontStyle:"italic"}},"Tap operations above to build a chain…"),
          React.createElement("div",{style:{display:"flex",gap:4}},
            React.createElement("button",{
              onClick:function(){if(customChain.length)p.runChainOp(customChain);},
              disabled:!customChain.length,
              style:{flex:1,padding:"7px 0",fontSize:10,fontWeight:700,fontFamily:"monospace",
                background:customChain.length?"#cc88ff":"#1a1a1a",color:customChain.length?"#000":"#444",
                border:"none",borderRadius:4,cursor:customChain.length?"pointer":"default",letterSpacing:1}},
              "⚡ Run Chain ("+customChain.length+")"),
            React.createElement("button",{
              onClick:function(){setCustomChain(function(c){return c.slice(0,-1);});},
              disabled:!customChain.length,
              title:"Remove last step",
              style:{padding:"7px 11px",fontSize:11,fontFamily:"monospace",background:"#1a1a1a",color:customChain.length?"#888":"#444",border:"1px solid #2a2a2a",borderRadius:4,cursor:customChain.length?"pointer":"default"}},
              "⌫"),
            React.createElement("button",{
              onClick:function(){setCustomChain([]);},
              style:{padding:"7px 12px",fontSize:9,fontFamily:"monospace",background:"#1a1a1a",color:"#888",border:"1px solid #2a2a2a",borderRadius:4,cursor:"pointer"}},
              "Clear")
          )
        )
      ):null,
      // Divider between layer tools (groups/chain) and this layer's settings
      React.createElement("div",{style:{height:1,background:"#161616",margin:"4px 0 10px"}}),
      soloPanel,
      // ── Layer Reference ──────────────────────────────────────────
      p.nodeMode?null:(function(){
        var allL=p.layers||[];
        // Candidate sources: any OTHER layer that is itself NOT a reference
        // (so we don't build chains/cycles through the UI).
        var candidates=allL.map(function(ly,idx){return {ly:ly,idx:idx};})
          .filter(function(o){return o.idx!==si&&o.ly.refUid==null&&o.ly.uid!=null;});
        var isRef=L.refUid!=null;
        var srcLabel="";
        if(isRef){var s=allL.find(function(ly){return ly.uid===L.refUid;});srcLabel=s?(s.label||"a layer"):"(missing)";}
        if(!isRef&&!candidates.length)return null; // nothing to reference yet
        return React.createElement("div",{style:{marginBottom:8,padding:"6px 8px",background:isRef?"#15101d":"#0e0e0e",border:"1px solid "+(isRef?"#3a2a55":"#1c1c1c"),borderRadius:4}},
          React.createElement("div",{style:{display:"flex",alignItems:"center",justifyContent:"space-between",gap:6}},
            React.createElement("span",{style:{fontSize:8,color:isRef?"#cc88ff":"#666",textTransform:"uppercase",letterSpacing:1,fontFamily:"monospace"}},
              isRef?("\u26ad Mirrors: "+srcLabel):"\u26ad Reference"),
            isRef?React.createElement("button",{onClick:function(){setL("refUid",null);if(onCommit)onCommit();},
              style:{padding:"2px 8px",fontSize:8,fontFamily:"monospace",background:"#1a1a1a",color:"#c88",border:"1px solid #3a2a2a",borderRadius:3,cursor:"pointer"}},"Detach")
            :React.createElement("select",{value:"",
              onChange:function(e){if(e.target.value){setL("refUid",e.target.value);if(onCommit)onCommit();}},
              style:{background:"#161616",color:"#aaa",border:"1px solid #2a2a2a",borderRadius:3,fontSize:8,fontFamily:"monospace",padding:"2px 4px",cursor:"pointer"}},
              React.createElement("option",{value:""},"Mirror a layer\u2026"),
              candidates.map(function(o){return React.createElement("option",{key:o.ly.uid,value:o.ly.uid},o.ly.label||("L"+(o.idx+1)));})
            )
          ),
          isRef?React.createElement("div",{style:{marginTop:6}},
            React.createElement("div",{style:{fontSize:7,color:"#777",marginBottom:5,lineHeight:1.4}},
              "Copies from "+srcLabel+", live. Toggle off a group to keep it local and edit it here:"),
            React.createElement("div",{style:{display:"flex",flexWrap:"wrap",gap:4}},
              [["refLocalXform","Transform"],["refLocalBlend","Blend/Opacity"],["refLocalAdjust","Adjust"]].map(function(t){
                var local=!!L[t[0]];
                return React.createElement("button",{key:t[0],
                  onClick:function(){setL(t[0],!local);if(onCommit)onCommit();},
                  title:local?"Local — edit this group on the reference":"Inherited from source — click to keep local",
                  style:{padding:"3px 7px",fontSize:7,fontFamily:"monospace",cursor:"pointer",borderRadius:3,letterSpacing:0.3,
                    background:local?"#1d2a1a":"#161616",color:local?"#a0e060":"#666",
                    border:"1px solid "+(local?"#3a5a2a":"#282828")}},
                  (local?"\u25c9 ":"\u25cb ")+t[1]);
              })
            )
          ):null
        );
      })(),
      // Reference with NO local groups → everything inherited, hide params.
      // Reference WITH local groups → show only those groups\' controls (handled
      // by per-section gating: _refHide(group) returns true when inherited).
      (L.refUid!=null&&!L.refLocalXform&&!L.refLocalBlend&&!L.refLocalAdjust)?
        React.createElement("div",{style:{fontSize:8,color:"#555",fontStyle:"italic",padding:"8px 4px",textAlign:"center"}},
        "All parameters inherited from the source. Toggle a group above to edit it here."):
      React.createElement("div",null,
      // Enabled + Opacity on one compact row
      React.createElement("div",{style:{display:"flex",alignItems:"center",gap:8,marginBottom:6}},
        // Enabled pill toggle (compact)
        React.createElement("div",{
          onClick:function(){setL("enabled",!L.enabled);},
          title:L.enabled?"Enabled (click to disable)":"Disabled (click to enable)",
          style:{width:30,height:16,borderRadius:8,background:L.enabled?LC8[si%8]:"#252525",cursor:"pointer",position:"relative",flexShrink:0,transition:"background 0.15s"}
        },React.createElement("div",{style:{position:"absolute",width:12,height:12,borderRadius:6,background:"#fff",top:2,left:L.enabled?16:2,transition:"left 0.15s"}})),
        // Opacity slider — takes rest of row
        React.createElement("div",{style:{flex:1}},
          React.createElement("input",{type:"range",min:0,max:1,step:0.01,value:L.opacity!=null?L.opacity:1,
            onChange:function(e){setL("opacity",parseFloat(e.target.value));},
            style:{width:"100%",accentColor:LC8[si%8],height:3,cursor:"pointer",display:"block"}})
        ),
        React.createElement("span",{style:{fontSize:10,color:LC8[si%8],fontFamily:"monospace",minWidth:28,textAlign:"right",flexShrink:0}},
          Math.round((L.opacity!=null?L.opacity:1)*100)+"%"
        )
      ),
      // Blend mode + Channel — now as expandable pill group
      React.createElement("div",{style:{marginBottom:8}},
        React.createElement("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}},
          React.createElement("span",{style:{fontSize:9,color:"#555",letterSpacing:1.2,textTransform:"uppercase"}},
            "Blend: ",
            React.createElement("span",{style:{color:LC8[si%8],fontWeight:700}},(L.blendMode||"normal").toUpperCase())
          ),
          // Channel pills
          React.createElement("div",{style:{display:"flex",gap:2}},
            CH.map(function(c){return React.createElement("button",{key:c,onClick:function(){setL("channels",c);},title:"Channels: "+CHL[c],style:{
              padding:"3px 6px",fontSize:8,fontFamily:"monospace",
              background:L.channels===c?LC8[si%8]:"#161616",
              color:L.channels===c?"#000":"#444",
              border:"1px solid "+(L.channels===c?LC8[si%8]:"#1e1e1e"),
              borderRadius:2,cursor:"pointer"
            }},CHL[c]);})
          )
        ),
        // Live blend-mode preview: each mode shows a low-res thumbnail of the
        // actual result (layers-below composited with this layer). The picker
        // renders the base stack + this layer ONCE, then just composites each
        // mode — cheap. Debounced and skipped during slider drags.
        React.createElement(BlendModePicker,{
          value:L.blendMode||"normal",
          onChange:function(mv){setL("blendMode",mv);},
          layers:p.layers,si:si,col:LC8[si%8],canvasEpoch:p.canvasEpoch
        })
      )
    ),
    React.createElement(Sep,null),
    // Type selector — collapsible categories
    React.createElement(CollapsibleTypeSelector,{L:L,setL:setL,TG:TG,TYPE_DEFAULTS:TYPE_DEFAULTS}),
    React.createElement(Sep,null),

    // Image upload
    L.type==="image"?React.createElement("div",{style:{marginBottom:10}},
      React.createElement("span",{style:LS},"Source Image"),
      L.imageData?React.createElement("img",{src:L.imageData,style:{width:"100%",height:60,objectFit:"cover",borderRadius:3,marginBottom:6,border:"1px solid #252525"}}):null,
      React.createElement("input",{type:"file",accept:"image/*",onChange:function(e){
        var file=e.target.files[0];if(!file)return;
        var reader=new FileReader();
        reader.onload=function(ev){
          var data=ev.target.result;
          preDecodeImage(data,function(){setL("imageData",data);});
        };
        reader.readAsDataURL(file);
      },style:{fontSize:10,color:"#888",fontFamily:"monospace",width:"100%",marginBottom:8}}),
      // Color mode toggle
      React.createElement("div",{style:{display:"flex",gap:6,marginBottom:6}},
        React.createElement("div",{style:{flex:1}},
          React.createElement("span",{style:{fontSize:8,color:"#555",textTransform:"uppercase",letterSpacing:1,display:"block",marginBottom:4}},"Color Mode"),
          React.createElement("div",{style:{display:"flex",gap:3}},
            React.createElement("button",{onClick:function(){setL("imageColorMode","luma");},
              style:{flex:1,padding:"4px 0",fontSize:9,fontFamily:"monospace",
                background:(L.imageColorMode||"luma")==="luma"?"#e8900a":"#1a1a1a",
                color:(L.imageColorMode||"luma")==="luma"?"#000":"#666",
                border:"1px solid "+((L.imageColorMode||"luma")==="luma"?"#e8900a":"#282828"),
                borderRadius:2,cursor:"pointer"}},"Luma"),
            React.createElement("button",{onClick:function(){setL("imageColorMode","rgb");},
              style:{flex:1,padding:"4px 0",fontSize:9,fontFamily:"monospace",
                background:L.imageColorMode==="rgb"?"#e8900a":"#1a1a1a",
                color:L.imageColorMode==="rgb"?"#000":"#666",
                border:"1px solid "+(L.imageColorMode==="rgb"?"#e8900a":"#282828"),
                borderRadius:2,cursor:"pointer"}},"RGB")
          )
        ),
        React.createElement("div",{style:{flex:1}},
          React.createElement("span",{style:{fontSize:8,color:"#555",textTransform:"uppercase",letterSpacing:1,display:"block",marginBottom:4}},"Sampling"),
          React.createElement("div",{style:{display:"flex",gap:3}},
            React.createElement("button",{onClick:function(){setL("imageBilinear",true);},
              style:{flex:1,padding:"4px 0",fontSize:9,fontFamily:"monospace",
                background:L.imageBilinear!==false?"#e8900a":"#1a1a1a",
                color:L.imageBilinear!==false?"#000":"#666",
                border:"1px solid "+(L.imageBilinear!==false?"#e8900a":"#282828"),
                borderRadius:2,cursor:"pointer"}},"Bilin."),
            React.createElement("button",{onClick:function(){setL("imageBilinear",false);},
              style:{flex:1,padding:"4px 0",fontSize:9,fontFamily:"monospace",
                background:L.imageBilinear===false?"#e8900a":"#1a1a1a",
                color:L.imageBilinear===false?"#000":"#666",
                border:"1px solid "+(L.imageBilinear===false?"#e8900a":"#282828"),
                borderRadius:2,cursor:"pointer"}},"Nearest")
          )
        )
      ),
      L.imageColorMode==="rgb"?React.createElement("div",{style:{fontSize:8,color:"#555",lineHeight:1.5,padding:"4px 6px",background:"#141414",borderRadius:3}},
        "RGB mode: samples image colors directly. Color ramp ignored. Adjust/Hue/Sat still apply."
      ):null
    ):null,

    // UV Transform — collapsible
    React.createElement(Collapse,{id:"noise_uv",title:"UV Transform",defaultOpen:true},
      React.createElement("div",{style:{display:"flex",gap:8,marginBottom:4}},
        React.createElement("div",{style:{flex:1}},SliderC({label:"Offset X",value:L.offsetX||0,min:-2,max:2,step:0.005,onChange:function(v){setL("offsetX",v);}})),
        React.createElement("div",{style:{flex:1}},SliderC({label:"Offset Y",value:L.offsetY||0,min:-2,max:2,step:0.005,onChange:function(v){setL("offsetY",v);}}))
      ),
      React.createElement("div",{style:{display:"flex",gap:6,marginBottom:6}},
        React.createElement(TBtn,{active:linked, onClick:function(){setL("scaleLinked",true); },small:true},"⊞ Uniform"),
        React.createElement(TBtn,{active:!linked,onClick:function(){setL("scaleLinked",false);},small:true},"⊟ XY")
      ),
      linked
        ? SliderC({label:"Scale",value:L.scaleX||3.5,min:0.05,max:32,step:0.05,onChange:function(v){setL("scaleX",v);setL("scaleY",v);}})
        : React.createElement("div",{style:{display:"flex",gap:8}},
            React.createElement("div",{style:{flex:1}},SliderC({label:"Scale X",value:L.scaleX||3.5,min:0.05,max:32,step:0.05,onChange:function(v){setL("scaleX",v);}})),
            React.createElement("div",{style:{flex:1}},SliderC({label:"Scale Y",value:L.scaleY||3.5,min:0.05,max:32,step:0.05,onChange:function(v){setL("scaleY",v);}}))
          ),
      SliderC({label:"Rotation",value:L.rotation||0,min:-180,max:180,step:1,onChange:function(v){setL("rotation",v);},fmt:function(v){return Math.round(v)+"°";},presets:[{v:0,l:"0°"},{v:45,l:"45°"},{v:90,l:"90°"},{v:135,l:"135°"},{v:180,l:"180°"}]}),
      React.createElement("div",{style:{display:"flex",gap:8}},
        React.createElement("div",{style:{flex:1}},SliderC({label:"Skew X",value:L.skewX||0,min:-2,max:2,step:0.02,fmt:function(v){return v.toFixed(2);},onChange:function(v){setL("skewX",v);}})),
        React.createElement("div",{style:{flex:1}},SliderC({label:"Skew Y",value:L.skewY||0,min:-2,max:2,step:0.02,fmt:function(v){return v.toFixed(2);},onChange:function(v){setL("skewY",v);}}))
      ),
      SliderC({label:"Seed",value:L.seed||42,min:1,max:99999,step:1,onChange:function(v){
        var rounded=Math.round(v);
        var hkey=(L.label||"L")+"_"+si;
        recordSeed(hkey,rounded);
        setL("seed",rounded);
      },fmt:Math.round}),
      React.createElement(SeedHistory,{
        histKey:(L.label||"L")+"_"+si,
        current:L.seed||42,
        onChange:function(s){setL("seed",s);}
      }),
      React.createElement(Tog,{label:"Seamless tiling",value:!!L.seamless,onChange:function(v){setL("seamless",v);if(v&&p.onSeamlessOn)p.onSeamlessOn();onCommit();}}),
      // Seamless mode — only shown when seamless is on
      L.seamless?React.createElement("div",{style:{marginBottom:8}},
        React.createElement("div",{style:{fontSize:8,color:"#444",marginBottom:5,lineHeight:1.5}},
          React.createElement("span",{style:{color:"#a0e060",fontWeight:700}},"Mirror"),": perfect seams, any scale. ",
          React.createElement("span",{style:{color:"#e8900a",fontWeight:700}},"Math"),": integer scale, zero blur. ",
          React.createElement("span",{style:{color:"#4ab4ff",fontWeight:700}},"Blend"),": any noise, slight blur."
        ),
        React.createElement("div",{style:{display:"flex",gap:3}},
          [{v:"mirror",l:"Mirror",c:"#a0e060"},{v:"math",l:"Math",c:"#e8900a"},{v:"blend",l:"Blend",c:"#4ab4ff"}].map(function(opt){
            var active=(L.seamlessMode||"math")===opt.v;
            return React.createElement("button",{key:opt.v,
              onClick:function(){setL("seamlessMode",opt.v);onCommit();},
              style:{flex:1,padding:"5px 0",fontSize:9,fontFamily:"monospace",
                background:active?opt.c:"#161616",
                color:active?"#000":"#555",
                border:"1px solid "+(active?opt.c:"#252525"),
                borderRadius:3,cursor:"pointer",fontWeight:active?700:400}},opt.l);
          })
        ),
        // Auto-fallback transparency: same helper the renderer uses, so this
        // note always matches what actually happens.
        (function(){
          if((L.seamlessMode||"math")!=="math")return null;
          var blocker=mathTileBlocker(L);
          if(!blocker)return null;
          return React.createElement("div",{style:{
            marginTop:6,padding:"6px 8px",background:"#1a1408",border:"1px solid #3d2e0a",
            borderRadius:3,fontSize:8,color:"#c9952c",lineHeight:1.5}},
            "Math tiling isn't possible with "+blocker+" — edges are auto-blended instead (still seamless). Use Mirror mode or remove the blocker for exact lattice tiling.");
        })()
      ):null
    ),

    // Flip / Mirror — collapsible
    React.createElement(Collapse,{id:"noise_flip",title:"Flip / Mirror",
      defaultOpen:!!(L.flipH||L.flipV||L.mirrorH||L.mirrorV),
      badge:(L.flipH||L.flipV||L.mirrorH||L.mirrorV)?"active":null},
      React.createElement("div",{style:{display:"flex",gap:4,flexWrap:"wrap"}},
        [{k:"flipH",l:"Flip H"},{k:"flipV",l:"Flip V"},{k:"mirrorH",l:"Mirror H"},{k:"mirrorV",l:"Mirror V"}].map(function(btn){
          var active=!!L[btn.k];
          return React.createElement("button",{key:btn.k,onClick:function(){setL(btn.k,!active);onCommit();},style:{
            flex:1,padding:"5px 4px",fontSize:9,fontFamily:"monospace",
            background:active?"#e8900a":"#161616",color:active?"#000":"#555",
            border:"1px solid "+(active?"#e8900a":"#252525"),borderRadius:3,cursor:"pointer"
          }},btn.l);
        })
      )
    ),

    // Radial Tiling — collapsible
    React.createElement(Collapse,{id:"noise_radial",title:"Radial Tiling",
      defaultOpen:!!L.radialTile,
      badge:L.radialTile?"active":null},
      React.createElement(Tog,{label:"Enable",value:!!L.radialTile,onChange:function(v){setL("radialTile",v);onCommit();}}),
      L.radialTile?React.createElement("div",null,
        React.createElement("div",{style:{fontSize:8,color:"#444",marginBottom:8,lineHeight:1.5}},"Repeats the layer N times around a center point. Mirror per sector for kaleidoscope look."),
        SliderC({label:"Count",value:L.radialCount||6,min:2,max:24,step:1,fmt:Math.round,onChange:function(v){setL("radialCount",Math.round(v));}}),
        SliderC({label:"Ring Radius",value:L.radialRadius!=null?L.radialRadius:0.25,min:0,max:0.5,step:0.005,
          fmt:function(v){return v===0?"0 (center)":v.toFixed(3);},
          onChange:function(v){setL("radialRadius",v);}}),
        SliderC({label:"Angle Offset",value:L.radialAngleOffset||0,min:-180,max:180,step:1,fmt:function(v){return Math.round(v)+"°";},onChange:function(v){setL("radialAngleOffset",v);}}),
        React.createElement("div",{style:{display:"flex",gap:8}},
          React.createElement("div",{style:{flex:1}},SliderC({label:"Center X",value:L.radialOffsetX||0,min:-0.5,max:0.5,step:0.005,onChange:function(v){setL("radialOffsetX",v);}})),
          React.createElement("div",{style:{flex:1}},SliderC({label:"Center Y",value:L.radialOffsetY||0,min:-0.5,max:0.5,step:0.005,onChange:function(v){setL("radialOffsetY",v);}}))
        )
      ):null
    ),

    // Type-specific params — wrapped in a collapsible section
    // key=L.type forces React to remount when type changes → always opens fresh
    React.createElement(Collapse,{key:"tp_"+L.type,id:"noise_type_"+L.type,title:"Type Parameters",defaultOpen:true,color:"#4ab4ff"},
    (L.type==="fbm"||L.type==="domainWarp")?React.createElement("div",null,
      React.createElement(Sel,{label:"Base Fn",value:L.fbmBase||"perlin",opts:[{v:"perlin",l:"Perlin"},{v:"value",l:"Value"},{v:"simplex",l:"Simplex"}],onChange:function(v){setL("fbmBase",v);}}),
      L.type==="fbm"?React.createElement(Sel,{label:"Mode",value:L.fbmMode||"normal",opts:[{v:"normal",l:"Normal"},{v:"ridged",l:"Ridged"},{v:"turbulence",l:"Turbulence"},{v:"billow",l:"Billow"}],onChange:function(v){setL("fbmMode",v);}}):null,
      SliderC({label:"Octaves",   value:L.octaves||5,   min:1,max:12, step:1,   onChange:function(v){setL("octaves",v);},   fmt:Math.round}),
      SliderC({label:"Lacunarity",value:L.lacunarity||2,min:1,max:6,  step:0.05,onChange:function(v){setL("lacunarity",v);}}),
      SliderC({label:"Gain",      value:L.gain||0.5,    min:0.05,max:0.95,step:0.01,onChange:function(v){setL("gain",v);}}),
      L.type==="domainWarp"?React.createElement("div",null,
        React.createElement(Sel,{label:"Warp Base",value:L.warpBase||"perlin",opts:[{v:"perlin",l:"Perlin"},{v:"value",l:"Value"},{v:"simplex",l:"Simplex"}],onChange:function(v){setL("warpBase",v);}}),
        React.createElement(Sel,{label:"Warp Mode",value:L.warpMode||"normal",opts:[{v:"normal",l:"Normal"},{v:"ridged",l:"Ridged"},{v:"swirl",l:"Swirl"}],onChange:function(v){setL("warpMode",v);}}),
        SliderC({label:"Warp Str",value:L.warpStr!=null?L.warpStr:1.5,min:-8,max:8,step:0.05,onChange:function(v){setL("warpStr",v);}}),
        React.createElement(Sel,{label:"Warp Levels",value:String(L.warpLevels||1),opts:[{v:"1",l:"1 (single)"},{v:"2",l:"2 (warp of warp)"}],onChange:function(v){setL("warpLevels",parseInt(v));}}),
        (L.warpLevels||1)>=2?SliderC({label:"2nd Warp",value:L.warp2!=null?L.warp2:0.8,min:0,max:3,step:0.05,onChange:function(v){setL("warp2",v);}}):null
      ):null
    ):null,

    L.type==="worley"?React.createElement("div",null,
      React.createElement(Sel,{label:"Mode",value:L.worleyMode||"f1",opts:[
        {v:"f1",l:"F1 Cells"},{v:"f2",l:"F2 Outer"},{v:"f3",l:"F3 Layered"},
        {v:"f2-f1",l:"F2-F1 Cracks"},{v:"f3-f1",l:"F3-F1 Wide Cracks"},
        {v:"f1+f2",l:"F1+F2"},{v:"f1*f2",l:"F1×F2"},
        {v:"smooth",l:"Smooth Blobs"},{v:"smoothCracks",l:"Soft Cracks"},
        {v:"edges",l:"Edges (uniform)"},{v:"edgesInv",l:"Edges Inverted"},{v:"cellWalls",l:"Cell Walls"},
        {v:"cell",l:"Cell Value (flat)"},
        {v:"cellEdges",l:"Cell + Edges"},{v:"cellShaded",l:"Cell Shaded"},{v:"cellRound",l:"Cell Rounded"}
      ],onChange:function(v){setL("worleyMode",v);}}),
      React.createElement(Sel,{label:"Distance",value:L.worleyMetric||"euclidean",opts:[{v:"euclidean",l:"Euclidean"},{v:"manhattan",l:"Manhattan"},{v:"chebyshev",l:"Chebyshev"},{v:"mink3",l:"Minkowski³"}],onChange:function(v){setL("worleyMetric",v);}}),
      SliderC({label:"Jitter",value:L.worleyJitter!=null?L.worleyJitter:1,min:0,max:1,step:0.01,fmt:function(v){return v<0.02?"grid":Math.round(v*100)+"%";},onChange:function(v){setL("worleyJitter",v);}}),
      SliderC({label:"Smooth",value:L.worleySmooth||0,min:0,max:1,step:0.01,fmt:function(v){return v<0.01?"off":Math.round(v*100)+"%";},onChange:function(v){setL("worleySmooth",v);}}),
      SliderC({label:"Warp",value:L.worleyWarp||0,min:0,max:1.5,step:0.01,fmt:function(v){return v<0.01?"off":v.toFixed(2);},onChange:function(v){setL("worleyWarp",v);}}),
      SliderC({label:"Contrast",value:L.worleyContrast!=null?L.worleyContrast:1,min:0.2,max:4,step:0.05,onChange:function(v){setL("worleyContrast",v);}})
    ):null,

    L.type==="voronoi"?React.createElement("div",null,
      React.createElement(Sel,{label:"Cell Value",value:L.voronoiVarMode||"flat",opts:[
        {v:"flat",l:"Flat (one tone/cell)"},{v:"dist",l:"Edge Falloff"},
        {v:"radial",l:"Radial (pebbles)"},{v:"smooth",l:"Smooth Shaded"},
        {v:"crystal",l:"Crystal (faceted)"},{v:"borders",l:"Cell Borders"},{v:"bevel",l:"Beveled Cells"}
      ],onChange:function(v){setL("voronoiVarMode",v);}}),
      React.createElement(Sel,{label:"Distance",value:L.worleyMetric||"euclidean",opts:[{v:"euclidean",l:"Euclidean"},{v:"manhattan",l:"Manhattan"},{v:"chebyshev",l:"Chebyshev"},{v:"mink3",l:"Minkowski³"}],onChange:function(v){setL("worleyMetric",v);}}),
      SliderC({label:"Jitter",value:L.worleyJitter!=null?L.worleyJitter:1,min:0,max:1,step:0.01,fmt:function(v){return v<0.02?"grid":Math.round(v*100)+"%";},onChange:function(v){setL("worleyJitter",v);}}),
      SliderC({label:"Warp",value:L.worleyWarp||0,min:0,max:1.5,step:0.01,fmt:function(v){return v<0.01?"off":v.toFixed(2);},onChange:function(v){setL("worleyWarp",v);}}),
      SliderC({label:"Contrast",value:L.worleyContrast!=null?L.worleyContrast:1,min:0.2,max:4,step:0.05,onChange:function(v){setL("worleyContrast",v);}})
    ):null,

    L.type==="dust"?React.createElement("div",null,
      SliderC({label:"Coverage",value:L.dustCoverage!=null?L.dustCoverage:0.5,min:0,max:1,step:0.01,fmt:function(v){return Math.round(v*100)+"%";},onChange:function(v){setL("dustCoverage",v);}}),
      SliderC({label:"Speck Size",value:L.dustSize!=null?L.dustSize:0.5,min:0.05,max:1,step:0.01,onChange:function(v){setL("dustSize",v);}}),
      React.createElement("div",{style:{fontSize:8,color:"#666",lineHeight:1.5,marginTop:4}},"Fine sparse specks. Raise Scale (transform) for finer dust. Layer with low opacity for dirt.")
    ):null,
    L.type==="debris"?React.createElement("div",null,
      SliderC({label:"Density",value:L.debrisDensity!=null?L.debrisDensity:0.5,min:0,max:1,step:0.01,fmt:function(v){return Math.round(v*100)+"%";},onChange:function(v){setL("debrisDensity",v);}}),
      SliderC({label:"Edge Sharpness",value:L.debrisSharp||2,min:0.5,max:6,step:0.1,onChange:function(v){setL("debrisSharp",v);}}),
      React.createElement("div",{style:{fontSize:8,color:"#666",lineHeight:1.5,marginTop:4}},"Irregular fragments at mixed sizes. Good for chips, flakes, rubble.")
    ):null,
    L.type==="grain"?React.createElement("div",null,
      SliderC({label:"Roughness",value:L.grainRough!=null?L.grainRough:0.5,min:0,max:1,step:0.01,fmt:function(v){return Math.round(v*100)+"%";},onChange:function(v){setL("grainRough",v);}}),
      SliderC({label:"Contrast",value:L.grainContrast||1.5,min:0.5,max:4,step:0.05,onChange:function(v){setL("grainContrast",v);}}),
      React.createElement("div",{style:{fontSize:8,color:"#666",lineHeight:1.5,marginTop:4}},"Fine fractal grain — film grain, fine dirt, surface tooth. Crank Scale for finer grain.")
    ):null,

    L.type==="hex"?React.createElement("div",null,
      React.createElement(Sel,{label:"Mode",value:L.hexMode||"edges",opts:[{v:"edges",l:"Honeycomb (edges)"},{v:"cells",l:"Filled Cells"},{v:"value",l:"Random Tone/Cell"},{v:"dots",l:"Center Dots"}],onChange:function(v){setL("hexMode",v);}}),
      SliderC({label:"Thickness",value:L.hexThick!=null?L.hexThick:0.12,min:0.02,max:0.5,step:0.01,onChange:function(v){setL("hexThick",v);}}),
      SliderC({label:"Jitter",value:L.hexJitter||0,min:0,max:1,step:0.01,fmt:function(v){return v<0.02?"perfect":Math.round(v*100)+"%";},onChange:function(v){setL("hexJitter",v);}}),
      React.createElement("div",{style:{fontSize:8,color:"#666",lineHeight:1.5,marginTop:4}},"Seamless on any scale. Row height auto-fits the tile; for the roundest hexagons keep Scale X and Y close.")
    ):null,
    L.type==="scratches"?React.createElement("div",null,
      SliderC({label:"Density",value:L.scrDensity!=null?L.scrDensity:0.5,min:0,max:1,step:0.01,fmt:function(v){return Math.round(v*100)+"%";},onChange:function(v){setL("scrDensity",v);}}),
      SliderC({label:"Length",value:L.scrLength!=null?L.scrLength:0.6,min:0.1,max:1.5,step:0.02,onChange:function(v){setL("scrLength",v);}}),
      SliderC({label:"Thickness",value:L.scrThick!=null?L.scrThick:0.04,min:0.005,max:0.15,step:0.002,onChange:function(v){setL("scrThick",v);}}),
      SliderC({label:"Angle",value:L.scrAngle||0,min:0,max:1,step:0.005,fmt:function(v){return Math.round(v*360)+"°";},onChange:function(v){setL("scrAngle",v);},presets:[{v:0,l:"0°"},{v:0.125,l:"45°"},{v:0.25,l:"90°"},{v:0.375,l:"135°"},{v:0.5,l:"180°"}]}),
      SliderC({label:"Angle Spread",value:L.scrAngleVar!=null?L.scrAngleVar:1,min:0,max:1,step:0.01,fmt:function(v){return v<0.02?"parallel":Math.round(v*100)+"%";},onChange:function(v){setL("scrAngleVar",v);}}),
      SliderC({label:"End Taper",value:L.scrTaper!=null?L.scrTaper:1,min:0,max:1,step:0.01,onChange:function(v){setL("scrTaper",v);}})
    ):null,
    L.type==="sparkle"?React.createElement("div",null,
      SliderC({label:"Density",value:L.spkDensity!=null?L.spkDensity:0.4,min:0,max:1,step:0.01,fmt:function(v){return Math.round(v*100)+"%";},onChange:function(v){setL("spkDensity",v);}}),
      SliderC({label:"Core Size",value:L.spkSize!=null?L.spkSize:0.4,min:0.05,max:1,step:0.01,onChange:function(v){setL("spkSize",v);}}),
      SliderC({label:"Glow",value:L.spkGlow!=null?L.spkGlow:0.5,min:0,max:1,step:0.01,fmt:function(v){return Math.round(v*100)+"%";},onChange:function(v){setL("spkGlow",v);}}),
      SliderC({label:"Star Rays",value:L.spkStreak||0,min:0,max:1,step:0.01,fmt:function(v){return v<0.02?"off":Math.round(v*100)+"%";},onChange:function(v){setL("spkStreak",v);}}),
      SliderC({label:"Twinkle",value:L.spkTwinkle!=null?L.spkTwinkle:0.6,min:0,max:1,step:0.01,fmt:function(v){return Math.round(v*100)+"%";},onChange:function(v){setL("spkTwinkle",v);}})
    ):null,
    L.type==="truchet"?React.createElement("div",null,
      React.createElement(Sel,{label:"Mode",value:L.truMode||"arcs",opts:[{v:"arcs",l:"Arcs (curved)"},{v:"lines",l:"Lines (straight)"},{v:"maze",l:"Maze (solid)"}],onChange:function(v){setL("truMode",v);}}),
      SliderC({label:"Thickness",value:L.truThick!=null?L.truThick:0.18,min:0.03,max:0.5,step:0.01,onChange:function(v){setL("truThick",v);}}),
      React.createElement("div",{style:{fontSize:8,color:"#666",lineHeight:1.5,marginTop:4}},"Tiles connect into continuous paths — circuits, mazes, woven networks.")
    ):null,

    L.type==="cloud"?React.createElement("div",null,
      React.createElement(Sel,{label:"Mode",value:L.cloudMode||"billow",opts:[{v:"billow",l:"Billow (puffy)"},{v:"wisps",l:"Wisps (ridged)"},{v:"puffy",l:"Puffy (full)"}],onChange:function(v){setL("cloudMode",v);}}),
      SliderC({label:"Octaves",value:L.octaves||5,min:1,max:10,step:1,fmt:Math.round,onChange:function(v){setL("octaves",v);}}),
      SliderC({label:"Coverage",value:L.cloudCov!=null?L.cloudCov:0.5,min:0,max:1,step:0.01,fmt:function(v){return Math.round(v*100)+"%";},onChange:function(v){setL("cloudCov",v);}}),
      SliderC({label:"Softness",value:L.cloudSoft!=null?L.cloudSoft:0.5,min:0,max:1,step:0.01,fmt:function(v){return Math.round(v*100)+"%";},onChange:function(v){setL("cloudSoft",v);}})
    ):null,
    L.type==="curl"?React.createElement("div",null,
      React.createElement(Sel,{label:"Curl Output",value:L.curlMode||"magnitude",opts:[{v:"magnitude",l:"Magnitude"},{v:"flow",l:"Flow (silky streaks)"},{v:"swirl",l:"Swirl (vortices)"},{v:"angular",l:"Angular (flow bands)"},{v:"x",l:"X component"},{v:"y",l:"Y component"}],onChange:function(v){setL("curlMode",v);}}),
      SliderC({label:"Curl Scale",value:L.curlScale||5,min:0.5,max:30,step:0.5,onChange:function(v){setL("curlScale",v);}}),
      SliderC({label:"Detail (octaves)",value:L.curlOct||4,min:1,max:6,step:1,fmt:Math.round,onChange:function(v){setL("curlOct",Math.round(v));}})
    ):null,
    // Octaves + gain for types that use fBm internally
    ["caustics","highpass","directional","marble"].indexOf(L.type)!==-1?React.createElement("div",null,
      SliderC({label:"Octaves",value:L.octaves||5,min:1,max:8,step:1,fmt:Math.round,onChange:function(v){setL("octaves",v);}}),
      SliderC({label:"Roughness (gain)",value:L.gain||0.5,min:0.1,max:0.9,step:0.01,onChange:function(v){setL("gain",v);}})
    ):null,
    L.type==="gradient"?React.createElement("div",null,
      React.createElement(GradientPreviewGrid,{
        value:L.gradientType||"radial",
        col:LC8[si%8],
        onChange:function(v){setL("gradientType",v);onCommit();}
      }),
      SliderC({label:"Size",value:L.gradScale||1,min:0.1,max:4,step:0.01,
        fmt:function(v){return"×"+v.toFixed(2);},onChange:function(v){setL("gradScale",v);}}),
      // Frequency only matters for band/ring/ray types
      ["spiral","rings","sineRadial","sineBands","angBands","sawtooth","stepped","starBurst"].indexOf(L.gradientType||"radial")!==-1?
        SliderC({label:"Frequency",value:L.gradFreq||1,min:0.25,max:6,step:0.01,
          fmt:function(v){return"×"+v.toFixed(2);},onChange:function(v){setL("gradFreq",v);}}):null,
      SliderC({label:"Curve (gamma)",value:L.gradPow||1,min:0.25,max:4,step:0.01,
        fmt:function(v){return v.toFixed(2);},onChange:function(v){setL("gradPow",v);}}),
      // Intensity remap curve, right here for convenience (same curve as ADJUST)
      React.createElement("div",{style:{marginTop:8}},
        React.createElement("div",{style:{fontSize:7,color:"#555",marginBottom:4,letterSpacing:1,textTransform:"uppercase"}},"Intensity Remap"),
        React.createElement(CurveEditor,{
          points:(L.curvePoints&&L.curvePoints.length>=2)?L.curvePoints:DEFAULT_CURVE,
          onChange:function(pts){setL("curvePoints",pts);},
          mode:L.curveMode||"smooth",
          onModeChange:function(m){setL("curveMode",m);},
          onCommit:onCommit
        })
      )
    ):null,

    L.type==="shape"?React.createElement("div",null,
      // Shape preview grid — live thumbnails for every shape
      React.createElement(ShapePreviewGrid,{
        value:L.shapeKind||"circle",
        shapeP:L.shapeP,
        col:LC8[si%8],
        onChange:function(id){setL("shapeKind",id);onCommit();}
      }),
      React.createElement(Sep,null),
      // Universal params
      SliderC({label:"Size",value:L.shapeP.r1,min:0.02,max:0.75,step:0.005,onChange:function(v){setLSP("r1",v);}}),
      SliderC({label:"Rotation",value:L.shapeP.rot||0,min:0,max:1,step:0.005,fmt:function(v){return Math.round(v*360)+"°";},onChange:function(v){setLSP("rot",v);},presets:[{v:0,l:"0°"},{v:0.125,l:"45°"},{v:0.25,l:"90°"},{v:0.375,l:"135°"},{v:0.5,l:"180°"}]}),
      SliderC({label:"Outline",value:L.shapeP.outline||0,min:0,max:0.4,step:0.005,fmt:function(v){return v===0?"off (solid)":v.toFixed(3);},onChange:function(v){setLSP("outline",v);}}),
      // R2 — shown for shapes that use inner/second radius
      ["ring","ellipse","moon","star4","star5","star6","vesica","flower","burst"].indexOf(L.shapeKind)!==-1?
        SliderC({label:["ring"].indexOf(L.shapeKind)!==-1?"Inner R":L.shapeKind==="ellipse"?"Height":L.shapeKind==="moon"?"Moon R":L.shapeKind==="vesica"?"Overlap":L.shapeKind==="burst"?"Core R":"Inner",value:L.shapeP.r2,min:0.01,max:0.75,step:0.005,onChange:function(v){setLSP("r2",v);}}):null,
      // Thick — for ring, cross, capsule, horseshoe, stroke, gear, frame
      ["ring","cross","capsule","horseshoe","stroke","gear","frame","bolt","arrow","plus"].indexOf(L.shapeKind)!==-1?
        SliderC({label:L.shapeKind==="arrow"||L.shapeKind==="plus"?"Arm Width":L.shapeKind==="bolt"?"Bolt Width":"Thickness",value:L.shapeP.thick,min:0.005,max:0.5,step:0.005,onChange:function(v){setLSP("thick",v);}}):null,
      // Corner — multipurpose per shape
      ["rbox","moon","egg","pie","horseshoe","vesica","stroke","heart","bolt","arrow"].indexOf(L.shapeKind)!==-1?
        SliderC({label:L.shapeKind==="rbox"?"Corner R":L.shapeKind==="pie"?"Arc Angle":L.shapeKind==="horseshoe"?"Opening":L.shapeKind==="egg"?"Asymmetry":L.shapeKind==="moon"?"Distance":L.shapeKind==="stroke"?"Amplitude":L.shapeKind==="heart"?"Shape":L.shapeKind==="vesica"?"Separation":L.shapeKind==="bolt"?"Jaggedness":L.shapeKind==="arrow"?"Head Width":"Corner",
          value:L.shapeP.corner,min:0.01,max:0.99,step:0.01,
          fmt:L.shapeKind==="pie"?function(v){return Math.round(v*180)+"°";}:null,
          onChange:function(v){setLSP("corner",v);}}):null,
      // Gear teeth / stroke freq / lightning zigs / burst rays — all use gearTeeth
      ["gear","stroke","bolt","burst"].indexOf(L.shapeKind)!==-1?
        SliderC({label:L.shapeKind==="gear"?"Teeth":L.shapeKind==="bolt"?"Zig Count":L.shapeKind==="burst"?"Rays":"Wave Freq",
          value:L.shapeP.gearTeeth,
          min:L.shapeKind==="bolt"?3:L.shapeKind==="burst"?3:2,
          max:L.shapeKind==="bolt"?7:24,step:1,fmt:Math.round,onChange:function(v){setLSP("gearTeeth",Math.round(v));}}):null,
      // Petal count for flower
      L.shapeKind==="flower"?
        SliderC({label:"Petals",value:L.shapeP.petalCount,min:2,max:16,step:1,fmt:Math.round,onChange:function(v){setLSP("petalCount",Math.round(v));}}):null,
      SliderC({label:"Edge Soft",value:L.shapeP.soft,min:0.001,max:0.15,step:0.001,onChange:function(v){setLSP("soft",v);}}),
      React.createElement(Sep,null),
      React.createElement(SHead,null,"Size Curve"),
      React.createElement("div",{style:{fontSize:8,color:"#444",marginBottom:6,lineHeight:1.5}},"Remaps the shape SDF output. Left = inside (0), right = outside (1). Use to create halos, rings, or non-linear falloffs."),
      React.createElement(CurveEditor,{
        points:L.shapeCurvePoints||DEFAULT_CURVE,
        mode:L.shapeCurveMode||"smooth",
        onChange:function(pts){setL("shapeCurvePoints",pts);},
        onModeChange:function(m){setL("shapeCurveMode",m);onCommit();},
        onCommit:onCommit
      }),
      React.createElement(Sep,null),
      React.createElement(SHead,null,"Width Curve (by Angle)"),
      React.createElement("div",{style:{fontSize:8,color:"#444",marginBottom:6,lineHeight:1.5}},"Modulates shape width based on angle (0°=right, going clockwise). Pull down to narrow at that angle."),
      React.createElement(CurveEditor,{
        points:L.shapeWidthCurvePoints||DEFAULT_CURVE,
        mode:L.shapeWidthCurveMode||"smooth",
        onChange:function(pts){setL("shapeWidthCurvePoints",pts);},
        onModeChange:function(m){setL("shapeWidthCurveMode",m);onCommit();},
        onCommit:onCommit
      })
    ):null,

    L.type==="iqcell"?React.createElement("div",null,
      React.createElement(Sel,{label:"Mode",value:L.iqMode||"smooth",opts:[
        {v:"smooth",l:"Smooth (blend)"},{v:"metaballs",l:"Metaballs (merged blobs)"},
        {v:"cells",l:"Soft Cells"},{v:"glow",l:"Glowing Cores"}
      ],onChange:function(v){setL("iqMode",v);}}),
      SliderC({label:"Merge (smooth-min)",value:L.iqSmoothK!=null?L.iqSmoothK:0.4,min:0,max:1,step:0.01,fmt:function(v){return Math.round(v*100)+"%";},onChange:function(v){setL("iqSmoothK",v);}}),
      L.iqMode!=="metaballs"&&L.iqMode!=="glow"?SliderC({label:"Cell/Distance",value:L.iqSmooth!=null?L.iqSmooth:0.5,min:0,max:1,step:0.01,fmt:function(v){return v===0?"Distance":v===1?"Cell value":v.toFixed(2);},onChange:function(v){setL("iqSmooth",v);}}):null,
      React.createElement(Sel,{label:"Distance",value:L.iqMetric||"euclidean",opts:[{v:"euclidean",l:"Euclidean"},{v:"manhattan",l:"Manhattan"},{v:"chebyshev",l:"Chebyshev"}],onChange:function(v){setL("iqMetric",v);}}),
      SliderC({label:"Jitter",value:L.iqJitter!=null?L.iqJitter:1,min:0,max:1,step:0.01,fmt:function(v){return v<0.02?"grid":Math.round(v*100)+"%";},onChange:function(v){setL("iqJitter",v);}}),
      SliderC({label:"Contrast",value:L.iqContrast||1,min:0.3,max:3,step:0.05,onChange:function(v){setL("iqContrast",v);}})
    ):null,
    L.type==="caustics"?React.createElement("div",null,
      React.createElement(Sel,{label:"Mode",value:L.causMode||"lines",opts:[
        {v:"lines",l:"Lines (classic)"},{v:"web",l:"Bright Web"},{v:"cells",l:"Filled Cells"}
      ],onChange:function(v){setL("causMode",v);}}),
      SliderC({label:"Warp",value:L.causWarp!=null?L.causWarp:1.1,min:-2.5,max:2.5,step:0.05,onChange:function(v){setL("causWarp",v);}}),
      SliderC({label:"Fold (branching)",value:L.causFold!=null?L.causFold:0.4,min:0,max:1.5,step:0.05,onChange:function(v){setL("causFold",v);}}),
      SliderC({label:"Line Sharpness",value:L.causSharp!=null?L.causSharp:6,min:2,max:12,step:0.2,onChange:function(v){setL("causSharp",v);}}),
      SliderC({label:"Glow",value:L.causBright!=null?L.causBright:0.28,min:0.12,max:0.6,step:0.01,fmt:function(v){return Math.round((0.72-v)/0.6*100)+"%";},onChange:function(v){setL("causBright",v);}})
    ):null,
    L.type==="plasma"?React.createElement("div",null,
      React.createElement(Sel,{label:"Mode",value:L.plasmaMode||"classic",opts:[
        {v:"classic",l:"Classic Plasma"},{v:"interference",l:"Interference Ridges"},{v:"rings",l:"Rings"}
      ],onChange:function(v){setL("plasmaMode",v);}}),
      SliderC({label:"Waves",value:L.plasmaWaves||4,min:3,max:8,step:1,fmt:Math.round,onChange:function(v){setL("plasmaWaves",Math.round(v));}}),
      SliderC({label:"Warp",value:L.plasmaWarp||0,min:-1.5,max:1.5,step:0.05,onChange:function(v){setL("plasmaWarp",v);}})
    ):null,
    L.type==="crystals"?React.createElement("div",null,
      React.createElement(Sel,{label:"Mode",value:L.crystalMode||"facets",opts:[
        {v:"facets",l:"Facets (classic)"},{v:"shards",l:"Glass Shards"},{v:"veins",l:"Bright Veins"},{v:"plates",l:"Toned Plates"}
      ],onChange:function(v){setL("crystalMode",v);}}),
      React.createElement(Sel,{label:"Distance",value:L.crystalMetric||"manhattan",opts:[{v:"manhattan",l:"Manhattan (angular)"},{v:"euclidean",l:"Euclidean (round)"},{v:"chebyshev",l:"Chebyshev (square)"}],onChange:function(v){setL("crystalMetric",v);}}),
      SliderC({label:"Sharpness",value:L.crystalSharp!=null?L.crystalSharp:4,min:0.5,max:12,step:0.1,onChange:function(v){setL("crystalSharp",v);}}),
      SliderC({label:"Jitter",value:L.crystalJitter!=null?L.crystalJitter:1,min:0,max:1,step:0.01,fmt:function(v){return v<0.02?"grid":Math.round(v*100)+"%";},onChange:function(v){setL("crystalJitter",v);}})
    ):null,
    L.type==="wood"?React.createElement("div",null,
      SliderC({label:"Rings",value:L.woodRings!=null?L.woodRings:8,min:1,max:40,step:0.5,onChange:function(v){setL("woodRings",v);}}),
      SliderC({label:"Turbulence",value:L.woodTurb!=null?L.woodTurb:1.2,min:0,max:6,step:0.05,onChange:function(v){setL("woodTurb",v);}})
    ):null,
    L.type==="marble"?React.createElement("div",null,
      SliderC({label:"Vein Frequency",value:L.marbleFreq!=null?L.marbleFreq:3,min:0.5,max:12,step:0.1,onChange:function(v){setL("marbleFreq",v);}}),
      SliderC({label:"Turbulence",value:L.marbleTurb!=null?L.marbleTurb:4,min:0,max:12,step:0.1,onChange:function(v){setL("marbleTurb",v);}}),
      SliderC({label:"Vein Angle",value:L.marbleAngle||0,min:0,max:1,step:0.005,fmt:function(v){return Math.round(v*360)+"°";},onChange:function(v){setL("marbleAngle",v);},presets:[{v:0,l:"0°"},{v:0.125,l:"45°"},{v:0.25,l:"90°"},{v:0.375,l:"135°"},{v:0.5,l:"180°"}]}),
      SliderC({label:"Vein Sharpness",value:L.marbleSharp||1,min:1,max:6,step:0.1,onChange:function(v){setL("marbleSharp",v);}})
    ):null,
    L.type==="gabor"?React.createElement("div",null,
      SliderC({label:"Frequency",value:L.gaborFreq!=null?L.gaborFreq:16,min:2,max:40,step:0.5,onChange:function(v){setL("gaborFreq",v);}}),
      SliderC({label:"Bandwidth",value:L.gaborBW!=null?L.gaborBW:2,min:0.2,max:6,step:0.1,onChange:function(v){setL("gaborBW",v);}}),
      SliderC({label:"Orientation",value:L.gaborOrient||0,min:0,max:1,step:0.005,fmt:function(v){return Math.round(v*360)+"°";},onChange:function(v){setL("gaborOrient",v);},presets:[{v:0,l:"0°"},{v:0.125,l:"45°"},{v:0.25,l:"90°"},{v:0.375,l:"135°"},{v:0.5,l:"180°"}]}),
      SliderC({label:"Orient Spread",value:L.gaborSpread!=null?L.gaborSpread:1,min:0,max:1,step:0.01,fmt:function(v){return v<0.02?"aligned":v>0.98?"random":Math.round(v*100)+"%";},onChange:function(v){setL("gaborSpread",v);}}),
      SliderC({label:"Anisotropy",value:L.gaborAniso||0,min:0,max:0.95,step:0.01,fmt:function(v){return v<0.02?"round":Math.round(v*100)+"%";},onChange:function(v){setL("gaborAniso",v);}}),
      SliderC({label:"Harmonics",value:L.gaborHarm||1,min:1,max:3,step:1,fmt:Math.round,onChange:function(v){setL("gaborHarm",Math.round(v));}}),
      SliderC({label:"Phase",value:L.gaborPhase||0,min:0,max:1,step:0.01,fmt:function(v){return Math.round(v*360)+"°";},onChange:function(v){setL("gaborPhase",v);}})
    ):null,
    L.type==="sparse"?React.createElement("div",null,
      React.createElement(Sel,{label:"Falloff",value:L.sparseFalloff||"gauss",opts:[
        {v:"gauss",l:"Gaussian (soft)"},{v:"disc",l:"Disc (hard)"},{v:"ring",l:"Ring"},{v:"spike",l:"Spike (tight)"}
      ],onChange:function(v){setL("sparseFalloff",v);}}),
      SliderC({label:"Density",value:L.sparseDens!=null?L.sparseDens:8,min:1,max:20,step:0.5,onChange:function(v){setL("sparseDens",v);}}),
      SliderC({label:"Size Variation",value:L.sparseSizeVar||0,min:0,max:1,step:0.01,fmt:function(v){return Math.round(v*100)+"%";},onChange:function(v){setL("sparseSizeVar",v);}}),
      SliderC({label:"Intensity Var",value:L.sparseIntVar||0,min:0,max:1,step:0.01,fmt:function(v){return Math.round(v*100)+"%";},onChange:function(v){setL("sparseIntVar",v);}})
    ):null,
    L.type==="highpass"?SliderC({label:"Blur Radius",value:L.hpBlur!=null?L.hpBlur:0.5,min:0.1,max:2,step:0.05,onChange:function(v){setL("hpBlur",v);}}):null,
    L.type==="directional"?React.createElement("div",null,
      SliderC({label:"Scale X (along)",value:L.dirScaleX!=null?L.dirScaleX:8,min:0.1,max:32,step:0.1,onChange:function(v){setL("dirScaleX",v);}}),
      SliderC({label:"Scale Y (across)",value:L.dirScaleY!=null?L.dirScaleY:1,min:0.1,max:32,step:0.1,onChange:function(v){setL("dirScaleY",v);}})
    ):null,
    L.type==="waveStroke"?React.createElement("div",null,
      React.createElement("div",{style:{fontSize:8,color:"#444",marginBottom:8,lineHeight:1.5}},"Single wave/trail line. Use with layer opacity + blend to stack multiple trails."),
      SliderC({label:"Angle",value:L.fiberAngle||0,min:-180,max:180,step:1,fmt:function(v){return Math.round(v)+"°";},onChange:function(v){setL("fiberAngle",v);},presets:[{v:0,l:"0°"},{v:45,l:"45°"},{v:90,l:"90°"},{v:135,l:"135°"},{v:180,l:"180°"}]}),
      SliderC({label:"Amplitude",value:L.waveAmp!=null?L.waveAmp:0.35,min:0,max:0.5,step:0.005,
        fmt:function(v){return v===0?"0 (straight)":v.toFixed(3);},onChange:function(v){setL("waveAmp",v);}}),
      SliderC({label:"Warp",value:L.waveWarp!=null?L.waveWarp:0.5,min:0,max:3,step:0.02,
        fmt:function(v){return v===0?"0 (sine)":v.toFixed(2)+" (organic)";},onChange:function(v){setL("waveWarp",v);}}),
      SliderC({label:"Thickness",value:L.waveThick!=null?L.waveThick:0.06,min:0.002,max:0.5,step:0.002,
        fmt:function(v){return (v*100).toFixed(1)+"% of canvas";},onChange:function(v){setL("waveThick",v);}}),
      SliderC({label:"Offset",value:L.waveOffset||0,min:-0.5,max:0.5,step:0.005,
        fmt:function(v){return v===0?"0 (centered)":v.toFixed(3);},onChange:function(v){setL("waveOffset",v);}})
    ):null,
    (L.type==="crosshatch"||L.type==="rippleDir"||L.type==="flowLines")?React.createElement("div",null,
      SliderC({label:"Angle",value:L.fiberAngle||0,min:-180,max:180,step:1,fmt:function(v){return Math.round(v)+"°";},onChange:function(v){setL("fiberAngle",v);},presets:[{v:0,l:"0°"},{v:45,l:"45°"},{v:90,l:"90°"},{v:135,l:"135°"},{v:180,l:"180°"}]}),
      SliderC({label:L.type==="crosshatch"?"Line Freq":"Bands",value:L.waveFreq!=null?L.waveFreq:6,min:1,max:24,step:0.5,onChange:function(v){setL("waveFreq",v);}}),
      L.type==="crosshatch"?SliderC({label:"Thickness",value:L.waveThick!=null?L.waveThick:0.25,min:0.02,max:0.95,step:0.01,fmt:function(v){return Math.round(v*100)+"%";},onChange:function(v){setL("waveThick",v);}}):null,
      (L.type==="rippleDir"||L.type==="flowLines")?SliderC({label:"Warp",value:L.waveWarp!=null?L.waveWarp:0.4,min:0,max:2,step:0.02,onChange:function(v){setL("waveWarp",v);}}):null
    ):null,
    (L.type==="fiber"||L.type==="streaks")?React.createElement("div",null,
      SliderC({label:"Angle",value:L.fiberAngle||0,min:-180,max:180,step:1,fmt:function(v){return Math.round(v)+"°";},onChange:function(v){setL("fiberAngle",v);},presets:[{v:0,l:"0°"},{v:45,l:"45°"},{v:90,l:"90°"},{v:135,l:"135°"},{v:180,l:"180°"}]}),
      L.type==="fiber"?React.createElement("div",null,
        SliderC({label:"Stretch",value:L.fiberStretch!=null?L.fiberStretch:12,min:1,max:40,step:0.5,onChange:function(v){setL("fiberStretch",v);}}),
        SliderC({label:"Cross Fibers",value:L.fiberCross!=null?L.fiberCross:0.15,min:0,max:0.6,step:0.01,fmt:function(v){return Math.round(v*100)+"%";},onChange:function(v){setL("fiberCross",v);}})
      ):null,
      L.type==="streaks"?React.createElement("div",null,
        SliderC({label:"Length",value:L.streakLength!=null?L.streakLength:8,min:1,max:30,step:0.5,onChange:function(v){setL("streakLength",v);}}),
        SliderC({label:"Density",value:L.streakDensity!=null?L.streakDensity:4,min:0.5,max:20,step:0.5,onChange:function(v){setL("streakDensity",v);}})
      ):null,
      SliderC({label:"Octaves",value:L.octaves||5,min:1,max:8,step:1,fmt:Math.round,onChange:function(v){setL("octaves",Math.round(v));}})
    ):null,
    // Universal contrast/sharpness for all directional types
    ["fiber","streaks","crosshatch","rippleDir","flowLines","waveStroke"].indexOf(L.type)!==-1?
      SliderC({label:"Contrast",value:L.dirContrast||1,min:0.3,max:4,step:0.05,onChange:function(v){setL("dirContrast",v);}}):null,
    L.type==="polarScatter"?React.createElement("div",null,
      SliderC({label:"Count",value:L.polarCount||6,min:1,max:32,step:1,fmt:Math.round,onChange:function(v){setL("polarCount",Math.round(v));}}),
      SliderC({label:"Radius",value:L.polarRadius||0.35,min:0.01,max:1,step:0.01,onChange:function(v){setL("polarRadius",v);}}),
      SliderC({label:"Spread / Size",value:L.polarSpread||0.18,min:0.01,max:0.8,step:0.01,onChange:function(v){setL("polarSpread",v);}}),
      SliderC({label:"Center Fill",value:L.polarInner||0,min:0,max:0.5,step:0.01,onChange:function(v){setL("polarInner",v);}}),
      React.createElement(Sel,{label:"Output",value:L.polarMode||"blob",opts:[{v:"blob",l:"Blob (Gaussian)"},{v:"distance",l:"Distance Field"}],onChange:function(v){setL("polarMode",v);}})
    ):null,
    L.type==="slopeGrad"?SliderC({label:"Angle",value:L.slopeAngle||0,min:0,max:360,step:1,fmt:function(v){return Math.round(v)+"°";},onChange:function(v){setL("slopeAngle",v);},presets:[{v:0,l:"0°"},{v:45,l:"45°"},{v:90,l:"90°"},{v:180,l:"180°"},{v:270,l:"270°"}]}):null,
    L.type==="scatter"?React.createElement("div",null,
      React.createElement(Sel,{label:"Element",value:L.scMode||"disc",opts:[{v:"disc",l:"Disc (soft circle)"},{v:"ring",l:"Ring"},{v:"shape",l:"Shape (pick below)"},{v:"sample",l:"Another Layer"}],onChange:function(v){setL("scMode",v);}}),
      SliderC({label:"Grid",value:L.scGrid!=null?L.scGrid:4,min:1,max:24,step:1,fmt:function(v){return Math.round(v)+"×"+Math.round(v);},onChange:function(v){setL("scGrid",Math.round(v));}}),
      SliderC({label:"Density",value:L.scDensity!=null?L.scDensity:0.85,min:0,max:1,step:0.01,fmt:function(v){return Math.round(v*100)+"%";},onChange:function(v){setL("scDensity",v);}}),
      SliderC({label:"Element Size",value:L.scSize!=null?L.scSize:0.5,min:0.05,max:1.5,step:0.01,onChange:function(v){setL("scSize",v);}}),
      SliderC({label:"Jitter",value:L.scJitter!=null?L.scJitter:0.8,min:0,max:1,step:0.01,fmt:function(v){return Math.round(v*100)+"%";},onChange:function(v){setL("scJitter",v);}}),
      React.createElement(Sel,{label:"Blend (overlaps)",value:L.scBlend||"max",opts:[{v:"max",l:"Max (lighten)"},{v:"add",l:"Additive"},{v:"mean",l:"Average"}],onChange:function(v){setL("scBlend",v);}}),
      React.createElement(Sep,null),
      React.createElement(SHead,null,"Randomization"),
      // Horizontal scale range
      React.createElement("div",{style:{fontSize:8,color:"#666",marginBottom:2}},"Horizontal Scale"),
      SliderC({label:"  Min",value:L.scScaleXMin!=null?L.scScaleXMin:1,min:0.1,max:2,step:0.01,onChange:function(v){setL("scScaleXMin",v);}}),
      SliderC({label:"  Max",value:L.scScaleXMax!=null?L.scScaleXMax:1,min:0.1,max:2,step:0.01,onChange:function(v){setL("scScaleXMax",v);}}),
      React.createElement("div",{style:{fontSize:8,color:"#666",marginBottom:2,marginTop:4}},"Vertical Scale"),
      SliderC({label:"  Min",value:L.scScaleYMin!=null?L.scScaleYMin:1,min:0.1,max:2,step:0.01,onChange:function(v){setL("scScaleYMin",v);}}),
      SliderC({label:"  Max",value:L.scScaleYMax!=null?L.scScaleYMax:1,min:0.1,max:2,step:0.01,onChange:function(v){setL("scScaleYMax",v);}}),
      React.createElement("div",{style:{fontSize:8,color:"#666",marginBottom:2,marginTop:4}},"Rotation Range"),
      SliderC({label:"  Min",value:L.scRotMin||0,min:0,max:1,step:0.005,fmt:function(v){return Math.round(v*360)+"°";},onChange:function(v){setL("scRotMin",v);}}),
      SliderC({label:"  Max",value:L.scRotMax!=null?L.scRotMax:0,min:0,max:1,step:0.005,fmt:function(v){return Math.round(v*360)+"°";},onChange:function(v){setL("scRotMax",v);}}),
      React.createElement("div",{style:{fontSize:8,color:"#666",marginBottom:2,marginTop:4}},"Intensity Range"),
      SliderC({label:"  Min",value:L.scIntMin!=null?L.scIntMin:1,min:0,max:1,step:0.01,onChange:function(v){setL("scIntMin",v);}}),
      SliderC({label:"  Max",value:L.scIntMax!=null?L.scIntMax:1,min:0,max:1,step:0.01,onChange:function(v){setL("scIntMax",v);}}),
      React.createElement("div",{style:{fontSize:8,color:"#4a8",marginTop:6,marginBottom:4,lineHeight:1.5}},"Seamless: tiles edge-to-edge automatically at any setting."),
      // Source layer picker for "Another Layer" mode
      (L.scMode==="sample")?React.createElement("div",null,
        React.createElement(Sep,null),
        React.createElement(SHead,null,"Source Layer"),
        React.createElement(Sel,{label:"Use Layer",value:String(L.scSourceIdx!=null?L.scSourceIdx:-1),
          opts:[{v:"-1",l:"(select a layer)"}].concat((p.layers||[]).map(function(ll,idx){return {v:String(idx),l:(idx+1)+": "+(ll.label||ll.type||"Layer")};}).filter(function(o,idx){return idx!==si;})),
          onChange:function(v){setL("scSourceIdx",parseInt(v));}}),
        React.createElement("div",{style:{fontSize:8,color:"#888",lineHeight:1.5}},"Scatters copies of another layer in this stack. That layer keeps rendering normally too — disable it if you only want the scattered copies.")
      ):null,
      // Shape picker only in shape mode
      (L.scMode==="shape")?React.createElement("div",null,
        React.createElement(Sep,null),
        React.createElement(SHead,null,"Scattered Shape"),
        React.createElement(ShapePreviewGrid,{
          value:(L.scShapeP&&L.scShape)||"circle",
          shapeP:L.scShapeP||DSP,
          col:LC8[si%8],
          onChange:function(id){setL("scShape",id);onCommit();}
        }),
        SliderC({label:"Shape Detail",value:(L.scShapeP&&L.scShapeP.r1)||0.38,min:0.05,max:0.5,step:0.005,onChange:function(v){var np=Object.assign({},L.scShapeP||DSP);np.r1=v;setL("scShapeP",np);}}),
        SliderC({label:"Shape Soft",value:(L.scShapeP&&L.scShapeP.soft)||0.022,min:0.001,max:0.15,step:0.001,onChange:function(v){var np=Object.assign({},L.scShapeP||DSP);np.soft=v;setL("scShapeP",np);}})
      ):null
    ):null
    ), // end Collapse "Type Parameters"

    React.createElement(UVDistStack,{dists:L.uvDists||[mkDist()],setDists:function(nd){setL("uvDists",nd);},layers:p.layers,si:si})
    ) // end non-reference params wrapper
  );
}

// ═══ COLOR PAIR PICKER ══════════════════════════════════════════
// Dark + Light swatches with inline hex editing and live gradient preview
// ═══ GRADIENT RAMP (multi-stop) ═════════════════════════════════
var RAMP_PRESETS=[
  {label:"Fire",stops:[{pos:0,color:"#000000"},{pos:0.25,color:"#8b1a00"},{pos:0.5,color:"#ff4400"},{pos:0.75,color:"#ffaa00"},{pos:1,color:"#ffffcc"}]},
  {label:"Embers",stops:[{pos:0,color:"#000000"},{pos:0.3,color:"#3d0000"},{pos:0.6,color:"#cc2200"},{pos:0.8,color:"#ff6600"},{pos:1,color:"#ffddaa"}]},
  {label:"Plasma",stops:[{pos:0,color:"#000030"},{pos:0.33,color:"#8800cc"},{pos:0.66,color:"#ff0066"},{pos:1,color:"#ffdd00"}]},
  {label:"Lava",stops:[{pos:0,color:"#0a0000"},{pos:0.4,color:"#330000"},{pos:0.7,color:"#aa1100"},{pos:0.85,color:"#ff4400"},{pos:1,color:"#ffaa00"}]},
  {label:"Smoke",stops:[{pos:0,color:"#000000"},{pos:0.4,color:"#1a1a1a"},{pos:0.7,color:"#555555"},{pos:1,color:"#cccccc"}]},
  {label:"Black Smoke",stops:[{pos:0,color:"#000000"},{pos:0.5,color:"#111111"},{pos:0.8,color:"#333333"},{pos:1,color:"#888888"}]},
  {label:"Ice",stops:[{pos:0,color:"#001133"},{pos:0.4,color:"#0066cc"},{pos:0.7,color:"#66ccff"},{pos:1,color:"#eef9ff"}]},
  {label:"Frost",stops:[{pos:0,color:"#000a1a"},{pos:0.3,color:"#003366"},{pos:0.6,color:"#4499cc"},{pos:0.8,color:"#aaddff"},{pos:1,color:"#ffffff"}]},
  {label:"Electric",stops:[{pos:0,color:"#000033"},{pos:0.3,color:"#0000cc"},{pos:0.6,color:"#4444ff"},{pos:0.8,color:"#aabbff"},{pos:1,color:"#ffffff"}]},
  {label:"Lightning",stops:[{pos:0,color:"#000011"},{pos:0.4,color:"#220066"},{pos:0.7,color:"#8844ff"},{pos:0.9,color:"#ccaaff"},{pos:1,color:"#ffffff"}]},
  {label:"Acid",stops:[{pos:0,color:"#001100"},{pos:0.3,color:"#004400"},{pos:0.6,color:"#00cc00"},{pos:0.85,color:"#aaff44"},{pos:1,color:"#ffff99"}]},
  {label:"Toxic",stops:[{pos:0,color:"#000000"},{pos:0.4,color:"#112200"},{pos:0.7,color:"#44aa00"},{pos:1,color:"#aaff22"}]},
  {label:"Blood",stops:[{pos:0,color:"#000000"},{pos:0.3,color:"#200000"},{pos:0.6,color:"#660000"},{pos:0.85,color:"#cc0000"},{pos:1,color:"#ff3333"}]},
  {label:"Gold",stops:[{pos:0,color:"#1a0d00"},{pos:0.3,color:"#553300"},{pos:0.6,color:"#cc8800"},{pos:0.85,color:"#ffcc00"},{pos:1,color:"#ffffa0"}]},
  {label:"Sunset",stops:[{pos:0,color:"#000033"},{pos:0.25,color:"#330066"},{pos:0.5,color:"#cc2244"},{pos:0.75,color:"#ff6600"},{pos:1,color:"#ffddaa"}]},
  {label:"Ocean",stops:[{pos:0,color:"#000033"},{pos:0.33,color:"#003366"},{pos:0.66,color:"#006699"},{pos:1,color:"#66cccc"}]},
  {label:"Deep Sea",stops:[{pos:0,color:"#000000"},{pos:0.3,color:"#000033"},{pos:0.6,color:"#003355"},{pos:0.85,color:"#004477"},{pos:1,color:"#0088aa"}]},
  {label:"Neon",stops:[{pos:0,color:"#000000"},{pos:0.33,color:"#ff0066"},{pos:0.66,color:"#00ffcc"},{pos:1,color:"#ffffff"}]},
  {label:"Heatmap",stops:[{pos:0,color:"#000044"},{pos:0.25,color:"#0000ff"},{pos:0.5,color:"#00ff00"},{pos:0.75,color:"#ffff00"},{pos:1,color:"#ff0000"}]},
  {label:"Infrared",stops:[{pos:0,color:"#000000"},{pos:0.25,color:"#000080"},{pos:0.5,color:"#0080ff"},{pos:0.75,color:"#ff8000"},{pos:1,color:"#ffffff"}]},
  {label:"Chalk",stops:[{pos:0,color:"#111111"},{pos:0.5,color:"#888888"},{pos:1,color:"#f0f0f0"}]},
  {label:"Sepia",stops:[{pos:0,color:"#2b1d0e"},{pos:0.5,color:"#7a5c3c"},{pos:1,color:"#f2ddb5"}]},
  {label:"Nebula",stops:[{pos:0,color:"#000000"},{pos:0.2,color:"#110033"},{pos:0.4,color:"#440066"},{pos:0.6,color:"#cc0066"},{pos:0.8,color:"#ff6644"},{pos:1,color:"#ffffcc"}]},
  {label:"Spirit",stops:[{pos:0,color:"#000000"},{pos:0.3,color:"#003322"},{pos:0.6,color:"#00aa66"},{pos:0.85,color:"#aaffdd"},{pos:1,color:"#ffffff"}]},
];

function GradientRamp(p){
  // stops: [{pos:0,color:"#000"},{pos:1,color:"#fff"},...]
  var stops=p.stops&&p.stops.length>=2?p.stops:[{pos:0,color:"#000000"},{pos:1,color:"#ffffff"}];
  var _drag=useState(-1);var dragging=_drag[0],setDragging=_drag[1];
  var trackRef=React.useRef(null);
  var onCommit=p.onCommit||function(){};
  // Touch mode: enlarge bar + stop handles for finger interaction
  var ctxTouch=useContext(TouchActiveContext);
  var touchActive=!!ctxTouch;
  var barH=touchActive?28:20;       // gradient bar height
  var stopW=touchActive?18:12;      // stop handle width
  var stopH=touchActive?36:26;      // stop handle height
  var stopTop=touchActive?-4:-3;    // vertical offset

  function updStop(i,k,v){var ns=stops.map(function(s,si){if(si!==i)return s;var u=Object.assign({},s);u[k]=v;return u;});p.onChange(ns);}
  function addStop(pos){
    // Interpolate color at pos
    var sorted=stops.slice().sort(function(a,b){return a.pos-b.pos;});
    var col="#888888";
    for(var i=0;i<sorted.length-1;i++){
      if(pos>=sorted[i].pos&&pos<=sorted[i+1].pos){
        var t=(pos-sorted[i].pos)/(sorted[i+1].pos-sorted[i].pos||0.001);
        var ca=hexF(sorted[i].color||"#000"),cb=hexF(sorted[i+1].color||"#fff");
        var r=ca[0]+t*(cb[0]-ca[0]),g=ca[1]+t*(cb[1]-ca[1]),b=ca[2]+t*(cb[2]-ca[2]);
        col="#"+[r,g,b].map(function(v){return Math.max(0,Math.min(255,Math.round(v*255))).toString(16).padStart(2,"0");}).join("");
        break;
      }
    }
    p.onChange(stops.concat([{pos:Math.max(0,Math.min(1,pos)),color:col}]));
  }
  function remStop(i){if(stops.length<=2)return;p.onChange(stops.filter(function(_,si){return si!==i;}));}

  // Build gradient CSS string
  var sorted=stops.slice().sort(function(a,b){return a.pos-b.pos;});
  var gradCSS="linear-gradient(to right,"+sorted.map(function(s){return s.color+" "+(s.pos*100).toFixed(1)+"%";}).join(",")+")";

  return React.createElement("div",{style:{marginBottom:10}},
    // Gradient bar — click to add stop, drag handles to reposition
    React.createElement("div",{ref:trackRef,
      onClick:function(e){
        var rect=trackRef.current.getBoundingClientRect();
        var pos=(e.clientX-rect.left)/rect.width;
        addStop(pos);onCommit();
      },
      style:{position:"relative",height:barH,borderRadius:4,background:gradCSS,cursor:"crosshair",marginBottom:6,border:"1px solid #252525",userSelect:"none"}},
      stops.map(function(s,i){
        return React.createElement("div",{key:i,
          onPointerDown:function(e){e.stopPropagation();setDragging(i);e.currentTarget.setPointerCapture(e.pointerId);},
          onPointerMove:function(e){
            if(dragging!==i)return;
            var rect=trackRef.current.getBoundingClientRect();
            var pos=Math.max(0,Math.min(1,(e.clientX-rect.left)/rect.width));
            updStop(i,"pos",pos);
          },
          onPointerUp:function(){setDragging(-1);onCommit();},
          style:{position:"absolute",top:stopTop,left:(s.pos*100)+"%",transform:"translateX(-50%)",
            width:stopW,height:stopH,background:s.color,border:"2px solid "+(dragging===i?"#fff":"#888"),
            borderRadius:3,cursor:"ew-resize",zIndex:2,boxSizing:"border-box",touchAction:"none"}
        });
      })
    ),
    // Stop editor: color + position for selected/hovered
    // Preset swatches
    React.createElement("div",{style:{marginTop:6}},
      React.createElement("div",{style:{display:"flex",flexWrap:"wrap",gap:3}},
        RAMP_PRESETS.map(function(pr){
          // Build CSS gradient for swatch
          var sorted=pr.stops.slice().sort(function(a,b){return a.pos-b.pos;});
          var gradCSS="linear-gradient(to right,"+sorted.map(function(s){return s.color+" "+(s.pos*100).toFixed(0)+"%";}).join(",")+")" ;
          return React.createElement("div",{key:pr.label,
            onClick:function(){p.onChange(pr.stops.slice());onCommit();},
            title:pr.label,
            style:{width:48,height:14,borderRadius:2,background:gradCSS,cursor:"pointer",
              border:"1px solid #252525",flexShrink:0,transition:"transform 0.1s"},
            onMouseEnter:function(e){e.currentTarget.style.transform="scaleY(1.3)";e.currentTarget.style.borderColor="#888";},
            onMouseLeave:function(e){e.currentTarget.style.transform="scaleY(1)";e.currentTarget.style.borderColor="#252525";}
          });
        })
      ),
      React.createElement("div",{style:{display:"flex",flexWrap:"wrap",gap:3,marginTop:3}},
        RAMP_PRESETS.map(function(pr){
          return React.createElement("span",{key:pr.label,
            onClick:function(){p.onChange(pr.stops.slice());onCommit();},
            style:{fontSize:6,color:"#333",cursor:"pointer",fontFamily:"monospace",
              padding:"1px 0",width:48,textAlign:"center",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}
          },pr.label);
        })
      )
    ),
    React.createElement("div",{style:{display:"flex",gap:4,flexWrap:"wrap"}},
      stops.map(function(s,i){
        return React.createElement("div",{key:i,style:{display:"flex",gap:3,alignItems:"center",background:"#141414",border:"1px solid #252525",borderRadius:3,padding:"3px 5px"}},
          React.createElement("input",{type:"color",value:s.color,onChange:function(e){updStop(i,"color",e.target.value);},
            style:{width:22,height:22,border:"none",padding:0,cursor:"pointer",background:"none"}}),
          React.createElement("span",{style:{fontSize:8,color:"#555",fontFamily:"monospace"}},Math.round(s.pos*100)+"%"),
          stops.length>2?React.createElement("span",{onClick:function(){remStop(i);onCommit();},style:{fontSize:10,color:"#444",cursor:"pointer",lineHeight:1,padding:"0 2px"}},"×"):null
        );
      })
    )
  );
}

// ═══ ADJUST PANEL ═══════════════════════════════════════════════
function AdjPanel(p){
  var L=p.L,setL=p.setL,histTick=p.histTick||0;
  var onCommit=p.onCommit||function(){};
  var bumpEpoch=p._bumpEpoch||function(){};
  function SliderC(sp){
    var _ap=sp.animParam!==undefined?sp.animParam:undefined;
    if(_ap===undefined&&sp.id&&ANIM_PARAM_SET[sp.id])_ap=sp.id;
    if(_ap===undefined&&sp.label){
      var _match=ANIM_PARAMS.find(function(x){return x.label===sp.label||x.id===sp.label.toLowerCase().replace(/ /g,"");});
      if(_match)_ap=_match.id;
    }
    return React.createElement(Slider,Object.assign({},sp,{onCommit:onCommit,animParam:_ap,_bumpEpoch:bumpEpoch}));
  }
  function resetAdj(){
    [{k:"brightness",v:0.5},{k:"contrast",v:1},{k:"contrastMode",v:"power"},{k:"midpoint",v:0.5},
     {k:"saturation",v:1},{k:"hueShift",v:0},{k:"invert",v:false},{k:"steps",v:0},
     {k:"multiplier",v:1},{k:"remapIn0",v:0},{k:"remapIn1",v:1},{k:"outputLo",v:0},{k:"outputHi",v:1},
     {k:"curvePoints",v:DEFAULT_CURVE.map(function(p2){return Object.assign({},p2);})}
    ].forEach(function(d){setL(d.k,d.v);});
    onCommit();
  }
  var ri0=L.remapIn0||0,ri1=L.remapIn1!=null?L.remapIn1:1;
  var outLo=L.outputLo||0,outHi=L.outputHi!=null?L.outputHi:1;
  var cmode=L.contrastMode||"power";

  // Levels badge
  var levelsBadge=(ri0!==0||ri1!==1||outLo!==0||outHi!==1)?"modified":null;
  var blurBadge=((L.layerBlur||0)>0||(L.layerGlow||0)>0)?"active":null;
  var postBadge=((L.postTX||0)!==0||(L.postTY||0)!==0||(L.postSX||1)!==1||(L.postSY||1)!==1||(L.postRot||0)!==0)?"modified":null;
  // Color ramp badge: active if not the default black→white
  var stops=L.colorStops||[{pos:0,color:L.colorA||"#000000"},{pos:1,color:L.colorB||"#ffffff"}];
  var isDefaultRamp=stops.length===2
    &&stops[0].pos===0&&(stops[0].color||"").toLowerCase()==="#000000"
    &&stops[1].pos===1&&(stops[1].color||"").toLowerCase()==="#ffffff"
    &&(L.hueShift||0)===0&&Math.abs((L.saturation!=null?L.saturation:1)-1)<0.01;
  var colorBadge=!isDefaultRamp?"custom":null;

  return React.createElement("div",null,
    React.createElement("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}},
      React.createElement("span",{style:{fontSize:9,color:"#555",letterSpacing:1.5,textTransform:"uppercase",fontFamily:"monospace"}},"Adjustments"),
      React.createElement("button",{onClick:resetAdj,title:"Reset all adjust values to defaults",
        style:{padding:"3px 8px",background:"#141414",border:"1px solid #252525",color:"#555",
          fontFamily:"monospace",fontSize:8,cursor:"pointer",borderRadius:3}},
        "Reset")
    ),

    React.createElement(Histogram,{tick:histTick,chanMode:p.chanMode}),

    // Apply these adjustments to other layers too (only useful with 2+ layers)
    (p.applyAdjustTo&&p.layerCount>1)?React.createElement("div",{style:{display:"flex",gap:5,marginBottom:10,marginTop:2}},
      React.createElement("button",{onClick:function(){p.applyAdjustTo("all");if(onCommit)onCommit();},
        title:"Copy this layer's Tone + Curve to every layer",
        style:{flex:1,padding:"6px 0",fontSize:8,fontFamily:"monospace",background:"#161616",color:"#88bbff",
          border:"1px solid #25303d",borderRadius:3,cursor:"pointer",letterSpacing:0.3}},
        "Apply to ALL layers"),
      React.createElement("button",{onClick:function(){p.applyAdjustTo("others");if(onCommit)onCommit();},
        title:"Copy this layer's Tone + Curve to the OTHER layers (keep this one)",
        style:{flex:1,padding:"6px 0",fontSize:8,fontFamily:"monospace",background:"#161616",color:"#88bbff",
          border:"1px solid #25303d",borderRadius:3,cursor:"pointer",letterSpacing:0.3}},
        "Apply to others")
    ):null,

    // ── Tone (contrast, gamma, brightness) ──────────────────
    React.createElement(Collapse,{id:"adj_tone",title:"Tone",defaultOpen:true},
      React.createElement("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}},
        React.createElement("span",{style:{fontSize:9,color:"#888",letterSpacing:1,textTransform:"uppercase"}},"Contrast Mode"),
        React.createElement("div",{style:{display:"flex",gap:3}},
          React.createElement("button",{onClick:function(){setL("contrastMode","power");},style:{padding:"3px 8px",fontSize:9,fontFamily:"monospace",background:cmode==="power"?"#e8900a":"#1a1a1a",color:cmode==="power"?"#000":"#666",border:"1px solid "+(cmode==="power"?"#e8900a":"#282828"),borderRadius:2,cursor:"pointer"}},"Power"),
          React.createElement("button",{onClick:function(){setL("contrastMode","scurve");},style:{padding:"3px 8px",fontSize:9,fontFamily:"monospace",background:cmode==="scurve"?"#e8900a":"#1a1a1a",color:cmode==="scurve"?"#000":"#666",border:"1px solid "+(cmode==="scurve"?"#e8900a":"#282828"),borderRadius:2,cursor:"pointer"}},"S-Curve")
        )
      ),
      React.createElement("div",{style:{fontSize:8,color:"#444",marginBottom:6}},
        cmode==="power"?"v^gamma  —  1=neutral  <1 brighten  >1 darken":"Symmetric sigmoid  —  1=neutral  higher=steeper"
      ),
      SliderC({label:"Gamma / Strength",value:L.contrast!=null?L.contrast:1,min:0.01,max:8,step:0.02,onChange:function(v){setL("contrast",v);}}),
      SliderC({label:"Midpoint (gamma pivot)",value:L.midpoint!=null?L.midpoint:0.5,min:0.01,max:0.99,step:0.01,
        fmt:function(v){return v===0.5?"0.50 (neutral)":v.toFixed(2);},
        onChange:function(v){setL("midpoint",v);}}),
      SliderC({label:"Brightness",value:L.brightness!=null?L.brightness:0.5,resetTo:0.5,min:-1,max:2,step:0.01,onChange:function(v){setL("brightness",v);}}),
      React.createElement(Tog,{label:"Invert",value:!!L.invert,onChange:function(v){setL("invert",v);}})
    ),

    // ── Curve ────────────────────────────────────────────────
    React.createElement(Collapse,{id:"adj_curve",title:"Curve",defaultOpen:!isCurveIdentity(L.curvePoints),
      badge:!isCurveIdentity(L.curvePoints)?"custom":null},
      React.createElement(CurveEditor,{
        points:(L.curvePoints&&L.curvePoints.length>=2)?L.curvePoints:DEFAULT_CURVE,
        onChange:function(pts){setL("curvePoints",pts);},
        mode:L.curveMode||"smooth",
        onModeChange:function(m){setL("curveMode",m);},
        onCommit:onCommit
      })
    ),

    // ── Levels ──────────────────────────────────────────────
    React.createElement(Collapse,{id:"adj_levels",title:"Levels",defaultOpen:!!levelsBadge,badge:levelsBadge},
      React.createElement("div",{style:{fontSize:8,color:"#444",marginBottom:6}},"Input: clips/expands range. Output: remaps to [Lo, Hi]."),
      SliderC({label:"Input Lo",value:ri0,min:-0.5,max:0.99,step:0.01,onChange:function(v){setL("remapIn0",Math.min(v,ri1-0.01));}}),
      SliderC({label:"Input Hi",value:ri1,min:0.01,max:1.5,step:0.01,onChange:function(v){setL("remapIn1",Math.max(v,ri0+0.01));}}),
      React.createElement("div",{style:{position:"relative",height:8,borderRadius:2,background:"linear-gradient(to right,#000,#fff)",marginBottom:8}},
        React.createElement("div",{style:{position:"absolute",left:(clamp(ri0)*100)+"%",top:0,bottom:0,width:2,background:"#e8900a"}}),
        React.createElement("div",{style:{position:"absolute",left:(clamp(ri1)*100)+"%",top:0,bottom:0,width:2,background:"#e8900a"}}),
        React.createElement("div",{style:{position:"absolute",left:(clamp(ri0)*100)+"%",right:((1-clamp(ri1))*100)+"%",top:0,bottom:0,background:"rgba(232,144,10,0.18)"}})
      ),
      SliderC({label:"Output Lo",value:outLo,min:-0.5,max:0.99,step:0.01,onChange:function(v){setL("outputLo",Math.min(v,outHi-0.01));}}),
      SliderC({label:"Output Hi",value:outHi,min:0.01,max:1.5,step:0.01,onChange:function(v){setL("outputHi",Math.max(v,outLo+0.01));}}),
      SliderC({label:"Steps (0=off)",value:L.steps!=null?L.steps:0,min:0,max:32,step:1,
        fmt:function(v){return v===0?"off":""+Math.round(v);},
        onChange:function(v){setL("steps",Math.round(v));}}),
      SliderC({label:"Multiplier",value:L.multiplier!=null?L.multiplier:1,min:0,max:20,step:0.05,onChange:function(v){setL("multiplier",v);}})
    ),

    // ── Blur / Glow ─────────────────────────────────────────
    React.createElement(Collapse,{id:"adj_blur",title:"Blur / Glow",defaultOpen:!!blurBadge,badge:blurBadge,color:"#ffcc44"},
      SliderC({label:"Layer Blur",value:L.layerBlur||0,min:0,max:20,step:0.5,fmt:function(v){return v===0?"off":v.toFixed(1)+"px";},onChange:function(v){setL("layerBlur",v);}}),
      SliderC({label:"Layer Glow",value:L.layerGlow||0,min:0,max:20,step:0.5,fmt:function(v){return v===0?"off":v.toFixed(1)+"px";},onChange:function(v){setL("layerGlow",v);}}),
      (L.layerGlow||0)>0?SliderC({label:"Glow Intensity",value:L.layerGlowIntensity!=null?L.layerGlowIntensity:0.5,min:0,max:3,step:0.02,onChange:function(v){setL("layerGlowIntensity",v);}}):null
    ),

    // ── Color Ramp ──────────────────────────────────────────
    React.createElement(Collapse,{id:"adj_color",title:"Color Ramp",defaultOpen:!!colorBadge,badge:colorBadge,color:"#ff6699"},
      React.createElement("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}},
        React.createElement("span",{style:{fontSize:8,color:"#444",lineHeight:1.5}},"Click bar to add stop. Drag to move."),
        React.createElement("div",{style:{display:"flex",gap:4}},
          React.createElement(SmBtn,{title:"Reverse gradient",onClick:function(){
            var rev=(L.colorStops||[]).map(function(s){return Object.assign({},s,{pos:1-s.pos});}).reverse();
            setL("colorStops",rev);if(rev.length>=2){setL("colorA",rev[0].color);setL("colorB",rev[rev.length-1].color);}onCommit();
          }},"⇄"),
          React.createElement(SmBtn,{title:"Randomize gradient",onClick:function(){
            var pts=L.colorStops||[];var rev=pts.map(function(s){return Object.assign({},s,{color:"#"+[0,0,0].map(function(){return Math.floor(Math.random()*256).toString(16).padStart(2,"0");}).join("")});});
            setL("colorStops",rev);if(rev.length>=2){setL("colorA",rev[0].color);setL("colorB",rev[rev.length-1].color);}onCommit();
          }},""),
          React.createElement(SmBtn,{title:"Reset to black-white",onClick:function(){
            var def=[{pos:0,color:"#000000"},{pos:1,color:"#ffffff"}];
            setL("colorStops",def);setL("colorA","#000000");setL("colorB","#ffffff");onCommit();
          }},"↺")
        )
      ),
      React.createElement(GradientRamp,{
        stops:L.colorStops||[{pos:0,color:L.colorA||"#000000"},{pos:1,color:L.colorB||"#ffffff"}],
        onChange:function(stops){setL("colorStops",stops);if(stops.length>=2){setL("colorA",stops[0].color);setL("colorB",stops[stops.length-1].color);}},
        onCommit:onCommit
      }),
      SliderC({label:"Hue Shift",value:L.hueShift!=null?L.hueShift:0,min:-180,max:180,step:1,
        fmt:function(v){return(v===0?"0":v>0?"+"+Math.round(v):""+Math.round(v))+"deg";},
        onChange:function(v){setL("hueShift",v);}}),
      SliderC({label:"Saturation",value:L.saturation!=null?L.saturation:1,min:0,max:4,step:0.02,
        fmt:function(v){return v.toFixed(2)+(Math.abs(v-1)<0.02?" (neutral)":"");},
        onChange:function(v){setL("saturation",v);}})
    ),

    // ── Post Transform ──────────────────────────────────────
    React.createElement(Collapse,{id:"adj_post",title:"Post Transform",defaultOpen:!!postBadge,badge:postBadge,color:"#4ab4ff"},
      React.createElement("div",{style:{fontSize:8,color:"#444",marginBottom:8,lineHeight:1.6}},
        "Applied after all noise, adjust and effects. Scales, rotates and positions the layer output."
      ),
      React.createElement("div",{style:{display:"flex",gap:8}},
        React.createElement("div",{style:{flex:1}},SliderC({label:"Translate X",value:L.postTX||0,min:-1,max:1,step:0.005,fmt:function(v){return v===0?"0 (center)":v.toFixed(3);},onChange:function(v){setL("postTX",v);}})),
        React.createElement("div",{style:{flex:1}},SliderC({label:"Translate Y",value:L.postTY||0,min:-1,max:1,step:0.005,fmt:function(v){return v===0?"0 (center)":v.toFixed(3);},onChange:function(v){setL("postTY",v);}}))
      ),
      React.createElement("div",{style:{display:"flex",gap:8}},
        React.createElement("div",{style:{flex:1}},SliderC({label:"Scale X",value:L.postSX!=null?L.postSX:1,min:0.05,max:4,step:0.01,fmt:function(v){return v===1?"1.00 (none)":v.toFixed(2);},onChange:function(v){setL("postSX",v);}})),
        React.createElement("div",{style:{flex:1}},SliderC({label:"Scale Y",value:L.postSY!=null?L.postSY:1,min:0.05,max:4,step:0.01,fmt:function(v){return v===1?"1.00 (none)":v.toFixed(2);},onChange:function(v){setL("postSY",v);}}))
      ),
      SliderC({label:"Rotation",value:L.postRot||0,min:-180,max:180,step:0.5,fmt:function(v){return v===0?"0° (none)":Math.round(v)+"°";},onChange:function(v){setL("postRot",v);}}),
      React.createElement("button",{
        onClick:function(){setL("postTX",0);setL("postTY",0);setL("postSX",1);setL("postSY",1);setL("postRot",0);},
        style:{width:"100%",padding:"5px",marginTop:4,background:"#1a1a1a",border:"1px solid #282828",color:"#666",fontFamily:"monospace",fontSize:9,cursor:"pointer",borderRadius:3,letterSpacing:0.5}
      },"↺ Reset Post Transform")
    )
  );
}

// ═══ FILTERS PANEL ══════════════════════════════════════════════
function FiltersPanel(p){
  var filters=p.filters||[],setFilters=p.setFilters,addType=p.addType,setAddType=p.setAddType;
  var layerName=p.layerName||"Layer";
  var onCommit=p.onCommit||function(){};
  var bumpEpoch=p._bumpEpoch||function(){};
  var globalFilters=p.globalFilters||[],setGlobalFilters=p.setGlobalFilters||function(){};
  var _section=useState("this"); var section=_section[0],setSection=_section[1];
  var activeFilters=section==="all"?globalFilters:filters;
  var setActiveFilters=section==="all"?setGlobalFilters:setFilters;
  function SliderC(sp){
    var _ap=sp.animParam!==undefined?sp.animParam:undefined;
    if(_ap===undefined&&sp.id&&ANIM_PARAM_SET[sp.id])_ap=sp.id;
    if(_ap===undefined&&sp.label){
      var _match=ANIM_PARAMS.find(function(x){return x.label===sp.label||x.id===sp.label.toLowerCase().replace(/ /g,"");});
      if(_match)_ap=_match.id;
    }
    return React.createElement(Slider,Object.assign({},sp,{onCommit:onCommit,animParam:_ap,_bumpEpoch:bumpEpoch}));
  }
  function upd(i,k,v){var nf=activeFilters.slice();nf[i]=Object.assign({},nf[i]);nf[i][k]=v;setActiveFilters(nf);}
  function rem(i){var nf=activeFilters.slice();nf.splice(i,1);setActiveFilters(nf);onCommit();}
  function move(i,dir){if(i+dir<0||i+dir>=activeFilters.length)return;var nf=activeFilters.slice(),tmp=nf[i];nf[i]=nf[i+dir];nf[i+dir]=tmp;setActiveFilters(nf);onCommit();}
  // Promote a per-layer filter to global (copy it, remove from layer)
  function promoteToAll(i){var f=Object.assign({},filters[i]);setGlobalFilters(globalFilters.concat([f]));var nf=filters.slice();nf.splice(i,1);setFilters(nf);onCommit();}
  // Demote a global filter to current layer
  function demoteToLayer(i){var f=Object.assign({},globalFilters[i]);setFilters(filters.concat([f]));var nf=globalFilters.slice();nf.splice(i,1);setGlobalFilters(nf);onCommit();}
  // ── Per-layer mask ──────────────────────────────────────────────
  var lmask=p.layerMask||{type:"none"};
  function updLMask(k,v){
    var nm=Object.assign({type:"none",radius:0.5,hardness:0.5,strength:1,offsetX:0,offsetY:0,scaleX:1,scaleY:1,angle:0,invert:false,apply:"both"},lmask);
    nm[k]=v; p.setLayerMask(nm.type==="none"?null:nm);
  }
  var lmActive=lmask.type&&lmask.type!=="none";
  var maskSection=React.createElement("div",{style:{marginBottom:12,padding:10,background:"#111",border:"1px solid "+(lmActive?"#3a5a3a":"#1c1c1c"),borderRadius:4}},
    React.createElement("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:lmActive?8:0}},
      React.createElement("span",{title:"Mask THIS layer only (the Global panel has a separate whole-image mask)",style:{fontSize:9,color:lmActive?"#a0e060":"#888",textTransform:"uppercase",letterSpacing:1,fontFamily:"monospace"}},"Layer Mask"),
      React.createElement("select",{value:lmask.type||"none",
        onChange:function(e){updLMask("type",e.target.value);p.onCommit&&p.onCommit();},
        style:{background:"#0e0e0e",color:lmActive?"#a0e060":"#888",border:"1px solid #2a2a2a",borderRadius:3,fontSize:9,fontFamily:"monospace",padding:"3px 6px",cursor:"pointer"}},
        [["none","None"],["vignette","Vignette"],["ellipse","Ellipse"],["box","Box"],["diamond","Diamond"],["radial","Radial"],["linear","Linear"],["edge","Edge"]].map(function(o){
          return React.createElement("option",{key:o[0],value:o[0]},o[1]);
        })
      )
    ),
    lmActive?React.createElement("div",null,
      SliderC({label:"Radius",value:lmask.radius!=null?lmask.radius:0.5,min:0,max:1.5,step:0.01,onChange:function(v){updLMask("radius",v);}}),
      SliderC({label:"Hardness",value:lmask.hardness||0,min:0,max:1,step:0.01,onChange:function(v){updLMask("hardness",v);}}),
      SliderC({label:"Strength",value:lmask.strength!=null?lmask.strength:1,min:0,max:2,step:0.01,onChange:function(v){updLMask("strength",v);}}),
      SliderC({label:"Offset X",value:lmask.offsetX||0,min:-0.5,max:0.5,step:0.01,onChange:function(v){updLMask("offsetX",v);}}),
      SliderC({label:"Offset Y",value:lmask.offsetY||0,min:-0.5,max:0.5,step:0.01,onChange:function(v){updLMask("offsetY",v);}}),
      lmask.type!=="radial"&&lmask.type!=="linear"&&lmask.type!=="edge"?React.createElement("div",null,
        SliderC({label:"Scale X",value:lmask.scaleX!=null?lmask.scaleX:1,min:0.1,max:3,step:0.01,onChange:function(v){updLMask("scaleX",v);}}),
        SliderC({label:"Scale Y",value:lmask.scaleY!=null?lmask.scaleY:1,min:0.1,max:3,step:0.01,onChange:function(v){updLMask("scaleY",v);}}),
        SliderC({label:"Angle",value:lmask.angle||0,min:0,max:360,step:1,fmt:function(v){return Math.round(v)+"\u00b0";},onChange:function(v){updLMask("angle",v);}})
      ):null,
      React.createElement("div",{style:{display:"flex",gap:6,alignItems:"center",marginTop:6}},
        React.createElement(Tog,{label:"Invert",value:!!lmask.invert,onChange:function(v){updLMask("invert",v);p.onCommit&&p.onCommit();}}),
        React.createElement("div",{style:{flex:1}}),
        [["both","RGBA"],["color","RGB"],["alpha","A"]].map(function(o){
          var act=(lmask.apply||"both")===o[0];
          return React.createElement("button",{key:o[0],onClick:function(){updLMask("apply",o[0]);p.onCommit&&p.onCommit();},
            style:{padding:"3px 8px",fontSize:8,fontFamily:"monospace",background:act?"#a0e060":"#161616",color:act?"#000":"#666",border:"1px solid "+(act?"#a0e060":"#252525"),borderRadius:3,cursor:"pointer"}},o[1]);
        })
      )
    ):null
  );
  return React.createElement("div",null,
    React.createElement(SHead,{color:"#88ddff"},"Filters"),
    maskSection,
    // Section tabs
    React.createElement("div",{style:{display:"flex",gap:4,marginBottom:8}},
      React.createElement("button",{onClick:function(){setSection("this");},style:{flex:1,padding:"5px 0",fontSize:9,fontFamily:"monospace",background:section==="this"?"#e8900a":"#161616",color:section==="this"?"#000":"#555",border:"1px solid "+(section==="this"?"#e8900a":"#252525"),borderRadius:3,cursor:"pointer"}},
        "◈ "+layerName+(filters.length>0?" ("+filters.length+")":"")),
      React.createElement("button",{onClick:function(){setSection("all");},style:{flex:1,padding:"5px 0",fontSize:9,fontFamily:"monospace",background:section==="all"?"#4ab4ff":"#161616",color:section==="all"?"#000":"#555",border:"1px solid "+(section==="all"?"#4ab4ff":"#252525"),borderRadius:3,cursor:"pointer"}},
        "⊞ All Layers"+(globalFilters.length>0?" ("+globalFilters.length+")":""))
    ),
    section==="all"?React.createElement("div",{style:{fontSize:8,color:"#4ab4ff",marginBottom:8,padding:"4px 8px",background:"rgba(74,180,255,0.07)",borderRadius:3,lineHeight:1.5}},"Applied to every layer before compositing. Persists when you switch layers."):null,
    section==="this"&&globalFilters.length>0?React.createElement("div",{style:{fontSize:8,color:"#555",marginBottom:8,padding:"3px 8px",background:"#111",borderRadius:3}},globalFilters.length+" filter"+(globalFilters.length>1?"s":"")+" active on all layers. Switch to All Layers tab to edit."):null,
    activeFilters.map(function(f,i){
      var info=FT.find(function(x){return x.v===f.type;});
      return React.createElement("div",{key:i,style:{background:"#141414",border:"1px solid "+(f.enabled?"#252525":"#1a1a1a"),borderRadius:4,padding:10,marginBottom:8,opacity:f.enabled?1:0.55}},
        React.createElement("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}},
          React.createElement("div",{style:{display:"flex",alignItems:"center",gap:6}},
            React.createElement("div",{onClick:function(){upd(i,"enabled",!f.enabled);onCommit();},style:{width:28,height:16,borderRadius:8,background:f.enabled?"#e8900a":"#252525",cursor:"pointer",position:"relative",transition:"background 0.15s",flexShrink:0}},React.createElement("div",{style:{position:"absolute",width:12,height:12,borderRadius:6,background:"#fff",top:2,left:f.enabled?14:2,transition:"left 0.15s"}})),
            React.createElement("span",{style:{fontSize:10,color:"#ccc",fontFamily:"monospace"}},info?info.l:f.type)
          ),
          React.createElement("div",{style:{display:"flex",gap:3}},
            React.createElement(SmBtn,{onClick:function(){move(i,-1);}},"▲"),
            React.createElement(SmBtn,{onClick:function(){move(i,1);}},"▼"),
            section==="this"?React.createElement(SmBtn,{onClick:function(){promoteToAll(i);},title:"Move to All Layers",color:"#4ab4ff"},"→⊞"):null,
            section==="all"?React.createElement(SmBtn,{onClick:function(){demoteToLayer(i);},title:"Move to current layer only",color:"#e8900a"},"→◈"):null,
            React.createElement(SmBtn,{onClick:function(){rem(i);},color:"#888"},"×")
          ),
          // UV distortion pre-filter
          React.createElement("div",{style:{marginTop:8}},
            React.createElement("span",{style:{fontSize:8,color:"#444",letterSpacing:1,textTransform:"uppercase",display:"block",marginBottom:4}},"Pre-Filter UV Warp"),
            React.createElement("select",{value:f.uvDistType||"none",onChange:function(e){upd(i,"uvDistType",e.target.value);},style:Object.assign({},SS,{marginBottom:4})},
              UVT.map(function(o){return React.createElement("option",{key:o.v,value:o.v},o.l);})
            ),
            f.uvDistType&&f.uvDistType!=="none"?SliderC({label:"Amount",value:f.uvDistAmt||0,min:-3,max:3,step:0.02,onChange:function(v){upd(i,"uvDistAmt",v);}}):null,
            f.uvDistType&&f.uvDistType!=="none"&&["noise","fbmNoise","ridged","ripple"].indexOf(f.uvDistType)!==-1?SliderC({label:"Frequency",value:f.uvDistFreq||3,min:0.5,max:20,step:0.1,onChange:function(v){upd(i,"uvDistFreq",v);}}):null
          )
        ),
        ["edgeDetect","sharpen","curvature","normalMap"].indexOf(f.type)!==-1?SliderC({label:"Strength",value:f.strength||1,min:0.05,max:f.type==="normalMap"?30:5,step:0.05,onChange:function(v){upd(i,"strength",v);}}):null,
        f.type==="emboss"?React.createElement("div",null,SliderC({label:"Strength",value:f.strength||1,min:0.05,max:5,step:0.05,onChange:function(v){upd(i,"strength",v);}}),SliderC({label:"Angle",value:f.angle||45,min:0,max:360,step:1,onChange:function(v){upd(i,"angle",v);},fmt:function(v){return Math.round(v)+"°";}})):null,
        f.type==="posterize"?SliderC({label:"Levels",value:f.levels||4,min:2,max:32,step:1,onChange:function(v){upd(i,"levels",v);},fmt:Math.round}):null,
        f.type==="threshold"?React.createElement("div",null,SliderC({label:"Cutoff",value:f.cutoff||0.5,min:-0.5,max:1.5,step:0.01,onChange:function(v){upd(i,"cutoff",v);}}),SliderC({label:"Softness",value:f.softness||0.02,min:0.001,max:0.5,step:0.005,onChange:function(v){upd(i,"softness",v);}})):null,
        f.type==="bevel"?React.createElement("div",null,SliderC({label:"Strength",value:f.strength||1,min:0.05,max:5,step:0.05,onChange:function(v){upd(i,"strength",v);}}),SliderC({label:"Blur",value:f.blur||3,min:1,max:16,step:0.5,onChange:function(v){upd(i,"blur",v);}})):null,
        f.type==="radialBlur"?React.createElement("div",null,
          SliderC({label:"Samples",value:f.samples||24,min:2,max:64,step:1,fmt:Math.round,onChange:function(v){upd(i,"samples",v);}}),
          SliderC({label:"Amount",value:f.amount||0.3,min:0.01,max:1,step:0.01,onChange:function(v){upd(i,"amount",v);}}),
          SliderC({label:"Center X",value:f.centerX!=null?f.centerX:0.5,min:0,max:1,step:0.01,onChange:function(v){upd(i,"centerX",v);}}),
          SliderC({label:"Center Y",value:f.centerY!=null?f.centerY:0.5,min:0,max:1,step:0.01,onChange:function(v){upd(i,"centerY",v);}})
        ):null,
        f.type==="slopeBlur"?React.createElement("div",null,
          SliderC({label:"Samples",value:f.samples||8,min:2,max:24,step:1,fmt:Math.round,onChange:function(v){upd(i,"samples",v);}}),
          SliderC({label:"Amount",value:f.amount||8,min:1,max:40,step:0.5,onChange:function(v){upd(i,"amount",v);}}),
          React.createElement(Sel,{label:"Direction",value:f.slopeMode||"gradient",opts:[{v:"gradient",l:"Along Gradient"},{v:"tangent",l:"Tangent (Perpendicular)"}],onChange:function(v){upd(i,"slopeMode",v);}})
        ):null,
        f.type==="chromatic"?React.createElement("div",null,
          SliderC({label:"Amount (px)",value:f.amount||5,min:0,max:30,step:0.5,onChange:function(v){upd(i,"amount",v);}}),
          React.createElement(Sel,{label:"Mode",value:f.caMode||"barrel",opts:[{v:"barrel",l:"Radial (Barrel)"},{v:"lateral",l:"Lateral"}],onChange:function(v){upd(i,"caMode",v);}})
        ):null,
        f.type==="makeTileable"?React.createElement("div",null,
          React.createElement("div",{style:{fontSize:8,color:"#444",marginBottom:8,lineHeight:1.5}},
            "4-way quintic blend. Pass 2 smooths residual 1/4-point artifacts."
          ),
          SliderC({label:"Blend Width (0=auto 32%)",value:f.blendWidth||0,min:0,max:128,step:1,
            fmt:function(v){return v===0?"auto":v+"px";},
            onChange:function(v){upd(i,"blendWidth",Math.round(v));}}),
          React.createElement("div",{style:{display:"flex",gap:4,marginTop:6}},
            [{v:1,l:"1 Pass"},{v:2,l:"2 Passes (slower, better)"}].map(function(opt){
              var active=(f.passes||1)===opt.v;
              return React.createElement("button",{key:opt.v,onClick:function(){upd(i,"passes",opt.v);onCommit();},
                style:{flex:1,padding:"5px 0",fontSize:9,fontFamily:"monospace",
                  background:active?"#e8900a":"#161616",color:active?"#000":"#555",
                  border:"1px solid "+(active?"#e8900a":"#252525"),borderRadius:2,cursor:"pointer"}},opt.l);
            })
          )
        ):null,
        f.type==="polarWrap"?React.createElement(Sel,{label:"Mode",value:f.polarMode||"toPolar",opts:[{v:"toPolar",l:"Rectangular → Polar"},{v:"fromPolar",l:"Polar → Rectangular"}],onChange:function(v){upd(i,"polarMode",v);}}):null,
        f.type==="gaussBlur"||f.type==="boxBlur"?SliderC({label:"Radius",value:f.blur||4,min:1,max:32,step:0.5,fmt:function(v){return v.toFixed(1)+"px";},onChange:function(v){upd(i,"blur",v);}}):null,
        f.type==="directionalBlur"?React.createElement("div",null,
          SliderC({label:"Samples",value:f.samples||8,min:2,max:32,step:1,fmt:Math.round,onChange:function(v){upd(i,"samples",Math.round(v));}}),
          SliderC({label:"Amount (px)",value:f.amount||30,min:1,max:200,step:1,onChange:function(v){upd(i,"amount",v);}}),
          SliderC({label:"Angle",value:f.angle||0,min:-180,max:180,step:1,fmt:function(v){return Math.round(v)+"°";},onChange:function(v){upd(i,"angle",v);}})
        ):null,
        f.type==="zoomBlur"?React.createElement("div",null,
          SliderC({label:"Samples",value:f.samples||8,min:2,max:32,step:1,fmt:Math.round,onChange:function(v){upd(i,"samples",Math.round(v));}}),
          SliderC({label:"Amount",value:f.amount||0.3,min:0.01,max:1,step:0.01,onChange:function(v){upd(i,"amount",v);}}),
          SliderC({label:"Center X",value:f.centerX!=null?f.centerX:0.5,min:0,max:1,step:0.01,onChange:function(v){upd(i,"centerX",v);}}),
          SliderC({label:"Center Y",value:f.centerY!=null?f.centerY:0.5,min:0,max:1,step:0.01,onChange:function(v){upd(i,"centerY",v);}})
        ):null,
        f.type==="spinBlur"?React.createElement("div",null,
          SliderC({label:"Samples",value:f.samples||8,min:2,max:32,step:1,fmt:Math.round,onChange:function(v){upd(i,"samples",Math.round(v));}}),
          SliderC({label:"Arc Angle",value:f.angle||10,min:1,max:90,step:0.5,fmt:function(v){return v.toFixed(1)+"°";},onChange:function(v){upd(i,"angle",v);}}),
          SliderC({label:"Center X",value:f.centerX!=null?f.centerX:0.5,min:0,max:1,step:0.01,onChange:function(v){upd(i,"centerX",v);}}),
          SliderC({label:"Center Y",value:f.centerY!=null?f.centerY:0.5,min:0,max:1,step:0.01,onChange:function(v){upd(i,"centerY",v);}})
        ):null,
        f.type==="fxaa"?SliderC({label:"Strength",value:f.strength!=null?f.strength:1,min:0,max:1.5,step:0.01,onChange:function(v){upd(i,"strength",v);}}):null,
        f.type==="pixelize"?SliderC({label:"Pixel Size",value:f.pixelSize||8,min:2,max:64,step:1,fmt:function(v){return Math.round(v)+"px";},onChange:function(v){upd(i,"pixelSize",Math.round(v));}}):null,
        f.type==="hueSat"?React.createElement("div",null,
          SliderC({label:"Hue",value:f.hue||0,min:-180,max:180,step:1,fmt:function(v){return Math.round(v)+"°";},onChange:function(v){upd(i,"hue",v);}}),
          SliderC({label:"Saturation",value:f.saturation!=null?f.saturation:1,min:0,max:2,step:0.01,onChange:function(v){upd(i,"saturation",v);}}),
          SliderC({label:"Value",value:f.value!=null?f.value:1,min:0,max:2,step:0.01,onChange:function(v){upd(i,"value",v);}})
        ):null,
        f.type==="brightCon"?React.createElement("div",null,
          SliderC({label:"Brightness",value:f.brightness||0,min:-1,max:1,step:0.01,onChange:function(v){upd(i,"brightness",v);}}),
          SliderC({label:"Contrast",value:f.contrast!=null?f.contrast:1,min:0,max:3,step:0.01,onChange:function(v){upd(i,"contrast",v);}}),
          SliderC({label:"Gamma",value:f.gamma!=null?f.gamma:1,min:0.25,max:4,step:0.01,onChange:function(v){upd(i,"gamma",v);}})
        ):null,
        f.type==="tint"?React.createElement("div",null,
          SliderC({label:"Red",value:f.tintR!=null?f.tintR:1,min:0,max:2,step:0.01,onChange:function(v){upd(i,"tintR",v);}}),
          SliderC({label:"Green",value:f.tintG!=null?f.tintG:1,min:0,max:2,step:0.01,onChange:function(v){upd(i,"tintG",v);}}),
          SliderC({label:"Blue",value:f.tintB!=null?f.tintB:1,min:0,max:2,step:0.01,onChange:function(v){upd(i,"tintB",v);}})
        ):null,
        f.type==="quantize"?React.createElement("div",null,
          SliderC({label:"Levels",value:f.levels||4,min:2,max:32,step:1,fmt:Math.round,onChange:function(v){upd(i,"levels",Math.round(v));}}),
          SliderC({label:"Dither",value:f.dither||0,min:0,max:1,step:0.01,onChange:function(v){upd(i,"dither",v);}})
        ):null
      );
    }),
    React.createElement("div",{style:{marginTop:8}},
      React.createElement("span",{style:{fontSize:8,color:"#444",textTransform:"uppercase",letterSpacing:1,display:"block",marginBottom:6}},"Add Filter"),
      [
        {group:"Detect",types:[{v:"edgeDetect",l:"Edge"},{v:"normalMap",l:"Normal"},{v:"curvature",l:"Curve"},{v:"emboss",l:"Emboss"}]},
        {group:"Blur",types:[{v:"gaussBlur",l:"Gaussian"},{v:"boxBlur",l:"Box"},{v:"directionalBlur",l:"Direction"},{v:"radialBlur",l:"Radial"},{v:"zoomBlur",l:"Zoom"},{v:"spinBlur",l:"Spin"},{v:"slopeBlur",l:"Slope"}]},
        {group:"Adjust",types:[{v:"sharpen",l:"Sharpen"},{v:"threshold",l:"Threshold"},{v:"posterize",l:"Posterize"},{v:"histoEq",l:"Histo Eq"},{v:"grayscale",l:"Grayscale"},{v:"invert",l:"Invert"},{v:"bevel",l:"Bevel"}]},
        {group:"Color",types:[{v:"hueSat",l:"Hue/Sat"},{v:"brightCon",l:"Bright/Con"},{v:"tint",l:"Tint"}]},
        {group:"FX",types:[{v:"chromatic",l:"Chromatic"},{v:"fxaa",l:"FXAA"},{v:"makeTileable",l:"Tileable"},{v:"polarWrap",l:"Polar"},{v:"pixelize",l:"Pixelize"},{v:"quantize",l:"Quantize"}]}
      ].map(function(grp){
        return React.createElement("div",{key:grp.group,style:{marginBottom:8}},
          React.createElement("span",{style:{fontSize:7,color:"#333",textTransform:"uppercase",letterSpacing:1.5,display:"block",marginBottom:4}},grp.group),
          React.createElement("div",{style:{display:"flex",flexWrap:"wrap",gap:3}},
            grp.types.map(function(ft){
              return React.createElement("button",{key:ft.v,
                onClick:function(){setActiveFilters(activeFilters.concat([mkFilter(ft.v)]));onCommit();},
                title:"Add "+ft.l+" filter",
                style:{padding:"4px 7px",fontSize:8,fontFamily:"monospace",
                  background:"#141414",border:"1px solid #252525",color:"#666",
                  borderRadius:3,cursor:"pointer",transition:"all 0.08s"},
                onMouseEnter:function(e){e.currentTarget.style.borderColor="#e8900a";e.currentTarget.style.color="#e8900a";},
                onMouseLeave:function(e){e.currentTarget.style.borderColor="#252525";e.currentTarget.style.color="#666";}
              },ft.l);
            })
          )
        );
      })
    )
  );
}

// ═══ QUICK ACTIONS PANEL ══════════════════════════════════════
// User-definable one-tap buttons for common operations

// ═══ GLOBAL PANEL ═══════════════════════════════════════════════
function GlobalPanel(p){
  var state=p.state,setS=p.setS,updMask=p.updMask,onSave=p.onSave,onLoad=p.onLoad,onNew=p.onNew,saveStatus=p.saveStatus,onExportPng=p.onExportPng;
  var onCommit=p.onCommit||function(){};
  function SliderC(sp){
    // Auto-detect animatable param: explicit animParam > id > label reverse lookup
    var _ap=sp.animParam!==undefined?sp.animParam:undefined;
    if(_ap===undefined&&sp.id&&ANIM_PARAM_SET[sp.id])_ap=sp.id;
    if(_ap===undefined&&sp.label){
      var _match=ANIM_PARAMS.find(function(x){return x.label===sp.label||x.id===sp.label.toLowerCase().replace(/ /g,"");});
      if(_match)_ap=_match.id;
    }
    return React.createElement(Slider,Object.assign({},sp,{onCommit:onCommit,animParam:_ap,_bumpEpoch:p._bumpEpoch||function(){}}));
  }

  // Badges for each section
  var blurActive=(state.blurRadius||0)>0;
  var glowActive=(state.glowRadius||0)>0&&(state.glowIntensity||0)>0;
  var maskActive=state.mask&&state.mask.type&&state.mask.type!=="none";

  return React.createElement("div",null,

    // ── EXPORT (primary action, always visible) ───────────────
    React.createElement("div",{style:{marginBottom:10}},
      React.createElement("button",{onClick:p.onExportPng,
        style:{width:"100%",padding:"11px 0",background:"#e8900a",border:"none",color:"#000",
          fontFamily:"monospace",fontSize:12,fontWeight:700,cursor:"pointer",borderRadius:4,letterSpacing:1}},
        "↓ Export PNG ("+(state.exportSize||512)+"px)"),
      saveStatus?React.createElement("div",{style:{fontSize:9,color:"#a0e060",letterSpacing:1,marginTop:6,textAlign:"center"}},saveStatus):null
    ),

    // ── BATCH EXPORT (multi-resolution) ───────────────────────
    React.createElement(Collapse,{id:"global_batch",title:"Batch Export (variants)",defaultOpen:false,color:"#44ddcc"},
      React.createElement("div",{style:{fontSize:8,color:"#555",lineHeight:1.6,marginBottom:8}},
        "Export variants of your current work in one click. A is the texture as-is; B, C, D re-seed every layer for fresh variations. Each saves as its own PNG."),
      React.createElement("div",{style:{fontSize:7,color:"#444",marginBottom:4,letterSpacing:0.5,textTransform:"uppercase"}},"Variants"),
      React.createElement("div",{style:{display:"flex",gap:6,marginBottom:10}},
        ["A","B","C","D"].map(function(lbl,vi){
          var sel=(p.state._batchVariants||[0,1,2,3]).indexOf(vi)!==-1;
          return React.createElement("button",{key:lbl,
            onClick:function(){
              var cur=(p.state._batchVariants||[0,1,2,3]).slice();
              var idx=cur.indexOf(vi);
              if(idx!==-1)cur.splice(idx,1);else cur.push(vi);
              cur.sort(function(a,b){return a-b;});
              setS("_batchVariants",cur);
            },
            style:{flex:1,padding:"8px 0",fontSize:11,fontFamily:"monospace",fontWeight:700,
              background:sel?"#44ddcc":"#161616",color:sel?"#000":"#666",
              border:"1px solid "+(sel?"#44ddcc":"#252525"),borderRadius:3,cursor:"pointer"}},
            lbl);
        })
      ),
      React.createElement("div",{style:{fontSize:7,color:"#444",marginBottom:4,letterSpacing:0.5,textTransform:"uppercase"}},"Size"),
      React.createElement("div",{style:{display:"flex",flexWrap:"wrap",gap:6,marginBottom:10}},
        [256,512,1024,2048].map(function(sz){
          var sel=(p.state._batchSize||1024)===sz;
          return React.createElement("button",{key:sz,
            onClick:function(){setS("_batchSize",sz);},
            style:{flex:"1 1 22%",padding:"7px 0",fontSize:9,fontFamily:"monospace",
              background:sel?"#2a6a64":"#161616",color:sel?"#9fe":"#666",
              border:"1px solid "+(sel?"#44ddcc":"#252525"),borderRadius:3,cursor:"pointer"}},
            sz>=1024?(sz/1024)+"k":sz);
        })
      ),
      React.createElement("button",{
        onClick:function(){var v=(p.state._batchVariants||[0,1,2,3]);if(v.length&&p.onBatchExport)p.onBatchExport(v,p.state._batchSize||1024);},
        style:{width:"100%",padding:"9px 0",background:(p.state._batchVariants||[0,1,2,3]).length?"#44ddcc":"#222",
          border:"none",color:(p.state._batchVariants||[0,1,2,3]).length?"#000":"#555",
          fontFamily:"monospace",fontSize:11,fontWeight:700,cursor:"pointer",borderRadius:4,letterSpacing:1}},
        "↓ Export "+((p.state._batchVariants||[0,1,2,3]).length)+" variants")
    ),

    // ── NORMAL MAP EXPORT ─────────────────────────────────────
    React.createElement(Collapse,{id:"global_normal",title:"Normal Map Export",defaultOpen:false,color:"#cc88ff"},
      React.createElement("div",{style:{fontSize:8,color:"#555",lineHeight:1.6,marginBottom:8}},
        "Converts the final composite (as height) to a tangent-space normal map. Wrap-around sampling keeps tiling textures seamless. OpenGL convention (Unity default)."),
      React.createElement(Slider,{label:"Bump Strength",value:state.normalStrength!=null?state.normalStrength:2,min:0.2,max:10,step:0.05,
        fmt:function(v){return v.toFixed(2);},onChange:function(v){setS("normalStrength",v);}}),
      React.createElement("button",{onClick:function(){p.onExportNormal&&p.onExportNormal(state.normalStrength!=null?state.normalStrength:2);},
        style:{width:"100%",padding:"9px 0",background:"#cc88ff",border:"none",color:"#000",
          fontFamily:"monospace",fontSize:11,fontWeight:700,cursor:"pointer",borderRadius:4,letterSpacing:1}},
        "↓ Export Normal Map ("+(state.exportSize||512)+"px)")
    ),

    // ── PROJECT FILE (collapsed by default — rare actions) ───
    React.createElement(Collapse,{id:"global_project",title:"Project File",defaultOpen:false,color:"#a0e060"},
      React.createElement("div",{style:{fontSize:8,color:"#555",lineHeight:1.6,marginBottom:8}},
        "Save/load to browser storage, or export/import as .texgen file."
      ),
      React.createElement("div",{style:{display:"grid",gridTemplateColumns:"1fr 1fr",gap:5,marginBottom:5}},
        React.createElement("button",{onClick:onSave,style:{padding:"7px 0",background:"#1a1a1a",border:"1px solid #2a2a2a",color:"#a0e060",fontFamily:"monospace",fontSize:9,cursor:"pointer",borderRadius:3}},"💾 Save"),
        React.createElement("button",{onClick:onLoad,style:{padding:"7px 0",background:"#1a1a1a",border:"1px solid #2a2a2a",color:"#a0e060",fontFamily:"monospace",fontSize:9,cursor:"pointer",borderRadius:3}},"📂 Load")
      ),
      React.createElement("div",{style:{display:"grid",gridTemplateColumns:"1fr 1fr",gap:5,marginBottom:5}},
        React.createElement("button",{onClick:p.onExportProject,style:{padding:"7px 0",background:"#1a1a1a",border:"1px solid #4ab4ff",color:"#4ab4ff",fontFamily:"monospace",fontSize:9,cursor:"pointer",borderRadius:3}},"↓ Export .texgen"),
        React.createElement("button",{onClick:p.onImportProject,style:{padding:"7px 0",background:"#1a1a1a",border:"1px solid #4ab4ff",color:"#4ab4ff",fontFamily:"monospace",fontSize:9,cursor:"pointer",borderRadius:3}},"↑ Import .texgen")
      ),
      React.createElement("button",{onClick:onNew,
        style:{width:"100%",padding:"6px 0",background:"none",border:"1px solid #333",color:"#666",fontFamily:"monospace",fontSize:9,cursor:"pointer",borderRadius:3,marginTop:3}},
        "✕ New project")
    ),

    // ── EXPORT SETTINGS ──────────────────────────────────────
    React.createElement(Collapse,{id:"global_settings",title:"Output Settings",defaultOpen:false},
      React.createElement(Sel,{label:"Export Size",value:state.exportSize||512,opts:[{v:256,l:"256 px"},{v:512,l:"512 px"},{v:1024,l:"1024 px"},{v:2048,l:"2048 px"}],onChange:function(v){setS("exportSize",parseInt(v));}}),
      React.createElement("div",{style:{fontSize:8,color:"#444",marginBottom:10,lineHeight:1.5}},"Preview always renders at the selected resolution above the canvas. Export uses this size."),
      // Anti-banding dither
      React.createElement("div",{style:{marginBottom:10}},
        React.createElement("span",{style:LS},"Anti-Banding Dither"),
        React.createElement("div",{style:{display:"flex",gap:6,marginBottom:6}},
          [["Off",0],["Subtle",0.5],["Normal",1],["Strong",1.5]].map(function(o){
            var act=Math.abs((state.exportDither!=null?state.exportDither:0)-o[1])<0.001;
            return React.createElement("button",{key:o[0],
              title:"TPDF dither: adds "+o[1]+" LSB of triangular noise before 8-bit quantization to remove banding in smooth gradients",
              onClick:function(){setS("exportDither",o[1]);},
              style:{flex:1,padding:"5px 0",fontSize:9,fontFamily:"monospace",background:act?"#44ddcc":"#161616",
                color:act?"#000":"#666",border:"1px solid "+(act?"#44ddcc":"#252525"),borderRadius:3,cursor:"pointer"}},o[0]);
          })
        ),
        React.createElement("div",{style:{fontSize:8,color:"#444",lineHeight:1.5}},"Applied on PNG export only (not normal maps). Removes hard steps in very smooth gradients. \"Normal\" suits most cases.")
      ),
      React.createElement("div",{style:{marginBottom:10}},
        React.createElement("span",{style:LS},"Color Space"),
        React.createElement("div",{style:{display:"flex",gap:6}},
          React.createElement(TBtn,{active:state.colorSpace==="linear",onClick:function(){setS("colorSpace","linear");}},"LINEAR"),
          React.createElement(TBtn,{active:state.colorSpace==="srgb",  onClick:function(){setS("colorSpace","srgb");}},"SRGB")
        )
      )
    ),

    // ── GLOBAL BLUR (collapsed if inactive) ─────────────────
    React.createElement(Collapse,{id:"global_blur",title:"Global Blur",defaultOpen:blurActive,
      badge:blurActive?(state.blurRadius.toFixed(1)+"px"):null},
      React.createElement("div",{style:{fontSize:8,color:"#444",marginBottom:6}},"Applied to the entire composited image after all layers."),
      SliderC({label:"Radius",value:state.blurRadius||0,min:0,max:30,step:0.5,
        fmt:function(v){return v===0?"off":v.toFixed(1)+"px";},
        onChange:function(v){setS("blurRadius",v);}})
    ),

    // ── GLOBAL GLOW (collapsed if inactive) ─────────────────
    React.createElement(Collapse,{id:"global_glow",title:"Glow / Bloom",defaultOpen:glowActive,
      badge:glowActive?"active":null,color:"#ffcc44"},
      React.createElement("div",{style:{fontSize:8,color:"#444",marginBottom:6}},"Bloom on composited image. Simulates emissive light spread."),
      SliderC({label:"Radius",value:state.glowRadius||0,min:0,max:30,step:0.5,
        fmt:function(v){return v===0?"off":v.toFixed(1)+"px";},
        onChange:function(v){setS("glowRadius",v);}}),
      (state.glowRadius||0)>0?React.createElement("div",null,
        SliderC({label:"Intensity",value:state.glowIntensity!=null?state.glowIntensity:0.5,min:0,max:4,step:0.02,
          onChange:function(v){setS("glowIntensity",v);}}),
        SliderC({label:"Threshold",value:state.glowThreshold||0,min:0,max:0.95,step:0.01,
          fmt:function(v){return v===0?"0 (all areas)":v.toFixed(2)+" (bright only)";},
          onChange:function(v){setS("glowThreshold",v);}}),
        React.createElement("div",{style:{marginBottom:8}},
          React.createElement("span",{style:LS},"Blend"),
          React.createElement("div",{style:{display:"flex",gap:4}},
            React.createElement("button",{onClick:function(){setS("glowBlend","add");onCommit();},style:{flex:1,padding:"5px 0",fontSize:9,fontFamily:"monospace",background:(state.glowBlend||"add")==="add"?"#ffcc44":"#1a1a1a",color:(state.glowBlend||"add")==="add"?"#000":"#666",border:"1px solid "+((state.glowBlend||"add")==="add"?"#ffcc44":"#282828"),borderRadius:3,cursor:"pointer"}},"Add (Emissive)"),
            React.createElement("button",{onClick:function(){setS("glowBlend","screen");onCommit();},style:{flex:1,padding:"5px 0",fontSize:9,fontFamily:"monospace",background:state.glowBlend==="screen"?"#ffcc44":"#1a1a1a",color:state.glowBlend==="screen"?"#000":"#666",border:"1px solid "+(state.glowBlend==="screen"?"#ffcc44":"#282828"),borderRadius:3,cursor:"pointer"}},"Screen (Soft)")
          )
        ),
        React.createElement("div",{style:{marginBottom:6}},
          React.createElement("span",{style:LS},"Tint (R / G / B)"),
          React.createElement("div",{style:{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6}},
            [["R","glowTintR"],["G","glowTintG"],["B","glowTintB"]].map(function(t){
              return SliderC({key:t[0],label:t[0],value:state[t[1]]!=null?state[t[1]]:1,min:0,max:2,step:0.02,
                onChange:function(v){setS(t[1],v);}});
            })
          )
        )
      ):null
    ),

    // ── GLOBAL ADJUSTMENTS (tone/color on the whole composite) ──
    React.createElement(Collapse,{id:"global_adjust",title:"Global Adjustments",
      defaultOpen:!!(state.gBrightness||state.gContrast&&state.gContrast!==1||state.gSaturation&&state.gSaturation!==1||state.gVignette||state.gHue),
      badge:(state.gBrightness||(state.gContrast&&state.gContrast!==1)||(state.gSaturation&&state.gSaturation!==1)||state.gVignette||state.gHue)?"active":null,color:"#66ccff"},
      React.createElement("div",{style:{fontSize:8,color:"#444",marginBottom:6}},"Tone and color applied to the whole image, after glow."),
      SliderC({label:"Brightness",value:state.gBrightness||0,min:-1,max:1,step:0.01,resetTo:0,
        fmt:function(v){return v===0?"0":(v>0?"+":"")+v.toFixed(2);},onChange:function(v){setS("gBrightness",v);}}),
      SliderC({label:"Contrast",value:state.gContrast!=null?state.gContrast:1,min:0,max:3,step:0.02,resetTo:1,
        fmt:function(v){return v.toFixed(2)+"x";},onChange:function(v){setS("gContrast",v);}}),
      SliderC({label:"Saturation",value:state.gSaturation!=null?state.gSaturation:1,min:0,max:2,step:0.02,resetTo:1,
        fmt:function(v){return Math.round(v*100)+"%";},onChange:function(v){setS("gSaturation",v);}}),
      SliderC({label:"Hue Shift",value:state.gHue||0,min:-180,max:180,step:1,resetTo:0,
        presets:[{v:0,l:"0°"},{v:90,l:"90°"},{v:180,l:"180°"},{v:-90,l:"-90°"}],
        fmt:function(v){return Math.round(v)+"°";},onChange:function(v){setS("gHue",v);}}),
      SliderC({label:"Vignette",value:state.gVignette||0,min:0,max:1,step:0.01,resetTo:0,
        fmt:function(v){return v===0?"off":Math.round(v*100)+"%";},onChange:function(v){setS("gVignette",v);}})
    ),

    // ── GLOBAL MASK (collapsed if inactive) ─────────────────
    React.createElement(Collapse,{id:"global_mask",title:"Global Mask",defaultOpen:maskActive,
      badge:maskActive?state.mask.type:null},
      React.createElement(Sel,{label:"Type",value:state.mask.type,opts:[
        {v:"none",    l:"None"},
        {v:"vignette",l:"Vignette (circular)"},
        {v:"ellipse", l:"Ellipse"},
        {v:"box",     l:"Box"},
        {v:"diamond", l:"Diamond"},
        {v:"radial",  l:"Radial (outward)"},
        {v:"edge",    l:"Edge Fade"},
        {v:"linear",  l:"Linear"},
      ],onChange:function(v){updMask("type",v);}}),
      state.mask.type!=="none"?React.createElement("div",null,
        React.createElement(SHead,null,"Shape"),
        React.createElement(Slider,{label:"Radius",value:state.mask.radius!=null?state.mask.radius:0.5,min:0,max:1.5,step:0.01,
          fmt:function(v){return v.toFixed(2);},onChange:function(v){updMask("radius",v);}}),
        React.createElement(Slider,{label:"Hardness",value:state.mask.hardness||0,min:0,max:1,step:0.01,
          fmt:function(v){return v===0?"0 (soft)":v===1?"1 (hard)":v.toFixed(2);},
          onChange:function(v){updMask("hardness",v);}}),
        React.createElement(Slider,{label:"Strength",value:state.mask.strength!=null?state.mask.strength:1,min:0,max:2,step:0.01,onChange:function(v){updMask("strength",v);}}),
        React.createElement(Tog,{label:"Invert",value:!!state.mask.invert,onChange:function(v){updMask("invert",v);}}),
        React.createElement("div",{style:{marginBottom:10}},
          React.createElement("span",{style:{fontSize:9,color:"#555",letterSpacing:1.2,textTransform:"uppercase",display:"block",marginBottom:6}},"Apply To"),
          React.createElement("div",{style:{display:"flex",gap:4}},
            [{v:"both",l:"RGB + Alpha"},{v:"color",l:"RGB only"},{v:"alpha",l:"Alpha only"}].map(function(o){
              var active=(state.mask.apply||"both")===o.v;
              return React.createElement("button",{key:o.v,onClick:function(){updMask("apply",o.v);},style:{
                flex:1,padding:"5px 4px",fontSize:9,fontFamily:"monospace",textAlign:"center",
                background:active?"#e8900a":"#161616",color:active?"#000":"#555",
                border:"1px solid "+(active?"#e8900a":"#252525"),borderRadius:3,cursor:"pointer"
              }},o.l);
            })
          )
        ),
        React.createElement(SHead,null,"Transform"),
        React.createElement("div",{style:{display:"flex",gap:8}},
          React.createElement("div",{style:{flex:1}},React.createElement(Slider,{label:"Offset X",value:state.mask.offsetX||0,min:-0.5,max:0.5,step:0.005,onChange:function(v){updMask("offsetX",v);}})),
          React.createElement("div",{style:{flex:1}},React.createElement(Slider,{label:"Offset Y",value:state.mask.offsetY||0,min:-0.5,max:0.5,step:0.005,onChange:function(v){updMask("offsetY",v);}}))
        ),
        (state.mask.type==="ellipse"||state.mask.type==="box"||state.mask.type==="diamond")?React.createElement("div",{style:{display:"flex",gap:8}},
          React.createElement("div",{style:{flex:1}},React.createElement(Slider,{label:"Scale X",value:state.mask.scaleX!=null?state.mask.scaleX:1,min:0.1,max:3,step:0.02,onChange:function(v){updMask("scaleX",v);}})),
          React.createElement("div",{style:{flex:1}},React.createElement(Slider,{label:"Scale Y",value:state.mask.scaleY!=null?state.mask.scaleY:1,min:0.1,max:3,step:0.02,onChange:function(v){updMask("scaleY",v);}}))
        ):null,
        (state.mask.type==="linear"||state.mask.type==="diamond")?React.createElement(Slider,{label:"Angle",value:state.mask.angle||0,min:-180,max:180,step:1,fmt:function(v){return Math.round(v)+"°";},onChange:function(v){updMask("angle",v);}}):null,
        React.createElement(SHead,null,"UV Distortion"),
        React.createElement("select",{value:state.mask.uvDistType||"none",onChange:function(e){updMask("uvDistType",e.target.value);},style:{width:"100%",background:"#161616",border:"1px solid #252525",color:"#ccc",padding:"6px 8px",fontSize:12,fontFamily:"monospace",borderRadius:3,boxSizing:"border-box",marginBottom:8}},
          [{v:"none",l:"None"},{v:"noise",l:"Noise Warp"},{v:"fbmNoise",l:"fBm Warp"},{v:"swirl",l:"Swirl"},{v:"twist",l:"Twist"},{v:"pinch",l:"Pinch"},{v:"bulge",l:"Bulge"},{v:"ripple",l:"Ripple"},{v:"fisheye",l:"Fisheye"}].map(function(o){return React.createElement("option",{key:o.v,value:o.v},o.l);})
        ),
        state.mask.uvDistType&&state.mask.uvDistType!=="none"?React.createElement("div",null,
          React.createElement(Slider,{label:"Amount",value:state.mask.uvDistAmt||0,min:0,max:3,step:0.02,onChange:function(v){updMask("uvDistAmt",v);}}),
          (state.mask.uvDistType==="noise"||state.mask.uvDistType==="fbmNoise"||state.mask.uvDistType==="ripple")?React.createElement(Slider,{label:"Frequency",value:state.mask.uvDistFreq||3,min:0.5,max:12,step:0.1,onChange:function(v){updMask("uvDistFreq",v);}}):null
        ):null
      ):null
    ),

    // ── KEYBOARD SHORTCUTS (collapsed by default) ───────────
    React.createElement(Collapse,{id:"global_kbd",title:"Keyboard Shortcuts",defaultOpen:false},
      React.createElement("div",{style:{display:"grid",gridTemplateColumns:"auto 1fr",gap:"3px 12px",fontSize:9,lineHeight:1.8}},
        ["Ctrl+Z","Undo","Ctrl+Y","Redo","Ctrl+S","Save",
         "1–6","Switch tab","[ ]","Prev/next tab",
         "Alt+1–8","Select layer","Q W","Prev/next layer",
         "R","Randomize seed","A","Randomize all seeds",
         "D","Duplicate layer","H","Toggle enabled","C","Copy layer","V","Paste layer",
         "X","Reset layer","S","Solo/unsolo layer","Esc","Exit solo",
         "G","Transform gizmo","B","A/B compare","F","Fit zoom",
         "+ −","Zoom in/out","0","Zoom 100%",
         "Shift+B","Cycle blend mode",
         "2×click","Reset slider","Scroll","Nudge slider","R-click","Context menu"
        ].map(function(txt,i){
          return React.createElement("span",{key:i,style:{
            color:i%2===0?"#e8900a":"#666",
            fontFamily:"monospace",
            fontWeight:i%2===0?"700":"400",
            fontSize:i%2===0?10:9
          }},txt);
        })
      )
    )
  );
}

// ═══ SPRITE PANEL ═══════════════════════════════════════════════
function SpritePanel(p){
  var state=p.state,setS=p.setS,copyLayersToSlot=p.copyLayersToSlot;
  var sc=["#e8900a","#4ab4ff","#a0e060","#ff6699"];
  return React.createElement("div",null,
    React.createElement(SHead,{color:"#ff6699"},"⊞ Spritesheet 2×2"),
    React.createElement("div",{style:{fontSize:8,color:"#444",lineHeight:1.6,marginBottom:12}},"Pack 4 independent textures into a single atlas. Useful for flipbook VFX, material channels, or Illugen-style channel-packed maps."),
    React.createElement(Tog,{label:"Spritesheet Mode",value:!!state.spritesheetMode,onChange:function(v){setS("spritesheetMode",v);}}),
    state.spritesheetMode?React.createElement("div",null,
      React.createElement(Sep,null),
      React.createElement("div",{style:{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:12}},
        ["1","2","3","4"].map(function(lbl,i){
          var act=state.activeSlotIdx===i;
          return React.createElement("div",{key:i,onClick:function(){setS("activeSlotIdx",i);},style:{padding:"12px 8px",textAlign:"center",cursor:"pointer",background:act?"#1e1e1e":"#141414",border:"2px solid "+(act?sc[i]:"#252525"),borderRadius:4,transition:"all 0.12s"}},
            React.createElement("div",{style:{fontSize:20,fontWeight:700,color:act?sc[i]:"#444",marginBottom:4}},lbl),
            React.createElement("div",{style:{fontSize:9,color:"#555"}},state.slots[i].layers.length+" layer"+(state.slots[i].layers.length!==1?"s":"")),
            act?React.createElement("div",{style:{fontSize:8,color:sc[i],marginTop:3,letterSpacing:1}},"● ACTIVE"):null
          );
        })
      ),
      React.createElement("div",{style:{display:"flex",gap:6}},
        React.createElement("button",{onClick:function(){copyLayersToSlot(state.activeSlotIdx);},style:{flex:1,padding:"7px",background:"#161616",border:"1px solid #282828",color:"#888",fontFamily:"monospace",fontSize:10,cursor:"pointer",borderRadius:3}},"Copy main→slot"),
        React.createElement("button",{onClick:function(){var ns=state.slots.slice();ns[state.activeSlotIdx]=mkSlot(state.activeSlotIdx,Math.random()*99999|0);setS("slots",ns);},style:{flex:1,padding:"7px",background:"#161616",border:"1px solid #282828",color:"#666",fontFamily:"monospace",fontSize:10,cursor:"pointer",borderRadius:3}},"Reset slot")
      ),
      React.createElement(Sep,null),
      // ── Channel-packed export: slot N -> channel N ──
      React.createElement("div",{style:{fontSize:8,color:"#555",lineHeight:1.6,marginBottom:8}},
        "Channel packing: exports the 4 slots as ONE texture at full resolution — slot 1 luminance → ",
        React.createElement("span",{style:{color:"#ff6666"}},"R"),", slot 2 → ",
        React.createElement("span",{style:{color:"#66dd66"}},"G"),", slot 3 → ",
        React.createElement("span",{style:{color:"#4ab4ff"}},"B"),", slot 4 → ",
        React.createElement("span",{style:{color:"#cc88ff"}},"A"),
        ". The standard packed-mask workflow for shader channels (erosion, dissolve, detail, alpha)."),
      React.createElement("button",{onClick:function(){p.onExportPacked&&p.onExportPacked();},
        style:{width:"100%",padding:"9px 0",background:"#ff6699",border:"none",color:"#000",
          fontFamily:"monospace",fontSize:11,fontWeight:700,cursor:"pointer",borderRadius:4,letterSpacing:1}},
        "↓ Export Packed RGBA ("+(state.exportSize||512)+"px)")
    ):null
  );
}

// ═══ FAVORITES PANEL ════════════════════════════════════════════
// A curated quick-edit panel: user pins any (layer, param) combos
var FAV_PARAMS=[
  {id:"scaleX",    label:"Scale X",        min:0.05,max:32,  step:0.05},
  {id:"scaleY",    label:"Scale Y",        min:0.05,max:32,  step:0.05},
  {id:"offsetX",   label:"Offset X",       min:-2,  max:2,   step:0.01},
  {id:"offsetY",   label:"Offset Y",       min:-2,  max:2,   step:0.01},
  {id:"rotation",  label:"Rotation",       min:-360,max:360, step:1},
  {id:"seed",      label:"Seed",           min:1,   max:99999,step:1},
  {id:"contrast",  label:"Contrast",       min:0.01,max:8,   step:0.05},
  {id:"brightness",label:"Brightness",     min:-1,  max:2,   step:0.01},
  {id:"multiplier",label:"Multiplier",     min:0,   max:20,  step:0.05},
  {id:"midpoint",  label:"Midpoint",       min:0.01,max:0.99,step:0.01},
  {id:"remapIn0",  label:"Remap Lo",       min:-0.5,max:1,   step:0.01},
  {id:"remapIn1",  label:"Remap Hi",       min:0,   max:1.5, step:0.01},
  {id:"outputLo",  label:"Output Lo",      min:-0.5,max:1,   step:0.01},
  {id:"outputHi",  label:"Output Hi",      min:0,   max:1.5, step:0.01},
  {id:"opacity",   label:"Opacity",        min:0,   max:1,   step:0.01},
  {id:"saturation",label:"Saturation",     min:0,   max:4,   step:0.02},
  {id:"hueShift",  label:"Hue Shift",      min:-180,max:180, step:1},
  {id:"layerBlur", label:"Layer Blur",     min:0,   max:20,  step:0.5},
  {id:"layerGlow", label:"Layer Glow",     min:0,   max:20,  step:0.5},
  {id:"warpStr",   label:"Warp Strength",  min:0.1, max:8,   step:0.05},
  {id:"octaves",   label:"Octaves",        min:1,   max:12,  step:1},
  {id:"gain",      label:"Roughness(gain)",min:0.1, max:0.9, step:0.01},
  {id:"lacunarity",label:"Lacunarity",     min:1,   max:6,   step:0.05},
  {id:"woodRings", label:"Wood Rings",     min:1,   max:40,  step:0.5},
  {id:"woodTurb",  label:"Wood Turbulence",min:0,   max:6,   step:0.05},
  {id:"marbleFreq",label:"Marble Freq",    min:0.5, max:12,  step:0.1},
  {id:"marbleTurb",label:"Marble Turb",    min:0,   max:12,  step:0.1},
  {id:"curlScale", label:"Curl Scale",     min:0.5, max:30,  step:0.5},
  {id:"gaborFreq", label:"Gabor Frequency",min:2,   max:40,  step:0.5},
];

function FavoritesPanel(p){
  var favs=p.favorites||[];
  var setFavs=p.setFavs;
  var layers=p.layers;
  var updL=p.updL;
  var addFavParam=p.addFavParam;var setAddFavParam=p.setAddFavParam;
  var addFavLayer=p.addFavLayer;var setAddFavLayer=p.setAddFavLayer;

  function rem(i){var nf=favs.slice();nf.splice(i,1);setFavs(nf);}

  return React.createElement("div",null,
    React.createElement(SHead,{color:"#ffdd44"},"★ Favorites"),
    React.createElement("div",{style:{fontSize:8,color:"#444",marginBottom:10,lineHeight:1.6}},
      "Pin any parameter for quick access. Changes here update the layer in real-time."
    ),
    // Add new favorite
    React.createElement("div",{style:{background:"#141414",border:"1px solid #1e1e1e",borderRadius:4,padding:8,marginBottom:12}},
      React.createElement("span",{style:{fontSize:8,color:"#555",textTransform:"uppercase",letterSpacing:1,display:"block",marginBottom:6}},"Pin parameter"),
      React.createElement("div",{style:{display:"flex",gap:5,marginBottom:5}},
        React.createElement("select",{value:addFavLayer,onChange:function(e){setAddFavLayer(parseInt(e.target.value));},style:Object.assign({},SS,{flex:1,marginBottom:0})},
          layers.map(function(l,i){return React.createElement("option",{key:i,value:i},l.label||"L"+(i+1));})
        ),
        React.createElement("select",{value:addFavParam,onChange:function(e){setAddFavParam(e.target.value);},style:Object.assign({},SS,{flex:2,marginBottom:0})},
          FAV_PARAMS.map(function(pr){return React.createElement("option",{key:pr.id,value:pr.id},pr.label);})
        )
      ),
      React.createElement("button",{onClick:function(){
        var def=FAV_PARAMS.find(function(x){return x.id===addFavParam;})||FAV_PARAMS[0];
        var label=(layers[addFavLayer]?layers[addFavLayer].label||"L"+(addFavLayer+1):"L1")+" / "+def.label;
        // Avoid duplicate
        var exists=favs.some(function(f){return f.layerIdx===addFavLayer&&f.param===addFavParam;});
        if(!exists)setFavs(favs.concat([{layerIdx:addFavLayer,param:addFavParam,label:label}]));
      },style:{width:"100%",padding:"6px",background:"#ffdd44",border:"none",color:"#000",fontFamily:"monospace",fontSize:10,fontWeight:700,cursor:"pointer",borderRadius:3}},"★ Pin")
    ),
    // Favorites list
    favs.length===0?React.createElement("div",{style:{fontSize:9,color:"#333",textAlign:"center",padding:20}},"No favorites yet. Pin parameters above."):null,
    favs.map(function(fav,i){
      var layer=layers[fav.layerIdx];
      if(!layer)return null;
      var def=FAV_PARAMS.find(function(x){return x.id===fav.param;})||{id:fav.param,label:fav.param,min:0,max:1,step:0.01};
      var val=layer[def.id];
      if(val==null)val=(def.min+def.max)*0.5;
      return React.createElement("div",{key:i,style:{background:"#141414",border:"1px solid #1e1e1e",borderRadius:4,padding:"8px 10px",marginBottom:6}},
        React.createElement("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}},
          React.createElement("span",{style:{fontSize:9,color:"#ffdd44",fontFamily:"monospace"}},fav.label),
          React.createElement(SmBtn,{onClick:function(){rem(i);}},"✕")
        ),
        React.createElement("div",{style:{display:"flex",gap:6,alignItems:"center"}},
          React.createElement("input",{type:"range",min:def.min,max:def.max,step:def.step,value:val,
            onChange:function(e){updL(fav.layerIdx,def.id,parseFloat(e.target.value));},
            style:{flex:1,accentColor:"#ffdd44",height:3,cursor:"pointer"}}),
          React.createElement("span",{style:{fontSize:10,color:"#ffdd44",fontFamily:"monospace",minWidth:36,textAlign:"right"}},
            def.step>=1?Math.round(val):val.toFixed(2))
        )
      );
    })
  );
}

// ═══ ANIMATABLE PARAMS ══════════════════════════════════════════
var ANIM_PARAMS=[
  // UV Transform
  {id:"offsetX",     label:"Offset X",       min:-2,   max:2,    step:0.01,  group:"UV"},
  {id:"offsetY",     label:"Offset Y",       min:-2,   max:2,    step:0.01,  group:"UV"},
  {id:"rotation",    label:"Rotation",       min:-360, max:360,  step:1,     group:"UV"},
  {id:"scaleX",      label:"Scale X",        min:0.1,  max:32,   step:0.05,  group:"UV"},
  {id:"scaleY",      label:"Scale Y",        min:0.1,  max:32,   step:0.05,  group:"UV"},
  // Noise
  {id:"octaves",     label:"Octaves",        min:1,    max:12,   step:1,     group:"Noise"},
  {id:"gain",        label:"Roughness",      min:0.1,  max:0.9,  step:0.01,  group:"Noise"},
  {id:"lacunarity",  label:"Lacunarity",     min:1,    max:6,    step:0.05,  group:"Noise"},
  {id:"warpStr",     label:"Warp Strength",  min:0.1,  max:8,    step:0.05,  group:"Noise"},
  {id:"curlScale",   label:"Curl Scale",     min:0.5,  max:30,   step:0.5,   group:"Noise"},
  {id:"woodRings",   label:"Wood Rings",     min:1,    max:40,   step:0.5,   group:"Noise"},
  {id:"woodTurb",    label:"Wood Turbulence",min:0,    max:6,    step:0.05,  group:"Noise"},
  {id:"marbleFreq",  label:"Marble Freq",    min:0.5,  max:12,   step:0.1,   group:"Noise"},
  {id:"marbleTurb",  label:"Marble Turb",    min:0,    max:12,   step:0.1,   group:"Noise"},
  {id:"gaborFreq",   label:"Gabor Freq",     min:2,    max:40,   step:0.5,   group:"Noise"},
  // Adjust
  {id:"contrast",    label:"Contrast",       min:0.01, max:8,    step:0.05,  group:"Adjust"},
  {id:"brightness",  label:"Brightness",     min:-1,   max:2,    step:0.01,  group:"Adjust"},
  {id:"multiplier",  label:"Multiplier",     min:0,    max:20,   step:0.05,  group:"Adjust"},
  {id:"midpoint",    label:"Midpoint",       min:0.01, max:0.99, step:0.01,  group:"Adjust"},
  {id:"outputLo",    label:"Output Lo",      min:-0.5, max:1,    step:0.01,  group:"Adjust"},
  {id:"outputHi",    label:"Output Hi",      min:0,    max:1.5,  step:0.01,  group:"Adjust"},
  {id:"remapIn0",    label:"Remap Lo",       min:-0.5, max:1,    step:0.01,  group:"Adjust"},
  {id:"remapIn1",    label:"Remap Hi",       min:0,    max:1.5,  step:0.01,  group:"Adjust"},
  {id:"hueShift",    label:"Hue Shift",      min:-180, max:180,  step:1,     group:"Adjust"},
  {id:"saturation",  label:"Saturation",     min:0,    max:4,    step:0.02,  group:"Adjust"},
  {id:"steps",       label:"Steps",          min:0,    max:32,   step:1,     group:"Adjust"},
  // FX
  {id:"layerBlur",   label:"Layer Blur",     min:0,    max:20,   step:0.5,   group:"FX"},
  {id:"layerGlow",   label:"Layer Glow",     min:0,    max:20,   step:0.5,   group:"FX"},
  {id:"layerGlowIntensity",label:"Glow Intensity",min:0,max:3,  step:0.02,  group:"FX"},
  {id:"opacity",     label:"Opacity",        min:0,    max:1,    step:0.01,  group:"FX"},
  // Post-transform (animatable)
  {id:"postTX",      label:"Post Translate X", min:-1,   max:1,    step:0.005, group:"Post"},
  {id:"postTY",      label:"Post Translate Y", min:-1,   max:1,    step:0.005, group:"Post"},
  {id:"postSX",      label:"Post Scale X",     min:0.05, max:4,    step:0.01,  group:"Post"},
  {id:"postSY",      label:"Post Scale Y",     min:0.05, max:4,    step:0.01,  group:"Post"},
  {id:"postRot",     label:"Post Rotation",    min:-180, max:180,  step:0.5,   group:"Post"},
  // UV Distortion slots
  {id:"uvDist0amt",  label:"UV Dist 1 Amount",min:0,  max:5,    step:0.02,  group:"UV Dist"},
  {id:"uvDist0freq", label:"UV Dist 1 Freq",  min:0.5,max:16,   step:0.1,   group:"UV Dist"},
  {id:"uvDist1amt",  label:"UV Dist 2 Amount",min:0,  max:5,    step:0.02,  group:"UV Dist"},
  {id:"uvDist1freq", label:"UV Dist 2 Freq",  min:0.5,max:16,   step:0.1,   group:"UV Dist"},
  {id:"uvDist2amt",  label:"UV Dist 3 Amount",min:0,  max:5,    step:0.02,  group:"UV Dist"},
  // Directional / Wave / Stroke
  {id:"fiberAngle",  label:"Fiber Angle",      min:-180, max:180,  step:1,     group:"Directional"},
  {id:"fiberStretch",label:"Fiber Stretch",    min:1,    max:40,   step:0.5,   group:"Directional"},
  {id:"waveFreq",    label:"Wave Freq/Bands",  min:1,    max:32,   step:0.5,   group:"Directional"},
  {id:"waveAmp",     label:"Wave Amplitude",   min:0,    max:0.5,  step:0.005, group:"Directional"},
  {id:"waveWarp",    label:"Wave Warp",        min:0,    max:3,    step:0.02,  group:"Directional"},
  {id:"waveThick",   label:"Wave Thickness",   min:0.002,max:0.5,  step:0.002, group:"Directional"},
  {id:"waveOffset",  label:"Wave Offset",      min:-0.5, max:0.5,  step:0.005, group:"Directional"},
  {id:"streakLength",label:"Streak Length",    min:1,    max:30,   step:0.5,   group:"Directional"},
  {id:"streakDensity",label:"Streak Density",  min:0.5,  max:20,   step:0.5,   group:"Directional"},
  // Radial / Transform
  {id:"radialAngleOffset",label:"Radial Angle",min:-180,max:180,  step:1,     group:"UV"},
  {id:"radialRadius",label:"Ring Radius",      min:0,    max:0.5,  step:0.005, group:"UV"},
  {id:"radialCount", label:"Radial Count",     min:2,    max:24,   step:1,     group:"UV"},
  {id:"skewX",       label:"Skew X",           min:-2,   max:2,    step:0.02,  group:"UV"},
  {id:"skewY",       label:"Skew Y",           min:-2,   max:2,    step:0.02,  group:"UV"},
];

// Fast lookup set for animatable params
var ANIM_PARAM_SET={};
(function(){ANIM_PARAMS.forEach(function(p){ANIM_PARAM_SET[p.id]=true;});})();

// ═══ AUTO-ANIMATE PRESETS ════════════════════════════════════
var AUTO_PRESETS=[
  // Visibility
  {id:"fadeIn",      label:"Fade In",        group:"Visibility", tracks:[{param:"opacity",from:0,to:1}]},
  {id:"fadeOut",     label:"Fade Out",       group:"Visibility", tracks:[{param:"opacity",from:1,to:0}]},
  {id:"blurIn",      label:"Unblur",         group:"Visibility", tracks:[{param:"layerBlur",from:12,to:0}]},
  {id:"blurOut",     label:"Blur Out",       group:"Visibility", tracks:[{param:"layerBlur",from:0,to:12}]},
  {id:"dissolve",    label:"Dissolve",       group:"Visibility", tracks:[{param:"opacity",from:1,to:0},{param:"steps",from:0,to:16}]},
  // Motion
  {id:"scrollH",     label:"Scroll →",       group:"Motion", tracks:[{param:"offsetX",from:0,to:1}]},
  {id:"scrollV",     label:"Scroll ↓",       group:"Motion", tracks:[{param:"offsetY",from:0,to:1}]},
  {id:"scrollDiag",  label:"Scroll ↘",       group:"Motion", tracks:[{param:"offsetX",from:0,to:1},{param:"offsetY",from:0,to:0.5}]},
  {id:"spin",        label:"Spin",           group:"Motion", tracks:[{param:"rotation",from:0,to:360}]},
  {id:"postDrift",   label:"Drift (Post)",   group:"Motion", tracks:[{param:"postTX",from:-0.3,to:0.3},{param:"postTY",from:0,to:0.15}]},
  {id:"postSpin",    label:"Post Spin",      group:"Motion", tracks:[{param:"postRot",from:0,to:360}]},
  // Scale — scaleX animates uniformly when Scale Linked is on (default).
  // Use Post Scale for independent X/Y.
  {id:"zoomIn",      label:"Zoom In",        group:"Scale", tracks:[{param:"scaleX",from:2,to:8}]},
  {id:"zoomOut",     label:"Zoom Out",       group:"Scale", tracks:[{param:"scaleX",from:8,to:2}]},
  {id:"postZoomIn",  label:"Post Zoom In",   group:"Scale", tracks:[{param:"postSX",from:1,to:1.8},{param:"postSY",from:1,to:1.8}]},
  {id:"postZoomOut", label:"Post Zoom Out",  group:"Scale", tracks:[{param:"postSX",from:1.8,to:1},{param:"postSY",from:1.8,to:1}]},
  {id:"squishX",     label:"Squish X",       group:"Scale", tracks:[{param:"postSX",from:1,to:0.4}]},
  {id:"squishY",     label:"Squish Y",       group:"Scale", tracks:[{param:"postSY",from:1,to:0.4}]},
  // Noise
  {id:"warpBuild",   label:"Warp Build",     group:"Noise", tracks:[{param:"warpStr",from:0,to:4}]},
  {id:"noiseEvolve", label:"Noise Evolve",   group:"Noise", tracks:[{param:"lacunarity",from:1.2,to:5},{param:"octaves",from:2,to:10}]},
  {id:"curlBuild",   label:"Curl Build",     group:"Noise", tracks:[{param:"curlScale",from:1,to:20}]},
  {id:"warpScroll",  label:"Warp + Scroll",  group:"Noise", tracks:[{param:"warpStr",from:0.5,to:3},{param:"offsetX",from:0,to:1}]},
  // UV Distortion
  {id:"uvAmt1",      label:"Dist 1 Amount",  group:"UV Dist", tracks:[{param:"uvDist0amt",from:0,to:2}]},
  {id:"uvFreq1",     label:"Dist 1 Freq",    group:"UV Dist", tracks:[{param:"uvDist0freq",from:1,to:10}]},
  {id:"uvAmt2",      label:"Dist 2 Amount",  group:"UV Dist", tracks:[{param:"uvDist1amt",from:0,to:2}]},
  {id:"uvFreq2",     label:"Dist 2 Freq",    group:"UV Dist", tracks:[{param:"uvDist1freq",from:1,to:10}]},
  {id:"uvSwirl",     label:"Swirl + Freq",   group:"UV Dist", tracks:[{param:"uvDist0amt",from:0,to:1.5},{param:"uvDist0freq",from:2,to:8}]},
  // Tone
  {id:"contrastPop", label:"Contrast Pop",   group:"Tone", tracks:[{param:"contrast",from:0.3,to:4}]},
  {id:"brighten",    label:"Brighten",       group:"Tone", tracks:[{param:"brightness",from:0,to:0.8}]},
  {id:"glowBuild",   label:"Glow Build",     group:"Tone", tracks:[{param:"layerGlow",from:0,to:10},{param:"layerGlowIntensity",from:0.3,to:2.5}]},
  {id:"remapWipe",   label:"Remap Wipe",     group:"Tone", tracks:[{param:"remapIn0",from:0,to:0.95}]},
  {id:"multPulse",   label:"Multiplier +",   group:"Tone", tracks:[{param:"multiplier",from:0,to:2}]},
  // Color
  {id:"hueRotate",   label:"Hue Rotate",     group:"Color", tracks:[{param:"hueShift",from:-180,to:180}]},
  {id:"saturate",    label:"Saturate",       group:"Color", tracks:[{param:"saturation",from:0,to:3}]},
  {id:"desaturate",  label:"Desaturate",     group:"Color", tracks:[{param:"saturation",from:1,to:0}]},
  // Style
  {id:"posterize",   label:"Posterize",      group:"Style", tracks:[{param:"steps",from:0,to:16}]},
  {id:"posterFade",  label:"Poster Fade",    group:"Style", tracks:[{param:"steps",from:16,to:0},{param:"opacity",from:0.5,to:1}]},
  {id:"sharpFade",   label:"Sharp Fade",     group:"Style", tracks:[{param:"multiplier",from:2,to:0},{param:"contrast",from:3,to:1}]},
];

// Flipbook grid layouts
var FB_GRIDS=[
  {label:"4 frames (2×2)",  frames:4,  cols:2},
  {label:"8 frames (4×2)",  frames:8,  cols:4},
  {label:"16 frames (4×4)", frames:16, cols:4},
  {label:"32 frames (8×4)", frames:32, cols:8},
  {label:"49 frames (7×7)", frames:49, cols:7},
  {label:"64 frames (8×8)", frames:64, cols:8},
  {label:"81 frames (9×9)", frames:81, cols:9},
];

// Build a state for frame t (0=start, 1=end)
function buildFrameState(baseState,anim,t){
  // Apply global retiming curve first (remaps 0..1 → 0..1)
  if(anim.timingCurve&&!isCurveIdentity(anim.timingCurve)){
    var gLUT=evalCurveLUT(anim.timingCurve.slice().sort(function(a,b){return a.x-b.x;}),anim.timingCurveMode||"smooth");
    t=gLUT[Math.min(255,Math.floor(t*255))];
  }
  // Clone state without imageData (base64 is huge, JSON clone is slow)
  var imgDataMap={};
  (baseState.layers||[]).forEach(function(L,i){if(L.imageData)imgDataMap[i]=L.imageData;});
  // Collect slot imageData before stripping (slots were previously never restored)
  var slotImgMap={};
  (baseState.slots||[]).forEach(function(sl,si2){
    (sl.layers||[]).forEach(function(L,li){
      if(L.imageData){if(!slotImgMap[si2])slotImgMap[si2]={};slotImgMap[si2][li]=L.imageData;}
    });
  });
  var lean=Object.assign({},baseState,{
    layers:(baseState.layers||[]).map(function(L){return L.imageData?Object.assign({},L,{imageData:null}):L;}),
    slots:(baseState.slots||[]).map(function(sl){return Object.assign({},sl,{layers:(sl.layers||[]).map(function(L){return L.imageData?Object.assign({},L,{imageData:null}):L;})});})
  });
  var newState=JSON.parse(JSON.stringify(lean));
  (newState.layers||[]).forEach(function(L,i){if(imgDataMap[i])L.imageData=imgDataMap[i];});
  // Restore slot imageData references
  (newState.slots||[]).forEach(function(sl,si2){
    if(slotImgMap[si2])(sl.layers||[]).forEach(function(L,li){if(slotImgMap[si2][li])L.imageData=slotImgMap[si2][li];});
  });
  var tracks=anim.tracks||[];
  var layers=newState.layers;
  tracks.forEach(function(track){
    // Apply per-track easing curve
    var easedT=t;
    if(track.timingCurve&&!isCurveIdentity(track.timingCurve)){
      var tcLUT=evalCurveLUT(track.timingCurve.slice().sort(function(a,b){return a.x-b.x;}),track.timingCurveMode||"smooth");
      easedT=tcLUT[Math.min(255,Math.floor(t*255))];
    }
    // Global track: layerIdx===-1 → apply to all layers
    var targetLayers=track.layerIdx===-1?layers.map(function(_,idx){return idx;}):[track.layerIdx!=null?track.layerIdx:0];
    targetLayers.forEach(function(li){
      if(!layers[li])return;
      var from=track.from!=null?track.from:(layers[li][track.param]||0);
      var to=track.to!=null?track.to:from;
      var val;
      if(track.layerIdx===-1&&track.globalMode==="relative"){
        // Relative mode: add lerped delta to each layer's base value
        var base=layers[li][track.param]!=null?layers[li][track.param]:0;
        val=base+lerp(0,to-from,easedT);
      } else {
        val=lerp(from,to,easedT);
      }
      var uvDistMatch=track.param.match(/^uvDist(\d+)(amt|freq)$/);
      if(uvDistMatch){
        var dIdx=parseInt(uvDistMatch[1]),dProp=uvDistMatch[2];
        if(layers[li].uvDists&&layers[li].uvDists[dIdx])layers[li].uvDists[dIdx][dProp]=val;
      } else {
        layers[li][track.param]=val;
      }
    });
  });
  return newState;
}

// Render single frame buffer at given size
function renderFrameBuf(frameState,size){
  var buf=new Float32Array(size*size*4);
  for(var _ai=3;_ai<buf.length;_ai+=4)buf[_ai]=1;
  renderLayersToBuf(buf,size,resolveReferences(frameState.layers),null,frameState.globalLayerFilters||[]);
  var blurR=frameState.blurRadius||0;
  if(blurR>=1)gaussBlur(buf,size,size,Math.max(1,Math.round(blurR)));
  if((frameState.glowRadius||0)>0)applyGlow(buf,size,frameState.glowRadius,frameState.glowIntensity||0.5,{threshold:frameState.glowThreshold||0,tintR:frameState.glowTintR!=null?frameState.glowTintR:1,tintG:frameState.glowTintG!=null?frameState.glowTintG:1,tintB:frameState.glowTintB!=null?frameState.glowTintB:1,blend:frameState.glowBlend||"add"});
  applyGlobalAdjust(buf,size,frameState); // global tone/color after glow
  applyGlobalFiltersPost(buf,size,frameState.globalLayerFilters||[]); // global FX after glow
  if(frameState.filters&&frameState.filters.length)frameState.filters.forEach(function(f){applyFilter(buf,size,f);});
  applyMaskToBuf(buf,size,frameState.mask); // mask LAST
  return buf;
}

// Export flipbook: renders N frames, packs into cols×rows atlas
function exportFlipbook(baseState,anim,grid,frameSize){
  return new Promise(function(resolve){
    var frames=grid.frames,cols=grid.cols,rows=Math.ceil(frames/cols);
    var atlasW=cols*frameSize,atlasH=rows*frameSize;
    var atlas=new Uint8ClampedArray(atlasW*atlasH*4);
    for(var f=0;f<frames;f++){
      var t=frames>1?f/(frames-1):0;
      var frameState=buildFrameState(baseState,anim,t);
      var buf=renderFrameBuf(frameState,frameSize);
      var doSRGB=baseState.colorSpace==="srgb";
      var col=f%cols,row=Math.floor(f/cols);
      var ox=col*frameSize,oy=row*frameSize;
      for(var py=0;py<frameSize;py++)for(var px=0;px<frameSize;px++){
        var src=(py*frameSize+px)*4;
        var dst=((oy+py)*atlasW+(ox+px))*4;
        var r=clamp(buf[src]),g=clamp(buf[src+1]),b=clamp(buf[src+2]),a=clamp(buf[src+3]);
        if(doSRGB){r=toSRGB(r);g=toSRGB(g);b=toSRGB(b);}
        atlas[dst]=r*255+0.5|0;atlas[dst+1]=g*255+0.5|0;atlas[dst+2]=b*255+0.5|0;atlas[dst+3]=a*255+0.5|0;
      }
    }
    var c=document.createElement("canvas");c.width=atlasW;c.height=atlasH;
    var ctx=c.getContext("2d");
    var imgData=ctx.createImageData(atlasW,atlasH);
    for(var i=0;i<atlas.length;i++)imgData.data[i]=atlas[i];
    ctx.putImageData(imgData,0,0);
    resolve(c);
  });
}

// ── Flipbook Import UI (mobile-safe) ─────────────────────────────────────
// Uses a real file input rendered in JSX (no dynamic DOM, no window.prompt)
function ImportFlipbookUI(p){
  var fileRef=useRef(null);
  var _cols=useState(p.initialCols||8); var cols=_cols[0],setCols=_cols[1];
  var _rows=useState(p.initialRows||8); var rows=_rows[0],setRows=_rows[1];
  var _pending=useState(null); var pendingFile=_pending[0],setPendingFile=_pending[1];
  var _err=useState(""); var err=_err[0],setErr=_err[1];
  var compact=!!p.compact;

  function onFileChange(e){
    var f=e.target.files&&e.target.files[0];
    if(!f)return;
    setPendingFile(f);setErr("");
    // Reset input so same file can be re-selected
    e.target.value="";
  }

  function doImport(){
    if(!pendingFile){setErr("Select a file first.");return;}
    var c=Math.max(1,Math.min(32,Math.round(cols)||4));
    var r=Math.max(1,Math.min(32,Math.round(rows)||4));
    p.onImport(pendingFile,c,r);
    setPendingFile(null);
  }

  return React.createElement("div",{style:{background:compact?"#0e0e0e":"#141414",border:"1px dashed "+(compact?"#1e1e1e":"#2a2a2a"),borderRadius:4,padding:compact?8:12,marginBottom:10}},
    compact?null:React.createElement("div",{style:{fontSize:8,color:"#555",marginBottom:10,lineHeight:1.6}},
      "Import a sprite sheet to play it back with live post-processing. Filters apply per-frame."),
    // Grid size
    // Grid size with stepper buttons (mobile-friendly)
    React.createElement("div",{style:{marginBottom:10}},
      React.createElement("div",{style:{fontSize:7,color:"#555",marginBottom:6,textTransform:"uppercase",letterSpacing:1}},"Grid Layout"),
      React.createElement("div",{style:{display:"flex",gap:6,alignItems:"center"}},
        // Cols stepper
        React.createElement("div",{style:{flex:1,background:"#111",border:"1px solid #2a2a2a",borderRadius:4,padding:6}},
          React.createElement("div",{style:{fontSize:7,color:"#444",textAlign:"center",marginBottom:4}},"Columns"),
          React.createElement("div",{style:{display:"flex",alignItems:"center",justifyContent:"center",gap:6}},
            React.createElement("button",{onClick:function(){setCols(function(v){return Math.max(1,v-1);});},
              style:{width:32,height:32,background:"#1a1a1a",border:"1px solid #333",color:"#888",borderRadius:3,cursor:"pointer",fontSize:18,lineHeight:1,padding:0}},"-"),
            React.createElement("span",{style:{fontSize:18,fontFamily:"monospace",color:"#ccc",minWidth:28,textAlign:"center",fontWeight:700}},cols),
            React.createElement("button",{onClick:function(){setCols(function(v){return Math.min(32,v+1);});},
              style:{width:32,height:32,background:"#1a1a1a",border:"1px solid #333",color:"#888",borderRadius:3,cursor:"pointer",fontSize:18,lineHeight:1,padding:0}},"+")
          )
        ),
        React.createElement("span",{style:{color:"#333",fontSize:16,fontWeight:700}},"×"),
        // Rows stepper
        React.createElement("div",{style:{flex:1,background:"#111",border:"1px solid #2a2a2a",borderRadius:4,padding:6}},
          React.createElement("div",{style:{fontSize:7,color:"#444",textAlign:"center",marginBottom:4}},"Rows"),
          React.createElement("div",{style:{display:"flex",alignItems:"center",justifyContent:"center",gap:6}},
            React.createElement("button",{onClick:function(){setRows(function(v){return Math.max(1,v-1);});},
              style:{width:32,height:32,background:"#1a1a1a",border:"1px solid #333",color:"#888",borderRadius:3,cursor:"pointer",fontSize:18,lineHeight:1,padding:0}},"-"),
            React.createElement("span",{style:{fontSize:18,fontFamily:"monospace",color:"#ccc",minWidth:28,textAlign:"center",fontWeight:700}},rows),
            React.createElement("button",{onClick:function(){setRows(function(v){return Math.min(32,v+1);});},
              style:{width:32,height:32,background:"#1a1a1a",border:"1px solid #333",color:"#888",borderRadius:3,cursor:"pointer",fontSize:18,lineHeight:1,padding:0}},"+")
          )
        ),
        React.createElement("div",{style:{textAlign:"center",color:"#555",fontSize:8,fontFamily:"monospace",lineHeight:1.4}},
          React.createElement("span",{style:{display:"block",fontSize:14,color:"#888",fontWeight:700}},cols*rows),
          "frames")
      )
    ),
    // File selection — label-wrapped input + explicit ref.click() + drag & drop.
    // Three independent paths: in sandboxed iframes the label->picker can
    // silently fail, and drag & drop is the fallback that always works.
    React.createElement("div",{style:{marginBottom:8}},
      React.createElement("label",{style:{display:"block",cursor:"pointer"}},
        React.createElement("div",{
          onClick:function(e){
            // Explicit second path: programmatic click on the input.
            // preventDefault stops the label from double-triggering it.
            if(fileRef.current){e.preventDefault();fileRef.current.click();}
          },
          onDragOver:function(e){e.preventDefault();e.stopPropagation();},
          onDrop:function(e){
            e.preventDefault();e.stopPropagation();
            var f=e.dataTransfer&&e.dataTransfer.files&&e.dataTransfer.files[0];
            if(f){
              if(f.type&&f.type.indexOf("image/")!==0){setErr("Not an image file: "+(f.type||f.name));return;}
              setPendingFile(f);setErr("");
            }
          },
          style:{padding:"10px 12px",background:"#111",border:"2px dashed "+(pendingFile?"#ff9966":"#252525"),
          borderRadius:4,textAlign:"center",transition:"border-color 0.15s"}},
          React.createElement("div",{style:{fontSize:9,color:pendingFile?"#ff9966":"#444",fontFamily:"monospace",marginBottom:pendingFile?2:0}},
            pendingFile?"File: "+pendingFile.name:"Tap to select — or drag & drop the sheet here"),
          pendingFile?React.createElement("div",{style:{fontSize:7,color:"#555"}},
            "PNG or JPG · "+cols+"×"+rows+" grid · "+cols*rows+" frames"):null
        ),
        React.createElement("input",{ref:fileRef,type:"file",accept:"image/*",
          onChange:onFileChange,
          style:{position:"absolute",width:"1px",height:"1px",opacity:0,overflow:"hidden",clip:"rect(0,0,0,0)"}})
      )
    ),
    err?React.createElement("div",{style:{fontSize:8,color:"#ff6666",marginBottom:6}},err):null,
    React.createElement("button",{
      onClick:doImport,
      disabled:!pendingFile,
      style:{width:"100%",padding:"9px 0",background:pendingFile?"#ff9966":"#1a1a1a",
        border:"1px solid "+(pendingFile?"#ff9966":"#252525"),
        color:pendingFile?"#000":"#444",fontFamily:"monospace",fontSize:10,
        fontWeight:pendingFile?700:400,cursor:pendingFile?"pointer":"default",borderRadius:3}
    },pendingFile?"Import "+cols*rows+" Frames":"Select a file above")
  );
}

function AnimPanel(p){
  var anim=p.anim,setAnim=p.setAnim,layers=p.layers,state=p.state,exporting=p.exporting;
  var tracks=anim.tracks||[];
  var grid=FB_GRIDS[anim.gridIdx!=null?anim.gridIdx:2];
  var frameSize=anim.frameSize||128;
  var totalFrames=grid.frames;
  var fps=p.importedFB?(p.importedFB.fps||24):(anim.fps!=null?anim.fps:60);
  var fbSeq=p.importedFB?fbSequence(p.importedFB):null;
  var totalFramesActual=p.importedFB?Math.max(1,fbSeq.length):totalFrames;
  function setFps(v){setA("fps",Math.max(1,Math.min(240,v|0)));}

  // When flipbookInMain, use TexGen's lifted frame state; otherwise local state
  var _frame=useState(0); var localFrame=_frame[0],setLocalFrame=_frame[1];
  var _loopOv=useState(4); var loopOverlap=_loopOv[0],setLoopOverlap=_loopOv[1];
  var _loopBl=useState("linear"); var loopBlend=_loopBl[0],setLoopBlend=_loopBl[1];
  var _playing=useState(false); var localPlaying=_playing[0],setLocalPlaying=_playing[1];
  // Use TexGen's state if available (flipbookInMain), else local
  var frame=p.flipbookInMain&&p.animFrame!=null?p.animFrame:localFrame;
  var playing=p.flipbookInMain&&p.animPlaying!=null?p.animPlaying:localPlaying;
  function setFrame(v){if(p.flipbookInMain&&p.setAnimFrame)p.setAnimFrame(v);else setLocalFrame(v);}
  function setPlaying(v){if(p.flipbookInMain&&p.setAnimPlaying)p.setAnimPlaying(v);else setLocalPlaying(v);}

  var _showEase=useState(-1);   var showEaseTrack=_showEase[0],setShowEaseTrack=_showEase[1];
  var _showAuto=useState(false); var showAuto=_showAuto[0],setShowAuto=_showAuto[1];
  var _lastApplied=useState(null); var lastApplied=_lastApplied[0],setLastApplied=_lastApplied[1];
  var previewRef=useRef(null);
  var playTimer=useRef(null);
  var _grp=useState("All"); var filterGroup=_grp[0],setFilterGroup=_grp[1];

  // Render preview
  useEffect(function(){
    var cv=previewRef.current;if(!cv)return;
    // If imported flipbook is active, show the actual imported frame
    if(p.importedFB&&p.importedFB.frames){
      var ifbFrame=p.importedFB.frames[fbSeq.length?fbSeq[Math.min(frame,fbSeq.length-1)]:0];
      if(ifbFrame){
        var sz=128,fsz=p.importedFB.frameSize;
        cv.width=cv.height=sz;
        var ctx2=cv.getContext("2d"),img2=ctx2.createImageData(sz,sz);
        // Scale/resample from frameSize to 128
        for(var _py=0;_py<sz;_py++)for(var _px=0;_px<sz;_px++){
          var sx=Math.floor(_px*fsz/sz),sy=Math.floor(_py*fsz/sz);
          var si2=(sy*fsz+sx)*4,di=(_py*sz+_px)*4;
          img2.data[di  ]=clamp(ifbFrame[si2  ])*255+0.5|0;
          img2.data[di+1]=clamp(ifbFrame[si2+1])*255+0.5|0;
          img2.data[di+2]=clamp(ifbFrame[si2+2])*255+0.5|0;
          img2.data[di+3]=255;
        }
        ctx2.putImageData(img2,0,0);
        return;
      }
    }
    var sz=128,t=totalFrames>1?frame/(totalFrames-1):0;
    var fs=buildFrameState(state,anim,t);
    var buf=renderFrameBuf(fs,sz);
    cv.width=cv.height=sz;
    var ctx=cv.getContext("2d"),img=ctx.createImageData(sz,sz);
    var doSRGB=state.colorSpace==="srgb";
    for(var i=0;i<sz*sz;i++){
      var r=clamp(buf[i*4]),g=clamp(buf[i*4+1]),b=clamp(buf[i*4+2]),a=clamp(buf[i*4+3]);
      if(doSRGB){r=toSRGB(r);g=toSRGB(g);b=toSRGB(b);}
      img.data[i*4]=r*255+0.5|0;img.data[i*4+1]=g*255+0.5|0;img.data[i*4+2]=b*255+0.5|0;img.data[i*4+3]=a*255+0.5|0;
    }
    ctx.putImageData(img,0,0);
  },[frame,anim,state]);

  // Playback
  useEffect(function(){
    if(!playing){if(playTimer.current)clearInterval(playTimer.current);return;}
    playTimer.current=setInterval(function(){setFrame(function(f){return(f+1)%totalFramesActual;});},Math.round(1000/fps));
    return function(){clearInterval(playTimer.current);};
  },[playing,fps,totalFrames]);

  function setA(k,v){var n=Object.assign({},anim);n[k]=v;setAnim(n);}
  function addTrack(){setAnim(Object.assign({},anim,{tracks:tracks.concat([{layerIdx:0,param:"brightness",from:0,to:1,globalMode:"absolute",timingCurve:DEFAULT_CURVE.map(function(p2){return Object.assign({},p2);})}])}));}
  function updTrack(i,k,v){var nt=tracks.slice();nt[i]=Object.assign({},nt[i]);nt[i][k]=v;setAnim(Object.assign({},anim,{tracks:nt}));}
  function remTrack(i){var nt=tracks.slice();nt.splice(i,1);setAnim(Object.assign({},anim,{tracks:nt}));if(showEaseTrack===i)setShowEaseTrack(-1);}

  // Available param groups
  var groups=["All"].concat(Array.from(new Set(ANIM_PARAMS.map(function(x){return x.group||"Other";}))));
  var filteredParams=filterGroup==="All"?ANIM_PARAMS:ANIM_PARAMS.filter(function(x){return x.group===filterGroup;});

  var iconStyle={padding:"4px 8px",background:"none",border:"none",cursor:"pointer",fontFamily:"monospace",fontSize:11};

  return React.createElement("div",null,
    React.createElement(SHead,{color:"#ff9966"},"Flipbook Animation"),

    // ── IMPORT FLIPBOOK ──────────────────────────────────────
    p.importedFB?React.createElement("div",{style:{background:"#141414",border:"1px solid #2a1a00",borderRadius:4,padding:10,marginBottom:10}},
      React.createElement("div",{style:{marginBottom:8}},
        React.createElement("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}},
          React.createElement("span",{style:{fontSize:9,color:"#ff9966",fontFamily:"monospace",fontWeight:700}},
            p.importedFB.totalFrames+" frames · "+p.importedFB.frameSize+"px"),
          React.createElement("button",{onClick:function(){p.setImportedFB(null);},
            style:{padding:"3px 7px",background:"none",border:"1px solid #333",color:"#555",fontFamily:"monospace",fontSize:8,cursor:"pointer",borderRadius:3}},
            "Clear")
        ),
        // Re-slice controls — change grid after import
        React.createElement(ImportFlipbookUI,{
          onImport:p.importFlipbook,
          compact:true,
          initialCols:p.importedFB.cols,
          initialRows:p.importedFB.rows
        })
      ),
      // FPS for imported flipbook
      React.createElement("div",{style:{display:"flex",alignItems:"center",gap:8,marginBottom:8}},
        React.createElement("span",{style:{fontSize:8,color:"#555",minWidth:30}},"FPS"),
        React.createElement("input",{type:"range",min:1,max:120,step:1,
          value:p.importedFB.fps||24,
          onChange:function(e){p.setImportedFB(Object.assign({},p.importedFB,{fps:parseInt(e.target.value)}));},
          style:{flex:1,accentColor:"#ff9966",height:3,cursor:"pointer"}}),
        React.createElement("span",{title:"Playback speed in frames per second",style:{fontSize:9,color:"#ff9966",fontFamily:"monospace",minWidth:28}},
          (p.importedFB.fps||24)+"fps")
      ),
      // ── RETIMING ──────────────────────────────────────────
      React.createElement("div",{style:{marginBottom:8,padding:8,background:"#101010",border:"1px solid #221a10",borderRadius:4}},
        React.createElement("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}},
          React.createElement("span",{title:"Trim, resample and reorder the imported frames",style:{fontSize:8,color:"#888",textTransform:"uppercase",letterSpacing:1}},"Retiming"),
          React.createElement("span",{title:"Source frames → effective frames after retiming",style:{fontSize:8,color:"#ff9966",fontFamily:"monospace"}},
            p.importedFB.totalFrames+" src → "+totalFramesActual+" frames")
        ),
        // Trim range
        (function(){
          var _ri=p.importedFB.rangeIn!=null?p.importedFB.rangeIn:0;
          var _ro=p.importedFB.rangeOut!=null?p.importedFB.rangeOut:p.importedFB.totalFrames-1;
          function _setR(k,v){
            var nfb=Object.assign({},p.importedFB);nfb[k]=v;
            // keep in <= out
            if(nfb.rangeIn>nfb.rangeOut){if(k==="rangeIn")nfb.rangeOut=nfb.rangeIn;else nfb.rangeIn=nfb.rangeOut;}
            p.setImportedFB(nfb);setFrame(0);
          }
          return React.createElement("div",null,
            React.createElement("div",{style:{display:"flex",alignItems:"center",gap:8,marginBottom:4}},
              React.createElement("span",{title:"First source frame of the playback range",style:{fontSize:8,color:"#555",minWidth:30}},"In"),
              React.createElement("input",{title:"Trim: first frame to play",type:"range",min:0,max:p.importedFB.totalFrames-1,step:1,value:_ri,
                onChange:function(e){_setR("rangeIn",parseInt(e.target.value));},
                style:{flex:1,accentColor:"#4ab4ff",height:3,cursor:"pointer"}}),
              React.createElement("span",{style:{fontSize:9,color:"#4ab4ff",fontFamily:"monospace",minWidth:24,textAlign:"right"}},_ri)
            ),
            React.createElement("div",{style:{display:"flex",alignItems:"center",gap:8,marginBottom:6}},
              React.createElement("span",{title:"Last source frame of the playback range",style:{fontSize:8,color:"#555",minWidth:30}},"Out"),
              React.createElement("input",{title:"Trim: last frame to play",type:"range",min:0,max:p.importedFB.totalFrames-1,step:1,value:_ro,
                onChange:function(e){_setR("rangeOut",parseInt(e.target.value));},
                style:{flex:1,accentColor:"#a0e060",height:3,cursor:"pointer"}}),
              React.createElement("span",{style:{fontSize:9,color:"#a0e060",fontFamily:"monospace",minWidth:24,textAlign:"right"}},_ro)
            )
          );
        })(),
        // Frame step + play mode
        React.createElement("div",{style:{display:"flex",gap:6,alignItems:"center"}},
          React.createElement("span",{title:"Keep one frame every N: 2 halves the frame count",style:{fontSize:8,color:"#555"}},"Step"),
          [1,2,3,4].map(function(s){
            var act=(p.importedFB.frameStep||1)===s;
            return React.createElement("button",{key:s,title:"Keep 1 frame every "+s,
              onClick:function(){p.setImportedFB(Object.assign({},p.importedFB,{frameStep:s}));setFrame(0);},
              style:{padding:"3px 8px",fontSize:9,fontFamily:"monospace",background:act?"#ff9966":"#161616",
                color:act?"#000":"#555",border:"1px solid "+(act?"#ff9966":"#252525"),borderRadius:3,cursor:"pointer"}},s);
          }),
          React.createElement("div",{style:{flex:1}}),
          [{v:"forward",l:"→",tt:"Play forward"},{v:"reverse",l:"←",tt:"Play backward"},{v:"pingpong",l:"↔",tt:"Forward then backward (no duplicated endpoints)"}].map(function(md){
            var act=(p.importedFB.playMode||"forward")===md.v;
            return React.createElement("button",{key:md.v,title:md.tt,
              onClick:function(){p.setImportedFB(Object.assign({},p.importedFB,{playMode:md.v}));setFrame(0);},
              style:{padding:"3px 9px",fontSize:11,fontFamily:"monospace",background:act?"#ff9966":"#161616",
                color:act?"#000":"#555",border:"1px solid "+(act?"#ff9966":"#252525"),borderRadius:3,cursor:"pointer"}},md.l);
          })
        ),
        // ── Time remap curve — the same CurveEditor used everywhere else ──
        (function(){
          var tc=p.importedFB.timeCurve;
          return React.createElement("div",{style:{marginTop:8}},
            React.createElement("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}},
              React.createElement("span",{title:"Curve-based retiming: X = playback time, Y = source frame position",style:{fontSize:8,color:"#888",textTransform:"uppercase",letterSpacing:1}},"Time Remap"),
              tc?React.createElement("div",{style:{display:"flex",gap:4,flexWrap:"wrap",justifyContent:"flex-end"}},
                // Quick presets — tooltips describe the motion feel
                [["Linear",[{x:0,y:0},{x:1,y:1}],"Constant speed (identity)"],
                 ["Ease In",[{x:0,y:0},{x:0.6,y:0.25},{x:1,y:1}],"Starts slow, ends fast"],
                 ["Ease Out",[{x:0,y:0},{x:0.4,y:0.75},{x:1,y:1}],"Starts fast, ends slow"],
                 ["In-Out",[{x:0,y:0},{x:0.35,y:0.12},{x:0.65,y:0.88},{x:1,y:1}],"Slow at both ends, fast in the middle"],
                 ["Snap",[{x:0,y:0},{x:0.25,y:0.9},{x:1,y:1}],"Very fast start, then almost frozen"],
                 ["Hold End",[{x:0,y:0},{x:0.6,y:1},{x:1,y:1}],"Plays fully, then freezes on the last frame"],
                 ["Hold Start",[{x:0,y:0},{x:0.4,y:0},{x:1,y:1}],"Freezes on the first frame, then plays"],
                 ["Boomerang",[{x:0,y:0},{x:0.5,y:1},{x:1,y:0}],"Forward then backward in one cycle"]].map(function(pr){
                  return React.createElement("button",{key:pr[0],title:pr[2],
                    onClick:function(){p.setImportedFB(Object.assign({},p.importedFB,{timeCurve:pr[1]}));},
                    style:{fontSize:7,padding:"2px 6px",background:"#161616",border:"1px solid #252525",color:"#777",fontFamily:"monospace",borderRadius:3,cursor:"pointer"}},pr[0]);
                }).concat([
                  React.createElement("button",{key:"off",title:"Disable curve retiming (back to linear playback)",
                    onClick:function(){var nfb=Object.assign({},p.importedFB);nfb.timeCurve=null;p.setImportedFB(nfb);},
                    style:{fontSize:7,padding:"2px 6px",background:"#2a1414",border:"1px solid #3d1d1d",color:"#cc6666",fontFamily:"monospace",borderRadius:3,cursor:"pointer"}},"Off")
                ])
              ):null
            ),
            tc?React.createElement("div",null,
              React.createElement(CurveEditor,{
                points:tc,
                mode:p.importedFB.timeCurveMode||"smooth",
                onModeChange:function(m){p.setImportedFB(Object.assign({},p.importedFB,{timeCurveMode:m}));},
                onChange:function(pts){p.setImportedFB(Object.assign({},p.importedFB,{timeCurve:pts}));},
                size:140
              }),
              React.createElement("div",{style:{fontSize:7,color:"#555",lineHeight:1.5,marginTop:2}},
                "X = playback time, Y = source frame position. Flat segment = freeze frame, steep = fast-forward. Duration stays the same — also baked into Export.")
            ):React.createElement("button",{
              title:"Add a speed curve: reshape WHEN each source frame plays, duration unchanged",
              onClick:function(){p.setImportedFB(Object.assign({},p.importedFB,{timeCurve:[{x:0,y:0},{x:1,y:1}]}));},
              style:{width:"100%",padding:"6px 0",fontSize:9,fontFamily:"monospace",background:"#161616",border:"1px dashed #2a2a2a",color:"#777",borderRadius:3,cursor:"pointer"}},
              "+ Curve retiming (time remap)")
          );
        })()
      ),
      // Post-process filters
      React.createElement("div",{style:{marginBottom:6}},
        React.createElement("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}},
          React.createElement("span",{style:{fontSize:8,color:"#888",textTransform:"uppercase",letterSpacing:1}},"Post Filters (applied to each frame)"),
          React.createElement("button",{onClick:function(){p.setFbPostFilters([]);p.reprocessAll();},
            style:{fontSize:7,color:"#444",background:"none",border:"1px solid #252525",padding:"2px 5px",cursor:"pointer",borderRadius:2,fontFamily:"monospace"}},
            "Clear all")
        ),
        // Add filter buttons for post-processing
        [
          {group:"Blur",types:[{v:"directionalBlur",l:"Direction Blur"},{v:"radialBlur",l:"Radial Blur"},{v:"zoomBlur",l:"Zoom"},{v:"spinBlur",l:"Spin"},{v:"gaussBlur",l:"Gaussian"},{v:"boxBlur",l:"Box"}]},
          {group:"Adjust",types:[{v:"sharpen",l:"Sharpen"},{v:"emboss",l:"Emboss"},{v:"threshold",l:"Threshold"},{v:"posterize",l:"Posterize"},{v:"invert",l:"Invert"},{v:"grayscale",l:"Grayscale"}]},
          {group:"Color",types:[{v:"hueSat",l:"Hue/Sat"},{v:"brightCon",l:"Bright/Con"},{v:"tint",l:"Tint"}]},
          {group:"Pixel",types:[{v:"pixelize",l:"Pixelize"},{v:"quantize",l:"Quantize"}]},
          {group:"FX",types:[{v:"chromatic",l:"Chromatic"},{v:"fxaa",l:"FXAA"},{v:"edgeDetect",l:"Edge"},{v:"normalMap",l:"Normal"}]}
        ].map(function(grp){
          return React.createElement("div",{key:grp.group,style:{marginBottom:4}},
            React.createElement("div",{title:"Add a "+grp.group.toLowerCase()+" filter — applied to every frame",style:{display:"flex",flexWrap:"wrap",gap:2}},
              grp.types.map(function(ft){
                return React.createElement("button",{key:ft.v,
                  onClick:function(){
                    var nf=(p.fbPostFilters||[]).concat([mkFilter(ft.v)]);
                    p.setFbPostFilters(nf);p.reprocessAll();
                  },
                  style:{padding:"3px 6px",fontSize:7,fontFamily:"monospace",
                    background:"#111",border:"1px solid #222",color:"#888",
                    borderRadius:2,cursor:"pointer"}
                },"+ "+ft.l);
              })
            )
          );
        }),
        // Active post-filter list (with parameter editing)
        (p.fbPostFilters||[]).length>0?React.createElement("div",{style:{marginTop:6}},
          (p.fbPostFilters||[]).map(function(f,i){
            // Spec-driven param editor: [key,label,min,max,step] per filter type
            var _FBP={
              edgeDetect:[["strength","Strength",0.05,5,0.05]],
              sharpen:[["strength","Strength",0.05,5,0.05]],
              curvature:[["strength","Strength",0.05,5,0.05]],
              normalMap:[["strength","Strength",0.05,30,0.05]],
              emboss:[["strength","Strength",0.05,5,0.05],["angle","Angle",0,360,1]],
              bevel:[["strength","Strength",0.05,5,0.05],["blur","Blur",1,16,0.5]],
              posterize:[["levels","Levels",2,32,1]],
              threshold:[["cutoff","Cutoff",-0.5,1.5,0.01],["softness","Softness",0.001,0.5,0.005]],
              gaussBlur:[["blur","Radius",1,32,0.5]],
              boxBlur:[["blur","Radius",1,32,0.5]],
              radialBlur:[["amount","Amount",0.02,1,0.01],["samples","Samples",4,48,1],["centerX","Center X",0,1,0.01],["centerY","Center Y",0,1,0.01]],
              zoomBlur:[["amount","Amount",0.02,1,0.01],["samples","Samples",4,48,1],["centerX","Center X",0,1,0.01],["centerY","Center Y",0,1,0.01]],
              spinBlur:[["angle","Angle",1,90,1],["samples","Samples",4,48,1],["centerX","Center X",0,1,0.01],["centerY","Center Y",0,1,0.01]],
              pixelize:[["pixelSize","Pixel Size",2,64,1]],
              quantize:[["levels","Levels",2,32,1],["dither","Dither",0,1,0.01]],
              hueSat:[["hue","Hue",-180,180,1],["saturation","Saturation",0,2,0.01],["value","Value",0,2,0.01]],
              brightCon:[["brightness","Brightness",-1,1,0.01],["contrast","Contrast",0,3,0.01],["gamma","Gamma",0.25,4,0.01]],
              tint:[["tintR","Red",0,2,0.01],["tintG","Green",0,2,0.01],["tintB","Blue",0,2,0.01]],
              slopeBlur:[["amount","Amount",0.02,1,0.01],["samples","Samples",4,48,1]],
              directionalBlur:[["amount","Amount",0.02,1,0.01],["angle","Angle",0,360,1]],
              chromatic:[["amount","Amount",0.5,30,0.5]],
              fxaa:[["strength","Strength",0,1.5,0.01]]
            };
            var _fbParams=_FBP[f.type]||[];
            function _updP(k,v){var nf=p.fbPostFilters.slice();nf[i]=Object.assign({},nf[i]);nf[i][k]=v;p.setFbPostFilters(nf);p.reprocessAll();}
            return React.createElement("div",{key:i,style:{padding:"3px 0",borderBottom:"1px solid #1e1e1e"}},
            React.createElement("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"center"}},
              React.createElement("div",{style:{display:"flex",alignItems:"center",gap:6}},
                React.createElement("div",{title:f.enabled?"Disable this filter":"Enable this filter",
                  onClick:function(){var nf=p.fbPostFilters.slice();nf[i]=Object.assign({},nf[i],{enabled:!nf[i].enabled});p.setFbPostFilters(nf);p.reprocessAll();},
                  style:{width:22,height:12,borderRadius:6,background:f.enabled?"#e8900a":"#252525",cursor:"pointer",position:"relative",flexShrink:0},
                  children:[React.createElement("div",{style:{position:"absolute",width:10,height:10,borderRadius:5,background:"#fff",top:1,left:f.enabled?10:1,transition:"left 0.12s"}})]
                }),
                React.createElement("span",{style:{fontSize:8,color:"#888",fontFamily:"monospace"}},f.type)
              ),
              React.createElement("button",{title:"Remove this filter",onClick:function(){var nf=p.fbPostFilters.slice();nf.splice(i,1);p.setFbPostFilters(nf);p.reprocessAll();},
                style:{fontSize:9,color:"#444",background:"none",border:"none",cursor:"pointer"}},
                "x")
            ),
            // Parameter sliders for this filter — applied live to ALL frames
            f.enabled&&_fbParams.length?React.createElement("div",{style:{padding:"4px 0 2px 28px"}},
              _fbParams.map(function(pp){
                var key=pp[0],label=pp[1],mn=pp[2],mx=pp[3],st=pp[4];
                var val=f[key]!=null?f[key]:mn;
                return React.createElement("div",{key:key,style:{display:"flex",alignItems:"center",gap:6,marginBottom:3}},
                  React.createElement("span",{style:{fontSize:7,color:"#555",minWidth:46}},label),
                  React.createElement("input",{type:"range",min:mn,max:mx,step:st,value:val,
                    onChange:function(e){_updP(key,parseFloat(e.target.value));},
                    style:{flex:1,accentColor:"#e8900a",height:3,cursor:"pointer"}}),
                  React.createElement("span",{style:{fontSize:8,color:"#e8900a",fontFamily:"monospace",minWidth:30,textAlign:"right"}},
                    st>=1?Math.round(val):val.toFixed(2))
                );
              })
            ):null
            );
          })
        ):null
      ),
      // ── SEAMLESS LOOP ─────────────────────────────────────
      React.createElement("div",{style:{marginTop:8,padding:8,background:"#101010",border:"1px solid #10221a",borderRadius:4}},
        React.createElement("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}},
          React.createElement("span",{title:"Crossfade the tail into the head so the animation loops with no visible jump",
            style:{fontSize:8,color:"#888",textTransform:"uppercase",letterSpacing:1}},"Seamless Loop"),
          p.hasLoopBackup?React.createElement("button",{title:"Revert to the pre-loop frames",
            onClick:function(){p.onUndoLoop&&p.onUndoLoop();},
            style:{fontSize:7,padding:"2px 7px",background:"#2a1414",border:"1px solid #3d1d1d",color:"#cc6666",fontFamily:"monospace",borderRadius:3,cursor:"pointer"}},"Undo Loop"):null
        ),
        React.createElement("div",{style:{display:"flex",alignItems:"center",gap:8,marginBottom:6}},
          React.createElement("span",{title:"How many frames to crossfade. More = smoother loop but more frames consumed",style:{fontSize:8,color:"#555",minWidth:48}},"Overlap"),
          React.createElement("input",{type:"range",min:1,max:Math.max(2,Math.floor((p.importedFB.totalFrames-1)/2)),step:1,value:Math.min(loopOverlap,Math.floor((p.importedFB.totalFrames-1)/2)),
            onChange:function(e){setLoopOverlap(parseInt(e.target.value));},
            style:{flex:1,accentColor:"#44ddcc",height:3,cursor:"pointer"}}),
          React.createElement("span",{style:{fontSize:9,color:"#44ddcc",fontFamily:"monospace",minWidth:24,textAlign:"right"}},loopOverlap)
        ),
        // Blend mode for the tail→head crossfade
        React.createElement("div",{style:{display:"flex",alignItems:"center",gap:6,marginBottom:6}},
          React.createElement("span",{title:"How the overlapping frames are combined",style:{fontSize:8,color:"#555",minWidth:48}},"Blend"),
          [{v:"linear",l:"Linear",tt:"Straight dissolve — neutral baseline"},
           {v:"smooth",l:"Smooth",tt:"Eased dissolve — softer at both ends, less noticeable swap"},
           {v:"additive",l:"Additive",tt:"Weighted sum — keeps fire/spark brightness that a dissolve dips in the middle"}].map(function(bm){
            var act=loopBlend===bm.v;
            return React.createElement("button",{key:bm.v,title:bm.tt,
              onClick:function(){setLoopBlend(bm.v);},
              style:{flex:1,padding:"4px 0",fontSize:8,fontFamily:"monospace",background:act?"#44ddcc":"#161616",
                color:act?"#000":"#666",border:"1px solid "+(act?"#44ddcc":"#252525"),borderRadius:3,cursor:"pointer",fontWeight:act?700:400}},bm.l);
          })
        ),
        (function(){
          var tooFew=p.importedFB.totalFrames<4;
          var looped=!!p.hasLoopBackup;
          var disabled=tooFew||looped;
          var label=tooFew?"Need ≥ 4 frames":looped?"Loop active — Undo to redo":
            "Make Seamless Loop ("+p.importedFB.totalFrames+"→"+(p.importedFB.totalFrames-Math.min(loopOverlap,Math.floor((p.importedFB.totalFrames-1)/2)))+")";
          return React.createElement("button",{
            title:looped?"A loop is already applied. Press Undo Loop first to change the overlap.":"Blend the last "+loopOverlap+" frames over the first "+loopOverlap+" — output loses "+loopOverlap+" frames but loops seamlessly",
            onClick:function(){if(!disabled)p.onMakeLoop&&p.onMakeLoop(loopOverlap,loopBlend);},
            disabled:disabled,
            style:{width:"100%",padding:"7px 0",background:disabled?"#1a1a1a":"#44ddcc",border:"none",
              color:disabled?"#444":"#000",fontFamily:"monospace",fontSize:10,fontWeight:700,
              cursor:disabled?"default":"pointer",borderRadius:4,letterSpacing:1}},
            label);
        })()
      ),
      // ── EXPORT OPTIONS: resize + grid ─────────────────────
      React.createElement("div",{style:{marginTop:8,padding:8,background:"#101010",border:"1px solid #1a1a1a",borderRadius:4}},
        React.createElement("div",{style:{fontSize:8,color:"#888",textTransform:"uppercase",letterSpacing:1,marginBottom:6}},"Export Options"),
        React.createElement("div",{style:{display:"flex",alignItems:"center",gap:6,marginBottom:6}},
          React.createElement("span",{title:"Downscale each frame on export (box filter)",style:{fontSize:8,color:"#555",minWidth:40}},"Scale"),
          [["1","Native"],["0.5","½"],["0.25","¼"]].map(function(sc){
            var act=(p.importedFB.exportScale||"1")===sc[0];
            var px=Math.round(p.importedFB.frameSize*parseFloat(sc[0]));
            return React.createElement("button",{key:sc[0],title:px+"px per frame",
              onClick:function(){p.setImportedFB(Object.assign({},p.importedFB,{exportScale:sc[0]}));},
              style:{flex:1,padding:"4px 0",fontSize:9,fontFamily:"monospace",background:act?"#e8900a":"#161616",
                color:act?"#000":"#666",border:"1px solid "+(act?"#e8900a":"#252525"),borderRadius:3,cursor:"pointer"}},sc[1]);
          })
        ),
        React.createElement("div",{style:{display:"flex",alignItems:"center",gap:6}},
          React.createElement("span",{title:"Columns in the exported sheet. Auto = square-ish layout",style:{fontSize:8,color:"#555",minWidth:40}},"Grid"),
          React.createElement("button",{title:"Automatic square layout",
            onClick:function(){p.setImportedFB(Object.assign({},p.importedFB,{exportCols:0}));},
            style:{padding:"4px 8px",fontSize:9,fontFamily:"monospace",background:!(p.importedFB.exportCols>0)?"#e8900a":"#161616",
              color:!(p.importedFB.exportCols>0)?"#000":"#666",border:"1px solid "+(!(p.importedFB.exportCols>0)?"#e8900a":"#252525"),borderRadius:3,cursor:"pointer"}},"Auto"),
          React.createElement("input",{type:"number",min:1,max:32,placeholder:"cols",
            value:p.importedFB.exportCols>0?p.importedFB.exportCols:"",
            onChange:function(e){var v=parseInt(e.target.value)||0;p.setImportedFB(Object.assign({},p.importedFB,{exportCols:v}));},
            style:{flex:1,minWidth:0,background:"#0e0e0e",border:"1px solid #252525",color:"#e8900a",padding:"4px 6px",
              fontFamily:"monospace",fontSize:10,borderRadius:3,textAlign:"center"}}),
          React.createElement("span",{style:{fontSize:8,color:"#555"}},"cols")
        )
      ),
      // Export the edited flipbook: filters + retiming baked into a new sheet
      React.createElement("button",{onClick:function(){p.onExportImportedFB&&p.onExportImportedFB();},
        title:"Bake filters + retiming + loop into a new sprite sheet PNG (alpha preserved)",
        disabled:!!exporting,
        style:{width:"100%",marginTop:4,padding:"8px 0",background:exporting?"#553311":"#ff9966",border:"none",color:"#000",
          fontFamily:"monospace",fontSize:10,fontWeight:700,cursor:exporting?"default":"pointer",borderRadius:4,letterSpacing:1}},
        exporting?"Exporting…":"↓ Export Edited Flipbook ("+totalFramesActual+" frames)")
    ):React.createElement("div",null,
      p.fbImportStatus?React.createElement("div",{style:{fontSize:9,fontFamily:"monospace",padding:"6px 8px",marginBottom:6,
        background:p.fbImportStatus.indexOf("failed")!==-1?"#1a0d0d":"#0d1a0d",
        border:"1px solid "+(p.fbImportStatus.indexOf("failed")!==-1?"#3d1414":"#143d14"),
        color:p.fbImportStatus.indexOf("failed")!==-1?"#ff6666":"#a0e060",borderRadius:3}},p.fbImportStatus):null,
      React.createElement(ImportFlipbookUI,{onImport:p.importFlipbook})
    ),

    // ── PREVIEW ──────────────────────────────────────────────
    React.createElement("div",{style:{background:"#141414",border:"1px solid #1e1e1e",borderRadius:4,padding:10,marginBottom:10}},
      React.createElement("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}},
        React.createElement(SHead,{color:"#ff9966"},"Preview"),
        React.createElement("button",{onClick:p.onToggleFlipbookMain,title:"Show preview in main canvas",
          style:{padding:"2px 6px",fontSize:8,fontFamily:"monospace",background:p.flipbookInMain?"#ff9966":"#1a1a1a",
                 color:p.flipbookInMain?"#000":"#666",border:"1px solid "+(p.flipbookInMain?"#ff9966":"#282828"),borderRadius:2,cursor:"pointer"}
        },"⊠ Main view")
      ),
      React.createElement("div",{style:{display:"flex",justifyContent:"center",marginBottom:8}},
        React.createElement("div",{style:{position:"relative",background:"#0b0b0b",border:"1px solid #252525",borderRadius:3}},
          React.createElement("canvas",{ref:previewRef,style:{display:"block",width:128,height:128,imageRendering:"pixelated"}}),
          React.createElement("div",{style:{position:"absolute",bottom:4,right:6,fontSize:9,color:"rgba(255,153,102,0.9)",fontFamily:"monospace"}},(frame+1)+"/"+totalFramesActual)
        )
      ),
      React.createElement("input",{title:"Scrub through frames (pauses playback)",type:"range",min:0,max:totalFramesActual-1,step:1,value:frame,
        onChange:function(e){setPlaying(false);setFrame(parseInt(e.target.value));},
        style:{width:"100%",accentColor:"#ff9966",height:3,cursor:"pointer",marginBottom:8}}),
      React.createElement("div",{style:{display:"flex",gap:6,alignItems:"center"}},
        React.createElement("button",{title:"Go to first frame",onClick:function(){setFrame(0);setPlaying(false);},style:Object.assign({},iconStyle,{color:"#888"})},"|◀"),
        React.createElement("button",{title:playing?"Stop playback":"Play the animation",onClick:function(){setPlaying(function(v){return!v;});},
          style:{padding:"5px 14px",background:playing?"#ff9966":"#1a1a1a",border:"1px solid "+(playing?"#ff9966":"#282828"),
                 color:playing?"#000":"#aaa",fontFamily:"monospace",fontSize:12,cursor:"pointer",borderRadius:3,fontWeight:700}},
          playing?"■":"▶"
        ),
        React.createElement("button",{title:"Go to last frame",onClick:function(){setFrame(totalFrames-1);setPlaying(false);},style:Object.assign({},iconStyle,{color:"#888"})},"▶|"),
        React.createElement("div",{style:{flex:1}}),
        React.createElement("div",{style:{display:"flex",alignItems:"center",gap:3}},
          React.createElement("span",{title:"Playback speed (frames per second)",style:{fontSize:9,color:"#555",letterSpacing:1}},"FPS"),
          [12,24,30,60,120].map(function(v){
            return React.createElement("button",{key:v,onClick:function(){setFps(v);},
              style:{padding:"2px 5px",fontSize:8,fontFamily:"monospace",
                     background:fps===v?"#e8900a":"#1a1a1a",
                     color:fps===v?"#000":"#555",
                     border:"1px solid "+(fps===v?"#e8900a":"#252525"),
                     borderRadius:2,cursor:"pointer"}},v);
          }),
          React.createElement("input",{type:"number",min:1,max:240,defaultValue:fps,key:fps,
            onBlur:function(e){var v=parseInt(e.target.value);if(!isNaN(v)&&v>=1)setFps(Math.min(240,v));else e.target.value=fps;},
            onKeyDown:function(e){if(e.key==="Enter"){var v=parseInt(e.target.value);if(!isNaN(v)&&v>=1)setFps(Math.min(240,v));}},
            style:{width:40,background:"#161616",border:"1px solid #252525",color:"#e8900a",padding:"3px 4px",
                   fontSize:11,fontFamily:"monospace",borderRadius:3,textAlign:"center",outline:"none"}})
        )
      )
    ),

    // ── RETIMING CURVE ───────────────────────────────────────
    React.createElement("div",{style:{background:"#141414",border:"1px solid #1e1e1e",borderRadius:4,padding:10,marginBottom:12}},
      React.createElement(SHead,{color:"#ff9966"},"Retiming"),
      React.createElement("div",{style:{fontSize:8,color:"#444",marginBottom:8,lineHeight:1.6}},
        "Remaps time across all frames. X=linear, Y=played. Steep start = faster early."
      ),
      React.createElement(CurveEditor,{
        points:(anim.timingCurve&&anim.timingCurve.length>=2)?anim.timingCurve:DEFAULT_CURVE,
        onChange:function(pts){setA("timingCurve",pts);},
        mode:anim.timingCurveMode||"smooth",
        onModeChange:function(m){setA("timingCurveMode",m);}
      })
    ),

    // ── SETTINGS ─────────────────────────────────────────────
    React.createElement(Sel,{label:"Frames / Layout",value:anim.gridIdx!=null?anim.gridIdx:2,
      opts:FB_GRIDS.map(function(g,i){return{v:i,l:g.label};}),
      onChange:function(v){setA("gridIdx",parseInt(v));setFrame(0);setPlaying(false);}}),
    React.createElement(Sel,{label:"Frame Size",value:frameSize,
      opts:[{v:64,l:"64 px"},{v:128,l:"128 px"},{v:256,l:"256 px"},{v:512,l:"512 px"}],
      onChange:function(v){setA("frameSize",parseInt(v));}}),
    React.createElement("div",{style:{fontSize:8,color:"#555",marginBottom:10}},
      "Atlas: "+grid.cols+"×"+Math.ceil(grid.frames/grid.cols)+" = "+grid.frames+" frames → "+(grid.cols*frameSize)+"×"+(Math.ceil(grid.frames/grid.cols)*frameSize)+"px"
    ),

    // ── AUTO-ANIMATE ──────────────────────────────────────────
    React.createElement(Sep,null),
    React.createElement("div",{style:{background:"#141414",border:"1px solid #1e1e1e",borderRadius:4,padding:10,marginBottom:10}},
      React.createElement("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:showAuto?8:0,cursor:"pointer"},onClick:function(){setShowAuto(function(v){return!v;});}},
        React.createElement("span",{style:{fontSize:9,color:"#ffcc44",letterSpacing:2,textTransform:"uppercase"}}," Auto-Animate"),
        React.createElement("span",{style:{fontSize:10,color:"#3a3a3a"}},showAuto?"▾":"▸")
      ),
      showAuto?React.createElement("div",null,
        // Target layer + reverse toggle
        React.createElement("div",{style:{display:"flex",gap:6,alignItems:"flex-end",marginBottom:8,marginTop:8}},
          React.createElement("div",{style:{flex:1}},
            React.createElement("span",{style:{fontSize:8,color:"#555",letterSpacing:1,textTransform:"uppercase",display:"block",marginBottom:4}},"Layer"),
            React.createElement("select",{value:anim._autoLayer||0,onChange:function(e){setA("_autoLayer",parseInt(e.target.value));},style:Object.assign({},SS,{marginBottom:0})},
              layers.map(function(l,i){return React.createElement("option",{key:i,value:i},l.label||"L"+(i+1));})
            )
          ),
          React.createElement("button",{
            onClick:function(){setA("_autoReverse",!anim._autoReverse);},
            title:"Reverse: swap Start and End values when applying",
            style:{padding:"6px 10px",fontSize:9,fontFamily:"monospace",
                   background:anim._autoReverse?"#4ab4ff":"#1a1a1a",
                   color:anim._autoReverse?"#000":"#666",
                   border:"1px solid "+(anim._autoReverse?"#4ab4ff":"#282828"),
                   borderRadius:3,cursor:"pointer",flexShrink:0}
          },"⇄ Rev")
        ),
        // Grouped preset buttons
        (function(){
          var groups=[];
          var seen={};
          AUTO_PRESETS.forEach(function(pr){var g=pr.group||"Other";if(!seen[g]){seen[g]=true;groups.push(g);}});
          return groups.map(function(g){
            var gPresets=AUTO_PRESETS.filter(function(pr){return (pr.group||"Other")===g;});
            return React.createElement("div",{key:g,style:{marginBottom:8}},
              React.createElement("div",{style:{fontSize:8,color:"#555",letterSpacing:1,textTransform:"uppercase",marginBottom:4}},g),
              g==="Scale"?React.createElement("div",{style:{fontSize:7,color:"#444",marginBottom:4,lineHeight:1.5}},"Zoom uses Scale X. With Scale Linked on (default) it scales both axes. Use Post Scale for independent X/Y."):null,
              g==="UV Dist"?React.createElement("div",{style:{fontSize:7,color:"#444",marginBottom:4,lineHeight:1.5}},"Enable a UV Distortion type on the layer first."):null,
              React.createElement("div",{style:{display:"grid",gridTemplateColumns:"1fr 1fr",gap:3}},
                gPresets.map(function(preset){
                  var isJustApplied=lastApplied===preset.id;
                  return React.createElement("button",{key:preset.id,
                    onClick:function(){
                      var li=anim._autoLayer||0;
                      var rev=!!anim._autoReverse;
                      var newTracks=preset.tracks.map(function(t){
                        var from=rev?t.to:t.from, to=rev?t.from:t.to;
                        return {layerIdx:li,param:t.param,from:from,to:to,
                                timingCurve:DEFAULT_CURVE.map(function(p2){return Object.assign({},p2);})};
                      });
                      setAnim(Object.assign({},anim,{tracks:tracks.concat(newTracks)}));
                      setLastApplied(preset.id);
                      setTimeout(function(){setLastApplied(null);},1200);
                    },
                    style:{padding:"5px 3px",fontSize:9,fontFamily:"monospace",
                           background:isJustApplied?"#ffcc44":"#161616",
                           border:"1px solid "+(isJustApplied?"#ffcc44":"#1e1e1e"),
                           color:isJustApplied?"#000":"#ffcc44",
                           borderRadius:3,cursor:"pointer",textAlign:"center",
                           transition:"background 0.15s,color 0.15s,border-color 0.15s"}
                  },isJustApplied?"✓ "+preset.label:preset.label);
                })
              )
            );
          });
        })()
      ):null
    ),

    // ── TRACKS ───────────────────────────────────────────────
    React.createElement(SHead,{color:"#ff9966"},"Tracks"),
    // Group filter for params
    React.createElement("div",{style:{display:"flex",gap:3,marginBottom:10,flexWrap:"wrap"}},
      groups.map(function(g){return React.createElement("button",{key:g,
        onClick:function(){setFilterGroup(g);},
        style:{padding:"2px 7px",fontSize:8,fontFamily:"monospace",background:filterGroup===g?"#ff9966":"#1a1a1a",
               color:filterGroup===g?"#000":"#555",border:"1px solid "+(filterGroup===g?"#ff9966":"#282828"),borderRadius:2,cursor:"pointer"}
      },g);}
    )),

    tracks.map(function(track,i){
      var paramDef=ANIM_PARAMS.find(function(x){return x.id===track.param;})||{id:track.param,label:track.param,min:0,max:1,step:0.01};
      var isEaseOpen=showEaseTrack===i;
      return React.createElement("div",{key:i,style:{background:"#141414",border:"1px solid #252525",borderRadius:4,padding:10,marginBottom:8}},
        // Header — shows param name + invert + ease + delete
        React.createElement("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}},
          React.createElement("div",{style:{display:"flex",alignItems:"center",gap:6}},
            React.createElement("span",{style:{fontSize:9,color:"#ff9966",fontFamily:"monospace",letterSpacing:0.5}},(i+1)+"."),
            React.createElement("span",{style:{fontSize:9,color:"#ccc",fontFamily:"monospace"}},paramDef.label)
          ),
          React.createElement("div",{style:{display:"flex",gap:3}},
            React.createElement("button",{
              onClick:function(){
                var f=track.from!=null?track.from:0,t2=track.to!=null?track.to:1;
                var nt=tracks.slice();nt[i]=Object.assign({},nt[i],{from:t2,to:f});
                setAnim(Object.assign({},anim,{tracks:nt}));
              },
              title:"Invert: swap Start and End",
              style:{padding:"2px 6px",fontSize:9,fontFamily:"monospace",background:"#1a1a1a",
                     color:"#aaa",border:"1px solid #282828",borderRadius:2,cursor:"pointer"}
            },"⇄"),
            React.createElement("button",{
              onClick:function(){
                var dup=Object.assign({},track,{timingCurve:(track.timingCurve||DEFAULT_CURVE).map(function(p2){return Object.assign({},p2);})});
                setAnim(Object.assign({},anim,{tracks:tracks.slice(0,i+1).concat([dup]).concat(tracks.slice(i+1))}));
              },
              title:"Duplicate track",
              style:{padding:"2px 6px",fontSize:9,fontFamily:"monospace",background:"#1a1a1a",
                     color:"#888",border:"1px solid #282828",borderRadius:2,cursor:"pointer"}
            },"⧉"),
            React.createElement("button",{onClick:function(){setShowEaseTrack(isEaseOpen?-1:i);},
              title:"Edit easing curve",
              style:{padding:"2px 6px",fontSize:8,fontFamily:"monospace",background:isEaseOpen?"#e8900a":"#1a1a1a",
                     color:isEaseOpen?"#000":"#666",border:"1px solid "+(isEaseOpen?"#e8900a":"#282828"),borderRadius:2,cursor:"pointer"}
            },"~ Ease"),
            React.createElement(SmBtn,{onClick:function(){remTrack(i);},color:"#888"},"×")
          )
        ),
        // Layer selector with thumbnail
        React.createElement("div",{style:{display:"flex",gap:6,marginBottom:8,alignItems:"center"}},
          (track.layerIdx!==-1&&layers[track.layerIdx||0])?React.createElement(LayerThumb,{layer:layers[track.layerIdx||0],allLayers:layers}):track.layerIdx===-1?React.createElement("div",{style:{width:36,height:36,background:"#1a1a1a",border:"1px solid #252525",borderRadius:3,display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,color:"#4ab4ff",fontFamily:"monospace"}},"⊞"):null,
          React.createElement("div",{style:{flex:1}},
            React.createElement("span",{style:{fontSize:8,color:"#555",textTransform:"uppercase",letterSpacing:1,display:"block",marginBottom:3}},"Layer"),
            React.createElement("select",{value:track.layerIdx!=null?track.layerIdx:0,onChange:function(e){updTrack(i,"layerIdx",parseInt(e.target.value));},style:Object.assign({},SS,{marginBottom:0})},
              React.createElement("option",{value:-1},"⊞ All Layers"),
              layers.map(function(l,li){return React.createElement("option",{key:li,value:li},l.label||"L"+(li+1));})
            ),
            track.layerIdx===-1?React.createElement("div",{style:{display:"flex",gap:4,marginTop:6}},
              [{v:"absolute",l:"Absolute (from→to)"},{v:"relative",l:"Relative (add Δ per layer)"}].map(function(opt){
                var active=(track.globalMode||"absolute")===opt.v;
                return React.createElement("button",{key:opt.v,onClick:function(){updTrack(i,"globalMode",opt.v);},style:{flex:1,padding:"4px 0",fontSize:8,fontFamily:"monospace",background:active?"#4ab4ff":"#1a1a1a",color:active?"#000":"#555",border:"1px solid "+(active?"#4ab4ff":"#252525"),borderRadius:2,cursor:"pointer"}},opt.l);
              })
            ):null
          )
        ),
        // Param selector (filtered)
        React.createElement("div",{style:{marginBottom:8}},
          React.createElement("span",{style:{fontSize:8,color:"#555",textTransform:"uppercase",letterSpacing:1,display:"block",marginBottom:3}},"Parameter"),
          React.createElement("select",{value:track.param,onChange:function(e){updTrack(i,"param",e.target.value);},style:Object.assign({},SS,{marginBottom:0})},
            (filterGroup==="All"?ANIM_PARAMS:filteredParams).map(function(pr){
              return React.createElement("option",{key:pr.id,value:pr.id},(pr.group?"["+pr.group+"] ":"")+pr.label);
            })
          )
        ),
        // Start / End — compact two-column layout with value labels
        React.createElement("div",{style:{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}},
          (track.layerIdx===-1&&track.globalMode==="relative"?[["Δ Start","from","#4ab4ff"],["Δ End","to","#a0e060"]]:[["Start","from","#4ab4ff"],["End","to","#a0e060"]]).map(function(col){
            var label=col[0],key=col[1],color=col[2];
            var val=track[key]!=null?track[key]:(key==="from"?0:1);
            var fmt=paramDef.step<1?val.toFixed(2):""+Math.round(val);
            return React.createElement("div",{key:key},
              React.createElement("div",{style:{display:"flex",justifyContent:"space-between",marginBottom:2,alignItems:"center"}},
                React.createElement("span",{style:{fontSize:8,color:color,textTransform:"uppercase",letterSpacing:1}},label),
                React.createElement("input",{type:"number",
                  defaultValue:val,key:key+"_"+val,
                  onBlur:function(e){
                    var v=parseFloat(e.target.value);
                    if(!isNaN(v))updTrack(i,key,Math.max(paramDef.min,Math.min(paramDef.max,v)));
                  },
                  onKeyDown:function(e){
                    if(e.key==="Enter"){
                      var v=parseFloat(e.target.value);
                      if(!isNaN(v))updTrack(i,key,Math.max(paramDef.min,Math.min(paramDef.max,v)));
                    }
                  },
                  title:"Edit value",
                  style:{width:52,background:"#0e0e0e",border:"1px solid "+color,color:color,
                         padding:"1px 4px",fontSize:10,fontFamily:"monospace",borderRadius:2,
                         textAlign:"right",outline:"none",WebkitAppearance:"none",MozAppearance:"textfield"}
                })
              ),
              React.createElement("input",{type:"range",min:paramDef.min,max:paramDef.max,step:paramDef.step,value:val,
                onChange:function(e){updTrack(i,key,parseFloat(e.target.value));},
                style:{width:"100%",accentColor:color,height:3,cursor:"pointer"}})
            );
          })
        ),
        // Easing curve (collapsible)
        isEaseOpen?React.createElement("div",{style:{marginTop:10,paddingTop:10,borderTop:"1px solid #252525"}},
          React.createElement(CurveEditor,{
            points:(track.timingCurve&&track.timingCurve.length>=2)?track.timingCurve:DEFAULT_CURVE,
            onChange:function(pts){updTrack(i,"timingCurve",pts);},
            mode:track.timingCurveMode||"smooth",
            onModeChange:function(m){updTrack(i,"timingCurveMode",m);}
          })
        ):null
      );
    }),

    React.createElement("button",{onClick:addTrack,
      style:{width:"100%",padding:"7px",background:"#1a1a1a",border:"1px dashed #333",color:"#777",fontFamily:"monospace",fontSize:10,cursor:"pointer",borderRadius:3,marginBottom:12}},
      "+ Add Track"
    ),
    React.createElement(Sep,null),
    React.createElement("button",{
      onClick:p.onExportFlipbook,disabled:exporting,
      style:{width:"100%",padding:"10px",background:exporting?"#333":"#ff9966",border:"none",color:exporting?"#666":"#000",
             fontFamily:"monospace",fontSize:12,fontWeight:700,cursor:exporting?"not-allowed":"pointer",borderRadius:3,letterSpacing:1}
    }, exporting?"RENDERING FRAMES…":"↓ EXPORT FLIPBOOK PNG")
  );
}

// ═══ MAIN APP ═══════════════════════════════════════════════════
// ═══ NODE CANVAS (visual editor for node mode) ═══════════════════
// A pannable board that draws nodes as boxes and connections as bezier
// curves. Supports: drag nodes, drag from an output port to an input port to
// connect, click a connection to delete it, add nodes from a palette, live
// preview of the output node. Reuses the node engine + evaluator above.
function NodeCanvas(p){
  var g=p.graph, setGraph=p.setGraph, size=p.previewSize||128;
  var wrapRef=useRef(null);
  var _pan=useState({x:0,y:0}); var pan=_pan[0],setPan=_pan[1];
  var _zoom=useState(1); var zoom=_zoom[0],setZoom=_zoom[1];
  var drag=useRef(null);          // {nodeId, dx, dy} while dragging a node
  var link=useRef(null);          // {fromId, x, y} while dragging a new wire
  var _tick=useState(0); var tick=_tick[0],setTick=_tick[1];           // visual redraw (node positions)
  var _etick=useState(0); var evalTick=_etick[0],setEvalTick=_etick[1]; // graph re-evaluation (structure/params)
  var _sel=useState(null); var selNode=_sel[0],setSelNode=_sel[1];
  // Multi-selection: a set of node ids for batch operations. selNode stays the
  // "primary" (drives the param panel); selSet holds the full selection.
  var _selSet=useState({}); var selSet=_selSet[0],setSelSet=_selSet[1];
  // Marquee box-select: {x0,y0,x1,y1} in board coords while dragging on empty space.
  var _marquee=useState(null); var marquee=_marquee[0],setMarquee=_marquee[1];
  // Touch-friendly SELECT MODE: when on, dragging empty space draws a marquee
  // (instead of panning) and tapping a node toggles it in the selection — no
  // keyboard modifier needed. Toggled by a button in the toolbar.
  var _selMode=useState(false); var selMode=_selMode[0],setSelMode=_selMode[1];
  // ── Animation timeline state ──
  var _animTime=useState(0); var animTime=_animTime[0],setAnimTime=_animTime[1]; // current time (s)
  var _animPlaying=useState(false); var animPlaying=_animPlaying[0],setAnimPlaying=_animPlaying[1];
  var _animDur=useState(3); var animDur=_animDur[0],setAnimDur=_animDur[1];      // duration (s)
  var _animFps=useState(30); var animFps=_animFps[0],setAnimFps=_animFps[1];
  var _showTimeline=useState(false); var showTimeline=_showTimeline[0],setShowTimeline=_showTimeline[1];
  var animTimeRef=useRef(0); animTimeRef.current=animTime;
  // Sprite-sheet bake settings (grid and per-frame size)
  var _bc=useState(4); var bakeCols=_bc[0],setBakeCols=_bc[1];
  var _br=useState(4); var bakeRows=_br[0],setBakeRows=_br[1];
  var _bfs=useState(128); var bakeFrameSize=_bfs[0],setBakeFrameSize=_bfs[1];
  // Add/replace a keyframe for a node param at the current time.
  function addKeyframe(nodeId,key,value){
    var nd=g.nodes[nodeId]; if(!nd)return;
    if(!nd.anim)nd.anim={};
    var kfs=nd.anim[key]||[];
    var t=Math.round(animTimeRef.current*1000)/1000;
    // replace if a keyframe already exists at this time, else insert sorted
    var found=false;
    for(var i=0;i<kfs.length;i++){if(Math.abs(kfs[i].t-t)<0.001){kfs[i].v=value;found=true;break;}}
    if(!found){kfs.push({t:t,v:value}); kfs.sort(function(a,b){return a.t-b.t;});}
    nd.anim[key]=kfs; bump();
  }
  function removeKeyframesFor(nodeId,key){
    var nd=g.nodes[nodeId]; if(!nd||!nd.anim)return;
    delete nd.anim[key];
    var any=false; for(var k in nd.anim){if(nd.anim[k]&&nd.anim[k].length)any=true;}
    if(!any)delete nd.anim;
    bump();
  }
  function hasKeyframes(nodeId,key){var nd=g.nodes[nodeId];return !!(nd&&nd.anim&&nd.anim[key]&&nd.anim[key].length);}
  // Long-press radial action menu on a node (touch): {nodeId, screenX, screenY}
  var _nodeMenu=useState(null); var nodeMenu=_nodeMenu[0],setNodeMenu=_nodeMenu[1];
  // Tap-a-wire action menu: {edgeId, screenX, screenY}
  var _wireMenu=useState(null); var wireMenu=_wireMenu[0],setWireMenu=_wireMenu[1];
  // Quick-add search text (filters the add-node menu by name)
  var _addQ=useState(""); var addQ=_addQ[0],setAddQ=_addQ[1];
  // Which add-menu category is expanded. Remembered between openings so you
  // come back to the group you were working in.
  var _addCat=useState("Sources"); var addCat=_addCat[0],setAddCat=_addCat[1];
  // Pixel-perfect preview: nearest-neighbour scaling, essential for pixel-art work
  var _pixPerf=useState(false); var pixPerf=_pixPerf[0],setPixPerf=_pixPerf[1];
  // Control dock starts compact so it doesn't cover the board on a phone
  var _dockOpen=useState(false); var dockOpen=_dockOpen[0],setDockOpen=_dockOpen[1];
  // Preset browser panel
  var _presetOpen=useState(false); var presetOpen=_presetOpen[0],setPresetOpen=_presetOpen[1];
  // Replace the whole graph with a ready-made one. Undoable like any edit.
  function loadPreset(p){
    var ng=buildPresetGraph(p);
    g.nodes=ng.nodes; g.edges=ng.edges;
    setSelNode(null); clearSel(); setPresetOpen(false);
    bump();
    setTimeout(fitView,30);
  }
  // Mirrors the module-level pixel-scaling flag so the dock can toggle it.
  var _pxScale=useState(getPixelScaling()); var pxScale=_pxScale[0],setPxScaleState=_pxScale[1];
  function togglePixelScaling(){
    var nv=!getPixelScaling();
    setPixelScaling(nv); setPxScaleState(nv);
    setEvalTick(function(t){return t+1;});
  }
  // Custom fonts loaded this session (family names registered with document.fonts)
  var _fonts=useState([]); var customFonts=_fonts[0],setCustomFonts=_fonts[1];
  // Load a user font file and register it so the Text node can use it.
  function loadCustomFont(file,cb){
    if(!file||typeof FontFace==="undefined"){cb&&cb(null);return;}
    var fam=(file.name||"CustomFont").replace(/\.(ttf|otf|woff2?|TTF|OTF|WOFF2?)$/,"").replace(/[^\w\- ]/g,"").trim()||"CustomFont";
    var rd=new FileReader();
    rd.onload=function(){
      try{
        var ff=new FontFace(fam,rd.result);
        ff.load().then(function(loaded){
          document.fonts.add(loaded);
          setCustomFonts(function(prev){ return prev.indexOf(fam)===-1?prev.concat([fam]):prev; });
          setEvalTick(function(t){return t+1;}); // re-render text nodes with the new font
          cb&&cb(fam);
        }).catch(function(){cb&&cb(null);});
      }catch(e){cb&&cb(null);}
    };
    rd.onerror=function(){cb&&cb(null);};
    rd.readAsArrayBuffer(file);
  }
  var longPressRef=useRef(null);
  var marqueeRef=useRef(null);
  // Clipboard for copy/paste of nodes (with their internal wiring).
  var clipboardRef=useRef(null);
  function selCount(){return Object.keys(selSet).length;}
  function isSel(id){return !!selSet[id];}
  function selectOnly(id){var s={}; if(id)s[id]=true; setSelSet(s); setSelNode(id||null);}
  function toggleSel(id){var s=Object.assign({},selSet); if(s[id])delete s[id]; else s[id]=true; setSelSet(s);
    var keys=Object.keys(s); setSelNode(keys.length?keys[keys.length-1]:null);}
  function selectAll(){var s={}; for(var nid in g.nodes)s[nid]=true; setSelSet(s); var k=Object.keys(s); setSelNode(k.length?k[0]:null);}
  function clearSel(){setSelSet({}); setSelNode(null);}
  function selectByType(type){var s={}; for(var nid in g.nodes)if(g.nodes[nid].type===type)s[nid]=true; setSelSet(s);
    var k=Object.keys(s); setSelNode(k.length?k[0]:null);}
  function invertSel(){var s={}; for(var nid in g.nodes)if(!selSet[nid])s[nid]=true; setSelSet(s);
    var k=Object.keys(s); setSelNode(k.length?k[0]:null);}
  // ids currently in the selection (or just the primary if selSet empty)
  function selIds(){var k=Object.keys(selSet); if(k.length)return k; return selNode?[selNode]:[];}
  // "Add node" radial/list menu, opened by dropping a wire on empty space (or via a button).
  // { screenX, screenY, boardX, boardY, fromId } — fromId auto-wires the new node.
  var _addMenu=useState(null); var addMenu=_addMenu[0],setAddMenu=_addMenu[1];
  // Notify the host when a SOURCE node is selected, so the full layer panel can edit it.
  useEffect(function(){
    if(!p.onSelectSource)return;
    var nd=selNode?g.nodes[selNode]:null;
    p.onSelectSource(nd&&(nd.type==="source"||nd.type==="filter")?selNode:null);
  },[selNode]);
  var previewRef=useRef(null);

  // ── Undo / redo history for the node graph ──────────────────────
  // Snapshots are lightweight JSON of the graph with flipbook frames stripped
  // (frames are rebuilt from sheet.src on restore). Kept in two stacks.
  var undoStack=useRef([]);
  var redoStack=useRef([]);
  var committedRef=useRef(null); // snapshot of the last settled state
  function snapshotGraph(){
    var nodes={};
    for(var nid in g.nodes){
      var on=g.nodes[nid]; var params={};
      for(var k in on.params){
        var v=on.params[k];
        if(k==="sheet"&&v){ params[k]={src:v.src||null,cols:v.cols,rows:v.rows,frameSize:v.frameSize,totalFrames:v.totalFrames}; }
        else if(v&&v.buffer&&v.length!=null&&typeof v!=="string"){ params[k]="__ta__"; }
        else if(v&&typeof v==="object"){ try{params[k]=JSON.parse(JSON.stringify(v));}catch(_e){params[k]=v;} }
        else params[k]=v;
      }
      nodes[nid]={id:on.id,type:on.type,x:on.x,y:on.y,params:params};
      if(on.anim)nodes[nid].anim=JSON.parse(JSON.stringify(on.anim));
      if(on.bypass)nodes[nid].bypass=true;
      if(on.title)nodes[nid].title=on.title;
    }
    return JSON.stringify({nodes:nodes,edges:g.edges,version:g.version||1});
  }
  function restoreSnapshot(snap){
    try{
      var data=JSON.parse(snap);
      for(var nid in data.nodes){
        var nn=data.nodes[nid];
        if(nn.params&&nn.params.sheet&&nn.params.sheet.src){
          var cur=g.nodes[nid];
          if(cur&&cur.params.sheet&&cur.params.sheet.src===nn.params.sheet.src&&cur.params.sheet.frames){
            nn.params.sheet.frames=cur.params.sheet.frames;
          }
        }
      }
      g.nodes=data.nodes; g.edges=data.edges;
      committedRef.current=snap;
      setGraph(Object.assign({},g)); setEvalTick(function(t){return t+1;}); setTick(function(t){return t+1;});
    }catch(e){}
  }
  function undo(){
    if(!undoStack.current.length)return;
    var current=snapshotGraph();
    redoStack.current.push(current);
    var snap=undoStack.current.pop();
    restoreSnapshot(snap); setSelNode(null); clearSel();
  }
  function redo(){
    if(!redoStack.current.length)return;
    undoStack.current.push(snapshotGraph());
    var snap=redoStack.current.pop();
    restoreSnapshot(snap); setSelNode(null); clearSel();
  }
  function canUndo(){return undoStack.current.length>0;}
  function canRedo(){return redoStack.current.length>0;}
  // bump() = the graph changed (it has ALREADY been mutated on g). Push the
  // PREVIOUS committed state onto undo, then commit the new state.
  function bump(){
    var prev=committedRef.current;
    var now=snapshotGraph();
    if(prev!=null && prev!==now){
      undoStack.current.push(prev);
      if(undoStack.current.length>60)undoStack.current.shift();
      redoStack.current=[];
    }
    committedRef.current=now;
    setGraph(Object.assign({},g)); setTick(function(t){return t+1;}); setEvalTick(function(t){return t+1;});
  }

  // ── Timeline playback clock: advance animTime while playing, loop at duration.
  useEffect(function(){
    if(!animPlaying)return;
    var iv=setInterval(function(){
      setAnimTime(function(t){var nt=t+1/animFps; if(nt>animDur)nt=0; return Math.round(nt*1000)/1000;});
    },1000/animFps);
    return function(){clearInterval(iv);};
  },[animPlaying,animFps,animDur]);

  // ── Flipbook playback clock ──────────────────────────────────────
  // If any flipbook node is playing, advance its offset on a timer (at its fps)
  // and re-evaluate so the preview animates live. We mutate offset in place and
  // bump eval so downstream nodes re-render each frame.
  var _fbTick=useState(0); var fbTick=_fbTick[0],setFbTick=_fbTick[1];
  // A STABLE signature: only which flipbook nodes are playing + their fps. This
  // must NOT include offset, or the interval would be torn down every frame.
  var fbPlaySig=(function(){
    var s=[];
    for(var nid in g.nodes){var n=g.nodes[nid];
      if(n.type==="flipbook"&&n.params.playing&&n.params.sheet&&n.params.sheet.frames&&n.params.sheet.frames.length)
        s.push(nid+"@"+(n.params.fps||24));
    }
    return s.sort().join(",");
  })();
  useEffect(function(){
    if(!fbPlaySig)return; // nothing playing
    var ids=fbPlaySig.split(",").map(function(x){return x.split("@")[0];});
    var fps=Math.max(1,parseInt(fbPlaySig.split("@")[1])||24);
    var iv=setInterval(function(){
      for(var i=0;i<ids.length;i++){var n=g.nodes[ids[i]];if(n)n.params.offset=(Math.round(n.params.offset||0)+1);}
      setEvalTick(function(t){return t+1;}); // re-eval to show next frame
      setFbTick(function(t){return t+1;});
    },1000/fps);
    return function(){clearInterval(iv);};
  },[fbPlaySig]);
  // redraw() = only positions changed (dragging/panning) → cheap redraw, NO re-eval.
  function redraw(){ setTick(function(t){return t+1;}); }

  // ── Live preview: evaluate the graph, draw the OUTPUT preview AND store the
  // per-node buffers so each node can show its own thumbnail. ──
  var nodeBufs=useRef({}); // nodeId -> buffer, for per-node mini-previews
  // A signature of everything that affects the RESULT (types, params, edges) but
  // NOT node positions. Used as the eval dependency so dragging a node around
  // doesn't trigger a full graph re-evaluation.
  function graphRenderSig(){
    var parts=[];
    var ids=Object.keys(g.nodes).sort();
    for(var i=0;i<ids.length;i++){
      var n=g.nodes[ids[i]];
      var pj;
      try{
        pj=JSON.stringify(n.params,function(k,v){
          // skip heavy base64 image data; hash by length instead
          if(k==="imageData"&&typeof v==="string")return "img:"+v.length;
          // skip flipbook frames (huge typed arrays) — hash the sheet cheaply by
          // its source + grid + frame count, NOT its pixel data. Serializing the
          // frames here would block the main thread every render.
          if(k==="sheet"&&v&&typeof v==="object"){
            return "sheet:"+(v.src?v.src.length:0)+"x"+(v.cols||0)+"x"+(v.rows||0)+"x"+(v.totalFrames||0)+"x"+(v.frameSize||0);
          }
          if(k==="frames")return undefined; // never serialize raw frames
          // any stray typed array → hash by length only
          if(v&&v.buffer&&v.length!=null&&typeof v!=="string"&&!Array.isArray(v))return "ta:"+v.length;
          return v;
        });
      }catch(_e){ pj=n.type; }
      parts.push(ids[i]+":"+n.type+":"+pj);
    }
    var eids=Object.keys(g.edges).sort();
    for(var j=0;j<eids.length;j++){
      var e=g.edges[eids[j]];
      parts.push(e.from+">"+e.to+"."+e.toPort);
    }
    return parts.join("|");
  }
  var renderSig=graphRenderSig();
  useEffect(function(){
    var cv=previewRef.current;
    try{
      var res=evaluate(g,size,makeNodeEvaluator(size),showTimeline?animTime:null);
      nodeBufs.current=res.cache||{};
      // draw the OUTPUT preview panel
      if(cv){
        var ctx=cv.getContext("2d");
        var img=ctx.createImageData(size,size);
        if(res.buffer){
          for(var i=0;i<size*size;i++){
            img.data[i*4]=Math.round((res.buffer[i*4]||0)*255);
            img.data[i*4+1]=Math.round((res.buffer[i*4+1]||0)*255);
            img.data[i*4+2]=Math.round((res.buffer[i*4+2]||0)*255);
            img.data[i*4+3]=255;
          }
        } else {
          for(var j=0;j<size*size;j++){img.data[j*4+3]=255;} // black
        }
        ctx.putImageData(img,0,0);
      }
      // draw every node's thumbnail from the cache
      drawNodeThumbs();
    }catch(e){ /* preview is best-effort */ }
  },[evalTick,size,renderSig,animTime,showTimeline]);

  // Repaint node thumbnails when the graph's content changes (evalTick) or when
  // a node is added/removed (so freshly mounted canvases get filled). NOT on
  // every pointer move — that would repaint every thumb each frame during a drag.
  var thumbCanvases=useRef({}); // nodeId -> canvas element
  var nodeCount=Object.keys(g.nodes).length;
  useEffect(function(){ drawNodeThumbs(); },[evalTick,nodeCount,size,renderSig]);
  // Node preview size — user-adjustable (S / M / L / XL). Bigger = easier to read
  // the graph at a glance, Substance-style. Drives node width/height too.
  var _thumb=useState(96); var thumbSize=_thumb[0],setThumbSize=_thumb[1];
  var THUMB=thumbSize; // mini-preview size in px
  function drawNodeThumbs(){
    var cache=nodeBufs.current||{};
    for(var nid in thumbCanvases.current){
      var cv=thumbCanvases.current[nid]; if(!cv){delete thumbCanvases.current[nid];continue;}
      if(!g.nodes[nid]){delete thumbCanvases.current[nid];continue;} // node was removed
      var buf=cache[nid];
      var ctx=cv.getContext("2d");
      var img=ctx.createImageData(size,size);
      if(buf){
        for(var i=0;i<size*size;i++){
          img.data[i*4]=Math.round((buf[i*4]||0)*255);
          img.data[i*4+1]=Math.round((buf[i*4+1]||0)*255);
          img.data[i*4+2]=Math.round((buf[i*4+2]||0)*255);
          img.data[i*4+3]=255;
        }
      } else {
        // no buffer (e.g. unconnected) → checker-ish dark fill
        for(var j=0;j<size*size;j++){img.data[j*4]=img.data[j*4+1]=img.data[j*4+2]=20;img.data[j*4+3]=255;}
      }
      ctx.putImageData(img,0,0);
    }
  }

  // ── Coordinate helpers (screen ↔ board) ──
  // (board↔screen conversion uses toBoardLive, which reads the live view ref)

  // Port positions (board space) for a node.
  var TIMELINE_H=176; // approximate height of the timeline strip, used to keep
                      // the dock and the preview clear of it
  var PORT_R=11; // touch-sized ports (bigger = easier to hit with a finger)
  var PORT_HIT=10; // extra invisible hit padding around each port
  // Node size adapts to the preview: width fits the thumbnail, height = title + thumb + footer.
  var NODE_W=Math.max(120,THUMB+24), NODE_H=THUMB+44;
  // Centralized node metadata: label, accent colour, category, short hint. Drives
  // the palette buttons, the add-node menu, and node borders. Adding a new node
  // type here + in NODE_TYPES + the evaluator is all it takes to extend the system.
  var NODE_META={
    source:  {label:"Source",   color:"#3a7d44", cat:"Sources", hint:"Noise / pattern generator", icon:"source"},
    flipbook:{label:"Flipbook", color:"#3a7d44", cat:"Sources", hint:"Play an imported sprite sheet", icon:"flipbook"},
    blend:   {label:"Blend",    color:"#3a5a8a", cat:"Combine", hint:"Blend A over B", icon:"blend"},
    mask:    {label:"Mask Mix", color:"#3a5a8a", cat:"Combine", hint:"Pick A/B by a mask", icon:"mask"},
    alphaMerge:{label:"Alpha Merge",color:"#3a8a8a",cat:"Channel",hint:"RGB + alpha into one", icon:"amerge"},
    alphaSplit:{label:"Alpha Split",color:"#3a8a8a",cat:"Channel",hint:"Extract a channel as grayscale", icon:"asplit"},
    reroute:{label:"Reroute", color:"#666", cat:"Channel", hint:"Pass-through dot to tidy wires", icon:"reroute"},
    levels:{label:"Levels", color:"#c08a4a", cat:"Adjust", hint:"Remap black/white points and gamma", icon:"levels"},
    threshold:{label:"Threshold", color:"#c08a4a", cat:"Adjust", hint:"Binary cut at a luminance level", icon:"threshold"},
    posterize:{label:"Posterize", color:"#c08a4a", cat:"Adjust", hint:"Quantize to N stepped levels", icon:"posterize"},
    sharpen:{label:"Sharpen", color:"#5a9ad0", cat:"Filters", hint:"Unsharp-mask sharpening", icon:"sharpen"},
    emboss:{label:"Emboss", color:"#5a9ad0", cat:"Filters", hint:"Directional relief from gradient", icon:"emboss"},
    normalmap:{label:"Normal Map", color:"#7a6ad0", cat:"Filters", hint:"Tangent-space normal from height", icon:"normalmap"},
    pixelate:{label:"Pixelate", color:"#d05a9a", cat:"Retro", hint:"Collapse into chunky pixel blocks", icon:"pixelate"},
    palette:{label:"Palette", color:"#d05a9a", cat:"Retro", hint:"Snap to a retro hardware palette", icon:"palette"},
    outline:{label:"Outline", color:"#d05a9a", cat:"Retro", hint:"Hard sprite border, pixel-art style", icon:"outline"},
    scanlines:{label:"Scanlines", color:"#d05a9a", cat:"Retro", hint:"CRT scanlines, RGB mask, vignette", icon:"scanlines"},
    text:{label:"Text", color:"#4a9a6a", cat:"Sources", hint:"Render text, any installed or loaded font", icon:"text"},
    morph:{label:"Expand / Shrink", color:"#5a9ad0", cat:"Filters", hint:"Dilate or erode the filled area", icon:"morph"},
    edgedetect:{label:"Edge Detect", color:"#5a9ad0", cat:"Filters", hint:"Sobel or Laplacian edges", icon:"edge"},
    island:{label:"Island / Fill", color:"#5a9ad0", cat:"Filters", hint:"Label regions, drop specks, fill holes", icon:"island"},
    colorgrade:{label:"Master Color", color:"#c08a4a", cat:"Adjust", hint:"Full grade: exposure, LGG, temp, vibrance", icon:"grade"},
    shape:{label:"Shape", color:"#4a9a6a", cat:"Sources", hint:"Circle, star, polygon, ring and more", icon:"shape"},
    gradient:{label:"Gradient", color:"#4a9a6a", cat:"Sources", hint:"Linear, radial, angular, diamond", icon:"gradient"},
    checker:{label:"Checker", color:"#4a9a6a", cat:"Sources", hint:"Checkerboard pattern", icon:"checker"},
    stripes:{label:"Stripes", color:"#4a9a6a", cat:"Sources", hint:"Angled stripes with soft edges", icon:"stripes"},
    bricks:{label:"Bricks", color:"#4a9a6a", cat:"Sources", hint:"Brick wall with mortar and bevel", icon:"bricks"},
    mirror:{label:"Mirror", color:"#8a6ad0", cat:"Distort", hint:"Mirror or kaleidoscope fold", icon:"mirror"},
    offsetnode:{label:"Offset", color:"#8a6ad0", cat:"Distort", hint:"Wrap-shift to check seamless tiling", icon:"offset"},
    dirblur:{label:"Directional Blur", color:"#5a9ad0", cat:"Filters", hint:"Motion blur along an angle", icon:"dirblur"},
    radialblur:{label:"Radial Blur", color:"#5a9ad0", cat:"Filters", hint:"Zoom or spin blur", icon:"radialblur"},
    vignette:{label:"Vignette", color:"#5a9ad0", cat:"Filters", hint:"Darken toward the corners", icon:"vignette"},
    mathnode:{label:"Math", color:"#a06a8a", cat:"Combine", hint:"Add, multiply, min, max, power...", icon:"math"},
    mix:{label:"Mix", color:"#a06a8a", cat:"Combine", hint:"Blend two inputs by factor or mask", icon:"mix"},
    polar:{label:"Polar", color:"#8a6ad0", cat:"Distort", hint:"Cartesian/polar remap: rays, tunnels, spirals", icon:"polar"},
    adjust:  {label:"Adjust",   color:"#7a5a8a", cat:"Filters", hint:"Brightness / contrast / colour", icon:"adjust"},
    filter:  {label:"Filter",   color:"#7a5a8a", cat:"Filters", hint:"Stack of 29 filters", icon:"filter"},
    blur:    {label:"Blur",     color:"#7a5a8a", cat:"Filters", hint:"Gaussian blur", icon:"blur"},
    glow:    {label:"Glow",     color:"#7a5a8a", cat:"Filters", hint:"Bloom on bright areas", icon:"glow"},
    gradmap: {label:"Grad Map", color:"#7a5a8a", cat:"Filters", hint:"Map luminance to colours", icon:"gradmap"},
    warp:    {label:"Warp",     color:"#8a6a3a", cat:"Distort", hint:"Domain warp / UV distortion", icon:"warp"},
    transform:{label:"Transform",color:"#8a6a3a",cat:"Distort", hint:"Scale / rotate / offset / mirror", icon:"transform"},
    output:  {label:"Output",   color:"#9a4a4a", cat:"Output",  hint:"Final result of the graph", icon:"output"},
    flipbookPack:{label:"Flipbook Pack",color:"#9a4a4a",cat:"Output",hint:"Re-tile all frames into a sheet", icon:"pack"}
  };
  // Order of categories and the types in each, for palette + menu grouping.
  var NODE_CATEGORIES=[
    {name:"Sources", types:["source","shape","gradient","checker","stripes","bricks","flipbook","text"]},
    {name:"Combine", types:["blend","mask","mathnode","mix"]},
    {name:"Channel", types:["alphaMerge","alphaSplit","reroute"]},
    {name:"Adjust",  types:["adjust","colorgrade","levels","threshold","posterize"]},
    {name:"Filters", types:["filter","blur","dirblur","radialblur","glow","vignette","gradmap","sharpen","emboss","normalmap","morph","edgedetect","island"]},
    {name:"Distort", types:["warp","transform","polar","mirror","offsetnode"]},
    {name:"Retro",   types:["pixelate","palette","outline","scanlines"]},
    {name:"Output",  types:["output","flipbookPack"]}
  ];
  function nodeColor(type){return (NODE_META[type]&&NODE_META[type].color)||"#444";}
  function nodeLabel(type){return (NODE_META[type]&&NODE_META[type].label)||type;}
  // Simple inline SVG icon per node type (no emoji). Returns a React <svg>.
  function nodeIcon(type,sz,col){
    sz=sz||12; col=col||"#ccc";
    var icon=(NODE_META[type]&&NODE_META[type].icon)||type;
    var paths={
      source:    'M2 8 Q4 3 6 8 T10 8 T14 8',                                  // wavy
      flipbook:  'M3 3h7v7H3z M5 5h7v7H5z',                                     // stacked frames
      blend:     'M5 4a4 4 0 100 8 M11 4a4 4 0 110 8',                          // two overlapping circles
      mask:      'M2 8h12 M8 2v12',                                             // cross split
      amerge:    'M2 5h5v6H2z M9 5h5v6H9z M7 8h2',                              // two boxes joined
      asplit:    'M3 3h10v10H3z M8 3v10',                                       // box split
      adjust:    'M3 4h10 M3 8h7 M3 12h10 M10 6v4',                            // sliders
      filter:    'M2 3h12 L9 9v4 L7 13V9z',                                     // funnel
      blur:      'M8 3a5 5 0 100 10 5 5 0 100-10',                              // soft circle
      glow:      'M8 5v-3 M8 14v-3 M5 8H2 M14 8h-3 M8 5a3 3 0 100 6 3 3 0 100-6', // sun
      gradmap:   'M2 4h12v8H2z',                                                // gradient bar (filled separately)
      warp:      'M2 8 Q5 2 8 8 T14 8',                                         // wave
      transform: 'M3 3h10v10H3z M3 3l10 10 M13 3L3 13',                         // box with diagonals
      output:    'M8 2a6 6 0 100 12 6 6 0 100-12 M8 5v6 M5 8h6',               // target/plus
      pack:      'M2 2h5v5H2z M9 2h5v5H9z M2 9h5v5H2z M9 9h5v5H9z',            // grid
      reroute:   'M3 8h3 M10 8h3 M8 6a2 2 0 100 4 2 2 0 100-4',                // dot on a wire
      levels:    'M2 13 L5 4 L8 13 M3 10h4 M11 4v9 M9 8h4',                     // histogram + slider
      threshold: 'M2 11h5 V5 h7',                                              // step
      posterize: 'M2 12 h3 V9 h3 V6 h3 V3 h3',                                 // staircase
      sharpen:   'M8 2 L10 8 L8 14 L6 8 Z M8 6v4',                             // sharp diamond
      emboss:    'M3 11 L8 5 L13 11 M3 11h10',                                 // relief
      normalmap: 'M8 8a5 5 0 100 .01 M8 3v10 M3 8h10',                          // sphere normal
      pixelate:  'M2 2h5v5H2z M9 2h5v5H9z M2 9h5v5H2z',                          // big blocks
      palette:   'M2 4h3v8H2z M6 4h3v8H6z M10 4h4v8h-4z',                        // colour bars
      outline:   'M3 3h10v10H3z M6 6h4v4H6z',                                    // ring
      scanlines: 'M2 4h12 M2 7h12 M2 10h12 M2 13h12',                            // lines
      text:      'M3 4h10 M8 4v9 M6 13h4',                                        // capital T
      morph:     'M8 2v12 M2 8h12 M5 5l6 6 M11 5l-6 6',                           // expand star
      edge:      'M2 12 L6 5 L10 11 L14 4',                                       // jagged edge
      island:    'M4 6a2 2 0 104 0 2 2 0 10-4 0 M10 10a2 2 0 104 0 2 2 0 10-4 0', // two blobs
      grade:     'M2 8a6 6 0 1012 0 6 6 0 10-12 0 M8 2v12',                       // split circle
      shape:     'M8 2l2 4 4 .6-3 2.9.7 4L8 11.6 4.3 13.5l.7-4-3-2.9 4-.6z',      // star
      gradient:  'M2 3h12v10H2z M2 8h12',                                          // ramp
      checker:   'M2 2h6v6H2z M8 8h6v6H8z',                                        // 2 squares
      stripes:   'M3 2v12 M7 2v12 M11 2v12',                                       // vertical lines
      bricks:    'M2 4h12 M2 8h12 M2 12h12 M6 4V2 M10 8V4 M6 12V8',                // wall
      mirror:    'M8 2v12 M2 5l4 3-4 3z M14 5l-4 3 4 3z',                          // fold
      offset:    'M2 2h7v7H2z M7 7h7v7H7z',                                        // shifted tiles
      dirblur:   'M2 6h12 M4 9h10 M6 12h8',                                        // streaks
      radialblur:'M8 8m-5 0a5 5 0 1010 0 5 5 0 10-10 0 M8 3v2 M8 11v2 M3 8h2 M11 8h2',
      vignette:  'M2 2h12v12H2z M8 8m-4 0a4 4 0 108 0 4 4 0 10-8 0',               // dark frame
      math:      'M3 8h10 M8 3v10',                                                // plus
      mix:       'M3 5h4 M3 11h4 M7 5c3 0 3 6 6 6 M13 8h1',                        // merge
      polar:     'M8 8m-6 0a6 6 0 1012 0 6 6 0 10-12 0 M8 8L14 8 M8 8l-4 4'        // radial
    };
    var d=paths[icon]||'M3 3h10v10H3z';
    var children=[React.createElement("path",{key:"p",d:d,stroke:col,strokeWidth:1.3,fill:icon==="gradmap"?"url(#nigrad)":"none",strokeLinecap:"round",strokeLinejoin:"round"})];
    if(icon==="gradmap"){
      children.unshift(React.createElement("defs",{key:"d"},React.createElement("linearGradient",{id:"nigrad",x1:"0",x2:"1"},
        React.createElement("stop",{offset:"0",stopColor:"#000"}),React.createElement("stop",{offset:"1",stopColor:col}))));
    }
    return React.createElement("svg",{width:sz,height:sz,viewBox:"0 0 16 16",style:{flexShrink:0,display:"block"}},children);
  }
  function inPortPos(node,port){
    var def=NODE_TYPES[node.type]; var idx=def.inputs.indexOf(port);
    var n=def.inputs.length;
    var spacing=NODE_H/(n+1);
    return { x:node.x, y:node.y+spacing*(idx+1) };
  }
  function outPortPos(node,port){
    var def=NODE_TYPES[node.type]; var outs=(def&&def.outputs)||["out"];
    if(outs.length>1&&port){
      var oi=outs.indexOf(port); if(oi<0)oi=0;
      return { x:node.x+NODE_W, y:node.y+NODE_H*(oi+1)/(outs.length+1) };
    }
    return { x:node.x+NODE_W, y:node.y+NODE_H/2 };
  }

  // ── Gesture state ──────────────────────────────────────────────
  // Live pan/zoom kept in a ref so continuous gestures don't read stale React
  // state mid-move. We mirror it to React state for rendering.
  var view=useRef({x:0,y:0,z:1});
  view.current.x=pan.x; view.current.y=pan.y; view.current.z=zoom;
  function applyView(nx,ny,nz){
    view.current.x=nx; view.current.y=ny; view.current.z=nz;
    setPan({x:nx,y:ny}); setZoom(nz);
  }
  // Zoom by a factor around the centre of the board viewport.
  function zoomBy(factor){
    var r=wrapRef.current?wrapRef.current.getBoundingClientRect():{width:300,height:300};
    var mx=r.width/2, my=r.height/2;
    var nz=Math.max(0.25,Math.min(2.5,view.current.z*factor));
    var bx=(mx-view.current.x)/view.current.z, by=(my-view.current.y)/view.current.z;
    applyView(mx-bx*nz, my-by*nz, nz);
  }
  // Fit all nodes into view (centre + zoom so they're comfortably visible).
  function fitView(){
    var ids=Object.keys(g.nodes); if(!ids.length){ applyView(0,0,1); return; }
    var minX=1e9,minY=1e9,maxX=-1e9,maxY=-1e9;
    ids.forEach(function(id){var n=g.nodes[id];minX=Math.min(minX,n.x);minY=Math.min(minY,n.y);maxX=Math.max(maxX,n.x+150);maxY=Math.max(maxY,n.y+64);});
    var r=wrapRef.current?wrapRef.current.getBoundingClientRect():{width:300,height:300};
    var pad=40;
    var gw=Math.max(1,maxX-minX), gh=Math.max(1,maxY-minY);
    var nz=Math.max(0.25,Math.min(1.5,Math.min((r.width-pad*2)/gw,(r.height-pad*2-60)/gh)));
    var cx=(minX+maxX)/2, cy=(minY+maxY)/2;
    applyView(r.width/2-cx*nz, (r.height/2+20)-cy*nz, nz);
  }
  // Active pointers, keyed by pointerId → {x,y}. Drives one-finger pan and
  // two-finger pinch.
  var pointers=useRef({});
  var pinch=useRef(null);   // {startDist, startZoom, cx, cy, startPanX, startPanY}
  var panning=useRef(null); // {sx, sy} one-finger / mouse board pan

  // board coords from screen using the LIVE view ref (not React state)
  function toBoardLive(clientX,clientY){
    var r=wrapRef.current.getBoundingClientRect();
    return { x:(clientX-r.left-view.current.x)/view.current.z, y:(clientY-r.top-view.current.y)/view.current.z };
  }
  function pointerCount(){ var n=0; for(var k in pointers.current)n++; return n; }
  function twoPointerData(){
    var pts=[]; for(var k in pointers.current)pts.push(pointers.current[k]);
    if(pts.length<2)return null;
    var dx=pts[0].x-pts[1].x, dy=pts[0].y-pts[1].y;
    return { dist:Math.hypot(dx,dy), cx:(pts[0].x+pts[1].x)/2, cy:(pts[0].y+pts[1].y)/2 };
  }

  // ── Node drag ──
  function onNodePointerDown(e,node){
    e.stopPropagation();
    if(nodeMenu)setNodeMenu(null); // a new tap dismisses any open action menu
    if(e.currentTarget&&e.currentTarget.setPointerCapture&&e.pointerId!=null){try{e.currentTarget.setPointerCapture(e.pointerId);}catch(_e){}}
    pointers.current[e.pointerId]={x:e.clientX,y:e.clientY};
    var b=toBoardLive(e.clientX,e.clientY);
    // In SELECT mode (or with a modifier) a TAP toggles this node in the
    // selection, but a DRAG still moves it. So we defer the toggle to pointer-up
    // and only apply it if the finger never moved. Previously this branch
    // returned early, which made nodes completely undraggable in select mode.
    var toggleOnTap = !!(selMode||e.shiftKey||e.ctrlKey||e.metaKey);
    var group;
    if(toggleOnTap){
      // drag whatever is currently selected (including this node if it is in it)
      group = (selSet[node.id]&&selCount()>1) ? Object.keys(selSet) : [node.id];
    } else if(selSet[node.id]&&selCount()>1){
      // clicking a node already in a multi-selection keeps the whole selection
      group=Object.keys(selSet);
    } else {
      selectOnly(node.id); group=[node.id];
    }
    // record start positions of every node being dragged (for group move)
    var starts={};
    for(var i=0;i<group.length;i++){var gn=g.nodes[group[i]]; if(gn)starts[group[i]]={x:gn.x,y:gn.y};}
    drag.current={ nodeId:node.id, dx:b.x-node.x, dy:b.y-node.y, pid:e.pointerId, group:group, starts:starts, ox:b.x, oy:b.y, sx:e.clientX, sy:e.clientY, moved:false, toggleOnTap:toggleOnTap };
    // long-press → node action menu (touch-friendly). Only fires if the finger
    // has NOT moved (a drag in progress cancels it). We also require the same
    // pointer to still be down on this node.
    if(longPressRef.current)clearTimeout(longPressRef.current);
    var lx=e.clientX, ly=e.clientY, lid=node.id, lpid=e.pointerId;
    longPressRef.current=setTimeout(function(){
      longPressRef.current=null;
      // bail if a drag actually happened or the pointer was released
      if(!drag.current||drag.current.pid!==lpid||drag.current.moved)return;
      drag.current=null;
      // opening the action menu closes the settings panel so they never overlap
      setSelNode(null); if(p.onSelectSource)p.onSelectSource(null);
      setNodeMenu({nodeId:lid,screenX:lx,screenY:ly});
    },500);
  }
  // ── Start a wire from an output port ──
  function onOutPointerDown(e,node,fromPort){
    e.stopPropagation();
    if(e.currentTarget&&e.currentTarget.setPointerCapture&&e.pointerId!=null){try{e.currentTarget.setPointerCapture(e.pointerId);}catch(_e){}}
    pointers.current[e.pointerId]={x:e.clientX,y:e.clientY};
    var b=toBoardLive(e.clientX,e.clientY);
    link.current={ fromId:node.id, fromPort:fromPort||"out", x:b.x, y:b.y, pid:e.pointerId };
    setTick(function(t){return t+1;});
  }
  // ── Board pointer down: start pan (1 finger) or arm pinch (2 fingers) ──
  function onBoardPointerDown(e){
    if(e.currentTarget&&e.currentTarget.setPointerCapture&&e.pointerId!=null){try{e.currentTarget.setPointerCapture(e.pointerId);}catch(_e){}}
    pointers.current[e.pointerId]={x:e.clientX,y:e.clientY};
    var cnt=pointerCount();
    if(cnt>=2){
      // entering pinch — cancel any single-finger pan
      panning.current=null;
      var tp=twoPointerData();
      if(tp){ pinch.current={ startDist:tp.dist, startZoom:view.current.z, cx:tp.cx, cy:tp.cy,
        startPanX:view.current.x, startPanY:view.current.y }; }
    } else {
      // select mode (touch) or modifier on empty space starts a marquee; else pan
      // tapping empty space always closes any open pop-up menu
      if(addMenu)setAddMenu(null);
      if(nodeMenu)setNodeMenu(null);
      if(wireMenu)setWireMenu(null);
      if(selMode||e.shiftKey||e.ctrlKey||e.metaKey){
        var bb=toBoardLive(e.clientX,e.clientY);
        marqueeRef.current={x0:bb.x,y0:bb.y,x1:bb.x,y1:bb.y,pid:e.pointerId,additive:e.shiftKey||selMode};
        setMarquee({x0:bb.x,y0:bb.y,x1:bb.x,y1:bb.y});
      } else {
        panning.current={ sx:e.clientX-view.current.x, sy:e.clientY-view.current.y };
        setSelNode(null); clearSel();
      }
    }
  }
  // ── Unified move handler (mouse + touch) ──
  function onMove(e){
    // keep this pointer's tracked position fresh
    if(pointers.current[e.pointerId])pointers.current[e.pointerId]={x:e.clientX,y:e.clientY};

    // Two-finger pinch zoom takes priority.
    if(pinch.current&&pointerCount()>=2){
      var tp=twoPointerData(); if(!tp)return;
      var ratio=tp.dist/(pinch.current.startDist||1);
      var nz=Math.max(0.25,Math.min(2.5,pinch.current.startZoom*ratio));
      // keep the pinch midpoint anchored on screen while zooming
      var r=wrapRef.current.getBoundingClientRect();
      var mx=pinch.current.cx-r.left, my=pinch.current.cy-r.top;
      // board point under the original midpoint (using the pinch start view)
      var bx=(mx-pinch.current.startPanX)/pinch.current.startZoom;
      var by=(my-pinch.current.startPanY)/pinch.current.startZoom;
      // also follow the midpoint as the fingers move (two-finger pan)
      var nmx=tp.cx-r.left, nmy=tp.cy-r.top;
      applyView(nmx-bx*nz, nmy-by*nz, nz);
      return;
    }
    if(drag.current){
      var b=toBoardLive(e.clientX,e.clientY);
      // any real movement marks this as a drag and cancels the pending long-press
      if(!drag.current.moved&&(Math.abs(e.clientX-drag.current.sx)>4||Math.abs(e.clientY-drag.current.sy)>4)){
        drag.current.moved=true;
        if(longPressRef.current){clearTimeout(longPressRef.current);longPressRef.current=null;}
        if(nodeMenu)setNodeMenu(null);
      }
      if(!drag.current.moved)return; // below threshold: don't jitter the node yet
      if(drag.current.group&&drag.current.group.length>1){
        // group move: shift every selected node by the same delta from start
        var ddx=b.x-drag.current.ox, ddy=b.y-drag.current.oy;
        for(var gi=0;gi<drag.current.group.length;gi++){
          var gid=drag.current.group[gi], st=drag.current.starts[gid], gn=g.nodes[gid];
          if(gn&&st){ gn.x=st.x+ddx; gn.y=st.y+ddy; }
        }
        setTick(function(t){return t+1;});
      } else {
        var nd=g.nodes[drag.current.nodeId];
        if(nd){ nd.x=b.x-drag.current.dx; nd.y=b.y-drag.current.dy; setTick(function(t){return t+1;}); }
      }
    } else if(link.current){
      var b2=toBoardLive(e.clientX,e.clientY);
      link.current.x=b2.x; link.current.y=b2.y; setTick(function(t){return t+1;});
    } else if(panning.current){
      applyView(e.clientX-panning.current.sx, e.clientY-panning.current.sy, view.current.z);
    } else if(marqueeRef.current){
      var bm=toBoardLive(e.clientX,e.clientY);
      marqueeRef.current.x1=bm.x; marqueeRef.current.y1=bm.y;
      setMarquee({x0:marqueeRef.current.x0,y0:marqueeRef.current.y0,x1:bm.x,y1:bm.y});
    }
  }
  function onUp(e){
    // remove this pointer
    if(e.pointerId!=null)delete pointers.current[e.pointerId];
    if(longPressRef.current){clearTimeout(longPressRef.current);longPressRef.current=null;}
    // finalize a marquee box-select: select every node whose centre is inside
    if(marqueeRef.current&&(e.pointerId==null||marqueeRef.current.pid===e.pointerId)){
      var mq=marqueeRef.current; marqueeRef.current=null; setMarquee(null);
      var xa=Math.min(mq.x0,mq.x1),xb=Math.max(mq.x0,mq.x1),ya=Math.min(mq.y0,mq.y1),yb=Math.max(mq.y0,mq.y1);
      var s=mq.additive?Object.assign({},selSet):{};
      for(var mid in g.nodes){
        var mn=g.nodes[mid]; var cx=mn.x+NODE_W/2, cy=mn.y+NODE_H/2;
        if(cx>=xa&&cx<=xb&&cy>=ya&&cy<=yb)s[mid]=true;
      }
      setSelSet(s); var mk=Object.keys(s); setSelNode(mk.length?mk[mk.length-1]:null);
      return;
    }
    // If a pinch was active and we dropped below 2 fingers, end it (and if one
    // finger remains, hand off to a fresh pan so it doesn't jump).
    if(pinch.current&&pointerCount()<2){
      pinch.current=null;
      var rem=null; for(var pk in pointers.current){rem=pointers.current[pk];break;}
      if(rem){ panning.current={ sx:rem.x-view.current.x, sy:rem.y-view.current.y }; }
    }
    if(drag.current&&(e.pointerId==null||drag.current.pid===e.pointerId)){
      var didMove=drag.current.moved;
      var wantToggle=drag.current.toggleOnTap, tId=drag.current.nodeId;
      drag.current=null;
      if(didMove)bump();              // a real move: commit it to undo history
      else if(wantToggle)toggleSel(tId); // a tap in select mode: toggle instead
      else { setGraph(Object.assign({},g)); redraw(); }
    }
    else if(link.current&&(e.pointerId==null||link.current.pid===e.pointerId)){
      // drop on an input port? hit-test all input ports
      var b=toBoardLive(e.clientX,e.clientY);
      var hit=null;
      for(var id in g.nodes){
        var nd=g.nodes[id]; var def=NODE_TYPES[nd.type];
        for(var k=0;k<def.inputs.length;k++){
          var pp=inPortPos(nd,def.inputs[k]);
          var _tol=30/view.current.z; // generous screen-space tolerance for touch fingers
          if(Math.abs(pp.x-b.x)<_tol&&Math.abs(pp.y-b.y)<_tol){ hit={node:nd,port:def.inputs[k]}; break; }
        }
        if(hit)break;
      }
      if(hit){ connect(g,link.current.fromId,hit.node.id,hit.port,link.current.fromPort); link.current=null; bump(); }
      else {
        // Dropped on empty space → open the "add node" menu, auto-wiring from this output.
        var fromId=link.current.fromId, fromPort=link.current.fromPort;
        setAddMenu({ screenX:e.clientX, screenY:e.clientY, boardX:b.x, boardY:b.y, fromId:fromId, fromPort:fromPort });
        link.current=null; redraw();
      }
    }
    if(pointerCount()===0)panning.current=null;
  }

  // ── Add a node from the palette ──
  // opts: { x, y } board coords (optional), { fromId } to auto-wire an output into
  // the new node's first input, { select } to open its panel after.
  function addNodeOfType(type,opts){
    opts=opts||{};
    var nCount=Object.keys(g.nodes).length;
    var ox=(nCount%5)*26, oy=(nCount%5)*22;
    var px=opts.x!=null?opts.x:(-pan.x+160+ox)/zoom;
    var py=opts.y!=null?opts.y:(-pan.y+150+oy)/zoom;
    var nd=mkNode(type, px, py);
    if(type==="source"){
      nd.params.layer=mkL(0,(Math.random()*99999)|0,{enabled:true,type:"fbm"});
    }
    addNode(g,nd);
    // Auto-connect: wire the dragged-from output into this node's first input.
    if(opts.fromId&&g.nodes[opts.fromId]){
      var def=NODE_TYPES[type];
      if(def.inputs&&def.inputs.length)connect(g,opts.fromId,nd.id,def.inputs[0],opts.fromPort);
    }
    bump();
    if(opts.select)setSelNode(nd.id);
    return nd;
  }

  // Duplicate a node (deep-copy its params) offset slightly, and select it.
  function duplicateNode(nid){
    var src=g.nodes[nid]; if(!src)return;
    var nd=mkNode(src.type, src.x+30, src.y+30);
    nd.params=cloneParams(src.params);
    if(src.title)nd.title=src.title;
    if(src.anim)nd.anim=JSON.parse(JSON.stringify(src.anim));
    if(src.bypass)nd.bypass=true;
    addNode(g,nd); bump(); selectOnly(nd.id);
  }

  // Deep-copy params while preserving typed arrays (flipbook frames) and not
  // exploding on the huge sheet. JSON can't round-trip Float32Array, so handle it.
  function cloneParams(p){
    var out={};
    for(var k in p){
      var v=p[k];
      if(k==="sheet"&&v){ out[k]=v; } // share the sheet (frames are immutable here)
      else if(v&&v.buffer&&v.length!=null&&typeof v!=="string"){ out[k]=v.slice(); }
      else if(v&&typeof v==="object"){ try{out[k]=JSON.parse(JSON.stringify(v));}catch(_e){out[k]=v;} }
      else out[k]=v;
    }
    return out;
  }

  // ══ BATCH OPERATIONS ════════════════════════════════════════════
  // All operate on the current selection (selIds()). Each ends with bump().

  // 1. Delete all selected nodes.
  function batchDelete(){
    var ids=selIds(); if(!ids.length)return;
    for(var i=0;i<ids.length;i++)removeNode(g,ids[i]);
    clearSel(); if(p.onSelectSource)p.onSelectSource(null); bump();
  }
  // 2. Duplicate selected nodes, preserving wires BETWEEN them; offset +40,+40.
  function batchDuplicate(){
    var ids=selIds(); if(!ids.length)return;
    var map={}; var newIds={};
    for(var i=0;i<ids.length;i++){
      var src=g.nodes[ids[i]]; if(!src)continue;
      var nd=mkNode(src.type,src.x+40,src.y+40); nd.params=cloneParams(src.params);
      if(src.title)nd.title=src.title;
      if(src.anim)nd.anim=JSON.parse(JSON.stringify(src.anim));
      if(src.bypass)nd.bypass=true;
      addNode(g,nd); map[ids[i]]=nd.id; newIds[nd.id]=true;
    }
    // re-create internal edges among the duplicated set (keeping the output port)
    for(var eid in g.edges){
      var e=g.edges[eid];
      if(map[e.from]&&map[e.to])connect(g,map[e.from],map[e.to],e.toPort,e.fromPort);
    }
    setSelSet(newIds); var k=Object.keys(newIds); setSelNode(k.length?k[0]:null); bump();
  }
  // 3. Copy selected to the clipboard (deep snapshot + internal edges).
  function batchCopy(){
    var ids=selIds(); if(!ids.length)return;
    var nodes=[]; var idset={}; for(var i=0;i<ids.length;i++)idset[ids[i]]=true;
    for(var i2=0;i2<ids.length;i2++){var n=g.nodes[ids[i2]]; if(n){var cn={id:n.id,type:n.type,x:n.x,y:n.y,params:cloneParams(n.params)};
      if(n.title)cn.title=n.title; if(n.anim)cn.anim=JSON.parse(JSON.stringify(n.anim)); if(n.bypass)cn.bypass=true; nodes.push(cn);}}
    var edges=[]; for(var eid in g.edges){var e=g.edges[eid]; if(idset[e.from]&&idset[e.to])edges.push({from:e.from,to:e.to,toPort:e.toPort,fromPort:e.fromPort});}
    clipboardRef.current={nodes:nodes,edges:edges};
  }
  // 4. Paste clipboard (offset so it doesn't overlap), select the pasted nodes.
  function batchPaste(){
    var cb=clipboardRef.current; if(!cb||!cb.nodes.length)return;
    var map={}, newIds={};
    for(var i=0;i<cb.nodes.length;i++){
      var s=cb.nodes[i]; var nd=mkNode(s.type,s.x+50,s.y+50); nd.params=cloneParams(s.params);
      if(s.title)nd.title=s.title; if(s.anim)nd.anim=JSON.parse(JSON.stringify(s.anim)); if(s.bypass)nd.bypass=true;
      addNode(g,nd); map[s.id]=nd.id; newIds[nd.id]=true;
    }
    for(var j=0;j<cb.edges.length;j++){var e=cb.edges[j]; if(map[e.from]&&map[e.to])connect(g,map[e.from],map[e.to],e.toPort,e.fromPort);}
    setSelSet(newIds); var k=Object.keys(newIds); setSelNode(k.length?k[0]:null); bump();
  }
  // 5-10. Alignment.
  function selNodesArr(){var ids=selIds(); var a=[]; for(var i=0;i<ids.length;i++){var n=g.nodes[ids[i]]; if(n)a.push(n);} return a;}
  function batchAlign(mode){
    var a=selNodesArr(); if(a.length<2)return;
    var minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
    for(var i=0;i<a.length;i++){minX=Math.min(minX,a[i].x);maxX=Math.max(maxX,a[i].x);minY=Math.min(minY,a[i].y);maxY=Math.max(maxY,a[i].y);}
    var cx=(minX+maxX)/2, cy=(minY+maxY)/2;
    for(var j=0;j<a.length;j++){
      if(mode==="left")a[j].x=minX; else if(mode==="right")a[j].x=maxX;
      else if(mode==="top")a[j].y=minY; else if(mode==="bottom")a[j].y=maxY;
      else if(mode==="centerH")a[j].x=cx; else if(mode==="centerV")a[j].y=cy;
    }
    bump();
  }
  // 11-12. Distribute evenly (by left edge) horizontally or vertically.
  function batchDistribute(axis){
    var a=selNodesArr(); if(a.length<3)return;
    a.sort(function(p1,p2){return axis==="h"?p1.x-p2.x:p1.y-p2.y;});
    var first=axis==="h"?a[0].x:a[0].y, last=axis==="h"?a[a.length-1].x:a[a.length-1].y;
    var step=(last-first)/(a.length-1);
    for(var i=0;i<a.length;i++){ if(axis==="h")a[i].x=first+step*i; else a[i].y=first+step*i; }
    bump();
  }
  // 13. Tidy / auto-layout: arrange selected (or all) left-to-right by topology depth.
  function batchAutoLayout(){
    var ids=selIds(); if(ids.length<2)ids=Object.keys(g.nodes);
    if(!ids.length)return;
    var idset={}; for(var i=0;i<ids.length;i++)idset[ids[i]]=true;
    // depth = longest path from any node with no selected input
    var depth={};
    function getDepth(id,guard){
      if(depth[id]!=null)return depth[id];
      if(guard[id])return 0; guard[id]=true;
      var d=0, n=g.nodes[id], def=NODE_TYPES[n.type];
      for(var pi=0;pi<def.inputs.length;pi++){
        var e=incomingEdge(g,id,def.inputs[pi]);
        if(e&&idset[e.from])d=Math.max(d,getDepth(e.from,guard)+1);
      }
      depth[id]=d; return d;
    }
    for(var k=0;k<ids.length;k++)getDepth(ids[k],{});
    // group by depth column, stack vertically
    var cols={}; for(var m=0;m<ids.length;m++){var d=depth[ids[m]]||0;(cols[d]=cols[d]||[]).push(ids[m]);}
    var x0=200,y0=160,colW=Math.max(180,NODE_W+70),rowH=Math.max(120,NODE_H+30);
    Object.keys(cols).sort(function(a,b){return a-b;}).forEach(function(d){
      var arr=cols[d];
      for(var r=0;r<arr.length;r++){var n=g.nodes[arr[r]]; n.x=x0+d*colW; n.y=y0+r*rowH;}
    });
    bump();
  }
  // 14. Chain selected in series: connect each to the next (by x position).
  function batchChain(){
    var a=selNodesArr(); if(a.length<2)return;
    a.sort(function(p1,p2){return p1.x-p2.x;});
    for(var i=0;i<a.length-1;i++){
      var from=a[i], to=a[i+1], def=NODE_TYPES[to.type];
      if(def.inputs.length)connect(g,from.id,to.id,def.inputs[0]);
    }
    bump();
  }
  // 15. Randomize seeds of all selected source nodes (and warp nodes).
  function batchRandomizeSeeds(){
    var ids=selIds(); if(!ids.length)return; var changed=false;
    for(var i=0;i<ids.length;i++){
      var n=g.nodes[ids[i]]; if(!n)continue;
      if(n.type==="source"&&n.params.layer){ n.params.layer=Object.assign({},n.params.layer,{seed:(Math.random()*99999)|0}); changed=true; }
      if(n.type==="warp"){ n.params.seed=(Math.random()*99999)|0; changed=true; }
    }
    if(changed)bump();
  }
  // 16. Reset selected nodes' params to type defaults.
  function batchResetParams(){
    var ids=selIds(); if(!ids.length)return;
    for(var i=0;i<ids.length;i++){
      var n=g.nodes[ids[i]]; if(!n)continue; var def=NODE_TYPES[n.type];
      n.params=JSON.parse(JSON.stringify(def.params||{}));
      if(n.type==="source")n.params.layer=mkL(0,(Math.random()*99999)|0,{enabled:true,type:"fbm"});
    }
    bump();
  }
  // 17. Nudge selected by a board-space delta (arrow keys).
  function batchNudge(dx,dy){
    var ids=selIds(); if(!ids.length)return;
    for(var i=0;i<ids.length;i++){var n=g.nodes[ids[i]]; if(n){n.x+=dx;n.y+=dy;}}
    setTick(function(t){return t+1;}); setGraph(Object.assign({},g));
  }
  // 19. Disconnect all wires touching the selection.
  function batchDisconnect(){
    var ids=selIds(); if(!ids.length)return; var idset={}; for(var i=0;i<ids.length;i++)idset[ids[i]]=true;
    var toRemove=[]; for(var eid in g.edges){var e=g.edges[eid]; if(idset[e.from]||idset[e.to])toRemove.push(eid);}
    for(var j=0;j<toRemove.length;j++)delete g.edges[toRemove[j]];
    bump();
  }
  // 20. Select everything downstream of the current selection (follow outputs).
  function batchSelectDownstream(){
    var ids=selIds(); if(!ids.length)return; var s=Object.assign({},selSet); if(!Object.keys(s).length)s[selNode]=true;
    var changed=true;
    while(changed){ changed=false;
      for(var eid in g.edges){var e=g.edges[eid]; if(s[e.from]&&!s[e.to]){s[e.to]=true;changed=true;}}
    }
    setSelSet(s); var k=Object.keys(s); setSelNode(k.length?k[0]:null);
  }
  // 21. Select everything upstream of the current selection (follow inputs).
  function batchSelectUpstream(){
    var ids=selIds(); if(!ids.length)return; var s=Object.assign({},selSet); if(!Object.keys(s).length)s[selNode]=true;
    var changed=true;
    while(changed){ changed=false;
      for(var eid in g.edges){var e=g.edges[eid]; if(s[e.to]&&!s[e.from]){s[e.from]=true;changed=true;}}
    }
    setSelSet(s); var k=Object.keys(s); setSelNode(k.length?k[0]:null);
  }

  // ══ AUTO FUNCTIONS ══════════════════════════════════════════════
  var GRID=20; // snap grid in board units

  // A1. Auto-space: lay the WHOLE graph out left-to-right by flow with even gaps.
  function autoSpace(){
    var ids=Object.keys(g.nodes); if(ids.length<2)return;
    var depth={};
    function gd(id,guard){
      if(depth[id]!=null)return depth[id];
      if(guard[id])return 0; guard[id]=true;
      var d=0,n=g.nodes[id],def=NODE_TYPES[n.type];
      for(var pi=0;pi<def.inputs.length;pi++){var e=incomingEdge(g,id,def.inputs[pi]);if(e)d=Math.max(d,gd(e.from,guard)+1);}
      depth[id]=d; return d;
    }
    for(var i=0;i<ids.length;i++)gd(ids[i],{});
    var cols={}; for(var m=0;m<ids.length;m++){var d=depth[ids[m]]||0;(cols[d]=cols[d]||[]).push(ids[m]);}
    var x0=200,y0=150,colW=Math.max(190,NODE_W+80),rowH=Math.max(120,NODE_H+34);
    Object.keys(cols).sort(function(a,b){return a-b;}).forEach(function(d){
      var arr=cols[d].sort(function(a,b){return g.nodes[a].y-g.nodes[b].y;});
      for(var r=0;r<arr.length;r++){var n=g.nodes[arr[r]]; n.x=x0+d*colW; n.y=y0+r*rowH;}
    });
    bump();
  }
  // A2. Auto-align to grid: snap every node (or selection) to the grid.
  function autoAlignGrid(){
    var ids=selCount()>1?selIds():Object.keys(g.nodes); if(!ids.length)return;
    for(var i=0;i<ids.length;i++){var n=g.nodes[ids[i]]; if(n){n.x=Math.round(n.x/GRID)*GRID; n.y=Math.round(n.y/GRID)*GRID;}}
    bump();
  }
  // helper: would connecting from→to create a cycle?
  function wouldCycle(fromId,toId){
    var seen={},stack=[toId];
    while(stack.length){var cur=stack.pop(); if(cur===fromId)return true;
      for(var eid in g.edges){var e=g.edges[eid]; if(e.from===cur&&!seen[e.to]){seen[e.to]=true;stack.push(e.to);}}
    }
    return false;
  }
  // A3. Auto-connect: fill every empty input with the nearest node to the left
  // that won't create a cycle. Great after dropping several nodes loosely.
  function autoConnect(){
    var ids=Object.keys(g.nodes); var made=0;
    for(var i=0;i<ids.length;i++){
      var n=g.nodes[ids[i]]; var def=NODE_TYPES[n.type];
      if(!def.inputs.length)continue;
      for(var pi=0;pi<def.inputs.length;pi++){
        var port=def.inputs[pi];
        if(incomingEdge(g,n.id,port))continue;
        var best=null,bestD=Infinity;
        for(var j=0;j<ids.length;j++){
          var c=g.nodes[ids[j]]; if(c.id===n.id)continue;
          if(c.x>=n.x)continue;
          var dx=n.x-c.x, dy=n.y-c.y, d=dx*dx+dy*dy;
          if(d<bestD&&!wouldCycle(c.id,n.id)){bestD=d;best=c;}
        }
        if(best){connect(g,best.id,n.id,port);made++;}
      }
    }
    if(made)bump();
  }
  // A4. Auto-insert a node onto an existing wire: splice newType between the two
  // ends of an edge.
  function autoInsertOnEdge(edgeId,newType){
    var e=g.edges[edgeId]; if(!e)return;
    var fromId=e.from, toId=e.to, toPort=e.toPort;
    var toNode=g.nodes[toId];
    var ins=mkNode(newType,(g.nodes[fromId].x+toNode.x)/2,(g.nodes[fromId].y+toNode.y)/2);
    if(newType==="source")ins.params.layer=mkL(0,(Math.random()*99999)|0,{enabled:true,type:"fbm"});
    addNode(g,ins);
    delete g.edges[edgeId];
    var idef=NODE_TYPES[newType];
    if(idef.inputs.length)connect(g,fromId,ins.id,idef.inputs[0]);
    connect(g,ins.id,toId,toPort);
    bump(); selectOnly(ins.id);
  }
  // A5/A6. Wrappers.
  function autoFrame(){ fitView(); }

  // Keyboard shortcuts in node mode: Delete/Backspace removes, Ctrl/Cmd+D duplicates.
  useEffect(function(){
    function onKeyNode(e){
      // ignore when typing in an input/select/textarea
      var tag=(e.target&&e.target.tagName||"").toLowerCase();
      if(tag==="input"||tag==="textarea"||tag==="select"||e.target.isContentEditable)return;
      var cmd=e.ctrlKey||e.metaKey;
      // global shortcuts (work even with no selection)
      if(cmd&&(e.key==="z"||e.key==="Z")&&!e.shiftKey){ e.preventDefault(); undo(); return; }
      if(cmd&&((e.key==="z"||e.key==="Z")&&e.shiftKey||e.key==="y"||e.key==="Y")){ e.preventDefault(); redo(); return; }
      if(cmd&&(e.key==="a"||e.key==="A")){ e.preventDefault(); selectAll(); return; }
      if(cmd&&(e.key==="v"||e.key==="V")){ e.preventDefault(); batchPaste(); return; }
      if(e.key==="Escape"){ clearSel(); setAddMenu(null); return; }
      var ids=selIds(); if(!ids.length)return;
      if(e.key==="Delete"||e.key==="Backspace"){
        e.preventDefault();
        var hadSrc=false; for(var i=0;i<ids.length;i++){var t=g.nodes[ids[i]]&&g.nodes[ids[i]].type;if(t==="source"||t==="filter")hadSrc=true;}
        batchDelete(); if(hadSrc&&p.onSelectSource)p.onSelectSource(null);
      } else if(cmd&&(e.key==="d"||e.key==="D")){ e.preventDefault(); batchDuplicate(); }
      else if(cmd&&(e.key==="c"||e.key==="C")){ e.preventDefault(); batchCopy(); }
      else if(e.key==="ArrowLeft"){ e.preventDefault(); batchNudge(e.shiftKey?-40:-8,0); }
      else if(e.key==="ArrowRight"){ e.preventDefault(); batchNudge(e.shiftKey?40:8,0); }
      else if(e.key==="ArrowUp"){ e.preventDefault(); batchNudge(0,e.shiftKey?-40:-8); }
      else if(e.key==="ArrowDown"){ e.preventDefault(); batchNudge(0,e.shiftKey?40:8); }
    }
    window.addEventListener("keydown",onKeyNode);
    return function(){window.removeEventListener("keydown",onKeyNode);};
  },[selNode,selSet,g]);

  // ── Build SVG wires ──
  function wirePath(x1,y1,x2,y2){
    var dx=Math.max(40,Math.abs(x2-x1)*0.5);
    return "M"+x1+","+y1+" C"+(x1+dx)+","+y1+" "+(x2-dx)+","+y2+" "+x2+","+y2;
  }
  var wires=[];
  for(var eid in g.edges){
    var e=g.edges[eid]; var nf=g.nodes[e.from], nt=g.nodes[e.to];
    if(!nf||!nt)continue;
    var op=outPortPos(nf,e.fromPort), ip=inPortPos(nt,e.toPort);
    var _d=wirePath(op.x,op.y,ip.x,ip.y);
    // fat invisible stroke = generous touch target for the wire
    wires.push(React.createElement("path",{key:eid+"_hit",d:_d,
      stroke:"transparent",strokeWidth:18,fill:"none",style:{cursor:"pointer",pointerEvents:"stroke",touchAction:"none"},
      onPointerDown:function(edgeId){return function(ev){ev.stopPropagation();
        setNodeMenu(null); setAddMenu(null);
        setWireMenu({edgeId:edgeId,screenX:ev.clientX,screenY:ev.clientY});};}(eid)}));
    wires.push(React.createElement("path",{key:eid,d:_d,
      stroke:wireMenu&&wireMenu.edgeId===eid?"#9cf":"#e8900a",strokeWidth:wireMenu&&wireMenu.edgeId===eid?3:2,
      fill:"none",opacity:0.85,style:{pointerEvents:"none"}}));
  }
  // pending wire while dragging
  if(link.current){
    var lf=g.nodes[link.current.fromId];
    if(lf){var lop=outPortPos(lf,link.current.fromPort);wires.push(React.createElement("path",{key:"pending",
      d:wirePath(lop.x,lop.y,link.current.x,link.current.y),stroke:"#8fd4ff",strokeWidth:2,fill:"none",strokeDasharray:"5,4"}));}
  }

  // ── Node boxes ──
  var nodeEls=[];
  for(var nid in g.nodes){
    (function(node){
      var def=NODE_TYPES[node.type];
      var col=nodeColor(node.type);
      var inputs=[];
      def.inputs.forEach(function(port,k){
        var pp=inPortPos(node,port);
        // the port dot
        inputs.push(React.createElement("div",{key:port,title:port,style:{
          position:"absolute",left:-PORT_R,top:(pp.y-node.y)-PORT_R,width:PORT_R*2,height:PORT_R*2,
          borderRadius:"50%",background:"#222",border:"2px solid #8fd4ff",boxSizing:"border-box",touchAction:"none",
          boxShadow:"0 0 0 3px rgba(143,212,255,0.08)"}}));
        // a small label, only when there's more than one input (so A/B/mask are clear)
        if(def.inputs.length>1){
          inputs.push(React.createElement("div",{key:port+"_l",style:{
            position:"absolute",left:PORT_R+1,top:(pp.y-node.y)-6,fontSize:7,color:"#5b8fb0",
            fontFamily:"monospace",fontWeight:700,pointerEvents:"none",letterSpacing:0.3}},port.toUpperCase()));
        }
      });
      var hasOut=def.cat!=="output";
      nodeEls.push(React.createElement("div",{key:node.id,
        onPointerDown:function(e){onNodePointerDown(e,node);},
        onPointerMove:onMove,onPointerUp:onUp,onPointerCancel:onUp,
        style:{position:"absolute",left:node.x,top:node.y,width:NODE_W,height:NODE_H,
          background:"#161616",border:(node.bypass?"2px dashed #6a5a3a":"2px solid "+(selNode===node.id?"#e8900a":(isSel(node.id)?"#e8900acc":col))),borderRadius:8,
          boxShadow:(selNode===node.id)?"0 0 0 2px #e8900a, 0 0 14px rgba(232,144,10,0.35)":
                    (isSel(node.id)?"0 0 0 2px #e8900acc, 0 0 10px rgba(232,144,10,0.22)":"0 2px 8px rgba(0,0,0,0.5)"),
          opacity:node.bypass?0.55:1,
          cursor:"grab",userSelect:"none",boxSizing:"border-box",touchAction:"none"}},
        React.createElement("div",{style:{padding:"3px 7px",fontSize:9.5,fontFamily:"monospace",fontWeight:700,
          color:col,letterSpacing:0.4,borderBottom:"1px solid #242424",display:"flex",justifyContent:"space-between",alignItems:"center"}},
          React.createElement("span",{style:{display:"flex",alignItems:"center",gap:5}},nodeIcon(node.type,11,col),
            React.createElement("span",null,node.title||nodeLabel(node.type))),
          React.createElement("span",{style:{width:7,height:7,borderRadius:"50%",background:col,flexShrink:0,opacity:0.8}})),
        // large full-width preview of this node's output
        // Selection badge: a thin border is hard to read on a phone, so a
        // selected node also gets a solid corner tick.
        isSel(node.id)?React.createElement("div",{key:"selbadge",style:{position:"absolute",top:-7,right:-7,
          width:19,height:19,borderRadius:"50%",background:"#e8900a",color:"#000",fontSize:11,fontWeight:900,
          fontFamily:"monospace",display:"flex",alignItems:"center",justifyContent:"center",
          border:"2px solid #0d0d0d",pointerEvents:"none",zIndex:3}},"\u2713"):null,
        React.createElement("div",{style:{padding:(def.inputs.length>1?"4px 6px 2px 18px":"4px 6px 2px")}},
          React.createElement("canvas",{width:size,height:size,
            ref:function(nodeId){return function(el){if(el)thumbCanvases.current[nodeId]=el;else delete thumbCanvases.current[nodeId];};}(node.id),
            style:{display:"block",width:THUMB,height:THUMB,borderRadius:3,border:"1px solid #2a2a2a",
              background:"#0a0a0a",imageRendering:pixPerf?"pixelated":"auto"}})),
        React.createElement("div",{style:{fontSize:7.5,color:"#888",fontFamily:"monospace",lineHeight:1.3,overflow:"hidden",
          padding:"0 7px 3px",whiteSpace:"nowrap",textOverflow:"ellipsis"}},
            node.type==="source"?(node.params.layer?node.params.layer.type:"empty"):
            node.type==="blend"?node.params.mode:
            node.type==="adjust"?("b "+(node.params.brightness||0).toFixed(2)):
            node.type==="blur"?("r "+(node.params.radius!=null?node.params.radius:3)):
            node.type==="glow"?("glow "+(node.params.radius||8)):
            node.type==="gradmap"?"gradient":
            node.type==="filter"?((node.params.filters&&node.params.filters.length||0)+" filters"):
            node.type==="warp"?(node.params.warpType||"warp"):
            node.type==="transform"?("s"+(node.params.scale!=null?node.params.scale:1).toFixed(1)+" r"+(node.params.rotate||0)):
            node.type==="mask"?"A/B by mask":
            node.type==="flipbook"?(node.params.sheet&&node.params.sheet.frames&&node.params.sheet.frames.length?
              ((node.params.playing?"\u25b6 ":"")+((Math.round(node.params.offset||0)%node.params.sheet.totalFrames)+1)+"/"+node.params.sheet.totalFrames):"no sheet"):
            node.type==="flipbookPack"?((node.params.cols||5)+"\u00d7"+(node.params.rows||5)+" sheet"):
            node.type==="alphaSplit"?"rgb / r g b a":
            node.type==="alphaMerge"?"rgb + alpha":
            node.type==="output"?"final":""
        ),
        inputs,
        hasOut?(function(){
          var outs=def.outputs||["out"];
          var multi=outs.length>1;
          return outs.map(function(op,oi){
            // distribute ports vertically when there are several; centre when one
            var topY=multi?(NODE_H*(oi+1)/(outs.length+1)):(NODE_H/2);
            return React.createElement("div",{key:"out_"+op,onPointerDown:function(e){onOutPointerDown(e,node,op);},
              onPointerMove:onMove,onPointerUp:onUp,onPointerCancel:onUp,
              title:"drag to connect ("+op+")",style:{position:"absolute",right:-PORT_R-PORT_HIT,top:topY-PORT_R-PORT_HIT,
              width:(PORT_R+PORT_HIT)*2,height:(PORT_R+PORT_HIT)*2,display:"flex",alignItems:"center",justifyContent:"center",
              cursor:"crosshair",touchAction:"none"}},
              React.createElement("div",{style:{width:(multi?PORT_R*1.6:PORT_R*2),height:(multi?PORT_R*1.6:PORT_R*2),borderRadius:"50%",background:"#222",
                border:"2px solid #e8900a",boxSizing:"border-box",pointerEvents:"none"}}),
              // output port label (always show a name)
              React.createElement("div",{style:{position:"absolute",right:(PORT_R+PORT_HIT)*2-2,top:"50%",transform:"translateY(-50%)",
                fontSize:multi?7:6.5,color:"#e8b06a",fontFamily:"monospace",fontWeight:700,pointerEvents:"none",
                background:"rgba(16,16,16,0.85)",padding:"0 2px",borderRadius:2,whiteSpace:"nowrap"}},op.toUpperCase()));
          });
        })():null
      ));
    })(g.nodes[nid]);
  }

  // ── Parameter panel for the selected node ──────────────────────────
  // Update a param on the selected node and re-evaluate.
  function setNodeParam(key,value){
    var nd=g.nodes[selNode]; if(!nd)return;
    nd.params[key]=value; bump();
  }
  // Import a sprite sheet file into a flipbook node: slice cols×rows into frames.
  // Slice a sprite sheet (given a data URL) into cols×rows square frames, then
  // call back with the sheet object. Keeps the source dataURL so the sheet can be
  // re-sliced (grid change) and re-built after save/load without the raw frames.
  function sliceSheet(dataURL,cols,rows,cb){
    var img=new Image();
    img.onload=function(){
      var frameW=Math.round(img.width/cols), frameH=Math.round(img.height/rows);
      var frameSize=Math.min(frameW,frameH);
      var total=cols*rows;
      var off=document.createElement("canvas"); off.width=img.width; off.height=img.height;
      var octx=off.getContext("2d"); octx.drawImage(img,0,0);
      var frames=[];
      for(var fi=0;fi<total;fi++){
        var fc=fi%cols, fr=(fi/cols)|0;
        var fcv=document.createElement("canvas"); fcv.width=fcv.height=frameSize;
        var fctx=fcv.getContext("2d");
        fctx.drawImage(off,fc*frameW,fr*frameH,frameW,frameH,0,0,frameSize,frameSize);
        var id=fctx.getImageData(0,0,frameSize,frameSize);
        var buf=new Float32Array(frameSize*frameSize*4);
        for(var pi=0;pi<frameSize*frameSize;pi++){
          buf[pi*4]=id.data[pi*4]/255;buf[pi*4+1]=id.data[pi*4+1]/255;
          buf[pi*4+2]=id.data[pi*4+2]/255;buf[pi*4+3]=id.data[pi*4+3]/255;
        }
        frames.push(buf);
      }
      // dataURL is kept so save/load and grid changes can rebuild without raw frames
      cb({frames:frames,frameSize:frameSize,cols:cols,rows:rows,totalFrames:total,src:dataURL});
    };
    img.src=dataURL;
  }
  function importFlipbookSheet(nid,file,cols,rows){
    var rd=new FileReader();
    rd.onload=function(e){
      sliceSheet(e.target.result,cols,rows,function(sheet){
        var nd=g.nodes[nid]; if(!nd)return;
        nd.params.sheet=sheet;
        nd.params.cols=cols; nd.params.rows=rows; nd.params.rangeIn=0; nd.params.rangeOut=sheet.totalFrames-1; nd.params.offset=0;
        bump();
      });
    };
    rd.readAsDataURL(file);
  }
  // Re-slice an already-loaded sheet with a new grid (keeps the source image).
  function resliceFlipbook(nid,cols,rows){
    var nd=g.nodes[nid]; if(!nd||!nd.params.sheet||!nd.params.sheet.src)return;
    sliceSheet(nd.params.sheet.src,cols,rows,function(sheet){
      var n2=g.nodes[nid]; if(!n2)return;
      n2.params.sheet=sheet;
      n2.params.cols=cols; n2.params.rows=rows; n2.params.rangeIn=0; n2.params.rangeOut=sheet.totalFrames-1; n2.params.offset=0;
      bump();
    });
  }
  // Grid presets for sprite sheets.
  var FB_GRID_PRESETS=[[4,4],[5,5],[6,6],[7,7],[8,8],[2,2],[3,3],[4,2],[8,4]];

  // After a load (or any time), a flipbook may have a sheet with a source dataURL
  // but no decoded frames (frames are stripped before saving). Detect that and
  // re-slice from the source so playback/baking work again. Runs once per such node.
  var fbHydrating=useRef({});
  useEffect(function(){
    for(var nid in g.nodes){
      var n=g.nodes[nid];
      if(n.type==="flipbook"&&n.params.sheet&&n.params.sheet.src&&
         (!n.params.sheet.frames||!n.params.sheet.frames.length)&&!fbHydrating.current[nid]){
        fbHydrating.current[nid]=true;
        (function(theId,sh){
          sliceSheet(sh.src, sh.cols||5, sh.rows||5, function(sheet){
            var nn=g.nodes[theId]; if(!nn){delete fbHydrating.current[theId];return;}
            nn.params.sheet=sheet; delete fbHydrating.current[theId]; bump();
          });
        })(nid,n.params.sheet);
      }
    }
  },[renderSig]);

  function buildNodePanel(){
    var nd=g.nodes[selNode]; if(!nd)return null;
    var def=NODE_TYPES[nd.type];
    var rows=[];
    // Sticky header: with 10+ parameter rows on some nodes you would otherwise
    // scroll away from the name and the close button.
    rows.push(React.createElement("div",{key:"title",style:{fontSize:10,fontFamily:"monospace",fontWeight:700,
      color:"#e8900a",letterSpacing:0.5,marginBottom:8,textTransform:"uppercase",display:"flex",
      justifyContent:"space-between",alignItems:"center",gap:6,position:"sticky",top:-10,zIndex:2,
      background:"rgba(15,15,15,0.97)",padding:"10px 0 7px",margin:"-10px 0 8px",
      borderBottom:"1px solid #262626"}},
      def.title,
      React.createElement("div",{style:{display:"flex",gap:5,alignItems:"center"}},
        React.createElement("button",{onClick:function(){removeNode(g,nd.id);setSelNode(null);bump();},
          title:"Delete node",style:{background:"none",border:"1px solid #5a2a2a",color:"#c66",borderRadius:3,
          fontSize:8,padding:"2px 6px",cursor:"pointer",fontFamily:"monospace"}},"DELETE"),
        React.createElement("button",{onClick:function(){duplicateNode(nd.id);},
          title:"Duplicate node",style:{background:"none",border:"1px solid #2a4a5a",color:"#7ab",borderRadius:5,
          minHeight:28,fontSize:8.5,padding:"0 9px",cursor:"pointer",fontFamily:"monospace",touchAction:"manipulation",
          display:"inline-flex",alignItems:"center"}},"DUP"),
        (def.cat!=="output"&&def.inputs&&def.inputs.length)?React.createElement("button",{onClick:function(){nd.bypass=!nd.bypass;bump();},
          title:nd.bypass?"Node is bypassed (passes input through). Click to enable.":"Bypass / mute this node",
          style:{background:nd.bypass?"#e8900a":"none",border:"1px solid "+(nd.bypass?"#e8900a":"#5a4a2a"),color:nd.bypass?"#000":"#caa46a",borderRadius:5,
          minHeight:28,fontSize:8.5,padding:"0 9px",cursor:"pointer",fontFamily:"monospace",fontWeight:700,touchAction:"manipulation",
          display:"inline-flex",alignItems:"center"}},nd.bypass?"\u25cb OFF":"BYPASS"):null,
        React.createElement("button",{onClick:function(){setSelNode(null);},
          title:"Close panel",style:{background:"none",border:"1px solid #333",color:"#999",borderRadius:5,
          minHeight:28,minWidth:28,fontSize:13,padding:"0 6px",cursor:"pointer",fontFamily:"monospace",touchAction:"manipulation",
          display:"inline-flex",alignItems:"center",justifyContent:"center"}},"\u00d7"))));

    // Rename row: give the node a custom title (helps organize big graphs).
    rows.push(React.createElement("div",{key:"rename",style:{display:"flex",alignItems:"center",gap:5,marginBottom:9}},
      React.createElement("span",{style:{fontSize:7.5,color:"#777",fontFamily:"monospace",letterSpacing:0.5,minWidth:34}},"NAME"),
      React.createElement("input",{type:"text",value:nd.title||"",placeholder:def.title,
        onChange:function(ev){
          var v=ev.target.value;
          if(v)nd.title=v; else delete nd.title;
          setGraph(Object.assign({},g)); setTick(function(t){return t+1;}); // redraw only, no re-eval
        },
        style:{flex:1,minWidth:0,background:"#0f0f0f",border:"1px solid #2a2a2a",borderRadius:4,color:"#ddd",
          fontSize:9,fontFamily:"monospace",padding:"4px 6px",outline:"none"}}),
      nd.title?React.createElement("button",{onClick:function(){delete nd.title;setGraph(Object.assign({},g));setTick(function(t){return t+1;});},
        title:"Reset to default name",
        style:{background:"none",border:"1px solid #333",color:"#999",borderRadius:3,fontSize:8,padding:"3px 5px",cursor:"pointer",fontFamily:"monospace"}},"\u21ba"):null));

    // Keyframe section: when the timeline is open, list this node's numeric params
    // with a diamond to keyframe each at the current time. This makes ALL numeric
    // parameters animatable without rewriting every control.
    if(showTimeline){
      var animKeys=[];
      for(var pk in nd.params){var pv=nd.params[pk]; if(typeof pv==="number")animKeys.push(pk);}
      rows.push(React.createElement("div",{key:"kfsec",style:{marginBottom:9,padding:"7px 8px",background:"#16121c",
        border:"1px solid #3a2f4a",borderRadius:6}},
        React.createElement("div",{style:{fontSize:7.5,color:"#c9a0ff",fontFamily:"monospace",fontWeight:700,letterSpacing:0.5,marginBottom:5}},"KEYFRAMES @ "+animTime.toFixed(2)+"s"),
        animKeys.length?animKeys.map(function(key){
          var on=hasKeyframes(nd.id,key);
          return React.createElement("div",{key:key,style:{display:"flex",alignItems:"center",justifyContent:"space-between",gap:6,marginBottom:5}},
            React.createElement("span",{style:{fontSize:8.5,color:"#aaa",fontFamily:"monospace"}},key+" = "+(typeof nd.params[key]==="number"?nd.params[key].toFixed(2):nd.params[key])),
            React.createElement("div",{style:{display:"flex",gap:3}},
              React.createElement("button",{onClick:function(){var kk=key;addKeyframe(nd.id,kk,nd.params[kk]);},title:"Add keyframe here",
                style:{fontSize:11,minWidth:30,minHeight:26,padding:"0 6px",background:on?"#e8900a":"#241c30",color:on?"#000":"#c9a0ff",
                  border:"1px solid "+(on?"#e8900a":"#4a3a5a"),borderRadius:5,cursor:"pointer",fontFamily:"monospace",
                  touchAction:"manipulation",display:"inline-flex",alignItems:"center",justifyContent:"center"}},"\u25c8"),
              on?React.createElement("button",{onClick:function(){var kk=key;removeKeyframesFor(nd.id,kk);},title:"Clear keyframes",
                style:{fontSize:11,minWidth:26,minHeight:26,padding:"0 5px",background:"none",color:"#a66",border:"1px solid #5a2a2a",
                  borderRadius:5,cursor:"pointer",fontFamily:"monospace",touchAction:"manipulation",
                  display:"inline-flex",alignItems:"center",justifyContent:"center"}},"\u00d7"):null));
        }):React.createElement("div",{style:{fontSize:7.5,color:"#777",fontFamily:"monospace"}},"No numeric parameters on this node.")));
    }

    // reusable colour pickers for the generator nodes
    var COLOR_FG=React.createElement("div",{key:"color",style:{display:"flex",alignItems:"center",gap:6,marginTop:5}},React.createElement("span",{style:{fontSize:8,color:"#999",fontFamily:"monospace",minWidth:52}},"Color"),React.createElement("input",{type:"color",value:nd.params.color||"#ffffff",onChange:function(ev){setNodeParam("color",ev.target.value);},style:{width:36,height:26,background:"none",border:"1px solid #333",borderRadius:4,cursor:"pointer"}}));
    var COLOR_BG=React.createElement("div",{key:"bgColor",style:{display:"flex",alignItems:"center",gap:6,marginTop:5}},React.createElement("span",{style:{fontSize:8,color:"#999",fontFamily:"monospace",minWidth:52}},"Background"),React.createElement("input",{type:"color",value:nd.params.bgColor||"#000000",onChange:function(ev){setNodeParam("bgColor",ev.target.value);},style:{width:36,height:26,background:"none",border:"1px solid #333",borderRadius:4,cursor:"pointer"}}));
    var COLOR_A=React.createElement("div",{key:"colorA",style:{display:"flex",alignItems:"center",gap:6,marginTop:5}},React.createElement("span",{style:{fontSize:8,color:"#999",fontFamily:"monospace",minWidth:52}},"Color A"),React.createElement("input",{type:"color",value:nd.params.colorA||"#000000",onChange:function(ev){setNodeParam("colorA",ev.target.value);},style:{width:36,height:26,background:"none",border:"1px solid #333",borderRadius:4,cursor:"pointer"}}));
    var COLOR_B=React.createElement("div",{key:"colorB",style:{display:"flex",alignItems:"center",gap:6,marginTop:5}},React.createElement("span",{style:{fontSize:8,color:"#999",fontFamily:"monospace",minWidth:52}},"Color B"),React.createElement("input",{type:"color",value:nd.params.colorB||"#ffffff",onChange:function(ev){setNodeParam("colorB",ev.target.value);},style:{width:36,height:26,background:"none",border:"1px solid #333",borderRadius:4,cursor:"pointer"}}));
    if(nd.type==="source"){
      // The full layer panel for a Source opens in the side panel (all noise
      // types, parameters, filters and warps). Here we just show a hint.
      rows.push(React.createElement("div",{key:"hint",style:{fontSize:8,color:"#888",fontFamily:"monospace",lineHeight:1.6}},
        (nd.params.layer?("Noise: "+(nd.params.layer.type||"fbm")):"empty")+". Full controls are in the side panel \u2192"));
    }
    else if(nd.type==="blend"){
      rows.push(React.createElement(Sel,{key:"mode",label:"Blend Mode",value:nd.params.mode||"normal",
        opts:BM.map(function(m){return {v:m,l:m};}),onChange:function(v){setNodeParam("mode",v);}}));
      rows.push(React.createElement(Slider,{key:"op",label:"Opacity",value:nd.params.opacity!=null?nd.params.opacity:1,min:0,max:1,step:0.01,
        fmt:function(v){return Math.round(v*100)+"%";},onChange:function(v){setNodeParam("opacity",v);}}));
      rows.push(React.createElement("div",{key:"hint",style:{fontSize:8,color:"#666",fontFamily:"monospace",lineHeight:1.5,marginTop:4}},
        "Input A blends over input B."));
    }
    else if(nd.type==="adjust"){
      rows.push(React.createElement(Slider,{key:"br",label:"Brightness",value:nd.params.brightness||0,min:-0.5,max:0.5,step:0.01,
        onChange:function(v){setNodeParam("brightness",v);}}));
      rows.push(React.createElement(Slider,{key:"con",label:"Contrast",value:nd.params.contrast!=null?nd.params.contrast:1,min:0,max:3,step:0.02,
        onChange:function(v){setNodeParam("contrast",v);}}));
      rows.push(React.createElement(Slider,{key:"sat",label:"Saturation",value:nd.params.saturation!=null?nd.params.saturation:1,min:0,max:3,step:0.02,
        onChange:function(v){setNodeParam("saturation",v);}}));
      rows.push(React.createElement(Slider,{key:"hue",label:"Hue",value:nd.params.hue||0,min:-180,max:180,step:1,
        onChange:function(v){setNodeParam("hue",Math.round(v));}}));
      rows.push(React.createElement(Slider,{key:"gam",label:"Gamma",value:nd.params.gamma!=null?nd.params.gamma:1,min:0.2,max:3,step:0.02,
        onChange:function(v){setNodeParam("gamma",v);}}));
      rows.push(React.createElement("div",{key:"inv",style:{display:"flex",alignItems:"center",gap:8,marginTop:6},
        onClick:function(){setNodeParam("invert",!nd.params.invert);}},
        React.createElement("div",{style:{width:28,height:16,borderRadius:8,background:nd.params.invert?"#e8900a":"#252525",
          cursor:"pointer",position:"relative",flexShrink:0}},
          React.createElement("div",{style:{position:"absolute",width:12,height:12,borderRadius:6,background:"#fff",top:2,left:nd.params.invert?14:2,transition:"left 0.15s"}})),
        React.createElement("span",{style:{fontSize:9,color:"#aaa",fontFamily:"monospace",cursor:"pointer"}},"Invert")));
    }
    else if(nd.type==="blur"){
      rows.push(React.createElement(Slider,{key:"r",label:"Radius",value:nd.params.radius||3,min:0,max:30,step:1,
        onChange:function(v){setNodeParam("radius",Math.round(v));}}));
      rows.push(React.createElement("div",{key:"hint",style:{fontSize:8,color:"#666",fontFamily:"monospace",lineHeight:1.5,marginTop:4}},
        "Gaussian blur. 0 = off."));
    }
    else if(nd.type==="glow"){
      rows.push(React.createElement(Slider,{key:"r",label:"Radius",value:nd.params.radius||8,min:1,max:40,step:1,
        onChange:function(v){setNodeParam("radius",Math.round(v));}}));
      rows.push(React.createElement(Slider,{key:"int",label:"Intensity",value:nd.params.intensity!=null?nd.params.intensity:0.8,min:0,max:2,step:0.05,
        onChange:function(v){setNodeParam("intensity",v);}}));
      rows.push(React.createElement(Slider,{key:"thr",label:"Threshold",value:nd.params.threshold||0,min:0,max:1,step:0.02,
        onChange:function(v){setNodeParam("threshold",v);}}));
      rows.push(React.createElement("div",{key:"hint",style:{fontSize:8,color:"#666",fontFamily:"monospace",lineHeight:1.5,marginTop:4}},
        "Bloom on bright areas above the threshold."));
    }
    else if(nd.type==="gradmap"){
      var gmRow=function(label,key,val){
        return React.createElement("div",{key:key,style:{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:7}},
          React.createElement("span",{style:{fontSize:9,color:"#999",fontFamily:"monospace"}},label),
          React.createElement("input",{type:"color",value:val||"#000000",
            onChange:function(e){setNodeParam(key,e.target.value);},
            style:{width:38,height:22,border:"1px solid #333",borderRadius:3,background:"none",cursor:"pointer",padding:0}}));
      };
      // mode toggle: simple (A / mid / B) vs full multi-stop gradient
      rows.push(React.createElement("div",{key:"modetog",style:{display:"flex",gap:4,marginBottom:9}},
        ["Simple","Gradient"].map(function(lbl,idx){
          var on=(idx===1)===!!nd.params.useStops;
          return React.createElement("button",{key:lbl,onClick:function(){setNodeParam("useStops",idx===1);},
            style:{flex:1,padding:"5px 0",fontSize:8.5,fontFamily:"monospace",fontWeight:700,letterSpacing:0.3,
              background:on?"#e8900a":"#161616",color:on?"#000":"#888",
              border:"1px solid "+(on?"#e8900a":"#2a2a2a"),borderRadius:4,cursor:"pointer",touchAction:"manipulation"}},lbl);
        })));
      if(nd.params.useStops){
        // full multi-stop gradient editor (reuses GradientRamp)
        rows.push(React.createElement(GradientRamp,{key:"ramp",stops:nd.params.colorStops||[{pos:0,color:"#000000"},{pos:1,color:"#ffffff"}],
          onChange:function(ns){setNodeParam("colorStops",ns);},onCommit:function(){}}));
      } else {
        rows.push(gmRow("Low (dark)","colorA",nd.params.colorA));
        if(nd.params.colorMid)rows.push(gmRow("Mid","colorMid",nd.params.colorMid));
        rows.push(gmRow("High (bright)","colorB",nd.params.colorB));
        rows.push(React.createElement("div",{key:"midtog",style:{display:"flex",alignItems:"center",gap:8,marginTop:2},
          onClick:function(){setNodeParam("colorMid",nd.params.colorMid?null:"#ff4400");}},
          React.createElement("div",{style:{width:28,height:16,borderRadius:8,background:nd.params.colorMid?"#e8900a":"#252525",
            cursor:"pointer",position:"relative",flexShrink:0}},
            React.createElement("div",{style:{position:"absolute",width:12,height:12,borderRadius:6,background:"#fff",top:2,left:nd.params.colorMid?14:2,transition:"left 0.15s"}})),
          React.createElement("span",{style:{fontSize:9,color:"#aaa",fontFamily:"monospace",cursor:"pointer"}},"Use mid colour")));
      }
      rows.push(React.createElement("div",{key:"hint",style:{fontSize:8,color:"#666",fontFamily:"monospace",lineHeight:1.5,marginTop:6}},
        "Maps brightness to a colour ramp. Great for fire, energy, toxic looks."));
    }
    else if(nd.type==="warp"){
      var WARP_TYPES=[
        {v:"fbmNoise",l:"fBm Warp"},{v:"noise",l:"Perlin Warp"},{v:"ridged",l:"Ridged Warp"},
        {v:"turbulence",l:"Turbulence"},{v:"voronoi",l:"Voronoi Warp"},{v:"radial",l:"Radial Push/Pull"},
        {v:"directional",l:"Directional"},{v:"multidirectional",l:"Multidirectional"},{v:"swirl",l:"Swirl"},
        {v:"twist",l:"Twist"},{v:"pinch",l:"Pinch"},{v:"bulge",l:"Bulge"},{v:"ripple",l:"Ripple"},{v:"fisheye",l:"Fisheye"}
      ];
      rows.push(React.createElement(Sel,{key:"wt",label:"Warp Type",value:nd.params.warpType||"fbmNoise",opts:WARP_TYPES,
        onChange:function(v){setNodeParam("warpType",v);}}));
      rows.push(React.createElement(Slider,{key:"amt",label:"Amount",value:nd.params.amount!=null?nd.params.amount:0.1,min:0,max:0.6,step:0.005,
        onChange:function(v){setNodeParam("amount",v);}}));
      rows.push(React.createElement(Slider,{key:"fr",label:"Frequency",value:nd.params.freq||3,min:0.5,max:16,step:0.1,
        onChange:function(v){setNodeParam("freq",v);}}));
      rows.push(React.createElement(Slider,{key:"sd",label:"Seed",value:nd.params.seed||1234,min:0,max:9999,step:1,
        onChange:function(v){setNodeParam("seed",Math.round(v));}}));
      rows.push(React.createElement("button",{key:"rs",onClick:function(){setNodeParam("seed",(Math.random()*9999)|0);},
        style:{width:"100%",padding:"5px",fontSize:8.5,fontFamily:"monospace",background:"#161616",color:"#d0a060",
        border:"1px solid #4a3a2a",borderRadius:4,cursor:"pointer",marginTop:4}},"\u21bb New Seed"));
    }
    else if(nd.type==="transform"){
      rows.push(React.createElement(Sel,{key:"smp",label:"Sampling",value:nd.params.sampling||"linear",
        opts:[{v:"linear",l:"Linear (smooth)"},{v:"point",l:"Point / Nearest (crisp)"}],
        onChange:function(v){setNodeParam("sampling",v);}}));
      rows.push(React.createElement(Slider,{key:"sc",label:"Scale",value:nd.params.scale!=null?nd.params.scale:1,min:0.1,max:4,step:0.02,
        onChange:function(v){setNodeParam("scale",v);}}));
      rows.push(React.createElement(Slider,{key:"tile",label:"Tiling",value:nd.params.tile||1,min:1,max:8,step:1,
        onChange:function(v){setNodeParam("tile",Math.round(v));}}));
      rows.push(React.createElement(Slider,{key:"rot",label:"Rotate",value:nd.params.rotate||0,min:0,max:360,step:1,
        onChange:function(v){setNodeParam("rotate",Math.round(v));}}));
      rows.push(React.createElement(Slider,{key:"ofx",label:"Offset X",value:nd.params.offsetX||0,min:-1,max:1,step:0.01,
        onChange:function(v){setNodeParam("offsetX",v);}}));
      rows.push(React.createElement(Slider,{key:"ofy",label:"Offset Y",value:nd.params.offsetY||0,min:-1,max:1,step:0.01,
        onChange:function(v){setNodeParam("offsetY",v);}}));
      var mkToggle=function(label,key){
        return React.createElement("div",{key:key,style:{display:"flex",alignItems:"center",gap:8,marginTop:6},
          onClick:function(){setNodeParam(key,!nd.params[key]);}},
          React.createElement("div",{style:{width:28,height:16,borderRadius:8,background:nd.params[key]?"#e8900a":"#252525",
            cursor:"pointer",position:"relative",flexShrink:0}},
            React.createElement("div",{style:{position:"absolute",width:12,height:12,borderRadius:6,background:"#fff",top:2,left:nd.params[key]?14:2,transition:"left 0.15s"}})),
          React.createElement("span",{style:{fontSize:9,color:"#aaa",fontFamily:"monospace",cursor:"pointer"}},label));
      };
      rows.push(mkToggle("Mirror X","mirrorX"));
      rows.push(mkToggle("Mirror Y","mirrorY"));
      rows.push(React.createElement("div",{key:"hint",style:{fontSize:8,color:"#666",fontFamily:"monospace",lineHeight:1.5,marginTop:6}},
        "Seamless wrap keeps the result tileable."));
    }
    else if(nd.type==="mask"){
      rows.push(React.createElement(Slider,{key:"mc",label:"Mask Contrast",value:nd.params.maskContrast!=null?nd.params.maskContrast:1,min:0.2,max:5,step:0.05,
        onChange:function(v){setNodeParam("maskContrast",v);}}));
      rows.push(React.createElement("div",{key:"im",style:{display:"flex",alignItems:"center",gap:8,marginTop:6},
        onClick:function(){setNodeParam("invertMask",!nd.params.invertMask);}},
        React.createElement("div",{style:{width:28,height:16,borderRadius:8,background:nd.params.invertMask?"#e8900a":"#252525",
          cursor:"pointer",position:"relative",flexShrink:0}},
          React.createElement("div",{style:{position:"absolute",width:12,height:12,borderRadius:6,background:"#fff",top:2,left:nd.params.invertMask?14:2,transition:"left 0.15s"}})),
        React.createElement("span",{style:{fontSize:9,color:"#aaa",fontFamily:"monospace",cursor:"pointer"}},"Invert mask")));
      rows.push(React.createElement("div",{key:"hint",style:{fontSize:8,color:"#888",fontFamily:"monospace",lineHeight:1.6,marginTop:6}},
        "Picks A or B per pixel by the Mask input. White = A, black = B. Contrast sharpens the transition."));
    }
    else if(nd.type==="flipbook"){
      var fbp=nd.params; var sheet=fbp.sheet;
      // import button (file input)
      rows.push(React.createElement("label",{key:"imp",style:{display:"block",padding:"7px 0",textAlign:"center",fontSize:9,
        fontFamily:"monospace",fontWeight:700,background:"#1b2a1b",color:"#9fe080",border:"1px solid #2f4a2f",
        borderRadius:5,cursor:"pointer",marginBottom:8}},
        sheet?"Replace sheet\u2026":"Import sprite sheet\u2026",
        React.createElement("input",{type:"file",accept:"image/*",style:{display:"none"},
          onChange:function(e){var f=e.target.files&&e.target.files[0];if(f)importFlipbookSheet(nd.id,f,nd.params.cols||5,nd.params.rows||5);}})));
      // grid presets
      rows.push(React.createElement("div",{key:"glbl",style:{fontSize:8,color:"#888",fontFamily:"monospace",marginBottom:3}},"Grid (cols \u00d7 rows)"));
      rows.push(React.createElement("div",{key:"grid",style:{display:"flex",flexWrap:"wrap",gap:3,marginBottom:8}},
        FB_GRID_PRESETS.map(function(gp){
          var act=(nd.params.cols===gp[0]&&nd.params.rows===gp[1]);
          return React.createElement("button",{key:gp.join("x"),onClick:function(){
              if(nd.params.sheet&&nd.params.sheet.src){ resliceFlipbook(nd.id,gp[0],gp[1]); }
              else { setNodeParam("cols",gp[0]); var nd2=g.nodes[nd.id]; nd2.params.rows=gp[1]; bump(); }
            },
            style:{padding:"4px 7px",fontSize:8,fontFamily:"monospace",background:act?"#e8900a":"#161616",
              color:act?"#000":"#aaa",border:"1px solid "+(act?"#e8900a":"#2a2a2a"),borderRadius:4,cursor:"pointer"}},
            gp[0]+"\u00d7"+gp[1]);
        })));
      if(sheet){
        rows.push(React.createElement("div",{key:"info",style:{fontSize:8,color:"#777",fontFamily:"monospace",marginBottom:6}},
          sheet.totalFrames+" frames \u00b7 "+sheet.frameSize+"px"));
        // playback
        rows.push(React.createElement("div",{key:"playrow",style:{display:"flex",gap:5,marginBottom:8}},
          React.createElement("button",{onClick:function(){setNodeParam("playing",!nd.params.playing);},
            style:{flex:1,padding:"6px 0",fontSize:9,fontFamily:"monospace",fontWeight:700,
              background:nd.params.playing?"#e8900a":"#161616",color:nd.params.playing?"#000":"#aaa",
              border:"1px solid "+(nd.params.playing?"#e8900a":"#2a2a2a"),borderRadius:4,cursor:"pointer"}},
            nd.params.playing?"\u275a\u275a Pause":"\u25b6 Play")));
        rows.push(React.createElement(Slider,{key:"fps",label:"FPS",value:nd.params.fps||24,min:1,max:60,step:1,
          onChange:function(v){setNodeParam("fps",Math.round(v));}}));
        rows.push(React.createElement(Slider,{key:"off",label:"Frame",value:((Math.round(nd.params.offset||0))%sheet.totalFrames),min:0,max:Math.max(0,sheet.totalFrames-1),step:1,
          onChange:function(v){setNodeParam("playing",false);setNodeParam("offset",Math.round(v));}}));
        rows.push(React.createElement(Slider,{key:"ri",label:"Range In",value:nd.params.rangeIn||0,min:0,max:Math.max(0,sheet.totalFrames-1),step:1,
          onChange:function(v){setNodeParam("rangeIn",Math.round(v));}}));
        rows.push(React.createElement(Slider,{key:"ro",label:"Range Out",value:nd.params.rangeOut!=null?nd.params.rangeOut:sheet.totalFrames-1,min:0,max:Math.max(0,sheet.totalFrames-1),step:1,
          onChange:function(v){setNodeParam("rangeOut",Math.round(v));}}));
        rows.push(React.createElement(Slider,{key:"step",label:"Frame Step",value:nd.params.frameStep||1,min:1,max:8,step:1,
          onChange:function(v){setNodeParam("frameStep",Math.round(v));}}));
        rows.push(React.createElement(Sel,{key:"pm",label:"Play Mode",value:nd.params.playMode||"forward",
          opts:[{v:"forward",l:"Forward"},{v:"reverse",l:"Reverse"},{v:"pingpong",l:"Ping-pong"}],
          onChange:function(v){setNodeParam("playMode",v);}}));
      }
      rows.push(React.createElement("div",{key:"hint",style:{fontSize:8,color:"#666",fontFamily:"monospace",lineHeight:1.5,marginTop:6}},
        "Outputs the current frame. Add nodes after it to edit every frame, then feed a Flipbook Pack to re-tile."));
    }
    else if(nd.type==="flipbookPack"){
      rows.push(React.createElement(Slider,{key:"c",label:"Columns",value:nd.params.cols||5,min:1,max:12,step:1,
        onChange:function(v){setNodeParam("cols",Math.round(v));}}));
      rows.push(React.createElement(Slider,{key:"r",label:"Rows",value:nd.params.rows||5,min:1,max:12,step:1,
        onChange:function(v){setNodeParam("rows",Math.round(v));}}));
      rows.push(React.createElement("button",{key:"bake",onClick:function(){if(p.onBakeFlipbook)p.onBakeFlipbook(nd.id);},
        style:{width:"100%",padding:"8px 0",fontSize:9,fontFamily:"monospace",fontWeight:700,marginTop:8,
          background:"#e8900a",color:"#000",border:"none",borderRadius:5,cursor:"pointer"}},"\u2193 Bake & Export Sheet"));
      rows.push(React.createElement("div",{key:"hint",style:{fontSize:8,color:"#666",fontFamily:"monospace",lineHeight:1.5,marginTop:6}},
        "Re-evaluates every frame through your graph and tiles them into a sheet, then exports it as PNG."));
    }
    else if(nd.type==="shape"){
      rows.push(React.createElement(Sel,{key:"sh",label:"Shape",value:nd.params.shape||"circle",
        opts:[{v:"circle",l:"Circle"},{v:"square",l:"Square"},{v:"diamond",l:"Diamond"},{v:"polygon",l:"Polygon"},
              {v:"star",l:"Star"},{v:"ring",l:"Ring"},{v:"cross",l:"Cross"},{v:"capsule",l:"Capsule"}],
        onChange:function(v){setNodeParam("shape",v);}}));
      rows.push(React.createElement(Slider,{key:"sz",label:"Size",value:nd.params.size!=null?nd.params.size:0.6,min:0.02,max:1.6,step:0.01,onChange:function(v){setNodeParam("size",v);}}));
      rows.push(React.createElement(Slider,{key:"as",label:"Aspect",value:nd.params.aspect!=null?nd.params.aspect:1,min:0.1,max:4,step:0.02,onChange:function(v){setNodeParam("aspect",v);}}));
      rows.push(React.createElement(Slider,{key:"ro",label:"Rotation",value:nd.params.rotation||0,min:0,max:360,step:1,fmt:function(v){return Math.round(v)+"\u00b0";},onChange:function(v){setNodeParam("rotation",v);}}));
      if(nd.params.shape==="polygon"||nd.params.shape==="star")
        rows.push(React.createElement(Slider,{key:"sd",label:"Sides",value:nd.params.sides!=null?nd.params.sides:5,min:3,max:16,step:1,fmt:function(v){return Math.round(v)+"";},onChange:function(v){setNodeParam("sides",Math.round(v));}}));
      if(nd.params.shape==="star"||nd.params.shape==="ring")
        rows.push(React.createElement(Slider,{key:"in",label:nd.params.shape==="ring"?"Hole":"Inner",value:nd.params.inner!=null?nd.params.inner:0.5,min:0.02,max:0.98,step:0.01,onChange:function(v){setNodeParam("inner",v);}}));
      if(nd.params.shape==="cross"||nd.params.shape==="capsule")
        rows.push(React.createElement(Slider,{key:"tk",label:"Thickness",value:nd.params.thickness!=null?nd.params.thickness:0.3,min:0.02,max:0.98,step:0.01,onChange:function(v){setNodeParam("thickness",v);}}));
      rows.push(React.createElement(Slider,{key:"ft",label:"Feather",value:nd.params.feather!=null?nd.params.feather:0.01,min:0,max:0.5,step:0.005,onChange:function(v){setNodeParam("feather",v);}}));
      rows.push(React.createElement(Slider,{key:"px",label:"Pos X",value:nd.params.x!=null?nd.params.x:0.5,min:-0.5,max:1.5,step:0.01,onChange:function(v){setNodeParam("x",v);}}));
      rows.push(React.createElement(Slider,{key:"py",label:"Pos Y",value:nd.params.y!=null?nd.params.y:0.5,min:-0.5,max:1.5,step:0.01,onChange:function(v){setNodeParam("y",v);}}));
      rows.push(React.createElement(Tog,{key:"iv",label:"Invert",value:!!nd.params.invert,onChange:function(v){setNodeParam("invert",v);}}));
      rows.push(React.createElement(Tog,{key:"tr",label:"Transparent BG",value:!!nd.params.transparent,onChange:function(v){setNodeParam("transparent",v);}}));
      rows.push(COLOR_FG);
      if(!nd.params.transparent)rows.push(COLOR_BG);
    }
    else if(nd.type==="gradient"){
      rows.push(React.createElement(Sel,{key:"gt",label:"Type",value:nd.params.gradType||"linear",
        opts:[{v:"linear",l:"Linear"},{v:"radial",l:"Radial"},{v:"angular",l:"Angular"},{v:"diamond",l:"Diamond"}],
        onChange:function(v){setNodeParam("gradType",v);}}));
      rows.push(React.createElement(Slider,{key:"an",label:"Angle",value:nd.params.angle||0,min:0,max:360,step:1,fmt:function(v){return Math.round(v)+"\u00b0";},onChange:function(v){setNodeParam("angle",v);}}));
      rows.push(React.createElement(Slider,{key:"sc",label:"Scale",value:nd.params.scale!=null?nd.params.scale:1,min:0.05,max:4,step:0.01,onChange:function(v){setNodeParam("scale",v);}}));
      rows.push(React.createElement(Slider,{key:"rp",label:"Repeat",value:nd.params.repeat||1,min:1,max:12,step:1,fmt:function(v){return Math.round(v)+"\u00d7";},onChange:function(v){setNodeParam("repeat",Math.round(v));}}));
      rows.push(React.createElement(Slider,{key:"px",label:"Center X",value:nd.params.x!=null?nd.params.x:0.5,min:0,max:1,step:0.01,onChange:function(v){setNodeParam("x",v);}}));
      rows.push(React.createElement(Slider,{key:"py",label:"Center Y",value:nd.params.y!=null?nd.params.y:0.5,min:0,max:1,step:0.01,onChange:function(v){setNodeParam("y",v);}}));
      rows.push(React.createElement(Tog,{key:"mi",label:"Mirror",value:!!nd.params.mirror,onChange:function(v){setNodeParam("mirror",v);}}));
      rows.push(React.createElement(Tog,{key:"iv",label:"Invert",value:!!nd.params.invert,onChange:function(v){setNodeParam("invert",v);}}));
      rows.push(COLOR_A); rows.push(COLOR_B);
    }
    else if(nd.type==="checker"){
      rows.push(React.createElement(Slider,{key:"tx",label:"Tiles X",value:nd.params.tilesX!=null?nd.params.tilesX:8,min:1,max:64,step:1,fmt:function(v){return Math.round(v)+"";},onChange:function(v){setNodeParam("tilesX",Math.round(v));}}));
      rows.push(React.createElement(Slider,{key:"ty",label:"Tiles Y",value:nd.params.tilesY!=null?nd.params.tilesY:8,min:1,max:64,step:1,fmt:function(v){return Math.round(v)+"";},onChange:function(v){setNodeParam("tilesY",Math.round(v));}}));
      rows.push(COLOR_A); rows.push(COLOR_B);
    }
    else if(nd.type==="stripes"){
      rows.push(React.createElement(Slider,{key:"ct",label:"Count",value:nd.params.count!=null?nd.params.count:8,min:1,max:64,step:1,fmt:function(v){return Math.round(v)+"";},onChange:function(v){setNodeParam("count",Math.round(v));}}));
      rows.push(React.createElement(Slider,{key:"an",label:"Angle",value:nd.params.angle||0,min:0,max:360,step:1,fmt:function(v){return Math.round(v)+"\u00b0";},onChange:function(v){setNodeParam("angle",v);}}));
      rows.push(React.createElement(Slider,{key:"wd",label:"Width",value:nd.params.width!=null?nd.params.width:0.5,min:0.02,max:0.98,step:0.01,onChange:function(v){setNodeParam("width",v);}}));
      rows.push(React.createElement(Slider,{key:"sf",label:"Softness",value:nd.params.softness||0,min:0,max:0.5,step:0.005,onChange:function(v){setNodeParam("softness",v);}}));
      rows.push(COLOR_A); rows.push(COLOR_B);
    }
    else if(nd.type==="bricks"){
      rows.push(React.createElement(Slider,{key:"cl",label:"Columns",value:nd.params.cols!=null?nd.params.cols:4,min:1,max:32,step:1,fmt:function(v){return Math.round(v)+"";},onChange:function(v){setNodeParam("cols",Math.round(v));}}));
      rows.push(React.createElement(Slider,{key:"rw",label:"Rows",value:nd.params.rows!=null?nd.params.rows:8,min:1,max:32,step:1,fmt:function(v){return Math.round(v)+"";},onChange:function(v){setNodeParam("rows",Math.round(v));}}));
      rows.push(React.createElement(Slider,{key:"mo",label:"Mortar",value:nd.params.mortar!=null?nd.params.mortar:0.06,min:0,max:0.4,step:0.005,onChange:function(v){setNodeParam("mortar",v);}}));
      rows.push(React.createElement(Slider,{key:"of",label:"Row Offset",value:nd.params.offset!=null?nd.params.offset:0.5,min:0,max:1,step:0.01,onChange:function(v){setNodeParam("offset",v);}}));
      rows.push(React.createElement(Slider,{key:"bv",label:"Bevel",value:nd.params.bevel!=null?nd.params.bevel:0.1,min:0,max:0.5,step:0.005,onChange:function(v){setNodeParam("bevel",v);}}));
      rows.push(COLOR_A); rows.push(COLOR_B);
    }
    else if(nd.type==="polar"){
      rows.push(React.createElement(Sel,{key:"md",label:"Mode",value:nd.params.mode||"toPolar",
        opts:[{v:"toPolar",l:"To Polar (rays)"},{v:"toCartesian",l:"To Cartesian (wrap)"}],
        onChange:function(v){setNodeParam("mode",v);}}));
      rows.push(React.createElement(Slider,{key:"sp",label:"Spin",value:nd.params.spin||0,min:0,max:360,step:1,fmt:function(v){return Math.round(v)+"\u00b0";},onChange:function(v){setNodeParam("spin",v);}}));
      rows.push(React.createElement(Slider,{key:"zm",label:"Zoom",value:nd.params.zoom!=null?nd.params.zoom:1,min:0.1,max:4,step:0.02,onChange:function(v){setNodeParam("zoom",v);}}));
      rows.push(React.createElement(Slider,{key:"rp",label:"Repeat",value:nd.params.repeat||1,min:1,max:16,step:1,fmt:function(v){return Math.round(v)+"\u00d7";},onChange:function(v){setNodeParam("repeat",Math.round(v));}}));
      rows.push(React.createElement(Slider,{key:"px",label:"Center X",value:nd.params.x!=null?nd.params.x:0.5,min:0,max:1,step:0.01,onChange:function(v){setNodeParam("x",v);}}));
      rows.push(React.createElement(Slider,{key:"py",label:"Center Y",value:nd.params.y!=null?nd.params.y:0.5,min:0,max:1,step:0.01,onChange:function(v){setNodeParam("y",v);}}));
      rows.push(React.createElement("div",{key:"hint",style:{fontSize:8,color:"#888",fontFamily:"monospace",lineHeight:1.6}},
        "Feed it Stripes to get a starburst, or a Gradient to get a tunnel."));
    }
    else if(nd.type==="mirror"){
      rows.push(React.createElement(Sel,{key:"md",label:"Mode",value:nd.params.mode||"x",
        opts:[{v:"x",l:"Mirror X"},{v:"y",l:"Mirror Y"},{v:"xy",l:"Mirror Both"},{v:"diagonal",l:"Diagonal"},{v:"kaleido",l:"Kaleidoscope"}],
        onChange:function(v){setNodeParam("mode",v);}}));
      rows.push(React.createElement("div",{key:"hint",style:{fontSize:8,color:"#888",fontFamily:"monospace",lineHeight:1.6}},
        "Folds the image onto itself. Kaleidoscope gives a symmetric tile that repeats cleanly."));
    }
    else if(nd.type==="offsetnode"){
      rows.push(React.createElement(Slider,{key:"ox",label:"Offset X",value:nd.params.offsetX!=null?nd.params.offsetX:0.5,min:0,max:1,step:0.01,onChange:function(v){setNodeParam("offsetX",v);}}));
      rows.push(React.createElement(Slider,{key:"oy",label:"Offset Y",value:nd.params.offsetY!=null?nd.params.offsetY:0.5,min:0,max:1,step:0.01,onChange:function(v){setNodeParam("offsetY",v);}}));
      rows.push(React.createElement("div",{key:"hint",style:{fontSize:8,color:"#888",fontFamily:"monospace",lineHeight:1.6}},
        "Shifts with wrap-around. At 0.5/0.5 any seam in a tiling texture lands in the middle where you can see it."));
    }
    else if(nd.type==="dirblur"){
      rows.push(React.createElement(Slider,{key:"an",label:"Angle",value:nd.params.angle||0,min:0,max:360,step:1,fmt:function(v){return Math.round(v)+"\u00b0";},onChange:function(v){setNodeParam("angle",v);}}));
      rows.push(React.createElement(Slider,{key:"ln",label:"Length",value:nd.params.length!=null?nd.params.length:8,min:0,max:64,step:1,fmt:function(v){return Math.round(v)+"px";},onChange:function(v){setNodeParam("length",Math.round(v));}}));
      rows.push(React.createElement(Slider,{key:"sm",label:"Samples",value:nd.params.samples!=null?nd.params.samples:12,min:2,max:48,step:1,fmt:function(v){return Math.round(v)+"";},onChange:function(v){setNodeParam("samples",Math.round(v));}}));
      rows.push(React.createElement(Tog,{key:"wr",label:"Wrap (tileable)",value:!!nd.params.wrap,onChange:function(v){setNodeParam("wrap",v);}}));
    }
    else if(nd.type==="radialblur"){
      rows.push(React.createElement(Sel,{key:"md",label:"Mode",value:nd.params.mode||"zoom",
        opts:[{v:"zoom",l:"Zoom"},{v:"spin",l:"Spin"}],onChange:function(v){setNodeParam("mode",v);}}));
      rows.push(React.createElement(Slider,{key:"am",label:"Amount",value:nd.params.amount!=null?nd.params.amount:0.2,min:-1,max:1,step:0.01,onChange:function(v){setNodeParam("amount",v);}}));
      rows.push(React.createElement(Slider,{key:"sm",label:"Samples",value:nd.params.samples!=null?nd.params.samples:12,min:2,max:48,step:1,fmt:function(v){return Math.round(v)+"";},onChange:function(v){setNodeParam("samples",Math.round(v));}}));
      rows.push(React.createElement(Slider,{key:"px",label:"Center X",value:nd.params.x!=null?nd.params.x:0.5,min:0,max:1,step:0.01,onChange:function(v){setNodeParam("x",v);}}));
      rows.push(React.createElement(Slider,{key:"py",label:"Center Y",value:nd.params.y!=null?nd.params.y:0.5,min:0,max:1,step:0.01,onChange:function(v){setNodeParam("y",v);}}));
    }
    else if(nd.type==="vignette"){
      rows.push(React.createElement(Slider,{key:"am",label:"Amount",value:nd.params.amount!=null?nd.params.amount:0.6,min:0,max:1,step:0.01,onChange:function(v){setNodeParam("amount",v);}}));
      rows.push(React.createElement(Slider,{key:"rd",label:"Radius",value:nd.params.radius!=null?nd.params.radius:0.75,min:0,max:2,step:0.01,onChange:function(v){setNodeParam("radius",v);}}));
      rows.push(React.createElement(Slider,{key:"sf",label:"Softness",value:nd.params.softness!=null?nd.params.softness:0.45,min:0.01,max:1.5,step:0.01,onChange:function(v){setNodeParam("softness",v);}}));
      rows.push(React.createElement(Slider,{key:"rn",label:"Roundness",value:nd.params.roundness!=null?nd.params.roundness:1,min:0.1,max:1,step:0.01,onChange:function(v){setNodeParam("roundness",v);}}));
      rows.push(COLOR_FG);
    }
    else if(nd.type==="mathnode"){
      rows.push(React.createElement(Sel,{key:"op",label:"Operation",value:nd.params.op||"add",
        opts:[{v:"add",l:"Add"},{v:"subtract",l:"Subtract"},{v:"multiply",l:"Multiply"},{v:"divide",l:"Divide"},
              {v:"min",l:"Min"},{v:"max",l:"Max"},{v:"difference",l:"Difference"},{v:"screen",l:"Screen"},{v:"power",l:"Power"}],
        onChange:function(v){setNodeParam("op",v);}}));
      rows.push(React.createElement(Slider,{key:"fc",label:"B Factor",value:nd.params.factor!=null?nd.params.factor:1,min:0,max:4,step:0.02,onChange:function(v){setNodeParam("factor",v);}}));
      rows.push(React.createElement(Tog,{key:"cl",label:"Clamp to 0..1",value:nd.params.clamp!==false,onChange:function(v){setNodeParam("clamp",v);}}));
      rows.push(React.createElement("div",{key:"hint",style:{fontSize:8,color:"#888",fontFamily:"monospace",lineHeight:1.6}},
        "Combines input A and input B per channel. B Factor scales B before the operation."));
    }
    else if(nd.type==="mix"){
      rows.push(React.createElement(Slider,{key:"fc",label:"Factor",value:nd.params.factor!=null?nd.params.factor:0.5,min:0,max:1,step:0.01,onChange:function(v){setNodeParam("factor",v);}}));
      rows.push(React.createElement(Tog,{key:"um",label:"Use mask input",value:nd.params.useMask!==false,onChange:function(v){setNodeParam("useMask",v);}}));
      rows.push(React.createElement(Tog,{key:"im",label:"Invert mask",value:!!nd.params.invertMask,onChange:function(v){setNodeParam("invertMask",v);}}));
      rows.push(React.createElement("div",{key:"hint",style:{fontSize:8,color:"#888",fontFamily:"monospace",lineHeight:1.6}},
        "Blends A toward B. With a mask connected, the mask brightness drives the blend per pixel."));
    }
    else if(nd.type==="text"){
      rows.push(React.createElement("div",{key:"txt",style:{marginBottom:7}},
        React.createElement("div",{style:{fontSize:8,color:"#999",fontFamily:"monospace",marginBottom:3}},"Text (use Enter for a new line)"),
        React.createElement("textarea",{value:nd.params.text!=null?nd.params.text:"",rows:2,
          onChange:function(ev){setNodeParam("text",ev.target.value);},
          style:{width:"100%",boxSizing:"border-box",background:"#0f0f0f",border:"1px solid #2a2a2a",borderRadius:4,
            color:"#ddd",fontSize:10,fontFamily:"monospace",padding:"5px 6px",outline:"none",resize:"vertical"}})));
      rows.push(React.createElement(Sel,{key:"ff",label:"Font",value:nd.params.fontFamily||"monospace",
        opts:[{v:"monospace",l:"Monospace"},{v:"sans-serif",l:"Sans Serif"},{v:"serif",l:"Serif"},
              {v:"Impact, sans-serif",l:"Impact"},{v:"Georgia, serif",l:"Georgia"},{v:"'Courier New', monospace",l:"Courier"},
              {v:"'Trebuchet MS', sans-serif",l:"Trebuchet"},{v:"Verdana, sans-serif",l:"Verdana"}].concat(
          (customFonts||[]).map(function(f){return {v:f,l:f+" (loaded)"};})),
        onChange:function(v){setNodeParam("fontFamily",v);}}));
      rows.push(React.createElement("div",{key:"fu",style:{marginBottom:8}},
        React.createElement("label",{style:{display:"block",padding:"6px 8px",background:"#1a1a1a",border:"1px dashed #3a3a3a",
          borderRadius:5,cursor:"pointer",fontSize:8.5,fontFamily:"monospace",color:"#9cf",textAlign:"center"}},
          "Load a font file (.ttf .otf .woff)",
          React.createElement("input",{type:"file",accept:".ttf,.otf,.woff,.woff2",style:{display:"none"},
            onChange:function(ev){var f=ev.target.files&&ev.target.files[0]; if(f)loadCustomFont(f,function(fam){ if(fam)setNodeParam("fontFamily",fam); });}}))));
      rows.push(React.createElement(Slider,{key:"fs",label:"Size",value:nd.params.fontSize!=null?nd.params.fontSize:24,min:4,max:100,step:1,fmt:function(v){return Math.round(v)+"%";},onChange:function(v){setNodeParam("fontSize",Math.round(v));}}));
      rows.push(React.createElement(Slider,{key:"ls",label:"Letter Space",value:nd.params.letterSpacing||0,min:-0.2,max:1,step:0.01,onChange:function(v){setNodeParam("letterSpacing",v);}}));
      rows.push(React.createElement(Slider,{key:"px",label:"Pos X",value:nd.params.x!=null?nd.params.x:0.5,min:0,max:1,step:0.01,onChange:function(v){setNodeParam("x",v);}}));
      rows.push(React.createElement(Slider,{key:"py",label:"Pos Y",value:nd.params.y!=null?nd.params.y:0.5,min:0,max:1,step:0.01,onChange:function(v){setNodeParam("y",v);}}));
      rows.push(React.createElement(Sel,{key:"al",label:"Align",value:nd.params.align||"center",
        opts:[{v:"left",l:"Left"},{v:"center",l:"Center"},{v:"right",l:"Right"}],onChange:function(v){setNodeParam("align",v);}}));
      rows.push(React.createElement(Tog,{key:"bd",label:"Bold",value:!!nd.params.bold,onChange:function(v){setNodeParam("bold",v);}}));
      rows.push(React.createElement(Tog,{key:"it",label:"Italic",value:!!nd.params.italic,onChange:function(v){setNodeParam("italic",v);}}));
      rows.push(React.createElement(Tog,{key:"tr",label:"Transparent BG",value:!!nd.params.transparent,onChange:function(v){setNodeParam("transparent",v);}}));
      rows.push(React.createElement("div",{key:"cols",style:{display:"flex",alignItems:"center",gap:10,marginTop:6}},
        React.createElement("span",{style:{fontSize:8,color:"#999",fontFamily:"monospace"}},"Text"),
        React.createElement("input",{type:"color",value:nd.params.color||"#ffffff",
          onChange:function(ev){setNodeParam("color",ev.target.value);},
          style:{width:32,height:22,background:"none",border:"1px solid #333",borderRadius:3,cursor:"pointer"}}),
        nd.params.transparent?null:React.createElement("span",{style:{fontSize:8,color:"#999",fontFamily:"monospace"}},"BG"),
        nd.params.transparent?null:React.createElement("input",{type:"color",value:nd.params.bgColor||"#000000",
          onChange:function(ev){setNodeParam("bgColor",ev.target.value);},
          style:{width:32,height:22,background:"none",border:"1px solid #333",borderRadius:3,cursor:"pointer"}})));
    }
    else if(nd.type==="morph"){
      rows.push(React.createElement(Slider,{key:"am",label:"Amount",value:nd.params.amount!=null?nd.params.amount:1,min:-8,max:8,step:1,
        fmt:function(v){var r=Math.round(v);return r===0?"off":(r>0?"expand "+r+"px":"shrink "+(-r)+"px");},
        onChange:function(v){setNodeParam("amount",Math.round(v));}}));
      rows.push(React.createElement(Sel,{key:"sr",label:"Operate On",value:nd.params.source||"alpha",
        opts:[{v:"alpha",l:"Alpha"},{v:"luma",l:"Luminance"}],onChange:function(v){setNodeParam("source",v);}}));
      rows.push(React.createElement(Sel,{key:"sh",label:"Shape",value:nd.params.shape||"diamond",
        opts:[{v:"diamond",l:"Diamond (round)"},{v:"square",l:"Square (blocky)"}],onChange:function(v){setNodeParam("shape",v);}}));
      rows.push(React.createElement("div",{key:"hint",style:{fontSize:8,color:"#888",fontFamily:"monospace",lineHeight:1.6}},
        "Positive grows the shape outward, negative eats it inward. Chain shrink then expand to remove specks."));
    }
    else if(nd.type==="edgedetect"){
      rows.push(React.createElement(Sel,{key:"mt",label:"Method",value:nd.params.method||"sobel",
        opts:[{v:"sobel",l:"Sobel (directional)"},{v:"laplacian",l:"Laplacian (thin)"}],onChange:function(v){setNodeParam("method",v);}}));
      rows.push(React.createElement(Slider,{key:"am",label:"Amount",value:nd.params.amount!=null?nd.params.amount:1,min:0,max:6,step:0.05,onChange:function(v){setNodeParam("amount",v);}}));
      rows.push(React.createElement(Slider,{key:"th",label:"Threshold",value:nd.params.threshold||0,min:0,max:1,step:0.01,onChange:function(v){setNodeParam("threshold",v);}}));
      rows.push(React.createElement(Tog,{key:"ov",label:"Overlay on source",value:!!nd.params.overlay,onChange:function(v){setNodeParam("overlay",v);}}));
      rows.push(React.createElement(Tog,{key:"iv",label:"Invert",value:!!nd.params.invert,onChange:function(v){setNodeParam("invert",v);}}));
      rows.push(React.createElement("div",{key:"cl",style:{display:"flex",alignItems:"center",gap:6,marginTop:5}},
        React.createElement("span",{style:{fontSize:8,color:"#999",fontFamily:"monospace",minWidth:52}},"Edge Color"),
        React.createElement("input",{type:"color",value:nd.params.color||"#ffffff",
          onChange:function(ev){setNodeParam("color",ev.target.value);},
          style:{width:34,height:22,background:"none",border:"1px solid #333",borderRadius:3,cursor:"pointer"}})));
    }
    else if(nd.type==="island"){
      rows.push(React.createElement(Sel,{key:"md",label:"Mode",value:nd.params.mode||"colorize",
        opts:[{v:"colorize",l:"Colorize islands"},{v:"removeSmall",l:"Remove small"},{v:"keepLargest",l:"Keep largest"},{v:"fillHoles",l:"Fill holes"}],
        onChange:function(v){setNodeParam("mode",v);}}));
      rows.push(React.createElement(Sel,{key:"sr",label:"Detect On",value:nd.params.source||"luma",
        opts:[{v:"luma",l:"Luminance"},{v:"alpha",l:"Alpha"}],onChange:function(v){setNodeParam("source",v);}}));
      rows.push(React.createElement(Slider,{key:"th",label:"Threshold",value:nd.params.threshold!=null?nd.params.threshold:0.5,min:0,max:1,step:0.01,onChange:function(v){setNodeParam("threshold",v);}}));
      if((nd.params.mode||"colorize")==="removeSmall")
        rows.push(React.createElement(Slider,{key:"ms",label:"Min Size",value:nd.params.minSize!=null?nd.params.minSize:8,min:1,max:400,step:1,fmt:function(v){return Math.round(v)+"px";},onChange:function(v){setNodeParam("minSize",Math.round(v));}}));
      rows.push(React.createElement(Sel,{key:"cn",label:"Connectivity",value:String(nd.params.connectivity||4),
        opts:[{v:"4",l:"4 (orthogonal)"},{v:"8",l:"8 (with diagonals)"}],onChange:function(v){setNodeParam("connectivity",parseInt(v));}}));
      rows.push(React.createElement("div",{key:"hint",style:{fontSize:8,color:"#888",fontFamily:"monospace",lineHeight:1.6}},
        "Finds connected regions. Colorize is for inspecting, Remove small cleans up stray pixels."));
    }
    else if(nd.type==="colorgrade"){
      rows.push(React.createElement(Slider,{key:"ex",label:"Exposure",value:nd.params.exposure||0,min:-3,max:3,step:0.05,fmt:function(v){return v.toFixed(2)+" EV";},onChange:function(v){setNodeParam("exposure",v);}}));
      rows.push(React.createElement(Slider,{key:"co",label:"Contrast",value:nd.params.contrast!=null?nd.params.contrast:1,min:0,max:3,step:0.02,onChange:function(v){setNodeParam("contrast",v);}}));
      rows.push(React.createElement(Slider,{key:"lf",label:"Lift",value:nd.params.lift||0,min:-0.5,max:0.5,step:0.01,onChange:function(v){setNodeParam("lift",v);}}));
      rows.push(React.createElement(Slider,{key:"gm",label:"Gamma",value:nd.params.gamma!=null?nd.params.gamma:1,min:0.1,max:4,step:0.02,onChange:function(v){setNodeParam("gamma",v);}}));
      rows.push(React.createElement(Slider,{key:"gn",label:"Gain",value:nd.params.gain!=null?nd.params.gain:1,min:0,max:3,step:0.02,onChange:function(v){setNodeParam("gain",v);}}));
      rows.push(React.createElement(Slider,{key:"tp",label:"Temperature",value:nd.params.temperature||0,min:-1,max:1,step:0.02,onChange:function(v){setNodeParam("temperature",v);}}));
      rows.push(React.createElement(Slider,{key:"tn",label:"Tint",value:nd.params.tint||0,min:-1,max:1,step:0.02,onChange:function(v){setNodeParam("tint",v);}}));
      rows.push(React.createElement(Slider,{key:"sa",label:"Saturation",value:nd.params.saturation!=null?nd.params.saturation:1,min:0,max:3,step:0.02,onChange:function(v){setNodeParam("saturation",v);}}));
      rows.push(React.createElement(Slider,{key:"vb",label:"Vibrance",value:nd.params.vibrance||0,min:-1,max:1,step:0.02,onChange:function(v){setNodeParam("vibrance",v);}}));
      rows.push(React.createElement(Slider,{key:"hs",label:"Hue Shift",value:nd.params.hueShift||0,min:-180,max:180,step:1,fmt:function(v){return Math.round(v)+"\u00b0";},onChange:function(v){setNodeParam("hueShift",v);}}));
    }
    else if(nd.type==="pixelate"){
      rows.push(React.createElement(Slider,{key:"bs",label:"Block Size",value:nd.params.blockSize!=null?nd.params.blockSize:8,min:1,max:64,step:1,fmt:function(v){return Math.round(v)+"px";},onChange:function(v){setNodeParam("blockSize",Math.round(v));}}));
      rows.push(React.createElement(Sel,{key:"md",label:"Sampling",value:nd.params.mode||"average",
        opts:[{v:"average",l:"Average (smooth)"},{v:"nearest",l:"Nearest (crisp)"}],
        onChange:function(v){setNodeParam("mode",v);}}));
    }
    else if(nd.type==="palette"){
      rows.push(React.createElement(Sel,{key:"pl",label:"Palette",value:nd.params.palette||"gameboy",
        opts:[{v:"gameboy",l:"Game Boy (4 green)"},{v:"gray4",l:"4 Grays"},{v:"mono",l:"1-bit Mono"},
              {v:"cga",l:"CGA (4)"},{v:"pico8",l:"PICO-8 (16)"},{v:"c64",l:"C64 (16)"},{v:"nes",l:"NES-like (16)"}],
        onChange:function(v){setNodeParam("palette",v);}}));
      rows.push(React.createElement(Slider,{key:"dt",label:"Dither",value:nd.params.dither||0,min:0,max:1,step:0.05,onChange:function(v){setNodeParam("dither",v);}}));
      rows.push(React.createElement("div",{key:"hint",style:{fontSize:8,color:"#888",fontFamily:"monospace",lineHeight:1.6}},
        "Dither breaks gradients into classic ordered pixel patterns before snapping to the palette."));
    }
    else if(nd.type==="outline"){
      rows.push(React.createElement(Sel,{key:"sr",label:"Detect On",value:nd.params.source||"alpha",
        opts:[{v:"alpha",l:"Alpha"},{v:"luma",l:"Luminance"}],onChange:function(v){setNodeParam("source",v);}}));
      rows.push(React.createElement(Slider,{key:"th",label:"Threshold",value:nd.params.threshold!=null?nd.params.threshold:0.5,min:0,max:1,step:0.01,onChange:function(v){setNodeParam("threshold",v);}}));
      rows.push(React.createElement(Slider,{key:"tk",label:"Thickness",value:nd.params.thickness!=null?nd.params.thickness:1,min:1,max:5,step:1,fmt:function(v){return Math.round(v)+"px";},onChange:function(v){setNodeParam("thickness",Math.round(v));}}));
      rows.push(React.createElement(Sel,{key:"md",label:"Side",value:nd.params.mode||"outer",
        opts:[{v:"outer",l:"Outer"},{v:"inner",l:"Inner"}],onChange:function(v){setNodeParam("mode",v);}}));
      rows.push(React.createElement("div",{key:"cl",style:{display:"flex",alignItems:"center",gap:6,marginTop:5}},
        React.createElement("span",{style:{fontSize:8,color:"#999",fontFamily:"monospace",minWidth:52}},"Color"),
        React.createElement("input",{type:"color",value:nd.params.color||"#000000",
          onChange:function(ev){setNodeParam("color",ev.target.value);},
          style:{width:34,height:22,background:"none",border:"1px solid #333",borderRadius:3,cursor:"pointer"}})));
    }
    else if(nd.type==="scanlines"){
      rows.push(React.createElement(Slider,{key:"sp",label:"Spacing",value:nd.params.spacing!=null?nd.params.spacing:3,min:2,max:12,step:1,fmt:function(v){return Math.round(v)+"px";},onChange:function(v){setNodeParam("spacing",Math.round(v));}}));
      rows.push(React.createElement(Slider,{key:"dk",label:"Darkness",value:nd.params.darkness!=null?nd.params.darkness:0.4,min:0,max:1,step:0.02,onChange:function(v){setNodeParam("darkness",v);}}));
      rows.push(React.createElement(Slider,{key:"tk",label:"Line Width",value:nd.params.thickness!=null?nd.params.thickness:1,min:1,max:5,step:1,fmt:function(v){return Math.round(v)+"px";},onChange:function(v){setNodeParam("thickness",Math.round(v));}}));
      rows.push(React.createElement(Slider,{key:"vg",label:"Vignette",value:nd.params.vignette||0,min:0,max:1,step:0.02,onChange:function(v){setNodeParam("vignette",v);}}));
      rows.push(React.createElement(Tog,{key:"rm",label:"RGB Mask",value:!!nd.params.rgbMask,onChange:function(v){setNodeParam("rgbMask",v);}}));
    }
    else if(nd.type==="levels"){
      rows.push(React.createElement(Slider,{key:"ib",label:"In Black",value:nd.params.inBlack!=null?nd.params.inBlack:0,min:0,max:1,step:0.01,onChange:function(v){setNodeParam("inBlack",v);}}));
      rows.push(React.createElement(Slider,{key:"iw",label:"In White",value:nd.params.inWhite!=null?nd.params.inWhite:1,min:0,max:1,step:0.01,onChange:function(v){setNodeParam("inWhite",v);}}));
      rows.push(React.createElement(Slider,{key:"gm",label:"Gamma",value:nd.params.gamma!=null?nd.params.gamma:1,min:0.1,max:4,step:0.01,onChange:function(v){setNodeParam("gamma",v);}}));
      rows.push(React.createElement(Slider,{key:"ob",label:"Out Black",value:nd.params.outBlack!=null?nd.params.outBlack:0,min:0,max:1,step:0.01,onChange:function(v){setNodeParam("outBlack",v);}}));
      rows.push(React.createElement(Slider,{key:"ow",label:"Out White",value:nd.params.outWhite!=null?nd.params.outWhite:1,min:0,max:1,step:0.01,onChange:function(v){setNodeParam("outWhite",v);}}));
    }
    else if(nd.type==="threshold"){
      rows.push(React.createElement(Slider,{key:"lv",label:"Level",value:nd.params.level!=null?nd.params.level:0.5,min:0,max:1,step:0.01,onChange:function(v){setNodeParam("level",v);}}));
      rows.push(React.createElement(Slider,{key:"sf",label:"Softness",value:nd.params.softness||0,min:0,max:0.5,step:0.01,onChange:function(v){setNodeParam("softness",v);}}));
    }
    else if(nd.type==="posterize"){
      rows.push(React.createElement(Slider,{key:"lv",label:"Levels",value:nd.params.levels!=null?nd.params.levels:4,min:2,max:16,step:1,fmt:function(v){return Math.round(v)+"";},onChange:function(v){setNodeParam("levels",Math.round(v));}}));
    }
    else if(nd.type==="sharpen"){
      rows.push(React.createElement(Slider,{key:"am",label:"Amount",value:nd.params.amount!=null?nd.params.amount:1,min:0,max:3,step:0.05,onChange:function(v){setNodeParam("amount",v);}}));
    }
    else if(nd.type==="emboss"){
      rows.push(React.createElement(Slider,{key:"am",label:"Amount",value:nd.params.amount!=null?nd.params.amount:1,min:0,max:4,step:0.05,onChange:function(v){setNodeParam("amount",v);}}));
      rows.push(React.createElement(Slider,{key:"an",label:"Angle",value:nd.params.angle!=null?nd.params.angle:45,min:0,max:360,step:1,fmt:function(v){return Math.round(v)+"\u00b0";},onChange:function(v){setNodeParam("angle",v);}}));
    }
    else if(nd.type==="normalmap"){
      rows.push(React.createElement(Slider,{key:"st",label:"Strength",value:nd.params.strength!=null?nd.params.strength:2,min:0.1,max:8,step:0.1,onChange:function(v){setNodeParam("strength",v);}}));
      rows.push(React.createElement("div",{key:"hint",style:{fontSize:8,color:"#888",fontFamily:"monospace",lineHeight:1.6}},
        "Feed a heightmap (grayscale) to get a tangent-space normal map."));
    }
    else if(nd.type==="reroute"){
      rows.push(React.createElement("div",{key:"hint",style:{fontSize:8,color:"#888",fontFamily:"monospace",lineHeight:1.6}},
        "Pass-through node. Use it to route wires cleanly around the graph."));
    }
    else if(nd.type==="alphaSplit"){
      rows.push(React.createElement("div",{key:"hint",style:{fontSize:8,color:"#888",fontFamily:"monospace",lineHeight:1.6}},
        "Five outputs on the right: RGB (full colour), and R, G, B, A each as a grayscale channel. Drag from the one you need."));
    }
    else if(nd.type==="alphaMerge"){
      rows.push(React.createElement("div",{key:"hint",style:{fontSize:8,color:"#888",fontFamily:"monospace",lineHeight:1.6}},
        "RGB comes from the 'rgb' input; the 'alpha' input's brightness becomes the alpha channel."));
    }
    else if(nd.type==="output"){
      rows.push(React.createElement("div",{key:"hint",style:{fontSize:8,color:"#888",fontFamily:"monospace",lineHeight:1.6}},
        "The final result of the graph. Connect your last node here. Shown in the preview."));
    }
    // Drops below the batch toolbar when that is on screen (2+ nodes selected),
    // and shortens when the timeline occupies the bottom of the board.
    var _multi=selCount()>1;
    return React.createElement("div",{style:{position:"absolute",top:(_multi?104:74),right:8,
      width:"min(216px, calc(100% - 16px))",zIndex:12,
      background:"rgba(15,15,15,0.96)",border:"1px solid #2a2a2a",borderRadius:9,padding:"10px 11px",
      boxShadow:"0 4px 20px rgba(0,0,0,0.6)",
      maxHeight:showTimeline?(_multi?"calc(100% - 300px)":"calc(100% - 270px)")
                            :(_multi?"calc(100% - 180px)":"calc(100% - 150px)"),
      overflowY:"auto",WebkitOverflowScrolling:"touch",overscrollBehavior:"contain",
      backdropFilter:"blur(4px)"}},rows);
  }
  var nodePanel=selNode?buildNodePanel():null;

  // ── "Add node" menu: grouped, colour-coded, opens on wire-drop or the + button.
  // Positions itself near the drop point but stays on-screen. ──
  function buildAddMenu(){
    if(!addMenu)return null;
    var wrapRect=wrapRef.current?wrapRef.current.getBoundingClientRect():{left:0,top:0,width:400,height:400};
    var mx=addMenu.screenX-wrapRect.left, my=addMenu.screenY-wrapRect.top;
    var MENU_W=Math.min(228,Math.max(180,wrapRect.width-24)), MENU_MAXH=Math.min(440,wrapRect.height-20);
    // keep on screen
    if(mx+MENU_W>wrapRect.width-8)mx=wrapRect.width-MENU_W-8;
    if(mx<8)mx=8;
    if(my+MENU_MAXH>wrapRect.height-8)my=Math.max(8,wrapRect.height-MENU_MAXH-8);
    if(my<8)my=8;
    var rows=[];
    rows.push(React.createElement("div",{key:"hd",style:{display:"flex",justifyContent:"space-between",alignItems:"center",
      padding:"7px 9px",borderBottom:"1px solid #232323",position:"sticky",top:0,background:"#141414",zIndex:1}},
      React.createElement("span",{style:{fontSize:8.5,fontFamily:"monospace",fontWeight:700,color:"#e8900a",letterSpacing:0.6}},
        addMenu.fromId?"CONNECT TO\u2026":"ADD NODE"),
      React.createElement("button",{onClick:function(){setAddMenu(null);setAddQ("");},
        style:{background:"none",border:"none",color:"#888",fontSize:13,cursor:"pointer",fontFamily:"monospace",padding:"0 2px"}},"\u00d7")));
    // quick search: type to filter by node name
    rows.push(React.createElement("div",{key:"srch",style:{padding:"6px 9px",borderBottom:"1px solid #1e1e1e",
      position:"sticky",top:30,background:"#141414",zIndex:1}},
      React.createElement("input",{type:"text",value:addQ,placeholder:"search\u2026",autoFocus:false,
        onChange:function(ev){setAddQ(ev.target.value);},
        onPointerDown:function(ev){ev.stopPropagation();},
        style:{width:"100%",boxSizing:"border-box",background:"#0f0f0f",border:"1px solid #2a2a2a",borderRadius:4,
          color:"#ddd",fontSize:9,fontFamily:"monospace",padding:"5px 7px",outline:"none"}})));
    var _q=(addQ||"").trim().toLowerCase();
    var _matched=0;
    NODE_CATEGORIES.forEach(function(cat){
      // when auto-wiring from an output, don't offer a Source (it has no input)
      var typesHere=cat.types.filter(function(t){
        if(_q){
          var mm=NODE_META[t]||{};
          var hay=((mm.label||t)+" "+(mm.hint||"")+" "+t).toLowerCase();
          if(hay.indexOf(_q)===-1)return false;
        }
        if(addMenu.fromId){var d=NODE_TYPES[t];return d.inputs&&d.inputs.length>0;}
        return true;
      });
      _matched+=typesHere.length;
      if(!typesHere.length)return;
      // With 40+ node types a flat list is several screens of scrolling, so the
      // categories collapse. A search expands everything automatically.
      var expanded=_q?true:(addCat===cat.name);
      rows.push(React.createElement("button",{key:"c"+cat.name,
        onClick:function(){ setAddCat(expanded&&!_q?null:cat.name); },
        style:{display:"flex",alignItems:"center",gap:7,width:"100%",textAlign:"left",minHeight:34,
          padding:"0 9px",background:expanded?"#1c1c1c":"none",border:"none",
          borderTop:"1px solid #1e1e1e",cursor:"pointer",fontFamily:"monospace",
          color:expanded?"#e8900a":"#8a8a8a",touchAction:"manipulation"}},
        React.createElement("span",{style:{fontSize:9,transition:"transform 0.12s",
          transform:expanded?"rotate(90deg)":"rotate(0deg)",display:"inline-block",width:8}},"\u25b8"),
        React.createElement("span",{style:{fontSize:9,fontWeight:700,letterSpacing:1,textTransform:"uppercase"}},cat.name),
        React.createElement("span",{style:{marginLeft:"auto",fontSize:8,color:"#666"}},typesHere.length)));
      if(!expanded)return;
      typesHere.forEach(function(t){
        var meta=NODE_META[t]||{};
        rows.push(React.createElement("button",{key:t,
          onClick:function(){
            addNodeOfType(t,{x:addMenu.boardX,y:addMenu.boardY,fromId:addMenu.fromId,fromPort:addMenu.fromPort,select:false});
            setAddCat(cat.name); setAddMenu(null); setAddQ("");
          },
          style:{display:"flex",alignItems:"center",gap:9,width:"100%",textAlign:"left",minHeight:38,
            padding:"0 10px",background:"none",border:"none",borderLeft:"3px solid "+(meta.color||"#444"),
            cursor:"pointer",fontFamily:"monospace",color:"#ccc",touchAction:"manipulation"},
          onMouseEnter:function(e){e.currentTarget.style.background="#1c1c1c";},
          onMouseLeave:function(e){e.currentTarget.style.background="none";}},
          nodeIcon(t,13,meta.color||"#aaa"),
          React.createElement("span",{style:{fontSize:10,fontWeight:700,whiteSpace:"nowrap"}},meta.label||t),
          React.createElement("span",{style:{fontSize:7,color:"#777",marginLeft:"auto",textAlign:"right",
            overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:"46%"}},meta.hint||"")));
      });
    });
    if(!_matched)rows.push(React.createElement("div",{key:"nores",style:{padding:"14px 10px",fontSize:8.5,
      color:"#777",fontFamily:"monospace",textAlign:"center"}},"No node matches \u201c"+addQ+"\u201d"));
    return React.createElement("div",{key:"amwrap"},
      React.createElement("div",{onPointerDown:function(ev){ev.stopPropagation();setAddMenu(null);setAddQ("");},
        style:{position:"absolute",inset:0,zIndex:59,background:"transparent"}}),
      React.createElement("div",{style:{position:"absolute",left:mx,top:my,width:MENU_W,maxHeight:MENU_MAXH,
        overflowY:"auto",background:"#141414",border:"1px solid #2e2e2e",borderRadius:8,zIndex:60,
        boxShadow:"0 8px 30px rgba(0,0,0,0.7)",WebkitOverflowScrolling:"touch"}},rows)
    );
  }
  var addMenuEl=addMenu?buildAddMenu():null;

  // ── Batch operations toolbar: appears when 2+ nodes are selected ──
  function buildBatchBar(){
    var n=selCount(); if(n<2)return null;
    function btn(label,fn,title,accent){
      return React.createElement("button",{key:label,onClick:fn,title:title||label,
        style:{minHeight:30,padding:"0 10px",fontSize:9.5,fontFamily:"monospace",fontWeight:600,lineHeight:1,
          background:accent?"#e8900a":"#1c1c1c",color:accent?"#000":"#cdcdcd",
          border:"1px solid "+(accent?"#e8900a":"#333"),borderRadius:6,cursor:"pointer",touchAction:"manipulation",
          whiteSpace:"nowrap",display:"inline-flex",alignItems:"center",justifyContent:"center"}},label);
    }
    function grp(label,kids){
      return React.createElement("div",{key:label,style:{display:"flex",alignItems:"center",gap:4,padding:"0 6px",borderRight:"1px solid #2a2a2a"}},
        React.createElement("span",{style:{fontSize:7,color:"#666",fontFamily:"monospace",letterSpacing:0.5,marginRight:2}},label),kids);
    }
    // Sits below the mode-switch pill, which also lives at top-centre.
    return React.createElement("div",{style:{position:"absolute",top:52,left:"50%",transform:"translateX(-50%)",zIndex:30,
      display:"flex",alignItems:"center",gap:3,flexWrap:"wrap",maxWidth:"94%",
      background:"rgba(16,16,16,0.96)",border:"1px solid #e8900a44",borderRadius:9,padding:"6px 7px",boxShadow:"0 4px 18px rgba(0,0,0,0.6)"}},
      React.createElement("span",{style:{fontSize:8.5,fontFamily:"monospace",fontWeight:700,color:"#e8900a",padding:"0 5px"}},n+" SEL"),
      grp("EDIT",[btn("Dup",batchDuplicate,"Duplicate selected"),btn("Copy",batchCopy,"Copy"),btn("Paste",batchPaste,"Paste"),btn("Del",batchDelete,"Delete selected")]),
      grp("ALIGN",[btn("\u2190",function(){batchAlign("left");},"Align left"),btn("\u2192",function(){batchAlign("right");},"Align right"),
        btn("\u2191",function(){batchAlign("top");},"Align top"),btn("\u2193",function(){batchAlign("bottom");},"Align bottom"),
        btn("H",function(){batchAlign("centerH");},"Center horizontally"),btn("V",function(){batchAlign("centerV");},"Center vertically")]),
      grp("DIST",[btn("\u21d4",function(){batchDistribute("h");},"Distribute horizontally"),btn("\u21d5",function(){batchDistribute("v");},"Distribute vertically"),btn("Tidy",batchAutoLayout,"Auto-layout by flow")]),
      grp("WIRE",[btn("Chain",batchChain,"Connect in series"),btn("Cut",batchDisconnect,"Disconnect wires"),btn("\u2193down",batchSelectDownstream,"Select downstream"),btn("\u2191up",batchSelectUpstream,"Select upstream"),btn("Invert",invertSel,"Invert selection")]),
      grp("PARAM",[btn("Seeds",batchRandomizeSeeds,"Randomize seeds"),btn("Reset",batchResetParams,"Reset params")]),
      grp("EXPORT",[btn("Multi-res",function(){if(p.onBatchExportRes)p.onBatchExportRes();},"Export 256/512/1024/2048",true),
        btn("Each",function(){if(p.onBatchExportNodes)p.onBatchExportNodes(selIds());},"Export each selected node",true)]),
      btn("\u00d7",clearSel,"Clear selection")
    );
  }
  var batchBarEl=buildBatchBar();

  // ── Long-press node action menu (touch quick actions) ──
  function buildNodeMenu(){
    if(!nodeMenu)return null;
    var node=g.nodes[nodeMenu.nodeId]; if(!node)return null;
    var wrapRect=wrapRef.current?wrapRef.current.getBoundingClientRect():{left:0,top:0,width:300,height:300};
    // offset the menu up-right of the finger so it isn't hidden under the thumb
    var mx=nodeMenu.screenX-wrapRect.left+14, my=nodeMenu.screenY-wrapRect.top-10;
    var W=158, H=250;
    if(mx+W>wrapRect.width-8)mx=nodeMenu.screenX-wrapRect.left-W-14; // flip to the left
    if(mx<8)mx=8;
    if(my+H>wrapRect.height-8)my=Math.max(8,wrapRect.height-H-8);
    if(my<8)my=8;
    function item(label,fn,col){
      return React.createElement("button",{key:label,onClick:function(){fn();setNodeMenu(null);},
        onMouseEnter:function(e){e.currentTarget.style.background="#1e1e1e";},
        onMouseLeave:function(e){e.currentTarget.style.background="none";},
        style:{display:"block",width:"100%",textAlign:"left",padding:"10px 12px",background:"none",border:"none",
          borderBottom:"1px solid #1e1e1e",color:col||"#ddd",fontSize:10,fontFamily:"monospace",cursor:"pointer",touchAction:"manipulation"}},label);
    }
    // "insert after" submenu: splice a node onto this node's first OUTGOING edge
    var outEdge=null; for(var eid in g.edges){if(g.edges[eid].from===node.id){outEdge=eid;break;}}
    return React.createElement("div",{key:"nmwrap"},
      // full-screen invisible backdrop: tap anywhere outside closes the menu
      React.createElement("div",{onPointerDown:function(ev){ev.stopPropagation();setNodeMenu(null);},
        style:{position:"absolute",inset:0,zIndex:69,background:"transparent"}}),
      React.createElement("div",{style:{position:"absolute",left:mx,top:my,width:W,zIndex:70,
        background:"#141414",border:"1px solid #383838",borderRadius:10,overflow:"hidden",boxShadow:"0 10px 36px rgba(0,0,0,0.75)"}},
        React.createElement("div",{style:{padding:"8px 11px",fontSize:8.5,fontFamily:"monospace",fontWeight:700,color:nodeColor(node.type),
          borderBottom:"1px solid #2a2a2a",display:"flex",justifyContent:"space-between",alignItems:"center",gap:6}},
          React.createElement("span",{style:{display:"flex",alignItems:"center",gap:5}},nodeIcon(node.type,11,nodeColor(node.type)),nodeLabel(node.type)),
          React.createElement("button",{onClick:function(){setNodeMenu(null);},style:{background:"none",border:"none",color:"#888",fontSize:14,cursor:"pointer",lineHeight:1,padding:"0 2px"}},"\u00d7")),
        item("Open settings",function(){selectOnly(node.id);}),
        item("Duplicate",function(){duplicateNode(node.id);}),
        (NODE_TYPES[node.type].cat!=="output"&&NODE_TYPES[node.type].inputs&&NODE_TYPES[node.type].inputs.length)?
          item(node.bypass?"Enable (un-bypass)":"Bypass / mute",function(){node.bypass=!node.bypass;bump();},node.bypass?"#e8b06a":"#caa46a"):null,
        item("Add to selection",function(){toggleSel(node.id);}),
        item("Select all of this type",function(){selectByType(node.type);}),
        outEdge?item("Insert Blur after",function(){autoInsertOnEdge(outEdge,"blur");}):null,
        outEdge?item("Insert Adjust after",function(){autoInsertOnEdge(outEdge,"adjust");}):null,
        item("Disconnect wires",function(){selectOnly(node.id);batchDisconnect();}),
        item("Delete",function(){selectOnly(node.id);batchDelete();},"#e87a7a")
      )
    );
  }
  var nodeMenuEl=buildNodeMenu();

  // ── Wire action menu: delete the wire, or splice a node onto it ──
  function buildWireMenu(){
    if(!wireMenu)return null;
    var ed=g.edges[wireMenu.edgeId]; if(!ed){return null;}
    var wrapRect=wrapRef.current?wrapRef.current.getBoundingClientRect():{left:0,top:0,width:300,height:300};
    var mx=wireMenu.screenX-wrapRect.left+12, my=wireMenu.screenY-wrapRect.top-8;
    var W=170, H=220;
    if(mx+W>wrapRect.width-8)mx=wireMenu.screenX-wrapRect.left-W-12;
    if(mx<8)mx=8;
    if(my+H>wrapRect.height-8)my=Math.max(8,wrapRect.height-H-8);
    if(my<8)my=8;
    function wItem(label,fn,col){
      return React.createElement("button",{key:label,onClick:function(){fn();setWireMenu(null);},
        onMouseEnter:function(ev){ev.currentTarget.style.background="#1e1e1e";},
        onMouseLeave:function(ev){ev.currentTarget.style.background="none";},
        style:{display:"block",width:"100%",textAlign:"left",padding:"10px 12px",background:"none",border:"none",
          borderBottom:"1px solid #1e1e1e",color:col||"#ddd",fontSize:10,fontFamily:"monospace",cursor:"pointer",touchAction:"manipulation"}},label);
    }
    var fromN=g.nodes[ed.from], toN=g.nodes[ed.to];
    return React.createElement("div",{key:"wmwrap"},
      React.createElement("div",{onPointerDown:function(ev){ev.stopPropagation();setWireMenu(null);},
        style:{position:"absolute",inset:0,zIndex:69,background:"transparent"}}),
      React.createElement("div",{style:{position:"absolute",left:mx,top:my,width:W,zIndex:70,
        background:"#141414",border:"1px solid #383838",borderRadius:10,overflow:"hidden",boxShadow:"0 10px 36px rgba(0,0,0,0.75)"}},
        React.createElement("div",{style:{padding:"8px 11px",fontSize:8,fontFamily:"monospace",fontWeight:700,color:"#e8900a",
          borderBottom:"1px solid #2a2a2a",display:"flex",justifyContent:"space-between",alignItems:"center",gap:6}},
          React.createElement("span",{style:{whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}},
            (fromN?nodeLabel(fromN.type):"?")+" \u2192 "+(toN?nodeLabel(toN.type):"?")),
          React.createElement("button",{onClick:function(){setWireMenu(null);},
            style:{background:"none",border:"none",color:"#888",fontSize:14,cursor:"pointer",lineHeight:1,padding:"0 2px"}},"\u00d7")),
        React.createElement("div",{style:{padding:"5px 11px 2px",fontSize:7,color:"#777",fontFamily:"monospace"}},"INSERT ON THIS WIRE"),
        wItem("Blur",function(){autoInsertOnEdge(wireMenu.edgeId,"blur");}),
        wItem("Adjust",function(){autoInsertOnEdge(wireMenu.edgeId,"adjust");}),
        wItem("Levels",function(){autoInsertOnEdge(wireMenu.edgeId,"levels");}),
        wItem("Warp",function(){autoInsertOnEdge(wireMenu.edgeId,"warp");}),
        wItem("Reroute",function(){autoInsertOnEdge(wireMenu.edgeId,"reroute");}),
        wItem("Delete wire",function(){disconnect(g,wireMenu.edgeId);bump();},"#e87a7a")
      )
    );
  }
  var wireMenuEl=buildWireMenu();

  // ── Preset browser ──────────────────────────────────────────────
  function buildPresetPanel(){
    if(!presetOpen)return null;
    var cats=[]; var byCat={};
    GRAPH_PRESETS.forEach(function(p){
      if(!byCat[p.cat]){byCat[p.cat]=[];cats.push(p.cat);}
      byCat[p.cat].push(p);
    });
    var rows=[];
    rows.push(React.createElement("div",{key:"hd",style:{display:"flex",alignItems:"center",gap:6,
      padding:"9px 11px",borderBottom:"1px solid #262626",position:"sticky",top:0,
      background:"rgba(15,15,15,0.98)",zIndex:2}},
      React.createElement("span",{style:{fontSize:10,fontFamily:"monospace",fontWeight:700,color:"#7fb0ff",letterSpacing:0.5}},"\u2726 PRESETS"),
      React.createElement("span",{style:{fontSize:7.5,color:"#666",fontFamily:"monospace"}},GRAPH_PRESETS.length+" graphs"),
      React.createElement("button",{onClick:function(){setPresetOpen(false);},
        style:{marginLeft:"auto",minWidth:28,minHeight:28,background:"none",border:"1px solid #333",color:"#999",
          borderRadius:5,fontSize:13,cursor:"pointer",fontFamily:"monospace",touchAction:"manipulation"}},"\u00d7")));
    cats.forEach(function(cat){
      rows.push(React.createElement("div",{key:"c"+cat,style:{fontSize:7.5,fontFamily:"monospace",color:"#666",
        letterSpacing:1,padding:"8px 11px 3px",textTransform:"uppercase"}},cat));
      byCat[cat].forEach(function(p){
        rows.push(React.createElement("button",{key:p.name,onClick:function(){loadPreset(p);},
          onMouseEnter:function(ev){ev.currentTarget.style.background="#1e1e1e";},
          onMouseLeave:function(ev){ev.currentTarget.style.background="none";},
          style:{display:"block",width:"100%",textAlign:"left",minHeight:42,padding:"6px 11px",
            background:"none",border:"none",borderLeft:"3px solid #2a4a6a",borderBottom:"1px solid #1a1a1a",
            cursor:"pointer",fontFamily:"monospace",touchAction:"manipulation"}},
          React.createElement("div",{style:{fontSize:10,fontWeight:700,color:"#ddd"}},p.name),
          React.createElement("div",{style:{fontSize:7.5,color:"#777",marginTop:2}},p.hint)));
      });
    });
    rows.push(React.createElement("div",{key:"ft",style:{fontSize:7.5,color:"#666",fontFamily:"monospace",
      padding:"9px 11px",lineHeight:1.5,borderTop:"1px solid #1e1e1e"}},
      "Loading a preset replaces the current graph. Undo brings yours back."));
    return React.createElement("div",{key:"pwrap"},
      React.createElement("div",{onPointerDown:function(ev){ev.stopPropagation();setPresetOpen(false);},
        style:{position:"absolute",inset:0,zIndex:44,background:"rgba(0,0,0,0.35)"}}),
      React.createElement("div",{style:{position:"absolute",left:8,top:8,
        width:"min(250px, calc(100% - 16px))",maxHeight:"calc(100% - 16px)",overflowY:"auto",
        WebkitOverflowScrolling:"touch",overscrollBehavior:"contain",zIndex:45,
        background:"rgba(15,15,15,0.98)",border:"1px solid #2e2e2e",borderRadius:10,
        boxShadow:"0 10px 40px rgba(0,0,0,0.8)"}},rows));
  }
  var presetPanelEl=buildPresetPanel();

  // ── Timeline strip (bottom): scrub, play, set duration, see keyframes ──
  function buildTimeline(){
    if(!showTimeline)return null;
    var W=560; // logical width of the track in px (responsive via maxWidth)
    // collect keyframe times for the selected node (to show as ticks)
    var marks=[];
    if(selNode&&g.nodes[selNode]&&g.nodes[selNode].anim){
      var a=g.nodes[selNode].anim;
      for(var key in a){(a[key]||[]).forEach(function(kf){marks.push(kf.t);});}
    }
    function scrubTo(clientX,trackEl){
      var r=trackEl.getBoundingClientRect();
      var f=(clientX-r.left)/r.width; f=f<0?0:f>1?1:f;
      setAnimPlaying(false); setAnimTime(Math.round(f*animDur*1000)/1000);
    }
    return React.createElement("div",{style:{position:"absolute",left:8,right:8,bottom:8,zIndex:40,
      background:"rgba(16,16,16,0.97)",border:"1px solid #2c2c2c",borderRadius:10,padding:"8px 10px",
      boxShadow:"0 -2px 16px rgba(0,0,0,0.5)"}},
      // top row: transport + time + duration + fps + close
      React.createElement("div",{style:{display:"flex",alignItems:"center",gap:8,marginBottom:7,flexWrap:"wrap"}},
        React.createElement("button",{onClick:function(){setAnimPlaying(!animPlaying);},
          style:{minWidth:44,minHeight:34,padding:"0 12px",fontSize:12,fontFamily:"monospace",fontWeight:700,background:animPlaying?"#e8900a":"#1c1c1c",
            color:animPlaying?"#000":"#9cf",border:"1px solid "+(animPlaying?"#e8900a":"#2a4a5a"),borderRadius:7,cursor:"pointer",
            touchAction:"manipulation",display:"inline-flex",alignItems:"center",justifyContent:"center"}},
          animPlaying?"\u275a\u275a":"\u25b6"),
        React.createElement("button",{onClick:function(){setAnimPlaying(false);setAnimTime(0);},
          style:{minWidth:38,minHeight:34,padding:"0 9px",fontSize:12,fontFamily:"monospace",background:"#1c1c1c",color:"#bbb",border:"1px solid #333",
            borderRadius:7,cursor:"pointer",touchAction:"manipulation",display:"inline-flex",alignItems:"center",justifyContent:"center"}},"\u23ee"),
        React.createElement("span",{style:{fontSize:9,fontFamily:"monospace",color:"#e8900a",fontWeight:700,minWidth:64}},animTime.toFixed(2)+" / "+animDur.toFixed(1)+"s"),
        React.createElement("span",{style:{fontSize:8,fontFamily:"monospace",color:"#777"}},"DUR"),
        React.createElement("input",{type:"range",min:1,max:10,step:0.5,value:animDur,
          onChange:function(e){setAnimDur(parseFloat(e.target.value));},style:{width:118,touchAction:"none"}}),
        React.createElement("span",{style:{fontSize:8,fontFamily:"monospace",color:"#777"}},"FPS"),
        React.createElement("input",{type:"range",min:6,max:60,step:1,value:animFps,
          onChange:function(e){setAnimFps(parseInt(e.target.value));},style:{width:108,touchAction:"none"}}),
        React.createElement("span",{style:{fontSize:8,fontFamily:"monospace",color:"#999"}},animFps+""),
        p.onBakeTimeline?React.createElement("button",{onClick:function(){
            setAnimPlaying(false);
            p.onBakeTimeline({cols:bakeCols,rows:bakeRows,frames:bakeCols*bakeRows,frameSize:bakeFrameSize,duration:animDur});
          },title:"Render the animation into a sprite sheet PNG",
          style:{marginLeft:"auto",minHeight:32,padding:"0 13px",fontSize:9.5,fontFamily:"monospace",fontWeight:700,
            background:"#e8900a",color:"#000",border:"1px solid #e8900a",borderRadius:6,cursor:"pointer",
            touchAction:"manipulation",display:"inline-flex",alignItems:"center"}},"\u2193 BAKE SHEET"):null,
        React.createElement("button",{onClick:function(){setShowTimeline(false);setAnimPlaying(false);},
          style:{marginLeft:p.onBakeTimeline?0:"auto",minHeight:32,padding:"0 12px",fontSize:9.5,fontFamily:"monospace",background:"none",color:"#999",
            border:"1px solid #333",borderRadius:6,cursor:"pointer",touchAction:"manipulation",display:"inline-flex",alignItems:"center"}},"Close")),
      // bake settings row
      p.onBakeTimeline?React.createElement("div",{style:{display:"flex",alignItems:"center",gap:7,marginBottom:7,flexWrap:"wrap"}},
        React.createElement("span",{style:{fontSize:7.5,color:"#777",fontFamily:"monospace",letterSpacing:0.5}},"SHEET"),
        [[2,2],[3,3],[4,4],[5,5],[6,6],[8,8],[4,2],[8,4]].map(function(gr){
          var on=bakeCols===gr[0]&&bakeRows===gr[1];
          return React.createElement("button",{key:gr[0]+"x"+gr[1],onClick:function(){setBakeCols(gr[0]);setBakeRows(gr[1]);},
            style:{minHeight:28,padding:"0 8px",fontSize:8.5,fontFamily:"monospace",fontWeight:700,
              background:on?"#e8900a":"#1c1c1c",color:on?"#000":"#bbb",border:"1px solid "+(on?"#e8900a":"#333"),
              borderRadius:5,cursor:"pointer",touchAction:"manipulation",display:"inline-flex",alignItems:"center"}},gr[0]+"\u00d7"+gr[1]);
        }),
        React.createElement("span",{style:{fontSize:7.5,color:"#777",fontFamily:"monospace",marginLeft:4}},"FRAME"),
        [64,128,256].map(function(fs){
          var on=bakeFrameSize===fs;
          return React.createElement("button",{key:fs,onClick:function(){setBakeFrameSize(fs);},
            style:{minHeight:28,padding:"0 8px",fontSize:8.5,fontFamily:"monospace",fontWeight:700,
              background:on?"#e8900a":"#1c1c1c",color:on?"#000":"#bbb",border:"1px solid "+(on?"#e8900a":"#333"),
              borderRadius:5,cursor:"pointer",touchAction:"manipulation",display:"inline-flex",alignItems:"center"}},fs);
        }),
        React.createElement("span",{style:{fontSize:7.5,color:"#666",fontFamily:"monospace",marginLeft:"auto"}},
          (bakeCols*bakeRows)+" frames \u00b7 "+(bakeCols*bakeFrameSize)+"\u00d7"+(bakeRows*bakeFrameSize)+"px")):null,
      // the scrub track
      React.createElement("div",{
        onPointerDown:function(e){e.currentTarget.setPointerCapture&&e.currentTarget.setPointerCapture(e.pointerId);scrubTo(e.clientX,e.currentTarget);},
        onPointerMove:function(e){if(e.buttons||e.pressure>0)scrubTo(e.clientX,e.currentTarget);},
        style:{position:"relative",height:44,background:"#0d0d0d",border:"1px solid #262626",borderRadius:7,cursor:"pointer",touchAction:"none",overflow:"hidden"}},
        // keyframe ticks
        marks.map(function(t,i){
          return React.createElement("div",{key:i,style:{position:"absolute",left:(t/animDur*100)+"%",top:6,width:11,height:11,
            marginLeft:-5.5,background:"#e8900a",transform:"rotate(45deg)",borderRadius:2}});
        }),
        // playhead
        React.createElement("div",{style:{position:"absolute",left:(animTime/animDur*100)+"%",top:0,bottom:0,width:3,marginLeft:-1.5,
          background:"#9cf",boxShadow:"0 0 6px rgba(153,204,255,0.6)"}})
      ),
      selNode?React.createElement("div",{style:{fontSize:7.5,color:"#666",fontFamily:"monospace",marginTop:5}},
        "Tap the \u25c8 next to any parameter of the selected node to keyframe it at the current time."):
        React.createElement("div",{style:{fontSize:7.5,color:"#666",fontFamily:"monospace",marginTop:5}},"Select a node, then keyframe its parameters with the \u25c8 buttons.")
    );
  }
  var timelineEl=buildTimeline();
  // Tapping empty board closes the add menu too.

  return React.createElement("div",{style:{position:"absolute",inset:0,background:"#0a0a0a",overflow:"hidden"}},
    // Toolbar — sits BELOW the centre mode switch so they never overlap
    React.createElement("div",{style:{position:"absolute",top:38,left:8,right:8,zIndex:10,display:"flex",gap:5,flexWrap:"wrap",alignItems:"center"}},
      // Compact "+ Add Node" button — opens the grouped, colour-coded menu.
      React.createElement("button",{onClick:function(e){
          var r=wrapRef.current?wrapRef.current.getBoundingClientRect():{left:0,top:0,width:300,height:300};
          setAddMenu({ screenX:r.left+60, screenY:r.top+70,
            boardX:(-view.current.x+120)/view.current.z, boardY:(-view.current.y+120)/view.current.z, fromId:null });
        },
        style:{display:"inline-flex",alignItems:"center",gap:6,padding:"5px 12px",fontSize:9,fontFamily:"monospace",fontWeight:700,
          background:"#1a1a1a",color:"#e8900a",border:"1px solid #3a3a3a",borderRadius:5,cursor:"pointer",touchAction:"manipulation"}},
        React.createElement("span",{style:{fontSize:13,lineHeight:1}},"+"),"ADD NODE"),
      // Quick chips for the most-used types (still one tap), the rest live in the menu.
      ["source","blend","filter"].map(function(t){
        var meta=NODE_META[t]||{};
        return React.createElement("button",{key:t,onClick:function(){addNodeOfType(t);},title:meta.hint||"",
          style:{display:"inline-flex",alignItems:"center",gap:4,padding:"4px 8px 4px 6px",fontSize:8,fontFamily:"monospace",
            background:"#161616",color:"#bbb",borderLeft:"3px solid "+(meta.color||"#444"),
            borderTop:"1px solid #2a2a2a",borderRight:"1px solid #2a2a2a",borderBottom:"1px solid #2a2a2a",
            borderRadius:4,cursor:"pointer",touchAction:"manipulation"}},
          React.createElement("span",{style:{width:5,height:5,borderRadius:"50%",background:(meta.color||"#444"),flexShrink:0}}),
          meta.label||NODE_TYPES[t].title);
      })
    ),
    // Live preview (bottom-right, out of the way of the toolbar)
    React.createElement("div",{style:{position:"absolute",bottom:showTimeline?TIMELINE_H+14:8,right:8,zIndex:10,
      border:"1px solid #2a2a2a",borderRadius:6,overflow:"hidden",background:"#000",boxShadow:"0 2px 10px rgba(0,0,0,0.5)"}},
      React.createElement("canvas",{ref:previewRef,width:size,height:size,
        style:{display:"block",width:104,height:104,imageRendering:pixPerf?"pixelated":"auto"}}),
      React.createElement("div",{style:{fontSize:7,color:"#777",textAlign:"center",padding:"2px 0",fontFamily:"monospace",letterSpacing:1,background:"#0d0d0d"}},"OUTPUT"),
      p.onExport?React.createElement("button",{onClick:function(){if(!p.exporting)p.onExport();},
        disabled:p.exporting,
        style:{display:"block",width:"100%",padding:"5px 0",fontSize:8,fontFamily:"monospace",fontWeight:700,
          background:p.exporting?"#333":"#e8900a",color:p.exporting?"#888":"#000",border:"none",cursor:p.exporting?"default":"pointer",
          letterSpacing:0.5}},p.exporting?"RENDERING...":("\u2193 PNG "+(p.exportSize||512))):null
    ),
    // Selected-node parameter panel
    nodePanel,
    // Add-node menu (wire-drop or + button)
    addMenuEl,
    // Batch operations toolbar (2+ selected)
    batchBarEl,
    // Long-press node action menu
    nodeMenuEl,
    // Wire action menu
    wireMenuEl,
    // Preset browser
    presetPanelEl,
    // Animation timeline (bottom)
    timelineEl,
    // Board (pannable)
    React.createElement("div",{ref:wrapRef,
      onPointerDown:onBoardPointerDown,onPointerMove:onMove,onPointerUp:onUp,
      onPointerCancel:onUp,onPointerLeave:onUp,
      onWheel:function(e){
        // Zoom toward the cursor.
        e.preventDefault();
        var r=wrapRef.current.getBoundingClientRect();
        var mx=e.clientX-r.left, my=e.clientY-r.top;
        var factor=e.deltaY<0?1.1:0.9;
        var nz=Math.max(0.25,Math.min(2.5,view.current.z*factor));
        var bx=(mx-view.current.x)/view.current.z, by=(my-view.current.y)/view.current.z;
        applyView(mx-bx*nz, my-by*nz, nz);
      },
      style:{position:"absolute",inset:0,touchAction:"none"}},
      React.createElement("div",{style:{position:"absolute",left:0,top:0,
        transform:"translate("+pan.x+"px,"+pan.y+"px) scale("+zoom+")",transformOrigin:"0 0"}},
        React.createElement("svg",{style:{position:"absolute",left:0,top:0,width:4000,height:4000,overflow:"visible",pointerEvents:"none"}},
          React.createElement("g",{style:{pointerEvents:"stroke"}},wires)
        ),
        nodeEls,
        marquee?React.createElement("div",{style:{position:"absolute",
          left:Math.min(marquee.x0,marquee.x1),top:Math.min(marquee.y0,marquee.y1),
          width:Math.abs(marquee.x1-marquee.x0),height:Math.abs(marquee.y1-marquee.y0),
          background:"rgba(232,144,10,0.12)",border:"1px solid #e8900a",borderRadius:2,pointerEvents:"none"}}):null
      )
    ),
    // ── Bottom-left control dock ──────────────────────────────────
    // Compact by default so it does not eat the screen on a phone; the extra
    // rows appear on demand. Every button is a real finger-sized target.
    (function(){
      var BTN_H=34;                       // comfortable touch height
      function dBtn(label,onClick,opts){
        opts=opts||{};
        return React.createElement("button",{key:opts.key||label,onClick:onClick,title:opts.title||label,
          disabled:opts.disabled,
          style:{minHeight:BTN_H,minWidth:opts.minWidth||38,padding:"0 11px",fontSize:opts.fontSize||10,
            fontFamily:"monospace",fontWeight:700,lineHeight:1,
            background:opts.on?(opts.onColor||"#e8900a"):"#1b1b1b",
            color:opts.on?"#000":(opts.disabled?"#555":(opts.color||"#cbb")),
            border:"1px solid "+(opts.on?(opts.onColor||"#e8900a"):(opts.border||"#333")),
            borderRadius:7,cursor:opts.disabled?"default":"pointer",touchAction:"manipulation",
            opacity:opts.disabled?0.45:1,
            display:"flex",alignItems:"center",justifyContent:"center",gap:4}},label);
      }
      function rowLabel(t){
        return React.createElement("span",{key:"l"+t,style:{fontSize:7,color:"#666",fontFamily:"monospace",
          letterSpacing:1,width:34,flexShrink:0}},t);
      }
      var rows=[];
      // always-visible essentials
      rows.push(React.createElement("div",{key:"main",style:{display:"flex",alignItems:"center",gap:6}},
        dBtn("\u21b6",undo,{key:"u",title:"Undo (Ctrl+Z)",disabled:!canUndo(),minWidth:BTN_H,fontSize:14}),
        dBtn("\u21b7",redo,{key:"r",title:"Redo (Ctrl+Y)",disabled:!canRedo(),minWidth:BTN_H,fontSize:14}),
        dBtn(selMode?"\u2713 SEL":"SEL",function(){setSelMode(!selMode);if(selMode)clearSel();},
          {key:"s",title:"Touch select mode: drag to box-select, tap to add",on:selMode,color:"#9cf",border:"#2a4a5a"}),
        dBtn("\u2726",function(){setPresetOpen(!presetOpen);},
          {key:"p",title:"Ready-made effect graphs",on:presetOpen,onColor:"#7fb0ff",color:"#9cf",border:"#2a4a6a",minWidth:BTN_H,fontSize:13}),
        dBtn(dockOpen?"\u2715":"\u22ef",function(){setDockOpen(!dockOpen);},
          {key:"m",title:dockOpen?"Hide tools":"More tools",minWidth:BTN_H,fontSize:14,color:"#999"})));
      if(dockOpen){
        rows.push(React.createElement("div",{key:"auto",style:{display:"flex",alignItems:"center",gap:5,flexWrap:"wrap",maxWidth:250}},
          rowLabel("AUTO"),
          dBtn("Space",autoSpace,{key:"a1",title:"Lay the whole graph out by flow",fontSize:9}),
          dBtn("Wire",autoConnect,{key:"a2",title:"Auto-connect free inputs to the nearest node",fontSize:9}),
          dBtn("Grid",autoAlignGrid,{key:"a3",title:"Snap nodes to the grid",fontSize:9}),
          dBtn("Fit",autoFrame,{key:"a4",title:"Fit all nodes in view",fontSize:9})));
        // SEL row: selection commands that were previously keyboard-only.
        rows.push(React.createElement("div",{key:"sel",style:{display:"flex",alignItems:"center",gap:5,flexWrap:"wrap",maxWidth:250}},
          rowLabel("SEL"),
          dBtn("All",selectAll,{key:"s1",title:"Select every node (Ctrl+A)",fontSize:9}),
          dBtn("None",function(){setSelNode(null);clearSel();},{key:"s2",title:"Clear the selection",fontSize:9}),
          dBtn("Invert",invertSel,{key:"s3",title:"Invert the selection",fontSize:9})));
        rows.push(React.createElement("div",{key:"view",style:{display:"flex",alignItems:"center",gap:5,flexWrap:"wrap",maxWidth:250}},
          rowLabel("VIEW"),
          dBtn(showTimeline?"\u25c8 ANIM":"ANIM",function(){setShowTimeline(!showTimeline);if(showTimeline)setAnimPlaying(false);},
            {key:"v1",title:"Animation timeline & keyframes",on:showTimeline,color:"#c9a0ff",border:"#4a3a5a",fontSize:9}),
          dBtn(pixPerf?"\u25a0 PIXEL":"PIXEL",function(){setPixPerf(!pixPerf);},
            {key:"v2",title:"Pixel-perfect preview (nearest-neighbour)",on:pixPerf,onColor:"#d05a9a",color:"#e9a0c8",border:"#5a3a4a",fontSize:9}),
          dBtn(pxScale?"\u2194 SCALE":"1:1 PX",togglePixelScaling,
            {key:"v3",title:pxScale?"Pixel sizes scale with resolution, so the preview matches the export"
                                  :"Pixel sizes are absolute: the export will look different from the preview",
             on:pxScale,onColor:"#5ac0a0",color:"#7fd8bd",border:"#2a5a4a",fontSize:9})));
        rows.push(React.createElement("div",{key:"size",style:{display:"flex",alignItems:"center",gap:5}},
          rowLabel("SIZE"),
          [["S",64],["M",96],["L",140],["XL",200]].map(function(o){
            return dBtn(o[0],function(){setThumbSize(o[1]);},{key:"z"+o[0],title:"Preview "+o[0],on:thumbSize===o[1],minWidth:BTN_H,fontSize:9});
          })));
        rows.push(React.createElement("div",{key:"zoom",style:{display:"flex",alignItems:"center",gap:5}},
          rowLabel("ZOOM"),
          dBtn("\u2212",function(){zoomBy(0.8);},{key:"zo",title:"Zoom out",minWidth:BTN_H,fontSize:15}),
          dBtn("\u2922",fitView,{key:"zf",title:"Fit to view",minWidth:BTN_H,fontSize:13}),
          dBtn("+",function(){zoomBy(1.25);},{key:"zi",title:"Zoom in",minWidth:BTN_H,fontSize:15}),
          React.createElement("span",{key:"pc",style:{fontSize:8.5,color:"#888",fontFamily:"monospace",marginLeft:2,minWidth:32}},Math.round(zoom*100)+"%")));
      }
      // The timeline docks along the bottom edge, so lift this out of its way.
      return React.createElement("div",{style:{position:"absolute",left:8,bottom:showTimeline?TIMELINE_H+14:8,zIndex:12,display:"flex",
        flexDirection:"column",gap:6,background:"rgba(14,14,14,0.94)",border:"1px solid #262626",
        borderRadius:11,padding:"8px 9px",boxShadow:"0 3px 14px rgba(0,0,0,0.55)"}},rows);
    })(),
    // Starter hint: only while the graph is nearly empty, then it gets out of the way.
    (nodeCount<=3&&!showTimeline)?React.createElement("div",{style:{position:"absolute",bottom:10,left:"50%",transform:"translateX(-50%)",
      zIndex:10,fontSize:8,maxWidth:250,textAlign:"center",color:"#666",fontFamily:"monospace",lineHeight:1.5,
      background:"rgba(10,10,10,0.75)",padding:"5px 10px",borderRadius:6,pointerEvents:"none"}},
      "Drag a node to move it \u00b7 drag orange to blue to wire \u00b7 tap a wire for options \u00b7 press and hold a node or a slider name for more \u00b7 pinch to zoom"):null
  );
}

// Rolling crash-recovery snapshot. Kept under its own key so it can never
// overwrite the user's explicit save point.
var AUTOSAVE_KEY="texgen-autosave";

// Destination folder for multi-file exports. Resolves to null when the picker
// is unavailable or the user cancels, in which case callers fall back to
// ordinary downloads.
function pickExportDir(){
  if(typeof window==="undefined"||typeof window.showDirectoryPicker!=="function")
    return Promise.resolve(null);
  return window.showDirectoryPicker({mode:"readwrite",id:"texgen-export"})
    .then(function(h){return h;},function(){return null;});
}

// Writes one blob, either into a previously chosen folder or as a download.
// Always resolves - an export set must not stall on a single failed file.
function saveBlobAs(dirHandle,filename,blob){
  if(dirHandle){
    return dirHandle.getFileHandle(filename,{create:true})
      .then(function(fh){return fh.createWritable();})
      .then(function(w){return Promise.resolve(w.write(blob)).then(function(){return w.close();});})
      .catch(function(e){console.error("Could not write "+filename+":",e);});
  }
  return new Promise(function(resolve){
    var url=URL.createObjectURL(blob),a=document.createElement("a");
    a.href=url;a.download=filename;
    document.body.appendChild(a);a.click();
    setTimeout(function(){
      document.body.removeChild(a);URL.revokeObjectURL(url);resolve();
    },200);
  });
}
var AUTOSAVE_INTERVAL_MS=20000;

export default function TexGen(){
  injectSpinnerCSS();
  var canvasRef=useRef(null);
  var renderTimer=useRef(null);
  var _pn=useState("noise");   var panel=_pn[0],_setPanel=_pn[1];
  var prevPanelRef=useRef("noise");
  function setPanel(p){
    if(typeof p==="function"){_setPanel(function(prev){var next=p(prev);if(next!==prev)prevPanelRef.current=prev;return next;});}
    else{if(p!==panel)prevPanelRef.current=panel;_setPanel(p);}
  }
  var _pn2=useState("adj");     var panel2=_pn2[0],setPanel2=_pn2[1];
  var _split=useState(false);   var splitMode=_split[0],setSplitMode=_split[1];
  var abSnapshotRef=useRef(null);   // stored A snapshot (imageData pixels)
  var abCanvasRef=useRef(null);     // offscreen canvas for snapshot
  var _abMode=useState(false);      var abMode=_abMode[0],setAbMode=_abMode[1];
  var _abSplit=useState(0.5);       var abSplit=_abSplit[0],setAbSplit=_abSplit[1];
  var abDragging=useRef(false);
  var _al=useState(0);         var rootAL=_al[0],setRootAL=_al[1];
  var _at=useState("edgeDetect"); var addType=_at[0],setAddType=_at[1];
  var _mob=useState(typeof window!=="undefined"&&window.innerWidth<768);
  var _touch=useState(typeof window!=="undefined"&&window.innerWidth<768); var touchMode=_touch[0],setTouchMode=_touch[1];
  var isMobile=_mob[0],setIsMobile=_mob[1];
  var _ss=useState(""); var saveStatus=_ss[0],setSaveStatus=_ss[1];
  var _pz=useState(1); var previewZoom=_pz[0],setPreviewZoom=_pz[1];
  // Canvas pan offset in screen px — only meaningful when zoomed in.
  var _ppan=useState({x:0,y:0}); var previewPan=_ppan[0],setPreviewPan=_ppan[1];
  // Gesture tracking ref. During pinch/pan we mutate the canvas transform
  // directly (no React re-render per touchmove) and commit to state on end.
  var gestRef=useRef({mode:null,d0:0,z0:1,x0:0,y0:0,px0:0,py0:0,z:1,px:0,py:0});
  // Mobile: user-resizable canvas height (null = default 55vw)
  var _mch=useState(null); var mobileCanvasH=_mch[0],setMobileCanvasH=_mch[1];
  var dividerRef=useRef({y0:0,h0:0,active:false,raf:false});
  var canvasAreaRef=useRef(null);
  // Long-press context menu on layer thumbnails: {idx, y} or null
  var _lm=useState(null); var layerMenu=_lm[0],setLayerMenu=_lm[1];
  var _cvm=useState(null); var canvasMenu=_cvm[0],setCanvasMenu=_cvm[1]; // {x,y} or null
  // long-press state for the canvas quick-actions menu (touch equivalent of right-click)
  var _cvLp=useRef(null), _cvLpMoved=useRef(false), _cvLpOrigin=useRef(null);
  var _toast=useState(null); var toast=_toast[0],setToast=_toast[1]; // transient status message
  var toastTimer=useRef(null);
  var canvasMenuRef=useRef(null); // mirrors canvasMenu for the static keydown handler
  useEffect(function(){canvasMenuRef.current=canvasMenu;},[canvasMenu]);
  function flash(msg){
    setToast(msg);
    if(toastTimer.current)clearTimeout(toastTimer.current);
    toastTimer.current=setTimeout(function(){setToast(null);},1800);
  }
  var _lmr=useState(null); var lmRename=_lmr[0],setLmRename=_lmr[1]; // string while renaming
  var lpRef=useRef({t:null,x:0,y:0});
  var _pvr=useState(256); var previewRes=_pvr[0],setPreviewRes=_pvr[1]; // 64/128/256/512
  // Drain buffer pool when preview resolution changes — old-size buffers
  // are no longer useful and would just sit holding memory
  useEffect(function(){drainBufPool();},[previewRes]);
  var _sp=useState(false); var seamlessPreview=_sp[0],setSeamlessPreview=_sp[1];
  var _pw=useState(340);   var panelWidth=_pw[0],setPanelWidth=_pw[1];
  var _ps=useState("right"); var panelSide=_ps[0],setPanelSide=_ps[1];
  var _us=useState(1);      var uiScale=_us[0],setUiScale=_us[1];  // 0.8 0.9 1 1.1 1.25
  var _slsz=useState(128);  var soloThumbSize=_slsz[0],setSoloThumbSize=_slsz[1];
  var _solo2=useState(-1); var soloLayerIdx=_solo2[0],setSoloLayerIdx=_solo2[1]; // -1=off, N=show only layer N in preview // 64 128 256
  var _giz=useState(false); var gizmoOn=_giz[0],setGizmoOn=_giz[1];
  var _gizMode=useState("move"); var gizmoMode=_gizMode[0],setGizmoMode=_gizMode[1]; // move | rotate | scale
  var gizmoDragging=useRef(null); // null | "xy" | "x" | "y" | "rot" | "scale" | "scaleX" | "scaleY"
  var gizmoStart=useRef({x:0,y:0,ox:0,oy:0,rot:0,sx:0,sy:0});
  var isDraggingPanel=useRef(false);
  var dragStartX=useRef(0);
  var dragStartW=useRef(292);
  var bgTileRef=useRef(null); // div behind canvas for tile bg-repeat
  var _an=useState({tracks:[],gridIdx:2,frameSize:128,fps:60}); var anim=_an[0],setAnim=_an[1];
  // Imported flipbook state
  var _ifb=useState(null); var importedFB=_ifb[0],setImportedFB=_ifb[1];
  var _ifbStatus=useState(""); var fbImportStatus=_ifbStatus[0],setFbImportStatus=_ifbStatus[1];
  var _ifbPost=useState([]); var fbPostFilters=_ifbPost[0],setFbPostFilters=_ifbPost[1];
  var fbProcessedRef=useRef([]);
  // Generation counter — bumped on every filter change. getFbFrame compares
  // per-entry gen vs current gen to detect stale cache without visiting all frames.
  var fbGenRef=useRef(0);
  var _ex=useState(false); var exporting=_ex[0],setExporting=_ex[1];
  var _exPng=useState(false); var exportingPng=_exPng[0],setExportingPng=_exPng[1];
  var _favP=useState("scaleX"); var addFavParam=_favP[0],setAddFavParam=_favP[1];
  var _favL=useState(0);        var addFavLayer=_favL[0],setAddFavLayer=_favL[1];

  var _st=useState(mkState());
  var _appMode=useState("layers"); var appMode=_appMode[0],setAppMode=_appMode[1]; // "layers" | "nodes"
  var _nodeGraph=useState(function(){
    // Seed a tiny starter graph so node mode shows something immediately.
    var g=mkGraph();
    var s=addNode(g,mkNode("source",40,90));
    s.params.layer=mkL(0,(Math.random()*9999)|0,{enabled:true,type:"fbm"}); // so it renders, not black
    var a=addNode(g,mkNode("adjust",230,90));
    var o=addNode(g,mkNode("output",420,90));
    connect(g,s.id,a.id,"in"); connect(g,a.id,o.id,"in");
    return g;
  });
  var nodeGraph=_nodeGraph[0],setNodeGraph=_nodeGraph[1];
  // The currently selected Source node id (so the full layer panel can edit it in node mode)
  var _selSrc=useState(null); var selSourceNodeId=_selSrc[0],setSelSourceNodeId=_selSrc[1];
  var _nfat=useState("gaussBlur"); var nodeFilterAddType=_nfat[0],setNodeFilterAddType=_nfat[1];
  // Edit the layer object held by a Source node, then re-render the graph.
  function nodeLayerOf(nid){var n=nodeGraph.nodes[nid];return n&&n.params?n.params.layer:null;}
  function setNodeLayer(nid,k,v){
    setNodeGraph(function(g){
      var n=g.nodes[nid]; if(!n||!n.params)return g;
      var nl=Object.assign({},n.params.layer||{}); nl[k]=v;
      var nodes=Object.assign({},g.nodes);
      nodes[nid]=Object.assign({},n,{params:Object.assign({},n.params,{layer:nl})});
      return Object.assign({},g,{nodes:nodes});
    });
  }
  function setNodeLayerSP(nid,k,v){
    setNodeGraph(function(g){
      var n=g.nodes[nid]; if(!n||!n.params)return g;
      var L=n.params.layer||{}; var sp=Object.assign({},L.shapeP||{}); sp[k]=v;
      var nl=Object.assign({},L,{shapeP:sp});
      var nodes=Object.assign({},g.nodes);
      nodes[nid]=Object.assign({},n,{params:Object.assign({},n.params,{layer:nl})});
      return Object.assign({},g,{nodes:nodes});
    });
  }
  // Set the whole filters array of a Filter node.
  function setNodeFilters(nid,filters){
    setNodeGraph(function(g){
      var n=g.nodes[nid]; if(!n||!n.params)return g;
      var nodes=Object.assign({},g.nodes);
      nodes[nid]=Object.assign({},n,{params:Object.assign({},n.params,{filters:filters})});
      return Object.assign({},g,{nodes:nodes});
    });
  }
  // Clean up any in-progress interaction when switching app modes, so a drag
  // started in one mode can't leave a dangling ref affecting the other.
  useEffect(function(){
    if(typeof abDragging!=="undefined"&&abDragging.current!==undefined)abDragging.current=false;
    if(typeof gizmoDragging!=="undefined"&&gizmoDragging.current!==undefined)gizmoDragging.current=null;
    if(typeof setSoloLayerIdx==="function"){} // no-op guard; solo stays as set
  },[appMode]);
  var state=_st[0],setState=_st[1];

  // Load from storage on mount.
  // Reads the explicit save and the autosave and takes whichever is newer, so
  // an interrupted session comes back instead of silently starting empty.
  useEffect(function(){
    if(typeof window==="undefined"||!window.storage)return;
    function readKey(k){
      return window.storage.get(k).then(function(res){
        if(!res||!res.value)return null;
        try{return JSON.parse(res.value);}
        catch(e){console.error("Stored project unreadable ("+k+")",e);return null;}
      }).catch(function(){return null;});
    }
    function seedEmpty(){setTimeout(function(){pushUndo(mkState());},100);}

    Promise.all([readKey("texgen-project"),readKey(AUTOSAVE_KEY)]).then(function(r){
      var proj=r[0],auto=r[1];
      var recovered=!!(auto&&(!proj||(auto._savedAt||0)>(proj._savedAt||0)));
      var saved=recovered?auto:proj;
      if(!saved){seedEmpty();return;}
      try{
        function hydrateLayers(layers){
          (layers||[]).forEach(function(L){if(L.imageData)preDecodeImage(L.imageData,function(){});if(!L.uvDists||!L.uvDists.length)L.uvDists=[mkDist()];if(L.uid==null)L.uid=newUid();});
        }
        hydrateLayers(saved.layers);
        (saved.slots||[]).forEach(function(s){hydrateLayers(s.layers);});
        // These were persisted but only ever restored by the manual Load
        // button, so a restart silently dropped the node graph.
        if(saved._nodeGraph){setNodeGraph(saved._nodeGraph);delete saved._nodeGraph;}
        if(saved._appMode){setAppMode(saved._appMode);delete saved._appMode;}
        if(saved._pxScale!==undefined){setPixelScaling(!!saved._pxScale);delete saved._pxScale;}
        setState(function(prev){
          var next=Object.assign({},prev,saved);
          // Seed undo stack with loaded state
          setTimeout(function(){pushUndo(next);},100);
          return next;
        });
        // Runs after React has flushed the dirty effect this load triggers.
        setTimeout(function(){_autoDirty.current=recovered;},200);
        if(recovered){
          setSaveStatus("↻ Recovered");setTimeout(function(){setSaveStatus("");},3000);
        } else {
          setSaveStatus("↑ Loaded");setTimeout(function(){setSaveStatus("");},2000);
        }
      }catch(e){console.error("Load failed",e);seedEmpty();}
    }).catch(function(){seedEmpty();});
  },[]);

  var _rk=useState(0); var canvasEpoch=_rk[0],setCanvasEpoch=_rk[1];
  // Callback passed to sliders so they can trigger a full-res render on release
  var bumpEpoch=function(){setCanvasEpoch(function(k){return k+1;});};
  // After each render, surface the edge-cut analysis (computed during render).
  useEffect(function(){
    var ea=_lastEdgeAnalysis;
    var w=ea&&ea.clipped?{sides:ea.sides,cutCount:ea.cutCount,maxEdge:ea.maxEdge}:null;
    setEdgeWarn(w);
    if(!w)setEdgeWarnDismissed(false); // re-arm for the next cut
  },[canvasEpoch]);
  var _ht=useState(0); var histTick=_ht[0],setHistTick=_ht[1];
  var _sf=useState(false); var showFav=_sf[0],setShowFav=_sf[1];
  var _sw=useState(0.5); var splitRatio=_sw[0],setSplitRatio=_sw[1]; // 0..1, left panel fraction
  var isDraggingSplit=useRef(false);
  var splitDragStartX=useRef(0);
  var splitDragStartR=useRef(0.5);
  var _fim=useState(false); var flipbookInMain=_fim[0],setFlipbookInMain=_fim[1];
  var _af=useState(0); var animFrame=_af[0],setAnimFrame=_af[1];
  var _apl=useState(false); var animPlaying=_apl[0],setAnimPlaying=_apl[1];
  var animPlayTimer=useRef(null);
  var _ap=useState(null); var chanMode=_ap[0],setChanMode=_ap[1];
  var _ac=useState(false); var showAlphaChecker=_ac[0],setShowAlphaChecker=_ac[1];
  var _cl=useState(false); var compareLayers=_cl[0],setCompareLayers=_cl[1];
  var _t33=useState(false); var tileCheck33=_t33[0],setTileCheck33=_t33[1];
  var tile33Ref=useRef(null); // canvas for the crisp 3x3 grid render
  var _ve=useState(false); var showVariations=_ve[0],setShowVariations=_ve[1];
  var _ew=useState(null); var edgeWarn=_ew[0],setEdgeWarn=_ew[1];
  var _ewd=useState(false); var edgeWarnDismissed=_ewd[0],setEdgeWarnDismissed=_ewd[1];
  var _ecm=useState("cut"); var edgeCheckMode=_ecm[0],setEdgeCheckMode=_ecm[1]; // "cut" or "seam"
  useEffect(function(){
    function onResize(){
      setIsMobile(window.innerWidth<768);
      // Canvas gets cleared on any layout reflow — bump key to force redraw
      setCanvasEpoch(function(k){return k+1;});
    }
    window.addEventListener("resize",onResize);
    return function(){window.removeEventListener("resize",onResize);};
  },[]);

  // Ref updated every render so the keyboard handler (registered once) always reads fresh values.
  // This avoids the stale-closure bug that would occur with an empty dependency array [].
  var _keyRef=useRef({});
  _keyRef.current={si:si,L:L,curLayers:curLayers,setL:setL,
    soloLayerIdx:soloLayerIdx,setSoloLayerIdx:setSoloLayerIdx,setCurAL:setCurAL,
    copyCurrentLayer:copyCurrentLayer,pasteCurrentLayer:pasteCurrentLayer,
    randomizeAllSeeds:randomizeAllSeeds,resetLayerToDefaults:resetLayerToDefaults,
    duplicateLayer:duplicateLayer,setAbMode:setAbMode};

  // Keyboard shortcuts — registered once, reads live state via _keyRef
  useEffect(function(){
    var navIds=["noise","adj","fx","anim","global","sprite"];
    function onKey(e){
      var tag=document.activeElement&&document.activeElement.tagName;
      if(tag==="INPUT"||tag==="SELECT"||tag==="TEXTAREA")return;
      var cmd=e.ctrlKey||e.metaKey;
      var ka=_keyRef.current; // always current

      if(cmd&&(e.key==="z"||e.key==="Z")&&!e.shiftKey){e.preventDefault();doUndo();return;}
      if(cmd&&(e.key==="y"||(e.key==="z"&&e.shiftKey)||e.key==="Z")){e.preventDefault();doRedo();return;}
      if(cmd&&e.key==="s"){e.preventDefault();doSave();return;}
      if(cmd)return;

      // S before number check — solo toggle
      if(e.key==="s"||e.key==="S"){e.preventDefault();ka.setSoloLayerIdx(function(v){return v===ka.si?-1:ka.si;});return;}

      var n=parseInt(e.key);
      if(n>=1&&n<=6&&!e.altKey){e.preventDefault();setPanel(navIds[n-1]);return;}
      // Alt+1..8 selects a layer directly
      if(n>=1&&n<=8&&e.altKey){e.preventDefault();ka.setCurAL(Math.min(ka.curLayers.length-1,n-1));return;}
      // f = fit/reset zoom+pan, b = toggle A/B compare
      if((e.key==="f"||e.key==="F")&&!cmd){e.preventDefault();setPreviewZoom(1);setPreviewPan({x:0,y:0});return;}
      if(e.key==="B"&&e.shiftKey&&!cmd){e.preventDefault();
        // Shift+B cycles the active layer's blend mode (quick experimentation)
        var curBM=ka.L&&ka.L.blendMode||"normal";var bi=BM.indexOf(curBM);var nb=BM[(bi+1)%BM.length];
        ka.setL("blendMode",nb);flash("Blend: "+nb);return;}
      if((e.key==="b"||e.key==="B")&&!cmd){e.preventDefault();ka.setAbMode&&ka.setAbMode(function(v){return!v;});return;}
      if(e.key==="["||e.key===","||e.key==="{"){e.preventDefault();setPanel(function(p){var i=navIds.indexOf(p);return navIds[Math.max(0,i-1)];});return;}
      if(e.key==="]"||e.key==="."||e.key==="}"){e.preventDefault();setPanel(function(p){var i=navIds.indexOf(p);return navIds[Math.min(navIds.length-1,i+1)];});return;}
      if(e.key==="g"||e.key==="G"){e.preventDefault();setGizmoOn(function(v){return!v;});return;}
      // +/- zoom canvas; 0 resets to 100%
      if(e.key==="+"||e.key==="="){e.preventDefault();setPreviewZoom(function(z){var i=ZOOM_STEPS.findIndex(function(s){return s>=z;});return i<0?1:ZOOM_STEPS[Math.min(ZOOM_STEPS.length-1,i+1)]||z;});return;}
      if(e.key==="-"||e.key==="_"){e.preventDefault();setPreviewZoom(function(z){var p=null;ZOOM_STEPS.forEach(function(s){if(s<z)p=s;});return p||z;});return;}
      if(e.key==="0"){e.preventDefault();setPreviewZoom(1);return;}
      if(e.key==="r"||e.key==="R"){e.preventDefault();ka.setL("seed",Math.random()*99999|0);return;}
      if(e.key==="d"||e.key==="D"){e.preventDefault();ka.duplicateLayer();return;}
      if(e.key==="h"||e.key==="H"){e.preventDefault();ka.setL("enabled",!ka.L.enabled);return;}
      if(e.key==="c"||e.key==="C"){e.preventDefault();ka.copyCurrentLayer();return;}
      if(e.key==="v"||e.key==="V"){e.preventDefault();ka.pasteCurrentLayer();return;}
      if(e.key==="a"||e.key==="A"){e.preventDefault();ka.randomizeAllSeeds();return;}
      if(e.key==="x"||e.key==="X"){e.preventDefault();ka.resetLayerToDefaults();return;}
      if(e.key==="Escape"){
        // Esc closes context menus first, then exits solo.
        if(canvasMenuRef.current){setCanvasMenu(null);e.preventDefault();return;}
        if(ka.soloLayerIdx>=0){e.preventDefault();ka.setSoloLayerIdx(-1);return;}
      }
      if(e.key==="q"||e.key==="Q"){e.preventDefault();ka.setCurAL(Math.max(0,ka.si-1));return;}
      if(e.key==="w"||e.key==="W"){e.preventDefault();ka.setCurAL(Math.min(ka.curLayers.length-1,ka.si+1));return;}
    }
    window.addEventListener("keydown",onKey);
    return function(){window.removeEventListener("keydown",onKey);};
  },[]);

  // Strip imageData for undo (keep snapshots small)
  function stripImgForUndo(layers){return (layers||[]).map(function(L){return L.imageData?Object.assign({},L,{imageData:"<img>"}):(L);});}
  function snapshotForUndo(s){
    return JSON.stringify({
      layers:stripImgForUndo(s.layers),mask:s.mask,filters:s.filters,
      globalLayerFilters:s.globalLayerFilters,quickActions:s.quickActions,
      blurRadius:s.blurRadius,glowRadius:s.glowRadius,glowIntensity:s.glowIntensity,
      glowThreshold:s.glowThreshold,glowTintR:s.glowTintR,glowTintG:s.glowTintG,glowTintB:s.glowTintB,glowBlend:s.glowBlend,
      colorSpace:s.colorSpace,
      // Layer groups + global adjustments were missing → group ops and global
      // tone/color (vignette etc.) were not undoable. Now captured.
      layerGroups:s.layerGroups,
      gBrightness:s.gBrightness,gContrast:s.gContrast,gSaturation:s.gSaturation,gHue:s.gHue,gVignette:s.gVignette,
      slots:(s.slots||[]).map(function(sl){return Object.assign({},sl,{layers:stripImgForUndo(sl.layers)});})
    });
  }
  // pushUndo: only call on commit (mouse-up, toggle click, etc.) — not on every slider tick
  function pushUndo(s){
    if(undoPushing.current)return;
    var snap=snapshotForUndo(s);
    var stack=undoStack.current,idx=undoIdx.current;
    if(idx>=0&&stack[idx]===snap)return; // unchanged
    stack.splice(idx+1);
    stack.push(snap);
    if(stack.length>40)stack.shift();
    undoIdx.current=stack.length-1;
  }
  // commitUndo: fires after a short debounce to avoid re-render during drag
  var _commitTimer=useRef(null);

  // Add animation track from any slider's "+ anim" button
  function addAnimTrack(paramId,currentVal){
    var paramDef=ANIM_PARAMS.find(function(x){return x.id===paramId;})||{id:paramId,label:paramId,min:0,max:1,step:0.01};
    var newTrack={layerIdx:si,param:paramId,
      from:currentVal!=null?currentVal:(paramDef.min||0),
      to:currentVal!=null?currentVal:(paramDef.max||1),
      globalMode:"absolute",
      timingCurve:DEFAULT_CURVE.map(function(pt){return Object.assign({},pt);})
    };
    setAnim(function(prev){return Object.assign({},prev,{tracks:(prev.tracks||[]).concat([newTrack])});});
    setPanel("anim");
  }

  function commitUndo(){
    if(_commitTimer.current)clearTimeout(_commitTimer.current);
    _commitTimer.current=setTimeout(function(){
      setState(function(p){pushUndo(p);return p;});
    },120);
  }
  function _restoreImgData(saved,prev){
    var restored=Object.assign({},prev,saved);
    restored.layers=(saved.layers||[]).map(function(L,i){
      var cur=prev.layers[i]||{};
      return L.imageData==="<img>"?Object.assign({},L,{imageData:cur.imageData||null}):L;
    });
    restored.slots=(saved.slots||[]).map(function(sl,si2){
      var prevSl=(prev.slots&&prev.slots[si2])||{};
      return Object.assign({},sl,{layers:(sl.layers||[]).map(function(L,li){
        var curL=(prevSl.layers&&prevSl.layers[li])||{};
        return L.imageData==="<img>"?Object.assign({},L,{imageData:curL.imageData||null}):L;
      })});
    });
    return restored;
  }
  function doUndo(){
    var stack=undoStack.current,idx=undoIdx.current;
    if(idx<=0)return;
    undoIdx.current=idx-1;
    try{
      undoPushing.current=true;
      var saved=JSON.parse(stack[idx-1]);
      setState(function(prev){return _restoreImgData(saved,prev);});
    }finally{setTimeout(function(){undoPushing.current=false;},0);}
  }
  function doRedo(){
    var stack=undoStack.current,idx=undoIdx.current;
    if(idx>=stack.length-1)return;
    undoIdx.current=idx+1;
    try{
      undoPushing.current=true;
      var saved=JSON.parse(stack[idx+1]);
      setState(function(prev){return _restoreImgData(saved,prev);});
    }finally{setTimeout(function(){undoPushing.current=false;},0);}
  }
  function setS(k,v){setState(function(p){var n=Object.assign({},p);n[k]=v;return n;});}
  function updMask(k,v){setState(function(p){var m=Object.assign({},p.mask);m[k]=v;return Object.assign({},p,{mask:m});});}

  var editSlot=state.spritesheetMode,asi=state.activeSlotIdx;
  var curLayers=editSlot?state.slots[asi].layers:state.layers;
  var curAL=editSlot?(state.slots[asi].activeLayerIdx||0):rootAL;
  var si=Math.min(curAL,curLayers.length-1);
  var L=curLayers[si];

  function setCurAL(idx){
    if(editSlot){setState(function(p){var s=p.slots.slice();s[asi]=Object.assign({},s[asi],{activeLayerIdx:idx});return Object.assign({},p,{slots:s});});}
    else setRootAL(idx);
  }
  function updL(idx,k,v){
    if(editSlot){setState(function(p){var s=p.slots.slice(),sl=Object.assign({},s[asi]),ls=sl.layers.slice();ls[idx]=Object.assign({},ls[idx]);ls[idx][k]=v;sl.layers=ls;s[asi]=sl;return Object.assign({},p,{slots:s});});}
    else setState(function(p){var l=p.layers.slice();l[idx]=Object.assign({},l[idx]);l[idx][k]=v;return Object.assign({},p,{layers:l});});
  }
  function updLSP(idx,k,v){
    if(editSlot){setState(function(p){var s=p.slots.slice(),sl=Object.assign({},s[asi]),ls=sl.layers.slice();var sp=Object.assign({},ls[idx].shapeP);sp[k]=v;ls[idx]=Object.assign({},ls[idx],{shapeP:sp});sl.layers=ls;s[asi]=sl;return Object.assign({},p,{slots:s});});}
    else setState(function(p){var l=p.layers.slice();var sp=Object.assign({},l[idx].shapeP);sp[k]=v;l[idx]=Object.assign({},l[idx],{shapeP:sp});return Object.assign({},p,{layers:l});});
  }
  function setL(k,v){updL(si,k,v);}
  function setLSP(k,v){updLSP(si,k,v);}

  // ── Layer groups (root layers only; not spritesheet slots) ──
  function addGroup(){
    pushUndo(state);
    setState(function(p){
      var groups=(p.layerGroups||[]).slice();
      var newId=(groups.reduce(function(m,g){return Math.max(m,g.id||0);},0))+1;
      groups.push({id:newId,name:"Group "+newId,enabled:true,opacity:1,collapsed:false});
      // Assign the current layer to the new group right away
      var ls=p.layers.slice();
      if(ls[si]){ls[si]=Object.assign({},ls[si],{groupId:newId});}
      return Object.assign({},p,{layerGroups:groups,layers:ls});
    });
  }
  function updGroup(id,k,v){
    setState(function(p){
      var groups=(p.layerGroups||[]).map(function(g){return g.id===id?Object.assign({},g,(function(){var o={};o[k]=v;return o;})()):g;});
      return Object.assign({},p,{layerGroups:groups});
    });
  }
  function removeGroup(id){
    pushUndo(state);
    setState(function(p){
      var groups=(p.layerGroups||[]).filter(function(g){return g.id!==id;});
      var ls=p.layers.map(function(L){return L.groupId===id?Object.assign({},L,{groupId:null}):L;});
      return Object.assign({},p,{layerGroups:groups,layers:ls});
    });
  }
  function setLayerGroup(layerIdx,groupId){
    setState(function(p){var l=p.layers.slice();l[layerIdx]=Object.assign({},l[layerIdx],{groupId:groupId});return Object.assign({},p,{layers:l});});
  }

  function addLayer(){
    if(curLayers.length>=8){flash("Layer limit reached (8 max)");return;}
    pushUndo(state);
    var idx=curLayers.length,nl=mkL(idx,Math.random()*99999|0,{enabled:true});
    if(editSlot){setState(function(p){var s=p.slots.slice(),sl=Object.assign({},s[asi]);sl.layers=sl.layers.concat([nl]);s[asi]=sl;return Object.assign({},p,{slots:s});});}
    else setState(function(p){return Object.assign({},p,{layers:p.layers.concat([nl])});});
    setCurAL(idx);
  }
  // Quick-add layer with preset blend mode — for one-click workflows
  // e.g. "add a subtract layer" without hunting in a menu
  function addLayerWithBlend(blendMode){
    if(curLayers.length>=8){flash("Layer limit reached (8 max)");return;}
    pushUndo(state);
    var idx=curLayers.length;
    // Smart default type for common blends:
    // - Subtract/Multiply: shape (masks/carves nicely)
    // - Add/Screen: fbm (emissive glow)
    // - Others: fbm
    var defaultType=(blendMode==="subtract"||blendMode==="multiply")?"shape":"fbm";
    var nl=mkL(idx,Math.random()*99999|0,{enabled:true,blendMode:blendMode,type:defaultType});
    // Apply type defaults
    if(TYPE_DEFAULTS[defaultType])Object.assign(nl,TYPE_DEFAULTS[defaultType]);
    if(editSlot){setState(function(p){var s=p.slots.slice(),sl=Object.assign({},s[asi]);sl.layers=sl.layers.concat([nl]);s[asi]=sl;return Object.assign({},p,{slots:s});});}
    else setState(function(p){return Object.assign({},p,{layers:p.layers.concat([nl])});});
    setCurAL(idx);
  }
  function removeLayer(){
    if(curLayers.length<=1){flash("Can't delete the last layer");return;}
    pushUndo(state);
    setSoloLayerIdx(-1);
    var goneUid=curLayers[si]?curLayers[si].uid:null;
    // Drop refUid on any layer that referenced the one being deleted.
    function cleanRefs(list){return list.map(function(ly){return (goneUid!=null&&ly.refUid===goneUid)?Object.assign({},ly,{refUid:null}):ly;});}
    if(editSlot){setState(function(p){var s=p.slots.slice(),sl=Object.assign({},s[asi]),ls=cleanRefs(sl.layers.slice());ls.splice(si,1);sl.layers=ls;sl.activeLayerIdx=Math.max(0,si-1);s[asi]=sl;return Object.assign({},p,{slots:s});});}
    else{setState(function(p){var l=cleanRefs(p.layers.slice());l.splice(si,1);return Object.assign({},p,{layers:l});});setRootAL(Math.max(0,si-1));}
  }
  function duplicateLayer(){
    if(curLayers.length>=8){flash("Layer limit reached (8 max)");return;}
    pushUndo(state);
    var src=curLayers[si];
    var nl=JSON.parse(JSON.stringify(src));
    nl.uid=newUid(); nl.refUid=null;
    nl.label=(nl.label||("L"+(si+1)))+" copy";
    nl.seed=Math.random()*99999|0;
    var newIdx=si+1;
    if(editSlot){setState(function(p){var s=p.slots.slice(),sl=Object.assign({},s[asi]),ls=sl.layers.slice();ls.splice(newIdx,0,nl);sl.layers=ls;sl.activeLayerIdx=newIdx;s[asi]=sl;return Object.assign({},p,{slots:s});});}
    else{setState(function(p){var l=p.layers.slice();l.splice(newIdx,0,nl);return Object.assign({},p,{layers:l});});setRootAL(newIdx);}
  }

  function copyLayersToSlot(slotIdx){
    setState(function(p){
      var s=p.slots.slice();
      var nl=JSON.parse(JSON.stringify(p.layers));
      s[slotIdx]=Object.assign({},s[slotIdx],{layers:nl,activeLayerIdx:0});
      return Object.assign({},p,{slots:s});
    });
  }

  function swapLayers(dir){
    var newIdx=si+dir;
    if(newIdx<0||newIdx>=curLayers.length)return;
    if(editSlot){setState(function(p){var s=p.slots.slice(),sl=Object.assign({},s[asi]),ls=sl.layers.slice();var tmp=ls[si];ls[si]=ls[newIdx];ls[newIdx]=tmp;sl.layers=ls;sl.activeLayerIdx=newIdx;s[asi]=sl;return Object.assign({},p,{slots:s});});}
    else{setState(function(p){var l=p.layers.slice();var tmp=l[si];l[si]=l[newIdx];l[newIdx]=tmp;return Object.assign({},p,{layers:l});});setRootAL(newIdx);}
  }
  function moveLayerUp(){swapLayers(-1);}
  function moveLayerDown(){swapLayers(1);}

  function copyCurrentLayer(){
    var imgData=L.imageData;
    var snap=JSON.parse(JSON.stringify(Object.assign({},L,{imageData:null})));
    snap.imageData=imgData;
    copiedLayer.current=snap;
    // copiedLayer is a ref — doesn't trigger re-render by itself.
    // Bump epoch so the "Paste" button appears immediately after Ctrl+C / C key.
    setCanvasEpoch(function(e){return e+1;});
    flash("Layer copied");
  }
  function pasteCurrentLayer(){
    if(!copiedLayer.current){flash("Nothing to paste");return;}
    pushUndo(state);
    flash("Layer pasted");
    var pasted=JSON.parse(JSON.stringify(copiedLayer.current));
    if(editSlot){
      setState(function(p){var s=p.slots.slice(),sl=Object.assign({},s[asi]),ls=sl.layers.slice();ls[si]=Object.assign({},pasted,{label:ls[si].label||pasted.label,enabled:ls[si].enabled});sl.layers=ls;s[asi]=sl;return Object.assign({},p,{slots:s});});
    } else {
      setState(function(p){var l=p.layers.slice();l[si]=Object.assign({},pasted,{label:l[si].label||pasted.label,enabled:l[si].enabled});return Object.assign({},p,{layers:l});});
    }
  }
  // Run a chain of ops on the active layer set as ONE undoable change.
  function runChainOp(opIds){
    pushUndo(state);
    if(editSlot){
      setState(function(p){
        var s=p.slots.slice(),sl=Object.assign({},s[asi]);
        var res=runChain(opIds,sl.layers,sl.activeLayerIdx||0);
        sl.layers=res.layers; sl.activeLayerIdx=res.activeIdx; s[asi]=sl;
        return Object.assign({},p,{slots:s});
      });
    } else {
      var res=runChain(opIds,state.layers,si);
      setState(function(p){return Object.assign({},p,{layers:res.layers});});
      setRootAL(res.activeIdx);
    }
  }
  // Auto-fix an edge cut: add a Make Tileable global filter that blends the
  // opposite borders so the effect no longer reads as a hard cut when tiled.
  function autoFixEdges(){
    pushUndo(state);
    setState(function(p){
      var gf=(p.globalLayerFilters||[]).slice();
      // Fade the borders to zero so the effect no longer hits a hard edge.
      var has=gf.some(function(f){return f.type==="edgeFade"&&f.enabled;});
      if(!has)gf.push({type:"edgeFade",enabled:true,falloff:0.18});
      return Object.assign({},p,{globalLayerFilters:gf});
    });
    setEdgeWarnDismissed(true);
    flash("Added edge fade to fix the border");
  }
  function applyVariation(newLayers){
    pushUndo(state);
    if(editSlot){
      setState(function(p){var s=p.slots.slice(),sl=Object.assign({},s[asi]);sl.layers=newLayers;s[asi]=sl;return Object.assign({},p,{slots:s});});
    } else {
      setState(function(p){return Object.assign({},p,{layers:newLayers});});
    }
    setShowVariations(false);
  }
  function randomizeAllSeeds(){
    pushUndo(state);
    if(editSlot){
      setState(function(p){var s=p.slots.slice(),sl=Object.assign({},s[asi]),ls=sl.layers.map(function(L){return Object.assign({},L,{seed:Math.random()*99999|0});});sl.layers=ls;s[asi]=sl;return Object.assign({},p,{slots:s});});
    } else {
      setState(function(p){return Object.assign({},p,{layers:p.layers.map(function(l){return Object.assign({},l,{seed:Math.random()*99999|0});})});});
    }
  }
  function resetLayerToDefaults(){
    pushUndo(state);
    var fresh=mkL(si,Math.random()*99999|0,{type:L.type,label:L.label,enabled:L.enabled});
    if(editSlot){
      setState(function(p){var s=p.slots.slice(),sl=Object.assign({},s[asi]),ls=sl.layers.slice();ls[si]=fresh;sl.layers=ls;s[asi]=sl;return Object.assign({},p,{slots:s});});
    } else {
      setState(function(p){var l=p.layers.slice();l[si]=fresh;return Object.assign({},p,{layers:l});});
    }
  }

  var rAFHandle=useRef(null);
  var renderHiTimer=useRef(null);
  // Render dedup: track last rendered key + resolution + chanMode to skip no-op renders
  var lastRenderedKey=useRef(null);
  var lastRenderedRes=useRef(0);
  var lastRenderedChan=useRef(null);
  var lastRenderedMode=useRef(""); // "draft" | "hi"
  var lastRenderedSolo=useRef(-2);  // -2 = unset, -1 = no solo, N = solo idx
  // Undo/redo history (circular buffer, max 40 snapshots)
  var undoStack=useRef([]);
  var undoIdx=useRef(-1);
  var undoPushing=useRef(false); // prevent pushing during undo/redo
  var copiedLayer=useRef(null);  // clipboard for layer copy/paste

  // Build a lightweight hash of render-relevant state to skip no-op renders
  function renderKey(s){
    // Comprehensive hash — every render-affecting field must appear here.
    // If a param is missing from this hash, changes to it will be silently ignored.
    function hashNum(h,v){return Math.imul(h^((v*1000003)|0),0x9e3779b9);}
    function hashStr(h,str){if(!str)return h;for(var i=0;i<str.length;i++)h=Math.imul(h^str.charCodeAt(i),0x9e3779b9);return h;}
    function hashL(h,L){
      // Reference identity: changing the ref target (or the source) must re-render.
      h=hashStr(h,L.refUid||"");h=hashStr(h,L.uid||"");h=hashNum(h,(L.refLocalXform?1:0)+(L.refLocalBlend?2:0)+(L.refLocalAdjust?4:0));
      // UV transform
      h=hashNum(h,(L.seed||0));h=hashNum(h,(L.scaleX||0)*1000);h=hashNum(h,(L.scaleY||0)*1000);
      h=hashNum(h,(L.rotation||0)*100);h=hashNum(h,(L.skewX||0)*1000);h=hashNum(h,(L.skewY||0)*1000);h=hashNum(h,(L.offsetX||0)*1000);h=hashNum(h,(L.offsetY||0)*1000);
      h=hashNum(h,L.scaleLinked?1:0);h=hashNum(h,L.seamless?1:0);h=hashStr(h,L.seamlessMode||"");
      // Blend
      h=hashNum(h,(L.opacity||1)*1000);h=hashStr(h,L.blendMode);h=hashStr(h,L.channels);
      h=hashNum(h,L.enabled?1:0);
      // Adjust
      h=hashNum(h,(L.contrast||1)*1000);h=hashStr(h,L.contrastMode||"power");
      h=hashNum(h,(L.midpoint||0.5)*1000);h=hashNum(h,(L.brightness||0)*1000);
      h=hashNum(h,L.invert?1:0);
      h=hashNum(h,(L.remapIn0||0)*1000);h=hashNum(h,(L.remapIn1||1)*1000);
      h=hashNum(h,(L.outputLo||0)*1000);h=hashNum(h,(L.outputHi||1)*1000);
      h=hashNum(h,(L.steps||0));h=hashNum(h,(L.multiplier||1)*1000);
      // Color
      h=hashStr(h,L.colorA);h=hashStr(h,L.colorB);var cs=L.colorStops||[];h=hashNum(h,cs.length);for(var csi=0;csi<cs.length;csi++){h=hashNum(h,(cs[csi].pos||0)*1000);h=hashStr(h,cs[csi].color||"");}
      h=hashNum(h,(L.hueShift||0)*10);h=hashNum(h,(L.saturation||1)*1000);
      // Curve (each control point x,y)
      h=hashStr(h,L.curveMode||"smooth");
      var cp=L.curvePoints||[];h=hashNum(h,cp.length);
      for(var ci=0;ci<cp.length;ci++){h=hashNum(h,(cp[ci].x||0)*1000);h=hashNum(h,(cp[ci].y||0)*1000);}
      // FX
      h=hashNum(h,(L.layerBlur||0)*10);h=hashNum(h,(L.layerGlow||0)*10);
      h=hashNum(h,(L.layerGlowIntensity||0.5)*100);
      // Type and noise params
      h=hashStr(h,L.type);h=hashStr(h,L.fbmBase||"perlin");h=hashStr(h,L.fbmMode||"normal");
      h=hashNum(h,L.octaves||5);h=hashNum(h,(L.lacunarity||2)*100);h=hashNum(h,(L.gain||0.5)*1000);
      h=hashStr(h,L.warpBase||"perlin");h=hashNum(h,(L.warpStr||0)*100);
      h=hashNum(h,L.warpLevels||1);h=hashNum(h,(L.warp2!=null?L.warp2:0.8)*1000);h=hashStr(h,L.warpMode||"normal");
      h=hashStr(h,L.curlMode||"magnitude");h=hashNum(h,(L.curlScale||0)*10);h=hashNum(h,L.curlOct||4);
      h=hashNum(h,(L.cloudCov!=null?L.cloudCov:0.5)*1000);h=hashNum(h,(L.cloudSoft!=null?L.cloudSoft:0.5)*1000);h=hashStr(h,L.cloudMode||"billow");
      h=hashStr(h,L.worleyMode||"f1");h=hashStr(h,L.worleyMetric||"euclidean");
      h=hashNum(h,(L.worleyJitter!=null?L.worleyJitter:1)*1000);h=hashNum(h,(L.worleyContrast!=null?L.worleyContrast:1)*1000);h=hashStr(h,L.voronoiVarMode||"flat");h=hashNum(h,(L.worleySmooth||0)*1000);h=hashNum(h,(L.worleyWarp||0)*1000);
      // Scatter
      h=hashNum(h,L.scGrid||0);h=hashNum(h,(L.scDensity!=null?L.scDensity:1)*1000);
      h=hashNum(h,(L.scSize||0)*1000);h=hashNum(h,(L.scSizeVar||0)*1000);
      h=hashNum(h,(L.scJitter!=null?L.scJitter:0.8)*1000);
      h=hashStr(h,L.scMode||"disc");h=hashStr(h,L.scShape||"circle");h=hashStr(h,L.scBlend||"max");
      h=hashNum(h,(L.scScaleXMin!=null?L.scScaleXMin:1)*1000);h=hashNum(h,(L.scScaleXMax!=null?L.scScaleXMax:1)*1000);
      h=hashNum(h,(L.scScaleYMin!=null?L.scScaleYMin:1)*1000);h=hashNum(h,(L.scScaleYMax!=null?L.scScaleYMax:1)*1000);
      h=hashNum(h,(L.scRotMin||0)*1000);h=hashNum(h,(L.scRotMax||0)*1000);
      h=hashNum(h,(L.scIntMin!=null?L.scIntMin:1)*1000);h=hashNum(h,(L.scIntMax!=null?L.scIntMax:1)*1000);
      h=hashNum(h,L.scSourceIdx!=null?L.scSourceIdx:-1);
      if(L.scShapeP){h=hashNum(h,(L.scShapeP.r1||0)*1000);h=hashNum(h,(L.scShapeP.soft||0)*10000);}
      h=hashStr(h,L.gradientType||"radial");
      h=hashNum(h,(L.gradScale||1)*1000);h=hashNum(h,(L.gradFreq||1)*1000);h=hashNum(h,(L.gradPow||1)*1000);
      h=hashNum(h,(L.woodRings||0)*100);h=hashNum(h,(L.woodTurb||0)*100);
      h=hashNum(h,(L.marbleFreq||0)*100);h=hashNum(h,(L.marbleTurb||0)*100);
      h=hashNum(h,(L.gaborFreq||0)*10);h=hashNum(h,(L.gaborBW||0)*100);
      h=hashNum(h,(L.gaborOrient||0)*1000);h=hashNum(h,(L.gaborSpread!=null?L.gaborSpread:1)*1000);h=hashNum(h,(L.gaborAniso||0)*1000);h=hashNum(h,L.gaborHarm||1);h=hashNum(h,(L.gaborPhase||0)*1000);
      h=hashNum(h,(L.dustCoverage!=null?L.dustCoverage:0.5)*1000);h=hashNum(h,(L.dustSize!=null?L.dustSize:0.5)*1000);
      h=hashNum(h,(L.debrisDensity!=null?L.debrisDensity:0.5)*1000);h=hashNum(h,(L.debrisSharp||2)*100);
      h=hashNum(h,(L.grainRough!=null?L.grainRough:0.5)*1000);h=hashNum(h,(L.grainContrast||1.5)*100);
      h=hashStr(h,L.hexMode||"edges");h=hashNum(h,(L.hexThick!=null?L.hexThick:0.12)*1000);h=hashNum(h,(L.hexJitter||0)*1000);
      h=hashNum(h,(L.scrDensity!=null?L.scrDensity:0.5)*1000);h=hashNum(h,(L.scrLength!=null?L.scrLength:0.6)*1000);h=hashNum(h,(L.scrThick!=null?L.scrThick:0.04)*1000);h=hashNum(h,(L.scrAngle||0)*1000);h=hashNum(h,(L.scrAngleVar!=null?L.scrAngleVar:1)*1000);h=hashNum(h,(L.scrTaper!=null?L.scrTaper:1)*1000);
      h=hashNum(h,(L.spkDensity!=null?L.spkDensity:0.4)*1000);h=hashNum(h,(L.spkSize!=null?L.spkSize:0.4)*1000);h=hashNum(h,(L.spkGlow!=null?L.spkGlow:0.5)*1000);h=hashNum(h,(L.spkStreak||0)*1000);h=hashNum(h,(L.spkTwinkle!=null?L.spkTwinkle:0.6)*1000);
      h=hashNum(h,(L.truThick!=null?L.truThick:0.18)*1000);h=hashStr(h,L.truMode||"arcs");
      h=hashNum(h,(L.crystalSharp||0)*10);h=hashNum(h,(L.sparseDens||0)*10);
      h=hashStr(h,L.crystalMode||"facets");h=hashStr(h,L.crystalMetric||"manhattan");h=hashNum(h,(L.crystalJitter!=null?L.crystalJitter:1)*1000);
      h=hashNum(h,(L.marbleAngle||0)*1000);h=hashNum(h,(L.marbleSharp||1)*100);
      h=hashNum(h,(L.sparseSizeVar||0)*1000);h=hashNum(h,(L.sparseIntVar||0)*1000);h=hashStr(h,L.sparseFalloff||"gauss");
      h=hashNum(h,(L.iqSmooth||0)*1000);h=hashNum(h,(L.hpBlur||0)*1000);
      h=hashNum(h,(L.iqSmoothK!=null?L.iqSmoothK:0.4)*1000);h=hashStr(h,L.iqMetric||"euclidean");h=hashNum(h,(L.iqJitter!=null?L.iqJitter:1)*1000);h=hashStr(h,L.iqMode||"smooth");h=hashNum(h,(L.iqContrast||1)*1000);
      h=hashNum(h,(L.causWarp!=null?L.causWarp:1.1)*1000);h=hashNum(h,(L.causFold!=null?L.causFold:0.4)*1000);h=hashNum(h,(L.causSharp!=null?L.causSharp:6)*100);h=hashNum(h,(L.causBright!=null?L.causBright:0.28)*1000);h=hashStr(h,L.causMode||"lines");
      h=hashNum(h,L.plasmaWaves||4);h=hashNum(h,(L.plasmaWarp||0)*1000);h=hashStr(h,L.plasmaMode||"classic");
      h=hashNum(h,(L.dirScaleX||0)*100);h=hashNum(h,(L.dirScaleY||0)*100);h=hashNum(h,(L.fiberAngle||0)*10);h=hashNum(h,(L.fiberStretch||0)*100);h=hashNum(h,(L.streakLength||0)*100);h=hashNum(h,(L.streakDensity||0)*100);h=hashNum(h,(L.waveAmp||0)*1000);h=hashNum(h,(L.waveWarp||0)*1000);h=hashNum(h,(L.waveThick||0)*1000);h=hashNum(h,(L.waveOffset||0)*1000);h=hashNum(h,(L.waveFreq||0)*100);h=hashNum(h,(L.dirContrast||1)*1000);h=hashNum(h,(L.fiberCross!=null?L.fiberCross:0.15)*1000);
      h=hashNum(h,(L.polarCount||0));h=hashNum(h,(L.polarRadius||0)*1000);
      h=hashNum(h,(L.polarSpread||0)*1000);h=hashNum(h,(L.slopeAngle||0)*10);
      // Shape
      h=hashStr(h,L.shapeKind||"circle");
      h=hashNum(h,L.flipH?1:0);h=hashNum(h,L.flipV?1:0);h=hashNum(h,L.mirrorH?1:0);h=hashNum(h,L.mirrorV?1:0);
      h=hashNum(h,L.radialTile?1:0);h=hashNum(h,L.radialCount||6);h=hashNum(h,(L.radialAngleOffset||0)*10);h=hashNum(h,(L.radialRadius||0)*1000);
      h=hashNum(h,(L.radialOffsetX||0)*1000);h=hashNum(h,(L.radialOffsetY||0)*1000);
      // Shape curve
      var scp=L.shapeCurvePoints||[];h=hashNum(h,scp.length);
      for(var sci=0;sci<scp.length;sci++){h=hashNum(h,(scp[sci].x||0)*1000);h=hashNum(h,(scp[sci].y||0)*1000);}
      h=hashStr(h,L.shapeCurveMode||"smooth");var swp=L.shapeWidthCurvePoints||[];h=hashNum(h,swp.length);for(var swi=0;swi<swp.length;swi++){h=hashNum(h,(swp[swi].x||0)*1000);h=hashNum(h,(swp[swi].y||0)*1000);}h=hashStr(h,L.shapeWidthCurveMode||"smooth");
      if(L.shapeP){var sp=L.shapeP;
        h=hashNum(h,(sp.r1||0)*1000);h=hashNum(h,(sp.r2||0)*1000);
        h=hashNum(h,(sp.thick||0)*1000);h=hashNum(h,(sp.corner||0)*1000);
        h=hashNum(h,(sp.soft||0)*10000);h=hashNum(h,sp.gearTeeth||0);
        h=hashNum(h,sp.petalCount||0);
        h=hashNum(h,(sp.rot||0)*1000);h=hashNum(h,(sp.outline||0)*1000);
      }
      // Image
      h=hashNum(h,L.imageData?L.imageData.length:0);
      h=hashStr(h,L.imageColorMode||"luma");h=hashNum(h,L.imageBilinear!==false?1:0);
      // UV distortions (type + amt + freq)
      var ud=L.uvDists||[];h=hashNum(h,ud.length);
      for(var i=0;i<ud.length;i++){
        h=hashStr(h,ud[i].type||"none");
        h=hashNum(h,(ud[i].amt||0)*1000);
        h=hashNum(h,(ud[i].freq||3)*100);
        h=hashNum(h,(ud[i].offsetX||0)*1000);
        h=hashNum(h,(ud[i].offsetY||0)*1000);
        h=hashNum(h,ud[i].sourceLayerIdx||0);
        h=hashStr(h,ud[i].falloff||"");
        h=hashNum(h,(ud[i].falloffRadius||0.5)*100);
        h=hashNum(h,(ud[i].oct||4));h=hashNum(h,(ud[i].lac||2)*10);h=hashNum(h,(ud[i].gain||0.5)*100);
        h=hashNum(h,(ud[i].angle||0)*10);h=hashNum(h,(ud[i].count||0));h=hashNum(h,(ud[i].spread||0)*100);
        h=hashStr(h,ud[i].base||"");
      }
      // Per-layer filters (all values)
      // Per-layer mask
      if(L.mask){var lm=L.mask;h=hashStr(h,lm.type||"none");h=hashNum(h,(lm.radius||0)*1000);
        h=hashNum(h,(lm.hardness||0)*1000);h=hashNum(h,(lm.strength!=null?lm.strength:1)*1000);
        h=hashNum(h,(lm.offsetX||0)*1000);h=hashNum(h,(lm.offsetY||0)*1000);
        h=hashNum(h,(lm.scaleX!=null?lm.scaleX:1)*1000);h=hashNum(h,(lm.scaleY!=null?lm.scaleY:1)*1000);
        h=hashNum(h,(lm.angle||0)*10);h=hashNum(h,lm.invert?1:0);h=hashStr(h,lm.apply||"both");}
      var lf=L.layerFilters||[];h=hashNum(h,lf.length);
      for(var i=0;i<lf.length;i++){
        h=hashStr(h,lf[i].type);h=hashNum(h,lf[i].enabled?1:0);
        h=hashNum(h,(lf[i].strength||1)*100);h=hashNum(h,(lf[i].angle||0)*10);
        h=hashNum(h,(lf[i].levels||0));h=hashNum(h,(lf[i].cutoff||0)*1000);
        h=hashNum(h,(lf[i].softness||0)*1000);h=hashNum(h,(lf[i].blur||0)*10);
        h=hashStr(h,lf[i].uvDistType||"none");h=hashNum(h,(lf[i].uvDistAmt||0)*1000);
      }
      return h;
    }
    var h=0x811c9dc5;
    var ls=s.layers||[];h=hashNum(h,ls.length);
    for(var i=0;i<ls.length;i++)h=hashL(h,ls[i]);
    // Layer groups (enabled + opacity fold into render) + each layer's groupId
    var grps=s.layerGroups||[];h=hashNum(h,grps.length);
    for(var gi=0;gi<grps.length;gi++){h=hashNum(h,grps[gi].id||0);h=hashNum(h,grps[gi].enabled===false?0:1);h=hashNum(h,(grps[gi].opacity!=null?grps[gi].opacity:1)*1000);h=hashNum(h,(grps[gi].brightness||0)*1000);h=hashNum(h,(grps[gi].contrast!=null?grps[gi].contrast:1)*1000);}
    for(var li2=0;li2<ls.length;li2++)h=hashNum(h,ls[li2].groupId!=null?ls[li2].groupId:-1);
    // Spritesheet slots
    var ss=s.slots||[];
    for(var i=0;i<ss.length;i++){var sl=ss[i].layers||[];h=hashNum(h,sl.length);for(var j=0;j<sl.length;j++)h=hashL(h,sl[j]);}
    // Mask (all fields)
    var m=s.mask||{};h=hashStr(h,m.type||"none");
    h=hashNum(h,(m.strength||1)*1000);h=hashNum(h,(m.radius||0.5)*1000);
    h=hashNum(h,(m.hardness||0)*1000);h=hashNum(h,(m.offsetX||0)*1000);
    h=hashNum(h,(m.offsetY||0)*1000);h=hashNum(h,(m.scaleX||1)*1000);
    h=hashNum(h,(m.scaleY||1)*1000);h=hashNum(h,(m.angle||0)*10);
    h=hashNum(h,m.invert?1:0);
    h=hashStr(h,m.uvDistType||"none");h=hashNum(h,(m.uvDistAmt||0)*1000);
    h=hashNum(h,(m.uvDistFreq||3)*100);
    // Global filters (all values)
    var fs=s.filters||[];h=hashNum(h,fs.length);
    for(var i=0;i<fs.length;i++){
      h=hashStr(h,fs[i].type);h=hashNum(h,fs[i].enabled?1:0);
      h=hashNum(h,(fs[i].strength||1)*100);h=hashNum(h,(fs[i].angle||0)*10);
      h=hashNum(h,(fs[i].levels||0));h=hashNum(h,(fs[i].cutoff||0)*1000);
      h=hashNum(h,(fs[i].softness||0)*1000);h=hashNum(h,(fs[i].blur||0)*10);
      h=hashNum(h,(fs[i].samples||0));h=hashNum(h,(fs[i].amount||0)*1000);
      h=hashStr(h,fs[i].uvDistType||"none");h=hashNum(h,(fs[i].uvDistAmt||0)*1000);h=hashNum(h,(fs[i].uvDistFreq||3)*100);
    }
    // Global settings
    h=hashNum(h,(s.blurRadius||0)*10);h=hashNum(h,(s.glowRadius||0)*10);
    h=hashNum(h,(s.gBrightness||0)*1000);h=hashNum(h,(s.gContrast!=null?s.gContrast:1)*1000);h=hashNum(h,(s.gSaturation!=null?s.gSaturation:1)*1000);h=hashNum(h,(s.gHue||0)*10);h=hashNum(h,(s.gVignette||0)*1000);
    h=hashNum(h,(s.glowIntensity||0)*100);
    h=hashStr(h,s.colorSpace||"linear");
    h=hashNum(h,(s.glowThreshold||0)*1000);h=hashNum(h,(s.glowTintR||1)*100);h=hashNum(h,(s.glowTintG||1)*100);h=hashNum(h,(s.glowTintB||1)*100);h=hashStr(h,s.glowBlend||"add");
    h=hashNum(h,s.spritesheetMode?1:0);h=hashNum(h,s.activeSlotIdx||0);
    var glf=s.globalLayerFilters||[];h=hashNum(h,glf.length);
    for(var gi=0;gi<glf.length;gi++){h=hashStr(h,glf[gi].type||"");h=hashNum(h,glf[gi].enabled?1:0);h=hashNum(h,(glf[gi].strength||1)*100);h=hashNum(h,(glf[gi].amount||0)*100);h=hashStr(h,glf[gi].uvDistType||"none");h=hashNum(h,(glf[gi].uvDistAmt||0)*1000);}
    return (h>>>0).toString(36);
  }

  // 2-tier debounced render: 60ms draft (LO-res) + 500ms idle full-res
  // Debouncing is critical — without it every slider tick fires a full CPU render
  useEffect(function(){
    if(renderTimer.current)clearTimeout(renderTimer.current);
    if(renderHiTimer.current)clearTimeout(renderHiTimer.current);
    if(rAFHandle.current)cancelAnimationFrame(rAFHandle.current);

    // Compute render key once for dedup guard.
    // Skip render entirely if nothing visually relevant changed AND
    // resolution/chanMode/solo state are unchanged from last successful render.
    // Flipbook playback bypasses dedup (frame changes externally).
    var curKey=renderKey(state);
    var keySame=curKey===lastRenderedKey.current;

    // RAF throttle + adaptive draft resolution
    // During drag: prioritize responsiveness, but keep enough detail to read changes
    // For 512 preview: 192px draft (9x faster than full, still recognizable)
    // For 1024/2048: 256px draft (good fidelity, user expects slower with big previews)
    var draftRes;
    if(_isSliderActive){
      draftRes=Math.min(previewRes,Math.min(256,Math.max(192,previewRes>>2)));
    } else {
      draftRes=Math.min(previewRes,Math.max(128,previewRes>>1));
    }

    // Dedup check for draft render: same key + same draft res + same chan + same solo
    var draftDedupHit=keySame
      && lastRenderedRes.current===draftRes
      && lastRenderedChan.current===chanMode
      && lastRenderedSolo.current===soloLayerIdx
      && lastRenderedMode.current==="draft"
      && !flipbookInMain; // flipbook needs to redraw on frame change

    if(!_rafPending&&!draftDedupHit){
      _rafPending=true;
      rAFHandle.current=requestAnimationFrame(function(){
        _rafPending=false;
        if(canvasRef.current&&flipbookInMain&&importedFB){try{
            var _seq=fbSequence(importedFB);
            var _fi=_seq.length?_seq[Math.min(animFrame,_seq.length-1)]:0;
            var _fbuf=getFbFrame(_fi);var _fsize=importedFB.frameSize;
            if(_fbuf){var _cv=canvasRef.current;_cv.width=_cv.height=_fsize;
              var _fctx=_cv.getContext("2d"),_fimg=_fctx.createImageData(_fsize,_fsize);
              for(var _fpi=0;_fpi<_fsize*_fsize;_fpi++){
                var _dr=clamp(_fbuf[_fpi*4]),_dg=clamp(_fbuf[_fpi*4+1]),_db=clamp(_fbuf[_fpi*4+2]),_da=clamp(_fbuf[_fpi*4+3]);
                // Channel isolation works on imported flipbooks too — A shows
                // the frame's real alpha as grayscale (vital for VFX sheets)
                if(chanMode){var _dch=chanMode==="r"?_dr:chanMode==="g"?_dg:chanMode==="b"?_db:_da;_dr=_dch;_dg=_dch;_db=_dch;}
                _fimg.data[_fpi*4]=_dr*255+0.5|0;
                _fimg.data[_fpi*4+1]=_dg*255+0.5|0;
                _fimg.data[_fpi*4+2]=_db*255+0.5|0;
                _fimg.data[_fpi*4+3]=255;}
              _fctx.putImageData(_fimg,0,0);}
        }catch(e){console.error(e);}
        }else if(canvasRef.current&&!flipbookInMain)try{
          var _rState=soloLayerIdx>=0?Object.assign({},state,{layers:state.layers.map(function(L,li){return li===soloLayerIdx?Object.assign({},L,{blendMode:"normal",opacity:1,enabled:true}):Object.assign({},L,{enabled:false});})}) :state;
          renderAll(canvasRef.current,_rState,draftRes,chanMode,showAlphaChecker);
          // Mark this render as completed (key + params)
          lastRenderedKey.current=curKey;
          lastRenderedRes.current=draftRes;
          lastRenderedChan.current=chanMode;
          lastRenderedSolo.current=soloLayerIdx;
          lastRenderedMode.current="draft";
        }catch(e){console.error(e);}
      });
    }

    // Full-res: after 500ms of no changes AND slider not active
    // Uses a shorter delay (300ms) if slider already released
    var hiDelay=_isSliderActive?800:350;

    // Dedup check for hi render: same key + same hi res + same chan + same solo + already in hi mode
    var hiDedupHit=keySame
      && lastRenderedRes.current===previewRes
      && lastRenderedChan.current===chanMode
      && lastRenderedSolo.current===soloLayerIdx
      && lastRenderedMode.current==="hi"
      && !flipbookInMain;

    if(!hiDedupHit){
      renderHiTimer.current=setTimeout(function(){
        // Double-check slider is still not active at fire time
        if(_isSliderActive)return;
        if(canvasRef.current)try{
          if(flipbookInMain&&importedFB){
            var _seq2=fbSequence(importedFB);
            var _fi2=_seq2.length?_seq2[Math.min(animFrame,_seq2.length-1)]:0;
            var _fbuf2=getFbFrame(_fi2);var _fsize2=importedFB.frameSize;
            if(_fbuf2){var _cv2=canvasRef.current;_cv2.width=_cv2.height=_fsize2;
              var _fctx2=_cv2.getContext("2d"),_fimg2=_fctx2.createImageData(_fsize2,_fsize2);
              for(var _fpi2=0;_fpi2<_fsize2*_fsize2;_fpi2++){
                var _hr=clamp(_fbuf2[_fpi2*4]),_hg=clamp(_fbuf2[_fpi2*4+1]),_hb=clamp(_fbuf2[_fpi2*4+2]),_ha=clamp(_fbuf2[_fpi2*4+3]);
                if(chanMode){var _hch=chanMode==="r"?_hr:chanMode==="g"?_hg:chanMode==="b"?_hb:_ha;_hr=_hch;_hg=_hch;_hb=_hch;}
                _fimg2.data[_fpi2*4  ]=_hr*255+0.5|0;
                _fimg2.data[_fpi2*4+1]=_hg*255+0.5|0;
                _fimg2.data[_fpi2*4+2]=_hb*255+0.5|0;
                _fimg2.data[_fpi2*4+3]=255;}
              _fctx2.putImageData(_fimg2,0,0);}
          } else if(flipbookInMain){
            var _grid=FB_GRIDS[anim.gridIdx!=null?anim.gridIdx:2];
            var _t=_grid.frames>1?animFrame/(_grid.frames-1):0;
            var _fs=buildFrameState(state,anim,_t);
            var _buf=renderFrameBuf(_fs,previewRes);
            var _cva=canvasRef.current;_cva.width=_cva.height=previewRes;
            var _ctxa=_cva.getContext("2d"),_imga=_ctxa.createImageData(previewRes,previewRes);
            var _doSRGB=state.colorSpace==="srgb";
            for(var _i=0;_i<previewRes*previewRes;_i++){
              var _r=clamp(_buf[_i*4]),_g=clamp(_buf[_i*4+1]),_b=clamp(_buf[_i*4+2]),_a=clamp(_buf[_i*4+3]);
              if(_doSRGB){_r=toSRGB(_r);_g=toSRGB(_g);_b=toSRGB(_b);}
              if(chanMode){var _ch=chanMode==="r"?_r:chanMode==="g"?_g:chanMode==="b"?_b:_a;_r=_ch;_g=_ch;_b=_ch;_a=1;}
              _imga.data[_i*4]=_r*255+0.5|0;_imga.data[_i*4+1]=_g*255+0.5|0;_imga.data[_i*4+2]=_b*255+0.5|0;_imga.data[_i*4+3]=_a*255+0.5|0;
            }
            _ctxa.putImageData(_imga,0,0);
          } else {
            var _rState2=soloLayerIdx>=0?Object.assign({},state,{layers:state.layers.map(function(L,li){return li===soloLayerIdx?Object.assign({},L,{blendMode:"normal",opacity:1,enabled:true}):Object.assign({},L,{enabled:false});})}) :state;
            renderAll(canvasRef.current,_rState2,previewRes,chanMode,showAlphaChecker);setHistTick(function(t){return t+1;});
            // Mark hi render as completed
            lastRenderedKey.current=curKey;
            lastRenderedRes.current=previewRes;
            lastRenderedChan.current=chanMode;
            lastRenderedSolo.current=soloLayerIdx;
            lastRenderedMode.current="hi";
          }
        }catch(e){console.error(e);}
      },hiDelay);
    }

    return function(){
      if(renderTimer.current)clearTimeout(renderTimer.current);
      if(renderHiTimer.current)clearTimeout(renderHiTimer.current);
      if(rAFHandle.current){cancelAnimationFrame(rAFHandle.current);_rafPending=false;}
    };
  },[state,canvasEpoch,flipbookInMain,chanMode,previewRes,soloLayerIdx,importedFB,animFrame,fbPostFilters,showAlphaChecker]);

  // When flipbookInMain: redraw main canvas when animFrame changes
  // If importedFB is active, the main render useEffect already handles display — skip here.
  useEffect(function(){
    if(!flipbookInMain||!canvasRef.current||importedFB)return;
    try{
      var grd=FB_GRIDS[anim.gridIdx!=null?anim.gridIdx:2];
      var t=grd.frames>1?animFrame/(grd.frames-1):0;
      var fs=buildFrameState(state,anim,t);
      var buf=renderFrameBuf(fs,PREVIEW_HI);
      var cv=canvasRef.current;cv.width=cv.height=PREVIEW_HI;
      var ctx=cv.getContext("2d"),img=ctx.createImageData(PREVIEW_HI,PREVIEW_HI);
      var doS=state.colorSpace==="srgb";
      for(var ii=0;ii<PREVIEW_HI*PREVIEW_HI;ii++){
        var r=clamp(buf[ii*4]),g=clamp(buf[ii*4+1]),b=clamp(buf[ii*4+2]),a=clamp(buf[ii*4+3]);
        if(doS){r=toSRGB(r);g=toSRGB(g);b=toSRGB(b);}
        if(chanMode){var cvv=chanMode==="r"?r:chanMode==="g"?g:chanMode==="b"?b:(doS?toSRGB(a):a);r=cvv;g=cvv;b=cvv;a=1;}
        img.data[ii*4]=r*255+0.5|0;img.data[ii*4+1]=g*255+0.5|0;img.data[ii*4+2]=b*255+0.5|0;img.data[ii*4+3]=a*255+0.5|0;
      }
      ctx.putImageData(img,0,0);
    }catch(e){console.error("anim main render:",e);}
  },[animFrame,flipbookInMain,anim,state,chanMode]);

  // Playback loop for main canvas anim preview
  useEffect(function(){
    if(!flipbookInMain||!animPlaying){if(animPlayTimer.current)clearInterval(animPlayTimer.current);return;}
    var totalF=importedFB?Math.max(1,fbSequence(importedFB).length):FB_GRIDS[anim.gridIdx!=null?anim.gridIdx:2].frames;
    var useFps=importedFB?(importedFB.fps||24):(anim.fps||60);
    animPlayTimer.current=setInterval(function(){
      setAnimFrame(function(f){return(f+1)%totalF;});
    },Math.round(1000/useFps));
    return function(){clearInterval(animPlayTimer.current);};
  },[flipbookInMain,animPlaying,anim,importedFB]);

  // Update tile background after hi-res render (CSS bg-repeat approach)
  useEffect(function(){
    var div=bgTileRef.current;
    if(!seamlessPreview){if(div)div.style.backgroundImage="none";return;}
    var timer=setTimeout(function(){
      if(canvasRef.current&&bgTileRef.current){
        // Use JPEG for smaller URL in bg-image
        bgTileRef.current.style.backgroundImage="url("+canvasRef.current.toDataURL("image/jpeg",0.92)+")";
      }
    },440);
    return function(){clearTimeout(timer);};
  },[state,seamlessPreview]);

  // Sync tile background-size with zoom immediately (no re-render needed)
  useEffect(function(){
    if(bgTileRef.current&&seamlessPreview)
      bgTileRef.current.style.backgroundSize=(baseDisplaySize*previewZoom)+"px "+(baseDisplaySize*previewZoom)+"px";
  },[previewZoom,seamlessPreview]);

  // 3x3 tiling check: draw the main canvas 9 times into a grid so seams are
  // obvious. Cheap — just 9 drawImage of the already-rendered canvas.
  useEffect(function(){
    if(!tileCheck33)return;
    var timer=setTimeout(function(){
      var dst=tile33Ref.current, srcC=canvasRef.current;
      if(!dst||!srcC)return;
      var cell=Math.round(dst.clientWidth/3)||120;
      dst.width=cell*3; dst.height=cell*3;
      var ctx=dst.getContext("2d");
      ctx.imageSmoothingEnabled=false;
      for(var ty=0;ty<3;ty++)for(var tx=0;tx<3;tx++){
        ctx.drawImage(srcC,tx*cell,ty*cell,cell,cell);
      }
      // Dim the 8 outer tiles slightly + outline the center tile so you can tell
      // where one repeat ends and the next begins.
      ctx.fillStyle="rgba(0,0,0,0.32)";
      for(var oy=0;oy<3;oy++)for(var ox=0;ox<3;ox++){
        if(ox===1&&oy===1)continue;
        ctx.fillRect(ox*cell,oy*cell,cell,cell);
      }
      ctx.strokeStyle="rgba(232,144,10,0.9)";ctx.lineWidth=2;
      ctx.strokeRect(cell+1,cell+1,cell-2,cell-2);
    },120);
    return function(){clearTimeout(timer);};
  },[tileCheck33,state,canvasEpoch,previewRes,soloLayerIdx]);

  // Storage
  // Serialisation-safe snapshot of the whole project. Shared by the explicit
  // Save and by the autosave below, so the two can never drift apart.
  function buildProjectSnapshot(){
    // Strip imageData from save (large base64 blobs; user re-imports on load)
    var toSave=JSON.parse(JSON.stringify(state));
    function stripImg(layers){(layers||[]).forEach(function(L){if(L.imageData)L.imageData=null;});}
    stripImg(toSave.layers);
    (toSave.slots||[]).forEach(function(s){stripImg(s.layers);});
    toSave._bounds=JSON.parse(JSON.stringify(_gBounds));
    // Persist the node graph too. Build a serialization-safe copy: strip layer
    // imageData, and for flipbook nodes drop the decoded frames (huge typed
    // arrays) — keep only the source dataURL + grid so we can re-slice on load.
    try{
      var ngNodes={};
      for(var nid in nodeGraph.nodes){
        var on=nodeGraph.nodes[nid];
        var params=Object.assign({},on.params);
        if(params.layer&&params.layer.imageData)params.layer=Object.assign({},params.layer,{imageData:null});
        if(params.sheet){
          // keep src/grid/meta, drop frames (rebuilt on load)
          params.sheet={src:params.sheet.src||null,cols:params.sheet.cols,rows:params.sheet.rows,
            frameSize:params.sheet.frameSize,totalFrames:params.sheet.totalFrames};
        }
        ngNodes[nid]=Object.assign({},on,{params:params});
      }
      var ng={nodes:ngNodes,edges:JSON.parse(JSON.stringify(nodeGraph.edges)),version:nodeGraph.version||1};
      toSave._nodeGraph=ng; toSave._appMode=appMode;
      // Pixel scaling changes how the graph renders, so it belongs to the project.
      toSave._pxScale=getPixelScaling();
    }catch(e){console.error("Node graph could not be serialised:",e);}
    toSave._savedAt=Date.now();
    return toSave;
  }

  function doSave(){
    if(!window.storage){setSaveStatus("✗ No storage");setTimeout(function(){setSaveStatus("");},2000);return;}
    var toSave=buildProjectSnapshot();
    window.storage.set("texgen-project",JSON.stringify(toSave)).then(function(){
      // An explicit save supersedes the recovery copy: nothing is unsaved now.
      _autoDirty.current=false;
      if(window.storage.remove)window.storage.remove(AUTOSAVE_KEY).catch(function(){});
      setSaveStatus("✓ Saved");setTimeout(function(){setSaveStatus("");},2000);
    }).catch(function(){setSaveStatus("✗ Save failed");setTimeout(function(){setSaveStatus("");},3000);});
  }
  // ---- Autosave / crash recovery ----------------------------------------
  // Marks the project dirty on any change and flushes at most every
  // AUTOSAVE_INTERVAL_MS, plus once more when the window is hidden or closed.
  // Bounded loss instead of "everything since the last manual save".
  var _autoDirty=useRef(false);
  var _autoArmed=useRef(false);
  var _snapFn=useRef(null);
  _snapFn.current=buildProjectSnapshot;

  useEffect(function(){
    // The first run is the initial mount, not a user edit.
    if(!_autoArmed.current){_autoArmed.current=true;return;}
    _autoDirty.current=true;
  },[state,nodeGraph,appMode]);

  useEffect(function(){
    if(typeof window==="undefined"||!window.storage)return;
    function flushAutosave(){
      if(!_autoDirty.current||!_snapFn.current)return;
      _autoDirty.current=false;
      try{
        window.storage.set(AUTOSAVE_KEY,JSON.stringify(_snapFn.current()))
          .catch(function(e){_autoDirty.current=true;console.error("Autosave failed:",e);});
      }catch(e){_autoDirty.current=true;console.error("Autosave failed:",e);}
    }
    function onHide(){if(document.visibilityState==="hidden")flushAutosave();}
    var iv=setInterval(flushAutosave,AUTOSAVE_INTERVAL_MS);
    window.addEventListener("pagehide",flushAutosave);
    document.addEventListener("visibilitychange",onHide);
    return function(){
      clearInterval(iv);
      window.removeEventListener("pagehide",flushAutosave);
      document.removeEventListener("visibilitychange",onHide);
    };
  },[]);

  function doLoad(){
    if(!window.storage){setSaveStatus("✗ No storage");setTimeout(function(){setSaveStatus("");},2000);return;}
    window.storage.get("texgen-project").then(function(res){
      if(res&&res.value){try{var saved=JSON.parse(res.value);
        if(saved._nodeGraph){setNodeGraph(saved._nodeGraph);delete saved._nodeGraph;}
        if(saved._appMode){setAppMode(saved._appMode);delete saved._appMode;}
        if(saved._pxScale!==undefined){setPixelScaling(!!saved._pxScale);delete saved._pxScale;}
        setState(function(p){return Object.assign({},p,saved);});
        // Loading rewinds to the saved point, so the recovery copy is stale.
        setTimeout(function(){_autoDirty.current=false;},200);
        if(window.storage.remove)window.storage.remove(AUTOSAVE_KEY).catch(function(){});
        setSaveStatus("↑ Loaded");setTimeout(function(){setSaveStatus("");},2000);}catch(e){setSaveStatus("✗ Parse error");}}
      else setSaveStatus("No saved project");
      setTimeout(function(){setSaveStatus("");},2500);
    }).catch(function(){setSaveStatus("✗ Load failed");setTimeout(function(){setSaveStatus("");},2500);});
  }
  function doNew(){
    if(window.confirm("Start new project? Unsaved changes will be lost.")){
      // Otherwise the old project's recovery copy would come back on restart.
      _autoDirty.current=false;
      if(window.storage&&window.storage.remove)window.storage.remove(AUTOSAVE_KEY).catch(function(){});
      // Reset module-level UI state so it doesn't bleed into the new project
      Object.keys(_gBounds).forEach(function(k){delete _gBounds[k];});
      Object.keys(_collapseState).forEach(function(k){delete _collapseState[k];});
      setState(mkState());
      setRootAL(0);
      setSoloLayerIdx(-1);
      undoStack.current=[];undoIdx.current=-1;
      setCanvasEpoch(function(e){return e+1;});
    }
  }

  // Export project as .texgen JSON file
  function doExportProject(){
    var toSave=JSON.parse(JSON.stringify(state));
    // Strip imageData (too large for JSON files unless user accepts)
    function stripImg(layers){(layers||[]).forEach(function(L){if(L.imageData)L.imageData=null;});}
    stripImg(toSave.layers);
    (toSave.slots||[]).forEach(function(s){stripImg(s.layers);});
    toSave._bounds=JSON.parse(JSON.stringify(_gBounds));
    var json=JSON.stringify({_texgen:1,version:2,ts:Date.now(),state:toSave},null,2);
    try{
      var blob=new Blob([json],{type:"application/json"});
      var url=URL.createObjectURL(blob);
      var a=document.createElement("a");
      a.href=url;a.download="project.texgen";a.style.cssText="position:fixed;top:-100px;";
      document.body.appendChild(a);a.click();
      setTimeout(function(){document.body.removeChild(a);URL.revokeObjectURL(url);},500);
      setSaveStatus("✓ Exported");setTimeout(function(){setSaveStatus("");},2000);
    }catch(e){setSaveStatus("✗ Export failed");setTimeout(function(){setSaveStatus("");},2500);}
  }

  // Import project from .texgen JSON file
  function doImportProject(){
    var inp=document.createElement("input");
    inp.type="file";inp.accept=".texgen,.json";
    inp.style.cssText="position:fixed;top:-100px;left:-100px;opacity:0;";
    function hydrateLayers(layers){
      (layers||[]).forEach(function(L){
        if(!L.uvDists||!L.uvDists.length)L.uvDists=[mkDist()];
        // Ensure curvePoints are plain objects with x,y numbers
        if(L.curvePoints&&L.curvePoints.length>=2){
          L.curvePoints=L.curvePoints.map(function(p2){return{x:+p2.x,y:+p2.y};});
        } else {
          L.curvePoints=DEFAULT_CURVE.map(function(p2){return Object.assign({},p2);});
        }
      });
    }
    inp.onchange=function(e){
      var file=e.target.files[0];if(!file)return;
      var reader=new FileReader();
      reader.onload=function(ev){
        try{
          var parsed=JSON.parse(ev.target.result);
          var saved=parsed.state||parsed;
          if(!saved.layers){setSaveStatus("✗ Invalid file");setTimeout(function(){setSaveStatus("");},2500);return;}
          hydrateLayers(saved.layers);
          (saved.slots||[]).forEach(function(s){hydrateLayers(s.layers);});
          if(saved._bounds){Object.keys(_gBounds).forEach(function(k){delete _gBounds[k];});Object.assign(_gBounds,saved._bounds);}
          setState(function(prev){return Object.assign({},prev,saved);});
          setRootAL(0);
          setSaveStatus("↑ Imported");setTimeout(function(){setSaveStatus("");},2000);
        }catch(err){setSaveStatus("✗ Parse error: "+err.message);setTimeout(function(){setSaveStatus("");},3000);}
      };
      reader.readAsText(file);
      document.body.removeChild(inp);
    };
    document.body.appendChild(inp);
    inp.click();
  }

  // Export
  function captureABSnapshot(){
    // Render current state into an offscreen canvas and store pixels.
    // Must match exactly what renderAll produces (mask + global filters applied).
    var size=previewRes;
    var offscreen=document.createElement("canvas");
    offscreen.width=offscreen.height=size;
    renderAll(offscreen,state,size,chanMode);
    abCanvasRef.current=offscreen;
    abSnapshotRef.current=offscreen.getContext("2d").getImageData(0,0,size,size);
    setAbMode(true);
  }
  function clearABSnapshot(){setAbMode(false);abSnapshotRef.current=null;abCanvasRef.current=null;}

  // ── Flipbook Import ───────────────────────────────────────────────────
  function importFlipbook(file,cols,rows){
    setFbImportStatus("Decoding image…");
    setFbPreLoop(null); // a new sheet invalidates any prior loop backup
    var img=new Image();
    img.onload=function(){
      var frameW=Math.round(img.width/cols);
      var frameH=Math.round(img.height/rows);
      var frameSize=Math.min(frameW,frameH); // square frames
      var totalFrames=cols*rows;
      // Slice into frames
      var offscreen=document.createElement("canvas");
      offscreen.width=img.width;offscreen.height=img.height;
      var octx=offscreen.getContext("2d");
      octx.drawImage(img,0,0);
      var frames=[];
      for(var fi=0;fi<totalFrames;fi++){
        var fc=fi%cols, fr2=Math.floor(fi/cols);
        var fc2=document.createElement("canvas");
        fc2.width=fc2.height=frameSize;
        var fctx=fc2.getContext("2d");
        fctx.drawImage(offscreen,fc*frameW,fr2*frameH,frameW,frameH,0,0,frameSize,frameSize);
        var idata=fctx.getImageData(0,0,frameSize,frameSize);
        var buf=new Float32Array(frameSize*frameSize*4);
        for(var pi=0;pi<frameSize*frameSize;pi++){
          buf[pi*4  ]=idata.data[pi*4  ]/255;
          buf[pi*4+1]=idata.data[pi*4+1]/255;
          buf[pi*4+2]=idata.data[pi*4+2]/255;
          buf[pi*4+3]=idata.data[pi*4+3]/255;
        }
        frames.push(buf);
      }
      var _fbState={frames:frames,frameSize:frameSize,cols:cols,rows:rows,fps:24,totalFrames:totalFrames,
        rangeIn:0,rangeOut:totalFrames-1,frameStep:1,playMode:"forward"};
      setImportedFB(_fbState);
      fbProcessedRef.current=[];
      fbGenRef.current++; // invalidate any stale processed cache entries
      setFlipbookInMain(true);
      setAnimFrame(0);
      setCanvasEpoch(function(e){return e+1;});
      setFbImportStatus("");
    };
    img.onerror=function(){
      console.error("Flipbook import: image failed to load");
      setFbImportStatus("Import failed: the image could not be decoded. Check the file format (PNG/JPG/WebP).");
    };
    // Read as data: URL via FileReader — NOT a blob: URL. Sandboxed iframe
    // CSPs (like the artifact environment) block blob: for images but allow
    // data:. The image-layer import already uses this pattern and works;
    // this was the only file read still going through createObjectURL.
    var reader=new FileReader();
    reader.onload=function(ev){img.src=ev.target.result;};
    reader.onerror=function(){
      console.error("Flipbook import: file read failed");
      setFbImportStatus("Import failed: could not read the file from disk.");
    };
    try{
      reader.readAsDataURL(file);
    }catch(e){
      console.error("Flipbook import:",e);
      setFbImportStatus("Import failed: "+(e&&e.message?e.message:"could not read the file."));
    }
  }

  // Apply post-filters to an imported frame
  function applyFbPostFilters(frameBuf,frameSize){
    if(!fbPostFilters||!fbPostFilters.length)return frameBuf;
    // Direct allocation, NOT the scratch pool: this buffer is cached long-term
    // in fbProcessedRef. Pool buffers are meant to be released back quickly;
    // holding one in a cache could let a later getBuf() hand the same buffer
    // to another renderer and corrupt cached frames. The per-frame cache makes
    // this a one-time cost, not a per-playback-frame allocation.
    var buf=new Float32Array(frameBuf.length);
    buf.set(frameBuf);
    fbPostFilters.forEach(function(f){if(f&&f.enabled)applyFilter(buf,frameSize,f);});
    return buf;
  }

  // Get processed frame — per-frame generation check, O(1) cache hit path.
  // Old approach required visiting all N frames before clearing the reprocess flag,
  // causing every frame to re-run applyFbPostFilters on every access during playback.
  function getFbFrame(fi){
    if(!importedFB)return null;
    var frames=importedFB.frames;
    if(!frames[fi])return null;
    var cached=fbProcessedRef.current[fi];
    // Cache miss: frame not yet processed, or filters changed (generation mismatch)
    if(!cached||cached._gen!==fbGenRef.current){
      var buf=applyFbPostFilters(frames[fi],importedFB.frameSize);
      fbProcessedRef.current[fi]={buf:buf,_gen:fbGenRef.current};
      return buf;
    }
    return cached.buf;
  }

  function reprocessAllFbFrames(){
    // Bump generation counter — all cached entries become stale atomically.
    // No need to clear the array; entries are reprocessed lazily on next access.
    fbGenRef.current++;
    setCanvasEpoch(function(e){return e+1;});
  }

  function doBatchExport(variantIdxs,size){
    if(exportingPng)return;
    setExportingPng(true);
    var sz=size||1024;
    var queue=variantIdxs.slice();
    var labels=["A","B","C","D"];
    var exportDir=null; // set once, below, before the queue starts draining
    // Source = the CURRENT work (the spritesheet slot if in spritesheet mode,
    // otherwise the main layers). Variant A is the work as-is; B/C/D re-seed every
    // layer with a deterministic per-variant offset so each export is different
    // but reproducible across runs.
    var srcLayers=editSlot&&state.slots[asi]?state.slots[asi].layers:state.layers;
    var srcMask=editSlot&&state.slots[asi]?(state.slots[asi].mask||state.mask):state.mask;
    function variantLayers(vi){
      if(vi===0)return srcLayers; // A = exactly the current work
      return srcLayers.map(function(L,li){
        var baseSeed=(L.seed||0);
        // offset keeps layers distinct from each other within a variant
        return Object.assign({},L,{seed:(baseSeed+vi*7919+li*131)>>>0});
      });
    }
    function next(){
      if(queue.length===0){setExportingPng(false);return;}
      var vi=queue.shift();
      var st=Object.assign({},state,{exportSize:sz,layers:variantLayers(vi),mask:srcMask,spritesheetMode:false});
      exportFull(st).then(function(c){
        function done(){setTimeout(next,120);} // yield between files
        if(c.toBlob){
          c.toBlob(function(blob){
            saveBlobAs(exportDir,"texgen_variant"+(labels[vi]||vi)+"_"+sz+"px.png",blob).then(done);
          },"image/png");
        } else { done(); }
      }).catch(function(e){console.error("Batch export failed:",e);flash("Batch export failed - see DevTools console");setExportingPng(false);});
    }
    // One folder prompt for the whole set rather than one per file.
    pickExportDir().then(function(dir){
      exportDir=dir;
      if(dir)flash("Exporting "+queue.length+" variants to "+(dir.name||"folder"));
      setTimeout(next,20);
    });
  }

  function doExport(){
    if(exportingPng)return;
    setExportingPng(true);
    var _exOpts=appMode==="nodes"?{nodeGraph:nodeGraph}:undefined;
    // Yield to React so the "Rendering..." button state paints before the
    // synchronous render work freezes the main thread (same as doExportFlipbook)
    setTimeout(function(){
    exportFull(state,_exOpts).then(function(c){
      setExportingPng(false);
      if(c.toBlob){
        c.toBlob(function(blob){
          var url=URL.createObjectURL(blob),a=document.createElement("a");
          a.href=url;a.download="texgen_"+state.exportSize+"px.png";
          document.body.appendChild(a);a.click();
          setTimeout(function(){document.body.removeChild(a);URL.revokeObjectURL(url);},200);
        },"image/png");
      } else {
        var w=window.open("","_blank");
        if(w){var url=c.toDataURL("image/png");w.document.write("<img src='"+url+"' style='max-width:100%'/><br><a download='texgen_"+state.exportSize+"px.png' href='"+url+"'>Save PNG</a>");}
      }
    }).catch(function(e){console.error("Export failed:",e);flash("Export failed - see DevTools console");setExportingPng(false);});
    },20);
  }

  // Bake a Flipbook Pack node: re-evaluate every frame through the graph at full
  // per-frame resolution, tile into a sheet, and download it as PNG.
  // Bake the keyframe animation into a sprite sheet PNG (the asset-pack workflow:
  // animate params on the timeline, then get a flipbook you can ship).
  function doBakeTimeline(opts){
    if(exportingPng)return;
    setExportingPng(true);
    setTimeout(function(){
      try{
        var baked=bakeTimeline(nodeGraph,opts||{},function(sz){return makeNodeEvaluator(sz);});
        if(!baked){setExportingPng(false);flash&&flash("Add an Output node first");return;}
        var c=document.createElement("canvas"); c.width=baked.width; c.height=baked.height;
        var ctx=c.getContext("2d"); var img=ctx.createImageData(baked.width,baked.height);
        for(var i=0;i<baked.width*baked.height;i++){
          img.data[i*4]=Math.round((baked.buffer[i*4]||0)*255);
          img.data[i*4+1]=Math.round((baked.buffer[i*4+1]||0)*255);
          img.data[i*4+2]=Math.round((baked.buffer[i*4+2]||0)*255);
          img.data[i*4+3]=Math.round((baked.buffer[i*4+3]!=null?baked.buffer[i*4+3]:1)*255);
        }
        ctx.putImageData(img,0,0);
        setExportingPng(false);
        c.toBlob(function(blob){
          var url=URL.createObjectURL(blob),a=document.createElement("a");
          a.href=url;a.download="anim_"+baked.cols+"x"+baked.rows+"_"+baked.frameSize+"px.png";
          document.body.appendChild(a);a.click();
          setTimeout(function(){document.body.removeChild(a);URL.revokeObjectURL(url);},200);
        },"image/png");
      }catch(e){ setExportingPng(false); flash&&flash("Bake failed"); }
    },30);
  }
  function doBakeFlipbook(packId){
    if(exportingPng)return;
    setExportingPng(true);
    setTimeout(function(){
      try{
        var baked=bakeFlipbook(nodeGraph,packId,function(sz){return makeNodeEvaluator(sz);});
        if(!baked){setExportingPng(false);flash&&flash("No flipbook sheet found upstream");return;}
        var c=document.createElement("canvas"); c.width=baked.width; c.height=baked.height;
        var ctx=c.getContext("2d"); var img=ctx.createImageData(baked.width,baked.height);
        for(var i=0;i<baked.width*baked.height;i++){
          img.data[i*4]=Math.round((baked.buffer[i*4]||0)*255);
          img.data[i*4+1]=Math.round((baked.buffer[i*4+1]||0)*255);
          img.data[i*4+2]=Math.round((baked.buffer[i*4+2]||0)*255);
          img.data[i*4+3]=Math.round((baked.buffer[i*4+3]!=null?baked.buffer[i*4+3]:1)*255);
        }
        ctx.putImageData(img,0,0);
        setExportingPng(false);
        c.toBlob(function(blob){
          var url=URL.createObjectURL(blob),a=document.createElement("a");
          a.href=url;a.download="flipbook_"+baked.cols+"x"+baked.rows+".png";
          document.body.appendChild(a);a.click();
          setTimeout(function(){document.body.removeChild(a);URL.revokeObjectURL(url);},200);
        },"image/png");
      }catch(e){console.error("Bake failed:",e);setExportingPng(false);}
    },20);
  }

  // ══ BATCH EXPORT (node mode) ════════════════════════════════════
  // Helper: turn a float buffer (size×size, RGBA 0..1) into a PNG download.
  function downloadBuffer(buf,size,filename){
    var c=document.createElement("canvas"); c.width=c.height=size;
    var ctx=c.getContext("2d"); var img=ctx.createImageData(size,size);
    for(var i=0;i<size*size;i++){
      img.data[i*4]=Math.round((buf[i*4]||0)*255);
      img.data[i*4+1]=Math.round((buf[i*4+1]||0)*255);
      img.data[i*4+2]=Math.round((buf[i*4+2]||0)*255);
      img.data[i*4+3]=Math.round((buf[i*4+3]!=null?buf[i*4+3]:1)*255);
    }
    ctx.putImageData(img,0,0);
    c.toBlob(function(blob){
      var url=URL.createObjectURL(blob),a=document.createElement("a");
      a.href=url;a.download=filename;document.body.appendChild(a);a.click();
      setTimeout(function(){document.body.removeChild(a);URL.revokeObjectURL(url);},150);
    },"image/png");
  }
  // 22. Export the graph output at several resolutions at once.
  function batchExportResolutions(sizes){
    sizes=sizes||[256,512,1024,2048];
    sizes.forEach(function(sz,i){
      setTimeout(function(){
        var res=evaluate(nodeGraph,sz,makeNodeEvaluator(sz));
        if(res.buffer)downloadBuffer(res.buffer,sz,"texgen_"+sz+"px.png");
      },i*350);
    });
  }
  // 23. Export EACH selected node's output as its own PNG (or all source nodes
  // if nothing selected). Great for exporting channel maps separately.
  function batchExportNodes(ids,sz){
    sz=sz||(state.exportSize||512);
    if(!ids||!ids.length){ids=[];for(var nid in nodeGraph.nodes)if(nodeGraph.nodes[nid].type==="source")ids.push(nid);}
    var res=evaluate(nodeGraph,sz,makeNodeEvaluator(sz));
    ids.forEach(function(id,i){
      var buf=res.cache&&res.cache[id];
      if(buf)setTimeout(function(){downloadBuffer(buf,sz,"node_"+(nodeGraph.nodes[id]?nodeGraph.nodes[id].type:"x")+"_"+id.slice(-4)+".png");},i*300);
    });
  }
  // 24. Seed sweep: render N variations of the graph's source seeds, tiled into a
  // contact sheet. Each frame re-seeds every source node.
  function batchSeedSweep(count,sz){
    count=count||9; sz=sz||256;
    var cols=Math.ceil(Math.sqrt(count)), rows=Math.ceil(count/cols);
    var sheetW=cols*sz, sheetH=rows*sz;
    var c=document.createElement("canvas"); c.width=sheetW; c.height=sheetH;
    var ctx=c.getContext("2d");
    // snapshot original seeds to restore after
    var saved={};
    for(var nid in nodeGraph.nodes){var n=nodeGraph.nodes[nid];if(n.type==="source"&&n.params.layer)saved[nid]=n.params.layer.seed;}
    for(var f=0;f<count;f++){
      for(var nid2 in nodeGraph.nodes){var n2=nodeGraph.nodes[nid2];if(n2.type==="source"&&n2.params.layer)n2.params.layer=Object.assign({},n2.params.layer,{seed:((f*7919+1237)%99999)});}
      var res=evaluate(nodeGraph,sz,makeNodeEvaluator(sz));
      if(res.buffer){
        var img=ctx.createImageData(sz,sz);
        for(var i=0;i<sz*sz;i++){img.data[i*4]=Math.round((res.buffer[i*4]||0)*255);img.data[i*4+1]=Math.round((res.buffer[i*4+1]||0)*255);img.data[i*4+2]=Math.round((res.buffer[i*4+2]||0)*255);img.data[i*4+3]=255;}
        ctx.putImageData(img,(f%cols)*sz,((f/cols)|0)*sz);
      }
    }
    // restore seeds
    for(var rid in saved){var rn=nodeGraph.nodes[rid];if(rn&&rn.params.layer)rn.params.layer=Object.assign({},rn.params.layer,{seed:saved[rid]});}
    c.toBlob(function(blob){var url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="seed_sweep_"+count+".png";document.body.appendChild(a);a.click();setTimeout(function(){document.body.removeChild(a);URL.revokeObjectURL(url);},150);},"image/png");
  }

  function doExportNormal(strength){
    if(exportingPng)return;
    setExportingPng(true);
    setTimeout(function(){
    exportFull(state,{normalMap:true,normalStrength:strength||2}).then(function(c){
      setExportingPng(false);
      if(c.toBlob){
        c.toBlob(function(blob){
          var url=URL.createObjectURL(blob),a=document.createElement("a");
          a.href=url;a.download="texgen_normal_"+state.exportSize+"px.png";
          document.body.appendChild(a);a.click();
          setTimeout(function(){document.body.removeChild(a);URL.revokeObjectURL(url);},200);
        },"image/png");
      }
    }).catch(function(e){console.error("Normal export failed:",e);setExportingPng(false);});
    },20);
  }

  function doExportPacked(){
    if(exportingPng)return;
    setExportingPng(true);
    setTimeout(function(){
    exportPackedRGBA(state).then(function(c){
      setExportingPng(false);
      if(c.toBlob){
        c.toBlob(function(blob){
          var url=URL.createObjectURL(blob),a=document.createElement("a");
          a.href=url;a.download="texgen_packed_"+state.exportSize+"px.png";
          document.body.appendChild(a);a.click();
          setTimeout(function(){document.body.removeChild(a);URL.revokeObjectURL(url);},200);
        },"image/png");
      }
    }).catch(function(e){console.error("Packed export failed:",e);setExportingPng(false);});
    },20);
  }

  // Pre-loop backup as STATE (not a ref) so toggling it re-renders the Undo
  // button. Stores the full pre-loop frame set + the retiming fields that the
  // loop resets, so Undo restores the exact prior state.
  var _plb=useState(null); var fbPreLoop=_plb[0],setFbPreLoop=_plb[1];

  function makeFbLoop(overlap,blendMode){
    if(!importedFB||importedFB.totalFrames<4)return;
    // Guard: only ONE loop at a time. If a loop already exists, Undo first.
    // This keeps the backup pointing at the true original and prevents the
    // frame count from shrinking on every press.
    if(fbPreLoop)return;
    setFbPreLoop({
      frames:importedFB.frames,totalFrames:importedFB.totalFrames,
      rangeIn:importedFB.rangeIn,rangeOut:importedFB.rangeOut,
      frameStep:importedFB.frameStep,playMode:importedFB.playMode,
      timeCurve:importedFB.timeCurve,timeCurveMode:importedFB.timeCurveMode
    });
    var nf=makeLoopFrames(importedFB.frames,overlap,blendMode);
    // Reset retiming: a leftover trim/step/curve would map onto the new,
    // shorter looped sequence and produce confusing playback. Loop = clean base.
    setImportedFB(Object.assign({},importedFB,{
      frames:nf,totalFrames:nf.length,rangeIn:0,rangeOut:nf.length-1,
      frameStep:1,playMode:"forward",timeCurve:null
    }));
    fbProcessedRef.current=[];fbGenRef.current++;
    setAnimFrame(0);
    setCanvasEpoch(function(e){return e+1;});
  }
  function undoFbLoop(){
    if(!fbPreLoop||!importedFB)return;
    var bk=fbPreLoop;
    setFbPreLoop(null);
    // Restore frames AND the retiming that was active before the loop
    setImportedFB(Object.assign({},importedFB,{
      frames:bk.frames,totalFrames:bk.totalFrames,
      rangeIn:bk.rangeIn!=null?bk.rangeIn:0,
      rangeOut:bk.rangeOut!=null?bk.rangeOut:bk.totalFrames-1,
      frameStep:bk.frameStep||1,playMode:bk.playMode||"forward",
      timeCurve:bk.timeCurve||null,timeCurveMode:bk.timeCurveMode||"smooth"
    }));
    fbProcessedRef.current=[];fbGenRef.current++;
    setAnimFrame(0);
    setCanvasEpoch(function(e){return e+1;});
  }

  // Export the imported flipbook with all edits baked in: post filters applied
  // per frame, frames in the retimed order (trim/step/mode), auto grid layout.
  function doExportImportedFB(){
    if(!importedFB||exporting)return;
    setExporting(true);
    setTimeout(function(){
      try{
        var seq=fbSequence(importedFB);
        if(!seq.length){setExporting(false);return;}
        var srcFs=importedFB.frameSize;
        // Resize: exportScale is "1" | "0.5" | "0.25"
        var scale=parseFloat(importedFB.exportScale||"1")||1;
        var fs=Math.max(8,Math.round(srcFs*scale));
        // Grid: exportCols 0 = auto square, else user-chosen column count
        var cols=importedFB.exportCols>0?Math.min(importedFB.exportCols,seq.length):Math.ceil(Math.sqrt(seq.length));
        var rows=Math.ceil(seq.length/cols);
        var c=document.createElement("canvas");
        c.width=cols*fs;c.height=rows*fs;
        var ctx=c.getContext("2d");
        for(var k=0;k<seq.length;k++){
          var fbuf=getFbFrame(seq[k]);
          if(!fbuf)continue;
          // Box-filter downscale if needed (no-op at scale 1)
          if(fs<srcFs)fbuf=resizeFrameBuf(fbuf,srcFs,fs);
          var img=ctx.createImageData(fs,fs);
          for(var pi=0;pi<fs*fs;pi++){
            img.data[pi*4  ]=clamp(fbuf[pi*4  ])*255+0.5|0;
            img.data[pi*4+1]=clamp(fbuf[pi*4+1])*255+0.5|0;
            img.data[pi*4+2]=clamp(fbuf[pi*4+2])*255+0.5|0;
            // Preserve source alpha — packed VFX sheets rely on it
            img.data[pi*4+3]=clamp(fbuf[pi*4+3])*255+0.5|0;
          }
          ctx.putImageData(img,(k%cols)*fs,Math.floor(k/cols)*fs);
        }
        setExporting(false);
        if(c.toBlob){
          c.toBlob(function(blob){
            var url=URL.createObjectURL(blob),a=document.createElement("a");
            a.href=url;a.download="flipbook_edited_"+seq.length+"f_"+cols+"x"+rows+"_"+fs+"px.png";
            document.body.appendChild(a);a.click();
            setTimeout(function(){document.body.removeChild(a);URL.revokeObjectURL(url);},200);
          },"image/png");
        }
      }catch(e){console.error("Edited flipbook export failed:",e);setExporting(false);}
    },20);
  }

  function doExportFlipbook(){
    var grid=FB_GRIDS[anim.gridIdx!=null?anim.gridIdx:2];
    var frameSize=anim.frameSize||128;
    setExporting(true);
    setTimeout(function(){
      exportFlipbook(state,anim,grid,frameSize).then(function(c){
        setExporting(false);
        if(c.toBlob){
          c.toBlob(function(blob){
            var url=URL.createObjectURL(blob),a=document.createElement("a");
            a.href=url;a.download="flipbook_"+grid.frames+"f_"+frameSize+"px.png";
            document.body.appendChild(a);a.click();
            setTimeout(function(){document.body.removeChild(a);URL.revokeObjectURL(url);},200);
          },"image/png");
        }
      }).catch(function(e){console.error(e);setExporting(false);});
    },20);
  }

  var NAV=[{id:"noise",icon:"◈",label:"Noise"},{id:"adj",icon:"◑",label:"Adjust"},{id:"fx",icon:"✦",label:"Filters"},{id:"anim",icon:"◷",label:"Anim"},{id:"global",icon:"⊞",label:"Global"},{id:"sprite",icon:"⊟",label:"Sprite"}];
  var fxCount=(curLayers[si]&&curLayers[si].layerFilters||[]).filter(function(f){return f.enabled;}).length;
  var globalFxCount=(state.globalLayerFilters||[]).filter(function(f){return f.enabled;}).length;

  function mkPanelContent(pid){
    if(pid==="noise") return React.createElement(NoisePanel,{L:L,si:si,layers:curLayers,setL:setL,setLSP:setLSP,addLayer:addLayer,addLayerWithBlend:addLayerWithBlend,removeLayer:removeLayer,duplicateLayer:duplicateLayer,setActiveL:setCurAL,moveLayerUp:moveLayerUp,moveLayerDown:moveLayerDown,onSeamlessOn:function(){setSeamlessPreview(true);},soloThumbSize:soloThumbSize,setSoloThumbSize:setSoloThumbSize,soloIdx:soloLayerIdx,setSoloIdx:setSoloLayerIdx,onRenameLayer:function(idx,newLabel){updL(idx,"label",newLabel);},copyLayer:copyCurrentLayer,pasteLayer:pasteCurrentLayer,hasCopied:!!copiedLayer.current,randomizeAll:randomizeAllSeeds,resetLayer:resetLayerToDefaults,onCommit:commitUndo,_bumpEpoch:bumpEpoch,canvasEpoch:canvasEpoch,groups:(editSlot?null:state.layerGroups)||[],addGroup:addGroup,updGroup:updGroup,removeGroup:removeGroup,setLayerGroup:setLayerGroup,groupsEnabled:!editSlot,runChainOp:runChainOp});
    if(pid==="adj")   return React.createElement(AdjPanel,{L:L,si:si,setL:setL,histTick:histTick,chanMode:chanMode,onCommit:commitUndo,_bumpEpoch:bumpEpoch,
      layerCount:curLayers.length,
      applyAdjustTo:function(scope){
        pushUndo(state);
        var ADJ=["contrast","contrastMode","midpoint","brightness","invert","curvePoints","curveMode","gradPow"];
        var srcL=curLayers[si];
        var patch={}; ADJ.forEach(function(k){if(srcL[k]!==undefined)patch[k]=srcL[k];});
        function applyToList(list){return list.map(function(ly,idx){
          if(scope==="others"&&idx===si)return ly;
          return Object.assign({},ly,JSON.parse(JSON.stringify(patch)));
        });}
        if(editSlot){
          setState(function(p){var s=p.slots.slice(),sl=Object.assign({},s[asi]);sl.layers=applyToList(sl.layers);s[asi]=sl;return Object.assign({},p,{slots:s});});
        } else {
          setState(function(p){return Object.assign({},p,{layers:applyToList(p.layers)});});
        }
      }});
    if(pid==="fx")    return React.createElement(FiltersPanel,{filters:curLayers[si].layerFilters||[],setFilters:function(f){updL(si,"layerFilters",f);},globalFilters:state.globalLayerFilters||[],setGlobalFilters:function(f){setState(function(p){return Object.assign({},p,{globalLayerFilters:f});});},addType:addType,setAddType:setAddType,layerName:(curLayers[si].label||"L"+(si+1)),layerMask:curLayers[si].mask||null,setLayerMask:function(m){updL(si,"mask",m);},onCommit:commitUndo,_bumpEpoch:bumpEpoch});
    if(pid==="anim")  return React.createElement(AnimPanel,{anim:anim,setAnim:setAnim,layers:state.layers,state:state,exporting:exporting,onExportFlipbook:doExportFlipbook,flipbookInMain:flipbookInMain,onToggleFlipbookMain:function(){setFlipbookInMain(function(v){return!v;});},animFrame:animFrame,setAnimFrame:setAnimFrame,animPlaying:animPlaying,setAnimPlaying:setAnimPlaying,importedFB:importedFB,setImportedFB:setImportedFB,importFlipbook:importFlipbook,fbPostFilters:fbPostFilters,setFbPostFilters:setFbPostFilters,reprocessAll:reprocessAllFbFrames,onExportImportedFB:doExportImportedFB,fbImportStatus:fbImportStatus,onMakeLoop:makeFbLoop,onUndoLoop:undoFbLoop,hasLoopBackup:!!fbPreLoop});
    if(pid==="global")return React.createElement(GlobalPanel,{state:state,setS:setS,updMask:updMask,onSave:doSave,onLoad:doLoad,onNew:doNew,saveStatus:saveStatus,onExportProject:doExportProject,onImportProject:doImportProject,onExportPng:doExport,onBatchExport:doBatchExport,onExportNormal:doExportNormal,onCommit:commitUndo,_bumpEpoch:bumpEpoch});
    return React.createElement(SpritePanel,{state:state,setS:setS,copyLayersToSlot:copyLayersToSlot,onExportPacked:doExportPacked});
  }
  var panelContent=mkPanelContent(panel);
  var panelContent2=splitMode?mkPanelContent(panel2):null;
  // View menu state — consolidates panel layout + UI scale + touch mode
  var _vm=useState(false); var viewMenuOpen=_vm[0],setViewMenuOpen=_vm[1];
  // Close menu on click-outside
  useEffect(function(){
    if(!viewMenuOpen)return;
    function onDoc(e){
      var menu=document.getElementById("texgen-view-menu");
      var trigger=document.getElementById("texgen-view-trigger");
      if(menu&&!menu.contains(e.target)&&trigger&&!trigger.contains(e.target))setViewMenuOpen(false);
    }
    document.addEventListener("mousedown",onDoc);
    return function(){document.removeEventListener("mousedown",onDoc);};
  },[viewMenuOpen]);

  var topBar=React.createElement("div",{style:{
    display:"flex",alignItems:"center",height:44,
    background:"#0e0e0e",borderBottom:"1px solid #1c1c1c",
    flexShrink:0,gap:0,overflow:"visible",position:"relative"
  }},
    // ── LEFT: Logo + slot indicator ───────────────────────────
    React.createElement("div",{style:{display:"flex",alignItems:"center",gap:10,padding:"0 14px",flexShrink:0}},
      React.createElement("span",{style:{fontSize:12,fontWeight:700,color:"#e8900a",letterSpacing:3}},"TEXGEN"),
      editSlot?React.createElement("span",{style:{
        fontSize:8,color:"#ff6699",letterSpacing:1.2,
        padding:"3px 7px",background:"rgba(255,102,153,0.08)",
        border:"1px solid rgba(255,102,153,0.3)",borderRadius:3
      }},"SLOT "+([1,2,3,4][asi])):null
    ),

    // ── CENTER: Primary actions ──────────────────────────────
    React.createElement("div",{style:{flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:6}},
      // Undo / Redo (paired)
      React.createElement("div",{style:{display:"flex",gap:0,background:"#0a0a0a",border:"1px solid #1c1c1c",borderRadius:3,overflow:"hidden"}},
        React.createElement("button",{onClick:doUndo,title:"Undo (Ctrl+Z)",
          disabled:!(undoStack.current.length>1&&undoIdx.current>0),
          style:{padding:"5px 10px",background:"none",border:"none",borderRight:"1px solid #1c1c1c",
            color:undoStack.current.length>1&&undoIdx.current>0?"#888":"#2a2a2a",
            fontFamily:"monospace",fontSize:13,cursor:undoStack.current.length>1&&undoIdx.current>0?"pointer":"not-allowed",lineHeight:1}},"↩"),
        React.createElement("button",{onClick:doRedo,title:"Redo (Ctrl+Y)",
          disabled:!(undoIdx.current<undoStack.current.length-1),
          style:{padding:"5px 10px",background:"none",border:"none",
            color:undoIdx.current<undoStack.current.length-1?"#888":"#2a2a2a",
            fontFamily:"monospace",fontSize:13,cursor:undoIdx.current<undoStack.current.length-1?"pointer":"not-allowed",lineHeight:1}},"↪")
      ),
      // Seed randomize — standalone icon button
      React.createElement("button",{onClick:function(){
        var s=Math.random()*99999|0;
        recordSeed((L.label||"L")+"_"+si,s);
        setL("seed",s);
      },
        title:"Randomize seed (R)",
        style:{padding:"5px 10px",background:"#0a0a0a",border:"1px solid #1c1c1c",color:"#888",
          fontFamily:"monospace",fontSize:13,cursor:"pointer",borderRadius:3,lineHeight:1}},"⟳"),
      // Save + status combined
      React.createElement("button",{onClick:doSave,
        title:"Save project (Ctrl+S)",
        style:{padding:"5px 12px",background:saveStatus?"rgba(160,224,96,0.12)":"#0a0a0a",
          border:"1px solid "+(saveStatus?"#a0e060":"#1c1c1c"),
          color:saveStatus?"#a0e060":"#888",fontFamily:"monospace",fontSize:10,cursor:"pointer",borderRadius:3,
          letterSpacing:0.5,minWidth:54,textAlign:"center"}},
        saveStatus||"Save"),
      // A/B comparison
      React.createElement("button",{
        onClick:function(){if(abMode){clearABSnapshot();}else{captureABSnapshot();}},
        title:abMode?"Exit A/B compare":"Capture snapshot to compare before/after",
        style:{padding:"5px 12px",background:abMode?"rgba(74,180,255,0.12)":"#0a0a0a",
          border:"1px solid "+(abMode?"#4ab4ff":"#1c1c1c"),
          color:abMode?"#4ab4ff":"#666",fontFamily:"monospace",fontSize:10,cursor:"pointer",borderRadius:3,letterSpacing:0.5}},
        abMode?"A|B ●":"A|B"),
      // Export PNG — primary CTA
      React.createElement("button",{onClick:doExport,
        disabled:exportingPng,
        style:{padding:"6px 16px",background:exportingPng?"#444":"#e8900a",border:"none",color:exportingPng?"#888":"#000",
          fontFamily:"monospace",fontSize:11,fontWeight:700,cursor:exportingPng?"wait":"pointer",borderRadius:3,letterSpacing:0.8,marginLeft:6}},
        exportingPng?"Rendering…":"Export PNG")
    ),

    // ── RIGHT: View menu trigger ──────────────────────────────
    React.createElement("div",{style:{display:"flex",alignItems:"center",gap:0,padding:"0 10px",flexShrink:0,position:"relative"}},
      isMobile?null:React.createElement("button",{
        id:"texgen-view-trigger",
        onClick:function(){setViewMenuOpen(function(v){return!v;});},
        title:"View options (panel layout, UI scale, touch mode)",
        style:{padding:"5px 10px",background:viewMenuOpen?"#1a1a1a":"#0a0a0a",border:"1px solid #1c1c1c",
          color:"#888",fontFamily:"monospace",fontSize:9,cursor:"pointer",borderRadius:3,letterSpacing:0.5,
          display:"flex",alignItems:"center",gap:5}},
        React.createElement("span",null,"View"),
        React.createElement("span",{style:{fontSize:8,color:"#555"}},viewMenuOpen?"▴":"▾")
      ),
      // View popover
      viewMenuOpen?React.createElement("div",{
        id:"texgen-view-menu",
        style:{position:"absolute",top:42,right:8,zIndex:100,
          background:"#0e0e0e",border:"1px solid #2a2a2a",borderRadius:4,
          padding:10,minWidth:200,boxShadow:"0 8px 24px rgba(0,0,0,0.6)"}},
        // Panel position
        React.createElement("div",{style:{marginBottom:10}},
          React.createElement("div",{style:{fontSize:8,color:"#555",letterSpacing:1.2,textTransform:"uppercase",marginBottom:5}},"Panel position"),
          React.createElement("div",{style:{display:"grid",gridTemplateColumns:"1fr 1fr",gap:3}},
            [["left","◧ Left"],["right","◨ Right"],["top","⬒ Top"],["bottom","⬓ Bottom"]].map(function(pair){
              var active=panelSide===pair[0];
              return React.createElement("button",{key:pair[0],onClick:function(){setPanelSide(pair[0]);},
                style:{padding:"5px 7px",fontSize:9,fontFamily:"monospace",
                  background:active?"#e8900a":"#161616",
                  color:active?"#000":"#666",
                  border:"1px solid "+(active?"#e8900a":"#252525"),
                  borderRadius:3,cursor:"pointer",textAlign:"left"}},pair[1]);
            })
          )
        ),
        // UI scale
        React.createElement("div",{style:{marginBottom:10}},
          React.createElement("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}},
            React.createElement("span",{style:{fontSize:8,color:"#555",letterSpacing:1.2,textTransform:"uppercase"}},"UI Scale"),
            React.createElement("span",{style:{fontSize:10,color:"#e8900a",fontFamily:"monospace"}},Math.round(uiScale*100)+"%")
          ),
          React.createElement("div",{style:{display:"flex",gap:3}},
            [0.8,0.9,1,1.1,1.25].map(function(s){
              var active=Math.abs(uiScale-s)<0.01;
              return React.createElement("button",{key:s,onClick:function(){setUiScale(s);},
                style:{flex:1,padding:"5px 0",fontSize:9,fontFamily:"monospace",
                  background:active?"#e8900a":"#161616",
                  color:active?"#000":"#666",
                  border:"1px solid "+(active?"#e8900a":"#252525"),
                  borderRadius:3,cursor:"pointer"}},Math.round(s*100));
            })
          )
        ),
        // Touch mode
        React.createElement("div",null,
          React.createElement("button",{onClick:function(){setTouchMode(function(v){return!v;});},
            style:{width:"100%",padding:"6px 10px",fontSize:9,fontFamily:"monospace",letterSpacing:1,
              background:touchMode?"rgba(74,180,255,0.12)":"#161616",
              color:touchMode?"#4ab4ff":"#666",
              border:"1px solid "+(touchMode?"#4ab4ff":"#252525"),
              borderRadius:3,cursor:"pointer",textAlign:"left",
              display:"flex",justifyContent:"space-between",alignItems:"center"}},
            React.createElement("span",null,"Touch mode (bigger handles)"),
            React.createElement("span",{style:{fontSize:8}},touchMode?"ON":"OFF")
          )
        )
      ):null
    )
  );

  // Effective touch mode: explicit toggle OR mobile screen.
  // All interactive handles (gizmo, curve points, gradient stops) use this
  // so "Touch mode" toggle in View menu actually enlarges them on desktop.
  var touchActive=touchMode||isMobile;
  function zoomIn(){var next=ZOOM_STEPS.find(function(z){return z>previewZoom;});if(next)setPreviewZoom(next);}
  function zoomOut(){var prev=null;for(var i=0;i<ZOOM_STEPS.length;i++){if(ZOOM_STEPS[i]<previewZoom)prev=ZOOM_STEPS[i];}if(prev)setPreviewZoom(prev);}

  // Combined bottom toolbar: zoom + alpha preview
  var zoomBar=React.createElement("div",{
    onTouchStart:isMobile?function(e){e.stopPropagation();}:undefined,
    onTouchMove:isMobile?function(e){e.stopPropagation();}:undefined,
    style:isMobile?{
      // Mobile: a single scrollable bar pinned across the bottom. overflow-x
      // lets you swipe to reach every control; nothing is clipped off-screen.
      position:"absolute",bottom:8,left:8,right:8,zIndex:13,
      display:"flex",gap:2,alignItems:"center",flexWrap:"nowrap",
      background:"rgba(10,10,10,0.94)",border:"1px solid #1c1c1c",borderRadius:5,
      padding:"2px 5px",backdropFilter:"blur(4px)",
      overflowX:"auto",overflowY:"hidden",WebkitOverflowScrolling:"touch",
      touchAction:"pan-x",scrollbarWidth:"none"
    }:{
      // Desktop: centered; allow horizontal scroll only if the window is narrow.
      position:"absolute",bottom:8,left:"50%",transform:"translateX(-50%)",
      maxWidth:"calc(100% - 24px)",
      display:"flex",gap:2,alignItems:"center",flexWrap:"nowrap",
      background:"rgba(10,10,10,0.92)",border:"1px solid #1c1c1c",borderRadius:5,
      padding:"2px 5px",zIndex:10,backdropFilter:"blur(4px)",
      overflowX:"auto",overflowY:"hidden",scrollbarWidth:"thin"
    }},
    React.createElement("button",{onClick:zoomOut,style:{background:"none",border:"none",color:"#888",cursor:"pointer",fontSize:13,padding:"0 3px",fontFamily:"monospace",lineHeight:1}},"−"),
    React.createElement("span",{style:{fontSize:9,color:"#e8900a",fontFamily:"monospace",minWidth:36,textAlign:"center",cursor:"pointer"},onClick:function(){setPreviewZoom(1);setPreviewPan({x:0,y:0});}},(previewZoom*100|0)+"%"),
    React.createElement("button",{onClick:zoomIn,style:{background:"none",border:"none",color:"#888",cursor:"pointer",fontSize:13,padding:"0 3px",fontFamily:"monospace",lineHeight:1}},"+"),
    React.createElement("div",{style:{width:1,height:14,background:"#252525",margin:"0 4px"}}),
    // Preview resolution picker
    React.createElement("div",{style:{display:"flex",gap:2}},
      [64,128,256,512,1024,2048].map(function(res){
        var col=res<=256?"#4ab4ff":res<=512?"#e8900a":res<=1024?"#ff9966":"#ff6699";
        return React.createElement("button",{key:res,onClick:function(){setPreviewRes(res);},
          title:"Preview res: "+res+"px"+(res>=1024?" (slow render, use for quality check)":""),
          style:{padding:"2px 4px",fontSize:8,fontFamily:"monospace",
            background:previewRes===res?col:"none",
            color:previewRes===res?"#000":"#444",
            border:"1px solid "+(previewRes===res?col:"#2a2a2a"),
            borderRadius:2,cursor:"pointer"}},
          res>=1024?(res/1024)+"k":res);
      })
    ),
    React.createElement("div",{style:{width:1,height:14,background:"#252525",margin:"0 4px"}}),
    React.createElement("div",{style:{display:"flex",gap:2}},
      [["null","RGB"],["r","R"],["g","G"],["b","B"],["a","A"]].map(function(pair){
        var id=pair[0]==="null"?null:pair[0],label=pair[1];
        var active=chanMode===id;
        var col=id==="r"?"#ff6666":id==="g"?"#66dd66":id==="b"?"#4ab4ff":id==="a"?"#cc88ff":"#e8900a";
        return React.createElement("button",{key:label,
          onClick:function(){setChanMode(active?null:id);},
          title:id===null?"Show composite RGB":id==="a"?"Alpha channel (grayscale)":id.toUpperCase()+" channel (grayscale)",
          style:{
            padding:"2px 6px",fontSize:8,fontFamily:"monospace",
            background:active?col:"none",
            color:active?"#000":id===null?"#777":"#555",
            border:"1px solid "+(active?col:"#2a2a2a"),
            borderRadius:2,cursor:"pointer",transition:"all 0.08s"
          }
        },label);
      })
    ),
    React.createElement("div",{style:{width:1,height:14,background:"#252525",margin:"0 4px"}}),
    React.createElement("button",{
      onClick:function(){setShowAlphaChecker(function(v){return!v;});},
      title:"Show a checkerboard behind the texture so transparency reads correctly (for textures with an alpha channel)",
      style:{padding:"2px 7px",fontSize:8,fontFamily:"monospace",
        background:showAlphaChecker?"#44ddcc":"none",color:showAlphaChecker?"#000":"#555",
        border:"1px solid "+(showAlphaChecker?"#44ddcc":"#2a2a2a"),borderRadius:2,cursor:"pointer"}},
      "▦ Alpha"),
    React.createElement("button",{
      onClick:function(){setCompareLayers(function(v){return!v;});},
      title:"Show each layer rendered separately, side by side, instead of the composite",
      style:{padding:"2px 7px",fontSize:8,fontFamily:"monospace",
        background:compareLayers?"#e8900a":"none",color:compareLayers?"#000":"#555",
        border:"1px solid "+(compareLayers?"#e8900a":"#2a2a2a"),borderRadius:2,cursor:"pointer"}},
      "▥ Compare"),
    React.createElement("div",{style:{width:1,height:14,background:"#252525",margin:"0 4px"}}),
    // Tiling / variation view controls — live in the same bar as Alpha/Compare
    React.createElement("button",{
      onClick:function(){setSeamlessPreview(function(v){return!v;});},
      title:anySeamless?"Toggle seamless tile preview":"Toggle tile preview",
      style:{padding:"2px 7px",fontSize:8,fontFamily:"monospace",whiteSpace:"nowrap",
        background:seamlessPreview?"#e8900a":"none",color:seamlessPreview?"#000":"#555",
        border:"1px solid "+(seamlessPreview?"#e8900a":"#2a2a2a"),borderRadius:2,cursor:"pointer"}},
      "⊞ Tile"),
    React.createElement("button",{
      onClick:function(){setTileCheck33(function(v){return!v;});},
      title:"3×3 tiling check",
      style:{padding:"2px 7px",fontSize:8,fontFamily:"monospace",whiteSpace:"nowrap",
        background:tileCheck33?"#e8900a":"none",color:tileCheck33?"#000":"#555",
        border:"1px solid "+(tileCheck33?"#e8900a":"#2a2a2a"),borderRadius:2,cursor:"pointer"}},
      "▦ 3×3"),
    React.createElement("button",{
      onClick:function(){setShowVariations(function(v){return!v;});},
      title:"Explore variations",
      style:{padding:"2px 7px",fontSize:8,fontFamily:"monospace",whiteSpace:"nowrap",
        background:showVariations?"#e8900a":"none",color:showVariations?"#000":"#555",
        border:"1px solid "+(showVariations?"#e8900a":"#2a2a2a"),borderRadius:2,cursor:"pointer"}},
      "⚄ Vary")
  );

  var baseDisplaySize=256; // CSS display size — always fixed
  var anySeamless=curLayers.some(function(l){return l.seamless;});
  var soloBanner=soloLayerIdx>=0?React.createElement("div",{
    onClick:function(){setSoloLayerIdx(-1);},
    style:{
      position:"absolute",top:8,left:"50%",transform:"translateX(-50%)",
      background:"rgba(232,144,10,0.9)",color:"#000",
      padding:"3px 10px",borderRadius:10,fontSize:9,fontFamily:"monospace",
      fontWeight:700,letterSpacing:0.5,zIndex:12,cursor:"pointer",
      whiteSpace:"nowrap"
    }},"SOLO: "+(curLayers[soloLayerIdx]?curLayers[soloLayerIdx].label||"L"+(soloLayerIdx+1):"")+" ✕"):null;

  // Edge-cut warning: an effect runs off a border and would show a seam when
  // tiled. Offers a one-tap Auto-Fix (Make Tileable) or dismiss.
  // Discreet, non-intrusive seam hint: a small pill at the bottom-left of the
  // canvas, muted colours, easy to ignore. Only shows on a real seam mismatch.
  var edgeBanner=(edgeWarn&&!edgeWarnDismissed)?React.createElement("div",{style:{
    position:"absolute",bottom:10,left:10,
    background:"rgba(20,20,22,0.82)",color:"#d8a060",padding:"3px 6px",borderRadius:5,
    zIndex:14,display:"flex",alignItems:"center",gap:6,fontFamily:"monospace",
    border:"1px solid rgba(180,120,60,0.35)",backdropFilter:"blur(2px)"
  }},
    React.createElement("span",{style:{fontSize:8,lineHeight:1.3,opacity:0.95}},
      (edgeCheckMode==="seam"?"seam: ":"edge cut: ")+edgeWarn.sides),
    React.createElement("button",{onClick:autoFixEdges,title:"Fade the borders to fix it",
      style:{padding:"1px 6px",fontSize:8,fontFamily:"monospace",background:"rgba(180,120,60,0.22)",color:"#e8b070",border:"1px solid rgba(180,120,60,0.4)",borderRadius:3,cursor:"pointer",whiteSpace:"nowrap"}},
      "fix"),
    React.createElement("button",{onClick:function(){var nm=edgeCheckMode==="cut"?"seam":"cut";setEdgeCheckMode(nm);_edgeCheckMode=nm;bumpEpoch();},
      title:edgeCheckMode==="cut"?"Mode: effect runs off edge. Click for tiling-seam mode.":"Mode: opposite borders mismatch. Click for edge-cut mode.",
      style:{padding:"1px 5px",fontSize:8,fontFamily:"monospace",background:"transparent",color:"#888",border:"1px solid rgba(120,120,120,0.3)",borderRadius:3,cursor:"pointer"}},
      edgeCheckMode==="cut"?"⊡":"⊞"),
    React.createElement("button",{onClick:function(){setEdgeWarnDismissed(true);},title:"Dismiss",
      style:{padding:"1px 5px",fontSize:9,background:"transparent",color:"#888",border:"none",cursor:"pointer"}},
      "✕")
  ):null;
  // Shared style for the canvas action buttons. Grouped into one flex toolbar
  // (top-right) so they wrap/space automatically and never overlap on mobile.
  // Tile/3x3/Vary now live in the bottom zoomBar (one coherent bar). The old
  // floating canvas toolbar is removed to stop the overlaps.

  var tile33Overlay=tileCheck33?React.createElement("div",{style:{
    position:"absolute",inset:0,zIndex:7,background:"#080808",
    display:"flex",alignItems:"center",justifyContent:"center",padding:8
  }},
    React.createElement("canvas",{ref:tile33Ref,style:{
      width:Math.min(baseDisplaySize*1.4,420)+"px",height:Math.min(baseDisplaySize*1.4,420)+"px",
      imageRendering:previewRes<=256?"pixelated":"auto",borderRadius:2,boxShadow:"0 0 0 1px #1e1e1e"
    }}),
    React.createElement("div",{style:{position:"absolute",bottom:10,left:0,right:0,textAlign:"center",
      fontSize:8,color:"#666",fontFamily:"monospace",pointerEvents:"none"}},
      "3×3 tiling check · center tile outlined · look for visible seams at the edges")
  ):null;

  // ─── GIZMO ────────────────────────────────────────────────
  // Unity-style transform gizmo overlaid on canvas.
  // Controls offsetX/Y (move), rotation (rotate), scaleX/Y (scale) of active layer.
  var gizmoBtn=React.createElement("div",{style:{
    position:"absolute",top:8,left:8,display:"flex",gap:2,zIndex:11,
    background:"rgba(10,10,10,0.88)",border:"1px solid #1c1c1c",borderRadius:5,padding:2,
    backdropFilter:"blur(4px)"
  }},
    React.createElement("button",{
      onClick:function(){setGizmoOn(function(v){return!v;});},
      title:gizmoOn?"Hide gizmo":"Show transform gizmo",
      style:{padding:"3px 7px",background:gizmoOn?"#e8900a":"none",border:"none",
        color:gizmoOn?"#000":"#555",fontFamily:"monospace",fontSize:9,cursor:"pointer",borderRadius:3,letterSpacing:0.5}
    },gizmoOn?"◆ Gizmo":"◇ Gizmo"),
    gizmoOn?[
      React.createElement("button",{key:"m",onClick:function(){setGizmoMode("move");},
        title:"Move (W)",
        style:{padding:"3px 6px",background:gizmoMode==="move"?"#4ab4ff":"none",border:"none",
          color:gizmoMode==="move"?"#000":"#555",fontFamily:"monospace",fontSize:11,cursor:"pointer",borderRadius:2,lineHeight:1}},"✥"),
      React.createElement("button",{key:"r",onClick:function(){setGizmoMode("rotate");},
        title:"Rotate (E)",
        style:{padding:"3px 6px",background:gizmoMode==="rotate"?"#a0e060":"none",border:"none",
          color:gizmoMode==="rotate"?"#000":"#555",fontFamily:"monospace",fontSize:11,cursor:"pointer",borderRadius:2,lineHeight:1}},"↻"),
      React.createElement("button",{key:"s",onClick:function(){setGizmoMode("scale");},
        title:"Scale (R)",
        style:{padding:"3px 6px",background:gizmoMode==="scale"?"#ff6699":"none",border:"none",
          color:gizmoMode==="scale"?"#000":"#555",fontFamily:"monospace",fontSize:11,cursor:"pointer",borderRadius:2,lineHeight:1}},"⇲")
    ]:null
  );

  function getCanvasRect(){
    if(!canvasRef.current)return null;
    return canvasRef.current.getBoundingClientRect();
  }

  // Convert pointer event → UV coords in [0,1]
  function ptrToUV(e){
    var rect=getCanvasRect();if(!rect)return{u:0.5,v:0.5};
    var src=e.touches&&e.touches.length>0?e.touches[0]:(e.changedTouches&&e.changedTouches.length>0?e.changedTouches[0]:e);
    return{u:(src.clientX-rect.left)/rect.width,v:(src.clientY-rect.top)/rect.height};
  }

  function onGizmoDown(handleType,e){
    e.preventDefault();e.stopPropagation();
    pushUndo(state);
    gizmoDragging.current=handleType;
    var p=ptrToUV(e);
    gizmoStart.current={
      x:p.u,y:p.v,
      ox:L.offsetX||0,oy:L.offsetY||0,
      rot:L.rotation||0,
      sx:L.scaleX||3.5,sy:L.scaleY||3.5
    };
    // Lock body scroll while dragging
    if(typeof document!=="undefined"){
      document.body.style.overflow="hidden";
      document.body.style.touchAction="none";
    }
  }
  function onGizmoMove(e){
    if(!gizmoDragging.current)return;
    if(e.preventDefault)e.preventDefault();
    if(e.stopPropagation)e.stopPropagation();
    var p=ptrToUV(e),s=gizmoStart.current;
    var du=p.u-s.x,dv=p.v-s.y;
    var mode=gizmoDragging.current;
    if(mode==="xy"){
      setL("offsetX",s.ox+du);
      setL("offsetY",s.oy+dv);
    } else if(mode==="x"){
      setL("offsetX",s.ox+du);
    } else if(mode==="y"){
      setL("offsetY",s.oy+dv);
    } else if(mode==="rot"){
      // Angle from center
      var cx=0.5+(s.ox||0),cy=0.5+(s.oy||0);
      var a0=Math.atan2(s.y-cy,s.x-cx);
      var a1=Math.atan2(p.v-cy,p.u-cx);
      var deg=(a1-a0)*180/Math.PI;
      setL("rotation",s.rot+deg);
    } else if(mode==="scale"){
      // Uniform scale based on distance from center
      var cx=0.5+(s.ox||0),cy=0.5+(s.oy||0);
      var d0=Math.hypot(s.x-cx,s.y-cy)||0.001;
      var d1=Math.hypot(p.u-cx,p.v-cy)||0.001;
      var ratio=d1/d0;
      var newSX=Math.max(0.1,Math.min(32,s.sx*ratio));
      setL("scaleX",newSX);
      if(L.scaleLinked)setL("scaleY",newSX);
      else setL("scaleY",Math.max(0.1,Math.min(32,s.sy*ratio)));
    } else if(mode==="scaleX"){
      var ratio=1+du*4;
      setL("scaleX",Math.max(0.1,Math.min(32,s.sx*ratio)));
    } else if(mode==="scaleY"){
      var ratio=1+dv*4;
      setL("scaleY",Math.max(0.1,Math.min(32,s.sy*ratio)));
    }
  }
  function onGizmoUp(){
    if(gizmoDragging.current){commitUndo();}
    gizmoDragging.current=null;
    // Restore body scroll
    if(typeof document!=="undefined"){
      document.body.style.overflow="";
      document.body.style.touchAction="";
    }
  }

  // Build SVG gizmo overlaid on canvas
  var gizmoSVG=null;
  if(gizmoOn&&L){
    // Use touchActive (explicit toggle OR mobile) for handle sizing
    var HS=touchActive?10:6;     // handle visible size
    var HIT=touchActive?16:10;   // invisible hit area extends further
    var armW=touchActive?5:3;    // axis line stroke width
    var headSz=touchActive?12:8; // arrowhead size
    var ringW=touchActive?4:2;   // rotate ring width
    var rotDotR=touchActive?9:6; // rotation indicator dot
    var ctrSz=touchActive?16:10; // center grab cube size
    var cu=(0.5+(L.offsetX||0))*baseDisplaySize;
    var cv=(0.5+(L.offsetY||0))*baseDisplaySize;
    var armLen=Math.min(64,baseDisplaySize*0.28);
    var rot=(L.rotation||0)*Math.PI/180;
    var cosR=Math.cos(rot),sinR=Math.sin(rot);
    // X axis tip (rotated red)
    var xTx=cu+cosR*armLen,xTy=cv+sinR*armLen;
    // Y axis tip (rotated green, perpendicular)
    var yTx=cu-sinR*armLen,yTy=cv+cosR*armLen;

    var elts=[];
    // Outer grab circle (for rotation in rotate mode)
    if(gizmoMode==="rotate"){
      elts.push(React.createElement("circle",{key:"rotRing",cx:cu,cy:cv,r:armLen+8,
        fill:"none",stroke:"#a0e060",strokeWidth:ringW,strokeDasharray:"4 3",opacity:0.7,
        style:{pointerEvents:"all",cursor:"grab",touchAction:"none"},
        onPointerDown:function(e){e.currentTarget.setPointerCapture(e.pointerId);onGizmoDown("rot",e);}
      }));
      // Rotation indicator dot
      var ix=cu+cosR*(armLen+8),iy=cv+sinR*(armLen+8);
      elts.push(React.createElement("circle",{key:"rotDot",cx:ix,cy:iy,r:rotDotR,fill:"#a0e060",stroke:"#000",strokeWidth:1.5,style:{pointerEvents:"none"}}));
    }
    if(gizmoMode==="scale"){
      // Uniform scale ring (diagonal handle at 45°)
      var scX=cu+cosR*armLen*0.85-sinR*armLen*0.85;
      var scY=cv+sinR*armLen*0.85+cosR*armLen*0.85;
      elts.push(React.createElement("rect",{key:"scUniform",x:scX-HS,y:scY-HS,width:HS*2,height:HS*2,
        fill:"#ff6699",stroke:"#000",strokeWidth:1.5,
        style:{pointerEvents:"all",cursor:"nwse-resize",touchAction:"none"},
        onPointerDown:function(e){e.currentTarget.setPointerCapture(e.pointerId);onGizmoDown("scale",e);}
      }));
    }
    // X axis line (red)
    elts.push(React.createElement("line",{key:"xLine",x1:cu,y1:cv,x2:xTx,y2:xTy,stroke:"#ff4444",strokeWidth:armW,opacity:0.85,style:{pointerEvents:"none"}}));
    // X arrowhead / scale cube
    if(gizmoMode==="scale"){
      elts.push(React.createElement("rect",{key:"xHandle",x:xTx-HS,y:xTy-HS,width:HS*2,height:HS*2,fill:"#ff4444",stroke:"#000",strokeWidth:1.5,
        style:{pointerEvents:"all",cursor:"ew-resize",touchAction:"none"},
        onPointerDown:function(e){e.currentTarget.setPointerCapture(e.pointerId);onGizmoDown("scaleX",e);}
      }));
    } else {
      var ax=xTx,ay=xTy;
      var ahx1=ax-cosR*headSz-sinR*(headSz*0.6),ahy1=ay-sinR*headSz+cosR*(headSz*0.6);
      var ahx2=ax-cosR*headSz+sinR*(headSz*0.6),ahy2=ay-sinR*headSz-cosR*(headSz*0.6);
      // Invisible hit circle
      elts.push(React.createElement("circle",{key:"xHit",cx:ax,cy:ay,r:HIT,fill:"rgba(255,68,68,0.0001)",
        style:{pointerEvents:gizmoMode==="move"?"all":"none",cursor:"ew-resize",touchAction:"none"},
        onPointerDown:gizmoMode==="move"?function(e){e.currentTarget.setPointerCapture(e.pointerId);onGizmoDown("x",e);}:null
      }));
      elts.push(React.createElement("polygon",{key:"xArrow",points:ax+","+ay+" "+ahx1+","+ahy1+" "+ahx2+","+ahy2,fill:"#ff4444",stroke:"#000",strokeWidth:1,
        style:{pointerEvents:"none"}
      }));
    }
    // Y axis line (green)
    elts.push(React.createElement("line",{key:"yLine",x1:cu,y1:cv,x2:yTx,y2:yTy,stroke:"#44dd44",strokeWidth:armW,opacity:0.85,style:{pointerEvents:"none"}}));
    if(gizmoMode==="scale"){
      elts.push(React.createElement("rect",{key:"yHandle",x:yTx-HS,y:yTy-HS,width:HS*2,height:HS*2,fill:"#44dd44",stroke:"#000",strokeWidth:1.5,
        style:{pointerEvents:"all",cursor:"ns-resize",touchAction:"none"},
        onPointerDown:function(e){e.currentTarget.setPointerCapture(e.pointerId);onGizmoDown("scaleY",e);}
      }));
    } else {
      var bx=yTx,by=yTy;
      var bhx1=bx+sinR*headSz-cosR*(headSz*0.6),bhy1=by-cosR*headSz-sinR*(headSz*0.6);
      var bhx2=bx+sinR*headSz+cosR*(headSz*0.6),bhy2=by-cosR*headSz+sinR*(headSz*0.6);
      elts.push(React.createElement("circle",{key:"yHit",cx:bx,cy:by,r:HIT,fill:"rgba(68,221,68,0.0001)",
        style:{pointerEvents:gizmoMode==="move"?"all":"none",cursor:"ns-resize",touchAction:"none"},
        onPointerDown:gizmoMode==="move"?function(e){e.currentTarget.setPointerCapture(e.pointerId);onGizmoDown("y",e);}:null
      }));
      elts.push(React.createElement("polygon",{key:"yArrow",points:bx+","+by+" "+bhx1+","+bhy1+" "+bhx2+","+bhy2,fill:"#44dd44",stroke:"#000",strokeWidth:1,
        style:{pointerEvents:"none"}
      }));
    }
    // Center XY grab
    if(gizmoMode==="move"){
      elts.push(React.createElement("rect",{key:"centerGrab",x:cu-ctrSz,y:cv-ctrSz,width:ctrSz*2,height:ctrSz*2,
        fill:"rgba(255,221,68,0.2)",stroke:"#ffdd44",strokeWidth:1.5,
        style:{pointerEvents:"all",cursor:"move",touchAction:"none"},
        onPointerDown:function(e){e.currentTarget.setPointerCapture(e.pointerId);onGizmoDown("xy",e);}
      }));
      elts.push(React.createElement("circle",{key:"centerDot",cx:cu,cy:cv,r:3,fill:"#ffdd44",style:{pointerEvents:"none"}}));
    } else {
      elts.push(React.createElement("circle",{key:"centerDot",cx:cu,cy:cv,r:3,fill:"#ffdd44",stroke:"#000",strokeWidth:1,style:{pointerEvents:"none"}}));
    }

    gizmoSVG=React.createElement("svg",{
      width:baseDisplaySize,height:baseDisplaySize,
      viewBox:"0 0 "+baseDisplaySize+" "+baseDisplaySize,
      style:{
        position:"absolute",
        width:baseDisplaySize+"px",height:baseDisplaySize+"px",
        transform:"translate("+previewPan.x+"px,"+previewPan.y+"px) scale("+previewZoom+")",transformOrigin:"center center",
        pointerEvents:"none",zIndex:6,overflow:"visible",
        touchAction:"none"
      },
      onPointerMove:onGizmoMove,
      onPointerUp:onGizmoUp,
      onPointerCancel:onGizmoUp
    },elts);
  }

  // Global move/up listeners while gizmo is being dragged
  useEffect(function(){
    function mv(e){if(gizmoDragging.current)onGizmoMove(e);}
    function up(e){if(gizmoDragging.current)onGizmoUp();}
    function tMv(e){if(gizmoDragging.current){e.preventDefault();onGizmoMove(e);}}
    window.addEventListener("pointermove",mv);
    window.addEventListener("pointerup",up);
    window.addEventListener("pointercancel",up);
    // Touch events with passive:false so preventDefault works
    window.addEventListener("touchmove",tMv,{passive:false});
    window.addEventListener("touchend",up);
    window.addEventListener("touchcancel",up);
    return function(){
      window.removeEventListener("pointermove",mv);
      window.removeEventListener("pointerup",up);
      window.removeEventListener("pointercancel",up);
      window.removeEventListener("touchmove",tMv);
      window.removeEventListener("touchend",up);
      window.removeEventListener("touchcancel",up);
    };
  },[L]);

  // The tile bg div: shows repeating tiles AROUND the central canvas
  var tileBgDiv=React.createElement("div",{ref:bgTileRef,"data-cv":"1",style:{touchAction:"none",
    position:"absolute",inset:0,
    backgroundSize:(baseDisplaySize*previewZoom)+"px "+(baseDisplaySize*previewZoom)+"px",
    backgroundRepeat:"repeat",
    backgroundPosition:"center center",
    imageRendering:"pixelated",
    opacity:seamlessPreview?0.45:0,
    transition:"opacity 0.25s"
  }});

  // Checkerboard background pattern for canvas area (transparent texture bg)
  var checker=React.createElement("div",{"data-cv":"1",style:{position:"absolute",inset:0,touchAction:"none",backgroundImage:"linear-gradient(45deg,#111 25%,transparent 25%),linear-gradient(-45deg,#111 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#111 75%),linear-gradient(-45deg,transparent 75%,#111 75%)",backgroundSize:"16px 16px",backgroundPosition:"0 0,0 8px,8px -8px,-8px 0",opacity:0.5}});

  // Quick layer switcher — compact strip on left side of canvas
  // Layer drag-reorder state for quick strip
  var _dragL=useState(-1); var dragLayerIdx=_dragL[0],setDragLayerIdx=_dragL[1];
  var _dragOv=useState(-1); var dragOverIdx=_dragOv[0],setDragOverIdx=_dragOv[1];
  var _stripOpen=useState(true); var stripOpen=_stripOpen[0],setStripOpen=_stripOpen[1];
  function onLayerDragStart(i){setDragLayerIdx(i);}
  function onLayerDragOver(i,e){e.preventDefault();setDragOverIdx(i);}
  function onLayerDragEnd(){
    if(dragLayerIdx>=0&&dragOverIdx>=0&&dragLayerIdx!==dragOverIdx){
      pushUndo(state);
      setState(function(p){
        var ls=p.layers.slice();
        var moved=ls.splice(dragLayerIdx,1)[0];
        ls.splice(dragOverIdx,0,moved);
        return Object.assign({},p,{layers:ls});
      });
      setCurAL(dragOverIdx);
      haptic(10);
    }
    setDragLayerIdx(-1);setDragOverIdx(-1);
  }
  var thumbSz=isMobile?54:56;
  // Collapsed strip: just a thin button to expand
  var quickLayerStrip=!stripOpen?React.createElement("button",{
    onClick:function(){setStripOpen(true);},
    title:"Show layer strip",
    style:{
      position:"absolute",left:6,top:"50%",transform:"translateY(-50%)",
      background:"rgba(10,10,10,0.85)",border:"1px solid #1c1c1c",
      borderRadius:4,padding:"8px 4px",cursor:"pointer",zIndex:10,
      color:"#666",fontSize:14,lineHeight:1,
      display:"flex",flexDirection:"column",alignItems:"center",gap:4,
      backdropFilter:"blur(4px)"
    }
  },
    React.createElement("span",{style:{transform:"rotate(90deg)",letterSpacing:1}},"⊟"),
    React.createElement("span",{style:{fontSize:8,color:"#444",fontFamily:"monospace",writingMode:"vertical-rl",letterSpacing:1}},curLayers.length+" L")
  ):React.createElement("div",{style:{
    position:"absolute",left:8,top:"50%",transform:"translateY(-50%)",
    display:"flex",flexDirection:"column",gap:0,zIndex:10,
    background:"rgba(10,10,10,0.92)",border:"1px solid #1c1c1c",
    borderRadius:6,padding:0,backdropFilter:"blur(6px)",
    maxHeight:"92%",overflow:"hidden",
    boxShadow:"0 4px 16px rgba(0,0,0,0.4)"
  }},
    // ── Header with collapse + count ──
    React.createElement("div",{style:{
      display:"flex",alignItems:"center",justifyContent:"space-between",
      padding:"4px 6px 4px 8px",borderBottom:"1px solid #1c1c1c",
      gap:4
    }},
      React.createElement("span",{style:{
        fontSize:7,color:"#444",letterSpacing:1.2,textTransform:"uppercase",fontFamily:"monospace"
      }},curLayers.length+"/8"),
      React.createElement("button",{
        onClick:function(){setStripOpen(false);},
        title:"Hide layer strip",
        style:{padding:"2px 4px",background:"none",border:"none",color:"#444",
          cursor:"pointer",fontSize:11,lineHeight:1}
      },"×")
    ),
    // ── Scrollable layer list ──
    React.createElement("div",{style:{
      display:"flex",flexDirection:"column",gap:3,
      padding:4,overflowY:"auto",overflowX:"hidden",flex:1
    }},
    curLayers.map(function(lay,i){
      var col=LC8[i%8];
      var isActive=i===si;
      var isSolo=soloLayerIdx===i&&soloLayerIdx<curLayers.length;
      return React.createElement("div",{key:i,
        onClick:function(){setCurAL(i);if(!isMobile)setPanel("noise");},
        onDoubleClick:function(){
          pushUndo(state);
          setState(function(p){var ls=p.layers.slice();ls[i]=Object.assign({},ls[i],{enabled:!ls[i].enabled});return Object.assign({},p,{layers:ls});});
        },
        // Long-press (touch) or right-click (desktop) opens the layer menu
        onTouchStart:function(e){
          var lp=lpRef.current;
          lp.x=e.touches[0].clientX;lp.y=e.touches[0].clientY;
          if(lp.t)clearTimeout(lp.t);
          lp.t=setTimeout(function(){
            lp.t=null;haptic(15);
            setCurAL(i);setLmRename(null);
            setLayerMenu({idx:i,y:lp.y});
          },480);
        },
        onTouchMove:function(e){
          var lp=lpRef.current;
          if(lp.t&&(Math.abs(e.touches[0].clientX-lp.x)>10||Math.abs(e.touches[0].clientY-lp.y)>10)){
            clearTimeout(lp.t);lp.t=null;
          }
        },
        onTouchEnd:function(){var lp=lpRef.current;if(lp.t){clearTimeout(lp.t);lp.t=null;}},
        onContextMenu:function(e){
          e.preventDefault();
          setCurAL(i);setLmRename(null);
          setLayerMenu({idx:i,y:e.clientY});
        },
        draggable:!isMobile,
        onDragStart:function(){onLayerDragStart(i);},
        onDragOver:function(e){onLayerDragOver(i,e);},
        onDragEnd:onLayerDragEnd,
        title:(lay.label||"L"+(i+1))+" — "+lay.type+(lay.enabled?"":" [hidden]")+(isMobile?"":"  ·  drag to reorder, dbl-click to toggle"),
        style:{
          position:"relative",cursor:isMobile?"pointer":"grab",borderRadius:3,
          border:"2px solid "+(dragOverIdx===i&&dragLayerIdx!==i?"#4ab4ff":isActive?col:isSolo?"#ffdd44":"#1e1e1e"),
          opacity:dragLayerIdx===i?0.4:lay.enabled?1:0.4,
          transition:"border-color 0.1s,opacity 0.1s,transform 0.08s",
          overflow:"hidden",
          width:thumbSz,height:thumbSz,
          flexShrink:0,
          // Subtle glow for active layer
          boxShadow:isActive?"0 0 0 1px "+col+"55":"none"
        }
      },
        React.createElement(SoloPreview,{layer:lay,size:thumbSz,allLayers:curLayers}),
        // Disabled overlay: diagonal line — clearer than a tiny dot
        !lay.enabled?React.createElement("div",{style:{
          position:"absolute",inset:0,
          background:"linear-gradient(135deg,transparent calc(50% - 1px),#ff6666 50%,transparent calc(50% + 1px))",
          pointerEvents:"none"
        }}):null,
        // Blend-mode badge — top right (only when not "normal")
        (lay.blendMode&&lay.blendMode!=="normal")?React.createElement("div",{style:{
          position:"absolute",top:1,right:1,fontSize:7,fontFamily:"monospace",fontWeight:700,
          color:"#ffd27f",background:"rgba(0,0,0,0.6)",borderRadius:2,padding:"0 2px",lineHeight:1.4,pointerEvents:"none"
        }},({add:"+",subtract:"−",multiply:"×",divide:"÷",screen:"S",overlay:"Ov",softlight:"s",hardlight:"H",lighten:"↑",darken:"↓",linearDodge:"+",difference:"△",exclusion:"⊕",dissolve:"·",max:"▲",min:"▼"}[lay.blendMode]||"?")):null,
        // Reference badge — bottom left (a small chain mark)
        (lay.refUid!=null)?React.createElement("div",{style:{
          position:"absolute",bottom:1,left:1,fontSize:7,color:"#cc88ff",background:"rgba(0,0,0,0.6)",
          borderRadius:2,padding:"0 2px",lineHeight:1.4,pointerEvents:"none"
        }},"\u26ad"):null,
        // Layer number — top left
        React.createElement("div",{style:{
          position:"absolute",top:1,left:2,
          fontSize:8,color:isActive?col:"#888",
          fontFamily:"monospace",fontWeight:700,
          textShadow:"0 1px 2px rgba(0,0,0,0.85)",
          pointerEvents:"none",lineHeight:1
        }},i+1),
        // Solo indicator — top right corner badge (only when soloed)
        isSolo?React.createElement("div",{style:{
          position:"absolute",top:1,right:1,
          width:8,height:8,borderRadius:"50%",
          background:"#ffdd44",
          boxShadow:"0 0 4px #ffdd44",
          pointerEvents:"none"
        }}):null,
        // Solo button — bottom right corner overlay (always present, opacity-controlled)
        React.createElement("div",{
          onClick:function(e){e.stopPropagation();setSoloLayerIdx(isSolo?-1:i);},
          title:isSolo?"Exit solo":"Solo this layer",
          style:{
            position:"absolute",bottom:0,right:0,
            width:14,height:14,
            display:"flex",alignItems:"center",justifyContent:"center",
            background:isSolo?"rgba(255,221,68,0.95)":"rgba(0,0,0,0.7)",
            cursor:"pointer",fontSize:9,
            color:isSolo?"#000":"#999",
            opacity:isMobile||isActive||isSolo?1:0,
            transition:"opacity 0.12s,background 0.12s",
            borderRadius:"3px 0 0 0",
            lineHeight:1
          },
          onMouseEnter:function(e){
            e.currentTarget.style.opacity="1";
            if(!isSolo)e.currentTarget.style.background="rgba(255,221,68,0.4)";
          },
          onMouseLeave:function(e){
            e.currentTarget.style.opacity=isActive||isSolo||isMobile?"1":"0";
            if(!isSolo)e.currentTarget.style.background="rgba(0,0,0,0.7)";
          }
        },"●")
      );
    }),
    // Add layer button — matches thumbnail width, dashed border to mark "add" affordance
    curLayers.length<8?React.createElement("button",{
      onClick:addLayer,
      title:"Add new layer",
      style:{
        width:thumbSz,height:Math.round(thumbSz*0.5),
        background:"#0e0e0e",border:"1px dashed #2e2e2e",color:"#666",
        fontFamily:"monospace",fontSize:13,cursor:"pointer",borderRadius:3,
        padding:0,lineHeight:1,flexShrink:0,
        transition:"border-color 0.1s,color 0.1s,background 0.1s"
      },
      onMouseEnter:function(e){e.currentTarget.style.borderColor="#e8900a";e.currentTarget.style.color="#e8900a";e.currentTarget.style.background="#1a1208";},
      onMouseLeave:function(e){e.currentTarget.style.borderColor="#2e2e2e";e.currentTarget.style.color="#666";e.currentTarget.style.background="#0e0e0e";}
    },"+"):null
    ) // end scrollable list
  );

  // ── Pinch-to-zoom + pan gestures on the canvas ──────────────────
  // Two fingers: pinch zoom (around center). One finger while zoomed in: pan.
  // Direct DOM mutation during the gesture (60fps without re-rendering the
  // whole app), state commit on touch end. Disabled while the gizmo is active
  // because the gizmo owns its touches.
  function _gestTargetOk(e){
    var t=e.target;
    return t&&(t.tagName==="CANVAS"||(t.dataset&&t.dataset.cv==="1"));
  }
  function _applyGestTransform(){
    var g=gestRef.current;
    if(canvasRef.current)canvasRef.current.style.transform="translate("+g.px+"px,"+g.py+"px) scale("+g.z+")";
  }
  function _panClamp(v,z){
    var lim=baseDisplaySize*z*0.75;
    return v<-lim?-lim:v>lim?lim:v;
  }
  function onCanvasTouchStart(e){
    if(gizmoOn||abMode)return;
    var g=gestRef.current;
    if(e.touches.length===2){
      var dx=e.touches[0].clientX-e.touches[1].clientX,dy=e.touches[0].clientY-e.touches[1].clientY;
      g.mode="pinch";g.d0=Math.hypot(dx,dy)||1;g.z0=previewZoom;
      g.z=previewZoom;g.px=previewPan.x;g.py=previewPan.y;
      g.px0=previewPan.x;g.py0=previewPan.y;
    } else if(e.touches.length===1&&previewZoom>1&&_gestTargetOk(e)){
      g.mode="pan";g.x0=e.touches[0].clientX;g.y0=e.touches[0].clientY;
      g.px0=previewPan.x;g.py0=previewPan.y;
      g.z=previewZoom;g.px=previewPan.x;g.py=previewPan.y;
    } else g.mode=null;
  }
  function onCanvasTouchMove(e){
    var g=gestRef.current;
    if(!g.mode)return;
    if(g.mode==="pinch"&&e.touches.length===2){
      var dx=e.touches[0].clientX-e.touches[1].clientX,dy=e.touches[0].clientY-e.touches[1].clientY;
      var d=Math.hypot(dx,dy)||1;
      var z=g.z0*d/g.d0;
      g.z=z<0.25?0.25:z>8?8:z;
      g.px=_panClamp(g.px0,g.z);g.py=_panClamp(g.py0,g.z);
      _applyGestTransform();
      e.preventDefault&&e.preventDefault();
    } else if(g.mode==="pan"&&e.touches.length===1){
      g.px=_panClamp(g.px0+(e.touches[0].clientX-g.x0),g.z);
      g.py=_panClamp(g.py0+(e.touches[0].clientY-g.y0),g.z);
      _applyGestTransform();
      e.preventDefault&&e.preventDefault();
    }
  }
  function onCanvasTouchEnd(e){
    var g=gestRef.current;
    if(!g.mode)return;
    if(e.touches.length>0&&g.mode==="pinch"){
      // One finger lifted mid-pinch: continue as pan from current point
      g.mode="pan";g.x0=e.touches[0].clientX;g.y0=e.touches[0].clientY;
      g.px0=g.px;g.py0=g.py;
      return;
    }
    g.mode=null;
    var z=g.z;
    // Snap to 100% when close — also recenters
    if(z>0.95&&z<1.05){z=1;g.px=0;g.py=0;}
    setPreviewZoom(z);
    setPreviewPan({x:g.px,y:g.py});
  }
  function onCanvasMouseDown(e){
    if(gizmoOn||abMode||e.button!==0)return;
    if(previewZoom<=1||!_gestTargetOk(e))return;
    var g=gestRef.current;
    g.mode="mpan";g.x0=e.clientX;g.y0=e.clientY;
    g.px0=previewPan.x;g.py0=previewPan.y;
    g.z=previewZoom;g.px=previewPan.x;g.py=previewPan.y;
    e.preventDefault();
  }
  function onCanvasMouseMove(e){
    var g=gestRef.current;
    if(g.mode!=="mpan")return;
    g.px=_panClamp(g.px0+(e.clientX-g.x0),g.z);
    g.py=_panClamp(g.py0+(e.clientY-g.y0),g.z);
    _applyGestTransform();
  }
  function onCanvasMouseUp(){
    var g=gestRef.current;
    if(g.mode!=="mpan")return;
    g.mode=null;
    setPreviewPan({x:g.px,y:g.py});
  }
  function onCanvasWheel(e){
    if(gizmoOn)return;
    var z=previewZoom*(e.deltaY<0?1.1:1/1.1);
    z=z<0.25?0.25:z>8?8:z;
    if(z>0.95&&z<1.05)z=1;
    setPreviewZoom(z);
    if(z===1)setPreviewPan({x:0,y:0});
    else setPreviewPan({x:_panClamp(previewPan.x,z),y:_panClamp(previewPan.y,z)});
  }

  var _nodeMode=appMode==="nodes";
  // ── Node-mode source panel: the FULL layer panel, but editing the selected
  // Source node's layer instead of a project layer. Reuses NoisePanel so every
  // noise type, parameter, filter and warp is available identically. ──
  var _selNodeObj=selSourceNodeId?nodeGraph.nodes[selSourceNodeId]:null;
  var _selNodeType=_selNodeObj?_selNodeObj.type:null;
  var nodeSrcLayer=(_selNodeType==="source")?nodeLayerOf(selSourceNodeId):null;
  var _panelOpen=appMode==="nodes"&&selSourceNodeId&&_selNodeObj&&(_selNodeType==="source"?!!nodeSrcLayer:_selNodeType==="filter");
  var _panelTitle=_selNodeType==="filter"?"FILTER NODE":"SOURCE NODE";
  var _panelBody=null;
  if(_selNodeType==="source"&&nodeSrcLayer){
    _panelBody=React.createElement(NoisePanel,{
      nodeMode:true,
      L:nodeSrcLayer, si:0, layers:[nodeSrcLayer],
      setL:function(k,v){setNodeLayer(selSourceNodeId,k,v);},
      setLSP:function(k,v){setNodeLayerSP(selSourceNodeId,k,v);},
      onCommit:function(){}, _bumpEpoch:bumpEpoch, canvasEpoch:canvasEpoch,
      addLayer:function(){},addLayerWithBlend:function(){},removeLayer:function(){},
      duplicateLayer:function(){},setActiveL:function(){},moveLayerUp:function(){},moveLayerDown:function(){},
      onSeamlessOn:function(){},soloThumbSize:128,setSoloThumbSize:function(){},soloIdx:-1,setSoloIdx:function(){},
      onRenameLayer:function(){},copyLayer:function(){},pasteLayer:function(){},hasCopied:false,
      randomizeAll:function(){},resetLayer:function(){},
      groups:[],addGroup:function(){},updGroup:function(){},removeGroup:function(){},setLayerGroup:function(){},
      groupsEnabled:false,runChainOp:function(){}
    });
  } else if(_selNodeType==="filter"){
    _panelBody=React.createElement(FiltersPanel,{
      filters:(_selNodeObj.params.filters)||[],
      setFilters:function(nf){setNodeFilters(selSourceNodeId,nf);},
      addType:nodeFilterAddType, setAddType:setNodeFilterAddType,
      layerName:"Filter Node", onCommit:function(){}, _bumpEpoch:bumpEpoch,
      globalFilters:[], setGlobalFilters:function(){}
    });
  }
  var nodeSourcePanel=_panelOpen?React.createElement("div",{style:{
    position:"absolute",top:0,right:0,bottom:0,
    width:isMobile?"86%":320,maxWidth:"92%",zIndex:45,
    background:"rgba(13,13,13,0.97)",borderLeft:"1px solid #2a2a2a",
    display:"flex",flexDirection:"column",overflow:"hidden",
    boxShadow:"-6px 0 24px rgba(0,0,0,0.6)"}},
    React.createElement("div",{style:{padding:"8px 10px",borderBottom:"1px solid #1c1c1c",display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0}},
      React.createElement("span",{style:{fontSize:9,fontFamily:"monospace",fontWeight:700,color:"#e8900a",letterSpacing:0.5}},_panelTitle),
      React.createElement("button",{onClick:function(){setSelSourceNodeId(null);},
        title:"Close",style:{background:"none",border:"1px solid #333",color:"#aaa",borderRadius:4,fontSize:13,padding:"1px 9px",cursor:"pointer",fontFamily:"monospace",touchAction:"manipulation"}},"\u00d7")),
    React.createElement("div",{style:{flex:1,overflowY:"auto",padding:"10px 9px 40px",WebkitOverflowScrolling:"touch",minHeight:0}},
      _panelBody
    )
  ):null;

  var canvasArea=React.createElement("div",{
    ref:canvasAreaRef,
    onTouchStart:_nodeMode?null:onCanvasTouchStart,onTouchMove:_nodeMode?null:onCanvasTouchMove,
    onTouchEnd:_nodeMode?null:onCanvasTouchEnd,onTouchCancel:_nodeMode?null:onCanvasTouchEnd,
    onMouseDown:_nodeMode?null:onCanvasMouseDown,onMouseMove:_nodeMode?null:onCanvasMouseMove,
    onMouseUp:_nodeMode?null:onCanvasMouseUp,onMouseLeave:_nodeMode?null:onCanvasMouseUp,
    onWheel:_nodeMode?null:onCanvasWheel,
    style:{flex:(isMobile&&appMode!=="nodes")?null:1,display:"flex",alignItems:"center",justifyContent:"center",background:"#0b0b0b",position:"relative",overflow:"hidden",minWidth:0,height:(isMobile&&appMode!=="nodes")?(mobileCanvasH?mobileCanvasH+"px":"55vw"):null,minHeight:isMobile?(appMode==="nodes"?"320px":"160px"):null,touchAction:(gizmoOn||appMode==="nodes")?"none":"auto"}},
    // Node mode overlay — covers the whole canvas area when active
    appMode==="nodes"?React.createElement(NodeCanvas,{graph:nodeGraph,setGraph:setNodeGraph,previewSize:128,onExport:doExport,exporting:exportingPng,exportSize:state.exportSize||512,onSelectSource:setSelSourceNodeId,onBakeFlipbook:doBakeFlipbook,onBakeTimeline:doBakeTimeline,onBatchExportRes:batchExportResolutions,onBatchExportNodes:batchExportNodes,onBatchSeedSweep:batchSeedSweep}):null,
    appMode==="nodes"?nodeSourcePanel:null,
    // Mode switch (top-center) — compact pill, always visible. Layers is the
    // primary mode; Nodes is the alternate view.
    React.createElement("div",{style:{position:"absolute",top:8,left:"50%",transform:"translateX(-50%)",zIndex:30,
      display:"flex",gap:0,background:"rgba(13,13,13,0.92)",border:"1px solid #2a2a2a",borderRadius:14,overflow:"hidden",
      boxShadow:"0 2px 8px rgba(0,0,0,0.4)",backdropFilter:"blur(3px)"}},
      ["layers","nodes"].map(function(m){
        return React.createElement("button",{key:m,
          onClick:function(){setAppMode(m);},
          style:{padding:"4px 13px",fontSize:8.5,fontFamily:"monospace",fontWeight:700,letterSpacing:0.6,cursor:"pointer",border:"none",
            background:appMode===m?"#e8900a":"transparent",color:appMode===m?"#000":"#888",
            transition:"background 0.15s",touchAction:"manipulation"}},
          m==="layers"?"\u25a4 LAYERS":"\u2b22 NODES");
      })
    ),
    // Layer-mode UI (canvas, overlays, controls) — hidden entirely in node mode
    ...(appMode==="layers"?[
    checker,
    tileBgDiv,
    quickLayerStrip,
    // Main canvas always rendered and shown — sits on top of tiled bg
    // Checkerboard backing — only shown when alpha display is on, so transparent
    // regions read as transparency (not as fringey dark edges over the page bg).
    showAlphaChecker?React.createElement("div",{style:{
      position:"absolute",
      width:baseDisplaySize+"px",height:baseDisplaySize+"px",
      transform:"translate("+previewPan.x+"px,"+previewPan.y+"px) scale("+previewZoom+")",transformOrigin:"center center",
      backgroundImage:"conic-gradient(#3a3a3a 0 25%, #2a2a2a 0 50%, #3a3a3a 0 75%, #2a2a2a 0)",
      backgroundSize:"16px 16px",
      borderRadius:0,zIndex:1,pointerEvents:"none"
    }}):null,
    React.createElement("canvas",{ref:canvasRef,
      onContextMenu:function(e){e.preventDefault();setCanvasMenu({x:e.clientX,y:e.clientY});},
      // Touch parity: right-click has no touch equivalent, so press-and-hold
      // opens the same quick-actions menu. Moving the finger cancels it.
      onPointerDown:function(e){
        if(_cvLp.current)clearTimeout(_cvLp.current);
        _cvLpMoved.current=false; _cvLpOrigin.current={x:e.clientX,y:e.clientY};
        var cx=e.clientX, cy=e.clientY;
        _cvLp.current=setTimeout(function(){
          _cvLp.current=null;
          if(!_cvLpMoved.current){ haptic(14); setCanvasMenu({x:cx,y:cy}); }
        },500);
      },
      onPointerMove:function(e){
        if(!_cvLp.current)return;
        var o=_cvLpOrigin.current;
        if(o&&(Math.abs(e.clientX-o.x)>8||Math.abs(e.clientY-o.y)>8)){
          _cvLpMoved.current=true; clearTimeout(_cvLp.current); _cvLp.current=null;
        }
      },
      onPointerUp:function(){ if(_cvLp.current){clearTimeout(_cvLp.current);_cvLp.current=null;} },
      onPointerCancel:function(){ if(_cvLp.current){clearTimeout(_cvLp.current);_cvLp.current=null;} },
      title:"Right-click or press and hold for quick actions",
      style:{
      imageRendering:previewRes<=256?"pixelated":"auto",
      width:baseDisplaySize+"px",height:baseDisplaySize+"px",
      transform:"translate("+previewPan.x+"px,"+previewPan.y+"px) scale("+previewZoom+")",transformOrigin:"center center",
      touchAction:"none",
      cursor:previewZoom>1&&!gizmoOn&&!abMode?"grab":undefined,
      // In tile mode: sharper outline so you can see where the tile boundary is
      boxShadow:seamlessPreview?"0 0 0 2px #e8900a, 0 0 40px rgba(232,144,10,0.15)":"0 0 60px rgba(232,144,10,0.07),0 0 0 1px #1e1e1e",
      position:"relative",flexShrink:0,zIndex:2
    }}),
    tile33Overlay,
    gizmoBtn,
    gizmoSVG,
    soloBanner,
    edgeBanner,
    toast?React.createElement("div",{style:{
      position:"absolute",bottom:48,left:"50%",transform:"translateX(-50%)",
      background:"rgba(20,20,22,0.92)",color:"#e8c070",padding:"6px 14px",borderRadius:6,
      zIndex:20,fontFamily:"monospace",fontSize:10,letterSpacing:0.3,pointerEvents:"none",
      border:"1px solid rgba(180,140,60,0.3)",boxShadow:"0 4px 16px rgba(0,0,0,0.5)",whiteSpace:"nowrap"
    }},toast):null,
    React.createElement(EditHistoryPanel,{isMobile:isMobile}),
    compareLayers?React.createElement(LayerCompareGrid,{
      layers:state.layers,activeIdx:curAL,
      onPick:function(i){setCurAL(i);}
    }):null,
    showVariations?React.createElement(VariationsExplorer,{
      layers:editSlot?state.slots[asi].layers:state.layers,
      onApply:applyVariation,
      onClose:function(){setShowVariations(false);}
    }):null,
    // Canvas menu backdrop (closes on outside click)
    canvasMenu?React.createElement("div",{
      onClick:function(){setCanvasMenu(null);},
      onContextMenu:function(e){e.preventDefault();setCanvasMenu(null);},
      style:{position:"fixed",inset:0,zIndex:39}
    }):null,
    // ── Layer context menu (long-press / right-click on a thumbnail) ──
    layerMenu?React.createElement("div",{
      onClick:function(){setLayerMenu(null);setLmRename(null);},
      style:{position:"fixed",inset:0,zIndex:29,background:"rgba(0,0,0,0.25)"}
    }):null,
    layerMenu?(function(){
      var mi=layerMenu.idx;
      var mlay=curLayers[mi];
      if(!mlay){setTimeout(function(){setLayerMenu(null);},0);return null;}
      var mcol=LC8[mi%8];
      function act(fn){return function(e){e.stopPropagation();fn();setLayerMenu(null);setLmRename(null);};}
      function btn(label,fn,color,disabled){
        if(label==null)return null; // skip non-applicable entries entirely
        return React.createElement("button",{
          onClick:disabled?function(e){e.stopPropagation();}:act(fn),
          style:{display:"block",width:"100%",textAlign:"left",padding:"10px 14px",
            background:"none",border:"none",borderBottom:"1px solid #1a1a1a",
            color:disabled?"#333":(color||"#aaa"),fontFamily:"monospace",fontSize:11,
            cursor:disabled?"default":"pointer",letterSpacing:0.5}
        },label);
      }
      var menuTop=Math.max(50,Math.min(layerMenu.y-90,(typeof window!=="undefined"?window.innerHeight:600)-330));
      return React.createElement("div",{
        onClick:function(e){e.stopPropagation();},
        style:{position:"fixed",left:58,top:menuTop,zIndex:30,width:190,
          background:"#0d0d0d",border:"1px solid #262626",borderLeft:"3px solid "+mcol,
          borderRadius:6,boxShadow:"0 8px 32px rgba(0,0,0,0.7)",overflow:"hidden"}
      },
        React.createElement("div",{style:{padding:"8px 14px",fontSize:9,color:mcol,
          fontFamily:"monospace",fontWeight:700,letterSpacing:1,borderBottom:"1px solid #1e1e1e",
          textTransform:"uppercase"}},
          (mlay.label||"L"+(mi+1))+" · "+mlay.type),
        lmRename!=null?React.createElement("div",{style:{padding:"8px 10px",display:"flex",gap:6,borderBottom:"1px solid #1a1a1a"}},
          React.createElement("input",{type:"text",value:lmRename,autoFocus:true,
            onChange:function(e){setLmRename(e.target.value);},
            onKeyDown:function(e){
              if(e.key==="Enter"){updL(mi,"label",lmRename);setLayerMenu(null);setLmRename(null);}
              if(e.key==="Escape")setLmRename(null);
            },
            style:{flex:1,minWidth:0,background:"#161616",border:"1px solid "+mcol,color:"#ddd",
              padding:"5px 8px",fontFamily:"monospace",fontSize:11,borderRadius:3,outline:"none"}}),
          React.createElement("button",{
            onClick:function(e){e.stopPropagation();updL(mi,"label",lmRename);setLayerMenu(null);setLmRename(null);},
            style:{padding:"5px 10px",background:mcol,border:"none",color:"#000",
              fontFamily:"monospace",fontSize:10,fontWeight:700,cursor:"pointer",borderRadius:3}},"OK")
        ):React.createElement("button",{
          onClick:function(e){e.stopPropagation();setLmRename(mlay.label||"L"+(mi+1));},
          style:{display:"block",width:"100%",textAlign:"left",padding:"10px 14px",
            background:"none",border:"none",borderBottom:"1px solid #1a1a1a",
            color:"#aaa",fontFamily:"monospace",fontSize:11,cursor:"pointer",letterSpacing:0.5}
        },"Rename…"),
        btn("Duplicate",function(){setCurAL(mi);setTimeout(duplicateLayer,0);},null,curLayers.length>=8),
        btn(mlay.enabled?"Hide":"Show",function(){updL(mi,"enabled",!mlay.enabled);}),
        btn(soloLayerIdx===mi?"Unsolo":"Solo",function(){setSoloLayerIdx(soloLayerIdx===mi?-1:mi);},"#ffdd44"),
        React.createElement("div",{style:{height:4,background:"#070707"}}),
        btn("Copy Layer",function(){setCurAL(mi);setTimeout(copyCurrentLayer,0);}),
        btn("Paste Over",function(){setCurAL(mi);setTimeout(pasteCurrentLayer,0);},null,!copiedLayer.current),
        btn("New Seed",function(){updL(mi,"seed",Math.random()*99999|0);},"#7fd4ff"),
        btn("Reset Layer",function(){setCurAL(mi);setTimeout(resetLayerToDefaults,0);},"#cc9966"),
        React.createElement("div",{style:{height:4,background:"#070707"}}),
        btn("Invert Colors",function(){updL(mi,"invert",!mlay.invert);}),
        btn(mlay.refUid!=null?"Detach Reference":null,function(){updL(mi,"refUid",null);},"#cc88ff",mlay.refUid==null),
        React.createElement("div",{style:{height:4,background:"#070707"}}),
        btn("Move Up",function(){setCurAL(mi);setTimeout(moveLayerUp,0);},null,mi===0),
        btn("Move Down",function(){setCurAL(mi);setTimeout(moveLayerDown,0);},null,mi===curLayers.length-1),
        btn("Delete",function(){setCurAL(mi);setTimeout(removeLayer,0);},"#ff6666",curLayers.length<=1)
      );
    })():null,
    // Canvas right-click menu: quick global actions
    canvasMenu?React.createElement("div",{
      onClick:function(e){e.stopPropagation();},
      style:{position:"fixed",left:Math.min(canvasMenu.x,(typeof window!=="undefined"?window.innerWidth:800)-200),
        top:Math.min(canvasMenu.y,(typeof window!=="undefined"?window.innerHeight:600)-360),
        zIndex:40,width:188,background:"#0d0d0d",border:"1px solid #262626",borderLeft:"3px solid #e8900a",
        borderRadius:6,boxShadow:"0 8px 32px rgba(0,0,0,0.7)",overflow:"hidden"}
    },(function(){
      function cact(fn){return function(e){e.stopPropagation();fn();setCanvasMenu(null);};}
      function cbtn(label,fn,color){return React.createElement("button",{onClick:cact(fn),
        style:{display:"block",width:"100%",textAlign:"left",padding:"9px 14px",background:"none",border:"none",
          borderBottom:"1px solid #1a1a1a",color:color||"#aaa",fontFamily:"monospace",fontSize:11,cursor:"pointer",letterSpacing:0.4}},label);}
      function csep(){return React.createElement("div",{style:{height:4,background:"#070707"}});}
      return [
        React.createElement("div",{key:"h",style:{padding:"8px 14px",fontSize:9,color:"#e8900a",fontFamily:"monospace",fontWeight:700,letterSpacing:1,borderBottom:"1px solid #1e1e1e",textTransform:"uppercase"}},"Canvas"),
        cbtn("Add Layer",function(){addLayer();},"#7fd4ff"),
        cbtn("Randomize Seeds",function(){randomizeAllSeeds();},"#7fd4ff"),
        csep(),
        cbtn(gizmoOn?"Hide Gizmo":"Transform Gizmo",function(){setGizmoOn(function(v){return!v;});}),
        cbtn(seamlessPreview?"Exit Tile Preview":"Tile Preview",function(){setSeamlessPreview(function(v){return!v;});}),
        cbtn(tileCheck33?"Exit 3×3 Check":"3×3 Tiling Check",function(){setTileCheck33(function(v){return!v;});}),
        cbtn(compareLayers?"Hide Layer Compare":"Compare Layers",function(){setCompareLayers(function(v){return!v;});}),
        cbtn(showVariations?"Hide Variations":"Variations Explorer",function(){setShowVariations(function(v){return!v;});}),
        csep(),
        cbtn("Export PNG",function(){setPanel("export");},"#a0e060"),
        cbtn("Close",function(){},"#666")
      ];
    })()):null,
    // A/B comparison overlay — snapshot on left half, live on right
    abMode&&abCanvasRef.current?React.createElement("div",{
      style:{position:"absolute",inset:0,zIndex:5,display:"flex",alignItems:"center",justifyContent:"center",pointerEvents:"none"}
    },
      // Snapshot canvas clipped to left portion
      React.createElement("div",{style:{
        position:"absolute",
        width:baseDisplaySize+"px",height:baseDisplaySize+"px",
        overflow:"hidden",
        clipPath:"inset(0 "+(100-abSplit*100)+"% 0 0)"
      }},
        React.createElement("canvas",{
          ref:function(el){
            if(!el||!abCanvasRef.current)return;
            el.width=el.height=baseDisplaySize;
            el.getContext("2d").drawImage(abCanvasRef.current,0,0,baseDisplaySize,baseDisplaySize);
          },
          style:{width:baseDisplaySize+"px",height:baseDisplaySize+"px",imageRendering:previewRes<=256?"pixelated":"auto"}
        })
      ),
      // A label
      React.createElement("div",{style:{position:"absolute",left:"calc(50% - "+((0.5-abSplit*0.5)*baseDisplaySize+baseDisplaySize*0.25)+"px)",top:8,background:"rgba(0,0,0,0.75)",color:"#fff",fontFamily:"monospace",fontSize:9,fontWeight:700,padding:"2px 6px",borderRadius:3,pointerEvents:"none"}},"A"),
      // B label
      React.createElement("div",{style:{position:"absolute",right:"calc(50% - "+((0.5-abSplit*0.5)*baseDisplaySize+baseDisplaySize*0.25)+"px)",top:8,background:"rgba(0,0,0,0.75)",color:"#4ab4ff",fontFamily:"monospace",fontSize:9,fontWeight:700,padding:"2px 6px",borderRadius:3,pointerEvents:"none"}},"B"),
      // Divider line
      React.createElement("div",{style:{position:"absolute",top:0,bottom:0,
        left:"calc(50% + "+((abSplit-0.5)*baseDisplaySize)+"px)",
        width:2,background:"rgba(255,255,255,0.8)"}})
    ):null,
    // AB drag handle (interactive)
    abMode?React.createElement("div",{
      style:{position:"absolute",top:0,bottom:0,
        left:"calc(50% + "+((abSplit-0.5)*baseDisplaySize)+"px)",
        width:24,cursor:"ew-resize",zIndex:7,transform:"translateX(-50%)",
        pointerEvents:"all"},
      onPointerDown:function(e){abDragging.current=true;e.currentTarget.setPointerCapture(e.pointerId);},
      onPointerMove:function(e){
        if(!abDragging.current)return;
        var rect=e.currentTarget.parentElement.getBoundingClientRect();
        var canvasLeft=(rect.width-baseDisplaySize*previewZoom)/2+previewPan.x;
        var rel=(e.clientX-rect.left-canvasLeft)/(baseDisplaySize*previewZoom);
        setAbSplit(Math.max(0.02,Math.min(0.98,rel)));
      },
      onPointerUp:function(){abDragging.current=false;}
    }):null,
    zoomBar
    ]:[]) // end layer-mode group
  );

  var panelPad=panelWidth>400?"14px 14px 80px":"10px 10px 80px";
  var kbHint=!isMobile?React.createElement("div",{style:{
    padding:"8px 12px",fontSize:8,color:"#2a2a2a",fontFamily:"monospace",
    borderTop:"1px solid #161616",flexShrink:0,lineHeight:1.8,letterSpacing:0.5
  }},
    "1-6: switch tab  ·  [ / ]: prev/next  ·  S: split"
  ):null;
  var panelScroll=React.createElement("div",{style:{flex:1,overflowY:"auto",padding:panelPad,WebkitOverflowScrolling:"touch",minWidth:0}},panelContent);

  // Reset panel dimension when switching orientation
  useEffect(function(){
    var isV=panelSide==="top"||panelSide==="bottom";
    setPanelWidth(function(w){return isV?Math.min(Math.max(w,180),300):Math.min(Math.max(w,220),520);});
  },[panelSide]);

  // Split-panel internal drag resize
  useEffect(function(){
    function onSplitMove(e){
      if(!isDraggingSplit.current)return;
      var panelEl=document.getElementById("texgen-panelbox");
      if(!panelEl)return;
      var rect=panelEl.getBoundingClientRect();
      var rel=(e.clientX-rect.left)/rect.width;
      setSplitRatio(Math.max(0.2,Math.min(0.8,rel)));
    }
    function onSplitUp(){isDraggingSplit.current=false;document.body.style.cursor="";}
    window.addEventListener("mousemove",onSplitMove);
    window.addEventListener("mouseup",onSplitUp);
    return function(){window.removeEventListener("mousemove",onSplitMove);window.removeEventListener("mouseup",onSplitUp);};
  },[]);

  // Drag-resize handler (fires on mousemove when isDraggingPanel)
  useEffect(function(){
    function onMove(e){
      if(!isDraggingPanel.current)return;
      var isVert=panelSide==="top"||panelSide==="bottom";
      var delta=isVert?(panelSide==="top"?(e.clientY-dragStartX.current):(dragStartX.current-e.clientY)):(panelSide==="right"?(dragStartX.current-e.clientX):(e.clientX-dragStartX.current));
      var minSz=isVert?120:180,maxSz=isVert?600:900;
      setPanelWidth(Math.max(minSz,Math.min(maxSz,dragStartW.current+delta)));
    }
    function onUp(){isDraggingPanel.current=false;document.body.style.cursor="";}
    window.addEventListener("mousemove",onMove);
    window.addEventListener("mouseup",onUp);
    return function(){window.removeEventListener("mousemove",onMove);window.removeEventListener("mouseup",onUp);};
  },[panelSide]);

  var isVertPanel=panelSide==="top"||panelSide==="bottom";
  var dragHandle=React.createElement("div",{
    onMouseDown:function(e){
      isDraggingPanel.current=true;
      dragStartX.current=isVertPanel?e.clientY:e.clientX;
      dragStartW.current=panelWidth;
      document.body.style.cursor=isVertPanel?"ns-resize":"ew-resize";
      e.preventDefault();
    },
    style:{
      width:isVertPanel?"100%":6,
      height:isVertPanel?6:"100%",
      flexShrink:0,
      cursor:isVertPanel?"ns-resize":"ew-resize",
      background:"transparent",
      position:"relative",zIndex:10,
      borderLeft:panelSide==="right"?"2px solid #2a2a2a":"none",
      borderRight:panelSide==="left"?"2px solid #2a2a2a":"none",
      borderTop:panelSide==="bottom"?"2px solid #2a2a2a":"none",
      borderBottom:panelSide==="top"?"2px solid #2a2a2a":"none",
      // Subtle grip dots in center of handle
      backgroundImage:isVertPanel?"radial-gradient(circle,#333 1px,transparent 1px)":"radial-gradient(circle,#333 1px,transparent 1px)",
      backgroundSize:isVertPanel?"8px 8px":"8px 8px",
      backgroundRepeat:"repeat",
      backgroundPosition:"center",
    }
  });

  function mkNavBar(activeP,setActiveP,showSplit){
    var layerColor=LC8[si%8];
    // Tabs that show layer-context (their content depends on active layer)
    var layerCtxTabs={noise:true,adj:true,fx:true};

    function renderTab(n){
      var isActive=activeP===n.id;
      var totalFx=fxCount+globalFxCount;
      var count=n.id==="fx"&&totalFx>0?totalFx
              :n.id==="anim"&&(anim.tracks||[]).length>0?(anim.tracks||[]).length
              :null;
      var showLayerStripe=layerCtxTabs[n.id]&&!editSlot&&isActive;
      return React.createElement("button",{key:n.id,
        onClick:function(){setActiveP(n.id);},
        title:n.label+(count?" ("+count+")":""),
        style:{
          flex:1,minWidth:0,
          padding:isMobile?"10px 4px":"9px 4px",
          background:isActive?"#1a1a1a":"transparent",
          border:"none",borderTop:"1px solid transparent",
          color:isActive?"#e8900a":"#3a3a3a",
          cursor:"pointer",fontFamily:"monospace",
          position:"relative",
          transition:"background 0.12s,color 0.12s",
          display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:2
        },
        onMouseEnter:isActive?null:function(e){e.currentTarget.style.background="rgba(232,144,10,0.04)";e.currentTarget.style.color="#888";},
        onMouseLeave:isActive?null:function(e){e.currentTarget.style.background="transparent";e.currentTarget.style.color="#3a3a3a";}
      },
        // Layer-context stripe — colored bar at top of active tab when in layer-aware section
        showLayerStripe?React.createElement("div",{style:{
          position:"absolute",top:0,left:6,right:6,height:2,
          background:layerColor,borderRadius:"0 0 2px 2px"
        }}):null,
        // Icon
        React.createElement("span",{style:{fontSize:13,lineHeight:1,opacity:isActive?1:0.55}},n.icon),
        // Label
        React.createElement("span",{style:{
          fontSize:7.5,letterSpacing:0.8,textTransform:"uppercase",lineHeight:1,
          fontWeight:isActive?700:400,
          // Truncate gracefully on tight pannels
          maxWidth:"100%",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"
        }},n.label),
        // Count badge — small dot in corner instead of parens in label
        count?React.createElement("span",{style:{
          position:"absolute",top:4,right:4,
          minWidth:13,height:13,padding:"0 3px",
          background:isActive?"#e8900a":"#3a2a08",
          color:isActive?"#000":"#e8900a",
          fontSize:8,fontWeight:700,fontFamily:"monospace",
          borderRadius:7,
          display:"flex",alignItems:"center",justifyContent:"center",
          lineHeight:1,letterSpacing:0
        }},count):null
      );
    }

    return React.createElement("div",{style:{
      display:"flex",borderBottom:"1px solid #1c1c1c",
      flexShrink:0,alignItems:"stretch",
      background:"#0e0e0e"
    }},
      // ── Primary tabs (navigation) ──
      React.createElement("div",{style:{display:"flex",flex:1,minWidth:0}},
        NAV.map(renderTab)
      ),
      // ── Tools (modals, separated) ──
      showSplit?React.createElement("div",{style:{
        display:"flex",borderLeft:"1px solid #1c1c1c"
      }},
        // Split toggle
        React.createElement("button",{
          onClick:function(){
            setSplitMode(function(v){
              if(!v)setPanelWidth(function(w){return Math.max(w,620);});
              return!v;
            });
          },
          title:splitMode?"Exit split view (S)":"Split panel (S)",
          style:{
            padding:"0 11px",
            background:splitMode?"#1a1a1a":"transparent",
            border:"none",
            color:splitMode?"#e8900a":"#444",
            cursor:"pointer",fontSize:13,lineHeight:1,fontFamily:"monospace",
            display:"flex",alignItems:"center",justifyContent:"center",
            transition:"background 0.12s,color 0.12s"
          },
          onMouseEnter:splitMode?null:function(e){e.currentTarget.style.color="#888";},
          onMouseLeave:splitMode?null:function(e){e.currentTarget.style.color="#444";}
        },"⊞"),
        // Favorites toggle
        React.createElement("button",{
          onClick:function(){setShowFav(function(v){return!v;});},
          title:showFav?"Hide favorites":"Show favorites strip",
          style:{
            padding:"0 11px",
            background:showFav?"rgba(255,221,68,0.15)":"transparent",
            border:"none",borderLeft:"1px solid #1c1c1c",
            color:showFav?"#ffdd44":"#444",
            cursor:"pointer",fontSize:13,lineHeight:1,
            display:"flex",alignItems:"center",justifyContent:"center",
            transition:"background 0.12s,color 0.12s"
          },
          onMouseEnter:showFav?null:function(e){e.currentTarget.style.color="#888";},
          onMouseLeave:showFav?null:function(e){e.currentTarget.style.color="#444";}
        },"★")
      ):null
    );
  }

  var panelBox=React.createElement("div",{id:"texgen-panelbox",style:{
    width:isVertPanel?"100%":panelWidth,
    minWidth:isVertPanel?0:180,maxWidth:isVertPanel?"100%":900,
    background:"#0e0e0e",
    borderLeft:panelSide==="right"?"1px solid #1c1c1c":"none",
    borderRight:panelSide==="left"?"1px solid #1c1c1c":"none",
    borderTop:panelSide==="bottom"?"1px solid #1c1c1c":"none",
    borderBottom:panelSide==="top"?"1px solid #1c1c1c":"none",
    display:"flex",flexDirection:"column",overflow:"hidden",flexShrink:0
  }},
    splitMode
      // Split: two panels side by side with draggable divider
      ? React.createElement("div",{style:{display:"flex",flexDirection:"row",flex:1,overflow:"hidden",userSelect:"none"}},
          // Left split panel
          React.createElement("div",{style:{width:(splitRatio*100)+"%",minWidth:160,display:"flex",flexDirection:"column",overflow:"hidden",flexShrink:0}},
            mkNavBar(panel,setPanel,true),
            React.createElement("div",{style:{flex:1,overflowY:"auto",padding:"10px 8px 20px",WebkitOverflowScrolling:"touch",minWidth:0}},panelContent)
          ),
          // Draggable divider
          React.createElement("div",{
            onMouseDown:function(e){isDraggingSplit.current=true;document.body.style.cursor="ew-resize";e.preventDefault();},
            style:{width:6,flexShrink:0,cursor:"ew-resize",background:"transparent",
                   borderLeft:"2px solid #2a2a2a",borderRight:"2px solid #2a2a2a",
                   backgroundImage:"radial-gradient(circle,#333 1px,transparent 1px)",
                   backgroundSize:"4px 8px",backgroundRepeat:"repeat",backgroundPosition:"center"}
          }),
          // Right split panel
          React.createElement("div",{style:{flex:1,minWidth:160,display:"flex",flexDirection:"column",overflow:"hidden"}},
            mkNavBar(panel2,setPanel2),
            React.createElement("div",{style:{flex:1,overflowY:"auto",padding:"10px 8px 20px",WebkitOverflowScrolling:"touch",minWidth:0}},panelContent2)
          )
        )
      // Single panel
      : React.createElement("div",{style:{display:"flex",flexDirection:"column",flex:1,overflow:"hidden"}},
          mkNavBar(panel,setPanel,true),
          panelScroll,
          kbHint,
          // Favorites strip — slides in at bottom when ★ is toggled
          showFav?React.createElement("div",{style:{
            borderTop:"2px solid #ffdd44",
            background:"#0a0a0a",
            maxHeight:280,overflowY:"auto",
            flexShrink:0
          }},
            React.createElement("div",{style:{padding:"8px 12px"}},
              React.createElement(FavoritesPanel,{
                favorites:state.favorites||[],
                setFavs:function(nf){setS("favorites",nf);},
                layers:curLayers,updL:updL,
                addFavParam:addFavParam,setAddFavParam:setAddFavParam,
                addFavLayer:addFavLayer,setAddFavLayer:setAddFavLayer
              })
            )
          ):null
        )
  );

  if(!isMobile){
    var isTop=panelSide==="top",isBottom=panelSide==="bottom";

    // Vertical panel (top/bottom): panel gets fixed height, canvas fills rest.
    // In node mode the parameter panel is hidden so the node board gets all the
    // room (and the layer-mode controls aren't shown for a graph anyway).
    var _showPanel=appMode!=="nodes";
    var inner;
    if(isTop)    inner=React.createElement("div",{style:{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}},_showPanel?panelBox:null,_showPanel?dragHandle:null,canvasArea);
    else if(isBottom) inner=React.createElement("div",{style:{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}},canvasArea,_showPanel?dragHandle:null,_showPanel?panelBox:null);
    else         inner=React.createElement("div",{style:{flex:1,display:"flex",overflow:"hidden"}},
      (_showPanel&&panelSide==="left")?panelBox:null,
      (_showPanel&&panelSide==="left")?dragHandle:null,
      canvasArea,
      (_showPanel&&panelSide==="right")?dragHandle:null,
      (_showPanel&&panelSide==="right")?panelBox:null
    );

    return React.createElement("div",{style:{
      display:"flex",flexDirection:"column",height:"100vh",
      background:"#0b0b0b",color:"#bbb",fontFamily:"monospace",overflow:"hidden",
      zoom:uiScale  // scales all px values proportionally
    }},topBar,inner);
  }
  // Mobile: panel above canvas when panelSide="top", else below
  var mobilePanel=React.createElement("div",{style:{flex:1,overflowY:"auto",WebkitOverflowScrolling:"touch"}},
    mkNavBar(panel,setPanel),
    React.createElement("div",{style:{padding:"12px 12px 40px"}},panelContent)
  );
  // ── Draggable divider between canvas and panel (mobile) ──
  // Lets the user choose how much screen goes to preview vs controls.
  var mobileDivider=React.createElement("div",{
    onTouchStart:function(e){
      var d=dividerRef.current;
      d.active=true;d.y0=e.touches[0].clientY;
      d.h0=canvasAreaRef.current?canvasAreaRef.current.offsetHeight:Math.round(window.innerWidth*0.55);
    },
    onTouchMove:function(e){
      var d=dividerRef.current;
      if(!d.active)return;
      var dy=e.touches[0].clientY-d.y0;
      // Panel above canvas: dragging down shrinks the canvas; default: grows it
      var nh=panelSide==="top"?d.h0-dy:d.h0+dy;
      var maxH=window.innerHeight-220;
      nh=nh<140?140:nh>maxH?maxH:nh;
      if(!d.raf){
        d.raf=true;d.pend=nh;
        requestAnimationFrame(function(){d.raf=false;setMobileCanvasH(d.pend);});
      } else d.pend=nh;
    },
    onTouchEnd:function(){dividerRef.current.active=false;haptic(8);},
    style:{
      height:18,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",
      background:"#101010",borderTop:"1px solid #1c1c1c",borderBottom:"1px solid #1c1c1c",
      touchAction:"none",cursor:"ns-resize"
    }
  },
    React.createElement("div",{style:{width:44,height:4,borderRadius:2,background:"#2e2e2e"}})
  );
  var mobileCanvasAndPanel=(appMode==="nodes")
    ?[canvasArea]   // node mode: board fills the screen; the source panel is an overlay
    :(panelSide==="top"
      ?[mobilePanel,mobileDivider,canvasArea]
      :[canvasArea,mobileDivider,mobilePanel]);
  return React.createElement(AnimTrackContext.Provider,{value:addAnimTrack},
  React.createElement("div",{className:touchMode?"tm":undefined,style:{display:"flex",flexDirection:"column",height:"100vh",background:"#0b0b0b",color:"#bbb",fontFamily:"monospace",overflow:"hidden",zoom:uiScale}},
    topBar,
    mobileCanvasAndPanel[0],
    mobileCanvasAndPanel[1],
    mobileCanvasAndPanel[2]
  ));
}