// Regression coverage using isolated copies of the engine-test projects.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const core=require('../backend/core.cjs'),api=require('../backend/api.cjs'),f=require('../backend/scene-format.cjs');
const baseline=JSON.parse(fs.readFileSync(path.join(__dirname,'test-results.json'))).fixtureRoot;
const root=fs.mkdtempSync(path.join(__dirname,'audit-'));
fs.cpSync(baseline,root,{recursive:true});
const sourceProject=path.join(root,'Source'),targetProject=path.join(root,'Target');
const sourceFile=path.join(sourceProject,'Assets/Demo.unity'),targetFile=path.join(targetProject,'Assets/Demo.unity');
const source=fs.readFileSync(sourceFile,'utf8'),target=fs.readFileSync(targetFile,'utf8');
const config={sourceProject,targetProject,sourceFile,targetFile,mapFrom:'HDRP',mapTo:'URP',options:{commonReferences:false},exclusions:[]};
const header='%YAML 1.1\n%TAG !u! tag:unity3d.com,2011:\n';
const rootType='--- !u!1660057539 &9223372036854775807\n';
const addedRoot=`--- !u!1 &9000\nGameObject:\n  m_Component:\n  - component: {fileID: 9001}\n  m_Name: NewRoot\n  m_IsActive: 1\n--- !u!4 &9001\nTransform:\n  m_GameObject: {fileID: 9000}\n  m_LocalPosition: {x: 4, y: 0, z: 0}\n  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}\n  m_LocalScale: {x: 1, y: 1, z: 1}\n  m_LocalEulerAnglesHint: {x: 0, y: 0, z: 0}\n  m_Children: []\n  m_Father: {fileID: 0}\n`;
const checks=[];
function test(name,fn){fs.writeFileSync(sourceFile,source);fs.writeFileSync(targetFile,target);try{fn();checks.push({name,passed:true});console.log('PASS '+name);}catch(e){checks.push({name,passed:false,error:e.message});console.log('FAIL '+name+': '+e.message);}}
test('new top-level object can be applied from the complete preview',()=>{
  fs.writeFileSync(sourceFile,source.replace(rootType,addedRoot+rootType).replace('  - {fileID: 10}\n','  - {fileID: 10}\n  - {fileID: 9001}\n'));
  const plan=api.run({action:'compare',config});
  api.run({action:'apply',planPath:plan.planPath,selectedPaths:plan.report.rows.map(r=>r.path)});
  assert(f.load(targetFile).byPath.has('NewRoot'));
});
test('empty scene produces a valid root list',()=>{
  fs.writeFileSync(targetFile,header+rootType+'SceneRoots:\n  m_ObjectHideFlags: 0\n  m_Roots: []\n');
  const result=core(config),scene=f.parse(result.outputBytes);
  const rootDoc=scene.docs.find(d=>d.type==='1660057539');
  assert(!f.field(rootDoc,'m_Roots').includes('[]'),'a populated root list still contains []');
  const roots=[...f.field(rootDoc,'m_Roots').matchAll(/fileID: (\d+)/g)].map(m=>m[1]);
  assert(roots.length>0);for(const id of roots)assert(scene.nodes.has(id));
});
test('older scene without SceneRoots supports additions',()=>{
  fs.writeFileSync(targetFile,target.slice(0,target.indexOf(rootType)));
  const result=core(config);assert(f.parse(result.outputBytes).byPath.has('Root/NewGroup/Text'));
});
test('text that resembles a Unity reference remains literal',()=>{
  const literal="'Example {fileID: 20}'";
  fs.writeFileSync(sourceFile,source.replace("'Cost $10: preview'",literal));
  const result=core(config,['Root/NewGroup/Text']);
  assert(result.outputBytes.toString().includes('m_Text: '+literal),'text content was rewritten as an object reference');
});
test('excluded groups and descendants remain unchanged',()=>{
  const result=core({...config,exclusions:['Root']});assert(result.outputBytes.equals(Buffer.from(target)));
});
test('target changes after comparison are rejected',()=>{
  const plan=api.run({action:'compare',config});fs.appendFileSync(targetFile,'\n');const before=fs.readFileSync(targetFile);
  assert.throws(()=>api.run({action:'apply',planPath:plan.planPath,selectedPaths:plan.report.rows.map(r=>r.path)}),/changed/);
  assert(fs.readFileSync(targetFile).equals(before));
});
test('prefab changes after comparison are rejected',()=>{
  const prefab=path.join(targetProject,'Assets/URP/Effect.prefab'),bytes=fs.readFileSync(prefab);
  const plan=api.run({action:'compare',config});fs.appendFileSync(prefab,'\n');
  try{assert.throws(()=>api.run({action:'apply',planPath:plan.planPath,selectedPaths:plan.report.rows.map(r=>r.path)}),/changed/);assert.equal(fs.readFileSync(targetFile,'utf8'),target);}finally{fs.writeFileSync(prefab,bytes);}
});
test('target CRLF line endings are preserved',()=>{
  fs.writeFileSync(targetFile,target.replaceAll('\n','\r\n'));const result=core(config);
  assert(!/(?<!\r)\n/.test(result.outputBytes.toString()));
});
test('multiline text containing reference-shaped lines stays literal',()=>{
  const literal='|\n    - {fileID: 20}\n    sample: {fileID: 99999}';
  fs.writeFileSync(sourceFile,source.replace("'Cost $10: preview'",literal));
  const result=core(config,['Root/NewGroup/Text']);assert(result.outputBytes.toString().includes('m_Text: '+literal));
});
test('apply refuses edits arriving during backup creation',()=>{
  const plan=api.run({action:'compare',config}),originalWrite=fs.writeFileSync;let injected=false;
  fs.writeFileSync=function(file,...args){const result=originalWrite.call(this,file,...args);if(String(file).endsWith('manifest.json')&&!injected){injected=true;originalWrite(targetFile,target+'\n# newer edit\n');}return result;};
  try{assert.throws(()=>api.run({action:'apply',planPath:plan.planPath,selectedPaths:plan.report.rows.map(r=>r.path)}),/changed/);assert(fs.readFileSync(targetFile,'utf8').includes('# newer edit'));}finally{fs.writeFileSync=originalWrite;}
});
test('restore refuses edits arriving during its safety backup',()=>{
  const plan=api.run({action:'compare',config}),applied=api.run({action:'apply',planPath:plan.planPath,selectedPaths:plan.report.rows.map(r=>r.path)});
  const current=fs.readFileSync(targetFile,'utf8'),originalWrite=fs.writeFileSync;let injected=false;
  fs.writeFileSync=function(file,...args){const result=originalWrite.call(this,file,...args);if(String(file).endsWith('manifest.json')&&!injected){injected=true;originalWrite(targetFile,current+'\n# newer edit\n');}return result;};
  try{assert.throws(()=>api.run({action:'restore',manifest:applied.manifest}),/changed/);assert(fs.readFileSync(targetFile,'utf8').includes('# newer edit'));}finally{fs.writeFileSync=originalWrite;}
});
test('locked Unity project blocks apply even without an editor command line',()=>{
  if(process.platform!=='win32')return;
  const cp=require('node:child_process'),lock=path.join(targetProject,'Temp/UnityLockfile');fs.mkdirSync(path.dirname(lock),{recursive:true});fs.writeFileSync(lock,'');
  const plan=api.run({action:'compare',config});
  const code=`const api=require(${JSON.stringify(require.resolve('../backend/api.cjs'))});try{api.run(${JSON.stringify({action:'apply',planPath:plan.planPath,selectedPaths:plan.report.rows.map(r=>r.path)})});process.stdout.write('UNEXPECTED_WRITE');}catch(e){process.stdout.write(e.message);}`;
  const probe=path.join(root,'lock-probe.cjs');fs.writeFileSync(probe,code);
  const quote=s=>"'"+s.replaceAll("'","''")+"'";
  const script=`$ErrorActionPreference='Stop';$handle=[IO.File]::Open(${quote(lock)},[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None);try{& ${quote(process.execPath)} ${quote(probe)}}finally{$handle.Dispose()}`;
  const ps=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
  const output=cp.execFileSync(ps,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true,timeout:30000});
  assert.match(output,/target project is open in Unity/);assert.equal(fs.readFileSync(targetFile,'utf8'),target);
});
test('leftover unlocked Unity lock file does not prevent use',()=>{
  assert.equal(api.unityRunning(targetProject),false);
});
fs.writeFileSync(path.join(__dirname,'audit-results.json'),JSON.stringify({passed:checks.filter(c=>c.passed).length,total:checks.length,checks,fixtureRoot:root},null,2));
if(checks.some(c=>!c.passed))process.exitCode=1;
