/**
 * Модуль процедурной генерации этажей катакомб, связки комнат,
 * расхода света от прогресса и метроидвания-замков.
 * Чистая логика без DOM.
 */
import { isItemContaminated } from './inventory.ts';
import type {
  DungeonFloor,
  DungeonRoom,
  InventoryGrid,
  MetroidvaniaLockType,
  PlayerState,
  RoomCue,
} from './types.ts';

export function generateFloor(floorNumber: number, runSeed = 0): DungeonFloor {
  // Номер этажа задаёт стабильную генерацию: сохранение восстанавливает ту же карту.
  let seed = (Math.max(1, Math.floor(floorNumber)) * 2654435761 ^ runSeed) >>> 0;
  if (seed === 0) seed = 1;
  const random = (): number => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
  const rooms: DungeonRoom[] = [
    {
      id: 'room_0',
      x: 0,
      y: 0,
      width: 14,
      height: 14,
      type: 'spawn',
      isRevealed: true,
      isVisited: true,
      hasAetherRift: true,
    },
    {
      id: 'room_1',
      x: 18,
      y: 0,
      width: 12,
      height: 12,
      type: 'corridor',
      isRevealed: false,
      isVisited: false,
      hasAetherRift: false,
      cue: {
        type: 'scoot',
        message: 'Из-за двери доносится шорох сухой листвы и когтей...',
      },
    },
    {
      id: 'room_2',
      x: 34,
      y: -6,
      width: 16,
      height: 16,
      type: 'hall',
      isRevealed: false,
      isVisited: false,
      hasAetherRift: false,
      cue: {
        type: 'blood_scent',
        message: 'На каменном пороге видны бурые пятна имперской крови...',
      },
    },
    {
      id: 'room_3',
      x: 34,
      y: 14,
      width: 14,
      height: 14,
      type: 'mimic_room',
      isRevealed: false,
      isVisited: false,
      hasAetherRift: false,
      cue: {
        type: 'spore_buzz',
        message: 'В воздухе висит мерцающая зеленоватая споровая пыль...',
      },
    },
    {
      id: 'room_4',
      x: 54,
      y: -6,
      width: 14,
      height: 14,
      type: 'shrine',
      isRevealed: false,
      isVisited: false,
      hasAetherRift: false,
      lockType: 'brambles',
      cue: {
        type: 'whisper',
        message: 'Вход оплетён ядовитыми колючими корнями Древоточцев...',
      },
    },
    {
      id: 'room_5',
      x: 54,
      y: 14,
      width: 18,
      height: 18,
      type: 'boss_gate',
      isRevealed: false,
      isVisited: false,
      hasAetherRift: false,
      lockType: 'runeCipher',
      cue: {
        type: 'heat_radiance',
        message: 'Огромные ворота с древним дисковым шифром Сильванов...',
      },
    },
  ];

  // Первый этаж сохраняет знакомые ориентиры; дальше меняются изгибы маршрутов.
  if (floorNumber > 1 || runSeed !== 0) {
    for (let i = 1; i < rooms.length; i++) {
      const room = rooms[i]!;
      rooms[i] = { ...room, x: room.x + Math.floor(random() * 7) - 3, y: room.y + Math.floor(random() * 7) - 3,
        width: room.width + Math.floor(random() * 3) * 2, height: room.height + Math.floor(random() * 3) * 2 };
    }
  }

  const connections: [string, string][] = [
    ['room_0', 'room_1'],
    ['room_1', 'room_2'],
    ['room_1', 'room_3'],
    ['room_2', 'room_4'],
    ['room_3', 'room_5'],
    ['room_4', 'room_5'],
  ];

  if (runSeed !== 0 && (runSeed + floorNumber) % 3 !== 0) {
    const junction = rooms.find((room) => room.id === 'room_1')!;
    rooms.push({ id: 'room_6', x: junction.x + Math.floor(random() * 5) - 2, y: -23 - Math.floor(random() * 4),
      width: 12, height: 10, type: 'library', isRevealed: false, isVisited: false, hasAetherRift: false,
      lockType: 'illusionary', secret: true });
    connections.push(['room_1', 'room_6']);
  }
  if (runSeed !== 0) {
    const branch = rooms.find(room => room.id === 'room_3')!;
    const locks: MetroidvaniaLockType[] = ['submerged','steamVent','soundTrap','elementalWard','pitchBlack','chasm'];
    rooms.push({ id: 'room_7', x: branch.x - 18, y: branch.y + 24, width: 12, height: 10,
      type: 'vault', isRevealed: false, isVisited: false, hasAetherRift: false,
      lockType: locks[((runSeed >>> 0) + floorNumber * 17) % locks.length]!,
      cue: { type: 'whisper', message: 'За боковым проходом слышен звон запечатанного реликвария.' } });
    connections.push(['room_3','room_7']);
  }
  return {
    floorNumber,
    rooms,
    connections,
    activeRoomId: 'room_0',
  };
}

