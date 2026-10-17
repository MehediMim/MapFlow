// Map objects, effects and shapes: units, places and hazards you can place, move and animate
// (war maps, disasters, logistics...). Everything is drawn as vector shapes in code, so it looks the
// same on every device and in exported video. The engine passes its helpers in as `H`.
const TAU = Math.PI * 2, dark = '#1d2226', light = '#eef2f4', metal = '#9aa5ad';
const stroke = (c, s) => { c.lineJoin = 'round'; c.strokeStyle = 'rgba(0,0,0,.55)'; c.lineWidth = Math.max(1, s * .05); c.stroke(); };
const poly = (c, pts, fill, s) => { c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x * s, y * s) : c.moveTo(x * s, y * s))); c.closePath(); c.fillStyle = fill; c.fill(); stroke(c, s); };
const rect = (c, x, y, w, h, fill, s, r = .06) => { c.beginPath(); c.roundRect(x * s, y * s, w * s, h * s, r * s); c.fillStyle = fill; c.fill(); stroke(c, s); };
const circ = (c, x, y, r, fill, s) => { c.beginPath(); c.arc(x * s, y * s, r * s, 0, TAU); c.fillStyle = fill; c.fill(); stroke(c, s); };
const seg = (c, x0, y0, x1, y1, col, w, s) => { c.beginPath(); c.moveTo(x0 * s, y0 * s); c.lineTo(x1 * s, y1 * s); c.strokeStyle = col; c.lineWidth = w * s; c.lineCap = 'round'; c.stroke(); };
const mirrorY = pts => pts.map(([x, y]) => [x, -y]);

// Each icon is drawn in a box of about -1..1 (s = half size in px), facing right.
// rot: turns fully to its heading when it moves; otherwise it just mirrors. air: floats above the ground.
export const OBJECT_ICONS = {
  soldier: { label: 'Soldier', color: '#5b7f3a', draw: (c, s, col) => { rect(c, -.2, .2, .16, .55, dark, s); rect(c, .04, .2, .16, .55, dark, s); rect(c, -.22, -.42, .44, .62, col, s); circ(c, 0, -.6, .2, '#e0b88f', s); poly(c, [[-.25, -.62], [.25, -.62], [.2, -.84], [-.2, -.84]], col, s); seg(c, .1, -.15, .85, -.4, dark, .1, s); } },
  tank: { label: 'Tank', color: '#6b7f4a', draw: (c, s, col) => { rect(c, -.9, .25, 1.8, .4, dark, s, .2); poly(c, [[-.85, .25], [.85, .25], [.7, -.1], [-.7, -.1]], col, s); rect(c, -.35, -.42, .7, .34, col, s, .12); rect(c, .3, -.34, .75, .12, metal, s); for (let x = -.65; x <= .66; x += .26) circ(c, x, .45, .12, metal, s); } },
  warship: { label: 'Warship', color: '#8a9aa6', draw: (c, s, col) => { poly(c, [[-1, 0], [1, 0], [.8, .4], [-.85, .4]], col, s); rect(c, -.3, -.35, .55, .35, light, s); rect(c, -.1, -.68, .2, .33, dark, s); rect(c, .4, -.2, .5, .1, dark, s); seg(c, -.6, 0, -.6, -.5, dark, .05, s); } },
  jet: { label: 'Fighter jet', color: '#b9c3cc', rot: 1, air: 1, draw: (c, s, col) => { const w = [[.2, 0], [-.4, -.85], [-.62, -.85], [-.3, 0]]; poly(c, w, metal, s); poly(c, mirrorY(w), metal, s); poly(c, [[-1, 0], [-.8, -.3], [-.62, 0], [-.8, .3]], metal, s); poly(c, [[-1, 0], [.6, -.13], [1, 0], [.6, .13]], col, s); circ(c, .3, 0, .08, '#2b6cb0', s); } },
  helicopter: { label: 'Helicopter', color: '#6b7f4a', air: 1, draw: (c, s, col, t) => { rect(c, -1, -.06, .7, .12, col, s, .05); rect(c, -.45, -.25, .95, .5, col, s, .22); circ(c, .3, -.05, .13, '#bcd7ea', s); seg(c, -.6, .42, .5, .42, dark, .06, s); c.save(); c.translate(0, -.32 * s); c.rotate(t * .9); seg(c, -1.1, 0, 1.1, 0, dark, .08, s); c.restore(); } },
  drone: { label: 'Drone', color: '#444b52', rot: 1, air: 1, draw: (c, s, col, t) => { for (const [x, y] of [[-.55, -.45], [.55, -.45], [-.55, .45], [.55, .45]]) { seg(c, 0, 0, x, y, dark, .07, s); c.save(); c.translate(x * s, y * s); c.rotate(t * 1.3); seg(c, -.25, 0, .25, 0, light, .06, s); c.restore(); } rect(c, -.22, -.14, .44, .28, col, s, .1); } },
  submarine: { label: 'Submarine', color: '#4a5a66', draw: (c, s, col) => { rect(c, -1, -.2, 2, .4, col, s, .2); rect(c, -.2, -.5, .35, .32, col, s, .06); seg(c, .05, -.5, .05, -.78, dark, .05, s); seg(c, .05, -.78, .25, -.78, dark, .05, s); circ(c, -1.02, 0, .1, dark, s); } },
  missile: { label: 'Missile', color: '#d9d9d9', rot: 1, air: 1, draw: (c, s, col, t) => { const f = [[-.8, -.12], [-1, -.38], [-.55, -.12]]; poly(c, [[-.8, -.07], [-1.15 - .2 * Math.sin(t * 1.7), 0], [-.8, .07]], '#ffb703', s); poly(c, f, metal, s); poly(c, mirrorY(f), metal, s); rect(c, -.8, -.12, 1.4, .24, light, s, .12); poly(c, [[.6, -.12], [1, 0], [.6, .12]], '#e63946', s); } },
  base: { label: 'Military base', color: '#8b6f47', draw: (c, s, col) => { poly(c, [[-.8, .4], [-.8, 0], [-.4, -.35], [.4, -.35], [.8, 0], [.8, .4]], col, s); rect(c, -.15, .05, .3, .35, dark, s); seg(c, .5, -.35, .5, -.95, light, .06, s); poly(c, [[.5, -.95], [.95, -.82], [.5, -.7]], '#e63946', s); } },
  flag: { label: 'Flag', color: '#e63946', draw: (c, s, col, t) => { const top = [], bot = []; for (let i = 0; i <= 10; i++) { const x = .03 + i / 10 * .9, w = Math.sin(t * .2 + i * .6) * .05 * (i / 10 + .3); top.push([x, -.98 + w]); bot.push([x, -.45 + w]); } poly(c, [...top, ...bot.reverse()], col, s); rect(c, -.05, -1, .08, 1.4, light, s, .03); } },
  city: { label: 'City', color: '#9fb4c2', draw: (c, s, col) => { rect(c, -.9, -.1, .4, .5, col, s, .03); rect(c, -.4, -.7, .45, 1.1, col, s, .03); rect(c, .1, -.3, .4, .7, col, s, .03); rect(c, .55, 0, .35, .4, col, s, .03); for (const [x, y] of [[-.28, -.5], [-.28, -.2], [-.28, .1], [.22, -.1], [.22, .15]]) rect(c, x, y, .13, .1, '#ffe9a8', s, .02); } },
  camp: { label: 'Camp / tents', color: '#a0875a', draw: (c, s, col) => { poly(c, [[-.9, .4], [-.4, -.4], [.1, .4]], col, s); poly(c, [[-.1, .4], [.4, -.5], [.95, .4]], '#d8c590', s); poly(c, [[-.5, .4], [-.4, .05], [-.3, .4]], dark, s); } },
  checkpoint: { label: 'Checkpoint', color: '#c9a227', draw: (c, s, col) => { rect(c, -.9, -.1, .5, .5, metal, s); rect(c, -.4, .08, 1.3, .12, '#e63946', s, .02); rect(c, -.05, .08, .2, .12, light, s, .01); rect(c, .4, .08, .2, .12, light, s, .01); rect(c, .85, -.1, .12, .5, dark, s, .02); } },
  factory: { label: 'Factory', color: '#8d99a6', draw: (c, s, col, t) => { rect(c, -.9, -.1, 1.4, .5, col, s, .03); poly(c, [[-.9, -.1], [-.9, -.4], [-.5, -.1], [-.5, -.4], [-.1, -.1], [-.1, -.4], [.3, -.1]], col, s); rect(c, .2, -.8, .18, .7, dark, s, .02); rect(c, .5, -.65, .18, .55, dark, s, .02); for (let i = 0; i < 3; i++) { const q = ((t * .02) + i / 3) % 1; c.globalAlpha *= .8; circ(c, .29 + q * .25, -.9 - q * .6, .1 + q * .15, 'rgba(120,125,130,.6)', s); } } },
  airport: { label: 'Airport', color: '#7d8c99', draw: (c, s, col) => { rect(c, -1, .1, 2, .32, dark, s, .03); for (let x = -.8; x < .9; x += .35) rect(c, x, .24, .2, .04, light, s, .01); rect(c, .4, -.5, .22, .6, col, s, .03); rect(c, .3, -.72, .42, .22, light, s, .05); } },
  storm: { label: 'Storm', color: '#7aa0c4', draw: (c, s, col) => { rect(c, -.75, -.2, 1.5, .35, col, s, .15); circ(c, -.4, -.2, .35, col, s); circ(c, 0, -.4, .45, col, s); circ(c, .4, -.2, .35, col, s); poly(c, [[0, .05], [-.25, .55], [0, .5], [-.1, 1], [.3, .35], [.05, .4]], '#ffd166', s); } },
  volcano: { label: 'Volcano', color: '#8b4a2b', draw: (c, s, col, t) => { poly(c, [[-1, .5], [-.25, -.4], [.25, -.4], [1, .5]], col, s); poly(c, [[-.25, -.4], [.25, -.4], [.12, -.18], [-.1, -.08]], '#ff5a1f', s); for (let i = 0; i < 3; i++) { const q = ((t * .015) + i / 3) % 1; c.globalAlpha *= .7; circ(c, Math.sin(i * 2 + q) * .2, -.55 - q * .8, .15 + q * .2, 'rgba(70,70,75,.55)', s); } } },
};
export const OBJECT_ENTER = [['drop', 'Drop in'], ['fade', 'Fade in'], ['grow', 'Grow'], ['none', 'Instant']];
export const OBJECT_IDLE = [['none', 'Still'], ['pulse', 'Pulse'], ['shake', 'Shake'], ['bob', 'Bob up and down'], ['spin', 'Spin']];
export const OBJECT_EXIT = [['none', 'Stay until the bar ends'], ['fade', 'Fade out'], ['shrink', 'Shrink'], ['explode', 'Explode']];
export const EFFECTS = {
  explosion: { label: 'Explosion', color: '#ff7a1a' }, fire: { label: 'Fire', color: '#ff5a1f' }, smoke: { label: 'Smoke', color: '#6b7278' },
  shockwave: { label: 'Shockwave', color: '#ffffff' }, quake: { label: 'Earthquake rings', color: '#ff4d4d' }, blast: { label: 'Blast / danger radius', color: '#ff3b30' },
  strike: { label: 'Missile strike (launch → target)', color: '#ff7a1a' },
};
export const SHAPES = {
  arrow: { label: 'Attack arrow', color: '#e63946' }, retreat: { label: 'Retreat arrow', color: '#f4a261' }, front: { label: 'Front line', color: '#d62828' },
  zone: { label: 'Zone / occupied area', color: '#e9c46a' }, noFly: { label: 'No-fly / restricted zone', color: '#ff595e' },
};

