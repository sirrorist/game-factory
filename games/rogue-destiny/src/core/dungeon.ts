/**
 * Модуль процедурной генерации этажей катакомб, связки комнат,
 * расхода света от прогресса и метроидвания-замков.
 * Чистая логика без DOM.
 */
import type {
  DungeonFloor,
  DungeonRoom,
  InventoryGrid,
  MetroidvaniaLockType,
  PlayerState,
  RoomCue,
} from './types.ts';

export function generateFloor(floorNumber: number): DungeonFloor {
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

  const connections: [string, string][] = [
    ['room_0', 'room_1'],
    ['room_1', 'room_2'],
    ['room_1', 'room_3'],
    ['room_2', 'room_4'],
    ['room_3', 'room_5'],
    ['room_4', 'room_5'],
  ];

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
    // Вход в новую комнату расходует свет по прогрессу
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
  const hasCategory = (cat: string) =>
    Array.from(grid.items.values()).some((i) => i.category === cat);
  const hasElement = (elem: string) =>
    Array.from(grid.items.values()).some((i) => i.element === elem);

  switch (lockType) {
    case 'brambles':
      if (hasElement('fire')) {
        return { canUnlock: true, reason: 'Огненное оружие сжигает терновые корни!' };
      }
      return { canUnlock: false, reason: 'Нужен огонь или кислота, чтобы прожечь лозы.' };

    case 'runeCipher':
      if (codexKnowledge.has('sylvan_ciphers') || hasCategory('tool')) {
        return { canUnlock: true, reason: 'Древний шифр расшифрован благодаря записям Кодекса!' };
      }
      return { canUnlock: false, reason: 'Дисковый замок заперт. Нужны знания шифра из Кодекса.' };

    case 'submerged':
      if (hasCategory('tool') || codexKnowledge.has('water_breathing')) {
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
      if (hasElement('fire') || hasElement('ice') || hasCategory('scroll')) {
        return { canUnlock: true, reason: 'Эфирный резонанс развеивает иллюзорную стену!' };
      }
      return { canUnlock: false, reason: 'Кажется, это обычная стена... но вода уходит под неё.' };

    default:
      return { canUnlock: true, reason: 'Преграда преодолена.' };
  }
}
