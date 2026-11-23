var cvs = document.querySelector('#mycanvas');
var ctx = cvs.getContext('2d');

var GAME_WIDTH = 320;
var GAME_HEIGHT = 480;
var renderScale = Math.min(Math.max(window.devicePixelRatio || 1, 2), 4);

var degree = Math.PI / 180;
var animClock = 0;

function resizeCanvas() {
  var wrapper = document.getElementById('game-wrapper');
  if (!wrapper) return;
  renderScale = Math.min(Math.max(window.devicePixelRatio || 1, 2), 4);
  cvs.width = GAME_WIDTH * renderScale;
  cvs.height = GAME_HEIGHT * renderScale;
  ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);
  var w = wrapper.clientWidth;
  var h = wrapper.clientHeight;
  var s = Math.min(w / GAME_WIDTH, h / GAME_HEIGHT);
  cvs.style.width = (GAME_WIDTH * s) + 'px';
  cvs.style.height = (GAME_HEIGHT * s) + 'px';
  cvs.style.position = 'absolute';
  cvs.style.top = '0';
  cvs.style.left = '0';
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

var sprite = new Image();
sprite.src = "./images/sprite.png";

var faceImg = new Image();
faceImg.src = "./images/face.png";

// ============================================================================
// Sound Manager (non-overlapping voice/SFX playback + reliable mobile unlock)
// ============================================================================
var Sound = (function () {
  var AudioCtx = window.AudioContext || window.webkitAudioContext;
  var audioCtx = null;
  var buffers = {};
  var activeSources = {};
  var fallbacks = {};
  var muted = localStorage.getItem('fb_muted') === '1';

  var files = {
    score: 'audios/score.wav',
    flap: 'audios/flap.wav',
    hit: 'audios/hit.wav',
    die: 'audios/die.wav',
    start: 'audios/start.wav'
  };

  Object.keys(files).forEach(function (name) {
    var a = new Audio();
    a.src = files[name];
    a.preload = 'auto';
    fallbacks[name] = a;
  });

  function ensureContext() {
    if (!AudioCtx) return null;
    if (!audioCtx) {
      try {
        audioCtx = new AudioCtx();
        loadBuffers();
      } catch (e) {
        audioCtx = null;
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(function () {});
    }
    return audioCtx;
  }

  function loadBuffers() {
    if (!audioCtx || typeof fetch !== 'function') return;
    Object.keys(files).forEach(function (name) {
      fetch(files[name])
        .then(function (res) { return res.ok ? res.arrayBuffer() : null; })
        .then(function (arr) {
          if (!arr || !audioCtx) return;
          audioCtx.decodeAudioData(arr, function (decoded) {
            buffers[name] = decoded;
          }, function () {});
        })
        .catch(function () {});
    });
  }

  function isPlaying(name) {
    if (activeSources[name]) return true;
    var el = fallbacks[name];
    return !!(el && !el.paused && !el.ended);
  }

  function stop(name) {
    if (activeSources[name]) {
      try { activeSources[name].stop(0); } catch (e) {}
      activeSources[name] = null;
    }
    var el = fallbacks[name];
    if (el && !el.paused) {
      try {
        el.pause();
        el.currentTime = 0;
      } catch (e) {}
    }
  }

  function stopAll() {
    Object.keys(files).forEach(stop);
  }

  function play(name, options) {
    if (muted) return;
    var opts = options || {};
    var rate = opts.rate || 1;
    var interrupt = opts.interrupt !== false;

    if (!interrupt && isPlaying(name)) return;
    if (interrupt) stop(name);

    var ctxAudio = ensureContext();
    // Only use Web Audio when context is actively running so sounds never queue up while suspended
    if (ctxAudio && ctxAudio.state === 'running' && buffers[name]) {
      try {
        var src = ctxAudio.createBufferSource();
        src.buffer = buffers[name];
        if (rate !== 1) src.playbackRate.value = rate;
        src.connect(ctxAudio.destination);
        activeSources[name] = src;
        src.onended = function () {
          if (activeSources[name] === src) activeSources[name] = null;
        };
        src.start(0);
        return;
      } catch (e) {
        activeSources[name] = null;
      }
    }

    var el = fallbacks[name];
    if (el) {
      try {
        el.currentTime = 0;
        var p = el.play();
        if (p && typeof p.catch === 'function') p.catch(function () {});
      } catch (e) {}
    }
  }

  function playTone(freqStart, freqEnd, duration, type, volume) {
    if (muted) return;
    var ctxAudio = ensureContext();
    if (!ctxAudio || ctxAudio.state !== 'running') return;
    try {
      var now = ctxAudio.currentTime;
      var osc = ctxAudio.createOscillator();
      var gain = ctxAudio.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freqStart, now);
      osc.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 40), now + duration);
      gain.gain.setValueAtTime(volume || 0.14, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
      osc.connect(gain);
      gain.connect(ctxAudio.destination);
      osc.start(now);
      osc.stop(now + duration);
    } catch (e) {}
  }

  function setMuted(val) {
    muted = !!val;
    if (muted) stopAll();
    localStorage.setItem('fb_muted', muted ? '1' : '0');
  }

  return {
    unlock: ensureContext,
    play: play,
    stop: stop,
    stopAll: stopAll,
    playTone: playTone,
    isMuted: function () { return muted; },
    setMuted: setMuted
  };
})();

