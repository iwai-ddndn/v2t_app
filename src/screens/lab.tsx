import { useState } from 'react';
import { FileAudio, Loader2, Play, Plus, Trash2 } from 'lucide-react';
import { TopAppBar } from '@/components/top-app-bar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { decodeFileTo16k, Chunker, encodeWav, normalizeGain, TARGET_RATE, type ChunkMeta } from '@/lib/audio';
import { transcribeWav, MODELS, cleanup, parseGlossary } from '@/lib/engines/openai';
import * as Soniox from '@/lib/engines/soniox';
import { cer } from '@/lib/cer';
import { getSettings, useSettings } from '@/store/settings';
import { back } from '@/hooks/use-route';
import { cn } from '@/lib/utils';

interface Result { name: string; text: string; sec: number | null; usd: number; latency?: number; error?: boolean }
const KEY = 'v2t.lab';
const OPTIONS = [
  { id: 'openai:gpt-transcribe', label: 'gpt-transcribe', checked: true },
  { id: 'openai:gpt-transcribe:raw', label: 'gpt-transcribe(前処理なし)', checked: true },
  { id: 'openai:gpt-4o-transcribe', label: 'gpt-4o-transcribe' },
  { id: 'openai:gpt-4o-mini-transcribe', label: 'gpt-4o-mini-transcribe' },
  { id: 'soniox', label: 'Soniox', checked: true },
  { id: 'soniox:raw', label: 'Soniox(前処理なし)' },
];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function LabScreen() {
  const yen = useSettings((s) => s.yenPerUsd);
  const [pcm, setPcm] = useState<Int16Array | null>(null);
  const [fileInfo, setFileInfo] = useState('');
  const [ref, setRef] = useState('');
  const [picks, setPicks] = useState(() => new Set(OPTIONS.filter((o) => o.checked).map((o) => o.id)));
  const [results, setResults] = useState<Result[]>(() => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } });
  const [log, setLog] = useState('');
  const [running, setRunning] = useState(false);
  const [manual, setManual] = useState({ name: '', text: '' });

  const save = (r: Result[]) => { setResults(r); localStorage.setItem(KEY, JSON.stringify(r)); };
  const hours = pcm ? pcm.length / TARGET_RATE / 3600 : 0;

  const runOpenAI = async (model: string, raw: boolean): Promise<Omit<Result, 'name' | 'sec'>> => {
    const s = getSettings();
    const chunks: { p: Int16Array; m: ChunkMeta }[] = [];
    const ch = new Chunker({ minSec: s.chunkMin, maxSec: s.chunkMax, onChunk: (p, _st, m) => chunks.push({ p, m }) });
    for (let i = 0; i < pcm!.length; i += 1600) ch.push(pcm!.subarray(i, i + 1600));
    ch.flush();
    const out: string[] = []; const lat: number[] = []; let context = '';
    for (const [i, c] of chunks.entries()) {
      const t0 = performance.now();
      const text = await transcribeWav(encodeWav(raw ? c.p : normalizeGain(c.p)), {
        apiKey: s.openaiKey, model, lang: s.lang.slice(0, 2), prompt: context, keywords: raw ? [] : parseGlossary(s.glossary), baseUrl: s.openaiBaseUrl,
      });
      lat.push((performance.now() - t0) / 1000);
      const cleaned = raw ? text : cleanup(text, c.m);
      out.push(cleaned); context = (context + cleaned).slice(-200);
      setLog(`${model}: ${i + 1}/${chunks.length}`);
    }
    const sent = chunks.reduce((a, c) => a + c.p.length, 0) / TARGET_RATE;
    return { text: out.join('\n'), usd: (sent / 60) * MODELS[model].costPerMin, latency: lat.reduce((a, b) => a + b, 0) / Math.max(1, lat.length) };
  };

  const runSoniox = async (raw: boolean): Promise<Omit<Result, 'name' | 'sec'>> => {
    const base = getSettings();
    let text = '';
    const eng = Soniox.create(raw ? { ...base, normalize: false, glossary: '' } : base, {
      offset: 0, now: () => 0,
      onSegment: (s) => { text += `${s.speaker != null ? `話者${s.speaker}: ` : ''}${s.text}\n`; },
      onInterim: () => {}, onStatus: (m) => setLog(m), onError: (e) => setLog(e.message), onUsage: () => {},
    });
    await eng.start();
    for (let i = 0; i < pcm!.length; i += 1600) {
      eng.feed(pcm!.slice(i, i + 1600));
      if ((i / 1600) % 10 === 0) { setLog(`Soniox: ${Math.round((i / pcm!.length) * 100)}%`); await sleep(250); } // 約4倍速で送信
    }
    await eng.stop();
    return { text, usd: (pcm!.length / TARGET_RATE / 60) * eng.info.costPerMin };
  };

  const run = async () => {
    if (!pcm) return;
    setRunning(true);
    let acc = results;
    for (const id of OPTIONS.map((o) => o.id).filter((id) => picks.has(id))) {
      const raw = id.endsWith(':raw');
      const label = OPTIONS.find((o) => o.id === id)!.label;
      const t0 = performance.now();
      try {
        const s = getSettings();
        if (id.startsWith('openai:') && !s.openaiKey) throw new Error('OpenAI の API キーが未設定です');
        if (id.startsWith('soniox') && !s.sonioxKey) throw new Error('Soniox の API キーが未設定です');
        const r = id.startsWith('openai:') ? await runOpenAI(id.split(':')[1], raw) : await runSoniox(raw);
        acc = [...acc, { name: label, ...r, sec: (performance.now() - t0) / 1000 }];
      } catch (e) {
        acc = [...acc, { name: label, text: `エラー: ${(e as Error).message}`, sec: null, usd: 0, error: true }];
      }
      save(acc);
    }
    setLog('完了'); setRunning(false);
  };

  return (
    <div className="min-h-dvh">
      <TopAppBar title="ラボ: 方式の比較" onBack={() => back('/settings')} />
      <main className="mx-auto grid max-w-[720px] gap-4 px-4 pb-16">
        <Card>
          <CardHeader>
            <CardTitle>1. 録音ファイル</CardTitle>
            <CardDescription>ボイスメモで録った会議(.m4a など)を選びます。まずは 3〜5 分がおすすめです。</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            <Button variant="tonal" asChild className="justify-self-start">
              <label><FileAudio />ファイルを選ぶ
                <input type="file" accept="audio/*,video/*,.m4a,.mp3,.wav" className="sr-only" onChange={async (e) => {
                  const f = e.target.files?.[0]; if (!f) return;
                  setFileInfo('読み込み中…');
                  try { const p = await decodeFileTo16k(f); setPcm(p); setFileInfo(`${f.name}(${(p.length / TARGET_RATE / 60).toFixed(1)} 分)`); }
                  catch (err) { setFileInfo(`読み込めません: ${(err as Error).message}`); }
                }} />
              </label>
            </Button>
            {fileInfo && <p className="text-sm text-muted-foreground">{fileInfo}</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>2. 正解テキスト(任意)</CardTitle>
            <CardDescription>人が直した正解を貼ると、CER(文字誤り率。低いほど正確)を計算します。</CardDescription>
          </CardHeader>
          <CardContent><Textarea rows={4} value={ref} onChange={(e) => setRef(e.target.value)} aria-label="正解テキスト" /></CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>3. 比べる方式</CardTitle>
            <CardDescription>「前処理あり」はライブと同じ処理(発話検出・音量そろえ・用語ヒント・誤出力の除去)をかけた結果です。</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="flex flex-wrap gap-2">
              {OPTIONS.map((o) => {
                const on = picks.has(o.id);
                return (
                  <button key={o.id} type="button" aria-pressed={on}
                    onClick={() => setPicks((p) => { const n = new Set(p); if (on) n.delete(o.id); else n.add(o.id); return n; })}
                    className={cn('state-layer h-8 rounded-sm border px-3 text-sm', on ? 'border-transparent bg-secondary text-secondary-foreground' : 'border-border')}>
                    {o.label}
                  </button>
                );
              })}
            </div>
            <Button onClick={run} disabled={!pcm || running || picks.size === 0} className="justify-self-start">
              {running ? <Loader2 className="animate-spin" /> : <Play />}比較を実行
            </Button>
            {log && <p className="text-sm text-muted-foreground" aria-live="polite">{log}</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>手入力の結果を追加</CardTitle>
            <CardDescription>ファイルを入れられない方式(端末の音声認識・ボイスメモの文字起こしなど)の結果を貼って比べられます。</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="grid gap-2"><Label htmlFor="mname">方式の名前</Label><Input id="mname" value={manual.name} placeholder="例: ボイスメモ" onChange={(e) => setManual({ ...manual, name: e.target.value })} /></div>
            <Textarea rows={3} aria-label="認識結果" value={manual.text} placeholder="認識結果" onChange={(e) => setManual({ ...manual, text: e.target.value })} />
            <Button variant="outline" className="justify-self-start" disabled={!manual.text.trim()} onClick={() => { save([...results, { name: manual.name || '手入力', text: manual.text, sec: null, usd: 0 }]); setManual({ name: '', text: '' }); }}><Plus />結果に追加</Button>
          </CardContent>
        </Card>

        {results.length > 0 && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>結果</CardTitle>
              <Button variant="text" onClick={() => save([])}><Trash2 />クリア</Button>
            </CardHeader>
            <CardContent className="grid gap-3">
              {results.map((r, i) => {
                const c = ref.trim() && !r.error ? cer(ref, r.text) : NaN;
                return (
                  <details key={i} className="rounded-md border border-border" data-testid="lab-result">
                    <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
                      <span className="font-medium">{r.name}</span>
                      {!Number.isNaN(c) && <Badge variant={c < 0.1 ? 'secondary' : 'outline'} data-testid="cer">CER {(c * 100).toFixed(1)}%</Badge>}
                      {r.error && <Badge variant="destructive">エラー</Badge>}
                      <span className="text-xs text-muted-foreground">
                        {r.sec != null && `${r.sec.toFixed(1)}秒`}{r.latency != null && `(1区切り ${r.latency.toFixed(1)}秒)`}
                        {r.usd > 0 && hours > 0 && ` · 1時間 約${Math.round((r.usd / hours) * yen)}円`}
                      </span>
                    </summary>
                    <pre className="max-h-80 overflow-y-auto border-t border-border px-4 py-3 font-sans text-sm leading-relaxed whitespace-pre-wrap">{r.text}</pre>
                  </details>
                );
              })}
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
