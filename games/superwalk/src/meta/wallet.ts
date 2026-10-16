// src/meta/wallet.ts
// Главный кошелёк $GFC для игрока.
// Связывает криптозащиту (security.ts), AMM-рынок (market.ts) и казино/кейсы (casino.ts).
// Обеспечивает персистентное сохранение, безопасную валидацию сейва при старте и API для HUD.

import {
  type WalletState,
  createInitialWallet,
  appendTransaction,
  verifyWallet,
  generateSeedCommitment,
  sha256,
} from './security.ts';
import { VirtualAmmMarket, type MarketTradeResult } from './market.ts';
import {
  ForestCasino,
  type SlotSpinResult,
  type SkinItem,
  SKINS_COLLECTION,
  SLOT_SPIN_COST,
  CASE_OPEN_COST,
} from './casino.ts';

const WALLET_STORAGE_KEY = 'gf_superwalk_wallet_v1';
const MARKET_STORAGE_KEY = 'gf_superwalk_market_v1';
const SKINS_STORAGE_KEY = 'gf_superwalk_skins_v1';
const EQUIPPED_SKIN_KEY = 'gf_superwalk_equipped_skin';

const CASE_REVEAL_DELAY_MS = 4000;
interface SavedCaseOpening {
  id: string;
  skinId: string;
  readyAt: number;
  isNew: boolean;
  revealed: boolean;
  compensationGfc: number;
}
export interface CaseOpening extends Omit<SavedCaseOpening, 'skinId'> { skin: SkinItem }

export interface WithdrawReceipt {
  amountGfc: number;
  usdEquivalent: number;
  usdEstimated: number;
  txHash: string;
  blockNumber: number;
  timestamp: number;
  recipient: string;
  network: string;
  feeUsd: number;
  slippage: number;
  status: 'success_simulated';
  statusTitle: string;
}

export type ExecuteWithdrawalResult =
  | { success: true; receipt: WithdrawReceipt; error?: undefined }
  | { success: false; error: string; receipt?: undefined };

export interface WithdrawSimulationResult {
  amountGfc: number;
  usdEstimated: number;
  slippage: number;
  feeUsd: number;
  status: 'rejected_forest_tax';
  statusTitle: string;
  humorMessage: string;
}

export class MetaWalletManager {
  private wallet: WalletState;
  private market: VirtualAmmMarket;
  private unlockedSkinIds: Set<string>;
  private equippedSkinId: string | null = null;
  private tamperedDetected = false;
  private spinNonce = 0;
  private caseOpening: SavedCaseOpening | null = null;

  constructor() {
    this.wallet = this.loadAndVerifyWallet();
    this.market = this.loadMarket();
    this.unlockedSkinIds = this.loadUnlockedSkins();
    this.equippedSkinId = this.loadEquippedSkin();
    // Восстановление уже оплаченного результата без нового ролла/списания.
    if (this.caseOpening?.revealed) {
      this.unlockedSkinIds.add(this.caseOpening.skinId);
      this.saveSkins();
    } else if (this.caseOpening && Date.now() >= this.caseOpening.readyAt) {
      this.finishSkinCase(this.caseOpening.id);
    }
  }

  public getBalance(): number {
    return this.wallet.balance;
  }

  public getMarket(): VirtualAmmMarket {
    return this.market;
  }

  public isTampered(): boolean {
    return this.tamperedDetected;
  }

  public getTamperCount(): number {
    return this.wallet.tamperCount;
  }

  public getWalletState(): Readonly<WalletState> {
    return this.wallet;
  }

  /**
   * Начисление $GFC за игровые достижения (открытие сундука, убийство элитки, победа над боссом)
   */
  public awardGfc(
    type: 'chest' | 'elite' | 'boss',
    specifiedAmount?: number,
  ): { success: boolean; amount: number; balance: number } {
    let amount = specifiedAmount;
    if (amount === undefined) {
      if (type === 'chest') amount = 5 + Math.floor(Math.random() * 11); // 5..15 $GFC
      else if (type === 'elite') amount = 25;
      else if (type === 'boss') amount = 100; // Босс Старый Пень
      else amount = 10;
    }

    const res = appendTransaction(this.wallet, type, amount);
    if (res.success) {
      this.wallet = res.state;
      this.saveWallet();
      return { success: true, amount, balance: this.wallet.balance };
    }
    return { success: false, amount: 0, balance: this.wallet.balance };
  }

