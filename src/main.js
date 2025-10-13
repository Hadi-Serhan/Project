import {
  canvas, ctx, cx, cy, dist, clamp,
  core, enemies, projectiles, effects,
  upgrades, cost,
  // state vars
  gold, wave, waveRunning, defeated, waveStatus,
  // setters
  setGold, setWave, setWaveRunning, setDefeatedFlag, setWaveStatus,
  // pub/sub
  subscribe, notifySubscribers,
  // run controls
  paused, timeScale, autoStart, setPaused, setTimeScale, setAutoStart
} from './state.js';

import { ENEMY_TYPES, waveRecipe } from './content.js';
import { nova, frost } from './abilities.js';

// -------------------- Local "view" of state (mirrors state.js) --------------------
const S = {
  get gold()         { return gold; }, set gold(v) { setGold(v); },
  get wave()         { return wave; }, set wave(v) { setWave(v); },
  get waveRunning()  { return waveRunning; }, set waveRunning(v) { setWaveRunning(v); },
  get defeated()     { return defeated; }, set defeated(v) { setDefeatedFlag(v); },
  get waveStatus()   { return waveStatus; }, set waveStatus(t) { setWaveStatus(t); },
  get paused()       { return paused; }, set paused(v) { setPaused(v); },
  get timeScale()    { return timeScale; }, set timeScale(v) { setTimeScale(v); },
  get autoStart()    { return autoStart; }, set autoStart(v) { setAutoStart(v); }
};

// -------------------- Save / Load --------------------
const SAVE_KEY = 'mage-core:v1';

function serialize() {
  return {
    wave: S.wave,
    waveRunning: false,           // never resume mid-wave
    defeated: false,              // never resume defeated
    gold: S.gold,
    coreHP: core.hp,
    upgrades: { ...upgrades },
    novaCD: nova.cdLeft,
    frostCD: frost.cdLeft,
    savedAt: Date.now(),
    timeScale: S.timeScale,
    autoStart: S.autoStart,
  };
}
function hasSave() { try { return !!localStorage.getItem(SAVE_KEY); } catch { return false; } }
function saveGame() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(serialize()));
    setWaveStatus('Game saved 💾');
    setTimeout(() => setWaveStatus('Running…'), 800);
    notifySubscribers(buildSnapshot());
  } catch {}
}
function applySnapshot(snap) {
  S.wave = snap.wave ?? 0;
  S.waveRunning = false;
  S.defeated = false;
  S.gold = snap.gold ?? 0;
  S.timeScale = snap.timeScale ?? 1;
  S.autoStart = !!(snap.autoStart ?? false);

  core.hp = Math.min(core.hpMax, snap.coreHP ?? core.hpMax);

  upgrades.dmg   = snap.upgrades?.dmg   ?? 0;
  upgrades.rof   = snap.upgrades?.rof   ?? 0;
  upgrades.range = snap.upgrades?.range ?? 0;
  core.applyUpgrades();

  nova.cdLeft  = snap.novaCD  ?? 0;
  frost.cdLeft = snap.frostCD ?? 0;

  enemies.length = 0;
  projectiles.length = 0;
  effects.length = 0;
  spawners.length = 0;           // stop any queued spawns

  setWaveStatus('Loaded ✅');
  notifySubscribers(buildSnapshot());
}
function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    applySnapshot(JSON.parse(raw));
    return true;
  } catch { return false; }
}
function wipeSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch {}
  setWaveStatus('Save wiped 🗑️');
  notifySubscribers(buildSnapshot());
}
// autosave every 5s
setInterval(saveGame, 5000);

// -------------------- Snapshot for Vue --------------------
function buildSnapshot(){
  let lastSaved = null;
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) lastSaved = (JSON.parse(raw).savedAt) || null;
  } catch {}

  return {
    wave: S.wave,
    waveRunning: S.waveRunning,
    defeated: S.defeated,
    coreHP: core.hp,
    gold: S.gold,
    costs: { dmg: cost('dmg'), rof: cost('rof'), range: cost('range') },
    cd: { nova: nova.cdLeft, frost: frost.cdLeft },
    waveStatus: S.waveStatus,
    hasSave: hasSave(),
    lastSaved,
    paused: S.paused,
    timeScale: S.timeScale,
    autoStart: S.autoStart,
  };
}

// -------------------- Small FX helpers --------------------
function makeFloatText(x, y, text, color='#ffd166') {
  // A simple rising/fading number
  return {
    t: 0, dur: 0.8, x, y, vy: -36,
    draw(dt){
      this.t += dt;
      const k = clamp(this.t/this.dur, 0, 1);
      const alpha = 1 - k;
      const yy = this.y + this.vy * this.t;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.font = 'bold 14px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(text, this.x, yy);
      ctx.restore();
      return this.t < this.dur;
    }
  };
}
function applyDamage(target, dmg){
  target.hp -= dmg;
  const p = target.pos;
  effects.push(makeFloatText(p.x, p.y - target.radius - 12, Math.ceil(dmg).toString(), '#ffd166'));
}
function coreTookDamage(amount){
  effects.push(makeFloatText(core.x(), core.y() - 28, `-${amount}`, '#ff6b6b'));
}

