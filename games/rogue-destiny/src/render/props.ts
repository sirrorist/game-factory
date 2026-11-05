/** Модели Kenney CC0: локальные исходники и материалы Souls-Comic. */
import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import stoneSource from '../assets/kenney/gravestone-broken.obj?raw';
import obeliskSource from '../assets/kenney/pillar-obelisk.obj?raw';
import rocksSource from '../assets/kenney/rocks.obj?raw';
import cryptSource from '../assets/kenney/crypt-small.obj?raw';
import ghostSource from '../assets/kenney/character-ghost.obj?raw';
import coffinSource from '../assets/kenney/coffin-old.obj?raw';

const sources = [stoneSource, obeliskSource, rocksSource, cryptSource, coffinSource, ghostSource];
const templates: THREE.Group[] = [];

export function createCryptProp(kind: number, material: THREE.Material, height: number): THREE.Group {
  const index = kind % sources.length;
  if (!templates[index]) templates[index] = new OBJLoader().parse(sources[index]!);
  const group = templates[index]!.clone(true);
  group.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      node.material = material;
      node.castShadow = true;
      node.receiveShadow = true;
    }
  });
  const bounds = new THREE.Box3().setFromObject(group);
  const size = bounds.getSize(new THREE.Vector3());
  const scale = height / Math.max(0.01, size.y);
  group.scale.setScalar(scale);
  // Опорная точка всегда на полу, независимо от исходного origin модели.
  group.position.y = -bounds.min.y * scale;
  return group;
}
