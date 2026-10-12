// src/meta/market.ts
// Модуль динамического курса $GFC к USD / GRAM.
// Реализует:
// 1. Модель Constant Product AMM (x * y = k) с честным расчётом Slippage и комиссий.
// 2. Влияние действий игрока: продажа/фарм создаёт Sell pressure, сжигание в слотах/кейсах пампит курс.
// 3. Симуляция глобального рынка (Ornstein-Uhlenbeck процесс + сделки «китов» леса).
// 4. Скользящий буфер цен LiveMarketChart (32 точки) с моментальной реакцией на памп/дамп и SVG-рендерингом.

export interface MarketCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MarketTradeResult {
  amountGfc: number;
  usdReceived: number;
  effectivePrice: number;
  spotPrice: number;
  slippagePercent: number;
  feeUsd: number;
  newPrice: number;
}

export interface MarketState {
  reserveGfc: number;
  reserveUsd: number;
  k: number;
  candles: MarketCandle[];
  lastTickTime: number;
  whaleCooldown: number;
  chartPrices?: number[];
}

export interface ChartRenderResult {
  isUp: boolean;
  changePct: number;
  currentPrice: number;
}

const DEFAULT_RESERVE_GFC = 200_000;
const DEFAULT_RESERVE_USD = 50_000; // Стартовый курс: 50000 / 200000 = $0.2500 за 1 $GFC
const LP_FEE_RATE = 0.003; // 0.3% комиссия пула ликвидности

/**
 * Скользящий буфер цен (32 точки) для живого графика в интерфейсе Gram Wallet.
 * При добавлении новой цены массив плавно сдвигается влево (shift), а справа добавляется новая точка.
 */
export class LiveMarketChart {
  public static readonly BUFFER_SIZE = 32;
  public priceHistory: number[];

  constructor(initialPrice: number = 0.25, history?: number[]) {
    if (history && history.length > 0) {
      this.priceHistory = [...history];
      while (this.priceHistory.length < LiveMarketChart.BUFFER_SIZE) {
        this.priceHistory.unshift(this.priceHistory[0] ?? initialPrice);
      }
      if (this.priceHistory.length > LiveMarketChart.BUFFER_SIZE) {
        this.priceHistory = this.priceHistory.slice(-LiveMarketChart.BUFFER_SIZE);
      }
    } else {
      this.priceHistory = this.generateInitialHistory(initialPrice);
    }
  }

  public getHistory(): readonly number[] {
    return this.priceHistory;
  }

  public getCurrentPrice(): number {
    if (this.priceHistory.length === 0) return 0;
    return this.priceHistory[this.priceHistory.length - 1]!;
  }

  public getMinPrice(): number {
    if (this.priceHistory.length === 0) return 0;
    return Math.min(...this.priceHistory);
  }

  public getMaxPrice(): number {
    if (this.priceHistory.length === 0) return 0;
    return Math.max(...this.priceHistory);
  }

  public getPriceRange(): { min: number; max: number; range: number } {
    const min = this.getMinPrice();
    const max = this.getMaxPrice();
    return { min, max, range: Math.max(0, max - min) };
  }

  /**
   * Сдвиг массива влево и добавление новой точки цены справа.
   */
  public pushPrice(price: number): void {
    if (this.priceHistory.length >= LiveMarketChart.BUFFER_SIZE) {
      this.priceHistory.shift();
    }
    this.priceHistory.push(price);
  }

