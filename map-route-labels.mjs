// Route labels use the geometry already loaded by Map Studio. Work is cached per
// route; drawing subsequent frames only checks the small route coordinate arrays.
import { detailLevelOf } from './map-country-details.mjs';
const routeCache = new WeakMap(), featureCache = new WeakMap();
const EPS = 1e-12, PARAM_EPS = 1e-10;
const cross = (ax, ay, bx, by) => ax * by - ay * bx;

function ringBox(ring) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  for (let i = 0; i < ring.n; i++) {
    const x = ring.xy[2 * i], y = ring.xy[2 * i + 1];
    b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y);
    b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y);
  }
  return b;
}

function geometry(feature) {
  const hit = featureCache.get(feature);
  if (hit?.source === feature.rings) return hit;
  const groups = [], rings = [];
  for (const source of feature.rings || []) {
    if (!source.xy || source.n < 3) continue;
    const ring = { xy: source.xy, n: source.n, bbox: ringBox(source) };
    rings.push(ring);
    // buildGeo preserves polygon order: an outer ring, then its own holes.
    if (!source.hole) groups.push({ outer: ring, holes: [] });
    else if (groups.length) groups[groups.length - 1].holes.push(ring);
  }
  const result = { source: feature.rings, groups, rings };
  featureCache.set(feature, result);
  return result;
}

// 0 = outside, 1 = inside, 2 = boundary. The query may be in any world copy.
function ringRelation(ring, X, Y) {
  const b = ring.bbox;
  if (Y < b[1] - EPS || Y > b[3] + EPS) return 0;
  const first = Math.ceil(X - b[2] - EPS), last = Math.floor(X - b[0] + EPS);
  for (let shift = first; shift <= last; shift++) {
    const x = X - shift;
    let inside = false;
    for (let i = 0, j = ring.n - 1; i < ring.n; j = i++) {
      const ax = ring.xy[2 * j], ay = ring.xy[2 * j + 1];
      const bx = ring.xy[2 * i], by = ring.xy[2 * i + 1];
      const dx = bx - ax, dy = by - ay, length = Math.hypot(dx, dy);
      if (length > 0 && Math.abs(cross(x - ax, Y - ay, dx, dy)) <= EPS * length
        && x >= Math.min(ax, bx) - EPS && x <= Math.max(ax, bx) + EPS
        && Y >= Math.min(ay, by) - EPS && Y <= Math.max(ay, by) + EPS) return 2;
      if ((ay > Y) !== (by > Y) && x < ax + (Y - ay) * dx / dy) inside = !inside;
    }
    if (inside) return 1;
  }
  return 0;
}

function contains(feature, X, Y) {
  for (const group of feature.geometry.groups) {
    if (ringRelation(group.outer, X, Y)
      && !group.holes.some(hole => ringRelation(hole, X, Y) === 1)) return true;
  }
  return false;
}

function boundaryCuts(ring, ax, ay, bx, by, cuts) {
  const b = ring.bbox, lowY = Math.min(ay, by), highY = Math.max(ay, by);
  if (highY < b[1] - EPS || lowY > b[3] + EPS) return;
  const lowX = Math.min(ax, bx), highX = Math.max(ax, bx);
  const first = Math.ceil(lowX - b[2] - EPS), last = Math.floor(highX - b[0] + EPS);
  const rx = bx - ax, ry = by - ay, rr = rx * rx + ry * ry;
  if (!rr) return;
  const add = t => { if (t >= -PARAM_EPS && t <= 1 + PARAM_EPS) cuts.push(Math.max(0, Math.min(1, t))); };
  for (let shift = first; shift <= last; shift++) {
    for (let i = 0, j = ring.n - 1; i < ring.n; j = i++) {
      const cx = ring.xy[2 * j] + shift, cy = ring.xy[2 * j + 1];
      const dx = ring.xy[2 * i] + shift, dy = ring.xy[2 * i + 1];
      if (Math.max(cx, dx) < lowX - EPS || Math.min(cx, dx) > highX + EPS
        || Math.max(cy, dy) < lowY - EPS || Math.min(cy, dy) > highY + EPS) continue;
      const sx = dx - cx, sy = dy - cy, qx = cx - ax, qy = cy - ay;
      const denominator = cross(rx, ry, sx, sy);
      if (Math.abs(denominator) > Number.EPSILON * 16 * Math.sqrt(rr * (sx * sx + sy * sy))) {
        const t = cross(qx, qy, sx, sy) / denominator, u = cross(qx, qy, rx, ry) / denominator;
        if (u >= -PARAM_EPS && u <= 1 + PARAM_EPS) add(t);
      } else if (Math.abs(cross(qx, qy, rx, ry)) <= EPS * Math.sqrt(rr)) {
        // Collinear borders still split the route at both overlap endpoints.
        add((qx * rx + qy * ry) / rr);
        add(((dx - ax) * rx + (dy - ay) * ry) / rr);
      }
    }
  }
}

