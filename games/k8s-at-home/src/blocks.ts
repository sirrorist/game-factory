// Блоки мира. Id блока - байт в массиве чанка и в сохранении: существующие id не менять,
// новые - только в конец, иначе старые миры откроются с чужими блоками.

export const B = {
  AIR: 0,
  BEDROCK: 1,
  STONE: 2,
  DIRT: 3,
  GRASS: 4,
  SAND: 5,
  LOG: 6,
  LEAVES: 7,
  PLANKS: 8,
  COBBLE: 9,
  GLASS: 10,
  WATER: 11,
  SNOW: 12,
  COAL: 13,
  BRICK: 14,
  GRAVEL: 15,
  CONTAINER: 16,
  SERVER: 17,
  SNOWY_GRASS: 18,
} as const;

export type BlockId = number;

/** Как блок рисуется: непрозрачный куб, вырез по альфе (листва, стекло) или вода. */
export type Pass = 'opaque' | 'cutout' | 'water';

export interface BlockDef {
  name: string;
  /** Плитки атласа: верх, низ, бок. */
  top: string;
  bottom: string;
  side: string;
  pass: Pass;
  /** Сквозь него не пройти. */
  solid: boolean;
  /** Закрывает соседние грани целиком: за ним грани соседей не рисуются. */
  opaque: boolean;
  breakable: boolean;
  /** Показывать в выборе блоков. */
  pickable: boolean;
  /** Тон звука ломания и установки: 0 - глухой (земля), 1 - звонкий (камень, стекло). */
  pitch: number;
}

function cube(name: string, tile: string, extra: Partial<BlockDef> = {}): BlockDef {
  return {
    name, top: tile, bottom: tile, side: tile,
    pass: 'opaque', solid: true, opaque: true, breakable: true, pickable: true, pitch: 0.5,
    ...extra,
  };
}

export const BLOCKS: BlockDef[] = [];
BLOCKS[B.AIR] = cube('Воздух', 'stone', { pass: 'opaque', solid: false, opaque: false, breakable: false, pickable: false });
BLOCKS[B.BEDROCK] = cube('Коренная порода', 'bedrock', { breakable: false, pickable: false, pitch: 0.9 });
BLOCKS[B.STONE] = cube('Камень', 'stone', { pitch: 0.9 });
BLOCKS[B.DIRT] = cube('Земля', 'dirt', { pitch: 0.1 });
BLOCKS[B.GRASS] = cube('Трава', 'grass_side', { top: 'grass_top', bottom: 'dirt', pitch: 0.15 });
BLOCKS[B.SAND] = cube('Песок', 'sand', { pitch: 0.2 });
BLOCKS[B.LOG] = cube('Бревно', 'log_side', { top: 'log_top', bottom: 'log_top', pitch: 0.4 });
BLOCKS[B.LEAVES] = cube('Листва', 'leaves', { pass: 'cutout', opaque: false, pitch: 0.25 });
BLOCKS[B.PLANKS] = cube('Доски', 'planks', { pitch: 0.45 });
BLOCKS[B.COBBLE] = cube('Булыжник', 'cobble', { pitch: 0.85 });
BLOCKS[B.GLASS] = cube('Стекло', 'glass', { pass: 'cutout', opaque: false, pitch: 1 });
BLOCKS[B.WATER] = cube('Вода', 'water', { pass: 'water', solid: false, opaque: false, breakable: false, pickable: false });
BLOCKS[B.SNOW] = cube('Снег', 'snow', { pitch: 0.1 });
BLOCKS[B.COAL] = cube('Угольная руда', 'coal', { pitch: 0.9 });
BLOCKS[B.BRICK] = cube('Кирпич', 'brick', { pitch: 0.8 });
BLOCKS[B.GRAVEL] = cube('Гравий', 'gravel', { pitch: 0.3 });
BLOCKS[B.CONTAINER] = cube('Контейнер', 'container_side', { top: 'container_top', bottom: 'container_top', pitch: 0.7 });
BLOCKS[B.SERVER] = cube('Сервер', 'server_front', { top: 'server_top', bottom: 'server_top', pitch: 0.75 });
BLOCKS[B.SNOWY_GRASS] = cube('Заснеженная трава', 'snowy_side', { top: 'snow', bottom: 'dirt', pitch: 0.1 });

export const BLOCK_COUNT = BLOCKS.length;

/** Начальная панель быстрого доступа. */
export const DEFAULT_HOTBAR: BlockId[] = [
  B.GRASS, B.DIRT, B.STONE, B.COBBLE, B.PLANKS, B.LOG, B.GLASS, B.CONTAINER, B.SERVER,
];

export function isBlockId(v: unknown): v is BlockId {
  return typeof v === 'number' && Number.isInteger(v) && v > 0 && v < BLOCK_COUNT;
}

// Таблицы для горячих циклов генерации и мешинга: доступ к объекту на каждый воксель дорог.
export const SOLID = new Uint8Array(256);
export const OPAQUE = new Uint8Array(256);
for (let id = 0; id < BLOCK_COUNT; id++) {
  SOLID[id] = BLOCKS[id]!.solid ? 1 : 0;
  OPAQUE[id] = BLOCKS[id]!.opaque ? 1 : 0;
}
