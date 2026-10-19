module.exports=async({ev})=>{
 for(const [k,x] of Object.entries({AAAA:`{name:'z.png',type:'image/png',data:'AAAA'}`,nul:`null`,num:`{data:5}`,empty:`{name:'e',data:'',type:'image/png'}`})){
  const r=await ev(`(async()=>{const t=Date.now();const p=new Promise(r=>{const f=new File([JSON.stringify({pack:{title:'N'},images:[${x}]})],'p.json');caricaPresetFile(f);setTimeout(()=>r('timeout/ok after wait'),4000)});await p;return {ms:Date.now()-t,n:SHOTS.length,toast:document.getElementById('toast')&&document.getElementById('toast').textContent}})()`);
  console.log(k,JSON.stringify(r));
 }return 1};
