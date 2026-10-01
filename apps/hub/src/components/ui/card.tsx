import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils.ts';

// Карточка-картридж: рифлёный верх (gf-card::before), обложка-наклейка, тело, действия.

export function Card({ className, ...props }: ComponentProps<'article'>) {
  return <article className={cn('gf-card', className)} {...props} />;
}

export function CardCover({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('gf-card__cover', className)} {...props} />;
}

export function CardContent({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('gf-card__body', className)} {...props} />;
}

export function CardFooter({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('gf-card__actions', className)} {...props} />;
}
