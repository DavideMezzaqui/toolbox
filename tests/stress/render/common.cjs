exports.setup = async (ev)=> ev(`(async()=>{
  const mk = async (name, hue) => { const c = document.createElement('canvas'); c.width = 1280; c.height = 720;
    const g = c.getContext('2d'); g.fillStyle = 'hsl(' + hue + ',60%,40%)'; g.fillRect(0, 0, 1280, 720);
    g.fillStyle = '#fff'; g.font = 'bold 200px Arial'; g.fillText(name, 500, 420);
    return new File([await new Promise(r => c.toBlob(r, 'image/png'))], name + '.png', {type:'image/png', lastModified:hue}); };
  SHOTS = []; imgShot = null;
  const fl=[await mk('A', 10), await mk('B', 140), await mk('C', 220)]; await new Promise(r => addShots(fl, r));
  FORMATS.forEach(f=>{ state.layouts[f.id].on=true; });
  return SHOTS.length; })()`);
