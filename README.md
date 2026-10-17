# Mapflow — mobile map animation studio

**Mapflow** is a standalone, mobile-first version of the FrameFlow Map Studio. Its dark editing workspace, bottom-sheet controls, scrub-able clip timeline, and touch gestures are designed for phones in the style of modern mobile video editors.

It is a **Progressive Web App (PWA)**, not a compiled Android APK or iOS IPA. The ZIP contains complete working source code: no backend, build process, or API key is needed. It can be installed onto the home screen when hosted over HTTPS (or used in a browser from a local server).

## Quick start: desktop or development

1. Extract the ZIP. Open a terminal **inside the `Mapflow` folder**, next to `index.html`.
2. Run `python -m http.server 8000` (or `py -m http.server 8000` on Windows).
3. Open **http://localhost:8000/**.

Do **not** double-click `index.html` and open it as a `file://` URL; browsers normally block JavaScript module imports and JSON data loading from local files.

## Install as a mobile app

1. Host the **contents** of the `Mapflow` folder on any HTTPS static hosting platform, such as GitHub Pages, Netlify, or Cloudflare Pages. For GitHub Pages, add all of its contents to your repository root, including `index.html`, `map-data/`, `icons/`, `sw.js`, and all `.mjs` files; enable GitHub Pages in repository settings.
2. Open your HTTPS URL in **Chrome on Android**, then use **Install app** or **Add to Home screen**. On **iPhone**, open the URL in Safari, tap the Share icon, and choose **Add to Home Screen**.
3. Open **Mapflow** from your phone's home screen. Its interface opens without the browser address bar in supported standalone modes.

A local Wi-Fi HTTP URL can be used to preview the app on your phone, but **PWA installation and offline caching normally require HTTPS** (localhost is the development exception). This is a web app, so it is not an APK installable by opening the ZIP. To distribute through app stores, package the web app using a native wrapper such as Capacitor and follow that platform's signing/build process.

## What you can edit

- **Animations:** Border, Travel, Highlight, Pin, Object, Effect, Arrow/Zone, and Text Label.
- **Camera:** Fly to, Swoop, Push in, Pull back, Orbit, Tilt, Pan to, Frame route, Follow traveler, and Back to start.
- **Timeline:** Tap to select a clip, drag a clip to change its start time, drag its right handle to change duration, swipe the ruler and lanes to scrub, and use the timeline zoom control.
- **Map preview:** Drag to explore, pinch to zoom, or scroll-wheel zoom on desktop. Use **Project → Use preview view** to save the camera as the project's starting view. When playback starts, temporary preview navigation is cleared so timeline camera movements run.
- **Touch picking:** Tap **◎ Pick** next to a place to select it directly from the map. For Travel, Shape, and moving Object layers, tap **Draw on map** to add route waypoints, then **Done**.
- **Style:** Map themes, raster satellite choices, procedural textures, grid toggle, map labels, and per-layer colors.
- **Project:** 9:16 portrait, 16:9 landscape, or square; 24/30/60 FPS; duration; detailed country framing; undo/redo; autosave; JSON import/export.
- **Export:** Full-resolution **PNG** for the current frame; rendered **WebM video** in browsers with WebCodecs encoding support; editable **JSON** project files compatible with FrameFlow Map Studio.

### Detailed countries

The ZIP includes the uploaded data packs for **Bangladesh** (divisions, districts, and local areas) and **Myanmar** (states/regions and districts), plus 50m/110m world maps. The country detail packs are loaded on demand to reduce initial download and memory use. Other countries can still be selected and viewed using the world map outlines, but do not have subnational boundaries unless a compatible `<country>-detail.json` pack is added to `map-data/`.

**To highlight a district/state:** Open **Project → Map mode → One country (detailed)**, choose Bangladesh or Myanmar, select the boundary level, add **Border** or **Highlight**, then choose or pick a region.

## Video export compatibility

WebM export runs in the browser with WebCodecs and can be memory/CPU-intensive for long videos. Chrome or Edge on Android and desktop are recommended; browser support varies by device. Some Safari/iOS versions do not support this encoder or downloading WebM. **PNG and JSON export remain available**. Keep the browser tab open while rendering; export happens on the device, not on a server. Satellite mode additionally needs network access and a tile source permitting cross-origin use. Esri tiles have separate licensing requirements.

## Data and offline notes

Natural Earth world country geometry is included in the files supplied for the original FrameFlow project. Regional sources and licensing information are retained inside `map-data/bangladesh-detail.json` and `map-data/myanmar-detail.json`; comply with those attributions when distributing maps or videos. The Bangladesh detail data is approximate/simplified regional geometry rather than a street map. Myanmar's boundaries use the source indicated in that pack. Country polygons do not include road-level features.

The service worker caches the core application and world map once installed. Previously visited detail packs are cached as downloaded. Satellite imagery and unseen data require an internet connection. If the app shows an empty screen, start it from HTTP(S), not `file://`, and confirm the full `map-data/` directory was uploaded.

## Project layout

- `index.html` — standalone Mapflow mobile editing interface
- `mapflow.css` — phone, tablet, and desktop responsive editing UI
- `mapflow.js` — mobile timeline, sheet editors, touch gestures, autosave, JSON/PNG/WebM export
- `map-engine.mjs`, `map-objects.mjs`, `map-country-details.mjs`, `map-video-export.mjs`, etc. — adapted FrameFlow map functionality and its direct module dependencies
- `map-data/` — bundled world and detailed-country geometry
- `icons/`, `manifest.webmanifest`, `sw.js` — installable PWA shell
- `tests/smoke.mjs` — geometry/project sanity tests; run `npm test`

**No Motion, Paper, or Scene Studio UI is included.** Several shared headless `.mjs` utility files are included because the original map engine imports them.
