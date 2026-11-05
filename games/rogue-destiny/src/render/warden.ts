/** Kenney Keeper CC0: переосмысленный каменно-древесный Страж, руки на отдельных pivots. */
import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import keeperSource from '../assets/kenney/character-keeper.obj?raw';
import type { createCryptMaterials } from './materials.ts';

export function createWardenModel(materials: ReturnType<typeof createCryptMaterials>): { model: THREE.Group; left: THREE.Group; right: THREE.Group; baseY: number } {
  const model = new OBJLoader().parse(keeperSource);
  const bounds = new THREE.Box3().setFromObject(model);
  const scale = 2.1 / Math.max(0.01, bounds.max.y - bounds.min.y);
  model.scale.setScalar(scale); model.position.y = -bounds.min.y * scale;
  const bark = new THREE.MeshToonMaterial({ color: '#435447', gradientMap: materials.gradientMap });
  const armor = new THREE.MeshToonMaterial({ color: '#52616b', gradientMap: materials.gradientMap });
  model.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    node.material = node.name === 'torso' || node.name === 'head' ? armor : bark;
    node.castShadow = true; node.receiveShadow = true;
  });
  const pivot = (name: string): THREE.Group => {
    const joint = new THREE.Group(); const mesh = model.getObjectByName(name);
    if (mesh instanceof THREE.Mesh) {
      mesh.geometry.computeBoundingBox();
      const box = mesh.geometry.boundingBox!;
      const x = (box.min.x + box.max.x) / 2, y = box.max.y, z = (box.min.z + box.max.z) / 2;
      mesh.geometry = mesh.geometry.clone(); mesh.geometry.translate(-x, -y, -z);
      mesh.position.set(0, 0, 0); joint.position.set(x, y, z); joint.add(mesh);
    }
    model.add(joint); return joint;
  };
  return { model, left: pivot('arm-left'), right: pivot('arm-right'), baseY: model.position.y };
}
