import { validateVector } from './vector-layers.mjs';
import { validateExtras } from './motion-extras.mjs';
import { validateStructured } from './motion-structured.mjs';
import { validateChart } from './charts.mjs';
import { validateMotionPath } from './motion-path.mjs';
import { validateMotionVideo } from './motion-video.mjs';
export const PROPS=['x','y','scale','rotation','opacity','w','h','blur'];
export const easings={linear:t=>t,easeIn:t=>t*t*t,easeOut:t=>1-(1-t)**3,easeInOut:t=>t<.5?4*t*t*t:1-(-2*t+2)**3/2,backOut:t=>1+2.70158*(t-1)**3+1.70158*(t-1)**2,hold:t=>t>=1?1:0};
export function valueAt(layer,prop,frame){const keys=layer.keys[prop];if(!keys?.length)return layer[prop];const sorted=[...keys].sort((a,b)=>a.f-b.f);if(frame<=sorted[0].f)return sorted[0].v;if(frame>=sorted.at(-1).f)return sorted.at(-1).v;for(let i=1;i<sorted.length;i++){if(frame<=sorted[i].f){const a=sorted[i-1],b=sorted[i],t=(frame-a.f)/(b.f-a.f);return a.v+(b.v-a.v)*(easings[a.e]||easings.linear)(t)}}}
// Non-destructive, playhead-relative Motion FX. Every clip modifies the *current*
// keyframed pose, not a frozen pose sampled when the preset was inserted.
const fxClamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const fxSmooth=t=>t*t*(3-2*t);
function applyFxClip(p,fx,frame){
 const start=fx.start,dur=Math.max(1,fx.dur),end=start+dur;
 if(frame<start)return;
 const held=fx.endBehavior==='hold';
 // An explicit Return command freezes the effect at the playhead, then fades its
 // RELATIVE displacement out. The keyed layer keeps moving underneath.
 const releaseAt=Number.isSafeInteger(fx.returnStart)?fx.returnStart:null;
 const releasing=releaseAt!==null&&frame>=releaseAt;
 const at=releasing?releaseAt:frame;
 if(at>=end&&!held)return;
 const release=releasing?1-fxSmooth(fxClamp((frame-releaseAt)/Math.max(1,fx.returnDuration||1),0,1)):1;
 if(release<=0)return;
 const t=fxClamp((at-start)/dur,0,1),u=fxSmooth(t);
 const returning=!held;
 // Temporary effects rise and fall without a jump at either edge. Entrance
 // effects with Hold are true introductions: they arrive at the animated pose.
 const pulse=Math.sin(Math.PI*t)**2*release;
 const strength=(fx.kind==='in'?(returning?Math.sin(Math.PI*t)**2:1-u):fx.kind==='out'?(returning?Math.sin(Math.PI*t)**2:u):Math.sin(Math.PI*t)**2)*release;
 const distance=fxClamp(Number(fx.distance)||120,0,2000);
 const mult=fx.name==='pop'?.25:.7;
 switch(fx.name){
  case 'fade':p.opacity*=1-strength;break;
  case 'slide-left':p.x-=distance*strength;if(fx.kind!=='loop')p.opacity*=1-strength;break;
  case 'slide-right':p.x+=distance*strength;if(fx.kind!=='loop')p.opacity*=1-strength;break;
  case 'slide-up':p.y-=distance*strength;if(fx.kind!=='loop')p.opacity*=1-strength;break;
  case 'slide-down':p.y+=distance*strength;if(fx.kind!=='loop')p.opacity*=1-strength;break;
  case 'zoom':case 'pop':p.scale*=1-(1-mult)*strength;if(fx.kind!=='loop')p.opacity*=1-strength;break;
  case 'spin':p.rotation+=(fx.kind==='in'?-90:90)*strength;p.opacity*=1-strength;break;
  case 'pulse':p.scale*=1+.12*pulse;break;
  case 'float':p.y-=distance*.3*pulse;break;
  case 'bounce':p.y-=distance*.5*pulse;break;
  case 'sway':p.rotation+=8*pulse;break;
  case 'breathe':p.opacity*=1-.45*pulse;break;
  case 'rotate':p.rotation+=360*u*release;break;
  case 'blur':p.blur=fxClamp((p.blur??0)+fxClamp(Number(fx.amount)||0,0,80)*pulse,0,80);break;
 }
 p.opacity=fxClamp(p.opacity,0,1);p.scale=fxClamp(p.scale,.01,20);
}
export function poseAt(layer,frame){
 const p={...layer};for(const k of PROPS)p[k]=valueAt(layer,k,frame);
 // Sorted for deterministic overlapping effects, independent of insertion order.
 if(Array.isArray(layer.fxClips))for(const fx of [...layer.fxClips].sort((a,b)=>a.start-b.start||String(a.id).localeCompare(String(b.id))))applyFxClip(p,fx,frame);
 return p;
}
export function putKey(layer,prop,frame,value,easing='easeInOut'){const list=layer.keys[prop]||=[];const existing=list.find(k=>k.f===frame);if(existing){existing.v=value;existing.e=easing}else list.push({f:frame,v:value,e:easing});list.sort((a,b)=>a.f-b.f)}
export function validateProject(p){if(!p||p.version!==1||!Array.isArray(p.layers)||p.layers.length>200)throw Error('This is not a FrameFlow project.');if(![24,30,60].includes(p.fps)||!Number.isSafeInteger(p.frames)||p.frames<2)throw Error('Invalid frame settings.');if(!Number.isInteger(p.width)||!Number.isInteger(p.height)||p.width<100||p.height<100||p.width>3840||p.height>3840)throw Error('Invalid canvas size.');if(typeof p.bg!=='string'||!/^#[0-9a-f]{6}$/i.test(p.bg))throw Error('Invalid background color.');let ids=new Set;for(const l of p.layers){if(l.fxClips!==undefined){if(!Array.isArray(l.fxClips)||l.fxClips.length>150)throw Error('Invalid motion effects.');for(const fx of l.fxClips){if(!fx||typeof fx.id!=='string'||!['in','out','loop','blur'].includes(fx.kind)||typeof fx.name!=='string'||!Number.isSafeInteger(fx.start)||fx.start<0||fx.start>=p.frames||!Number.isSafeInteger(fx.dur)||fx.dur<1||fx.start+fx.dur>p.frames||!['return','hold'].includes(fx.endBehavior)||fx.distance!==undefined&&(!Number.isFinite(fx.distance)||fx.distance<0||fx.distance>2000)||fx.amount!==undefined&&(!Number.isFinite(fx.amount)||fx.amount<0||fx.amount>80)||fx.returnStart!==undefined&&(!Number.isSafeInteger(fx.returnStart)||fx.returnStart<fx.start||fx.returnStart>=p.frames)||fx.returnDuration!==undefined&&(!Number.isSafeInteger(fx.returnDuration)||fx.returnDuration<1||fx.returnDuration>p.frames))throw Error('Invalid motion effect clip.');}}if(l.blur===undefined)l.blur=0;if(!Number.isFinite(l.blur)||l.blur<0||l.blur>80)throw Error('Invalid layer blur.');if(l.depth!==undefined&&(!Number.isFinite(l.depth)||l.depth< -500||l.depth>500))throw Error('Invalid layer depth.');if(!['rect','circle','text','image','table','chart','list','diagram','group','vector','video'].includes(l.type)||typeof l.id!=='string'||ids.has(l.id)||!l.keys||typeof l.keys!=='object')throw Error('Invalid layer.');ids.add(l.id);if(l.parentId!==undefined&&typeof l.parentId!=='string')throw Error('Invalid group parent.');for(const prop of PROPS){if(!Number.isFinite(l[prop]))throw Error('Invalid transform.');if(l.keys[prop]&&!Array.isArray(l.keys[prop]))throw Error('Invalid keyframes.');for(const k of l.keys[prop]||[]){if(prop==='blur'&&(k.v<0||k.v>80))throw Error('Invalid blur keyframe.');if(!Number.isSafeInteger(k.f)||k.f<0||!Number.isFinite(k.v)||!Object.hasOwn(easings,k.e))throw Error('Invalid keyframe.')}}validateMotionPath(l.motionPath);if(l.type==='video')validateMotionVideo(l);if(l.type==='chart')validateChart(l.chart);if(l.type==='list'||l.type==='diagram')validateStructured(l);if(l.type==='vector')validateVector(l);if(l.type==='image'&&(!/^data:image\/(png|jpeg|webp|gif|avif);base64,/i.test(l.src||'')))throw Error('Unsupported image data.');if(l.fontFamily!==undefined&&(typeof l.fontFamily!=='string'||l.fontFamily.length>60))throw Error('Invalid font.');if(!Number.isFinite(l.in)||!Number.isFinite(l.out)||l.in<0||l.out<l.in)throw Error('Invalid layer timing.')}for(const l of p.layers){if(l.parentId){const g=p.layers.find(x=>x.id===l.parentId);if(!g||g.type!=='group'||g.parentId||l.type==='group')throw Error('Invalid group relationship.')}}validateExtras(p);return p}

// ---------------------------------------------------------------- Fonts (shared by Motion and Map Studio)
// g = generic fallback, w = Google Fonts weights to request, sys = already on most computers (nothing to download)
export const FONT_GROUPS = ['Basic', 'Sans-serif', 'Serif', 'Display & handwriting', 'Monospace', 'Bangla (বাংলা)'];
export const FONTS = [
  { n: 'Arial', g: 'sans-serif', c: 0, sys: 1 }, { n: 'Verdana', g: 'sans-serif', c: 0, sys: 1 }, { n: 'Trebuchet MS', g: 'sans-serif', c: 0, sys: 1 },
  { n: 'Georgia', g: 'serif', c: 0, sys: 1 }, { n: 'Times New Roman', g: 'serif', c: 0, sys: 1 }, { n: 'Courier New', g: 'monospace', c: 0, sys: 1 }, { n: 'Impact', g: 'sans-serif', c: 0, sys: 1 },
  { n: 'Inter', g: 'sans-serif', c: 1, w: '400;600;700;800' }, { n: 'Poppins', g: 'sans-serif', c: 1, w: '400;600;700;800' }, { n: 'Montserrat', g: 'sans-serif', c: 1, w: '400;600;700;800' },
  { n: 'Roboto', g: 'sans-serif', c: 1, w: '400;700' }, { n: 'Open Sans', g: 'sans-serif', c: 1, w: '400;600;700;800' }, { n: 'Lato', g: 'sans-serif', c: 1, w: '400;700' },
  { n: 'DM Sans', g: 'sans-serif', c: 1, w: '400;600;700' }, { n: 'Manrope', g: 'sans-serif', c: 1, w: '400;600;700;800' }, { n: 'Space Grotesk', g: 'sans-serif', c: 1, w: '400;600;700' },
  { n: 'Raleway', g: 'sans-serif', c: 1, w: '400;600;700;800' }, { n: 'Nunito', g: 'sans-serif', c: 1, w: '400;600;700;800' }, { n: 'Oswald', g: 'sans-serif', c: 1, w: '400;600;700' },
  { n: 'Playfair Display', g: 'serif', c: 2, w: '400;600;700;800' }, { n: 'Merriweather', g: 'serif', c: 2, w: '400;700' }, { n: 'Lora', g: 'serif', c: 2, w: '400;600;700' },
  { n: 'Source Serif 4', g: 'serif', c: 2, w: '400;600;700' }, { n: 'Cinzel', g: 'serif', c: 2, w: '400;600;700;800' },
  { n: 'Bebas Neue', g: 'sans-serif', c: 3, w: '400' }, { n: 'Anton', g: 'sans-serif', c: 3, w: '400' }, { n: 'Archivo Black', g: 'sans-serif', c: 3, w: '400' },
  { n: 'Abril Fatface', g: 'serif', c: 3, w: '400' }, { n: 'Lobster', g: 'cursive', c: 3, w: '400' }, { n: 'Pacifico', g: 'cursive', c: 3, w: '400' },
  { n: 'Caveat', g: 'cursive', c: 3, w: '400;600;700' }, { n: 'Permanent Marker', g: 'cursive', c: 3, w: '400' }, { n: 'Bangers', g: 'cursive', c: 3, w: '400' },
  { n: 'Roboto Mono', g: 'monospace', c: 4, w: '400;700' }, { n: 'JetBrains Mono', g: 'monospace', c: 4, w: '400;700;800' },
  { n: 'Headline Bangla Regular Unicode', g: 'sans-serif', c: 5, css: 'https://db.onlinewebfonts.com/c/34f489006eb9119cd72ec882cf0f41a8?family=Headline+Bangla+Regular+Unicode' },
  { n: 'Hind Siliguri', g: 'sans-serif', c: 5, w: '400;600;700' }, { n: 'Noto Sans Bengali', g: 'sans-serif', c: 5, w: '400;600;700;800' }, { n: 'Noto Serif Bengali', g: 'serif', c: 5, w: '400;600;700;800' },
  { n: 'Baloo Da 2', g: 'sans-serif', c: 5, w: '400;600;700;800' }, { n: 'Anek Bangla', g: 'sans-serif', c: 5, w: '400;600;700;800' }, { n: 'Tiro Bangla', g: 'serif', c: 5, w: '400' },
  { n: 'Mina', g: 'sans-serif', c: 5, w: '400;700' }, { n: 'Galada', g: 'cursive', c: 5, w: '400' },
  // Newspaper faces (used by Paper Studio)
  { n: 'UnifrakturCook', g: 'serif', c: 3, w: '700' }, { n: 'Old Standard TT', g: 'serif', c: 2, w: '400;700' }, { n: 'Libre Baskerville', g: 'serif', c: 2, w: '400;700' },
  { n: 'Special Elite', g: 'monospace', c: 4, w: '400' }, { n: 'DM Serif Display', g: 'serif', c: 3, w: '400' }, { n: 'Rozha One', g: 'serif', c: 3, w: '400' },
];
const FONT_BY = Object.fromEntries(FONTS.map(f => [f.n, f]));
/** Strips characters that could break a CSS font string; falls back to Arial. */
export function cleanFont(name, fallback = 'Arial') { const s = String(name ?? '').replace(/["'\\;{}<>\r\n]/g, '').trim().slice(0, 60); return s || fallback; }
/** CSS font-family list for canvas/DOM, e.g. `"Poppins", sans-serif`. */
export function fontStack(name) { const n = cleanFont(name), f = FONT_BY[n]; return `"${n}", ${f?.g || 'sans-serif'}`; }
export const isKnownFont = name => Object.hasOwn(FONT_BY, cleanFont(name));

const fontJobs = new Map();
/** Loads a font from Google Fonts (any family name works; installed fonts need nothing). Resolves true/false, never rejects. */
export function loadFont(name) {
  const n = cleanFont(name), f = FONT_BY[n];
  if (typeof document === 'undefined' || f?.sys) return Promise.resolve(true);
  if (fontJobs.has(n)) return fontJobs.get(n);
  const job = new Promise(resolve => {
    const fam = encodeURIComponent(n).replace(/%20/g, '+');
    const attempt = spec => {
      const link = document.createElement('link');
      link.rel = 'stylesheet'; link.href = f?.css || `https://fonts.googleapis.com/css2?family=${fam}${spec}&display=swap`;
      link.onload = () => Promise.all((f?.css ? [400] : [400, 600, 700, 800]).map(w => document.fonts.load(`${w} 24px "${n}"`, 'অআকখ বাংলা ১২৩'))).then(() => resolve(true), () => resolve(false));
      link.onerror = () => { link.remove(); if (!f?.css && spec) attempt(''); else resolve(false); };
      document.head.appendChild(link);
    };
    attempt(f?.w ? `:wght@${f.w}` : ':wght@400;600;700;800');
  });
  fontJobs.set(n, job); return job;
}
export const loadFonts = names => Promise.all([...new Set(names.map(x => cleanFont(x)))].map(loadFont));

const escHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** <select> + optional custom-name box. Pair with bindFontPicker(). */
export function fontPickerHtml(id, label, value) {
  const cur = cleanFont(value), known = isKnownFont(cur);
  const groups = FONT_GROUPS.map((g, i) => `<optgroup label="${escHtml(g)}">${FONTS.filter(f => f.c === i).map(f => `<option value="${escHtml(f.n)}" ${f.n === cur ? 'selected' : ''}>${escHtml(f.n)}</option>`).join('')}</optgroup>`).join('');
  return `<label>${label}<select id="${id}">${groups}<option value="__custom" ${known ? '' : 'selected'}>Custom font name…</option></select></label>` +
    `<label id="${id}CustomRow" style="${known ? 'display:none' : ''}">Font name<input id="${id}Custom" maxlength="60" value="${known ? '' : escHtml(cur)}" placeholder="Any Google Font, or one installed on this computer"></label>`;
}
/** Calls onPick(fontName) when the person chooses a listed font or finishes typing a custom one. */
export function bindFontPicker(id, onPick) {
  const sel = document.getElementById(id), row = document.getElementById(id + 'CustomRow'), box = document.getElementById(id + 'Custom');
  sel.onchange = () => { if (sel.value === '__custom') { row.style.display = ''; box.focus(); return; } row.style.display = 'none'; onPick(sel.value); };
  box.onchange = () => { const n = cleanFont(box.value, ''); if (n) onPick(n); };
}
