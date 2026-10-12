import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { VirtualAmmMarket, LiveMarketChart } from '../src/meta/market.ts';

describe('Рыночная экономика $GFC и AMM-курс (src/meta/market.ts)', () => {
  it('стартовый курс соответствует Constant Product AMM (0.25 USD)', () => {
    const market = new VirtualAmmMarket();
    const price = market.getSpotPrice();
    assert.equal(price, 0.25, 'Начальный курс равен 50,000 / 200,000 = $0.2500');
  });

  it('маленький обмен ($10 GFC) имеет минимальное проскальзывание (slippage < 0.5%)', () => {
    const market = new VirtualAmmMarket();
    const res = market.simulateSellGfc(10);
    assert.ok(res.usdReceived > 2.4, 'За 10 GFC получено ~2.49 USD');
    assert.ok(res.slippagePercent < 0.5, `Проскальзывание мало (${res.slippagePercent.toFixed(2)}%)`);
    assert.ok(res.feeUsd > 0, 'Комиссия LP удержана');
  });

  it('крупный сброс (50,000 GFC) вызывает честный slippage и снижает курс', () => {
    const market = new VirtualAmmMarket();
    const beforePrice = market.getSpotPrice();
    const res = market.executeSellGfc(50_000);

    assert.ok(res.slippagePercent > 15, `Крупный ордер вызвал ощутимый slippage: ${res.slippagePercent.toFixed(1)}%`);
    assert.ok(res.newPrice < beforePrice, 'Курс упал после крупной продажи');
    assert.equal(market.getSpotPrice(), res.newPrice);
  });

  it('сжигание $GFC в слотах и кейсах уменьшает предложение и пампит курс вверх', () => {
    const market = new VirtualAmmMarket();
    const beforePrice = market.getSpotPrice();
    const newPrice = market.burnGfc(5000);

    assert.ok(newPrice > beforePrice, `Курс вырос после сжигания: ${beforePrice.toFixed(4)} -> ${newPrice.toFixed(4)}`);
  });

  it('рыночный тик формирует свечи и не превышает лимит истории (30 свечей)', () => {
    const market = new VirtualAmmMarket();
    const initialCandles = market.getMarketState().candles.length;
    assert.ok(initialCandles > 0, 'Инициализированы стартовые свечи');

    // Симулируем 100 тиков
    for (let i = 0; i < 100; i++) {
      market.tick(1.0, Date.now() + i * 65_000);
    }

    const candles = market.getMarketState().candles;
    assert.ok(candles.length <= 30, `Количество свечей (${candles.length}) не превышает лимит 30`);
    const last = candles[candles.length - 1]!;
    assert.ok(last.high >= last.low, 'High >= Low');
    assert.ok(last.volume >= 0, 'Volume >= 0');
  });

  it('сглаженная формула Орнштейна-Уленбека меняет курс плавно в пределах волатильности шага', () => {
    const market = new VirtualAmmMarket();
    const initialPrice = market.getSpotPrice();

    // За один тик изменение курса должно быть спокойным и умеренным
    market.tick(1.0);
    const tickPrice = market.getSpotPrice();
    const stepDiffPct = (Math.abs(tickPrice - initialPrice) / initialPrice) * 100;
    assert.ok(stepDiffPct < 3.0, `Шаг тика спокоен (${stepDiffPct.toFixed(3)}% < 3.0%)`);

    // За серию из 30 тиков курс не улетает в бесконечность или ноль, а возвращается к цели 0.28
    for (let i = 0; i < 30; i++) {
      market.tick(1.0);
    }
    const endPrice = market.getSpotPrice();
    assert.ok(endPrice > 0.05 && endPrice < 1.0, `Курс ${endPrice.toFixed(4)} в адекватных границах`);
  });

  it('кадровые вызовы tick(dt) с малым dt аккумулируют время и не дергают цену 60 раз в секунду', () => {
    const market = new VirtualAmmMarket();
    const priceBefore = market.getSpotPrice();

    // 20 кадров по 16 мс (около 320 мс < 1.0 с порога)
    for (let i = 0; i < 20; i++) {
      market.tick(0.016);
    }
    // Цена не изменилась пока не накопился полный шаг симуляции
    assert.equal(market.getSpotPrice(), priceBefore, 'Курс стабилен между секундными шагами');

    // Накопление до 1.0 с (еще 45 кадров по 16 мс)
    for (let i = 0; i < 45; i++) {
      market.tick(0.016);
    }
    // После накопления 1.0 с шаг сработал
    assert.ok(market.getSpotPrice() > 0, 'Шаг симуляции успешно применился после накопления 1 секунды');
  });
});

