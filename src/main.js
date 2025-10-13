import {
  canvas, ctx, cx, cy, dist, clamp,
  core, enemies, projectiles, effects,
  upgrades, cost,
  activeSpawners,
  // state vars
  gold, wave, waveRunning, defeated, waveStatus,
  // setters
  setGold, setWave, setWaveRunning, setDefeatedFlag, setWaveStatus,
  // pub/sub
  subscribe, notifySubscribers
} from './state.js';

import { ENEMY_TYPES, waveRecipe } from './content.js';
import { nova, frost } from './abilities.js';

// -------------------- Local "view" of state (mirrors state.js) --------------------
const S = {
  get gold()         { return gold; },
  set gold(v)        { setGold(v); },
  get wave()         { return wave; },
  set wave(v)        { setWave(v); },
  get waveRunning()  { return waveRunning; },
  set waveRunning(v) { setWaveRunning(v); },
  get defeated()     { return defeated; },
  set defeated(v)    { setDefeatedFlag(v); },
  get waveStatus()   { return waveStatus; },
  set waveStatus(t)  { setWaveStatus(t); },
};

// -------------------- Save / Load (define BEFORE buildSnapshot) --------------------
const SAVE_KEY = 'mage-core:v1';

function serialize() {
  return {
    wave: S.wave,
    waveRunning: false,     // never resume mid-wave
    defeated: false,        // never resume defeated
    gold: S.gold,
    coreHP: core.hp,
    upgrades: { ...upgrades },
    novaCD: nova.cdLeft,
    frostCD: frost.cdLeft,
    savedAt: Date.now(),
  };
}
function hasSave() {
  try { return !!localStorage.getItem(SAVE_KEY); } catch { return false; }
}
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
  activeSpawners.clear();

  setWaveStatus('Loaded ✅');
  notifySubscribers(buildSnapshot());
}
function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const snap = JSON.parse(raw);
    applySnapshot(snap);
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
  };
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

// -------------------- Spawner --------------------
function spawnBatch(type, count, cadenceSec){
  if (S.defeated) return;
  const key = `batch-${type}-${performance.now()}`;
  activeSpawners.add(key);
  let spawned = 0;
  const timer = setInterval(() => {
    if (S.defeated) { clearInterval(timer); activeSpawners.delete(key); return; }
    enemies.push(createEnemy(type, S.wave));
    if (++spawned >= count){ clearInterval(timer); activeSpawners.delete(key); }
  }, cadenceSec*1000);
}

// -------------------- Loop --------------------
let last = performance.now();
function loop(now){
  const dt = Math.min((now - last)/1000, 0.05); last = now;
  update(dt); draw(); requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

function update(dt){
  for (const e of enemies) e.update(dt);

  if (!S.defeated) {
    core._fireTimer -= dt;
    if (core._fireTimer <= 0) {
      const target = pickTarget();
      if (target) { projectiles.push(createProjectile(target.id)); core._fireTimer = 1 / core.fireRate; }
    }
  }

  for (const p of projectiles) {
    if (!p.alive) continue;
    const t = enemies.find(e => e.id === p.targetId);
    if (!t) { p.alive = false; continue; }
    const tp = t.pos, d = dist(p.x, p.y, tp.x, tp.y);
    if (d < 12) { t.hp -= core.damage; p.alive = false; }
    else {
      const dx = (tp.x - p.x) / d, dy = (tp.y - p.y) / d;
      p.x += dx * p.speed * dt; p.y += dy * p.speed * dt;
    }
  }
  for (let i=projectiles.length-1; i>=0; i--) if (!projectiles[i].alive) projectiles.splice(i,1);

  if (nova.cdLeft  > 0) nova.cdLeft  = Math.max(0, nova.cdLeft  - dt);
  if (frost.cdLeft > 0) frost.cdLeft = Math.max(0, frost.cdLeft - dt);
  for (let i=effects.length-1; i>=0; i--) { const keep = effects[i].draw?.(dt); if (!keep) effects.splice(i,1); }

  for (let i=enemies.length-1; i>=0; i--) {
    const e = enemies[i];
    if (e.hp <= 0) { S.gold = S.gold + e.goldOnDeath; enemies.splice(i,1); }
  }

  if (!S.defeated && core.hp <= 0) {
    S.defeated = true;
    S.waveRunning = false;
    activeSpawners.clear();
    setWaveStatus('Defeated ❌  (Press Reset)');
  }

  if (!S.defeated && S.waveRunning && activeSpawners.size === 0 && enemies.length === 0){
    S.waveRunning = false; setWaveStatus('Cleared ✅');
  }

  // Push snapshot to Vue
  notifySubscribers(buildSnapshot());
}

function draw(){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  core.draw();
  frost.drawOverlay();
  for (const e of enemies) e.draw();
  ctx.fillStyle = '#fff';
  for (const p of projectiles) { ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI*2); ctx.fill(); }
  ctx.fillStyle='#9fb'; ctx.font='14px system-ui, sans-serif';
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
  }
};

// initial
if (!loadGame()){
  setWaveStatus('No wave');
  notifySubscribers(buildSnapshot());
}