export function enterRoom(
  floor: DungeonFloor,
  roomId: string,
  player: PlayerState,
): { newlyRevealed: boolean; lightSpent: number } {
  const room = floor.rooms.find((r) => r.id === roomId);
  if (!room) {
    return { newlyRevealed: false, lightSpent: 0 };
  }

  floor.activeRoomId = roomId;
  let newlyRevealed = false;
  let lightSpent = 0;

  if (!room.isRevealed) {
    room.isRevealed = true;
    newlyRevealed = true;
  }
  // Разведка свитком показывает карту, но не заменяет реальное исследование зала.
  if (!room.isVisited) {
    lightSpent = 15;
    player.lightSupply = Math.max(0, player.lightSupply - lightSpent);
  }

  room.isVisited = true;
  return { newlyRevealed, lightSpent };
}

export function canUnlockMetroidvania(
  lockType: MetroidvaniaLockType,
  grid: InventoryGrid,
  codexKnowledge: Set<string>,
): { canUnlock: boolean; reason: string } {
  const usable = Array.from(grid.items.values()).filter(item => !item.isSpoiled && !isItemContaminated(grid,item) && item.durability !== 0);
  const hasCategory = (cat: string) => usable.some(item => item.category === cat);
  const hasElement = (elem: string) => usable.some(item => item.element === elem);
  const hasUtility = (utility: string) => usable.some(item => item.utility === utility);

  switch (lockType) {
    case 'brambles':
      if (hasElement('fire') || hasElement('poison')) {
        return { canUnlock: true, reason: 'Стихийный резонанс разрушает терновые корни!' };
      }
      return { canUnlock: false, reason: 'Нужен огонь или кислота, чтобы прожечь лозы.' };

    case 'runeCipher':
      if (codexKnowledge.has('sylvan_ciphers') || hasUtility('cipher')) {
        return { canUnlock: true, reason: 'Древний шифр расшифрован благодаря записям Кодекса!' };
      }
      return { canUnlock: false, reason: 'Дисковый замок заперт. Нужны знания шифра из Кодекса.' };

    case 'submerged':
      if (hasUtility('breathing') || codexKnowledge.has('water_breathing')) {
        return { canUnlock: true, reason: 'Дыхательная трубка позволяет преодолеть затопленный сифон!' };
      }
      return { canUnlock: false, reason: 'Вода до потолка. Без дыхательной трубки герой захлебнется.' };

    case 'soundTrap':
      // Проверка категории веса: нужен легкий вес
      let totalWeight = 0;
      for (const i of grid.items.values()) totalWeight += i.weight;
      if (totalWeight < 6.0) {
        return { canUnlock: true, reason: 'Бесшумный легкий шаг позволяет пройти мимо чутких стражей!' };
      }
      return { canUnlock: false, reason: 'Доспехи слишком гремят. Нужен легкий вес (менее 6 кг).' };

    case 'steamVent':
      if (hasElement('ice')) {
        return { canUnlock: true, reason: 'Ледяной кристалл замораживает струю пара!' };
      }
      return { canUnlock: false, reason: 'Раскаленный пар преграждает путь. Нужен морозный кристалл.' };

    case 'illusionary':
      if (codexKnowledge.has('true_sight') || hasElement('fire') || hasElement('ice') || hasCategory('scroll')) {
        return { canUnlock: true, reason: 'Эфирный резонанс развеивает иллюзорную стену!' };
      }
      return { canUnlock: false, reason: 'Кажется, это обычная стена... но вода уходит под неё.' };

    case 'chasm':
      if (codexKnowledge.has('aether_step') || hasUtility('grapple')) return { canUnlock: true, reason: 'Эфирный скачок позволяет преодолеть разлом.' };
      return { canUnlock: false, reason: 'Для бездны нужен готовый Эфирный скачок или крюк.' };
    case 'elementalWard':
      if (codexKnowledge.has('elemental_ward')) return { canUnlock: true, reason: 'Знание перехваченного эфира снимает барьер.' };
      return { canUnlock: false, reason: 'Поймайте атаку идеальным парированием, чтобы понять барьер.' };
    case 'pitchBlack':
      if (codexKnowledge.has('fate_light') || hasUtility('light')) return { canUnlock: true, reason: 'Эфирный свет указывает путь в абсолютной тьме.' };
      return { canUnlock: false, reason: 'В абсолютной тьме нужен эфирный источник света или Нить Судьбы.' };
    default:
      return { canUnlock: false, reason: 'Способ преодоления этой преграды пока неизвестен.' };
  }
}

/** Звуковой проход снова запирается при шумном ранце, оставляя выход изнутри. */
export function refreshSoundGates(floor: DungeonFloor, grid: InventoryGrid, x: number, z: number): string[] {
  const closed: string[] = [];
  if (canUnlockMetroidvania('soundTrap',grid,new Set()).canUnlock) return closed;
  for (const room of floor.rooms) {
    if (room.lockType !== 'soundTrap' || !room.unlocked) continue;
    if (Math.abs(x-room.x) < room.width/2+0.5 && Math.abs(z-room.y) < room.height/2+0.5) continue;
    room.unlocked = false; closed.push(room.id);
  }
  return closed;
}