describe('Живой график цен LiveMarketChart (src/meta/market.ts)', () => {
  it('инициализирует скользящий буфер ровно из 32 точек', () => {
    const chart = new LiveMarketChart(0.25);
    assert.equal(chart.priceHistory.length, 32, 'Буфер содержит 32 точки');
    assert.equal(chart.getCurrentPrice(), 0.25, 'Текущая цена соответствует стартовой');

    // Инициализация с пользовательской историей дополняет массив до 32 элементов
    const customChart = new LiveMarketChart(0.30, [0.28, 0.29, 0.30]);
    assert.equal(customChart.priceHistory.length, 32, 'Пользовательская история дополнена до 32 точек');
    assert.equal(customChart.getCurrentPrice(), 0.30);
  });

  it('метод pushPrice сдвигает массив влево (shift) и добавляет новую точку справа', () => {
    const chart = new LiveMarketChart(0.25);
    const secondPrice = chart.priceHistory[1];

    chart.pushPrice(0.35);

    assert.equal(chart.priceHistory.length, 32, 'Размер буфера сохраняется равным 32');
    assert.equal(chart.priceHistory[0], secondPrice, 'Первая точка сдвинулась влево');
    assert.equal(chart.priceHistory[31], 0.35, 'Новая точка добавлена справа');
    assert.equal(chart.getCurrentPrice(), 0.35);
  });

  it('корректно рассчитывает min, max и range цен в буфере', () => {
    const testPrices = new Array(32).fill(0.25);
    testPrices[5] = 0.20; // минимум
    testPrices[20] = 0.35; // максимум
    const chart = new LiveMarketChart(0.25, testPrices);

    assert.equal(chart.getMinPrice(), 0.20, 'Минимальная цена 0.20');
    assert.equal(chart.getMaxPrice(), 0.35, 'Максимальная цена 0.35');

    const rangeInfo = chart.getPriceRange();
    assert.equal(rangeInfo.min, 0.20);
    assert.equal(rangeInfo.max, 0.35);
    assert.ok(Math.abs(rangeInfo.range - 0.15) < 1e-9, 'Диапазон range = max - min = 0.15');

    // Константный ряд (все точки равны)
    const flatChart = new LiveMarketChart(0.25, new Array(32).fill(0.25));
    assert.equal(flatChart.getPriceRange().range, 0, 'Константный ряд имеет range = 0');
  });

  it('метод renderSvg генерирует полилайн, полигон с градиентом и пульсирующий маркер', () => {
    const chart = new LiveMarketChart(0.25);
    const mockEl = { innerHTML: '' };

    const res = chart.renderSvg(mockEl, 300, 50);

    assert.ok(mockEl.innerHTML.length > 0, 'HTML разметка сгенерирована');
    assert.ok(mockEl.innerHTML.includes('<polyline'), 'Разметка содержит ломаную линию <polyline>');
    assert.ok(mockEl.innerHTML.includes('<polygon'), 'Разметка содержит полупрозрачный полигон <polygon>');
    assert.ok(mockEl.innerHTML.includes('<linearGradient'), 'Разметка содержит <linearGradient>');
    assert.ok(mockEl.innerHTML.includes('gf-chart-ping'), 'Разметка содержит пульсирующий маркер .gf-chart-ping');
    assert.ok(mockEl.innerHTML.includes('gf-chart-core'), 'Разметка содержит ядро маркера .gf-chart-core');

    assert.equal(typeof res.isUp, 'boolean');
    assert.equal(typeof res.changePct, 'number');
    assert.equal(typeof res.currentPrice, 'number');
  });

  it('реакция на памп: зеленый цвет (#4ade80), положительный процент и унос точки влево за 32 шага', () => {
    const chart = new LiveMarketChart(0.25);
    const mockEl = { innerHTML: '' };

    // Памп: скачок с 0.25 до 0.40 (+60%)
    chart.pushPrice(0.40);
    const res = chart.renderSvg(mockEl, 300, 50);

    assert.equal(res.isUp, true, 'isUp равен true при пампе');
    assert.ok(res.changePct > 0, 'changePct положительный');
    assert.ok(mockEl.innerHTML.includes('#4ade80'), 'Цвет графика зеленый (#4ade80)');

    // Проверяем, что точка пампа плавно уносится влево по истории
    for (let step = 0; step < 31; step++) {
      chart.pushPrice(0.30);
      assert.equal(chart.priceHistory[31 - step - 1], 0.40, `Точка пампа сместилась на индекс ${30 - step}`);
    }

    // На 32-м шаге точка пампа выталкивается из буфера истории
    chart.pushPrice(0.30);
    assert.ok(!chart.priceHistory.includes(0.40), 'Точка пампа полностью унесена за пределы 32-точечного буфера');
  });

  it('реакция на дамп: красный цвет (#ef4444) и отрицательный процент', () => {
    // Стартовая цена 0.30, резкий дамп до 0.15
    const history = new Array(31).fill(0.30);
    history.push(0.15);
    const chart = new LiveMarketChart(0.30, history);
    const mockEl = { innerHTML: '' };

    const res = chart.renderSvg(mockEl, 300, 50);

    assert.equal(res.isUp, false, 'isUp равен false при дампе');
    assert.ok(res.changePct < 0, 'changePct отрицательный');
    assert.ok(mockEl.innerHTML.includes('#ef4444'), 'Цвет графика красный (#ef4444)');
  });

  it('интеграция VirtualAmmMarket и LiveMarketChart: памп и дамп моментально обновляют график', () => {
    const market = new VirtualAmmMarket();
    const liveChart = market.getLiveChart();

    assert.equal(liveChart.priceHistory.length, 32, 'График AMM содержит 32 точки');

    // Сжигание монеты в слотах/кейсах пампит рынок и сразу попадает на график
    const priceBeforeBurn = market.getSpotPrice();
    const priceAfterBurn = market.burnGfc(5000);
    assert.ok(priceAfterBurn > priceBeforeBurn);
    assert.equal(liveChart.getCurrentPrice(), priceAfterBurn, 'График моментально отреагировал на памп');

    // Продажа крупного объёма дампит рынок и сразу попадает на график
    const sellRes = market.executeSellGfc(30_000);
    assert.ok(sellRes.newPrice < priceAfterBurn);
    assert.equal(liveChart.getCurrentPrice(), sellRes.newPrice, 'График моментально отреагировал на дамп');
  });
});
