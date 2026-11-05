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

function stonePattern(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#26303a'; ctx.fillRect(0, 0, 128, 128);
  for (let row = 0; row < 4; row++) for (let col = -1; col < 4; col++) {
    const x = col * 32 + (row % 2) * 16;
    const tone = 130 + ((row * 37 + (col + 1) * 19) % 35);
    ctx.fillStyle = `rgb(${tone - 12},${tone},${tone + 8})`;
    ctx.fillRect(x + 1, row * 32 + 1, 30, 30);
    ctx.fillStyle = '#bcc6c855'; ctx.fillRect(x + 2, row * 32 + 2, 28, 1);
    ctx.fillStyle = '#17232b44'; ctx.fillRect(x + 3, row * 32 + 28, 27, 2);
    for (let grain = 0; grain < 10; grain++) {
      ctx.fillStyle = grain % 2 ? '#34434b33' : '#d1d7d122';
      ctx.fillRect(x + 3 + (grain * 7 + row * 5) % 25, row * 32 + 3 + (grain * 13 + col * 3 + 100) % 24, 2, 1);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(3, 3);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
function ripplePattern(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d')!; const pixels = ctx.createImageData(64, 64);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const i = (y * 64 + x) * 4;
    pixels.data[i] = 128 + Math.round(Math.sin((x + y * 2) * Math.PI / 16) * 22);
    pixels.data[i + 1] = 128 + Math.round(Math.cos((y - x) * Math.PI / 16) * 22);
    pixels.data[i + 2] = 250; pixels.data[i + 3] = 255;
  }
  ctx.putImageData(pixels, 0, 0);
  const texture = new THREE.CanvasTexture(canvas); texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(80, 80);
  return texture;
}
export function createCryptMaterials() {
  const gradientMap = createToonGradientMap();
  const floorTexture = stonePattern();
  const waterNormal = ripplePattern();

  // Камень сводов и колонн
  const stone = new THREE.MeshToonMaterial({
    color: '#2a3342',
    gradientMap,
  });

  // Каменные плиты пола
  const floor = new THREE.MeshToonMaterial({
    color: '#647480',
    map: floorTexture,
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
    roughness: 0.25,
    normalMap: waterNormal,
    normalScale: new THREE.Vector2(0.35, 0.35),
    depthWrite: false,
    metalness: 0.2,
    transparent: true,
    opacity: 0.48,
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
    floorTexture,
    waterNormal,
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
