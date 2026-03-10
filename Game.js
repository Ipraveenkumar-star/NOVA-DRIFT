/**
 * NOVA DRIFT — game.js
 * A physics-based gravitational drift shooter
 * Player pilots a ship through gravitational fields, shooting enemies
 * and collecting orbs while managing gravity wells
 */

'use strict';

// ═══════════════════════════════════════════════════════
//  UTILS
// ═══════════════════════════════════════════════════════
const $ = id => document.getElementById(id);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lerp = (a, b, t) => a + (b - a) * t;
const dist2 = (ax, ay, bx, by) => (ax-bx)**2 + (ay-by)**2;
const rand = (lo, hi) => Math.random() * (hi - lo) + lo;
const randInt = (lo, hi) => Math.floor(rand(lo, hi + 1));
const TAU = Math.PI * 2;

// ═══════════════════════════════════════════════════════
//  STORAGE / SETTINGS
// ═══════════════════════════════════════════════════════
const DEFAULT_SETTINGS = { musicVol: 40, sfxVol: 70, difficulty: 'normal', particles: 'high' };
const DEFAULT_SAVE = { bestScore: 0, totalMissions: 0, topLevel: 1, leaderboard: [], achievements: {} };

let settings = { ...DEFAULT_SETTINGS };
let save = { ...DEFAULT_SAVE };

function loadSave() {
  try {
    const s = localStorage.getItem('novadrift_settings');
    if (s) settings = { ...DEFAULT_SETTINGS, ...JSON.parse(s) };
    const d = localStorage.getItem('novadrift_save');
    if (d) save = { ...DEFAULT_SAVE, ...JSON.parse(d) };
  } catch(e) {}
}

function writeSave() {
  try {
    localStorage.setItem('novadrift_settings', JSON.stringify(settings));
    localStorage.setItem('novadrift_save', JSON.stringify(save));
  } catch(e) {}
}

loadSave();

// ═══════════════════════════════════════════════════════
//  AUDIO ENGINE (Web Audio API procedural sounds)
// ═══════════════════════════════════════════════════════
let audioCtx = null;
let musicGain = null;
let sfxGain = null;
let musicOscs = [];

function initAudio() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  musicGain = audioCtx.createGain();
  musicGain.gain.value = settings.musicVol / 100 * 0.3;
  musicGain.connect(audioCtx.destination);
  sfxGain = audioCtx.createGain();
  sfxGain.gain.value = settings.sfxVol / 100 * 0.5;
  sfxGain.connect(audioCtx.destination);
}

function updateAudioVolumes() {
  if (!audioCtx) return;
  if (musicGain) musicGain.gain.setTargetAtTime(settings.musicVol / 100 * 0.3, audioCtx.currentTime, 0.1);
  if (sfxGain) sfxGain.gain.setTargetAtTime(settings.sfxVol / 100 * 0.5, audioCtx.currentTime, 0.1);
}

function playBeep(freq, type, duration, vol = 1, detune = 0) {
  if (!audioCtx || settings.sfxVol === 0) return;
  const osc = audioCtx.createOscillator();
  const env = audioCtx.createGain();
  osc.connect(env); env.connect(sfxGain);
  osc.type = type; osc.frequency.value = freq; osc.detune.value = detune;
  env.gain.setValueAtTime(vol, audioCtx.currentTime);
  env.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
  osc.start(); osc.stop(audioCtx.currentTime + duration);
}

function playShoot() {
  if (!audioCtx) return;
  playBeep(880, 'sawtooth', 0.08, 0.6);
  playBeep(440, 'square', 0.1, 0.2, -1200);
}

function playExplode(big = false) {
  if (!audioCtx) return;
  const n = audioCtx.createOscillator();
  const buf = audioCtx.createBuffer(1, audioCtx.sampleRate * 0.5, audioCtx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  const filt = audioCtx.createBiquadFilter();
  filt.type = 'lowpass'; filt.frequency.value = big ? 800 : 1200;
  const env = audioCtx.createGain();
  src.connect(filt); filt.connect(env); env.connect(sfxGain);
  env.gain.setValueAtTime(big ? 1 : 0.6, audioCtx.currentTime);
  env.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + (big ? 0.6 : 0.3));
  src.start(); src.stop(audioCtx.currentTime + 0.6);
}

function playPickup() {
  if (!audioCtx) return;
  [440, 550, 660, 880].forEach((f, i) => {
    setTimeout(() => playBeep(f, 'sine', 0.15, 0.4), i * 50);
  });
}

function playHit() {
  if (!audioCtx) return;
  playBeep(200, 'sawtooth', 0.2, 0.7);
}

function playLevelUp() {
  if (!audioCtx) return;
  [523, 659, 784, 1047].forEach((f, i) => {
    setTimeout(() => playBeep(f, 'sine', 0.3, 0.5), i * 100);
  });
}

let bgMusicInterval = null;
function startBGMusic() {
  if (!audioCtx || settings.musicVol === 0) return;
  stopBGMusic();
  const notes = [55, 73.4, 82.4, 110, 146.8, 165];
  let step = 0;
  const playNote = () => {
    if (!audioCtx) return;
    const n = notes[step % notes.length];
    const osc = audioCtx.createOscillator();
    const env = audioCtx.createGain();
    osc.connect(env); env.connect(musicGain);
    osc.type = 'sawtooth'; osc.frequency.value = n;
    osc.detune.value = Math.sin(step * 0.5) * 20;
    env.gain.setValueAtTime(0.001, audioCtx.currentTime);
    env.gain.linearRampToValueAtTime(0.3, audioCtx.currentTime + 0.05);
    env.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.45);
    osc.start(); osc.stop(audioCtx.currentTime + 0.45);
    step++;
  };
  bgMusicInterval = setInterval(playNote, 500);
}

function stopBGMusic() {
  if (bgMusicInterval) { clearInterval(bgMusicInterval); bgMusicInterval = null; }
}

