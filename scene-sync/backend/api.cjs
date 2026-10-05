'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),cp=require('node:child_process');
const format=require('./scene-format.cjs');
const build=require('./core.cjs');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const fileHash=p=>hash(fs.readFileSync(p));
const same=(a,b)=>path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();
function within(child,parent) { const relative=path.relative(parent,child); return relative!==''&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative); }
function project(p) {
  p=fs.realpathSync(p);
  if(!fs.existsSync(path.join(p,'Assets'))||!fs.existsSync(path.join(p,'ProjectSettings','ProjectVersion.txt'))) throw new Error('Select a Unity project root folder containing Assets and ProjectSettings.');
  return p;
}
function config(c) {
  if(!c) throw new Error('Configuration is missing.');
  c=JSON.parse(JSON.stringify(c));
  c.sourceProject=project(c.sourceProject); c.targetProject=project(c.targetProject);
  c.sourceFile=fs.realpathSync(c.sourceFile); c.targetFile=fs.realpathSync(c.targetFile);
  for(const [file,p] of [[c.sourceFile,c.sourceProject],[c.targetFile,c.targetProject]]) {
    if(!within(file,fs.realpathSync(path.join(p,'Assets')))||path.extname(file).toLowerCase()!=='.unity') throw new Error('Choose a .unity scene inside the selected project’s Assets folder.');
  }
  if(same(c.sourceFile,c.targetFile)) throw new Error('Source and target must be different scenes.');
  c.exclusions=(c.exclusions||[]).map(s=>s.trim()).filter(Boolean);
  c.mapFrom=c.mapFrom||''; c.mapTo=c.mapTo||'';
  if(/[\\/]/.test(c.mapFrom+c.mapTo)) throw new Error('Use names such as HDRP and URP in the asset rule, without folder separators.');
  return c;
}
function unityRunning(p) {
  if(process.platform!=='win32') return false;
  const script=`$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$targetProject=[IO.Path]::GetFullPath($env:DAVFX_SYNC_TARGET).TrimEnd('\\','/')
$running=$false
$lockFile=Join-Path $targetProject 'Temp/UnityLockfile'
if(Test-Path -LiteralPath $lockFile) {
  try {$probe=[IO.File]::Open($lockFile,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None);$probe.Dispose()}
  catch [IO.IOException] {$running=$true}
}
foreach($item in @(Get-CimInstance Win32_Process -Filter "name = 'Unity.exe'")) {
  if(-not $item.CommandLine){throw 'Cannot inspect a running Unity editor. Close Unity before applying.'}
  $m=[regex]::Match($item.CommandLine,'(?i)-projectpath\\s+(?:"([^"]+)"|(\\S+))')
  if($m.Success) {
    $candidate=$m.Groups[1].Value
    if(-not $candidate){$candidate=$m.Groups[2].Value}
    if([IO.Path]::GetFullPath($candidate).TrimEnd('\\','/') -ieq $targetProject){$running=$true}
  }
}
if($running){Write-Output 'RUNNING'}else{Write-Output 'CLOSED'}`;
  const exe=path.join(process.env.SystemRoot||'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
  const result=cp.execFileSync(exe,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true,env:{...process.env,DAVFX_SYNC_TARGET:p},timeout:30000}).trim();
  if(!['RUNNING','CLOSED'].includes(result)) throw new Error('Could not check whether the target project is open in Unity.');
  return result==='RUNNING';
}
function requireClosed(p) { if(unityRunning(p)) throw new Error('The target project is open in Unity. Save your work, close that project and try again. You can still compare scenes.'); }
function atomicWrite(file,bytes,beforeCommit=()=>{}) {
  const temporary=file+'.davfx-'+crypto.randomBytes(8).toString('hex')+'.tmp';
  try {
    const fd=fs.openSync(temporary,'wx');
    try { fs.writeFileSync(fd,bytes);fs.fsyncSync(fd); } finally {fs.closeSync(fd);}
    beforeCommit();
    fs.renameSync(temporary,file);
    if(fileHash(file)!==hash(bytes)) throw new Error('The saved file could not be verified. Restore it from the backup.');
  } finally {if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
}
function backup(p,file,before,after,report) {
  const dir=path.join(p,'SceneSyncBackups',new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomBytes(3).toString('hex'));
  fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'original.unity'),before);
  if(fileHash(path.join(dir,'original.unity'))!==hash(before))throw new Error('Backup verification failed. No changes were applied.');
  let metaHash=null;
  if(fs.existsSync(file+'.meta')) {fs.copyFileSync(file+'.meta',path.join(dir,'original.unity.meta'));metaHash=fileHash(file+'.meta');}
  const manifest={version:1,targetProject:p,targetFile:file,beforeHash:hash(before),afterHash:hash(after),metaHash,createdAt:new Date().toISOString(),report};
  fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify(manifest,null,2));
  return path.join(dir,'manifest.json');
}
function validatePlan(plan) {
  for(const [file,sha] of [[plan.config.sourceFile,plan.report.sourceSHA256],[plan.config.targetFile,plan.report.beforeSHA256],...plan.report.dependencies.map(d=>[d.file,d.sha256])]) {
    if(!fs.existsSync(file)||fileHash(file)!==sha)throw new Error('A file has changed since the comparison. Compare scenes again.\n'+file);
  }
  if(plan.targetMetaHash!==null&&(!fs.existsSync(plan.config.targetFile+'.meta')||fileHash(plan.config.targetFile+'.meta')!==plan.targetMetaHash)) throw new Error('Scene metadata has changed. Compare scenes again.');
}
function run(req) {
  if(req.action==='open-projects')return require('./open-projects.cjs').detect();
  if(req.action==='scenes') {
    const root=project(req.project);
    return {scenes:format.walk(path.join(root,'Assets'),p=>p.toLowerCase().endsWith('.unity')).map(p=>({path:p,label:path.relative(root,p)}))};
  }
  if(req.action==='compare') {
    const c=config(req.config), result=build(c);
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'davfx-scene-sync-'));
    const planPath=path.join(dir,'plan.json');
    fs.writeFileSync(planPath,JSON.stringify({version:1,config:c,report:result.report,targetMetaHash:fs.existsSync(c.targetFile+'.meta')?fileHash(c.targetFile+'.meta'):null},null,2));
    fs.writeFileSync(path.join(dir,'preview.unity'),result.outputBytes);
    return {planPath,report:result.report};
  }
  if(req.action==='apply') {
    const plan=JSON.parse(fs.readFileSync(req.planPath,'utf8'));
    if(plan.version!==1)throw new Error('This preview is invalid. Compare scenes again.');
    const c=config(plan.config);
    if(!Array.isArray(req.selectedPaths)||!req.selectedPaths.length)throw new Error('Select at least one change.');
    if(req.selectedPaths.some(p=>!plan.report.rows.some(r=>r.path===p)))throw new Error('The selection does not match the comparison.');
    requireClosed(c.targetProject); validatePlan(plan);
    const result=build(c,req.selectedPaths);
    validatePlan(plan);
    if(result.report.rows.some(r=>!plan.report.rows.some(o=>o.path===r.path)))throw new Error('New differences were found. Compare scenes again.');
    const before=fs.readFileSync(c.targetFile);
    if(before.equals(result.outputBytes)) return {applied:false,message:'The selection does not require any changes.'};
    // Check again immediately before the only write to the Unity project.
    requireClosed(c.targetProject); validatePlan(plan);
    const manifest=backup(c.targetProject,c.targetFile,before,result.outputBytes,result.report);
    atomicWrite(c.targetFile,result.outputBytes,()=>validatePlan(plan));
    return {applied:true,manifest,report:result.report,message:'Sync complete. Open the target scene in Unity to review the result.'};
  }
  if(req.action==='restore') {
    const manifestPath=fs.realpathSync(req.manifest),manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
    if(manifest.version!==1)throw new Error('Unrecognized backup. Select a DAVFX Scene Sync manifest.');
    const p=project(manifest.targetProject),file=fs.realpathSync(manifest.targetFile);
    if(!within(file,fs.realpathSync(path.join(p,'Assets')))||path.extname(file)!=='.unity')throw new Error('The backup path is invalid.');
    requireClosed(p);
    if(fileHash(file)!==manifest.afterHash)throw new Error('The scene has changed since this backup. Restore stopped to preserve your newer edits. The original scene is still available in the backup folder.');
    if(manifest.metaHash && fileHash(file+'.meta')!==manifest.metaHash)throw new Error('Scene metadata has changed. Restore stopped.');
    const original=fs.readFileSync(path.join(path.dirname(manifestPath),'original.unity'));
    if(hash(original)!==manifest.beforeHash)throw new Error('The backup has been modified or is incomplete.');
    const current=fs.readFileSync(file);
    const safetyBackup=backup(p,file,current,original,{restoreOf:manifestPath});
    atomicWrite(file,original,()=>{
      if(fileHash(file)!==manifest.afterHash)throw new Error('The scene changed while restoring. No restore was applied.');
      if(manifest.metaHash&&fileHash(file+'.meta')!==manifest.metaHash)throw new Error('Scene metadata changed while restoring. No restore was applied.');
    });
    return {restored:true,manifest:safetyBackup,message:'Original scene restored. A copy of the scene before restoring has also been saved.'};
  }
  throw new Error('Unknown operation.');
}
// The desktop launches this file directly.
module.exports={run,config,unityRunning,atomicWrite};
if(require.main===module) {
  try {const request=JSON.parse(fs.readFileSync(process.argv[2],'utf8').replace(/^\uFEFF/,'')); process.stdout.write(JSON.stringify({ok:true,...run(request)}));}
  catch(error){process.stdout.write(JSON.stringify({ok:false,error:error.message}));process.exitCode=1;}
}
