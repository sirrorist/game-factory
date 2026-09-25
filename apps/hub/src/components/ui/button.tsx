// Кнопка в духе shadcn/ui (реестр shadcn из среды агента недоступен — компонент написан по его образцу).

import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils.ts';

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        outline: 'border bg-transparent hover:bg-muted',
        ghost: 'hover:bg-muted',
      },
      size: {
        default: 'h-9 px-4',
        sm: 'h-8 px-3',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export type ButtonVariants = VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, ...props }: ComponentProps<'button'> & ButtonVariants) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
