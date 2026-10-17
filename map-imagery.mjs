// FrameFlow Map Studio: satellite / photo-realistic raster tiles.
// The engine (map-engine.mjs) stays DOM-free: it only asks this provider for decoded tiles.
// Tiles use the standard Web-Mercator XYZ scheme, the same space as the vector map.
//
// IMPORTANT: a source must send CORS headers (Access-Control-Allow-Origin). Tiles are fetched with
// fetch() + createImageBitmap(), so a source without CORS simply fails and never taints the canvas
// (a tainted canvas would break PNG snapshots and video export).

export const IMAGERY_SOURCES = {
  gibs: {
    label: 'NASA Blue Marble (free, soft up close)',
    url: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg',
    maxZoom: 8,
    attribution: 'Imagery: NASA Blue Marble / GIBS',
  },
  esri: {
    label: 'Esri World Imagery (sharp, check licence)',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    maxZoom: 17,
    attribution: 'Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
  },
};
export const DEFAULT_IMAGERY = 'gibs';

export function createImagery({ sources = IMAGERY_SOURCES, limit = 700, concurrency = 8 } = {}) {
  const cache = new Map();           // key -> { img: ImageBitmap | null, state: 'loading' | 'ok' | 'error', waiters: [] }
  const queue = []; let active = 0, failed = 0;
  const api = { onTile: null };
  const src = id => sources[id] || sources[DEFAULT_IMAGERY];
  const keyOf = (id, z, x, y) => `${sources[id] ? id : DEFAULT_IMAGERY}/${z}/${x}/${y}`;

  function pump() {
    while (active < concurrency && queue.length) {
      const job = queue.shift(); active++;
      const s = src(job.id), url = s.url.replace('{z}', job.z).replace('{x}', job.x).replace('{y}', job.y);
      fetch(url, { mode: 'cors' })
        .then(r => { if (!r.ok) throw Error('HTTP ' + r.status); return r.blob(); })
        .then(b => createImageBitmap(b))
        .then(img => { job.entry.img = img; job.entry.state = 'ok'; })
        .catch(() => { job.entry.state = 'error'; failed++; })
        .finally(() => {
          active--; const w = job.entry.waiters; job.entry.waiters = [];
          for (const f of w) f();
          if (job.entry.state === 'ok' && api.onTile) api.onTile();
          pump();
        });
    }
  }
  function touch(key, entry) { cache.delete(key); cache.set(key, entry); }
  function evict() {
    if (cache.size <= limit) return;
    for (const [k, e] of cache) { if (cache.size <= limit * .85) break; if (e.state !== 'loading') { e.img?.close?.(); cache.delete(k); } }
  }
  /** Decoded tile, or null. Starts loading it when it is not known yet. */
  api.get = (id, z, x, y) => {
    const key = keyOf(id, z, x, y); let e = cache.get(key);
    if (!e) {
      e = { img: null, state: 'loading', waiters: [] }; cache.set(key, e);
      queue.push({ id, z, x, y, entry: e }); pump(); evict();
    } else touch(key, e);
    return e.img;
  };
  /** Decoded tile if already in memory (never starts a download). */
  api.peek = (id, z, x, y) => cache.get(keyOf(id, z, x, y))?.img || null;
  api.maxZoom = id => src(id).maxZoom;
  api.attribution = id => src(id).attribution;
  api.failedCount = () => failed;
  /** Resolves once every tile is decoded or has failed for good (so exports never hang). */
  api.ready = (tiles, cancelled = () => false) => Promise.all(tiles.map(t => {
    api.get(t.src, t.z, t.x, t.y);
    const e = cache.get(keyOf(t.src, t.z, t.x, t.y));
    if (!e || e.state !== 'loading') return null;
    return new Promise(res => e.waiters.push(res));
  }).filter(Boolean)).then(() => { if (cancelled()) throw new DOMException('Export cancelled.', 'AbortError'); });
  api.prefetch = tiles => { for (const t of tiles) api.get(t.src, t.z, t.x, t.y); };
  return api;
}
