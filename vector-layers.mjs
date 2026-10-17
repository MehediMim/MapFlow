// FrameFlow editable SVG vector layers. No external dependencies.
const TAGS = new Set(['svg','g','path','circle','rect','ellipse','line','polyline','polygon']);
const ATTRS = new Set(['d','cx','cy','r','rx','ry','x','y','x1','y1','x2','y2','width','height','points','transform','viewBox','stroke-linejoin','stroke-linecap','fill-rule','fill','stroke','stroke-width','opacity','fill-opacity','stroke-opacity','style','stroke-dasharray','stroke-dashoffset','stroke-miterlimit']);
const validColor = x => /^#[0-9a-f]{6}$/i.test(x || '');
const cache = new Map();
const esc = x => String(x).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
export function sanitizeSvg(input) {
  if (typeof input !== 'string' || input.length > 180000) throw Error('SVG must be smaller than 180 KB.');
  const doc = new DOMParser().parseFromString(input, 'image/svg+xml');
  const root = doc.documentElement;
  if (root.localName !== 'svg' || doc.querySelector('parsererror')) throw Error('Invalid SVG document');
  let vb = (root.getAttribute('viewBox') || '').trim();
  const nums = vb.split(/[\s,]+/).map(Number);
  if (nums.length !== 4 || nums.some(x => !Number.isFinite(x)) || nums[2] <= 0 || nums[3] <= 0) {
    const w = parseFloat(root.getAttribute('width')) || 100, h = parseFloat(root.getAttribute('height')) || 100;
    vb = `0 0 ${Math.max(1, Math.min(10000,w))} ${Math.max(1,Math.min(10000,h))}`;
  }
  let count = 0;
  function clean(el) {
    if (!TAGS.has(el.localName) || ++count > 350) return '';
    const attrs = [...el.attributes].filter(a=>ATTRS.has(a.name) && a.value.length < 16000 && !/url\s*\(|javascript\s*:|data\s*:/i.test(a.value))
      .map(a=>` ${a.name}="${esc(a.value)}"`).join('');
    return `<${el.localName}${attrs}>${[...el.children].map(clean).join('')}</${el.localName}>`;
  }
  const children = [...root.children].map(clean).join('');
  if (!children) throw Error('This SVG has no supported vector shapes.');
  const rootAttrs=[...root.attributes].filter(a=>ATTRS.has(a.name) && a.name!=='viewBox' && a.value.length<16000 && !/url\s*\(|javascript\s*:|data\s*:/i.test(a.value)).map(a=>` ${a.name}="${esc(a.value)}"`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${esc(vb)}"${rootAttrs}>${children}</svg>`;
}
function prepared(layer) {
  const key = [layer.svgMarkup,layer.vectorFill,layer.vectorStroke,layer.vectorStrokeWidth,layer.vectorOverride,layer.isDrawnLine].join('|');
  if (cache.has(key)) return cache.get(key);
  const dom = new DOMParser().parseFromString(layer.svgMarkup, 'image/svg+xml');
  const root = dom.documentElement;
  const vb = (root.getAttribute('viewBox')||'0 0 100 100').split(/[\s,]+/).map(Number);
  const fill = validColor(layer.vectorFill) ? layer.vectorFill : '#b6f36e';
  const stroke = validColor(layer.vectorStroke) ? layer.vectorStroke : '#ffffff';
  const width = Math.max(0,Math.min(80,+layer.vectorStrokeWidth||0));
 if(layer.isDrawnLine){for(const el of root.querySelectorAll('path')){el.setAttribute('fill','none');el.setAttribute('stroke',stroke);el.setAttribute('stroke-width',String(width));}}
 else if(layer.vectorOverride){root.setAttribute('fill',fill);root.setAttribute('stroke',stroke);root.setAttribute('stroke-width',String(width));for(const el of root.querySelectorAll('*')){el.removeAttribute('fill');el.removeAttribute('stroke');el.removeAttribute('stroke-width');el.removeAttribute('style');}}
  const paths=[...root.querySelectorAll('path')].filter(p=>p.getAttribute('d'));
  const pathInfo=paths.map(p=>{try {return {d:p.getAttribute('d'),length:p.getTotalLength(),el:p};}catch{return null}}).filter(Boolean);
  const svg = new XMLSerializer().serializeToString(root);
  const image=new Image();const uri='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
  const item={image,vb,pathInfo};cache.set(key,item);
  image.onload=()=>window.dispatchEvent(new Event('ff-vector-loaded'));
  image.src=uri;
  if (cache.size>80) cache.delete(cache.keys().next().value);
  return item;
}
function progress(layer,frame){
  const dur=Math.max(1,+layer.vectorDuration||40);
  return Math.max(0,Math.min(1,(frame-(layer.vectorStart??layer.in))/dur));
}
// Puppet-pin positions are in 0..1 SVG-image coordinates; keyframes are in timeline frames.
export function pinAt(layer,frame){
 const pin=layer.puppetPin;
 if(!pin)return null;
 const keys=[...(pin.keys||[])].sort((a,b)=>a.f-b.f);
 if(!keys.length)return {x:pin.x,y:pin.y};
 if(frame<=keys[0].f)return {x:keys[0].x,y:keys[0].y};
 if(frame>=keys.at(-1).f)return {x:keys.at(-1).x,y:keys.at(-1).y};
 for(let i=1;i<keys.length;i++)if(frame<=keys[i].f){const a=keys[i-1],b=keys[i],t=(frame-a.f)/(b.f-a.f);const q=t*t*(3-2*t);return {x:a.x+(b.x-a.x)*q,y:a.y+(b.y-a.y)*q};}
 return {x:pin.x,y:pin.y};
}
export function setPinKey(layer,frame,x,y){
 const pin=layer.puppetPin;if(!pin)return;
 if(!Array.isArray(pin.keys))pin.keys=[];
 const key=pin.keys.find(k=>k.f===frame);
 if(key){key.x=x;key.y=y;}else pin.keys.push({f:frame,x,y});
 pin.keys.sort((a,b)=>a.f-b.f);
}
// Piecewise-affine image mesh.  The SVG image is the source, so existing per-shape
// fills and strokes remain intact; only the geometry of a localized region moves.
function triangle(ctx,image,sw,sh,a,b,c){
 const det=(b.sx-a.sx)*(c.sy-a.sy)-(c.sx-a.sx)*(b.sy-a.sy);
 if(Math.abs(det)<1e-7)return;
 const A=((b.dx-a.dx)*(c.sy-a.sy)-(c.dx-a.dx)*(b.sy-a.sy))/det;
 const B=((b.dy-a.dy)*(c.sy-a.sy)-(c.dy-a.dy)*(b.sy-a.sy))/det;
 const C=((c.dx-a.dx)*(b.sx-a.sx)-(b.dx-a.dx)*(c.sx-a.sx))/det;
 const D=((c.dy-a.dy)*(b.sx-a.sx)-(b.dy-a.dy)*(c.sx-a.sx))/det;
 const E=a.dx-A*a.sx-C*a.sy,F=a.dy-B*a.sx-D*a.sy;
 ctx.save();ctx.beginPath();ctx.moveTo(a.dx,a.dy);ctx.lineTo(b.dx,b.dy);ctx.lineTo(c.dx,c.dy);ctx.closePath();ctx.clip();
 ctx.transform(A,B,C,D,E,F);ctx.drawImage(image,0,0,sw,sh);ctx.restore();
}
function meshDraw(ctx,image,sw,sh,pin,pos){
 const n=12,rad=Math.max(.08,Math.min(.9,pin.radius??.32)), dx=(pos.x-pin.x)*sw,dy=(pos.y-pin.y)*sh;
 const verts=[];for(let y=0;y<=n;y++){const row=[];for(let x=0;x<=n;x++){
  const sx=sw*x/n,sy=sh*y/n;
  const distance=Math.hypot(x/n-pin.x,y/n-pin.y);
  // Fixed outer vertices keep the rest of the image stable.
  const weight=distance>=rad?0:Math.pow(1-distance/rad,2);
  row.push({sx,sy,dx:sx+dx*weight,dy:sy+dy*weight});
 }verts.push(row);}
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){
  const a=verts[y][x],b=verts[y][x+1],c=verts[y+1][x+1],d=verts[y+1][x];
  triangle(ctx,image,sw,sh,a,b,c);triangle(ctx,image,sw,sh,a,c,d);
 }
}
export function drawVector(ctx,layer,frame,w,h,showHandles=false){
 if(!layer.svgMarkup)return;
 const {image,vb,pathInfo}=prepared(layer),[minX,minY,sw,sh]=vb;
 if(!sw||!sh)return;
 ctx.save();ctx.translate(-w/2,-h/2);ctx.scale(w/sw,h/sh);ctx.translate(-minX,-minY);
 const t=progress(layer,frame);
 if(layer.vectorDraw && pathInfo.length && t<1){
  ctx.strokeStyle=(layer.vectorOverride||layer.isDrawnLine)?(layer.vectorStroke||'#ffffff'):'#ffffff';ctx.lineWidth=Math.max(1,+layer.vectorStrokeWidth||1);if(layer.isDrawnLine)ctx.lineCap=ctx.lineJoin='round';
  for(const {d,length} of pathInfo){if(length>0){ctx.setLineDash([length*t,length+1]);ctx.stroke(new Path2D(d));}}
  ctx.setLineDash([]);
 }else if(image.complete&&image.naturalWidth){
  const pin=layer.puppetPin,pos=pinAt(layer,frame);
  if(pin&&pos&&(Math.abs(pos.x-pin.x)+Math.abs(pos.y-pin.y)>1e-5)){
   ctx.translate(minX,minY);meshDraw(ctx,image,sw,sh,pin,pos);ctx.translate(-minX,-minY);
  }else ctx.drawImage(image,minX,minY,sw,sh);
 }
 if(showHandles && layer.puppetPin){const p=pinAt(layer,frame);if(p){
  const px=minX+p.x*sw,py=minY+p.y*sh,rr=Math.max(5,sw*0.018);
  ctx.lineWidth=rr*.24;ctx.strokeStyle='#07151b';ctx.fillStyle='#ffcf59';
  ctx.beginPath();ctx.arc(px,py,rr,0,2*Math.PI);ctx.fill();ctx.stroke();
  ctx.beginPath();ctx.moveTo(px-rr*1.65,py);ctx.lineTo(px+rr*1.65,py);ctx.moveTo(px,py-rr*1.65);ctx.lineTo(px,py+rr*1.65);ctx.stroke();
 }}
 ctx.restore();
}
export function vectorInspector(layer){
 if(layer.isDrawnLine)return `<div class="section-title">DRAWN LINE</div><label>Line color<input type="color" data-vector="vectorStroke" value="${validColor(layer.vectorStroke)?layer.vectorStroke:'#b6f36e'}"></label><label>Line width<input type="number" data-vector="vectorStrokeWidth" min="1" max="80" value="${layer.vectorStrokeWidth??5}"></label><label class="m-chk"><input type="checkbox" data-vector="vectorDraw" ${layer.vectorDraw?'checked':''}> Animate line drawing</label><div class="two"><label>Drawing start (seconds)<input type="number" data-vector="vectorStart" min="0" step=".033" value="${((layer.vectorStart??layer.in)/window.ffVectorFps).toFixed(2)}"></label><label>Drawing duration (seconds)<input type="number" data-vector="vectorDuration" min=".033" step=".033" value="${((layer.vectorDuration||40)/window.ffVectorFps).toFixed(2)}"></label></div>`;
 const color=(name,id,value)=>`<label>${name}<input type="color" data-vector="${id}" value="${validColor(value)?value:'#ffffff'}"></label>`;
 return `<div class="section-title" style="margin-top:14px">SVG / VECTOR</div>
 <p class="mini-label">Imported colors are preserved by default.</p>
 <label class="m-chk"><input type="checkbox" data-vector="vectorOverride" ${layer.vectorOverride?'checked':''}> Override original SVG colors</label>
 ${layer.vectorOverride?`<div class="two">${color('Fill','vectorFill',layer.vectorFill)}${color('Stroke','vectorStroke',layer.vectorStroke)}</div><label>Stroke width<input type="number" data-vector="vectorStrokeWidth" min="0" max="80" value="${layer.vectorStrokeWidth??5}"></label>`:''}
 <label class="m-chk"><input type="checkbox" data-vector="vectorDraw" ${layer.vectorDraw?'checked':''}> Draw SVG path over time</label>
 <div class="two"><label>Start (seconds)<input type="number" data-vector="vectorStart" min="0" step=".033" value="${((layer.vectorStart??layer.in)/window.ffVectorFps).toFixed(2)}"></label><label>Duration (seconds)<input type="number" data-vector="vectorDuration" min=".033" step=".033" value="${((layer.vectorDuration||40)/window.ffVectorFps).toFixed(2)}"></label></div>
 <div class="section-title" style="margin-top:14px">PUPPET PIN</div>
 <p class="mini-label">Add a pin; Alt-click the SVG to position its anchor without deforming it. Then move to another frame and drag the yellow handle to bend the artwork. Nearby artwork bends while distant parts stay in place.</p>
 ${layer.puppetPin?`<button id="vectorRemovePin" type="button">Remove pin</button><label>Influence radius<input id="vectorPinRadius" type="range" min="8" max="90" value="${Math.round((layer.puppetPin.radius??.32)*100)}"></label>`:`<button id="vectorAddPin" type="button">+ Add puppet pin</button>`}`;
}
export function bindVectorInspector(layer,commit,fps){
 window.ffVectorFps=fps;
 document.querySelectorAll('[data-vector]').forEach(el=>el.onchange=()=>{
  const name=el.dataset.vector;let value=el.type==='checkbox'?el.checked:el.type==='number'?Number(el.value):el.value;
  if(['vectorStart','vectorDuration'].includes(name)){
   value=Math.round(value*fps);const old=(layer[name]??(name==='vectorStart'?layer.in:40))/fps;
   if(!Number.isSafeInteger(value)){el.value=old;return;}value=Math.max(name==='vectorStart'?0:1,value);
   const start=name==='vectorStart'?value:(layer.vectorStart??layer.in),dur=name==='vectorDuration'?value:(layer.vectorDuration??40);
   if(!Number.isSafeInteger(start+dur)){el.value=old;return;}
  }
  if(typeof value==='number'&&!Number.isFinite(value))return;commit(layer,name,value);
 });
 document.getElementById('vectorAddPin')?.addEventListener('click',()=>commit(layer,'puppetPin',{x:.5,y:.5,radius:.32,keys:[{f:layer.in,x:.5,y:.5}]}));
 document.getElementById('vectorRemovePin')?.addEventListener('click',()=>commit(layer,'puppetPin',null));
 document.getElementById('vectorPinRadius')?.addEventListener('change',e=>commit(layer,'puppetPin',{...layer.puppetPin,radius:+e.target.value/100}));
}
export function validateVector(layer){
 if(typeof layer.svgMarkup!=='string'||layer.svgMarkup.length>180000||!/^<svg\b/.test(layer.svgMarkup))throw Error('Invalid vector SVG');
 for(const key of ['vectorFill','vectorStroke','vectorPinColor'])if(layer[key]!==undefined&&!validColor(layer[key]))throw Error('Invalid SVG color');
 for(const key of ['vectorStrokeWidth','vectorPinSize'])if(layer[key]!==undefined&&(!Number.isFinite(layer[key])||layer[key]<0||layer[key]>1800))throw Error('Invalid SVG setting');
 for(const key of ['vectorStart','vectorDuration'])if(layer[key]!==undefined&&(!Number.isSafeInteger(layer[key])||layer[key]<(key==='vectorStart'?0:1)))throw Error('Invalid SVG timing');
 const start=layer.vectorStart??layer.in,dur=layer.vectorDuration??40;
 if(!Number.isSafeInteger(start+dur))throw Error('Invalid SVG timing');
 const p=layer.puppetPin;
 if(p!=null){const xy=(x)=>Number.isFinite(x)&&x>=-2&&x<=3;
  if(!xy(p.x)||!xy(p.y)||!Number.isFinite(p.radius)||p.radius<.08||p.radius>.9||!Array.isArray(p.keys)||p.keys.length>300||p.keys.some(k=>!Number.isSafeInteger(k.f)||k.f<0||!xy(k.x)||!xy(k.y)))throw Error('Invalid puppet pin');
 }
}

export async function preloadVectors(scene){
 const waits=[];for(const layer of scene.layers||[]){if(layer.type!=='vector')continue;const im=prepared(layer).image;
 if(!im.complete||!im.naturalWidth)waits.push(im.decode());}
 await Promise.all(waits);
}
