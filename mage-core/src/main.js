import {
  canvas, ctx, cx, cy, dist, clamp,
  core, enemies, projectiles, effects, upgrades,
  gold, prestige, wave, waveRunning, defeated, waveStatus,
  setGold, setWave, setWaveRunning, setDefeatedFlag, setWaveStatus, setPrestige,
  subscribe, notifySubscribers,
  paused, timeScale, autoStart, setPaused, setTimeScale, setAutoStart
} from './state.js';

import Engine from './engine.js';
import { ENEMY_TYPES, waveRecipe } from './content.js';
import { getImage, getFrames } from './assets.js';

// import UI hooks only (no DOM here)
import {
  initMenuUI,
  ensureHudMenuButton,
  removeHudMenuButton,
  openPauseMenu,
  showDefeatMenu
} from './ui/overlay.js';

// Expose live game state to Engine
Engine.setStateAccessor(() => ({ core, enemies, effects, projectiles }));

// Local view for reactive state setters
const S = {
  get gold()         { return gold; }, set gold(v) { setGold(v); },
  get prestige()     { return prestige; }, set prestige(v) { setPrestige(v); },
  get wave()         { return wave; }, set wave(v) { setWave(v); },
  get waveRunning()  { return waveRunning; }, set waveRunning(v) { setWaveRunning(v); },
  get defeated()     { return defeated; }, set defeated(v) { setDefeatedFlag(v); },
  get waveStatus()   { return waveStatus; }, set waveStatus(t) { setWaveStatus(t); },
  get paused()       { return paused; }, set paused(v) { setPaused(v); },
  get timeScale()    { return timeScale; }, set timeScale(v) { setTimeScale(v); },
  get autoStart()    { return autoStart; }, set autoStart(v) { setAutoStart(v); }
};

// ---- sprite frame totals ----
const NECRO_WALK_LAST=22, NECRO_ATTACK_LAST=11, SKELE_RUN_LAST=11, SKELE_ATTACK_LAST=11,
      GOLEM_WALK_LAST=23, GOLEM_ATTACK_LAST=11, TROLL_WALK_LAST=9, TROLL_ATTACK_LAST=9,
      BALL_EXP_LAST=5, PROJECTILE_SIZE=40;

// ---- assets ----
const DEFAULT_ASSETS = {
  troll_walk:   { seq: { base: 'assets/troll/Walking/Troll_03_1_WALK_',    start: 0, end: TROLL_WALK_LAST,   pad: 3, ext: '.png' } },
  troll_attack: { seq: { base: 'assets/troll/Slashing/Troll_03_1_ATTACK_', start: 0, end: TROLL_ATTACK_LAST, pad: 3, ext: '.png' } },
  golem_walk:   { seq: { base: 'assets/golem/Walking/0_Golem_Walking_',    start: 0, end: GOLEM_WALK_LAST,   pad: 3, ext: '.png' } },
  golem_attack: { seq: { base: 'assets/golem/Slashing/0_Golem_Slashing_',  start: 0, end: GOLEM_ATTACK_LAST, pad: 3, ext: '.png' } },
  skeleton_run:    { seq: { base: 'assets/skeleton/Running/0_Skeleton_Crusader_Running_',   start: 0, end: SKELE_RUN_LAST,    pad: 3, ext: '.png' } },
  skeleton_attack: { seq: { base: 'assets/skeleton/Slashing/0_Skeleton_Crusader_Slashing_', start: 0, end: SKELE_ATTACK_LAST, pad: 3, ext: '.png' } },
  necro_walk:   { seq: { base: 'assets/necromancer/Walking/0_Necromancer_of_the_Shadow_Walking_',   start: 0, end: NECRO_WALK_LAST,   pad: 3, ext: '.png' } },
  necro_attack: { seq: { base: 'assets/necromancer/Slashing/0_Necromancer_of_the_Shadow_Slashing_', start: 0, end: NECRO_ATTACK_LAST, pad: 3, ext: '.png' } },
  ball_idle:    'assets/projectiles/1.png',
  ball_explode: { seq: { base: 'assets/projectiles/', start: 2, end: BALL_EXP_LAST, pad: 0, ext: '.png' } },
  core_top:  'assets/core/1.png',
  core_mid:  'assets/core/2.png',
  core_base: 'assets/core/3.png',
  ball_down: 'assets/projectiles/reversed.png',
  map: 'assets/maps/default_map.png'
};

