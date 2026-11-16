# ネイティブアプリ(iOS)インストール手順書

会議メモのネイティブ版を、自分の iPhone に入れて使うまでの手順です。
ネイティブ版は、**画面を消しても・他のアプリを使っていても録音と文字起こしが続きます**。

所要時間の目安: 初回は 1〜2 時間(Xcode のダウンロード時間がほとんどです)。2 回目以降は 5 分ほどです。

---

## 0. 必要なもの

| 必要なもの | 備考 |
|---|---|
| **Mac** | Windows では iOS アプリを作れません。Xcode が動く macOS が必要です(最新の Xcode は比較的新しい macOS を求めます)。 |
| **iPhone と USB ケーブル** | 初回はケーブル接続が必要です(2 回目以降は Wi-Fi でも可)。 |
| **Apple ID** | いつも使っている Apple ID で OK です(無料)。 |
| **GitHub にログインできること** | このリポジトリは非公開なので、ダウンロードにログインが必要です。 |
| **API キー**(どちらか、または両方) | OpenAI(ChatGPT Pro の API クレジットが使えます)/ Soniox |

### 無料の Apple ID と有料の開発者登録の違い
| | 無料の Apple ID | Apple Developer Program(年 $99) |
|---|---|---|
| 自分の iPhone に入れる | ✅ | ✅ |
| アプリの有効期限 | **7 日**(切れたら Mac から入れ直す。記録は消えません) | 1 年 |
| 他の人に配る | ✗ | ✅ TestFlight で配布できる |

まずは無料で試して、気に入ったら有料登録を検討するのがおすすめです。

---

## 1. Mac の準備(初回のみ)

### 1-1. Xcode をインストールする
1. Mac の **App Store** で「Xcode」を検索してインストールします(数十 GB あり、時間がかかります)。
2. インストールが終わったら Xcode を一度起動します。ライセンスに同意し、追加コンポーネントのインストールを待ちます。
3. **iOS のプラットフォーム**を求められたら、ダウンロードします。
   - 求められなかった場合は、Xcode → Settings → **Components** で iOS を確認します。
   - iPhone の iOS より Xcode が古いとアプリを入れられません。Xcode は最新にしておいてください。

### 1-2. Homebrew と XcodeGen をインストールする
このアプリは、設定ファイル(`ios/project.yml`)から Xcode のプロジェクトを自動生成する方式です。生成には **XcodeGen** というツールを使います。

1. **ターミナル**を開きます(Finder → アプリケーション → ユーティリティ → ターミナル)。
2. Homebrew が入っていなければ、https://brew.sh に載っている 1 行のコマンドを貼り付けて実行します。
   - 終了時に「Next steps」として表示されるコマンド(`echo ... >> ~/.zprofile` など)も、指示どおり実行してください。
3. 次を実行します。
   ```sh
   brew install xcodegen
   ```
4. `xcodegen --version` でバージョンが表示されれば OK です。

---

## 2. ソースコードを Mac にダウンロードする

非公開リポジトリなので、ログインが必要です。**GitHub Desktop を使う方法が一番簡単**です。

### 方法A: GitHub Desktop(おすすめ)
1. https://desktop.github.com から GitHub Desktop をインストールし、GitHub アカウントでサインインします。
2. File → **Clone Repository** → `iwai-ddndn/v2t_app` を選びます。
   - 保存先は、例えば `~/Documents/v2t_app` にします。
3. 左上の「Current Branch」が **main** になっていることを確認します。

### 方法B: ターミナル(gh コマンド)
```sh
brew install gh
gh auth login            # 画面の指示に従ってブラウザでログイン
cd ~/Documents
gh repo clone iwai-ddndn/v2t_app
```

---

## 3. Xcode プロジェクトを作って開く

ターミナルで次を実行します(保存先が違う場合は、パスを読み替えてください)。

```sh
cd ~/Documents/v2t_app/ios
xcodegen generate
open V2T.xcodeproj
```

Xcode が開き、左側に「V2T」プロジェクトが表示されれば OK です。

---

## 4. 署名(自分の Apple ID でアプリを作る設定)

