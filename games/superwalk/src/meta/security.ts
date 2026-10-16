// src/meta/security.ts
// Клиентская криптографическая система проверки и защиты мета-валюты $GFC (Game Factory Coin).
// Включает:
// 1. Чистый TS SHA-256 и HMAC-SHA256 (работает синхронно в браузере и в Node.js без полифиллов)
// 2. Hash-chaining Transaction Log (мини-блокчейн лесных транзакций для обнаружения накрутки)
// 3. Защита от редактирования DevTools/localStorage и безопасный откат (Tamper Detection)
// 4. Provably Fair CSPRNG генератор для слот-машины и CS-кейсов

export const META_PARODY_ENABLED = true;

// Обфусцированная соль платформы для HMAC подписи сейва
const SECRET_SALT = 'GF_SUPERWALK_FOREST_VAULT_KEY_2026_9f8e7d6c';
const GENESIS_HASH = 'GENESIS_FOREST_VAULT_BLOCK_00000000000000000000000000000000';

export type TransactionType =
  | 'init'
  | 'chest'
  | 'elite'
  | 'boss'
  | 'slot_spin'
  | 'slot_win'
  | 'case_open'
  | 'case_win'
  | 'withdraw';

export interface WalletTransaction {
  id: string;
  type: TransactionType;
  amount: number;
  balanceAfter: number;
  timestamp: number;
  nonce: number;
  prevHash: string;
  hash: string;
}

export interface WalletState {
  balance: number;
  lastVerifiedHash: string;
  transactions: WalletTransaction[];
  signature: string;
  tamperCount: number;
}

// -------------------------------------------------------------
// Чистая синхронная реализация SHA-256 (FIPS 180-4) в TypeScript
// -------------------------------------------------------------

function rightRotate(value: number, amount: number): number {
  return (value >>> amount) | (value << (32 - amount));
}

const K: readonly number[] = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

export function sha256Bytes(data: Uint8Array): Uint8Array {
  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const bitLength = data.length * 8;
  const newLength = ((data.length + 8) >> 6) + 1 << 6;
  const padded = new Uint8Array(newLength);
  padded.set(data);
  padded[data.length] = 0x80;

  // Длина в битах в последних 8 байтах (big-endian 64-bit)
  const view = new DataView(padded.buffer);
  view.setUint32(newLength - 4, bitLength >>> 0);
  view.setUint32(newLength - 8, Math.floor(bitLength / 0x100000000));

  const w = new Uint32Array(64);

  for (let chunk = 0; chunk < newLength; chunk += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(chunk + i * 4);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rightRotate(w[i - 15]!, 7) ^ rightRotate(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3);
      const s1 = rightRotate(w[i - 2]!, 17) ^ rightRotate(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10);
      w[i] = ((w[i - 16]! + s0) | 0) + ((w[i - 7]! + s1) | 0);
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i++) {
      const s1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (((((h + s1) | 0) + ch) | 0) + ((K[i]! + w[i]!) | 0)) | 0;
      const s0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) | 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }

    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
    h5 = (h5 + f) | 0;
    h6 = (h6 + g) | 0;
    h7 = (h7 + h) | 0;
  }

  const result = new Uint8Array(32);
  const resView = new DataView(result.buffer);
  resView.setUint32(0, h0);
  resView.setUint32(4, h1);
  resView.setUint32(8, h2);
  resView.setUint32(12, h3);
  resView.setUint32(16, h4);
  resView.setUint32(20, h5);
  resView.setUint32(24, h6);
  resView.setUint32(28, h7);
  return result;
}

