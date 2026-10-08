var cvs = document.querySelector('#mycanvas');
var ctx = cvs.getContext('2d');

var degree = Math.PI / 180;
var frames = 0;

function resizeCanvas() {
  var wrapper = document.getElementById('game-wrapper');
  if (!wrapper) return;
  var w = wrapper.clientWidth;
  var h = wrapper.clientHeight;
  var baseW = cvs.width;
  var baseH = cvs.height;
  var s = Math.min(w / baseW, h / baseH);
  cvs.style.width = (baseW * s) + 'px';
  cvs.style.height = (baseH * s) + 'px';
  cvs.style.position = 'absolute';
  cvs.style.top = '0';
  cvs.style.left = '0';
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

var sprite = new Image();
sprite.src = "./images/sprite.png";

var SCORE = new Audio();
SCORE.src = "audios/score.wav";

var FLAP = new Audio();
FLAP.src = "audios/flap.wav";

var HIT = new Audio();
HIT.src = "audios/hit.wav";

var DIE = new Audio();
DIE.src = "audios/die.wav";

var START = new Audio();
START.src = "audios/start.wav";

var state = {
  current: 0,
  getReady: 0,
  game: 1,
  over: 2
};

var gameConfig = {
  gravity: 0.12,
  jump: 4.4,
  pipeDx: 1.5,
  gap: 145,
  pipeTopMin: -220,
  pipeTopMax: -180,
  spawnInterval: 120
};

// Medal definitions from sprite audit
var medals = {
  bronze: { label: 'Bronze', color: '#cd7f32', sprite: null },
  silver: { label: 'Silver', color: '#c0c0c0', sprite: { sX: 295, sY: 100, w: 42, h: 42 } },
  gold: { label: 'Gold', color: '#d4af37', sprite: { sX: 340, sY: 140, w: 42, h: 42 } },
  platinum: { label: 'Platinum', color: '#e5e4e2', sprite: null }
};

function getBadgeScoreThreshold(score) {
  if (score >= 50) return medals.platinum;
  if (score >= 30) return medals.gold;
  if (score >= 15) return medals.silver;
  if (score >= 5) return medals.bronze;
  return null;
}

function drawBadge(ctx, medal, cx, cy, size) {
  if (!medal) return;
  if (medal.sprite) {
    ctx.drawImage(sprite, medal.sprite.sX, medal.sprite.sY, medal.sprite.w, medal.sprite.h, cx - size / 2, cy - size / 2, size, size);
  } else {
    // Draw custom medal badge for bronze/platinum
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
    ctx.fillStyle = medal.color;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    // Inner ring
    ctx.beginPath();
    ctx.arc(cx, cy, size / 2 - 6, 0, Math.PI * 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.stroke();
    // Label
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(medal.label[0], cx, cy);
    ctx.restore();
  }
}

function clickHandler() {
  switch (state.current) {
    case state.getReady:
      START.play();
      state.current = state.game;
      break;
    case state.game:
      FLAP.play();
      bird.flap();
      break;
    default:
      bird.speed = 0;
      bird.rotation = 0;
      pipes.position = [];
      pipes.spawnTimer = 0;
      score.value = 0;
      score.finishedRunCalled = false;
      state.current = state.getReady;
      break;
  }
}

document.addEventListener('keydown', function (e) {
  if (e.which === 32 || e.key === ' ' || e.code === 'Space') {
    e.preventDefault();
    clickHandler();
  }
});

document.getElementById('game-wrapper').addEventListener('pointerdown', function (e) {
  e.preventDefault();
  clickHandler();
});

let bg = {
  sX: 0,
  sY: 0,
  w: 275,
  h: 226,
  x: 0,
  y: cvs.height - 226,
  draw: function () {
    ctx.drawImage(sprite, this.sX, this.sY, this.w, this.h, this.x, this.y, this.w, this.h);
    ctx.drawImage(sprite, this.sX, this.sY, this.w, this.h, this.x + this.w, this.y, this.w, this.h);
  }
};

let fg = {
  sX: 276,
  sY: 0,
  w: 224,
  h: 112,
  x: 0,
  y: cvs.height - 112,
  dx: gameConfig.pipeDx,
  draw: function () {
    ctx.drawImage(sprite, this.sX, this.sY, this.w, this.h, this.x, this.y, this.w, this.h);
    ctx.drawImage(sprite, this.sX, this.sY, this.w, this.h, this.x + this.w, this.y, this.w, this.h);
  },
  update: function () {
    if (state.current === state.game) {
      this.x = (this.x - this.dx) % (this.w / 2);
    }
  }
};

let getReady = {
  sX: 0,
  sY: 228,
  w: 173,
  h: 152,
  x: cvs.width / 2 - 173 / 2,
  y: 80,
  draw: function () {
    if (state.current === state.getReady) {
      ctx.drawImage(sprite, this.sX, this.sY, this.w, this.h, this.x, this.y, this.w, this.h);
    }
  }
};

let gameOver = {
  sX: 175,
  sY: 228,
  w: 225,
  h: 202,
  x: cvs.width / 2 - 225 / 2,
  y: 90,
  draw: function () {
    if (state.current === state.over) {
      ctx.drawImage(sprite, this.sX, this.sY, this.w, this.h, this.x, this.y, this.w, this.h);
    }
  }
};

function finishRun(finalScore) {
  if (score.finishedRunCalled) return;
  score.finishedRunCalled = true;
  score.best = Math.max(finalScore, score.best);
  localStorage.setItem("best", score.best);
  // Generate a run ID for duplicate protection
  const runId = Date.now() + '-' + Math.random().toString(36).slice(2);
  localStorage.setItem("lb_last_run_id", runId);

  if (window.Leaderboard && typeof window.Leaderboard.submitRun === 'function') {
    window.Leaderboard.submitRun(finalScore).then(function (res) {
      var msg = 'Submitted!';
      var sub = '';
      if (res && res.duplicate) {
        msg = 'Score saved (duplicate prevented)';
      } else if (res && res.success) {
        msg = 'Score submitted!';
      } else if (res && res.offline) {
        msg = 'Offline - saved locally';
        sub = 'Will retry when online';
      } else if (res && res.error) {
        msg = 'Submission failed';
        sub = res.error;
      } else {
        msg = 'Not submitted';
      }
      // Update UI through the game-status element
      var statusEl = document.getElementById('game-status');
      if (statusEl) {
        var textEl = statusEl.querySelector('.status-text');
        var subEl = statusEl.querySelector('.status-sub');
        if (textEl) textEl.textContent = msg;
        if (subEl) subEl.textContent = sub || '';
        statusEl.classList.add('active');
        setTimeout(function () { statusEl.classList.remove('active'); }, 3500);
      }
    }).catch(function (e) {
      console.warn('Submission error:', e);
    });
  }
}

let bird = {
  animation: [
    { sX: 276, sY: 112 },
    { sX: 276, sY: 139 },
    { sX: 276, sY: 164 },
    { sX: 276, sY: 139 }
  ],
  w: 34,
  h: 26,
  x: 50,
  y: 150,
  speed: 0,
  gravity: gameConfig.gravity,
  jump: gameConfig.jump,
  rotation: 0,
  animationIndex: 0,
  radius: 12,
  draw: function () {
    let birdFrame = this.animation[this.animationIndex];
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rotation);
    ctx.drawImage(sprite, birdFrame.sX, birdFrame.sY, this.w, this.h, -this.w / 2, -this.h / 2, this.w, this.h);
    ctx.restore();
  },
  update: function () {
    let period = state.current === state.getReady ? 20 : 5;
    this.animationIndex += frames % period === 0 ? 1 : 0;
    this.animationIndex = this.animationIndex % this.animation.length;
    if (state.current === state.getReady) {
      this.y = 150;
    } else {
      this.speed += this.gravity;
      this.y += this.speed;
      if (this.speed < this.jump) {
        this.rotation = -25 * degree;
      } else {
        this.rotation = 90 * degree;
      }
    }
    if (this.y + this.h / 2 >= cvs.height - fg.h) {
      this.y = cvs.height - fg.h - (this.h / 2);
      this.animationIndex = 1;
      if (state.current === state.game) {
        DIE.play();
        state.current = state.over;
        finishRun(score.value);
      }
    }
    if (state.current === state.game && this.y - this.radius <= 0) {
      this.y = this.radius;
      DIE.play();
      state.current = state.over;
      finishRun(score.value);
    }
  },
  flap: function () {
    this.speed = -this.jump;
  }
};

let pipes = {
  top: { sX: 553, sY: 0 },
  bottom: { sX: 502, sY: 0 },
  w: 53,
  h: 400,
  dx: gameConfig.pipeDx,
  gap: gameConfig.gap,
  position: [],
  spawnTimer: 0,
  draw: function () {
    for (let i = 0; i < this.position.length; i++) {
      let p = this.position[i];
      let topYpos = p.y;
      let bottomYPos = p.y + this.h + this.gap;
      ctx.drawImage(sprite, this.top.sX, this.top.sY, this.w, this.h, p.x, topYpos, this.w, this.h);
      ctx.drawImage(sprite, this.bottom.sX, this.bottom.sY, this.w, this.h, p.x, bottomYPos, this.w, this.h);
    }
  },
  update: function () {
    if (state.current !== state.game) return;
    this.spawnTimer++;
    if (this.position.length === 0 || this.spawnTimer >= gameConfig.spawnInterval) {
      this.position.push({
        x: cvs.width,
        y: gameConfig.pipeTopMin + Math.random() * (gameConfig.pipeTopMax - gameConfig.pipeTopMin)
      });
      this.spawnTimer = 0;
    }
    for (let i = 0; i < this.position.length; i++) {
      let p = this.position[i];
      p.x -= this.dx;

      let bottomPipesPos = p.y + this.h + this.gap;

      // Collision detection
      if (
        bird.x + bird.radius > p.x &&
        bird.x - bird.radius < p.x + this.w &&
        bird.y + bird.radius > p.y && bird.y - bird.radius < p.y + this.h
      ) {
        HIT.play();
        state.current = state.over;
        finishRun(score.value);
      }
      if (
        bird.x + bird.radius > p.x &&
        bird.x - bird.radius < p.x + this.w &&
        bird.y + bird.radius > bottomPipesPos && bird.y - bird.radius < bottomPipesPos + this.h
      ) {
        HIT.play();
        state.current = state.over;
        finishRun(score.value);
      }

      if (p.x + this.w <= 0) {
        this.position.shift();
        SCORE.play();
        score.value++;
        score.best = Math.max(score.value, score.best);
        localStorage.setItem("best", score.best);
      }
    }
  }
};

var score = {
  best: parseInt(localStorage.getItem("best")) || 0,
  value: 0,
  finishedRunCalled: false,
  draw: function () {
    if (state.current === state.game) {
      ctx.lineWidth = 2;
      ctx.font = "35px 'Segoe UI', Impact, sans-serif";
      ctx.fillStyle = "white";
      ctx.strokeStyle = "black";
      ctx.textAlign = "center";
      ctx.fillText(this.value, cvs.width / 2, 50);
      ctx.strokeText(this.value, cvs.width / 2, 50);
    } else if (state.current === state.over) {
      // Game Over screen
      gameOver.draw();

      // The panel artwork already contains the SCORE and BEST labels.
      ctx.lineWidth = 2;
      ctx.font = "20px 'Segoe UI', Impact, sans-serif";
      ctx.fillStyle = "#fff";
      ctx.strokeStyle = "#9b7936";
      ctx.textAlign = "center";
      ctx.fillText(this.value, 215, 185);
      ctx.strokeText(this.value, 215, 185);
      ctx.fillText(this.best, 215, 225);
      ctx.strokeText(this.best, 215, 225);

      // Badge / Medal display based on best/score
      let badge = getBadgeScoreThreshold(Math.max(this.value, this.best));
      if (badge) {
        drawBadge(ctx, badge, 95, 200, 36);
        ctx.font = "12px 'Segoe UI', sans-serif";
        ctx.fillStyle = "#ffd700";
        ctx.textAlign = "center";
        ctx.fillText(badge.label, 95, 230);
      }
    }
  }
};

function update() {
  bird.update();
  fg.update();
  pipes.update();
}

function draw() {
  ctx.fillStyle = '#70c5ce';
  ctx.fillRect(0, 0, cvs.width, cvs.height);
  bg.draw();
  pipes.draw();
  fg.draw();
  bird.draw();
  getReady.draw();
  score.draw();
}

function animate() {
  update();
  draw();
  frames++;
  requestAnimationFrame(animate);
}

animate();
