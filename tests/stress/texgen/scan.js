/* In-page scan used by the sweep scripts: visible text smaller than 11 px, under 4.5:1 contrast, or clipped. */
window.__scan = function () {
  const parse = c => { const m = /rgba?\(([^)]+)\)/.exec(c); if (!m) return null; const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return {r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1}; };
  const over = (f, b) => ({r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1});
  const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const L = c => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  const bgOf = el => { const chain = []; for (let n = el; n; n = n.parentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (c && c.a > 0) { chain.push(c); if (c.a >= 1) break; } }
    let acc = {r: 16, g: 16, b: 18, a: 1}; for (let i = chain.length - 1; i >= 0; i--) acc = over(chain[i], acc); return acc; };
  const res = {small: [], low: [], clipped: []};
  const w = document.createTreeWalker(document.getElementById('root'), NodeFilter.SHOW_TEXT); let t; const seen = new Set();
  while ((t = w.nextNode())) {
    if (!t.textContent.trim()) continue; const el = t.parentElement; if (!el || seen.has(el)) continue; seen.add(el);
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
    const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    const fs = parseFloat(cs.fontSize); const lab = (el.textContent || '').trim().slice(0, 28);
    if (fs < 11) res.small.push(fs + 'px ' + lab);
    const own = /hidden|clip/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0;
    const pa = el.parentElement, ps = pa && getComputedStyle(pa), pr = pa && pa.getBoundingClientRect();
    const byParent = pa && /hidden|clip/.test(ps.overflowX) && pr.width > 0 && (r.right > pr.right + 1 || r.left < pr.left - 1);
    if (own || byParent) res.clipped.push(lab + (own ? ' (own ' + el.scrollWidth + '>' + el.clientWidth + ')' : ' (parent box)'));
    let dis = false, op = 1; for (let n = el; n; n = n.parentElement) { if (n.disabled) dis = true; const o = parseFloat(getComputedStyle(n).opacity); if (o < 1) op *= o; }
    if (dis || op < 0.99) continue;
    const fg = parse(cs.color); if (!fg) continue; const bg = bgOf(el); const f = over(fg, bg);
    const l1 = L(f), l2 = L(bg); const cr = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    if (cr < 4.5) res.low.push(cr.toFixed(2) + ' ' + lab);
  }
  return res;
};
