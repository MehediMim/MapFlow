// Mapflow — standalone mobile-first editor using FrameFlow's real map renderer.
// No desktop studio DOM, framework, backend, or external build tools required.
import {
  THEMES, TEXTURES, DEFAULT_AREA, AREA_MODES, NEIGHBOR_MODES, ACTION_TYPES, PRESETS,
  TRAVEL_ICONS, LABEL_SHAPES, PATH_CURVES, makeAction, makeShot, newMapProject,
  validateMapProject, buildGeo, installCountryDetail, detailRegions, countryAt, regionAt,
  drawMap, drawPathEditor, makeView, screenToLonLat, cameraAt, lonToX, latToY,
  imageryNeeds
} from './map-engine.mjs';
import { detailFileOf, detailInfo, detailLevelOf } from './map-country-details.mjs';
import { CITIES } from './map-places.mjs';
import { OBJECT_ICONS, EFFECTS, SHAPES, OBJECT_ENTER, OBJECT_IDLE, OBJECT_EXIT } from './map-objects.mjs';
import { createImagery } from './map-imagery.mjs';
import { panMapCamera, zoomMapCamera } from './map-navigation.mjs';
import { exportMapVideo } from './map-video-export.mjs';
import { snapTimeline } from './timeline-snap.mjs';

const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clamp=(n,min,max)=>Math.min(max,Math.max(min,n));
const copy=o=>JSON.parse(JSON.stringify(o));
const SECOND=36,KEY='mapflow-mobile-project-v1';
const icons={border:'▱',plane:'✈',pin:'⌖',highlight:'◎',object:'◆',effect:'✹',shape:'➜',label:'Aa',shot:'◉'};
const colors={border:['#4dcbb9','#23766b'],plane:['#ff9966','#71442e'],pin:['#f18aa6','#7a4057'],highlight:['#f0c76a','#746036'],object:['#c0b0ef','#5f4d86'],effect:['#ffb482','#734f34'],shape:['#c7b6e3','#66527b'],label:['#9abfee','#486782'],shot:['#9fbaf1','#4d6392']};
const engineCanvas=$('mapCanvas'),ctx=engineCanvas.getContext('2d',{alpha:false}),viewport=$('timelineViewport');
let p,geo=null,geoError='',frame=0,selected=null,playing=false,playRAF=0,playT0=0,playStart=0;
let sheet='',previewCamera=null,pick=null,pointers=new Map(),gesture=null,lastView=null;
let undo=[],redo=[],editCheckpoint=null,zoom=1,isRendering=false,activeExport=false,tileRAF=0;
let timelineSync=false,scrollRAF=0,toastTimer=0,loadingPacks=new Map(),missingPacks=new Set();

function fresh(){const x=newMapProject();x.name='My first map';x.width=720;x.height=1280;x.frames=360;x.fps=30;x.graticule=false;x.theme='earth';x.camera.init={lon:90.4,lat:23.75,zoom:4.15,bearing:0,pitch:0};return x;}
let hasProject=false;
try{const saved=localStorage.getItem(KEY);p=saved?JSON.parse(saved):fresh();validateMapProject(p);hasProject=!!saved;}catch{p=fresh();}
function items(){return [...p.actions,...p.shots];}
function current(){return items().find(a=>a.id===selected);}
function sec(t){return Math.max(0,Math.round(Number(t||0)*p.fps));}
const fmt=frames=>{const total=Math.max(0,frames/p.fps);return `${String(Math.floor(total/60)).padStart(2,'0')}:${String(Math.floor(total%60)).padStart(2,'0')}.${Math.floor(total*10%10)}`;};
function nameOf(it){return it.kind==='shot'?'Camera':ACTION_TYPES[it.type]?.label||it.type;}
function showToast(message){const el=$('toast');el.textContent=message;el.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('visible'),2600);}
function store(){try{localStorage.setItem(KEY,JSON.stringify(p));hasProject=true;}catch{showToast('Storage full. Export your project JSON to save it.');}}
function renderHome(){
 $('resumeProjectBtn').hidden=!hasProject;$('homeEmpty').hidden=hasProject;
 $('recentProjectName').textContent=p.name||'Untitled map';
 $('recentProjectMeta').textContent=`${p.width} \u00d7 ${p.height} \u00b7 ${Math.round(p.frames/p.fps*10)/10}s \u00b7 ${items().length} layers`;
}
function showScreen(editor,focus=true){
 if(!editor&&$('previewPanel').classList.contains('preview-expanded'))void exitPreviewFullscreen(false);
 pause();closeSheet();if(pick)finishPick(true);closeSheet();
 $('homeScreen').hidden=editor;$('workspace').hidden=!editor;$('workspace').inert=!editor;
 if(editor){refresh(true);scrollToFrame();if(focus)$('homeBtn').focus();}
 else{renderHome();if(focus)$('homeTitle').focus();}
}
function setPreviewExpanded(expanded,focus=false){
 const panel=$('previewPanel'),button=$('fullscreenBtn');
 panel.classList.toggle('preview-expanded',expanded);
 button.textContent=expanded?'Exit fullscreen':'Fullscreen';
 button.setAttribute('aria-label',expanded?'Exit fullscreen preview':'Enter fullscreen preview');
 button.setAttribute('aria-pressed',String(expanded));
 $('previewPlayBtn').hidden=!expanded;
 $('previewPlayBtn').textContent=playing?'Pause':'Play';
 document.querySelector('.editing-panel').inert=expanded;
 document.querySelector('.topbar').inert=expanded;
 if(focus)button.focus();
}
async function exitPreviewFullscreen(focus=true){
 if(document.fullscreenElement===$('previewPanel')){
  try{await document.exitFullscreen();}catch{showToast('Use your browser fullscreen control to exit');return;}
 }
 setPreviewExpanded(false,focus);
}
async function togglePreviewFullscreen(){
 if($('previewPanel').classList.contains('preview-expanded')){await exitPreviewFullscreen();return;}
 setPreviewExpanded(true,true);
 // Keep the expanded in-app preview if native fullscreen is unavailable or denied.
 try{await $('previewPanel').requestFullscreen?.();}catch{}
}
function openEditor(){if(location.hash==='#editor')showScreen(true);else location.hash='editor';}
function createProject(){
 if(hasProject&&!confirm('Create a new map? This replaces the project saved on this device. Export its JSON first to keep a copy.'))return;
 pause();checkpoint();p=fresh();selected=null;previewCamera=null;frame=0;viewport.scrollTop=0;store();openEditor();
}
function checkpoint(){undo.push(JSON.stringify(p));if(undo.length>60)undo.shift();redo=[];setUndo();}
function setUndo(){$('undoBtn').disabled=!undo.length;$('redoBtn').disabled=!redo.length;}
function undoRedo(direction){pause();const from=direction==='undo'?undo:redo,to=direction==='undo'?redo:undo;if(!from.length)return;to.push(JSON.stringify(p));p=JSON.parse(from.pop());if(!items().some(x=>x.id===selected))selected=null;frame=clamp(frame,0,p.frames-1);previewCamera=null;store();setUndo();refresh(true);}
function extend(){const last=Math.max(...items().map(a=>a.start+a.dur),p.frames);p.frames=Math.max(2,last);}
function mutate(fn,{redrawSheet=false,timeline=true}={}){checkpoint();fn();extend();store();refresh(false,timeline);if(redrawSheet&&sheet)renderSheet(true);}
function updateStats(){$('projectName').innerHTML=esc(p.name||'Untitled map')+' <span>⌄</span>';$('previewMeta').textContent=`${p.width>p.height?'16:9':p.width===p.height?'1:1':'9:16'} • ${p.fps} FPS`;$('totalTime').textContent=fmt(p.frames);$('layerCount').textContent=items().length;setUndo();}
function ensureCanvas(){if(engineCanvas.width!==p.width||engineCanvas.height!==p.height){engineCanvas.width=p.width;engineCanvas.height=p.height;}engineCanvas.style.aspectRatio=`${p.width}/${p.height}`;}
function draw(){ensureCanvas();if(!geo){ctx.fillStyle='#101923';ctx.fillRect(0,0,p.width,p.height);ctx.fillStyle='#9eabbb';ctx.textAlign='center';ctx.font=`bold ${p.width/18}px sans-serif`;ctx.fillText(geoError?'Map data failed to load':'Preparing your map…',p.width/2,p.height/2);return;}
  try{lastView=drawMap(ctx,p.width,p.height,p,frame,geo,previewCamera);if(pick?.pathId){const a=items().find(x=>x.id===pick.pathId);if(a)drawPathEditor(ctx,lastView,a);}}
  catch(error){console.error(error);showToast('Preview error: '+error.message);}
}
function setFrame(f,fromScroll=false){if(!pick)previewCamera=null;frame=clamp(Math.round(f)||0,0,p.frames-1);$('currentTime').textContent=fmt(frame);draw();if(!fromScroll)scrollToFrame();}
function scrollToFrame(){timelineSync=true;viewport.scrollLeft=frame/p.fps*SECOND*zoom;requestAnimationFrame(()=>timelineSync=false);}
function pause(){if(!playing)return;playing=false;$('previewPlayBtn').textContent='Play';cancelAnimationFrame(playRAF);$('playBtn').innerHTML='<svg viewBox="0 0 24 24"><path d="m8 5 12 7-12 7z" fill="currentColor" stroke="none"/></svg>';$('playBtn').setAttribute('aria-label','Play');}
function play(){if(playing)return;$('previewPlayBtn').textContent='Pause';previewCamera=null;if(frame>=p.frames-1)frame=0;playing=true;playT0=performance.now();playStart=frame;$('playBtn').innerHTML='<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zM14 5h4v14h-4z" fill="currentColor" stroke="none"/></svg>';$('playBtn').setAttribute('aria-label','Pause');const loop=t=>{if(!playing)return;const target=Math.round(playStart+(t-playT0)*p.fps/1000);if(target>=p.frames-1){setFrame(p.frames-1);pause();return;}if(target!==frame)setFrame(target);playRAF=requestAnimationFrame(loop);};playRAF=requestAnimationFrame(loop);}

