import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../src/core/world.ts';

describe('Генерация мира "Солнечные холмы" (DESIGN.md, раздел 6)', () => {
  it('генерация детерминирована для одного seed', () => {
    const w1 = generateWorld(1337);
    const w2 = generateWorld(1337);

    assert.equal(w1.trees.length, w2.trees.length);
    assert.equal(w1.rocks.length, w2.rocks.length);
    assert.equal(w1.boundaryRocks.length, w2.boundaryRocks.length);

    for (let i = 0; i < w1.trees.length; i++) {
      assert.equal(w1.trees[i]!.x, w2.trees[i]!.x);
      assert.equal(w1.trees[i]!.z, w2.trees[i]!.z);
    }
  });

  it('число внутренних препятствий в пределах 40-60 по DESIGN.md', () => {
    const world = generateWorld();
    const innerObstaclesCount = world.trees.length + world.rocks.length;
    // По DESIGN.md, раздел 6: "40-60 камней и деревьев как препятствия"
    assert.ok(
      innerObstaclesCount >= 40 && innerObstaclesCount <= 60,
      `Число препятствий ${innerObstaclesCount} вне диапазона 40..60`,
    );
  });

  it('зона спавна (R = 7.0 м) полностью свободна от препятствий', () => {
    const world = generateWorld();
    for (const obs of world.obstacles) {
      const dist = Math.hypot(obs.x, obs.z);
      assert.ok(
        dist >= 6.8,
        `Препятствие на (${obs.x.toFixed(1)}, ${obs.z.toFixed(1)}) слишком близко к точке спавна (dist = ${dist.toFixed(1)} м)`,
      );
    }
  });

  it('кольцо скал оцепляет арену по периметру (радиус 60..70 м)', () => {
    const world = generateWorld();
    assert.ok(world.boundaryRocks.length >= 40, 'Слишком мало граничных скал');
    for (const rock of world.boundaryRocks) {
      const dist = Math.hypot(rock.x, rock.z);
      assert.ok(
        dist >= 61.0 && dist <= 68.0,
        `Граничная скала на dist = ${dist} вне диапазона 61..68 м`,
      );
    }
  });

  it('все препятствия имеют положительный радиус коллизии', () => {
    const world = generateWorld();
    for (const obs of world.obstacles) {
      assert.ok(obs.radius > 0.4, `Радиус коллизии ${obs.radius} слишком мал`);
    }
  });
});