// ═══════════════════════════════════════════════════════
//  PARTICLE SYSTEM
// ═══════════════════════════════════════════════════════
class Particle {
  constructor(x, y, vx, vy, life, color, size = 2, grav = 0) {
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.life = this.maxLife = life;
    this.color = color;
    this.size = size;
    this.grav = grav;
    this.dead = false;
  }
  update(dt) {
    this.vy += this.grav * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.life -= dt;
    if (this.life <= 0) this.dead = true;
  }
  draw(ctx) {
    const a = clamp(this.life / this.maxLife, 0, 1);
    ctx.globalAlpha = a;
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size * a + 0.5, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

const particles = [];
const MAX_PARTICLES = { high: 400, medium: 200, low: 80 };

function spawnExplosion(x, y, color1, color2, count = 20, speed = 150) {
  const limit = MAX_PARTICLES[settings.particles] || 200;
  const actual = Math.min(count, limit - particles.length + 10);
  for (let i = 0; i < actual; i++) {
    const angle = rand(0, TAU);
    const spd = rand(30, speed);
    particles.push(new Particle(x, y,
      Math.cos(angle) * spd, Math.sin(angle) * spd,
      rand(0.4, 1.2),
      Math.random() < 0.5 ? color1 : color2,
      rand(1.5, 4)
    ));
  }
}

function spawnTrail(x, y, color) {
  if (particles.length > MAX_PARTICLES[settings.particles] - 20) return;
  particles.push(new Particle(x, y,
    rand(-20, 20), rand(-20, 20),
    rand(0.1, 0.3), color, rand(1, 3)
  ));
}

// ═══════════════════════════════════════════════════════
//  LEVEL DEFINITIONS
// ═══════════════════════════════════════════════════════
const LEVEL_DEFS = [
  { name: 'SOLAR FRINGE',    enemies: 4, gravWells: 1, enemySpeed: 80,  spawnRate: 3.5, asteroids: 3  },
  { name: 'ASTEROID FIELD',  enemies: 6, gravWells: 2, enemySpeed: 100, spawnRate: 3.0, asteroids: 8  },
  { name: 'NEBULA CLUSTER',  enemies: 8, gravWells: 2, enemySpeed: 120, spawnRate: 2.5, asteroids: 6  },
  { name: 'VOID CORE',       enemies: 10,gravWells: 3, enemySpeed: 140, spawnRate: 2.2, asteroids: 10 },
  { name: 'DARK MATTER',     enemies: 12,gravWells: 3, enemySpeed: 160, spawnRate: 2.0, asteroids: 12 },
  { name: 'EVENT HORIZON',   enemies: 15,gravWells: 4, enemySpeed: 180, spawnRate: 1.8, asteroids: 15 },
  { name: 'SINGULARITY',     enemies: 18,gravWells: 4, enemySpeed: 200, spawnRate: 1.5, asteroids: 18 },
  { name: 'OMEGA SECTOR',    enemies: 20,gravWells: 5, enemySpeed: 220, spawnRate: 1.3, asteroids: 20 },
];

function getLevelDef(level) {
  const idx = Math.min(level - 1, LEVEL_DEFS.length - 1);
  const def = LEVEL_DEFS[idx];
  // Scale infinitely after last defined level
  if (level > LEVEL_DEFS.length) {
    const extra = level - LEVEL_DEFS.length;
    return { ...def, enemies: def.enemies + extra * 2, enemySpeed: def.enemySpeed + extra * 10, spawnRate: Math.max(0.8, def.spawnRate - extra * 0.1) };
  }
  return def;
}

// ═══════════════════════════════════════════════════════
//  ACHIEVEMENTS
// ═══════════════════════════════════════════════════════
const ACHIEVEMENTS = [
  { id: 'first_kill',    icon: '💥', name: 'First Contact',    desc: 'Destroy your first enemy',          check: s => s.totalKills >= 1 },
  { id: 'kill_10',       icon: '⚡', name: 'On a Roll',         desc: 'Destroy 10 enemies in one mission', check: s => s.sessionKills >= 10 },
  { id: 'kill_50',       icon: '☄',  name: 'Void Hunter',       desc: 'Destroy 50 enemies total',          check: s => s.totalKillsAll >= 50 },
  { id: 'score_1000',    icon: '🌟', name: 'Point Chaser',      desc: 'Score 1,000 points',                check: s => s.score >= 1000 },
  { id: 'score_5000',    icon: '💫', name: 'Space Ace',         desc: 'Score 5,000 points',                check: s => s.score >= 5000 },
  { id: 'score_10000',   icon: '🔥', name: 'Supernova',         desc: 'Score 10,000 points',               check: s => s.score >= 10000 },
  { id: 'sector_3',      icon: '🛸', name: 'Deep Space',        desc: 'Reach Sector 3',                    check: s => s.level >= 3 },
  { id: 'sector_5',      icon: '🌌', name: 'Event Horizon',     desc: 'Reach Sector 5',                    check: s => s.level >= 5 },
  { id: 'sector_7',      icon: '⭐', name: 'Legend',             desc: 'Reach Sector 7',                    check: s => s.level >= 7 },
  { id: 'combo_5',       icon: '🔗', name: 'Chain Reaction',    desc: 'Get a x5 combo',                    check: s => s.maxCombo >= 5 },
  { id: 'survive_120',   icon: '⏱',  name: 'Long Haul',         desc: 'Survive for 2 minutes',             check: s => s.elapsed >= 120 },
  { id: 'no_damage',     icon: '🛡',  name: 'Ghost Pilot',       desc: 'Complete a sector without damage',  check: s => s.sectorNoDamage },
];

function checkAchievements(state) {
  ACHIEVEMENTS.forEach(a => {
    if (!save.achievements[a.id] && a.check(state)) {
      save.achievements[a.id] = Date.now();
      writeSave();
      showAchievementToast(a);
    }
  });
}

function showAchievementToast(ach) {
  const toast = $('achievement-toast');
  $('at-name').textContent = ach.name;
  toast.classList.remove('hidden');
  playPickup();
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.add('hidden'), 3500);
}

// ═══════════════════════════════════════════════════════
//  GAME STATE
// ═══════════════════════════════════════════════════════
let canvas, ctx;
let W, H;
let gameRunning = false;
let gamePaused = false;
let gameState = {};
let animFrame = null;
let lastTime = 0;

// Input state
const keys = {};
const touch = { left: false, right: false, up: false, down: false, shoot: false, boost: false };

// ── Stars (parallax background) ──
let bgStars = [];
function initStars() {
  bgStars = [];
  const layers = [
    { count: 80, speed: 0.02, size: 0.8, alpha: 0.3 },
    { count: 50, speed: 0.06, size: 1.2, alpha: 0.5 },
    { count: 25, speed: 0.12, size: 2.0, alpha: 0.8 },
  ];
  layers.forEach(l => {
    for (let i = 0; i < l.count; i++) {
      bgStars.push({ x: rand(0, W), y: rand(0, H), size: l.size, alpha: l.alpha, speed: l.speed, twinkle: rand(0, TAU) });
    }
  });
}

// ═══════════════════════════════════════════════════════
//  GAME OBJECTS
// ═══════════════════════════════════════════════════════

// ── Player Ship ──
class Player {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.angle = -Math.PI / 2;
    this.targetAngle = this.angle;
    this.hp = 100; this.maxHp = 100;
    this.shield = 100; this.maxShield = 100;
    this.shieldRegen = 8;
    this.shieldDelay = 0;
    this.thrust = 380;
    this.drag = 0.97;
    this.radius = 14;
    this.shootCooldown = 0;
    this.shootRate = 0.22;
    this.boostEnergy = 100; this.maxBoost = 100;
    this.boosting = false;
    this.iframes = 0;
    this.trail = [];
    this.dead = false;
  }

  update(dt, gravWells) {
    this.iframes = Math.max(0, this.iframes - dt);
    this.shieldDelay = Math.max(0, this.shieldDelay - dt);

    // Input
    const left  = keys['a'] || keys['ArrowLeft']  || touch.left;
    const right = keys['d'] || keys['ArrowRight'] || touch.right;
    const up    = keys['w'] || keys['ArrowUp']    || touch.up;
    const down  = keys['s'] || keys['ArrowDown']  || touch.down;
    const boost = keys['Shift'] || touch.boost;
    const shooting = keys[' '] || keys['z'] || touch.shoot;

    // Rotation
    if (left)  this.angle -= 3.5 * dt;
    if (right) this.angle += 3.5 * dt;

    // Thrust
    this.boosting = boost && this.boostEnergy > 0;
    const thrustMul = this.boosting ? 2.2 : 1;
    if (up) {
      this.vx += Math.cos(this.angle) * this.thrust * thrustMul * dt;
      this.vy += Math.sin(this.angle) * this.thrust * thrustMul * dt;
      spawnTrail(this.x - Math.cos(this.angle)*16, this.y - Math.sin(this.angle)*16,
        this.boosting ? '#ff6b00' : '#00f5ff');
    }
    if (down) {
      this.vx -= Math.cos(this.angle) * this.thrust * 0.5 * dt;
      this.vy -= Math.sin(this.angle) * this.thrust * 0.5 * dt;
    }

    // Boost energy
    if (this.boosting && up) this.boostEnergy = Math.max(0, this.boostEnergy - 40 * dt);
    else this.boostEnergy = Math.min(this.maxBoost, this.boostEnergy + 12 * dt);

    // Gravity wells
    gravWells.forEach(gw => {
      const dx = gw.x - this.x, dy = gw.y - this.y;
      const d2 = dx*dx + dy*dy;
      const d = Math.sqrt(d2);
      if (d < 5) return;
      const force = gw.mass * 8000 / d2;
      this.vx += (dx / d) * force * dt;
      this.vy += (dy / d) * force * dt;
    });

    // Drag
    const drag = this.boosting ? 0.985 : this.drag;
    this.vx *= drag; this.vy *= drag;

    // Clamp speed
    const maxSpd = this.boosting ? 500 : 320;
    const spd = Math.hypot(this.vx, this.vy);
    if (spd > maxSpd) { this.vx = this.vx/spd*maxSpd; this.vy = this.vy/spd*maxSpd; }

    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // Wrap screen
    if (this.x < -20) this.x = W + 20;
    if (this.x > W + 20) this.x = -20;
    if (this.y < -20) this.y = H + 20;
    if (this.y > H + 20) this.y = -20;

    // Shield regen
    if (this.shieldDelay <= 0) {
      this.shield = Math.min(this.maxShield, this.shield + this.shieldRegen * dt);
    }

    // Shooting
    this.shootCooldown = Math.max(0, this.shootCooldown - dt);
    if (shooting && this.shootCooldown <= 0) {
      this.shootCooldown = this.shootRate;
      return 'shoot';
    }
    return null;
  }

