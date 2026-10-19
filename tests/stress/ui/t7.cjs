module.exports=async({ev,command,delay,log})=>{
 for(const [w,h] of [[900,600],[1280,720],[2560,1440],[700,500]]){
  await command('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile:false});await delay(600);
  log(w,h,JSON.stringify(await ev(`(()=>{const d=document.documentElement,b=document.getElementById('controls'),c=cv.getBoundingClientRect(),s=(document.getElementById('stage')||cvwrap).getBoundingClientRect();
   const wide=[...b.querySelectorAll('*')].filter(e=>e.getBoundingClientRect().right>b.getBoundingClientRect().right+1&&getComputedStyle(e).position!=='fixed').slice(0,3).map(e=>e.tagName+'.'+e.className);
   return {iw:innerWidth,sw:d.scrollWidth,sh:d.scrollHeight,ih:innerHeight,ctl:[b.clientWidth,b.scrollWidth,b.getBoundingClientRect().bottom],canvas:[c.left,c.right,c.width,c.height],stage:[s.right,s.bottom],wide}})()`)));
 }
};
