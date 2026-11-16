# 文字起こし精度の改善(調査と実装)

> 調査日: 2026-11-16
> 想定する使い方: **PC のスピーカーから流れるオンライン会議の音声**を、iPhone のブラウザで録音して文字起こしする。

## 1. 症状と原因

| 症状 | 原因(コードを調べて判明したもの) |
|---|---|
| **文字起こしがそもそも反応しない** | 旧版は「音量が一定値(約 -38dBFS)未満なら無音」という**固定しきい値**で判定していた。スピーカー越しの声は小さいため、区間ごと「無音」と判定されて、**API に送られずに捨てられていた**。 |
| 精度が低い | (1) ブラウザ標準のノイズ抑制・エコー除去・自動音量調整が、スピーカーから出る声を「雑音・エコー」として削っていた。(2) 声が小さいまま API に送られていた。(3) 最大長(20秒)に達すると、単語の途中でも強制的に切れていた。(4) 固有名詞のヒントがなかった。(5) 区間を並列に送るため、「直前の発言」を文脈として渡せていなかった。 |
| 内蔵認識(無料)が反応しない | iPhone の Web Speech API は、遠くの小さな音声に弱い。アプリ側からは音量を調整できない。 |

## 2. 既存研究から分かったこと → 実装への反映

| 知見 | 出典 | 実装 |
|---|---|---|
| 1 チャンネルの音声強調(ノイズ抑制など)は、聞いた印象が良くなっても、**加工による歪み(アーティファクト)が音声認識の精度を下げる主因**になる。強調前の音を混ぜ戻すだけでも改善する。 | Iwamoto et al., *How Bad Are Artifacts?*, Interspeech 2022 / 続報 arXiv:2311.11599 | **ブラウザのノイズ抑制・エコー除去・自動音量調整を既定でオフ**にした(「マイク・加工なし」)。代わりに、**歪みを生まない処理だけ**を行う: 80Hz ハイパスと、区間内で一定のゲインによる音量正規化。 |
| Whisper 系のモデルは、無音や雑音から**定型文をでっち上げる**(「ご視聴ありがとうございました」など)。頻出フレーズの一覧(Bag of Hallucinations)での除去と、発話検出(VAD)による非音声の除外が有効。 | Barański et al., ICASSP 2025 (arXiv:2501.11378) / Koenecke et al., *Careless Whisper*, FAccT 2024 | **適応型 VAD** で、発話が 0.3 秒未満の区間は送らない。日本語の頻出フレーズを除去する。同じ語が 4 回以上ループする出力は 1 回にまとめる。発話がほぼ無い区間からの短い出力は捨てる。 |
| 雑音レベルは、「一定時間内の最小値」で推定するのが頑健(Minimum Statistics 法)。 | Martin, *Noise Power Spectral Density Estimation Based on Optimal Smoothing and Minimum Statistics*, IEEE TSAP 2001(古典的な手法) | ノイズフロア = 直近 5 秒の 100ms ごとの音量の最小値。「雑音 + 8dB」を超えたら発話とみなす。**部屋や音量に合わせてしきい値が自動で変わる**。 |
| 固定長で区切ると、単語の途中で切れて誤認識が増える。ストリーミング用 Whisper(Whisper-Streaming)は、確定した部分だけを出すことでこれを避けている。 | Macháček et al., *Turning Whisper into Real-Time Transcription System*, 2023 (arXiv:2307.14743) | 区切りは「発話の切れ目(0.4 秒の無音)」を優先する。最大長に達したら、**直近 3 秒で一番静かな位置**(息継ぎ)で切る。 |
| Whisper のプロンプトは「直前の書き起こし」を想定して学習されている。単語リストをそのままプロンプトに入れると、かえって悪化することがある。新しい gpt-transcribe には、用語ヒント専用の `keywords` がある。 | arXiv:2502.11572(Whisper の希少語認識)/ OpenAI Speech-to-text ガイド | **区間を順番に送り**、直前 200 文字の書き起こしを毎回プロンプトに渡す。**用語・固有名詞**の設定欄を追加した。gpt-transcribe には `keywords[]`、Soniox には `context.terms`、旧モデルには「直前の発言」の形でプロンプトの先頭に入れる。 |
| OpenAI は 2026 年 7 月に **GPT-Transcribe**($0.0045/分)を公開し、文字起こし用の推奨モデルとしている。whisper-1 と gpt-4o-transcribe は 2027 年 2 月に提供終了予定と報じられている。 | OpenAI 発表、Impress Watch、developersdigest | 既定のモデルを **gpt-transcribe** に変更した。保存済みの設定が旧既定(mini)だった場合も、自動で移行する。 |
| PC の音声は、ブラウザの画面共有 API(getDisplayMedia)で、**スピーカーを通さずにデジタルのまま**取り込める。タブの音声は Chrome 系の全 OS で使える。macOS のシステム音声は Chrome 141 以降かつ macOS 14.2 以降で使える。iPhone・Safari では使えない。 | addpipe.com の解説記事 ほか | 音源に「**PCの音声を直接**」と「PCの音声 + マイク」を追加した。 |

