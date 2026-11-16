import * as React from 'react';
import { Switch as SwitchPrimitive } from 'radix-ui';
import { cn } from '@/lib/utils';

// M3 Switch: トラック 52×32・オンで thumb が大きくなる
function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn('peer inline-flex h-8 w-[52px] shrink-0 items-center rounded-full border-2 border-outline bg-accent transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=checked]:border-primary data-[state=checked]:bg-primary disabled:opacity-38', className)}
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block size-4 translate-x-[6px] rounded-full bg-outline transition-all duration-200 ease-standard data-[state=checked]:size-6 data-[state=checked]:translate-x-[22px] data-[state=checked]:bg-primary-foreground" />
    </SwitchPrimitive.Root>
  );
}
export { Switch };
