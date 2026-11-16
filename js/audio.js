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

export const dbfs = (r) => 20 * Math.log10(Math.max(r, 1e-6));

/**
 * 適応型の発話検出(VAD)。
 * 固定のしきい値だと、スピーカー越しの小さな音声を「無音」と判定して捨ててしまう。
 * そこで周囲の雑音レベル(ノイズフロア)を推定し、「雑音より marginDb 以上大きいか」で判定する。
 *  - ノイズフロア = 直近 windowSec 秒の 100ms ごとの音量の最小値(Minimum Statistics 法の簡易版)。
 *    話し声には必ず音節の切れ目があるので、最小値は背景雑音の大きさに近くなる。
 *  - 判定が途切れても hangFrames だけ発話扱いを続ける(語尾の切れ防止)
 */
export class Vad {
  constructor({ marginDb = 8, absMinDb = -65, hangFrames = 3, windowSec = 5, frameSec = 0.1 } = {}) {
    Object.assign(this, { marginDb, absMinDb, hangFrames });
    this.win = []; this.winLen = Math.round(windowSec / frameSec); this.hang = 0; this.floorDb = -90;
  }
  push(int16) {
    const levelDb = dbfs(rms(int16));
    this.win.push(levelDb);
    if (this.win.length > this.winLen) this.win.shift();
    this.floorDb = Math.max(-90, Math.min(...this.win));
    const raw = levelDb > this.floorDb + this.marginDb && levelDb > this.absMinDb;
    if (raw) this.hang = this.hangFrames; else if (this.hang > 0) this.hang--;
    return { speech: raw || this.hang > 0, levelDb, floorDb: this.floorDb };
  }
}

/** 80Hz の 1 次ハイパスフィルタ(机の振動・空調などの低音を除去。線形処理なので認識を邪魔する歪みを生まない) */
export class HighPass {
  constructor(cutoff = 80, rate = TARGET_RATE) {
    const rc = 1 / (2 * Math.PI * cutoff); this.a = rc / (rc + 1 / rate); this.px = 0; this.py = 0;
  }
  process(f32) {
    const out = new Float32Array(f32.length); let { px, py } = this; const a = this.a;
    for (let i = 0; i < f32.length; i++) { const x = f32[i]; py = a * (py + x - px); px = x; out[i] = py; }
    this.px = px; this.py = py; return out;
  }
}

const toF32 = (int16) => { const f = new Float32Array(int16.length); for (let i = 0; i < int16.length; i++) f[i] = int16[i] / 32768; return f; };

/**
 * 区間単位の音量正規化(OpenAI に送る前に使う)。
 * 小さい声を約 -20dBFS まで持ち上げる(最大 +26dB)。ゲインは区間内で一定なので、
 * ノイズ抑制のような非線形の歪み(認識精度を下げる主因と報告されている)は生じない。
 */
export function normalizeGain(int16, { targetRms = 0.1, maxGain = 20, minGain = 0.5, ceiling = 0.95 } = {}) {
  if (!int16.length) return int16;
  const f = new HighPass().process(toF32(int16));
  // 100ms ごとのパワーの上位半分 = 話している部分のおおよその音量
  const fr = 1600, pw = [];
  for (let i = 0; i < f.length; i += fr) {
    let s = 0; const e = Math.min(f.length, i + fr);
    for (let j = i; j < e; j++) s += f[j] * f[j];
    pw.push(s / Math.max(1, e - i));
  }
  pw.sort((a, b) => b - a);
  const top = pw.slice(0, Math.max(1, Math.ceil(pw.length / 2)));
  const speechRms = Math.sqrt(top.reduce((a, b) => a + b, 0) / top.length);
  let gain = Math.min(maxGain, Math.max(minGain, targetRms / Math.max(speechRms, 1e-5)));
  // まれな大きなピークは許容しつつ(99.9パーセンタイル基準)、それ以外が割れないように上限をかける
  const abs = Float32Array.from(f, Math.abs).sort();
  const p999 = abs[Math.min(abs.length - 1, Math.floor(abs.length * 0.999))];
  if (p999 * gain > ceiling) gain = ceiling / Math.max(p999, 1e-5);
  const out = new Int16Array(f.length);
  for (let i = 0; i < f.length; i++) { const v = Math.max(-1, Math.min(1, f[i] * gain)); out[i] = v < 0 ? v * 0x8000 : v * 0x7fff; }
  return out;
}

