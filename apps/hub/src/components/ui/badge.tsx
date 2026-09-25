import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils.ts';

export function Badge({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      className={cn('inline-flex items-center rounded-sm bg-muted px-2 py-0.5 text-xs text-muted-foreground', className)}
      {...props}
    />
  );
}
