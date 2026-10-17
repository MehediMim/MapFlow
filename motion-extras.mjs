// All motion is evaluated from the timeline frame, never from wall-clock time.
export const BACKGROUND_STYLES = { none: 'Solid color', grid: 'Drifting grid', dots: 'Floating dots', diagonal: 'Diagonal lines', waves: 'Flowing waves', glow: 'Moving glow' };
export const DEFAULT_BACKGROUND = { style: 'none', animated: true, speed: 1, spacing: 64, opacity: .25, color: '#6b9250' };
export const TABLE_THEMES = { light: 'Clean light', dark: 'Midnight', accent: 'Accent header' };
export const TABLE_ANIMATIONS = { rows: 'Rows slide in', fade: 'Rows fade in', wipe: 'Reveal across', none: 'No reveal' };
export const DEFAULT_TABLE = { title: 'Project overview', info: 'Weekly progress · October', data: [['Task', 'Owner', 'Status'], ['Research', 'Mim', 'Complete'], ['Design', 'Abir', 'In progress'], ['Review', 'Team', 'Next']], theme: 'dark', animation: 'rows', duration: 60, fontSize: 26, titleFontSize:30,infoFontSize:16,headerFontSize:26,titleWeight:700,infoWeight:400,headerWeight:700 };
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
export function parseTable(text) {
  const lines = text.trim().split(/\r?\n/).filter(line => line.trim());
  if (!lines.length || lines.length > 31) throw Error('Use a header and up to 30 data rows.');
  const data = lines.map(line => line.split(line.includes('\t') ? '\t' : '|').map(s => s.trim()));
  const columns = Math.max(...data.map(row => row.length));
  if (columns > 8 || data.some(row => row.some(cell => cell.length > 160))) throw Error('Use up to 8 columns and 160 characters per cell.');
  return data.map(row => Array.from({ length: columns }, (_, i) => row[i] || ''));
}
export function validateExtras(project) {
  const b = project.backgroundEffect;
  const number = (v, lo, hi) => Number.isFinite(v) && v >= lo && v <= hi;
  const color = v => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
  for(const shot of project.cameraShots||[])for(const key of ['frontBlur','backBlur'])if(shot[key]!==undefined&&!number(shot[key],0,80))throw Error('Invalid camera blur.');
  if (b !== undefined && (!b || !Object.hasOwn(BACKGROUND_STYLES, b.style) || typeof b.animated !== 'boolean' || !number(b.speed, 0, 4) || !number(b.spacing, 20, 200) || !number(b.opacity, 0, 1) || !color(b.color))) throw Error('Invalid animated background settings.');
  for (const layer of project.layers) if (layer.type === 'table') {
    const t = layer.table;
    if (!t || typeof t.title !== 'string' || t.title.length > 160 || typeof t.info !== 'string' || t.info.length > 240 || !Object.hasOwn(TABLE_THEMES, t.theme) || !Object.hasOwn(TABLE_ANIMATIONS, t.animation) || !Number.isSafeInteger(t.duration) || t.duration < 1 || !number(t.fontSize, 8, 100) || !Array.isArray(t.data) || !t.data.length || t.data.length > 31) throw Error('Invalid table settings.');
    const n = t.data[0]?.length;
    if (!n || n > 8 || t.data.some(row => !Array.isArray(row) || row.length !== n || row.some(cell => typeof cell !== 'string' || cell.length > 160))) throw Error('Invalid table data.');
    for(const key of ['titleFontSize','infoFontSize','headerFontSize'])if(t[key]!==undefined&&!number(t[key],8,100))throw Error('Invalid table typography size.');for(const key of ['titleColor','infoColor'])if(t[key]!==undefined&&!color(t[key]))throw Error('Invalid table text color.');for(const key of ['titleFontFamily','infoFontFamily'])if(t[key]!==undefined&&(typeof t[key]!=='string'||t[key].length>60))throw Error('Invalid table font.');for(const key of ['titleWeight','infoWeight','headerWeight'])if(t[key]!==undefined&&![400,500,600,700,800].includes(Number(t[key])))throw Error('Invalid table typography weight.');if (!color(layer.color)) throw Error('Invalid table accent color.');
  }
}
export function drawBackgroundEffect(ctx, W, H, frame, fps, settings) {
  const b = { ...DEFAULT_BACKGROUND, ...settings };
  if (b.style === 'none' || b.opacity <= 0) return;
  const u = Math.min(W, H) / 720, step = b.spacing * u;
  const time = b.animated ? frame / fps * b.speed : 0;
  const drift = time * 22 * u, ox = drift % step, oy = (drift * .65) % step;
  ctx.save();ctx.globalAlpha = b.opacity;ctx.strokeStyle = ctx.fillStyle = b.color;ctx.lineWidth = Math.max(.5, u);
  if (b.style === 'grid') {
    ctx.beginPath();
    for (let x = ox; x < W; x += step) { ctx.moveTo(x, 0);ctx.lineTo(x, H); }
    for (let y = oy; y < H; y += step) { ctx.moveTo(0, y);ctx.lineTo(W, y); }
    ctx.stroke();
  } else if (b.style === 'dots') {
    ctx.beginPath();
    for (let y = oy; y < H + step; y += step) for (let x = ox; x < W + step; x += step) { ctx.moveTo(x + 2.2*u, y);ctx.arc(x, y, 2.2*u, 0, Math.PI*2); }
    ctx.fill();
  } else if (b.style === 'diagonal') {
    ctx.beginPath();
    for (let x = -H - step + ox; x < W + step; x += step) { ctx.moveTo(x, 0);ctx.lineTo(x + H, H); }
    ctx.stroke();
  } else if (b.style === 'waves') {
    ctx.lineWidth = Math.max(1, 2*u);
    for (let y = -step; y < H + step; y += step) {
      ctx.beginPath();
      for (let x = 0; x <= W + 8*u; x += Math.max(2, 8*u)) { const py = y + Math.sin(x/(150*u) + time*.7 + y/(220*u))*step*.3; if (!x) ctx.moveTo(x, py);else ctx.lineTo(x, py); }
      ctx.stroke();
    }
  } else if (b.style === 'glow') {
    for (let i = 0; i < 3; i++) {
      const x = W*(.5 + .32*Math.sin(time*.25 + i*2.1)), y = H*(.5 + .3*Math.cos(time*.32 + i*1.7));
      const radius = Math.max(W,H)*.5, g=ctx.createRadialGradient(x,y,0,x,y,radius);
      g.addColorStop(0,b.color);g.addColorStop(1,b.color+'00');ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
    }
  }
  ctx.restore();
}
export function tableProgress(table, row, rows, elapsed) {
  if (table.animation === 'none') return 1;
  const duration = Math.max(1, table.duration), stagger = rows > 1 ? duration*.65/(rows-1) : 0;
  const t = clamp((elapsed - row*stagger)/(duration*(rows > 1 ? .35 : 1)),0,1);
  return 1-(1-t)**3;
}
let tableFont = '"Arial", sans-serif';
function cellText(ctx, text, x, y, width, fontSize, color, bold = false, family = tableFont) {
  ctx.font = `${typeof bold==='number'?bold:(bold?700:400)} ${fontSize}px ${family}`;ctx.fillStyle=color;ctx.textAlign='left';ctx.textBaseline='middle';
  let value=String(text);
  if(ctx.measureText(value).width>width){while(value.length&&ctx.measureText(value+'…').width>width)value=value.slice(0,-1);value+='…';}
  ctx.fillText(value,x,y,Math.max(1,width));
}
export function drawTable(ctx, layer, frame) {
  tableFont = `"${String(layer.table?.fontFamily || 'Arial').replace(/["'\\\\;{}<>\r\n]/g, '').slice(0, 60) || 'Arial'}", sans-serif`;
  const t=layer.table, W=Math.max(1,layer.w),H=Math.max(1,layer.h),u=Math.min(W/900,H/420);
  const colors=t.theme==='dark'?{bg:'#15251f',alt:'#1d3028',text:'#e8f1e4',muted:'#a8bba4',head:'#304638',headText:'#f0f7e9',line:'#3b5141'}:{bg:'#f5f7f1',alt:'#e9eee3',text:'#243324',muted:'#61735a',head:t.theme==='accent'?layer.color:'#d9e3cf',headText:'#182518',line:'#cad5c0'};
  const pad=Math.max(4,18*u),top=(t.title?52*u:0)+(t.info?28*u:0),rowH=(H-top)/t.data.length,colW=W/t.data[0].length;
  const fs=Math.max(3,Math.min(t.fontSize*W/900,rowH*.4,colW*.3));
  ctx.save();ctx.translate(-W/2,-H/2);ctx.beginPath();ctx.rect(0,0,W,H);ctx.clip();
  ctx.fillStyle=colors.bg;ctx.fillRect(0,0,W,top);
  if(t.title)cellText(ctx,t.title,pad,26*u,W-2*pad,(t.titleFontSize??30)*u,t.titleColor||colors.text,t.titleWeight??700,`"${t.titleFontFamily||t.fontFamily||'Arial'}",sans-serif`);
  if(t.info)cellText(ctx,t.info,pad,(t.title?52*u:0)+12*u,W-2*pad,(t.infoFontSize??16)*u,t.infoColor||colors.muted,t.infoWeight??400,`"${t.infoFontFamily||t.fontFamily||'Arial'}",sans-serif`);
  t.data.forEach((row,index)=>{
    const p=index===0?1:tableProgress(t,index-1,t.data.length-1,frame-layer.in);
    if(p<=0)return;
    ctx.save();ctx.beginPath();ctx.rect(0,top+index*rowH,W,rowH);ctx.clip();
    if(index){ctx.globalAlpha*=p;if(t.animation==='rows')ctx.translate(0,(1-p)*rowH*.6);if(t.animation==='wipe'){ctx.beginPath();ctx.rect(0,top+index*rowH,W*p,rowH);ctx.clip();}}
    ctx.fillStyle=index===0?colors.head:index%2?colors.bg:colors.alt;ctx.fillRect(0,top+index*rowH,W,rowH);
    ctx.strokeStyle=colors.line;ctx.lineWidth=Math.max(.5,u);ctx.beginPath();ctx.moveTo(0,top+(index+1)*rowH);ctx.lineTo(W,top+(index+1)*rowH);ctx.stroke();
    row.forEach((text,col)=>cellText(ctx,text,col*colW+pad,top+(index+.5)*rowH,Math.max(1,colW-2*pad),index===0?(t.headerFontSize??t.fontSize)*W/900:fs,index===0?colors.headText:colors.text,index===0?(t.headerWeight??700):false));
    ctx.restore();
  });
  ctx.restore();
}
