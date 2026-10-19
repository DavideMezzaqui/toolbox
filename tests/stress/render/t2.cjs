const {setup}=require('./common.cjs');
module.exports=async({ev})=>{
  await setup(ev);
  return ev(`(()=>{
    const leaves=[];const walk=(o,p)=>{ if(o&&typeof o==='object'){ for(const k of Object.keys(o)) walk(o[k],p.concat(k)); } else leaves.push(p.join('.')+':'+typeof o); };
    walk(state.layouts.unity_cover,[]);
    return {n:leaves.length, leaves:leaves.join(' | '), pack:JSON.stringify(state.pack), exp:JSON.stringify(state.export), naming:JSON.stringify(state.naming), theme:JSON.stringify(state.theme), layers: JSON.stringify(state.layouts.unity_cover.layers)};})()`);
};
