import { openInput, RingBuffer, playPcm, TARGET_RATE, Vad, canCapturePcAudio } from './audio.js';
import * as WebSpeech from './engines/webspeech.js';
import * as OpenAI from './engines/openai.js';
import * as Soniox from './engines/soniox.js';
import { summarize } from './summary.js';
import { fmtTime, toPlainText } from './util.js';

const $ = (s) => document.querySelector(s);
const DEFAULTS = {
  engine: 'webspeech', openaiKey: '', openaiModel: OpenAI.DEFAULT_MODEL, openaiBaseUrl: '',
  chunkMin: 8, chunkMax: 20, summaryModel: 'gpt-5-mini', sonioxKey: '', sonioxModel: 'stt-rt-v5',
  diarize: false, fontSize: 18, ringMinutes: 10, yenPerUsd: 150, lang: 'ja-JP',
  inputSource: 'mic', normalize: true, glossary: '', settingsVersion: 2,
};
const stored = JSON.parse(localStorage.getItem('v2t.settings') || '{}');
const settings = { ...DEFAULTS, ...stored };
// v1 → v2: 旧既定モデルを最新の gpt-transcribe に、入力は「加工なし」に移行(保存済みの設定がある人だけ)
if (Object.keys(stored).length && (stored.settingsVersion || 1) < 2) {
  if (settings.openaiModel === 'gpt-4o-mini-transcribe') settings.openaiModel = OpenAI.DEFAULT_MODEL;
  settings.inputSource = 'mic'; settings.normalize = true; settings.settingsVersion = 2;
  localStorage.setItem('v2t.settings', JSON.stringify(settings));
}
const saveSettings = () => localStorage.setItem('v2t.settings', JSON.stringify(settings));

const ENGINES = [
  { value: 'webspeech', label: '無料:iPhone内蔵', make: (cb) => WebSpeech.create(settings, cb) },
  { value: 'openai', label: 'OpenAI(高精度)', make: (cb) => OpenAI.create(settings, cb) },
  { value: 'soniox', label: 'Soniox(即時)', make: (cb) => Soniox.create(settings, cb) },
];

// ---- 状態 ----
let session = loadCurrent() || newSession();
let engine = null, mic = null, ring = null, running = false;
let startedAt = 0;          // performance.now() 基準の開始時刻
let baseElapsed = 0;        // 一時停止前までの経過秒
let wakeLock = null, tick = null, player = null;
let autoScroll = true;

function newSession() { return { id: Date.now(), created: new Date().toISOString(), segments: [], usage: {} }; }
function loadCurrent() { try { return JSON.parse(localStorage.getItem('v2t.current')); } catch { return null; } }
function persist() {
  localStorage.setItem('v2t.current', JSON.stringify(session));
}
const elapsed = () => baseElapsed + (running ? (performance.now() - startedAt) / 1000 : 0);

// ---- 描画 ----
function applyFont() { document.documentElement.style.setProperty('--fs', `${settings.fontSize}px`); }
function renderAll() {
  const list = $('#list');
  list.innerHTML = '';
  if (!session.segments.length) {
    list.innerHTML = '<p class="empty">「● 開始」で録音と文字起こしを始めます。<br>下の「◀ 1分前」などで直前の発言にすぐ戻れます。</p>';
  }
  session.segments.forEach((s) => list.appendChild(segEl(s)));
  scrollBottom();
  updateCost();
}
function segEl(s) {
  const d = document.createElement('div');
  d.className = 'seg'; d.dataset.t = s.t;
  const tm = document.createElement('time'); tm.textContent = fmtTime(s.t);
  d.appendChild(tm);
  if (s.speaker != null) { const sp = document.createElement('span'); sp.className = 'spk'; sp.textContent = `話者${s.speaker}`; d.appendChild(sp); }
  const tx = document.createElement('span'); tx.textContent = s.text; d.appendChild(tx);
  return d;
}
function addSegment(s) {
  // 時刻順に挿入(区切り送信型は応答順が前後し得るため)
  const segs = session.segments;
  let i = segs.length; while (i > 0 && segs[i - 1].t > s.t) i--;
  segs.splice(i, 0, s);
  const list = $('#list');
  list.querySelector('.empty')?.remove();
  const el = segEl(s);
  list.insertBefore(el, list.children[i] || null);
  persist();
  if (autoScroll) scrollBottom();
}
function scrollBottom() { const l = $('#list'); l.scrollTop = l.scrollHeight; }
function setStatus(t) { $('#status').textContent = t; }
function updateMeter(v) {
  const bar = $('#meterBar');
  if (!v) { bar.style.width = '0'; bar.classList.remove('speech'); return; }
  bar.style.width = `${Math.max(0, Math.min(100, ((v.levelDb + 70) / 60) * 100))}%`;
  bar.classList.toggle('speech', v.speech);
}
function updateCost() {
  let usd = 0;
  for (const v of Object.values(session.usage)) usd += (v.sec / 60) * v.rate + (v.usd || 0);
  // 録音中の分は概算で上乗せ(停止時に正確な送信秒数で確定)
  if (running && engine) usd += ((performance.now() - startedAt) / 60000) * engine.info.costPerMin;
  $('#cost').textContent = `¥${Math.round(usd * settings.yenPerUsd)}`;
  $('#cost').title = `推定API費用 $${usd.toFixed(4)}`;
}

