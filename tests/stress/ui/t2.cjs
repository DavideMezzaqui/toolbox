const fs=require('fs');
module.exports=async({ev,log})=>{const src=fs.readFileSync(__dirname+'/p2.js','utf8');const all=[];
 for(let f=0;f<8;f++)for(let t=0;t<5;t++){const t0=Date.now();
  const r=await ev(src.replace('FI_',f).replace('TI_',t));log(f,t,Date.now()-t0,'ms',JSON.stringify(r).slice(0,600));all.push(r);}
 return 'done';};
