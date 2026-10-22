'use strict';
// Screenshots of Studio at 1920x1080 and 1280x720 (join mode with the tray open, a registered mode, the icon rail).
module.exports = async ({ ev, command, until, delay, capture }) => {
  const shots = [];
  const J = JSON.stringify;
  await until(() => ev('Studio.mode()'), 'studio');
  await ev(`(async()=>{const mk=async(n,h)=>{const c=document.createElement('canvas');c.width=320;c.height=180;const g=c.getContext('2d');g.fillStyle='hsl('+h+',50%,38%)';g.fillRect(0,0,320,180);g.fillStyle='#fff';g.font='bold 70px Arial';g.fillText(n[0],140,115);const b=await new Promise(r=>c.toBlob(r,'image/png'));return new File([b],n,{type:'image/png',lastModified:h})};
    Studio.tray([await mk('hero.png',20),await mk('smoke_sheet_8x8.png',200),await mk('albedo.png',120),new File([new Uint8Array(8)],'showcase_javelin.mp4',{type:'video/mp4',lastModified:3})]);return 1})()`);
  await delay(1200);
  for (const [w, h] of [[1920, 1080], [1280, 720]]) {
    await command('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await ev(`Studio.show('join')`); await delay(1500);
    shots.push(await capture(`studio-join-${w}`));
    await ev(`Studio.show('texgen');Studio.modes.find(m=>m.id==='texgen').frame.src='test-mode.html?embed=1'`);
    await delay(1500);
    await ev(`Studio.modes.find(m=>m.id==='texgen').win.Embed.status('3 images, 4096 x 4096, 1.2 MB')`);
    shots.push(await capture(`studio-registered-${w}`));
    await ev(`document.getElementById('app').classList.add('slim');1`);
    await delay(300);
    shots.push(await capture(`studio-slim-${w}`));
    await ev(`document.getElementById('app').classList.remove('slim');1`);
  }
  return { ok: true, shots };
};
