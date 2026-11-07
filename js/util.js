export function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const p = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}
export function toPlainText(segs, withTime = false) {
  return segs.map((s) => `${withTime ? `[${fmtTime(s.t)}] ` : ''}${s.speaker != null ? `話者${s.speaker}: ` : ''}${s.text}`).join('\n');
}
