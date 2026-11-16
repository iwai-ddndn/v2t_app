import { forwardRef, Fragment, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown, Flag, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { fmtTime } from '@/lib/format';
import type { Segment } from '@/store/sessions';
import { cn } from '@/lib/utils';

export interface TranscriptHandle {
  /** from 秒以降をハイライトして、その位置までスクロール */
  focusFrom: (from: number) => void;
  focusTime: (t: number) => void;
  toLatest: () => void;
}

interface Props {
  segments: Segment[];
  flags?: number[];
  interim?: string;
  pending?: number;
  live?: boolean;
  query?: string;
  empty?: React.ReactNode;
  className?: string;
}

/** 書き起こし一覧。下端にいる間は自動で追従し、上にスクロールしたら止めて「最新へ」を出す */
export const TranscriptView = forwardRef<TranscriptHandle, Props>(function TranscriptView(
  { segments, flags = [], interim, pending = 0, live, query, empty, className }, ref,
) {
  const scroller = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);
  const [highlightFrom, setHighlightFrom] = useState<number | null>(null);
  const [unseen, setUnseen] = useState(0);
  const lastCount = useRef(segments.length);

  const scrollToEnd = (smooth = false) => {
    const el = scroller.current; if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  };

  useLayoutEffect(() => {
    const added = segments.length - lastCount.current;
    lastCount.current = segments.length;
    if (follow) scrollToEnd();
    else if (added > 0) setUnseen((n) => n + added);
  }, [segments.length, interim, pending, follow]);

  const onScroll = () => {
    const el = scroller.current; if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    if (atBottom !== follow) setFollow(atBottom);
    if (atBottom) setUnseen(0);
  };

  const scrollToTime = (t: number) => {
    const el = scroller.current; if (!el) return;
    const rows = [...el.querySelectorAll<HTMLElement>('[data-t]')];
    const target = rows.find((r) => Number(r.dataset.t) >= t - 0.01) || rows.at(-1);
    if (!target) return;
    setFollow(false);
    // 区切りの途中から始まっている可能性があるので、1 つ前の行から見せる
    const prev = rows[rows.indexOf(target) - 1] || target;
    el.scrollTo({ top: prev.offsetTop - 8, behavior: 'smooth' });
  };

  useImperativeHandle(ref, () => ({
    focusFrom: (from) => { setHighlightFrom(from); requestAnimationFrame(() => scrollToTime(from)); },
    focusTime: (t) => { setHighlightFrom(null); requestAnimationFrame(() => scrollToTime(t)); },
    toLatest: () => { setHighlightFrom(null); setFollow(true); setUnseen(0); scrollToEnd(true); },
  }));

  // 印を時刻の位置に差し込む
  const rows: ({ kind: 'seg'; seg: Segment } | { kind: 'flag'; t: number })[] = [];
  let fi = 0;
  const sortedFlags = [...flags].sort((a, b) => a - b);
  for (const seg of segments) {
    while (fi < sortedFlags.length && sortedFlags[fi] <= seg.t) rows.push({ kind: 'flag', t: sortedFlags[fi++] });
    rows.push({ kind: 'seg', seg });
  }
  while (fi < sortedFlags.length) rows.push({ kind: 'flag', t: sortedFlags[fi++] });

  const q = query?.trim();
  const recentFrom = segments.length - 3;

  return (
    <div className={cn('relative min-h-0 flex-1', className)}>
      <div ref={scroller} onScroll={onScroll} className="h-full overflow-y-auto overscroll-contain px-4 pb-6" data-testid="transcript">
        {segments.length === 0 && !interim && !pending ? empty : (
          <div role="log" aria-live="polite" aria-relevant="additions" className="mx-auto flex max-w-[720px] flex-col gap-1 pt-2">
            {rows.map((r, i) => r.kind === 'flag' ? (
              <div key={`f${r.t}-${i}`} data-flag={r.t} className="my-1 flex items-center gap-2 text-xs font-medium text-primary">
                <Flag className="size-4 fill-current" aria-hidden />
                <span>印 {fmtTime(r.t)}</span>
                <span className="h-px flex-1 bg-primary/30" />
              </div>
            ) : (
              <Fragment key={r.seg.id}>
                <SegmentRow
                  seg={r.seg}
                  highlighted={highlightFrom != null && r.seg.t >= highlightFrom - 0.01}
                  dim={live && segments.indexOf(r.seg) < recentFrom}
                  query={q}
                />
              </Fragment>
            ))}
            {(interim || pending > 0) && (
              <div className="flex items-start gap-3 rounded-md px-2 py-1.5 text-muted-foreground" aria-live="off">
                <span className="w-12 shrink-0 pt-[0.35em] text-xs tabular-nums">
                  <Loader2 className="size-3.5 animate-spin" aria-label="処理中" />
                </span>
                <p className="italic leading-relaxed" style={{ fontSize: 'calc(var(--transcript-size, 18px) * 0.95)' }}>
                  {interim || `文字起こし中…${pending > 1 ? `(${pending}件)` : ''}`}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
      {!follow && (segments.length > 0) && (
        <Button
          size="sm" variant="tonal"
          className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 shadow-md"
          onClick={() => { setHighlightFrom(null); setFollow(true); setUnseen(0); scrollToEnd(true); }}
        >
          <ArrowDown />{unseen > 0 ? `新しい発言 ${unseen}件` : '最新へ'}
        </Button>
      )}
    </div>
  );
});

function SegmentRow({ seg, highlighted, dim, query }: { seg: Segment; highlighted: boolean; dim?: boolean; query?: string }) {
  return (
    <div
      data-t={seg.t}
      data-highlighted={highlighted || undefined}
      className={cn('flex items-start gap-3 rounded-md px-2 py-1.5 transition-colors duration-300',
        highlighted && 'bg-primary-container/60 text-on-primary-container')}
    >
      <time className="w-12 shrink-0 pt-[0.4em] text-xs text-muted-foreground tabular-nums">{fmtTime(seg.t)}</time>
      <div className="min-w-0 flex-1">
        {seg.speaker != null && <div className="text-xs font-medium text-primary">話者{seg.speaker}</div>}
        <p
          className={cn('leading-relaxed break-words transition-opacity', dim && !highlighted && 'opacity-75')}
          style={{ fontSize: 'var(--transcript-size, 18px)' }}
        >
          {query ? <Highlight text={seg.text} query={query} /> : seg.text}
        </p>
      </div>
    </div>
  );
}

function Highlight({ text, query }: { text: string; query: string }) {
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
  return <>{parts.map((p, i) => (i % 2 ? <mark key={i} className="rounded-sm bg-primary-container px-0.5 text-on-primary-container">{p}</mark> : p))}</>;
}
