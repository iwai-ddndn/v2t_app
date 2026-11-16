export function fmtTime(sec: number): string {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const p = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}
export function toPlainText(segs: { t: number; text: string; speaker?: string | number | null }[], withTime = false): string {
  return segs.map((s) => `${withTime ? `[${fmtTime(s.t)}] ` : ''}${s.speaker != null ? `話者${s.speaker}: ` : ''}${s.text}`).join('\n');
}

export function fmtDuration(sec: number): string {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  if (h) return `${h}時間${m}分`;
  if (m) return `${m}分`;
  return `${sec}秒`;
}
export function fmtRange(sec: number): string {
  return sec < 60 ? `${sec}秒` : `${sec / 60}分`;
}
export function fmtYen(usd: number, yenPerUsd: number): string {
  const y = usd * yenPerUsd;
  return y < 1 && y > 0 ? '¥1未満' : `¥${Math.round(y).toLocaleString('ja-JP')}`;
}
export function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' });
}
