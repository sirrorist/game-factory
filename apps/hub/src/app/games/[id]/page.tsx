import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { frameAttributes } from '@gf/hub-bridge';
import { DownloadLink } from '@/components/download-link.tsx';
import { Icon } from '@/components/icons.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { findGame } from '@/lib/catalog.ts';
import { GameFrame } from './game-frame.tsx';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const game = findGame((await params).id);
  return { title: game ? game.entry.manifest.title : 'Игра не найдена' };
}

export default async function GamePage({ params }: Props) {
  const game = findGame((await params).id);
  if (!game) notFound();
  const { entry, gameOrigin, download } = game;
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
