import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils.ts';

const TONE = { tag: '', version: 'gf-badge--version', live: 'gf-badge--live', new: 'gf-badge--new' } as const;

/** Метка: тег игры, версия (моноширинная), статус, NEW (классы gf-badge). */
export function Badge({ className, tone = 'tag', ...props }: ComponentProps<'span'> & { tone?: keyof typeof TONE }) {
  return <span className={cn('gf-badge', TONE[tone], className)} {...props} />;
}
