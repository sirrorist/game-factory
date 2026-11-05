import * as THREE from 'three';
import type { DungeonFloor, DungeonRoom, MetroidvaniaLockType } from '../core/types.ts';

export const GATE_COLORS: Record<MetroidvaniaLockType, string> = {
  illusionary:'#78949c', runeCipher:'#66bad0', brambles:'#d68a42', submerged:'#4a95b9', steamVent:'#d4d6d0',
  soundTrap:'#d5b977', elementalWard:'#a38de2', pitchBlack:'#181827', chasm:'#536275',
};
/** Силуэт преграды на входе боковой комнаты; ресурсы освобождаются вместе с миром. */
export function createGateMarker(room: DungeonRoom, floor: DungeonFloor): THREE.Group {
  const group = new THREE.Group();
  const connection = floor.connections.find(([a,b])=>a===room.id||b===room.id);
  const neighbor = connection && floor.rooms.find(other=>other.id===(connection[0]===room.id?connection[1]:connection[0]));
  if (!room.lockType || !neighbor) return group;
  const dx=neighbor.x-room.x,dz=neighbor.y-room.y;
  const t=Math.min(dx?room.width/2/Math.abs(dx):Infinity,dz?room.height/2/Math.abs(dz):Infinity);
  group.position.set(dx*t,0,dz*t); group.rotation.y=Math.atan2(dx,dz);
  const material=new THREE.MeshBasicMaterial({color:GATE_COLORS[room.lockType]});
  const metal=new THREE.MeshToonMaterial({color:'#514b48'});
  if(room.lockType==='steamVent') {
    const pipeGeo=new THREE.CylinderGeometry(0.16,0.16,0.7,6),steamGeo=new THREE.IcosahedronGeometry(0.48,0);
    const steam=new THREE.MeshBasicMaterial({color:'#d4d6d0',transparent:true,opacity:0.35,depthWrite:false});
    for(let i=0;i<5;i++) {
      const pipe=new THREE.Mesh(pipeGeo,metal);pipe.position.set((i-2)*0.7,0.4,0);group.add(pipe);
      for(let j=0;j<3;j++){const puff=new THREE.Mesh(steamGeo,steam);puff.position.set((i-2)*0.7,1+j*0.65,0);puff.scale.setScalar(0.7+j*0.3);group.add(puff);}
    }
  } else if(room.lockType==='soundTrap') {
    const frame=new THREE.Mesh(new THREE.BoxGeometry(4,0.15,0.15),metal);frame.position.y=2.8;group.add(frame);
    const bellGeo=new THREE.ConeGeometry(0.24,0.4,6,1,true),threadGeo=new THREE.CylinderGeometry(0.015,0.015,0.6,4);
    for(let i=0;i<5;i++){
      const thread=new THREE.Mesh(threadGeo,metal);thread.position.set((i-2)*0.7,2.45,0);group.add(thread);
      const bell=new THREE.Mesh(bellGeo,material);bell.position.set((i-2)*0.7,2.05,0);group.add(bell);
    }
  } else if(room.lockType==='chasm') {
    const gap=new THREE.Mesh(new THREE.PlaneGeometry(4,1.7),new THREE.MeshBasicMaterial({color:'#080a12'}));
    gap.rotation.x=-Math.PI/2;gap.position.y=0.13;group.add(gap);
    const edgeGeo=new THREE.BoxGeometry(4,0.12,0.18);
    for(const side of [-1,1]){const edge=new THREE.Mesh(edgeGeo,metal);edge.position.set(0,0.16,side*0.85);group.add(edge);}
  } else if(room.lockType==='submerged'||room.lockType==='pitchBlack') {
    const veil=new THREE.Mesh(new THREE.PlaneGeometry(4,3.2),new THREE.MeshBasicMaterial({color:GATE_COLORS[room.lockType],transparent:true,opacity:room.lockType==='pitchBlack'?0.96:0.65,side:THREE.DoubleSide}));
    veil.position.y=1.6;group.add(veil);
    if(room.lockType==='submerged'){
      const rippleGeo=new THREE.TorusGeometry(0.4,0.025,4,16);
      for(let i=0;i<3;i++){const ripple=new THREE.Mesh(rippleGeo,material);ripple.position.set(i-1,0.7+i*0.6,0.04);group.add(ripple);}
    }
  } else {
    const rune=new THREE.Mesh(new THREE.TorusGeometry(0.8,0.06,5,6),material);rune.position.y=1.6;group.add(rune);
    const core=new THREE.Mesh(new THREE.OctahedronGeometry(0.3,0),material);core.position.y=1.6;group.add(core);
  }
  return group;
}