function geometryRefs(features) {
  const refs = [];
  for (const feature of features || []) refs.push(feature, feature.rings);
  return refs;
}

function sourceState(geo, mode, country, detailLevel) {
  const countries = geo?.hi?.features || [];
  const details = mode === 'country' ? [] : country
    ? [[country, geo?.details?.get(country)]]
    : Array.from(geo?.details?.entries?.() || []).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  return {
    countries, countryRefs: geometryRefs(countries),
    details: details.filter(([, pack]) => pack).map(([name, pack]) => {
      const level = detailLevelOf(geo, name, detailLevel), regions = pack.levels?.[level];
      return { name, pack, level, regions, regionRefs: geometryRefs(regions) };
    }),
  };
}

const sameRefs = (a, b) => a.length === b.length && a.every((value, i) => value === b[i]);
function sameSources(a, b) {
  return a.countries === b.countries && sameRefs(a.countryRefs, b.countryRefs)
    && a.details.length === b.details.length && a.details.every((d, i) =>
      d.name === b.details[i].name && d.pack === b.details[i].pack && d.level === b.details[i].level && d.regions === b.details[i].regions
      && sameRefs(d.regionRefs, b.details[i].regionRefs));
}

function placeFeatures(sources) {
  const regions = [], countries = [];
  const wrap = (f, key) => ({ text: String(f.name || '').trim(), key, geometry: geometry(f) });
  for (const detail of sources.details) {
    for (const feature of detail.regions || []) {
      regions.push(wrap(feature, `region:${detail.name}:${detail.level}:${feature.key || feature.name}`));
    }
  }
  for (const feature of sources.countries) countries.push(wrap(feature, `country:${feature.name}`));
  return [...regions, ...countries].filter(f => f.text && f.geometry.rings.length);
}

function snapshot(route) {
  const n = Math.min(route.n ?? route.X?.length ?? 0, route.X?.length ?? 0, route.Y?.length ?? 0);
  if (!Number.isInteger(n) || n < 1) return null;
  const X = Float64Array.from(Array.from(route.X).slice(0, n));
  const Y = Float64Array.from(Array.from(route.Y).slice(0, n));
  if (!X.every(Number.isFinite) || !Y.every(Number.isFinite)) return null;
  const cum = new Float64Array(n);
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(X[i] - X[i - 1], Y[i] - Y[i - 1]);
  return { n, X, Y, cum, total: cum[n - 1], key: route.key, entries: [] };
}

function sameRoute(route, state) {
  return state && (route.n ?? route.X?.length) === state.n && route.key === state.key
    && route.X?.length >= state.n && route.Y?.length >= state.n
    && state.X.every((x, i) => x === route.X[i] && state.Y[i] === route.Y[i]);
}

