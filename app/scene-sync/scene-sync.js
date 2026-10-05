'use strict';
// The iframe is retained by Toolbox. All paths/data are rendered as text.
const $=id=>document.getElementById(id),all=s=>[...document.querySelectorAll(s)];
const bridge=window.desktop?.sceneSync||window.parent.desktop?.sceneSync;
const clone=o=>JSON.parse(JSON.stringify(o)),norm=p=>(p||'').replaceAll('/','\\').replace(/\\+$/,'').toLowerCase(),base=p=>(p||'').split(/[\\/]/).pop()||'';
function join(...parts){const value=parts.filter(Boolean).join('\\'),joined=value.replace(/[\\/]+/g,'\\');return /^[\\/]{2}/.test(value)?'\\'+joined:joined;}
const options={transforms:true,ui:true,addMissing:true,active:true,hierarchy:true,commonReferences:false,cameras:true};
let state={last:{sourceProject:'',targetProject:'',sourceFile:'',targetFile:'',mapFrom:'HDRP',mapTo:'URP',exclusions:[],options},profiles:[],layout:{}};
let busy=false,saveTimer,dialogFinish,sceneLists={source:[],target:[]},scene={plan:null,report:null,selected:new Set(),index:-1};
async function call(method,...args){if(!bridge)throw Error('Open this tool inside the desktop Toolbox.');const res=await bridge[method](...args);if(!res.ok)throw Error(res.error);return res.value;}
function status(message,tone=''){const el=$('sceneStatus');el.textContent=message;el.title=message;el.className=tone;}
async function task(label,fn){if(busy)return;busy=true;document.body.classList.add('busy');status(label);const controls=all('button,input,select,textarea').filter(el=>!el.closest('dialog'));const disabled=controls.map(el=>el.disabled);controls.forEach(el=>el.disabled=true);try{return await fn();}catch(e){status(e.message,'blocker');showText('Operation stopped',e.message);}finally{busy=false;document.body.classList.remove('busy');controls.forEach((el,i)=>el.disabled=disabled[i]);syncInputs();}}
function save(){clearTimeout(saveTimer);saveTimer=setTimeout(()=>call('saveSettings',state).catch(e=>status('Could not save preferences: '+e.message,'blocker')),250);}
function get(o,key){return key.split('.').reduce((v,k)=>v?.[k],o);}function set(o,key,v){const keys=key.split('.');let node=o;for(const k of keys.slice(0,-1))node=node[k]||(node[k]={});node[keys.at(-1)]=v;}
function syncInputs(){all('[data-bind]').forEach(el=>{const v=get(state.last,el.dataset.bind);if(el.type==='checkbox')el.checked=!!v;else{el.value=v??'';el.title=el.value;}});$('sceneExclusions').value=(state.last.exclusions||[]).join('; ');updateActions();}
function invalidate(){
  scene={plan:null,report:null,selected:new Set(),index:-1};renderScene();
  status('Settings changed. Compare scenes again.');updateActions();save();
}
function updateActions(){
  $('applyScene').disabled=busy||!scene.plan||!scene.selected.size;
  $('sceneBackup').disabled=busy||!state.lastBackup;
}
function button(text,title,fn){const b=document.createElement('button');b.type='button';b.textContent=text;b.title=title;b.onclick=fn;return b;}
function cell(row,text,cls='',title){const td=document.createElement('td');td.textContent=text??'';if(cls)td.className=cls;if(title)td.title=title;row.append(td);return td;}
function bind(el,key){el.dataset.scope='scene';el.dataset.bind=key;el.onchange=()=>change(key,el.type==='checkbox'?el.checked:el.value.trim().replace(/^"|"$/g,''));}
function makeCards(){
  const root=$('sceneCards');
  for(const role of ['source','target']){
    const card=document.createElement('div');card.className='card '+role;
    const heading=document.createElement('div');heading.className='card-heading';const strong=document.createElement('strong');strong.textContent=role==='source'?'SOURCE · copy from':'TARGET · update';heading.append(strong);
    const detect=button('Open projects','Find running Unity editors, with their full paths',()=>openProjects(role));heading.append(detect);card.append(heading);
    function pathRow(key,label,picker){if(label){const l=document.createElement('label');l.textContent=label;card.append(l);}const row=document.createElement('div');row.className='path-row';const input=document.createElement('input');input.setAttribute('aria-label',role+' '+(label||'project'));bind(input,key);const browse=button('Browse','Open the Windows '+(picker==='scene'?'scene':'folder')+' picker',()=>browseField(role,key,picker));row.append(input,browse);card.append(row);return {input,browse};}
    pathRow(role+'Project','Project','folder');
    const row=pathRow(role+'File','Scene','scene');row.input.readOnly=true;row.input.title='Choose a saved scene';row.browse.textContent='Choose…';row.browse.onclick=()=>chooseScene(role);
    root.append(card);
  }
}
async function loadScenes(role,p=state.last[role+'Project']){const reply=p?await call('run',{action:'scenes',project:p}):{scenes:[]};const list=reply.scenes||[];let selected=list.find(s=>norm(s.path)===norm(state.last[role+'File']));if(!selected)selected=list.find(s=>/demo/i.test(s.label))||list[0];sceneLists[role]=list;state.last[role+'Project']=p;state.last[role+'File']=selected?.path||'';}
async function change(key,value){
  if(busy)return;const c=state.last;if(get(c,key)===value)return;
  invalidate();
  // Commit related paths together only after discovery succeeds. An invalid
  // selection invalidates the preview but cannot leave mixed old/new roots.
  if(['sourceProject','targetProject'].includes(key))return task('Finding scenes…',async()=>{await loadScenes(key.startsWith('source')?'source':'target',value);save();status('Scenes loaded. Compare to review changes.');});
  set(c,key,value);syncInputs();save();
}
async function browseField(role,key,kind){if(busy)return;await task('Choose '+(kind==='scene'?'a scene':'a folder')+'…',async()=>{const p=await call('pick',kind,state.last[key]||join(state.last[role+'Project'],'Assets'));if(!p)return;invalidate();if(['sourceProject','targetProject'].includes(key))await loadScenes(role,p);else state.last[key]=p;save();});}
function modal(title){if($('dialog').open)$('dialog').close();if(dialogFinish){dialogFinish(null);dialogFinish=null;}$('dialogTitle').textContent=title;$('dialogBody').replaceChildren();$('dialog').showModal();return $('dialogBody');}
function finishDialog(value){const resolve=dialogFinish;dialogFinish=null;$('dialog').close();if(resolve)resolve(value);}
$('dialogClose').onclick=()=>finishDialog(null);$('dialog').oncancel=e=>{e.preventDefault();finishDialog(null);};
function showText(title,text){const body=modal(title),pre=document.createElement('pre');pre.textContent=text;body.append(pre);}
function promptText(title,initial=''){const body=modal(title),input=document.createElement('input');input.value=initial;body.append(input);const actions=document.createElement('div');actions.className='dialog-actions';actions.append(button('Cancel','Cancel',()=>finishDialog(null)),button('Save','Save this profile',()=>{if(input.value.trim())finishDialog(input.value.trim());}));body.append(actions);input.focus();return new Promise(r=>dialogFinish=r);}
function confirmAction(title,message){const body=modal(title),p=document.createElement('p');p.textContent=message;body.append(p);const actions=document.createElement('div');actions.className='dialog-actions';actions.append(button('Cancel','Keep current files',()=>finishDialog(false)),button('Restore','Restore the chosen backup',()=>finishDialog(true)));body.append(actions);return new Promise(r=>dialogFinish=r);}
function choices(title,items,choose){const body=modal(title),search=document.createElement('input');search.type='search';search.placeholder='Search name or path…';search.setAttribute('aria-label','Search choices');const list=document.createElement('div');list.className='choices';body.append(search,list);function render(){list.replaceChildren();for(const item of items.filter(i=>(i.name+' '+i.path).toLowerCase().includes(search.value.toLowerCase()))){const b=button(item.name,item.path,()=>{finishDialog(null);choose(item.path);});const small=document.createElement('small');small.textContent=item.path;b.append(small);list.append(b);}if(!list.children.length){const p=document.createElement('p');p.textContent='No matches. Use Browse to choose a path.';list.append(p);}}search.oninput=render;render();search.focus();}
async function openProjects(role){const reply=await task('Detecting open Unity projects…',()=>call('run',{action:'open-projects'}));if(!reply)return;choices('Open Unity projects',reply.projects||[],p=>change(role+'Project',p));}
async function chooseScene(role){if(busy)return;if(!sceneLists[role].length){const loaded=await task('Finding scenes…',async()=>{await loadScenes(role);return true;});if(!loaded)return;}choices('Choose '+role+' scene',sceneLists[role].map(s=>({name:base(s.path),path:s.path})),p=>{state.last[role+'File']=p;invalidate();syncInputs();});}
function visibleScenes(){return (scene.report?.rows||[]).map((r,i)=>({r,i})).filter(({r})=>(r.path+' '+r.kind+' '+r.action).toLowerCase().includes($('sceneSearch').value.toLowerCase()));}
function renderScene(){
  $('sceneRows').replaceChildren();const rows=visibleScenes();for(const {r,i} of rows){const tr=document.createElement('tr');tr.classList.toggle('selected',scene.index===i);const td=cell(tr,'','selection');const box=document.createElement('input');box.type='checkbox';box.checked=scene.selected.has(r.path);box.setAttribute('aria-label','Select '+r.path);box.onchange=()=>{if(box.checked)scene.selected.add(r.path);else scene.selected.delete(r.path);updateActions();sceneCount();};box.onclick=e=>e.stopPropagation();td.append(box);cell(tr,r.action);cell(tr,r.kind);cell(tr,r.path,'',r.path);cell(tr,r.details?.length||0);tr.onclick=()=>{if(busy)return;scene.index=i;renderScene();};$('sceneRows').append(tr);}
  $('sceneEmpty').hidden=rows.length>0;$('sceneEmpty').querySelector('strong').textContent=scene.report?(scene.report.rows.length?'No matching changes':'Scenes are up to date'):'Ready to compare';$('sceneDetails').replaceChildren();for(const d of scene.report?.rows[scene.index]?.details||[]){const tr=document.createElement('tr');cell(tr,d.field);cell(tr,typeof d.before==='object'?JSON.stringify(d.before):d.before);cell(tr,typeof d.after==='object'?JSON.stringify(d.after):d.after);$('sceneDetails').append(tr);}sceneCount();updateActions();
}
function sceneCount(){$('sceneCount').textContent=(scene.report?.rows.length||0)+' changes · '+scene.selected.size+' selected';}
function renderProfiles(){$('profiles').replaceChildren(new Option('Current configuration',''));(state.profiles||[]).forEach((p,i)=>$('profiles').append(new Option(p.name,String(i))));}
makeCards();all('[data-bind]').forEach(el=>bind(el,el.dataset.bind));
$('help').onclick=()=>task('Loading help…',async()=>showText('Scene Sync help',await call('help')));
$('sceneExclusions').onchange=()=>{state.last.exclusions=$('sceneExclusions').value.split(';').map(s=>s.trim()).filter(Boolean);invalidate();};
$('sceneSearch').oninput=renderScene;
$('selectVisible').onclick=()=>{for(const {r} of visibleScenes())scene.selected.add(r.path);renderScene();};$('clearVisible').onclick=()=>{for(const {r} of visibleScenes())scene.selected.delete(r.path);renderScene();};
$('compare').onclick=()=>task('Comparing saved scenes…',async()=>{scene.plan=null;const r=await call('run',{action:'compare',config:state.last});scene={plan:r.planPath,report:r.report,index:r.report.rows.length?0:-1,selected:new Set(r.report.rows.map(x=>x.path))};renderScene();save();status(r.report.rows.length?'Preview ready. Select changes to apply.':'Scenes are up to date.','success');});
$('applyScene').onclick=()=>task('Applying selected changes and creating a backup…',async()=>{const planPath=scene.plan;try{const r=await call('run',{action:'apply',planPath,selectedPaths:[...scene.selected]});if(r.manifest)state.lastBackup=r.manifest;status(r.message,'success');save();}finally{scene.plan=null;}});
$('swapScenes').onclick=()=>task('Swapping scenes…',async()=>{const c=state.last;[c.sourceProject,c.targetProject]=[c.targetProject,c.sourceProject];[c.sourceFile,c.targetFile]=[c.targetFile,c.sourceFile];[c.mapFrom,c.mapTo]=[c.mapTo,c.mapFrom];[sceneLists.source,sceneLists.target]=[sceneLists.target,sceneLists.source];invalidate();syncInputs();});
$('sceneBackup').onclick=()=>task('Opening backup folder…',()=>call('openBackup',state.lastBackup));
$('sceneRestore').onclick=async()=>{const manifest=await task('Choose a backup…',()=>call('pick','backup',state.lastBackup));if(!manifest)return;if(!await confirmAction('Restore scene backup','Restore files changed by this operation? Current files will also be backed up. Newer edits are protected.'))return;await task('Restoring backup…',async()=>{const r=await call('run',{action:'restore',manifest});state.lastBackup=r.manifest;invalidate();status(r.message,'success');save();});};
$('saveProfile').onclick=async()=>{if(busy)return;const name=await promptText('Save scene profile');if(!name)return;const item={name,config:clone(state.last)},index=state.profiles.findIndex(p=>p.name===name);if(index<0)state.profiles.push(item);else state.profiles[index]=item;renderProfiles();save();status('Profile saved.','success');};
$('profiles').onchange=()=>{if($('profiles').value==='')return;task('Loading profile scenes…',async()=>{state.last=clone(state.profiles[Number($('profiles').value)].config);state.last.options={...options,...state.last.options};invalidate();await loadScenes('source');await loadScenes('target');syncInputs();save();status('Profile loaded. Compare scenes to review changes.');});};
all('[data-resize]').forEach(el=>{const root=$(el.dataset.resize);function resize(percent){percent=Math.max(20,Math.min(70,percent));root.style.setProperty('--list-size',percent+'%');state.layout[el.dataset.resize]=percent;save();}el.onpointerdown=e=>{el.setPointerCapture(e.pointerId);el.onpointermove=move=>{const r=root.getBoundingClientRect();resize((move.clientY-r.top)/r.height*100);};};el.onpointerup=el.onpointercancel=()=>el.onpointermove=null;el.onkeydown=e=>{if(['ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();resize((state.layout[el.dataset.resize]||52)+(e.key==='ArrowUp'?-5:5));}};el.ondblclick=()=>resize(52);});
(async()=>{try{const old=await call('loadSettings');state={...state,...old,last:{...state.last,...old.last,options:{...options,...old.last?.options}},profiles:old.profiles||[],layout:old.layout||{}};
// Settings left behind by the removed Package Prep tool.
delete state.package;delete state.packageBackup;delete state.mode;
syncInputs();renderProfiles();renderScene();for(const [key,value] of Object.entries(state.layout))if($(key)&&Number.isFinite(value))$(key).style.setProperty('--list-size',Math.max(20,Math.min(70,value))+'%');await task('Loading available scenes…',async()=>{status('Choose scenes, then compare.');for(const role of ['source','target']){try{await loadScenes(role);}catch(e){status(e.message,'blocker');}}syncInputs();save();});}catch(e){status(e.message,'blocker');}finally{document.body.dataset.ready='true';}})();
