'use strict';
// Shared by t7.cjs and t7-gen-pristine.cjs: builds a recognisable project in the page
// (8 images with awkward names, a logo, odd characters in the texts, a variant, tweaked layouts).
const NAMES = ['Schermata è 日本語 – ü.png', 'q"uo\\te.png', "it's a 'test'.png", 'emoji 😀.png',
               'photo.jpg', 'hole.png', 'plain 1.png', 'plain 2.png'];
const KINDS = ['png', 'png', 'png', 'png', 'jpg', 'rgba', 'png', 'png'];
const TITLE = 'T "quoted" \\ back\nline 日本 😀   end \\u00e8 \\n \\"';
const PATH0 = 'café/' + NAMES[0], PATH1 = 'sub dir\\x "y"/q"uo\\te.png';
module.exports = async (ev) => {
  await ev(`window.mkImg = async (name, kind, hue, lm) => {
    const c = document.createElement('canvas'); c.width = 320 + hue; c.height = 180; const g = c.getContext('2d');
    g.fillStyle = 'hsl(' + hue + ',60%,40%)'; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = 'hsl(' + ((hue + 120) % 360) + ',70%,60%)'; g.fillRect(20 + hue / 5, 20, 90, 60);
    if (kind === 'rgba') g.clearRect(c.width / 2 - 40, 40, 80, 80);
    const mime = kind === 'jpg' ? 'image/jpeg' : 'image/png';
    return new File([await new Promise(r => c.toBlob(r, mime, 0.9))], name, { type: mime, lastModified: lm });
  }; 1`);
  await ev(`(async () => {
    SHOTS = []; imgShot = null;
    const names = ${JSON.stringify(NAMES)}, kinds = ${JSON.stringify(KINDS)};
    const fl = []; for (let i = 0; i < 8; i++) fl.push(await mkImg(names[i], kinds[i], 20 + i * 40, 1000 + i));
    await new Promise(r => addShots(fl, r));
    SHOTS[1].path = ${JSON.stringify(PATH1)}; SHOTS[0].path = ${JSON.stringify(PATH0)};
    state.pack.title = ${JSON.stringify(TITLE)};
    FORMATS.forEach((f, k) => { const S = state.layouts[f.id].shot; S.panels = 1 + (k % 3); S.src = [k % 8, (k + 3) % 8, (k + 5) % 8, -1, -1, -1]; });
    state.layouts.unity_cover.shot.rot = [7, 0, 0, 0, 0, 0];
    variantAdd(); state.pack.title += ' v2'; state.active = 'unity_card';
    const lg = await mkImg(${JSON.stringify('logo é.png')}, 'rgba', 200, 5);
    caricaLogoFile(lg);
    for (let t = 0; t < 100 && !logoBlob; t++) await new Promise(r => setTimeout(r, 50));
    return SHOTS.length; })()`);
  return ev('SHOTS.length');
};
module.exports.NAMES = NAMES; module.exports.TITLE = TITLE; module.exports.PATH0 = PATH0; module.exports.PATH1 = PATH1;
