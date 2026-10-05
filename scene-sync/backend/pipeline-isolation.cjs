'use strict';
const fs=require('node:fs'),path=require('node:path'),refs=require('./package-references.cjs');
const key=p=>path.resolve(p).toLowerCase();
const under=(p,root)=>key(p)===key(root)||key(p).startsWith(key(root)+path.sep);
function wrongPipeline(file,to){
  const normalized=file.replaceAll('\\','/').toLowerCase();
  const scoped=normalized.split(/\/(?:assets|packages|library\/packagecache)\//).pop();
  const parts=scoped.split('/');
  return parts.includes(to==='URP'?'hdrp':'urp')||parts.some(p=>p.startsWith(to==='URP'?'com.unity.render-pipelines.high-definition':'com.unity.render-pipelines.universal'));
}
const inspectable=file=>refs.serialized.has(path.extname(file).toLowerCase())||refs.graphs.has(path.extname(file).toLowerCase())||['.asmdef','.asmref','.shader','.hlsl','.cginc','.compute'].includes(path.extname(file).toLowerCase());

// Inspect the final bytes and final GUID locations, including assets reused unchanged.
// Engine/package dependencies are allowed unless they belong to the opposite pipeline.
function audit({config:c,operations=[],entries=[],targetIndex,sourceIndex,files,read,issue,knownIssues=[]}){
  const ops=new Map(operations.map(o=>[key(o.path),o])),locations=new Map(targetIndex.byGuid),visited=new Set();let checked=0,links=0;
  for(const [id,file] of locations)if(ops.get(key(file))?.remove||ops.get(key(file+'.meta'))?.remove)locations.delete(id);
  for(const e of entries)locations.set(e.id,e.destination);
  const bytes=file=>{const op=ops.get(key(file));return op&&!op.remove?(op.data!==null&&op.data!==undefined?Buffer.from(op.data,'base64'):read(op.source)):read(file);};
  const exists=file=>ops.has(key(file))?!ops.get(key(file)).remove:fs.existsSync(file);
  for(const op of operations.filter(o=>!o.remove&&o.path.endsWith('.meta'))){const m=/^guid: ([a-f\d]{32})\r?$/mi.exec(bytes(op.path).toString('utf8'));if(m)locations.set(m[1].toLowerCase(),op.path.slice(0,-5));}
  const roots=[...files,...operations.filter(o=>!o.remove).map(o=>o.path)].filter(p=>under(p,c.targetFolder)||under(p,c.commonFolder));
  function dependency(owner,dest){
    links++;
    if(wrongPipeline(dest,c.to)||under(dest,c.sourceFolder)){
      issue('Blocker','Pipeline isolation: reference to the opposite pipeline remains: '+dest+'. Choose a compatible target counterpart or move shared resources to Common.',owner);return;
    }
    const common=under(owner,c.commonFolder);
    if(common&&(wrongPipeline(dest,'URP')||wrongPipeline(dest,'HDRP'))){issue('Blocker','Pipeline isolation: Common depends on a render-pipeline package: '+dest+'. Move this asset to its pipeline folder or use a pipeline-independent counterpart.',owner);return;}
    if(common&&under(dest,c.targetFolder)){issue('Blocker','Pipeline isolation: Common depends on a pipeline-specific asset: '+dest+'. Common must be independent of both pipelines.',owner);return;}
    if(under(dest,path.join(c.targetProject,'Assets'))&&!under(dest,c.targetFolder)&&!under(dest,c.commonFolder)){
      issue('Blocker','Pipeline isolation: asset dependency is outside Target and Common: '+dest+'. Place shared resources in Common or select a target counterpart.',owner);return;
    }
    if(exists(dest+'.meta'))bytes(dest+'.meta'); // Track GUID-location changes between analysis and apply.
    if(under(dest,c.targetFolder)||under(dest,c.commonFolder)){scan(dest);scan(dest+'.meta');}
  }
  function scan(file){
    if(visited.has(key(file))||!exists(file)||!inspectable(file))return;
    visited.add(key(file));checked++;
    let data,ids;try{data=bytes(file);ids=refs.transform(file,data).references;}catch(e){issue('Blocker','Pipeline isolation could not inspect this asset: '+e.message,file);return;}
    for(const id of ids){if(/^0{16}/.test(id))continue;const dest=locations.get(id);
      if(dest){dependency(file,dest);continue;}
      const source=sourceIndex?.byGuid.get(id);
      if(source&&(wrongPipeline(source,c.to)||under(source,c.sourceFolder))){dependency(file,source);continue;}
      // A missing GUID cannot certify dependency isolation, even on an existing counterpart.
      if(!knownIssues.some(i=>(i.severity==='Blocker'||c.allowMissingSourceReferences)&&i.message.includes(id)))issue(c.allowMissingSourceReferences?'Review':'Blocker','Pipeline isolation: unresolved dependency '+id+'. Its destination cannot be verified.'+(c.allowMissingSourceReferences?' Preserved by Keep missing references.':''),file);
    }
    if(['.shader','.hlsl','.cginc','.compute'].includes(path.extname(file).toLowerCase())){
      for(const m of data.toString('utf8').replace(/\/\*[\s\S]*?\*\//g,'').matchAll(/^\s*#\s*include(?:_with_pragmas)?\s*["<]([^">]+)[">]/gm)){
        const ref=m[1];let dest;
        if(/^(Assets|Packages)[\\/]/i.test(ref))dest=path.join(c.targetProject,ref);
        else if(ref.includes('/')||ref.includes('\\'))dest=path.resolve(path.dirname(file),ref);
        else if(exists(path.join(path.dirname(file),ref)))dest=path.join(path.dirname(file),ref);
        if(dest)dependency(file,dest);
      }
    }
  }
  for(const file of roots)scan(file);
  return {version:1,checkedFiles:checked,checkedReferences:links};
}
function auditScene(config,outputBytes,targetIndex,sourceIndex,read){
  const relative=path.relative(path.join(config.targetProject,'Assets'),config.targetFile),parts=relative.split(path.sep);
  const index=parts.findLastIndex(p=>/^(HDRP|URP)$/i.test(p));
  if(index<0)return null; // Generic scene layouts need not use the package convention.
  const to=parts[index].toUpperCase(),root=path.join(config.targetProject,'Assets',...parts.slice(0,index)),issues=[];
  const c={...config,to,targetFolder:path.join(root,parts[index]),commonFolder:path.join(root,'Common'),sourceFolder:path.join(root,to==='HDRP'?'URP':'HDRP')};
  const result=audit({config:c,operations:[{path:config.targetFile,data:outputBytes.toString('base64')}],targetIndex,sourceIndex,files:[config.targetFile],read,issue:(severity,message,asset)=>issues.push({severity,message,asset})});
  if(issues.length)throw new Error('Scene dependency isolation failed. Target scenes must use their own pipeline or Common.\n'+issues.slice(0,12).map(i=>i.asset+'\n'+i.message).join('\n\n')+(issues.length>12?'\n'+(issues.length-12)+' more issues.':''));
  return result;
}
module.exports={audit,auditScene,wrongPipeline};
