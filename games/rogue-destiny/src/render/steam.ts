import * as THREE from 'three';
import type { SteamState } from '../core/cooling.ts';
/** Один переиспользуемый облачный буфер; без освещения и загрузок текстур. */
export function createSteamCloud() {
  const geometry=new THREE.BufferGeometry(),positions=new Float32Array(32*3);
  for(let i=0;i<32;i++) {
    const angle=i*2.399963,radius=0.3+(i%7)*0.3;
    positions[i*3]=Math.cos(angle)*radius;positions[i*3+1]=0.3+(i%9)*0.22;positions[i*3+2]=Math.sin(angle)*radius;
  }
  geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
  const material=new THREE.PointsMaterial({color:'#c6dcda',size:0.9,transparent:true,opacity:0.25,depthWrite:false});
  const cloud=new THREE.Points(geometry,material);cloud.visible=false;
  return {cloud,update:(state:SteamState,delta:number,visible:boolean)=>{
    cloud.visible=visible&&state.remaining>0;
    if(!cloud.visible) return;
    cloud.position.set(state.x,0,state.z);cloud.rotation.y+=delta*0.18;
    material.opacity=Math.min(0.28,state.remaining*0.16);
  }};
}
