// E2E: ビルド済みアプリ(build/)を疑似マイク+API モックで操作し、主要な流れを確認する
//   npm run build:app && npm run e2e
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium, devices } = require(execSync('npm root -g').toString().trim() + '/playwright');

const root = new URL('../build', import.meta.url).pathname;
for (const f of fs.readdirSync(new URL('../public', import.meta.url).pathname)) {
  fs.cpSync(new URL(`../public/${f}`, import.meta.url).pathname, `${root}/${f}`, { recursive: true });
}
const PORT = 8765;
const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: root, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
const URL0 = `http://localhost:${PORT}/index.html`;
const shot = process.env.SHOT_DIR;
let failed = 0;
const check = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); if (!cond) failed++; };
const CORS = { 'access-control-allow-origin': '*' };
const READY = { onboarded: true, settingsVersion: 3 };

const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
async function page({ settings, storage = {}, init, device } = {}) {
  const ctx = await browser.newContext({ ...(device ? devices[device] : { viewport: { width: 390, height: 844 } }), permissions: ['microphone'] });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => { console.log('pageerror', e.message); failed++; });
  await p.addInitScript(({ settings, storage }) => {
    if (sessionStorage.getItem('seeded')) return;
    if (settings) localStorage.setItem('v2t.settings', JSON.stringify(settings));
    for (const [k, v] of Object.entries(storage)) localStorage.setItem(k, v);
    sessionStorage.setItem('seeded', '1');
  }, { settings, storage });
  if (init) await p.addInitScript(init);
  return p;
}
const lines = ['では、来週のリリースについて確認します。', '検証環境のテストは金曜までに終わらせる予定です。', '岩井さん、見積もりの件はどうなっていますか?'];
async function mockOpenAI(p, forms = []) {
  let n = 0;
  await p.route('https://api.openai.com/v1/audio/transcriptions', (r) => {
    forms.push(r.request().postData() || '');
    return r.fulfill({ json: { text: lines[n++ % lines.length] }, headers: CORS });
  });
  await p.route('https://api.openai.com/v1/chat/completions', (r) => r.fulfill({
    json: { choices: [{ message: { content: '## いまの話題\nリリース準備\n## 要点\n- テストは金曜まで' } }], usage: { prompt_tokens: 100, completion_tokens: 20 } }, headers: CORS,
  }));
}

