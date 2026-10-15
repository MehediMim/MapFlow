// Offline VP8 + optional Opus/WebM export. No wall-clock playback or captureStream involved.
// WebCodecs timestamps are microseconds; this WebM uses a 1000 ns timecode scale.
const bytes = (...parts) => new Blob(parts);
function uint(n) {
  const a = []; do { a.unshift(n % 256); n = Math.floor(n / 256); } while (n);
  return new Uint8Array(a);
}
function size(n) {
  let width = 1;
  while (n >= 2 ** (7 * width) - 1) width++;
  const a = new Uint8Array(width);
  for (let i = width - 1; i >= 0; i--) { a[i] = n % 256; n = Math.floor(n / 256); }
  a[0] |= 1 << (8 - width); return a;
}
function element(id, body) {
  const b = body instanceof Blob ? body : bytes(body);
  return bytes(uint(id), size(b.size), b);
}
const number = (id, n) => element(id, uint(n));
const string = (id, s) => element(id, new TextEncoder().encode(s));
function float(n) { const a = new Uint8Array(8); new DataView(a.buffer).setFloat64(0, n); return a; }

export function muxWebM(chunks, { width, height, fps, frames, audio = null }) {
  const header = element(0x1a45dfa3, bytes(number(0x4286, 1), number(0x42f7, 1),
    number(0x42f2, 4), number(0x42f3, 8), string(0x4282, 'webm'), number(0x4287, 2), number(0x4285, 2)));
  const info = element(0x1549a966, bytes(number(0x2ad7b1, 1000),
    element(0x4489, float(frames * 1e6 / fps)), string(0x4d80, 'FrameFlow'), string(0x5741, 'FrameFlow')));
  const videoTrack = element(0xae, bytes(number(0xd7, 1), number(0x73c5, 1),
    number(0x83, 1), number(0x9c, 0), string(0x86, 'V_VP8'), number(0x23e383, Math.round(1e9 / fps)),
    element(0xe0, bytes(number(0xb0, width), number(0xba, height)))));
  const audioTrack = audio ? element(0xae, bytes(number(0xd7, 2), number(0x73c5, 2),
    number(0x83, 2), number(0x9c, 0), string(0x86, 'A_OPUS'), element(0x63a2, audio.description),
    number(0x56aa, Math.round(audio.preSkip * 1e9 / 48000)), number(0x56bb, 80000000),
    element(0xe1, bytes(element(0xb5, float(48000)), number(0x9f, audio.channels))))) : null;
  const tracks = element(0x1654ae6b, bytes(videoTrack, ...(audioTrack ? [audioTrack] : [])));
  const packets = chunks.map(c => ({ ...c, track: 1 }));
  if (audio) packets.push(...audio.chunks.map(c => ({ ...c, track: 2 })));
  packets.sort((a,b) => a.timestamp - b.timestamp || a.track - b.track);
  // One cluster per packet avoids signed 16-bit relative-time overflow at microsecond scale.
  const clusters = packets.map(c => {
    const block = bytes(new Uint8Array([0x80 | c.track, 0, 0, c.type === 'key' ? 0x80 : 0]), c.data);
    // DiscardPadding is a signed nanosecond integer. Prefix zero for a positive value.
    const body = c.discardPadding ? element(0xa0, bytes(
      element(0xa1, bytes(new Uint8Array([0x82, 0, 0, 0]), c.data)),
      element(0x75a2, bytes(new Uint8Array([0]), uint(c.discardPadding))))) : element(0xa3, block);
    return element(0x1f43b675, bytes(number(0xe7, c.timestamp), body));
  });
  return new Blob([header, element(0x18538067, bytes(info, tracks, ...clusters))], { type: 'video/webm' });
}

export async function exportMapVideo({ canvas, fps, frames, draw, cancelled = () => false, progress = () => {}, audio = null }) {
  if (!globalThis.VideoEncoder || !globalThis.VideoFrame) {
    throw Error('Frame-by-frame export needs a browser with WebCodecs (Chrome or Edge). Open the app over HTTPS or localhost.');
  }
  const encodedAudio = audio ? await encodeAudio(audio, frames / fps, cancelled) : null;
  const config = { codec: 'vp8', width: canvas.width, height: canvas.height,
    bitrate: 12_000_000, framerate: fps, latencyMode: 'quality' };
  const support = await VideoEncoder.isConfigSupported(config);
  if (!support.supported) throw Error('VP8 encoding is unavailable at this resolution. Try a smaller resolution or Chrome/Edge.');
  const chunks = []; let failure;
  const encoder = new VideoEncoder({ output(chunk) {
    const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data);
    chunks.push({ timestamp: chunk.timestamp, type: chunk.type, data });
  }, error(e) { failure = e; } });
  const check = () => { if (cancelled()) throw new DOMException('Export cancelled.', 'AbortError'); if (failure) throw failure; };
  try {
    encoder.configure(config);
    for (let f = 0; f < frames; f++) {
      check(); await draw(f); check();
      const timestamp = Math.round(f * 1e6 / fps);
      const vf = new VideoFrame(canvas, { timestamp, duration: Math.round((f + 1) * 1e6 / fps) - timestamp });
      try { encoder.encode(vf, { keyFrame: f % Math.max(1, Math.round(fps * 2)) === 0 }); }
      finally { vf.close(); }
      // Bound pending encoder work, while allowing slow frames to take as long as needed.
      if ((f + 1) % 8 === 0) { await encoder.flush(); check(); }
      progress(f + 1);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    await encoder.flush(); check();
    chunks.sort((a, b) => a.timestamp - b.timestamp);
    if (chunks.length !== frames || chunks.some((c, f) => c.timestamp !== Math.round(f * 1e6 / fps))) {
      throw Error('The encoder did not return every frame. No incomplete video was saved.');
    }
    return muxWebM(chunks, { width: canvas.width, height: canvas.height, fps, frames, audio: encodedAudio });
  } finally { if (encoder.state !== 'closed') encoder.close(); }
}


