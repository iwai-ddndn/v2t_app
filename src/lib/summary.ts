// 直近の文字起こしを OpenAI で要約(数百〜数千トークン程度なので 1 回 0.1 円前後)
// 出力は見出しつきの短い Markdown 風テキスト(画面側で「## 」「- 」だけを解釈して表示する)
const SYSTEM = [
  '会議の自動文字起こし(誤認識を含む)を読み、聞き逃した人が10秒で追いつけるよう日本語で要約する。',
  '次の見出しをこの順で使い、該当がない見出しは省略する。各項目は1行・体言止め。',
  '## いまの話題\n(1行)',
  '## 要点\n- (3〜5個)',
  '## 決まったこと・宿題\n- ',
  '## あなたへの質問かも\n- (誰かに問いかけている発言)',
  '誤認識と思われる語は文脈で補正してよい。前置き・締めの文は書かない。',
].join('\n');
export interface SummarySettings { openaiKey: string; openaiBaseUrl?: string; summaryModel?: string }
export async function summarize(text: string, settings: SummarySettings): Promise<{ text: string; usd: number }> {
  const res = await fetch(`${settings.openaiBaseUrl || 'https://api.openai.com/v1'}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${settings.openaiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: settings.summaryModel || 'gpt-5-mini',
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: text.slice(-20000) },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  const u = j.usage || {};
  // 小型モデル相当の概算単価(入力 $0.25/1M, 出力 $2/1M)
  const usd = ((u.prompt_tokens || 0) * 0.25 + (u.completion_tokens || 0) * 2) / 1e6;
  return { text: j.choices?.[0]?.message?.content?.trim() || '(空の応答)', usd };
}
