import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MetaWalletManager } from '../src/meta/wallet.ts';
import { verifyWallet, appendTransaction } from '../src/meta/security.ts';
import { ForestCasino, SKINS_COLLECTION } from '../src/meta/casino.ts';

// Mock localStorage in Node.js environment
const store = new Map<string, string>();
const localStorageMock = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => store.set(k, v),
  removeItem: (k: string) => store.delete(k),
  clear: () => store.clear(),
};
// @ts-expect-error mock
globalThis.localStorage = localStorageMock;

describe('Менеджер кошелька $GFC (src/meta/wallet.ts)', () => {
  beforeEach(() => {
    store.clear();
  });

  it('инициализирует кошелёк со стартовым балансом 100 $GFC', () => {
    const mgr = new MetaWalletManager();
    assert.equal(mgr.getBalance(), 100);
    assert.equal(mgr.isTampered(), false);
  });

  it('начисляет $GFC за сундуки (+5..15) и победу над боссом (+100)', () => {
    const mgr = new MetaWalletManager();
    const chestRes = mgr.awardGfc('chest', 12);
    assert.equal(chestRes.success, true);
    assert.equal(chestRes.amount, 12);
    assert.equal(mgr.getBalance(), 112);

    const bossRes = mgr.awardGfc('boss', 100);
    assert.equal(bossRes.success, true);
    assert.equal(bossRes.amount, 100);
    assert.equal(mgr.getBalance(), 212);
  });

  it('слот-машина списывает 10 $GFC и зачисляет выигрыш', () => {
    const mgr = new MetaWalletManager();
    const startBal = mgr.getBalance();
    const res = mgr.playSlots();

    assert.equal(res.success, true);
    assert.ok(res.spinResult);
    assert.equal(res.spinResult.reels.length, 3);
    const expected = startBal - 10 + res.spinResult.payout;
    assert.equal(mgr.getBalance(), expected);
  });

  it('кейс списывает ставку один раз и выдаёт скин только после остановки', t => {
    let now = 1_000_000;
    t.mock.method(Date, 'now', () => now);
    const skin = SKINS_COLLECTION[1]!;
    t.mock.method(ForestCasino, 'openCase', () => ({ item: skin, rollValue: 0.3, revealedHash: 'case-test' }));
    const mgr = new MetaWalletManager();
    const startBal = mgr.getBalance();
    const res = mgr.openSkinCase();

    assert.equal(res.success, true);
    assert.ok(res.skin);
    assert.equal(mgr.getBalance(), startBal - 50);

    assert.equal(mgr.getUnlockedSkins().some(s => s.id === skin.id), false);
    assert.equal(mgr.equipSkin(skin.id), false);
    assert.equal(mgr.finishSkinCase(res.opening!.id).success, false);
    assert.equal(mgr.openSkinCase().success, false);
    assert.equal(mgr.getBalance(), startBal - 50);
    assert.equal(mgr.getWalletState().transactions.filter(tx => tx.type === 'case_win').length, 0);
    now = res.opening!.readyAt;
    assert.equal(mgr.finishSkinCase(res.opening!.id).success, true);
    assert.ok(mgr.getUnlockedSkins().some(s => s.id === skin.id));
    assert.equal(mgr.finishSkinCase(res.opening!.id).success, true);
    assert.equal(mgr.getWalletState().transactions.filter(tx => tx.type === 'case_win').length, 1);
    assert.equal(mgr.getBalance(), startBal - 50);
    assert.equal(verifyWallet(mgr.getWalletState()).valid, true);
  });

  it('перезагрузка продолжает оплаченный кейс и сохраняет его при других начислениях', t => {
    let now = 2_000_000;
    t.mock.method(Date, 'now', () => now);
    const skin = SKINS_COLLECTION[2]!;
    t.mock.method(ForestCasino, 'openCase', () => ({ item: skin, rollValue: 0.1, revealedHash: 'case-test' }));
    const mgr = new MetaWalletManager();
    const opening = mgr.openSkinCase().opening!;
    mgr.awardGfc('chest', 10);
    now += 1000;
    const resumed = new MetaWalletManager();
    assert.equal(resumed.getCaseOpening()?.id, opening.id);
    assert.equal(resumed.getCaseOpening()?.readyAt, opening.readyAt);
    assert.equal(resumed.getBalance(), 60);
    assert.equal(resumed.getUnlockedSkins().some(s => s.id === skin.id), false);
    assert.equal(resumed.openSkinCase().success, false);
    now = opening.readyAt + 100;
    const completed = new MetaWalletManager();
    assert.equal(completed.getCaseOpening()?.revealed, true);
    assert.equal(completed.getBalance(), 60);
    assert.ok(completed.getUnlockedSkins().some(s => s.id === skin.id));
    assert.equal(completed.getWalletState().transactions.filter(tx => tx.type === 'case_open').length, 1);
    assert.equal(completed.getWalletState().transactions.filter(tx => tx.type === 'case_win').length, 1);
  });

  it('сохранённый результат восстанавливает коллекцию без повторной выдачи', t => {
    let now = 3_000_000;
    t.mock.method(Date, 'now', () => now);
    const skin = SKINS_COLLECTION[3]!;
    t.mock.method(ForestCasino, 'openCase', () => ({ item: skin, rollValue: 0.01, revealedHash: 'case-test' }));
    const mgr = new MetaWalletManager();
    const opening = mgr.openSkinCase().opening!;
    now = opening.readyAt;
    mgr.finishSkinCase(opening.id);
    store.delete('gf_superwalk_skins_v1');
    const restored = new MetaWalletManager();
    assert.ok(restored.getUnlockedSkins().some(s => s.id === skin.id));
    assert.equal(restored.getCaseOpening()?.skin.id, skin.id);
    const count = restored.getWalletState().transactions.length;
    assert.equal(restored.finishSkinCase(opening.id).success, true);
    assert.equal(restored.finishSkinCase('другой-кейс').success, false);
    assert.equal(restored.getWalletState().transactions.length, count);
  });

  for (const skin of SKINS_COLLECTION) {
    it(`дубликат «${skin.name}» начисляет ${skin.duplicatePayoutGfc} $GFC один раз после остановки`, t => {
      let now = 4_000_000;
      t.mock.method(Date, 'now', () => now);
      t.mock.method(ForestCasino, 'openCase', () => ({ item: skin, rollValue: 0, revealedHash: 'case-test' }));
      store.set('gf_superwalk_skins_v1', JSON.stringify(['skin_sock', skin.id]));
      const mgr = new MetaWalletManager();
      const opening = mgr.openSkinCase().opening!;
      assert.equal(opening.isNew, false);
      assert.equal(opening.compensationGfc, skin.duplicatePayoutGfc);
      assert.equal(mgr.getBalance(), 50);
      assert.equal(mgr.finishSkinCase(opening.id).success, false);
      now = opening.readyAt;
      const resumed = new MetaWalletManager();
      assert.equal(resumed.getBalance(), 50 + skin.duplicatePayoutGfc);
      assert.equal(resumed.getCaseOpening()?.compensationGfc, skin.duplicatePayoutGfc);
      assert.equal(resumed.getWalletState().transactions.filter(tx => tx.type === 'case_win').length, 1);
      assert.equal(resumed.getWalletState().transactions.at(-1)?.amount, skin.duplicatePayoutGfc);
      assert.equal(resumed.finishSkinCase(opening.id).success, true);
      assert.equal(new MetaWalletManager().getBalance(), 50 + skin.duplicatePayoutGfc);
      assert.equal(verifyWallet(resumed.getWalletState()).valid, true);
    });
  }

  it('не начисляет новую компенсацию за уже завершённый кейс предыдущего формата', t => {
    let now = 5_000_000;
    t.mock.method(Date, 'now', () => now);
    const skin = SKINS_COLLECTION[0]!;
    t.mock.method(ForestCasino, 'openCase', () => ({ item: skin, rollValue: 0.8, revealedHash: 'case-test' }));
    const mgr = new MetaWalletManager();
    const opening = mgr.openSkinCase().opening!;
    now = opening.readyAt;
    const raw = JSON.parse(store.get('gf_superwalk_wallet_v1')!);
    const oldCredit = appendTransaction(mgr.getWalletState(), 'case_win', 0);
    assert.equal(oldCredit.success, true);
    raw.caseOpening.revealed = true;
    delete raw.caseOpening.compensationGfc;
    store.set('gf_superwalk_wallet_v1', JSON.stringify({ ...oldCredit.state, caseOpening: raw.caseOpening }));
    const restored = new MetaWalletManager();
    assert.equal(restored.getCaseOpening()?.compensationGfc, 0);
    assert.equal(restored.getBalance(), 50);
    assert.equal(restored.finishSkinCase(opening.id).success, true);
    assert.equal(restored.getBalance(), 50);
  });

  it('экипировка и смена скина', () => {
    const mgr = new MetaWalletManager();
    assert.equal(mgr.getEquippedSkin(), null);

    // Бабушкин носок доступен сразу
    const equipped = mgr.equipSkin('skin_sock');
    assert.equal(equipped, true);
    assert.equal(mgr.getEquippedSkin()?.id, 'skin_sock');

    mgr.unequipSkin();
    assert.equal(mgr.getEquippedSkin(), null);
  });

  it('симуляция вывода средств выдаёт сатирический отказ и расчёт курса', () => {
    const mgr = new MetaWalletManager();
    const withdraw = mgr.simulateWithdrawal(50);
    assert.equal(withdraw.amountGfc, 50);
    assert.ok(withdraw.usdEstimated > 0);
    assert.equal(withdraw.status, 'rejected_forest_tax');
    assert.ok(withdraw.humorMessage.length > 10);
  });

  it('успешный вывод средств списывает $GFC и формирует квитанцию WithdrawReceipt', () => {
    const mgr = new MetaWalletManager();
    assert.equal(mgr.getBalance(), 100);

    const res = mgr.executeWithdrawal(40);
    assert.equal(res.success, true);
    assert.equal(mgr.getBalance(), 60);

    const receipt = res.receipt!;
    assert.ok(receipt);
    assert.equal(receipt.amountGfc, 40);
    assert.equal(receipt.status, 'success_simulated');
    assert.equal(receipt.statusTitle, 'Перевод успешно отправлен!');
    assert.equal(receipt.recipient, '@superfox_gram');
    assert.equal(receipt.network, 'TON Forest');
    assert.ok(receipt.usdEquivalent > 0);
    assert.equal(receipt.usdEstimated, receipt.usdEquivalent);
    assert.ok(receipt.feeUsd > 0);
    assert.ok(receipt.slippage >= 0);
    assert.ok(receipt.blockNumber > 0);
    assert.ok(receipt.timestamp > 0);
    assert.match(receipt.txHash, /^0x[0-9a-f]{40}$/);
  });

  it('сохраняет криптографическую валидность цепочки транзакций после вывода', () => {
    const mgr = new MetaWalletManager();
    mgr.awardGfc('chest', 20); // Баланс 120
    const res = mgr.executeWithdrawal(50, '@woodland_fox');
    assert.equal(res.success, true);
    assert.equal(mgr.getBalance(), 70);
    assert.equal(res.receipt?.recipient, '@woodland_fox');

    const state = mgr.getWalletState();
    const verification = verifyWallet(state);
    assert.equal(verification.valid, true, 'Цепочка транзакций криптографически валидна');
    assert.equal(verification.safeBalance, 70);

    const lastTx = state.transactions[state.transactions.length - 1]!;
    assert.equal(lastTx.type, 'withdraw');
    assert.equal(lastTx.amount, -50);
    assert.equal(lastTx.balanceAfter, 70);
  });

  it('отклоняет вывод при недостатке баланса или некорректной сумме', () => {
    const mgr = new MetaWalletManager();
    assert.equal(mgr.getBalance(), 100);

    // Попытка вывести больше, чем есть
    const overWithdraw = mgr.executeWithdrawal(500);
    assert.equal(overWithdraw.success, false);
    assert.match(overWithdraw.error ?? '', /Недостаточно/);
    assert.equal(mgr.getBalance(), 100);

    // Попытка вывести 0 или отрицательную сумму
    const zeroWithdraw = mgr.executeWithdrawal(0);
    assert.equal(zeroWithdraw.success, false);
    assert.equal(mgr.getBalance(), 100);

    const negativeWithdraw = mgr.executeWithdrawal(-25);
    assert.equal(negativeWithdraw.success, false);
    assert.equal(mgr.getBalance(), 100);
  });

  it('вывод $GFC симулирует продажу на AMM-рынке и снижает спотовую цену', () => {
    const mgr = new MetaWalletManager();
    const market = mgr.getMarket();
    const priceBefore = market.getSpotPrice();

    const res = mgr.executeWithdrawal(80);
    assert.equal(res.success, true);

    const priceAfter = market.getSpotPrice();
    assert.ok(priceAfter < priceBefore, 'Продажа $GFC создаёт давление на курс и снижает цену');
  });
});
