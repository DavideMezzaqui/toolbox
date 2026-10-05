'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.join(__dirname,'scene-sync');const files=[];
/* The engine runs on its own copy of Node. It is not kept in Git (93 MB, and
   a new copy in the history every time Node is updated): it is the same Node
   that runs this build, copied in when it is missing. */
const bundled=path.join(root,'runtime','node.exe');
if(!fs.existsSync(bundled)){fs.mkdirSync(path.dirname(bundled),{recursive:true});fs.copyFileSync(process.execPath,bundled);console.log('Scene Sync runtime: copied Node '+process.version);}
function walk(dir){for(const entry of fs.readdirSync(path.join(root,dir),{withFileTypes:true})){const rel=path.posix.join(dir,entry.name);if(entry.isDirectory())walk(rel);else files.push(rel);}}
for(const dir of ['backend','runtime','licenses'])walk(dir);
files.push('README.md','THIRD-PARTY.md');files.sort();
const entries=files.map(file=>({file,sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')}));
const version=crypto.createHash('sha256').update(JSON.stringify(entries)).digest('hex');
fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify({version,entries},null,2));console.log('Scene Sync engine: '+version.slice(0,12));
