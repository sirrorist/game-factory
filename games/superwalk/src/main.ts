import * as THREE from 'three';
import { GameFactory, type Session } from '@gf/game-sdk';
import { fillIcons, setIcon } from './icons.ts';
import { Input } from './input.ts';
import { stepPlayer, getTerrainHeight, type PlayerState } from './core/movement.ts';
import { generateWorld, type WorldData } from './core/world.ts';
import './style.css';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Элемент #${id} не найден`);
  return el as T;
};

let toastTimeout: number | undefined;
function toast(message: string, durationMs = 2800, type: 'info' | 'ok' | 'err' = 'info'): void {
  const el = $('toast');
  el.textContent = message;
  el.className = 'gf-toast' + (type === 'ok' ? ' gf-toast--ok' : type === 'err' ? ' gf-toast--err' : '');
  el.hidden = false;
  if (toastTimeout !== undefined) clearTimeout(toastTimeout);
  toastTimeout = window.setTimeout(() => {
    el.hidden = true;
  }, durationMs);
}

class SuperwalkApp {
  private session: Session;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private input: Input;
  private world: WorldData;

  private paused = false;
  private debug = false;

  private playerState: PlayerState = {
    x: 0,
    y: 0,
    z: 0,
    vy: 0,
    grounded: true,
    yaw: 0,
  };
  private runTime = 0;

  private lastTime = performance.now();
  private frameCount = 0;
  private fps = 60;
  private fpsTimer = performance.now();
  private frameTimes: number[] = [];
  private worstFrameMs = 0;
  private slowFramesCount = 0;
  private perfAvgMs = 16.6;
  private perfWorstMs = 16.6;
  private perfSlowPerSec = 0;

  private heroGroup: THREE.Group;
  private tailPivot: THREE.Group;
  private shadowMesh: THREE.Mesh;
  private shadowMat: THREE.MeshBasicMaterial;

  private fullscreenExitAt = -Infinity;
  private wasHostFullscreen = false;

