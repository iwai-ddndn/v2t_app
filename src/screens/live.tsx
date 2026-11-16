import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  ChevronDown, Flag, History, Mic, MonitorSpeaker, Pause, Play, Settings, Square, Check, Rewind, Volume2, X, CircleAlert,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { TopAppBar } from '@/components/top-app-bar';
import { LevelMeter } from '@/components/level-meter';
import { TranscriptView, type TranscriptHandle } from '@/components/transcript-view';
import { CatchUpSheet } from '@/components/catch-up-sheet';
import { EngineOptions, ENGINE_META } from '@/components/engine-options';
import { fmtDate, fmtTime, fmtYen } from '@/lib/format';
import { MODELS } from '@/lib/engines/openai';
import { endSession, nowElapsed, useRecorder } from '@/store/recorder';
import { autoTitle, sessionUsd, useSessions } from '@/store/sessions';
import { useSettings } from '@/store/settings';
import { navigate } from '@/hooks/use-route';
import { cn } from '@/lib/utils';

export function LiveScreen() {
  const current = useSessions((s) => s.current);
  const rec = useRecorder();
  const settings = useSettings();
  const list = useRef<TranscriptHandle>(null);
  const [catchUp, setCatchUp] = useState(false);
  const [engineSheet, setEngineSheet] = useState(false);
  const [endDialog, setEndDialog] = useState(false);

  const recording = rec.state === 'recording';
  const busy = rec.state === 'starting' || rec.state === 'stopping';
  const paused = rec.state === 'paused' || (rec.state === 'idle' && current.durationSec > 0);
  const usd = sessionUsd(current) + rec.liveUsd;

  const engineLabel = (() => {
    const m = ENGINE_META.find((e) => e.id === settings.engine)!;
    return settings.engine === 'openai' ? `${m.name} · ${MODELS[settings.openaiModel]?.name ?? settings.openaiModel}` : settings.engine === 'soniox' ? `${m.name} · ${settings.sonioxModel}` : m.name;
  })();
  const SourceIcon = settings.engine !== 'webspeech' && settings.inputSource.startsWith('pc') ? MonitorSpeaker : Mic;

  const onFlag = () => {
    const t = nowElapsed();
    const added = useSessions.getState().toggleFlag(t);
    toast(added ? `${fmtTime(t)} に印をつけました` : '印を外しました', { duration: 2000 });
  };

  return (
    <div className="flex h-dvh flex-col">
      <TopAppBar
        title={
          <div className="min-w-0">
            <h1 className="truncate text-[22px] leading-7">{current.title || (current.segments.length || current.durationSec ? `${fmtDate(current.createdAt)} の記録` : '新しい記録')}</h1>
          </div>
        }
        actions={<>
          <Button variant="icon" size="icon" aria-label="履歴" onClick={() => navigate('/history')}><History /></Button>
          <Button variant="icon" size="icon" aria-label="設定" onClick={() => navigate('/settings')}><Settings /></Button>
        </>}
      >
        {/* 状態の行: 方式チップ / 録音状態 / 費用 */}
        <div className="flex h-12 items-center gap-2 px-4">
          <button
            type="button"
            onClick={() => setEngineSheet(true)}
            className="state-layer flex h-8 min-w-0 items-center gap-1.5 rounded-sm border border-border px-3 text-sm text-foreground"
            aria-label={`文字起こし方式: ${engineLabel}`}
          >
            <SourceIcon className="size-4 shrink-0 text-primary" aria-hidden />
            <span className="truncate">{engineLabel}</span>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          </button>
          <div className="flex-1" />
          <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground tabular-nums" title="この記録の推定 API 費用" aria-label={`推定費用 ${fmtYen(usd, settings.yenPerUsd)}`}>{fmtYen(usd, settings.yenPerUsd)}</span>
          <RecStatus state={rec.state} elapsed={rec.elapsed} hasContent={current.durationSec > 0} />
        </div>
        <div className="px-4 pb-1">
          <LevelMeter className={cn('transition-opacity', recording && settings.engine !== 'webspeech' ? 'opacity-100' : 'opacity-0')} />
        </div>
      </TopAppBar>

      <Notice />

      <TranscriptView
        ref={list}
        live={recording}
        segments={current.segments}
        flags={current.flags}
        interim={rec.interim}
        pending={rec.pending}
        empty={<EmptyState recording={recording || busy} />}
      />

      {/* M3 Bottom app bar: [追いつく] [録音 FAB] [印 / 終了] */}
      <nav aria-label="操作" className="pb-safe shrink-0 bg-surface-container">
        <div className="mx-auto grid h-24 max-w-[720px] grid-cols-[1fr_auto_1fr] items-center gap-2 px-4">
          <BarAction icon={<Rewind />} label="追いつく" onClick={() => setCatchUp(true)} disabled={current.segments.length === 0} />
          {recording || rec.state === 'stopping' ? (
            <Button size="fab" variant="destructive" className="min-w-36" onClick={() => rec.stop()} disabled={busy} aria-label="一時停止">
              <Pause className="fill-current" />一時停止
            </Button>
          ) : (
            <Button size="fab" className="min-w-36" onClick={() => rec.start()} disabled={busy}
              aria-label={paused ? '再開' : '録音を開始'}>
              {paused ? <Play className="fill-current" /> : <span className="size-4 rounded-full bg-current" aria-hidden />}
              {rec.state === 'starting' ? '準備中…' : paused ? '再開' : '録音開始'}
            </Button>
          )}
          {recording
            ? <BarAction icon={<Flag />} label="印をつける" onClick={onFlag} />
            : paused
              ? <BarAction icon={<Square />} label="終了して保存" onClick={() => setEndDialog(true)} disabled={busy} />
              : <div />}
        </div>
      </nav>

      <CatchUpSheet open={catchUp} onOpenChange={setCatchUp} onShowInList={(from) => list.current?.focusFrom(from)} />
      <EngineSheet open={engineSheet} onOpenChange={setEngineSheet} locked={recording || busy} />
      <EndDialog open={endDialog} onOpenChange={setEndDialog} />
    </div>
  );
}

