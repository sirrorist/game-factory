// Только временные сборки для проверки. В опубликованную игру этот модуль не входит.
// Функция самодостаточна: сервер вставляет её в HTML после стирания типов Node.
export async function prepareScene(value: unknown, scene: string, touch: boolean): Promise<void> {
  const app = value as {
    paused: boolean; isGameOver: boolean; runTime: number; lastTime: number; fpsTimer: number; autoCameraEnabled: boolean;
    input: { active: boolean; touchMode: boolean; enableTouch(): void; unlock(): void };
    tick(time: number): void;
    inventory: { weapons: Map<string, number>; tomes: Map<string, number> };
    ownedItems: Map<string, number>;
    combatState: { heroHp: number; heroMaxHp: number; heroLevel: number; kills: number; pendingLevelUps: number;
      hasteLevel: number; mightLevel: number; weapons: { id: string; level: number; cooldownTimer: number }[] };
    recalculateHeroStats(): void;
    updateInventoryHud(): void; updateDashboard(): void; updateDebug(): void;
    positionFeedback?(): void;
    openMenu(): void; switchMenuTab?(tab: string): void; openTabModal(): void; openUpgradeModal(): void; endGame(victory: boolean): void;
    openWalletModal(): void; switchWalletTab(tab: string): void;
    handleCaseOpen(): void; handleWithdraw(): void;
    handleChestOpened(chest: unknown): void;
    updateWithdrawCalculations(): void;
    walletManager: { unlockedSkinIds: Set<string>; getWalletState(): { balance: number } };
    renderWalletMarketInfo(): void;
    itemPopupTimeout?: number;
  };
  const el = (id: string) => document.getElementById(id)!;
  app.paused = true;
  app.input.active = false;
  app.input.unlock();
  document.documentElement.dataset.uiTouch = String(app.input.touchMode);
  // В iframe на ПК показываем тач-вид, но проверяем исходный режим до этой подстановки.
  if (touch && !app.input.touchMode) {
    app.input.enableTouch();
    app.autoCameraEnabled = true;
    el('camera-label').textContent = 'Автокамера: вкл';
  }
  const rich = !['hud', 'upgrade', 'wallet-slots', 'wallet-cases', 'wallet-result', 'wallet-skins', 'wallet-withdraw', 'wallet-receipt'].includes(scene);
  if (rich) {
    app.inventory.weapons.set('spark_sling', 5);
    app.inventory.tomes.set('tome_haste', 5);
    app.inventory.tomes.set('tome_might', 5);
    for (const id of ['acorn', 'swift_feather', 'magnet_pebble', 'burdock', 'lucky_paw', 'fang', 'honeycomb', 'spring_boots', 'rage_totem', 'storm_bead', 'mirror_bark', 'four_leaf', 'ninth_tail', 'phoenix_down']) app.ownedItems.set(id, 12);
    app.combatState.heroLevel = 25;
    app.combatState.kills = 12345;
    app.runTime = 420;
    app.combatState.hasteLevel = app.inventory.tomes.get('tome_haste') ?? 0;
    app.combatState.mightLevel = app.inventory.tomes.get('tome_might') ?? 0;
    app.combatState.weapons = [...app.inventory.weapons].map(([id, level]) => ({ id, level, cooldownTimer: 0.1 }));
    app.recalculateHeroStats();
  }
  app.updateInventoryHud();
  // Один настоящий кадр; затем мир заморожен, чтобы сравнивать одну и ту же сцену.
  app.lastTime = 1000;
  app.fpsTimer = 1000;
  app.paused = false;
  app.tick(1000);
  app.paused = true;
  app.tick = () => {};
  if (scene === 'pause' || scene === 'pause-stats') app.openMenu();
  if (scene === 'pause-stats') app.switchMenuTab?.('stats');
  if (scene === 'dashboard') app.openTabModal();
  if (scene === 'upgrade') { app.combatState.pendingLevelUps = 1; app.openUpgradeModal(); }
  if (scene === 'victory' || scene === 'defeat') app.endGame(scene === 'victory');
  if (scene === 'boss' || scene === 'boss-toast' || scene === 'boss-item') el('boss-hud').hidden = false;
  if (scene === 'toast' || scene === 'boss-toast') {
    // Текст — проверка длинного сообщения; оболочка и CSS остаются настоящими.
    el('toast').hidden = false;
    el('toast').textContent = 'Найден легендарный предмет: Девятый хвост (+15 $GFC)!';
  }
  if (scene === 'item' || scene === 'boss-item') {
    app.handleChestOpened({ opened: true });
    // Редкая статическая сцена не должна исчезать при медленном кадре 4K.
    // Живой прогон не использует фикстуру и сохраняет обычное время уведомления.
    clearTimeout(app.itemPopupTimeout);
  }
  if (scene === 'debug') { app.updateDebug(); el('debug').hidden = false; }
  if (scene.startsWith('wallet-')) {
    if (scene === 'wallet-skins-rich') {
      // Только образец коллекции для визуального просмотра; не сценарий получения наград.
      app.walletManager.unlockedSkinIds = new Set(['skin_sock', 'skin_forest_camo', 'skin_neon_fox', 'skin_fade_tail']);
    }
    app.openWalletModal();
    const tab = scene === 'wallet-balance-large' ? 'slots' : scene === 'wallet-result' ? 'cases'
      : scene === 'wallet-receipt' || scene === 'wallet-withdraw-error' ? 'withdraw'
      : scene === 'wallet-skins-rich' ? 'skins' : scene.slice(7);
    app.switchWalletTab(tab);
    if (scene === 'wallet-balance-large') {
      // Образец глифов, не начисление и не проверка происхождения баланса.
      app.walletManager.getWalletState().balance = 1000000;
      app.renderWalletMarketInfo();
    }
    if (scene === 'wallet-withdraw-error') {
      (el('input-withdraw-amount') as HTMLInputElement).value = '1000001';
      app.updateWithdrawCalculations();
    }
    if (scene === 'wallet-result') {
      // Ролл остаётся детерминированным, но ожидание выдачи должно пройти по часам.
      const originalNow = Date.now;
      const fixedNow = originalNow();
      app.handleCaseOpen();
      const startedAt = performance.now();
      Date.now = () => fixedNow + Math.floor(performance.now() - startedAt);
      try { await new Promise(resolve => setTimeout(resolve, 4200)); }
      finally { Date.now = originalNow; }
      el('toast').hidden = true;
    }
    if (scene === 'wallet-receipt') {
      app.handleWithdraw();
      await new Promise(resolve => setTimeout(resolve, 1800));
      // Хеш случаен по определению; визуально проверяем его формат, а не криптографию.
      el('receipt-txhash').textContent = '0x12345678...abcdef';
      el('toast').hidden = true;
    }
  }
  await document.fonts.ready;
  app.positionFeedback?.();
  // После подготовки можно взаимодействовать с интерфейсом: его таймеры идут,
  // но исходный вид сохраняет одинаковую дату и случайность между сборками.
  const preparedNow = Date.now();
  const preparedAt = performance.now();
  Date.now = () => preparedNow + Math.floor(performance.now() - preparedAt);
  document.documentElement.dataset.uiReady = scene;
}