// ============================================================================
// Game State, Mode & Config
// ============================================================================
var state = {
  current: 0,
  getReady: 0,
  game: 1,
  over: 2
};

var gameMode = localStorage.getItem('fb_mode') === 'chaos' ? 'chaos' : 'classic';
var gameOverAt = 0;
var GAME_OVER_COOLDOWN_MS = 550;

var gameConfig = {
  gravity: 0.12,
  jump: 4.4,
  pipeDx: 1.5,
  gap: 145,
  pipeTopMin: -235,
  pipeTopMax: -145,
  spawnInterval: 120
};

// Juice / FX state
var fx = {
  flashAlpha: 0,
  shakeTime: 0,
  shakeMag: 0,
  scorePop: 0,
  slowMoTimer: 0,
  slowMoDuration: 240,
  particles: [],
  popups: []
};

var perfectStreak = 0;
var gameOverQuip = '';

var QUIPS_LOW = [
  'Gravity: 1, You: 0',
  'Emotional damage',
  'Bro blinked',
  'Warmup run right?',
  'Skill issue?'
];
var QUIPS_MID = [
  'Not bad, chief',
  'Getting warmer!',
  'Respectable flight',
  'Clean moves!'
];
var QUIPS_HIGH = [
  'Certified Legend',
  'Main character energy',
  'Unstoppable!',
  'Built different'
];
var PERFECT_CALLOUTS = ['CLEAN!', 'SHEESH!', 'PRO!', 'GODLIKE!'];

function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function spawnParticles(x, y, count, color, speed, size) {
  for (var i = 0; i < count; i++) {
    var angle = Math.random() * Math.PI * 2;
    var mag = (0.4 + Math.random() * 0.9) * (speed || 2);
    fx.particles.push({
      x: x,
      y: y,
      vx: Math.cos(angle) * mag,
      vy: Math.sin(angle) * mag,
      life: 1,
      decay: 0.025 + Math.random() * 0.025,
      color: color || '#fff',
      size: size || (2 + Math.random() * 2.5)
    });
  }
}

function spawnPopup(x, y, text, color) {
  fx.popups.push({
    x: x,
    y: y,
    vy: -0.9,
    text: text,
    color: color || '#fde047',
    life: 1
  });
}

function triggerShake(duration, magnitude) {
  fx.shakeTime = Math.max(fx.shakeTime, duration);
  fx.shakeMag = Math.max(fx.shakeMag, magnitude);
}

function showStatusToast(msg, sub) {
  var statusEl = document.getElementById('game-status');
  if (!statusEl) return;
  var textEl = statusEl.querySelector('.status-text');
  var subEl = statusEl.querySelector('.status-sub');
  if (textEl) textEl.textContent = msg || '';
  if (subEl) subEl.textContent = sub || '';
  statusEl.classList.add('active');
  clearTimeout(showStatusToast._timer);
  showStatusToast._timer = setTimeout(function () {
    statusEl.classList.remove('active');
  }, 3200);
}

// ============================================================================
// Medals
// ============================================================================
var medals = {
  bronze: { label: 'Bronze', color: '#cd7f32', sprite: null },
  silver: { label: 'Silver', color: '#c0c0c0', sprite: { sX: 295, sY: 100, w: 42, h: 42 } },
  gold: { label: 'Gold', color: '#d4af37', sprite: { sX: 340, sY: 140, w: 42, h: 42 } },
  platinum: { label: 'Platinum', color: '#e5e4e2', sprite: null }
};

function getBadgeScoreThreshold(val) {
  if (val >= 50) return medals.platinum;
  if (val >= 30) return medals.gold;
  if (val >= 15) return medals.silver;
  if (val >= 5) return medals.bronze;
  return null;
}

function drawBadge(ctx, medal, cx, cy, size) {
  if (!medal) return;
  if (medal.sprite) {
    ctx.drawImage(sprite, medal.sprite.sX, medal.sprite.sY, medal.sprite.w, medal.sprite.h, cx - size / 2, cy - size / 2, size, size);
  } else {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
    ctx.fillStyle = medal.color;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, size / 2 - 6, 0, Math.PI * 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(medal.label[0], cx, cy);
    ctx.restore();
  }
}

// ============================================================================
// Mode, Share & Mute UI Wiring
// ============================================================================
var modeBtn = document.getElementById('mode-toggle');
var muteBtn = document.getElementById('mute-toggle');
var shareBtn = document.getElementById('share-btn');
var controlsHint = document.getElementById('controls-hint');

function syncHUD() {
  if (modeBtn) {
    modeBtn.textContent = gameMode === 'chaos' ? 'Chaos+' : 'Classic';
    modeBtn.classList.toggle('chaos', gameMode === 'chaos');
  }
  if (muteBtn) {
    muteBtn.textContent = Sound.isMuted() ? '🔇' : '🔊';
  }
  if (shareBtn) {
    shareBtn.classList.toggle('visible', state.current === state.over);
  }
  if (controlsHint) {
    if (state.current === state.getReady) {
      controlsHint.textContent = gameMode === 'chaos'
        ? 'Chaos+: Moving pipes & power-ups! Tap to start'
        : 'Tap anywhere or press Space to flap';
    } else if (state.current === state.over) {
      controlsHint.textContent = 'Tap anywhere to play again';
    } else {
      controlsHint.textContent = '';
    }
  }
}

