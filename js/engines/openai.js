// OpenAI 音声認識 API(区切り送信型)。無音位置で 8〜20 秒に区切って送る。
// ChatGPT Pro の「API クレジット特典」を使えば実質無料枠内で運用可能。
import { Chunker, encodeWav, TARGET_RATE } from '../audio.js';

export const MODELS = {
  'gpt-4o-mini-transcribe': { name: 'OpenAI gpt-4o-mini-transcribe', costPerMin: 0.003 },
  'gpt-4o-transcribe': { name: 'OpenAI gpt-4o-transcribe', costPerMin: 0.006 },
  'whisper-1': { name: 'OpenAI whisper-1', costPerMin: 0.006 },
};

export async function transcribeWav(blob, { apiKey, model, lang = 'ja', prompt = '', baseUrl, signal }) {
  const fd = new FormData();
  fd.append('file', blob, 'chunk.wav');
  fd.append('model', model);
  fd.append('language', lang);
  fd.append('response_format', 'json');
  if (prompt) fd.append('prompt', prompt);
  const res = await fetch(`${baseUrl || 'https://api.openai.com/v1'}/audio/transcriptions`, {
    method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: fd, signal,
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  return (j.text || '').trim();
}

export function create(settings, cb) {
  const model = settings.openaiModel || 'gpt-4o-mini-transcribe';
  const info = { id: 'openai', name: MODELS[model]?.name || model, costPerMin: MODELS[model]?.costPerMin ?? 0.006, needsMic: true };
  let seq = 0, nextToEmit = 0; const done = new Map(); let pending = 0; let context = '';
  let usageSec = 0;

  const emitInOrder = () => {
    while (done.has(nextToEmit)) {
      const r = done.get(nextToEmit); done.delete(nextToEmit); nextToEmit++;
      if (r && r.text) { cb.onSegment({ t: r.t, text: r.text }); context = (context + r.text).slice(-200); }
    }
    cb.onInterim(pending ? `…文字起こし中(${pending}件)` : '');
  };

  const send = async (pcm, startSec, attempt = 0) => {
    const id = attempt === 0 ? seq++ : pcm.__id;
    pcm.__id = id;
    if (attempt === 0) { pending++; usageSec += pcm.length / TARGET_RATE; }
    cb.onInterim(`…文字起こし中(${pending}件)`);
    try {
      const text = await transcribeWav(encodeWav(pcm), {
        apiKey: settings.openaiKey, model, lang: (settings.lang || 'ja-JP').slice(0, 2), prompt: context, baseUrl: settings.openaiBaseUrl,
      });
      done.set(id, { t: cb.offset + startSec, text: cleanup(text) });
    } catch (e) {
      if (attempt < 2) { setTimeout(() => send(pcm, startSec, attempt + 1), 1500 * (attempt + 1)); return; }
      cb.onStatus(`送信失敗: ${e.message}`);
      done.set(id, { t: cb.offset + startSec, text: '[⚠ この区間は文字起こし失敗]' });
    }
    pending--; emitInOrder();
  };

  const chunker = new Chunker({
    minSec: Number(settings.chunkMin || 8), maxSec: Number(settings.chunkMax || 20), onChunk: (pcm, s) => send(pcm, s),
  });

  return {
    info,
    async start() {
      if (!settings.openaiKey) throw new Error('OpenAI APIキーを設定してください');
      cb.onStatus(`録音中(${info.name}・約${settings.chunkMin || 8}〜${settings.chunkMax || 20}秒ごとに反映)`);
    },
    feed(int16) { chunker.push(int16); },
    flushNow() { chunker.flush(); },
    async stop() {
      chunker.flush();
      const t0 = Date.now();
      while (pending > 0 && Date.now() - t0 < 30000) await new Promise((r) => setTimeout(r, 200));
      cb.onUsage(usageSec);
    },
  };
}

// Whisper系が無音で出しがちな定型ハルシネーションを除去
const HALLUCINATIONS = [/ご視聴ありがとうございました。?/g, /チャンネル登録(よろしくお願いします|お願いします)。?/g, /^\s*(はい|ん)\s*。?\s*$/];
export function cleanup(text) {
  let t = text;
  for (const re of HALLUCINATIONS) t = t.replace(re, '');
  return t.trim();
}
