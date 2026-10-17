const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
export function validateMotionPath(path) {
  if (path === undefined) return;
  if (!path || !Array.isArray(path.points) || path.points.length > 120 || !['straight', 'smooth'].includes(path.curve) ||
      !Number.isSafeInteger(path.start) || path.start < 0 || !Number.isSafeInteger(path.dur) || path.dur < 1 ||
      !Number.isSafeInteger(path.start + path.dur) || path.points.some(p => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.abs(p.x) > 20000 || Math.abs(p.y) > 20000)) throw Error('Invalid movement path.');
}
export function motionPathSamples(path) {
  const pts = path.points;
  if (pts.length < 2 || path.curve === 'straight') return pts.map(p => ({ ...p }));
  const samples = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[i], c = pts[i + 1], d = pts[Math.min(pts.length - 1, i + 2)];
    for (let j = 0; j < 16; j++) {
      const t = j / 16, t2 = t * t, t3 = t2 * t;
      const axis = k => clamp(.5 * ((2 * b[k]) + (-a[k] + c[k]) * t + (2 * a[k] - 5 * b[k] + 4 * c[k] - d[k]) * t2 + (-a[k] + 3 * b[k] - 3 * c[k] + d[k]) * t3), -20000, 20000);
      samples.push({ x: axis('x'), y: axis('y') });
    }
  }
  samples.push({ ...pts.at(-1) }); return samples;
}
export function applyMotionPath(layer) {
  const path = layer.motionPath;
  validateMotionPath(path);
  const pts = motionPathSamples(path);
  if (!pts.length) return;
  const distances = [0];
  for (let i = 1; i < pts.length; i++) distances.push(distances.at(-1) + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const total = distances.at(-1), keys = new Map();
  pts.forEach((p, i) => keys.set(path.start + Math.round((total ? distances[i] / total : i / Math.max(1, pts.length - 1)) * path.dur), p));
  keys.set(path.start, pts[0]);
  if (pts.length > 1) keys.set(path.start + path.dur, pts.at(-1));
  for (const axis of ['x', 'y']) layer.keys[axis] = [...keys].sort((a, b) => a[0] - b[0]).map(([f, p]) => ({ f, v: p[axis], e: 'linear' }));
  layer.x = pts[0].x; layer.y = pts[0].y;
}
