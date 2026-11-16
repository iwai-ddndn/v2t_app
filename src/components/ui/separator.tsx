import * as React from 'react';
import { Separator as SP } from 'radix-ui';
import { cn } from '@/lib/utils';

function Separator({ className, orientation = 'horizontal', decorative = true, ...props }: React.ComponentProps<typeof SP.Root>) {
  return (
    <SP.Root decorative={decorative} orientation={orientation}
      className={cn('shrink-0 bg-border', orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px', className)} {...props} />
  );
}
export { Separator };
