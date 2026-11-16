import * as React from 'react';
import { Slot } from 'radix-ui';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

// M3 のボタン: 角は full(pill)、高さ 40px(タッチ領域は 48px を確保)、状態レイヤーつき
const buttonVariants = cva(
  "state-layer inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium transition-[color,background-color,box-shadow,transform] duration-200 ease-standard outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-38 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[18px]",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground',
        tonal: 'bg-secondary text-secondary-foreground',
        destructive: 'bg-destructive text-destructive-foreground',
        outline: 'border border-outline bg-transparent text-primary',
        ghost: 'bg-transparent text-primary',
        text: 'bg-transparent text-primary px-3',
        icon: 'bg-transparent text-muted-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-10 px-6 has-[>svg]:px-4',
        sm: 'h-9 px-4 text-[13px]',
        lg: 'h-12 px-7 text-base',
        icon: 'size-12 [&_svg:not([class*=size-])]:size-6',
        fab: 'h-14 rounded-lg px-5 text-base shadow-[0_3px_6px_rgb(0_0_0/0.16),0_3px_12px_rgb(0_0_0/0.12)] [&_svg:not([class*=size-])]:size-6',
        'fab-lg': 'size-24 rounded-xl text-base shadow-[0_3px_6px_rgb(0_0_0/0.16),0_3px_12px_rgb(0_0_0/0.12)] [&_svg:not([class*=size-])]:size-9',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

function Button({
  className, variant, size, asChild = false, ...props
}: React.ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'button';
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { Button, buttonVariants };
