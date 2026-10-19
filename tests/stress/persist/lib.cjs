// tolerant reload: returns true when autoArmed
exports.soft=(ev,delay,evaluate)=>async(ms=12000)=>{
  await evaluate('frames.store.contentWindow.location.reload()');await delay(600);
  const s=Date.now();
  while(Date.now()-s<ms){try{if(await ev('typeof addShots==="function"&&autoArmed===true'))return true;}catch(e){}await delay(200);}
  return false;
};