/**
 * ストリーミング用の前処理(Soniox 用): ハイパス + ゆっくり動く自動音量調整。
 * 発話中のフレームの音量だけで目標ゲインを決め、1フレームあたり ±1dB までしか変えない。
 */
export class StreamingLeveler {
  constructor({ targetRms = 0.1, maxGain = 20 } = {}) {
    this.hp = new HighPass(); this.vad = new Vad(); this.targetRms = targetRms; this.maxGain = maxGain;
    this.speechPow = null; this.gain = 1;
  }
  process(int16) {
    const f = this.hp.process(toF32(int16));
    const v = this.vad.push(int16);
    if (v.speech) {
      let s = 0; for (let i = 0; i < f.length; i++) s += f[i] * f[i];
      const p = s / Math.max(1, f.length);
      this.speechPow = this.speechPow == null ? p : this.speechPow * 0.9 + p * 0.1;
    }
    const want = this.speechPow ? Math.min(this.maxGain, Math.max(0.5, this.targetRms / Math.sqrt(this.speechPow))) : 1;
    const step = 1.122; // 1dB
    this.gain = Math.min(this.gain * step, Math.max(this.gain / step, want));
    const out = new Int16Array(f.length);
    for (let i = 0; i < f.length; i++) {
      let x = f[i] * this.gain;
      if (x > 0.9 || x < -0.9) x = Math.sign(x) * (0.9 + 0.1 * Math.tanh((Math.abs(x) - 0.9) / 0.1)); // ソフトリミッタ
      out[i] = x < 0 ? x * 0x8000 : x * 0x7fff;
    }
    return out;
  }
}

/**
 * 発話の切れ目で区切るチャンカー(OpenAI など区間送信型エンジン用)。
 *  - minSec 以上たまり、適応 VAD で silenceSec 以上の無音が続いたら区切る
 *  - maxSec に達したら、直近 3 秒で一番静かな位置で区切る(単語の途中で切らないため)
 *  - 発話が minSpeechSec 未満の区間は送らない(無音での誤出力防止と課金節約)
 */
export class Chunker {
  constructor({ minSec = 8, maxSec = 20, silenceSec = 0.4, minSpeechSec = 0.3, rate = TARGET_RATE, vad, onChunk }) {
    Object.assign(this, { minSec, maxSec, silenceSec, minSpeechSec, rate, onChunk });
    this.vad = vad || new Vad();
    this.frames = []; this.samples = 0; this.silentSamples = 0; this.startSample = 0;
  }
  push(int16) {
    const v = this.vad.push(int16);
    this.frames.push({ pcm: int16, speech: v.speech, db: v.levelDb });
    this.samples += int16.length;
    if (v.speech) this.silentSamples = 0; else this.silentSamples += int16.length;
    const sec = this.samples / this.rate;
    if (sec >= this.minSec && this.silentSamples >= this.silenceSec * this.rate) this.flush();
    else if (sec >= this.maxSec) this.flush(this.quietestCut());
  }
  quietestCut() {
    const n = this.frames.length;
    let acc = 0, best = n - 1, bestDb = Infinity;
    for (let i = n - 1; i >= 1; i--) {
      acc += this.frames[i].pcm.length;
      if (acc > 3 * this.rate) break;
      if (this.frames[i].db < bestDb) { bestDb = this.frames[i].db; best = i; }
    }
    return best + 1; // 一番静かなフレームまでを含めて送る
  }
  flush(count = this.frames.length) {
    if (!this.frames.length) return;
    const take = this.frames.splice(0, count);
    const len = take.reduce((a, f) => a + f.pcm.length, 0);
    const speechSamples = take.reduce((a, f) => a + (f.speech ? f.pcm.length : 0), 0);
    const pcm = concatInt16(take.map((f) => f.pcm));
    const startSec = this.startSample / this.rate;
    this.startSample += len;
    this.samples -= len;
    this.silentSamples = 0;
    for (let i = this.frames.length - 1; i >= 0 && !this.frames[i].speech; i--) this.silentSamples += this.frames[i].pcm.length;
    if (speechSamples < this.minSpeechSec * this.rate) return;
    this.onChunk(pcm, startSec, { speechRatio: speechSamples / len });
  }
}

