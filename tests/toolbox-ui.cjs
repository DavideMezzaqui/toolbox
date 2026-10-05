'use strict';
// Real Electron/Chromium QA via CDP, with isolated preferences and disposable
// projects only. No browser automation dependency or production test IPC.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),data=fs.mkdtempSync(path.join(os.tmpdir(),'DAVFX Toolbox UI ')),port=49387;
const out=path.join(__dirname,'screenshots');fs.mkdirSync(out,{recursive:true});
const sceneReport=JSON.parse(fs.readFileSync(path.join(root,'scene-sync/tests/ui-test-report.json'),'utf8'));
const state={last:{sourceProject:'',targetProject:'',sourceFile:'',targetFile:'',options:{}},profiles:[]};
fs.writeFileSync(path.join(data,'scene-sync.json'),JSON.stringify(state));
const executable=process.env.DAVFX_QA_PACKAGED||path.join(root,'node_modules/electron/dist/electron.exe');
const args=process.env.DAVFX_QA_PACKAGED?['--remote-debugging-port='+port]:[root,'--remote-debugging-port='+port];
const proc=cp.spawn(executable,args,{cwd:root,windowsHide:true,stdio:'ignore',env:{...process.env,DAVFX_TOOLBOX_QA:'1',DAVFX_TOOLBOX_QA_DATA:data}});
const delay=ms=>new Promise(r=>setTimeout(r,ms));let ws,seq=0;const pending=new Map(),contexts=[];const checks=[];
function command(method,params={}){return new Promise((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method));},45000);pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});ws.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression,contextId){const r=await command('Runtime.evaluate',{expression,contextId,returnByValue:true,awaitPromise:true,userGesture:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;}
async function until(fn,label){const start=Date.now();while(Date.now()-start<60000){try{if(await fn())return;}catch{}await delay(100);}throw Error('Timed out: '+label);}
async function capture(name){const r=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(out,name+'.png'),Buffer.from(r.data,'base64'));}
(async()=>{try{
  let target;await until(async()=>{const list=await(await fetch('http://127.0.0.1:'+port+'/json')).json();target=list.find(t=>t.type==='page');return !!target;},'Electron debugging');
  ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.executionContextCreated')contexts.push(m.params.context);if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(p)m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}};
  ws.onclose=()=>{for(const p of pending.values())p.reject(Error('CDP connection closed'));pending.clear();};
  await command('Runtime.enable');await command('Page.enable');
  await until(()=>evaluate('typeof show === "function"'),'Toolbox shell');assert.equal(await evaluate('TOOLS.length'),9);checks.push('Nine Toolbox tabs, including Scene Sync and Clip Joiner');
  await evaluate('show("scene-sync")');await until(()=>evaluate('!!frames["scene-sync"]?.contentDocument?.body?.dataset.ready'),'Scene Sync ready');
  const tree=await command('Page.getFrameTree'),frame=tree.frameTree.childFrames.find(f=>f.frame.url.includes('/scene-sync/')).frame.id;
  const context=contexts.find(c=>c.auxData?.frameId===frame&&c.auxData?.isDefault).id;
  await evaluate('window.qaErrors=[];window.addEventListener("error",e=>qaErrors.push(e.message));window.addEventListener("unhandledrejection",e=>qaErrors.push(String(e.reason)))',context);
  assert.equal(await evaluate('!!bridge',context),true);checks.push('Embedded iframe receives the sandboxed desktop bridge');
  await command('Emulation.setDeviceMetricsOverride',{width:1000,height:760,deviceScaleFactor:1,mobile:false});await delay(200);assert(await evaluate('document.documentElement.scrollWidth<=innerWidth',context));await capture('toolbox-scenes-small');checks.push('Responsive scene view at 1000 pixels');
  await evaluate(`scene={plan:'test',report:${JSON.stringify(sceneReport)},index:0,selected:new Set()};renderScene()`,context);
  await evaluate('$("selectVisible").click()',context);assert(await evaluate('scene.selected.size>0 && !$("applyScene").disabled',context));await evaluate('$("clearVisible").click()',context);assert(await evaluate('$("applyScene").disabled',context));checks.push('Scene row selection controls Apply');
  await command('Emulation.setDeviceMetricsOverride',{width:1700,height:1000,deviceScaleFactor:1,mobile:false});await delay(100);await capture('toolbox-scenes');
  await evaluate('$("sceneSearch").value="persistent-filter"',context);await evaluate('show("textures");show("scene-sync")');assert.equal(await evaluate('$("sceneSearch").value',context),'persistent-filter');checks.push('Tab switches preserve the tool document and state');
  for(const id of ['flipbook','video','textures','frames','annotate','texgen','store','clips']){await evaluate('show('+JSON.stringify(id)+')');await until(()=>evaluate('frames['+JSON.stringify(id)+'].contentDocument?.readyState==="complete"'),id);}
  checks.push('All eight other tool pages load, Clip Joiner included');await evaluate('show("scene-sync")');
  const run=await evaluate('call("run",{action:"open-projects"})',context);assert(Array.isArray(run.projects));checks.push('Actual bundled engine detects open Unity projects through IPC');
  if(run.projects.length){
    await evaluate('openProjects("source")',context);
    assert(await evaluate('$("dialog").open && !!document.querySelector(".choices button")',context));
    await evaluate('document.querySelector(".choices button").click()',context);await until(()=>evaluate('!busy',context),'open project selection');
    assert.equal(await evaluate('state.last.sourceProject',context),run.projects[0].path);assert(await evaluate('!$("dialog").open && sceneLists.source.length>0',context));
    checks.push('Detected project selection loads its scenes without a disposed-window error (read-only)');
  }
  // Drive real buttons against copies of the engine fixtures; never user assets.
  const sceneFixture=JSON.parse(fs.readFileSync(path.join(root,'scene-sync/tests/test-results.json'),'utf8')).fixtureRoot;
  const sceneRoot=path.join(data,'Scene projects');
  for(const side of ['Source','Target'])fs.cpSync(path.join(sceneFixture,side),path.join(sceneRoot,side),{recursive:true});
  const config={sourceProject:path.join(sceneRoot,'Source'),targetProject:path.join(sceneRoot,'Target'),sourceFile:path.join(sceneRoot,'Source/Assets/Demo.unity'),targetFile:path.join(sceneRoot,'Target/Assets/Demo.unity'),mapFrom:'HDRP',mapTo:'URP',exclusions:[],options:{transforms:true,ui:true,addMissing:true,active:true,hierarchy:true,cameras:true,commonReferences:false}};
  const originalScene=fs.readFileSync(config.targetFile),originalSource=fs.readFileSync(config.sourceFile);
  await evaluate(`state.last={...state.last,...${JSON.stringify(config)}};$('sceneSearch').value='';syncInputs();$('compare').click()`,context);
  await until(()=>evaluate('!busy',context),'real scene comparison');assert(await evaluate('scene.plan && scene.selected.size>0',context),await evaluate('$("sceneStatus").textContent',context));
  await capture('toolbox-scenes');
  await evaluate('$("applyScene").click()',context);await until(()=>evaluate('!busy',context),'real scene apply');
  assert(!fs.readFileSync(config.targetFile).equals(originalScene));assert(fs.readFileSync(config.sourceFile).equals(originalSource));
  assert(await evaluate('$("applyScene").disabled && !!state.lastBackup',context));
  assert((await evaluate('call("run",{action:"restore",manifest:state.lastBackup})',context)).restored);
  assert(fs.readFileSync(config.targetFile).equals(originalScene));checks.push('Real scene Compare / Apply buttons, target remapping, backup and byte-exact restore');
  await require('./clips-check.cjs')({command,evaluate,until,contexts,checks,capture});
  await require('./store-check.cjs')({command,evaluate,until,contexts,checks,capture});
  await evaluate('show("scene-sync")');
  const workflow=process.env.DAVFX_QA_WORKFLOW==='1'||process.argv.includes('--workflow');
  if(workflow)await require('./user-workflow.cjs')({evaluate,until,context,data,root,checks});
  assert.deepEqual(await evaluate('qaErrors',context),[]);
  fs.writeFileSync(path.join(__dirname,(workflow?'workflow-':'')+(process.env.DAVFX_QA_PACKAGED?'packaged-ui-results.json':'ui-results.json')),JSON.stringify({passed:checks.length,checks,data},null,2));console.log(checks.map(x=>'PASS '+x).join('\n'));
}finally{if(ws){try{await command('Browser.close');}catch{}ws.close();}await delay(300);if(proc.exitCode===null)proc.kill();}})().catch(e=>{console.error(e);process.exitCode=1;});
