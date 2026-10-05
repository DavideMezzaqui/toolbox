'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
// Invoked inside the actual Electron test harness. Only temporary projects.
module.exports=async function workflow({evaluate,until,context,data,root,checks}){
  const ev=expression=>evaluate(expression,context),j=JSON.stringify;
  const click=async id=>{await ev(`$(${j(id)}).click()`);await until(()=>ev('!busy'),id);};
  const fixture=JSON.parse(fs.readFileSync(path.join(root,'scene-sync/tests/test-results.json'))).fixtureRoot;
  const workspace=path.join(data,'Workflow scenes');
  for(const side of ['Source','Target'])fs.cpSync(path.join(fixture,side),path.join(workspace,side),{recursive:true});
  const source=path.join(workspace,'Source'),target=path.join(workspace,'Target');
  const sceneFile=path.join(source,'Assets/Demo.unity'),targetScene=path.join(target,'Assets/Demo.unity');
  const sceneConfig={sourceProject:source,targetProject:target,sourceFile:sceneFile,targetFile:targetScene,mapFrom:'HDRP',mapTo:'URP',exclusions:[],options:{transforms:true,ui:true,addMissing:true,active:true,hierarchy:true,cameras:true,commonReferences:false}};

  // A later edit on the source side, the way a scene actually drifts.
  const originalSource=fs.readFileSync(sceneFile);
  fs.writeFileSync(sceneFile,originalSource.toString().replace('m_LocalPosition: {x: 12, y: 0, z: 0}','m_LocalPosition: {x: 42, y: 0, z: 0}').replace('Cost $10: preview','Updated demo text'));

  await ev(`state.last=${j(sceneConfig)};$('sceneSearch').value='';syncInputs();`);await click('compare');
  assert(await ev('!!scene.plan && scene.selected.size>0'),await ev('$("sceneStatus").textContent'));
  const beforeSync=fs.readFileSync(targetScene);
  await click('applyScene');assert.match(fs.readFileSync(targetScene,'utf8'),/Updated demo text/);assert.match(fs.readFileSync(targetScene,'utf8'),/x: 42/);
  const sceneBackup=await ev('state.lastBackup');await click('compare');assert.equal(await ev('scene.report.rows.length'),0);
  checks.push('Workflow: source position/text edits sync into the target scene and settle to no changes');

  const syncedScene=fs.readFileSync(targetScene);fs.appendFileSync(targetScene,'\n');
  const restoreError=await ev(`call('run',{action:'restore',manifest:${j(sceneBackup)}}).then(()=>'',e=>e.message)`);
  assert.match(restoreError,/changed/);assert(fs.readFileSync(targetScene).equals(Buffer.concat([syncedScene,Buffer.from('\n')])));fs.writeFileSync(targetScene,syncedScene);
  checks.push('Workflow: Restore refuses to overwrite newer target edits');

  await ev(`call('run',{action:'restore',manifest:${j(sceneBackup)}})`);assert(fs.readFileSync(targetScene).equals(beforeSync));
  checks.push('Workflow: Restore returns the target scene byte for byte');

  await click('compare');const beforeStale=fs.readFileSync(targetScene);fs.appendFileSync(sceneFile,'\n');await click('applyScene');
  assert(fs.readFileSync(targetScene).equals(beforeStale));assert(await ev('!scene.plan && $("applyScene").disabled'));assert.match(await ev('$("dialogBody").textContent'),/changed/);await ev('finishDialog(null)');
  checks.push('Workflow: source edits after Compare prevent Apply without changing the target');

  const savedSceneConfig=await ev('state.last');await ev(`change('sourceProject',${j(path.join(data,'Missing scene project'))})`);
  assert.deepEqual(await ev('state.last'),savedSceneConfig);assert(await ev('$("dialog").open && !scene.plan'));await ev('finishDialog(null)');
  checks.push('Workflow: failed scene-project selection preserves the working scene and shows the error');

  assert.equal(await ev(`join(${j('\\\\server\\share\\Assets')},'DAVFX')`),'\\\\server\\share\\Assets\\DAVFX');
  checks.push('Workflow: path suggestions preserve UNC network path prefixes');
};
