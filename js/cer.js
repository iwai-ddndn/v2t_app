// 文字誤り率 (CER)。日本語は単語区切りが無いので WER より CER で比較するのが一般的。
export function normalize(s) {
  return (s || '').normalize('NFKC').replace(/[\s、。,.!?！？「」『』（）()・…ー\-―"'“”‘’:：;；]/g, '').toLowerCase();
}
export function editDistance(a, b) {
  const n = a.length, m = b.length;
  if (!n) return m; if (!m) return n;
  let prev = new Uint32Array(m + 1), cur = new Uint32Array(m + 1);
  for (let j = 0; j <= m; j++) prev[j] = j;
  for (let i = 1; i <= n; i++) {
    cur[0] = i; const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= m; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[m];
}
export function cer(ref, hyp) {
  const r = normalize(ref), h = normalize(hyp);
  if (!r.length) return NaN;
  return editDistance(r, h) / r.length;
}