async function initGeo(){try{const paths=['map-data/countries-50m.json','map-data/countries-110m.json'];const [hi,lo]=await Promise.all(paths.map(path=>fetch(path).then(r=>{if(!r.ok)throw Error(path+' HTTP '+r.status);return r.json();})));geo=buildGeo(hi,lo);geo.cities=CITIES;geo.imagery=createImagery({limit:180,concurrency:5});geo.imagery.onTile=()=>{if(!tileRAF)tileRAF=requestAnimationFrame(()=>{tileRAF=0;if(!activeExport)draw();});};$('loading').hidden=true;await checkDetail();refresh(true);}catch(e){console.error(e);geoError=e.message;$('loading').innerHTML='<span>Could not load maps. Serve this folder with a local web server, then reload.</span>';showToast('Map data unavailable');}}
async function loadDetail(country){if(!geo||geo.details?.has(country))return true;if(missingPacks.has(country))return false;if(loadingPacks.has(country))return loadingPacks.get(country);const task=(async()=>{try{const response=await fetch(detailFileOf(country));if(response.status===404){missingPacks.add(country);return false;}if(!response.ok)throw Error(`HTTP ${response.status}`);const data=await response.json();if(data.country!==country)throw Error('Incorrect detail pack');installCountryDetail(geo,data);refresh(false);if(sheet==='project'||sheet==='edit')renderSheet(true);return true;}catch(e){missingPacks.add(country);showToast('Detailed boundaries unavailable for '+country);console.warn(e);return false;}})();loadingPacks.set(country,task);return task;}
async function checkDetail(){if(!geo)return;const countries=new Set();if(p.area?.mode==='country')countries.add(p.area.country);for(const a of items())for(const loc of [a.target,a.from,a.to,a.place])if(loc?.kind==='region')countries.add(loc.country||p.area?.country||'Bangladesh');await Promise.all([...countries].map(loadDetail));}
function activeRegions(){return geo&&p.area?.mode==='country'?detailRegions(p,geo):[];}
function position(){if(!geo)return {lat:23.81,lon:90.4};const c=previewCamera||cameraAt(p,geo,p.width,p.height,frame);return {lat:Number((Math.atan(Math.sinh(Math.PI*(1-2*c.cy)))*180/Math.PI).toFixed(4)),lon:Number(((((c.cx*360)%360)+540)%360-180).toFixed(4))};}
function pointAtCenter(){const o=position();return {kind:'point',name:`${o.lat.toFixed(2)}, ${o.lon.toFixed(2)}`,lat:o.lat,lon:o.lon};}
function preferredTarget(){const a=p.area||DEFAULT_AREA;return {kind:'country',name:a.mode==='country'?a.country:'Bangladesh'};}
function locationText(l){return l?.kind==='all'?'All borders':l?.name||'';}
function parseLocation(value,kinds='any'){const text=String(value||'').trim(),lower=text.toLowerCase();if(!text)return null;
  if(kinds==='border'&&['all','all borders','all countries'].includes(lower))return {kind:'all',name:'All countries'};
  if(kinds==='border'&&['all regions'].includes(lower)&&p.area?.mode==='country')return {kind:'all',name:'All regions',country:p.area.country,level:detailLevelOf(geo,p.area.country,p.area.detailLevel)};
  const regions=activeRegions();if(kinds!=='point'){const r=regions.find(f=>f.key.toLowerCase()===lower||f.name.toLowerCase()===lower);if(r&&kinds!=='point')return {kind:'region',name:r.key,country:p.area.country};
  const match=geo?.names.find(n=>n.toLowerCase()===lower);if(match)return {kind:'country',name:match};}
  if(kinds==='border')return null;
  const city=CITIES.find(c=>c[0].toLowerCase()===lower)||geo?.details?.get(p.area?.country)?.cities?.find(c=>c[0].toLowerCase()===lower);if(city)return {kind:'city',name:city[0],lat:city[1],lon:city[2]};
  const m=text.match(/^(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)$/);if(m&&Math.abs(+m[1])<=90&&Math.abs(+m[2])<=180)return {kind:'point',name:`${(+m[1]).toFixed(2)}, ${(+m[2]).toFixed(2)}`,lat:+m[1],lon:+m[2]};return null;}