function RecStatus({ state, elapsed, hasContent }: { state: string; elapsed: number; hasContent: boolean }) {
  if (state === 'recording') {
    return (
      <span className="inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-sm bg-error-container px-2.5 text-sm font-medium text-on-error-container tabular-nums" role="status" aria-label={`録音中 ${fmtTime(elapsed)}`}>
        <span className="size-2 animate-pulse rounded-full bg-destructive motion-reduce:animate-none" aria-hidden />REC {fmtTime(elapsed)}
      </span>
    );
  }
  if (state === 'paused' || (state === 'idle' && hasContent)) {
    return (
      <span className="inline-flex h-8 shrink-0 items-center gap-1 whitespace-nowrap rounded-sm bg-secondary px-2.5 text-sm text-secondary-foreground tabular-nums" role="status" aria-label={`一時停止中 ${fmtTime(elapsed)}`}>
        <Pause className="size-3.5 fill-current" aria-hidden />{fmtTime(elapsed)}
      </span>
    );
  }
  if (state === 'starting') return <span className="text-sm text-muted-foreground" role="status">準備中…</span>;
  return null;
}

/** 下部バーのアイコン+ラベル(M3 のナビゲーション項目と同じ 48px 以上のタッチ領域) */
function BarAction({ icon, label, onClick, disabled }: { icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button" onClick={onClick} disabled={disabled}
      className="state-layer flex h-16 min-w-16 flex-col items-center justify-center gap-1 justify-self-center rounded-lg px-3 text-xs font-medium text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-38 [&_svg]:size-6 [&_svg]:text-muted-foreground"
    >
      {icon}<span>{label}</span>
    </button>
  );
}