  /**
   * Спин слот-машины за 10 $GFC
   */
  public playSlots(): {
    success: boolean;
    spinResult?: SlotSpinResult;
    netWin: number;
    error?: string;
  } {
    if (this.wallet.balance < SLOT_SPIN_COST) {
      return {
        success: false,
        netWin: 0,
        error: `Недостаточно $GFC для спина. Нужно ${SLOT_SPIN_COST}, на балансе ${this.wallet.balance}`,
      };
    }

    // 1. Списание ставки в журнал транзакций
    const debit = appendTransaction(this.wallet, 'slot_spin', -SLOT_SPIN_COST);
    if (!debit.success) {
      return { success: false, netWin: 0, error: debit.error };
    }
    this.wallet = debit.state;

    // Сжигаем часть монет в AMM (памп курса)
    this.market.burnGfc(SLOT_SPIN_COST);

    // 2. Provably Fair генерация спина
    const commitment = generateSeedCommitment();
    const clientSeed = 'superwalk_user_' + Date.now();
    this.spinNonce++;
    const spin = ForestCasino.spinSlots(commitment.serverSeed, clientSeed, this.spinNonce);

    // 3. Зачисление выигрыша, если есть
    if (spin.payout > 0) {
      const credit = appendTransaction(this.wallet, 'slot_win', spin.payout);
      if (credit.success) {
        this.wallet = credit.state;
      }
    }

    this.saveWallet();
    this.saveMarket();

    return {
      success: true,
      spinResult: spin,
      netWin: spin.payout - SLOT_SPIN_COST,
    };
  }

  /**
   * Открытие CS-кейса за 50 $GFC
   */
  public openSkinCase(): {
    success: boolean;
    skin?: SkinItem;
    isNew: boolean;
    error?: string;
    opening?: CaseOpening;
  } {
    if (this.caseOpening && !this.caseOpening.revealed) {
      return { success: false, isNew: false, error: 'Предыдущий кейс ещё открывается.' };
    }
    if (this.wallet.balance < CASE_OPEN_COST) {
      return {
        success: false,
        isNew: false,
        error: `Недостаточно $GFC. Открытие кейса стоит ${CASE_OPEN_COST} $GFC`,
      };
    }

    const debit = appendTransaction(this.wallet, 'case_open', -CASE_OPEN_COST);
    if (!debit.success) {
      return { success: false, isNew: false, error: debit.error };
    }
    this.wallet = debit.state;

    // Сжигание монет в AMM
    this.market.burnGfc(CASE_OPEN_COST);

    // Ролл скина
    const commitment = generateSeedCommitment();
    const clientSeed = 'case_roll_' + Date.now();
    this.spinNonce++;
    const roll = ForestCasino.openCase(commitment.serverSeed, clientSeed, this.spinNonce);

    const isNew = !this.unlockedSkinIds.has(roll.item.id);
    const debitTx = this.wallet.transactions[this.wallet.transactions.length - 1]!;
    this.caseOpening = {
      id: debitTx.hash, skinId: roll.item.id,
      readyAt: debitTx.timestamp + CASE_REVEAL_DELAY_MS,
      isNew, revealed: false,
      compensationGfc: isNew ? 0 : roll.item.duplicatePayoutGfc,
    };
    // Результат и списание сохраняются одним JSON; коллекция пока не изменяется.
    this.saveWallet();
    this.saveMarket();

    return {
      success: true,
      skin: roll.item,
      isNew,
      opening: this.getCaseOpening()!,
    };
  }

  public getCaseOpening(): CaseOpening | null {
    if (!this.caseOpening) return null;
    const skin = SKINS_COLLECTION.find(s => s.id === this.caseOpening!.skinId);
    return skin ? { ...this.caseOpening, skin } : null;
  }