export const SOURCES = {
  mic: 'iPhone/PCのマイク(加工なし・スピーカー音声向け)',
  'mic-voice': 'マイク(ノイズ抑制あり・自分の声中心)',
  pc: 'このPCの音声を直接取り込む(PCのChrome/Edge)',
  'pc+mic': 'PCの音声 + マイク(自分の声も入れる)',
};

export const canCapturePcAudio = () => !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) && !/iPhone|iPad|Android/i.test(navigator.userAgent);

async function micStream(processing) {
  return navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: processing, noiseSuppression: processing, autoGainControl: processing, channelCount: 1 },
  });
}

async function pcStream() {
  if (!canCapturePcAudio()) throw new Error('この端末ではPC音声を取り込めません。PCのChrome/Edgeでこのページを開いてください');
  const s = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    systemAudio: 'include', selfBrowserSurface: 'exclude', surfaceSwitching: 'include',
  });
  if (!s.getAudioTracks().length) {
    s.getTracks().forEach((t) => t.stop());
    throw new Error('音声が共有されていません。共有の画面で会議のタブ(またはシステム音声)を選び、「音声を共有」をオンにしてください');
  }
  s.getVideoTracks().forEach((t) => { t.enabled = false; }); // 映像は使わない
  return s;
}

/**
 * 音声入力を開いて 16kHz Int16 フレーム(約100ms)を onFrame に流す。
 * source: 'mic' | 'mic-voice' | 'pc' | 'pc+mic'
 */
export async function openInput(onFrame, { source = 'mic', onEnded } = {}) {
  const streams = [];
  try {
    if (source === 'pc' || source === 'pc+mic') streams.push(await pcStream());
    if (source !== 'pc') streams.push(await micStream(source === 'mic-voice'));
  } catch (e) {
    streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    throw e;
  }
  for (const s of streams) for (const t of s.getAudioTracks()) t.addEventListener('ended', () => onEnded && onEnded(t));
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  if (ctx.state === 'suspended') await ctx.resume();
  const srcs = streams.map((s) => ctx.createMediaStreamSource(new MediaStream(s.getAudioTracks())));
  const inRate = ctx.sampleRate;
  let node;
  const handle = (f32) => onFrame(floatToInt16(downsample(f32, inRate)));
  if (ctx.audioWorklet) {
    // バンドル/暗号化配信でも動くよう、ワークレットはコード文字列から Blob URL で読み込む
    const workletUrl = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'text/javascript' }));
    await ctx.audioWorklet.addModule(workletUrl);
    node = new AudioWorkletNode(ctx, 'pcm-tap', { channelCount: 1, channelCountMode: 'explicit' });
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
  srcs.forEach((s) => s.connect(node)); // 複数入力は自動で足し合わされる
  // Safari では destination に繋がないと処理が止まることがあるため無音で接続
  const mute = ctx.createGain(); mute.gain.value = 0; node.connect(mute).connect(ctx.destination);
  return {
    ctx,
    async close() {
      try { srcs.forEach((s) => s.disconnect()); node.disconnect(); } catch {}
      streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
      await ctx.close().catch(() => {});
    },
  };
}

/** 互換用 */
export const openMic = (onFrame) => openInput(onFrame, { source: 'mic' });

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
  // 聞き直しも音量をそろえて聞きやすくする
  const url = URL.createObjectURL(encodeWav(normalizeGain(int16), rate));
  const a = new Audio(url);
  a.onended = () => URL.revokeObjectURL(url);
  a.play();
  return a;
}
