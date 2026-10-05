'use strict';
const format=require('./scene-format.cjs'),path=require('node:path');
const serialized=new Set(['.prefab','.unity','.mat','.asset','.preset','.vfx','.vfxblock','.vfxoperator','.controller','.overridecontroller','.anim','.playable','.meta','.rendertexture','.cubemap','.spriteatlas','.spriteatlasv2','.terrainlayer','.physicmaterial','.physicsmaterial2d','.mask','.guiskin','.flare','.lighting']);
const graphs=new Set(['.shadergraph','.shadersubgraph']);
// Unity local file IDs are signed 64-bit integers. Keep their exact JSON spelling.
const parse=s=>JSON.parse(s,(key,value,context)=>typeof value==='number'?JSON.rawJSON(context.source):value);
function graphObjects(text) {
  const objects=[];let start=-1,depth=0,string=false,escaped=false;
  for(let i=0;i<text.length;i++) {
    const c=text[i];if(string){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')string=false;continue;}
    if(c==='"'){string=true;continue;}
    if(c==='{'||c==='['){if(depth++===0)start=i;}
    if(c==='}'||c===']'){if(--depth===0){objects.push(parse(text.slice(start,i+1)));start=-1;}}
  }
  if(depth!==0||string||!objects.length)throw new Error('Unsupported Shader Graph serialization.');
  return objects;
}
function transform(file,bytes,mapping=new Map()) {
  const ext=path.extname(file).toLowerCase(),references=new Set();let changed=0;
  const swap=guid=>{guid=guid.toLowerCase();references.add(guid);const target=mapping.get(guid)||guid;if(target!==guid)changed++;return target;};
  if(['.asmdef','.asmref'].includes(ext)){
    const text=bytes.toString('utf8');JSON.parse(text.replace(/^\uFEFF/,''));
    const output=text.replace(/("GUID:)([a-f\d]{32})(")/gi,(m,a,id,z)=>a+swap(id)+z);
    return {bytes:changed?Buffer.from(output):bytes,references:[...references],changed};
  }
  if(graphs.has(ext)) {
    const text=bytes.toString('utf8').replace(/^\uFEFF/,'');
    function visit(value) {
      if(JSON.isRawJSON(value))return value;
      if(Array.isArray(value)){for(let i=0;i<value.length;i++)value[i]=visit(value[i]);return value;}
      if(value&&typeof value==='object'){for(const key of Object.keys(value)){if(['guid','m_FunctionSource','m_SubGraphGuid'].includes(key)&&typeof value[key]==='string'&&/^[a-f\d]{32}$/i.test(value[key]))value[key]=swap(value[key]);else value[key]=visit(value[key]);}return value;}
      if(typeof value==='string'&&/^[\s]*[\[{]/.test(value)){let parsed;try{parsed=parse(value);}catch{return value;}const before=changed;visit(parsed);return changed!==before?JSON.stringify(parsed):value;}return value;
    }
    const objects=graphObjects(text);objects.forEach(visit);
    return {bytes:changed?Buffer.from(objects.map(o=>JSON.stringify(o,null,4)).join('\n\n')+'\n'):bytes,references:[...references],changed};
  }
  if(serialized.has(ext)) {
    if(bytes.includes(0))throw new Error('Binary Unity asset: enable Force Text serialization and resave '+file);
    const text=bytes.toString('utf8');
    if(ext!=='.meta'&&!text.replace(/^\uFEFF/,'').startsWith('%YAML'))throw new Error('Unsupported Unity text asset: '+file);
    const eol=text.includes('\r\n')?'\r\n':'\n';
    let output=format.mapReferences(text.replaceAll('\r\n','\n'),(raw,id,guid)=>guid?raw.replace(guid,swap(guid)):raw);
    if(['.vfx','.vfxblock','.vfxoperator'].includes(ext)){
      output=output.replace(/^([ \t]*m_SerializableObject: *)(('(?:[^']|'')*')|("(?:[^"\\]|\\.)*"))/gm,(line,prefix,quoted)=>{
        let json;try{json=format.scalar(quoted);JSON.parse(json);}catch{if(/[a-f\d]{32}/i.test(quoted))throw new Error('Unsupported VFX object serialization: '+file);return line;}
        const before=changed,replaced=json.replace(/("guid"\s*:\s*")([a-f\d]{32})(")/gi,(m,a,id,z)=>a+swap(id)+z);
        return changed===before?line:prefix+"'"+replaced.replaceAll("'","''")+"'";
      });
    }
    return {bytes:changed?Buffer.from(output.replaceAll('\n',eol)):bytes,references:[...references],changed};
  }
  return {bytes,references:[],changed:0};
}
module.exports={transform,serialized,graphs,graphObjects};
