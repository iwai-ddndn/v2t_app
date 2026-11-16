import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { ChevronRight, Download, ExternalLink, Eye, EyeOff, FlaskConical, LogOut, Trash2 } from 'lucide-react';
import { TopAppBar } from '@/components/top-app-bar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EngineOptions } from '@/components/engine-options';
import { MicTest } from '@/components/mic-test';
import { MODELS } from '@/lib/engines/openai';
import { canCapturePcAudio, type InputSource } from '@/lib/audio';
import { toPlainText } from '@/lib/format';
import { useSettings, type Theme } from '@/store/settings';
import { useSessions } from '@/store/sessions';
import { useRecorder } from '@/store/recorder';
import { back, navigate } from '@/hooks/use-route';
import { downloadText } from '@/lib/share';
import { cn } from '@/lib/utils';

export function SettingsScreen() {
  const s = useSettings();
  const recording = useRecorder((r) => r.state === 'recording' || r.state === 'starting');
  const pcOk = canCapturePcAudio();

  return (
    <div className="min-h-dvh">
      <TopAppBar title="設定" onBack={() => back('/')} />
      <main className="mx-auto grid max-w-[720px] gap-4 px-4 pb-16">
        <Section title="文字起こし" description="会議の内容や費用に合わせて選べます。録音中は変更できません。">
          <EngineOptions value={s.engine} onChange={(v) => s.set({ engine: v })} disabled={recording} />
          {s.engine === 'openai' && (
            <Field label="OpenAI のモデル" htmlFor="model">
              <Select value={s.openaiModel} onValueChange={(v) => s.set({ openaiModel: v })} disabled={recording}>
                <SelectTrigger id="model"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(MODELS).map(([id, m]) => (
                    <SelectItem key={id} value={id} description={`$${m.costPerMin}/分(1時間 約${Math.round(m.costPerMin * 60 * s.yenPerUsd)}円)・${m.note}`}>{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          <Field label="用語・固有名詞" htmlFor="glossary" hint="参加者の名前・社名・製品名・専門用語など。「、」か改行で区切ります。認識のヒントとして使われます(端末の音声認識を除く)。">
            <Textarea id="glossary" rows={3} value={s.glossary} placeholder="例: 岩井、DDN、四半期レビュー、KPI" onChange={(e) => s.set({ glossary: e.target.value })} />
          </Field>
        </Section>

        <Section title="音声の取り込み" description={s.engine === 'webspeech' ? '端末の音声認識はマイク入力のみ対応です。' : undefined}>
          <RadioGroup value={s.inputSource} onValueChange={(v) => s.set({ inputSource: v as InputSource })} disabled={recording || s.engine === 'webspeech'} aria-label="音源">
            {([
              ['mic', 'マイク(加工なし)', 'スピーカーから流れる会議・会議室向け。おすすめ。'],
              ['mic-voice', 'マイク(ノイズ抑制あり)', '自分の声が中心で、周りがうるさいとき。'],
              ['pc', 'この PC の音声を直接', 'PC の Chrome / Edge で開いたとき。スピーカーを通さないので最も正確。', !pcOk],
              ['pc+mic', 'PC の音声 + マイク', '自分の声も一緒に記録したいとき。', !pcOk],
            ] as [InputSource, string, string, boolean?][]).map(([v, t, d, disabled]) => (
              <label key={v} htmlFor={`src-${v}`} className={cn('state-layer flex cursor-pointer gap-4 rounded-md px-2 py-3', disabled && 'cursor-not-allowed opacity-50')}>
                <RadioGroupItem id={`src-${v}`} value={v} disabled={disabled} className="mt-0.5" />
                <span className="grid gap-0.5">
                  <span className="text-base">{t}</span>
                  <span className="text-sm text-muted-foreground">{disabled ? 'スマホでは使えません(PC のブラウザで開いてください)' : d}</span>
                </span>
              </label>
            ))}
          </RadioGroup>
          <SwitchRow id="normalize" label="小さい声を自動で大きくする" hint="スピーカー越し・遠い席の声を聞き取りやすい音量にそろえてから送ります。" checked={s.normalize} onChange={(v) => s.set({ normalize: v })} />
          {!recording && s.engine !== 'webspeech' && <MicTest source={s.inputSource} />}
        </Section>

        <Section title="API キー" description="キーはこの端末のブラウザ内にだけ保存され、各社の API に直接送られます。">
          <SecretField id="openai-key" label="OpenAI" value={s.openaiKey} onChange={(v) => s.set({ openaiKey: v.trim() })} placeholder="sk-..."
            help={<a className="inline-flex h-12 items-center gap-1 text-primary underline-offset-4 hover:underline" href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">キーを発行する<ExternalLink className="size-3.5" /></a>}
            hint="ChatGPT Pro の API クレジット(ChatGPT の設定 → Billing で申請)の範囲なら実質無料です。" />
          <SecretField id="soniox-key" label="Soniox" value={s.sonioxKey} onChange={(v) => s.set({ sonioxKey: v.trim() })}
            help={<a className="inline-flex h-12 items-center gap-1 text-primary underline-offset-4 hover:underline" href="https://soniox.com" target="_blank" rel="noreferrer">アカウントを作る<ExternalLink className="size-3.5" /></a>} />
        </Section>

        <Section title="表示">
          <Field label={`文字の大きさ ${s.fontSize}px`} htmlFor="font">
            <Slider id="font" min={14} max={28} step={1} value={[s.fontSize]} onValueChange={([v]) => s.set({ fontSize: v })} aria-label="文字の大きさ" />
            <p className="rounded-md bg-muted px-3 py-2 leading-relaxed" style={{ fontSize: s.fontSize }}>来週までに見積もりを出します。</p>
          </Field>
          <Field label="テーマ">
            <ToggleGroup type="single" value={s.theme} onValueChange={(v) => v && s.set({ theme: v as Theme })} aria-label="テーマ">
              <ToggleGroupItem value="system">自動</ToggleGroupItem>
              <ToggleGroupItem value="light">ライト</ToggleGroupItem>
              <ToggleGroupItem value="dark">ダーク</ToggleGroupItem>
            </ToggleGroup>
          </Field>
        </Section>

        <Advanced />

        <DataSection />

        <Card>
          <button type="button" onClick={() => navigate('/lab')} className="state-layer flex items-center gap-4 px-5 py-1 text-left">
            <FlaskConical className="size-6 shrink-0 text-muted-foreground" aria-hidden />
            <span className="grid flex-1 gap-0.5">
              <span className="text-base">ラボ: 方式の比較検証</span>
              <span className="text-sm text-muted-foreground">同じ録音を複数の方式で文字起こしし、精度・速度・費用を比べます。</span>
            </span>
            <ChevronRight className="size-5 text-muted-foreground" aria-hidden />
          </button>
        </Card>
      </main>
    </div>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="grid gap-5">{children}</CardContent>
    </Card>
  );
}

function Field({ label, htmlFor, hint, children }: { label: string; htmlFor?: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function SwitchRow({ id, label, hint, checked, onChange }: { id: string; label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center gap-4">
      <label htmlFor={id} className="grid flex-1 gap-0.5">
        <span className="text-base">{label}</span>
        {hint && <span className="text-sm text-muted-foreground">{hint}</span>}
      </label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function SecretField({ id, label, value, onChange, placeholder, help, hint }: {
  id: string; label: string; value: string; onChange: (v: string) => void; placeholder?: string; help?: ReactNode; hint?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-2">
        <Label htmlFor={id}>{label}</Label>
        {value ? <Badge variant="secondary">設定済み</Badge> : <Badge variant="outline">未設定</Badge>}
        <span className="flex-1" />
        <span className="text-sm">{help}</span>
      </div>
      <div className="relative">
        <Input id={id} type={show ? 'text' : 'password'} autoComplete="off" spellCheck={false} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className="pr-14" />
        <Button variant="icon" size="icon" className="absolute top-1 right-1" aria-label={show ? 'キーを隠す' : 'キーを表示'} onClick={() => setShow(!show)}>
          {show ? <EyeOff /> : <Eye />}
        </Button>
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Advanced() {
  const s = useSettings();
  const num = (k: 'chunkMin' | 'chunkMax' | 'ringMinutes' | 'yenPerUsd', min: number, max: number) => (
    <Input type="number" inputMode="numeric" min={min} max={max} value={s[k]} onChange={(e) => {
      const v = Number(e.target.value); if (Number.isFinite(v)) s.set({ [k]: Math.min(max, Math.max(min, v)) });
    }} />
  );
  return (
    <Card className="py-0">
      <details className="group">
        <summary className="state-layer flex cursor-pointer list-none items-center gap-4 rounded-lg px-5 py-5">
          <span className="grid flex-1 gap-0.5">
            <span className="text-base font-semibold">詳細設定</span>
            <span className="text-sm text-muted-foreground">区切りの長さ・要約モデル・話者分離など</span>
          </span>
          <ChevronRight className="size-5 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden />
        </summary>
        <div className="grid gap-5 px-5 pb-5">
          <div className="grid grid-cols-2 gap-3">
            <Field label="区切り 最短(秒)">{num('chunkMin', 3, 30)}</Field>
            <Field label="区切り 最長(秒)">{num('chunkMax', 5, 60)}</Field>
          </div>
          <p className="-mt-3 text-xs text-muted-foreground">OpenAI に送る単位。短いほど早く表示され、長いほど文脈が増えて精度が上がります。</p>
          <Field label="要約のモデル" htmlFor="sum-model"><Input id="sum-model" value={s.summaryModel} onChange={(e) => s.set({ summaryModel: e.target.value.trim() })} /></Field>
          <Field label="Soniox のモデル" htmlFor="sx-model"><Input id="sx-model" value={s.sonioxModel} onChange={(e) => s.set({ sonioxModel: e.target.value.trim() })} /></Field>
          <SwitchRow id="diarize" label="話者を分ける(Soniox)" checked={s.diarize} onChange={(v) => s.set({ diarize: v })} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="聞き直し用の音声(分)">{num('ringMinutes', 1, 30)}</Field>
            <Field label="為替(円/ドル)">{num('yenPerUsd', 50, 400)}</Field>
          </div>
          <Field label="API Base URL(プロキシを使う場合のみ)" htmlFor="base"><Input id="base" value={s.openaiBaseUrl} placeholder="https://api.openai.com/v1" onChange={(e) => s.set({ openaiBaseUrl: e.target.value.trim() })} /></Field>
        </div>
      </details>
    </Card>
  );
}

function DataSection() {
  const current = useSessions((s) => s.current);
  const [confirm, setConfirm] = useState(false);
  return (
    <Section title="データとプライバシー" description="記録・設定・キーはこの端末のブラウザ内にだけ保存されます。サーバーには送られません(音声は選んだ文字起こしサービスにだけ送られます)。">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={!current.segments.length} onClick={() => downloadText(`会議メモ_${current.createdAt.slice(0, 10)}.txt`, toPlainText(current.segments, true))}>
          <Download />今の記録を書き出す
        </Button>
        <Button variant="outline" onClick={() => {
          localStorage.removeItem('v2t.gateKey'); sessionStorage.removeItem('v2t.gateKey');
          toast('この端末のログインを解除しました'); setTimeout(() => location.reload(), 600);
        }}>
          <LogOut />この端末からログアウト
        </Button>
      </div>
      <Separator />
      <Button variant="text" className="justify-self-start text-destructive" onClick={() => setConfirm(true)}><Trash2 />すべての記録と設定を削除</Button>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>すべて削除しますか?</DialogTitle>
            <DialogDescription>記録・履歴・API キー・設定がこの端末から消えます。元に戻せません。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="text" onClick={() => setConfirm(false)}>キャンセル</Button>
            <Button variant="text" className="text-destructive" onClick={() => {
              Object.keys(localStorage).filter((k) => k.startsWith('v2t.') && k !== 'v2t.gateKey').forEach((k) => localStorage.removeItem(k));
              location.hash = '/'; location.reload();
            }}>削除する</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Section>
  );
}
