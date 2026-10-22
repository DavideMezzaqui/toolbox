/*
 * video-io: everything the Toolbox tools share for reading and writing video.
 * Extracted from Clip Joiner (app/clips/index.html), which proved it on real
 * showcase clips. Plain ES module, no dependencies besides ./mp4-muxer.mjs
 * (loaded the first time an Encoder is made).
 *
 *   Reading     loadVideo(file) -> VideoSource with frameAt(t): an exact frame
 *               as a drawable. MP4/MOV with H.264 go through the hardware
 *               decoder front to back (FrameReader); anything else (WebM, MKV,
 *               fragmented MP4, other codecs) falls back to seeking a <video>.
 *   Low level   mp4Index / readIndex, FrameReader, loadVideoElement, seekTo,
 *               seekExact.
 *   Writing     pickVideoCodec / pickAudioCodec (codec ladder), evenSize,
 *               Encoder (VideoEncoder + muxer, optional AAC/Opus track).
 *   Audio       decodeAudioFile, mixTracks.
 */

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ================================================================ MP4 reading
 *
 * Export reads each clip once, front to back, through the hardware decoder.
 * Seeking a <video> to every frame instead is only fast when keyframes are
 * close together: Davide's showcase clips have one every 250 frames, so each
 * seek re-decoded up to 250 frames - 18 s to export 3 s of Javelin.
 *
 * This is a plain MP4/MOV reader for H.264 with its index in the moov box
 * (not fragmented files). Anything it cannot read falls back to seeking.
 */
function* boxes(d, s, e) {
  let o = s;
  while (o + 8 <= e) {
    let size = d.getUint32(o), h = 8;
    const type = String.fromCharCode(d.getUint8(o + 4), d.getUint8(o + 5), d.getUint8(o + 6), d.getUint8(o + 7));
    if (size === 1) { size = Number(d.getBigUint64(o + 8)); h = 16; } else if (size === 0) size = e - o;
    if (size < h || o + size > e) return;
    yield { type, s: o + h, e: o + size };
    o += size;
  }
}
const child = (d, b, type) => { for (const x of boxes(d, b.s, b.e)) if (x.type === type) return x; return null; };
const path_ = (d, b, ...types) => { for (const t of types) { b = b && child(d, b, t); } return b; };

