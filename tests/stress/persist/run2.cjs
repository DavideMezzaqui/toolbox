'use strict';
// Stress harness for Store Graphics. Usage:
//   PORT=495xx [APP_ROOT=<copy of apps/Toolbox>] node run.cjs <module.cjs>
// The module exports async ({ev, evaluate, command, until, delay, capture, log}) => any.
// It launches the real Electron app with an isolated data dir, opens the Store
// Graphics tab and hands you `ev(expr)` that runs inside the store iframe.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process');
const real=path.resolve(__dirname,'../../..');
const root=path.resolve(process.env.APP_ROOT||real);
const port=+process.env.PORT||49500;
const data=fs.mkdtempSync(path.join(os.tmpdir(),'DAVFX stress '));
fs.writeFileSync(path.join(data,'scene-sync.json'),JSON.stringify({last:{},profiles:[]}));
const exe=path.join(real,'node_modules/electron/dist/electron.exe');
const proc=cp.spawn(exe,[root,'--remote-debugging-port='+port],{cwd:root,windowsHide:true,stdio:'ignore',env:{...process.env,DAVFX_TOOLBOX_QA:'1',DAVFX_TOOLBOX_QA_DATA:data}});
const delay=ms=>new Promise(r=>setTimeout(r,ms));let ws,seq=0;const pending=new Map(),contexts=[];
function command(method,params={}){return new Promise((resolve,reject)=>{const id=++seq;const t=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method));},120000);pending.set(id,{resolve:v=>{clearTimeout(t);resolve(v);},reject:e=>{clearTimeout(t);reject(e);}});ws.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression,contextId){const r=await command('Runtime.evaluate',{expression,contextId,returnByValue:true,awaitPromise:true,userGesture:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;}
async function until(fn,label,ms=60000){const s=Date.now();while(Date.now()-s<ms){try{if(await fn())return;}catch{}await delay(100);}throw Error('Timed out: '+label);}
const outDir=path.join(path.dirname(path.resolve(process.argv[2])),'shots');setTimeout(()=>{console.log("HARD TIMEOUT");process.exit(2)},+process.env.HARD||600000);
async function capture(name){fs.mkdirSync(outDir,{recursive:true});const r=await command('Page.captureScreenshot',{format:'png'});const f=path.join(outDir,name+'.png');fs.writeFileSync(f,Buffer.from(r.data,'base64'));return f;}
(async()=>{try{
  let target;await until(async()=>{const l=await(await fetch('http://127.0.0.1:'+port+'/json')).json();target=l.find(t=>t.type==='page');return !!target;},'electron');
  ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.executionContextCreated')contexts.push(m.params.context);if(m.method==='Runtime.executionContextDestroyed'){const i=contexts.findIndex(c=>c.id===m.params.executionContextId);if(i>=0)contexts.splice(i,1);}if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(p)m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}};
  await command('Runtime.enable');await command('Page.enable');
  await command('Emulation.setDeviceMetricsOverride',{width:1700,height:1000,deviceScaleFactor:1,mobile:false});
  await until(()=>evaluate('typeof show==="function"'),'shell');
  await evaluate('show("store")');
  await until(()=>evaluate('frames["store"]?.contentDocument?.readyState==="complete" && typeof frames["store"].contentWindow.addShots==="function"'),'store');
  const ctxOf=async()=>{const tree=await command('Page.getFrameTree');const fr=tree.frameTree.childFrames.find(f=>f.frame.url.includes('/store/')).frame.id;return contexts.find(c=>c.auxData?.frameId===fr&&c.auxData?.isDefault).id;};
  let ctx=await ctxOf();
  const ev=async x=>{try{return await evaluate(x,ctx);}catch(e){if(/context|Cannot find/.test(e.message)){ctx=await ctxOf();return evaluate(x,ctx);}throw e;}};
  await ev('window.qaErrors=[];addEventListener("error",e=>qaErrors.push(e.message));addEventListener("unhandledrejection",e=>qaErrors.push(String(e.reason&&e.reason.stack||e.reason)));1');
  await until(()=>ev('autoArmed===true'),'store started');
  const reload=async(ms=15000)=>{ctx=null;await evaluate('frames.store.contentWindow.location.reload()');await delay(600);const t0=Date.now();while(Date.now()-t0<ms){try{ctx=await ctxOf();if(await evaluate('typeof addShots==="function" && autoArmed===true',ctx)){await evaluate('window.qaErrors=[];addEventListener("error",e=>qaErrors.push(e.message));addEventListener("unhandledrejection",e=>qaErrors.push(String(e.reason&&e.reason.stack||e.reason)));1',ctx);return true;}}catch(e){}await delay(250);}return false;};
  const mod=require(path.resolve(process.argv[2]));
  const res=await mod({ev,evaluate,command,until,delay,capture,reload,log:(...a)=>console.log(...a)});
  console.log('RESULT',JSON.stringify(res,null,1));
  console.log('PAGE ERRORS',JSON.stringify(await ev('qaErrors')));
}finally{if(ws){try{await command('Browser.close');}catch{}ws.close();}await delay(300);if(proc.exitCode===null)proc.kill();try{fs.rmSync(data,{recursive:true,force:true});}catch{}}})().catch(e=>{console.error('HARNESS ERROR',e);process.exitCode=1;});
