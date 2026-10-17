import { makeView, screenToLonLat, lonToX, latToY } from './map-engine.mjs';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const wrapDelta = x => x - Math.round(x);

// Keep the ground under the mouse fixed, including with a tilted or rotated map.
export function panMapCamera(view, from, to) {
  const a = screenToLonLat(view, from.sx, from.sy), b = screenToLonLat(view, to.sx, to.sy);
  if (!a || !b) return null;
  return { ...view.cam, cx: view.cx + wrapDelta(lonToX(a.lon) - lonToX(b.lon)), cy: clamp(view.cy + latToY(a.lat) - latToY(b.lat), 0, 1) };
}

export function zoomMapCamera(view, point, delta) {
  const cam = { ...view.cam, zoom: clamp(view.cam.zoom + delta, 0, 12) };
  const next = makeView(cam, view.W, view.H);
  const a = screenToLonLat(view, point.sx, point.sy), b = screenToLonLat(next, point.sx, point.sy);
  if (a && b) {
    cam.cx += wrapDelta(lonToX(a.lon) - lonToX(b.lon));
    cam.cy = clamp(cam.cy + latToY(a.lat) - latToY(b.lat), 0, 1);
  }
  return cam;
}