const indexCache = new WeakMap();
/* The index of a file, or null when this reader cannot handle it. Cached per File. */
export function mp4Index(file) {
  if (!indexCache.has(file)) indexCache.set(file, readIndex(file).catch(() => null));
  return indexCache.get(file);
}
export async function readIndex(file) {
  /* the moov box can be at the start or at the end: walk the top level */
  let off = 0, moov = null;
  while (off + 8 <= file.size) {
    const h = new DataView(await file.slice(off, off + 16).arrayBuffer());
    let size = h.getUint32(0), hdr = 8;
    const type = String.fromCharCode(h.getUint8(4), h.getUint8(5), h.getUint8(6), h.getUint8(7));
    if (size === 1) { size = Number(h.getBigUint64(8)); hdr = 16; } else if (size === 0) size = file.size - off;
    if (size < hdr) return null;
    if (type === 'moov') { moov = new DataView(await file.slice(off, off + size).arrayBuffer()); moov.hdr = hdr; break; }
    if (type === 'moof') return null;                     /* fragmented: not handled */
    off += size;
  }
  if (!moov) return null;
  const d = moov, root = { s: moov.hdr, e: d.byteLength };
  for (const trak of boxes(d, root.s, root.e)) {
    if (trak.type !== 'trak') continue;
    const mdia = child(d, trak, 'mdia'), hdlr = mdia && child(d, mdia, 'hdlr');
    if (!hdlr || String.fromCharCode(d.getUint8(hdlr.s + 8), d.getUint8(hdlr.s + 9), d.getUint8(hdlr.s + 10), d.getUint8(hdlr.s + 11)) !== 'vide') continue;
    const mdhd = child(d, mdia, 'mdhd');
    const ts = d.getUint8(mdhd.s) ? d.getUint32(mdhd.s + 20) : d.getUint32(mdhd.s + 12);
    const stbl = path_(d, mdia, 'minf', 'stbl');
    const stsd = child(d, stbl, 'stsd');
    /* first sample entry: 8 byte header, then 78 bytes of VisualSampleEntry */
    const entry = { s: stsd.s + 8 + 8, e: stsd.s + 8 + d.getUint32(stsd.s + 8) };
    const fourcc = String.fromCharCode(d.getUint8(stsd.s + 12), d.getUint8(stsd.s + 13), d.getUint8(stsd.s + 14), d.getUint8(stsd.s + 15));
    if (fourcc !== 'avc1' && fourcc !== 'avc3') return null;
    const width = d.getUint16(entry.s + 24), height = d.getUint16(entry.s + 26);
    const avcC = child(d, { s: entry.s + 78, e: entry.e }, 'avcC');
    if (!avcC) return null;
    const hex = n => n.toString(16).padStart(2, '0');
    const codec = fourcc + '.' + hex(d.getUint8(avcC.s + 1)) + hex(d.getUint8(avcC.s + 2)) + hex(d.getUint8(avcC.s + 3));
    const description = new Uint8Array(d.buffer, d.byteOffset + avcC.s, avcC.e - avcC.s).slice();

    /* sample table */
    const stsz = child(d, stbl, 'stsz'), n = d.getUint32(stsz.s + 8), fixed = d.getUint32(stsz.s + 4);
    /* a fragmented file keeps its samples in moof boxes after the moov: empty table here */
    if (!n) return null;
    const size = new Uint32Array(n);
    for (let i = 0; i < n; i++) size[i] = fixed || d.getUint32(stsz.s + 12 + i * 4);
    const stco = child(d, stbl, 'stco'), co64 = child(d, stbl, 'co64');
    const nChunks = d.getUint32((stco || co64).s + 4);
    const chunkOff = i => stco ? d.getUint32(stco.s + 8 + i * 4) : Number(d.getBigUint64(co64.s + 8 + i * 8));
    const stsc = child(d, stbl, 'stsc'), nStsc = d.getUint32(stsc.s + 4);
    const offset = new Float64Array(n);
    let si = 0;
    for (let k = 0; k < nStsc; k++) {
      const first = d.getUint32(stsc.s + 8 + k * 12) - 1, per = d.getUint32(stsc.s + 12 + k * 12);
      const last = k + 1 < nStsc ? d.getUint32(stsc.s + 8 + (k + 1) * 12) - 1 : nChunks;
      for (let ch = first; ch < last && si < n; ch++) {
        let o = chunkOff(ch);
        for (let j = 0; j < per && si < n; j++) { offset[si] = o; o += size[si]; si++; }
      }
    }
    const stts = child(d, stbl, 'stts'), dts = new Float64Array(n);
    let t = 0; si = 0;
    for (let k = 0, m = d.getUint32(stts.s + 4); k < m; k++) {
      const cnt = d.getUint32(stts.s + 8 + k * 8), dl = d.getUint32(stts.s + 12 + k * 8);
      for (let j = 0; j < cnt && si < n; j++) { dts[si++] = t; t += dl; }
    }
    const pts = Float64Array.from(dts);
    const ctts = child(d, stbl, 'ctts');
    if (ctts) {
      si = 0;
      for (let k = 0, m = d.getUint32(ctts.s + 4); k < m; k++) {
        const cnt = d.getUint32(ctts.s + 8 + k * 8), off2 = d.getInt32(ctts.s + 12 + k * 8);
        for (let j = 0; j < cnt && si < n; j++) pts[si++] += off2;
      }
    }
    /* the edit list shifts the timeline the way <video> shows it: with
       B-frames the encoder starts presentation a couple of frames in */
    let shift = 0;
    const elst = path_(d, trak, 'edts', 'elst');
    if (elst) {
      const v = d.getUint8(elst.s), m = d.getUint32(elst.s + 4);
      for (let k = 0; k < m; k++) {
        const o = elst.s + 8 + k * (v ? 20 : 12);
        const mt = v ? Number(d.getBigInt64(o + 8)) : d.getInt32(o + 4);
        if (mt >= 0) { shift = mt; break; }
      }
    }
    const key = new Uint8Array(n);
    const stss = child(d, stbl, 'stss');
    if (stss) for (let k = 0, m = d.getUint32(stss.s + 4); k < m; k++) key[d.getUint32(stss.s + 8 + k * 4) - 1] = 1;
    else key.fill(1);
    const sec = new Float64Array(n);
    for (let i = 0; i < n; i++) sec[i] = (pts[i] - shift) / ts;
    const cfg = { codec, codedWidth: width, codedHeight: height, description, optimizeForLatency: false };
    let ok = false;
    for (const hw of ['prefer-hardware', 'no-preference']) {
      try { if ((await VideoDecoder.isConfigSupported(Object.assign({ hardwareAcceleration: hw }, cfg))).supported) { cfg.hardwareAcceleration = hw; ok = true; break; } } catch (e) {}
    }
    if (!ok) return null;
    return { cfg, n, size, offset, key, sec, frameDur: n > 1 ? (dts[n - 1] - dts[0]) / (n - 1) / ts : 1 / 30 };
  }
  return null;
}

