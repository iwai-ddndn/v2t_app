import { useRecorder } from '@/store/recorder';
import { cn } from '@/lib/utils';

/** 入力音量メーター(M3 Linear progress)。発話を検出しているときは primary 色 */
export function LevelMeter({ className, level: given }: { className?: string; level?: { db: number; speech: boolean } | null }) {
  const live = useRecorder((s) => s.level);
  const level = given === undefined ? live : given;
  const pct = level ? Math.max(2, Math.min(100, ((level.db + 70) / 60) * 100)) : 0;
  return (
    <div
      className={cn('h-1 w-full overflow-hidden rounded-full bg-secondary', className)}
      role="meter" aria-label="入力音量" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}
      aria-valuetext={level ? (level.speech ? '声を検出中' : '小さい音') : '停止中'}
    >
      <div
        data-speech={level?.speech ? 'true' : 'false'}
        className={cn('h-full rounded-full transition-[width,background-color] duration-100 ease-linear', level?.speech ? 'bg-primary' : 'bg-outline')}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
