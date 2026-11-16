import * as React from 'react';
import { Tabs as TabsPrimitive } from 'radix-ui';
import { cn } from '@/lib/utils';

// M3 Primary tabs: 高さ 48px・選択中は primary の下線
const Tabs = TabsPrimitive.Root;
function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List className={cn('flex h-12 w-full border-b border-border', className)} {...props} />;
}
function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn("state-layer relative inline-flex flex-1 items-center justify-center gap-1.5 text-sm font-medium text-muted-foreground outline-none focus-visible:bg-accent data-[state=active]:text-primary after:!opacity-0 data-[state=active]:before:absolute data-[state=active]:before:inset-x-[20%] data-[state=active]:before:bottom-0 data-[state=active]:before:h-[3px] data-[state=active]:before:rounded-t-full data-[state=active]:before:bg-primary [&_svg]:size-[18px]", className)}
      {...props}
    />
  );
}
function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn('outline-none', className)} {...props} />;
}
export { Tabs, TabsList, TabsTrigger, TabsContent };
