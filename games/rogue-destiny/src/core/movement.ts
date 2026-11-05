/** Пол и коридоры задают допустимую область движения; вода за краем непроходима. */
import type { DungeonFloor, DungeonRoom } from './types.ts';

const corridorCache = new WeakMap<DungeonFloor, { ax: number; az: number; dx: number; dz: number; length2: number; secret?: DungeonRoom }[]>();
function corridors(floor: DungeonFloor) {
  let cached = corridorCache.get(floor);
  if (cached) return cached;
  cached = [];
  for (const [aId, bId] of floor.connections) {
    const a = floor.rooms.find((room) => room.id === aId), b = floor.rooms.find((room) => room.id === bId);
    if (!a || !b) continue;
    const dx = b.x - a.x, dz = b.y - a.y;
    cached.push({ ax: a.x, az: a.y, dx, dz, length2: dx * dx + dz * dz, secret: a.secret ? a : b.secret ? b : undefined });
  }
  corridorCache.set(floor, cached);
  return cached;
}
export function isWalkable(floor: DungeonFloor, x: number, z: number, radius = 0.35): boolean {
  for (const room of floor.rooms) {
    if (room.lockType && !room.unlocked && Math.abs(x - room.x) < room.width / 2 + radius && Math.abs(z - room.y) < room.height / 2 + radius) return false;
  }
  for (const room of floor.rooms) {
    if (Math.abs(x - room.x) > room.width / 2 - radius || Math.abs(z - room.y) > room.height / 2 - radius) continue;
    // Радиус колонны совпадает с CylinderGeometry в environment.ts.
    for (let sx = -1; sx <= 1; sx += 2) for (let sz = -1; sz <= 1; sz += 2) {
      const cx = room.x + sx * (room.width / 2 - 1), cz = room.y + sz * (room.height / 2 - 1);
      if (Math.hypot(x - cx, z - cz) < 0.5 + radius) return false;
    }
    return true;
  }
  for (const c of corridors(floor)) {
    if (!c.length2 || c.secret && !c.secret.unlocked) continue;
    const t = Math.max(0, Math.min(1, ((x - c.ax) * c.dx + (z - c.az) * c.dz) / c.length2));
    if (Math.hypot(x - c.ax - c.dx * t, z - c.az - c.dz * t) <= 2 - radius) return true;
  }
  return false;
}

export function moveOnFloor(floor: DungeonFloor, x: number, z: number, dx: number, dz: number): { x: number; z: number } {
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.2));
  for (let i = 0; i < steps; i++) {
    const nx = x + dx / steps, nz = z + dz / steps;
    if (isWalkable(floor, nx, nz)) { x = nx; z = nz; }
    else {
      if (isWalkable(floor, nx, z)) x = nx;
      if (isWalkable(floor, x, nz)) z = nz;
    }
  }
  return { x, z };
}

/** Прямой удар блокируют колонны и закрытые печати; открытая вода не считается стеной. */
export function hasLineOfSight(floor: DungeonFloor,ax:number,az:number,bx:number,bz:number): boolean {
  if(![ax,az,bx,bz].every(Number.isFinite)) return false;
  const distance=Math.hypot(bx-ax,bz-az);if(distance>64)return false;
  const steps=Math.max(1,Math.ceil(distance/0.2));
  for(let i=0;i<=steps;i++) {
    const t=i/steps,x=ax+(bx-ax)*t,z=az+(bz-az)*t;
    for(const room of floor.rooms) {
      if(room.lockType&&!room.unlocked&&Math.abs(x-room.x)<=room.width/2&&Math.abs(z-room.y)<=room.height/2)return false;
      if(room.devastated)continue; // После срыва остаются низкие пни, луч проходит над ними.
      for(const sx of [-1,1])for(const sz of [-1,1]) {
        const dx=x-room.x-sx*(room.width/2-1),dz=z-room.y-sz*(room.height/2-1);
        if(dx*dx+dz*dz<0.36)return false;
      }
    }
  }
  return true;
}

const STEERING_ANGLES=[Math.PI/6,-Math.PI/6,Math.PI/3,-Math.PI/3,Math.PI/2,-Math.PI/2];
/** Локальный обход: короткие пробы выбирают свободную сторону, движение остаётся на полу. */
export function moveEnemyOnFloor(floor:DungeonFloor,x:number,z:number,dx:number,dz:number,id:string,goal?:{x:number;z:number}):{x:number;z:number} {
  const length=Math.hypot(dx,dz);if(!Number.isFinite(length)||length<1e-8)return {x,z};
  const nx=dx/length,nz=dz/length,lookahead=Math.max(length,Math.min(0.9,goal?Math.hypot(goal.x-x,goal.z-z):0.9));
  const forward=moveOnFloor(floor,x,z,nx*lookahead,nz*lookahead);
  const clearance=Math.hypot(forward.x-x,forward.z-z)/lookahead;
  if(clearance>0.985)return moveOnFloor(floor,x,z,dx,dz);
  let hash=0;for(let i=0;i<id.length;i++)hash+=id.charCodeAt(i);
  const side=hash%2===0?1:-1;
  let bestX=nx,bestZ=nz,bestScore=clearance+0.25;
  for(const candidate of STEERING_ANGLES) {
    const angle=candidate*side,c=Math.cos(angle),s=Math.sin(angle),tx=nx*c-nz*s,tz=nx*s+nz*c;
    const probe=moveOnFloor(floor,x,z,tx*lookahead,tz*lookahead);
    const score=Math.hypot(probe.x-x,probe.z-z)/lookahead+c*0.25;
    if(score>bestScore+1e-6){bestScore=score;bestX=tx;bestZ=tz;}
  }
  return moveOnFloor(floor,x,z,bestX*length,bestZ*length);
}
