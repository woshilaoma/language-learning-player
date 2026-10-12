/* 录音跟读：麦克风采集 → 16kHz 单声道 16bit PCM WAV → Blob + Base64 */
const Recorder = (function () {
  'use strict';

  const TARGET_RATE = 16000;

  let state = 'idle';
  let stream = null;
  let ctx = null;
  let source = null;
  let node = null;
  let chunks = [];
  let sampleRate = 0;
  let playEl = null;

  /* 线性插值降采样到 16kHz */
  function downsample(input, rate) {
    if (rate === TARGET_RATE || rate <= 0) return input;
    const ratio = rate / TARGET_RATE;
    const len = Math.floor(input.length / ratio);
    const out = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      const pos = i * ratio;
      const i0 = Math.floor(pos);
      const i1 = Math.min(i0 + 1, input.length - 1);
      const frac = pos - i0;
      out[i] = input[i0] * (1 - frac) + input[i1] * frac;
    }
    return out;
  }

  /* 手写 44 字节头的 16bit PCM WAV */
  function encodeWav(samples) {
    const n = samples.length;
    const buffer = new ArrayBuffer(44 + n * 2);
    const v = new DataView(buffer);
    const writeStr = function (off, s) {
      for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
    };
    writeStr(0, 'RIFF');
    v.setUint32(4, 36 + n * 2, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    v.setUint32(16, 16, true);            // fmt 块长度
    v.setUint16(20, 1, true);             // PCM
    v.setUint16(22, 1, true);             // 单声道
    v.setUint32(24, TARGET_RATE, true);   // 采样率
    v.setUint32(28, TARGET_RATE * 2, true);
    v.setUint16(32, 2, true);             // blockAlign
    v.setUint16(34, 16, true);            // 位深
    writeStr(36, 'data');
    v.setUint32(40, n * 2, true);
    let off = 44;
    for (let i = 0; i < n; i++, off += 2) {
      let s = samples[i];
      if (s > 1) s = 1;
      else if (s < -1) s = -1;
      v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return buffer;
  }

  /* 分块 btoa，每段 ≤8KB，防止 String.fromCharCode.apply 栈溢出 */
  function bytesToBase64(bytes) {
    let bin = '';
    const CHUNK = 0x2000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + CHUNK, bytes.length)));
    }
    return btoa(bin);
  }

  async function start() {
    if (state === 'recording') return;
    let media = null;
    try {
      media = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
    } catch (err) {
      throw new Error(I18N.t('err.mic'));
    }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
      source = ctx.createMediaStreamSource(media);
      node = ctx.createScriptProcessor(4096, 1, 1);
      chunks = [];
      node.onaudioprocess = function (e) {
        chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      };
      /* 经 0 增益节点接到 destination：保证 onaudioprocess 被调度，又不产生回声 */
      const mute = ctx.createGain();
      mute.gain.value = 0;
      source.connect(node);
      node.connect(mute);
      mute.connect(ctx.destination);
      stream = media;
      sampleRate = ctx.sampleRate;
      state = 'recording';
    } catch (err) {
      if (media) media.getTracks().forEach(function (t) { t.stop(); });
      if (ctx) { try { ctx.close(); } catch (e2) { /* 忽略 */ } }
      ctx = null; node = null; source = null; stream = null;
      state = 'idle';
      throw new Error(I18N.t('err.recInit', { msg: err && err.message ? err.message : I18N.t('err.unknown') }));
    }
  }

  async function stop() {
    if (state !== 'recording') return { ok: false, reason: 'too_short' };
    const rate = sampleRate;
    const data = chunks;
    /* 释放资源：停轨道、断节点、关 AudioContext */
    if (node) {
      node.onaudioprocess = null;
      try { node.disconnect(); } catch (e) { /* 忽略 */ }
    }
    if (source) { try { source.disconnect(); } catch (e) { /* 忽略 */ } }
    if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
    if (ctx) { try { ctx.close(); } catch (e) { /* 忽略 */ } }
    node = null; source = null; stream = null; ctx = null;
    state = 'idle';
    chunks = [];
    sampleRate = 0;

    let total = 0;
    for (let i = 0; i < data.length; i++) total += data[i].length;
    const duration = rate > 0 ? total / rate : 0;
    if (duration < 0.3) return { ok: false, reason: 'too_short' };

    const merged = new Float32Array(total);
    let off = 0;
    for (let i = 0; i < data.length; i++) {
      merged.set(data[i], off);
      off += data[i].length;
    }
    const wav = encodeWav(downsample(merged, rate));
    return {
      ok: true,
      wavBlob: new Blob([wav], { type: 'audio/wav' }),
      wavBase64: bytesToBase64(new Uint8Array(wav)),
      duration: duration
    };
  }

  function playBlob(blob) {
    if (playEl) { try { playEl.pause(); } catch (e) { /* 忽略 */ } }
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    playEl = audio; /* 保留引用，防止被回收中断播放 */
    audio.onended = function () { URL.revokeObjectURL(url); };
    const p = audio.play();
    if (p && p.catch) p.catch(function () { toast(I18N.t('toast.playRecFail')); });
  }

  return {
    get state() { return state; },
    start: start,
    stop: stop,
    playBlob: playBlob
  };
})();