  takeDamage(amount) {
    if (this.iframes > 0) return false;
    if (this.shield > 0) {
      const absorbed = Math.min(this.shield, amount);
      this.shield -= absorbed;
      amount -= absorbed;
    }
    if (amount > 0) this.hp -= amount;
    this.shieldDelay = 2.5;
    this.iframes = 0.3;
    if (this.hp <= 0) { this.dead = true; return true; }
    return false;
  }

  draw(ctx, t) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle + Math.PI / 2);

    // Boost glow
    if (this.boosting) {
      ctx.beginPath();
      ctx.arc(0, 0, 28, 0, TAU);
      const g = ctx.createRadialGradient(0, 0, 8, 0, 0, 28);
      g.addColorStop(0, 'rgba(255,107,0,0.3)');
      g.addColorStop(1, 'transparent');
      ctx.fillStyle = g;
      ctx.fill();
    }

    // Shield bubble
    if (this.shield > 10) {
      const sa = this.shield / this.maxShield * 0.4;
      ctx.beginPath();
      ctx.arc(0, 0, 22, 0, TAU);
      ctx.strokeStyle = `rgba(0,245,255,${sa})`;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Iframes flash
    if (this.iframes > 0 && Math.floor(this.iframes * 10) % 2 === 0) {
      ctx.restore(); return;
    }

    // Hull
    ctx.beginPath();
    ctx.moveTo(0, -16);
    ctx.lineTo(-10, 10);
    ctx.lineTo(-5, 6);
    ctx.lineTo(0, 8);
    ctx.lineTo(5, 6);
    ctx.lineTo(10, 10);
    ctx.closePath();

    const hull = ctx.createLinearGradient(0, -16, 0, 10);
    hull.addColorStop(0, '#00f5ff');
    hull.addColorStop(1, '#0066aa');
    ctx.fillStyle = hull;
    ctx.fill();
    ctx.strokeStyle = '#00f5ff';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Engine glow
    const thrustFlicker = 0.7 + Math.sin(t * 20) * 0.3;
    const up = keys['w'] || keys['ArrowUp'] || touch.up;
    if (up) {
      ctx.beginPath();
      ctx.moveTo(-5, 6);
      ctx.lineTo(0, 10 + 8 * thrustFlicker * (this.boosting ? 2 : 1));
      ctx.lineTo(5, 6);
      ctx.fillStyle = this.boosting ? '#ff6b00' : '#00f5ff';
      ctx.fill();
    }

    ctx.restore();
  }
}

// ── Enemy ──
class Enemy {
  constructor(x, y, level) {
    this.x = x; this.y = y;
    const def = getLevelDef(level);
    const diffMul = { easy: 0.7, normal: 1, hard: 1.4 }[settings.difficulty] || 1;
    this.speed = def.enemySpeed * diffMul * rand(0.8, 1.2);
    this.radius = randInt(10, 18);
    this.hp = Math.ceil(this.radius * 1.5 * (1 + (level-1)*0.2));
    this.maxHp = this.hp;
    this.angle = rand(0, TAU);
    this.rotSpeed = rand(-2, 2);
    this.shootTimer = rand(1, 3);
    this.shootRate = rand(2, 4) / diffMul;
    this.type = ['fighter', 'tank', 'scout'][randInt(0, 2)];
    this.color = { fighter: '#ff2d78', tank: '#9d00ff', scout: '#ff6b00' }[this.type];
    this.points = Math.ceil(this.radius * 5 * (1 + (level-1)*0.3));
    this.dead = false;
    this.vx = 0; this.vy = 0;
  }

  update(dt, player, gravWells) {
    this.angle += this.rotSpeed * dt;

    // Chase player
    const dx = player.x - this.x;
    const dy = player.y - this.y;
    const d = Math.hypot(dx, dy) || 1;
    this.vx = lerp(this.vx, (dx/d) * this.speed, 2 * dt);
    this.vy = lerp(this.vy, (dy/d) * this.speed, 2 * dt);

    // Gravity wells affect enemies too
    gravWells.forEach(gw => {
      const gx = gw.x - this.x, gy = gw.y - this.y;
      const gd2 = gx*gx + gy*gy;
      const gd = Math.sqrt(gd2);
      if (gd < 5) return;
      const force = gw.mass * 4000 / gd2;
      this.vx += (gx/gd) * force * dt;
      this.vy += (gy/gd) * force * dt;
    });

    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // Wrap
    if (this.x < -30) this.x = W + 30;
    if (this.x > W + 30) this.x = -30;
    if (this.y < -30) this.y = H + 30;
    if (this.y > H + 30) this.y = -30;

    // Shoot
    this.shootTimer -= dt;
    if (this.shootTimer <= 0) {
      this.shootTimer = this.shootRate;
      return 'shoot';
    }
    return null;
  }

  takeDamage(amount) {
    this.hp -= amount;
    if (this.hp <= 0) { this.dead = true; return true; }
    return false;
  }

  draw(ctx, t) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);

    // HP bar
    if (this.hp < this.maxHp) {
      const bw = this.radius * 2.5;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(-bw/2, -this.radius - 8, bw, 3);
      ctx.fillStyle = this.color;
      ctx.fillRect(-bw/2, -this.radius - 8, bw * (this.hp/this.maxHp), 3);
    }

    // Glow
    const g = ctx.createRadialGradient(0, 0, this.radius*0.5, 0, 0, this.radius*1.5);
    g.addColorStop(0, this.color + '66');
    g.addColorStop(1, 'transparent');
    ctx.beginPath(); ctx.arc(0, 0, this.radius*1.5, 0, TAU);
    ctx.fillStyle = g; ctx.fill();

    if (this.type === 'fighter') {
      ctx.beginPath();
      ctx.moveTo(0, -this.radius);
      ctx.lineTo(this.radius * 0.7, this.radius * 0.5);
      ctx.lineTo(0, this.radius * 0.2);
      ctx.lineTo(-this.radius * 0.7, this.radius * 0.5);
      ctx.closePath();
    } else if (this.type === 'tank') {
      const sides = 6;
      ctx.beginPath();
      for (let i = 0; i < sides; i++) {
        const a = (i / sides) * TAU;
        const method = i === 0 ? 'moveTo' : 'lineTo';
        ctx[method](Math.cos(a) * this.radius, Math.sin(a) * this.radius);
      }
      ctx.closePath();
    } else {
      // scout — diamond
      ctx.beginPath();
      ctx.moveTo(0, -this.radius);
      ctx.lineTo(this.radius, 0);
      ctx.lineTo(0, this.radius);
      ctx.lineTo(-this.radius, 0);
      ctx.closePath();
    }

    ctx.fillStyle = this.color + '44';
    ctx.fill();
    ctx.strokeStyle = this.color;
    ctx.lineWidth = 2;
    ctx.shadowColor = this.color;
    ctx.shadowBlur = 8;
    ctx.stroke();

    ctx.restore();
  }
}

