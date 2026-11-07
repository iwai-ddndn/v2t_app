// 直近の文字起こしを OpenAI で要約(数百〜数千トークン程度なので 1 回 0.1 円前後)
export async function summarize(text, settings) {
  const res = await fetch(`${settings.openaiBaseUrl || 'https://api.openai.com/v1'}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${settings.openaiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: settings.summaryModel || 'gpt-5-mini',
      messages: [
        { role: 'system', content: '会議の自動文字起こし(誤認識を含む)を読み、会議に途中参加・聞き逃した人がすぐ追いつけるよう日本語で要約する。出力: 1) 今話している話題(1行) 2) 直近の要点(箇条書き3〜6個) 3) 決定事項/宿題(あれば) 4) 自分に振られていそうな質問(あれば)。誤認識と思われる語は文脈で補正してよい。' },
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