function datalist(){const cityNames=[...(geo?.details?.get(p.area?.country)?.cities||[]),...CITIES];return `<datalist id="placesData"><option value="All borders"></option><option value="All regions"></option>${(geo?.names||[]).map(n=>`<option value="${esc(n)}"></option>`).join('')}${activeRegions().map(r=>`<option value="${esc(r.name)}"></option>`).join('')}${cityNames.map(c=>`<option value="${esc(c[0])}"></option>`).join('')}</datalist>`;}

function refresh(force=false,doTimeline=true){updateStats();if(doTimeline)renderTimeline();updateSelected();draw();if(force&&sheet)renderSheet(true);void checkDetail();}
function updateSelected(){const it=current(),strip=$('selectedStrip');const left=it?`<span><span class="strip-dot"></span>${esc(it.name)} <b>· ${fmt(it.start)}</b></span>`:'<span><span class="strip-dot"></span> Tap <b>+</b> to add an animation</span>';strip.querySelector('span:first-child').outerHTML=left;}
const pixelPerFrame=()=>SECOND*zoom/p.fps;
function renderTimeline(){const v=viewport,old=v.scrollLeft,half=v.clientWidth/2||180;const dur=p.frames/p.fps;const w=Math.max(v.clientWidth||350,2*half+dur*SECOND*zoom+half);
 const content=$('timelineContent');content.style.width=w+'px';const pix=pixelPerFrame();const ticks=[];const step=zoom>2?1:2;for(let t=0;t<=dur+0.1;t+=step){ticks.push(`<div class="tick major" style="left:${half+t*SECOND*zoom}px">${String(Math.floor(t/60)).padStart(2,'0')}:${String(t%60).padStart(2,'0')}</div>`);}
 let html=`<div class="ruler">${ticks.join('')}</div>`;const entries=[...p.shots.map(x=>({...x,_track:'shot'})),...p.actions.map(x=>({...x,_track:x.type}))];
 const rows=entries.length?entries:[null];for(const it of rows){html+='<div class="timeline-lane">';if(it){const pair=colors[it._track]||colors.shot;const left=half+it.start*pix,width=Math.max(24,it.dur*pix);html+=`<div class="clip ${selected===it.id?'selected':''}" data-clip="${esc(it.id)}" style="left:${left}px;width:${width}px;--clip-bg:${pair[1]}aa;--clip-border:${pair[0]}bb"><span class="clip-icon">${icons[it._track]||'●'}</span><span class="clip-name">${esc(it.name)}</span><span class="clip-handle" data-resize="1">Ⅱ</span></div>`;}html+='</div>';}
 content.innerHTML=html;if(!timelineSync)v.scrollLeft=frame*pix;}
function selectItem(id){selected=id;renderTimeline();updateSelected();if(sheet==='edit')renderSheet(true);else openSheet('edit');}
function addAction(type){pause();const location=pointAtCenter();const a=makeAction(type,frame);if(type==='border'||type==='highlight')a.target=preferredTarget();if(type==='pin'||type==='object'||type==='effect')a.place=location;if(type==='plane'){a.from=location;a.to={kind:'point',name:'Destination',lat:clamp(location.lat+4,-85,85),lon:clamp(location.lon+7,-180,180)};}if(type==='shape')a.path=[];if(type==='label'){a.text='Your map title';a.labelPlacement='screen';a.x=50;a.y=14;}mutate(()=>{a.dur=Math.min(a.dur,Math.max(1,p.frames-frame));a.animDur=a.dur;p.actions.push(a);});selected=a.id;renderTimeline();updateSelected();openSheet('edit');showToast(`${ACTION_TYPES[type].label} added to timeline`);}
function addCamera(preset){pause();const c=pointAtCenter(),s=makeShot(preset,frame,{target:c});if(['flyTo','swoop'].includes(preset))s.zoom=clamp((previewCamera||cameraAt(p,geo,p.width,p.height,frame)).zoom+1,0,12);if(['followPlane','framePlane'].includes(preset))s.planeId=p.actions.find(a=>a.type==='plane')?.id||'';mutate(()=>{s.dur=Math.min(s.dur,Math.max(1,p.frames-frame));p.shots.push(s);});selected=s.id;renderTimeline();updateSelected();openSheet('edit');showToast('Camera movement added');}
function deleteItem(){const a=current();if(!a)return;mutate(()=>{p.actions=p.actions.filter(x=>x.id!==a.id);p.shots=p.shots.filter(x=>x.id!==a.id);selected=null;},{redrawSheet:true});showToast('Layer removed');}
function duplicate(){const a=current();if(!a)return;mutate(()=>{const b=copy(a);b.id=globalThis.crypto?.randomUUID?.()||`mf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`;b.start=Math.min(p.frames-1,a.start+a.dur);b.name=a.name+' copy';(b.kind==='shot'?p.shots:p.actions).push(b);selected=b.id;},{redrawSheet:true});showToast('Layer duplicated');}

