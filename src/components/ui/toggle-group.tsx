import * as React from 'react';
import { ToggleGroup as TG } from 'radix-ui';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

// M3 Segmented button: 高さ 40px・outline・選択中は secondary-container + チェック
function ToggleGroup({ className, ...props }: React.ComponentProps<typeof TG.Root>) {
  return <TG.Root className={cn('inline-flex h-10 w-full overflow-hidden rounded-full border border-outline', className)} {...props} />;
}
function ToggleGroupItem({ className, children, ...props }: React.ComponentProps<typeof TG.Item>) {
  return (
    <TG.Item
      className={cn('group state-layer flex min-w-0 flex-1 items-center justify-center gap-1 border-l border-outline px-2 text-sm font-medium first:border-l-0 outline-none focus-visible:bg-accent data-[state=on]:bg-secondary data-[state=on]:text-secondary-foreground', className)}
      {...props}
    >
      <Check className="hidden size-4 shrink-0 group-data-[state=on]:block" aria-hidden />
      <span className="truncate">{children}</span>
    </TG.Item>
  );
}
export { ToggleGroup, ToggleGroupItem };
