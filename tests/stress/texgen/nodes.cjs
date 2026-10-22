'use strict';
// Visual QA helper: node mode (select a node, add-node menu, batch bar, context menu)
const fs = require('node:fs'), path = require('node:path');
module.exports = async ({ev, command, delay, capture}) => {
  const W = +(process.env.W || 1920), H = +(process.env.H || 1080);
  await command('Emulation.setDeviceMetricsOverride', {width: W, height: H, deviceScaleFactor: 1, mobile: false});
  await delay(1500);
  const files = [];
  const click = txt => ev(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(txt)});if(b)b.click();return !!b})()`);
  await ev(`[...document.querySelectorAll('button')].find(b=>/NODES/i.test(b.textContent))?.click();1`); await delay(700);
  // select the source node by clicking its title (pointer events)
  const pos = await ev(`(()=>{const e=[...document.querySelectorAll('div')].find(d=>/^Source/.test((d.textContent||'').trim())&&d.children.length>=1&&d.getBoundingClientRect().width>100&&d.getBoundingClientRect().width<200&&d.getBoundingClientRect().height>100);const r=e.getBoundingClientRect();let x=r.left+r.width/2,y=r.top+14;let w=window;while(w!==w.top){const f=w.frameElement.getBoundingClientRect();x+=f.left;y+=f.top;w=w.parent}return {x,y}})()`);
  await command('Input.dispatchMouseEvent', {type: 'mousePressed', x: pos.x, y: pos.y, button: 'left', clickCount: 1});
  await command('Input.dispatchMouseEvent', {type: 'mouseReleased', x: pos.x, y: pos.y, button: 'left', clickCount: 1});
  await delay(700);
  files.push(await capture('nodes-selected-' + W));
  await click('+ADD NODE'); await delay(500);
  files.push(await capture('nodes-add-' + W));
  await click('+ADD NODE'); await delay(300);
  await click('⋯'); await delay(300); await click('All'); await delay(500);
  files.push(await capture('nodes-batch-' + W));
  return {ok: true, files, pos};
};
