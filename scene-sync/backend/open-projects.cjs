'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');

// Unity Hub may quote both the switch and its value. Windows paths cannot contain quotes.
function projectPath(commandLine) {
  const args=(String(commandLine||'').match(/(?:[^\s"]+|"[^"]*")+/g)||[]).map(s=>s.replace(/"/g,''));
  const lower=args.map(s=>s.toLowerCase());
  if(lower.includes('-batchmode')||lower.includes('-adb2')||args.some(s=>/^AssetImportWorker/i.test(s)))return null;
  const index=lower.indexOf('-projectpath');
  if(index<0||!args[index+1]||! /^(?:[a-z]:[\\/]|\\\\[^\\]+\\[^\\]+)/i.test(args[index+1]))return null;
  return path.win32.normalize(args[index+1]);
}
function collect(processes,validate) {
  const projects=[],seen=new Set();let unavailable=0;
  for(const process of processes) {
    if(!process.CommandLine){unavailable++;continue;}
    const candidate=projectPath(process.CommandLine);
    if(!candidate)continue;
    try {
      const resolved=validate(candidate);
      if(!resolved)continue;
      const key=resolved.toLowerCase().replace(/[\\/]+$/,'');
      if(seen.has(key))continue;
      seen.add(key);projects.push({name:path.win32.basename(resolved),path:resolved});
    } catch {unavailable++;}
  }
  projects.sort((a,b)=>a.name.localeCompare(b.name)||a.path.localeCompare(b.path));
  return {projects,message:unavailable?'Some Unity processes could not be read. You can still paste a project path.':projects.length?'Select a project, then choose Use project.':'No open Unity projects found. You can still paste a path or browse.'};
}
function detect() {
  if(process.platform!=='win32')throw new Error('Open project detection is available on Windows.');
  const script=`$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
$items=@(Get-CimInstance Win32_Process -Filter "name = 'Unity.exe'" | Select-Object CommandLine)
ConvertTo-Json -InputObject $items -Compress`;
  const exe=path.join(process.env.SystemRoot||'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
  let processes;
  try {
    const output=cp.execFileSync(exe,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:4*1024*1024});
    processes=JSON.parse(output.replace(/^\uFEFF/,''));
    if(!Array.isArray(processes))throw new Error('Invalid process list');
  } catch {throw new Error('Could not detect open Unity projects. Try Refresh, or paste a project path.');}
  return collect(processes,candidate=>{
    if(!fs.statSync(path.join(candidate,'Assets')).isDirectory()||!fs.statSync(path.join(candidate,'ProjectSettings','ProjectVersion.txt')).isFile())return null;
    return fs.realpathSync(candidate);
  });
}
module.exports={detect,projectPath,collect};
