import { hasCell, neighbors, sameCell, type Cell, type FieldSize } from './field.ts';
import { isPlant, type PlacedObject } from './layout.ts';
import { emptyEffects, ownDeviceZone, conditionZone, hasGlobal, moduleAt, type EffectsState } from './effects.ts';

// Базовые устройства действуют на растения. Модули расширения появятся отдельно.
export function deviceZone(source: Cell, objects: readonly PlacedObject[], fx: EffectsState = emptyEffects(), size:FieldSize = 19): Cell[] {
  const device = objects.find(o => sameCell(o, source) && !isPlant(o.kind));
  return (device ? conditionZone(device, objects, fx,size) : neighbors(source)).filter(cell => hasCell(size, cell)
    && !objects.some(object => sameCell(object, cell) && !isPlant(object.kind)));
}

export function plantConditions(objects: readonly PlacedObject[], cell: Cell, fx: EffectsState = emptyEffects(), size:FieldSize = 19): { light: boolean; water: boolean } | null {
  const plant = objects.find(o => sameCell(o, cell) && isPlant(o.kind));
  if (!plant) return null;
  const direct = (target: Cell) => {
    let light = moduleAt(fx, target)?.effect === 'P6', water = false, sprinkler = false;
    for (const device of objects.filter(o => !isPlant(o.kind))) {
      const inZone = conditionZone(device, objects, fx,size).some(c => sameCell(c, target));
      if (inZone && device.kind === 'lamp') light = true;
      if (inZone && device.kind === 'sprinkler') { water = true; sprinkler = true; }
      if (moduleAt(fx, device)?.effect === 'E4' && ownDeviceZone(device, fx,size).some(c => sameCell(c, target))) { light = true; water = true; }
    }
    return { light, water, sprinkler };
  };
  const own = direct(cell);
  const same = objects.filter(o => o.kind === plant.kind && neighbors(cell).some(c => sameCell(c, o)));
  return { light: own.light || (hasGlobal(fx, 'P2', plant.kind) && same.some(o => direct(o).light)),
    water: own.water || (hasGlobal(fx, 'P3', plant.kind) && same.some(o => direct(o).sprinkler)) };
}