/* The last keyframe that is on screen at or before t (a sample number). */
function keyAtOrBefore(x, t) {
  let k = 0;
  for (let i = 0; i < x.n; i++) if (x.key[i] && x.sec[i] <= t + 1e-6) k = i;
  return k;
}

/* Hands out the frame on screen at a given time, for times that only move
   forward. Frames come out of the decoder in display order; everything
   older than the requested time is closed straight away.
   opts.cancelled: optional function; when it returns true the wait ends with
   Error('cancelled') (Clip Joiner passes its Cancel button). */
export class FrameReader {
  constructor(file, idx, opts) {
    this.file = file; this.x = idx; this.q = []; this.cur = null; this.err = null;
    this.block = null; this.blockAt = 0; this.flushed = false; this.wake = null;
    this.cancelled = (opts && opts.cancelled) || null;
  }
  open(t) {
    const x = this.x;
    /* start from the last keyframe that is on screen at or before t */
    this.next = keyAtOrBefore(x, t);
    this.dec = new VideoDecoder({
      output: f => { this.q.push(f); if (this.wake) { this.wake(); this.wake = null; } },
      error: e => { this.err = e; if (this.wake) { this.wake(); this.wake = null; } }
    });
    this.dec.configure(x.cfg);
  }
  async bytes(off, len) {
    const B = 8 << 20;
    if (!this.block || off < this.blockAt || off + len > this.blockAt + this.block.byteLength) {
      this.blockAt = off;
      this.block = new Uint8Array(await this.file.slice(off, Math.min(this.file.size, off + Math.max(B, len))).arrayBuffer());
    }
    return this.block.subarray(off - this.blockAt, off - this.blockAt + len);
  }
  async feed(count) {
    const x = this.x;
    for (let j = 0; j < count && this.next < x.n; j++) {
      const i = this.next++;
      const data = await this.bytes(x.offset[i], x.size[i]);
      this.dec.decode(new EncodedVideoChunk({ type: x.key[i] ? 'key' : 'delta',
        timestamp: Math.round(x.sec[i] * 1e6), duration: Math.round(x.frameDur * 1e6), data }));
    }
  }
  /* The hardware decoder only has a handful of frames to hand out. Never
     wait on it while holding frames it could need back: awaiting flush()
     here, with frames piling up unread, stopped the export dead at the end
     of Thinner Columns. So flush is fired and forgotten, and the loop keeps
     reading (and closing) what comes out. */
  async frameAt(t) {
    const tu = t * 1e6 + 500;
    let idle = performance.now();
    for (;;) {
      if (this.err) throw this.err;
      if (this.cancelled && this.cancelled()) throw new Error('cancelled');
      const before = this.q.length;
      /* keep only the newest frame that is already due */
      while (this.q.length && this.q[0].timestamp <= tu) { if (this.cur) this.cur.close(); this.cur = this.q.shift(); }
      if (this.q.length || this.flushed) return this.cur || this.q[0] || null;
      if (this.next >= this.x.n) {
        if (!this.flushing) { this.flushing = true; this.dec.flush().then(() => { this.flushed = true; if (this.wake) this.wake(); }, e => { this.err = e; }); }
      } else if (this.dec.decodeQueueSize < 8) await this.feed(4);
      await new Promise(r => { this.wake = r; setTimeout(r, 10); });
      if (this.q.length !== before) idle = performance.now();
      else if (performance.now() - idle > 15000) throw new Error('the video decoder stopped responding');
    }
  }
  close() {
    for (const f of this.q) f.close(); this.q = [];
    if (this.cur) this.cur.close(); this.cur = null;
    try { if (this.dec && this.dec.state !== 'closed') this.dec.close(); } catch (e) {}
  }
}

/* ================================================================ <video> loading and seeking */

let defaultPool = null;
/* A container that is off screen but still rendered: a display:none video may
   never present a frame, which seekExact waits for. */
