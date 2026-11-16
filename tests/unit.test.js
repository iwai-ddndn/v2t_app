import test from 'node:test';
import assert from 'node:assert/strict';
import { downsample, floatToInt16, RingBuffer, Chunker, encodeWav, rms, Vad, normalizeGain, StreamingLeveler, dbfs } from '../js/audio.js';
import { cer, normalize } from '../js/cer.js';
import { fmtTime, toPlainText } from '../js/util.js';
import { cleanup, create as createOpenAI, transcribeWav, parseGlossary, _resetLegacy } from '../js/engines/openai.js';

const tone = (sec, amp = 0.3) => { const a = new Int16Array(16000 * sec); for (let i = 0; i < a.length; i++) a[i] = Math.sin(i / 5) * amp * 32767; return a; };
const silence = (sec) => new Int16Array(16000 * sec);
// 決定的な疑似乱数(テストを毎回同じにするため)
let seed = 1; const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
const noise = (sec, amp) => Int16Array.from({ length: 16000 * sec }, () => rand() * amp * 32767);
/** スピーカー越しに小さく入った「話し声もどき」: 0.2秒鳴って0.1秒休む音節 + 小さな雑音 */
const farSpeech = (sec, amp = 0.006, noiseAmp = 0.0005) => {
  const a = noise(sec, noiseAmp);
  for (let i = 0; i < a.length; i++) if ((i % 4800) < 3200) a[i] += Math.sin(i / 4) * amp * 32767 * (0.6 + 0.4 * Math.sin(i / 900));
  return a;
};
// 大きめの話し声もどき(音節の切れ目あり)
const speech = (sec, amp = 0.3) => farSpeech(sec, amp, 0.0005);
const feed = (target, pcm) => { for (let i = 0; i < pcm.length; i += 1600) target.push(pcm.subarray(i, i + 1600)); };

test('downsample 48k->16k length', () => {
  assert.equal(downsample(new Float32Array(48000), 48000).length, 16000);
  assert.equal(floatToInt16(new Float32Array([1, -1, 0]))[1], -32768);
});

