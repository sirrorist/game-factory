import type {MetaProgress,SavedRunProgress} from './saves.ts';
import type {SaveEntry} from './save-writer.ts';
export interface RunReceipt {id:string;score:number;elites:number;victory:boolean;floor:number}
export const validRunId=(value:unknown):value is string=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(value);
export function legacyRunId(run:SavedRunProgress):string {return `legacy_${run.seed??0}_${run.floor}_${run.elitesDefeated}_${run.score}`;}
export function parseRunReceipt(value:unknown):RunReceipt|null {
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const r=value as Record<string,unknown>;
  const count=(v:unknown,max:number)=>typeof v==='number'&&Number.isInteger(v)&&v>=0&&v<=max;
  if(!validRunId(r.id)||!count(r.score,1e9)||!count(r.elites,1e9)||typeof r.victory!=='boolean'||!count(r.floor,3)||(r.floor as number)<1)return null;
  return {id:r.id,score:r.score as number,elites:r.elites as number,victory:r.victory,floor:r.floor as number};
}
/** Повтор журнала после перезагрузки не прибавляет победу/попытку второй раз. */
export function applyRunReceipt(meta:MetaProgress,receipt:RunReceipt):boolean {
  if(meta.completedRunIds?.includes(receipt.id))return false;
  meta.totalRuns++;meta.totalElites+=receipt.elites;if(receipt.victory)meta.victories++;
  meta.highScore=Math.max(meta.highScore,receipt.score);meta.highestFloor=Math.max(meta.highestFloor,receipt.floor);
  meta.completedRunIds=[...(meta.completedRunIds??[]),receipt.id].slice(-64);return true;
}
/** Журнал остаётся до подтверждения рекорда. Отдельный новый активный забег не очищается. */
export function resultEntries(meta:MetaProgress,receipt:RunReceipt,clearActive:boolean):SaveEntry[] {
  applyRunReceipt(meta,receipt);
  return [['pending_result',receipt],['meta_progress',meta],...(clearActive?[['run_progress',null],['progress',null]] as SaveEntry[]:[])];
}