function resetRun() {
  bird.y = 150;
  bird.speed = 0;
  bird.rotation = 0;
  bird.scaleX = 1;
  bird.scaleY = 1;
  bird.hasShield = false;
  bird.invulnTimer = 0;
  pipes.position = [];
  pipes.spawnTimer = 0;
  pipes.spawnCount = 0;
  powerups.items = [];
  fx.slowMoTimer = 0;
  fx.particles = [];
  fx.popups = [];
  fx.scorePop = 0;
  perfectStreak = 0;
  gameOverQuip = '';
  score.value = 0;
  score.isNewBest = false;
  score.pbAnnounced = false;
  score.finishedRunCalled = false;
  score.best = score.readBest();
  state.current = state.getReady;
  syncHUD();
}

if (modeBtn) {
  modeBtn.addEventListener('click', function () {
    Sound.unlock();
    gameMode = gameMode === 'classic' ? 'chaos' : 'classic';
    localStorage.setItem('fb_mode', gameMode);
    Sound.playTone(gameMode === 'chaos' ? 520 : 380, gameMode === 'chaos' ? 780 : 300, 0.12, 'triangle', 0.12);
    resetRun();
  });
}

if (muteBtn) {
  muteBtn.addEventListener('click', function () {
    Sound.setMuted(!Sound.isMuted());
    if (!Sound.isMuted()) Sound.unlock();
    syncHUD();
  });
}

if (shareBtn) {
  shareBtn.addEventListener('click', function () {
    var modeLabel = gameMode === 'chaos' ? 'Chaos+' : 'Classic';
    var text = 'I scored ' + score.value + ' in Kathikalle Umma Flappy (' + modeLabel + ' mode)! Best: ' + score.best + '. Beat my score!';
    if (navigator.share) {
      navigator.share({ title: document.title, text: text, url: window.location.href }).catch(function () {});
    } else if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text + ' ' + window.location.href)
        .then(function () { showStatusToast('Score copied!', 'Paste it to challenge your friends'); })
        .catch(function () { showStatusToast('Share unavailable', text); });
    } else {
      showStatusToast('Your score: ' + score.value, modeLabel + ' Best: ' + score.best);
    }
  });
}

// ============================================================================
// Input Handling
// ============================================================================
function clickHandler() {
  Sound.unlock();
  switch (state.current) {
    case state.getReady:
      Sound.stopAll();
      Sound.play('start');
      state.current = state.game;
      bird.flap(true);
      syncHUD();
      break;
    case state.game:
      bird.flap(false);
      break;
    default:
      if (performance.now() - gameOverAt < GAME_OVER_COOLDOWN_MS) return;
      Sound.stopAll();
      resetRun();
      break;
  }
}

document.addEventListener('keydown', function (e) {
  if (e.repeat) return;
  if (document.getElementById('lb-overlay')?.classList.contains('active')) return;
  if (e.target && e.target.matches('input, textarea, select, button, [contenteditable="true"]')) return;
  if (e.which === 32 || e.key === ' ' || e.code === 'Space') {
    e.preventDefault();
    clickHandler();
  }
});

document.getElementById('game-wrapper').addEventListener('pointerdown', function (e) {
  if (e.target.closest('#lb-overlay, button, input, select, textarea')) return;
  e.preventDefault();
  clickHandler();
});

// ============================================================================
// World Layers (Parallax BG, FG, Screens)
// ============================================================================
var bg = {
  sX: 0,
  sY: 0,
  w: 275,
  h: 226,
  x: 0,
  y: GAME_HEIGHT - 226,
  draw: function () {
    ctx.drawImage(sprite, this.sX, this.sY, this.w, this.h, this.x, this.y, this.w, this.h);
    ctx.drawImage(sprite, this.sX, this.sY, this.w, this.h, this.x + this.w, this.y, this.w, this.h);
    ctx.drawImage(sprite, this.sX, this.sY, this.w, this.h, this.x + this.w * 2, this.y, this.w, this.h);
  },
  update: function (step, worldSpeed) {
    if (state.current === state.game) {
      this.x -= worldSpeed * 0.25 * step;
      if (this.x <= -this.w) this.x += this.w;
    }
  }
};

var fg = {
  sX: 276,
  sY: 0,
  w: 224,
  h: 112,
  x: 0,
  y: GAME_HEIGHT - 112,
  draw: function () {
    ctx.drawImage(sprite, this.sX, this.sY, this.w, this.h, this.x, this.y, this.w, this.h);
    ctx.drawImage(sprite, this.sX, this.sY, this.w, this.h, this.x + this.w, this.y, this.w, this.h);
  },
  update: function (step, worldSpeed) {
    if (state.current === state.game) {
      this.x = (this.x - worldSpeed * step) % (this.w / 2);
    }
  }
};

var getReady = {
  sX: 0,
  sY: 228,
  w: 173,
  h: 152,
  x: GAME_WIDTH / 2 - 173 / 2,
  y: 80,
  draw: function () {
    if (state.current === state.getReady) {
      ctx.drawImage(sprite, this.sX, this.sY, this.w, this.h, this.x, this.y, this.w, this.h);
    }
  }
};

