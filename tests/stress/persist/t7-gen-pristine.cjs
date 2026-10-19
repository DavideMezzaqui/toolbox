'use strict';
// Run against the PRISTINE app (APP_ROOT=V/tpl) to write t7-pristine.json: a project file saved by the
// old one-shot code, plus t7-pristine.meta.json with the state it was saved from.
const fs = require('node:fs'), path = require('node:path');
const setup = require('./t7setup.cjs');
module.exports = async ({ ev }) => {
  await setup(ev);
  const r = await ev(`(async () => { const t = await testoProgetto(); return { t, snap: snapState(), active: state.active,
    shots: SHOTS.map(s => [s.name, s.path, s.blob.size, s.blob.type]), logo: logoBlob.size }; })()`);
  fs.writeFileSync(path.join(__dirname, 't7-pristine.json'), r.t);
  fs.writeFileSync(path.join(__dirname, 't7-pristine.meta.json'), JSON.stringify({ snap: r.snap, active: r.active, shots: r.shots, logo: r.logo }));
  return { ok: true, bytes: r.t.length, shots: r.shots.length };
};
