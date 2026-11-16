import * as React from 'react';
import { Select as SP } from 'radix-ui';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

const Select = SP.Root;
const SelectValue = SP.Value;

function SelectTrigger({ className, children, ...props }: React.ComponentProps<typeof SP.Trigger>) {
  return (
    <SP.Trigger
      className={cn('flex h-14 w-full items-center justify-between gap-2 rounded-sm border border-input bg-transparent px-4 text-left text-base outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary data-[placeholder]:text-muted-foreground [&>span]:truncate', className)}
      {...props}
    >
      {children}
      <SP.Icon asChild><ChevronDown className="size-5 text-muted-foreground" /></SP.Icon>
    </SP.Trigger>
  );
}
function SelectContent({ className, children, position = 'popper', ...props }: React.ComponentProps<typeof SP.Content>) {
  return (
    <SP.Portal>
      <SP.Content
        position={position}
        className={cn('relative z-50 max-h-[var(--radix-select-content-available-height)] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-sm bg-popover py-2 text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=open]:fade-in-0', position === 'popper' && 'translate-y-1', className)}
        {...props}
      >
        <SP.Viewport>{children}</SP.Viewport>
      </SP.Content>
    </SP.Portal>
  );
}
function SelectItem({ className, children, description, ...props }: React.ComponentProps<typeof SP.Item> & { description?: string }) {
  return (
    <SP.Item
      className={cn('relative flex min-h-12 cursor-default select-none flex-col justify-center py-2 pr-10 pl-4 text-sm outline-none data-[highlighted]:bg-accent data-[disabled]:opacity-38', className)}
      {...props}
    >
      <SP.ItemText>{children}</SP.ItemText>
      {description && <span className="text-xs text-muted-foreground">{description}</span>}
      <span className="absolute right-3 flex size-5 items-center justify-center">
        <SP.ItemIndicator><Check className="size-5 text-primary" /></SP.ItemIndicator>
      </span>
    </SP.Item>
  );
}
export { Select, SelectValue, SelectTrigger, SelectContent, SelectItem };