function getPool() {
  if (!defaultPool || !defaultPool.isConnected) {
    defaultPool = document.createElement('div');
    defaultPool.style.cssText = 'position:fixed;left:-9999px;top:0;width:2px;height:2px;overflow:hidden;pointer-events:none';
    document.body.appendChild(defaultPool);
  }
  return defaultPool;
}

/* Remembers the media time of the last frame a <video> presented, so a seek
   can tell a fresh frame from the stale one. Installed once per element. */
function trackPresented(v) {
  if (v.__vio || typeof v.requestVideoFrameCallback !== 'function') return;
  const st = v.__vio = { mt: -1, n: 0, on: new Set() };
  const cb = (now, meta) => {
    st.mt = meta.mediaTime; st.n++;
    for (const f of [...st.on]) f(meta);
    if (v.isConnected !== false) v.requestVideoFrameCallback(cb);
  };
  v.requestVideoFrameCallback(cb);
}

/* Creates a <video> for a URL and waits for its metadata. Screen recorders
   often write WebM without a duration: asking for a time far past the end
   makes Chromium scan to the real one (the 1e101 trick). The element is
   parked in `pool` (default: an off-screen container). */
export function loadVideoElement(url, pool) {
  return new Promise((res, rej) => {
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto'; v.crossOrigin = 'anonymous';
    v.onloadedmetadata = async () => {
      /* Screen recorders often write WebM without a duration. Asking for a
         time far past the end makes the browser scan to the real one. */
      if (!isFinite(v.duration)) {
        await new Promise(r => {
          const g = setTimeout(r, 8000);
          v.ondurationchange = () => { if (isFinite(v.duration)) { clearTimeout(g); r(); } };
          v.currentTime = 1e101;
        });
        v.ondurationchange = null;
        await seekTo(v, 0);
      }
      res(v);
    };
    v.onerror = () => rej(new Error('cannot read this file'));
    v.src = url;
    (pool || getPool()).appendChild(v);
  });
}

/* Seeks and resolves on 'seeked' (or after 4 s). Fast, and enough when the
   next thing drawn is shown anyway; frameAt() uses seekExact instead. */
export function seekTo(v, t) {
  return new Promise(res => {
    if (v.readyState >= 2 && Math.abs(v.currentTime - t) < 0.0005 && !v.seeking) { res(); return; }
    let done = false;
    const fin = () => { if (done) return; done = true; clearTimeout(g); v.removeEventListener('seeked', fin); res(); };
    const g = setTimeout(fin, 4000);
    v.addEventListener('seeked', fin);
    v.currentTime = t;
  });
}

/* Seeks and resolves only once the frame for t is really on screen. 'seeked'
   can fire before the new picture is presented, and drawing then gives the
   previous frame (the stale frame of the old Frame Strip). So after 'seeked'
   this also waits for the next presented frame (requestVideoFrameCallback,
   registered before the seek so it cannot be missed). Without that API, or if
   no frame is presented within 300 ms of 'seeked' (the target is the frame
   already shown, or the page is hidden), it settles on 'seeked' alone. */
export async function seekExact(v, t, timeout = 4000) {
  if (v.readyState < 2) {
    await new Promise(r => { const g = setTimeout(r, 3000); v.addEventListener('loadeddata', () => { clearTimeout(g); r(); }, { once: true }); });
  }
  trackPresented(v);
  const st = v.__vio;
  if (!v.seeking && Math.abs(v.currentTime - t) < 0.0005) return;
  return new Promise(res => {
    let done = false, seeked = false, shown = !st, wait = 0;
    const prev = st ? st.mt : -1;
    const fin = () => {
      if (done) return; done = true; clearTimeout(g); clearTimeout(wait);
      v.removeEventListener('seeked', onSeeked); if (st) st.on.delete(onFrame); res();
    };
    const g = setTimeout(fin, timeout);
    const check = () => { if (seeked && shown) fin(); };
    const onFrame = meta => { if (meta.mediaTime !== prev) { shown = true; check(); } };
    const onSeeked = () => { seeked = true; if (!shown) wait = setTimeout(fin, 300); check(); };
    if (st) st.on.add(onFrame);
    v.addEventListener('seeked', onSeeked);
    v.currentTime = t;
  });
}

/* ================================================================ loadVideo and frameAt */

/* The decoder picks the frame whose presentation time is the requested one
   (within half a millisecond); the seek path asks for the same moment. */
const SEEK_BIAS = 0.0005;

/* One video file, ready to hand out exact frames.
 *   file, url, video      the File, its object URL and a <video> for it
 *   duration, width, height
 *   mode                  'decoder' (hardware, front to back) or 'seek'
 *   frameDur, frameCount  from the MP4 index (null on the seek path)
 *   frameAt(t)            drawable for the frame on screen at t seconds:
 *                         a VideoFrame (decoder) or a canvas (seek). Both go
 *                         straight into drawImage / new VideoFrame(). Owned by
 *                         the source: valid until the next frameAt() or
 *                         dispose(), so draw or copy it before asking again.
 *   dispose()             closes decoder and frames, removes the <video>
 * Times that move forward are cheap on the decoder path (one pass, no
 * seeking); a jump back or far ahead restarts from the nearest keyframe.
 * Which frame: the decoder returns the newest frame whose time is <= t (+0.5
 * ms), the same rule the Clip Joiner export has always used. A <video> seek
 * shows the frame NEAREST to t instead (Chromium switches at the half-frame),
 * so the seek path can be one frame ahead when t falls in the second half of
 * a frame; times on a frame boundary or in its first half agree on both. */
class VideoSource {
  constructor(file, url, video, index, mode) {
    this.file = file; this.url = url; this.video = video; this.index = index;
    this.mode = mode;
    this.duration = video.duration; this.width = video.videoWidth; this.height = video.videoHeight;
    this.frameDur = index ? index.frameDur : null;
    this.frameCount = index ? index.n : null;
    this.reader = null; this.lastT = 0; this.canvas = null; this.chain = Promise.resolve();
  }
  frameAt(t) {
    const run = this.chain.then(() => this._frameAt(t));
    this.chain = run.catch(() => {});
    return run;
  }
  async _frameAt(t) {
    t = clamp(+t || 0, 0, Math.max(0, this.duration - 0.001));
    if (this.mode === 'decoder') {
      try { return await this._decoded(t); }
      catch (e) {
        if (e && e.message === 'cancelled') throw e;
        /* the decoder failed on this file: carry on by seeking */
        this._closeReader(); this.mode = 'seek';
      }
    }
    return this._sought(t);
  }
  async _decoded(t) {
    const x = this.index; let r = this.reader;
    const tu = t * 1e6 + 500;
    let reopen = !r;
    if (r && t < this.lastT) {
      /* back in time: the frame in hand still serves if it is the one due */
      reopen = !(r.cur && r.cur.timestamp <= tu);
    } else if (r && keyAtOrBefore(x, t) > r.next) {
      reopen = true;           /* a keyframe lies ahead of the reader: start there */
    }
    if (reopen) {
      this._closeReader();
      r = this.reader = new FrameReader(this.file, x);
      r.open(t);
    }
    const f = await r.frameAt(t);
    this.lastT = t;
    if (!f) throw new Error('no frame');
    return f;
  }
  async _sought(t) {
    const v = this.video;
    await seekExact(v, Math.min(t + SEEK_BIAS, Math.max(0, this.duration - 0.0005)));
    if (!this.canvas) this.canvas = document.createElement('canvas');
    const c = this.canvas;
    if (c.width !== v.videoWidth || c.height !== v.videoHeight) { c.width = v.videoWidth; c.height = v.videoHeight; }
    c.getContext('2d').drawImage(v, 0, 0);
    return c;
  }
  _closeReader() { if (this.reader) { this.reader.close(); this.reader = null; } }
  dispose() {
    this._closeReader();
    try { this.video.removeAttribute('src'); this.video.load(); this.video.remove(); } catch (e) {}
    try { URL.revokeObjectURL(this.url); } catch (e) {}
  }
}

/* Opens a video File. Rejects when the browser cannot read it or finds no
   duration. opts.mode 'seek' forces the seek path; opts.pool is the element
   the <video> is parked in. */
export async function loadVideo(file, opts) {
  opts = opts || {};
  const url = URL.createObjectURL(file);
  let video;
  try { video = await loadVideoElement(url, opts.pool); }
  catch (e) { URL.revokeObjectURL(url); throw e; }
  if (!isFinite(video.duration) || video.duration <= 0) {
    video.remove(); URL.revokeObjectURL(url);
    throw new Error('no duration');
  }
  trackPresented(video);
  const index = opts.mode === 'seek' ? null : await mp4Index(file);
  return new VideoSource(file, url, video, index, index ? 'decoder' : 'seek');
}