// ---------------------------------------------------------------- objects
export function drawObject(H, c, v, geo, a, frame, labels) {
  if (!H.actAlpha(a, frame)) return;
  const ic = OBJECT_ICONS[a.glyph] || OBJECT_ICONS.tank, u = v.unit, size = a.size || 1, s = 26 * size * u, t = frame - a.start;
  let X, Y, ang = null;
  if (a.mode === 'path') {
    const r = H.planeRoute(geo, a); if (!r) return;
    const p = H.ease(a.easing, H.actionProgress(a, frame)), pt = H.routeAt(r, p), k = Math.round(v.cx - pt.X);
    X = pt.X + k; Y = pt.Y;
    const p0 = H.routeAt(r, Math.max(0, p - .02)), p1 = H.routeAt(r, Math.min(1, p + .02)), q0 = H.project(v, p0.X + k, p0.Y), q1 = H.project(v, p1.X + k, p1.Y);
    if (Math.hypot(q1.x - q0.x, q1.y - q0.y) > .5) ang = Math.atan2(q1.y - q0.y, q1.x - q0.x);
    if (a.trail !== false && pt.i > 0) {
      c.save(); c.beginPath(); let on = false;
      for (let i = 0; i <= pt.i; i++) { const q = H.project(v, r.X[i] + k, r.Y[i]); if (q.z < v.near) { on = false; continue; } if (on) c.lineTo(q.x, q.y); else { c.moveTo(q.x, q.y); on = true; } }
      const e = H.project(v, X, Y); if (on) c.lineTo(e.x, e.y);
      c.globalAlpha = .75; c.strokeStyle = a.color; c.lineWidth = 3 * u; c.setLineDash([8 * u, 6 * u]); c.lineCap = 'round'; c.stroke(); c.restore();
    }
  } else { const r = H.resolveLoc(geo, a.place, v.cx); if (!r) return; X = r.X; Y = r.Y; }
  const left = a.start + a.dur - frame;
  if (a.exit === 'explode') { const xe = H.clamp01(1 - left / 30); if (xe > .1) { c.save(); explosion(H, c, v, X, Y, s * 1.6, (xe - .1) / .9, '#ff7a1a', frame); c.restore(); return; } }
  const enter = a.enter === 'none' ? 1 : H.clamp01(t / 18), xd = a.exit === 'none' ? 0 : H.clamp01(1 - left / 18);
  let alpha = 1, sc = 1, dx = 0, dy = 0, rot = 0;
  if (a.enter === 'drop') { dy = -(1 - H.bounce(enter)) * 220 * u; alpha = H.clamp01(enter * 3); } else if (a.enter === 'fade') alpha = enter; else if (a.enter === 'grow') sc = H.ease('backOut', enter);
  if (a.idle === 'pulse') sc *= 1 + .08 * Math.sin(t * .35); else if (a.idle === 'shake') { dx = Math.sin(t * 2.3) * 2.2 * u; dy += Math.cos(t * 3.1) * 1.6 * u; } else if (a.idle === 'bob') dy += Math.sin(t * .2) * 5 * u; else if (a.idle === 'spin') rot = t * .12;
  if (a.exit === 'fade') alpha *= 1 - xd; else if (a.exit === 'shrink') sc *= 1 - xd;
  if (alpha <= 0 || sc <= 0) return;
  const lift = ic.air ? 38 * size * u : 0, g0 = H.project(v, X, Y, 0), g = H.project(v, X, Y, lift);
  if (g.z < v.near) return;
  c.save();
  c.globalAlpha = alpha * .28; c.fillStyle = '#000'; c.beginPath(); c.ellipse(g0.x, g0.y, s * .7 * sc, s * .18 * sc, 0, 0, TAU); c.fill();
  c.globalAlpha = alpha; c.translate(g.x + dx, g.y - (ic.air ? 0 : s * .5 * sc) + dy);
  if (ang !== null) { if (ic.rot) c.rotate(ang); else if (Math.cos(ang) < 0) c.scale(-1, 1); }
  c.rotate(rot); c.scale(sc, sc); ic.draw(c, s, a.color, t);
  c.restore();
  if (a.showLabel) { const off = -s * 1.5 - lift; labels.push({ x: g0.x + dx, y: g0.y + off, ground: { X, Y }, groundOffset: { y: off }, text: a.label || ic.label, alpha: alpha * Math.min(1, sc), scale: 1 }); }
}

