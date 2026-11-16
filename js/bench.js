import { decodeFileTo16k, Chunker, encodeWav, normalizeGain, TARGET_RATE } from './audio.js';
import { transcribeWav, MODELS, cleanup, parseGlossary } from './engines/openai.js';
import * as Soniox from './engines/soniox.js';
import { cer } from './cer.js';

const $ = (s) => document.querySelector(s);
const settings = JSON.parse(localStorage.getItem('v2t.settings') || '{}');
let pcm = null;
let results = JSON.parse(localStorage.getItem('v2t.bench') || '[]');
const log = (t) => ($('#log').textContent = t);
const yen = settings.yenPerUsd || 150;

$('#file').onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  log('デコード中…');
  try {
    pcm = await decodeFileTo16k(f);
    $('#fileInfo').textContent = `${f.name}: ${(pcm.length / TARGET_RATE / 60).toFixed(1)} 分`;
    log('');
  } catch (err) { log(`読み込めません: ${err.message}`); }
};

$('#addManual').onclick = () => {
  const name = $('#manualName').value.trim() || '手入力';
  results.push({ name, text: $('#manualText').value, sec: null, usd: 0 });
  $('#manualText').value = ''; render();
};
$('#ref').oninput = render;
$('#clearRes').onclick = () => { results = []; render(); };
$('#exportJson').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify({ ref: $('#ref').value, results }, null, 2)], { type: 'application/json' }));
  a.download = 'bench.json'; a.click();
};

// ライブと同じ区切り方でチャンク化し、OpenAI に送る(並列3本)
async function runOpenAI(model, { raw = false } = {}) {
  const chunks = [];
  const ch = new Chunker({ minSec: Number(settings.chunkMin || 8), maxSec: Number(settings.chunkMax || 20), onChunk: (p, s, m) => chunks.push({ p, s, m }) });
  for (let i = 0; i < pcm.length; i += 1600) ch.push(pcm.subarray(i, i + 1600));
  ch.flush();
  const out = new Array(chunks.length); const lat = [];
  let next = 0, context = '';
  // 前チャンク末尾をプロンプトに使うため順次実行(ライブ時と同条件)
  for (const c of chunks) {
    const t0 = performance.now();
    const text = await transcribeWav(encodeWav(raw ? c.p : normalizeGain(c.p)), {
      apiKey: settings.openaiKey, model, lang: (settings.lang || 'ja-JP').slice(0, 2), prompt: context,
      keywords: raw ? [] : parseGlossary(settings.glossary), baseUrl: settings.openaiBaseUrl,
    });
    lat.push((performance.now() - t0) / 1000);
    const cleaned = raw ? text : cleanup(text, c.m);
    out[next++] = cleaned; context = (context + cleaned).slice(-200);
    log(`${model}: ${next}/${chunks.length}`);
  }
  const sentSec = chunks.reduce((a, c) => a + c.p.length, 0) / TARGET_RATE;
  return { text: out.join('\n'), usd: (sentSec / 60) * MODELS[model].costPerMin, latency: avg(lat), chunks: chunks.length };
}

async function runSoniox({ raw = false } = {}) {
  let text = '';
  const eng = Soniox.create(raw ? { ...settings, normalize: false, glossary: '' } : settings, {
    offset: 0, now: () => 0,
    onSegment: (s) => { text += `${s.speaker != null ? `話者${s.speaker}: ` : ''}${s.text}\n`; },
    onInterim: () => {}, onStatus: (m) => log(m), onError: (e) => log(e.message), onUsage: () => {},
  });
  await eng.start();
  const step = 1600; // 100ms
  for (let i = 0; i < pcm.length; i += step) {
    eng.feed(pcm.slice(i, i + step));
    if ((i / step) % 10 === 0) { log(`Soniox: ${Math.round((i / pcm.length) * 100)}%`); await sleep(250); } // 約4倍速で送信
  }
  await eng.stop();
  return { text, usd: (pcm.length / TARGET_RATE / 60) * eng.info.costPerMin };
}

$('#run').onclick = async () => {
  if (!pcm) { log('音声ファイルを選んでください'); return; }
  const picks = [...document.querySelectorAll('#engines input:checked')].map((i) => i.value);
  for (const p of picks) {
    const t0 = performance.now();
    try {
      let r;
      const raw = p.endsWith(':raw');
      const suffix = raw ? '(前処理なし)' : '(前処理あり)';
      if (p.startsWith('openai:')) {
        if (!settings.openaiKey) throw new Error('OpenAI APIキー未設定');
        const model = p.split(':')[1];
        r = await runOpenAI(model, { raw }); r.name = MODELS[model].name + suffix;
      } else {
        if (!settings.sonioxKey) throw new Error('Soniox APIキー未設定');
        r = await runSoniox({ raw }); r.name = `Soniox ${settings.sonioxModel || 'stt-rt-v5'}${suffix}`;
      }
      r.sec = (performance.now() - t0) / 1000;
      results.push(r); render();
    } catch (e) { results.push({ name: p, text: `エラー: ${e.message}`, sec: null, usd: 0, error: true }); render(); }
  }
  log('完了');
};

function render() {
  localStorage.setItem('v2t.bench', JSON.stringify(results));
  const ref = $('#ref').value;
  const tb = $('#tbody'); tb.innerHTML = '';
  const texts = $('#texts'); texts.innerHTML = '';
  results.forEach((r, i) => {
    const c = ref.trim() && !r.error ? cer(ref, r.text) : NaN;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${esc(r.name)}</td><td>${isNaN(c) ? '-' : (c * 100).toFixed(1) + '%'}</td>` +
      `<td>${r.sec ? r.sec.toFixed(1) + '秒' + (r.latency ? `<br><small>1区切り平均 ${r.latency.toFixed(1)}秒</small>` : '') : '-'}</td>` +
      `<td>${r.usd != null ? '$' + r.usd.toFixed(4) + `<br><small>1時間換算 ¥${pcm && r.usd ? Math.round(r.usd / (pcm.length / TARGET_RATE / 3600) * yen) : 0}</small>` : '-'}</td>` +
      `<td>${r.text.length}</td>`;
    tb.appendChild(tr);
    const d = document.createElement('details');
    d.innerHTML = `<summary>${esc(r.name)} の全文</summary><pre style="white-space:pre-wrap">${esc(r.text)}</pre>`;
    texts.appendChild(d);
  });
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const avg = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
render();