function pointAt(route, s) {
  if (!route.total) return { X: route.X[0], Y: route.Y[0] };
  const distance = s * route.total;
  let lo = 0, hi = route.n - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (route.cum[mid] <= distance) lo = mid; else hi = mid;
  }
  const length = route.cum[hi] - route.cum[lo], t = length ? (distance - route.cum[lo]) / length : 0;
  return { X: route.X[lo] + (route.X[hi] - route.X[lo]) * t, Y: route.Y[lo] + (route.Y[hi] - route.Y[lo]) * t };
}

function traceLabels(route, features) {
  const classify = (X, Y) => features.find(f => contains(f, X, Y));
  const runs = [], byPlace = new Map();
  const add = (feature, start, end) => {
    if (!feature) return;
    const previous = runs[runs.length - 1];
    if (previous?.feature.key === feature.key && Math.abs(previous.end - start) < PARAM_EPS) previous.end = end;
    else runs.push({ feature, start, end });
  };
  add(classify(route.X[0], route.Y[0]), 0, 0);
  if (route.total) for (let i = 1; i < route.n; i++) {
    const ax = route.X[i - 1], ay = route.Y[i - 1], bx = route.X[i], by = route.Y[i];
    const length = route.cum[i] - route.cum[i - 1];
    if (!length) continue;
    const cuts = [0, 1];
    for (const feature of features) for (const ring of feature.geometry.rings) boundaryCuts(ring, ax, ay, bx, by, cuts);
    cuts.sort((a, b) => a - b);
    let from = cuts[0];
    for (let j = 1; j < cuts.length; j++) {
      const to = cuts[j];
      if (to - from < PARAM_EPS) continue;
      const t = (from + to) / 2;
      add(classify(ax + (bx - ax) * t, ay + (by - ay) * t),
        (route.cum[i - 1] + from * length) / route.total, (route.cum[i - 1] + to * length) / route.total);
      from = to;
    }
  }
  if (route.n > 1) add(classify(route.X[route.n - 1], route.Y[route.n - 1]), 1, 1);
  for (const run of runs) {
    const hit = byPlace.get(run.feature.key);
    if (!hit) byPlace.set(run.feature.key, { ...run, enterS: run.start });
    else if (run.end - run.start > hit.end - hit.start + PARAM_EPS) {
      byPlace.set(run.feature.key, { ...run, enterS: hit.enterS });
    }
  }
  return Array.from(byPlace.values(), ({ feature, start, end, enterS }) => {
    const s = (start + end) / 2;
    return { text: feature.text, key: feature.key, ...pointAt(route, s), s, enterS };
  }).sort((a, b) => a.s - b.s || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/**
 * Names crossed by a planeRoute, in route order. Coordinates remain unwrapped
 * world units; s is the normalized distance at a representative point inside
 * the longest visited stretch, and enterS is the first entry into the place.
 * Country mode uses world countries. Auto/region prefer loaded administrative
 * regions, with country fallback where detail is unavailable. A supplied
 * country limits detail to that pack; otherwise all loaded packs are eligible.
 * Exact polygon intersections also detect narrow places on two-point paths.
 */
export function routePlaceLabels(geo, route, { mode = 'auto', country, detailLevel } = {}) {
  if (!route || typeof route !== 'object') return [];
  mode = mode === 'country' ? 'country' : 'auto';
  let state = routeCache.get(route);
  if (!sameRoute(route, state)) {
    state = snapshot(route);
    if (!state) return [];
    routeCache.set(route, state);
  }
  const sources = sourceState(geo, mode, country, detailLevel);
  const hit = state.entries.find(e => e.mode === mode && e.country === country && e.detailLevel === detailLevel && sameSources(e.sources, sources));
  if (hit) return hit.labels;
  const labels = traceLabels(state, placeFeatures(sources));
  // Keep a few recent property combinations; obsolete geometry is not retained
  // indefinitely when detail packs load or the selected detail level changes.
  state.entries.push({ mode, country, detailLevel, sources, labels });
  if (state.entries.length > 8) state.entries.shift();
  return labels;
}
