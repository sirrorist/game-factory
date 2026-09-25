// Змейка — эталон статической игры Game Factory.
// Показывает весь контракт с хабом: init → ready → save/load → submitScore.

(function () {
  'use strict';

  var GRID = 20;
  var CELL = 20;
  var TICK_MS = 110;

  var canvas = document.getElementById('board');
  var ctx = canvas.getContext('2d');
  var scoreEl = document.getElementById('score');
  var bestEl = document.getElementById('best');
  var modeEl = document.getElementById('mode');
  var messageEl = document.getElementById('message');
  var startBtn = document.getElementById('start');

  var session = null;
  var snake, dir, nextDir, food, score, timer, paused, alive;

  function randomFood() {
    var free = [];
    for (var x = 0; x < GRID; x++) {
      for (var y = 0; y < GRID; y++) {
        if (!snake.some(function (s) { return s.x === x && s.y === y; })) free.push({ x: x, y: y });
      }
    }
    return free[Math.floor(Math.random() * free.length)];
  }

  function reset() {
    snake = [{ x: 9, y: 10 }, { x: 8, y: 10 }, { x: 7, y: 10 }];
    dir = { x: 1, y: 0 };
    nextDir = dir;
    food = randomFood();
    score = 0;
    paused = false;
    alive = true;
    scoreEl.textContent = '0';
  }

  function draw() {
    ctx.fillStyle = '#1a2129';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#20272f';
    for (var i = 1; i < GRID; i++) {
      ctx.fillRect(i * CELL, 0, 1, canvas.height);
      ctx.fillRect(0, i * CELL, canvas.width, 1);
    }
    ctx.fillStyle = '#f85149';
    ctx.beginPath();
    ctx.arc(food.x * CELL + CELL / 2, food.y * CELL + CELL / 2, CELL / 2 - 2, 0, Math.PI * 2);
    ctx.fill();
    snake.forEach(function (s, idx) {
      ctx.fillStyle = idx === 0 ? '#56d364' : '#3fb950';
      ctx.fillRect(s.x * CELL + 1, s.y * CELL + 1, CELL - 2, CELL - 2);
    });
  }

  function gameOver() {
    alive = false;
    clearInterval(timer);
    timer = null;
    startBtn.hidden = false;
    startBtn.textContent = 'Ещё раз';
    messageEl.textContent = 'Игра окончена. Счёт: ' + score;
    session.submitScore(score).then(function (r) {
      bestEl.textContent = String(r.best);
      if (r.isBest && score > 0) messageEl.textContent = 'Новый рекорд: ' + score + '!';
    }).catch(function (e) {
      messageEl.textContent = 'Очки не сохранились: ' + e.message;
    });
    session.save('last', { score: score, at: Date.now() }).catch(function () {});
  }

  function step() {
    if (paused || !alive) return;
    dir = nextDir;
    var head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
    var hitsWall = head.x < 0 || head.y < 0 || head.x >= GRID || head.y >= GRID;
    // Хвост в этот ход уйдёт, поэтому в него можно въехать.
    var hitsSelf = snake.slice(0, -1).some(function (s) { return s.x === head.x && s.y === head.y; });
    if (hitsWall || hitsSelf) {
      gameOver();
      draw();
      return;
    }
    snake.unshift(head);
    if (head.x === food.x && head.y === food.y) {
      score += 1;
      scoreEl.textContent = String(score);
      if (snake.length === GRID * GRID) return gameOver();
      food = randomFood();
    } else {
      snake.pop();
    }
    draw();
  }

  function start() {
    reset();
    draw();
    startBtn.hidden = true;
    messageEl.textContent = 'Стрелки, WASD или свайп. Пробел — пауза.';
    clearInterval(timer);
    timer = setInterval(step, TICK_MS);
    canvas.focus();
  }

  function turn(x, y) {
    // Разворот на 180° запрещён: сравниваем с текущим направлением, а не с запрошенным.
    if (x === -dir.x && y === -dir.y) return;
    nextDir = { x: x, y: y };
  }

  var KEYS = {
    ArrowUp: [0, -1], KeyW: [0, -1],
    ArrowDown: [0, 1], KeyS: [0, 1],
    ArrowLeft: [-1, 0], KeyA: [-1, 0],
    ArrowRight: [1, 0], KeyD: [1, 0],
  };

  document.addEventListener('keydown', function (e) {
    if (!alive && (e.code === 'Enter' || e.code === 'Space') && session) {
      e.preventDefault();
      return start();
    }
    if (e.code === 'Space' && timer) {
      e.preventDefault();
      paused = !paused;
      messageEl.textContent = paused ? 'Пауза' : '';
      return;
    }
    var d = KEYS[e.code];
    if (d) {
      e.preventDefault();
      turn(d[0], d[1]);
    }
  });

  var touchStart = null;
  canvas.addEventListener('touchstart', function (e) {
    var t = e.changedTouches[0];
    touchStart = { x: t.clientX, y: t.clientY };
  }, { passive: true });
  canvas.addEventListener('touchend', function (e) {
    if (!touchStart) return;
    var t = e.changedTouches[0];
    var dx = t.clientX - touchStart.x;
    var dy = t.clientY - touchStart.y;
    touchStart = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 20) return;
    if (Math.abs(dx) > Math.abs(dy)) turn(dx > 0 ? 1 : -1, 0);
    else turn(0, dy > 0 ? 1 : -1);
  }, { passive: true });

  startBtn.addEventListener('click', start);

  // Старт: SDK сам поймёт, в хабе игра или открыта из архива.
  alive = false;
  reset();
  draw();
  startBtn.disabled = true;
  window.GameFactory.init({ gameId: 'snake' }).then(function (s) {
    session = s;
    modeEl.textContent = s.mode === 'hub' ? 'в хабе' : s.persistent ? 'без хаба' : 'без хаба, без сохранений';
    return s.bestScore();
  }).then(function (best) {
    if (best !== null) bestEl.textContent = String(best);
    alive = false;
    startBtn.disabled = false;
    session.ready();
  }).catch(function (e) {
    messageEl.textContent = 'Не удалось запуститься: ' + e.message;
  });
})();
