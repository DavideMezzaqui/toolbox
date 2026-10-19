module.exports=async({ev,reload})=>{
  const a=await ev(`(async()=>{const c=document.createElement('canvas');c.width=640;c.height=360;c.getContext('2d').fillRect(0,0,9,9);
   const f=new File([await new Promise(r=>c.toBlob(r,'image/png'))],'x.png',{type:'image/png'});await new Promise(r=>addShots([f],r));return SHOTS.length;})()`);
  await new Promise(r=>setTimeout(r,1500)); await reload();
  return {a, afterReload: await ev('SHOTS.length')};
};
