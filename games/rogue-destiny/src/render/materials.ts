/**
 * Генератор Cel-Shaded / Toon материалов для стиля Souls-Comic.
 * Все текстуры генерируются процедурно в Canvas (без внешних файлов).
 */
import * as THREE from 'three';

export function createToonGradientMap(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 1;
  const ctx = canvas.getContext('2d')!;

  // 4 тона освещения для эффекта чернильной штриховки комикса
  ctx.fillStyle = '#222630'; // Тень
  ctx.fillRect(0, 0, 1, 1);
  ctx.fillStyle = '#485569'; // Полутень
  ctx.fillRect(1, 0, 1, 1);
  ctx.fillStyle = '#8b9bb4'; // Средний тон
  ctx.fillRect(2, 0, 1, 1);
  ctx.fillStyle = '#e2e8f0'; // Блик
  ctx.fillRect(3, 0, 1, 1);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  return texture;
}

export function createCryptMaterials() {
  const gradientMap = createToonGradientMap();

  // Камень сводов и колонн
  const stone = new THREE.MeshToonMaterial({
    color: '#2a3342',
    gradientMap,
  });

  // Каменные плиты пола
  const floor = new THREE.MeshToonMaterial({
    color: '#1a222d',
    gradientMap,
  });

  // Вековые корни Сильванов
  const roots = new THREE.MeshToonMaterial({
    color: '#3d2b1f',
    gradientMap,
  });

  // Вода затопленных крипт
  const water = new THREE.MeshStandardMaterial({
    color: '#0e1e2d',
    roughness: 0.1,
    metalness: 0.2,
    transparent: true,
    opacity: 0.85,
  });

  // Мантия и одежда мага
  const mageCloth = new THREE.MeshToonMaterial({
    color: '#1e2430',
    gradientMap,
  });

  // Посох мага
  const staffWood = new THREE.MeshToonMaterial({
    color: '#42281a',
    gradientMap,
  });

  // Эфирный кристалл (лазурный свет)
  const aetherCrystal = new THREE.MeshBasicMaterial({
    color: '#38bdf8',
  });

  // Враг: Сильван (древесная кора)
  const sylvanBark = new THREE.MeshToonMaterial({
    color: '#29442a',
    gradientMap,
  });

  return {
    gradientMap,
    stone,
    floor,
    roots,
    water,
    mageCloth,
    staffWood,
    aetherCrystal,
    sylvanBark,
  };
}
