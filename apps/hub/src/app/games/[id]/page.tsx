import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { frameAttributes } from '@gf/hub-bridge';
import { DownloadLink } from '@/components/download-link.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { GameTags } from '@/components/game-tags.tsx';
import { findGame } from '@/lib/catalog.ts';
import { currentWithPermission } from '@/lib/session.ts';
import { GameFrame } from './game-frame.tsx';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }> };

async function gameFor(params: Props['params']) {
  // Пререлиз гостю - 404, как несуществующая игра (D-060)
  return findGame((await params).id, { owner: (await currentWithPermission('prereleases.view.all')) !== null });
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
    <GameFrame
      gameId={entry.id}
      gameOrigin={gameOrigin}
      title={manifest.title}
      sandbox={frame.sandbox}
      allow={frame.allow}
      metadata={
        <div className="gf-game-metadata">
          <GameTags tags={manifest.tags} title={manifest.title} />
          <Badge tone="version">v{entry.version}</Badge>
          {prerelease ? <Badge data-testid="prerelease">пререлиз</Badge> : null}
        </div>
      }
    >
      <div className="gf-game-info">
        {manifest.description ? <p className="max-w-prose text-muted-foreground">{manifest.description}</p> : null}
        {download ? <div><DownloadLink url={download.url} bytes={download.bytes} /></div> : null}
      </div>
    </GameFrame>
  );
}