/* ================================================================ codecs and sizes */

/* H.264/VP9 wants even sizes: round down to the nearest even number. */
export const evenSize = n => Math.max(2, Math.floor(n) & ~1);

/* The codec ladder: the first H.264 level this machine can encode at W x H,
   hardware first, then software, then VP9. Returns { codec, hw, mux } or
   null. only: 'avc' or 'vp9' limits the ladder. */
export function codecLadder(W, H, only) {
  const big = W * H > 2048 * 1088;
  const tries = (big ? ['avc1.640034', 'avc1.640033', 'avc1.4d0034'] : ['avc1.640028', 'avc1.4d0028', 'avc1.640032', 'avc1.42001f'])
    .flatMap(c => [[c, 'prefer-hardware', 'avc'], [c, 'prefer-software', 'avc']])
    .concat([['vp09.00.41.08', 'prefer-software', 'vp9'], ['vp09.00.51.08', 'prefer-software', 'vp9']]);
  return only ? tries.filter(t => t[2] === only) : tries;
}
export async function pickVideoCodec(W, H, { bitrate = 16e6, fps = 30, only } = {}) {
  if (typeof VideoEncoder === 'undefined') return null;
  for (const [codec, hw, mux] of codecLadder(W, H, only)) {
    try {
      const r = await VideoEncoder.isConfigSupported({ codec, width: W, height: H, bitrate, framerate: fps, hardwareAcceleration: hw });
      if (r.supported) return { codec, hw, mux };
    } catch (e) {}
  }
  return null;
}
/* AAC, else Opus; null when this build has no audio encoder. */
export async function pickAudioCodec(sampleRate = 48000, bitrate = 192000) {
  if (typeof AudioEncoder === 'undefined') return null;
  for (const [codec, mux] of [['mp4a.40.2', 'aac'], ['opus', 'opus']]) {
    try {
      const r = await AudioEncoder.isConfigSupported({ codec, sampleRate, numberOfChannels: 2, bitrate });
      if (r.supported) return { codec, mux };
    } catch (e) {}
  }
  return null;
}

/* ================================================================ Encoder */

/* VideoEncoder + mp4-muxer in one object, with an optional audio track.
 *   const enc = await Encoder.create({ width, height, fps, bitrate, audio });
 *   await enc.addFrame(canvas);                 // once per frame, in order
 *   await enc.flushVideo();
 *   if (enc.hasAudio) await enc.addAudio(audioBuffer, seconds);
 *   const { blob, buffer, frames } = enc.finalize();
 *   enc.close();                                // always, in a finally
 * width/height are rounded down to even numbers (enc.width, enc.height).
 * create() throws 'no encoder for WxH on this machine' when the ladder finds
 * nothing. audio: true asks for an AAC (else Opus) track; enc.hasAudio tells
 * whether this machine could provide one. Options: vc (a codec already
 * picked), only ('avc'|'vp9'), keyEvery (frames between keyframes, default
 * 2 s), fastStart (default 'in-memory'). */