## 3. 使い方のおすすめ(精度が高い順)

1. **PC のブラウザ(Chrome / Edge)でこのアプリを開き、音源を「PCの音声を直接」にする**
   - 開始時に共有する画面を聞かれるので、会議のタブ(または画面全体)を選び、「音声を共有」をオンにしてください。
   - スピーカー → 空気 → マイクを通らないので、遠くの声・反響・部屋の雑音の影響を受けません。**最も精度が高い方法**です。
   - 自分の声も記録したいときは「PCの音声 + マイク」にします。
   - 画面はPCで見ることになります。iPhoneで見たい場合は、書き出した記録を送ってください。
2. **iPhone で録る場合**: 音源は「マイク・加工なし」(既定)にし、「小さい声を自動で大きくする」をオンにします。
   - **iPhone をスピーカーの近く(30cm 以内が目安)**に置きます。
   - PC の音量を少し大きめにします。ステータス行の**音量メーター**が、話しているときに**緑**になれば検出できています。灰色のままなら、音が小さすぎます。
   - 方式は **OpenAI(gpt-transcribe)か Soniox** にします。内蔵認識(無料)は、スピーカー越しの音声には向きません。
3. **用語・固有名詞**の欄に、参加者の名前・社名・製品名・専門用語を入れます(誤変換が多い語ほど効果があります)。

## 4. 効果の確かめ方

比較ページ(⚙ → 方式の比較検証ページへ)で、同じ録音に対して「**前処理あり**」と「**前処理なし**」を並べて実行できます。正解テキストを貼れば、CER(文字誤り率)で改善の幅が分かります。

> この作業環境からは OpenAI / Soniox の API に接続できないため、**実際の会議音声での CER の改善幅はまだ測っていません**。
> 次のことは、合成した音声の自動テストで確認済みです。
> - 旧版では捨てられていた音量(約 -48dBFS)の音声が検出され、送られること
> - 雑音だけの区間は送られないこと
> - 息継ぎの位置で区切られること
> - 音量の正規化と、誤出力の除去が正しく動くこと

## 出典
- Iwamoto et al., "How Bad Are Artifacts?: Analyzing the Impact of Speech Enhancement Errors on ASR", Interspeech 2022 — https://arxiv.org/abs/2201.06685
- "How does end-to-end speech recognition training impact speech enhancement artifacts?" — https://arxiv.org/abs/2311.11599
- Barański et al., "Investigation of Whisper ASR Hallucinations Induced by Non-Speech Audio", ICASSP 2025 — https://arxiv.org/abs/2501.11378
- Macháček, Dabre, Bojar, "Turning Whisper into Real-Time Transcription System" (Whisper-Streaming) — https://arxiv.org/abs/2307.14743
- "Improving Rare-Word Recognition of Whisper in Zero-Shot Settings" — https://arxiv.org/abs/2502.11572
- OpenAI, Speech to text guide(gpt-transcribe の `languages[]` / `keywords[]`)— https://developers.openai.com/api/docs/guides/speech-to-text
- GPT-Transcribe の発表と価格(Impress Watch)— https://www.watch.impress.co.jp/docs/news/2128822.html
- whisper-1 / gpt-4o-transcribe の提供終了予定 — https://www.developersdigest.tech/blog/whisper-1-gpt-4o-transcribe-deprecation
- Soniox WebSocket API(`context.terms`)— https://soniox.com/docs/api-reference/stt/websocket-api
- getDisplayMedia によるシステム音声の取り込み(macOS は Chrome 141 以降)— https://blog.addpipe.com/getdisplaymedia-allows-capturing-the-screen-with-system-sounds-on-chrome-on-macos/
