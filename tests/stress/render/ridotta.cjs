'use strict';
// imgRidotta is a pure, size-limited cache: the same request gives the same
// pixels whatever was asked before (cold, reversed order, after eviction), a
// repeated request returns the same canvas, and memory stays under the cap.
//   node tests/stress/run.cjs tests/stress/render/ridotta.cjs
module.exports = async ({ev}) => {
  return ev(`(async()=>{
    const out = {ok: true, fails: []};
    const bad = m => { out.ok = false; out.fails.push(m); };
    const mk = (seed) => { const c = document.createElement('canvas'); c.width = 3840; c.height = 2160; const g = c.getContext('2d');
      let s = seed; const r = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
      g.fillStyle = 'hsl(' + seed * 40 + ',50%,40%)'; g.fillRect(0, 0, 3840, 2160);
      g.strokeStyle = '#fff'; g.lineWidth = 1;
      for (let i = 0; i < 1500; i++) { g.beginPath(); g.moveTo(r() * 3840, r() * 2160); g.lineTo(r() * 3840, r() * 2160); g.stroke(); }
      return c; };
    const imgs = [mk(1), mk(2), mk(3), mk(4), mk(5), mk(6)];
    const hash = async c => { const g = c.getContext('2d'), d = g.getImageData(0, 0, c.width, c.height).data;
      const b = new Uint8Array(await crypto.subtle.digest('SHA-256', d)); return c.width + 'x' + c.height + ':' + [...b.slice(0, 6)].map(x => x.toString(16).padStart(2, '0')).join(''); };
    const sizes = [[500.2, 281.4], [500.4, 281.1], [500.49, 281.49], [333.7, 187.7], [420, 236.25], [171, 96.2], [128, 72], [900.6, 506.2], [1500, 843.75], [64.5, 36.3]];
    if (typeof svuotaRidotte !== 'function' || typeof _ridLista === 'undefined') { bad('svuotaRidotte/_ridLista missing'); return out; }
    const pass = async (order) => { const h = {}; for (const i of order) { const [w, hh] = sizes[i]; const r = imgRidotta(imgs[0], w, hh); h[i] = r === imgs[0] ? 'same' : await hash(r); } return h; };
    const idx = sizes.map((_, i) => i);
    svuotaRidotte();
    const H1 = await pass(idx);
    svuotaRidotte();
    const H2 = await pass(idx.slice().reverse());
    const H3 = await pass(idx);                       // warm
    idx.forEach(i => { if (H1[i] !== H2[i]) bad('order changes pixels, size ' + sizes[i]); if (H1[i] !== H3[i]) bad('warm differs from cold, size ' + sizes[i]); });
    out.passthrough = idx.filter(i => H1[i] === 'same').map(i => sizes[i].join('x'));
    // a repeated request returns the very same canvas
    svuotaRidotte();
    const a = imgRidotta(imgs[1], 500.2, 281.4), b = imgRidotta(imgs[1], 500.2, 281.4);
    if (a !== b) bad('repeat request built a new canvas');
    // same request with another unrounded size must not hand back a copy made for the first one when the steps differ
    const c1 = imgRidotta(imgs[1], 100.4, 56.4), c2 = imgRidotta(imgs[1], 100.6, 56.6);
    out.roundedKeyDiffers = c1 !== c2;
    // hammer: many images x many sizes, memory and per-image limits
    svuotaRidotte();
    const hold = [];
    for (let k = 0; k < 60; k++) { const im = imgs[k % 6], w = 300 + k * 37.3, h = w * 0.5625; hold.push(imgRidotta(im, w, h)); }
    out.px = _ridPx; out.entries = _ridLista.length;
    if (_ridPx > 24e6 && _ridLista.length > 1) bad('over the pixel cap: ' + _ridPx);
    let sum = 0; _ridLista.forEach(v => { sum += v.px; }); if (sum !== _ridPx) bad('px bookkeeping off: ' + sum + ' vs ' + _ridPx);
    imgs.forEach(im => { const v = _ridCache.get(im); if (v && v.length > RID_PER_IMG) bad('too many sizes for one image: ' + v.length); });
    const live = new Set(_ridLista.map(v => v.canvas));
    const evicted = hold.filter(c => !imgs.includes(c) && !live.has(c));
    out.evicted = evicted.length;
    if (!evicted.length) bad('nothing evicted by 60 big requests');
    if (evicted.some(c => c.width !== 1 || c.height !== 1)) bad('evicted canvas not shrunk');
    if (_ridLista.some(v => v.canvas.width <= 1)) bad('live entry shrunk');
    // after everything, a request still gives the cold value
    svuotaRidotte();
    if (_ridPx !== 0 || _ridLista.length) bad('svuotaRidotte left entries');
    const H4 = await pass(idx);
    idx.forEach(i => { if (H1[i] !== H4[i]) bad('after eviction/clear differs, size ' + sizes[i]); });
    return out; })()`);
};