const field=(key,label,value,type='text',extra='')=>`<label class="field"><span>${esc(label)}</span><input data-field="${esc(key)}" type="${type}" value="${esc(value)}" ${extra}></label>`;
const select=(key,label,value,opts)=>`<label class="field"><span>${esc(label)}</span><select data-field="${esc(key)}">${opts.map(([v,l])=>`<option value="${esc(v)}" ${String(v)===String(value)?'selected':''}>${esc(l)}</option>`).join('')}</select></label>`;
const checkbox=(key,label,on)=>`<label class="field check"><input data-field="${esc(key)}" type="checkbox" ${on?'checked':''}><span>${esc(label)}</span></label>`;
const loc=(key,label,location,kind='any')=>`<div class="field-row"><label class="field"><span>${esc(label)}</span><input data-field="${esc(key)}" data-location="${kind}" value="${esc(locationText(location))}" list="placesData" placeholder="City, country or lat, lon"></label><button class="pick-btn" data-pick="${key}" title="Tap the map to set this location">◎ Pick</button></div>`;
const shade=(key,label,value)=>field(key,label,value,'color');
const sub=(v)=>`<p class="section-label">${v}</p>`;
const options=o=>Object.entries(o).map(([a,b])=>[a,typeof b==='string'?b:b?.label||a]);
const range=(key,label,value,min,max,step=1)=>`<label class="field"><span>${esc(label)}</span><input data-field="${esc(key)}" type="range" value="${esc(value)}" min="${min}" max="${max}" step="${step}"></label>`;
function editItemMarkup(it){if(!it)return `<p class="muted-copy">Select a clip from the timeline, or add a new one using the Add tool.</p><button class="main-button" data-open="add">+ Add animation</button>`;
 let html=sub('CLIP')+field('name','Layer name',it.name)+`<div class="field-grid">${field('start','Start (seconds)',(it.start/p.fps).toFixed(2),'number','step="0.1" min="0"')}${field('dur','Length (seconds)',(it.dur/p.fps).toFixed(2),'number','step="0.1" min="0.03"')}</div>`+select('easing','Animation easing',it.easing,[['easeInOut','Smooth'],['linear','Linear'],['easeIn','Ease in'],['easeOut','Ease out'],['backOut','Overshoot'],['hold','Hold']]);
 if(it.kind==='shot'){
  html+=sub('CAMERA MOVEMENT')+select('preset','Camera effect',it.preset,options(PRESETS));
  if(['flyTo','swoop','panTo'].includes(it.preset))html+=loc('target','Move to',it.target);
  if(['flyTo','swoop','followPlane'].includes(it.preset))html+=range('zoom','Target zoom',it.zoom,0,12,.1);
  if(['flyTo','swoop','orbit','tilt','framePlane','followPlane'].includes(it.preset))html+=`<div class="field-grid">${field('pitch','Tilt (°)',it.pitch,'number','min="0" max="75"')}${field('bearing','Rotation (°)',it.bearing||0,'number')}</div>`;
  if(['pushIn','pullBack','orbit','tilt'].includes(it.preset))html+=range('amount','Movement intensity',it.amount,0,4,.1);
  if(it.preset==='orbit')html+=field('degrees','Orbit degrees',it.degrees,'number');
  if(['flyTo','swoop'].includes(it.preset))html+=checkbox('autoFit','Fit selected area',it.autoFit);
  if(['followPlane','framePlane'].includes(it.preset))html+=select('planeId','Follow travel layer',it.planeId,[['','Choose traveler'],...p.actions.filter(a=>a.type==='plane').map(a=>[a.id,a.name])]);
 } else if(it.type==='border')html+=sub('BORDER STYLE')+loc('target','Country / region',it.target,'border')+`<div class="field-grid">${shade('color','Border color',it.color)}${field('width','Line width',it.width,'number','min="0.5" max="20" step="0.5"')}${field('fillAlpha','Fill opacity (0–1)',it.fillAlpha,'number','min="0" max="1" step="0.05"')}${checkbox('glow','Glow effect',it.glow)}</div>`;
 else if(it.type==='highlight')html+=sub('HIGHLIGHT')+loc('target','Country / location',it.target)+field('label','Display label',it.label||'')+`<div class="field-grid">${shade('color','Highlight color',it.color)}${field('dim','Darken surroundings (0–1)',it.dim,'number','step="0.05" min="0" max="1"')}</div>`+checkbox('showLabel','Show label',it.showLabel)+checkbox('pulse','Pulse',it.pulse);
 else if(it.type==='pin')html+=sub('MAP PIN')+loc('place','Position',it.place)+field('label','Custom label (optional)',it.label||'')+`<div class="field-grid">${shade('color','Pin color',it.color)}${field('size','Size',it.size,'number','step="0.1" min="0.2" max="80"')}</div>`+checkbox('showIcon','Show icon',it.showIcon)+checkbox('showLabel','Show label',it.showLabel);
 else if(it.type==='plane')html+=sub('TRAVEL ROUTE')+select('mode','Route mode',it.mode||'direct',[['direct','Direct great-circle path'],['path','Draw my own route']])+(it.mode==='path'?pathControls(it):loc('from','From',it.from)+loc('to','To',it.to))+`<div class="field-grid">${select('icon','Traveler icon',it.icon,options(TRAVEL_ICONS))}${field('size','Icon size',it.size,'number','min="0.2" max="80" step="1"')}${shade('color','Route color',it.color)}${shade('planeColor','Icon color',it.planeColor)}</div>`+checkbox('showPath','Show route line',it.showPath)+checkbox('showLabels','Show endpoints',it.showLabels)+checkbox('showRouteLabels','Label places on route',it.showRouteLabels);
 else if(it.type==='object')html+=sub('OBJECT')+select('glyph','Object type',it.glyph,options(OBJECT_ICONS))+(it.mode==='path'?pathControls(it):loc('place','Position',it.place))+`<div class="field-grid">${select('mode','Movement',it.mode,[['stay','Stay in place'],['path','Follow drawn path']])}${field('size','Scale',it.size,'number','min="0.2" max="80" step="0.1"')}${shade('color','Object color',it.color)}${select('idle','Idle effect',it.idle,OBJECT_IDLE)}</div>`+field('label','Object label',it.label||'')+checkbox('showLabel','Show label',it.showLabel);
 else if(it.type==='effect')html+=sub('VISUAL EFFECT')+select('fx','Effect',it.fx,options(EFFECTS))+loc('place','Effect location',it.place)+(it.fx==='strike'?loc('from','Launch position',it.from):'')+`<div class="field-grid">${shade('color','Effect color',it.color)}${field('size','Scale',it.size,'number','min="0.2" max="80" step="0.1"')}${field('repeat','Repeat',it.repeat,'number','min="1" max="10"')}</div>`;
 else if(it.type==='shape')html+=sub('DRAW ON MAP')+select('shape','Shape',it.shape,options(SHAPES))+pathControls(it)+`<div class="field-grid">${shade('color','Color',it.color)}${field('width','Stroke width',it.width,'number','min="0.5" max="20"')}${field('fillAlpha','Fill opacity',it.fillAlpha,'number','min="0" max="1" step="0.05"')}</div>`;
 else if(it.type==='label')html+=sub('TEXT')+field('text','Text',it.text)+select('labelPlacement','Position',it.labelPlacement||'screen',[['screen','On screen'],['map','Attached to map']])+(it.labelPlacement==='map'?loc('place','Map position',it.place):`<div class="field-grid">${field('x','X (%)',it.x,'number','min="0" max="100"')}${field('y','Y (%)',it.y,'number','min="0" max="100"')}</div>`)+`<div class="field-grid">${field('labelStyle.size','Text size',it.labelStyle?.size||24,'number','min="6" max="80"')}${shade('labelStyle.text','Text color',it.labelStyle?.text||'#ffffff')}</div>`;
 html+=`<hr class="divider"><div class="sheet-actions"><button data-action="duplicate" class="secondary-button">⧉ Duplicate</button><button data-action="delete" class="danger-button">✕ Delete layer</button></div>`+datalist();return html;
}
function pathControls(it){return `<p class="muted-copy">${it.path?.length||0} waypoints. Tap “Draw on map”, then tap points in order. Hit Done when finished.</p><button class="main-button" data-action="drawpath">➜ Draw on map</button>`+select('curve','Path shape',it.curve||'smooth',options(PATH_CURVES));}
function addMarkup(){return `${sub('ANIMATION LAYERS')}<div class="tiles">${Object.entries(ACTION_TYPES).map(([key,val])=>`<button class="tile" data-add="${key}"><span class="tile-icon">${icons[key]}</span>${esc(val.label)}</button>`).join('')}</div>${sub('WORKFLOW')}<p class="muted-copy">Add an animation at the current playhead. Select its clip to change location, color, timing, and movement. Camera movements have their own timeline clips.</p><button class="main-button" data-open="camera">✦ Add a camera movement</button>`;}
function cameraMarkup(){return `${sub('CINEMATIC CAMERA PRESETS')}<div class="tiles">${Object.entries(PRESETS).map(([key,val])=>`<button class="tile" data-camera="${key}"><span class="tile-icon">${val.icon}</span>${esc(val.label)}</button>`).join('')}</div><hr class="divider"><p class="muted-copy">Camera clips are editable on the timeline. You can also drag and pinch the preview, then apply that view as your starting camera in Project settings.</p>`;}
function styleMarkup(){const area=p.area||DEFAULT_AREA;return `${sub('MAP APPEARANCE')}<div class="tiles">${Object.entries(THEMES).map(([key,v])=>`<button class="tile ${p.theme===key?'selected':''}" data-theme="${key}"><span class="tile-icon" style="color:${v.land?.[0]||'#d6ff82'}">◉</span>${esc(v.label)}</button>`).join('')}</div>${sub('OVERLAYS')}${checkbox('p.graticule','Show latitude / longitude grid',p.graticule)}${select('p.texture.type','Map texture',p.texture?.type||'none',options(TEXTURES))}${range('p.texture.strength','Texture strength',p.texture?.strength||0,.0,1,.05)}${range('p.texture.scale','Texture size',p.texture?.scale||1,.5,3,.1)}${p.theme==='satellite'?`<p class="muted-copy">Satellite imagery uses NASA or Esri online tiles. An internet connection and source licensing may be required for exported videos.</p>${select('p.imagery','Imagery source',p.imagery||'gibs',[['gibs','NASA Blue Marble'],['esri','Esri World Imagery']])}`:''}${sub('MAP LABELS')}${range('p.labelStyle.size','Label size',p.labelStyle.size,6,80,1)}${select('p.labelStyle.shape','Label background',p.labelStyle.shape,options(LABEL_SHAPES))}`;}
function projectMarkup(){const a={...DEFAULT_AREA,...p.area};const countries=geo?.names||['Bangladesh','Myanmar'];const info=geo&&a.mode==='country'?detailInfo(geo,a.country):null;const levels=info?.levels||[];const duration=(p.frames/p.fps).toFixed(1);
 return `${sub('PROJECT')}${field('p.name','Project name',p.name)}<div class="field-grid">${select('p.size','Canvas ratio',`${p.width},${p.height}`,[['720,1280','9:16 Portrait'],['1280,720','16:9 Landscape'],['1080,1080','1:1 Square']])}${select('p.fps','Frame rate',p.fps,[[24,'24 FPS'],[30,'30 FPS'],[60,'60 FPS']])}${field('p.duration','Duration (seconds)',duration,'number','min="1" max="3600" step="1"')}</div>${sub('MAP AREA')}${select('p.area.mode','Map mode',a.mode,options(AREA_MODES))}${a.mode==='country'?select('p.area.country','Country',a.country,countries.map(c=>[c,c]))+select('p.area.neighbors','Nearby countries',a.neighbors,options(NEIGHBOR_MODES))+(levels.length?select('p.area.detailLevel','Boundary level',a.detailLevel||info.defaultLevel,levels):'<p class="muted-copy">Detailed regional borders are included for Bangladesh and Myanmar. Other countries show national borders.</p>')+checkbox('p.area.fit','Automatically frame this country',a.fit)+checkbox('p.area.name','Show country name',a.name)+checkbox('p.area.cities','Show cities',a.cities):'<p class="muted-copy">World map uses Natural Earth global boundaries.</p>'}${sub('START CAMERA')}<div class="field-grid">${field('p.camera.init.lon','Longitude',p.camera.init.lon,'number','min="-180" max="180" step="0.01"')}${field('p.camera.init.lat','Latitude',p.camera.init.lat,'number','min="-85" max="85" step="0.01"')}${field('p.camera.init.zoom','Zoom',p.camera.init.zoom,'number','min="0" max="12" step="0.1"')}${field('p.camera.init.pitch','3D tilt',p.camera.init.pitch||0,'number','min="0" max="75"')}${field('p.camera.init.bearing','Rotation',p.camera.init.bearing||0,'number','min="-180" max="180"')}</div><div class="sheet-actions"><button data-action="applyview" class="secondary-button">◎ Use preview view</button><button data-action="resetview" class="secondary-button">↺ Reset preview</button></div>${sub('PROJECT FILES')}<div class="sheet-actions"><button data-action="savejson" class="secondary-button">↓ Save project JSON</button><button data-action="import" class="secondary-button">↑ Open project JSON</button><button data-action="new" class="danger-button">＋ New project</button></div><p class="muted-copy">Projects autosave on this device. JSON files remain compatible with the original FrameFlow Map Studio.</p>`;}
