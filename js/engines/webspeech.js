// 無料: ブラウザ内蔵の音声認識(iPhone Safari では Apple の音声認識が使われる)
// iOS では勝手に止まる・isFinal にならない等の癖があるため、自動再起動と「確定待ちタイマー」で補う。
export const info = {
  id: 'webspeech', name: 'iPhone内蔵音声認識 (Web Speech API)', costPerMin: 0, needsMic: false,
};

export function isSupported() {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

export function create(settings, cb) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null, running = false, stallTimer = null, restartCount = 0;
  // resultIndex ごとに確定済みとして出力した文字数(iOS で isFinal が来ない対策)
  let committed = new Map();
  let usageStart = 0;

  const commit = (idx, text) => {
    const done = committed.get(idx) || '';
    const rest = text.startsWith(done) ? text.slice(done.length) : text;
    if (rest.trim()) cb.onSegment({ t: cb.now(), text: rest.trim() });
    committed.set(idx, text);
  };

  const startRec = () => {
    rec = new SR();
    rec.lang = settings.lang || 'ja-JP';
    rec.continuous = true;
    rec.interimResults = true;
    committed = new Map();
    let lastIdx = -1, lastText = '';
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]; const text = r[0].transcript;
        if (r.isFinal) commit(i, text);
        else {
          const done = committed.get(i) || '';
          interim += text.startsWith(done) ? text.slice(done.length) : text;
          lastIdx = i; lastText = text;
        }
      }
      cb.onInterim(interim);
      clearTimeout(stallTimer);
      if (interim) stallTimer = setTimeout(() => { commit(lastIdx, lastText); cb.onInterim(''); }, 2500);
    };
    rec.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      cb.onStatus(`認識エラー: ${e.error}(自動再開します)`);
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { running = false; cb.onError(new Error('マイク/音声認識が許可されていません')); }
    };
    rec.onend = () => {
      clearTimeout(stallTimer);
      if (lastText) commit(lastIdx, lastText);
      lastText = '';
      cb.onInterim('');
      if (running) { restartCount++; setTimeout(() => running && startRec(), 250); }
    };
    rec.start();
  };

  return {
    info,
    async start() {
      if (!isSupported()) throw new Error('このブラウザは Web Speech API に非対応です');
      running = true; usageStart = Date.now(); startRec();
      cb.onStatus('認識中(無料・端末/Apple側で処理)');
    },
    feed() {},
    async stop() {
      running = false; clearTimeout(stallTimer);
      try { rec && rec.stop(); } catch {}
      cb.onUsage((Date.now() - usageStart) / 1000);
    },
    stats: () => ({ restarts: restartCount }),
  };
}
