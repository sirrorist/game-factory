import Link from 'next/link';
import { Icon } from '@/components/icons.tsx';
import { buttonVariants } from '@/components/ui/button.tsx';
import { FirstScreen } from '@/components/first-screen.tsx';

export default function NotFound() {
  return (
    <FirstScreen>
      <div className="gf-empty-state">
        <p className="font-mono text-sm text-muted-foreground">404</p>
        <h1 className="font-display text-3xl font-bold tracking-tight">Такой игры нет</h1>
        <p className="text-muted-foreground">Может, её ещё не собрали - или в адресе опечатка.</p>
        <Link href="/" className={buttonVariants({ size: 'sm' })}>
          <Icon name="back" />
          Вернуться в каталог
        </Link>
      </div>
    </FirstScreen>
  );
}