// ---------------------------------------------------------------- effects
function fireball(c, x, y, r, col, alpha) {
  if (alpha <= 0 || r <= 0) return;
  const g = c.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, '#fff6c8'); g.addColorStop(.35, '#ffc93c'); g.addColorStop(.7, col); g.addColorStop(1, 'rgba(40,10,0,0)');
  c.globalAlpha = alpha; c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
}
function explosion(H, c, v, X, Y, s, p, col, frame) {
  const g = H.project(v, X, Y, 0), u = v.unit, e = 1 - (1 - p) ** 3, cy = g.y - s * .35;
  if (p < .18) { c.globalAlpha = 1 - p / .18; c.fillStyle = '#fff'; c.beginPath(); c.arc(g.x, cy, s * (.5 + p * 3), 0, TAU); c.fill(); }
  fireball(c, g.x, cy, s * (.25 + e * 1.1), col, Math.max(0, 1 - p * p * 1.1));
  c.beginPath(); H.groundCircle(c, v, X, Y, s * (.4 + e * 2.4)); c.globalAlpha = Math.max(0, 1 - p) * .7; c.strokeStyle = '#fff'; c.lineWidth = 2.5 * u; c.stroke();
  c.fillStyle = '#ffd166';
  for (let i = 0; i < 14; i++) { const an = i * 2.399, d = s * (.3 + e * (.9 + (i % 4) * .35)); c.globalAlpha = Math.max(0, 1 - p) * .9; c.beginPath(); c.arc(g.x + Math.cos(an) * d, cy + Math.sin(an) * d * .7 + p * p * s * .5, 2.2 * u, 0, TAU); c.fill(); }
  if (p > .25) for (let i = 0; i < 5; i++) { const q = (p - .25) / .75; c.globalAlpha = (q < .4 ? q / .4 : (1 - q) / .6) * .45; c.fillStyle = '#3a3f44'; c.beginPath(); c.arc(g.x + (i - 2) * s * .28, g.y - s * (.5 + q * 1.4 + (i % 2) * .2), s * (.25 + q * .3), 0, TAU); c.fill(); }
}
function rings(H, c, v, X, Y, s, p, col, n, spread, w) {
  for (let i = 0; i < n; i++) { const q = (p * n * .6 + i / n) % 1; c.beginPath(); H.groundCircle(c, v, X, Y, s * (.2 + q * spread)); c.globalAlpha = (1 - q) * .85; c.strokeStyle = col; c.lineWidth = w * v.unit; c.stroke(); }
}
export function drawEffect(H, c, v, geo, a, frame, labels) {
  if (!H.actAlpha(a, frame)) return;
  const r = H.resolveLoc(geo, a.place, v.cx); if (!r) return;
  const base = H.actionProgress(a, frame), rep = Math.max(1, a.repeat | 0 || 1), p = base >= 1 ? 1 : (base * rep) % 1, env = Math.min(1, base / .08, (1 - base) / .08 + .001);
  const u = v.unit, s = 40 * (a.size || 1) * u, g = H.project(v, r.X, r.Y, 0); if (g.z < v.near) return;
  c.save();
  if (a.fx === 'explosion') explosion(H, c, v, r.X, r.Y, s, p, a.color, frame);
  else if (a.fx === 'shockwave') rings(H, c, v, r.X, r.Y, s, p, a.color, 3, 3, 3);
  else if (a.fx === 'quake') { rings(H, c, v, r.X, r.Y, s, p, a.color, 4, 2.6, 3.5); c.globalAlpha = 1; c.fillStyle = a.color; c.beginPath(); c.arc(g.x, g.y, 4 * u, 0, TAU); c.fill(); }
  else if (a.fx === 'blast') { const k = 1.5 * H.ease('easeOut', H.clamp01(p * 3)) * s; c.beginPath(); H.groundCircle(c, v, r.X, r.Y, Math.max(1, k)); c.globalAlpha = (.2 + .08 * Math.sin(frame * .3)) * env; c.fillStyle = a.color; c.fill(); c.globalAlpha = .9 * env; c.strokeStyle = a.color; c.lineWidth = 2.5 * u; c.stroke(); }
  else if (a.fx === 'fire') {
    c.globalAlpha = .25 * env; c.fillStyle = a.color; c.beginPath(); c.ellipse(g.x, g.y - s * .3, s * .7, s * .5, 0, 0, TAU); c.fill();
    for (let i = 0; i < 7; i++) { const f = Math.sin(frame * .4 + i * 1.7), x = g.x + (i - 3) * s * .16, h = s * (.7 + .35 * f) * (1 - Math.abs(i - 3) * .12), w = s * .17; c.globalAlpha = env; const gr = c.createLinearGradient(0, g.y, 0, g.y - h); gr.addColorStop(0, '#ffd166'); gr.addColorStop(1, a.color); c.fillStyle = gr; c.beginPath(); c.moveTo(x - w, g.y); c.quadraticCurveTo(x - w, g.y - h * .5, x + f * s * .06, g.y - h); c.quadraticCurveTo(x + w, g.y - h * .5, x + w, g.y); c.closePath(); c.fill(); }
  } else if (a.fx === 'smoke') {
    for (let i = 0; i < 8; i++) { const q = ((frame / 60) + i / 8) % 1; c.globalAlpha = (1 - q) * .45 * env; c.fillStyle = a.color; c.beginPath(); c.arc(g.x + Math.sin(i * 3 + q * 3) * s * .35, g.y - q * s * 1.8, s * (.18 + q * .3), 0, TAU); c.fill(); }
  } else if (a.fx === 'strike') {
    const f = a.from && H.resolveLoc(geo, a.from, r.X), fl = .6;
    if (f && p < fl) {
      const q = p / fl, at = k => { const kk = Math.max(0, k); return H.project(v, f.X + (r.X - f.X) * kk, f.Y + (r.Y - f.Y) * kk, Math.sin(Math.PI * kk) * 110 * u * (a.size || 1)); };
      const m = at(q), m0 = at(q - .03);
      c.beginPath(); for (let k = 0; k <= 12; k++) { const t = at(q - k * .025); if (k) c.lineTo(t.x, t.y); else c.moveTo(t.x, t.y); }
      c.globalAlpha = .7; c.strokeStyle = '#ffd9a0'; c.lineWidth = 2.5 * u; c.lineCap = 'round'; c.stroke();
      c.globalAlpha = 1; c.translate(m.x, m.y); c.rotate(Math.atan2(m.y - m0.y, m.x - m0.x)); OBJECT_ICONS.missile.draw(c, 13 * (a.size || 1) * u, '#d9d9d9', frame);
    } else if (p >= fl || !f) explosion(H, c, v, r.X, r.Y, s, f ? (p - fl) / (1 - fl) : p, a.color, frame);
  }
  c.restore();
  if (a.showLabel) labels.push({ x: g.x, y: g.y - s * 1.7, ground: { X: r.X, Y: r.Y }, groundOffset: { y: -s * 1.7 }, text: a.label || EFFECTS[a.fx].label, alpha: Math.min(1, env), scale: 1 });
}

