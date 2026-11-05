import * as THREE from 'three';
import { createImpactPool,emitImpact,tickImpactPool,clearImpactPool } from '../core/impact.ts';
export type ImpactKind='hit'|'magic'|'parry'|'hurt'|'heal';
const palette:Record<ImpactKind,string>={hit:'#daba83',magic:'#ae98e0',parry:'#b3e8ee',hurt:'#c77661',heal:'#9dbf97'};
/** Один draw call, фиксированный пул, без текстур, таймеров и новых объектов на попадание. */
export function createCombatEffects(lowPower:boolean) {
  const capacity=lowPower?24:48,pool=createImpactPool(capacity);
  const mesh=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.065,0),new THREE.MeshBasicMaterial({color:'#ffffff'}),capacity);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.frustumCulled=false;mesh.visible=false;
  const dummy=new THREE.Object3D(),color=new THREE.Color(),colors=new Array<string>(capacity).fill('');
  dummy.scale.setScalar(0);dummy.updateMatrix();for(let i=0;i<capacity;i++)mesh.setMatrixAt(i,dummy.matrix);
  return {mesh,burst:(x:number,y:number,z:number,kind:ImpactKind,reducedMotion:boolean)=>emitImpact(pool,x,y,z,palette[kind],reducedMotion?2:lowPower?4:8),
    clear:()=>{clearImpactPool(pool);mesh.visible=false;},
    update:(dt:number)=>{
      mesh.visible=tickImpactPool(pool,dt)>0;if(!mesh.visible)return;
      for(let i=0;i<capacity;i++){
        const particle=pool.particles[i]!;dummy.position.set(particle.x,particle.y,particle.z);dummy.scale.setScalar(particle.life>0?particle.life/particle.duration*1.5:0);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);
        if(colors[i]!==particle.tint){colors[i]=particle.tint;mesh.setColorAt(i,color.set(particle.tint));}
      }
      mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;
    },
  };
}