var gameOver = {
  sX: 175,
  sY: 228,
  w: 225,
  h: 202,
  x: GAME_WIDTH / 2 - 225 / 2,
  y: 90,
  draw: function () {
    if (state.current === state.over) {
      ctx.drawImage(sprite, this.sX, this.sY, this.w, this.h, this.x, this.y, this.w, this.h);
    }
  }
};

// ============================================================================
// Run Completion & Personal-Best-Only Leaderboard Submission
// ============================================================================
function triggerGameOver(hitPipe) {
  if (state.current === state.over) return;
  state.current = state.over;
  gameOverAt = performance.now();
  fx.flashAlpha = 0.75;
  triggerShake(14, 5);
  spawnParticles(bird.x, bird.y, 12, '#fde047', 2.6, 3);
  Sound.stopAll();
  Sound.play(hitPipe ? 'hit' : 'die');
  finishRun(score.value);
  syncHUD();
}

function finishRun(finalScore) {
  if (score.finishedRunCalled) return;
  score.finishedRunCalled = true;

  var previousBest = score.readBest();
  var isNewPB = finalScore > previousBest && finalScore > 0;
  score.isNewBest = isNewPB;
  if (isNewPB) {
    score.best = finalScore;
    score.writeBest(finalScore);
    Sound.playTone(523, 1046, 0.28, 'triangle', 0.14);
  } else {
    score.best = previousBest;
  }

  if (isNewPB) {
    gameOverQuip = 'NEW PERSONAL BEST!';
  } else if (finalScore < 5) {
    gameOverQuip = pickRandom(QUIPS_LOW);
  } else if (finalScore < 15) {
    gameOverQuip = pickRandom(QUIPS_MID);
  } else {
    gameOverQuip = pickRandom(QUIPS_HIGH);
  }

  // Global leaderboard only tracks Classic personal bests (> 0)
  if (gameMode !== 'classic') {
    if (isNewPB) showStatusToast('New Chaos+ Best: ' + finalScore + '!', 'Chaos+ scores are saved locally');
    return;
  }
  if (!isNewPB) {
    return;
  }

  var runId = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (char) {
      var value = Math.random() * 16 | 0;
      return (char === 'x' ? value : (value & 3 | 8)).toString(16);
    });
  localStorage.setItem("lb_last_run_id", runId);

  if (window.Leaderboard && typeof window.Leaderboard.submitRun === 'function') {
    window.Leaderboard.submitRun(finalScore, runId).then(function (res) {
      var msg = 'New PB submitted!';
      var sub = '';
      if (res && res.duplicate) {
        msg = 'PB saved (duplicate prevented)';
      } else if (res && res.success) {
        msg = 'New Personal Best submitted!';
      } else if (res && res.offline) {
        msg = 'Offline - PB saved for retry';
        sub = 'Will sync when back online';
      } else if (res && res.error) {
        msg = 'PB submission failed';
        sub = res.error;
      } else {
        msg = 'Not submitted';
      }
      showStatusToast(msg, sub);
    }).catch(function (e) {
      console.warn('Submission error:', e);
    });
  }
}

// ============================================================================
// Bird (Intact face.png + Meme Accessories & Expressions)
// ============================================================================
function drawDealWithItShades(drawW, drawH) {
  var eyeY = -drawH * 0.09;
  var shadeW = drawW * 0.78;
  var shadeH = drawH * 0.14;
  var lensW = shadeW * 0.42;
  var bridgeW = shadeW - lensW * 2;
  var leftX = -shadeW / 2;

  ctx.fillStyle = '#0f172a';
  // Top bar
  ctx.fillRect(leftX, eyeY - shadeH * 0.45, shadeW, shadeH * 0.35);
  // Left & right lenses
  ctx.fillRect(leftX, eyeY - shadeH * 0.15, lensW, shadeH * 0.85);
  ctx.fillRect(leftX + lensW + bridgeW, eyeY - shadeH * 0.15, lensW, shadeH * 0.85);
  // White pixel glints
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillRect(leftX + 1.5, eyeY, 2.2, 2);
  ctx.fillRect(leftX + 4, eyeY + 2, 1.8, 1.8);
  ctx.fillRect(leftX + lensW + bridgeW + 1.5, eyeY, 2.2, 2);
  ctx.fillRect(leftX + lensW + bridgeW + 4, eyeY + 2, 1.8, 1.8);
}

function drawCrown(drawW, drawH) {
  var baseY = -drawH / 2 + 1;
  var cw = drawW * 0.62;
  var ch = 8;
  ctx.save();
  ctx.fillStyle = '#facc15';
  ctx.strokeStyle = '#92400e';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-cw / 2, baseY);
  ctx.lineTo(-cw / 2 - 1, baseY - ch);
  ctx.lineTo(-cw / 6, baseY - ch * 0.45);
  ctx.lineTo(0, baseY - ch - 2);
  ctx.lineTo(cw / 6, baseY - ch * 0.45);
  ctx.lineTo(cw / 2 + 1, baseY - ch);
  ctx.lineTo(cw / 2, baseY);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawDizzyOverlay(drawW, drawH) {
  // Anime sweat drop on side of forehead
  ctx.save();
  ctx.fillStyle = '#38bdf8';
  ctx.strokeStyle = '#0284c7';
  ctx.lineWidth = 0.8;
  var sx = drawW * 0.38;
  var sy = -drawH * 0.25;
  ctx.beginPath();
  ctx.moveTo(sx, sy - 4);
  ctx.quadraticCurveTo(sx + 3.2, sy + 1, sx, sy + 3);
  ctx.quadraticCurveTo(sx - 3.2, sy + 1, sx, sy - 4);
  ctx.fill();
  ctx.stroke();

  // Orbiting KO stars above head
  for (var i = 0; i < 3; i++) {
    var a = animClock * 0.12 + (i * Math.PI * 2 / 3);
    var ox = Math.cos(a) * 11;
    var oy = -drawH / 2 - 5 + Math.sin(a) * 3;
    ctx.fillStyle = '#fde047';
    ctx.beginPath();
    ctx.arc(ox, oy, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

var bird = {
  animation: [
    { sX: 276, sY: 112 },
    { sX: 276, sY: 139 },
    { sX: 276, sY: 164 },
    { sX: 276, sY: 139 }
  ],
  w: 24,
  h: 36,
  x: 50,
  y: 150,
  speed: 0,
  gravity: gameConfig.gravity,
  jump: gameConfig.jump,
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
  hasShield: false,
  invulnTimer: 0,
  animationIndex: 0,
  radius: 12,
  draw: function () {
    ctx.save();
    ctx.translate(this.x, this.y);

    // Invulnerability blink after shield shatter
    if (this.invulnTimer > 0 && Math.floor(this.invulnTimer / 4) % 2 === 0) {
      ctx.globalAlpha = 0.45;
    }

    // Shield bubble aura (Chaos+)
    if (this.hasShield) {
      ctx.save();
      var pulse = 1 + Math.sin(animClock * 0.15) * 0.06;
      ctx.beginPath();
      ctx.arc(0, 0, 22 * pulse, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(56, 189, 248, 0.22)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(125, 211, 252, 0.9)';
      ctx.stroke();
      ctx.restore();
    }

    ctx.rotate(this.rotation);
    ctx.scale(this.scaleX, this.scaleY);

    if (faceImg.complete && faceImg.naturalWidth > 0) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      var drawH = this.h;
      var drawW = drawH * (faceImg.naturalWidth / faceImg.naturalHeight);
      ctx.drawImage(faceImg, -drawW / 2, -drawH / 2, drawW, drawH);

      // Meme overlays (keep face identity completely intact)
      var wearShades = score.value >= 10 || this.hasShield || perfectStreak >= 2;
      var wearCrown = score.value >= 20 || (state.current === state.game && score.pbAnnounced);
      if (wearShades && state.current !== state.over) {
        drawDealWithItShades(drawW, drawH);
      }
      if (wearCrown) {
        drawCrown(drawW, drawH);
      }
      if (state.current === state.over) {
        drawDizzyOverlay(drawW, drawH);
      }
    } else {
      var birdFrame = this.animation[this.animationIndex];
      ctx.drawImage(sprite, birdFrame.sX, birdFrame.sY, 34, 26, -17, -13, 34, 26);
    }
    ctx.restore();
  },
  update: function (step) {
    // Spring squash/stretch back to 1
    var spring = Math.min(1, 0.2 * step);
    this.scaleX += (1 - this.scaleX) * spring;
    this.scaleY += (1 - this.scaleY) * spring;

    if (this.invulnTimer > 0) {
      this.invulnTimer = Math.max(0, this.invulnTimer - step);
    }

    if (state.current === state.getReady) {
      this.y = 150 + Math.sin(animClock * 0.08) * 6;
      this.rotation = 0;
      return;
    }

    if (state.current === state.game) {
      this.speed += this.gravity * step;
      this.y += this.speed * step;

      // Smooth velocity-based tilt
      var targetRot = this.speed < 0
        ? -25 * degree
        : Math.min(90 * degree, (this.speed / 7) * 90 * degree);
      this.rotation += (targetRot - this.rotation) * Math.min(1, 0.18 * step);

      // Subtle sparkle trail when wearing crown / on streak
      if ((score.value >= 20 || perfectStreak >= 2) && Math.random() < 0.25 * step) {
        spawnParticles(this.x - 10, this.y + 4, 1, score.value >= 20 ? '#fde047' : '#f472b6', 0.8, 2);
      }

      if (this.y + this.h / 2 >= GAME_HEIGHT - fg.h) {
        this.y = GAME_HEIGHT - fg.h - (this.h / 2);
        triggerGameOver(false);
      }
      if (this.y - this.radius <= 0) {
        this.y = this.radius;
        triggerGameOver(false);
      }
    } else if (state.current === state.over) {
      // Tumble to the ground on death instead of freezing mid-air
      if (this.y + this.h / 2 < GAME_HEIGHT - fg.h) {
        this.speed += this.gravity * 1.35 * step;
        this.y = Math.min(GAME_HEIGHT - fg.h - (this.h / 2), this.y + this.speed * step);
        this.rotation = Math.min(90 * degree, this.rotation + 6 * degree * step);
      }
    }
  },
  flap: function (silent) {
    this.speed = -this.jump;
    this.scaleX = 1.12;
    this.scaleY = 0.88;
    if (!silent) {
      Sound.play('flap', { interrupt: false });
    }
    spawnParticles(this.x - 10, this.y + 8, 4, 'rgba(255,255,255,0.85)', 1.4, 2.2);
  }
};

// ============================================================================
// Chaos+ Power-ups (Shield & Slow-Mo)
// ============================================================================
var powerups = {
  items: [],
  spawn: function (x, y) {
    var type = Math.random() < 0.55 ? 'shield' : 'slowmo';
    this.items.push({
      x: x,
      y: y,
      baseY: y,
      type: type,
      radius: 13,
      phase: Math.random() * Math.PI * 2
    });
  },
  update: function (step, worldSpeed) {
    if (state.current !== state.game) return;
    for (var i = this.items.length - 1; i >= 0; i--) {
      var item = this.items[i];
      item.x -= worldSpeed * step;
      item.y = item.baseY + Math.sin(animClock * 0.1 + item.phase) * 7;

      var dx = bird.x - item.x;
      var dy = bird.y - item.y;
      if (dx * dx + dy * dy <= (bird.radius + item.radius) * (bird.radius + item.radius)) {
        if (item.type === 'shield') {
          bird.hasShield = true;
          Sound.playTone(440, 880, 0.18, 'sine', 0.14);
          spawnParticles(item.x, item.y, 12, '#38bdf8', 2.4, 2.5);
          spawnPopup(bird.x + 12, bird.y - 24, 'SHIELD ON!', '#38bdf8');
        } else {
          fx.slowMoTimer = fx.slowMoDuration;
          Sound.playTone(680, 260, 0.25, 'triangle', 0.14);
          spawnParticles(item.x, item.y, 12, '#fde047', 2.2, 2.5);
          spawnPopup(bird.x + 12, bird.y - 24, 'SLOW-MO!', '#fde047');
        }
        this.items.splice(i, 1);
        continue;
      }

      if (item.x + item.radius < 0) {
        this.items.splice(i, 1);
      }
    }
  },
  draw: function () {
    for (var i = 0; i < this.items.length; i++) {
      var item = this.items[i];
      ctx.save();
      ctx.translate(item.x, item.y);
      ctx.beginPath();
      ctx.arc(0, 0, item.radius, 0, Math.PI * 2);
      if (item.type === 'shield') {
        ctx.fillStyle = 'rgba(14, 165, 233, 0.88)';
        ctx.strokeStyle = '#e0f2fe';
      } else {
        ctx.fillStyle = 'rgba(245, 158, 11, 0.9)';
        ctx.strokeStyle = '#fef3c7';
      }
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = '#fff';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(item.type === 'shield' ? 'S' : 'T', 0, 1);
      ctx.restore();
    }
  }
};

// ============================================================================
// Pipes (Instant Pass Scoring, Safe Backwards Loop, Chaos+ Moving Pipes)
// ============================================================================
function getCurrentSpeed() {
  var base = gameMode === 'chaos'
    ? Math.min(2.45, 1.6 + score.value * 0.025)
    : gameConfig.pipeDx;
  if (fx.slowMoTimer > 0) base *= 0.55;
  return base;
}

function getCurrentGap() {
  if (gameMode === 'chaos') {
    return Math.max(118, 144 - score.value * 0.65);
  }
  return gameConfig.gap;
}

var pipes = {
  top: { sX: 553, sY: 0 },
  bottom: { sX: 502, sY: 0 },
  w: 53,
  h: 400,
  position: [],
  spawnTimer: 0,
  spawnCount: 0,
  draw: function () {
    for (var i = 0; i < this.position.length; i++) {
      var p = this.position[i];
      var topYpos = p.y;
      var bottomYPos = p.y + this.h + p.gap;
      ctx.drawImage(sprite, this.top.sX, this.top.sY, this.w, this.h, p.x, topYpos, this.w, this.h);
      ctx.drawImage(sprite, this.bottom.sX, this.bottom.sY, this.w, this.h, p.x, bottomYPos, this.w, this.h);
    }
  },
  update: function (step, worldSpeed) {
    if (state.current !== state.game) return;
    this.spawnTimer += step * (fx.slowMoTimer > 0 ? 0.55 : 1);

    var interval = gameMode === 'chaos'
      ? Math.max(88, 118 - score.value * 0.6)
      : gameConfig.spawnInterval;

    if (this.position.length === 0 || this.spawnTimer >= interval) {
      var gap = getCurrentGap();
      var baseY = gameConfig.pipeTopMin + Math.random() * (gameConfig.pipeTopMax - gameConfig.pipeTopMin);
      var moving = gameMode === 'chaos' && score.value >= 3 && Math.random() < 0.55;
      var pipe = {
        x: GAME_WIDTH + 10,
        y: baseY,
        baseY: baseY,
        gap: gap,
        scored: false,
        moveAmp: moving ? (16 + Math.min(20, score.value * 0.6)) : 0,
        moveSpeed: moving ? (0.03 + Math.random() * 0.02) : 0,
        movePhase: Math.random() * Math.PI * 2
      };
      this.position.push(pipe);
      this.spawnTimer = 0;
      this.spawnCount++;

      // Spawn Chaos+ power-up in the gap
      if (gameMode === 'chaos' && this.spawnCount >= 2 && Math.random() < 0.35) {
        var gapCenterY = baseY + this.h + gap / 2;
        powerups.spawn(pipe.x + this.w / 2, gapCenterY);
      }
    }

    for (var i = this.position.length - 1; i >= 0; i--) {
      var p = this.position[i];
      p.x -= worldSpeed * step;

      if (p.moveAmp > 0) {
        p.movePhase += p.moveSpeed * step * (fx.slowMoTimer > 0 ? 0.55 : 1);
        var minY = -280;
        var maxY = GAME_HEIGHT - fg.h - p.gap - this.h - 45;
        p.y = Math.max(minY, Math.min(maxY, p.baseY + Math.sin(p.movePhase) * p.moveAmp));
      }

      var bottomPipesPos = p.y + this.h + p.gap;

      // Instant scoring when bird passes pipe center
      if (!p.scored && p.x + this.w / 2 < bird.x) {
        p.scored = true;
        var gapCenter = p.y + this.h + p.gap / 2;
        var isPerfect = Math.abs(bird.y - gapCenter) <= p.gap * 0.18;
        var points = 1;

        if (isPerfect) {
          perfectStreak++;
          var callout = PERFECT_CALLOUTS[Math.min(perfectStreak - 1, PERFECT_CALLOUTS.length - 1)];
          if (gameMode === 'chaos' && perfectStreak >= 2) {
            points = 2;
            callout = callout + ' +2';
          }
          spawnPopup(bird.x + 14, bird.y - 22, callout, '#fde047');
        } else {
          perfectStreak = 0;
        }

        score.value += points;
        fx.scorePop = 1;
        Sound.play('score', { rate: isPerfect ? Math.min(1.25, 1 + perfectStreak * 0.05) : 1 });

        // Live Personal Best celebration!
        if (!score.pbAnnounced && score.best > 0 && score.value > score.best) {
          score.pbAnnounced = true;
          spawnPopup(GAME_WIDTH / 2, 82, 'NEW PB!', '#4ade80');
          spawnParticles(bird.x, bird.y, 14, '#fde047', 2.4, 2.5);
          Sound.playTone(587, 880, 0.16, 'triangle', 0.12);
        }
      }

      // Collision detection
      var hitTop = bird.x + bird.radius > p.x &&
        bird.x - bird.radius < p.x + this.w &&
        bird.y + bird.radius > p.y &&
        bird.y - bird.radius < p.y + this.h;
      var hitBottom = bird.x + bird.radius > p.x &&
        bird.x - bird.radius < p.x + this.w &&
        bird.y + bird.radius > bottomPipesPos &&
        bird.y - bird.radius < bottomPipesPos + this.h;

      if ((hitTop || hitBottom) && bird.invulnTimer <= 0) {
        if (bird.hasShield) {
          bird.hasShield = false;
          bird.invulnTimer = 65;
          triggerShake(10, 4);
          spawnParticles(bird.x, bird.y, 16, '#38bdf8', 3, 3);
          spawnPopup(bird.x + 10, bird.y - 24, 'NOT TODAY!', '#38bdf8');
          Sound.playTone(720, 180, 0.2, 'sawtooth', 0.14);
        } else {
          triggerGameOver(true);
        }
      }

      if (p.x + this.w < -10) {
        this.position.splice(i, 1);
      }
    }
  }
};

// ============================================================================
// Score & Game Over Card
// ============================================================================
var score = {
  readBest: function () {
    var key = gameMode === 'chaos' ? 'best_chaos' : 'best';
    return parseInt(localStorage.getItem(key), 10) || 0;
  },
  writeBest: function (val) {
    var key = gameMode === 'chaos' ? 'best_chaos' : 'best';
    localStorage.setItem(key, String(val));
  },
  best: 0,
  value: 0,
  isNewBest: false,
  pbAnnounced: false,
  finishedRunCalled: false,
  draw: function () {
    if (state.current === state.game) {
      var popScale = 1 + fx.scorePop * 0.28;
      ctx.save();
      ctx.translate(GAME_WIDTH / 2, 54);
      ctx.scale(popScale, popScale);
      ctx.lineWidth = 3;
      ctx.font = "bold 36px 'Segoe UI', Impact, sans-serif";
      ctx.fillStyle = "white";
      ctx.strokeStyle = "#1e293b";
      ctx.textAlign = "center";
      ctx.strokeText(this.value, 0, 0);
      ctx.fillText(this.value, 0, 0);
      ctx.restore();

      // Slow-Mo countdown bar
      if (fx.slowMoTimer > 0) {
        var ratio = fx.slowMoTimer / fx.slowMoDuration;
        var barW = 90;
        var barX = GAME_WIDTH / 2 - barW / 2;
        ctx.save();
        ctx.fillStyle = 'rgba(15, 23, 42, 0.55)';
        ctx.fillRect(barX, 66, barW, 6);
        ctx.fillStyle = '#fde047';
        ctx.fillRect(barX, 66, barW * ratio, 6);
        ctx.restore();
      }
    } else if (state.current === state.over) {
      gameOver.draw();

      ctx.lineWidth = 2;
      ctx.font = "bold 20px 'Segoe UI', Impact, sans-serif";
      ctx.fillStyle = "#fff";
      ctx.strokeStyle = "#9b7936";
      ctx.textAlign = "center";
      ctx.strokeText(this.value, 215, 185);
      ctx.fillText(this.value, 215, 185);
      ctx.strokeText(this.best, 215, 225);
      ctx.fillText(this.best, 215, 225);

      if (this.isNewBest) {
        ctx.save();
        ctx.fillStyle = '#ef4444';
        ctx.fillRect(160, 208, 32, 14);
        ctx.fillStyle = '#fff';
        ctx.font = "bold 9px 'Segoe UI', sans-serif";
        ctx.textAlign = 'center';
        ctx.fillText('NEW!', 176, 218);
        ctx.restore();
      }

      // Award medal for current run score
      var badge = getBadgeScoreThreshold(this.value);
      if (badge) {
        drawBadge(ctx, badge, 95, 200, 36);
        ctx.font = "bold 11px 'Segoe UI', sans-serif";
        ctx.fillStyle = "#fde047";
        ctx.textAlign = "center";
        ctx.fillText(badge.label, 95, 230);
      }

      // Meme roast / hype caption below card
      if (gameOverQuip) {
        ctx.save();
        ctx.font = "bold 14px 'Segoe UI', sans-serif";
        ctx.textAlign = 'center';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(15, 23, 42, 0.85)';
        ctx.fillStyle = this.isNewBest ? '#4ade80' : '#fff';
        ctx.strokeText(gameOverQuip, GAME_WIDTH / 2, 314);
        ctx.fillText(gameOverQuip, GAME_WIDTH / 2, 314);
        ctx.restore();
      }
    }
  }
};
score.best = score.readBest();
syncHUD();

// ============================================================================
// FX Update & Draw
// ============================================================================
function updateFX(step) {
  if (fx.flashAlpha > 0) fx.flashAlpha = Math.max(0, fx.flashAlpha - 0.06 * step);
  if (fx.shakeTime > 0) fx.shakeTime = Math.max(0, fx.shakeTime - step);
  if (fx.scorePop > 0) fx.scorePop = Math.max(0, fx.scorePop - 0.1 * step);
  if (fx.slowMoTimer > 0 && state.current === state.game) {
    fx.slowMoTimer = Math.max(0, fx.slowMoTimer - step);
  }

  for (var i = fx.particles.length - 1; i >= 0; i--) {
    var pt = fx.particles[i];
    pt.x += pt.vx * step;
    pt.y += pt.vy * step;
    pt.vy += 0.04 * step;
    pt.life -= pt.decay * step;
    if (pt.life <= 0) fx.particles.splice(i, 1);
  }

  for (var j = fx.popups.length - 1; j >= 0; j--) {
    var pop = fx.popups[j];
    pop.y += pop.vy * step;
    pop.life -= 0.022 * step;
    if (pop.life <= 0) fx.popups.splice(j, 1);
  }
}

function drawFX() {
  // Subtle slow-mo tint
  if (fx.slowMoTimer > 0 && state.current === state.game) {
    ctx.save();
    ctx.fillStyle = 'rgba(56, 189, 248, 0.12)';
    ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    ctx.restore();
  }

  // Particles
  for (var i = 0; i < fx.particles.length; i++) {
    var pt = fx.particles[i];
    ctx.save();
    ctx.globalAlpha = Math.max(0, pt.life);
    ctx.fillStyle = pt.color;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Floating meme popups
  for (var j = 0; j < fx.popups.length; j++) {
    var pop = fx.popups[j];
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, pop.life * 1.4));
    ctx.font = "bold 14px 'Segoe UI', Impact, sans-serif";
    ctx.textAlign = 'center';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.fillStyle = pop.color;
    ctx.strokeText(pop.text, pop.x, pop.y);
    ctx.fillText(pop.text, pop.x, pop.y);
    ctx.restore();
  }

  // Impact white flash
  if (fx.flashAlpha > 0) {
    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 255, ' + fx.flashAlpha.toFixed(3) + ')';
    ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    ctx.restore();
  }
}

// ============================================================================
// Main Delta-Time Loop (60Hz baseline, smooth on 60/120/144/240Hz displays)
// ============================================================================
var lastTime = performance.now();

function update(step) {
  var worldSpeed = getCurrentSpeed();
  animClock += step;
  bg.update(step, worldSpeed);
  pipes.update(step, worldSpeed);
  powerups.update(step, worldSpeed);
  fg.update(step, worldSpeed);
  bird.update(step);
  updateFX(step);
}

function draw() {
  ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);
  ctx.imageSmoothingEnabled = false;

  ctx.save();
  if (fx.shakeTime > 0) {
    var mag = fx.shakeMag * (fx.shakeTime / 14);
    ctx.translate((Math.random() - 0.5) * 2 * mag, (Math.random() - 0.5) * 2 * mag);
  }

  ctx.fillStyle = gameMode === 'chaos' ? '#5eaec9' : '#70c5ce';
  ctx.fillRect(-10, -10, GAME_WIDTH + 20, GAME_HEIGHT + 20);
  bg.draw();
  pipes.draw();
  powerups.draw();
  fg.draw();
  bird.draw();
  getReady.draw();
  score.draw();
  drawFX();
  ctx.restore();
}

function animate(now) {
  var dtMs = now - lastTime;
  lastTime = now;
  // Normalize to 60fps baseline, clamped so tab switching never teleports physics
  var step = Math.min(Math.max(dtMs / (1000 / 60), 0.1), 2.5);
  update(step);
  draw();
  requestAnimationFrame(animate);
}

requestAnimationFrame(animate);
