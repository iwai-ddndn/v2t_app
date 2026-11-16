import { useState, type ReactNode } from 'react';
import { ArrowLeft, Check, ExternalLink, MonitorSpeaker, Rewind, ShieldCheck, Smartphone, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { EngineOptions } from '@/components/engine-options';
import { MicTest } from '@/components/mic-test';
import { canCapturePcAudio, type InputSource } from '@/lib/audio';
import { useSettings } from '@/store/settings';
import { cn } from '@/lib/utils';

const STEPS = ['ようこそ', '方式', 'API キー', '音声'] as const;

/** 初回セットアップ(4 ステップ)。会議の前に一度だけ済ませる */
export function Onboarding() {
  const s = useSettings();
  const [step, setStep] = useState(0);
  const finish = () => s.set({ onboarded: true });
  const needsKey = s.engine === 'openai' ? !s.openaiKey : s.engine === 'soniox' ? !s.sonioxKey : false;
  const last = step === STEPS.length - 1;

  return (
    <div className="flex h-dvh flex-col">
      <header className="pt-safe">
        <div className="flex h-16 items-center gap-1 px-1">
          {step > 0
            ? <Button variant="icon" size="icon" aria-label="戻る" onClick={() => setStep(step - 1)}><ArrowLeft /></Button>
            : <span className="w-3" />}
          <div className="flex flex-1 gap-1.5" role="progressbar" aria-label="セットアップの進み具合" aria-valuemin={1} aria-valuemax={STEPS.length} aria-valuenow={step + 1}>
            {STEPS.map((_, i) => <span key={i} className={cn('h-1 flex-1 rounded-full transition-colors', i <= step ? 'bg-primary' : 'bg-secondary')} />)}
          </div>
          <Button variant="text" onClick={finish}>スキップ</Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[560px] flex-1 overflow-y-auto px-6 pb-6">
        {step === 0 && (
          <Step title="会議の「今なんて?」に、すぐ追いつく" lead="会議の声をその場で文字にして、聞き逃した直前の内容をワンタップで確認できます。">
            <ul className="grid gap-4">
              <Feature icon={<Sparkles />} title="リアルタイムで文字に" body="スマホを置いておくだけ。PC の会議音声を直接取り込むこともできます。" />
              <Feature icon={<Rewind />} title="「追いつく」で直前を確認" body="30 秒〜5 分前までの発言・AI 要約・音声を、すぐに見返せます。" />
              <Feature icon={<ShieldCheck />} title="記録は端末の中だけ" body="記録や API キーはこの端末にだけ保存されます。音声は選んだ文字起こしサービスにだけ送られます。" />
            </ul>
          </Step>
        )}
        {step === 1 && (
          <Step title="文字起こしの方式" lead="あとから設定で変えられます。迷ったら OpenAI がおすすめです。">
            <EngineOptions value={s.engine} onChange={(v) => s.set({ engine: v })} />
          </Step>
        )}
        {step === 2 && (
          <Step title="API キーの設定" lead={s.engine === 'webspeech' ? '端末の音声認識はキー不要です。このまま次へ進めます。' : 'キーはこの端末にだけ保存されます。'}>
            {s.engine === 'openai' && (
              <div className="grid gap-4">
                <ol className="grid list-decimal gap-2 pl-5 text-sm text-muted-foreground marker:text-primary">
                  <li><a className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline" href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">platform.openai.com/api-keys<ExternalLink className="size-3.5" /></a> を開き、ChatGPT と同じアカウントでログイン</li>
                  <li>「Create new secret key」→ 表示された <code className="rounded-sm bg-muted px-1">sk-…</code> をコピー</li>
                  <li>下に貼り付け</li>
                </ol>
                <div className="grid gap-2">
                  <Label htmlFor="ob-openai">OpenAI の API キー</Label>
                  <Input id="ob-openai" type="password" autoComplete="off" placeholder="sk-..." value={s.openaiKey} onChange={(e) => s.set({ openaiKey: e.target.value.trim() })} />
                </div>
                <Alert variant="info"><Sparkles /><AlertDescription>ChatGPT Pro の API クレジット(ChatGPT の設定 → Billing で申請)の範囲内なら、文字起こしは実質無料です。</AlertDescription></Alert>
              </div>
            )}
            {s.engine === 'soniox' && (
              <div className="grid gap-2">
                <Label htmlFor="ob-soniox">Soniox の API キー</Label>
                <Input id="ob-soniox" type="password" autoComplete="off" value={s.sonioxKey} onChange={(e) => s.set({ sonioxKey: e.target.value.trim() })} />
                <p className="text-sm text-muted-foreground"><a className="text-primary underline-offset-4 hover:underline" href="https://soniox.com" target="_blank" rel="noreferrer">soniox.com</a> でアカウントを作り、Console で発行します。</p>
              </div>
            )}
          </Step>
        )}
        {step === 3 && (
          <Step title="音声の取り込み" lead="会議の音をどこから取るかを選び、声が届くか確かめましょう。">
            <RadioGroup value={s.inputSource.startsWith('pc') ? 'pc' : 'mic'} onValueChange={(v) => s.set({ inputSource: v as InputSource })} className="gap-3" aria-label="音源">
              <SourceOption value="mic" icon={<Smartphone />} title="この端末のマイク" body="スマホを PC のスピーカーの近く(30cm 以内)に置きます。対面の会議もこちら。" selected={!s.inputSource.startsWith('pc')} />
              <SourceOption value="pc" icon={<MonitorSpeaker />} title="PC の音声を直接" body="この PC の Chrome / Edge で使う場合。スピーカーを通さないので最も正確です。" selected={s.inputSource.startsWith('pc')} disabled={!canCapturePcAudio() || s.engine === 'webspeech'} />
            </RadioGroup>
            {s.engine !== 'webspeech' && <MicTest source={s.inputSource} />}
          </Step>
        )}
      </main>

      <footer className="pb-safe mx-auto flex w-full max-w-[560px] flex-col gap-2 px-6 pt-2">
        {step === 2 && needsKey && <p className="text-center text-xs text-muted-foreground">キーはあとで設定することもできます</p>}
        <Button size="lg" onClick={() => (last ? finish() : setStep(step + 1))}>
          {last ? <><Check />はじめる</> : step === 0 ? 'セットアップを始める' : '次へ'}
        </Button>
      </footer>
    </div>
  );
}

function Step({ title, lead, children }: { title: string; lead: string; children: ReactNode }) {
  return (
    <section className="grid gap-6 pt-6">
      <div className="grid gap-2">
        <h1 className="text-[28px] leading-9">{title}</h1>
        <p className="text-muted-foreground">{lead}</p>
      </div>
      {children}
    </section>
  );
}

function Feature({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <li className="flex gap-4">
      <span className="grid size-12 shrink-0 place-items-center rounded-lg bg-primary-container text-on-primary-container [&_svg]:size-6">{icon}</span>
      <span className="grid gap-0.5"><span className="font-medium">{title}</span><span className="text-sm text-muted-foreground">{body}</span></span>
    </li>
  );
}

function SourceOption({ value, icon, title, body, selected, disabled }: { value: string; icon: ReactNode; title: string; body: string; selected: boolean; disabled?: boolean }) {
  return (
    <label htmlFor={`ob-src-${value}`} className={cn('state-layer flex cursor-pointer gap-4 rounded-lg border p-4', selected ? 'border-primary bg-primary-container/40' : 'border-border', disabled && 'cursor-not-allowed opacity-50')}>
      <RadioGroupItem id={`ob-src-${value}`} value={value} disabled={disabled} className="mt-0.5" />
      <span className="text-primary [&_svg]:size-6">{icon}</span>
      <span className="grid gap-0.5"><span className="font-medium">{title}</span><span className="text-sm text-muted-foreground">{disabled ? 'この端末・方式では使えません(PC の Chrome / Edge + OpenAI か Soniox)' : body}</span></span>
    </label>
  );
}