// -------------------- Enemy factory --------------------
function createEnemy(type='grunt', waveNum=1) {
  const tpl = ENEMY_TYPES[type] || ENEMY_TYPES.grunt;
  const angle = Math.random() * Math.PI * 2;
  const spawnR = Math.min(canvas.width, canvas.height) * 0.45;
  const scale = 1 + waveNum * 0.18;
  const hpMax = Math.round(tpl.hp * scale);
  const goldOnDeath = Math.ceil((tpl.baseGold || 6) * (0.6 + waveNum * 0.2));
  return {
    id: Math.random().toString(36).slice(2),
    type, angle, dist: spawnR,
    speed: tpl.speed, radius: tpl.radius, color: tpl.color,
    hpMax, hp: hpMax, state: 'advancing',
    coreDamage: tpl.coreDamage, attackPeriod: tpl.attackPeriod, attackTimer: 0,
    goldOnDeath, boss: !!tpl.boss,
    get pos(){
      const dx = Math.cos(this.angle), dy = Math.sin(this.angle);
      return { x: cx() + dx * this.dist, y: cy() + dy * this.dist };
    },
    update(dt){
      const p = this.pos;
      let slowFactor = 0;
      if (frost.isIn(p.x, p.y)) slowFactor = this.boss ? Math.min(frost.slow, 0.20) : frost.slow;
      const speedMul = 1 - slowFactor;
      const atkMul = 1 / (1 - slowFactor);
      if (this.state === 'advancing') {
        this.dist = Math.max(0, this.dist - this.speed * speedMul * dt);
        if (this.dist <= core.radius) { this.state = 'attacking'; this.attackTimer = 0; }
      } else {
        this.attackTimer -= dt;
        if (this.attackTimer <= 0) {
          core.hp = Math.max(0, core.hp - this.coreDamage);
          coreTookDamage(this.coreDamage);               // <— pop red number at core
          this.attackTimer += this.attackPeriod * atkMul;
        }
      }
    },
    draw(){
      const p = this.pos;
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath(); ctx.ellipse(p.x+2, p.y+6, this.radius*0.9, this.radius*0.5, 0, 0, Math.PI*2); ctx.fill();
      if (this.state === 'attacking') {
        ctx.strokeStyle = 'rgba(255,120,80,0.6)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(core.x(), core.y()); ctx.stroke();
      }
      ctx.fillStyle = this.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, this.radius, 0, Math.PI*2); ctx.fill();

      const w = this.boss ? 36 : 20, h = 4, x = p.x - w/2, y = p.y - this.radius - 10;
      ctx.fillStyle = '#333'; ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#7fdb6a'; ctx.fillRect(x, y, clamp((this.hp/this.hpMax),0,1)*w, h);
    }
  };
}

// -------------------- Projectiles --------------------
function createProjectile(targetId){ return { x: core.x(), y: core.y(), speed: 380, targetId, alive: true }; }
function pickTarget(){
  let best = null, bestDist = Infinity;
  for (const e of enemies) {
    const p = e.pos; const d = dist(core.x(), core.y(), p.x, p.y);
    if (d <= core.range && d < bestDist) { best = e; bestDist = d; }
  }
  return best;
}

// -------------------- Spawner (loop-driven) --------------------
const spawners = []; // each: { type, remaining, cadence, timer }

function spawnBatch(type, count, cadenceSec){
  if (S.defeated) return;
  spawners.push({ type, remaining: count, cadence: cadenceSec, timer: 0 }); // spawn first immediately
}