export function sha256(text: string): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  const hashBytes = sha256Bytes(bytes);
  return Array.from(hashBytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function hmacSha256(keyStr: string, messageStr: string): string {
  const encoder = new TextEncoder();
  const rawKey = encoder.encode(keyStr);
  const msg = encoder.encode(messageStr);

  const blockSize = 64;
  const key: Uint8Array = rawKey.length > blockSize ? sha256Bytes(rawKey) : rawKey;
  const keyPadded = new Uint8Array(blockSize);
  keyPadded.set(key);

  const oPad = new Uint8Array(blockSize + 32);
  const iPad = new Uint8Array(blockSize + msg.length);

  for (let i = 0; i < blockSize; i++) {
    oPad[i] = keyPadded[i]! ^ 0x5c;
    iPad[i] = keyPadded[i]! ^ 0x36;
  }
  iPad.set(msg, blockSize);

  const innerHash = sha256Bytes(iPad);
  oPad.set(innerHash, blockSize);

  const outerHash = sha256Bytes(oPad);
  return Array.from(outerHash, (b) => b.toString(16).padStart(2, '0')).join('');
}

// -------------------------------------------------------------
// Вычисление хеша блока транзакции и подписи состояния
// -------------------------------------------------------------

export function computeTxHash(
  prevHash: string,
  id: string,
  type: TransactionType,
  amount: number,
  balanceAfter: number,
  timestamp: number,
  nonce: number,
): string {
  const payload = `${prevHash}|${id}|${type}|${amount}|${balanceAfter}|${timestamp}|${nonce}|${SECRET_SALT}`;
  return sha256(payload);
}

export function computeWalletSignature(balance: number, lastVerifiedHash: string, txCount: number): string {
  const payload = `balance=${balance};hash=${lastVerifiedHash};txs=${txCount}`;
  return hmacSha256(SECRET_SALT, payload);
}

// -------------------------------------------------------------
// Инициализация, проведение транзакций и проверка (Audit Chain)
// -------------------------------------------------------------

export function createInitialWallet(initialBalance = 100): WalletState {
  const timestamp = Date.now();
  const genesisTx: WalletTransaction = {
    id: 'tx_genesis_0',
    type: 'init',
    amount: initialBalance,
    balanceAfter: initialBalance,
    timestamp,
    nonce: 0,
    prevHash: GENESIS_HASH,
    hash: computeTxHash(GENESIS_HASH, 'tx_genesis_0', 'init', initialBalance, initialBalance, timestamp, 0),
  };

  const state: WalletState = {
    balance: initialBalance,
    lastVerifiedHash: genesisTx.hash,
    transactions: [genesisTx],
    signature: computeWalletSignature(initialBalance, genesisTx.hash, 1),
    tamperCount: 0,
  };
  return state;
}

const MAX_ALLOWABLE_AMOUNTS: Record<TransactionType, { min: number; max: number }> = {
  init: { min: 0, max: 1000 },
  chest: { min: 1, max: 30 },
  elite: { min: 10, max: 50 },
  boss: { min: 50, max: 150 },
  slot_spin: { min: -10, max: -10 },
  slot_win: { min: 0, max: 1000 },
  case_open: { min: -50, max: -50 },
  case_win: { min: 0, max: 200 },
  withdraw: { min: -1_000_000, max: 0 },
};

export function appendTransaction(
  state: WalletState,
  type: TransactionType,
  amount: number,
  overrideTimestamp?: number,
): { state: WalletState; success: boolean; error?: string } {
  // 1. Проверка диапазона допустимых сумм
  const rule = MAX_ALLOWABLE_AMOUNTS[type];
  if (!rule || amount < rule.min || amount > rule.max) {
    return {
      state,
      success: false,
      error: `Недопустимая сумма транзакции ${type}: ${amount} (лимит [${rule?.min}..${rule?.max}])`,
    };
  }

  // 2. Проверка достаточности средств при списании
  const nextBalance = state.balance + amount;
  if (nextBalance < 0) {
    return {
      state,
      success: false,
      error: `Недостаточно $GFC: баланс ${state.balance}, требуется ${-amount}`,
    };
  }

  const nonce = state.transactions.length;
  const timestamp = overrideTimestamp ?? Date.now();
  const id = `tx_${type}_${timestamp}_${nonce}`;
  const prevHash = state.lastVerifiedHash;

  const hash = computeTxHash(prevHash, id, type, amount, nextBalance, timestamp, nonce);

  const tx: WalletTransaction = {
    id,
    type,
    amount,
    balanceAfter: nextBalance,
    timestamp,
    nonce,
    prevHash,
    hash,
  };

  const updatedTransactions = [...state.transactions, tx];
  const nextSignature = computeWalletSignature(nextBalance, hash, updatedTransactions.length);

  return {
    state: {
      balance: nextBalance,
      lastVerifiedHash: hash,
      transactions: updatedTransactions,
      signature: nextSignature,
      tamperCount: state.tamperCount,
    },
    success: true,
  };
}

export interface VerificationResult {
  valid: boolean;
  reason?: string;
  safeBalance: number;
  recoveredState: WalletState;
}

/**
 * Полная проверка целостности кошелька:
 * 1. Проверка HMAC подписи состояния
 * 2. Проверка непрерывности цепочки хешей от Genesis
 * 3. Проверка инвариантов каждого баланса
 * 4. При взломе: безопасное восстановление до последней неповреждённой точки
 */
export function verifyWallet(state: WalletState): VerificationResult {
  // 1. Проверка подписи
  const expectedSig = computeWalletSignature(state.balance, state.lastVerifiedHash, state.transactions.length);
  const signatureMatches = state.signature === expectedSig;

  if (state.transactions.length === 0) {
    const fresh = createInitialWallet(0);
    return {
      valid: false,
      reason: 'Пустой журнал транзакций',
      safeBalance: 0,
      recoveredState: { ...fresh, tamperCount: state.tamperCount + 1 },
    };
  }

  let expectedPrevHash = GENESIS_HASH;
  let runningBalance = 0;
  const validChain: WalletTransaction[] = [];

  for (let i = 0; i < state.transactions.length; i++) {
    const tx = state.transactions[i]!;

    // Проверка цепочки prevHash
    if (tx.prevHash !== expectedPrevHash) {
      return fallbackToSafeState(
        validChain,
        state.tamperCount + 1,
        `Нарушена цепочка хешей на блоке #${i} (${tx.id})`,
      );
    }

    // Проверка хеша блока
    const actualHash = computeTxHash(
      tx.prevHash,
      tx.id,
      tx.type,
      tx.amount,
      tx.balanceAfter,
      tx.timestamp,
      tx.nonce,
    );
    if (tx.hash !== actualHash) {
      return fallbackToSafeState(
        validChain,
        state.tamperCount + 1,
        `Поддельный хеш транзакции #${i}: ${tx.hash} != ${actualHash}`,
      );
    }

    // Проверка инварианта суммы
    const expectedAfter = runningBalance + tx.amount;
    if (tx.balanceAfter !== expectedAfter || tx.balanceAfter < 0) {
      return fallbackToSafeState(
        validChain,
        state.tamperCount + 1,
        `Некорректный баланс на блоке #${i}: ожидалось ${expectedAfter}, указано ${tx.balanceAfter}`,
      );
    }

    runningBalance = tx.balanceAfter;
    expectedPrevHash = tx.hash;
    validChain.push(tx);
  }

  // Если подпись в заголовке сейва не совпала (например баланс отредактирован в объекте state)
  if (!signatureMatches) {
    return fallbackToSafeState(
      validChain,
      state.tamperCount + 1,
      'HMAC подпись кошелька не совпадает с заявленным балансом',
    );
  }

  return {
    valid: true,
    safeBalance: state.balance,
    recoveredState: state,
  };
}

function fallbackToSafeState(
  validChain: WalletTransaction[],
  tamperCount: number,
  reason: string,
): VerificationResult {
  if (validChain.length === 0) {
    const initial = createInitialWallet(100);
    return {
      valid: false,
      reason,
      safeBalance: 100,
      recoveredState: { ...initial, tamperCount },
    };
  }
  const lastValid = validChain[validChain.length - 1]!;
  const safeBalance = lastValid.balanceAfter;
  const signature = computeWalletSignature(safeBalance, lastValid.hash, validChain.length);
  return {
    valid: false,
    reason,
    safeBalance,
    recoveredState: {
      balance: safeBalance,
      lastVerifiedHash: lastValid.hash,
      transactions: validChain,
      signature,
      tamperCount,
    },
  };
}

// -------------------------------------------------------------
// Provably Fair CSPRNG генератор для слотов и рулетки
// -------------------------------------------------------------

export function getSecureRandomFloat(): number {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const array = new Uint32Array(1);
    crypto.getRandomValues(array);
    return array[0]! / 0xffffffff;
  }
  return Math.random();
}

export function generateSeedCommitment(): { serverSeed: string; commitmentHash: string } {
  let seedStr = '';
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    seedStr = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  } else {
    seedStr = Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
  return {
    serverSeed: seedStr,
    commitmentHash: sha256(seedStr + SECRET_SALT),
  };
}
