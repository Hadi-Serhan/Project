import {
  canvas, ctx, cx, cy, dist, clamp,
  core, enemies, projectiles, effects,
  // note: imported 'gold' is read-only here; we'll keep a local _gold
  upgrades, cost,
  activeSpawners, wave, waveRunning, defeated,
  setDefeated, ui, setWaveStatus, refreshEconomyUI
} from './state.js';

import { ENEMY_TYPES, waveRecipe } from './content.js';
import { nova, frost } from './abilities.js';

// -------------------- Local (mutable) run-state --------------------
let _gold = 0;           // separate from exported 'gold' to avoid write errors
let _wave = wave;
let _waveRunning = waveRunning;
let _defeated = defeated;

// single place to refresh the DOM bits that depend on _gold / costs / wave
function writeBackState() {
  ui.waveNumEl.textContent = _wave;

  // we still use refreshEconomyUI for enemy count & core HP,
  // but then we overwrite gold/cost/disabled states from our local values:
  refreshEconomyUI();
  ui.goldAmtEl.textContent = _gold;
  ui.buyDmgBtn.disabled   = _gold < cost('dmg');
  ui.buyRofBtn.disabled   = _gold < cost('rof');
  ui.buyRangeBtn.disabled = _gold < cost('range');
  ui.costDmgEl.textContent   = cost('dmg');
  ui.costRofEl.textContent   = cost('rof');
  ui.costRangeEl.textContent = cost('range');
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
    type,
    angle, dist: spawnR,
    speed: tpl.speed,
    radius: tpl.radius,
    color: tpl.color,
    hpMax, hp: hpMax,
    state: 'advancing',
    coreDamage: tpl.coreDamage,
    attackPeriod: tpl.attackPeriod,
    attackTimer: 0,
    goldOnDeath,
    boss: !!tpl.boss,
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
      // shadow
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath(); ctx.ellipse(p.x+2, p.y+6, this.radius*0.9, this.radius*0.5, 0, 0, Math.PI*2); ctx.fill();
      // link
      if (this.state === 'attacking') {
        ctx.strokeStyle = 'rgba(255,120,80,0.6)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(core.x(), core.y()); ctx.stroke();
      }
      // body
      ctx.fillStyle = this.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, this.radius, 0, Math.PI*2); ctx.fill();
      // hp bar
      const w = this.boss ? 36 : 20, h = 4, x = p.x - w/2, y = p.y - this.radius - 10;
      ctx.fillStyle = '#333'; ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#7fdb6a'; ctx.fillRect(x, y, clamp((this.hp/this.hpMax),0,1)*w, h);
    }
  };
}