  public finishSkinCase(id: string): { success: boolean; error?: string; opening?: CaseOpening } {
    const opening = this.caseOpening;
    if (!opening || opening.id !== id) return { success: false, error: 'Результат кейса не найден.' };
    if (opening.revealed) return { success: true, opening: this.getCaseOpening()! };
    if (Date.now() < opening.readyAt) return { success: false, error: 'Барабан ещё вращается.' };
    const credit = appendTransaction(this.wallet, 'case_win', opening.compensationGfc);
    if (!credit.success) return { success: false, error: credit.error };
    this.wallet = credit.state;
    opening.revealed = true;
    this.unlockedSkinIds.add(opening.skinId);
    // Сначала сохраняем завершённый результат: загрузка восстановит коллекцию,
    // даже если запись её отдельного ключа прервалась.
    this.saveWallet();
    this.saveSkins();
    return { success: true, opening: this.getCaseOpening()! };
  }

  public getUnlockedSkins(): SkinItem[] {
    return SKINS_COLLECTION.filter((s) => this.unlockedSkinIds.has(s.id));
  }

  public getEquippedSkin(): SkinItem | null {
    if (!this.equippedSkinId) return null;
    return SKINS_COLLECTION.find((s) => s.id === this.equippedSkinId) ?? null;
  }

  public equipSkin(skinId: string): boolean {
    if (!this.unlockedSkinIds.has(skinId)) return false;
    this.equippedSkinId = skinId;
    try {
      localStorage.setItem(EQUIPPED_SKIN_KEY, skinId);
    } catch {
      // ignore
    }
    return true;
  }

  public unequipSkin(): void {
    this.equippedSkinId = null;
    try {
      localStorage.removeItem(EQUIPPED_SKIN_KEY);
    } catch {
      // ignore
    }
  }

  /**
   * Пародийная симуляция вывода на карту / Telegram Gram
   */
  public simulateWithdrawal(amountGfc: number): WithdrawSimulationResult {
    const trade = this.market.simulateSellGfc(amountGfc);

    const humorReasons = [
      'Лесной Совет Бобров заморозил транзакцию на постройку плотины.',
      'Дятлы-валидаторы отклонили блок из-за повышенной перфорации коры.',
      'Комиссия Совиного Центробанка превысила объём заявки на 146%.',
      'Белка-кассир спрятала монеты в дупло до наступления зимы.',
    ];
    const humorMessage = humorReasons[Math.floor(Math.random() * humorReasons.length)]!;

    return {
      amountGfc,
      usdEstimated: trade.usdReceived,
      slippage: trade.slippagePercent,
      feeUsd: trade.feeUsd,
      status: 'rejected_forest_tax',
      statusTitle: 'Транзакция заморожена',
      humorMessage,
    };
  }

  /**
   * Исполнение вывода средств в TON Forest с генерацией криптографического чека
   */
  public executeWithdrawal(
    amountGfc: number,
    recipient = '@superfox_gram',
  ): ExecuteWithdrawalResult {
    if (amountGfc <= 0) {
      return {
        success: false,
        error: 'Сумма вывода должна быть больше нуля',
      };
    }

    if (this.wallet.balance < amountGfc) {
      return {
        success: false,
        error: `Недостаточно $GFC на балансе. Доступно: ${this.wallet.balance}, запрошено: ${amountGfc}`,
      };
    }

    // 1. Честное списание $GFC с цепочкой хешей и HMAC подписью
    const debit = appendTransaction(this.wallet, 'withdraw', -amountGfc);
    if (!debit.success) {
      return {
        success: false,
        error: debit.error ?? 'Ошибка списания средств с кошелька',
      };
    }
    this.wallet = debit.state;

    // 2. Влияние продажи на AMM-рынок (Constant Product x * y = k)
    const trade = this.market.executeSellGfc(amountGfc);

    // 3. Генерация криптографического txHash и номера блока TON Forest
    const now = Date.now();
    const hashSeed = `ton_forest_withdraw_${now}_${amountGfc}_${recipient}_${this.wallet.transactions.length}`;
    const txHash = `0x${sha256(hashSeed).slice(0, 40)}`;
    const blockNumber = 12_840_000 + (this.wallet.transactions.length * 17) + (now % 1000);

    // 4. Формирование чека об успешной операции
    const receipt: WithdrawReceipt = {
      amountGfc,
      usdEquivalent: trade.usdReceived,
      usdEstimated: trade.usdReceived,
      txHash,
      blockNumber,
      timestamp: now,
      recipient,
      network: 'TON Forest',
      feeUsd: trade.feeUsd,
      slippage: trade.slippagePercent,
      status: 'success_simulated',
      statusTitle: 'Перевод успешно отправлен!',
    };

    // 5. Сохранение персистентного состояния сейва
    this.saveWallet();
    this.saveMarket();

    return {
      success: true,
      receipt,
    };
  }