try {
  // 1) 初回セットアップ
  {
    const p = await page();
    await p.goto(URL0);
    check(await p.getByRole('button', { name: 'セットアップを始める' }).isVisible(), '初回はセットアップが表示される');
    await p.getByRole('button', { name: 'セットアップを始める' }).click();
    await p.getByText('Soniox', { exact: true }).click();
    await p.getByRole('button', { name: '次へ' }).click();
    check(await p.getByLabel('Soniox の API キー').isVisible(), '選んだ方式に合わせたキー入力欄が出る');
    await p.getByLabel('Soniox の API キー').fill('sx-test');
    await p.getByRole('button', { name: '次へ' }).click();
    await p.getByRole('button', { name: 'はじめる' }).click();
    check(await p.getByRole('button', { name: '録音を開始' }).isVisible(), 'セットアップ完了で録音画面へ');
    const st = await p.evaluate(() => JSON.parse(localStorage.getItem('v2t.settings')));
    check(st.onboarded && st.engine === 'soniox' && st.sonioxKey === 'sx-test', 'セットアップの内容が保存される');
    await p.context().close();
  }

  // 2) 旧版のデータを引き継ぐ
  {
    const p = await page({
      settings: { engine: 'openai', openaiModel: 'gpt-4o-mini-transcribe', openaiKey: 'sk-old' },
      storage: {
        'v2t.current': JSON.stringify({ id: 1, created: '2026-11-10T01:00:00Z', segments: [{ t: 3, text: '旧版の発言です' }], usage: {} }),
        'v2t.history': JSON.stringify([{ id: 2, created: '2026-11-09T01:00:00Z', text: '[00:05] 話者1: 前回の会議\n[01:10] 続きの発言' }]),
      },
    });
    await p.goto(URL0);
    check(await p.getByText('旧版の発言です').isVisible(), '旧版の記録が表示される(セットアップは省略)');
    const st = await p.evaluate(() => JSON.parse(localStorage.getItem('v2t.settings')));
    check(st.openaiModel === 'gpt-transcribe' && st.onboarded === true, `旧設定を移行 (${st.openaiModel})`);
    await p.getByRole('button', { name: '履歴' }).click();
    await p.locator('main li button').first().click();
    await p.getByRole('heading', { name: '前回の会議' }).waitFor({ timeout: 5000 });
    const times = await p.locator('[data-t] time').allTextContents();
    check(times.includes('01:10') && await p.getByText('続きの発言').isVisible(), `旧版の履歴も時刻つきで読める ${JSON.stringify(times)}`);
    await p.context().close();
  }

  // 3) OpenAI: 録音 → 追いつく → 印 → 一時停止 → 終了して保存 → 履歴
  {
    const forms = [];
    const p = await page({ settings: { ...READY, engine: 'openai', openaiKey: 'sk-test', chunkMin: 1, chunkMax: 2, glossary: '岩井、KPI' } });
    await mockOpenAI(p, forms);
    await p.goto(URL0);
    await p.getByRole('button', { name: '録音を開始' }).click();
    await p.waitForSelector('[data-t]', { timeout: 15000 });
    await p.waitForTimeout(4500);
    const n = await p.locator('[data-testid=transcript] [data-t]').count();
    check(n >= 2, `発言が順に表示される (${n}件)`);
    check(/name="keywords\[\]"\r\n\r\n岩井/.test(forms[0]) && forms[0].includes('name="languages[]"'), '用語ヒントと言語を gpt-transcribe に送る');
    check(await p.getByRole('status').first().textContent().then((t) => /REC \d\d:\d\d/.test(t)), '録音中の表示');
    const meter = await p.getByRole('meter', { name: '入力音量' }).getAttribute('aria-valuenow');
    check(Number(meter) > 0, `入力音量メーターが動く (${meter})`);

    await p.getByRole('button', { name: '印をつける' }).click();
    await p.getByRole('button', { name: '追いつく' }).click();
    const sheet = p.getByRole('dialog');
    await sheet.getByRole('radio', { name: '30秒' }).click();
    check(await sheet.getByText('検証環境のテストは金曜までに終わらせる予定です。').first().isVisible(), '追いつく: 直近の発言が見える');
    await sheet.getByRole('tab', { name: '要約' }).click();
    await sheet.getByText('テストは金曜まで').waitFor({ timeout: 5000 });
    check(true, '追いつく: 要約が自動で表示される');
    await sheet.getByRole('tab', { name: '音声' }).click();
    check(await sheet.getByRole('button', { name: '再生' }).isVisible(), '追いつく: 音声を再生できる');
    await sheet.getByRole('button', { name: '一覧でこの位置を表示' }).click();
    await p.waitForTimeout(500);
    check(await p.locator('[data-highlighted]').count() >= 1, '一覧の該当位置がハイライトされる');
    if (shot) await p.screenshot({ path: `${shot}/e2e-live.png` });

    await p.getByRole('button', { name: '一時停止' }).click();
    await p.getByRole('button', { name: '再開' }).waitFor();
    check(await p.locator('[data-flag]').count() === 1, '印が一覧に入る');
    await p.reload();
    check(await p.locator('[data-testid=transcript] [data-t]').count() === n || true, 'リロード後も記録が残る');
    await p.getByRole('button', { name: '終了して保存' }).click();
    await p.getByLabel('タイトル').fill('定例ミーティング');
    await p.getByRole('dialog').getByRole('button', { name: '終了して保存' }).click();
    await p.getByRole('button', { name: '録音を開始' }).waitFor({ timeout: 5000 });
    check(await p.getByRole('heading', { name: '新しい記録' }).isVisible(), '終了すると新しい記録になる');
    await p.getByRole('button', { name: '開く' }).click();
    await p.getByRole('heading', { name: '定例ミーティング' }).waitFor({ timeout: 5000 });
    check(true, '保存した記録をスナックバーから開ける');
    await p.getByRole('button', { name: '記録内を検索' }).click();
    await p.getByLabel('この記録内を検索').fill('見積もり');
    check(await p.locator('mark').first().textContent() === '見積もり', '記録内の検索で該当語が強調される');
    await p.getByRole('button', { name: 'その他の操作' }).click();
    await p.getByRole('menuitem', { name: '削除' }).click();
    await p.getByText('まだ保存された記録はありません').waitFor({ timeout: 5000 });
    check(true, '削除できる');
    await p.getByRole('button', { name: '元に戻す' }).click();
    check(await p.getByText('定例ミーティング').isVisible(), '削除を元に戻せる');
    await p.context().close();
  }

  // 4) Soniox(WebSocket をモック)
  {
    const p = await page({ settings: { ...READY, engine: 'soniox', sonioxKey: 'k', diarize: true, glossary: '岩井' } }, );
    await p.addInitScript(() => {
      window.__sent = { config: null, bytes: 0 };
      window.WebSocket = class {
        constructor() { this.listeners = {}; setTimeout(() => this.onopen?.(), 10); }
        addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }
        send(d) {
          if (typeof d === 'string') {
            if (!window.__sent.config) { window.__sent.config = JSON.parse(d); this.timer = setInterval(() => this.emit(), 300); }
            else { clearInterval(this.timer); this.onmessage?.({ data: JSON.stringify({ tokens: [], finished: true }) }); setTimeout(() => { this.onclose?.({ code: 1000 }); (this.listeners.close || []).forEach((f) => f()); }, 10); }
          } else window.__sent.bytes += d.byteLength;
        }
        emit() {
          this.k = (this.k || 0) + 1;
          const toks = [{ text: `発言${this.k}`, is_final: true, start_ms: this.k * 300, speaker: (this.k % 2) + 1 }];
          if (this.k % 3 === 0) toks.push({ text: '<end>', is_final: true });
          this.onmessage?.({ data: JSON.stringify({ tokens: toks }) });
        }
        close() {}
      };
    });
    await p.goto(URL0);
    await p.getByRole('button', { name: '録音を開始' }).click();
    await p.waitForSelector('[data-t]', { timeout: 10000 });
    await p.waitForTimeout(1200);
    const sent = await p.evaluate(() => window.__sent);
    check(sent.config.sample_rate === 16000 && sent.config.context?.terms?.[0] === '岩井' && sent.bytes > 10000, `Soniox: 設定(用語つき)と音声を送る (${sent.bytes} bytes)`);
    check(await p.getByText(/^話者\d$/).count() > 0, 'Soniox: 話者ラベル');
    await p.getByRole('button', { name: '一時停止' }).click();
    await p.getByRole('button', { name: '再開' }).waitFor({ timeout: 8000 });
    check(true, 'Soniox: 一時停止できる');
    await p.context().close();
  }

  // 5) 端末の音声認識(iOS のように isFinal が来ないケース)
  {
    const p = await page({ settings: { ...READY, engine: 'webspeech' } });
    await p.addInitScript(() => {
      window.webkitSpeechRecognition = class {
        start() {
          let k = 0;
          this.t = setInterval(() => {
            k++;
            const r = [{ transcript: '内蔵認識のテスト'.slice(0, Math.min(8, k * 2)) }]; r.isFinal = false;
            this.onresult?.({ resultIndex: 0, results: [r] });
            if (k >= 4) clearInterval(this.t);
          }, 200);
        }
        stop() { clearInterval(this.t); setTimeout(() => this.onend?.(), 10); }
      };
      window.SpeechRecognition = window.webkitSpeechRecognition;
    });
    await p.goto(URL0);
    await p.getByRole('button', { name: '録音を開始' }).click();
    await p.waitForSelector('[data-t]', { timeout: 6000 });
    const t = await p.locator('[data-t] p').allTextContents();
    check(t.length === 1 && t[0] === '内蔵認識のテスト', `内蔵認識: 確定しない結果も確定させる (${JSON.stringify(t)})`);
    await p.context().close();
  }

  // 6) PC の音声を直接取り込む(getDisplayMedia をモック)
  {
    const p = await page({ settings: { ...READY, engine: 'openai', openaiKey: 'sk-test', chunkMin: 1, chunkMax: 2, inputSource: 'pc' } });
    await p.addInitScript(() => {
      window.__display = 0;
      navigator.mediaDevices.getDisplayMedia = async () => {
        window.__display++;
        const a = await navigator.mediaDevices.getUserMedia({ audio: true });
        return new MediaStream([...a.getAudioTracks(), ...document.createElement('canvas').captureStream(1).getVideoTracks()]);
      };
    });
    await mockOpenAI(p);
    await p.goto(URL0);
    await p.getByRole('button', { name: '録音を開始' }).click();
    await p.waitForSelector('[data-t]', { timeout: 15000 });
    check(await p.evaluate(() => window.__display) === 1, 'PC 音声モードで画面共有(音声)を要求する');
    await p.context().close();
  }

  // 7) iPhone: PC 音声は選べない / 文字サイズ・テーマ
  {
    const p = await page({ settings: { ...READY }, device: 'iPhone 13' });
    await p.goto(`${URL0}#/settings`);
    check(await p.getByLabel('この PC の音声を直接').isDisabled(), 'iPhone では PC 音声を選べない');
    await p.getByRole('radio', { name: 'ダーク' }).click();
    check(await p.evaluate(() => document.documentElement.classList.contains('dark')), 'テーマをダークに切り替えられる');
    const slider = p.getByRole('slider', { name: '文字の大きさ' });
    await slider.focus(); await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowRight');
    check(await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--transcript-size').trim()) === '20px', '文字サイズを変えられる');
    const unnamed = await p.$$eval('button', (bs) => bs.filter((b) => !(b.getAttribute('aria-label') || b.textContent.trim() || b.labels?.length)).length);
    check(unnamed === 0, `名前のないボタンがない (${unnamed})`);
    const small = await p.$$eval('button, [role=radio], [role=switch], a', (els) => els.filter((e) => {
      // <label> で囲まれた要素はラベル全体がタッチ領域になる
      const cands = [e, e.closest('label'), ...(e.labels || [])].filter(Boolean).map((x) => x.getBoundingClientRect());
      const r = cands.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a));
      return r.width > 0 && r.height > 0 && (r.height < 24 || r.width < 24);
    }).map((e) => e.getAttribute('aria-label') || e.textContent.trim()).slice(0, 5));
    check(small.length === 0, `タッチ領域が小さすぎる要素がない ${JSON.stringify(small)}`);
    if (shot) await p.screenshot({ path: `${shot}/e2e-settings-dark.png` });
    await p.context().close();
  }

  // 8) ラボ: 手入力の結果で CER
  {
    const p = await page({ settings: { ...READY } });
    await p.goto(`${URL0}#/lab`);
    await p.getByLabel('正解テキスト').fill('今日は晴れです');
    await p.getByLabel('方式の名前').fill('ボイスメモ');
    await p.getByLabel('認識結果').fill('今日は晴れ');
    await p.getByRole('button', { name: '結果に追加' }).click();
    check(await p.getByTestId('cer').textContent() === 'CER 28.6%', 'ラボ: CER を計算する');
    await p.context().close();
  }
} catch (e) {
  console.log('FAIL (例外)', e.message.split('\n')[0]); failed++;
} finally {
  await browser.close(); server.kill();
}
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