// ---- default anim profiles ----
const DEFAULT_ANIM = {
  grunt:  { walk: 'necro_walk',    attack: 'necro_attack',    fpsWalk: 10, fpsAtk: 12, size: 56, face: 'right' },
  runner: { walk: 'skeleton_run',  attack: 'skeleton_attack', fpsWalk: 12, fpsAtk: 12, size: 52, face: 'right' },
  tank:   { walk: 'golem_walk',    attack: 'golem_attack',    fpsWalk: 8,  fpsAtk: 10, size: 64, face: 'right' },
  boss:   { walk: 'troll_walk',    attack: 'troll_attack',    fpsWalk: 8,  fpsAtk: 10, size: 84, face: 'right' }
};

// ---- enemy type registration ----
for (const [id, def] of Object.entries(ENEMY_TYPES)) {
  def.id = id;
  Engine.registerEnemyType(id, def);
}
Engine.setGoldSink((amt) => { S.gold = Math.max(0, (S.gold|0) + (amt|0)); });
Engine.setCoreMutator((fn) => { fn(core); });

// -------------------- Save / Load --------------------
const SAVE_KEY = 'mage-core:v1';
function serialize() {
  return {
    wave: S.wave, waveRunning: false, defeated: false,
    gold: S.gold, prestige: S.prestige, coreHP: core.hp, upgrades: { ...upgrades },
    perm: Engine.serializePerm(),
    savedAt: Date.now(), timeScale: S.timeScale, autoStart: S.autoStart,
    mods: [],
  };
}
function hasSave() { try { return !!localStorage.getItem(SAVE_KEY); } catch { return false; } }
function saveGame() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(serialize()));
    setWaveStatus('Game saved 💾'); setTimeout(() => setWaveStatus('Running…'), 800);
    notifySubscribers(buildSnapshot());
  } catch {}
}
function applySnapshot(snap) {
  S.wave = snap.wave ?? 0; S.waveRunning = false; S.defeated = false;
  S.gold = snap.gold ?? 0; S.prestige = snap.prestige ?? 0;
  S.timeScale = snap.timeScale ?? 1; S.autoStart = !!(snap.autoStart ?? false);
  core.hp = Math.min(core.hpMax, snap.coreHP ?? core.hpMax);

  upgrades.dmg   = snap.upgrades?.dmg   ?? 0;
  upgrades.rof   = snap.upgrades?.rof   ?? 0;
  upgrades.range = snap.upgrades?.range ?? 0;
  core.applyUpgrades();

  Engine.setPermLevels(snap.perm || {});
  Engine.applyPermToCore(core);

  enemies.length = 0; projectiles.length = 0; effects.length = 0; spawners.length = 0;

  setWaveStatus('Loaded ✅'); notifySubscribers(buildSnapshot());
}
function loadGame() {
  try { const raw = localStorage.getItem(SAVE_KEY); if (!raw) return false; applySnapshot(JSON.parse(raw)); return true; }
  catch { return false; }
}
function wipeSave() { try { localStorage.removeItem(SAVE_KEY); } catch {} setWaveStatus('Save wiped 🗑️'); notifySubscribers(buildSnapshot()); }
setInterval(saveGame, 5000);