function EmptyState({ recording }: { recording: boolean }) {
  const source = useSettings((s) => s.inputSource);
  const engine = useSettings((s) => s.engine);
  if (recording) {
    return (
      <div className="mx-auto grid max-w-sm justify-items-center gap-3 pt-20 text-center">
        <Volume2 className="size-10 text-primary" aria-hidden />
        <p className="text-lg">聞き取り中…</p>
        <p className="text-sm text-muted-foreground">
          {engine === 'openai' ? '話し始めてから 10〜20 秒ほどで表示されます。' : '話し始めると表示されます。'}
          上の音量バーが<strong className="text-primary">紫</strong>になれば声が届いています。
        </p>
      </div>
    );
  }
  return (
    <div className="mx-auto grid max-w-sm justify-items-center gap-4 pt-16 text-center">
      <div className="grid size-20 place-items-center rounded-full bg-primary-container text-on-primary-container"><Mic className="size-9" aria-hidden /></div>
      <h2 className="text-2xl">会議の声を、その場で文字に</h2>
      <p className="text-muted-foreground">録音を開始すると、ここに発言が流れます。聞き逃したら下の<strong className="text-foreground">「追いつく」</strong>で直前の内容・要約・音声をすぐ確認できます。</p>
      <p className="rounded-md bg-secondary px-4 py-3 text-left text-sm text-secondary-foreground">
        {source.startsWith('pc')
          ? '開始すると共有する画面を聞かれます。会議のタブを選び「音声を共有」をオンにしてください。'
          : 'PC のスピーカーから流れる会議は、スマホをスピーカーの近く(30cm 以内)に置くと精度が上がります。'}
      </p>
    </div>
  );
}

function Notice() {
  const notice = useRecorder((s) => s.notice);
  const dismiss = useRecorder((s) => s.dismissNotice);
  if (!notice) return null;
  const content = notice.kind === 'quiet'
    ? { v: 'info' as const, t: '音がほとんど入っていません', d: 'スマホをスピーカーに近づけるか、PC の音量を上げてください。' }
    : notice.kind === 'share-ended'
      ? { v: 'destructive' as const, t: '音声の共有が終了しました', d: '一時停止してから、もう一度「再開」を押してください。' }
      : { v: 'destructive' as const, t: 'うまくいきませんでした', d: notice.message };
  return (
    <div className="px-4 pb-2">
      <Alert variant={content.v} className="pr-12">
        <CircleAlert />
        <AlertTitle>{content.t}</AlertTitle>
        <AlertDescription>{content.d}</AlertDescription>
        <Button variant="icon" size="icon" className="absolute top-0 right-0" aria-label="閉じる" onClick={dismiss}><X /></Button>
      </Alert>
    </div>
  );
}

function EngineSheet({ open, onOpenChange, locked }: { open: boolean; onOpenChange: (v: boolean) => void; locked: boolean }) {
  const engine = useSettings((s) => s.engine);
  const set = useSettings((s) => s.set);
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent aria-describedby="engine-desc">
        <DrawerHeader>
          <DrawerTitle>文字起こしの方式</DrawerTitle>
          <DrawerDescription id="engine-desc">{locked ? '録音中は変更できません。一時停止してから変更してください。' : '会議の内容や費用に合わせて選べます。'}</DrawerDescription>
        </DrawerHeader>
        <div className="overflow-y-auto px-6 pb-2">
          <EngineOptions value={engine} onChange={(v) => set({ engine: v })} disabled={locked} />
        </div>
        <DrawerFooter>
          <Button variant="text" onClick={() => { onOpenChange(false); navigate('/settings'); }}>モデル・音源・キーの設定</Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

function EndDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const current = useSessions((s) => s.current);
  const [title, setTitle] = useState('');
  useEffect(() => { if (open) setTitle(current.title || autoTitle(current)); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>記録を終了しますか?</DialogTitle>
          <DialogDescription>この記録は履歴に保存され、次の録音は新しい記録になります。</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="end-title">タイトル</Label>
          <Input id="end-title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </div>
        <DialogFooter>
          <Button variant="text" onClick={() => onOpenChange(false)}>キャンセル</Button>
          <Button variant="text" onClick={() => {
            if (title.trim()) useSessions.getState().rename(current.id, title.trim());
            const ended = endSession();
            onOpenChange(false);
            if (ended) toast('履歴に保存しました', { action: { label: '開く', onClick: () => navigate(`/history/${ended.id}`) } });
          }}><Check />終了して保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