function layersMarkup(){return items().length?items().map(it=>`<button class="list-card ${it.id===selected?'selected':''}" data-select="${esc(it.id)}"><span class="list-icon">${icons[it.kind==='shot'?'shot':it.type]||'●'}</span><span><strong>${esc(it.name)}</strong><small>${esc(nameOf(it))} • ${fmt(it.start)} → ${fmt(it.start+it.dur)}</small></span><span class="list-chevron">›</span></button>`).join(''):'<p class="muted-copy">No layers yet. Tap Add to create an animation.</p>'}
function exportMarkup(){return `${sub('EXPORT PROJECT')}<button class="list-card" data-action="video"><span class="list-icon">▶</span><span><strong>Export video · WebM</strong><small>${p.width}×${p.height} · ${p.fps} FPS · ${fmt(p.frames)} — frame-accurate</small></span><span class="list-chevron">›</span></button><button class="list-card" data-action="png"><span class="list-icon">▧</span><span><strong>Save current frame · PNG</strong><small>Full-resolution image at ${fmt(frame)}</small></span><span class="list-chevron">›</span></button><button class="list-card" data-action="savejson"><span class="list-icon">{ }</span><span><strong>Save editable project · JSON</strong><small>Import back into Mapflow or FrameFlow Map Studio</small></span><span class="list-chevron">›</span></button><p class="muted-copy">WebM video export requires browser WebCodecs support (best in current Chrome/Edge on Android or desktop). Some iPhones do not support this format; PNG and JSON export are available there.</p>`;}
function openSheet(tool){pause();sheet=tool;renderSheet(false);$('sheet').classList.add('open');$('sheet').setAttribute('aria-hidden','false');$('scrim').hidden=false;document.querySelectorAll('.toolnav-item').forEach(b=>b.classList.toggle('active',b.dataset.tool===tool));}
function renderSheet(preserve){if(!sheet)return;const titles={add:['MAPFLOW TOOLS','Add to map'],edit:['PROPERTIES',current()?.name||'Edit a layer'],camera:['CAMERA','Camera movements'],style:['LOOK & FEEL','Map style'],project:['SETTINGS','Project settings'],layers:['MANAGE','All layers'],export:['SHARE','Export your map']};const [eyebrow,title]=titles[sheet]||titles.add;$('sheetEyebrow').textContent=eyebrow;$('sheetTitle').textContent=title;const content=$('sheetContent'),top=preserve?content.scrollTop:0;content.innerHTML={add:addMarkup,edit:()=>editItemMarkup(current()),camera:cameraMarkup,style:styleMarkup,project:projectMarkup,layers:layersMarkup,export:exportMarkup}[sheet]();content.scrollTop=top;}
function closeSheet(){sheet='';$('sheet').classList.remove('open');$('sheet').setAttribute('aria-hidden','true');$('scrim').hidden=true;document.querySelectorAll('.toolnav-item').forEach(b=>b.classList.toggle('active',b.dataset.tool==='add'));}
function getValuePath(obj,path){return path.split('.').reduce((a,k)=>a?.[k],obj);}
function setValuePath(obj,path,val){const segments=path.split('.');let root=obj;while(segments.length>1){const k=segments.shift();root[k]??={};root=root[k];}root[segments[0]]=val;}
function commitField(el,live=false){const key=el.dataset.field;if(!key)return;const target=key.startsWith('p.')?p:current();if(!target)return;const k=key.startsWith('p.')?key.slice(2):key;let val=el.type==='checkbox'?el.checked:el.value;
 if(key==='p.size'){const [w,h]=val.split(',').map(Number);mutate(()=>{p.width=w;p.height=h;p.area={...DEFAULT_AREA,...p.area};previewCamera=null;},{redrawSheet:true});return;}
 if(key==='p.duration'){const n=Number(val);if(!Number.isFinite(n)||n<1||n>3600){showToast('Duration must be 1–3600 seconds');return;}const nextFrames=Math.max(2,sec(n));mutate(()=>{p.frames=Math.max(nextFrames,...items().map(i=>i.start+i.dur));frame=Math.min(frame,p.frames-1);},{redrawSheet:true});return;}
 else if(el.dataset.location){const l=parseLocation(val,el.dataset.location);if(!l){showToast('Enter a listed place, country, region or lat, lon');el.value=locationText(getValuePath(target,k));return;}val=l;}
 else if(key==='p.area.detailLevel'){val=String(val);}
 else if(key==='p.fps'){val=Number(val);const realTime=p.frames/p.fps;const newFPS=val;mutate(()=>{const ratio=newFPS/p.fps;for(const it of items()){it.start=Math.round(it.start*ratio);it.dur=Math.max(1,Math.round(it.dur*ratio));if(it.animDur)it.animDur=Math.max(1,Math.round(it.animDur*ratio));}p.frames=Math.max(2,Math.round(realTime*newFPS));frame=Math.round(frame*ratio);p.fps=newFPS;},{redrawSheet:true});return;}
 else if(el.type==='number'||el.type==='range'){val=Number(val);if(!Number.isFinite(val))return;const limits={'camera.init.lon':[-180,180],'camera.init.lat':[-85,85],'camera.init.zoom':[0,12],'camera.init.pitch':[0,75],'camera.init.bearing':[-180,180],'texture.strength':[0,1],'texture.scale':[.5,3],'labelStyle.size':[6,80],zoom:[0,12],pitch:[0,75],width:[.5,20],size:[.2,80],fillAlpha:[0,1],dim:[0,1],repeat:[1,10],x:[0,100],y:[0,100]};if(limits[k]){val=clamp(val,...limits[k]);el.value=val;}}
 if(!key.startsWith('p.')&&(k==='dur'||k==='start')){val=sec(val);if(k==='dur')val=Math.max(1,val);else val=Math.max(0,val);}
 const prior=getValuePath(target,k);if(JSON.stringify(prior)===JSON.stringify(val))return;
 if(live&&editCheckpoint!==key){checkpoint();editCheckpoint=key;}else if(!live)checkpoint();
 setValuePath(target,k,val);
 if(k==='preset'&&target.kind==='shot'){const defs=PRESETS[val]?.def||{};Object.assign(target,defs);}
 if(k==='fx'&&target.type==='effect')target.color=EFFECTS[val]?.color||target.color;
 if(k==='glyph'&&target.type==='object')target.color=OBJECT_ICONS[val]?.color||target.color;
 if(k==='shape'&&target.type==='shape')target.color=SHAPES[val]?.color||target.color;
 if(k==='dur'&&target.type)target.animDur=val;
 if(k==='mode'&&target.type==='plane'&&val==='path'&&!target.path.length)target.path=[{lat:target.from.lat,lon:target.from.lon},{lat:target.to.lat,lon:target.to.lon}];
 extend();frame=clamp(frame,0,p.frames-1);previewCamera=null;store();refresh(false,true);
 if(!live){editCheckpoint=null;renderSheet(true);}if(k.startsWith('area.')){void checkDetail();renderSheet(true);}
}
function beginPick(key){const it=current();if(!it)return;pause();pick={item:it.id,key};closeSheet();$('placeHint').hidden=false;$('placeHintText').textContent='Tap map to set '+key;$('placeDone').hidden=true;$('stageInstruction').textContent='Tap your desired position on the map';}
function beginPath(){const a=current();if(!a||!['plane','shape','object'].includes(a.type))return;pause();mutate(()=>{a.path=[];a.mode='path';});pick={pathId:a.id};closeSheet();$('placeHint').hidden=false;$('placeHintText').textContent='Tap to place route points';$('placeDone').hidden=false;$('stageInstruction').textContent='Tap points in order • Done to finish';draw();}
function finishPick(cancel=false){const was=pick;pick=null;$('placeHint').hidden=true;$('stageInstruction').textContent='Drag to explore · Pinch to zoom';if(was?.pathId&&!cancel){const a=items().find(x=>x.id===was.pathId);if(a?.path?.length>=2){if(a.type==='plane'){a.from={kind:'point',name:'Start',...a.path[0]};a.to={kind:'point',name:'Finish',...a.path.at(-1)};}store();}else showToast('Add at least two route points');}draw();if(was?.item||was?.pathId)openSheet('edit');}

