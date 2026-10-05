const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const indexCache=new Map();

function documents(text) {
  const headers = [...text.matchAll(/^--- !u!(\d+) &(-?\d+)( stripped)?\n/gm)];
  return headers.map((m, i) => ({
    type: m[1], id: m[2], stripped: !!m[3],
    raw: text.slice(m.index, headers[i + 1]?.index ?? text.length)
  }));
}
function field(doc, key) {
  const fields = [...doc.raw.matchAll(/^  (\w+):/gm)];
  const i = fields.findIndex(m => m[1] === key);
  return i < 0 ? null : doc.raw.slice(fields[i].index, fields[i + 1]?.index ?? doc.raw.length);
}
function value(doc, key) { return field(doc, key)?.slice(key.length + 3).trim() ?? ''; }
function ref(text) { return text?.match(/fileID: (-?\d+)/)?.[1] ?? '0'; }
function guid(text) { return text?.match(/guid: ([a-f0-9]{32})/)?.[1] ?? ''; }
// Only complete YAML mapping values are object references. Braces in text are literal.
function mapReferences(text,convert) {
  // Unity wraps long strings onto indented lines. Their contents are still text.
  const strings=[];
  for(const m of text.matchAll(/^([ \t]*)(?:-\s+)?(?:m_(?:Text|text):[ \t]*|[\w.]+:[ \t]*(?=["'|>]))/gm)) {
    let end=text.indexOf('\n',m.index);
    if(end<0)end=text.length;
    else {
      end++;
      while(end<text.length){const next=text.indexOf('\n',end),stop=next<0?text.length:next+1,line=text.slice(end,stop);if(line.trim()&&line.match(/^[ \t]*/)[0].length<=m[1].length)break;end=stop;}
    }
    strings.push([m.index,end]);
  }
  let stringIndex=0;
  return text.replace(/^(\s*(?:-\s+)?(?:[\w.]+:\s*)?)(\{fileID: (-?\d+)(?:, guid: ([a-f0-9]{32}),\s*type: (\d+))?\})([ \t]*)$/gm,
    (line,prefix,reference,id,assetGuid,type,suffix,offset)=>{
      while(stringIndex<strings.length&&strings[stringIndex][1]<=offset)stringIndex++;
      if(stringIndex<strings.length&&offset>=strings[stringIndex][0])return line;
      if(!/[-:]\s*$/.test(prefix)||/\bm_(?:Text|text):\s*$/.test(prefix))return line;
      return prefix+convert(reference,id,assetGuid,type)+suffix;
    });
}
function references(text) {
  const found=[];mapReferences(text,(raw,id,guid,type)=>{found.push({raw,id,guid,type});return raw;});return found;
}
function modifications(doc) {
  return [...doc.raw.matchAll(/^    - target: \{fileID: (-?\d+), guid: ([a-f0-9]{32}),[\s\S]*?\n      propertyPath: (.*)\n      value: (.*)\n      objectReference: (.*)\n/gm)]
    .map(m => ({id:m[1],guid:m[2],property:m[3],value:m[4],objectReference:m[5],raw:m[0]}));
}
function scalar(text) {
  if(text.startsWith('"')) { try { return JSON.parse(text); } catch {} }
  return text.startsWith("'")&&text.endsWith("'")?text.slice(1,-1).replaceAll("''", "'"):text;
}
function load(file, index) { return parse(fs.readFileSync(file), file, index); }
function parse(bytes, file = '<memory>', index) {
  const text = bytes.toString('utf8').replace(/\r\n/g, '\n');
  const docs = documents(text), byId = new Map(docs.map(d => [d.id, d]));
  if(!text.includes('%YAML 1.1') || !docs.length) throw new Error('Unrecognized Unity YAML format: '+file);
  if (byId.size !== docs.length) throw new Error('Duplicate IDs: ' + file);
  const prefabInfo=new Map();
  for(const instance of docs.filter(d=>d.type==='1001')) {
    const mods=modifications(instance), assetGuid=guid(value(instance,'m_SourcePrefab'));
    const stripped=docs.filter(d=>['4','224'].includes(d.type)&&d.stripped&&ref(value(d,'m_PrefabInstance'))===instance.id);
    if(stripped.length>1) throw new Error('Prefab child transform overrides are not supported: '+file+' (instance '+instance.id+').');
    let name,rootId;
    const asset=index?.byGuid.get(assetGuid);
    if(asset) {
      const assetDocs=documents(fs.readFileSync(asset,'utf8').replace(/\r\n/g,'\n'));
      const roots=assetDocs.filter(d=>['4','224'].includes(d.type)&&!d.stripped&&ref(value(d,'m_Father'))==='0');
      if(roots.length===1) {
        rootId=roots[0].id;
        const goId=ref(value(roots[0],'m_GameObject'));
        const go=assetDocs.find(d=>d.id===goId);
        name=mods.find(m=>m.property==='m_Name'&&m.id===goId)?.value ?? (go&&value(go,'m_Name'));
      }
    }
    const names=mods.filter(m=>m.property==='m_Name');
    if(!name && names.length===1) name=names[0].value;
    if(!name) throw new Error('Could not resolve the prefab root name. Import the project in Unity: '+assetGuid);
    if(rootId&&stripped.length&&ref(value(stripped[0],'m_CorrespondingSourceObject'))!==rootId) throw new Error('Unsupported prefab child transform: '+name);
    prefabInfo.set(instance.id,{name:scalar(name),rootId});
  }
  const nodes = new Map();
  for (const d of docs.filter(d => ['4','224'].includes(d.type))) {
    if (d.stripped) {
      const instance = byId.get(ref(value(d,'m_PrefabInstance')));
      if (!instance) throw new Error('Missing prefab instance: ' + d.id);
      const mods = modifications(instance);
      nodes.set(d.id, {id:d.id,doc:d,instance,mods,name:prefabInfo.get(instance.id).name,
        parent:ref(instance.raw.match(/m_TransformParent: ([^\n]+)/)?.[1]),
        prefabGuid:guid(value(instance,'m_SourcePrefab')),sourceId:ref(value(d,'m_CorrespondingSourceObject')),components:[]});
    } else {
      const go = byId.get(ref(value(d,'m_GameObject')));
      if (!go) throw new Error('Missing GameObject: '+d.id);
      const components = [...(field(go,'m_Component')??'').matchAll(/fileID: (-?\d+)/g)].map(m=>byId.get(m[1]));
      if(components.some(c=>!c)) throw new Error('Missing component: '+go.id);
      nodes.set(d.id,{id:d.id,doc:d,go,name:scalar(value(go,'m_Name')),parent:ref(value(d,'m_Father')),components});
    }
  }
  const represented = new Set([...nodes.values()].map(n=>n.instance?.id));
  for (const instance of docs.filter(d=>d.type==='1001'&&!represented.has(d.id))) {
    const mods=modifications(instance);
    const parent=ref(instance.raw.match(/m_TransformParent: ([^\n]+)/)?.[1]);
    nodes.set(instance.id,{id:instance.id,doc:instance,instance,mods,virtual:true,
      name:prefabInfo.get(instance.id).name,parent,
      prefabGuid:guid(value(instance,'m_SourcePrefab')),
      sourceId:mods.find(m=>m.property==='m_LocalPosition.x')?.id,components:[]});
  }
  function fullPath(node,seen=new Set()) {
    if(node.path) return node.path;
    if(seen.has(node.id)) throw new Error('Hierarchy cycle');
    seen.add(node.id);
    if(node.parent !== '0' && !nodes.has(node.parent)) throw new Error('Missing parent '+node.parent);
    return node.path = (node.parent==='0' ? '' : fullPath(nodes.get(node.parent),seen)+'/')+node.name;
  }
  for(const node of nodes.values()) fullPath(node);
  const byPath = new Map();
  for(const node of nodes.values()) {
    if(!byPath.has(node.path)) byPath.set(node.path,[]);
    byPath.get(node.path).push(node);
  }
  return {file,bytes,text,docs,byId,nodes,byPath,eol:bytes.includes(Buffer.from('\r\n'))?'\r\n':'\n'};
}
function walk(root,predicate) {
  const result=[];
  if(!fs.existsSync(root)) return result;
  for(const entry of fs.readdirSync(root,{withFileTypes:true})) {
    const full=path.join(root,entry.name);
    if(entry.isDirectory()) result.push(...walk(full,predicate));
    else if(entry.isFile() && predicate(full)) result.push(full);
  }
  return result;
}
function assetIndex(project, packages=false) {
  const key=path.resolve(project)+'|'+packages;
  if(indexCache.has(key))return indexCache.get(key);
  const rg=path.join(__dirname,'../runtime/rg.exe');
  if(fs.existsSync(rg)) {
    const roots=[path.join(project,'Assets')];
    if(packages)for(const part of ['Packages','Library/PackageCache'])if(fs.existsSync(path.join(project,part)))roots.push(path.join(project,part));
    let text='';
    try{text=cp.execFileSync(rg,['--hidden','--no-ignore','--glob','*.meta','--glob','!**/*~/**','--no-heading','--with-filename','--color','never','^guid: [a-f0-9]{32}\\r?$',...roots],{encoding:'utf8',maxBuffer:64*1024*1024,windowsHide:true});}
    catch(e){if(e.status!==1)throw new Error('Asset scan failed: '+(e.stderr||e.message));}
    const byGuid=new Map(),byPath=new Map();
    for(const m of text.matchAll(/^(.*\.meta):guid: ([a-f0-9]{32})\r?$/gm)){
      const asset=path.normalize(m[1].slice(0,-5)),id=m[2];
      if(byGuid.has(id)&&byGuid.get(id)!==asset)throw new Error('Duplicate GUID: '+asset+' / '+byGuid.get(id));
      byGuid.set(id,asset);byPath.set(asset,id);
    }
    const result={byGuid,byPath};indexCache.set(key,result);return result;
  }
  const files=walk(path.join(project,'Assets'),f=>f.endsWith('.meta'));
  if(packages) {
    const eligible=f=>f.endsWith('.meta')&&!f.split(/[\\/]/).some(part=>part.endsWith('~'));
    files.push(...walk(path.join(project,'Packages'),eligible));
    files.push(...walk(path.join(project,'Library/PackageCache'),eligible));
  }
  const byGuid=new Map(),byPath=new Map();
  for(const file of files) {
    const id=fs.readFileSync(file,'utf8').match(/^guid: ([a-f0-9]{32})/m)?.[1];
    if(!id) continue;
    const asset=file.slice(0,-5);
    if(byGuid.has(id)&&byGuid.get(id)!==asset) throw new Error('Duplicate GUID '+id+': '+asset+' / '+byGuid.get(id));
    byGuid.set(id,asset); byPath.set(asset,id);
  }
  return {byGuid,byPath};
}
function clearIndexCache(){indexCache.clear();}
module.exports={documents,field,value,ref,guid,modifications,load,parse,walk,assetIndex,scalar,clearIndexCache,mapReferences,references};
