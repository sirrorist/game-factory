import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  stepPlayer,
  DEFAULT_PLAYER_PARAMS,
  type PlayerState,
  type Obstacle,
} from '../src/core/movement.ts';

describe('Физика движения и управление (dt, поворот камеры, коллизии)', () => {
  const initial: PlayerState = {
    x: 0,
    y: 0,
    z: 0,
    vy: 0,
    grounded: true,
    yaw: 0,
  };

  it('бег вперёд за 1.0 с даёт одну дистанцию на 60 Гц и 144 Гц', () => {
    let state60 = { ...initial };
    const dt60 = 1 / 60;
    for (let i = 0; i < 60; i++) {
      state60 = stepPlayer(state60, { forward: 1, strafe: 0, jump: false, yaw: 0 }, dt60);
    }

    let state144 = { ...initial };
    const dt144 = 1 / 144;
    for (let i = 0; i < 144; i++) {
      state144 = stepPlayer(state144, { forward: 1, strafe: 0, jump: false, yaw: 0 }, dt144);
    }

    // Дистанция: 6.0 м/с * 1.0 с = 6.0 м (-Z при yaw=0 вглубь экрана)
    assert.ok(Math.abs(state60.z - (-6.0)) < 1e-4, `state60.z = ${state60.z}, ожидалось -6.0`);
    assert.ok(Math.abs(state144.z - (-6.0)) < 1e-4, `state144.z = ${state144.z}, ожидалось -6.0`);
    assert.ok(
      Math.abs(state60.z - state144.z) < 1e-6,
      `Разница между 60 и 144 Гц (${Math.abs(state60.z - state144.z)}) больше 1e-6`,
    );
  });

  it('направление движения строго следует за направлением камеры (yaw): W->-Z, S->+Z, D->+X, A->-X', () => {
    const run1s = (input: { forward: number; strafe: number; jump: boolean; yaw: number }) => {
      let s = { ...initial };
      for (let i = 0; i < 60; i++) s = stepPlayer(s, input, 1 / 60);
      return s;
    };

    // 1. yaw = 0: взгляд вперёд вглубь экрана (-Z).
    // W -> -Z, S -> +Z
    // D -> +X (вправо на экране), A -> -X (влево на экране)
    const stepFwd = run1s({ forward: 1, strafe: 0, jump: false, yaw: 0 });
    assert.ok(Math.abs(stepFwd.z - (-6.0)) < 1e-4 && Math.abs(stepFwd.x) < 1e-4, 'W не пошел в -Z');

    const stepBack = run1s({ forward: -1, strafe: 0, jump: false, yaw: 0 });
    assert.ok(Math.abs(stepBack.z - 6.0) < 1e-4 && Math.abs(stepBack.x) < 1e-4, 'S не пошел в +Z');

    const stepRight = run1s({ forward: 0, strafe: 1, jump: false, yaw: 0 });
    assert.ok(Math.abs(stepRight.x - 6.0) < 1e-4 && Math.abs(stepRight.z) < 1e-4, 'D не пошел в +X (вправо)');

    const stepLeft = run1s({ forward: 0, strafe: -1, jump: false, yaw: 0 });
    assert.ok(Math.abs(stepLeft.x - (-6.0)) < 1e-4 && Math.abs(stepLeft.z) < 1e-4, 'A не пошел в -X (влево)');

    // 2. Повернули камеру на 90 градусов вправо вокруг героя (yaw = -Math.PI / 2):
    // Камера смотрит в сторону +X.
    // Теперь вперёд - это +X, вправо - это +Z, влево - это -Z
    const yawLookRight = -Math.PI / 2;
    const stepFwd90 = run1s({ forward: 1, strafe: 0, jump: false, yaw: yawLookRight });
    assert.ok(Math.abs(stepFwd90.x - 6.0) < 1e-4 && Math.abs(stepFwd90.z) < 1e-4, 'W при повороте направо не пошел в +X');

    const stepRight90 = run1s({ forward: 0, strafe: 1, jump: false, yaw: yawLookRight });
    assert.ok(Math.abs(stepRight90.z - 6.0) < 1e-4 && Math.abs(stepRight90.x) < 1e-4, 'D при повороте направо не пошел в +Z');

    const stepLeft90 = run1s({ forward: 0, strafe: -1, jump: false, yaw: yawLookRight });
    assert.ok(Math.abs(stepLeft90.z - (-6.0)) < 1e-4 && Math.abs(stepLeft90.x) < 1e-4, 'A при повороте направо не пошел в -Z');
  });

  it('коллизии: герой не проходит сквозь препятствия и скользит вдоль них', () => {
    const rocks: Obstacle[] = [{ x: 0, z: -3.0, radius: 1.0 }]; // Камень прямо по курсу впереди
    let state = { ...initial };
    const dt = 1 / 60;
    // Бежим вперёд (W) прямо на камень 60 кадров
    for (let i = 0; i < 60; i++) {
      state = stepPlayer(state, { forward: 1, strafe: 0, jump: false, yaw: 0 }, dt, DEFAULT_PLAYER_PARAMS, rocks);
    }
    // Герой должен остановиться перед камнем: z >= -3.0 + (1.0 + radius)
    const minAllowedZ = -3.0 + (1.0 + DEFAULT_PLAYER_PARAMS.radius);
    assert.ok(state.z >= minAllowedZ - 1e-4, `Герой прошёл сквозь камень! z = ${state.z}, min = ${minAllowedZ}`);
  });

  it('прыжок достигает расчётной высоты 1.6 м и одинаково приземляется на 60 и 144 Гц', () => {
    let state60 = { ...initial };
    let maxHeight60 = 0;
    const dt60 = 1 / 60;
    for (let i = 0; i < 60; i++) {
      state60 = stepPlayer(state60, { forward: 0, strafe: 0, jump: i === 0, yaw: 0 }, dt60);
      if (state60.y > maxHeight60) maxHeight60 = state60.y;
    }

    let state144 = { ...initial };
    let maxHeight144 = 0;
    const dt144 = 1 / 144;
    for (let i = 0; i < 144; i++) {
      state144 = stepPlayer(state144, { forward: 0, strafe: 0, jump: i === 0, yaw: 0 }, dt144);
      if (state144.y > maxHeight144) maxHeight144 = state144.y;
    }

    assert.ok(Math.abs(maxHeight60 - DEFAULT_PLAYER_PARAMS.jumpHeight) < 0.01);
    assert.ok(Math.abs(maxHeight144 - DEFAULT_PLAYER_PARAMS.jumpHeight) < 0.01);
    assert.ok(state60.grounded);
    assert.ok(state144.grounded);
  });

  it('граница арены: герой не может убежать за пределы arenaRadius (65.0 м)', () => {
    let state = { ...initial, x: 64.0, z: 0 };
    // Бежим вправо (D) 60 кадров
    for (let i = 0; i < 60; i++) {
      state = stepPlayer(state, { forward: 0, strafe: 1, jump: false, yaw: 0 }, 1 / 60);
    }
    const dist = Math.hypot(state.x, state.z);
    assert.ok(dist <= 65.0001, `Герой убежал за пределы арены! dist = ${dist}`);
  });

  it('мутация: движение без dt приводит к катастрофическому расхождению между 60 и 144 Гц', () => {
    const brokenStep = (pos: number, speed: number) => pos + speed;
    let pos60 = 0;
    for (let i = 0; i < 60; i++) pos60 = brokenStep(pos60, 6.0);
    let pos144 = 0;
    for (let i = 0; i < 144; i++) pos144 = brokenStep(pos144, 6.0);
    assert.ok(Math.abs(pos144 - pos60) > 500);
  });

  it('пружинные башмаки: двойной прыжок в воздухе (spring_boots, maxAirJumps = 1)', () => {
    const paramsWithBoots = { ...DEFAULT_PLAYER_PARAMS, maxAirJumps: 1 };
    let state: PlayerState = { x: 0, y: 0, z: 0, vy: 0, grounded: true, yaw: 0 };
    const dt = 1 / 60;

    // 1. Первый прыжок с земли
    state = stepPlayer(state, { forward: 0, strafe: 0, jump: true, yaw: 0 }, dt, paramsWithBoots);
    assert.equal(state.grounded, false, 'Герой оторвался от земли');
    assert.ok(state.vy > 0, 'Положительная вертикальная скорость');

    // Отпускаем клавишу прыжка и летим вверх 0.2 с
    for (let i = 0; i < 12; i++) {
      state = stepPlayer(state, { forward: 0, strafe: 0, jump: false, yaw: 0 }, dt, paramsWithBoots);
    }
    const heightBeforeAirJump = state.y;
    assert.ok(heightBeforeAirJump > 0.8, 'Герой поднялся выше 0.8 м');

    // 2. Нажимаем прыжок в воздухе (второй прыжок)
    state = stepPlayer(state, { forward: 0, strafe: 0, jump: true, yaw: 0 }, dt, paramsWithBoots);
    assert.ok(state.vy > 7.0, 'Второй прыжок в воздухе вернул максимальный импульс vy0');
    assert.equal(state.airJumpsLeft, 0, 'Воздушные прыжки исчерпаны');

    // Отпускаем клавишу и летим до пика второго прыжка
    for (let i = 0; i < 15; i++) {
      state = stepPlayer(state, { forward: 0, strafe: 0, jump: false, yaw: 0 }, dt, paramsWithBoots);
    }
    assert.ok(state.y > 2.2, `Высота с двойным прыжком (${state.y.toFixed(2)} м) превысила стандартные 1.6 м`);

    // 3. Пытаемся сделать третий прыжок в воздухе — не должно сработать
    const vyBeforeThird = state.vy;
    state = stepPlayer(state, { forward: 0, strafe: 0, jump: true, yaw: 0 }, dt, paramsWithBoots);
    assert.ok(state.vy < vyBeforeThird, 'Третий прыжок не срабатывает, продолжается падение');
  });
});

