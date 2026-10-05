const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const f=require('./scene-format.cjs');
module.exports = function build(config, selection=null) {
f.clearIndexCache();
const {sourceProject,targetProject,sourceFile,targetFile}=config;
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const sourceAssets = f.assetIndex(sourceProject, true), targetAssets = f.assetIndex(targetProject, true);
const source = f.load(sourceFile,sourceAssets), target = f.load(targetFile,targetAssets);
const options=Object.assign({transforms:true,ui:true,addMissing:true,active:true,hierarchy:true,commonReferences:false,cameras:true},config.options);
const ignored = new Set(config.exclusions||[]);
for(const n of source.nodes.values()) {
  if(n.components.some(c=>c.type==='108') || /^(StaticLightingSky|LightDataToShader|Sky and Fog Global Volume|Global Volume)$/i.test(n.name)) ignored.add(n.path);
  if(!options.cameras && n.components.some(c=>c.type==='20')) ignored.add(n.path);
}
const eligible = [...source.nodes.values()].filter(n => ![...ignored].some(p => n.path===p || n.path.startsWith(p+'/')) && (options.addMissing||target.byPath.has(n.path)));
const selectedPaths=new Set(selection===null?eligible.map(n=>n.path):selection);
for(const p of selectedPaths) if(!eligible.some(n=>n.path===p)) throw new Error('Object is excluded or unavailable: '+p);
// A new object requires its missing containers; existing unchecked objects stay untouched.
for(const p of [...selectedPaths]) {
  let n=source.byPath.get(p)[0];
  while(n.parent!=='0') {
    n=source.nodes.get(n.parent);
    if(target.byPath.has(n.path)) break;
    if(!eligible.includes(n)) throw new Error('Select or include the parent object: '+n.path);
    selectedPaths.add(n.path);
  }
}
const selected=eligible.filter(n=>selectedPaths.has(n.path));
const mappingNodes=eligible.filter(n=>target.byPath.has(n.path)||selectedPaths.has(n.path));
const dependencies=new Map();
function remember(file) { if(!dependencies.has(file)&&fs.existsSync(file)) dependencies.set(file,hash(fs.readFileSync(file))); }
function counterpart(sourcePath) {
  let relative=path.relative(sourceProject,sourcePath).replaceAll('\\','/');
  if(config.mapFrom) relative=relative.split(config.mapFrom).join(config.mapTo||'');
  return path.join(targetProject,relative);
}
for (const scene of [source, target]) {
  for (const [p, nodes] of scene.byPath) if (nodes.length !== 1) throw new Error('Ambiguous hierarchy path: ' + p);
}
const idMap = new Map([['0', '0']]), used = new Set(target.byId.keys());
let nextId = 7100000000000000000n;
function allocate() { while (used.has(String(nextId))) nextId++; const id = String(nextId++); used.add(id); return id; }
function componentKey(d) { return d.type + ':' + (d.type === '114' ? f.guid(f.value(d, 'm_Script')) : ''); }
function correspondingComponents(a, b) {
  const result = new Map(), occurrences = new Map();
  for (const c of a.components) {
    const key = componentKey(c), occurrence = occurrences.get(key) ?? 0;
    occurrences.set(key, occurrence + 1);
    const matches = b.components.filter(d => componentKey(d) === key);
    if (matches[occurrence]) result.set(c.id, matches[occurrence].id);
  }
  return result;
}
const prefabPairs = new Map();
function prefabPair(sourceGuid) {
  if (prefabPairs.has(sourceGuid)) return prefabPairs.get(sourceGuid);
  const sourcePath = sourceAssets.byGuid.get(sourceGuid);
  if (!sourcePath) throw new Error('Source prefab not found: ' + sourceGuid);
  let targetPath = counterpart(sourcePath);
  if(!targetAssets.byPath.has(targetPath) && targetAssets.byGuid.has(sourceGuid)) targetPath=targetAssets.byGuid.get(sourceGuid);
  const targetGuid = targetAssets.byPath.get(targetPath);
  if (!targetGuid) throw new Error('Target counterpart not found: ' + targetPath);
  const a = f.load(sourcePath,sourceAssets), b = f.load(targetPath,targetAssets), ids = new Map();
  for(const p of [sourcePath,sourcePath+'.meta',targetPath,targetPath+'.meta']) remember(p);
  const ar = [...a.nodes.values()].filter(n => n.parent === '0');
  const br = [...b.nodes.values()].filter(n => n.parent === '0');
  if (ar.length !== 1 || br.length !== 1 || ar[0].instance || br[0].instance) throw new Error('Unsupported prefab root: ' + sourcePath);
  for (const sn of a.nodes.values()) {
    const tn = b.byPath.get(sn.path)?.[0];
    if (!tn || sn.instance || tn.instance) continue;
    ids.set(sn.id, tn.id); ids.set(sn.go.id, tn.go.id);
    for (const [x, y] of correspondingComponents(sn, tn)) ids.set(x, y);
  }
  const pair = { sourceGuid, targetGuid, sourcePath, targetPath, a, b, sourceRoot: ar[0], targetRoot: br[0], ids };
  prefabPairs.set(sourceGuid, pair);
  return pair;
}

// Match scene objects by their complete hierarchy path, not by recycled file IDs.
const newSourceDocs = new Map(), newNodes = [];
for (const sn of mappingNodes) {
  const tn = target.byPath.get(sn.path)?.[0];
  if (tn && !!sn.instance !== !!tn.instance) throw new Error('Prefab/plain object mismatch: ' + sn.path);
  if (sn.instance) {
    const pair = prefabPair(sn.prefabGuid);
    if (tn && tn.prefabGuid !== pair.targetGuid) throw new Error('Different prefab at: ' + sn.path);
    idMap.set(sn.instance.id, tn?.instance.id ?? allocate());
    const stripped = source.docs.filter(d => d.stripped && f.ref(f.value(d, 'm_PrefabInstance')) === sn.instance.id);
    for (const sd of stripped) {
      const sourceId = f.ref(f.value(sd, 'm_CorrespondingSourceObject'));
      const mappedSourceId = pair.ids.get(sourceId);
      if (!mappedSourceId) throw new Error('Unmapped prefab object: ' + sn.path + ' / ' + sourceId);
      const td = tn && target.docs.find(d => d.stripped && d.type === sd.type && f.ref(f.value(d, 'm_PrefabInstance')) === tn.instance.id && f.ref(f.value(d, 'm_CorrespondingSourceObject')) === mappedSourceId);
      idMap.set(sd.id, td?.id ?? allocate());
      if (!td && selectedPaths.has(sn.path)) newSourceDocs.set(sd.id, sd);
    }
    if (!tn) { newSourceDocs.set(sn.instance.id, sn.instance); newNodes.push(sn); }
  } else {
    if (tn && sn.doc.type !== tn.doc.type) throw new Error('Transform type mismatch: ' + sn.path);
    idMap.set(sn.go.id, tn?.go.id ?? allocate());
    const components = tn ? correspondingComponents(sn, tn) : new Map();
    for (const sd of sn.components) {
      if (tn && !components.has(sd.id)) {
        if (sn.doc.type === '224') throw new Error('UI component mismatch: ' + sn.path + ' / ' + componentKey(sd));
        continue; // Camera/rendering components stay specific to the target pipeline.
      }
      idMap.set(sd.id, components.get(sd.id) ?? allocate());
      if (!tn) newSourceDocs.set(sd.id, sd);
    }
    if (!tn) { newSourceDocs.set(sn.go.id, sn.go); newNodes.push(sn); }
  }
}
// Protected objects can still be referenced by a Canvas or other common component.
for (const sn of source.nodes.values()) {
  const tn = target.byPath.get(sn.path)?.[0];
  if (!tn || sn.instance || tn.instance || idMap.has(sn.id)) continue;
  idMap.set(sn.id, tn.id); idMap.set(sn.go.id, tn.go.id);
  for (const [a, b] of correspondingComponents(sn, tn)) idMap.set(a, b);
}

function remap(text) {
  // A reference value passed on its own still needs the same structured handling.
  const standalone=/^\{fileID:/.test(text);
  const mapped=f.mapReferences(standalone?'objectReference: '+text:text, (whole, id, guid) => {
    if (!guid) {
      if (!idMap.has(id)) throw new Error('Unmapped scene reference: ' + id);
      return whole.replace('fileID: ' + id, 'fileID: ' + idMap.get(id));
    }
    if (/^0{16}/.test(guid)) return whole;
    let targetGuid = guid, targetId = id;
    if (prefabPairs.has(guid)) {
      const pair = prefabPairs.get(guid);
      targetGuid = pair.targetGuid;
      targetId = id === '100100000' ? id : pair.ids.get(id);
      if (!targetId) throw new Error('Unmapped prefab fileID: ' + guid + ' / ' + id);
    } else if (!targetAssets.byGuid.has(guid)) {
      const sourcePath = sourceAssets.byGuid.get(guid);
      if (!sourcePath) throw new Error('Unknown source asset: ' + guid);
      const destination=counterpart(sourcePath);
      targetGuid = targetAssets.byPath.get(destination);
      if (!targetGuid) throw new Error('Required asset missing from the target project: ' + destination);
    }
    if(sourceAssets.byGuid.has(guid)) remember(sourceAssets.byGuid.get(guid)+'.meta');
    if(targetAssets.byGuid.has(targetGuid)) remember(targetAssets.byGuid.get(targetGuid)+'.meta');
    return whole.replace('fileID: ' + id, 'fileID: ' + targetId).replace('guid: ' + guid, 'guid: ' + targetGuid);
  });
  return standalone?mapped.slice('objectReference: '.length):mapped;
}
const changed = new Map(), changes = [];
function editField(doc, key, desired, objectPath) {
  const current = changed.get(doc.id) ?? { ...doc };
  const previous = f.field(current, key);
  if (previous === desired) return;
  if (previous === null || desired === null) throw new Error('Unsupported field change: ' + objectPath + ' / ' + key);
  current.raw = current.raw.replace(previous, () => desired);
  changed.set(doc.id, current);
  changes.push({ path: objectPath, component: doc.type, field: key, before:previous.trim(), after:desired.trim() });
}
const transformFields = ['m_LocalRotation', 'm_LocalPosition', 'm_LocalScale', 'm_ConstrainProportionsScale', 'm_LocalEulerAnglesHint', 'm_AnchorMin', 'm_AnchorMax', 'm_AnchoredPosition', 'm_SizeDelta', 'm_Pivot'];
function keys(doc) { return [...doc.raw.matchAll(/^  (\w+):/gm)].map(m => m[1]); }
function orderedChildren(sn, tn) {
  const desired = [...(f.field(sn.doc, 'm_Children') ?? '').matchAll(/fileID: (-?\d+)/g)]
    .map(m => idMap.get(m[1])).filter(Boolean);
  const extras = [...(f.field(tn.doc, 'm_Children') ?? '').matchAll(/fileID: (-?\d+)/g)]
    .map(m => m[1]).filter(id => !desired.includes(id));
  const old=[...(f.field(tn.doc,'m_Children')??'').matchAll(/fileID: (-?\d+)/g)].map(m=>m[1]);
  const result = options.hierarchy ? [...desired, ...extras] : [...old,...desired.filter(id=>!old.includes(id))];
  return '  m_Children:' + (result.length ? '\n' + result.map(id => '  - {fileID: ' + id + '}\n').join('') : ' []\n');
}
for (const sn of selected.filter(n => !n.instance)) {
  const tn = target.byPath.get(sn.path)?.[0];
  if (!tn) continue;
  for (const key of options.transforms?transformFields:[]) {
    if (f.field(sn.doc, key) !== null) editField(tn.doc, key, f.field(sn.doc, key), sn.path);
  }
  if(options.hierarchy) editField(tn.doc, 'm_Children', orderedChildren(sn, tn), sn.path);
  if(options.active) editField(tn.go, 'm_IsActive', f.field(sn.go, 'm_IsActive'), sn.path);
  if (options.ui && sn.doc.type === '224') {
    for (const sc of sn.components.filter(d => !['4', '224'].includes(d.type))) {
      const tc = target.byId.get(idMap.get(sc.id));
      for (const key of keys(sc)) {
        if (['m_ObjectHideFlags', 'm_CorrespondingSourceObject', 'm_PrefabInstance', 'm_PrefabAsset', 'm_GameObject', 'm_Script', 'm_EditorClassIdentifier'].includes(key)) continue;
        editField(tc, key, remap(f.field(sc, key)), sn.path);
      }
    }
  }
}
// Attach only the selected additions, even when their existing parent is unchecked.
for(const parentId of new Set(newNodes.map(n=>n.parent).filter(id=>id!=='0'))) {
  const sn=source.nodes.get(parentId), tn=target.byPath.get(sn.path)?.[0];
  if(tn&&!tn.instance) editField(tn.doc,'m_Children',orderedChildren(sn,tn),sn.path);
}

function vector(text) { return Object.fromEntries([...text.matchAll(/([xyzw]): ([^,}]+)/g)].map(m => [m[1], m[2]])); }
const isPlacement = p => /^m_Local(Position|Rotation|Scale|EulerAnglesHint)\.[xyzw]$/.test(p);
function effectivePlacement(node, root) {
  const result = new Map();
  for (const field of ['m_LocalPosition', 'm_LocalRotation', 'm_LocalScale', 'm_LocalEulerAnglesHint']) {
    for (const [axis, v] of Object.entries(vector(f.value(root.doc, field)))) result.set(field + '.' + axis, v);
  }
  for (const mod of node.mods) if (mod.id === root.id && isPlacement(mod.property)) result.set(mod.property, mod.value);
  return result;
}
function almostEqual(a, b) { return a === b || (a !== undefined && b !== undefined && Math.abs(Number(a) - Number(b)) <= 1e-7); }
function modText(id, guid, property, value, objectReference = '{fileID: 0}') {
  return `    - target: {fileID: ${id}, guid: ${guid}, type: 3}\n      propertyPath: ${property}\n      value: ${value}\n      objectReference: ${objectReference}\n`;
}
function setMod(raw, id, guid, property, value, objectReference = '{fileID: 0}') {
  const mod = f.modifications({ raw }).find(m => m.id === id && m.property === property);
  if (mod) {
    if (mod.value === value && mod.objectReference === objectReference) return raw;
    const update = mod.raw.replace(/(\n      value: )[^\n]*/, (_,p)=>p+value).replace(/(\n      objectReference: )[^\n]*/, (_,p)=>p+objectReference);
    return raw.replace(mod.raw, () => update);
  }
  if (!raw.includes('    m_RemovedComponents:')) throw new Error('Unsupported prefab modifications');
  return raw.replace('    m_RemovedComponents:', modText(id, guid, property, value, objectReference) + '    m_RemovedComponents:');
}
for (const sn of selected.filter(n => n.instance)) {
  const tn = target.byPath.get(sn.path)?.[0], pair = prefabPair(sn.prefabGuid);
  const desired = effectivePlacement(sn, pair.sourceRoot);
  let raw;
  if (tn) {
    raw = tn.instance.raw;
    const previous = effectivePlacement(tn, pair.targetRoot);
    for (const [property, value] of options.transforms?desired:[]) {
      if (!almostEqual(previous.get(property), value)) raw = setMod(raw, pair.targetRoot.id, pair.targetGuid, property, value);
    }
  } else {
    // Instantiate the existing URP prefab; transfer placement, not HDRP VFX property overrides.
    const mods = [modText(pair.targetRoot.go.id, pair.targetGuid, 'm_Name', JSON.stringify(sn.name))];
    for (const [property, value] of desired) mods.push(modText(pair.targetRoot.id, pair.targetGuid, property, value));
    raw = `--- !u!1001 &${idMap.get(sn.instance.id)}\nPrefabInstance:\n  m_ObjectHideFlags: 0\n  serializedVersion: 2\n  m_Modification:\n    serializedVersion: 3\n    m_TransformParent: {fileID: ${idMap.get(sn.parent)}}\n    m_Modifications:\n${mods.join('')}    m_RemovedComponents: []\n    m_RemovedGameObjects: []\n    m_AddedGameObjects: []\n    m_AddedComponents: []\n  m_SourcePrefab: {fileID: 100100000, guid: ${pair.targetGuid}, type: 3}\n`;
  }
  const desiredActive = sn.mods.find(m => m.id === pair.sourceRoot.go.id && m.property === 'm_IsActive')?.value ?? f.value(pair.sourceRoot.go, 'm_IsActive');
  const previousActive = tn?.mods.find(m => m.id === pair.targetRoot.go.id && m.property === 'm_IsActive')?.value ?? f.value(pair.targetRoot.go, 'm_IsActive');
  if ((options.active||!tn) && desiredActive !== previousActive) raw = setMod(raw, pair.targetRoot.go.id, pair.targetGuid, 'm_IsActive', desiredActive);
  raw = raw.replace(/(m_TransformParent: \{fileID: )-?\d+(\})/, '$1' + idMap.get(sn.parent) + '$2');
  // The tester is a shared, pipeline-independent prefab. Reconnect its demo object.
  if (options.commonReferences && pair.sourceGuid===pair.targetGuid) {
    for (const mod of sn.mods.filter(m => m.objectReference!=='{fileID: 0}'&&!isPlacement(m.property))) {
      const id = pair.ids.get(mod.id);
      if (!id) throw new Error('Tester component mapping missing');
      raw = setMod(raw, id, pair.targetGuid, mod.property, mod.value, remap(mod.objectReference));
    }
  }
  if (!tn) newSourceDocs.set(sn.instance.id, { ...sn.instance, ready: raw });
  else if (raw !== tn.instance.raw) {
    changed.set(tn.instance.id, { ...tn.instance, raw });
    const oldMods=f.modifications(tn.instance),updatedMods=f.modifications({raw});
    for(const m of updatedMods) {
      const before=oldMods.find(o=>o.id===m.id&&o.property===m.property);
      if(!before||before.value!==m.value||before.objectReference!==m.objectReference)
        changes.push({path:sn.path,component:'PrefabInstance',field:m.property,before:before?(before.value||before.objectReference):'(prefab default)',after:m.value||m.objectReference});
    }
  }
}

const additions = [...newSourceDocs.values()].map(sd => {
  let raw=sd.raw;
  if(['4','224'].includes(sd.type)&&!sd.stripped) {
    const children=f.field(sd,'m_Children');
    if(children) {
      const mapped=[...children.matchAll(/fileID: (-?\d+)/g)].map(m=>m[1]).filter(id=>idMap.has(id));
      raw=raw.replace(children,()=> '  m_Children:'+(mapped.length?'\n'+mapped.map(id=>'  - {fileID: '+id+'}\n').join(''):' []\n'));
    }
  }
  return {...sd,id:idMap.get(sd.id),raw:sd.ready??remap(raw).replace(/^(--- !u!\d+ &)-?\d+/,(_,p)=>p+idMap.get(sd.id))};
});
const roots = target.docs.find(d => d.type === '1660057539');
const newRoots = newNodes.filter(n => n.parent === '0').map(n => idMap.get(n.id));
if (newRoots.length && roots) {
  const previous=[...(f.field(roots,'m_Roots')??'').matchAll(/fileID: (-?\d+)/g)].map(m=>m[1]);
  editField(roots,'m_Roots','  m_Roots:\n'+[...previous,...newRoots].map(id=>`  - {fileID: ${id}}\n`).join(''),'SceneRoots');
}
let assembled = target.text.slice(0, target.text.indexOf('--- !u!'));
for (const doc of target.docs) {
  if (doc === roots) assembled += additions.map(d => d.raw).join('');
  assembled += (changed.get(doc.id) ?? doc).raw;
}
if(!roots) assembled+=additions.map(d=>d.raw).join('');
const outputBytes = Buffer.from(assembled.replaceAll('\n', target.eol), 'utf8');

// Verify object references and prefab sub-object IDs before writing anything in Assets.
function validate(text) {
  const docs = f.documents(text), ids = new Set(docs.map(d => d.id));
  if (ids.size !== docs.length) throw new Error('Duplicate scene IDs in output');
  for (const doc of docs) {
    for (const m of f.references(doc.raw).filter(r=>!r.guid)) {
      if (m.id !== '0' && !ids.has(m.id)) throw new Error('Dangling scene reference: ' + doc.id + ' -> ' + m.id);
    }
  }
  const checkedGuids = new Set();
  for (const m of f.references(text).filter(r=>r.guid)) {
    if (/^0{16}/.test(m.guid)) continue;
    if (!targetAssets.byGuid.has(m.guid)) throw new Error('Unresolved asset GUID in output: ' + m.guid);
    checkedGuids.add(m.guid);
  }
  const prefabAssets = new Map();
  for (const doc of docs.filter(d => d.type === '1001')) {
    const guid = f.guid(f.value(doc, 'm_SourcePrefab'));
    if (!prefabAssets.has(guid)) prefabAssets.set(guid, f.load(targetAssets.byGuid.get(guid),targetAssets));
    const asset = prefabAssets.get(guid);
    for (const mod of f.modifications(doc)) {
      if (mod.guid === guid && !asset.byId.has(mod.id)) throw new Error('Invalid prefab override target: ' + guid + ' / ' + mod.id);
    }
  }
  return { documents: docs.length, resolvedAssetGuids: checkedGuids.size, prefabInstances: docs.filter(d => d.type === '1001').length };
}
const validation = validate(assembled);
validation.isolation=require('./pipeline-isolation.cjs').auditScene(config,outputBytes,targetAssets,sourceAssets,file=>{const bytes=fs.readFileSync(file);dependencies.set(file,hash(bytes));return bytes;});
const report = {
  sourceFile, targetFile, sourceSHA256: hash(source.bytes), beforeSHA256: hash(target.bytes), afterSHA256: hash(outputBytes),
  addedObjects: newNodes.map(n => ({ path: n.path, kind: n.instance ? 'Prefab instance' : n.doc.type === '224' ? 'UI' : 'GameObject' })),
  updatedObjects: [...new Set(changes.filter(c=>c.component!=='1660057539').map(c => c.path))], fieldChanges: changes,
  addedSerializedObjects: additions.length, modifiedSerializedObjects: changed.size,
  preservedPipelineObjects: [...ignored], validation
};
const candidate = f.parse(outputBytes, targetFile, targetAssets);
if(roots) {
  const rootIds=[...(f.field(candidate.byId.get(roots.id),'m_Roots')??'').matchAll(/fileID: (-?\d+)/g)].map(m=>m[1]);
  if(new Set(rootIds).size!==rootIds.length||rootIds.some(id=>!candidate.nodes.has(id)||candidate.nodes.get(id).parent!=='0'))throw new Error('Invalid scene root list');
  for(const n of candidate.nodes.values())if(n.parent==='0'&&!rootIds.includes(n.id))throw new Error('Unlisted scene root: '+n.path);
}
for (const n of candidate.nodes.values()) {
  if (n.instance) continue;
  const children = [...(f.field(n.doc, 'm_Children') ?? '').matchAll(/fileID: (-?\d+)/g)].map(m => m[1]);
  if (new Set(children).size !== children.length) throw new Error('Duplicate child: ' + n.path);
  for (const id of children) {
    const child = candidate.nodes.get(id);
    if (!child || child.parent !== n.id) throw new Error('Invalid hierarchy link: ' + n.path + ' -> ' + id);
  }
  if (n.parent !== '0') {
    const parent = candidate.nodes.get(n.parent);
    const parentChildren = [...(f.field(parent.doc, 'm_Children') ?? '').matchAll(/fileID: (-?\d+)/g)].map(m => m[1]);
    if (!parentChildren.includes(n.id)) throw new Error('Unlisted child: ' + n.path);
  }
}
for (const original of target.docs) {
  if (!candidate.byId.has(original.id)) throw new Error('Existing serialized object was removed: ' + original.id);
  if (!changed.has(original.id) && original.raw !== candidate.byId.get(original.id).raw) throw new Error('Unexpected change: ' + original.id);
}
for (const sn of selected) {
  const cn = candidate.byPath.get(sn.path)?.[0];
  if (!cn) throw new Error('Missing output object: ' + sn.path);
  if (sn.instance) {
    const pair = prefabPair(sn.prefabGuid);
    if (cn.prefabGuid !== pair.targetGuid) throw new Error('Wrong target prefab: ' + sn.path);
    const expected = effectivePlacement(sn, pair.sourceRoot), actual = effectivePlacement(cn, pair.targetRoot);
    if(options.transforms||!target.byPath.has(sn.path)) for (const [key, value] of expected) if (!almostEqual(value, actual.get(key))) throw new Error('Placement mismatch: ' + sn.path + ' / ' + key);
  } else {
    if(options.transforms||!target.byPath.has(sn.path)) for (const key of transformFields) if (f.value(sn.doc, key) !== f.value(cn.doc, key)) throw new Error('Transform mismatch: ' + sn.path + ' / ' + key);
    if ((options.ui||!target.byPath.has(sn.path)) && sn.doc.type === '224') {
      for (const sc of sn.components) {
        const cc = candidate.byId.get(idMap.get(sc.id));
        if (f.field(sc, 'm_Text') && remap(f.field(sc, 'm_Text')) !== f.field(cc, 'm_Text')) throw new Error('Text mismatch: ' + sn.path);
      }
    }
  }
}

report.dependencies=[...dependencies].map(([file,sha256])=>({file,sha256}));
report.excludedObjects=[...ignored];
report.rows=[...report.addedObjects.map(n=>({path:n.path,action:'Add',kind:n.kind,details:[{field:'New object',before:'Not present',after:n.kind}]})),...report.updatedObjects.map(p=>({path:p,action:'Update',kind:source.byPath.get(p)?.[0]?.instance?'Prefab':'Object',details:changes.filter(c=>c.path===p)}))];
report.rows.sort((a,b)=>a.path.localeCompare(b.path));
return {report, outputBytes};
};
