import { useEffect, useMemo, useRef, useState } from 'react';
import { AudioLines, FileText, Pause, Play, RefreshCw, Sparkles, ListEnd } from 'lucide-react';
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { SummaryView } from '@/components/summary-view';
import { fmtRange, fmtTime, toPlainText } from '@/lib/format';
import { playPcm } from '@/lib/audio';
import { summarize } from '@/lib/summary';
import { getRing, nowElapsed, useRecorder } from '@/store/recorder';
import { useSessions } from '@/store/sessions';
import { getSettings, useSettings } from '@/store/settings';
import { navigate } from '@/hooks/use-route';

const RANGES = [30, 60, 180, 300];
type Tab = 'text' | 'summary' | 'audio';

// 要約は「範囲 + 対象の発言数」が同じ間は再利用する
const summaryCache = new Map<string, string>();

/** 追いつくシート: 直近 N 秒の「文字 / 要約 / 音声」 */
export function CatchUpSheet({ open, onOpenChange, onShowInList }: {
  open: boolean; onOpenChange: (v: boolean) => void; onShowInList: (from: number) => void;
}) {
  const range = useSettings((s) => s.catchupRange);
  const setSettings = useSettings((s) => s.set);
  const segments = useSessions((s) => s.current.segments);
  const elapsed = useRecorder((s) => s.elapsed);
  const [tab, setTab] = useState<Tab>('text');
  // シートを開いた瞬間の時刻を基準にする(開いている間に範囲がずれないように)
  const [anchor, setAnchor] = useState(0);
  useEffect(() => { if (open) setAnchor(nowElapsed() || elapsed); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const from = Math.max(0, anchor - range);
  const inRange = useMemo(() => segments.filter((s) => s.t >= from - 0.01), [segments, from]);

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="h-[88dvh]" aria-describedby="catchup-desc">
        <DrawerHeader className="gap-3">
          <div>
            <DrawerTitle>追いつく</DrawerTitle>
            <DrawerDescription id="catchup-desc">直近 {fmtRange(range)}({fmtTime(from)} 〜 {fmtTime(anchor)})</DrawerDescription>
          </div>
          <ToggleGroup type="single" value={String(range)} aria-label="範囲"
            onValueChange={(v) => v && setSettings({ catchupRange: Number(v) })}>
            {RANGES.map((r) => <ToggleGroupItem key={r} value={String(r)}>{fmtRange(r)}</ToggleGroupItem>)}
          </ToggleGroup>
        </DrawerHeader>
        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="flex min-h-0 flex-1 flex-col">
          <TabsList className="px-2">
            <TabsTrigger value="text"><FileText />文字</TabsTrigger>
            <TabsTrigger value="summary"><Sparkles />要約</TabsTrigger>
            <TabsTrigger value="audio"><AudioLines />音声</TabsTrigger>
          </TabsList>
          <TabsContent value="text" className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            {inRange.length === 0
              ? <p className="py-10 text-center text-muted-foreground">この範囲にはまだ発言がありません</p>
              : (
                <div className="grid gap-3">
                  {inRange.map((s) => (
                    <p key={s.id} className="leading-relaxed" style={{ fontSize: 'calc(var(--transcript-size, 18px) * 1.05)' }}>
                      <time className="mr-2 align-[0.15em] text-xs text-muted-foreground tabular-nums">{fmtTime(s.t)}</time>
                      {s.speaker != null && <span className="mr-1 text-sm text-primary">話者{s.speaker}</span>}
                      {s.text}
                    </p>
                  ))}
                </div>
              )}
          </TabsContent>
          <TabsContent value="summary" className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            {open && tab === 'summary' && <SummaryPane text={toPlainText(inRange)} cacheKey={`${range}:${inRange.length}:${inRange.at(-1)?.id}`} />}
          </TabsContent>
          <TabsContent value="audio" className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            {open && tab === 'audio' && <AudioPane range={range} />}
          </TabsContent>
        </Tabs>
        <DrawerFooter className="border-t border-border">
          <Button variant="tonal" size="lg" onClick={() => { onOpenChange(false); onShowInList(from); }} disabled={inRange.length === 0}>
            <ListEnd />一覧でこの位置を表示
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

function SummaryPane({ text, cacheKey }: { text: string; cacheKey: string }) {
  const hasKey = useSettings((s) => !!s.openaiKey);
  const [state, setState] = useState<{ status: 'idle' | 'loading' | 'done' | 'error'; text: string }>(() => {
    const c = summaryCache.get(cacheKey);
    return c ? { status: 'done', text: c } : { status: 'idle', text: '' };
  });
  const run = async () => {
    setState({ status: 'loading', text: '' });
    try {
      const { text: out, usd } = await summarize(text, getSettings());
      summaryCache.set(cacheKey, out);
      useSessions.getState().addUsage('要約', { usd });
      setState({ status: 'done', text: out });
    } catch (e) {
      setState({ status: 'error', text: (e as Error).message });
    }
  };
  // タブを開いたら自動で要約する
  useEffect(() => {
    const c = summaryCache.get(cacheKey);
    if (c) setState({ status: 'done', text: c });
    else if (hasKey && text.trim()) run();
  }, [cacheKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!text.trim()) return <p className="py-10 text-center text-muted-foreground">この範囲にはまだ発言がありません</p>;
  if (!hasKey) {
    return (
      <Alert variant="info">
        <Sparkles />
        <AlertTitle>要約には OpenAI の API キーが必要です</AlertTitle>
        <AlertDescription>
          <p>1回あたり 0.1 円前後です。</p>
          <Button variant="text" className="-ml-3 mt-1" onClick={() => navigate('/settings')}>設定を開く</Button>
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <div className="grid gap-4">
      {state.status === 'loading' && (
        <div className="grid gap-3" aria-busy="true" aria-label="要約中">
          {[80, 95, 70, 88].map((w, i) => <div key={i} className="h-4 animate-pulse rounded-sm bg-muted" style={{ width: `${w}%` }} />)}
        </div>
      )}
      {state.status === 'done' && <SummaryView text={state.text} />}
      {state.status === 'error' && (
        <Alert variant="destructive"><AlertTitle>要約できませんでした</AlertTitle><AlertDescription>{state.text}</AlertDescription></Alert>
      )}
      {state.status !== 'loading' && (
        <Button variant="text" className="justify-self-start" onClick={run}><RefreshCw />もう一度要約</Button>
      )}
    </div>
  );
}

function AudioPane({ range }: { range: number }) {
  const ring = getRing();
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const audio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => { audio.current?.pause(); }, []);
  useEffect(() => { audio.current?.pause(); setPlaying(false); setProgress(0); }, [range]);

  if (!ring || !ring.filled) {
    return (
      <Alert>
        <AudioLines />
        <AlertTitle>聞き直せる音声がありません</AlertTitle>
        <AlertDescription>OpenAI か Soniox で録音しているときに、直近 {useSettings.getState().ringMinutes} 分までの音声を聞き直せます(端末の音声認識では使えません)。</AlertDescription>
      </Alert>
    );
  }
  const seconds = Math.min(range, ring.filled / ring.rate);
  const toggle = () => {
    if (playing) { audio.current?.pause(); setPlaying(false); return; }
    const a = playPcm(ring.last(range));
    audio.current = a;
    a.ontimeupdate = () => setProgress(a.duration ? a.currentTime / a.duration : 0);
    a.onended = () => { setPlaying(false); setProgress(1); };
    setPlaying(true);
  };
  return (
    <div className="grid justify-items-center gap-6 py-6">
      <Button size="fab-lg" variant={playing ? 'tonal' : 'default'} onClick={toggle} aria-label={playing ? '一時停止' : '再生'}>
        {playing ? <Pause /> : <Play />}
      </Button>
      <div className="grid w-full max-w-sm gap-2">
        <div className="h-1 w-full overflow-hidden rounded-full bg-secondary">
          <div className="h-full bg-primary transition-[width] duration-200" style={{ width: `${progress * 100}%` }} />
        </div>
        <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
          <span>{fmtTime(progress * seconds)}</span><span>{fmtTime(seconds)}</span>
        </div>
      </div>
      <p className="text-center text-sm text-muted-foreground">直近 {fmtRange(range)} の音声を、聞き取りやすい音量にそろえて再生します。<br />会議中はイヤホンをお使いください。録音は止まりません。</p>
    </div>
  );
}
