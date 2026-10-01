// Небо: смена дня и ночи, солнце и луна, звёзды, облака, туман. Всё следует за камерой.

import * as THREE from 'three';

const DAY = new THREE.Color(0x8ec5ff);
const NIGHT = new THREE.Color(0x0a0f24);
const DUSK = new THREE.Color(0xf08a4b);
const UNDERWATER = new THREE.Color(0x1d4a8a);

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export interface SkyState {
  /** Множитель яркости мира, от ~0,2 ночью до 1 днём. */
  daylight: number;
}

export class Sky {
  private readonly scene: THREE.Scene;
  private readonly fog: THREE.Fog;
  private readonly color = new THREE.Color();
  private readonly sun: THREE.Mesh;
  private readonly moon: THREE.Mesh;
  private readonly stars: THREE.Points;
  private readonly clouds: THREE.Mesh;
  private readonly cloudTex: THREE.CanvasTexture;
  private readonly cloudMat: THREE.MeshBasicMaterial;
  private drift = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.fog = new THREE.Fog(DAY.getHex(), 40, 80);
    scene.fog = this.fog;
    scene.background = this.color;

    const disc = (size: number, color: number): THREE.Mesh => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(size, size),
        new THREE.MeshBasicMaterial({ color, fog: false, depthWrite: false, transparent: true }),
      );
      m.renderOrder = -2;
      scene.add(m);
      return m;
    };
    this.sun = disc(48, 0xfff1b0);
    this.moon = disc(30, 0xdfe7f2);

    const pts = new Float32Array(900 * 3);
    let r = 7;
    const rand = (): number => ((r = (r * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 900; i++) {
      const u = rand() * 2 - 1;
      const t = rand() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      pts.set([Math.cos(t) * s * 380, u * 380, Math.sin(t) * s * 380], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    this.stars = new THREE.Points(
      g,
      new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, fog: false, depthWrite: false }),
    );
    this.stars.renderOrder = -3;
    scene.add(this.stars);

    // Облака - пиксельная карта по порогу шума; к краю плоскости растворяются через альфу вершин.
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(64, 64);
    let seed = 99;
    const rnd = (): number => ((seed = (seed * 48271) % 2147483647) / 2147483647);
    const grid = new Float32Array(16 * 16).map(() => rnd());
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        // Значение шума - билинейно из сетки 16×16 с повтором по краям.
        const gx = x / 4, gy = y / 4;
        const x0 = Math.floor(gx), y0 = Math.floor(gy);
        const fx = gx - x0, fy = gy - y0;
        const at = (i: number, j: number): number => grid[(i & 15) + (j & 15) * 16]!;
        const v = (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
        const k = (x + y * 64) * 4;
        img.data[k] = img.data[k + 1] = img.data[k + 2] = 255;
        img.data[k + 3] = v > 0.62 ? 230 : 0;
      }
    }
    ctx.putImageData(img, 0, 0);
    this.cloudTex = new THREE.CanvasTexture(c);
    this.cloudTex.magFilter = THREE.NearestFilter;
    this.cloudTex.minFilter = THREE.NearestFilter;
    this.cloudTex.generateMipmaps = false;
    this.cloudTex.wrapS = THREE.RepeatWrapping;
    this.cloudTex.wrapT = THREE.RepeatWrapping;
    const SIZE = 900;
    this.cloudTex.repeat.set(SIZE / (64 * 10), SIZE / (64 * 10));
    const cg = new THREE.PlaneGeometry(SIZE, SIZE, 18, 18);
    const pos = cg.getAttribute('position');
    const alpha = new Float32Array(pos.count * 4);
    for (let i = 0; i < pos.count; i++) {
      const d = Math.hypot(pos.getX(i), pos.getY(i));
      alpha.set([1, 1, 1, 1 - smoothstep(120, SIZE / 2, d)], i * 4);
    }
    cg.setAttribute('color', new THREE.BufferAttribute(alpha, 4));
    this.cloudMat = new THREE.MeshBasicMaterial({
      map: this.cloudTex, transparent: true, vertexColors: true, side: THREE.DoubleSide, depthWrite: false, fog: false,
    });
    this.clouds = new THREE.Mesh(cg, this.cloudMat);
    this.clouds.rotation.x = -Math.PI / 2;
    this.clouds.renderOrder = 2;
    scene.add(this.clouds);
  }

  /** time: 0 - полночь, 0,25 - рассвет, 0,5 - полдень, 0,75 - закат. */
  update(time: number, camera: THREE.Camera, viewBlocks: number, underwater: boolean, dt: number): SkyState {
    const angle = (time - 0.25) * Math.PI * 2;
    const elev = Math.sin(angle);
    const dir = new THREE.Vector3(Math.cos(angle), elev, 0.25).normalize();
    const cam = camera.position;

    this.color.copy(NIGHT).lerp(DAY, smoothstep(-0.2, 0.3, elev));
    const dusk = Math.exp(-((elev / 0.14) ** 2)) * 0.55;
    this.color.lerp(DUSK, dusk);

    this.sun.position.copy(cam).addScaledVector(dir, 320);
    this.sun.lookAt(cam);
    this.moon.position.copy(cam).addScaledVector(dir, -320);
    this.moon.lookAt(cam);
    // За краем видимого мира земли нет: светило под горизонтом было бы видно сквозь пустоту.
    this.sun.visible = elev > -0.12;
    this.moon.visible = elev < 0.12;
    this.stars.position.copy(cam);
    this.stars.rotation.z = angle;
    (this.stars.material as THREE.PointsMaterial).opacity = 1 - smoothstep(-0.25, 0.1, elev);

    const daylight = 0.22 + 0.78 * smoothstep(-0.18, 0.25, elev);

    this.drift += dt * 1.2;
    const S = 64 * 10;
    this.clouds.position.set(cam.x, 108, cam.z);
    this.cloudTex.offset.set((cam.x + this.drift) / S, -cam.z / S);
    this.cloudMat.color.setScalar(0.35 + 0.65 * daylight);

    if (underwater) {
      this.color.copy(UNDERWATER).multiplyScalar(0.4 + 0.6 * daylight);
      this.fog.near = 1;
      this.fog.far = 20;
    } else {
      this.fog.near = viewBlocks * 0.55;
      this.fog.far = viewBlocks;
    }
    this.fog.color.copy(this.color);
    this.scene.background = this.color;
    return { daylight };
  }
}