test('ring buffer keeps last N seconds in order', () => {
  const rb = new RingBuffer(1, 10);
  rb.push(Int16Array.from([1, 2, 3, 4, 5, 6, 7]));
  rb.push(Int16Array.from([8, 9, 10, 11, 12]));
  assert.deepEqual([...rb.last(1)], [3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.deepEqual([...rb.last(0.3)], [10, 11, 12]);
});

test('chunker cuts at silence after minSec, forces at maxSec, skips silent chunks', () => {
  const chunks = [];
  const c = new Chunker({ minSec: 3, maxSec: 6, onChunk: (p, s) => chunks.push({ len: p.length / 16000, s }) });
  feed(c, speech(4)); feed(c, silence(1));        // 4s音声 + 無音 → 区切り
  feed(c, speech(7));                             // 6秒で強制区切り
  feed(c, silence(5)); c.flush();                 // 残りの音声1秒は送る / 無音のみは送らない
  assert.equal(chunks.length, 3);
  assert.ok(chunks[0].len >= 4 && chunks[0].len <= 5);
  assert.equal(chunks[1].s, chunks[0].len);
  assert.ok(chunks[1].len <= 6.01 && chunks[1].len >= 3);
  assert.ok(rms(silence(1)) === 0);
});

test('【改善点】スピーカー越しの小さな音声(約-48dBFS)も発話として検出して送る', () => {
  const quiet = farSpeech(10);
  assert.ok(rms(quiet) < 0.012 * 0.6, `旧実装の固定しきい値では捨てられていた音量 (rms=${rms(quiet).toFixed(4)})`);
  const chunks = [];
  const c = new Chunker({ minSec: 3, maxSec: 20, onChunk: (p, s, m) => chunks.push({ len: p.length / 16000, m }) });
  feed(c, noise(2, 0.0005)); feed(c, quiet); feed(c, noise(2, 0.0005)); c.flush();
  assert.ok(chunks.length >= 1, '小さな音声が送られること');
  const sent = chunks.reduce((a, x) => a + x.len, 0);
  assert.ok(sent >= 10, `発話10秒分が送られる (${sent.toFixed(1)}秒)`);
  assert.ok(chunks.every((x) => x.m.speechRatio > 0.3));
});

test('適応VAD: 雑音だけの区間は送らない(雑音の大きい部屋でも)', () => {
  const chunks = [];
  const c = new Chunker({ minSec: 3, maxSec: 8, onChunk: (p) => chunks.push(p) });
  feed(c, noise(20, 0.02)); c.flush();            // -37dBFS 程度の定常雑音のみ
  assert.equal(chunks.length, 0);
  const v = new Vad();
  let r; for (let i = 0; i < 50; i++) r = v.push(noise(0.1, 0.02));
  assert.ok(Math.abs(r.floorDb - dbfs(0.02 / Math.sqrt(3))) < 3, `ノイズフロアが雑音レベルに追従 (${r.floorDb.toFixed(1)}dB)`);
});

test('強制区切りは直近3秒で一番静かな位置で切る(単語の途中で切らない)', () => {
  const chunks = [];
  const c = new Chunker({ minSec: 3, maxSec: 6, silenceSec: 2, onChunk: (p) => chunks.push(p.length / 16000) });
  const a = speech(8, 0.3);
  for (let i = Math.round(4.5 * 16000); i < Math.round(4.6 * 16000); i++) a[i] = 0; // 4.5秒地点に完全な息継ぎ
  feed(c, a);
  assert.ok(Math.abs(chunks[0] - 4.6) < 0.01, `息継ぎの位置で区切る (${chunks[0]}秒)`);
});

test('音量正規化: 小さい声を約-20dBFSまで持ち上げ、大きい音は割らない', () => {
  const quiet = farSpeech(5);
  const out = normalizeGain(quiet);
  assert.ok(rms(out) > rms(quiet) * 8, `持ち上がる ${rms(quiet).toFixed(4)} → ${rms(out).toFixed(4)}`);
  const loud = tone(2, 0.99);
  const o2 = normalizeGain(loud);
  const peak = o2.reduce((m, v) => Math.max(m, Math.abs(v)), 0) / 32768;
  assert.ok(peak <= 0.96, `ピークが上限以下 (${peak.toFixed(3)})`);
});

test('ストリーミング用の自動音量調整: 数秒で目標音量に近づき、急に変えない', () => {
  const lv = new StreamingLeveler();
  const src = farSpeech(8);
  const outs = [];
  for (let i = 0; i < src.length; i += 1600) outs.push(lv.process(src.subarray(i, i + 1600)));
  const firstGainRatio = rms(outs[0]) / Math.max(rms(src.subarray(0, 1600)), 1e-9);
  assert.ok(firstGainRatio < 1.3, '最初から急に大きくしない');
  const tail = outs.slice(-20);
  const tailRms = Math.sqrt(tail.reduce((a, o) => a + rms(o) ** 2, 0) / tail.length);
  assert.ok(tailRms > rms(src) * 5, `最後は十分持ち上がっている (${tailRms.toFixed(4)})`);
});

test('wav header', async () => {
  const b = encodeWav(tone(1));
  const buf = new Uint8Array(await b.arrayBuffer());
  assert.equal(new TextDecoder().decode(buf.slice(0, 4)), 'RIFF');
  assert.equal(buf.length, 44 + 32000);
});

test('CER', () => {
  assert.equal(cer('今日は晴れです。', '今日は晴れです'), 0);
  assert.ok(Math.abs(cer('あいうえお', 'あいうけお') - 0.2) < 1e-9);
  assert.equal(normalize('ＡＢＣ　です。'), 'abcです');
});

test('format helpers & hallucination cleanup', () => {
  assert.equal(fmtTime(75), '01:15'); assert.equal(fmtTime(3725), '1:02:05');
  assert.equal(toPlainText([{ t: 5, text: 'a', speaker: 1 }], true), '[00:05] 話者1: a');
  assert.equal(cleanup('ご視聴ありがとうございました'), '');
});

test('ハルシネーション除去: 定型句・ループ・ほぼ無音区間の短い出力', () => {
  assert.equal(cleanup('では始めます。ご視聴ありがとうございました。'), 'では始めます。');
  assert.equal(cleanup('チャンネル登録よろしくお願いします'), '');
  assert.equal(cleanup('そうですねそうですねそうですねそうですねそうですね'), 'そうですね');
  assert.equal(cleanup('はいはい'), 'はいはい');                    // 2回の繰り返しは正当な発話として残す
  assert.equal(cleanup('ありがとう', { speechRatio: 0.05 }), '');  // 発話がほぼ無い区間の短文は捨てる
  assert.equal(cleanup('来週までに資料をまとめます', { speechRatio: 0.05 }), '来週までに資料をまとめます');
  assert.equal(cleanup('はい。', { speechRatio: 0.2 }), '');
});

test('用語リストの整形', () => {
  assert.deepEqual(parseGlossary('岩井、DDN\nv2t, KPI,,岩井 <tag>'), ['岩井', 'DDN', 'v2t', 'KPI', '岩井 tag']);
});

test('gpt-transcribe には languages[] / keywords[] を送り、拒否されたら旧形式で再送する', async () => {
  _resetLegacy();
  const bodies = [];
  globalThis.fetch = async (url, opts) => {
    const b = opts.body; bodies.push({ langs: b.getAll('languages[]'), kws: b.getAll('keywords[]'), lang: b.get('language'), prompt: b.get('prompt') });
    if (bodies.length === 1) return new Response('{"error":{"message":"Unknown parameter: languages[]"}}', { status: 400 });
    return new Response(JSON.stringify({ text: 'ok' }), { status: 200 });
  };
  const blob = encodeWav(tone(1));
  assert.equal(await transcribeWav(blob, { apiKey: 'k', model: 'gpt-transcribe', lang: 'ja', prompt: '前の発言', keywords: ['岩井', 'KPI'] }), 'ok');
  assert.deepEqual(bodies[0], { langs: ['ja'], kws: ['岩井', 'KPI'], lang: null, prompt: '前の発言' });
  assert.deepEqual(bodies[1], { langs: [], kws: [], lang: 'ja', prompt: '岩井、KPI。前の発言' });
  // 一度旧形式に切り替わったら以後は旧形式
  await transcribeWav(blob, { apiKey: 'k', model: 'gpt-transcribe', lang: 'ja' });
  assert.equal(bodies[2].lang, 'ja');
  _resetLegacy();
});

test('OpenAI: 区間を順番に送り、直前の書き起こしを次のプロンプトに使う', async () => {
  _resetLegacy();
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    const n = calls.length; calls.push({ prompt: opts.body.get('prompt'), kws: opts.body.getAll('keywords[]') });
    await new Promise((r) => setTimeout(r, 20));
    return new Response(JSON.stringify({ text: `第${n + 1}区間` }), { status: 200 });
  };
  const segs = [];
  const eng = createOpenAI({ openaiKey: 'k', chunkMin: 2, chunkMax: 4, glossary: '岩井、KPI' }, {
    offset: 10, now: () => 0, onSegment: (s) => segs.push(s), onInterim() {}, onStatus() {}, onError() {}, onUsage: (u) => (eng.usage = u),
  });
  await eng.start();
  const t = { push: (x) => eng.feed(x) };
  feed(t, speech(3)); feed(t, silence(1)); feed(t, speech(3)); feed(t, silence(1));
  await eng.stop();
  assert.deepEqual(segs.map((s) => s.text), ['第1区間', '第2区間']);
  assert.equal(segs[0].t, 10);
  assert.equal(calls[0].prompt, null);
  assert.equal(calls[1].prompt, '第1区間');
  assert.deepEqual(calls[0].kws, ['岩井', 'KPI']);
  assert.ok(eng.usage > 6 && eng.usage < 9);
});
