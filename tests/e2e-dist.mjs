// 公開ビルド(dist/)の E2E: パスワード保護と、暗号化された本体が正しく動くかを確認する
//   APP_PASSWORDS=... node scripts/build.mjs && TEST_PASSWORD=... node tests/e2e-dist.mjs
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require(execSync('npm root -g').toString().trim() + '/playwright');

const PW = process.env.TEST_PASSWORD;
if (!PW) { console.error('TEST_PASSWORD を指定してください'); process.exit(1); }
const dist = new URL('../dist', import.meta.url).pathname;
const PORT = 8766;
const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: dist, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
let failed = 0;
const check = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) failed++; };
const CORS = { 'access-control-allow-origin': '*' };

const html = fs.readFileSync(`${dist}/index.html`, 'utf8');
// 暗号文(base64)の中は偶然の文字列一致があり得るので、それ以外の部分だけを調べる
const outside = html.replace(/<script id="payload"[\s\S]*?<\/script>/, '');
check(html.includes('"wraps"') && !/openai\.com|soniox|追いつく|transcriptions|radix/i.test(outside), '公開HTMLに本体のコードが平文で含まれない');

const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['microphone'] });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => { console.log('pageerror', e.message); failed++; });
  await p.addInitScript(() => { if (!localStorage.getItem('v2t.settings')) localStorage.setItem('v2t.settings', JSON.stringify({ onboarded: true, settingsVersion: 3, engine: 'openai', openaiKey: 'sk-test', chunkMin: 1, chunkMax: 2 })); });
  let n = 0;
  await p.route('https://api.openai.com/v1/audio/transcriptions', (r) => r.fulfill({ json: { text: `公開版${++n}` }, headers: CORS }));
  const url = `http://localhost:${PORT}/`;

  await p.goto(url);
  await p.fill('#pw', 'wrong-password-123');
  await p.click('#go');
  await p.waitForFunction(() => document.querySelector('#msg').textContent.includes('違います'), null, { timeout: 15000 });
  check(!(await p.$('#btnStart')), '誤ったパスワードでは開かない');

  await p.fill('#pw', PW);
  await p.click('#go');
  await p.getByRole('button', { name: '録音を開始' }).waitFor({ timeout: 15000 });
  check(true, '正しいパスワードで本体が開く');
  await p.getByRole('button', { name: '録音を開始' }).click();
  await p.waitForSelector('[data-t]', { timeout: 15000 });
  check((await p.locator('[data-t] p').first().textContent()) === '公開版1', '公開版でも録音→文字起こしが動く(ワークレット含む)');
  await p.getByRole('button', { name: '一時停止' }).click();
  await p.getByRole('button', { name: '再開' }).waitFor();

  await p.goto(url);
  await p.getByRole('button', { name: '再開' }).waitFor({ timeout: 15000 });
  check((await p.locator('[data-t]').count()) >= 1, '記憶した端末ではパスワード不要・記録も残る');

  await p.goto(`${url}?bench`);
  await p.getByRole('heading', { name: 'ラボ: 方式の比較' }).waitFor({ timeout: 15000 });
  check(true, '旧版の比較ページの URL は新しいラボ画面へ');

  await p.goto(`${url}#/settings`);
  await p.getByRole('button', { name: 'この端末からログアウト' }).click();
  await p.waitForSelector('#pw', { timeout: 15000 });
  check(true, 'ログアウトでパスワード画面に戻る');
} finally {
  await browser.close(); server.kill();
}
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
