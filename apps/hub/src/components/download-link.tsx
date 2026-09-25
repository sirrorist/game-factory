import { buttonVariants, type ButtonVariants } from '@/components/ui/button.tsx';
import { cn, formatBytes } from '@/lib/utils.ts';

/** Архив отдаёт служебный хост игр с Content-Disposition: attachment — атрибут download не нужен (он и не работает между origin). */
export function DownloadLink({ url, bytes, variant = 'outline' }: { url: string; bytes: number } & ButtonVariants) {
  return (
    <a className={cn(buttonVariants({ variant, size: 'sm' }))} href={url} data-testid="download">
      Скачать · {formatBytes(bytes)}
    </a>
  );
}
