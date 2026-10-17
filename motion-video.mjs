export function videoTimeAt(layer, frame, fps, duration = layer.videoDuration) {
  return Math.max(0, Math.min(Math.max(0, duration - .001), (layer.videoOffset || 0) + Math.max(0, frame - layer.in) / fps));
}
export function validateMotionVideo(layer) {
  if (!/^data:video\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+$/i.test(layer.src || '') ||
      !Number.isFinite(layer.videoDuration) || layer.videoDuration <= 0 ||
      !Number.isFinite(layer.videoOffset) || layer.videoOffset < 0 || layer.videoOffset >= layer.videoDuration ||
      typeof layer.videoMuted !== 'boolean') throw Error('Invalid video layer.');
}
export function createMotionVideoStore({ redraw = () => {}, audioReady = () => {} } = {}) {
  const records = new Map(); let audioContext;
  function ensure(src, sound = true) {
    let r = records.get(src);
    if (!r) {
      const video = document.createElement('video'); video.muted = true; video.playsInline = true; video.preload = 'auto';
      r = { video, src, chain: Promise.resolve(), target: null, previewing: false, audio: null, audioState: 'loading' };
      records.set(src, r);
      r.ready = new Promise((resolve, reject) => {
        const timer = setTimeout(() => finish(Error('Video loading timed out.')), 30000);
        const finish = error => { clearTimeout(timer); video.removeEventListener('loadeddata', loaded); video.removeEventListener('error', failed); error ? reject(error) : resolve(r); };
        const loaded = () => finish(), failed = () => finish(Error('This video format could not be decoded. Try MP4 or WebM.'));
        video.addEventListener('loadeddata', loaded); video.addEventListener('error', failed); video.src = src; video.load();
      });
      r.ready.then(redraw, () => {});
    }
    if (sound && !r.audioJob) {
      r.audioJob = (async () => {
        try {
          audioContext ||= new AudioContext();
          r.audio = await audioContext.decodeAudioData(await (await fetch(src)).arrayBuffer());
          r.audioState = 'ready';
        } catch { r.audioState = 'silent'; }
        audioReady();
      })();
    }
    return r;
  }
  function seek(r, time) {
    const task = r.chain.catch(() => {}).then(async () => {
      await r.ready;
      if (!r.video.seeking && r.video.readyState >= 2 && Math.abs(r.video.currentTime - time) < .00001) return;
      await new Promise((resolve, reject) => {
        const video = r.video, timer = setTimeout(() => finish(Error('Video seeking timed out.')), 15000);
        const finish = error => { clearTimeout(timer); video.removeEventListener('seeked', done); video.removeEventListener('error', fail); error ? reject(error) : resolve(); };
        const done = () => finish(), fail = () => finish(Error('Could not decode the video frame.'));
        video.addEventListener('seeked', done); video.addEventListener('error', fail); video.currentTime = time;
      });
    });
    r.chain = task; return task;
  }
  async function previewRecord(r) {
    if (r.previewing || r.failed) return;
    r.previewing = true;
    try {
      while (r.target !== null) {
        const time = r.target; r.target = null;
        await seek(r, time); redraw();
      }
    } catch (e) { r.failed = e.message; redraw(); }
    finally { r.previewing = false; }
  }
  function syncPreview(project, frame) {
    for (const l of project.layers) if (l.type === 'video') {
      const r = ensure(l.src);
      if (l.visible === false || frame < l.in || frame > l.out) continue;
      const time = videoTimeAt(l, frame, project.fps);
      if (r.video.readyState >= 2 && !r.video.seeking && Math.abs(r.video.currentTime - time) < .00001 && !r.previewing) continue;
      r.target = time; void previewRecord(r);
    }
  }
  async function preload(project, sound = true) {
    await Promise.all(project.layers.filter(l => l.type === 'video').map(async l => { const r = ensure(l.src, sound); await r.ready; if (sound) await r.audioJob; }));
  }
  async function prepare(project, frame) {
    await Promise.all(project.layers.filter(l => l.type === 'video' && l.visible !== false && frame >= l.in && frame <= l.out).map(l => seek(ensure(l.src, false), videoTimeAt(l, frame, project.fps))));
  }
  function audioLayers(project) {
    return project.layers.filter(l => l.type === 'video' && !l.videoMuted && l.visible !== false).flatMap(l => {
      const buffer = records.get(l.src)?.audio;
      const parent = project.layers.find(p => p.id === l.parentId);
      if (!buffer || parent?.visible === false) return [];
      const start = Math.max(l.in, parent?.in ?? l.in), end = Math.min(l.out + 1, (parent?.out ?? l.out) + 1);
      const source = (l.videoOffset || 0) + (start - l.in) / project.fps;
      const duration = Math.min((end - start) / project.fps, buffer.duration - source);
      return duration > 0 ? [{ buffer, start: start / project.fps, source, duration, volume: 1, muted: false }] : [];
    });
  }
  function dispose() { for (const r of records.values()) { r.video.pause(); r.video.removeAttribute('src'); r.video.load(); } records.clear(); void audioContext?.close(); }
  return { ensure, preload, syncPreview, prepare, audioLayers, dispose, get: src => records.get(src)?.video, status: src => records.get(src) };
}
