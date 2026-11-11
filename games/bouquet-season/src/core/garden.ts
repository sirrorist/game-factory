import { sameCell } from './field.ts';
import { isPlant, type Layout, type LayoutCommand, type PlacedObject, type PlantKind } from './layout.ts';
import { newPlant, type PlantState } from './growth.ts';

export type Stock = Record<PlantKind,number>;
export const emptyStock = ():Stock => ({carnation:0,chrysanthemum:0,rose:0,tulip:0,gerbera:0,lily:0});
export interface Garden { plants: PlantState[]; undo: PlantState[] | null; stock: Stock }
export const newGarden = (layout: Layout): Garden => ({
  plants:layout.objects.filter(o=>isPlant(o.kind)).map(newPlant),
  undo:layout.undo===null?null:layout.undo.filter(o=>isPlant(o.kind)).map(newPlant),
  stock:emptyStock(),
});
export function editGarden(garden: Garden, command: LayoutCommand): Garden {
  if(command.type==='undo')return garden.undo===null?garden:{...garden,plants:structuredClone(garden.undo),undo:null};
  const undo=structuredClone(garden.plants);
  let plants=structuredClone(garden.plants);
  if(command.type==='place' && isPlant(command.kind))plants.push(newPlant(command.to));
  else if(command.type==='remove')plants=plants.filter(p=>!sameCell(p,command.from));
  else if(command.type==='move')plants=plants.map(p=>sameCell(p,command.from)?{...p,q:command.to.q,r:command.to.r}:p);
  return {...garden,plants,undo};
}

function exact(value: unknown, keys: string[]): value is Record<string,unknown> {
  return !!value && typeof value==='object' && !Array.isArray(value)
    && Object.keys(value).length===keys.length && keys.every(key=>Object.hasOwn(value,key));
}
const integer=(value:unknown,min:number,max:number):value is number=>Number.isSafeInteger(value) && (value as number)>=min && (value as number)<=max;
function validPlants(value: unknown, objects: readonly PlacedObject[], day: number, legacy = false): value is PlantState[] {
  if(!Array.isArray(value) || value.length!==objects.filter(o=>isPlant(o.kind)).length)return false;
  const seen=new Set<string>();
  return Array.from(value).every(p=>{
    if(!exact(p,legacy?['q','r','growth','growthDays','wilt','recovering','bonus','yield']:['q','r','growth','growthDays','wilt','recovering','bonus','supportBonus','yield'])
      || !integer(p.q,-4,3) || !integer(p.r,-3,4)
      || !objects.some(o=>sameCell(o,p as unknown as PlantState) && isPlant(o.kind))
      || !integer(p.growthDays,0,Math.min(4,day-1))
      || !integer(p.growth,Math.min(8,p.growthDays*2),Math.min(8,p.growthDays*4))
      || !integer(p.wilt,0,Math.min(3,day-1)) || typeof p.bonus!=='boolean' || typeof p.recovering!=='boolean'
      || (!legacy && typeof p.supportBonus!=='boolean')
      || (p.yield!==0 && p.yield!==2 && p.yield!==3)
      || (p.recovering && (p.wilt!==0 || day<3))
      || (p.wilt===3 && (p.yield!==0 || p.bonus || (!legacy && p.supportBonus)))
      || (p.growth<8 && p.yield!==0)
      || (p.wilt<3 && p.growth===8 && (p.growthDays<2 || p.yield!==2+Number(p.bonus||(!legacy&&p.supportBonus)))))return false;
    const key=`${p.q},${p.r}`;
    if(seen.has(key))return false;
    seen.add(key);return true;
  });
}
export function isGarden(value: unknown, layout: Layout, day: number, legacy = false, oldStock = false): value is Garden {
  if(!exact(value,['plants','undo','stock']) || !exact(value.stock,oldStock?['carnation','chrysanthemum']:Object.keys(emptyStock()))
    || !Object.values(value.stock).every(n=>integer(n,0,Number.MAX_SAFE_INTEGER))
    || !validPlants(value.plants,layout.objects,day,legacy))return false;
  return layout.undo===null ? value.undo===null : validPlants(value.undo,layout.undo,day,legacy);
}
