import * as React from 'react';
import { DropdownMenu as DM } from 'radix-ui';
import { cn } from '@/lib/utils';

// M3 Menu: surface-container・角 4〜8px・項目の高さ 48px
const DropdownMenu = DM.Root;
const DropdownMenuTrigger = DM.Trigger;

function DropdownMenuContent({ className, sideOffset = 4, ...props }: React.ComponentProps<typeof DM.Content>) {
  return (
    <DM.Portal>
      <DM.Content
        sideOffset={sideOffset}
        className={cn('z-50 min-w-[200px] overflow-hidden rounded-sm bg-popover py-2 text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0', className)}
        {...props}
      />
    </DM.Portal>
  );
}
function DropdownMenuItem({ className, variant, ...props }: React.ComponentProps<typeof DM.Item> & { variant?: 'destructive' }) {
  return (
    <DM.Item
      className={cn("relative flex h-12 cursor-default select-none items-center gap-3 px-3 text-sm outline-none data-[highlighted]:bg-accent data-[disabled]:opacity-38 [&_svg]:size-5 [&_svg]:text-muted-foreground",
        variant === 'destructive' && 'text-destructive [&_svg]:!text-destructive', className)}
      {...props}
    />
  );
}
function DropdownMenuSeparator({ className, ...props }: React.ComponentProps<typeof DM.Separator>) {
  return <DM.Separator className={cn('my-2 h-px bg-border', className)} {...props} />;
}

export { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator };
