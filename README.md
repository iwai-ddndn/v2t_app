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

## 2つの版
| | Web版(PWA) | ネイティブ版(iOSアプリ, `ios/`) |
|---|---|---|
| 方式 | 内蔵認識 / OpenAI / Soniox | OpenAI / Soniox |
| **画面を消す・他のアプリに切り替える** | ✗ 録音が止まることがある | ✅ **録音を継続**(バックグラウンド音声) |
| 通話などで中断されたとき | ― | 終わったら自動で再開 |
| Soniox の通信が切れたとき | 停止 | 自動で再接続 |
| インストール | URL を開くだけ | Mac + Xcode が必要 |

## Web版の公開(パスワード保護)
公開されるのは **`dist/` に入った暗号化済みのページだけ**です。
- アプリ本体(HTML/CSS/JS)は AES-256-GCM で暗号化されています。パスワード(PBKDF2-SHA256・60万回)を知っている人だけが復号して開けます。
- 誤ったパスワードでは何も表示されません。「この端末を記憶する」にチェックを入れると、次回からパスワードは不要です。設定画面からログアウトもできます。
- **文字起こしの内容・音声・APIキーは、サーバーにもリポジトリにも置かれません**。各端末の中にだけ保存され、音声は選んだ API(OpenAI / Soniox)へ直接送られます。
- 検索エンジンには登録されないように設定しています(noindex / robots.txt)。

### 公開手順(GitHub Pages)
1. リポジトリの Settings → Pages → Source を「**GitHub Actions**」にします。
2. Settings → General → Default branch を `main` にします(Pages のデプロイは既定ブランチからのみ許可されるため)。
3. Actions → 「Deploy web app (password protected)」→ Run workflow を実行します。`main` への push でも自動でデプロイされます。
4. 表示された URL(`https://<ユーザー名>.github.io/v2t_app/`)を iPhone の Safari で開き、パスワードを入力します。「共有 → ホーム画面に追加」でアプリのように使えます。

※非公開リポジトリで Pages を使うには、GitHub Pro 以上のプランが必要です。無料プランの場合は、リポジトリを公開にするか(公開されるのはソースコードだけで、記録やキーは含まれません)、`dist/` フォルダを Cloudflare Pages にアップロードしてください。

### パスワードの変更・人の追加
- Settings → Secrets and variables → Actions に `APP_PASSWORDS` を登録します(12文字以上、カンマ区切りで複数可。例: `自分用パスワード,Aさん用パスワード`)。登録すると、デプロイのたびにそのパスワードで暗号化し直します。
- ある人を外すときは、その人のパスワードを消して再デプロイします。中身の暗号鍵も毎回作り直すので、その人が「記憶した端末」も開けなくなります。
- 手元でビルドする場合は `APP_PASSWORDS="..." npm run build` を実行します。

## ネイティブ版(iOS アプリ)のインストール
Mac が必要です(Windows では iOS アプリをビルドできません)。
1. Mac に Xcode(無料)と XcodeGen をインストールします: `brew install xcodegen`
2. `cd ios && xcodegen generate && open V2T.xcodeproj`
3. Xcode → Settings → Accounts で Apple ID を追加します。ターゲット V2T → Signing & Capabilities → Team で自分を選び、Bundle Identifier を一意の名前(例: `com.あなたの名前.v2t`)に変えます。
4. iPhone をケーブルで接続して ▶ を押します。初回は iPhone の「設定 → 一般 → VPNとデバイス管理」で開発元を信頼してください。
   - 無料の Apple ID で入れたアプリは **7日で起動できなくなります**(再度 ▶ でまた使えます)。ずっと使うなら、Apple Developer Program(年 $99)に登録すると TestFlight で配布できます。
5. ⚙ 設定に OpenAI / Soniox の API キーを入れます。キーは Keychain に、記録はアプリ内に保存されます。

## 開発
ビルド不要の素の HTML / JavaScript です。

```sh
npm run serve      # http://localhost:8080
npm test           # 単体テスト(音声の区切り・リングバッファ・CER・OpenAIの順序保証)
npm run e2e        # Playwright で疑似マイク+APIモックの E2E テスト
APP_PASSWORDS=... npm run build && TEST_PASSWORD=... npm run e2e:dist   # 公開ビルドの E2E テスト
```

| ファイル | 役割 |
|---|---|
| `js/audio.js` | マイク入力 → 16kHz PCM、リングバッファ、無音で区切るチャンカー、WAV 化 |
| `js/engines/webspeech.js` | 内蔵認識(iOS 向けの自動再起動・強制確定つき) |
| `js/engines/openai.js` | OpenAI 文字起こし API(区間を並列送信し、順序を保って表示。再送あり) |
| `js/engines/soniox.js` | Soniox WebSocket ストリーミング(話者分離あり) |
| `js/app.js` | 画面・巻き戻し・聞き直し・要約・保存 |
| `js/bench.js` / `bench.html` | 方式の比較検証 |
| `scripts/build.mjs` / `scripts/gate.html` | 公開用の暗号化ビルドとパスワード画面 |
| `ios/` | ネイティブ版(SwiftUI。`project.yml` から XcodeGen でプロジェクトを生成) |

### ブラウザから OpenAI API に直接つながらない場合
社内ネットワークなどでつながらない場合は、Cloudflare Workers などで簡単なプロキシを立て、設定の「API Base URL」にそのアドレスを入れてください。
