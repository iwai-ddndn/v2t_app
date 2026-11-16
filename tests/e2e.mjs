// E2E: 擬似マイク + API モックで 3 方式の画面動作を確認する
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const { chromium, devices } = require(execSync('npm root -g').toString().trim() + '/playwright');

const PORT = 8765;
const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
const shot = process.env.SHOT_DIR;
let failed = 0;
const check = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); if (!cond) failed++; };

const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
async function page(settings, init) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['microphone'] });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => { console.log('pageerror', e.message); failed++; });
  await p.addInitScript((s) => { if (!sessionStorage.getItem('init')) { localStorage.setItem('v2t.settings', JSON.stringify(s)); sessionStorage.setItem('init', '1'); } }, settings);
  if (init) await p.addInitScript(init);
  return p;
}
const CORS = { 'access-control-allow-origin': '*' };

try {
  // 1) OpenAI 方式(API をモック)
  {
    const p = await page({ engine: 'openai', openaiKey: 'sk-test', chunkMin: 1, chunkMax: 2 });
    let n = 0;
    await p.route('https://api.openai.com/v1/audio/transcriptions', (r) => r.fulfill({ json: { text: `発言その${++n}です。` }, headers: CORS }));
    await p.route('https://api.openai.com/v1/chat/completions', (r) => r.fulfill({ json: { choices: [{ message: { content: '・要点テスト' } }], usage: { prompt_tokens: 100, completion_tokens: 20 } }, headers: CORS }));
    await p.goto(`http://localhost:${PORT}/`);
    await p.click('#btnStart');
    await p.waitForSelector('.seg', { timeout: 15000 });
    await p.waitForTimeout(4500);
    const segs = await p.$$eval('.seg span', (els) => els.map((e) => e.textContent));
    check(segs.length >= 2 && segs[0] === '発言その1です。', `OpenAI: 区間が順に表示される (${segs.length}件)`);
    await p.click('[data-back="30"]');
    check((await p.$$('.seg.hl')).length >= 2, '巻き戻し: 直近30秒がハイライト');
    await p.click('#btnListen');
    check(await p.isVisible('#dlgListen'), '聞き直しダイアログが開く');
    await p.click('[data-play="15"]');
    await p.click('#dlgListen button[value=close]');
    await p.click('#btnSummary'); await p.click('#btnDoSummary');
    await p.waitForFunction(() => document.querySelector('#summaryOut').textContent.includes('要点テスト'));
    check(true, '要約が表示される');
    await p.click('#dlgSummary button[value=close]');
    if (shot) await p.screenshot({ path: `${shot}/openai.png` });
    await p.click('#btnStart');
    await p.waitForFunction(() => document.querySelector('#btnStart').textContent.includes('再開'));
    const cost = await p.textContent('#cost');
    check(/^¥\d+$/.test(cost), `停止後に費用表示 ${cost}`);
    const before = (await p.$$('.seg')).length;
    await p.reload();
    check((await p.$$('.seg')).length === before, `リロード後も記録が残る (${before}件)`);
    await p.context().close();
  }
  // 2) Soniox 方式(WebSocket をモック)
  {
    const p = await page({ engine: 'soniox', sonioxKey: 'k', diarize: true }, () => {
      window.__sent = { config: null, bytes: 0 };
      window.WebSocket = class {
        constructor() { this.listeners = {}; setTimeout(() => this.onopen?.(), 10); }
        addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }
        send(d) {
          if (typeof d === 'string') {
            if (!window.__sent.config) { window.__sent.config = JSON.parse(d); this.timer = setInterval(() => this.emit(), 300); }
            else {
              clearInterval(this.timer);
              this.onmessage?.({ data: JSON.stringify({ tokens: [], finished: true }) });
              setTimeout(() => { this.onclose?.({ code: 1000 }); (this.listeners.close || []).forEach((f) => f()); }, 10);
            }
          } else window.__sent.bytes += d.byteLength;
        }
        emit() {
          this.k = (this.k || 0) + 1;
          const toks = [{ text: `トークン${this.k}`, is_final: true, start_ms: this.k * 300, speaker: (this.k % 2) + 1 }, { text: '途中', is_final: false }];
          if (this.k % 3 === 0) toks.push({ text: '<end>', is_final: true });
          this.onmessage?.({ data: JSON.stringify({ tokens: toks }) });
        }
        close() {}
      };
    });
    await p.goto(`http://localhost:${PORT}/`);
    await p.click('#btnStart');
    await p.waitForSelector('.seg', { timeout: 10000 });
    await p.waitForTimeout(1500);
    const cfg = await p.evaluate(() => window.__sent);
    check(cfg.config.sample_rate === 16000 && cfg.config.language_hints[0] === 'ja' && cfg.bytes > 10000, `Soniox: 設定送信+音声送信 (${cfg.bytes} bytes)`);
    check((await p.$$('.spk')).length > 0, 'Soniox: 話者ラベル表示');
    if (shot) await p.screenshot({ path: `${shot}/soniox.png` });
    await p.click('#btnStart');
    await p.waitForFunction(() => document.querySelector('#btnStart').textContent.includes('再開'), null, { timeout: 8000 });
    check(true, 'Soniox: 停止できる');
    await p.context().close();
  }
  // 3) Web Speech 方式(iOS のように isFinal が来ないケースをモック)
  {
    const p = await page({ engine: 'webspeech' }, () => {
      window.webkitSpeechRecognition = class {
        start() {
          let k = 0;
          this.t = setInterval(() => {
            k++;
            const text = '内蔵認識のテスト'.slice(0, Math.min(8, k * 2));
            const res = [{ transcript: text }]; res.isFinal = false;
            this.onresult?.({ resultIndex: 0, results: [res] });
            if (k >= 4) clearInterval(this.t); // 以後更新なし → 2.5秒で強制確定されるはず
          }, 200);
        }
        stop() { clearInterval(this.t); setTimeout(() => this.onend?.(), 10); }
      };
      window.SpeechRecognition = window.webkitSpeechRecognition;
    });
    await p.goto(`http://localhost:${PORT}/`);
    await p.click('#btnStart');
    await p.waitForSelector('.seg', { timeout: 6000 });
    const t = await p.$$eval('.seg span', (els) => els.map((e) => e.textContent));
    check(t.length === 1 && t[0] === '内蔵認識のテスト', `WebSpeech: 確定しない結果も一定時間で確定 (${JSON.stringify(t)})`);
    await p.click('#btnStart');
    await p.waitForTimeout(300);
    check((await p.$$('.seg')).length === 1, 'WebSpeech: 停止時に重複しない');
    await p.context().close();
  }
  // 5) PC音声の直接取り込み(getDisplayMedia をモック)+ 用語ヒント + 音量メーター
  {
    const p = await page({ engine: 'openai', openaiKey: 'sk-test', chunkMin: 1, chunkMax: 2, inputSource: 'pc', glossary: '岩井、KPI', settingsVersion: 2 }, () => {
      window.__display = 0;
      navigator.mediaDevices.getDisplayMedia = async () => {
        window.__display++;
        const a = await navigator.mediaDevices.getUserMedia({ audio: true });
        const c = document.createElement('canvas'); const v = c.captureStream(1);
        return new MediaStream([...a.getAudioTracks(), ...v.getVideoTracks()]);
      };
    });
    const forms = [];
    await p.route('https://api.openai.com/v1/audio/transcriptions', (r) => {
      const body = r.request().postData() || '';
      forms.push({ langs: body.includes('name="languages[]"'), kw: body.includes('岩井') && body.includes('name="keywords[]"'), model: /name="model"\r\n\r\ngpt-transcribe/.test(body) });
      return r.fulfill({ json: { text: 'PC音声の文字起こし' }, headers: CORS });
    });
    await p.goto(`http://localhost:${PORT}/`);
    await p.click('#btnStart');
    await p.waitForSelector('.seg', { timeout: 15000 });
    check(await p.evaluate(() => window.__display) === 1, 'PC音声モード: 画面共有(音声)を要求する');
    check(forms[0] && forms[0].model && forms[0].langs && forms[0].kw, `gpt-transcribe に languages[] と用語(keywords[])を送る ${JSON.stringify(forms[0])}`);
    const w = await p.evaluate(() => parseFloat(document.querySelector('#meterBar').style.width));
    check(w > 0, `音量メーターが動く (${w}%)`);
    await p.click('#btnStart');
    await p.waitForFunction(() => document.querySelector('#btnStart').textContent.includes('再開'));
    await p.context().close();
  }
  // 6) iPhone では PC音声の選択肢を選べない / 旧設定(v1)の移行
  {
    const ctx = await browser.newContext({ ...devices['iPhone 13'] });
    const p = await ctx.newPage();
    await p.addInitScript(() => localStorage.setItem('v2t.settings', JSON.stringify({ engine: 'openai', openaiModel: 'gpt-4o-mini-transcribe' })));
    await p.goto(`http://localhost:${PORT}/`);
    await p.click('#btnSettings');
    const dis = await p.$$eval('select[name=inputSource] option[value^="pc"]', (os) => os.every((o) => o.disabled));
    check(dis, 'iPhone: PC音声の選択肢は無効');
    const st = await p.evaluate(() => JSON.parse(localStorage.getItem('v2t.settings')));
    check(st.openaiModel === 'gpt-transcribe' && st.inputSource === 'mic' && st.normalize === true, `旧設定を新しい既定値へ移行 (${st.openaiModel}, ${st.inputSource})`);
    if (shot) await p.screenshot({ path: `${shot}/settings-iphone.png`, fullPage: false });
    await ctx.close();
  }
  // 4) 比較ページ
  {
    const p = await page({});
    await p.goto(`http://localhost:${PORT}/bench.html`);
    await p.fill('#manualName', 'ボイスメモ'); await p.fill('#manualText', '今日は晴れ');
    await p.click('#addManual'); await p.fill('#ref', '今日は晴れです');
    const c = await p.textContent('#tbody tr td:nth-child(2)');
    check(c === '28.6%', `比較ページ: CER 計算 (${c})`);
    if (shot) await p.screenshot({ path: `${shot}/bench.png` });
    await p.context().close();
  }
} finally {
  await browser.close(); server.kill();
}
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
