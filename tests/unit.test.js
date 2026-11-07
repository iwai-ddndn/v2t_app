import test from 'node:test';
import assert from 'node:assert/strict';
import { downsample, floatToInt16, RingBuffer, Chunker, encodeWav, rms } from '../js/audio.js';
import { cer, normalize } from '../js/cer.js';
import { fmtTime, toPlainText } from '../js/util.js';
import { cleanup, create as createOpenAI } from '../js/engines/openai.js';

const tone = (sec, amp = 0.3) => { const a = new Int16Array(16000 * sec); for (let i = 0; i < a.length; i++) a[i] = Math.sin(i / 5) * amp * 32767; return a; };
const silence = (sec) => new Int16Array(16000 * sec);
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
  feed(c, tone(4)); feed(c, silence(1));          // 4s音声 + 無音 → 区切り
  feed(c, tone(7));                               // 6秒で強制区切り
  feed(c, silence(5)); c.flush();                 // 無音のみ → 送らない
  assert.equal(chunks.length, 3);
  assert.ok(chunks[0].len >= 4 && chunks[0].len <= 5);
  assert.equal(chunks[1].s, chunks[0].len);
  assert.ok(Math.abs(chunks[1].len - 6) < 0.11);
  assert.ok(rms(silence(1)) === 0);
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

test('OpenAI engine emits segments in order even if responses arrive out of order', async () => {
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    const n = calls.length; calls.push(opts.body.get('prompt'));
    await new Promise((r) => setTimeout(r, n === 0 ? 80 : 5)); // 1件目だけ遅い
    return new Response(JSON.stringify({ text: `第${n + 1}区間` }), { status: 200 });
  };
  const segs = [];
  const eng = createOpenAI({ openaiKey: 'k', chunkMin: 2, chunkMax: 4 }, {
    offset: 10, now: () => 0, onSegment: (s) => segs.push(s), onInterim() {}, onStatus() {}, onError() {}, onUsage: (u) => (eng.usage = u),
  });
  await eng.start();
  const t = { push: (x) => eng.feed(x) };
  feed(t, tone(3)); feed(t, silence(1)); feed(t, tone(3)); feed(t, silence(1));
  await eng.stop();
  assert.deepEqual(segs.map((s) => s.text), ['第1区間', '第2区間']);
  assert.equal(segs[0].t, 10);
  assert.ok(eng.usage > 6 && eng.usage < 9);
});
