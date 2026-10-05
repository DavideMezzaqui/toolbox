'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process');
const {projectPath,collect}=require('../backend/open-projects.cjs');
let checks=0;
function check(name,fn){fn();checks++;console.log('PASS '+name);}
check('Hub quoted switch and spaces',()=>assert.equal(projectPath('"C:\\Unity\\Unity.exe" "-projectPath" "C:\\Projects\\My HDRP Pack"'),'C:\\Projects\\My HDRP Pack'));
check('case insensitive switches and Unicode paths',()=>assert.equal(projectPath('Unity.exe -PROJECTPATH "D:\\Unità\\È URP"'),'D:\\Unità\\È URP'));
check('UNC project paths',()=>assert.equal(projectPath('Unity.exe -projectPath "\\\\server\\projects\\Pack"'),'\\\\server\\projects\\Pack'));
check('worker and batch processes excluded',()=>{for(const flag of ['-batchmode','-name AssetImportWorker0','-adb2'])assert.equal(projectPath('Unity.exe -projectPath C:\\Pack '+flag),null);});
check('missing and relative paths excluded',()=>{for(const arg of ['','-projectPath','-projectPath relative','-projectPath C:relative','-projectPath \\relative'])assert.equal(projectPath('Unity.exe '+arg),null);});
check('duplicate projects collapse and equal names keep distinct paths',()=>{
 const result=collect(['C:\\One\\Pack','c:\\one\\pack\\','D:\\Two\\Pack'].map(p=>({CommandLine:'Unity.exe -projectPath "'+p+'"'})),p=>p);
 assert.equal(result.projects.length,2);assert.equal(result.projects[0].name,'Pack');assert.notEqual(result.projects[0].path,result.projects[1].path);
});
check('unavailable process does not hide readable projects',()=>{const r=collect([{CommandLine:null},{CommandLine:'Unity.exe -projectPath C:\\Pack'}],p=>p);assert.equal(r.projects.length,1);assert.match(r.message,/could not be read/);});
check('stale project does not discard other results',()=>{const r=collect([{CommandLine:'Unity.exe -projectPath C:\\Gone'},{CommandLine:'Unity.exe -projectPath C:\\Valid'}],p=>{if(p.endsWith('Gone'))throw Error('Missing');return p;});assert.equal(r.projects.length,1);assert.match(r.message,/could not be read/);});
check('empty detection keeps manual selection available',()=>{const r=collect([],()=>{});assert.deepEqual(r.projects,[]);assert.match(r.message,/No open Unity/);});
check('actual Windows API command completes',()=>{
 const request=path.join(os.tmpdir(),'davfx-open-projects-'+process.pid+'.json');
 try{fs.writeFileSync(request,JSON.stringify({action:'open-projects'}));const result=cp.spawnSync(process.execPath,[path.join(__dirname,'../backend/api.cjs'),request],{encoding:'utf8',windowsHide:true,timeout:20000});assert.ifError(result.error);assert.equal(result.status,0,result.stderr);const reply=JSON.parse(result.stdout);assert.equal(reply.ok,true,reply.error);assert(Array.isArray(reply.projects));console.log(JSON.stringify(reply));}finally{if(fs.existsSync(request))fs.unlinkSync(request);}
});
console.log(checks+' checks passed');