  /**
   * Отрисовка живого SVG графика:
   * - ломаная линии цены
   * - полупрозрачный полигон с <linearGradient> под кривой
   * - пульсирующий маркер текущей цены (.gf-chart-ping) и ядро (.gf-chart-core) на правом краю
   * Возвращает { isUp, changePct, currentPrice } для динамического цвета (#4ade80 / #ef4444)
   */
  public renderSvg(
    svgEl?: { innerHTML: string } | null,
    width: number = 300,
    height: number = 50,
  ): ChartRenderResult {
    const count = this.priceHistory.length;
    if (count === 0) {
      return { isUp: true, changePct: 0, currentPrice: 0 };
    }

    const firstPrice = this.priceHistory[0]!;
    const currentPrice = this.priceHistory[count - 1]!;
    const rawChange = firstPrice > 0 ? ((currentPrice - firstPrice) / firstPrice) * 100 : 0;
    const changePct = Math.round(rawChange * 100) / 100;
    const isUp = changePct >= 0;
    const color = isUp ? '#4ade80' : '#ef4444';

    const minP = this.getMinPrice();
    const maxP = this.getMaxPrice();
    const range = maxP - minP;

    const padTop = 4;
    const padBottom = 4;
    const usableHeight = Math.max(1, height - padTop - padBottom);

    const stepX = count > 1 ? width / (count - 1) : 0;
    const coords: { x: number; y: number }[] = [];

    for (let i = 0; i < count; i++) {
      const p = this.priceHistory[i]!;
      const x = i * stepX;
      let y: number;
      if (range < 1e-6) {
        y = height / 2;
      } else {
        const norm = (p - minP) / range;
        y = height - padBottom - norm * usableHeight;
      }
      coords.push({ x, y });
    }

    const polylinePoints = coords
      .map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`)
      .join(' ');

    const lastCoord = coords[coords.length - 1]!;
    const firstCoord = coords[0]!;
    const polygonPoints = `${firstCoord.x.toFixed(1)},${height} ${polylinePoints} ${lastCoord.x.toFixed(1)},${height}`;

    const gradId = 'gf-chart-grad';
    const svgMarkup = `
      <defs>
        <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${color}" stop-opacity="0.35" />
          <stop offset="100%" stop-color="${color}" stop-opacity="0.0" />
        </linearGradient>
      </defs>
      <polygon fill="url(#${gradId})" points="${polygonPoints}" />
      <polyline fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" points="${polylinePoints}" />
      <circle class="gf-chart-ping" cx="${lastCoord.x.toFixed(1)}" cy="${lastCoord.y.toFixed(1)}" r="3" fill="${color}" />
      <circle class="gf-chart-core" cx="${lastCoord.x.toFixed(1)}" cy="${lastCoord.y.toFixed(1)}" r="3" fill="${color}" />
    `.trim();

    if (svgEl && typeof svgEl === 'object' && 'innerHTML' in svgEl) {
      svgEl.innerHTML = svgMarkup;
    }

    return {
      isUp,
      changePct,
      currentPrice,
    };
  }

  private generateInitialHistory(basePrice: number): number[] {
    const points: number[] = [];
    let p = basePrice * 0.985;
    for (let i = 0; i < LiveMarketChart.BUFFER_SIZE; i++) {
      if (i === LiveMarketChart.BUFFER_SIZE - 1) {
        points.push(basePrice);
      } else {
        const delta = (Math.random() - 0.49) * 0.002 * basePrice;
        p = Math.max(0.01, p + delta);
        points.push(p);
      }
    }
    return points;
  }
}

export class VirtualAmmMarket {
  private state: MarketState;
  private liveChart: LiveMarketChart;
  private tickAccumulator: number = 0;

  constructor(savedState?: Partial<MarketState>) {
    const reserveGfc = savedState?.reserveGfc ?? DEFAULT_RESERVE_GFC;
    const reserveUsd = savedState?.reserveUsd ?? DEFAULT_RESERVE_USD;
    const k = reserveGfc * reserveUsd;
    const initialPrice = reserveUsd / reserveGfc;

    const now = Date.now();
    let candles = savedState?.candles ?? [];
    if (candles.length === 0) {
      // Инициализируем 15 стартовых свечей для графика
      candles = this.generateInitialCandles(now, initialPrice);
    }

    this.liveChart = new LiveMarketChart(initialPrice, savedState?.chartPrices);

    this.state = {
      reserveGfc,
      reserveUsd,
      k,
      candles,
      lastTickTime: now,
      whaleCooldown: savedState?.whaleCooldown ?? 12,
      chartPrices: this.liveChart.priceHistory,
    };
  }

  public getSpotPrice(): number {
    return this.state.reserveUsd / this.state.reserveGfc;
  }

  public getMarketState(): Readonly<MarketState> {
    return this.state;
  }

  public getLiveChart(): LiveMarketChart {
    return this.liveChart;
  }

  /**
   * Симуляция продажи $GFC в пул за USD (формула Constant Product x * y = k)
   */
  public simulateSellGfc(amountGfc: number): MarketTradeResult {
    if (amountGfc <= 0) {
      const p = this.getSpotPrice();
      return {
        amountGfc: 0,
        usdReceived: 0,
        effectivePrice: p,
        spotPrice: p,
        slippagePercent: 0,
        feeUsd: 0,
        newPrice: p,
      };
    }

    const spotPrice = this.getSpotPrice();
    const netGfcIn = amountGfc * (1 - LP_FEE_RATE);
    const newReserveGfc = this.state.reserveGfc + netGfcIn;
    const newReserveUsd = this.state.k / newReserveGfc;
    const usdReceived = Math.max(0, this.state.reserveUsd - newReserveUsd);

    const effectivePrice = usdReceived / amountGfc;
    const slippagePercent = Math.max(0, ((spotPrice - effectivePrice) / spotPrice) * 100);
    const feeUsd = (amountGfc * spotPrice) * LP_FEE_RATE;
    const newPrice = newReserveUsd / newReserveGfc;

    return {
      amountGfc,
      usdReceived,
      effectivePrice,
      spotPrice,
      slippagePercent,
      feeUsd,
      newPrice,
    };
  }

  /**
   * Исполнение продажи: изменяет резервы AMM пула и фиксирует объём в свече и живом графике
   */
  public executeSellGfc(amountGfc: number): MarketTradeResult {
    const res = this.simulateSellGfc(amountGfc);
    if (amountGfc <= 0) return res;

    const netGfcIn = amountGfc * (1 - LP_FEE_RATE);
    this.state.reserveGfc += netGfcIn;
    this.state.reserveUsd = Math.max(1000, this.state.reserveUsd - res.usdReceived);
    this.state.k = this.state.reserveGfc * this.state.reserveUsd;

    this.recordPriceToCurrentCandle(res.newPrice, amountGfc);
    this.liveChart.pushPrice(res.newPrice);
    return res;
  }

  /**
   * Сжигание $GFC (при спинах в казино и открытии кейсов).
   * Монеты навсегда изымаются из обращения — предложение падает, курс растёт (Pump)!
   */
  public burnGfc(amountGfc: number): number {
    if (amountGfc <= 0) return this.getSpotPrice();

    // Изъятие из резерва AMM с сохранением k поднимает курс
    const removedFromReserve = Math.min(amountGfc * 0.4, this.state.reserveGfc * 0.05);
    this.state.reserveGfc = Math.max(10_000, this.state.reserveGfc - removedFromReserve);
    this.state.k = this.state.reserveGfc * this.state.reserveUsd;

    const newPrice = this.getSpotPrice();
    this.recordPriceToCurrentCandle(newPrice, amountGfc);
    this.liveChart.pushPrice(newPrice);
    return newPrice;
  }

  /**
   * Симуляция тика рынка: сглаженный процесс возврата к среднему (Ornstein-Uhlenbeck)
   * Волатильность шага удерживается в реалистичных рамках ±0.2..0.8% без покадрового скачка.
   */
  public tick(dt: number, now = Date.now()): void {
    this.state.lastTickTime = now;
    this.tickAccumulator += dt;

    // Шаг симуляции:
    // Если dt >= 1.0 (дискретный шаг тестов), выполняем сразу.
    // Если dt < 1.0 (покадровый вызов из requestAnimationFrame), накапливаем до 1.0 с,
    // чтобы курс менялся плавно и читаемо без дикого шума при 60-144 Гц.
    const STEP_THRESHOLD = 1.0;
    if (dt < STEP_THRESHOLD && this.tickAccumulator < STEP_THRESHOLD) {
      return;
    }

    const stepDt = Math.min(2.0, this.tickAccumulator > 0 ? this.tickAccumulator : dt);
    this.tickAccumulator = 0;

    // 1. Псевдослучайные флуктуации (Mean-reverting Ornstein-Uhlenbeck)
    const currentPrice = this.getSpotPrice();
    const meanTarget = 0.28; // долгосрочная цель лесного рынка
    const theta = 0.05; // скорость возврата к среднему

    // Нормальный шум (Box-Muller)
    const u1 = Math.max(1e-6, Math.random());
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);

    // Сглаженная диффузия: реалистичная волатильность шага в диапазоне ±0.2..0.8%
    const clampedZ = Math.max(-2.0, Math.min(2.0, z));
    const stepVolatility = 0.002 + Math.abs(clampedZ) * 0.003; // от 0.2% до 0.8%
    const direction = clampedZ >= 0 ? 1 : -1;
    const diffusion = currentPrice * stepVolatility * direction * Math.sqrt(Math.min(1.0, Math.max(0.1, stepDt)));

    const drift = theta * (meanTarget - currentPrice) * stepDt;
    const priceDelta = drift + diffusion;

    let targetPrice = Math.max(0.05, currentPrice + priceDelta);

    // 2. Периодические сделки лесных «китов» (Whales)
    this.state.whaleCooldown -= stepDt;
    if (this.state.whaleCooldown <= 0) {
      this.state.whaleCooldown = 15 + Math.random() * 20;
      // Киты: 60% памп (покупка орехами), 40% дамп
      const isPump = Math.random() < 0.6;
      const whaleMagnitude = 0.04 + Math.random() * 0.08;
      targetPrice *= isPump ? (1 + whaleMagnitude) : (1 - whaleMagnitude);
    }

    // Обновляем резервы AMM под новую целевую цену с сохранением k
    this.state.reserveGfc = Math.sqrt(this.state.k / targetPrice);
    this.state.reserveUsd = Math.sqrt(this.state.k * targetPrice);

    this.recordPriceToCurrentCandle(targetPrice, Math.abs(priceDelta) * 1000, now);
    this.liveChart.pushPrice(targetPrice);
  }

  private recordPriceToCurrentCandle(price: number, volumeAdded: number, now = Date.now()): void {
    const candles = this.state.candles;
    if (candles.length === 0) {
      candles.push({
        time: now,
        open: price,
        high: price,
        low: price,
        close: price,
        volume: volumeAdded,
      });
      return;
    }

    const current = candles[candles.length - 1]!;
    const CANDLE_INTERVAL_MS = 60_000; // 1-минутные свечи

    if (now - current.time >= CANDLE_INTERVAL_MS) {
      // Закрываем свечу и открываем новую
      candles.push({
        time: now,
        open: current.close,
        high: Math.max(current.close, price),
        low: Math.min(current.close, price),
        close: price,
        volume: volumeAdded,
      });
      if (candles.length > 30) {
        candles.shift(); // Храним не более 30 последних свечей
      }
    } else {
      current.high = Math.max(current.high, price);
      current.low = Math.min(current.low, price);
      current.close = price;
      current.volume += volumeAdded;
    }
  }

  private generateInitialCandles(now: number, basePrice: number): MarketCandle[] {
    const count = 15;
    const candles: MarketCandle[] = [];
    let p = basePrice * 0.92;
    const interval = 60_000;

    for (let i = count - 1; i >= 0; i--) {
      const time = now - i * interval;
      const delta = (Math.random() - 0.48) * 0.015;
      const open = p;
      const close = Math.max(0.1, open + delta);
      const high = Math.max(open, close) + Math.random() * 0.008;
      const low = Math.min(open, close) - Math.random() * 0.008;
      const volume = 200 + Math.random() * 800;

      candles.push({
        time,
        open,
        high,
        low,
        close,
        volume,
      });
      p = close;
    }
    return candles;
  }
}
