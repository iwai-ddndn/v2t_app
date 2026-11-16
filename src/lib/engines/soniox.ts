// Soniox リアルタイム音声認識(WebSocket ストリーミング)。日本語に強く単価が最安クラス。
// 1〜2 秒程度の遅延で逐次表示。ブラウザから直接 WebSocket で接続できる(CORS不要)。
import { TARGET_RATE, StreamingLeveler } from '../audio';
import { parseGlossary } from './openai';
import type { Engine, EngineCallbacks, EngineSettings } from './types';

export const URL_DEFAULT = 'wss://stt-rt.soniox.com/transcribe-websocket';

export function create(settings: EngineSettings, cb: EngineCallbacks): Engine {
  const info = { id: 'soniox' as const, name: `Soniox · ${settings.sonioxModel || 'stt-rt-v5'}`, costPerMin: 0.12 / 60, needsMic: true };
  let ws: WebSocket | null = null, open = false, queue: ArrayBuffer[] = [], usageSec = 0;
  let finalBuf = ''; let segStartMs: number | null = null; let lastSpeaker: string | number | null = null;
  // 小さい音声を聞き取りやすい音量に整えてから送る(スピーカー越し・遠い席の声対策)
  const leveler = settings.normalize === false ? null : new StreamingLeveler();
  const terms = parseGlossary(settings.glossary);

  const pushSegment = () => {
    const text = finalBuf.trim();
    if (text) cb.onSegment({ t: cb.offset + (segStartMs || 0) / 1000, text, speaker: lastSpeaker });
    finalBuf = ''; segStartMs = null;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleMessage = (msg: any) => {
    if (msg.error_code) {
      cb.onStatus(`Sonioxエラー ${msg.error_code}: ${msg.error_message}`);
      cb.onError(new Error(msg.error_message)); return;
    }
    let interim = '';
    for (const tok of msg.tokens || []) {
      if (tok.text === '<end>' || tok.text === '<fin>') { if (tok.is_final) pushSegment(); continue; }
      if (tok.is_final) {
        if (settings.diarize && tok.speaker != null && lastSpeaker != null && tok.speaker !== lastSpeaker && finalBuf) pushSegment();
        if (segStartMs == null) segStartMs = tok.start_ms ?? 0;
        if (tok.speaker != null) lastSpeaker = tok.speaker;
        finalBuf += tok.text;
        // 句点で区切るか、長くなりすぎたら区切る
        if (/[。！？!?]$/.test(tok.text) && finalBuf.length > 40) pushSegment();
        else if (finalBuf.length > 140) pushSegment();
      } else interim += tok.text;
    }
    cb.onInterim(finalBuf + interim);
    if (msg.finished) pushSegment();
  };

  return {
    info,
    async start() {
      if (!settings.sonioxKey) throw new Error('Soniox APIキーを設定してください');
      await new Promise<void>((resolve, reject) => {
        const sock = new WebSocket(URL_DEFAULT);
        ws = sock;
        sock.binaryType = 'arraybuffer';
        sock.onopen = () => {
          const config: Record<string, unknown> = {
            api_key: settings.sonioxKey,
            model: settings.sonioxModel || 'stt-rt-v5',
            audio_format: 'pcm_s16le', sample_rate: TARGET_RATE, num_channels: 1,
            language_hints: [(settings.lang || 'ja-JP').slice(0, 2)],
            enable_endpoint_detection: true,
            enable_speaker_diarization: !!settings.diarize,
          };
          // 用語(固有名詞・社内用語など)を認識のヒントとして渡す
          if (terms.length) config.context = { terms };
          sock.send(JSON.stringify(config));
          open = true; queue.forEach((b) => sock.send(b)); queue = []; resolve();
        };
        sock.onerror = () => reject(new Error('Soniox に接続できません'));
        sock.onmessage = (e) => { try { handleMessage(JSON.parse(e.data)); } catch { /* 無視 */ } };
        sock.onclose = (e) => { open = false; pushSegment(); if (e.code !== 1000) cb.onStatus(`Soniox 切断 (${e.code} ${e.reason || ''})`); };
      });
      cb.onStatus('録音中');
    },
    feed(raw) {
      usageSec += raw.length / TARGET_RATE;
      const int16 = leveler ? leveler.process(raw) : raw;
      const b = int16.buffer.slice(int16.byteOffset, int16.byteOffset + int16.byteLength) as ArrayBuffer;
      if (open && ws) ws.send(b); else queue.push(b);
    },
    async stop() {
      const sock = ws;
      if (sock && open) {
        sock.send('');  // 終了通知(残りを確定させる)
        await new Promise<void>((r) => { const t = setTimeout(r, 5000); sock.addEventListener('close', () => { clearTimeout(t); r(); }); });
      }
      try { sock?.close(); } catch { /* 無視 */ }
      pushSegment(); cb.onUsage(usageSec);
    },
  };
}