// -------------------- Loop --------------------
let last = performance.now();
function loop(now){
  let dt = Math.min((now - last)/1000, 0.05);
  last = now;

  // Apply pause / speed
  if (S.paused) dt = 0;
  else dt *= Math.max(1, S.timeScale);

  update(dt);
  draw();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

function update(dt){
  // enemy updates
  for (const e of enemies) e.update(dt);

  // core fire
  if (!S.defeated) {
    core._fireTimer -= dt;
    if (core._fireTimer <= 0) {
      const target = pickTarget();
      if (target) { projectiles.push(createProjectile(target.id)); core._fireTimer = 1 / core.fireRate; }
    }
  }

  // spawn tick
  for (let i = spawners.length - 1; i >= 0; i--) {
    const s = spawners[i];
    s.timer -= dt;
    while (s.timer <= 0 && s.remaining > 0) {
      enemies.push(createEnemy(s.type, S.wave));
      s.remaining--;
      s.timer += s.cadence;
    }
    if (s.remaining <= 0) spawners.splice(i, 1);
  }

  // projectiles
  for (const p of projectiles) {
    if (!p.alive) continue;
    const t = enemies.find(e => e.id === p.targetId);
    if (!t) { p.alive = false; continue; }
    const tp = t.pos, d = dist(p.x, p.y, tp.x, tp.y);
    if (d < 12) {
      applyDamage(t, core.damage);       // <— use helper to spawn yellow number
      p.alive = false;
    } else {
      const dx = (tp.x - p.x) / d, dy = (tp.y - p.y) / d;
      p.x += dx * p.speed * dt; p.y += dy * p.speed * dt;
    }
  }
  for (let i=projectiles.length-1; i>=0; i--) if (!projectiles[i].alive) projectiles.splice(i,1);

  // abilities / effects
  if (nova.cdLeft  > 0) nova.cdLeft  = Math.max(0, nova.cdLeft  - dt);
  if (frost.cdLeft > 0) frost.cdLeft = Math.max(0, frost.cdLeft - dt);
  for (let i=effects.length-1; i>=0; i--) { const keep = effects[i].draw?.(dt); if (!keep) effects.splice(i,1); }

  // deaths / gold
  for (let i=enemies.length-1; i>=0; i--) {
    const e = enemies[i];
    if (e.hp <= 0) { S.gold = S.gold + e.goldOnDeath; enemies.splice(i,1); }
  }

  // defeat
  if (!S.defeated && core.hp <= 0) {
    S.defeated = true;
    S.waveRunning = false;
    spawners.length = 0;                  // stop any future spawns
    setWaveStatus('Defeated ❌  (Press Reset)');
  }

  // wave end
  if (!S.defeated && S.waveRunning && spawners.length === 0 && enemies.length === 0){
    S.waveRunning = false;
    setWaveStatus('Cleared ✅');
    if (S.autoStart) startWave();
  }

  // push snapshot to Vue
  notifySubscribers(buildSnapshot());
}

function draw(){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  core.draw();
  frost.drawOverlay();
  for (const e of enemies) e.draw();

  // boss HP bar (if any boss alive)
  const boss = enemies.find(e => e.boss);
  if (boss) {
    const frac = clamp(boss.hp / boss.hpMax, 0, 1);
    const w = canvas.width * 0.6, h = 10;
    const x = (canvas.width - w)/2, y = 18;
    ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#e66'; ctx.fillRect(x, y, w*frac, h);
    ctx.fillStyle = '#fff'; ctx.font='12px system-ui,sans-serif';
    ctx.textAlign = 'center'; ctx.fillText('BOSS', canvas.width/2, y - 2);
  }

  // projectiles
  ctx.fillStyle = '#fff';
  for (const p of projectiles) { ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI*2); ctx.fill(); }

  // HUD
  ctx.fillStyle='#9fb'; ctx.font='14px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`Enemies: ${enemies.length}`, 12, 20);
  ctx.fillText(`Wave: ${S.wave}`, 12, 38);
}

// -------------------- Game actions (used by Vue) --------------------
function startWave() {
  if (S.waveRunning || S.defeated) return;
  S.wave += 1;
  S.waveRunning = true;
  const baseCadence = Math.max(0.25, 0.55 - S.wave * 0.02);
  const packs = waveRecipe(S.wave);
  if (packs.some(p => p.boss)) setWaveStatus('Boss!'); else setWaveStatus('Running…');
  for (const p of packs) spawnBatch(p.type, p.count, baseCadence * (p.cadenceMul || 1));
}

function resetGame() {
  enemies.length = 0; projectiles.length = 0; effects.length = 0;
  frost.zones.length = 0; nova.cdLeft = 0; frost.cdLeft = 0;
  spawners.length = 0;                               // clear queued spawns
  S.wave = 0; S.waveRunning = false; S.defeated = false;
  core.hp = core.hpMax;
  S.gold = 0;
  upgrades.dmg = upgrades.rof = upgrades.range = 0;
  core.applyUpgrades();
  setWaveStatus('No wave');
  saveGame();
  notifySubscribers(buildSnapshot());
}

function buyUpgrade(type) {
  const c = cost(type);
  if (S.gold < c) return;
  S.gold = S.gold - c;
  upgrades[type]++; core.applyUpgrades();
  saveGame();
  notifySubscribers(buildSnapshot());
}

function castAbility(which) {
  if (which === 'nova'  && nova.cast())  { saveGame(); notifySubscribers(buildSnapshot()); }
  if (which === 'frost' && frost.cast()) { saveGame(); notifySubscribers(buildSnapshot()); }
}

// Keybindings
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'q') castAbility('nova');
  if (k === 'w') castAbility('frost');
});

// -------------------- Engine API (for Vue) --------------------
window.engine = {
  getSnapshot: buildSnapshot,
  subscribe, // from state.js
  actions: {
    startWave,
    reset: resetGame,
    buy: buyUpgrade,
    cast: castAbility,
    loadSave: loadGame,
    wipeSave: wipeSave,
    saveNow: saveGame,
    hasSave: hasSave,
    setPaused: (v) => { S.paused = !!v; },
    setSpeed: (n) => { S.timeScale = Math.max(1, n|0); },
    setAutoStart: (v) => { S.autoStart = !!v; },
  }
};

// initial
if (!loadGame()){
  setWaveStatus('No wave');
  notifySubscribers(buildSnapshot());
}
