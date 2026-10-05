'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process'),assert=require('node:assert/strict');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'davfx-api-cli-'));
const project=path.join(root,'Project'),scenes=path.join(project,'Assets/Scenes');
fs.mkdirSync(scenes,{recursive:true});fs.mkdirSync(path.join(project,'ProjectSettings'));
fs.writeFileSync(path.join(project,'ProjectSettings/ProjectVersion.txt'),'m_EditorVersion: 6000.0.63f1');
const sceneFile=path.join(scenes,'Demo.unity');
fs.writeFileSync(sceneFile,'%YAML 1.1\n%TAG !u! tag:unity3d.com,2011:\n--- !u!1 &1000\nGameObject:\n  m_Name: Example\n');
let sequence=0;
function call(request){
  const file=path.join(root,'request-'+(++sequence)+'.json');fs.writeFileSync(file,JSON.stringify(request));
  // Exercise the same fresh-process entry point used by the Windows app.
  const result=cp.spawnSync(process.execPath,[path.join(__dirname,'../backend/api.cjs'),file],{encoding:'utf8',windowsHide:true,timeout:60000});
  assert(!result.error,result.error&&result.error.message);
  return {reply:JSON.parse(result.stdout),status:result.status,stderr:result.stderr};
}
const listed=call({action:'scenes',project});
assert.equal(listed.reply.ok,true,listed.reply.error);assert.equal(listed.status,0,listed.stderr);
assert(listed.reply.scenes.some(s=>path.resolve(s.path)===path.resolve(sceneFile)));
console.log('PASS command-line scene listing');
const refused=call({action:'package-preview',project});
assert.equal(refused.reply.ok,false);assert.match(refused.reply.error,/Unknown operation/);assert.notEqual(refused.status,0);
console.log('PASS command-line entry point refuses removed and unknown operations');
const missing=call({action:'scenes',project:path.join(root,'Nowhere')});
assert.equal(missing.reply.ok,false);assert(missing.reply.error);
console.log('PASS command-line failures answer with a message instead of crashing');
fs.writeFileSync(path.join(__dirname,'api-cli-test-results.json'),JSON.stringify({passed:3,fixtureRoot:root},null,2));
