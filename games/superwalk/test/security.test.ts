import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  sha256,
  hmacSha256,
  createInitialWallet,
  appendTransaction,
  verifyWallet,
  generateSeedCommitment,
  getSecureRandomFloat,
  META_PARODY_ENABLED,
  type WalletState,
} from '../src/meta/security.ts';

describe('Криптографическая система защиты $GFC (src/meta/security.ts)', () => {
  it('флаг сатирической изоляции META_PARODY_ENABLED включен', () => {
    assert.equal(META_PARODY_ENABLED, true);
  });

  it('чистый TS SHA-256 вычисляет канонические эталонные хеши (NIST test vectors)', () => {
    // NIST Vector: "" (пустая строка)
    assert.equal(
      sha256(''),
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    // NIST Vector: "abc"
    assert.equal(
      sha256('abc'),
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('HMAC-SHA256 детерминирован и формирует корректную подпись', () => {
    const key = 'secret-forest-key';
    const msg = 'balance=250;hash=xyz';
    const sig1 = hmacSha256(key, msg);
    const sig2 = hmacSha256(key, msg);
    assert.equal(sig1, sig2);
    assert.equal(sig1.length, 64);
  });

  it('создание начального кошелька генерирует валидный Genesis-блок и корректную проверку', () => {
    const wallet = createInitialWallet(100);
    assert.equal(wallet.balance, 100);
    assert.equal(wallet.transactions.length, 1);
    assert.equal(wallet.transactions[0]!.type, 'init');

    const audit = verifyWallet(wallet);
    assert.equal(audit.valid, true);
    assert.equal(audit.safeBalance, 100);
  });

  it('добавление легитимных транзакций (сундук, босс, спин, выигрыш) непрерывно растит цепочку хешей', () => {
    let wallet = createInitialWallet(100);

    // 1. Открыли сундук в забеге: +15 $GFC
    const tx1 = appendTransaction(wallet, 'chest', 15);
    assert.equal(tx1.success, true);
    wallet = tx1.state;
    assert.equal(wallet.balance, 115);

    // 2. Убили босса Старый Пень: +100 $GFC
    const tx2 = appendTransaction(wallet, 'boss', 100);
    assert.equal(tx2.success, true);
    wallet = tx2.state;
    assert.equal(wallet.balance, 215);

    // 3. Спин в слот-машине: -10 $GFC
    const tx3 = appendTransaction(wallet, 'slot_spin', -10);
    assert.equal(tx3.success, true);
    wallet = tx3.state;
    assert.equal(wallet.balance, 205);

    // 4. Выигрыш в слотах (три лиса 🦊): +50 $GFC
    const tx4 = appendTransaction(wallet, 'slot_win', 50);
    assert.equal(tx4.success, true);
    wallet = tx4.state;
    assert.equal(wallet.balance, 255);

    // Проверяем непрерывность цепочки
    assert.equal(wallet.transactions.length, 5);
    for (let i = 1; i < wallet.transactions.length; i++) {
      assert.equal(
        wallet.transactions[i]!.prevHash,
        wallet.transactions[i - 1]!.hash,
        `prevHash блока ${i} строго совпадает с hash предыдущего блока`,
      );
    }

    const audit = verifyWallet(wallet);
    assert.equal(audit.valid, true);
    assert.equal(audit.safeBalance, 255);
  });

  it('защита от читерства: отклоняет транзакции с завышенной суммой', () => {
    const wallet = createInitialWallet(100);

    // Попытка накрутить +1000 $GFC из сундука (лимит 30)
    const cheatChest = appendTransaction(wallet, 'chest', 1000);
    assert.equal(cheatChest.success, false);
    assert.match(cheatChest.error ?? '', /Недопустимая сумма/);

    // Попытка списать больше, чем есть на балансе
    const poorWallet = createInitialWallet(5);
    const spinNoFunds = appendTransaction(poorWallet, 'slot_spin', -10);
    assert.equal(spinNoFunds.success, false);
    assert.match(spinNoFunds.error ?? '', /Недостаточно/);
  });

  it('обнаружение взлома (Tamper Detection): подделка баланса в localStorage/DevTools сбрасывает баланс до безопасного', () => {
    let wallet = createInitialWallet(100);
    const step1 = appendTransaction(wallet, 'chest', 20);
    wallet = step1.state; // Баланс 120

    // Читер меняет wallet.balance напрямую в объекте или localStorage
    const hackedWallet: WalletState = {
      ...wallet,
      balance: 999999, // Накрутка
    };

    const audit = verifyWallet(hackedWallet);
    assert.equal(audit.valid, false, 'Проверка обнаружила взлом подписи');
    assert.match(audit.reason ?? '', /HMAC подпись|Некорректный баланс/);
    assert.equal(audit.safeBalance, 120, 'Баланс безопасно откачен до последней верифицированной точки (120)');
    assert.equal(audit.recoveredState.tamperCount, 1, 'Счётчик попыток взлома увеличен');
  });

  it('обнаружение взлома: модификация любого исторического блока транзакции инвалидирует цепочку', () => {
    let wallet = createInitialWallet(100);
    wallet = appendTransaction(wallet, 'chest', 10).state;
    wallet = appendTransaction(wallet, 'boss', 70).state;

    // Взломщик подменил сумму в историческом блоке #1 с 10 на 50
    const tamperedTransactions = [...wallet.transactions];
    const originalTx = tamperedTransactions[1]!;
    tamperedTransactions[1] = {
      ...originalTx,
      amount: 50,
      balanceAfter: 150,
    };

    const tamperedWallet: WalletState = {
      ...wallet,
      transactions: tamperedTransactions,
    };

    const audit = verifyWallet(tamperedWallet);
    assert.equal(audit.valid, false);
    assert.equal(audit.safeBalance, 100, 'Откат произошёл до блока Genesis (100 $GFC)');
  });

  it('Provably Fair CSPRNG генерирует стойкие случайные числа и seed commitment', () => {
    const rand = getSecureRandomFloat();
    assert.ok(rand >= 0 && rand < 1, 'Случайное число в диапазоне [0, 1)');

    const commitment = generateSeedCommitment();
    assert.ok(commitment.serverSeed.length >= 16);
    assert.equal(commitment.commitmentHash.length, 64);
  });
});
