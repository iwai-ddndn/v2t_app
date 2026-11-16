import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** M3 Small top app bar(高さ 64px) */
export function TopAppBar({ title, onBack, actions, className, children }: {
  title?: ReactNode; onBack?: () => void; actions?: ReactNode; className?: string; children?: ReactNode;
}) {
  return (
    <header className={cn('pt-safe sticky top-0 z-20 bg-background', className)}>
      <div className="flex h-16 items-center gap-1 px-1">
        {onBack && (
          <Button variant="icon" size="icon" aria-label="戻る" onClick={onBack}><ArrowLeft /></Button>
        )}
        <div className={cn('min-w-0 flex-1', !onBack && 'pl-3')}>
          {typeof title === 'string' ? <h1 className="truncate text-[22px] leading-7">{title}</h1> : title}
        </div>
        {actions}
      </div>
      {children}
    </header>
  );
}
