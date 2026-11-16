import * as React from 'react';
import { Progress as PP } from 'radix-ui';
import { cn } from '@/lib/utils';

// M3 Linear progress indicator(トラック 4px)
function Progress({ className, value, indicatorClassName, ...props }: React.ComponentProps<typeof PP.Root> & { indicatorClassName?: string }) {
  return (
    <PP.Root className={cn('relative h-1 w-full overflow-hidden rounded-full bg-secondary', className)} {...props}>
      <PP.Indicator className={cn('h-full w-full flex-1 rounded-full bg-primary transition-transform duration-100', indicatorClassName)}
        style={{ transform: `translateX(-${100 - (value || 0)}%)` }} />
    </PP.Root>
  );
}
export { Progress };
