import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { frameAttributes } from '@gf/hub-bridge';
import { DownloadLink } from '@/components/download-link.tsx';
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
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Link href="/" className="text-sm text-muted-foreground hover:underline">
          ← Каталог
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{manifest.title}</h1>
        <span className="text-sm text-muted-foreground">v{entry.version}</span>
        {manifest.tags.map((t) => (
          <Badge key={t}>{t}</Badge>
        ))}
      </div>
      {manifest.description ? <p className="max-w-prose text-sm text-muted-foreground">{manifest.description}</p> : null}
      <GameFrame
        gameId={entry.id}
        gameOrigin={gameOrigin}
        title={manifest.title}
        sandbox={frame.sandbox}
        allow={frame.allow}
        fullscreen={manifest.permissions.includes('fullscreen')}
      >
        {download ? <DownloadLink url={download.url} bytes={download.bytes} /> : null}
      </GameFrame>
    </section>
  );
}