export class Encoder {
  static async create(o) {
    const width = evenSize(o.width), height = evenSize(o.height), fps = o.fps || 30;
    const bitrate = Math.round(o.bitrate || 16e6);
    const mod = await import('./mp4-muxer.mjs');
    const vc = o.vc || await pickVideoCodec(width, height, { bitrate, fps, only: o.only });
    if (!vc) throw new Error('no encoder for ' + width + '×' + height + ' on this machine');
    const ac = o.audio ? await pickAudioCodec() : null;
    return new Encoder(mod, vc, ac, { width, height, fps, bitrate, keyEvery: o.keyEvery || fps * 2, fastStart: o.fastStart || 'in-memory' });
  }
  constructor(mod, vc, ac, o) {
    Object.assign(this, { width: o.width, height: o.height, fps: o.fps, bitrate: o.bitrate, keyEvery: o.keyEvery });
    this.vc = vc; this.ac = ac; this.frames = 0; this.error = null; this.aenc = null;
    this.us = 1e6 / o.fps;
    this.target = new mod.ArrayBufferTarget();
    this.muxer = new mod.Muxer({
      target: this.target, fastStart: o.fastStart, firstTimestampBehavior: 'offset',
      video: { codec: vc.mux, width: o.width, height: o.height, frameRate: o.fps },
      audio: ac ? { codec: ac.mux, numberOfChannels: 2, sampleRate: 48000 } : undefined
    });
    this.venc = new VideoEncoder({ output: (ch, meta) => this.muxer.addVideoChunk(ch, meta), error: e => this.error = e });
    this.venc.configure({ codec: vc.codec, width: o.width, height: o.height, bitrate: o.bitrate, framerate: o.fps,
                          hardwareAcceleration: vc.hw, latencyMode: 'quality', bitrateMode: 'variable' });
  }
  get hasAudio() { return !!this.ac; }
  get codec() { return this.vc.codec; }
  /* throws the encoder's error, if it has failed */
  check() { if (this.error) throw this.error; }
  /* queues one frame (canvas, ImageBitmap, VideoFrame...) at the next slot */
  encode(src, opts) {
    const n = this.frames;
    const f = new VideoFrame(src, { timestamp: Math.round(n * this.us), duration: Math.round(this.us) });
    this.venc.encode(f, { keyFrame: opts && opts.keyFrame != null ? opts.keyFrame : n % this.keyEvery === 0 });
    f.close(); this.frames++;
    return n;
  }
  /* waits while the encoder has more than 8 frames queued */
  async drain() {
    while (this.venc.encodeQueueSize > 8) await new Promise(r => setTimeout(r, 4));
  }
  async addFrame(src, opts) { this.check(); const n = this.encode(src, opts); await this.drain(); return n; }
  async flushVideo() { await this.venc.flush(); }
  /* Encodes a stereo AudioBuffer at 48 kHz, at most `seconds` of it. Call
     after flushVideo(). */
  async addAudio(buffer, seconds) {
    if (!this.ac) return;
    const aenc = this.aenc = new AudioEncoder({ output: (ch, meta) => this.muxer.addAudioChunk(ch, meta), error: e => this.error = e });
    aenc.configure({ codec: this.ac.codec, sampleRate: 48000, numberOfChannels: 2, bitrate: 192000 });
    const L = buffer.getChannelData(0), R = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : L;
    const frames = Math.min(buffer.length, Math.round(seconds * 48000));
    for (let off = 0; off < frames; off += 1024) {
      const k = Math.min(1024, frames - off), data = new Float32Array(k * 2);
      data.set(L.subarray(off, off + k), 0); data.set(R.subarray(off, off + k), k);
      const ad = new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: k, numberOfChannels: 2,
                                 timestamp: Math.round(off / 48000 * 1e6), data });
      aenc.encode(ad); ad.close();
    }
    await aenc.flush();
  }
  finalize() {
    this.check();
    this.muxer.finalize();
    const buffer = this.target.buffer;
    return { buffer, blob: new Blob([buffer], { type: 'video/mp4' }), frames: this.frames };
  }
  close() {
    try { if (this.venc && this.venc.state !== 'closed') this.venc.close(); } catch (e) {}
    try { if (this.aenc && this.aenc.state !== 'closed') this.aenc.close(); } catch (e) {}
  }
}

/* ================================================================ audio */

/* Decodes the sound of a video/audio File to an AudioBuffer at 48 kHz, or
   null when it has none. ctx: an OfflineAudioContext to reuse. */
export async function decodeAudioFile(file, ctx) {
  ctx = ctx || new OfflineAudioContext(2, 48000, 48000);
  try { return await ctx.decodeAudioData(await file.arrayBuffer()); } catch (e) { return null; }
}

/* Mixes tracks into one stereo AudioBuffer of `seconds` length. A track is
   { buffer, start, offset, duration, speed, points }: it plays `duration`
   seconds of `buffer` from `offset`, at playbackRate `speed`, starting at
   `start` on the output; points is a list of [time, gain] on the output
   timeline (first one set, the rest linear ramps). */
export async function mixTracks(tracks, seconds, rate = 48000) {
  const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil(seconds * rate)), rate);
  for (const tr of tracks) {
    if (!tr.buffer) continue;
    const src = ctx.createBufferSource(); src.buffer = tr.buffer; src.playbackRate.value = tr.speed || 1;
    const gn = ctx.createGain(); src.connect(gn); gn.connect(ctx.destination);
    const pts = tr.points && tr.points.length ? tr.points : [[tr.start, 1]];
    gn.gain.setValueAtTime(pts[0][1], pts[0][0]);
    for (const [t, val] of pts.slice(1)) gn.gain.linearRampToValueAtTime(val, t);
    src.start(tr.start, tr.offset, tr.duration);
  }
  return await ctx.startRendering();
}
