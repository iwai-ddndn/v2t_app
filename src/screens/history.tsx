import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ChevronRight, Copy, Flag, MoreVertical, Pencil, Search, Share2, Trash2, X, FileText } from 'lucide-react';
import { TopAppBar } from '@/components/top-app-bar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { TranscriptView, type TranscriptHandle } from '@/components/transcript-view';
import { fmtDate, fmtDuration, fmtTime, fmtYen, toPlainText } from '@/lib/format';
import { shareText } from '@/lib/share';
import { autoTitle, sessionUsd, useSessions, type Session } from '@/store/sessions';
import { useSettings } from '@/store/settings';
import { back, navigate } from '@/hooks/use-route';

export function HistoryScreen() {
  const history = useSessions((s) => s.history);
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const k = q.trim().toLowerCase();
    if (!k) return history;
    return history.filter((h) => (h.title + ' ' + h.segments.map((s) => s.text).join(' ')).toLowerCase().includes(k));
  }, [history, q]);

  return (
    <div className="min-h-dvh">
      <TopAppBar title="履歴" onBack={() => back('/')}>
        {history.length > 0 && (
          <div className="px-4 pb-3">
            <SearchField value={q} onChange={setQ} placeholder="記録を検索" />
          </div>
        )}
      </TopAppBar>
      <main className="mx-auto max-w-[720px] pb-16">
        {history.length === 0 ? (
          <div className="grid justify-items-center gap-3 px-6 pt-24 text-center">
            <FileText className="size-12 text-muted-foreground" aria-hidden />
            <p className="text-lg">まだ保存された記録はありません</p>
            <p className="text-sm text-muted-foreground">録音を一時停止して「終了して保存」を押すと、ここに残ります。</p>
          </div>
        ) : filtered.length === 0 ? (
          <p className="px-6 pt-16 text-center text-muted-foreground">「{q}」を含む記録はありません</p>
        ) : (
          <ul className="grid">
            {filtered.map((h) => (
              <li key={h.id}>
                <button type="button" onClick={() => navigate(`/history/${h.id}`)} className="state-layer flex w-full items-center gap-4 px-4 py-3 text-left">
                  <div className="grid min-w-0 flex-1 gap-0.5">
                    <span className="truncate text-base">{h.title || autoTitle(h)}</span>
                    <span className="flex items-center gap-2 text-sm text-muted-foreground">
                      <span>{fmtDate(h.createdAt)}</span>·<span>{fmtDuration(h.durationSec)}</span>
                      {h.flags.length > 0 && <span className="inline-flex items-center gap-0.5 text-primary"><Flag className="size-3.5" />{h.flags.length}</span>}
                    </span>
                    <span className="line-clamp-1 text-sm text-muted-foreground">{h.segments.at(-1)?.text}</span>
                  </div>
                  <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

export function HistoryDetailScreen({ id }: { id: string }) {
  const session = useSessions((s) => (s.current.id === id ? s.current : s.history.find((h) => h.id === id)));
  const yen = useSettings((s) => s.yenPerUsd);
  const [q, setQ] = useState('');
  const [searching, setSearching] = useState(false);
  const [rename, setRename] = useState(false);
  const list = useRef<TranscriptHandle>(null);
  if (!session) {
    return (
      <div className="min-h-dvh">
        <TopAppBar title="記録" onBack={() => navigate('/history')} />
        <p className="px-6 pt-16 text-center text-muted-foreground">この記録は見つかりませんでした</p>
      </div>
    );
  }
  const title = session.title || autoTitle(session);
  const segs = q.trim() ? session.segments.filter((s) => s.text.toLowerCase().includes(q.trim().toLowerCase())) : session.segments;

  const onDelete = () => {
    const removed: Session = session;
    useSessions.getState().remove(session.id);
    navigate('/history');
    toast('記録を削除しました', { action: { label: '元に戻す', onClick: () => useSessions.getState().restore(removed) } });
  };

  return (
    <div className="flex h-dvh flex-col">
      <TopAppBar
        onBack={() => back('/history')}
        title={
          <div className="min-w-0">
            <h1 className="truncate text-[22px] leading-7">{title}</h1>
            <p className="truncate text-xs text-muted-foreground">{fmtDate(session.createdAt)} · {fmtDuration(session.durationSec)} · {fmtYen(sessionUsd(session), yen)}</p>
          </div>
        }
        actions={<>
          <Button variant="icon" size="icon" aria-label="記録内を検索" onClick={() => setSearching((v) => !v)}><Search /></Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="icon" size="icon" aria-label="その他の操作"><MoreVertical /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={async () => { const r = await shareText(title, toPlainText(session.segments, true)); if (r === 'downloaded') toast('テキストを保存しました'); }}><Share2 />書き出す・共有</DropdownMenuItem>
              <DropdownMenuItem onSelect={async () => { await navigator.clipboard.writeText(toPlainText(session.segments, true)); toast('全文をコピーしました'); }}><Copy />全文をコピー</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setRename(true)}><Pencil />名前を変更</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={onDelete}><Trash2 />削除</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>}
      >
        {searching && (
          <div className="px-4 pb-3"><SearchField value={q} onChange={setQ} placeholder="この記録内を検索" autoFocus onClose={() => { setQ(''); setSearching(false); }} /></div>
        )}
        {session.flags.length > 0 && !q && (
          <div className="flex gap-2 overflow-x-auto px-4 pb-3" aria-label="印">
            {session.flags.map((f) => (
              <button key={f} type="button" onClick={() => list.current?.focusTime(f)}
                className="state-layer inline-flex h-8 shrink-0 items-center gap-1 rounded-sm border border-border px-3 text-sm text-primary">
                <Flag className="size-4" />{fmtTime(f)}
              </button>
            ))}
          </div>
        )}
      </TopAppBar>
      <TranscriptView ref={list} segments={segs} flags={q ? [] : session.flags} query={q}
        empty={<p className="pt-16 text-center text-muted-foreground">{q ? `「${q}」は見つかりませんでした` : '発言がありません'}</p>} />
      <RenameDialog open={rename} onOpenChange={setRename} session={session} />
    </div>
  );
}

function SearchField({ value, onChange, placeholder, autoFocus, onClose }: { value: string; onChange: (v: string) => void; placeholder: string; autoFocus?: boolean; onClose?: () => void }) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input type="search" aria-label={placeholder} value={value} autoFocus={autoFocus} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="h-12 rounded-full border-0 bg-muted pl-12 pr-12 focus-visible:ring-2" />
      {(value || onClose) && (
        <Button variant="icon" size="icon" className="absolute top-0 right-0" aria-label="検索を閉じる" onClick={() => (onClose ? onClose() : onChange(''))}><X /></Button>
      )}
    </div>
  );
}

function RenameDialog({ open, onOpenChange, session }: { open: boolean; onOpenChange: (v: boolean) => void; session: Session }) {
  const [v, setV] = useState(session.title || autoTitle(session));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>名前を変更</DialogTitle></DialogHeader>
        <div className="grid gap-2"><Label htmlFor="rename">タイトル</Label><Input id="rename" value={v} onChange={(e) => setV(e.target.value)} autoFocus /></div>
        <DialogFooter>
          <Button variant="text" onClick={() => onOpenChange(false)}>キャンセル</Button>
          <Button variant="text" onClick={() => { useSessions.getState().rename(session.id, v.trim()); onOpenChange(false); }}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
