// 公開用ビルド: アプリ本体(HTML/CSS/JS)を丸ごと AES-256-GCM で暗号化し、
// パスワードを知っている人だけが復号して使えるページを dist/ に出力する。
//
//   APP_PASSWORDS="pass-for-me,pass-for-alice" node scripts/build.mjs
//
// ・パスワードごとに同じ「本体の鍵」を包むので、複数人に別々のパスワードを配れる。
//   誰かを外すときは、その人のパスワードを外して再ビルドする(本体の鍵も毎回作り直すので古い鍵は無効)。
// ・文字起こし内容や API キーはサーバーに一切置かれない(各端末内のみ)。
import { build } from 'esbuild';
import { webcrypto as crypto } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'dist');
const ITER = 600000;

const passwords = (process.env.APP_PASSWORDS || '').split(',').map((s) => s.trim()).filter(Boolean);
if (!passwords.length) { console.error('APP_PASSWORDS が未設定です(未保護のビルドは作りません)'); process.exit(1); }
if (passwords.some((p) => p.length < 12)) { console.error('パスワードは12文字以上にしてください'); process.exit(1); }

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const b64 = (u8) => Buffer.from(u8).toString('base64');

async function bundle(entry) {
  const r = await build({ entryPoints: [path.join(ROOT, entry)], bundle: true, format: 'iife', minify: true, write: false, target: ['safari15'] });
  return r.outputFiles[0].text;
}

function inline(html, js, css) {
  const out = html
    .replace(/<link rel="stylesheet" href="css\/style.css">/, () => `<style>${css}</style>`)
    .replace(/<script type="module" src="js\/(app|bench)\.js"><\/script>/, () => `<script>${js}</script>`)
    .replace(/href="bench\.html"/g, 'href="./?bench"');
  if (out.includes('src="js/')) throw new Error('script の置換に失敗');
  return out;
}

const css = read('css/style.css');
const pages = {
  app: inline(read('index.html'), await bundle('js/app.js'), css),
  bench: inline(read('bench.html'), await bundle('js/bench.js'), css),
};

// 本体の鍵で暗号化
const contentKeyRaw = crypto.getRandomValues(new Uint8Array(32));
const contentKey = await crypto.subtle.importKey('raw', contentKeyRaw, 'AES-GCM', false, ['encrypt']);
const iv = crypto.getRandomValues(new Uint8Array(12));
const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, contentKey, new TextEncoder().encode(JSON.stringify(pages))));

// パスワードごとに本体の鍵を包む(PBKDF2-SHA256 → AES-GCM)
const wraps = [];
for (const pw of passwords) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  const kek = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const wiv = crypto.getRandomValues(new Uint8Array(12));
  const wct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: wiv }, kek, contentKeyRaw));
  wraps.push({ s: b64(salt), i: b64(wiv), c: b64(wct) });
}
const payload = { v: 1, iter: ITER, iv: b64(iv), ct: b64(ct), wraps };

const gate = read('scripts/gate.html').replace('__PAYLOAD__', () => JSON.stringify(payload));
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'icons'), { recursive: true });
fs.writeFileSync(path.join(OUT, 'index.html'), gate);
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
fs.writeFileSync(path.join(OUT, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
for (const f of ['manifest.webmanifest', 'icons/icon.svg', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png']) fs.copyFileSync(path.join(ROOT, f), path.join(OUT, f));
fs.writeFileSync(path.join(OUT, 'sw.js'), read('scripts/sw.dist.js'));
console.log(`dist/ を出力しました(パスワード ${passwords.length} 件, 本体 ${(ct.length / 1024).toFixed(0)} KB)`);
