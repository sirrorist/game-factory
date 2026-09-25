import Link from 'next/link';
import { DownloadLink } from '@/components/download-link.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { buttonVariants } from '@/components/ui/button.tsx';
import { Card, CardContent, CardFooter } from '@/components/ui/card.tsx';
import { listGames } from '@/lib/catalog.ts';

// Реестр меняется после каждого `gf build` — страницу не кешируем.
export const dynamic = 'force-dynamic';

export default function CatalogPage() {
  const games = listGames();
  return (
    <section className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Игры</h1>
        <p className="text-sm text-muted-foreground">Играй прямо здесь или скачай архив и играй без интернета.</p>
      </div>
      {games.length === 0 ? (
        <p className="text-muted-foreground" data-testid="empty">
          Пока пусто: собери игры командой <code>pnpm games:build</code>.
        </p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="catalog">
          {games.map(({ entry, coverUrl, download }) => (
            <li key={entry.id} data-game-id={entry.id}>
              <Card className="flex h-full flex-col overflow-hidden">
                {coverUrl ? (
                  // Обычный <img>: обложку отдаёт служебный хост игр, оптимизатор Next тут лишний.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={coverUrl} alt="" width={320} height={180} className="aspect-video w-full bg-muted object-cover" />
                ) : (
                  <div className="aspect-video w-full bg-muted" />
                )}
                <CardContent className="flex-1">
                  <h2 className="font-medium">{entry.manifest.title}</h2>
                  {entry.manifest.description ? (
                    <p className="text-sm text-muted-foreground">{entry.manifest.description}</p>
                  ) : null}
                  <div className="flex flex-wrap gap-1">
                    {entry.manifest.tags.map((t) => (
                      <Badge key={t}>{t}</Badge>
                    ))}
                  </div>
                </CardContent>
                <CardFooter>
                  <Link href={`/games/${entry.id}`} className={buttonVariants({ size: 'sm' })}>
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
