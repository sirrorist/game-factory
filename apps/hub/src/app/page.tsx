import Link from 'next/link';
import { DownloadLink } from '@/components/download-link.tsx';
import { Icon } from '@/components/icons.tsx';
import { CatalogLayout } from '@/components/catalog-layout.tsx';
import { GameTags } from '@/components/game-tags.tsx';
import { FirstScreen } from '@/components/first-screen.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { buttonVariants } from '@/components/ui/button.tsx';
import { Card, CardContent, CardCover, CardFooter } from '@/components/ui/card.tsx';
import { listGames } from '@/lib/catalog.ts';
import { currentWithPermission } from '@/lib/session.ts';

// Реестр меняется после каждого `gf build` - страницу не кешируем.
export const dynamic = 'force-dynamic';

export default async function CatalogPage() {
  // Пререлизы (до 1.0.0) - только владельцу (D-060)
  const games = listGames({ owner: (await currentWithPermission('prereleases.view.all')) !== null });
  if (games.length === 0) {
    return (
      <FirstScreen>
        <div className="gf-empty-state">
          <Icon name="gamepad" className="gf-empty-state-icon" />
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Каталог</p>
          <h1 className="font-display text-3xl font-bold tracking-tight">Игры</h1>
          <p className="text-muted-foreground" data-testid="empty">В каталоге пока нет игр. Загляни позже.</p>
        </div>
      </FirstScreen>
    );
  }
  return (
    <CatalogLayout>
      <div className="gf-catalog__heading flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Каталог</p>
        <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Игры</h1>
        <p className="max-w-prose text-muted-foreground">Играй прямо здесь или скачай архив и играй без интернета.</p>
      </div>
      <ul className="gf-catalog__grid" data-testid="catalog">
        {games.map(({ entry, prerelease, coverUrl, download }) => (
          <li key={entry.id} data-game-id={entry.id} className="flex">
            <Card className="w-full">
              <CardCover>
                {/* Обложка ведёт туда же, куда "Играть". Для клавиатуры и чтения с экрана это дубль
                    кнопки - убираем его из обхода, чтобы игра не звучала дважды. */}
                <Link href={`/games/${entry.id}`} tabIndex={-1} aria-hidden="true" data-testid="cover-link">
                  {coverUrl ? (
                    // Обычный <img>: обложку отдаёт служебный хост игр, оптимизатор Next тут лишний.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={coverUrl} alt="" width={320} height={180} />
                  ) : null}
                </Link>
                <Badge tone="version" className="gf-catalog__version">v{entry.version}</Badge>
                {prerelease ? <Badge className="gf-card__flag" data-testid="prerelease">пререлиз</Badge> : null}
              </CardCover>
              <CardContent>
                <h2 className="gf-card__title" title={entry.manifest.title}>{entry.manifest.title}</h2>
                <p className="gf-card__desc">{entry.manifest.description}</p>
                <GameTags tags={entry.manifest.tags} title={entry.manifest.title} />
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
    </CatalogLayout>
  );
}
