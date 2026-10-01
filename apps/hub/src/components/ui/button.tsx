// Кнопка дизайн-системы: аркадная клавиша с бортиком (классы gf-btn в app/design.css).
// API прежний - variant и size, - чтобы ссылки-кнопки собирались через buttonVariants.

import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils.ts';

const VARIANT = {
  default: 'gf-btn--primary',
  secondary: '',
  outline: 'gf-btn--ghost',
  ghost: 'gf-btn--ghost',
  danger: 'gf-btn--danger',
} as const;

const SIZE = {
  default: '',
  sm: 'gf-btn--sm',
  lg: 'gf-btn--lg',
} as const;

export interface ButtonVariants {
  variant?: keyof typeof VARIANT | null;
  size?: keyof typeof SIZE | null;
}

export function buttonVariants({ variant, size }: ButtonVariants = {}): string {
  return cn('gf-btn', VARIANT[variant ?? 'default'], SIZE[size ?? 'default']);
}

export function Button({ className, variant, size, ...props }: ComponentProps<'button'> & ButtonVariants) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
