# デザイン方針(v2: 作り直し)

参考にしたもの: Material Design 3(以下 M3)のガイドライン。実装は shadcn/ui(React + Tailwind CSS + Radix UI)で行う。

## 1. 誰が・いつ・何のために使うか

- **場面**: オンライン会議や対面の会議の**最中**。メインの注意は会議に向いていて、スマホは**ちらっと見る**だけ。
- **一番の目的**: 「今なんて言った?」「さっきの話、何だっけ?」に**数秒で追いつく**こと。
- **制約**
  - 片手で操作する。
  - 画面を見る時間は短い。
  - 会議中なので、音や派手な動きは出さない。
  - 誤って停止しない。
- **副次的な目的**: 会議後に記録を読み返す・共有する。費用を把握する。

## 2. 設計原則

1. **ひと目で分かる(Glanceable)**
   - 最新の発言が一番下に大きく出る。古い発言は少し控えめにする。
   - 録音状態・経過時間・入力音量は、常に同じ場所に表示する。
2. **「追いつく」を主役にする**
   - 旧版の「巻き戻し」「聞き直し」「要約」は、どれも「直近 N 分に追いつく」という同じ目的の手段だった。
   - これを**1つの「追いつく」シート**に統合した。範囲(30秒〜5分)を選び、「文字 / 要約 / 音声」をタブで切り替える。
3. **設定は会議の前に済ませる**
   - 初回は**セットアップ**(使い方 → 方式 → APIキー → マイクテスト)を案内する。
   - 会議中の画面からは、細かい設定を排除する。
4. **状態は嘘をつかない**
   - 声が届いていないときは、メーターと案内ではっきり伝える。
   - 費用はリアルタイムで表示する。
   - データの保存先(端末内のみ)を明示する。
5. **アクセシビリティ**
   - タッチ領域は 48px 以上(M3 / Android の推奨値)。
   - 文字のコントラストは 4.5:1 以上。
   - 文字サイズは調整できる。
   - `prefers-reduced-motion` で動きを止める。
   - 書き起こしは `aria-live` で読み上げに対応する。

## 3. 情報設計(画面構成)

```
録音(ホーム)
 ├─ 追いつくシート(ボトムシート)  … 範囲: 30秒/1分/3分/5分 × タブ: 文字/要約/音声
 ├─ 方式の切り替えシート(ボトムシート)
 ├─ 一時停止中のスナックバー(再開 / 終了して保存)
 ├─ 履歴 ─ 記録の詳細(検索・印・書き出し・削除)
 └─ 設定 ─ 文字起こし / 音声入力 / APIキー / 表示 / 詳細 / データ / ラボ(比較検証)
初回のみ: セットアップ(4ステップ)
```

| 旧版 | 新版 | 理由 |
|---|---|---|
| ◀30秒〜5分のボタンが4つ並び、その下に「聞き直す / 開始 / 要約」 | 下部バーは **[追いつく] [● 録音] [印をつける]** の3つだけ | 会議中に押すボタンを減らす。追いつく系の操作は、シートの中にまとめた |
| 聞き直し・要約は別々のダイアログ | 「追いつく」シートのタブ | 同じ範囲の「文字・要約・音声」を行き来できる |
| 方式はヘッダーのプルダウン | 方式を表すチップ → 切り替えシート | 説明(費用・遅延・精度)を見ながら選べる。録音中は変更不可 |
| 設定は1つの長いダイアログ | 全画面の設定ページ。カードで分類し、詳細設定は折りたたむ | 段階的な開示。頻度の低い項目は下・奥に置く |
| 比較検証は別ページへのリンク | 設定 → ラボ | 一般の利用者には不要な機能なので、奥に置く |
| 記録の消去 = 履歴へ移動 | 停止 → 「終了して保存」で履歴へ。新しい記録が始まる | 会議1回 = 記録1件という、分かりやすい単位にする |
| (なし) | **印をつける** | 「ここ大事」を1タップで残し、あとで履歴から飛べる |

## 4. 主要な操作の流れ

**録音**
1. 録音ボタン(Extended FAB「録音開始」)を押す。
2. 録音中は、ボタンが停止ボタンに変わり、上部に「● REC 12:34」が表示される。
3. 停止を押すと一時停止になり、スナックバーで「再開」「終了して保存」を選べる。
4. 終了したら履歴に保存され、ホームは空の新しい記録になる。

