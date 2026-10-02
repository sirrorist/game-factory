/**
 * Модуль всплывающего боевого текста (Floating Combat Text) в 3D-пространстве.
 * Отображает цифры нанесённого урона, полученных травм и исцеления прямо в воздухе над персонажами.
 */
import * as THREE from 'three';

export type CombatTextType = 'damage_player' | 'damage_enemy' | 'heal' | 'crit' | 'parry' | 'vent';

interface FloatingItem {
  el: HTMLDivElement;
  worldPos: THREE.Vector3;
  startTime: number;
  duration: number;
  type: CombatTextType;
}

export interface CombatTextManager {
  spawn: (pos: THREE.Vector3, text: string, type: CombatTextType) => void;
  update: (camera: THREE.Camera, now: number) => void;
  clear: () => void;
}

export function createCombatTextManager(): CombatTextManager {
  const container = document.createElement('div');
  container.id = 'combat-text-container';
  container.className = 'combat-text-container';
  document.body.appendChild(container);

  const items: FloatingItem[] = [];
  const tempVec = new THREE.Vector3();

  function spawn(pos: THREE.Vector3, text: string, type: CombatTextType): void {
    const el = document.createElement('div');
    el.className = `combat-number cbt-${type}`;
    el.textContent = text;
    container.appendChild(el);

    // Добавляем случайный разброс по горизонтали, чтобы цифры не слипались
    const spawnPos = pos.clone();
    spawnPos.x += (Math.random() - 0.5) * 0.4;
    spawnPos.z += (Math.random() - 0.5) * 0.4;
    spawnPos.y += 1.4;

    items.push({
      el,
      worldPos: spawnPos,
      startTime: performance.now(),
      duration: 1200,
      type,
    });
  }

  function update(camera: THREE.Camera, now: number): void {
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i];
      if (!item) continue;
      const elapsed = now - item.startTime;
      const progress = Math.min(1, elapsed / item.duration);

      if (progress >= 1) {
        item.el.remove();
        items.splice(i, 1);
        continue;
      }

      // Траектория: плавный подъем вверх с замедлением
      tempVec.copy(item.worldPos);
      tempVec.y += progress * 1.6;

      tempVec.project(camera);

      // Проверка нахождения перед плоскостью камеры
      if (tempVec.z > 1 || tempVec.z < -1) {
        item.el.style.display = 'none';
        continue;
      }

      item.el.style.display = 'block';
      const screenX = (tempVec.x * 0.5 + 0.5) * window.innerWidth;
      const screenY = (-tempVec.y * 0.5 + 0.5) * window.innerHeight;

      // Масштаб: легкий всплеск в начале (pop) и затухание прозрачности в конце
      const scale = progress < 0.2 ? 0.7 + (progress / 0.2) * 0.5 : 1.2 - (progress - 0.2) * 0.25;
      const opacity = progress > 0.65 ? (1 - progress) / 0.35 : 1;

      item.el.style.transform = `translate(-50%, -50%) translate3d(${screenX}px, ${screenY}px, 0) scale(${scale})`;
      item.el.style.opacity = String(opacity);
    }
  }

  function clear(): void {
    for (const item of items) {
      item.el.remove();
    }
    items.length = 0;
  }

  return {
    spawn,
    update,
    clear,
  };
}