// ── Bullet ──
class Bullet {
  constructor(x, y, vx, vy, isPlayer, damage = 25) {
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.isPlayer = isPlayer;
    this.damage = damage;
    this.radius = isPlayer ? 4 : 3;
    this.life = 2.5;
    this.dead = false;
    this.color = isPlayer ? '#00f5ff' : '#ff2d78';
  }

  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.life -= dt;
    if (this.life <= 0 || this.x < -20 || this.x > W+20 || this.y < -20 || this.y > H+20) {
      this.dead = true;
    }
  }

  draw(ctx) {
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, TAU);
    ctx.fillStyle = this.color;
    ctx.shadowColor = this.color;
    ctx.shadowBlur = 12;
    ctx.fill();
    ctx.shadowBlur = 0;

    // Trail
    ctx.beginPath();
    ctx.moveTo(this.x, this.y);
    ctx.lineTo(this.x - this.vx * 0.04, this.y - this.vy * 0.04);
    ctx.strokeStyle = this.color + '88';
    ctx.lineWidth = this.radius * 0.8;
    ctx.stroke();
  }
}

// ── Gravity Well ──
class GravityWell {
  constructor(x, y, mass, level) {
    this.x = x; this.y = y;
    this.mass = mass;
    this.radius = 20 + mass * 5;
    this.dangerRadius = 60 + mass * 15;
    this.pulsePhase = rand(0, TAU);
    this.color = mass > 8 ? '#9d00ff' : '#00f5ff';
  }

