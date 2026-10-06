import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../src/core/world.ts';

describe('Генерация мира "Солнечные холмы" (DESIGN.md, раздел 6)', () => {
  it('генерация детерминирована для одного seed', () => {
    const w1 = generateWorld(1337);
    const w2 = generateWorld(1337);

    assert.equal(w1.trees.length, w2.trees.length);
    assert.equal(w1.rocks.length, 0);
    assert.equal(w1.boundaryRocks.length, 0);

    for (let i = 0; i < w1.trees.length; i++) {
      assert.equal(w1.trees[i]!.x, w2.trees[i]!.x);
      assert.equal(w1.trees[i]!.z, w2.trees[i]!.z);
    }
  });

  it('число внутренних препятствий в пределах 40-60 по DESIGN.md (деревья)', () => {
    const world = generateWorld();
    const innerObstaclesCount = world.trees.length;
    // По DESIGN.md, раздел 6: 40-60 деревьев как укрытия и препятствия
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

  it('камни исключены: чистая арена Megabonk с деревьями строго внутри R <= 55 м', () => {
    const world = generateWorld();
    assert.equal(world.rocks.length, 0, 'Внутренние камни должны отсутствовать');
    assert.equal(world.boundaryRocks.length, 0, 'Граничные скалы должны отсутствовать');
    for (const tree of world.trees) {
      const dist = Math.hypot(tree.x, tree.z);
      assert.ok(
        dist <= 55.0001,
        `Дерево на dist = ${dist} выходит за безопасную зону арены (55 м)`,
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
