import type { GameState } from '../src/core/state.ts';
// Формы реально существовавших схем, без будущих полей и пересчёта истории.
export function legacyState(state:GameState,version:1|2|3|4|5):any {
  const value=structuredClone(state) as any;
  delete value.profile.owned;delete value.profile.tutorial;
  if(version<5)delete value.profile.progress;
  const s=value.season;
  if(!s)return value;
  delete s.access;
  if(s.garden)for(const k of ['rose','tulip','gerbera','lily'])delete s.garden.stock[k];
  if(version===5)return value;
  delete s.effects;delete s.events;
  if(s.garden)for(const list of [s.garden.plants,s.garden.undo])if(list)for(const p of list)delete p.supportBonus;
  if(version<4)delete s.board;
  else if(s.board.pending)s.board.pending={orderId:s.board.pending.orderId,stage:s.board.pending.stage};
  if(version<3)delete s.garden;
  if(version<2)delete s.layout;
  return value;
}
