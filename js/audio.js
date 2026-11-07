// マイク取得 → 16kHz mono Int16 へ変換 → 購読者へ配信 / リングバッファ保持 / WAV化
export const TARGET_RATE = 16000;

const WORKLET_SRC = `class PcmTap extends AudioWorkletProcessor {
  process(inputs) { const ch = inputs[0] && inputs[0][0]; if (ch && ch.length) this.port.postMessage(ch.slice(0)); return true; }
}
registerProcessor('pcm-tap', PcmTap);`;

export function downsample(float32, inRate, outRate = TARGET_RATE) {
  if (inRate === outRate) return float32;
  const ratio = inRate / outRate;
  const outLen = Math.floor(float32.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(float32.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += float32[j];
    out[i] = sum / Math.max(1, end - start);
  }
  return out;
}

export function floatToInt16(f32) {
  const out = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

export function rms(int16) {
  if (!int16.length) return 0;
  let s = 0;
  for (let i = 0; i < int16.length; i++) { const v = int16[i] / 32768; s += v * v; }
  return Math.sqrt(s / int16.length);
}

export function concatInt16(chunks) {
  const len = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Int16Array(len);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

export function encodeWav(int16, sampleRate = TARGET_RATE) {
  const buf = new ArrayBuffer(44 + int16.length * 2);
  const v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + int16.length * 2, true); w(8, 'WAVE');
  w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, int16.length * 2, true);
  new Int16Array(buf, 44).set(int16);
  return new Blob([buf], { type: 'audio/wav' });
}

/** 直近 N 秒の PCM を保持するリングバッファ(聞き直し用) */
export class RingBuffer {
  constructor(seconds, rate = TARGET_RATE) {
    this.cap = seconds * rate; this.rate = rate;
    this.buf = new Int16Array(this.cap); this.pos = 0; this.filled = 0;
  }
  push(int16) {
    let src = int16;
    if (src.length > this.cap) src = src.subarray(src.length - this.cap);
    const first = Math.min(src.length, this.cap - this.pos);
    this.buf.set(src.subarray(0, first), this.pos);
    if (first < src.length) this.buf.set(src.subarray(first), 0);
    this.pos = (this.pos + src.length) % this.cap;
    this.filled = Math.min(this.cap, this.filled + src.length);
  }
  last(seconds) {
    const n = Math.min(this.filled, Math.floor(seconds * this.rate));
    const out = new Int16Array(n);
    const start = (this.pos - n + this.cap) % this.cap;
    const first = Math.min(n, this.cap - start);
    out.set(this.buf.subarray(start, start + first), 0);
    if (first < n) out.set(this.buf.subarray(0, n - first), first);
    return out;
  }
}

/**
 * 無音位置で区切るチャンカー(API 一括送信型エンジン用)
 * minSec 以上たまったら直近の無音で区切り、maxSec で強制的に区切る。
 */
export class Chunker {
  constructor({ minSec = 8, maxSec = 20, silenceSec = 0.5, silenceRms = 0.012, rate = TARGET_RATE, onChunk }) {
    Object.assign(this, { minSec, maxSec, silenceSec, silenceRms, rate, onChunk });
    this.parts = []; this.samples = 0; this.silentSamples = 0; this.startSample = 0; this.totalSamples = 0;
  }
  push(int16) {
    this.parts.push(int16); this.samples += int16.length; this.totalSamples += int16.length;
    if (rms(int16) < this.silenceRms) this.silentSamples += int16.length; else this.silentSamples = 0;
    const sec = this.samples / this.rate;
    if ((sec >= this.minSec && this.silentSamples >= this.silenceSec * this.rate) || sec >= this.maxSec) this.flush();
  }
  flush() {
    if (!this.samples) return;
    const pcm = concatInt16(this.parts);
    const startSec = this.startSample / this.rate;
    this.startSample += this.samples;
    this.parts = []; this.samples = 0; this.silentSamples = 0;
    // ほぼ全部無音のチャンクは送らない(課金節約)
    if (rms(pcm) < this.silenceRms * 0.6) return;
    this.onChunk(pcm, startSec);
  }
}

/** マイクを開いて 16kHz Int16 フレームを onFrame に流す */
export async function openMic(onFrame) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
  });
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  if (ctx.state === 'suspended') await ctx.resume();
  const src = ctx.createMediaStreamSource(stream);
  const inRate = ctx.sampleRate;
  let node;
  const handle = (f32) => onFrame(floatToInt16(downsample(f32, inRate)));
  if (ctx.audioWorklet) {
    // バンドル/暗号化配信でも動くよう、ワークレットはコード文字列から Blob URL で読み込む
    const workletUrl = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'text/javascript' }));
    await ctx.audioWorklet.addModule(workletUrl);
    node = new AudioWorkletNode(ctx, 'pcm-tap');
    // 128サンプル単位で来るので 100ms 程度にまとめる
    let acc = []; let accLen = 0; const want = Math.floor(inRate * 0.1);
    node.port.onmessage = (e) => {
      acc.push(e.data); accLen += e.data.length;
      if (accLen >= want) {
        const f = new Float32Array(accLen); let o = 0;
        for (const a of acc) { f.set(a, o); o += a.length; }
        acc = []; accLen = 0; handle(f);
      }
    };
  } else {
    node = ctx.createScriptProcessor(4096, 1, 1);
    node.onaudioprocess = (e) => handle(e.inputBuffer.getChannelData(0));
  }
  src.connect(node);
  // Safari では destination に繋がないと処理が止まることがあるため無音で接続
  const mute = ctx.createGain(); mute.gain.value = 0; node.connect(mute).connect(ctx.destination);
  return {
    ctx,
    async close() {
      try { src.disconnect(); node.disconnect(); } catch {}
      stream.getTracks().forEach((t) => t.stop());
      await ctx.close().catch(() => {});
    },
  };
}

/** 音声ファイルを 16kHz Int16 にデコード(比較検証ページ用) */
export async function decodeFileTo16k(file) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  const ab = await file.arrayBuffer();
  const audio = await new Promise((res, rej) => ctx.decodeAudioData(ab, res, rej));
  const ch0 = audio.getChannelData(0);
  let mono = ch0;
  if (audio.numberOfChannels > 1) {
    const ch1 = audio.getChannelData(1); mono = new Float32Array(ch0.length);
    for (let i = 0; i < ch0.length; i++) mono[i] = (ch0[i] + ch1[i]) / 2;
  }
  const out = floatToInt16(downsample(mono, audio.sampleRate));
  ctx.close().catch(() => {});
  return out;
}

export function playPcm(int16, rate = TARGET_RATE) {
  const url = URL.createObjectURL(encodeWav(int16, rate));
  const a = new Audio(url);
  a.onended = () => URL.revokeObjectURL(url);
  a.play();
  return a;
}