// -------------------- Snapshot helpers --------------------
function snapshotAbilities() {
  const out = [];
  const reg = Engine.registry?.abilities || {};
  for (const [id, a] of Object.entries(reg)) {
    const lvl = (Engine.getAbilityPermLevel?.(id) || 0)|0;
    out.push({
      id, title: a.title || id, hint: a.hint || '',
      enabled: a.enabled !== false,
      cd: Number.isFinite(a.cd) ? a.cd : 0,
      cdLeft: Number.isFinite(a.cdLeft) ? a.cdLeft : 0,
      permLevel: lvl,
      permPrice: 5 + Math.floor(Math.pow(1.35, lvl)),
    });
  }
  out.sort((x,y) => (x.title||'').localeCompare(y.title||'') || x.id.localeCompare(y.id));
  return out;
}
function snapshotPermanent() {
  const rows = [];
  for (const [id, def] of Object.entries(Engine.registry?.upgrades || {})) {
    const lvl = (Engine.getPermLevels()[id] | 0);
    const title = def.title || id;
    const price = 5 + Math.floor(Math.pow(1.35, lvl));
    rows.push({ id: `upgrade:${id}`, title, level: lvl, price, kind: 'upgrade' });
  }
  for (const [id, ab] of Object.entries(Engine.registry?.abilities || {})) {
    const lvl = (Engine.getAbilityPermLevel?.(id) || 0);
    const title = ab.title || id;
    const price = 5 + Math.floor(Math.pow(1.35, lvl));
    rows.push({ id: `ability:${id}`, title, level: lvl, price, kind: 'ability' });
  }
  rows.sort((a,b)=> a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  return rows;
}
function buildSnapshot(){
  let lastSaved = null;
  try { const raw = localStorage.getItem(SAVE_KEY); if (raw) lastSaved = (JSON.parse(raw).savedAt) || null; } catch {}
  return {
    wave: S.wave, waveRunning: S.waveRunning, defeated: S.defeated,
    coreHP: core.hp, gold: S.gold, prestige: S.prestige,
    abilities: snapshotAbilities(),
    permanent: snapshotPermanent(),
    waveStatus: S.waveStatus, hasSave: hasSave(), lastSaved,
    paused: S.paused, timeScale: S.timeScale, autoStart: S.autoStart,
  };
}

// -------------------- FX helpers --------------------
function makeFloatText(x, y, text, color = '#ffd166') {
  return {
    t: 0, dur: 0.8, x, y, vy: -36,
    draw(dt) {
      this.t += dt;
      const k = clamp(this.t / this.dur, 0, 1);
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
function applyDamage(target, dmg) {
  target.hp -= dmg;
  const p = target.pos;
  effects.push(makeFloatText(p.x, p.y - target.radius - 12, Math.ceil(dmg).toString(), '#ffd166'));
}
function coreTookDamage(amount) {
  effects.push(makeFloatText(core.x(), core.y() - 28, `-${amount}`, '#ff6b6b'));
}

// -------------------- Sprite helpers --------------------
function drawSprite(img, x, y, size, flipX = false) {
  const half = size / 2;
  ctx.save(); ctx.translate(x, y); if (flipX) ctx.scale(-1, 1);
  ctx.imageSmoothingEnabled = true; ctx.drawImage(img, -half, -half, size, size);
  ctx.restore();
}
function makeAnim(key, fps = 8, loop = true) {
  const frames = getFrames(key) || (getImage(key) ? [getImage(key)] : null);
  return {
    key, frames, fps, loop, t: 0, idx: 0,
    update(dt) {
      if (!this.frames || this.frames.length === 0) return;
      this.t += dt;
      const adv = Math.floor(this.t * this.fps);
      if (adv > 0) {
        this.t -= adv / this.fps;
        this.idx = this.loop ? (this.idx + adv) % this.frames.length
                             : Math.min(this.idx + adv, this.frames.length - 1);
      }
    },
    frame() { return (this.frames && this.frames.length) ? this.frames[this.idx] : null; },
    reset() { this.t = 0; this.idx = 0; }
  };
}
function drawSpriteFitW(img, x, y, targetW, flipX = false) {
  if (!img) return;
  const iw = img.width || 1, ih = img.height || 1;
  const w = targetW, h = w * (ih / iw), hx = w / 2, hy = h / 2;
  ctx.save(); ctx.translate(x, y); if (flipX) ctx.scale(-1, 1);
  ctx.imageSmoothingEnabled = true; ctx.drawImage(img, -hx, -hy, w, h); ctx.restore();
}

// -------------------- Damage reservation helpers --------------------
function effHP(e){ return (e.hp|0) - ((e.incomingDamage|0) || 0); }
function reserveDamage(enemy, amount){
  if (!enemy) return 0;
  const amt = Math.max(0, amount|0);
  enemy.incomingDamage = (enemy.incomingDamage|0) + amt;
  return amt;
}
function releaseReservation(enemyId, amount){
  if (!enemyId || !Number.isFinite(amount)) return;
  const e = enemies.find(x => x.id === enemyId);
  if (!e) return;
  e.incomingDamage = Math.max(0, (e.incomingDamage|0) - (amount|0));
}

// -------------------- Core art / projectile creation --------------------
const coreArt = {
  t: 0, dur: 0.5, throwing: false,
  scale: 1.0, anchorY: 10,
  baseW: 120, midW: 122, topW: 118, ballW: 28,
  restBaseY: 10, restMidY: 10, restTopY: -5, restBallY: -10,
  liftMid: 30, liftTop: 34, liftBall: 200,
  launchFrac: 0.55,
  attached: null,

  startThrow(targetId) {
    this.throwing = true; this.t = 0;
    const bp = this.ballPos(0);

    const tgt = enemies.find(e => e.id === targetId);
    const expected = Math.round(core.damage);
    const reserved = reserveDamage(tgt, expected);

    const p = {
      state: 'attached', alive: true, targetId,
      size: PROJECTILE_SIZE, x: bp.x, y: bp.y,
      attachT: this.dur * this.launchFrac,
      t: 0, ttl: 0, startX: 0, startY: 0, arcH: 0,
      hitApplied: false,
      explode: makeAnim('ball_explode', 18, false),
      prevX: bp.x, prevY: bp.y,
      descending: false,
      reserved,
    };
    this.attached = p;
    projectiles.push(p);
  },

  update(dt) {
    if (!this.throwing) return;
    this.t += dt;
    if (this.t >= this.dur) { this.throwing = false; this.t = 0; }
  },

  ballPos(kOverride = null) {
    const x = core.x();
    const y0 = core.y() + this.anchorY;
    const k = (kOverride !== null) ? kOverride : (this.throwing ? Math.sin((this.t / this.dur) * Math.PI) : 0);
    return { x, y: y0 + this.restBallY - this.liftBall * k };
  },

  draw() {
    const x  = core.x();
    const y0 = core.y() + this.anchorY;
    const k  = this.throwing ? Math.sin((this.t / this.dur) * Math.PI) : 0;

    const imgBase = getImage('core_base');
    const imgMid  = getImage('core_mid');
    const imgTop  = getImage('core_top');

    if (imgBase) drawSpriteFitW(imgBase, x, y0 + this.restBaseY, this.baseW * this.scale);
    if (imgMid)  drawSpriteFitW(imgMid,  x, y0 + this.restMidY  - this.liftMid  * k, this.midW  * this.scale);
    if (imgTop)  drawSpriteFitW(imgTop,  x, y0 + this.restTopY  - this.liftTop  * k, this.topW  * this.scale);

    const showDecorBall = !this.throwing && (!this.attached || this.attached.state !== 'attached');
    if (showDecorBall) {
      const ballImg = getImage('ball_idle');
      if (ballImg) drawSprite(ballImg, this.ballPos(0).x, this.ballPos(0).y, PROJECTILE_SIZE);
    }
  }
};

function setCoreRadiusFromArt(mult = 0.98) {
  const visualRadius = (coreArt.baseW * (coreArt.scale || 1)) * 0.5;
  core.radius = Math.round(visualRadius * mult);
}
setCoreRadiusFromArt();

// -------------------- Enemy factory --------------------
Engine.setEnemyFactory(function enemyFactory(def, waveNum = 1, overrides = {}) {
  const angle = Engine.rng() * Math.PI * 2;
  const spawnR = Math.min(canvas.width, canvas.height) * 0.45;
  const scale = 1 + waveNum * 0.18;
  const hpMax = Math.round((def.hp ?? 20) * scale);
  const goldOnDeath = Math.ceil((def.baseGold ?? 6) * (0.6 + waveNum * 0.2));

  const typeId = def.id || overrides.type || (def.boss ? 'boss' : 'enemy');

  const baseProfile = DEFAULT_ANIM[def.boss ? 'boss' : typeId] || {};
  const profile = (typeof Engine.resolveAnimProfile === 'function')
    ? Engine.resolveAnimProfile(typeId, !!def.boss, baseProfile, def.anim)
    : (def.anim ? { ...baseProfile, ...def.anim } : baseProfile);

  return {
    id: Math.random().toString(36).slice(2),
    type: typeId, angle, dist: spawnR, speed: def.speed, radius: def.radius, color: def.color,
    hpMax, hp: hpMax, state: 'advancing',
    coreDamage: def.coreDamage, attackPeriod: def.attackPeriod, attackTimer: 0,
    goldOnDeath, boss: !!def.boss,
    anim: (profile && getFrames(profile.walk)) ? makeAnim(profile.walk, profile.fpsWalk ?? 8, true) : null,
    _switchedToAttack: false,

    incomingDamage: 0, // reservation tally

    ...overrides,

    get pos(){
      const dx = Math.cos(this.angle), dy = Math.sin(this.angle);
      return { x: cx() + dx * this.dist, y: cy() + dy * this.dist };
    },

    _switchToAttack(){
      if (this._switchedToAttack) return;
      if (profile && getFrames(profile.attack)) this.anim = makeAnim(profile.attack, profile.fpsAtk ?? 10, true);
      this._switchedToAttack = true;
    },

    update(dt){
      const p = this.pos;

      const mods = Engine.applyEnemyModifiers(this, dt, { now: performance.now()/1000, pos: p });
      const speedMul = mods.speedMul;
      const atkMul   = mods.atkMul;

      if (this.state === 'advancing') {
        this.dist = Math.max(0, this.dist - this.speed * speedMul * dt);
        if (this.dist <= core.radius) { this.state = 'attacking'; this.attackTimer = 0; this._switchedToAttack || this._switchToAttack(); }
      } else {
        this.attackTimer -= dt;
        if (this.attackTimer <= 0) {
          core.hp = Math.max(0, core.hp - this.coreDamage);
          coreTookDamage(this.coreDamage);
          Engine.emit('core:hit', { amount: this.coreDamage, by: this });
          this.attackTimer += this.attackPeriod * atkMul;
        }
      }

      if (this.anim) this.anim.update(dt);
    },

    draw(){
      const p = this.pos;

      // shadow
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath(); ctx.ellipse(p.x+2, p.y+6, this.radius*0.9, this.radius*0.5, 0, 0, Math.PI*2); ctx.fill();

      if (this.state === 'attacking') {
        ctx.strokeStyle = 'rgba(255,120,80,0.6)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(core.x(), core.y()); ctx.stroke();
      }

      const defaultFacesRight = (baseProfile?.face ?? 'right') === 'right';
      const coreIsRight = core.x() > p.x;
      const flipX = defaultFacesRight ? !coreIsRight : coreIsRight;

      const baseSize = baseProfile?.size ?? (this.boss ? 72 : 56);
      const bob  = (this.state === 'attacking') ? 0.5 : Math.sin(performance.now()/220 + this.id.length) * 1.5;

      let drew = false;
      if (this.anim) {
        const frame = this.anim.frame();
        if (frame) { drawSprite(frame, p.x, p.y + bob, baseSize, flipX); drew = true; }
      }
      if (!drew) { ctx.fillStyle = this.color; ctx.beginPath(); ctx.arc(p.x, p.y, this.radius, 0, Math.PI*2); ctx.fill(); }

      // HP bar with subtle incoming overlay (optional visual)
      const w = this.boss ? 36 : 20, h = 4, x = p.x - w/2, y = p.y - (this.boss ? 42 : 30);
      ctx.fillStyle = '#333'; ctx.fillRect(x, y, w, h);
      const frac = clamp(this.hp/this.hpMax,0,1);
      ctx.fillStyle = '#7fdb6a'; ctx.fillRect(x, y, frac*w, h);
      const incoming = clamp((this.incomingDamage||0)/this.hpMax, 0, 1);
      if (incoming > 0 && frac > 0) {
        const left = clamp(frac - incoming, 0, frac);
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fillRect(x + left*w, y, Math.min(incoming, frac)*w, h);
      }
    }
  };
});

// -------------------- Targeting --------------------
function pickTarget(){
  let best = null, bestDist = Infinity;
  for (const e of enemies) {
    const p = e.pos;
    const d = dist(core.x(), core.y(), p.x, p.y);
    if (d > core.range) continue;
    if (effHP(e) <= 0) continue; // covered by reservations
    if (d < bestDist) { best = e; bestDist = d; }
  }
  return best;
}

// -------------------- Spawner --------------------
const spawners = [];
function spawnBatch(type, count, cadenceSec){
  if (S.defeated) return;
  spawners.push({ type, remaining: count, cadence: cadenceSec, timer: 0 });
}

// -------------------- Loop --------------------
let last = performance.now();
let _lastDt = 0;
function loop(now){
  let dt = Math.min((now - last)/1000, 0.05);
  last = now;

  if (S.paused) { _lastDt = 0; draw(); requestAnimationFrame(loop); return; }

  dt *= Math.max(1, S.timeScale);
  _lastDt = dt;
  coreArt.update(dt);

  update(dt); draw(); requestAnimationFrame(loop);
}

// Boot
(async () => {
  try {
    Engine.emit('bootstrap:beforeAssets');
    await Engine.setAssets?.(DEFAULT_ASSETS);
    Engine.emit('bootstrap:afterAssets');
  } catch (e) {
    console.warn('Asset load failed:', e);
  }
  setCoreRadiusFromArt();

  // show pre-game screen (paused) via UI module
  S.paused = true;
  initMenuUI({
    onPlay: () => {
      S.paused = false;
      if (!buildSnapshot().waveRunning) startWave();
      ensureHudMenuButton(() => openPauseMenu({
        onResume: () => { S.paused = false; },
        onSurrender: () => { surrender(); }, // defeat flow handled in update()
        onMainMenu: () => {
          removeHudMenuButton();
          resetGame();
          S.paused = true;
          initMenuUI({
            onPlay: () => {
              S.paused = false;
              if (!buildSnapshot().waveRunning) startWave();
              ensureHudMenuButton(() => openPauseMenu({
                onResume: () => { S.paused = false; },
                onSurrender: () => { surrender(); },
                onMainMenu: () => {
                  removeHudMenuButton(); resetGame(); S.paused = true; initMenuUI({ onPlay: arguments.callee });
                }
              }));
            },
            onBuyPermanent: (id) => { buyPermanent(id); }
          });
        }
      }));
    },
    onBuyPermanent: (id) => { buyPermanent(id); }
  });

  requestAnimationFrame(loop);
})();

// -------------------- Update --------------------
function update(dt){
  for (const e of enemies) e.update(dt);

  if (!S.defeated) {
    core._fireTimer -= dt;
    if (core._fireTimer <= 0) {
      const target = pickTarget();
      if (target) {
        coreArt.startThrow(target.id);
        core._fireTimer = 1 / core.fireRate;
      } else {
        core._fireTimer = 0.05; // retry soon if no valid target
      }
    }
  }

  // spawners
  for (let i = spawners.length - 1; i >= 0; i--) {
    const s = spawners[i];
    s.timer -= dt;
    while (s.timer <= 0 && s.remaining > 0) {
      enemies.push(Engine.spawnEnemy(s.type, S.wave));
      s.remaining--; s.timer += s.cadence;
    }
    if (s.remaining <= 0) spawners.splice(i, 1);
  }

  // projectiles
  for (const p of projectiles) {
    if (!p.alive) continue;

    if (p.state === 'attached') {
      const bp = coreArt.ballPos();
      p.prevY = p.y; p.prevX = p.x;
      p.x = bp.x; p.y = bp.y;
      p.descending = false;
      p.attachT -= dt;

      if (p.attachT <= 0) {
        const tgt = enemies.find(e => e.id === p.targetId);
        if (!tgt) {
          releaseReservation(p.targetId, p.reserved||0);
          p.alive = false; continue;
        }
        const end = tgt.pos;
        p.state = 'arc';
        p.t = 0; p.startX = p.x; p.startY = p.y;
        const dist0 = Math.hypot(end.x - p.startX, end.y - p.startY);
        p.ttl = clamp(0.38 + dist0 / 800, 0.38, 0.75);
        p.arcH = 60 + dist0 * 0.25;

        if (coreArt.attached === p) coreArt.attached = null;
      }

    } else if (p.state === 'arc') {
      const tgt = enemies.find(e => e.id === p.targetId);
      if (!tgt) {
        releaseReservation(p.targetId, p.reserved||0);
        p.alive = false; continue;
      }

      const end = tgt.pos;
      const prevY = p.y;
      p.t += dt; const u = Math.min(1, p.t / p.ttl);

      const lx = p.startX + (end.x - p.startX) * u;
      const ly = p.startY + (end.y - p.startY) * u;

      const yDrop = p.arcH * (u * (1 - u));
      p.x = lx;
      p.y = ly + yDrop;

      p.descending = (p.y > prevY + 0.01);

      const hitR = (tgt.radius || 16) + 10;
      if (dist(p.x, p.y, end.x, end.y) <= hitR || u >= 1) {
        if (p.reserved) { releaseReservation(p.targetId, p.reserved); p.reserved = 0; }
        if (!p.hitApplied) { applyDamage(tgt, core.damage); p.hitApplied = true; }
        p.state = 'explode'; p.explode.reset();
      }

    } else { // explode
      p.explode.update(dt);
      const frames = p.explode.frames || [];
      if (p.explode.idx >= frames.length - 1) p.alive = false;
    }
  }
  for (let i = projectiles.length - 1; i >= 0; i--) if (!projectiles[i].alive) projectiles.splice(i, 1);

  // deaths / gold
  for (let i=enemies.length-1; i>=0; i--) {
    const e = enemies[i];
    if (e.hp <= 0) {
      const goldGain = Math.round(e.goldOnDeath * (core.goldMul || 1));
      Engine.addGold(goldGain);
      Engine.emit('enemy:death', { enemy: e, wave: S.wave });
      enemies.splice(i,1);
    }
  }

  // defeat → show defeat UI through overlay.js
  if (!S.defeated && core.hp <= 0) {
    S.defeated = true; S.waveRunning = false; spawners.length = 0;
    const add = Engine.calcPrestigeAward({ kind:'defeat', wave:S.wave })|0;
    if (add > 0) { S.prestige += add; setWaveStatus(`Defeated ❌ (+${add} ⚜)`); }
    else setWaveStatus('Defeated ❌');

    removeHudMenuButton();
    showDefeatMenu({
      wave: S.wave,
      prestige: add,
      onTryAgain: () => {
        resetGame();
        S.paused = false;
        startWave();
        ensureHudMenuButton(() => openPauseMenu({
          onResume: () => { S.paused = false; },
          onSurrender: () => { surrender(); },
          onMainMenu: () => { removeHudMenuButton(); resetGame(); S.paused = true; initMenuUI({ onPlay: startFromMenu, onBuyPermanent: buyPermanent }); }
        }));
      },
      onMainMenu: () => {
        resetGame();
        S.paused = true;
        initMenuUI({ onPlay: startFromMenu, onBuyPermanent: buyPermanent });
      }
    });
  }

  // wave end
  if (!S.defeated && S.waveRunning && spawners.length === 0 && enemies.length === 0){
    S.waveRunning = false; setWaveStatus('Cleared ✅');
    Engine.emit('wave:end', { wave: S.wave });
    if (S.autoStart) startWave();
  }

  notifySubscribers(buildSnapshot());
}

// -------------------- Draw --------------------
function draw(){
  ctx.clearRect(0,0,canvas.width,canvas.height);

  // background
  const mapImg = getImage('map');
  if (mapImg && mapImg.width && mapImg.height) {
    const w = mapImg.width, h = mapImg.height;
    const s = Math.max(canvas.width / w, canvas.height / h);
    const drawW = w * s, drawH = h * s;
    const dx = (canvas.width  - drawW) / 2;
    const dy = (canvas.height - drawH) / 2;
    ctx.drawImage(mapImg, dx, dy, drawW, drawH);
  }

  // core
  coreArt.draw();

  // overlays (engine-side)
  Engine.drawOverlays(ctx);

  // enemies
  for (const e of enemies) e.draw();

  // effects
  for (let i = effects.length - 1; i >= 0; i--) {
    const fx = effects[i];
    let keep = true;
    try { keep = fx?.draw?.(_lastDt) !== false; } catch { keep = false; }
    if (!keep) effects.splice(i, 1);
  }

  // boss bar
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
  for (const p of projectiles) {
    if (p.state === 'attached' || p.state === 'arc') {
      const key = p.descending ? 'ball_down' : 'ball_idle';
      const img = getImage(key);
      if (img) drawSprite(img, p.x, p.y, p.size || 24);
      else { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI*2); ctx.fill(); }
    } else {
      const frame = p.explode?.frame();
      if (frame) drawSprite(frame, p.x, p.y, (p.size || 24) * 1.5);
    }
  }
}

// -------------------- Actions --------------------
function startWave() {
  if (S.waveRunning || S.defeated) return;
  S.wave += 1; S.waveRunning = true;
  Engine.emit('wave:start', { wave: S.wave });
  const baseCadence = Math.max(0.25, 0.55 - S.wave * 0.02);
  const packs = waveRecipe(S.wave);
  setWaveStatus(packs.some(p => p.boss) ? 'Boss!' : 'Running…');
  for (const p of packs) spawnBatch(p.type, p.count, baseCadence * (p.cadenceMul || 1));
}
function resetGame() {
  enemies.length = 0; projectiles.length = 0; effects.length = 0;
  spawners.length = 0;
  S.wave = 0; S.waveRunning = false; S.defeated = false;
  core.hp = core.hpMax; S.gold = 0;
  upgrades.dmg = upgrades.rof = upgrades.range = 0;
  core.applyUpgrades();
  Engine.applyPermToCore(core);
  Engine.runResetHooks();
  setWaveStatus('No wave'); saveGame(); notifySubscribers(buildSnapshot());
}

// Hard reset: wipe save, prestige, permanent levels, gold upgrades, and run state
function hardReset() {
  try { localStorage.removeItem('mage-core:v1'); } catch {}

  // clear run + stats
  enemies.length = 0; projectiles.length = 0; effects.length = 0;
  // if spawners is in this scope:
  if (typeof spawners !== 'undefined') spawners.length = 0;

  S.wave = 0; S.waveRunning = false; S.defeated = false;
  S.gold = 0; S.prestige = 0;
  core.hp = core.hpMax;

  // clear gold upgrades
  upgrades.dmg = 0;
  upgrades.rof = 0;
  upgrades.range = 0;

  // clear *all* permanent levels (including abilities)
  Engine.setPermLevels({});

  // re-apply from clean slate
  core.applyUpgrades();
  Engine.applyPermToCore(core);
  Engine.runResetHooks?.();

  setWaveStatus('Progress wiped');
  notifySubscribers(buildSnapshot());
}


function buyUpgrade(type) {
  const def = Engine.registry?.upgrades?.[type];
  if (!def) return;
  const level = upgrades[type] | 0;
  const c = (typeof def.cost === 'function') ? def.cost(level) : 0;
  if (S.gold < c) return;
  S.gold = S.gold - c;
  upgrades[type] = level + 1;
  core.applyUpgrades();
  if (typeof def.apply === 'function') def.apply(core, upgrades[type]);
  Engine.applyPermToCore(core);
  saveGame(); notifySubscribers(buildSnapshot());
}
function buyPermanent(rowId) {
  const m = String(rowId).split(':');
  if (m.length !== 2) return false;
  const kind = m[0], id = m[1];

  const levels = Engine.getPermLevels();
  const key = (kind === 'ability') ? `ability:${id}` : id;

  const cur = levels[key]|0;
  const price = 5 + Math.floor(Math.pow(1.35, cur));
  if ((S.prestige|0) < price) return false;

  S.prestige -= price;
  levels[key] = cur + 1;
  Engine.setPermLevels(levels);

  core.applyUpgrades();
  Engine.applyPermToCore(core);

  saveGame(); notifySubscribers(buildSnapshot());
  Engine.emit('meta:buy', { id: key, level: levels[key] });
  return true;
}
function castAbility(which) {
  const ok = Engine.castAbility(which);
  if (ok) { saveGame(); notifySubscribers(buildSnapshot()); }
  return ok;
}
function surrender() {
  if (S.defeated) return;
  // end run immediately; update() will detect defeat and show defeat menu
  core.hp = 0;
}

// Keybindings — just actions; UI overlay handles DOM
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'q') castAbility('nova');
  if (k === 'w') castAbility('frost');
  if (k === 'escape') {
    ensureHudMenuButton(() => openPauseMenu({
      onResume: () => { S.paused = false; },
      onSurrender: () => { surrender(); },
      onMainMenu: () => { removeHudMenuButton(); resetGame(); S.paused = true; initMenuUI({ onPlay: startFromMenu, onBuyPermanent: buyPermanent }); }
    }));
    S.paused = true;
  }
});

