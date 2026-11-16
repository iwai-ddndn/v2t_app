import * as React from 'react';
import { cn } from '@/lib/utils';

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn('flex min-h-24 w-full rounded-sm border border-input bg-transparent px-4 py-3 text-base outline-none placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary', className)}
      {...props}
    />
  );
}
export { Textarea };