// ---- 開始/停止 ----
async function start() {
  const def = ENGINES.find((e) => e.value === settings.engine);
  const cb = {
    now: elapsed,
    offset: elapsed(),
    onSegment: addSegment,
    onInterim: (t) => { $('#interim').textContent = t; if (autoScroll) scrollBottom(); },
    onStatus: setStatus,
    onError: (e) => { setStatus(`エラー: ${e.message}`); },
    onUsage: (sec) => {
      const key = engine.info.name;
      const u = session.usage[key] || (session.usage[key] = { sec: 0, rate: engine.info.costPerMin });
      u.sec += sec; persist(); updateCost();
    },
  };
  try {
    engine = def.make(cb);
    if (engine.info.needsMic) {
      ring = ring || new RingBuffer(settings.ringMinutes * 60);
      const meterVad = new Vad();
      let quietFrames = 0, warned = false;
      mic = await openInput((pcm) => {
        ring.push(pcm); engine.feed(pcm);
        const v = meterVad.push(pcm);
        updateMeter(v);
        // 5秒以上ほぼ無音なら、置き方・音量のヒントを出す
        quietFrames = v.levelDb < -55 ? quietFrames + 1 : 0;
        if (quietFrames === 50 && !warned) { warned = true; setStatus('⚠ 音がほとんど入っていません。スマホをスピーカーに近づけるか、PCの音量を上げてください'); }
      }, {
        source: settings.inputSource,
        onEnded: () => { if (running) setStatus('⚠ 音声の共有が終了しました。「停止」して再開してください'); },
      });
    } else if (settings.inputSource !== 'mic' && settings.inputSource !== 'mic-voice') {
      setStatus('※ 内蔵認識はマイク入力のみ対応です(PC音声は OpenAI / Soniox で使えます)');
    }
    await engine.start();
  } catch (e) {
    setStatus(`開始できません: ${e.message}`);
    if (mic) { await mic.close(); mic = null; }
    engine = null; return;
  }
  running = true; startedAt = performance.now();
  $('#btnStart').textContent = '■ 停止'; $('#btnStart').classList.add('recording');
  $('#engine').disabled = true;
  requestWake();
  tick = setInterval(() => { $('#clock').textContent = fmtTime(elapsed()); updateCost(); }, 1000);
}

async function stop() {
  if (!engine) return;
  setStatus('停止処理中…(残りの文字起こしを待っています)');
  $('#btnStart').disabled = true;
  baseElapsed = elapsed(); running = false;
  clearInterval(tick);
  if (mic) { await mic.close(); mic = null; }
  updateMeter(null);
  await engine.stop().catch(() => {});
  engine = null;
  $('#interim').textContent = '';
  $('#btnStart').disabled = false; $('#btnStart').textContent = '● 再開'; $('#btnStart').classList.remove('recording');
  $('#engine').disabled = false;
  setStatus('停止中(「再開」で続きから記録)');
  releaseWake(); persist(); updateCost();
}

async function requestWake() {
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { wakeLock = null; }
}
function releaseWake() { try { wakeLock?.release(); } catch {} wakeLock = null; }
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && running) {
    requestWake();
  } else if (document.visibilityState === 'hidden' && running) {
    // iPhone はバックグラウンドでブラウザのマイクが止まる
    setStatus('⚠ 画面を離れると録音が止まる場合があります。画面は点けたままにしてください');
  }
});

// ---- 巻き戻し ----
function rewind(sec) {
  const now = elapsed();
  const from = now - sec;
  const segs = [...document.querySelectorAll('.seg')];
  segs.forEach((el) => el.classList.remove('hl', 'target'));
  const inRange = segs.filter((el) => Number(el.dataset.t) >= from - 0.01);
  const target = inRange[0] || segs[segs.length - 1];
  if (!target) return;
  inRange.forEach((el) => el.classList.add('hl'));
  // 直前の1件も含めて表示(区切りの途中から始まっている可能性)
  const prev = target.previousElementSibling;
  (prev && prev.classList.contains('seg') ? prev : target).scrollIntoView({ block: 'start', behavior: 'smooth' });
  target.classList.add('target');
  autoScroll = false; $('#toLatest').hidden = false;
}

