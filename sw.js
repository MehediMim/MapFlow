const VERSION = 'mapflow-v1.0.3';
const CORE = ['./','./index.html','./mapflow.css','./mapflow.js','./manifest.webmanifest','./icons/icon.svg','./icons/icon-192.png','./icons/icon-512.png','./map-engine.mjs','./map-objects.mjs','./map-route-labels.mjs','./map-country-details.mjs','./map-imagery.mjs','./map-navigation.mjs','./map-places.mjs','./map-video-export.mjs','./engine.mjs','./vector-layers.mjs','./motion-extras.mjs','./motion-structured.mjs','./charts.mjs','./motion-path.mjs','./motion-video.mjs','./map-data/countries-50m.json','./map-data/countries-110m.json'];
self.addEventListener('install',event=>event.waitUntil(caches.open(VERSION).then(c=>c.addAll(CORE.map(url=>new Request(url,{cache:'reload'})))).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('mapflow-')&&k!==VERSION).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const req=event.request;if(req.method!=='GET'||new URL(req.url).origin!==self.location.origin)return;
  const url=new URL(req.url);
  // Recovery must always reach the server, including when an old shell is cached.
  if(url.pathname.endsWith('/update.html'))return;
  const shell=req.mode==='navigate'||/\.(?:html|css|js|mjs|webmanifest)$/.test(url.pathname);
  event.respondWith((async()=>{
    const cache=await caches.open(VERSION);
    const cached=()=>cache.match(req,{ignoreSearch:true});
    if(!shell){const hit=await cached();if(hit)return hit;}
    try{
      const response=await fetch(shell?new Request(req,{cache:'no-cache'}):req);
      if(response.ok){try{await cache.put(req,response.clone());}catch{}return response;}
      return await cached()||response;
    }catch(error){
      const hit=await cached();if(hit)return hit;
      throw error;
    }
  })());
});
