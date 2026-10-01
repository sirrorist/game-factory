import Link from 'next/link';
import { DownloadLink } from '@/components/download-link.tsx';
import { Icon } from '@/components/icons.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { buttonVariants } from '@/components/ui/button.tsx';
import { Card, CardContent, CardCover, CardFooter } from '@/components/ui/card.tsx';
import { listGames } from '@/lib/catalog.ts';

// Реестр меняется после каждого `gf build` - страницу не кешируем.
export const dynamic = 'force-dynamic';

export default function CatalogPage() {
  const games = listGames();
  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Каталог</p>
        <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Игры</h1>
        <p className="max-w-prose text-muted-foreground">Играй прямо здесь или скачай архив и играй без интернета.</p>
      </div>
      {games.length === 0 ? (
        <p className="text-muted-foreground" data-testid="empty">
          Пока пусто: собери игры командой <code>pnpm games:build</code>.
        </p>
      ) : (
        <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3" data-testid="catalog">
          {games.map(({ entry, coverUrl, download }) => (
            <li key={entry.id} data-game-id={entry.id} className="flex">
              <Card className="w-full">
                <CardCover>
                  {coverUrl ? (
                    // Обычный <img>: обложку отдаёт служебный хост игр, оптимизатор Next тут лишний.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={coverUrl} alt="" width={320} height={180} />
                  ) : null}
                </CardCover>
                <CardContent>
                  <h2 className="gf-card__title">{entry.manifest.title}</h2>
                  {entry.manifest.description ? <p className="gf-card__desc">{entry.manifest.description}</p> : null}
                  <div className="gf-card__meta">
                    {entry.manifest.tags.map((t) => (
                      <Badge key={t}>{t}</Badge>
                    ))}
                    <Badge tone="version">v{entry.version}</Badge>
                  </div>
                </CardContent>
                <CardFooter>
                  <Link href={`/games/${entry.id}`} className={buttonVariants({ size: 'sm' })}>
                    <Icon name="play" />
                    Играть
                  </Link>
                  {download ? <DownloadLink url={download.url} bytes={download.bytes} /> : null}
                </CardFooter>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