// ---- イベント ----
function init() {
  const sel = $('#engine');
  ENGINES.forEach((e) => sel.add(new Option(e.label, e.value)));
  sel.value = settings.engine;
  sel.onchange = () => { settings.engine = sel.value; saveSettings(); };
  applyFont(); renderAll();
  if (session.segments.length) { baseElapsed = session.segments[session.segments.length - 1].t + 1; $('#clock').textContent = fmtTime(baseElapsed); $('#btnStart').textContent = '● 再開'; }

  $('#btnStart').onclick = () => (running ? stop() : start());
  document.querySelectorAll('[data-back]').forEach((b) => (b.onclick = () => rewind(Number(b.dataset.back))));
  const list = $('#list');
  list.addEventListener('scroll', () => {
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    autoScroll = atBottom; $('#toLatest').hidden = atBottom;
  }, { passive: true });
  $('#toLatest').onclick = () => {
    autoScroll = true; $('#toLatest').hidden = true; scrollBottom();
    document.querySelectorAll('.seg').forEach((el) => el.classList.remove('hl', 'target'));
  };

  // 聞き直し
  $('#btnListen').onclick = () => {
    if (!ring || !ring.filled) { setStatus(settings.engine === 'webspeech' ? '聞き直しは OpenAI/Soniox 方式で録音中のみ使えます' : 'まだ音声がありません'); return; }
    $('#dlgListen').showModal();
  };
  document.querySelectorAll('[data-play]').forEach((b) => (b.onclick = () => {
    player?.pause(); player = playPcm(ring.last(Number(b.dataset.play)), TARGET_RATE);
  }));
  $('#btnStopPlay').onclick = () => player?.pause();

  // 要約
  $('#btnSummary').onclick = () => { $('#summaryOut').textContent = ''; $('#dlgSummary').showModal(); };
  $('#btnDoSummary').onclick = async () => {
    const range = Number($('#sumRange').value);
    const from = range ? elapsed() - range : -1;
    const text = toPlainText(session.segments.filter((s) => s.t >= from));
    if (!text.trim()) { $('#summaryOut').textContent = '対象範囲に文字起こしがありません'; return; }
    if (!settings.openaiKey) { $('#summaryOut').textContent = '要約には OpenAI APIキーが必要です(設定から)。'; return; }
    $('#summaryOut').textContent = '要約中…';
    try {
      const { text: out, usd } = await summarize(text, settings);
      $('#summaryOut').textContent = out;
      const u = session.usage['要約'] || (session.usage['要約'] = { sec: 0, rate: 0, usd: 0 });
      u.usd = (u.usd || 0) + usd;
      persist(); updateCost();
    } catch (e) { $('#summaryOut').textContent = `失敗: ${e.message}`; }
  };

  // 設定
  const form = $('#formSettings');
  $('#btnSettings').onclick = () => {
    for (const el of form.elements) {
      if (!el.name) continue;
      if (el.type === 'checkbox') el.checked = !!settings[el.name]; else el.value = settings[el.name] ?? '';
    }
    // スマホでは PC 音声の取り込みはできないので選べないようにする
    if (!canCapturePcAudio()) {
      form.elements.inputSource.querySelectorAll('option[value^="pc"]').forEach((o) => { o.disabled = true; });
      if (settings.inputSource.startsWith('pc')) form.elements.inputSource.value = 'mic';
    }
    renderHistory();
    $('#dlgSettings').showModal();
  };
  $('#dlgSettings').addEventListener('close', () => {
    for (const el of form.elements) {
      if (!el.name) continue;
      settings[el.name] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value || DEFAULTS[el.name]) : el.value.trim();
    }
    saveSettings(); applyFont();
  });
  $('#btnExport').onclick = () => download(`会議メモ_${session.created.slice(0, 16).replace(/[:T]/g, '-')}.txt`, toPlainText(session.segments, true));
  $('#btnCopy').onclick = async () => { await navigator.clipboard.writeText(toPlainText(session.segments, true)); setStatus('全文をコピーしました'); };
  $('#btnLogout').onclick = () => {
    if (!confirm('この端末のログイン状態を解除しますか?(記録と設定は端末に残ります)')) return;
    localStorage.removeItem('v2t.gateKey'); sessionStorage.removeItem('v2t.gateKey'); location.href = './';
  };
  $('#btnClear').onclick = () => {
    if (running) { alert('停止してから消去してください'); return; }
    if (!confirm('現在の記録を履歴に移して、新しい記録を始めますか?')) return;
    archive(); session = newSession(); baseElapsed = 0; ring = null; persist(); renderAll();
    $('#clock').textContent = '00:00'; $('#btnStart').textContent = '● 開始';
  };
}

function archive() {
  if (!session.segments.length) return;
  const hist = JSON.parse(localStorage.getItem('v2t.history') || '[]');
  hist.unshift({ id: session.id, created: session.created, text: toPlainText(session.segments, true) });
  localStorage.setItem('v2t.history', JSON.stringify(hist.slice(0, 30)));
}
function renderHistory() {
  const ul = $('#history'); ul.innerHTML = '';
  const hist = JSON.parse(localStorage.getItem('v2t.history') || '[]');
  hist.forEach((h) => {
    const li = document.createElement('li');
    li.textContent = new Date(h.created).toLocaleString('ja-JP');
    const b = document.createElement('button'); b.type = 'button'; b.textContent = '保存';
    b.onclick = () => download(`会議メモ_${h.id}.txt`, h.text);
    li.appendChild(b); ul.appendChild(li);
  });
}
function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

init();
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');
