export interface ImpactParticle {life:number;duration:number;x:number;y:number;z:number;vx:number;vy:number;vz:number;tint:string}
export interface ImpactPool {particles:ImpactParticle[];cursor:number}
export function createImpactPool(capacity:number):ImpactPool {
  const size=Number.isFinite(capacity)?Math.max(1,Math.min(128,Math.floor(capacity))):1;
  return {cursor:0,particles:Array.from({length:size},()=>({life:0,duration:1,x:0,y:0,z:0,vx:0,vy:0,vz:0,tint:'#ffffff'}))};
}
export function emitImpact(pool:ImpactPool,x:number,y:number,z:number,tint:string,count:number):void {
  if(!Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(z)||!Number.isFinite(count)||count<=0) return;
  for(let i=0;i<Math.min(pool.particles.length,Math.floor(count));i++) {
    const index=pool.cursor++%pool.particles.length,particle=pool.particles[index]!;
    const angle=index*2.399963,duration=0.28+(index%5)*0.035,speed=1.2+(index%3)*0.4;
    particle.life=duration;particle.duration=duration;particle.x=x;particle.y=y;particle.z=z;particle.vx=Math.sin(angle)*speed;particle.vy=1.2+(index%4)*0.3;particle.vz=Math.cos(angle)*speed;particle.tint=tint;
  }
}
export function tickImpactPool(pool:ImpactPool,dt:number):number {
  let active=0;
  if(!Number.isFinite(dt)||dt<0) return pool.particles.filter(particle=>particle.life>0).length;
  for(const particle of pool.particles) {
    if(particle.life<=0) continue;
    const elapsed=Math.min(dt,particle.life);particle.life=Math.max(0,particle.life-elapsed);
    particle.x+=particle.vx*elapsed;particle.y+=particle.vy*elapsed-2.9*elapsed*elapsed;particle.z+=particle.vz*elapsed;particle.vy-=5.8*elapsed;
    if(particle.life>1e-8) active++;else particle.life=0;
  }
  return active;
}
export function clearImpactPool(pool:ImpactPool):void {for(const particle of pool.particles)particle.life=0;pool.cursor=0;}

export interface CameraImpulse {remaining:number;strength:number;phase:number}
export const createCameraImpulse=():CameraImpulse=>({remaining:0,strength:0,phase:0});
export function kickCamera(state:CameraImpulse,strength:number):void {
  if(!Number.isFinite(strength)||strength<=0) return;
  state.remaining=0.18;state.strength=Math.min(0.06,Math.max(state.strength,strength));state.phase=0;
}
export function tickCameraImpulse(state:CameraImpulse,dt:number,reducedMotion:boolean):{x:number;y:number} {
  if(!Number.isFinite(dt)||dt<0) return {x:0,y:0};
  state.remaining=Math.max(0,state.remaining-dt);state.phase+=dt*90;
  if(state.remaining===0)state.strength=0;
  if(reducedMotion||state.remaining===0) return {x:0,y:0};
  const amplitude=state.strength*(state.remaining/0.18)**2;
  return {x:Math.sin(state.phase)*amplitude,y:Math.cos(state.phase*1.2)*amplitude*0.6};
}
