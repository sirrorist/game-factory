import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialInventory,
  getAvailableUpgrades,
  rollUpgradeChoices,
  applyUpgrade,
  getWeaponCooldown,
  getFlatMightBonus,
  MAX_UPGRADE_LEVEL,
} from '../src/core/upgrades.ts';

describe('Система улучшений и карточек (DESIGN.md, шаги 3, 5)', () => {
  it('стартовый инвентарь содержит Хвост-клинок 1 уровня', () => {
    const inv = createInitialInventory();
    assert.equal(inv.weapons.get('tail_blade'), 1);
    assert.equal(inv.weapons.size, 1);
    assert.equal(inv.tomes.size, 0);
  });

  it('ролл 3 карточек никогда не содержит дубликатов', () => {
    const inv = createInitialInventory();
    let seed = 42;
    const rnd = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };

    for (let i = 0; i < 30; i++) {
      const choices = rollUpgradeChoices(inv, rnd, 3);
      assert.ok(choices.length <= 3);
      const ids = choices.map((c) => c.id);
      const uniqueIds = new Set(ids);
      assert.equal(ids.length, uniqueIds.size, `Обнаружен дубликат карточки: ${ids.join(', ')}`);
    }
  });

  it('лимит слотов: при заполненных слотах оружия и фолиантов не предлагаются новые', () => {
    const inv = createInitialInventory();
    // Добавляем второе оружие
    applyUpgrade(inv, 'spark_sling');
    // Добавляем два фолианта
    applyUpgrade(inv, 'tome_haste');
    applyUpgrade(inv, 'tome_might');

    assert.equal(inv.weapons.size, 2);
    assert.equal(inv.tomes.size, 2);

    const available = getAvailableUpgrades(inv);
    // Все доступные карты должны быть улучшениями существующих (isNew = false)
    for (const opt of available) {
      assert.equal(opt.isNew, false, `Карточка ${opt.id} не должна быть новой`);
    }
  });

  it('уровни до 5: предметы 5 уровня исключаются из пула', () => {
    const inv = createInitialInventory();
    // Прокачиваем tail_blade до 5 уровня (сейчас 1, нужно еще 4 раза)
    for (let i = 0; i < 4; i++) {
      applyUpgrade(inv, 'tail_blade');
    }
    assert.equal(inv.weapons.get('tail_blade'), MAX_UPGRADE_LEVEL);

    const available = getAvailableUpgrades(inv);
    const hasTailBlade = available.some((opt) => opt.id === 'tail_blade');
    assert.equal(hasTailBlade, false, 'tail_blade 5 уровня не должен быть в пуле улучшений');
  });

  it('когда всё прокачано до 5 уровня, предлагаются только лечебный чай и легконог', () => {
    const inv = createInitialInventory();
    // Прокачиваем все 2 оружия и 2 фолианта до 5 уровня
    for (let i = 0; i < 5; i++) applyUpgrade(inv, 'tail_blade');
    for (let i = 0; i < 5; i++) applyUpgrade(inv, 'spark_sling');
    for (let i = 0; i < 5; i++) applyUpgrade(inv, 'tome_haste');
    for (let i = 0; i < 5; i++) applyUpgrade(inv, 'tome_might');

    const available = getAvailableUpgrades(inv);
    assert.equal(available.length, 2);
    assert.deepEqual(
      available.map((a) => a.id).sort(),
      ['heal_bonus', 'speed_bonus'].sort(),
    );

    // Применение альтернативных наград
    const resHeal = applyUpgrade(inv, 'heal_bonus');
    assert.equal(resHeal.hpGain, 20);
    assert.equal(inv.healBonusCount, 1);

    const resSpeed = applyUpgrade(inv, 'speed_bonus');
    assert.equal(resSpeed.speedMultiplier, 1.05);
    assert.equal(inv.speedBonusCount, 1);
  });

  it('фолиант быстроты уменьшает время перезарядки оружия на 12% за уровень', () => {
    const baseCd = 0.9;
    // 0 уровень: 0.9
    assert.equal(getWeaponCooldown(baseCd, 0), 0.9);
    // 1 уровень (+12% atk speed): 0.9 / 1.12 ≈ 0.80357
    assert.ok(Math.abs(getWeaponCooldown(baseCd, 1) - 0.9 / 1.12) < 1e-5);
    // 5 уровень (+60% atk speed): 0.9 / 1.60 = 0.5625
    assert.ok(Math.abs(getWeaponCooldown(baseCd, 5) - 0.9 / 1.6) < 1e-5);
  });

  it('фолиант силы даёт +3 плоского урона за каждый уровень', () => {
    assert.equal(getFlatMightBonus(0), 0);
    assert.equal(getFlatMightBonus(1), 3);
    assert.equal(getFlatMightBonus(2), 6);
    assert.equal(getFlatMightBonus(5), 15);
  });
});