  constructor(session: Session, best: number | null) {
    this.session = session;
    const touchDevice = matchMedia('(pointer: coarse)').matches || ('ontouchstart' in window);

    // 1. WebGL рендерер с соблюдением бюджета (docs/GAME-TZ.md):
    // antialias отключен на тач-устройствах, dpr ограничен до 1.5 на таче и до 2 на ПК.
    this.renderer = new THREE.WebGLRenderer({
      powerPreference: 'high-performance',
      antialias: !touchDevice,
    });
    const maxDpr = touchDevice ? 1.5 : 2.0;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxDpr));
    $('stage').appendChild(this.renderer.domElement);

    // 2. Сцена и камера
    this.scene = new THREE.Scene();
    const skyColor = 0xd8e8f8;
    this.scene.background = new THREE.Color(skyColor);
    this.scene.fog = new THREE.Fog(skyColor, 35, 110);

    this.camera = new THREE.PerspectiveCamera(65, 1, 0.1, 150);
    this.camera.position.set(0, 3.8, 6.2);
    this.camera.lookAt(0, 1.0, 0);

    // 3. Освещение: одна направленная лампа (мягкие тени) и рассеянный свет
    const ambient = new THREE.AmbientLight(0xfff1de, 0.75);
    this.scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xffeed6, 1.3);
    sun.position.set(30, 45, 20);
    this.scene.add(sun);

    // 4. Локация: "Солнечные холмы" - мягкая low-poly поляна 140x140 м
    const groundGeo = new THREE.PlaneGeometry(140, 140, 36, 36);
    groundGeo.rotateX(-Math.PI / 2);
    const pos = groundGeo.attributes['position'];
    if (pos) {
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        const h = getTerrainHeight(x, z);
        pos.setY(i, h);
      }
      groundGeo.computeVertexNormals();
    }
    const groundMat = new THREE.MeshLambertMaterial({
      color: 0x8ec968,
      flatShading: true,
    });
    const groundMesh = new THREE.Mesh(groundGeo, groundMat);
    this.scene.add(groundMesh);

    // 5. Силуэт героя (Лис: лапки на земле y=0, рыжий low-poly лис, хвост с белым кончиком, шарф)
    // Стандарт Three.js: лис изначально смотрит вперёд вглубь экрана (-Z).
    // Мордочка и нос направлены в -Z, пушистый хвост - сзади на +Z.
    this.heroGroup = new THREE.Group();
    this.heroGroup.position.set(0, 0, 0);

    const foxOrange = new THREE.MeshLambertMaterial({ color: 0xff7a1a, flatShading: true });
    const whiteMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
    const scarfMat = new THREE.MeshLambertMaterial({ color: 0x3d7cd8, flatShading: true });
    const darkMat = new THREE.MeshLambertMaterial({ color: 0x221a16, flatShading: true });

    // Лапки (опираются строго на землю y = 0: передние на -Z, задние на +Z)
    const legGeo = new THREE.BoxGeometry(0.12, 0.24, 0.14);
    const legPositions: [number, number, number][] = [
      [-0.15, 0.12, -0.14],
      [0.15, 0.12, -0.14],
      [-0.15, 0.12, 0.12],
      [0.15, 0.12, 0.12],
    ];
    for (const [lx, ly, lz] of legPositions) {
      const leg = new THREE.Mesh(legGeo, darkMat);
      leg.position.set(lx, ly, lz);
      this.heroGroup.add(leg);
    }

    // Тело (расположено над лапками: y от 0.22 до 0.77)
    const bodyGeo = new THREE.CylinderGeometry(0.28, 0.35, 0.55, 7);
    const bodyMesh = new THREE.Mesh(bodyGeo, foxOrange);
    bodyMesh.position.set(0, 0.48, 0);
    this.heroGroup.add(bodyMesh);

    // Голова (смещена вперёд к -Z)
    const headGeo = new THREE.BoxGeometry(0.42, 0.38, 0.44);
    const headMesh = new THREE.Mesh(headGeo, foxOrange);
    headMesh.position.set(0, 0.88, -0.08);
    this.heroGroup.add(headMesh);

    // Мордочка с белым кончиком (направлена вперёд по -Z)
    const muzzleGeo = new THREE.ConeGeometry(0.16, 0.3, 5);
    muzzleGeo.rotateX(-Math.PI / 2);
    const muzzleMesh = new THREE.Mesh(muzzleGeo, whiteMat);
    muzzleMesh.position.set(0, 0.82, -0.38);
    this.heroGroup.add(muzzleMesh);

    const noseMesh = new THREE.Mesh(new THREE.SphereGeometry(0.05, 5, 5), darkMat);
    noseMesh.position.set(0, 0.82, -0.54);
    this.heroGroup.add(noseMesh);

    // Ушки
    const earGeo = new THREE.ConeGeometry(0.1, 0.24, 4);
    const leftEar = new THREE.Mesh(earGeo, foxOrange);
    leftEar.position.set(-0.16, 1.15, -0.05);
    leftEar.rotation.z = 0.2;
    const rightEar = new THREE.Mesh(earGeo, foxOrange);
    rightEar.position.set(0.16, 1.15, -0.05);
    rightEar.rotation.z = -0.2;
    this.heroGroup.add(leftEar, rightEar);

    // Шарф
    const scarfMesh = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.08, 5, 8), scarfMat);
    scarfMesh.rotation.x = Math.PI / 2;
    scarfMesh.position.set(0, 0.72, -0.06);
    this.heroGroup.add(scarfMesh);

    // Хвост (прикреплен сзади к телу на +Z)
    this.tailPivot = new THREE.Group();
    this.tailPivot.position.set(0, 0.36, 0.24);
    const tailBase = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.07, 0.6, 6), foxOrange);
    tailBase.position.set(0, 0.22, 0.22);
    tailBase.rotation.x = 0.8;
    const tailTip = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.32, 6), whiteMat);
    tailTip.position.set(0, 0.52, 0.46);
    tailTip.rotation.x = 0.8;
    this.tailPivot.add(tailBase, tailTip);
    this.heroGroup.add(this.tailPivot);

    this.scene.add(this.heroGroup);

    // 6. Мягкая динамическая тень под лисом на траве (видна на земле даже при прыжке)
    const shadowGeo = new THREE.PlaneGeometry(1.3, 1.3);
    shadowGeo.rotateX(-Math.PI / 2);
    const shadowCanvas = document.createElement('canvas');
    shadowCanvas.width = 64;
    shadowCanvas.height = 64;
    const sctx = shadowCanvas.getContext('2d')!;
    const grad = sctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(18, 38, 12, 0.65)');
    grad.addColorStop(0.55, 'rgba(18, 38, 12, 0.32)');
    grad.addColorStop(1, 'rgba(18, 38, 12, 0)');
    sctx.fillStyle = grad;
    sctx.fillRect(0, 0, 64, 64);
    const shadowTex = new THREE.CanvasTexture(shadowCanvas);
    this.shadowMat = new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      depthWrite: false,
    });
    this.shadowMesh = new THREE.Mesh(shadowGeo, this.shadowMat);
    this.shadowMesh.position.y = 0.02;
    this.scene.add(this.shadowMesh);

    // 7. Окружение: процедурный мир "Солнечные холмы" через InstancedMesh (бюджет вызовов <= 300)
    this.world = generateWorld(1337);
    const dummy = new THREE.Object3D();

    // 7.1 Деревья: стволы (коричневые цилиндры) и кроны (пастельно-зеленые конусы)
    const trunkGeo = new THREE.CylinderGeometry(0.22, 0.32, 2.2, 5);
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x7a5032, flatShading: true });
    const trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, this.world.trees.length);

    const lowerGeo = new THREE.ConeGeometry(1.6, 2.2, 6);
    const lowerMat = new THREE.MeshLambertMaterial({ color: 0x4d9642, flatShading: true });
    const lowerMesh = new THREE.InstancedMesh(lowerGeo, lowerMat, this.world.trees.length);

    const upperGeo = new THREE.ConeGeometry(1.2, 1.8, 6);
    const upperMat = new THREE.MeshLambertMaterial({ color: 0x5ea852, flatShading: true });
    const upperMesh = new THREE.InstancedMesh(upperGeo, upperMat, this.world.trees.length);

    for (let i = 0; i < this.world.trees.length; i++) {
      const t = this.world.trees[i]!;
      const y = getTerrainHeight(t.x, t.z);

      // Ствол
      dummy.position.set(t.x, y + 1.1 * t.scale, t.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(t.scale, t.scale, t.scale);
      dummy.updateMatrix();
      trunkMesh.setMatrixAt(i, dummy.matrix);

      // Нижний ярус хвои
      dummy.position.set(t.x, y + 2.5 * t.scale, t.z);
      dummy.updateMatrix();
      lowerMesh.setMatrixAt(i, dummy.matrix);

      // Верхний ярус хвои
      dummy.position.set(t.x, y + 3.8 * t.scale, t.z);
      dummy.updateMatrix();
      upperMesh.setMatrixAt(i, dummy.matrix);
    }
    trunkMesh.instanceMatrix.needsUpdate = true;
    lowerMesh.instanceMatrix.needsUpdate = true;
    upperMesh.instanceMatrix.needsUpdate = true;
    this.scene.add(trunkMesh, lowerMesh, upperMesh);

    // 7.2 Внутренние камни (low-poly додекаэдры)
    const rockGeo = new THREE.DodecahedronGeometry(1.0, 0);
    const rockMat = new THREE.MeshLambertMaterial({ color: 0xb2aba0, flatShading: true });
    const rockMesh = new THREE.InstancedMesh(rockGeo, rockMat, this.world.rocks.length);
    for (let i = 0; i < this.world.rocks.length; i++) {
      const r = this.world.rocks[i]!;
      const y = getTerrainHeight(r.x, r.z);
      dummy.position.set(r.x, y + 0.5 * r.scale, r.z);
      dummy.rotation.set(0, r.rotY, 0);
      dummy.scale.set(r.scale, 0.8 * r.scale, r.scale);
      dummy.updateMatrix();
      rockMesh.setMatrixAt(i, dummy.matrix);
    }
    rockMesh.instanceMatrix.needsUpdate = true;
    this.scene.add(rockMesh);

    // 7.3 Граничные скалы по периметру (массивные валуны)
    const boundaryMat = new THREE.MeshLambertMaterial({ color: 0x8c867d, flatShading: true });
    const boundaryMesh = new THREE.InstancedMesh(rockGeo, boundaryMat, this.world.boundaryRocks.length);
    for (let i = 0; i < this.world.boundaryRocks.length; i++) {
      const br = this.world.boundaryRocks[i]!;
      const y = getTerrainHeight(br.x, br.z);
      dummy.position.set(br.x, y + 1.2 * br.scale, br.z);
      dummy.rotation.set(0, br.rotY, 0);
      dummy.scale.set(br.scale, 1.4 * br.scale, br.scale);
      dummy.updateMatrix();
      boundaryMesh.setMatrixAt(i, dummy.matrix);
    }
    boundaryMesh.instanceMatrix.needsUpdate = true;
    this.scene.add(boundaryMesh);

    // 7.4 Декоративные пучки травы
    const grassGeo = new THREE.ConeGeometry(0.35, 0.6, 3);
    const grassMat = new THREE.MeshLambertMaterial({ color: 0xa2e055, flatShading: true });
    const grassMesh = new THREE.InstancedMesh(grassGeo, grassMat, this.world.grassClumps.length);
    for (let i = 0; i < this.world.grassClumps.length; i++) {
      const g = this.world.grassClumps[i]!;
      const y = getTerrainHeight(g.x, g.z);
      dummy.position.set(g.x, y + 0.25 * g.scale, g.z);
      dummy.rotation.set(0, g.rotY, 0);
      dummy.scale.set(g.scale, g.scale, g.scale);
      dummy.updateMatrix();
      grassMesh.setMatrixAt(i, dummy.matrix);
    }
    grassMesh.instanceMatrix.needsUpdate = true;
    this.scene.add(grassMesh);

    // 8. Контроллер ввода (ПК и телефон)
    this.input = new Input(this.renderer.domElement, {
      pause: () => this.openMenu(),
      lockLost: () => {
        if (performance.now() - this.fullscreenExitAt < 700) {
          toast('Полный экран выключен — кликни, чтобы продолжить', 2500);
        } else {
          this.openMenu();
        }
      },
      gesture: () => undefined,
      toggleDebug: () => this.toggleDebug(),
    });
    if (touchDevice) this.input.enableTouch();

    fillIcons(document);

    $('mode').textContent = session.mode === 'hub' ? 'в хабе' : 'без хаба';
    $('best').textContent = best === null ? '-' : String(best);

    new ResizeObserver(() => this.resize()).observe($('app'));
    this.resize();

    this.bindUi();

    requestAnimationFrame((t) => this.tick(t));
  }

  private bindUi(): void {
    $('btn-menu').addEventListener('click', () => this.toggleMenu());
    $('btn-resume').addEventListener('click', () => this.closeMenu());
    $('btn-debug-toggle').addEventListener('click', () => this.toggleDebug());

    if (document.fullscreenEnabled) {
      $('btn-fs').hidden = false;
      $('btn-menu-fs').hidden = false;
      $('btn-fs').addEventListener('click', () => void this.toggleFullscreen());
      $('btn-menu-fs').addEventListener('click', () => void this.toggleFullscreen());
      document.addEventListener('fullscreenchange', () => {
        if (!document.fullscreenElement) this.fullscreenExitAt = performance.now();
        this.syncFullscreenButtons();
      });
      this.syncFullscreenButtons();
    }

    window.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.code === 'Escape') {
        e.preventDefault();
        if (performance.now() - this.fullscreenExitAt < 700) {
          toast('Полный экран выключен', 2000);
        } else {
          this.toggleMenu();
        }
      }
    });
  }

  private isHostFullscreen(): boolean {
    return !document.fullscreenElement && window.innerWidth >= screen.width - 2 && window.innerHeight >= screen.height - 2;
  }

  private syncFullscreenButtons(): void {
    const isFs = !!document.fullscreenElement;
    const name = isFs ? 'exit-fullscreen' : 'fullscreen';
    setIcon($('btn-fs'), name);
    setIcon($('btn-menu-fs'), name);
    $('fs-label').textContent = isFs ? 'Выйти из полноэкранного' : 'На весь экран';
    $('btn-fs').title = isFs ? 'Выйти из полноэкранного режима' : 'На весь экран';
  }

  private async toggleFullscreen(): Promise<void> {
    if (document.fullscreenElement) {
      try {
        screen.orientation?.unlock();
      } catch {
        // Игнорируем
      }
      try {
        await document.exitFullscreen();
      } catch (e) {
        toast(`Не удалось выйти (${e instanceof Error ? e.name : 'ошибка'})`, 3000, 'err');
      }
      return;
    }

    if (this.isHostFullscreen()) {
      toast('Полный экран уже включен хабом — выход: кнопка "Назад" или Esc', 3500);
      return;
    }

    try {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      if (this.input.touchMode) {
        const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
        try {
          await o.lock?.('landscape');
        } catch {
          // Игнорируем
        }
      }
    } catch (e) {
      toast(`Полный экран недоступен (${e instanceof Error ? e.name : 'ошибка'})`, 3500, 'err');
    }
  }

  private toggleMenu(): void {
    if (this.paused) this.closeMenu();
    else this.openMenu();
  }

  private openMenu(): void {
    this.paused = true;
    this.input.active = false;
    this.input.unlock();
    $('menu').hidden = false;
  }

  private closeMenu(): void {
    this.paused = false;
    this.input.active = true;
    $('menu').hidden = true;
  }

  private toggleDebug(): void {
    this.debug = !this.debug;
    $('debug').hidden = !this.debug;
    $('debug-label').textContent = `Показатели: ${this.debug ? 'вкл' : 'выкл'}`;
    toast(this.debug ? 'Показатели F3 включены' : 'Показатели F3 выключены', 1500);
    if (this.debug) this.updateDebug();
  }

  private resize(): void {
    const el = $('app');
    const w = Math.max(1, el.clientWidth);
    const h = Math.max(1, el.clientHeight);
    this.renderer.setSize(w, h, false);

    const host = this.isHostFullscreen();
    if (this.wasHostFullscreen && !host) this.fullscreenExitAt = performance.now();
    this.wasHostFullscreen = host;

    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private tick(time: number): void {
    requestAnimationFrame((t) => this.tick(t));

    // Строго через dt с ограничением потолка 0.05 с (GAME-TZ.md)
    const dt = Math.min((time - this.lastTime) / 1000, 0.05);
    const frameMs = time - this.lastTime;
    this.lastTime = time;

    this.frameCount++;
    this.frameTimes.push(frameMs);
    if (frameMs > this.worstFrameMs) this.worstFrameMs = frameMs;
    if (frameMs > 25) this.slowFramesCount++;

    if (time - this.fpsTimer >= 1000) {
      this.fps = this.frameCount;
      const sum = this.frameTimes.reduce((acc, v) => acc + v, 0);
      this.perfAvgMs = this.frameTimes.length > 0 ? sum / this.frameTimes.length : 16.6;
      this.perfWorstMs = this.worstFrameMs;
      this.perfSlowPerSec = this.slowFramesCount;

      this.frameCount = 0;
      this.worstFrameMs = 0;
      this.slowFramesCount = 0;
      this.frameTimes.length = 0;
      this.fpsTimer = time;
    }

    if (!this.paused) {
      // 1. Движение лиса через чистую функцию физики stepPlayer с учётом коллизий ROCKS и холмов
      const move = this.input.move();
      const jump = this.input.jump();
      this.playerState = stepPlayer(
        this.playerState,
        {
          forward: move.forward,
          strafe: move.strafe,
          jump,
          yaw: this.input.yaw,
        },
        dt,
        undefined,
        this.world.obstacles,
        getTerrainHeight,
      );

      // 2. Позиция 3D-модели лиса
      this.heroGroup.position.set(this.playerState.x, this.playerState.y, this.playerState.z);

      // 3. Динамическая тень на земле (проекция на рельеф под ногами)
      this.shadowMesh.position.x = this.playerState.x;
      this.shadowMesh.position.z = this.playerState.z;
      const groundY = getTerrainHeight(this.playerState.x, this.playerState.z);
      this.shadowMesh.position.y = groundY + 0.02;
      const jumpDelta = Math.max(0, this.playerState.y - groundY);
      const shadowScale = Math.max(0.35, 1.0 - jumpDelta * 0.35);
      this.shadowMesh.scale.set(shadowScale, shadowScale, shadowScale);
      this.shadowMat.opacity = Math.max(0.12, 0.65 - jumpDelta * 0.28);

      const moveLen = Math.hypot(move.strafe, move.forward);
      if (moveLen > 0.05) {
        this.runTime += dt;
        // Направление бега в мире относительно взгляда камеры (-Z - вперёд, +X - вправо)
        const sin = Math.sin(this.input.yaw);
        const cos = Math.cos(this.input.yaw);
        const moveX = -move.forward * sin + move.strafe * cos;
        const moveZ = -move.forward * cos - move.strafe * sin;
        // В Three.js rotation.y вокруг +Y: (0, 0, -1) переходит в (-sin(θ), -cos(θ)).
        // Чтобы модель смотрела по (moveX, moveZ): sin(θ) = -moveX, cos(θ) = -moveZ.
        const targetAngle = Math.atan2(-moveX, -moveZ);

        let diff = targetAngle - this.heroGroup.rotation.y;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        this.heroGroup.rotation.y += diff * Math.min(1, dt * 14);

        // Анимация бега: покачивание тела и быстрое махание хвостом
        this.heroGroup.position.y = this.playerState.y + Math.abs(Math.sin(this.runTime * 14)) * 0.06;
        this.tailPivot.rotation.y = Math.sin(this.runTime * 16) * 0.45;
        this.tailPivot.rotation.z = Math.cos(this.runTime * 14) * 0.15;
      } else {
        this.heroGroup.position.y = this.playerState.y;
        this.tailPivot.rotation.y = Math.sin(time * 0.003) * 0.25;
        this.tailPivot.rotation.z = Math.cos(time * 0.002) * 0.08;
      }

      // 4. Камера от третьего лица (следит за лисом с расстояния 6.2 м сзади: +Z при yaw=0)
      const camDist = 6.2;
      const cy = this.playerState.y + 1.3 + Math.sin(this.input.pitch) * camDist;
      const cx = this.playerState.x + Math.sin(this.input.yaw) * Math.cos(this.input.pitch) * camDist;
      const cz = this.playerState.z + Math.cos(this.input.yaw) * Math.cos(this.input.pitch) * camDist;
      this.camera.position.set(cx, Math.max(0.5, cy), cz);
      this.camera.lookAt(this.playerState.x, this.playerState.y + 1.0, this.playerState.z);
    }

    this.renderer.render(this.scene, this.camera);

    if (this.debug && this.frameCount % 10 === 0) {
      this.updateDebug();
    }
  }

  private updateDebug(): void {
    const info = this.renderer.info.render;
    const mem = this.renderer.info.memory;
    const el = this.renderer.domElement;
    const p = this.playerState;
    $('debug').textContent = [
      `fps ${this.fps} · кадр ${this.perfAvgMs.toFixed(1)} мс, худший ${this.perfWorstMs.toFixed(0)} мс · рывков ${this.perfSlowPerSec}/с`,
      `экран ${el.width}×${el.height} · dpr ${this.renderer.getPixelRatio().toFixed(2)} · тач ${this.input.touchMode ? 'да' : 'нет'}`,
      `вызовов ${info.calls} · треугольников ${info.triangles} · геометрий ${mem.geometries}`,
      `xyz ${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.z.toFixed(1)} · vy ${p.vy.toFixed(1)} · земля ${p.grounded ? 'да' : 'нет'}`,
      `мышь ${this.input.mouseStats.events} соб/с · макс шаг ${this.input.mouseStats.maxStep} px`,
    ].join('\n');
  }
}

// Запуск без top-level await (офлайн-режим IIFE)
async function main(): Promise<void> {
  const session = await GameFactory.init({ gameId: __GF_GAME_ID__ });
  const best = await session.bestScore();

  new SuperwalkApp(session, best);

  // session.ready() вызывается ТОЛЬКО когда сцена, интерфейс и обработчики полностью готовы к вводу
  session.ready();
}

void main();
