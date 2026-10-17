// Optional real-browser regression checks: node tests/ui.mjs [Chrome/Edge executable]
// Uses Node 22's built-in WebSocket; no npm dependencies are required.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, mkdtemp, rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve, extname, dirname, basename, sep} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';

const browserPath=process.argv[2] || [
 'C:/Program Files/Google/Chrome/Application/chrome.exe',
 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
].find(existsSync);
assert(browserPath,'Pass a Chrome or Edge executable as the first argument.');
const root=resolve(import.meta.dirname,'..');
let legacyWorker=false;
const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'};
const server=createServer(async(req,res)=>{
 try{
  const path=resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/\/$/,'/index.html'));
  if(!path.startsWith(root+sep))throw Error('Invalid path');
  if(legacyWorker&&path===resolve(root,'sw.js')){
   res.setHeader('Content-Type','text/javascript');
   res.end(`self.addEventListener('install',e=>e.waitUntil(self.skipWaiting()));self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));self.addEventListener('fetch',e=>{if(e.request.method==='GET'&&new URL(e.request.url).origin===location.origin)e.respondWith(caches.match(e.request,{ignoreSearch:true}).then(hit=>hit||fetch(e.request)));});`);return;
  }
  res.setHeader('Content-Type',types[extname(path)]||'application/octet-stream');res.end(await readFile(path));
 }catch{res.writeHead(404);res.end();}
});
server.listen(0,'127.0.0.1');await once(server,'listening');
const profile=await mkdtemp(join(tmpdir(),'mapflow-ui-'));
let browser,ws;
try{
 browser=spawn(browserPath,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',`--user-data-dir=${profile}`,'--remote-debugging-port=0','about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
 const endpoint=await new Promise((resolve,reject)=>{
  let output='';const timer=setTimeout(()=>reject(Error('Browser startup timed out')),20000);
  browser.on('error',error=>{clearTimeout(timer);reject(error);});
  browser.on('exit',code=>{clearTimeout(timer);reject(Error(`Browser exited (${code}): ${output}`));});
  browser.stderr.on('data',chunk=>{output+=chunk;const match=output.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(match){clearTimeout(timer);resolve(match[1]);}});
 });
 ws=new WebSocket(endpoint);await once(ws,'open');
 let seq=0;const pending=new Map();
 ws.addEventListener('message',event=>{const msg=JSON.parse(event.data);if(msg.id){const task=pending.get(msg.id);pending.delete(msg.id);if(msg.error)task.reject(Error(msg.error.message));else task.resolve(msg.result);}});
 const call=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params,sessionId}));});
 const {targetId}=await call('Target.createTarget',{url:'about:blank'});
 const {sessionId}=await call('Target.attachToTarget',{targetId,flatten:true});
 const page=(method,params)=>call(method,params,sessionId);
 const evaluate=async (expression,userGesture=false)=>{
  const result=await page('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture});
  assert(!result.exceptionDetails,JSON.stringify(result.exceptionDetails));return result.result.value;
 };
 const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const until=async expression=>{for(let i=0;i<100;i++){if(await evaluate(expression))return;await delay(100);}throw Error('Timed out: '+expression);};
 await page('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 await page('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
 await page('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/`});
 await until(`!!document.getElementById('newProjectBtn')?.onclick`);
 assert.equal(await evaluate(`document.getElementById('homeScreen').hidden`),false);
 assert.equal(await evaluate(`document.getElementById('workspace').hidden`),true);
 assert.equal(await evaluate(`getComputedStyle(document.querySelector('h1')).userSelect`),'none');
 await evaluate(`document.getElementById('newProjectBtn').click()`);
 await until(`!document.getElementById('workspace').hidden`);
 await evaluate(`document.getElementById('homeBtn').click()`);
 await until(`!document.getElementById('homeScreen').hidden`);
 assert.equal(await evaluate(`document.getElementById('resumeProjectBtn').hidden`),false);
 await evaluate(`document.getElementById('resumeProjectBtn').click()`);
 await until(`!document.getElementById('workspace').hidden`);
 await evaluate(`document.getElementById('fullscreenBtn').click()`,true);
 await until(`document.fullscreenElement?.id==='previewPanel'`);
 assert.equal(await evaluate(`document.getElementById('fullscreenBtn').getAttribute('aria-pressed')`),'true');
 assert(await evaluate(`(()=>{const r=document.getElementById('previewPanel').getBoundingClientRect();return r.width>=innerWidth-1&&r.height>=innerHeight-1;})()`),'Fullscreen preview must fill the viewport');
 await evaluate(`document.getElementById('previewPlayBtn').click()`);
 assert.equal(await evaluate(`document.getElementById('previewPlayBtn').textContent`),'Pause');
 await evaluate(`document.getElementById('previewPlayBtn').click();document.getElementById('fullscreenBtn').click()`,true);
 await until(`!document.fullscreenElement&&!document.getElementById('previewPanel').classList.contains('preview-expanded')`);
 assert.equal(await evaluate(`document.querySelector('.editing-panel').inert`),false);
 // Native browser exit must also restore the editor and its controls.
 await evaluate(`document.getElementById('fullscreenBtn').click()`,true);
 await until(`!!document.fullscreenElement`);
 await evaluate(`document.exitFullscreen()`);
 await until(`document.getElementById('fullscreenBtn').getAttribute('aria-pressed')==='false'`);
 // Simulate an unsupported/denied native request and verify in-app expansion.
 await evaluate(`document.getElementById('previewPanel').requestFullscreen=()=>Promise.reject(new Error('Unavailable'));document.getElementById('fullscreenBtn').click()`);
 assert.equal(await evaluate(`document.getElementById('previewPanel').classList.contains('preview-expanded')&&!document.fullscreenElement`),true);
 await page('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
 await page('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
 await evaluate(`delete document.getElementById('previewPanel').requestFullscreen`);
 assert.equal(await evaluate(`document.getElementById('previewPlayBtn').hidden`),true);
 // Seed a realistic stack of layers and reopen the saved project.
 await evaluate(`(async()=>{const {newMapProject,makeAction}=await import('./map-engine.mjs');const p=newMapProject();p.name='Scroll regression';p.width=720;p.height=1280;p.frames=360;p.actions=Array.from({length:14},()=>makeAction('pin',0));localStorage.setItem('mapflow-mobile-project-v1',JSON.stringify(p));location.reload();})()`);
 await until(`document.querySelectorAll('.clip').length===14 && document.getElementById('loading').hidden`);
 const metrics=await evaluate(`(()=>{const v=document.getElementById('timelineViewport');const c=document.querySelector('.clip').getBoundingClientRect();return {height:v.clientHeight,scrollHeight:v.scrollHeight,x:c.x+20,y:c.y+15};})()`);
 assert(metrics.scrollHeight>metrics.height,'Timeline must overflow vertically');
 const originalTime=await evaluate(`document.getElementById('currentTime').textContent`);
 // A vertical swipe starting ON a clip must scroll without opening its editor.
 await page('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:metrics.x,y:metrics.y}]});
 for(let i=1;i<=5;i++){await page('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:metrics.x,y:metrics.y-i*12}]});await delay(35);}
 await page('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await delay(250);
 assert(await evaluate(`document.getElementById('timelineViewport').scrollTop>0`),'Vertical swipe over a clip must scroll');
 assert.equal(await evaluate(`document.getElementById('sheet').classList.contains('open')`),false);
 assert.equal(await evaluate(`document.getElementById('currentTime').textContent`),originalTime);
 await evaluate(`document.querySelector('[data-tool="project"]').click()`);
 assert.equal(await evaluate(`getComputedStyle(document.querySelector('#sheetContent input')).userSelect`),'text');
 await evaluate(`document.getElementById('closeSheet').click();document.getElementById('timelineViewport').scrollLeft=72`);
 await until(`document.getElementById('currentTime').textContent!=='00:00.0'`);
 await until(`!!navigator.serviceWorker.controller`);
 const savedProject=await evaluate(`localStorage.getItem('mapflow-mobile-project-v1')`);
 // Online navigation must replace stale cached HTML, and offline still works.
 await evaluate(`(async()=>{const keys=await caches.keys();const cache=await caches.open(keys.find(k=>k.startsWith('mapflow-')));await cache.put(new URL('./',location.href),new Response('<h1>Stale app</h1>',{headers:{'Content-Type':'text/html'}}));location.reload();})()`);
 await until(`!!document.getElementById('fullscreenBtn')?.onclick`);
 assert.equal(await evaluate(`localStorage.getItem('mapflow-mobile-project-v1')`),savedProject);
 await page('Network.enable');
 await page('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:-1,uploadThroughput:-1});
 await page('Page.reload');
 await until(`!!document.getElementById('fullscreenBtn')?.onclick`);
 assert.equal(await evaluate(`localStorage.getItem('mapflow-mobile-project-v1')`),savedProject);
 await page('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
 // Reproduce the old cache-first worker, then repair it through update.html.
 legacyWorker=true;
 await evaluate(`(async()=>{const r=await navigator.serviceWorker.getRegistration();await r.update();})()`);
 await until(`!!document.getElementById('fullscreenBtn')?.onclick`);
 await delay(500);
 await evaluate(`(async()=>{const home=new URL('./',location.href);for(const key of await caches.keys()){const cache=await caches.open(key);await cache.delete(home.href,{ignoreSearch:true});}const cache=await caches.open('mapflow-legacy-test');await cache.put(home,new Response('<h1>Stale app</h1>',{headers:{'Content-Type':'text/html'}}));})()`);
 await page('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/`});
 await until(`document.querySelector('h1')?.textContent==='Stale app'`);
 await page('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/update.html`});
 await until(`!!document.getElementById('updateBtn')?.onclick`);
 legacyWorker=false;
 await evaluate(`document.getElementById('updateBtn').click()`);
 await until(`!!document.getElementById('fullscreenBtn')?.onclick`);
 assert.equal(await evaluate(`localStorage.getItem('mapflow-mobile-project-v1')`),savedProject);
 assert.equal(await evaluate(`document.getElementById('recentProjectName').textContent`),'Scroll regression');
 console.log('UI checks passed: home, fullscreen/playback/fallback, touch scrolling, scrubbing, stale-cache refresh, offline startup, and legacy-worker recovery with saved project preserved.');
}finally{
 ws?.close();if(browser&&browser.exitCode===null){const exited=once(browser,'exit');browser.kill();await exited.catch(()=>{});}
 server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
 assert.equal(dirname(resolve(profile)),resolve(tmpdir()));assert(basename(profile).startsWith('mapflow-ui-'));
 await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