  draw(ctx, t) {
    this.pulsePhase += 0.03;
    const pulse = Math.sin(this.pulsePhase) * 0.3 + 0.7;

    // Danger zone
    for (let ring = 3; ring >= 1; ring--) {
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.dangerRadius * ring / 3 * pulse, 0, TAU);
      ctx.strokeStyle = `rgba(157,0,255,${0.06 * ring})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Core glow
    const g = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, this.radius * 2);
    g.addColorStop(0, this.color + 'cc');
    g.addColorStop(0.5, this.color + '44');
    g.addColorStop(1, 'transparent');
    ctx.beginPath(); ctx.arc(this.x, this.y, this.radius * 2, 0, TAU);
    ctx.fillStyle = g; ctx.fill();

    // Core
    ctx.beginPath(); ctx.arc(this.x, this.y, this.radius * pulse, 0, TAU);
    ctx.fillStyle = this.color;
    ctx.shadowColor = this.color; ctx.shadowBlur = 20;
    ctx.fill(); ctx.shadowBlur = 0;

    // Rotating lines
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(t * 1.5);
    for (let i = 0; i < 4; i++) {
      ctx.rotate(TAU / 4);
      ctx.beginPath();
      ctx.moveTo(this.radius, 0);
      ctx.lineTo(this.dangerRadius * 0.5, 0);
      ctx.strokeStyle = this.color + '44';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.restore();
  }

  checkDanger(x, y) {
    return dist2(x, y, this.x, this.y) < this.dangerRadius * this.dangerRadius;
  }
}

// ── Asteroid ──
class Asteroid {
  constructor(x, y, size) {
    this.x = x; this.y = y;
    this.size = size || randInt(20, 45);
    this.radius = this.size;
    this.vx = rand(-50, 50);
    this.vy = rand(-50, 50);
    this.rotSpeed = rand(-1, 1);
    this.angle = 0;
    this.hp = Math.ceil(this.size / 8);
    this.dead = false;
    this.points = 0;
    // Irregular shape
    this.verts = [];
    const sides = randInt(6, 10);
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * TAU;
      const r = this.size * rand(0.7, 1.3);
      this.verts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
    }
  }

  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.angle += this.rotSpeed * dt;
    if (this.x < -60) this.x = W + 60;
    if (this.x > W + 60) this.x = -60;
    if (this.y < -60) this.y = H + 60;
    if (this.y > H + 60) this.y = -60;
  }

  draw(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);
    ctx.beginPath();
    ctx.moveTo(this.verts[0].x, this.verts[0].y);
    this.verts.forEach((v, i) => { if (i > 0) ctx.lineTo(v.x, v.y); });
    ctx.closePath();
    ctx.fillStyle = 'rgba(80,60,40,0.6)';
    ctx.fill();
    ctx.strokeStyle = '#8a6a4a';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }
}

// ── Orb (pickup) ──
class Orb {
  constructor(x, y, type) {
    this.x = x; this.y = y;
    this.type = type || ['health', 'shield', 'points'][randInt(0, 2)];
    this.radius = 8;
    this.life = 8;
    this.pulse = 0;
    this.dead = false;
    this.color = { health: '#ff2d78', shield: '#00f5ff', points: '#ffd700' }[this.type];
    this.value = { health: 30, shield: 50, points: 150 }[this.type];
  }

  update(dt) {
    this.pulse += dt * 3;
    this.life -= dt;
    if (this.life <= 0) this.dead = true;
  }

  draw(ctx) {
    const pulse = Math.sin(this.pulse) * 0.2 + 0.8;
    const alpha = Math.min(1, this.life * 2);

    ctx.globalAlpha = alpha;
    const g = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, this.radius * 2);
    g.addColorStop(0, this.color);
    g.addColorStop(1, 'transparent');
    ctx.beginPath(); ctx.arc(this.x, this.y, this.radius * 2 * pulse, 0, TAU);
    ctx.fillStyle = g; ctx.fill();

    ctx.beginPath(); ctx.arc(this.x, this.y, this.radius * pulse, 0, TAU);
    ctx.fillStyle = this.color;
    ctx.shadowColor = this.color; ctx.shadowBlur = 15;
    ctx.fill(); ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }
}

// ═══════════════════════════════════════════════════════
//  SPAWN HELPERS
// ═══════════════════════════════════════════════════════
function spawnEnemy(level) {
  const edge = randInt(0, 3);
  let x, y;
  if (edge === 0) { x = rand(-30, W+30); y = -30; }
  else if (edge === 1) { x = rand(-30, W+30); y = H+30; }
  else if (edge === 2) { x = -30; y = rand(-30, H+30); }
  else { x = W+30; y = rand(-30, H+30); }
  return new Enemy(x, y, level);
}

function spawnGravWell(existing) {
  let x, y, ok = false, attempts = 0;
  while (!ok && attempts < 20) {
    x = rand(W * 0.15, W * 0.85);
    y = rand(H * 0.15, H * 0.85);
    ok = existing.every(gw => Math.hypot(gw.x - x, gw.y - y) > 120);
    attempts++;
  }
  const mass = rand(4, 12);
  return new GravityWell(x, y, mass);
}

// ═══════════════════════════════════════════════════════
//  MAIN GAME INIT
// ═══════════════════════════════════════════════════════
function initGame() {
  canvas = $('game-canvas');
  ctx = canvas.getContext('2d');
  resizeCanvas();
  initStars();
  startLevel(1);
}

function resizeCanvas() {
  W = canvas.width = window.innerWidth;
  H = canvas.height = window.innerHeight;
}

function startLevel(level) {
  const def = getLevelDef(level);
  const player = gameState.player || new Player(W/2, H/2);

  if (gameState.player && level > 1) {
    player.hp = Math.min(player.maxHp, player.hp + 30);
    player.shield = player.maxShield;
  }

  gameState = {
    level,
    player: level === 1 ? new Player(W/2, H/2) : player,
    enemies: [],
    bullets: [],
    orbs: [],
    gravWells: [],
    asteroids: [],
    score: gameState.score || 0,
    sessionKills: gameState.sessionKills || 0,
    totalKillsAll: (save.achievements.kill_50 ? 50 : 0) + (gameState.sessionKills || 0),
    elapsed: gameState.elapsed || 0,
    spawnTimer: 0,
    spawnRate: def.spawnRate,
    maxEnemies: def.enemies,
    maxCombo: gameState.maxCombo || 0,
    combo: gameState.combo || 1,
    comboTimer: 0,
    sectorNoDamage: true,
    levelKills: 0,
    levelKillsNeeded: def.enemies * 3,
    levelProgress: 0,
    transitioning: false,
    t: gameState.t || 0,
  };

  // Spawn gravity wells
  for (let i = 0; i < def.gravWells; i++) {
    gameState.gravWells.push(spawnGravWell(gameState.gravWells));
  }

  // Spawn asteroids
  for (let i = 0; i < def.asteroids; i++) {
    let x = rand(0, W), y = rand(0, H);
    while (Math.hypot(x - W/2, y - H/2) < 150) {
      x = rand(0, W); y = rand(0, H);
    }
    gameState.asteroids.push(new Asteroid(x, y));
  }

  updateHUD();
}

// ═══════════════════════════════════════════════════════
//  GAME LOOP
// ═══════════════════════════════════════════════════════
function gameLoop(ts) {
  if (!gameRunning) return;
  animFrame = requestAnimationFrame(gameLoop);

  const dt = Math.min((ts - lastTime) / 1000, 0.05);
  lastTime = ts;
  if (gamePaused) return;

  gameState.t += dt;
  gameState.elapsed += dt;

  update(dt);
  render(gameState.t);
}

function update(dt) {
  const gs = gameState;
  const { player, gravWells } = gs;

  // Player update
  const action = player.update(dt, gravWells);
  if (action === 'shoot') {
    const spd = 520;
    gs.bullets.push(new Bullet(
      player.x + Math.cos(player.angle) * 18,
      player.y + Math.sin(player.angle) * 18,
      player.vx + Math.cos(player.angle) * spd,
      player.vy + Math.sin(player.angle) * spd,
      true, 25
    ));
    playShoot();
  }

  if (player.dead) {
    spawnExplosion(player.x, player.y, '#00f5ff', '#ff2d78', 60, 250);
    playExplode(true);
    setTimeout(() => showGameOver(), 800);
    gameRunning = false;
    return;
  }

  // Combo timer
  gs.comboTimer -= dt;
  if (gs.comboTimer <= 0 && gs.combo > 1) {
    gs.combo = Math.max(1, gs.combo - 1);
    gs.comboTimer = 0;
  }

  // Enemy spawning
  gs.spawnTimer -= dt;
  if (gs.spawnTimer <= 0 && gs.enemies.length < gs.maxEnemies) {
    gs.enemies.push(spawnEnemy(gs.level));
    gs.spawnTimer = gs.spawnRate;
  }

  // Enemy update
  gs.enemies.forEach(e => {
    const ea = e.update(dt, player, gravWells);
    if (ea === 'shoot') {
      const dx = player.x - e.x, dy = player.y - e.y;
      const d = Math.hypot(dx, dy) || 1;
      const spd = 280;
      const spread = 0.12;
      gs.bullets.push(new Bullet(
        e.x + dx/d*22, e.y + dy/d*22,
        dx/d*spd + rand(-spread,spread)*spd,
        dy/d*spd + rand(-spread,spread)*spd,
        false, 12
      ));
    }
  });

  // Asteroid update
  gs.asteroids.forEach(a => a.update(dt));

  // Orb update
  gs.orbs.forEach(o => o.update(dt));
  gs.orbs = gs.orbs.filter(o => !o.dead);

  // Bullet update & collision
  gs.bullets.forEach(b => {
    b.update(dt);
    if (b.dead) return;

    if (b.isPlayer) {
      // vs enemies
      for (const e of gs.enemies) {
        if (dist2(b.x, b.y, e.x, e.y) < (b.radius + e.radius) ** 2) {
          b.dead = true;
          spawnExplosion(b.x, b.y, '#ff2d78', '#ff6b00', 8, 100);
          if (e.takeDamage(b.damage)) {
            spawnExplosion(e.x, e.y, e.color, '#ffffff', 25, 200);
            playExplode();
            // Drop orb
            if (Math.random() < 0.35) gs.orbs.push(new Orb(e.x, e.y));
            gs.score += e.points * gs.combo;
            gs.sessionKills++;
            gs.levelKills++;
            gs.combo = Math.min(10, gs.combo + 1);
            gs.comboTimer = 3;
            gs.maxCombo = Math.max(gs.maxCombo, gs.combo);
            checkAchievements({ ...gs, totalKillsAll: gs.totalKillsAll + gs.sessionKills });
            updateHUD();
          }
          break;
        }
      }
      // vs asteroids
      for (const a of gs.asteroids) {
        if (dist2(b.x, b.y, a.x, a.y) < (b.radius + a.radius) ** 2) {
          b.dead = true;
          spawnExplosion(b.x, b.y, '#8a6a4a', '#aa8855', 6, 80);
          a.hp--;
          if (a.hp <= 0) {
            a.dead = true;
            spawnExplosion(a.x, a.y, '#8a6a4a', '#666666', 15, 150);
            gs.score += 20 * gs.combo;
            if (a.size > 25) {
              gs.asteroids.push(new Asteroid(a.x + rand(-20,20), a.y + rand(-20,20), a.size * 0.55));
              gs.asteroids.push(new Asteroid(a.x + rand(-20,20), a.y + rand(-20,20), a.size * 0.55));
            }
          }
          break;
        }
      }
    } else {
      // Enemy bullet vs player
      if (dist2(b.x, b.y, player.x, player.y) < (b.radius + player.radius) ** 2) {
        b.dead = true;
        const died = player.takeDamage(b.damage);
        gs.sectorNoDamage = false;
        playHit();
        flashDamage();
        if (died) { /* handled above */ }
        updateHUD();
      }
    }
  });

  // Player vs enemy collision
  gs.enemies.forEach(e => {
    if (dist2(player.x, player.y, e.x, e.y) < (player.radius + e.radius) ** 2) {
      const died = player.takeDamage(20);
      gs.sectorNoDamage = false;
      spawnExplosion(player.x, player.y, '#00f5ff', '#ffffff', 10, 80);
      playHit();
      flashDamage();
      updateHUD();
    }
  });

  // Player vs gravity well (lethal if too close)
  gravWells.forEach(gw => {
    if (dist2(player.x, player.y, gw.x, gw.y) < (gw.radius * 1.2) ** 2) {
      player.takeDamage(80 * dt);
      gs.sectorNoDamage = false;
      updateHUD();
    }
  });

  // Orb pickup
  gs.orbs.forEach(o => {
    if (dist2(player.x, player.y, o.x, o.y) < (player.radius + o.radius + 10) ** 2) {
      o.dead = true;
      playPickup();
      if (o.type === 'health') player.hp = Math.min(player.maxHp, player.hp + o.value);
      else if (o.type === 'shield') player.shield = Math.min(player.maxShield, player.shield + o.value);
      else gs.score += o.value * gs.combo;
      updateHUD();
    }
  });

  // Level progression
  gs.levelProgress = gs.levelKills / gs.levelKillsNeeded;
  if (gs.levelKills >= gs.levelKillsNeeded && !gs.transitioning) {
    gs.transitioning = true;
    checkAchievements({ ...gs, sectorNoDamage: gs.sectorNoDamage });
    triggerLevelTransition(gs.level + 1);
  }

  // Clean up dead objects
  gs.enemies = gs.enemies.filter(e => !e.dead);
  gs.bullets = gs.bullets.filter(b => !b.dead);
  gs.asteroids = gs.asteroids.filter(a => !a.dead);

  // Particles
  for (let i = particles.length - 1; i >= 0; i--) {
    particles[i].update(dt);
    if (particles[i].dead) particles.splice(i, 1);
  }

  // Update timer display
  const m = Math.floor(gs.elapsed / 60).toString().padStart(2, '0');
  const s = Math.floor(gs.elapsed % 60).toString().padStart(2, '0');
  $('hud-timer').textContent = `${m}:${s}`;
}

// ═══════════════════════════════════════════════════════
//  RENDER
// ═══════════════════════════════════════════════════════
function render(t) {
  ctx.clearRect(0, 0, W, H);

  // Background gradient
  const bg = ctx.createRadialGradient(W/2, H/2, 0, W/2, H/2, Math.max(W, H));
  bg.addColorStop(0, '#061020');
  bg.addColorStop(1, '#020408');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Stars (parallax with player velocity)
  const { player } = gameState;
  bgStars.forEach(s => {
    s.x -= player.vx * s.speed * 0.016;
    s.y -= player.vy * s.speed * 0.016;
    if (s.x < 0) s.x += W; if (s.x > W) s.x -= W;
    if (s.y < 0) s.y += H; if (s.y > H) s.y -= H;
    s.twinkle += 0.02;
    const a = s.alpha * (0.7 + Math.sin(s.twinkle) * 0.3);
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.size, 0, TAU);
    ctx.fillStyle = `rgba(200,220,255,${a})`;
    ctx.fill();
  });

  // Level progress bar at bottom
  ctx.fillStyle = 'rgba(0,245,255,0.08)';
  ctx.fillRect(0, H - 3, W * gameState.levelProgress, 3);
  ctx.fillStyle = 'rgba(0,245,255,0.5)';
  ctx.fillRect(0, H - 3, W * gameState.levelProgress, 2);

  // Draw gravity wells
  gameState.gravWells.forEach(gw => gw.draw(ctx, t));

  // Draw asteroids
  gameState.asteroids.forEach(a => a.draw(ctx));

  // Draw orbs
  gameState.orbs.forEach(o => o.draw(ctx));

  // Draw enemies
  gameState.enemies.forEach(e => e.draw(ctx, t));

  // Draw bullets
  ctx.save();
  gameState.bullets.forEach(b => b.draw(ctx));
  ctx.restore();

  // Draw particles
  ctx.save();
  particles.forEach(p => p.draw(ctx));
  ctx.restore();

  // Draw player
  player.draw(ctx, t);

  // Danger vignette near gravity wells
  let nearDanger = false;
  gameState.gravWells.forEach(gw => {
    if (gw.checkDanger(player.x, player.y)) nearDanger = true;
  });
  if (nearDanger) {
    const v = ctx.createRadialGradient(W/2, H/2, W*0.3, W/2, H/2, W*0.7);
    v.addColorStop(0, 'transparent');
    v.addColorStop(1, `rgba(157,0,255,${0.2 + Math.sin(t*4)*0.05})`);
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
  }
}

// ═══════════════════════════════════════════════════════
//  HUD UPDATE
// ═══════════════════════════════════════════════════════
function updateHUD() {
  const { player, score, level, combo } = gameState;
  $('hud-score').textContent = score.toLocaleString();
  $('hud-level').textContent = level;
  $('hud-combo').textContent = `x${combo}`;
  $('health-fill').style.width = `${(player.hp / player.maxHp) * 100}%`;
  $('shield-fill').style.width = `${(player.shield / player.maxShield) * 100}%`;
  checkAchievements({ ...gameState });
}

// ═══════════════════════════════════════════════════════
//  SCREEN TRANSITIONS
// ═══════════════════════════════════════════════════════
function triggerLevelTransition(nextLevel) {
  gameRunning = false;
  const overlay = $('level-transition');
  const def = getLevelDef(nextLevel);
  $('lt-number').textContent = nextLevel;
  $('lt-subtitle').textContent = def.name;
  overlay.classList.remove('hidden');
  playLevelUp();

  // Update top level save
  if (nextLevel > save.topLevel) { save.topLevel = nextLevel; writeSave(); }

  setTimeout(() => {
    overlay.classList.add('hidden');
    startLevel(nextLevel);
    gameRunning = true;
    lastTime = performance.now();
    animFrame = requestAnimationFrame(gameLoop);
  }, 2200);
}

function flashDamage() {
  let el = $('damage-flash');
  if (!el) {
    el = document.createElement('div');
    el.id = 'damage-flash';
    document.body.appendChild(el);
  }
  el.style.animation = 'none';
  el.offsetHeight; // reflow
  el.style.animation = 'screen-flash 0.4s ease-out forwards';
}

// ═══════════════════════════════════════════════════════
//  GAME OVER / PAUSE
// ═══════════════════════════════════════════════════════
function showGameOver() {
  stopBGMusic();
  const gs = gameState;
  const isNewBest = gs.score > save.bestScore;
  if (isNewBest) save.bestScore = gs.score;
  save.totalMissions++;
  if (gs.level > save.topLevel) save.topLevel = gs.level;

  // Add to leaderboard
  const m = Math.floor(gs.elapsed / 60).toString().padStart(2,'0');
  const s = Math.floor(gs.elapsed % 60).toString().padStart(2,'0');
  save.leaderboard.push({
    score: gs.score, level: gs.level,
    time: `${m}:${s}`, kills: gs.sessionKills,
    date: new Date().toLocaleDateString()
  });
  save.leaderboard.sort((a, b) => b.score - a.score);
  save.leaderboard = save.leaderboard.slice(0, 10);
  writeSave();

  $('go-score').textContent = gs.score.toLocaleString();
  $('go-level').textContent = gs.level;
  $('go-time').textContent = `${m}:${s}`;
  $('go-kills').textContent = gs.sessionKills;
  $('go-best').textContent = save.bestScore.toLocaleString();
  $('go-newbest').classList.toggle('hidden', !isNewBest);
  showScreen('gameover-screen');
}

function pauseGame() {
  if (!gameRunning) return;
  gamePaused = true;
  const gs = gameState;
  $('pause-score').textContent = gs.score.toLocaleString();
  $('pause-level').textContent = gs.level;
  const m = Math.floor(gs.elapsed/60).toString().padStart(2,'0');
  const s = Math.floor(gs.elapsed%60).toString().padStart(2,'0');
  $('pause-time').textContent = `${m}:${s}`;
  showScreen('pause-screen');
  stopBGMusic();
}

function resumeGame() {
  gamePaused = false;
  hideScreen('pause-screen');
  lastTime = performance.now();
  if (settings.musicVol > 0) startBGMusic();
}

// ═══════════════════════════════════════════════════════
//  SCREEN MANAGEMENT
// ═══════════════════════════════════════════════════════
const ALL_SCREENS = ['main-menu','game-screen','pause-screen','gameover-screen','leaderboard-screen','achievements-screen','settings-screen'];

function showScreen(id) {
  $('game-screen').classList.toggle('hidden', id !== 'game-screen');
  ALL_SCREENS.forEach(s => { if (s !== 'game-screen') $(s).classList.toggle('hidden', s !== id); });
  if (id === 'game-screen') {
    $('game-screen').classList.remove('hidden');
    ALL_SCREENS.filter(s => s !== 'game-screen').forEach(s => $(s).classList.add('hidden'));
  }
}

function hideScreen(id) { $(id).classList.add('hidden'); }

function goToMenu() {
  gameRunning = false;
  gamePaused = false;
  stopBGMusic();
  particles.length = 0;
  $('menu-best-score').textContent = save.bestScore.toLocaleString();
  $('menu-missions').textContent = save.totalMissions;
  $('menu-top-level').textContent = save.topLevel;
  showScreen('main-menu');
  startMenuBG();
}

function startNewGame() {
  gameState = {};
  particles.length = 0;
  showScreen('game-screen');
  initGame();
  gameRunning = true;
  lastTime = performance.now();
  animFrame = requestAnimationFrame(gameLoop);
  startBGMusic();
}

function restartGame() {
  gameRunning = false;
  particles.length = 0;
  showScreen('game-screen');
  gameState = {};
  initGame();
  gameRunning = true;
  lastTime = performance.now();
  animFrame = requestAnimationFrame(gameLoop);
  if (settings.musicVol > 0) startBGMusic();
}

// ═══════════════════════════════════════════════════════
//  MENU BACKGROUND ANIMATION
// ═══════════════════════════════════════════════════════
let menuAnimFrame = null;
let menuParticles = [];
let menuT = 0;
let menuCanvas, menuCtx;

function startMenuBG() {
  menuCanvas = $('menu-bg-canvas');
  if (!menuCanvas) return;
  menuCanvas.width = window.innerWidth;
  menuCanvas.height = window.innerHeight;
  menuCtx = menuCanvas.getContext('2d');
  menuParticles = [];
  for (let i = 0; i < 60; i++) {
    menuParticles.push({
      x: rand(0, menuCanvas.width), y: rand(0, menuCanvas.height),
      vx: rand(-20, 20), vy: rand(-20, 20),
      size: rand(1, 3), color: Math.random() < 0.5 ? '#00f5ff' : '#9d00ff',
      alpha: rand(0.2, 0.8), pulse: rand(0, TAU)
    });
  }
  if (menuAnimFrame) cancelAnimationFrame(menuAnimFrame);
  menuAnimFrame = requestAnimationFrame(animMenuBG);
}

function animMenuBG(ts) {
  if (!$('main-menu') || $('main-menu').classList.contains('hidden')) {
    cancelAnimationFrame(menuAnimFrame); return;
  }
  menuAnimFrame = requestAnimationFrame(animMenuBG);
  menuT += 0.016;
  const W = menuCanvas.width, H = menuCanvas.height;
  menuCtx.clearRect(0, 0, W, H);

  // Nebula
  const grd = menuCtx.createRadialGradient(W*0.3, H*0.4, 0, W*0.3, H*0.4, W*0.6);
  grd.addColorStop(0, 'rgba(0,80,120,0.15)');
  grd.addColorStop(1, 'transparent');
  menuCtx.fillStyle = grd; menuCtx.fillRect(0, 0, W, H);
  const grd2 = menuCtx.createRadialGradient(W*0.7, H*0.6, 0, W*0.7, H*0.6, W*0.5);
  grd2.addColorStop(0, 'rgba(80,0,120,0.12)');
  grd2.addColorStop(1, 'transparent');
  menuCtx.fillStyle = grd2; menuCtx.fillRect(0, 0, W, H);

  menuParticles.forEach(p => {
    p.x += p.vx * 0.016; p.y += p.vy * 0.016;
    p.pulse += 0.04;
    if (p.x < 0) p.x = W; if (p.x > W) p.x = 0;
    if (p.y < 0) p.y = H; if (p.y > H) p.y = 0;
    const a = p.alpha * (0.6 + Math.sin(p.pulse) * 0.4);
    menuCtx.beginPath();
    menuCtx.arc(p.x, p.y, p.size, 0, TAU);
    menuCtx.fillStyle = p.color.replace(')', `,${a})`).replace('rgb(', 'rgba(').replace('#00f5ff', `rgba(0,245,255,${a})`).replace('#9d00ff', `rgba(157,0,255,${a})`);
    // simpler:
    menuCtx.globalAlpha = a;
    menuCtx.fillStyle = p.color;
    menuCtx.fill();
    menuCtx.globalAlpha = 1;
  });

  // Grid lines
  menuCtx.strokeStyle = 'rgba(0,245,255,0.03)';
  menuCtx.lineWidth = 1;
  const grid = 80;
  const ox = (menuT * 15) % grid;
  for (let x = -grid + ox; x < W + grid; x += grid) {
    menuCtx.beginPath(); menuCtx.moveTo(x, 0); menuCtx.lineTo(x + H, H); menuCtx.stroke();
  }
}

// ═══════════════════════════════════════════════════════
//  LEADERBOARD / ACHIEVEMENTS / SETTINGS UI
// ═══════════════════════════════════════════════════════
function renderLeaderboard() {
  const list = $('leaderboard-list');
  if (!save.leaderboard.length) {
    list.innerHTML = '<div style="text-align:center;color:var(--text-dim);font-family:var(--font-hud);font-size:0.8rem;padding:2rem;">NO MISSIONS LOGGED YET</div>';
    return;
  }
  const medals = ['gold', 'silver', 'bronze'];
  list.innerHTML = save.leaderboard.map((e, i) => `
    <div class="lb-entry ${medals[i] || ''}">
      <div class="lb-rank">${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i+1}`}</div>
      <div class="lb-info">
        <div class="lb-name">SECTOR ${e.level} — ${e.kills} KILLS</div>
        <div class="lb-meta">TIME: ${e.time} · ${e.date}</div>
      </div>
      <div class="lb-score">${e.score.toLocaleString()}</div>
    </div>
  `).join('');
}

