import * as React from 'react';
import { cn } from '@/lib/utils';

// M3 Filled card(surface-container-low)/ outlined は variant で
function Card({ className, variant = 'filled', ...props }: React.ComponentProps<'div'> & { variant?: 'filled' | 'outlined' }) {
  return (
    <div
      data-slot="card"
      className={cn('flex flex-col gap-4 rounded-lg py-5 text-card-foreground',
        variant === 'filled' ? 'bg-card' : 'border border-border bg-background', className)}
      {...props}
    />
  );
}
function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card-header" className={cn('grid gap-1 px-5', className)} {...props} />;
}
function CardTitle({ className, ...props }: React.ComponentProps<'h3'>) {
  return <h3 data-slot="card-title" className={cn('text-base font-semibold leading-snug', className)} {...props} />;
}
function CardDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return <p data-slot="card-description" className={cn('text-sm text-muted-foreground', className)} {...props} />;
}
function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card-content" className={cn('px-5', className)} {...props} />;
}
function CardFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card-footer" className={cn('flex items-center px-5', className)} {...props} />;
}

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter };
