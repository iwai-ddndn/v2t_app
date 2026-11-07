# 会議メモ — iPhone 向けリアルタイム文字起こし

会議中に **「今なんて言った?」「さっきの話は何だった?」** をすぐ確認するための Web アプリ(PWA)です。

- 文字起こしの方式を3つから選べます
  - **無料:iPhone内蔵**: Safari 内蔵の音声認識を使います。0円です。
  - **OpenAI(高精度)**: gpt-4o-mini-transcribe を使います。1時間あたり約27円ですが、ChatGPT Pro の API クレジットの範囲内なら実質0円です。
  - **Soniox(即時)**: 遅延1〜2秒で、1時間あたり約20円です。
- **◀30秒 / 1分 / 3分 / 5分**: その時点までの発言にすぐ戻り、ハイライト表示します。
- **🔊 聞き直す**: 直近15秒〜3分の音声を再生します(イヤホン推奨)。
- **🧠 要約**: 直近3分/5分/10分/全体を、AI が「今の話題・要点・決定事項・自分への質問」にまとめます。
- 記録は端末内に自動保存されます。テキストでの保存・コピー・履歴(30件)にも対応しています。
- **比較検証ページ(`bench.html`)**: 同じ音声を複数の方式で文字起こしし、CER・速度・費用を比較できます。

方式ごとの費用と品質の比較、推奨する使い分けは **[docs/EVALUATION.md](docs/EVALUATION.md)** にまとめています。

## 使い方(iPhone)
1. HTTPS で公開します(マイクを使うため HTTPS が必須です)。
   - **GitHub Pages**: リポジトリの Settings → Pages → Source で「GitHub Actions」を選び、`main` に push します(`.github/workflows/pages.yml` が自動でデプロイします)。※非公開リポジトリで Pages を使うには、GitHub の有料プランが必要です。
   - または **Cloudflare Pages / Netlify** にフォルダごとアップロードします(無料。ビルドは不要)。
2. iPhone の Safari で開き、「共有 → ホーム画面に追加」でアプリのように使えます。
3. ⚙︎ 設定に API キーを入力します(OpenAI 方式・Soniox 方式を使う場合のみ)。
   - OpenAI: https://platform.openai.com/api-keys で発行します。ChatGPT Pro の特典クレジットは、ChatGPT の Settings → Billing から申請します。
   - キーは端末のブラウザ内にのみ保存され、各社の API に直接送信されます。
4. 会議中は**画面を点けたまま、アプリを前面に**出しておいてください(iOS は、バックグラウンドに回った Web アプリのマイクを止めます)。

## 開発
ビルド不要の素の HTML / JavaScript です。

```sh
npm run serve      # http://localhost:8080
npm test           # 単体テスト(音声の区切り・リングバッファ・CER・OpenAIの順序保証)
npm run e2e        # Playwright で疑似マイク+APIモックの E2E テスト
```

| ファイル | 役割 |
|---|---|
| `js/audio.js` | マイク入力 → 16kHz PCM、リングバッファ、無音で区切るチャンカー、WAV 化 |
| `js/engines/webspeech.js` | 内蔵認識(iOS 向けの自動再起動・強制確定つき) |
| `js/engines/openai.js` | OpenAI 文字起こし API(区間を並列送信し、順序を保って表示。再送あり) |
| `js/engines/soniox.js` | Soniox WebSocket ストリーミング(話者分離あり) |
| `js/app.js` | 画面・巻き戻し・聞き直し・要約・保存 |
| `js/bench.js` / `bench.html` | 方式の比較検証 |

### ブラウザから OpenAI API に直接つながらない場合
社内ネットワークなどでつながらない場合は、Cloudflare Workers などで簡単なプロキシを立て、設定の「API Base URL」にそのアドレスを入れてください。
