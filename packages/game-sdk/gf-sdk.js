// Game Factory SDK — мост между игрой и хабом.
//
// Классический скрипт без import/export: подключается обычным <script src="gf-sdk.js">
// и поэтому работает и через file:// (там модульные скрипты блокируются).
// Типы — в index.d.ts, проверка — tsc с checkJs (packages/game-sdk/tsconfig.json).
//
// Два режима:
//   hub        — игра в iframe хаба: сохранения и очки уходят в хаб через postMessage;
//   standalone — игра открыта сама по себе (офлайн-архив, прямой заход): всё в localStorage.
// Игра пишет один и тот же код, режим SDK выбирает сам.

(function (global) {
  'use strict';

  var VERSION = '0.1.0';
  var PROTOCOL = 1;
  var HELLO_TIMEOUT_MS = 1500;
  var REQUEST_TIMEOUT_MS = 5000;
  var MAX_VALUE_BYTES = 64 * 1024;
  var KEY_RE = /^[a-zA-Z0-9_.-]{1,64}$/;

  /** @param {string} key */
  function checkKey(key) {
    if (typeof key !== 'string' || !KEY_RE.test(key)) {
      throw new Error('gf: ключ сохранения — 1-64 символа a-z, A-Z, 0-9, _ . -');
    }
  }

  /** @param {unknown} value @returns {string} */
  function serialize(value) {
    var json = JSON.stringify(value);
    if (json === undefined) throw new Error('gf: значение не сериализуется в JSON');
    if (json.length > MAX_VALUE_BYTES) throw new Error('gf: значение больше ' + MAX_VALUE_BYTES + ' байт');
    return json;
  }

  /** @param {number} score */
  function checkScore(score) {
    if (typeof score !== 'number' || !isFinite(score)) throw new Error('gf: очки — конечное число');
  }

  /** @param {GF.Mode} mode */
  function markReady(mode) {
    try {
      document.documentElement.setAttribute('data-gf-ready', mode);
      document.dispatchEvent(new CustomEvent('gf:ready', { detail: { mode: mode } }));
    } catch (e) {
      /* не DOM-окружение — метка не нужна */
    }
  }

  /** Хранилище, которое не падает: file:// в некоторых браузерах и приватный режим бросают на localStorage. */
  function safeStorage() {
    /** @type {Record<string, string>} */
    var memory = {};
    /** @type {Storage | null} */
    var ls = null;
    try {
      var candidate = global.localStorage;
      var probe = '__gf_probe__';
      candidate.setItem(probe, '1');
      candidate.removeItem(probe);
      ls = candidate;
    } catch (e) {
      ls = null;
    }
    return {
      persistent: ls !== null,
      /** @param {string} k @returns {string | null} */
      get: function (k) {
        if (ls) return ls.getItem(k);
        var v = memory[k];
        return v === undefined ? null : v;
      },
      /** @param {string} k @param {string} v */
      set: function (k, v) {
        if (ls) ls.setItem(k, v);
        else memory[k] = v;
      },
    };
  }

  /** @param {string} gameId @returns {GF.Session} */
  function createStandalone(gameId) {
    var store = safeStorage();
    var prefix = 'gf:' + gameId + ':';
    return {
      mode: 'standalone',
      gameId: gameId,
      player: null,
      persistent: store.persistent,
      save: function (key, value) {
        checkKey(key);
        store.set(prefix + 'save:' + key, serialize(value));
        return Promise.resolve();
      },
      load: function (key) {
        checkKey(key);
        var raw = store.get(prefix + 'save:' + key);
        return Promise.resolve(raw === null ? null : JSON.parse(raw));
      },
      submitScore: function (score) {
        checkScore(score);
        var raw = store.get(prefix + 'best');
        var best = raw === null ? null : Number(raw);
        var isBest = best === null || score > best;
        if (isBest) store.set(prefix + 'best', String(score));
        return Promise.resolve({ best: isBest ? score : /** @type {number} */ (best), isBest: isBest });
      },
      bestScore: function () {
        var raw = store.get(prefix + 'best');
        return Promise.resolve(raw === null ? null : Number(raw));
      },
      ready: function () {
        markReady('standalone');
      },
    };
  }

  /**
   * @param {string} gameId
   * @param {Window} parent
   * @param {string} hubOrigin
   * @param {GF.Player | null} player
   * @returns {GF.Session}
   */
  function createHubSession(gameId, parent, hubOrigin, player) {
    var nextId = 1;
    /** @type {Record<number, {resolve: (v: any) => void, reject: (e: Error) => void, timer: ReturnType<typeof setTimeout>}>} */
    var pending = {};

    global.addEventListener('message', /** @param {MessageEvent} event */ function (event) {
      // Отвечать может только тот хаб, который поздоровался: и окно, и origin.
      if (event.source !== parent || event.origin !== hubOrigin) return;
      var d = event.data;
      if (!d || d.gf !== PROTOCOL || d.type !== 'response' || typeof d.id !== 'number') return;
      var p = pending[d.id];
      if (!p) return;
      delete pending[d.id];
      clearTimeout(p.timer);
      if (d.ok) p.resolve(d.result);
      else p.reject(new Error('gf: хаб отказал: ' + String(d.error)));
    });

    /** @param {string} method @param {unknown} params */
    function request(method, params) {
      return new Promise(function (resolve, reject) {
        var id = nextId++;
        var timer = setTimeout(function () {
          delete pending[id];
          reject(new Error('gf: хаб не ответил на ' + method));
        }, REQUEST_TIMEOUT_MS);
        pending[id] = { resolve: resolve, reject: reject, timer: timer };
        // targetOrigin — точный origin хаба, а не "*": чужой родитель ответа не прочтёт.
        parent.postMessage({ gf: PROTOCOL, type: 'request', id: id, method: method, params: params }, hubOrigin);
      });
    }

    return {
      mode: 'hub',
      gameId: gameId,
      player: player,
      persistent: true,
      save: function (key, value) {
        checkKey(key);
        return request('save', { key: key, value: serialize(value) }).then(function () {});
      },
      load: function (key) {
        checkKey(key);
        return request('load', { key: key }).then(function (raw) {
          return raw === null || raw === undefined ? null : JSON.parse(String(raw));
        });
      },
      submitScore: function (score) {
        checkScore(score);
        return request('submitScore', { score: score });
      },
      bestScore: function () {
        return request('bestScore', null).then(function (v) {
          return typeof v === 'number' ? v : null;
        });
      },
      ready: function () {
        parent.postMessage({ gf: PROTOCOL, type: 'ready' }, hubOrigin);
        markReady('hub');
      },
    };
  }

  /** @param {{ gameId: string }} options @returns {Promise<GF.Session>} */
  function init(options) {
    var gameId = options && options.gameId;
    if (typeof gameId !== 'string' || !/^[a-z0-9-]{1,40}$/.test(gameId)) {
      return Promise.reject(new Error('gf: init({ gameId }) — id игры из game.json'));
    }

    var parent = null;
    try {
      if (global.parent && global.parent !== global) parent = global.parent;
    } catch (e) {
      parent = null;
    }
    if (!parent) return Promise.resolve(createStandalone(gameId));

    var hubParent = /** @type {Window} */ (parent);
    return new Promise(function (resolve) {
      var done = false;
      /** @param {MessageEvent} event */
      function onWelcome(event) {
        if (event.source !== hubParent) return;
        var d = event.data;
        if (!d || d.gf !== PROTOCOL || d.type !== 'welcome' || d.gameId !== gameId) return;
        if (typeof event.origin !== 'string' || event.origin === 'null') return;
        done = true;
        global.removeEventListener('message', onWelcome);
        var player = d.player && typeof d.player.id === 'string' ? { id: d.player.id, name: String(d.player.name) } : null;
        resolve(createHubSession(gameId, hubParent, event.origin, player));
      }
      global.addEventListener('message', onWelcome);
      // В hello нет ничего секретного, поэтому "*": origin хаба игра узнаёт из ответа.
      // Встроить игру куда попало не выйдет: это запрещает CSP frame-ancestors сервера игр.
      hubParent.postMessage({ gf: PROTOCOL, type: 'hello', gameId: gameId, sdk: VERSION }, '*');
      setTimeout(function () {
        if (done) return;
        global.removeEventListener('message', onWelcome);
        resolve(createStandalone(gameId));
      }, HELLO_TIMEOUT_MS);
    });
  }

  global.GameFactory = Object.freeze({ init: init, version: VERSION, protocol: PROTOCOL });
})(typeof window !== 'undefined' ? window : /** @type {any} */ (globalThis));