// Expose to UI
window.engine = {
  getSnapshot: buildSnapshot,
  subscribe,
  actions: {
    startWave, reset: resetGame, buy: buyUpgrade, buyPermanent, cast: castAbility,
    loadSave: loadGame, wipeSave: wipeSave, saveNow: saveGame, hasSave: hasSave,
    setPaused: (v) => { S.paused = !!v; notifySubscribers(buildSnapshot()); },
    togglePause: () => { S.paused = !S.paused; notifySubscribers(buildSnapshot()); },
    setSpeed: (n) => { S.timeScale = Math.max(1, n|0); notifySubscribers(buildSnapshot()); },
    setAutoStart: (v) => { S.autoStart = !!v; notifySubscribers(buildSnapshot()); },
    surrender,
    hardReset,
  }
};

// initial load
if (!loadGame()){
  setWaveStatus('No wave');
  notifySubscribers(buildSnapshot());
}

// ---------- Prestige rules ----------
Engine.addPrestigeRule(({kind, wave}) => kind==='bossKill' ? (1 + Math.floor((wave||0)/5)) : 0);
Engine.addPrestigeRule(({kind, wave}) => kind==='defeat'   ? Math.floor((wave||0)/3)       : 0);

// helper: start from menu (used by overlay callbacks)
function startFromMenu(){
  S.paused = false;
  if (!buildSnapshot().waveRunning) startWave();
  ensureHudMenuButton(() => openPauseMenu({
    onResume: () => { S.paused = false; },
    onSurrender: () => { surrender(); },
    onMainMenu: () => { removeHudMenuButton(); resetGame(); S.paused = true; initMenuUI({ onPlay: startFromMenu, onBuyPermanent: buyPermanent }); }
  }));
}
