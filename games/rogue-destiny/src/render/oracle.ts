import * as THREE from 'three';
import { createCryptProp } from './props.ts';
import { ORACLE_ARENA_RADIUS } from '../core/oracle.ts';
import type { DungeonRoom } from '../core/types.ts';

/** Выжженный лес иллюзии: общие геометрии, без дополнительных источников света. */
export function createOracle(room: DungeonRoom) {
  const group = new THREE.Group();
  const center = new THREE.Vector3(room.x, 0, room.y);
  const material = new THREE.MeshToonMaterial({ color: '#96a8bf', transparent: true, opacity: 0.8 });
  const ghost = createCryptProp(5, material, 2.4); ghost.position.set(room.x, 0.5, room.y); group.add(ghost);
  ghost.rotation.y = -Math.PI / 2;
  const nightmare = new THREE.Group(); nightmare.position.copy(center); nightmare.visible = false; group.add(nightmare);
  const ash = new THREE.Mesh(new THREE.CircleGeometry(ORACLE_ARENA_RADIUS + 8, 48), new THREE.MeshToonMaterial({ color: '#30232e' }));
  ash.rotation.x = -Math.PI / 2; ash.position.y = 0.12; nightmare.add(ash);
  const emberMaterial = new THREE.MeshBasicMaterial({ color: '#bf573d' });
  const border = new THREE.Mesh(new THREE.RingGeometry(ORACLE_ARENA_RADIUS, ORACLE_ARENA_RADIUS + 0.12, 64), emberMaterial);
  border.rotation.x = -Math.PI / 2; border.position.y = 0.14; nightmare.add(border);
  const bark = new THREE.MeshToonMaterial({ color: '#171923' });
  const trunkGeometry = new THREE.CylinderGeometry(0.12, 0.36, 4, 5);
  const branchGeometry = new THREE.CylinderGeometry(0.04, 0.14, 1.8, 5);
  const dummy = new THREE.Object3D();
  const trunks = new THREE.InstancedMesh(trunkGeometry, bark, 18);
  const branches = new THREE.InstancedMesh(branchGeometry, bark, 36);
  for (let i = 0; i < 18; i++) {
    const angle = i * Math.PI * 2 / 18, radius = 7 + Math.sin(i * 5.3) * 0.7;
    const height = 0.8 + (i % 4) * 0.17;
    dummy.position.set(Math.cos(angle) * radius, height * 2, Math.sin(angle) * radius);
    dummy.rotation.set(Math.sin(i) * 0.12, angle, Math.cos(i) * 0.1); dummy.scale.set(1, height, 1); dummy.updateMatrix(); trunks.setMatrixAt(i, dummy.matrix);
    for (let side = 0; side < 2; side++) {
      dummy.position.y = height * (2.2 + side * 0.8);
      dummy.rotation.set(0, angle + side * Math.PI, 0.8 + side * 0.4); dummy.scale.set(1,1,1); dummy.updateMatrix(); branches.setMatrixAt(i * 2 + side, dummy.matrix);
    }
  }
  nightmare.add(trunks, branches);
  const particleGeometry = new THREE.BufferGeometry();
  const positions = new Float32Array(48 * 3);
  for (let i = 0; i < 48; i++) {
    const angle = i * 2.399963, radius = 1 + (i % 11) * 0.6;
    positions[i*3] = Math.cos(angle)*radius; positions[i*3+1] = 0.5 + (i%13)*0.28; positions[i*3+2] = Math.sin(angle)*radius;
  }
  particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions,3));
  const embers = new THREE.Points(particleGeometry, new THREE.PointsMaterial({ color: '#e7a581', size: 0.045, transparent: true, opacity: 0.7, depthWrite: false }));
  nightmare.add(embers);
  const geometry = new THREE.OctahedronGeometry(0.45, 0);
  const nodeMaterial = new THREE.MeshBasicMaterial({ color: '#d9acff' });
  const haloGeometry = new THREE.RingGeometry(0.6,0.68,24);
  const nodes = Array.from({ length: 3 }, (_, index) => {
    const angle = index * Math.PI * 2 / 3;
    const node = new THREE.Mesh(geometry, nodeMaterial);
    node.position.set(room.x + Math.cos(angle) * 4, 1.1, room.y + Math.sin(angle) * 4);
    const halo = new THREE.Mesh(haloGeometry, new THREE.MeshBasicMaterial({ color: '#9d6cbf', side: THREE.DoubleSide }));
    halo.rotation.x = Math.PI / 2; node.add(halo);
    node.visible = false; group.add(node); return node;
  });
  return { group, ghost, nodes, center, nightmare, embers };
}