function onCanvasPoint(x,y){if(!geo||!lastView)return;const hit=screenToLonLat(lastView,x,y);if(!hit)return;if(pick?.pathId){const it=items().find(x=>x.id===pick.pathId);if(!it)return;if(it.path.length>=120){showToast('120 points maximum');return;}checkpoint();it.path.push({lat:hit.lat,lon:hit.lon});store();draw();$('placeHintText').textContent=`${it.path.length} points · Tap to add`;return;}
 if(pick?.item){const it=items().find(x=>x.id===pick.item);if(!it)return;let l={kind:'point',name:`${hit.lat.toFixed(2)}, ${hit.lon.toFixed(2)}`,lat:hit.lat,lon:hit.lon};if(pick.key==='target'&&['border','highlight'].includes(it.type)){const r=regionAt(p,geo,hit.lon,hit.lat);const c=countryAt(geo,hit.lon,hit.lat);if(r)l={kind:'region',name:r,country:p.area.country};else if(c)l={kind:'country',name:c};else if(it.type==='border'){showToast('Tap inside a country to draw a border');return;}}
 checkpoint();setValuePath(it,pick.key,l);store();refresh();finishPick();showToast('Location updated');}}
function pointerXY(e){const b=engineCanvas.getBoundingClientRect();return {sx:(e.clientX-b.left)/b.width*p.width,sy:(e.clientY-b.top)/b.height*p.height};}
function onPointerDown(e){if(!geo||e.button!==0)return;e.preventDefault();engineCanvas.setPointerCapture(e.pointerId);pointers.set(e.pointerId,{start:pointerXY(e),now:pointerXY(e),x:e.clientX,y:e.clientY});if(pointers.size===1){gesture={moved:false,origin:pointerXY(e),cam:previewCamera||cameraAt(p,geo,p.width,p.height,frame)};}else if(pointers.size===2){const [a,b]=[...pointers.values()];gesture={moved:true,dist:Math.hypot(a.x-b.x,a.y-b.y),cam:previewCamera||cameraAt(p,geo,p.width,p.height,frame)};}}
function onPointerMove(e){if(!pointers.has(e.pointerId)||!geo)return;e.preventDefault();const record=pointers.get(e.pointerId);const prev=record.now;record.now=pointerXY(e);record.x=e.clientX;record.y=e.clientY;
 if(pick)return;
 if(pointers.size===2){const [a,b]=[...pointers.values()],dist=Math.hypot(a.x-b.x,a.y-b.y);if(gesture?.dist&&dist>0){const point={sx:(a.now.sx+b.now.sx)/2,sy:(a.now.sy+b.now.sy)/2};const v=makeView(gesture.cam,p.width,p.height);previewCamera=zoomMapCamera(v,point,clamp(Math.log2(dist/gesture.dist),-4,4));draw();}return;}
 if(pointers.size===1){const moved=Math.hypot(record.now.sx-record.start.sx,record.now.sy-record.start.sy);if(moved>6)gesture.moved=true;const cam=previewCamera||cameraAt(p,geo,p.width,p.height,frame),v=makeView(cam,p.width,p.height);const result=panMapCamera(v,prev,record.now);if(result){previewCamera=result;draw();}}
}
function onPointerUp(e){const record=pointers.get(e.pointerId);if(!record)return;if(!gesture?.moved&&pointers.size===1&&pick)onCanvasPoint(record.now.sx,record.now.sy);pointers.delete(e.pointerId);if(!pointers.size)gesture=null;else if(pointers.size===1){const remaining=[...pointers.values()][0];remaining.start=remaining.now;gesture={moved:false,cam:previewCamera};}}

