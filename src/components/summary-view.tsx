/** 要約(「## 見出し」と「- 箇条書き」だけを解釈して表示) */
export function SummaryView({ text }: { text: string }) {
  const blocks: { title?: string; items: string[]; lines: string[] }[] = [];
  let cur = { items: [] as string[], lines: [] as string[] } as { title?: string; items: string[]; lines: string[] };
  blocks.push(cur);
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const h = line.match(/^#{1,3}\s*(.+)$/) || line.match(/^\d\)\s*(.+)$/);
    if (h) { cur = { title: h[1], items: [], lines: [] }; blocks.push(cur); continue; }
    const li = line.match(/^[-・*]\s*(.+)$/);
    if (li) cur.items.push(li[1]); else cur.lines.push(line);
  }
  return (
    <div className="grid gap-5">
      {blocks.filter((b) => b.title || b.items.length || b.lines.length).map((b, i) => (
        <section key={i} className="grid gap-1.5">
          {b.title && <h3 className="text-xs font-medium tracking-wide text-primary">{b.title}</h3>}
          {b.lines.map((l, j) => <p key={j} className="text-base leading-relaxed">{l}</p>)}
          {b.items.length > 0 && (
            <ul className="grid gap-1.5">
              {b.items.map((it, j) => (
                <li key={j} className="flex gap-2 text-base leading-relaxed">
                  <span aria-hidden className="mt-[0.7em] size-1.5 shrink-0 rounded-full bg-primary" />{it}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
