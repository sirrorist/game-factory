import { neighbors, sameCell, type Cell, type FieldSize } from './field.ts';
import { isPlant, waterPlant, type PlantKind, type PlacedObject } from './layout.ts';
import { plantConditions } from './conditions.ts';
import { emptyEffects, hasGlobal, moduleAt, type EffectsState } from './effects.ts';

export interface PlantState extends Cell {
  // Половины единицы: целые числа без накопления ошибок округления.
  growth: number;
  growthDays: number;
  wilt: number;
  recovering: boolean;
  bonus: boolean;
  supportBonus: boolean;
  yield: number;
}
export const newPlant = (cell: Cell): PlantState => ({ q:cell.q,r:cell.r,growth:0,growthDays:0,wilt:0,recovering:false,bonus:true,supportBonus:true,yield:0 });
export const livingObjects = (objects: readonly PlacedObject[], plants: readonly PlantState[]): PlacedObject[] => objects.filter(o =>
  !isPlant(o.kind) || plants.some(p => sameCell(p,o) && p.wilt < 3));

// Только выращивание: разрешение календарного перехода и сроки заказов — уровень сезона.
export function growDay(objects: readonly PlacedObject[], plants: readonly PlantState[], fx: EffectsState = emptyEffects(), size:FieldSize = 19): { objects: PlacedObject[]; plants: PlantState[] } {
  const living=livingObjects(objects,plants);
  const next=plants.map(plant=>{
    const object=objects.find(o=>sameCell(o,plant));
    if(!object || !isPlant(object.kind))throw Error('Растение не найдено на поле.');
    if(plant.wilt===3)return {...plant};
    const conditions=plantConditions(living,plant,fx,size)!;
    const waterRequired = waterPlant(object.kind) !== hasGlobal(fx, 'P1', object.kind);
    const required=waterRequired?conditions.water:conditions.light;
    const extra=waterRequired?conditions.light:conditions.water;
    const adjacent=living.filter(o=>isPlant(o.kind) && neighbors(plant).some(c=>sameCell(c,o)));
    const other=adjacent.some(o=>o.kind!==object.kind),same=adjacent.some(o=>o.kind===object.kind);
    const bonus=plant.yield>0?plant.bonus:plant.bonus && required && other;
    const supportBonus=plant.yield>0?plant.supportBonus:plant.supportBonus && required && moduleAt(fx,plant)?.effect==='P5'
      && living.some(o=>!isPlant(o.kind) && neighbors(plant).some(c=>sameCell(c,o)));
    if(!required){
      const wilt=plant.wilt+1;
      return {...plant,wilt,recovering:false,bonus:wilt===3?false:bonus,supportBonus:wilt===3?false:supportBonus,yield:wilt===3?0:plant.yield};
    }
    // Восстановление и адаптация могут занять один и тот же день, без двойного роста.
    if(plant.wilt>0)return {...plant,wilt:0,recovering:true,bonus,supportBonus};
    if(object.adaptation || plant.yield>0)return {...plant,recovering:false,bonus,supportBonus};
    const speedNeighbor=moduleAt(fx,plant)?.effect==='P4'?other:same;
    const growth=Math.min(8,plant.growth+2+Number(extra)+Number(speedNeighbor));
    const growthDays=plant.growthDays+1;
    return {...plant,growth,growthDays,recovering:false,bonus,supportBonus,yield:growth===8 && growthDays>=2 ? 2+Number(bonus||supportBonus) : 0};
  });
  return {objects:objects.map(o=>({...o,adaptation:0})),plants:next};
}

export function cutPlant(objects: readonly PlacedObject[], plants: readonly PlantState[], cell: Cell): {
  plants: PlantState[]; kind: PlantKind; amount: number;
} {
  const object=objects.find(o=>sameCell(o,cell));
  const plant=plants.find(p=>sameCell(p,cell));
  if(!object || !isPlant(object.kind) || !plant)throw Error('Растение не найдено.');
  if(plant.wilt===3 || plant.yield===0)throw Error('Срезать можно только готовое живое растение.');
  return {kind:object.kind,amount:plant.yield,plants:plants.map(p=>p===plant?{
    ...p,growth:0,growthDays:0,bonus:true,supportBonus:true,yield:0,
  }:{...p})};
}