1. Xcode → **Settings…**(⌘,)→ **Accounts** → 左下の「+」→ **Apple ID** を選び、サインインします。
2. Settings を閉じます。左側のファイル一覧で一番上の **V2T**(青いアイコン)をクリックします。
3. 中央で TARGETS の **V2T** を選び、**Signing & Capabilities** タブを開きます。
4. 次のように設定します。
   - **Automatically manage signing**: チェック ON
   - **Team**: 自分の名前(**Personal Team**)を選ぶ
   - **Bundle Identifier**: `com.example.v2t.meetingmemo` を、**世界で自分だけの名前**に変えます。
     - 例: `com.taro-iwai.v2t`(英小文字・数字・ハイフン・ドット)
     - `com.example...` のままだと「すでに使われている」というエラーになります。
5. 赤いエラーが消えれば OK です。

> 💡 後で `xcodegen generate` をやり直すと、この設定は元に戻ります。その場合は 4 の 4 番をもう一度行ってください。毎回の手間を省きたい場合は、`ios/project.yml` の `PRODUCT_BUNDLE_IDENTIFIER` を自分の名前に書き換えておくと、Bundle Identifier の入力が不要になります。

---

## 5. iPhone の準備(初回のみ)

1. iPhone を **USB ケーブルで Mac に接続**します。
   - iPhone に「このコンピュータを信頼しますか?」と出たら **信頼** を選び、パスコードを入力します。
2. **デベロッパモードを ON にします。**
   - iPhone の **設定 → プライバシーとセキュリティ → デベロッパモード** を ON にします。iPhone が再起動します。
   - 再起動後に「デベロッパモードをオンにしますか?」と聞かれたら **オンにする** を選びます。
   - 項目が見当たらないときは、先に 6 番の ▶ を一度押すと表示されることがあります。

---

## 6. iPhone にインストールする

1. Xcode の画面上部中央にある、実行先(デバイス名が表示されている部分)をクリックし、**自分の iPhone** を選びます。
2. 左上の **▶(Run)** ボタンを押します(または ⌘R)。
   - 初回はビルドに数分かかります。
   - Mac のキーチェーンのパスワードを聞かれたら、Mac のログインパスワードを入れて「常に許可」を選びます。
3. 初回は iPhone 側で「信頼されていないデベロッパ」と表示されて、アプリが起動しません。次の操作で開発元を信頼してください。
   - iPhone の **設定 → 一般 → VPNとデバイス管理** → 自分の Apple ID の「デベロッパApp」→ **信頼**
4. もう一度 ▶ を押すか、ホーム画面の **「会議メモ」** アイコンをタップします。

---

## 7. 初回の設定

1. アプリを開いて「● 開始」を押すと、**マイクの使用許可**を求められるので「許可」を選びます。
2. 右上の ⚙(歯車)で設定画面を開き、API キーを入力します。

### OpenAI の API キー(おすすめ)
1. https://platform.openai.com/api-keys にログインし、**Create new secret key** を押します。表示された `sk-...` をコピーします。
2. ChatGPT Pro の **API クレジット特典**を申請します。ChatGPT(Web 版)の **設定 → Billing(請求)→ API credits** から申請してください。
   - 特典クレジットの範囲内なら、文字起こしは実質無料です(1 時間で約 27 円相当)。
3. アプリの設定画面「OpenAI」の **APIキー** 欄に貼り付けます。

### Soniox の API キー(即時表示したい場合)
1. https://soniox.com でアカウントを作り、Console で API キーを発行します(残高のチャージが必要です)。
2. アプリの設定画面「Soniox」の **APIキー** 欄に貼り付けます。
3. 「モデル」欄の既定値は `stt-rt-v5` です。接続時にモデル名のエラーが出たら、Soniox のドキュメントにある最新のリアルタイム用モデル名に書き換えてください。

> 🔒 API キーは iPhone の **Keychain**(パスワードと同じ安全な保管場所)に、記録はアプリ内にのみ保存されます。サーバーには送られません。

3. 画面上部の切り替えで **OpenAI** か **Soniox** を選びます。

---

## 8. 使い方

| 操作 | 内容 |
|---|---|
| **● 開始 / ■ 停止** | 録音と文字起こしを開始・停止します。停止後に「● 再開」を押すと、同じ記録の続きになります。 |
| **◀ 30秒 / 1分 / 3分 / 5分** | その時点以降の発言を緑でハイライトし、そこまでスクロールします。「最新へ ↓」で元に戻ります。 |
| **🔊 聞き直す** | 直近 15 秒〜3 分の音声を再生します(録音は止まりません)。イヤホン推奨です。 |
| **🧠 要約** | 直近 3 分/5 分/10 分/全体を AI が要約します(OpenAI キーが必要。1 回 0.1 円前後)。 |
| ⚙ → **現在の記録を書き出す** | テキストとして共有(メモ・メール・AirDrop など)できます。 |
| ⚙ → **履歴に移して新規開始** | 今の記録を履歴に保存して、新しい会議用に空にします。 |