function download(blob,name){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
function safeName(){return (p.name||'Mapflow').replace(/[^a-z0-9_-]+/gi,'-').slice(0,60);}
function saveJson(){const blob=new Blob([JSON.stringify(p,null,2)],{type:'application/json'});download(blob,safeName()+'.json');showToast('Project downloaded');}
function exportPNG(){if(!geo){showToast('Map is still loading');return;}draw();engineCanvas.toBlob(blob=>{if(blob)download(blob,`${safeName()}-${fmt(frame).replace(/[:.]/g,'-')}.png`);else showToast('Could not save PNG');},'image/png');}
async function exportVideo(){if(activeExport||!geo)return;pause();closeSheet();activeExport=true;$('exportOverlay').hidden=false;$('exportProgress').style.width='0%';$('exportPercent').textContent='0%';$('exportMessage').textContent='Starting encoder…';const snapshot=copy(p);const canvas=document.createElement('canvas');canvas.width=snapshot.width;canvas.height=snapshot.height;const ec=canvas.getContext('2d',{alpha:false});try{if(typeof VideoEncoder==='undefined')throw Error('This browser does not support video encoding. Use current Chrome or Edge, or export PNG instead.');await checkDetail();const result=await exportMapVideo({canvas,fps:snapshot.fps,frames:snapshot.frames,draw:async f=>{if(THEMES[snapshot.theme]?.imagery){await geo.imagery.ready(imageryNeeds(snapshot,geo,canvas.width,canvas.height,f),()=>!activeExport);geo.imagery.prefetch(imageryNeeds(snapshot,geo,canvas.width,canvas.height,Math.min(f+5,snapshot.frames-1)));}drawMap(ec,canvas.width,canvas.height,snapshot,f,geo);},cancelled:()=>!activeExport,progress:n=>{const amount=Math.round(n/snapshot.frames*100);$('exportProgress').style.width=amount+'%';$('exportPercent').textContent=amount+'%';$('exportMessage').textContent=`Encoding frame ${n} of ${snapshot.frames}`;}});if(activeExport){download(result,safeName()+'.webm');showToast('Video exported successfully');}}catch(e){console.error(e);if(e.name==='AbortError'||!activeExport)showToast('Export canceled');else{showToast('Video export failed');window.alert('Mapflow export: '+(e.message||e));}}finally{activeExport=false;$('exportOverlay').hidden=true;draw();}}
function applyPreviewView(){const v=previewCamera;if(!v){showToast('Move or zoom the preview first');return;}mutate(()=>{p.camera.init.lon=(((v.cx*360-180+180)%360)+360)%360-180;p.camera.init.lat=Math.atan(Math.sinh(Math.PI*(1-2*v.cy)))*180/Math.PI;p.camera.init.zoom=clamp(v.zoom,0,12);p.camera.init.bearing=v.bearing;p.camera.init.pitch=v.pitch;p.area.fit=false;previewCamera=null;},{redrawSheet:true});showToast('Preview camera saved as start view');}
async function importJson(file){try{const content=await file.text();if(content.length>5_000_000)throw Error('Project JSON is too large');const test=JSON.parse(content);validateMapProject(test);pause();checkpoint();p=test;selected=null;previewCamera=null;frame=0;store();await checkDetail();refresh(true);closeSheet();openEditor();showToast('Project imported');}catch(e){showToast('Could not import project: '+e.message);}}

// Event handlers: only real user gestures trigger downloads, navigation and edits.
$('fullscreenBtn').onclick=()=>void togglePreviewFullscreen();
$('previewPlayBtn').onclick=()=>playing?pause():play();
document.addEventListener('fullscreenchange',()=>setPreviewExpanded(document.fullscreenElement===$('previewPanel'),!$('workspace').hidden));
$('newProjectBtn').onclick=createProject;
$('resumeProjectBtn').onclick=openEditor;
$('homeImportBtn').onclick=()=>$('importInput').click();
$('homeBtn').onclick=()=>{store();location.hash='home';};
window.addEventListener('hashchange',()=>showScreen(location.hash==='#editor'));
$('undoBtn').onclick=()=>undoRedo('undo');$('redoBtn').onclick=()=>undoRedo('redo');$('exportBtn').onclick=()=>openSheet('export');$('pngBtn').onclick=exportPNG;
$('projectName').onclick=()=>openSheet('project');$('closeSheet').onclick=closeSheet;$('scrim').onclick=closeSheet;
$('fitBtn').onclick=()=>{previewCamera=null;draw();showToast('Preview view reset');};
$('playBtn').onclick=()=>playing?pause():play();$('goStart').onclick=()=>{pause();setFrame(0);};$('goEnd').onclick=()=>{pause();setFrame(p.frames-1);};
$('layersBtn').onclick=()=>openSheet('layers');$('timelineZoomBtn').onclick=()=>{zoom=zoom>=2.5?0.7:Math.round((zoom+.45)*100)/100;$('timelineZoomBtn').textContent=zoom.toFixed(1)+'×';renderTimeline();};
$('placeDone').onclick=()=>finishPick();$('placeCancel').onclick=()=>finishPick(true);
$('cancelExport').onclick=()=>{activeExport=false;$('exportMessage').textContent='Cancelling export…';};
$('importInput').onchange=e=>{const file=e.target.files[0];if(file)void importJson(file);e.target.value='';};
document.querySelectorAll('.toolnav-item').forEach(button=>button.onclick=()=>{const type=button.dataset.tool;if(type==='edit'&&!current()){showToast('Select a clip from the timeline first');return;}openSheet(type);});
$('sheetContent').addEventListener('click',event=>{const button=event.target.closest('button');if(!button)return;
 if(button.dataset.add){addAction(button.dataset.add);return;}if(button.dataset.camera){addCamera(button.dataset.camera);return;}if(button.dataset.theme){mutate(()=>{p.theme=button.dataset.theme;},{redrawSheet:true});return;}
 if(button.dataset.open){openSheet(button.dataset.open);return;}if(button.dataset.select){selectItem(button.dataset.select);return;}if(button.dataset.pick){beginPick(button.dataset.pick);return;}
 const action=button.dataset.action;
 if(action==='delete'){deleteItem();return;}if(action==='duplicate'){duplicate();return;}if(action==='drawpath'){beginPath();return;}if(action==='savejson'){saveJson();return;}if(action==='png'){exportPNG();return;}if(action==='video'){void exportVideo();return;}if(action==='applyview'){applyPreviewView();return;}
 if(action==='resetview'){previewCamera=null;draw();showToast('Preview reset');return;}
 if(action==='import'){$('importInput').click();return;}
 if(action==='new'){createProject();return;}
});
$('sheetContent').addEventListener('input',e=>{const el=e.target;if(el.matches('input[type="range"]'))commitField(el,true);});
$('sheetContent').addEventListener('change',e=>{const el=e.target;if(!el.matches('[data-field]'))return;commitField(el,false);});
let lastTimelineLeft=viewport.scrollLeft;
viewport.addEventListener('scroll',()=>{
 const left=viewport.scrollLeft;if(left===lastTimelineLeft)return;lastTimelineLeft=left;
 if(timelineSync||scrollRAF)return;
 scrollRAF=requestAnimationFrame(()=>{scrollRAF=0;if(timelineSync)return;pause();setFrame(viewport.scrollLeft/pixelPerFrame(),true);});
},{passive:true});
let clipDrag=null,magnetic=true;
function snapGuide(target){
 const guide=$('snapGuide');guide.hidden=target===null;
 if(target!==null)guide.style.left=(viewport.clientWidth/2+target*pixelPerFrame()-viewport.scrollLeft)+'px';
}
$('magnetBtn').onclick=()=>{
 magnetic=!magnetic;$('magnetBtn').setAttribute('aria-pressed',String(magnetic));
 $('magnetBtn').textContent=magnetic?'Magnet on':'Magnet off';snapGuide(null);
};
$('timelineContent').addEventListener('pointerdown',e=>{
 const clip=e.target.closest('[data-clip]');if(!clip||e.button!==0)return;
 e.stopPropagation();pause();const it=items().find(x=>x.id===clip.dataset.clip);if(!it)return;
 // Touch pan-y lets the browser scroll layers; horizontal motion edits the clip.
 clipDrag={it,clip,pointer:e.pointerId,startX:e.clientX,startY:e.clientY,start:e.target.closest('[data-resize]')?it.dur:it.start,mode:e.target.closest('[data-resize]')?'resize':'move',moved:false,targets:[...new Set([0,frame,p.frames,...items().filter(x=>x.id!==it.id).flatMap(x=>[x.start,x.start+x.dur])])]};
 clip.setPointerCapture(e.pointerId);
});
$('timelineContent').addEventListener('pointermove',e=>{
 if(!clipDrag||clipDrag.pointer!==e.pointerId)return;
 const d=e.clientX-clipDrag.startX,dy=e.clientY-clipDrag.startY;
 if(!clipDrag.moved){
  if(Math.abs(dy)>5&&Math.abs(dy)>Math.abs(d)){clipDrag=null;return;}
  if(Math.abs(d)<=5)return;
  checkpoint();clipDrag.moved=true;selected=clipDrag.it.id;updateSelected();
  document.querySelectorAll('.clip.selected').forEach(el=>el.classList.remove('selected'));clipDrag.clip.classList.add('selected');
 }
 const frames=Math.round(d/pixelPerFrame()),drag=clipDrag,resize=drag.mode==='resize';
 const raw=resize?drag.it.start+Math.max(1,drag.start+frames):Math.max(0,drag.start+frames);
 const result=magnetic&&!e.shiftKey?snapTimeline({value:raw,targets:drag.targets,offsets:resize?[0]:[0,drag.it.dur],min:resize?drag.it.start+1:0,pixelsPerFrame:pixelPerFrame()}):{value:raw,target:null};
 snapGuide(result.target);
 if(resize){drag.it.dur=result.value-drag.it.start;drag.clip.style.width=Math.max(24,drag.it.dur*pixelPerFrame())+'px';}
 else{drag.it.start=result.value;drag.clip.style.left=(viewport.clientWidth/2+drag.it.start*pixelPerFrame())+'px';}
 draw();
});
function endClip(e){
 if(!clipDrag||clipDrag.pointer!==e.pointerId)return;
 const was=clipDrag;clipDrag=null;snapGuide(null);
 if(e.type==='pointercancel'){
  if(was.moved){if(was.mode==='resize')was.it.dur=was.start;else was.it.start=was.start;undo.pop();setUndo();refresh();}
  return;
 }
 if(was.moved){if(was.mode==='resize'&&was.it.type&&was.it.animDur)was.it.animDur=was.it.dur;extend();store();refresh();openSheet('edit');}
 else selectItem(was.it.id);
}
$('timelineContent').addEventListener('pointerup',endClip);$('timelineContent').addEventListener('pointercancel',endClip);
engineCanvas.addEventListener('pointerdown',onPointerDown);engineCanvas.addEventListener('pointermove',onPointerMove);engineCanvas.addEventListener('pointerup',onPointerUp);engineCanvas.addEventListener('pointercancel',onPointerUp);
engineCanvas.addEventListener('wheel',e=>{if(!geo||pick)return;e.preventDefault();const point=pointerXY(e),cam=previewCamera||cameraAt(p,geo,p.width,p.height,frame);previewCamera=zoomMapCamera(makeView(cam,p.width,p.height),point,e.deltaY>0?-.24:.24);draw();},{passive:false});
window.addEventListener('keydown',e=>{if($('workspace').hidden||e.target.matches?.('input,textarea,select'))return;if(e.key===' '&&e.target.closest?.('button'))return;if(e.key===' '){e.preventDefault();playing?pause():play();}else if(e.key==='Escape'){if($('previewPanel').classList.contains('preview-expanded')){void exitPreviewFullscreen();return;}if(pick)finishPick(true);else closeSheet();}else if(e.key==='ArrowLeft'){pause();setFrame(frame-1);}else if(e.key==='ArrowRight'){pause();setFrame(frame+1);}});
window.addEventListener('resize',()=>renderTimeline());document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});
showScreen(location.hash==='#editor',false);setFrame(0);void initGeo();
if('serviceWorker'in navigator&&location.protocol.startsWith('http')){
 const hadController=!!navigator.serviceWorker.controller;
 let updatePending=false,reloading=false;
 function applyAppUpdate(){
  if(!updatePending||reloading||activeExport||document.hidden)return;
  reloading=true;
  document.activeElement?.blur();
  if(!$('workspace').hidden)store();
  location.reload();
 }
 navigator.serviceWorker.addEventListener('controllerchange',()=>{
  if(hadController){updatePending=true;applyAppUpdate();}
 });
 navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).then(registration=>{
  const check=()=>registration.update().catch(e=>console.debug('Update check unavailable',e));
  void check();
  window.addEventListener('online',()=>{void check();});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){applyAppUpdate();void check();}});
 }).catch(e=>console.debug('Offline cache unavailable',e));
 // Let a running export finish before applying an available update.
 window.setInterval(applyAppUpdate,2000);
}