function renderAchievements() {
  const grid = $('achievements-grid');
  grid.innerHTML = ACHIEVEMENTS.map(a => {
    const unlocked = !!save.achievements[a.id];
    return `<div class="achievement-card ${unlocked ? 'unlocked' : 'locked'}">
      <span class="ach-icon">${a.icon}</span>
      <div class="ach-name">${a.name}</div>
      <div class="ach-desc">${a.desc}</div>
    </div>`;
  }).join('');
}

function initSettings() {
  const musicSlider = $('set-music');
  const sfxSlider = $('set-sfx');
  musicSlider.value = settings.musicVol;
  sfxSlider.value = settings.sfxVol;
  $('set-music-val').textContent = `${settings.musicVol}%`;
  $('set-sfx-val').textContent = `${settings.sfxVol}%`;

  musicSlider.addEventListener('input', () => {
    settings.musicVol = +musicSlider.value;
    $('set-music-val').textContent = `${settings.musicVol}%`;
    updateAudioVolumes();
    writeSave();
  });
  sfxSlider.addEventListener('input', () => {
    settings.sfxVol = +sfxSlider.value;
    $('set-sfx-val').textContent = `${settings.sfxVol}%`;
    updateAudioVolumes();
    writeSave();
  });

  document.querySelectorAll('#set-difficulty .tgl').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#set-difficulty .tgl').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      settings.difficulty = btn.dataset.val;
      writeSave();
    });
    if (btn.dataset.val === settings.difficulty) btn.classList.add('active');
    else btn.classList.remove('active');
  });

  document.querySelectorAll('#set-particles .tgl').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#set-particles .tgl').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      settings.particles = btn.dataset.val;
      writeSave();
    });
    if (btn.dataset.val === settings.particles) btn.classList.add('active');
    else btn.classList.remove('active');
  });
}

