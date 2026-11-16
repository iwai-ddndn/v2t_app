import * as React from 'react';
import { cn } from '@/lib/utils';

// M3 Outlined text field(高さ 56px)
function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn('h-14 w-full min-w-0 rounded-sm border border-input bg-transparent px-4 text-base outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary disabled:opacity-38 aria-invalid:border-destructive', className)}
      {...props}
    />
  );
}
export { Input };
