import * as THREE from 'three';
import { GameFactory, type Session } from '@gf/game-sdk';
import { fillIcons, setIcon } from './icons.ts';
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
  private touchDevice: boolean;

  private paused = false;
  private debug = false;

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
  private fullscreenExitAt = -Infinity;
  private wasHostFullscreen = false;

  constructor(session: Session, best: number | null) {
    this.session = session;
    this.touchDevice = matchMedia('(pointer: coarse)').matches || ('ontouchstart' in window);

    // 1. WebGL рендерер с соблюдением бюджета (docs/GAME-TZ.md):
    // antialias отключен на тач-устройствах, dpr ограничен до 1.5 на таче и до 2 на ПК.
    this.renderer = new THREE.WebGLRenderer({
      powerPreference: 'high-performance',
      antialias: !this.touchDevice,
    });
    const maxDpr = this.touchDevice ? 1.5 : 2.0;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxDpr));
    $('stage').appendChild(this.renderer.domElement);

    // 2. Сцена и камера
    this.scene = new THREE.Scene();
    // Пастельный градиент / туман с 35 м (DESIGN.md, раздел 6)
    const skyColor = 0xd8e8f8;
    this.scene.background = new THREE.Color(skyColor);
    this.scene.fog = new THREE.Fog(skyColor, 35, 110);

    this.camera = new THREE.PerspectiveCamera(65, 1, 0.1, 150);
    this.camera.position.set(0, 4.2, 7.5);
    this.camera.lookAt(0, 1.2, 0);

    // 3. Освещение: одна направленная лампа (мягкие тени) и рассеянный свет
    const ambient = new THREE.AmbientLight(0xfff1de, 0.75);
    this.scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xffeed6, 1.3);
    sun.position.set(30, 45, 20);
    this.scene.add(sun);

    // 4. Локация: "Солнечные холмы" - мягкая low-poly поляна 140x140 м (высота холмов <= 2 м)
    const groundGeo = new THREE.PlaneGeometry(140, 140, 36, 36);
    groundGeo.rotateX(-Math.PI / 2);
    const pos = groundGeo.attributes['position'];
    if (pos) {
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        // Небольшие холмы по краям, центр ровнее
        const dist = Math.sqrt(x * x + z * z);
        const factor = Math.min(dist / 40, 1.0);
        const h = (Math.sin(x * 0.08) * Math.cos(z * 0.08) * 1.6 + Math.sin(x * 0.03 + z * 0.04) * 1.0) * factor;
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

    // 5. Силуэт героя (Лис: рыжий low-poly лис, хвост с белым кончиком, шарф)
    this.heroGroup = new THREE.Group();
    this.heroGroup.position.set(0, 0.9, 0);

    const foxOrange = new THREE.MeshLambertMaterial({ color: 0xff7a1a, flatShading: true });
    const whiteMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
    const scarfMat = new THREE.MeshLambertMaterial({ color: 0x3d7cd8, flatShading: true });
    const noseMat = new THREE.MeshLambertMaterial({ color: 0x222222, flatShading: true });

    // Тело
    const bodyGeo = new THREE.CylinderGeometry(0.32, 0.38, 0.85, 7);
    const bodyMesh = new THREE.Mesh(bodyGeo, foxOrange);
    this.heroGroup.add(bodyMesh);

    // Голова
    const headGeo = new THREE.BoxGeometry(0.5, 0.45, 0.52);
    const headMesh = new THREE.Mesh(headGeo, foxOrange);
    headMesh.position.set(0, 0.58, 0.1);
    this.heroGroup.add(headMesh);

    // Мордочка с белым кончиком
    const muzzleGeo = new THREE.ConeGeometry(0.2, 0.35, 5);
    muzzleGeo.rotateX(Math.PI / 2);
    const muzzleMesh = new THREE.Mesh(muzzleGeo, whiteMat);
    muzzleMesh.position.set(0, 0.52, 0.46);
    this.heroGroup.add(muzzleMesh);

    const noseMesh = new THREE.Mesh(new THREE.SphereGeometry(0.06, 5, 5), noseMat);
    noseMesh.position.set(0, 0.52, 0.65);
    this.heroGroup.add(noseMesh);

    // Ушки
    const earGeo = new THREE.ConeGeometry(0.12, 0.28, 4);
    const leftEar = new THREE.Mesh(earGeo, foxOrange);
    leftEar.position.set(-0.2, 0.9, 0.05);
    leftEar.rotation.z = 0.2;
    const rightEar = new THREE.Mesh(earGeo, foxOrange);
    rightEar.position.set(0.2, 0.9, 0.05);
    rightEar.rotation.z = -0.2;
    this.heroGroup.add(leftEar, rightEar);

    // Шарф
    const scarfMesh = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.1, 5, 8), scarfMat);
    scarfMesh.rotation.x = Math.PI / 2;
    scarfMesh.position.set(0, 0.36, 0.08);
    this.heroGroup.add(scarfMesh);

    // Хвост (привязан к опорной точке tailPivot)
    this.tailPivot = new THREE.Group();
    this.tailPivot.position.set(0, -0.15, -0.32);
    const tailBase = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.08, 0.7, 6), foxOrange);
    tailBase.position.set(0, 0.25, -0.25);
    tailBase.rotation.x = -0.8;
    const tailTip = new THREE.Mesh(new THREE.ConeGeometry(0.19, 0.38, 6), whiteMat);
    tailTip.position.set(0, 0.58, -0.52);
    tailTip.rotation.x = -0.8;
    this.tailPivot.add(tailBase, tailTip);
    this.heroGroup.add(this.tailPivot);

    this.scene.add(this.heroGroup);

    // 6. Окружение: несколько камней low-poly
    const stoneMat = new THREE.MeshLambertMaterial({ color: 0xb8b2a7, flatShading: true });
    const stoneGeo = new THREE.DodecahedronGeometry(0.65, 0);
    const rockPositions: [number, number, number][] = [
      [-6, 0.2, -4],
      [5, 0.2, -6],
      [-4, 0.2, 6],
      [7, 0.2, 4],
    ];
    for (const [rx, ry, rz] of rockPositions) {
      const rock = new THREE.Mesh(stoneGeo, stoneMat);
      rock.position.set(rx, ry, rz);
      rock.scale.set(1 + Math.random() * 0.4, 0.8 + Math.random() * 0.3, 1 + Math.random() * 0.4);
      this.scene.add(rock);
    }

    // Заполнение иконок в HTML
    fillIcons(document);

    // Отображение режима хаба и лучшего счёта
    $('mode').textContent = session.mode === 'hub' ? 'в хабе' : 'без хаба';
    $('best').textContent = best === null ? '-' : String(best);

    // Подсказка управления в зависимости от типа устройства
    if (this.touchDevice) {
      $('help-touch').hidden = false;
      $('help-desktop').hidden = true;
    }

    // Ресайз
    new ResizeObserver(() => this.resize()).observe($('app'));
    this.resize();

    // Привязка UI и кнопок
    this.bindUi();

    // Запуск цикла рендеринга
    requestAnimationFrame((t) => this.tick(t));
  }

  private bindUi(): void {
    // Открытие / закрытие меню
    $('btn-menu').addEventListener('click', () => this.toggleMenu());
    $('btn-resume').addEventListener('click', () => this.closeMenu());

    // Переключатель F3
    $('btn-debug-toggle').addEventListener('click', () => this.toggleDebug());

    // Кнопка полного экрана
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

    // Клавиатура ПК: Esc для меню, F3 для отладки
    window.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.code === 'F3') {
        e.preventDefault();
        this.toggleDebug();
        return;
      }
      if (e.code === 'Escape') {
        e.preventDefault();
        // Защита от дубля Esc при выходе из полноэкранного режима браузера
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
        // Игнорируем ошибку разблокировки ориентации
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
      if (this.touchDevice) {
        const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
        try {
          await o.lock?.('landscape');
        } catch {
          // Игнорируем, если lock не поддержан
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
    $('menu').hidden = false;
  }

  private closeMenu(): void {
    this.paused = false;
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

    // Замер fps каждую секунду
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
      // Плавное покачивание хвоста лиса во времени через dt
      this.tailPivot.rotation.y = Math.sin(time * 0.003) * 0.25;
      this.tailPivot.rotation.z = Math.cos(time * 0.002) * 0.08;
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
    $('debug').textContent = [
      `fps ${this.fps} · кадр ${this.perfAvgMs.toFixed(1)} мс, худший ${this.perfWorstMs.toFixed(0)} мс · рывков ${this.perfSlowPerSec}/с`,
      `экран ${el.width}×${el.height} · dpr ${this.renderer.getPixelRatio().toFixed(2)} · тач ${this.touchDevice ? 'да' : 'нет'}`,
      `вызовов ${info.calls} · треугольников ${info.triangles}`,
      `объектов сцены ${this.scene.children.length} · геометрий ${mem.geometries}`,
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