- OpenAI は **10〜20 秒ほど遅れて**まとめて表示されます。Soniox は 1〜2 秒で表示されます。
- 右上の「¥」は、その記録のおおよその API 費用です。

---

## 9. 動作確認チェックリスト(実機テスト用)

試した結果を教えてもらえれば、修正します。

- [ ] OpenAI で 3 分ほど話して、文字起こしが表示される
- [ ] Soniox で 3 分ほど話して、1〜2 秒で表示される
- [ ] **録音中に画面をロック**し、1〜2 分話してからロックを解除する → その間の発言が記録されている
- [ ] **録音中に別のアプリ**(Safari など)を開き、戻る → 記録が続いている
- [ ] 録音中に電話がかかってきた(または FaceTime で代用)→ 終話後に録音が再開する
- [ ] ◀ 1分 で、1 分前の発言にジャンプする
- [ ] 🔊 聞き直す で、直前の音声が聞こえる
- [ ] 🧠 要約 で、要約が表示される
- [ ] アプリを終了して開き直しても、記録が残っている
- [ ] 1 時間の会議でも止まらない(電池の減り方もメモしてもらえると助かります)

---

## 10. 困ったとき

| 症状 | 対処 |
|---|---|
| `xcodegen: command not found` | 1-2 をやり直します。Homebrew の「Next steps」のコマンドを実行していない可能性があります。ターミナルを開き直してください。 |
| Signing で「Failed to register bundle identifier」 | Bundle Identifier が他人と重複しています。別の名前に変えてください(4 の 4 番)。 |
| 「No Account for Team」「Signing requires a development team」 | 4 の 1 番(Apple ID の追加)と、Team の選択をやり直してください。 |
| 実行先に iPhone が出てこない | ケーブルを挿し直す、iPhone のロックを解除する、「信頼」を選ぶ。Xcode → Window → **Devices and Simulators** で認識されているか確認します。 |
| 「Developer Mode disabled」 | 5 の 2 番を行ってください。 |
| 「iOS ○○ is not installed」「Unsupported OS version」 | Xcode が iPhone の iOS より古いです。App Store で Xcode を更新し、Settings → Components で iOS をダウンロードしてください。 |
| 「信頼されていないデベロッパ」 | 6 の 3 番を行ってください。 |
| **1 週間後にアプリが開かなくなった** | 無料の Apple ID の 7 日制限です。iPhone を Mac につないで、Xcode で ▶ を押せば再び使えます(記録は残ります)。 |
| 「マイクが許可されていません」 | iPhone の 設定 → 会議メモ → マイク を ON にしてください。 |
| 「OpenAI 401」 | API キーが間違っています。貼り付け直してください。 |
| 「OpenAI 429」 | 残高・クレジット不足か、使いすぎの制限です。OpenAI の Billing を確認してください。 |
| 「Sonioxエラー …」/ すぐ切断される | API キー・残高・モデル名(7 の Soniox の 3 番)を確認してください。 |
| ビルドエラーが出た | エラー文をそのまま貼って教えてください。 |

---

## 11. アプリを更新するとき

コードが更新されたら、次の手順で入れ直します(記録と設定は残ります)。

1. GitHub Desktop で **Fetch origin → Pull origin** を押します(ターミナルの場合は `git pull`)。
2. 次を実行します。
   ```sh
   cd ~/Documents/v2t_app/ios
   xcodegen generate
   open V2T.xcodeproj
   ```
3. Signing の Team と Bundle Identifier が戻っていたら、設定し直します(4 番)。
4. iPhone をつないで ▶ を押します。

---

## 12. (任意)ずっと使う・他の人にも配る場合

1. https://developer.apple.com/programs/ で **Apple Developer Program**(年 $99)に登録します。
2. Xcode の Team を、登録したチーム(Personal Team ではない方)に変えます。
3. Xcode → Product → **Archive** → **Distribute App** → **TestFlight & App Store** の順に進み、App Store Connect にアップロードします。
4. App Store Connect の TestFlight で、テスターのメールアドレスを登録します。テスターは iPhone の TestFlight アプリからインストールできます(Mac 不要。有効期限は 90 日ごとの更新)。

> 他の人も使う場合、API キーはそれぞれの iPhone で入力します(キーは各端末内にのみ保存されます)。
