import { Check, KeyRound } from 'lucide-react';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Badge } from '@/components/ui/badge';
import { MODELS } from '@/lib/engines/openai';
import * as WebSpeech from '@/lib/engines/webspeech';
import type { EngineId } from '@/lib/engines/types';
import { useSettings } from '@/store/settings';
import { cn } from '@/lib/utils';

export interface EngineMeta {
  id: EngineId; name: string; summary: string; latency: string; accuracy: string; costPerHourUsd: (s: { openaiModel: string }) => number; needsKey?: 'openaiKey' | 'sonioxKey'; recommended?: boolean;
}

export const ENGINE_META: EngineMeta[] = [
  {
    id: 'openai', name: 'OpenAI', summary: '高精度。数秒〜20秒遅れでまとめて表示。ChatGPT Pro の API クレジットで実質無料。',
    latency: '10〜20秒', accuracy: '高', costPerHourUsd: (s) => (MODELS[s.openaiModel]?.costPerMin ?? 0.0045) * 60, needsKey: 'openaiKey', recommended: true,
  },
  {
    id: 'soniox', name: 'Soniox', summary: 'ほぼリアルタイム(1〜2秒)。日本語に強く単価も安い。別途アカウントが必要。',
    latency: '1〜2秒', accuracy: '高', costPerHourUsd: () => 0.12, needsKey: 'sonioxKey',
  },
  {
    id: 'webspeech', name: '端末の音声認識', summary: '無料・キー不要。スピーカー越しの音声や長時間の会議には弱い。聞き直し・PC音声は使えない。',
    latency: '即時', accuracy: '中', costPerHourUsd: () => 0,
  },
];

export function costLabel(usdPerHour: number, yen: number) {
  return usdPerHour === 0 ? '無料' : `1時間 約${Math.round(usdPerHour * yen)}円`;
}

/** 文字起こし方式の選択(M3 の選択カード) */
export function EngineOptions({ value, onChange, disabled }: { value: EngineId; onChange: (v: EngineId) => void; disabled?: boolean }) {
  const s = useSettings();
  return (
    <RadioGroup value={value} onValueChange={(v) => onChange(v as EngineId)} disabled={disabled} className="gap-3" aria-label="文字起こしの方式">
      {ENGINE_META.map((m) => {
        const unsupported = m.id === 'webspeech' && !WebSpeech.isSupported();
        const missingKey = m.needsKey && !s[m.needsKey];
        const selected = value === m.id;
        return (
          <label
            key={m.id}
            htmlFor={`engine-${m.id}`}
            className={cn('state-layer flex cursor-pointer gap-4 rounded-lg border p-4 transition-colors',
              selected ? 'border-primary bg-primary-container/40' : 'border-border',
              (disabled || unsupported) && 'cursor-not-allowed opacity-60')}
          >
            <RadioGroupItem id={`engine-${m.id}`} value={m.id} disabled={unsupported} className="mt-0.5" />
            <div className="grid min-w-0 flex-1 gap-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-base font-medium">{m.name}</span>
                {m.recommended && <Badge variant="secondary"><Check />おすすめ</Badge>}
                {missingKey && <Badge variant="outline"><KeyRound />キー未設定</Badge>}
                {unsupported && <Badge variant="outline">このブラウザは非対応</Badge>}
              </div>
              <p className="text-sm text-muted-foreground">{m.summary}</p>
              <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <div className="flex gap-1"><dt>費用</dt><dd className="font-medium text-foreground">{costLabel(m.costPerHourUsd(s), s.yenPerUsd)}</dd></div>
                <div className="flex gap-1"><dt>表示の遅れ</dt><dd className="font-medium text-foreground">{m.latency}</dd></div>
                <div className="flex gap-1"><dt>精度</dt><dd className="font-medium text-foreground">{m.accuracy}</dd></div>
              </dl>
            </div>
          </label>
        );
      })}
    </RadioGroup>
  );
}