// ═══════════════════════════════════════════════════════
//  INPUT HANDLERS
// ═══════════════════════════════════════════════════════
function initInput() {
  document.addEventListener('keydown', e => {
    keys[e.key] = true;
    if ((e.key === 'p' || e.key === 'P' || e.key === 'Escape') && gameRunning && !gamePaused) {
      pauseGame();
    } else if (e.key === 'Escape' && gamePaused) {
      resumeGame();
    }
  });
  document.addEventListener('keyup', e => { keys[e.key] = false; });

  // Mouse shooting
  document.addEventListener('mousedown', e => {
    if (e.button === 0 && gameRunning && !gamePaused) keys[' '] = true;
  });
  document.addEventListener('mouseup', e => { if (e.button === 0) keys[' '] = false; });

  // Mobile D-pad
  const dpad = [
    ['d-up', 'up'], ['d-down', 'down'], ['d-left', 'left'], ['d-right', 'right']
  ];
  dpad.forEach(([id, dir]) => {
    const el = document.querySelector(`.d-${dir.split('')[0]}`);
    if (!el) return;
    const start = () => { touch[dir === 'up' ? 'up' : dir === 'down' ? 'down' : dir === 'left' ? 'left' : 'right'] = true; };
    const end = () => { touch[dir === 'up' ? 'up' : dir === 'down' ? 'down' : dir === 'left' ? 'left' : 'right'] = false; };
    el.addEventListener('touchstart', e => { e.preventDefault(); start(); }, { passive: false });
    el.addEventListener('touchend', e => { e.preventDefault(); end(); }, { passive: false });
    el.addEventListener('mousedown', start);
    el.addEventListener('mouseup', end);
  });
}

