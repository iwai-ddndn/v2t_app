import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const alertVariants = cva('relative grid w-full grid-cols-[auto_1fr] items-start gap-x-3 gap-y-0.5 rounded-md px-4 py-3 text-sm [&>svg]:size-5 [&>svg]:translate-y-0.5', {
  variants: {
    variant: {
      default: 'bg-secondary text-secondary-foreground',
      destructive: 'bg-error-container text-on-error-container',
      info: 'bg-primary-container text-on-primary-container',
    },
  },
  defaultVariants: { variant: 'default' },
});
function Alert({ className, variant, ...props }: React.ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return <div role="alert" className={cn(alertVariants({ variant }), className)} {...props} />;
}
function AlertTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('col-start-2 font-medium', className)} {...props} />;
}
function AlertDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('col-start-2 opacity-90 [&_p]:leading-relaxed', className)} {...props} />;
}
export { Alert, AlertTitle, AlertDescription };
