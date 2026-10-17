const VERSION = 'mapflow-v1.0.2';
const CORE = ['./','./index.html','./mapflow.css','./mapflow.js','./manifest.webmanifest','./icons/icon.svg','./icons/icon-192.png','./icons/icon-512.png','./map-engine.mjs','./map-objects.mjs','./map-route-labels.mjs','./map-country-details.mjs','./map-imagery.mjs','./map-navigation.mjs','./map-places.mjs','./map-video-export.mjs','./engine.mjs','./vector-layers.mjs','./motion-extras.mjs','./motion-structured.mjs','./charts.mjs','./motion-path.mjs','./motion-video.mjs','./map-data/countries-50m.json','./map-data/countries-110m.json'];
self.addEventListener('install',event=>event.waitUntil(caches.open(VERSION).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('mapflow-')&&k!==VERSION).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const req=event.request;if(req.method!=='GET'||new URL(req.url).origin!==self.location.origin)return;
  event.respondWith(caches.match(req,{ignoreSearch:true}).then(hit=>hit||fetch(req).then(resp=>{if(resp.ok){const cp=resp.clone();caches.open(VERSION).then(c=>c.put(req,cp));}return resp;})));
});
