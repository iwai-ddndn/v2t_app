// Soniox リアルタイム音声認識(WebSocket ストリーミング)。日本語に強く単価が最安クラス。
// 1〜2 秒程度の遅延で逐次表示。ブラウザから直接 WebSocket で接続できる(CORS不要)。
import { TARGET_RATE, StreamingLeveler } from '../audio.js';
import { parseGlossary } from './openai.js';

export const URL_DEFAULT = 'wss://stt-rt.soniox.com/transcribe-websocket';

export function create(settings, cb) {
  const info = { id: 'soniox', name: `Soniox ${settings.sonioxModel || 'stt-rt-v5'}`, costPerMin: 0.12 / 60, needsMic: true };
  let ws = null, open = false, queue = [], usageSec = 0;
  let finalBuf = ''; let segStartMs = null; let lastSpeaker = null;
  // 小さい音声を聞き取りやすい音量に整えてから送る(スピーカー越し・遠い席の声対策)
  const leveler = settings.normalize === false ? null : new StreamingLeveler();
  const terms = parseGlossary(settings.glossary);

  const pushSegment = () => {
    const text = finalBuf.trim();
    if (text) cb.onSegment({ t: cb.offset + (segStartMs || 0) / 1000, text, speaker: lastSpeaker });
    finalBuf = ''; segStartMs = null;
  };

  const handleMessage = (msg) => {
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
      await new Promise((resolve, reject) => {
        ws = new WebSocket(settings.sonioxUrl || URL_DEFAULT);
        ws.binaryType = 'arraybuffer';
        ws.onopen = () => {
          const config = {
            api_key: settings.sonioxKey,
            model: settings.sonioxModel || 'stt-rt-v5',
            audio_format: 'pcm_s16le', sample_rate: TARGET_RATE, num_channels: 1,
            language_hints: [(settings.lang || 'ja-JP').slice(0, 2)],
            enable_endpoint_detection: true,
            enable_speaker_diarization: !!settings.diarize,
          };
          // 用語(固有名詞・社内用語など)を認識のヒントとして渡す
          if (terms.length) config.context = { terms };
          ws.send(JSON.stringify(config));
          open = true; queue.forEach((b) => ws.send(b)); queue = []; resolve();
        };
        ws.onerror = () => reject(new Error('Soniox に接続できません'));
        ws.onmessage = (e) => { try { handleMessage(JSON.parse(e.data)); } catch {} };
        ws.onclose = (e) => { open = false; pushSegment(); if (e.code !== 1000) cb.onStatus(`Soniox 切断 (${e.code} ${e.reason || ''})`); };
      });
      cb.onStatus(`録音中(${info.name}・ストリーミング)`);
    },
    feed(raw) {
      usageSec += raw.length / TARGET_RATE;
      const int16 = leveler ? leveler.process(raw) : raw;
      const b = int16.buffer.slice(int16.byteOffset, int16.byteOffset + int16.byteLength);
      if (open) ws.send(b); else queue.push(b);
    },
    async stop() {
      if (ws && open) {
        ws.send('');  // 終了通知(残りを確定させる)
        await new Promise((r) => { const t = setTimeout(r, 5000); ws.addEventListener('close', () => { clearTimeout(t); r(); }); });
      }
      try { ws && ws.close(); } catch {}
      pushSegment(); cb.onUsage(usageSec);
    },
  };
}