// ---------------------------------------------------------------- shapes (arrows, front lines, zones)
export function drawShape(H, c, v, geo, a, frame, labels) {
  if (!H.actAlpha(a, frame) || a.mode !== 'path' || (a.path || []).length < 2) return;
  const r = H.planeRoute(geo, a); if (!r) return;
  const u = v.unit, k = Math.round(v.cx - r.mid), p = H.ease(a.easing, H.actionProgress(a, frame)), P = [];
  for (let i = 0; i < r.n; i++) { const q = H.project(v, r.X[i] + k, r.Y[i]); P.push(q.z < v.near ? null : q); }
  const zone = a.shape === 'zone' || a.shape === 'noFly', w = (a.width || 6) * u;
  let text = null;
  c.save(); c.lineCap = 'round'; c.lineJoin = 'round';
  if (zone) {
    const pts = P.filter(Boolean); if (pts.length < 3) { c.restore(); return; }
    c.beginPath(); pts.forEach((q, i) => (i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y))); c.closePath();
    c.globalAlpha = (a.fillAlpha ?? .28) * p; c.fillStyle = a.color; c.fill();
    if (a.shape === 'noFly') {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; for (const q of pts) { x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); }
      c.save(); c.clip(); c.beginPath(); for (let x = x0 - (y1 - y0); x < x1; x += 12 * u) { c.moveTo(x, y1); c.lineTo(x + (y1 - y0), y0); } c.globalAlpha = .55 * p; c.strokeStyle = a.color; c.lineWidth = 1.6 * u; c.stroke(); c.restore();
    }
    c.beginPath(); pts.forEach((q, i) => (i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y))); c.closePath();
    c.globalAlpha = .95 * p; c.strokeStyle = a.color; c.lineWidth = w * .6; c.setLineDash(a.shape === 'noFly' ? [10 * u, 7 * u] : []); c.stroke();
    text = { x: pts.reduce((s, q) => s + q.x, 0) / pts.length, y: pts.reduce((s, q) => s + q.y, 0) / pts.length };
  } else {
    const e = p * (r.n - 1), L = []; let i = 0;
    for (; i <= Math.floor(e) && i < r.n; i++) { if (!P[i]) break; L.push(P[i]); }
    if (i === Math.floor(e) + 1 && P[i] && e % 1 > 0) L.push({ x: P[i - 1].x + (P[i].x - P[i - 1].x) * (e % 1), y: P[i - 1].y + (P[i].y - P[i - 1].y) * (e % 1) });
    if (L.length < 2) { c.restore(); return; }
    const path = () => { c.beginPath(); L.forEach((q, j) => (j ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y))); };
    const lw = a.shape === 'front' ? w * .8 : w * 1.4, dash = a.shape === 'retreat' ? [10 * u, 7 * u] : [];
    path(); c.globalAlpha = .35; c.strokeStyle = '#000'; c.lineWidth = lw + 3 * u; c.setLineDash(dash); c.stroke();
    path(); c.globalAlpha = .95; c.strokeStyle = a.color; c.lineWidth = lw; c.stroke(); c.setLineDash([]);
    const end = L[L.length - 1];
    if (a.shape === 'front') {
      const gap = 24 * u * (.6 + (a.width || 6) / 12), th = 9 * u * (.6 + (a.width || 6) / 12); let acc = gap / 2;
      c.fillStyle = a.color; c.globalAlpha = .95;
      for (let j = 1; j < L.length; j++) {
        const dx = L[j].x - L[j - 1].x, dy = L[j].y - L[j - 1].y, len = Math.hypot(dx, dy); if (!len) continue;
        const ux = dx / len, uy = dy / len; let d = acc;
        for (; d < len; d += gap) { const bx = L[j - 1].x + ux * d, by = L[j - 1].y + uy * d; c.beginPath(); c.moveTo(bx - ux * th * .6, by - uy * th * .6); c.lineTo(bx + ux * th * .6, by + uy * th * .6); c.lineTo(bx - uy * th * 1.2, by + ux * th * 1.2); c.closePath(); c.fill(); }
        acc = d - len;
      }
    } else if (p > .03) {
      let ref = L[L.length - 2]; for (let j = L.length - 2; j >= 0; j--) { ref = L[j]; if (Math.hypot(end.x - ref.x, end.y - ref.y) > w * 3) break; }
      const dx = end.x - ref.x, dy = end.y - ref.y, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len, hl = w * 3.2, hw = w * 1.7;
      c.beginPath(); c.moveTo(end.x + ux * hl * .3, end.y + uy * hl * .3); c.lineTo(end.x - ux * hl * .7 - uy * hw, end.y - uy * hl * .7 + ux * hw); c.lineTo(end.x - ux * hl * .7 + uy * hw, end.y - uy * hl * .7 - ux * hw); c.closePath();
      c.globalAlpha = .95; c.fillStyle = a.color; c.fill(); c.strokeStyle = 'rgba(0,0,0,.45)'; c.lineWidth = 1.5 * u; c.stroke();
    }
    text = { x: end.x, y: end.y - 18 * u };
  }
  c.restore();
  if (a.showLabel && a.label && text) labels.push({ x: text.x, y: text.y, text: a.label, alpha: Math.min(1, p * 2), scale: 1 });
}
