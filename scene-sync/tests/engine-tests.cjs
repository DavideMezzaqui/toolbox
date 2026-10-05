const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const core=require('../backend/core.cjs'),api=require('../backend/api.cjs'),f=require('../backend/scene-format.cjs');
const root=fs.mkdtempSync(path.join(__dirname,'run-'));
const A='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',B='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',C='cccccccccccccccccccccccccccccccc';
const doc=(type,id,body,stripped=false)=>`--- !u!${type} &${id}${stripped?' stripped':''}\n${body}\n`;
function native(id,tid,name,parent,children=[],position=0,type=4,extras=[]) {
  return doc(1,id,`GameObject:\n  m_Component:\n  - component: {fileID: ${tid}}\n${extras.map(x=>'  - component: {fileID: '+x+'}\n').join('')}  m_Name: ${name}\n  m_IsActive: 1`)+doc(type,tid,`${type===224?'RectTransform':'Transform'}:\n  m_GameObject: {fileID: ${id}}\n  m_LocalPosition: {x: ${position}, y: 0, z: 0}\n  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}\n  m_LocalScale: {x: 1, y: 1, z: 1}\n  m_LocalEulerAnglesHint: {x: 0, y: 0, z: 0}\n  m_Children:${children.length?'\n'+children.map(c=>'  - {fileID: '+c+'}').join('\n'):' []'}\n  m_Father: {fileID: ${parent}}${type===224?'\n  m_AnchorMin: {x: 0, y: 0}\n  m_AnchorMax: {x: 1, y: 1}\n  m_AnchoredPosition: {x: 3, y: 4}\n  m_SizeDelta: {x: 100, y: 20}\n  m_Pivot: {x: 0.5, y: 0.5}':''}`);
}
function instance(id,tid,parent,guid,rootId,goId,position=0,name='Effect'){
  return doc(1001,id,`PrefabInstance:\n  m_ObjectHideFlags: 0\n  serializedVersion: 2\n  m_Modification:\n    serializedVersion: 3\n    m_TransformParent: {fileID: ${parent}}\n    m_Modifications:\n    - target: {fileID: ${goId}, guid: ${guid}, type: 3}\n      propertyPath: m_Name\n      value: ${name}\n      objectReference: {fileID: 0}\n    - target: {fileID: ${rootId}, guid: ${guid}, type: 3}\n      propertyPath: m_LocalPosition.x\n      value: ${position}\n      objectReference: {fileID: 0}\n    m_RemovedComponents: []\n    m_RemovedGameObjects: []\n    m_AddedGameObjects: []\n    m_AddedComponents: []\n  m_SourcePrefab: {fileID: 100100000, guid: ${guid}, type: 3}`)+doc(4,tid,`Transform:\n  m_CorrespondingSourceObject: {fileID: ${rootId}, guid: ${guid}, type: 3}\n  m_PrefabInstance: {fileID: ${id}}\n  m_PrefabAsset: {fileID: 0}`,true);
}
function write(p,s){fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,s);}
function meta(p,guid){write(p+'.meta','fileFormatVersion: 2\nguid: '+guid+'\n');}
const sourceProject=path.join(root,'Source'),targetProject=path.join(root,'Target');
for(const p of [sourceProject,targetProject]){write(path.join(p,'ProjectSettings/ProjectVersion.txt'),'m_EditorVersion: 6000.0.63f1\n');write(path.join(p,'Assets/Text.cs'),'// fixture');meta(path.join(p,'Assets/Text.cs'),C);}
const header='%YAML 1.1\n%TAG !u! tag:unity3d.com,2011:\n';
const sourcePrefab=path.join(sourceProject,'Assets/HDRP/Effect.prefab'),targetPrefab=path.join(targetProject,'Assets/URP/Effect.prefab');
write(sourcePrefab,header+native(101,111,'Effect',0));meta(sourcePrefab,A);
write(targetPrefab,header+native(202,222,'Effect',0));meta(targetPrefab,B);
const sourceFile=path.join(sourceProject,'Assets/Demo.unity'),targetFile=path.join(targetProject,'Assets/Demo.unity');
const roots=id=>doc('1660057539','9223372036854775807',`SceneRoots:\n  m_ObjectHideFlags: 0\n  m_Roots:\n  - {fileID: ${id}}`);
const sourceText=header+native(1,10,'Root',0,[20,30,51])+native(2,20,'Shared',10,[],12)+native(3,30,'NewGroup',10,[40])+native(4,40,'Text',30,[],5,224,[41])+doc(114,41,`MonoBehaviour:\n  m_GameObject: {fileID: 4}\n  m_Script: {fileID: 11500000, guid: ${C}, type: 3}\n  m_Text: 'Cost $10: preview'`)+instance(50,51,10,A,111,101,9)+roots(10);
const targetText=header+native(101,110,'Root',0,[120,151])+native(102,120,'Shared',110,[],0)+instance(150,151,110,B,222,202,0)+roots(110);
write(sourceFile,sourceText);meta(sourceFile,'dddddddddddddddddddddddddddddddd');write(targetFile,targetText);meta(targetFile,'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee');
const config={sourceProject,targetProject,sourceFile,targetFile,mapFrom:'HDRP',mapTo:'URP',exclusions:[],options:{commonReferences:false}};
const checks=[];
function test(name,fn){fn();checks.push(name);console.log('PASS '+name);}
test('full comparison: additions and existing transforms',()=>{const r=core(config);assert.equal(r.report.addedObjects.length,2);assert(r.report.updatedObjects.includes('Root/Shared'));assert(r.report.updatedObjects.includes('Root/Effect'));assert.equal(fs.readFileSync(targetFile,'utf8'),targetText);});
test('selected existing object leaves prefab and other objects untouched',()=>{const r=core(config,['Root/Shared']);const after=f.parse(r.outputBytes);assert.equal(f.value(after.byPath.get('Root/Shared')[0].doc,'m_LocalPosition'),'{x: 12, y: 0, z: 0}');assert.equal(after.byId.get('150').raw,f.load(targetFile).byId.get('150').raw);assert.equal(r.report.addedObjects.length,0);});
test('selected child includes missing parent, not unrelated changes',()=>{const r=core(config,['Root/NewGroup/Text']);const after=f.parse(r.outputBytes);assert(after.byPath.has('Root/NewGroup/Text'));assert.equal(r.report.addedObjects.length,2);assert.equal(after.byId.get('120').raw,f.load(targetFile).byId.get('120').raw);assert(r.outputBytes.toString().includes('Cost $10: preview'));});
test('empty selection is a byte-for-byte no-op',()=>assert(core(config,[]).outputBytes.equals(fs.readFileSync(targetFile))));
test('disabled categories preserve existing transforms',()=>{const r=core({...config,options:{transforms:false,ui:false,addMissing:false,active:false,hierarchy:false,cameras:false}});assert(r.outputBytes.equals(fs.readFileSync(targetFile)));});
test('new prefab uses target GUID and target internal file IDs',()=>{const saved=fs.readFileSync(targetFile);write(targetFile,header+native(101,110,'Root',0,[120])+native(102,120,'Shared',110)+roots(110));try{const r=core(config,['Root/Effect']);const after=f.parse(r.outputBytes),n=after.byPath.get('Root/Effect')[0];assert.equal(n.prefabGuid,B);assert.equal(n.sourceId,'222');assert(n.mods.some(m=>m.id==='222'&&m.property==='m_LocalPosition.x'&&m.value==='9'));}finally{fs.writeFileSync(targetFile,saved);}});
test('missing counterpart fails without changing scene',()=>{fs.renameSync(targetPrefab+'.meta',targetPrefab+'.hold');try{assert.throws(()=>core(config));assert.equal(fs.readFileSync(targetFile,'utf8'),targetText);}finally{fs.renameSync(targetPrefab+'.hold',targetPrefab+'.meta');}});
test('ambiguous hierarchy fails instead of guessing',()=>{write(sourceFile,sourceText.replace('m_Name: NewGroup','m_Name: Shared'));try{assert.throws(()=>core(config),/Ambiguous/);}finally{write(sourceFile,sourceText);}});
let plan,backup;
test('API preview creates plan without scene changes',()=>{plan=api.run({action:'compare',config});assert(fs.existsSync(plan.planPath));assert.equal(fs.readFileSync(targetFile,'utf8'),targetText);});
test('stale preview is rejected',()=>{write(sourceFile,sourceText+'\n');try{assert.throws(()=>api.run({action:'apply',planPath:plan.planPath,selectedPaths:plan.report.rows.map(r=>r.path)}),/changed/);assert.equal(fs.readFileSync(targetFile,'utf8'),targetText);}finally{write(sourceFile,sourceText);}});
test('apply, backup, target prefab mapping and idempotence',()=>{const r=api.run({action:'apply',planPath:plan.planPath,selectedPaths:plan.report.rows.map(r=>r.path)});assert(r.applied);backup=r.manifest;assert.equal(fs.readFileSync(path.join(path.dirname(backup),'original.unity'),'utf8'),targetText);assert.equal(core(config).report.rows.length,0);assert.equal(fs.readFileSync(sourceFile,'utf8'),sourceText);});
test('restore refuses to overwrite newer edits',()=>{const current=fs.readFileSync(targetFile);write(targetFile,current.toString()+'\n');try{assert.throws(()=>api.run({action:'restore',manifest:backup}),/changed/);}finally{fs.writeFileSync(targetFile,current);}});
test('restore recovers original bytes and preserves source',()=>{assert(api.run({action:'restore',manifest:backup}).restored);assert.equal(fs.readFileSync(targetFile,'utf8'),targetText);assert.equal(fs.readFileSync(sourceFile,'utf8'),sourceText);});
test('source cannot also be destination',()=>assert.throws(()=>api.run({action:'compare',config:{...config,targetProject:sourceProject,targetFile:sourceFile}}),/different/));
const report=core(config).report;fs.writeFileSync(path.join(__dirname,'ui-test-report.json'),JSON.stringify(report,null,2));
fs.writeFileSync(path.join(__dirname,'test-results.json'),JSON.stringify({passed:checks.length,checks,fixtureRoot:root},null,2));
console.log('All '+checks.length+' checks passed.');