// Render only the retained regions, retaining silence at deleted regions and outside the source.
export async function renderEditedAudio(audio, duration) {
  const layers = audio.layers || audio.segments.map(c => ({...c, buffer: audio.buffer, volume: audio.volume}));
  const channels = Math.min(2, Math.max(...layers.map(l => l.buffer.numberOfChannels)));
  const offline = new OfflineAudioContext(channels, Math.max(1, Math.round(duration * 48000)), 48000);
  for (const c of layers) {
    if (c.muted || !c.volume) continue;
    const skip = Math.max(0, -c.start), start = Math.max(0, c.start);
    const length = Math.min(c.duration - skip, duration - start, c.buffer.duration - c.source - skip);
    if (length <= 0) continue;
    const gain = offline.createGain(); gain.gain.value = c.volume; gain.connect(offline.destination);
    const source = offline.createBufferSource(); source.buffer = c.buffer; source.connect(gain);
    source.start(start, c.source + skip, length);
  }
  return offline.startRendering();
}
async function encodeAudio(audio, duration, cancelled) {
  const check = () => { if (cancelled()) throw new DOMException('Export cancelled.', 'AbortError'); };
  check();
  if (!globalThis.AudioEncoder || !globalThis.AudioData || !globalThis.OfflineAudioContext)
    throw Error('This browser cannot export audio. Use Chrome/Edge with audio encoding support, or mute/remove the track to export visuals only.');
  const layers = audio.layers || audio.segments.map(c => ({...c, buffer: audio.buffer, volume: audio.volume}));
  const channels = Math.min(2, Math.max(...layers.map(l => l.buffer.numberOfChannels)));
  // WebM needs raw Opus packets (format 'opus'), not Ogg-framed ones. Try a few configs, since browsers differ.
  const base = { codec: 'opus', sampleRate: 48000, numberOfChannels: channels, bitrate: 128000 };
  const candidates = [
    { ...base, opus: { format: 'opus', frameDuration: 20000 } },
    { ...base, opus: { frameDuration: 20000 } },
    { ...base }
  ];
  let config = null;
  for (const c of candidates) {
    try { if ((await AudioEncoder.isConfigSupported(c)).supported) { config = c; break; } } catch (_) { /* try next */ }
  }
  if (!config) throw Error('Opus audio encoding is unavailable. Use a supported Chrome/Edge browser, or mute/remove audio.');
  const buffer = await renderEditedAudio(audio, duration); check();
  const chunks = []; let description, failure;
  const encoder = new AudioEncoder({ output(chunk, metadata) {
    const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data);
    chunks.push({ timestamp: chunk.timestamp, duration: chunk.duration || 20000, type: 'key', data });
    const d = metadata?.decoderConfig?.description;
    if (d) description = ArrayBuffer.isView(d) ? new Uint8Array(d.buffer, d.byteOffset, d.byteLength).slice() : new Uint8Array(d).slice();
  }, error(e) { failure = e; } });
  try {
    encoder.configure(config);
    for (let offset = 0; offset < buffer.length; offset += 960) {
      check(); if (failure) throw failure;
      const count = Math.min(960, buffer.length - offset), data = new Float32Array(count * channels);
      for (let ch = 0; ch < channels; ch++) data.set(buffer.getChannelData(ch).subarray(offset, offset + count), ch * count);
      const frame = new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: count,
        numberOfChannels: channels, timestamp: Math.round(offset / 48000 * 1e6), data });
      try { encoder.encode(frame); } finally { frame.close(); }
      // Do not flush mid-stream: Opus flush introduces a fresh codec delay.
      while (encoder.encodeQueueSize > 12) { await new Promise(r => setTimeout(r, 0)); check(); if (failure) throw failure; }
    }
    await encoder.flush(); check(); if (failure) throw failure;
    if (!chunks.length) throw Error('The audio encoder produced no audio. No silent replacement video was saved.');
    // Raw Opus mode often gives no description; build a standard OpusHead (mapping family 0, mono/stereo).
    if (!description || description.length < 19 || new TextDecoder().decode(description.subarray(0,8)) !== 'OpusHead') {
      description = new Uint8Array(19);
      description.set(new TextEncoder().encode('OpusHead'), 0);
      const dv = new DataView(description.buffer);
      description[8] = 1; description[9] = channels;
      dv.setUint16(10, 312, true);      // pre-skip (libopus lookahead at 48 kHz)
      dv.setUint32(12, 48000, true);    // original input sample rate
      dv.setInt16(16, 0, true);         // output gain
      description[18] = 0;              // channel mapping family 0
    }
    const preSkip = new DataView(description.buffer, description.byteOffset, description.byteLength).getUint16(10, true);
    chunks.sort((a,b) => a.timestamp - b.timestamp);
    const first = chunks[0].timestamp;
    for (const c of chunks) c.timestamp -= first;
    const last = chunks.at(-1);
    const padding = Math.max(0, Math.round((last.timestamp + last.duration) * 1000 - preSkip * 1e9 / 48000 - buffer.length * 1e9 / 48000));
    if (padding) last.discardPadding = padding;
    return { chunks, description, preSkip, channels };
  } finally { if (encoder.state !== 'closed') encoder.close(); }
}