// -------------------- Projectiles --------------------
function createProjectile(targetId){
  return { x: core.x(), y: core.y(), speed: 380, targetId, alive: true };
}

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
  if (_defeated) return;
  const key = `batch-${type}-${performance.now()}`;
  activeSpawners.add(key);
  let spawned = 0;
  const timer = setInterval(() => {
    if (_defeated) { clearInterval(timer); activeSpawners.delete(key); return; }
    enemies.push(createEnemy(type, _wave));
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
  // enemies
  for (const e of enemies) e.update(dt);

  // core fire
  if (!_defeated) {
    core._fireTimer -= dt;
    if (core._fireTimer <= 0) {
      const target = pickTarget();
      if (target) { projectiles.push(createProjectile(target.id)); core._fireTimer = 1 / core.fireRate; }
    }
  }

  // projectiles
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

  // ability cooldowns + effects
  if (nova.cdLeft  > 0) nova.cdLeft  = Math.max(0, nova.cdLeft  - dt);
  if (frost.cdLeft > 0) frost.cdLeft = Math.max(0, frost.cdLeft - dt);
  for (let i=effects.length-1; i>=0; i--) { const keep = effects[i].draw?.(dt); if (!keep) effects.splice(i,1); }

  // deaths / gold
  for (let i=enemies.length-1; i>=0; i--) {
    const e = enemies[i];
    if (e.hp <= 0) { _gold += e.goldOnDeath; enemies.splice(i,1); }
  }

  // defeat
  if (!_defeated && core.hp <= 0) {
    setDefeated();
    _defeated = true;
    setWaveStatus('Defeated ❌  (Press Reset)');
  }

  // wave end
  if (!_defeated && _waveRunning && activeSpawners.size === 0 && enemies.length === 0){
    _waveRunning = false; setWaveStatus('Cleared ✅');
  }

  // UI & ability CDs
  ui.novaCDEl.textContent  = nova.cdLeft  > 0 ? nova.cdLeft.toFixed(1)+'s'  : 'ready';
  ui.castNovaBtn.disabled  = nova.cdLeft  > 0;
  ui.frostCDEl.textContent = frost.cdLeft > 0 ? frost.cdLeft.toFixed(1)+'s' : 'ready';
  ui.castFrostBtn.disabled = frost.cdLeft > 0;

  writeBackState();   // <- ensure gold/costs/labels reflect local state
  notifyUI();         // <- push a snapshot to any Vue subscribers
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
  ctx.fillText(`Wave: ${_wave}`, 12, 38);
}

// -------------------- UI wiring --------------------
ui.spawnLeftBtn.addEventListener('click', () => enemies.push(createEnemy('grunt', Math.max(1, _wave))));
ui.spawnRightBtn.addEventListener('click', () => enemies.push(createEnemy('grunt', Math.max(1, _wave))));

ui.startWaveBtn.addEventListener('click', () => {
  if (_waveRunning || _defeated) return;
  _wave++; writeBackState();
  _waveRunning = true;
  const baseCadence = Math.max(0.25, 0.55 - _wave * 0.02);
  const packs = waveRecipe(_wave);
  if (packs.some(p => p.boss)) setWaveStatus('Boss!'); else setWaveStatus('Running…');
  for (const p of packs) spawnBatch(p.type, p.count, baseCadence * (p.cadenceMul || 1));
});

ui.resetBtn.addEventListener('click', () => {
  enemies.length = 0; projectiles.length = 0; effects.length = 0;
  frost.zones.length = 0; nova.cdLeft = 0; frost.cdLeft = 0;
  _wave = 0; _waveRunning = false; _defeated = false;
  core.hp = core.hpMax;
  _gold = 0;
  upgrades.dmg = upgrades.rof = upgrades.range = 0;
  core.applyUpgrades();
  setWaveStatus('No wave');
  writeBackState();
});

ui.buyDmgBtn.addEventListener('click', () => { const c = cost('dmg'); if (_gold < c) return; _gold -= c; upgrades.dmg++; core.applyUpgrades(); writeBackState(); });
ui.buyRofBtn.addEventListener('click', () => { const c = cost('rof'); if (_gold < c) return; _gold -= c; upgrades.rof++; core.applyUpgrades(); writeBackState(); });
ui.buyRangeBtn.addEventListener('click', () => { const c = cost('range'); if (_gold < c) return; _gold -= c; upgrades.range++; core.applyUpgrades(); writeBackState(); });

ui.castNovaBtn.addEventListener('click', () => { if (nova.cast()) updateNovaUI(); });
ui.castFrostBtn.addEventListener('click', () => { if (frost.cast()) updateFrostUI(); });
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'q') { if (nova.cast()) updateNovaUI(); }
  if (k === 'w') { if (frost.cast()) updateFrostUI(); }
});

function updateNovaUI(){
  ui.novaCDEl.textContent = nova.cdLeft > 0 ? nova.cdLeft.toFixed(1)+'s' : 'ready';
  ui.castNovaBtn.disabled = nova.cdLeft > 0;
}
function updateFrostUI(){
  ui.frostCDEl.textContent = frost.cdLeft > 0 ? frost.cdLeft.toFixed(1)+'s' : 'ready';
  ui.castFrostBtn.disabled = frost.cdLeft > 0;
}

// -------------------- Engine API for Vue --------------------
function getSnapshot() {
  return {
    wave: _wave,
    waveRunning: _waveRunning,
    defeated: _defeated,
    coreHP: core.hp,
    gold: _gold,
    costs: { dmg: cost('dmg'), rof: cost('rof'), range: cost('range') },
    cd: { nova: nova.cdLeft, frost: frost.cdLeft },
    waveStatus: ui.waveStatusEl.textContent || 'No wave',
  };
}
function startWaveAction() { ui.startWaveBtn.click(); }
function resetAction()     { ui.resetBtn.click(); }
function buyAction(line) {
  if (line === 'dmg') ui.buyDmgBtn.click();
  else if (line === 'rof') ui.buyRofBtn.click();
  else if (line === 'range') ui.buyRangeBtn.click();
}
function castAction(which) {
  if (which === 'nova')  { if (nova.cast()) updateNovaUI(); }
  if (which === 'frost') { if (frost.cast()) updateFrostUI(); }
}

// simple pub/sub so Vue can get live ticks
window.engine = {
  getSnapshot,
  actions: { startWave: startWaveAction, reset: resetAction, buy: buyAction, cast: castAction },
  _subs: [],
  subscribe(fn) { this._subs.push(fn); return () => { this._subs = this._subs.filter(f => f !== fn); }; },
};
function notifyUI() {
  const snap = getSnapshot();
  for (const fn of window.engine._subs) fn(snap);
}

// initial
setWaveStatus('No wave');
writeBackState();
