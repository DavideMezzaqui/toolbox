'use strict';
// Runs R/tests/store-check.cjs (written for tests/toolbox-ui.cjs) inside the stress harness, so a copy of the
// app can be checked without the whole toolbox-ui run. STORE_CHECK=<path to store-check.cjs> (default: R's).
const path = require('node:path');
module.exports = async ({ evaluate, command, until, capture, ev }) => {
  const sc = require(process.env.STORE_CHECK || path.resolve(__dirname, '../../store-check.cjs'));
  const tree = await command('Page.getFrameTree');
  const frame = tree.frameTree.childFrames.find(f => f.frame.url.includes('/store/')).frame.id;
  const contexts = [{ id: 'STORE', auxData: { frameId: frame, isDefault: true } }];
  const ev2 = (x, c) => c === 'STORE' ? ev(x) : evaluate(x, c);
  const checks = [];
  await sc({ command, evaluate: ev2, until, contexts, checks, capture });
  return { ok: true, passed: checks.length, last: checks[checks.length - 1] };
};
