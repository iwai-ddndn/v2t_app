// OpenAI 音声認識 API(区切り送信型)。発話の切れ目で 8〜20 秒に区切って送る。
// ChatGPT Pro の「API クレジット特典」を使えば実質無料枠内で運用可能。
import { Chunker, encodeWav, normalizeGain, TARGET_RATE, type ChunkMeta } from '../audio';
import type { Engine, EngineCallbacks, EngineSettings } from './types';

export const MODELS: Record<string, { name: string; costPerMin: number; note: string }> = {
  'gpt-transcribe': { name: 'gpt-transcribe', costPerMin: 0.0045, note: '最新・推奨' },
  'gpt-4o-transcribe': { name: 'gpt-4o-transcribe', costPerMin: 0.006, note: '1世代前の高精度モデル' },
  'gpt-4o-mini-transcribe': { name: 'gpt-4o-mini-transcribe', costPerMin: 0.003, note: '最安・精度はやや低い' },
  'whisper-1': { name: 'whisper-1', costPerMin: 0.006, note: '旧モデル(2027年2月終了予定)' },
};
export const DEFAULT_MODEL = 'gpt-transcribe';

/** 用語リスト(改行・読点・カンマ区切り)を API に渡せる形に整える */
export function parseGlossary(text: string | undefined | null): string[] {
  return [...new Set(String(text || '').split(/[\n,、，]+/).map((s) => s.replace(/[<>\r\n]/g, '').trim()).filter(Boolean))]
    .map((s) => s.slice(0, 60)).slice(0, 100);
}

// gpt-transcribe の新しい項目(languages[] / keywords[])が受け付けられなかった場合に、旧形式へ自動で切り替える
let legacyFields = false;
export const _resetLegacy = () => { legacyFields = false; };

export interface TranscribeOptions { apiKey: string; model: string; lang?: string; prompt?: string; keywords?: string[]; baseUrl?: string; signal?: AbortSignal }
export async function transcribeWav(blob: Blob, { apiKey, model, lang = 'ja', prompt = '', keywords = [], baseUrl, signal }: TranscribeOptions): Promise<string> {
  const isNew = model.startsWith('gpt-transcribe') && !legacyFields;
  const fd = new FormData();
  fd.append('file', blob, 'chunk.wav');
  fd.append('model', model);
  fd.append('response_format', 'json');
  if (isNew) {
    fd.append('languages[]', lang);
    keywords.forEach((k) => fd.append('keywords[]', k));
    if (prompt) fd.append('prompt', prompt);
  } else {
    fd.append('language', lang);
    // 旧モデルは用語を「前の発言」の形でプロンプトに入れるのが効果的(Whisper のプロンプトは直前の書き起こしを想定している)
    const p = (keywords.length ? `${keywords.join('、')}。` : '') + prompt;
    if (p) fd.append('prompt', p.slice(-800));
  }
  const res = await fetch(`${baseUrl || 'https://api.openai.com/v1'}/audio/transcriptions`, {
    method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: fd, signal,
  });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 300);
    if (isNew && res.status === 400 && /language|keyword/i.test(body)) {
      legacyFields = true;
      return transcribeWav(blob, { apiKey, model, lang, prompt, keywords, baseUrl, signal });
    }
    const err = new Error(`OpenAI ${res.status}: ${body}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  const j = await res.json();
  return (j.text || '').trim();
}

export function create(settings: EngineSettings, cb: EngineCallbacks): Engine {
  const model = settings.openaiModel || DEFAULT_MODEL;
  const info = { id: 'openai' as const, name: `OpenAI · ${MODELS[model]?.name || model}`, costPerMin: MODELS[model]?.costPerMin ?? 0.006, needsMic: true };
  const keywords = parseGlossary(settings.glossary);
  const lang = (settings.lang || 'ja-JP').slice(0, 2);
  let pending = 0; let context = ''; let usageSec = 0;
  // 直前の書き起こしを次の区間のプロンプトに使うため、区間は 1 本ずつ順番に送る
  let queue: Promise<void> = Promise.resolve();

  const process = async (pcm: Int16Array, startSec: number, meta: ChunkMeta) => {
    const t = cb.offset + startSec;
    let text: string | null = null;
    for (let attempt = 0; attempt < 3 && text == null; attempt++) {
      try {
        const raw = await transcribeWav(encodeWav(settings.normalize === false ? pcm : normalizeGain(pcm)), {
          apiKey: settings.openaiKey, model, lang, prompt: context, keywords, baseUrl: settings.openaiBaseUrl,
        });
        text = cleanup(raw, meta);
      } catch (err) {
        const e = err as Error & { status?: number };
        if (e.status === 401) { cb.onStatus('APIキーが正しくありません(設定を確認してください)'); text = '[⚠ APIキーエラー]'; break; }
        if (attempt === 2) { cb.onStatus(`送信失敗: ${e.message}`); text = '[⚠ この区間は文字起こし失敗]'; }
        else await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
    pending--;
    if (text) { cb.onSegment({ t, text }); if (!text.startsWith('[⚠')) context = (context + text).slice(-200); }
    cb.onInterim(pending ? `…文字起こし中(${pending}件)` : '');
  };

  const chunker = new Chunker({
    minSec: Number(settings.chunkMin || 8), maxSec: Number(settings.chunkMax || 20),
    onChunk: (pcm, s, meta) => {
      pending++; usageSec += pcm.length / TARGET_RATE;
      cb.onInterim(`…文字起こし中(${pending}件)`);
      queue = queue.then(() => process(pcm, s, meta));
    },
  });

  return {
    info,
    async start() {
      if (!settings.openaiKey) throw new Error('OpenAI APIキーを設定してください');
      cb.onStatus(`録音中(${info.name}・発話の切れ目ごとに反映)`);
    },
    feed(int16) { chunker.push(int16); },
    async stop() {
      chunker.flush();
      await Promise.race([queue, new Promise((r) => setTimeout(r, 30000))]);
      cb.onUsage(usageSec);
    },
  };
}

/**
 * Whisper 系モデルは、無音や雑音から定型文をでっち上げることがある(ハルシネーション)。
 * 研究(Barański et al. 2025 の "Bag of Hallucinations")にならい、頻出フレーズの除去と、
 * 同じ語の無限ループの圧縮を行う。発話がほとんど無い区間の短い出力は捨てる。
 */
const BAG = [
  /ご視聴(いただき)?ありがとうございました。?/g, /最後までご(視聴|覧)いただき(ありがとうございました|ありがとうございます)。?/g,
  /チャンネル登録(よろしくお願いします|お願いします|をお願いします)。?/g, /高評価(よろしくお願いします|お願いします)。?/g,
  /次回(も)?お楽しみに。?/g, /(字幕|翻訳)(は|:|：).{0,20}(が担当しました|によるもの)。?/g,
];
export function cleanup(text: string, { speechRatio = 1 }: { speechRatio?: number } = {}): string {
  let t = text;
  for (const re of BAG) t = t.replace(re, '');
  // 同じフレーズが 4 回以上連続したら 1 回にまとめる(ループ型の誤出力)
  t = t.replace(/(.{1,20}?)\1{3,}/g, '$1');
  t = t.trim();
  if (/^[\s。、.,!?！？・…]*$/.test(t)) return '';
  // 発話がほとんど無い区間からの短い出力は誤出力の可能性が高い
  if (speechRatio < 0.1 && t.length <= 12) return '';
  if (/^(はい|ん|うん|えー|あー)[。、]?$/.test(t) && speechRatio < 0.3) return '';
  return t;
}