  // -------------------------------------------------------------
  // Приватные методы загрузки и сохранения
  // -------------------------------------------------------------

  private loadAndVerifyWallet(): WalletState {
    try {
      const raw = localStorage.getItem(WALLET_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as WalletState;
        const audit = verifyWallet(parsed);
        if (audit.valid) {
          const candidate = (parsed as WalletState & { caseOpening?: SavedCaseOpening }).caseOpening;
          if (candidate && typeof candidate.id === 'string' && typeof candidate.skinId === 'string'
            && typeof candidate.isNew === 'boolean' && typeof candidate.revealed === 'boolean'
            && Number.isFinite(candidate.readyAt) && SKINS_COLLECTION.some(s => s.id === candidate.skinId)) {
            const debit = parsed.transactions.find(tx => tx.hash === candidate.id && tx.type === 'case_open' && tx.amount === -CASE_OPEN_COST);
            const skin = SKINS_COLLECTION.find(s => s.id === candidate.skinId)!;
            // Завершённые кейсы старой версии уже обработаны без компенсации.
            const compensation = candidate.compensationGfc ?? (candidate.revealed || candidate.isNew ? 0 : skin.duplicatePayoutGfc);
            const expected = candidate.isNew ? 0 : skin.duplicatePayoutGfc;
            if (debit && candidate.readyAt === debit.timestamp + CASE_REVEAL_DELAY_MS
              && (compensation === expected || (candidate.revealed && compensation === 0))) {
              this.caseOpening = { ...candidate, compensationGfc: compensation };
            }
          }
          return parsed;
        } else {
          // Взлом или повреждение!
          this.tamperedDetected = true;
          this.saveStateToStorage(WALLET_STORAGE_KEY, audit.recoveredState);
          return audit.recoveredState;
        }
      }
    } catch {
      // Ошибка JSON или доступа к localStorage
    }

    const initial = createInitialWallet(100);
    this.saveStateToStorage(WALLET_STORAGE_KEY, initial);
    return initial;
  }

  private loadMarket(): VirtualAmmMarket {
    try {
      const raw = localStorage.getItem(MARKET_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return new VirtualAmmMarket(parsed);
      }
    } catch {
      // ignore
    }
    return new VirtualAmmMarket();
  }

  private loadUnlockedSkins(): Set<string> {
    try {
      const raw = localStorage.getItem(SKINS_STORAGE_KEY);
      if (raw) {
        const list = JSON.parse(raw) as string[];
        return new Set(list);
      }
    } catch {
      // ignore
    }
    return new Set(['skin_sock']); // Стартовый носок разблокирован всегда
  }

  private loadEquippedSkin(): string | null {
    try {
      return localStorage.getItem(EQUIPPED_SKIN_KEY);
    } catch {
      return null;
    }
  }

  private saveWallet(): void {
    this.saveStateToStorage(WALLET_STORAGE_KEY, { ...this.wallet, caseOpening: this.caseOpening });
  }

  private saveMarket(): void {
    this.saveStateToStorage(MARKET_STORAGE_KEY, this.market.getMarketState());
  }

  private saveSkins(): void {
    this.saveStateToStorage(SKINS_STORAGE_KEY, Array.from(this.unlockedSkinIds));
  }

  private saveStateToStorage(key: string, data: unknown): void {
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch {
      // ignore quota
    }
  }
}
