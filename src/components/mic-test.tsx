import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Mic } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LevelMeter } from '@/components/level-meter';
import { openInput, Vad, type InputHandle, type InputSource } from '@/lib/audio';

/** 音声の取り込みテスト: 声(または PC の音)が「発話」として検出されるかを確かめる */
export function MicTest({ source }: { source: InputSource }) {
  const [level, setLevel] = useState<{ db: number; speech: boolean } | null>(null);
  const [running, setRunning] = useState(false);
  const [ok, setOk] = useState(false);
  const [error, setError] = useState('');
  const handle = useRef<InputHandle | null>(null);
  const speechFrames = useRef(0);

  const stop = async () => { await handle.current?.close(); handle.current = null; setRunning(false); setLevel(null); };
  useEffect(() => () => { handle.current?.close(); }, []);
  useEffect(() => { stop(); setOk(false); }, [source]);

  const start = async () => {
    setError(''); setOk(false); speechFrames.current = 0;
    const vad = new Vad();
    try {
      handle.current = await openInput((pcm) => {
        const v = vad.push(pcm);
        setLevel({ db: v.levelDb, speech: v.speech });
        if (v.speech && ++speechFrames.current >= 10) setOk(true);
      }, { source });
      setRunning(true);
    } catch (e) { setError((e as Error).message); }
  };

  return (
    <div className="grid gap-3 rounded-lg bg-muted p-4">
      <div className="flex items-center gap-3">
        <Mic className="size-5 shrink-0 text-primary" aria-hidden />
        <LevelMeter level={level} className="h-2" />
      </div>
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {error ? <span className="text-destructive">{error}</span>
          : ok ? <span className="inline-flex items-center gap-1 font-medium text-success"><CheckCircle2 className="size-4" />声を検出できました</span>
            : running ? '話すか、会議の音声を流してください。バーが紫になれば OK です。'
              : '録音前に、声が届くかを確かめられます。'}
      </p>
      <Button variant={running ? 'outline' : 'tonal'} onClick={running ? stop : start} className="justify-self-start">
        {running ? 'テストを終了' : 'テストする'}
      </Button>
    </div>
  );
}
