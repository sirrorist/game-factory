import Link from 'next/link';
import { Icon } from '@/components/icons.tsx';
import { buttonVariants } from '@/components/ui/button.tsx';

export default function NotFound() {
  return (
    <section className="flex flex-col items-start gap-4">
      <p className="font-mono text-sm text-muted-foreground">404</p>
      <h1 className="font-display text-3xl font-bold tracking-tight">Такой игры нет</h1>
      <p className="text-muted-foreground">Может, её ещё не собрали - или в адресе опечатка.</p>
      <Link href="/" className={buttonVariants({ size: 'sm' })}>
        <Icon name="back" />
        Вернуться в каталог
      </Link>
    </section>
  );
}
