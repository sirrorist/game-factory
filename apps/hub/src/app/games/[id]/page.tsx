import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { frameAttributes } from '@gf/hub-bridge';
import { DownloadLink } from '@/components/download-link.tsx';
import { Icon } from '@/components/icons.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { findGame } from '@/lib/catalog.ts';
import { currentOwner } from '@/lib/session.ts';
import { GameFrame } from './game-frame.tsx';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }> };

async function gameFor(params: Props['params']) {
  // Пререлиз гостю - 404, как несуществующая игра (D-060)
  return findGame((await params).id, { owner: (await currentOwner()) !== null });
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const game = await gameFor(params);
  return { title: game ? game.entry.manifest.title : 'Игра не найдена' };
}

export default async function GamePage({ params }: Props) {
  const game = await gameFor(params);
  if (!game) notFound();
  const { entry, prerelease, gameOrigin, download } = game;
  const { manifest } = entry;
  const frame = frameAttributes(manifest.permissions);

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <Link href="/" className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <Icon name="back" className="size-4" />
          Каталог
        </Link>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">{manifest.title}</h1>
          <Badge tone="version">v{entry.version}</Badge>
          {prerelease ? <Badge data-testid="prerelease">пререлиз</Badge> : null}
          {manifest.tags.map((t) => (
            <Badge key={t}>{t}</Badge>
          ))}
        </div>
        {manifest.description ? <p className="max-w-prose text-muted-foreground">{manifest.description}</p> : null}
      </div>
      <GameFrame
        gameId={entry.id}
        gameOrigin={gameOrigin}
        title={manifest.title}
        sandbox={frame.sandbox}
        allow={frame.allow}
      >
        {download ? <DownloadLink url={download.url} bytes={download.bytes} /> : null}
      </GameFrame>
    </section>
  );
}
