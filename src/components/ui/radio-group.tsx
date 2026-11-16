import * as React from 'react';
import { RadioGroup as RG } from 'radix-ui';
import { cn } from '@/lib/utils';

function RadioGroup({ className, ...props }: React.ComponentProps<typeof RG.Root>) {
  return <RG.Root className={cn('grid gap-2', className)} {...props} />;
}
function RadioGroupItem({ className, ...props }: React.ComponentProps<typeof RG.Item>) {
  return (
    <RG.Item
      className={cn('aspect-square size-5 shrink-0 rounded-full border-2 border-muted-foreground outline-none focus-visible:ring-[6px] focus-visible:ring-ring/30 data-[state=checked]:border-primary disabled:opacity-38', className)}
      {...props}
    >
      <RG.Indicator className="flex items-center justify-center">
        <span className="size-2.5 rounded-full bg-primary" />
      </RG.Indicator>
    </RG.Item>
  );
}
export { RadioGroup, RadioGroupItem };