**追いつく**
1. 下部の「追いつく」を押すとシートが開く。範囲の初期値は前回選んだもの(既定は 1分)。
2. 「文字」タブ: その範囲の書き起こしを大きな文字で表示する。「この位置へ」を押すと、本体の一覧をその位置にスクロールしてハイライトする。
3. 「要約」タブ: 開いたときに自動で要約する(OpenAI キーがある場合)。結果は範囲と内容が同じ間はキャッシュする。
4. 「音声」タブ: 直近の音声を、音量をそろえて再生する(OpenAI / Soniox で録音している場合のみ)。

**スクロールと自動追従**
- 一覧を上にスクロールしたら、自動追従を止める。
- そのとき「↓ 最新へ」(小さな FAB)を出す。押すと追従を再開する。

## 5. M3 → shadcn/ui の対応

| M3 | 実装 |
|---|---|
| Top app bar(small) | `header`。アイコンボタンは 48px |
| Extended FAB / FAB | `Button`(size `fab`)。角は丸く(full)、影は Elevation 3 相当 |
| Bottom app bar | 下部の固定バー(`surface-container`)。Safe Area に対応 |
| Modal bottom sheet | `Drawer`(Vaul)。上の角は 28px、ドラッグハンドルあり |
| Segmented button | `ToggleGroup` |
| Tabs(primary) | `Tabs` |
| Assist chip | `Badge` 風のボタン |
| Snackbar | `Sonner`(下部・アクション付き) |
| Switch / Radio / Slider / Text field | `Switch` / `RadioGroup` / `Slider` / `Input`・`Textarea` |
| Linear progress | 入力音量メーター。発話を検出中は primary 色 |
| Cards(filled / outlined) | `Card`(設定のグループ、方式の選択肢) |

## 6. デザイントークン

- **カラー**: M3 のベースラインのカラースキーム(ライト / ダーク)を、shadcn の CSS 変数に割り当てる。

  | shadcn | M3 |
  |---|---|
  | `background` | surface |
  | `card` | surface-container-low |
  | `muted` | surface-container-high |
  | `muted-foreground` | on-surface-variant |
  | `primary` | primary |
  | `secondary` | secondary-container |
  | `accent` | surface-container-highest |
  | `border` | outline-variant |
  | `destructive` | error |

  - 録音中の表示には error 系の色を使う。
  - テーマは OS の設定に従う。設定で固定もできる。
- **形(角丸)**: 小 8px、中 12px、大 16px、特大 28px(シート)。ボタンとチップは full(完全な丸み)。
- **文字**
  - 書き起こし本文は Body Large を基準にする(既定 18px、14〜28px の範囲で調整可)。
  - 時刻は Label Small(等幅数字)。
  - 画面タイトルは Title Large。
- **動き**
  - 標準: `cubic-bezier(0.2, 0, 0, 1)`、200ms。
  - 強調(シートの登場など): `cubic-bezier(0.05, 0.7, 0.1, 1)`、400ms。
  - `prefers-reduced-motion` のときは動きを止める。
- **状態レイヤー**: hover は 8%、押下は 10% の重ね色。フォーカスリングは primary 色。

## 7. 参考にした資料
- M3 のトップアプリバーの種類(Jetpack Compose Material 3 API リファレンス): https://developer.android.com/reference/kotlin/androidx/compose/material3/package-summary
- 最重要のアクションには FAB を使う(Android のレイアウトとナビゲーションのパターン): https://developer.android.google.cn/design/ui/mobile/guides/layout-and-content/layout-and-nav-patterns?hl=en
- タッチ領域 48×48dp・間隔 8dp、コントラスト 4.5:1 / 3:1: https://support.google.com/accessibility/android/answer/7101858 ・ https://developer.android.com/design/ui/mobile/guides/foundations/accessibility
- shadcn/ui の Vite + Tailwind v4 での導入、Radix の統合パッケージ、Sonner / Drawer(Vaul): https://ui.shadcn.com/docs/changelog/2026-02-radix-ui ・ https://shadcnstudio.com/blog/how-to-set-up-shadcn-with-tailwind-4-using-vite/