// ═══════════════════════════════════════════════════════
//  BUTTON WIRING
// ═══════════════════════════════════════════════════════
function wireButtons() {
  $('btn-play').onclick = () => { initAudio(); startNewGame(); };
  $('btn-leaderboard').onclick = () => { renderLeaderboard(); showScreen('leaderboard-screen'); };
  $('btn-achievements').onclick = () => { renderAchievements(); showScreen('achievements-screen'); };
  $('btn-settings').onclick = () => { showScreen('settings-screen'); };

  $('btn-pause').onclick = () => { initAudio(); pauseGame(); };
  $('btn-resume').onclick = () => resumeGame();
  $('btn-restart-pause').onclick = () => { hideScreen('pause-screen'); restartGame(); };
  $('btn-menu-pause').onclick = () => { hideScreen('pause-screen'); goToMenu(); };

  $('btn-retry').onclick = () => { hideScreen('gameover-screen'); restartGame(); };
  $('btn-menu-go').onclick = () => { hideScreen('gameover-screen'); goToMenu(); };

  $('btn-back-lb').onclick = () => showScreen('main-menu');
  $('btn-back-ach').onclick = () => showScreen('main-menu');
  $('btn-back-set').onclick = () => showScreen('main-menu');
}

// ═══════════════════════════════════════════════════════
//  MOBILE CONTROLS HTML
// ═══════════════════════════════════════════════════════
function buildMobileControls() {
  const mc = document.createElement('div');
  mc.className = 'mobile-controls';
  mc.id = 'mobile-controls';
  mc.innerHTML = `
    <div class="mobile-dpad">
      <button class="d-btn d-up" style="grid-area:up">▲</button>
      <button class="d-btn d-left" style="grid-area:left">◄</button>
      <button class="d-btn d-right" style="grid-area:right">►</button>
      <button class="d-btn d-down" style="grid-area:down">▼</button>
    </div>
    <div class="mobile-actions">
      <button class="action-btn boost-btn" id="mb-boost">BOOST</button>
      <button class="action-btn" id="mb-shoot">FIRE</button>
    </div>
  `;
  document.body.appendChild(mc);

  $('mb-shoot').addEventListener('touchstart', e => { e.preventDefault(); touch.shoot = true; }, { passive: false });
  $('mb-shoot').addEventListener('touchend', e => { e.preventDefault(); touch.shoot = false; }, { passive: false });
  $('mb-boost').addEventListener('touchstart', e => { e.preventDefault(); touch.boost = true; }, { passive: false });
  $('mb-boost').addEventListener('touchend', e => { e.preventDefault(); touch.boost = false; }, { passive: false });

  // D-pad direct
  mc.querySelectorAll('.d-up').forEach(el => {
    el.addEventListener('touchstart', e => { e.preventDefault(); touch.up = true; }, { passive: false });
    el.addEventListener('touchend', e => { e.preventDefault(); touch.up = false; }, { passive: false });
  });
  mc.querySelectorAll('.d-down').forEach(el => {
    el.addEventListener('touchstart', e => { e.preventDefault(); touch.down = true; }, { passive: false });
    el.addEventListener('touchend', e => { e.preventDefault(); touch.down = false; }, { passive: false });
  });
  mc.querySelectorAll('.d-left').forEach(el => {
    el.addEventListener('touchstart', e => { e.preventDefault(); touch.left = true; }, { passive: false });
    el.addEventListener('touchend', e => { e.preventDefault(); touch.left = false; }, { passive: false });
  });
  mc.querySelectorAll('.d-right').forEach(el => {
    el.addEventListener('touchstart', e => { e.preventDefault(); touch.right = true; }, { passive: false });
    el.addEventListener('touchend', e => { e.preventDefault(); touch.right = false; }, { passive: false });
  });

  // Only show when in game
  const observer = new MutationObserver(() => {
    const inGame = !$('game-screen').classList.contains('hidden');
    mc.style.display = inGame && window.innerWidth < 769 ? 'flex' : 'none';
  });
  observer.observe($('game-screen'), { attributes: true, attributeFilter: ['class'] });
}

// ═══════════════════════════════════════════════════════
//  LOADING SCREEN
// ═══════════════════════════════════════════════════════
function runLoader() {
  const bar = $('loader-bar');
  const text = $('loader-text');
  const msgs = ['INITIALIZING SYSTEMS...', 'LOADING ASSETS...', 'CALIBRATING ENGINES...', 'SCANNING VOID...', 'READY TO LAUNCH'];
  let prog = 0;
  const step = () => {
    prog += rand(15, 35);
    if (prog > 100) prog = 100;
    bar.style.width = `${prog}%`;
    const msgIdx = Math.min(Math.floor(prog / 25), msgs.length - 1);
    text.textContent = msgs[msgIdx];
    if (prog < 100) setTimeout(step, rand(200, 500));
    else setTimeout(() => {
      $('loading-screen').style.opacity = '0';
      $('loading-screen').style.transition = 'opacity 0.6s ease';
      setTimeout(() => {
        $('loading-screen').style.display = 'none';
        goToMenu();
      }, 600);
    }, 400);
  };
  setTimeout(step, 300);
}

// ═══════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════
window.addEventListener('resize', () => {
  if (canvas) resizeCanvas();
  if (menuCanvas) { menuCanvas.width = window.innerWidth; menuCanvas.height = window.innerHeight; }
  if (bgStars.length) initStars();
});

document.addEventListener('DOMContentLoaded', () => {
  wireButtons();
  initSettings();
  initInput();
  buildMobileControls();
  runLoader();
});
