// Firey/mods/vanilla-pack.js
import Engine from '../src/engine.js';
import { Audio } from '../src/audio.js';
import { core, enemies, effects, dist, clamp, ctx, Stats, CoreSchema } from '../src/state.js';
import { utils as AbilityUtils } from '../src/abilities.js'; // visuals (makeRingEffect)

// Audio
Audio.load({
  'ability/nova/cast':  new URL('../assets/sfx/fire_ring.wav',  import.meta.url).href,
  'ability/frost/cast': new URL('../assets/sfx/snow_storm.wav', import.meta.url).href,
  'ability/shock/cast': new URL('../assets/sfx/shock.wav',      import.meta.url).href,
  'ability/drive/cast': new URL('../assets/sfx/overdrive.wav',  import.meta.url).href,
});


  //STATS (for UI readouts) — labels + formatters
  //These keys are referenced from each upgrade via readoutKeys.

const f2 = (x) => (typeof x === 'number' ? Number(x).toFixed(2) : x);

Stats.register('damage', {
  label: 'Damage',
  get: c => c.damage ?? c.baseDamage,
  format: c => `Damage: ${f2(c.damage ?? c.baseDamage)}`
});

Stats.register('fireRate', {
  label: 'Attack Speed',
  get: c => c.fireRate ?? c.baseFireRate,
  format: c => `Attack Speed: ${f2(c.fireRate ?? c.baseFireRate)}/s`
});

Stats.register('range', {
  label: 'Range',
  get: c => c.range ?? c.baseRange,
  format: c => `Range: ${Math.round(c.range ?? c.baseRange)}`
});

Stats.register('armor', {
  label: 'Armor',
  get: c => c.armor ?? 0,
  format: c => `Armor: ${Math.round(c.armor ?? 0)}`
});

Stats.register('hpRegen', {
  label: 'Regen',
  get: c => c.hpRegen ?? 0,
  format: c => `Regen: ${f2(c.hpRegen ?? 0)}/s`
});

Stats.register('hp', {
  label: 'HP',
  get: c => [c.hp, c.hpMax],
  format: c => `HP: ${Math.round(c.hp ?? 0)}/${Math.round(c.hpMax ?? 0)}`
});

Stats.register('aura', {
  label: 'Aura',
  get: c => [c.auraDps||0, c.auraRadius||0],
  format: c => `Aura: ${f2(c.auraDps||0)} DPS • r=${Math.round(c.auraRadius||0)}`
});

/* ─────────────────────────────────────────────────────────────
   CORE BASE DEFAULTS
   - We can either extend the schema or set base values via modifyCore.
   - Here we stick to our values and force a recompute so UI readouts are correct.
----------------------------------------------------------------*/
Engine.modifyCore((c) => {
  // These are *base* fields — they’ll be copied to live fields by CoreSchema reset.
  c.baseDamage   = 35;
  c.baseFireRate = 1.2;
  c.baseRange    = 600;
  c.hpMax        = 1000;
  c.hp           = c.hpMax;

  // Recompute from schema + upgrades, then stamp permanent bonuses
  c.applyUpgrades();
  Engine.applyPermToCore(c);
});

/* ─────────────────────────────────────────────────────────────
   UPGRADES (data-first; schema/UI agnostic)
----------------------------------------------------------------*/

// Offense
Engine.registerUpgrade('dmg', {
  category: 'Offense',
  title: 'Damage',
  desc: 'Increase core damage (+5 per level).',
  readoutKeys: ['damage'],
  cost(level){ const base=20,k=1.5; return Math.floor(base*Math.pow(k, level)); },
  apply(c, level){ if (level) c.damage = (c.baseDamage ?? c.damage ?? 0) + 5 * level; },
  // Permanent: +2 flat damage per perm level
  permanentApply(c, p){ if (p) c.damage = (c.damage ?? c.baseDamage ?? 0) + 2 * p; }
});

Engine.registerUpgrade('rof', {
  category: 'Offense',
  title: 'Fire Rate',
  desc: 'Increase attack speed (+0.2 per level).',
  readoutKeys: ['fireRate'],
  cost(level){ const base=20,k=1.5; return Math.floor(base*Math.pow(k, level)); },
  apply(c, level){ if (level) c.fireRate = (c.baseFireRate ?? c.fireRate ?? 0) + 0.2 * level; },
  // Permanent: +0.1 atk/s per perm level
  permanentApply(c, p){ if (p) c.fireRate = (c.fireRate ?? c.baseFireRate ?? 0) + 0.1 * p; }
});

Engine.registerUpgrade('aura', {
  category: 'Offense',
  title: 'Inferno Aura',
  desc: 'Passive damage to nearby enemies (bigger radius per level).',
  readoutKeys: ['aura'],
  cost(level){ const base=35,k=1.6; return Math.floor(base*Math.pow(k, level)); },
  apply(c, lvl){
    if (!lvl) return;
    c.auraDps    = 3 + 2 * lvl;
    c.auraRadius = 80 + 18 * lvl;
  },
  permanentApply(c, lvl){
    if (!lvl) return;
    c.auraDps    = (c.auraDps||0) + (1.5 * lvl);
    c.auraRadius = Math.round((c.auraRadius||0) + 6 * lvl);
  }
});

// Defense
Engine.registerUpgrade('hpmax', {
  category: 'Defense',
  title: 'Core Vitality',
  desc: 'Max HP +60 per level.',
  readoutKeys: ['hp'],
  cost(level){ const base=25,k=1.55; return Math.floor(base*Math.pow(k, level)); },
  apply(c, lvl){
    if (!lvl) return;
    const prevMax = c.hpMax|0;
    c.hpMax = 1000 + 60 * lvl;
    c.hp = Math.min(c.hp + (c.hpMax - prevMax), c.hpMax);
  },
  // Permanent: +50 max HP per perm level
  permanentApply(c, p){
    if (!p) return;
    const prevMax = c.hpMax|0;
    c.hpMax = prevMax + 50 * p;
    c.hp = Math.min(c.hp + (c.hpMax - prevMax), c.hpMax);
  }
});

Engine.registerUpgrade('armor', {
  category: 'Defense',
  title: 'Arcane Plating',
  desc: 'Flat damage reduction (−1 per hit per level).',
  readoutKeys: ['armor'],
  cost(level){ const base=28,k=1.6; return Math.floor(base*Math.pow(k, level)); },
  apply(c, lvl){ if (lvl) c.armor = 1 * lvl; },
  // Permanent: +1 armor per perm level
  permanentApply(c, p){ if (p) c.armor = (c.armor|0) + 1 * p; }
});

Engine.registerUpgrade('regen', {
  category: 'Defense',
  title: 'Reconstitution',
  desc: 'Regenerate HP over time (+0.8 HP/s per level).',
  readoutKeys: ['hpRegen'],
  cost(level){ const base=30,k=1.55; return Math.floor(base*Math.pow(k, level)); },
  apply(c, lvl){ if (lvl) c.hpRegen = 0.8 * lvl; },
  // Permanent: +0.5 HP/s per perm level
  permanentApply(c, p){ if (p) c.hpRegen = (c.hpRegen||0) + 0.5 * p; }
});

// Utility
Engine.registerUpgrade('range', {
  category: 'Utility',
  title: 'Range',
  desc: 'Increase attack range (+12 per level).',
  readoutKeys: ['range'],
  cost(level){ const base=20,k=1.5; return Math.floor(base*Math.pow(k, level)); },
  apply(c, level){ if (level) c.range = (c.baseRange ?? c.range ?? 0) + 12 * level; },
  // Permanent: +8 range per perm level
  permanentApply(c, p){ if (p) c.range = (c.range ?? c.baseRange ?? 0) + 8 * p; }
});

/* ─────────────────────────────────────────────────────────────
   PASSIVE AURA TICK 
----------------------------------------------------------------*/
(function(){
  let lastT = performance.now()/1000;

  Engine.addOverlayDrawer(() => {
    const now = performance.now()/1000;
    const dt = Math.min(0.05, Math.max(0, now - lastT));
    lastT = now;

    // regen tick
    if ((core.hpRegen||0) > 0 && core.hp > 0 && core.hp < core.hpMax) {
      core.hp = Math.min(core.hpMax, Math.round((core.hp + core.hpRegen * dt) * 100) / 100);
    }

    // passive aura
    const dps = core.auraDps||0, rr = core.auraRadius||0;
    if (dps > 0 && rr > 0) {
      const r2 = rr*rr, cx = core.x(), cy = core.y();
      for (const e of enemies) {
        const p = e.pos, dx = p.x - cx, dy = p.y - cy;
        if (dx*dx + dy*dy <= r2) e.hp -= dps * dt;
      }
      // subtle ring
      ctx.save();
      ctx.strokeStyle = 'rgba(255,140,60,0.2)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI*2); ctx.stroke();
      ctx.restore();
    }
  });

  Engine.addResetHook(() => { lastT = performance.now()/1000; });
})();

/* ─────────────────────────────────────────────────────────────
   ABILITIES
----------------------------------------------------------------*/

// helpers
const _AL = (id) => (typeof Engine.getAbilityPermLevel === 'function' ? (Engine.getAbilityPermLevel(id) | 0) : 0);
const _cooldown = (base, lvl) => Math.max(1, base * Math.pow(0.94, lvl)); // ~ -6% CD per perm level

// Nova (Q)
Engine.registerAbility('nova', {
  title: 'Nova', hint: 'Q', enabled: true,
  // base knobs
  radius: 110, cd: 10, cdLeft: 0,
  damageBase: 35, damageCoef: 0.6,
  sfx: { cast: 'ability/nova/cast' },

  // effective w/ permanents
  _lvl() { return _AL('nova'); },
  _effectiveRadius() { return this.radius + 8 * this._lvl(); },
  _effectiveCd() { return _cooldown(this.cd, this._lvl()); },
  _effectiveDamage() {
    const L = this._lvl();
    const base = this.damageBase + 10 * L;
    const coef = this.damageCoef + 0.05 * L;
    return base + coef * core.damage;
  },

  cast() {
    if (this.cdLeft > 0 || this.enabled === false) return false;

    const dmg = this._effectiveDamage();
    const rr  = this._effectiveRadius();

    for (const e of enemies) {
      const p = e.pos;
      if (dist(core.x(), core.y(), p.x, p.y) <= rr) {
        e.hp -= dmg;
        if (e.state === 'attacking') e.dist += 6;
      }
    }
    if (AbilityUtils?.makeRingEffect) {
      effects.push(AbilityUtils.makeRingEffect(core.x(), core.y(), rr + 10));
      effects.push(AbilityUtils.makeRingEffect(core.x(), core.y(), rr + 26));
    }

    this.cdLeft = this._effectiveCd();
    return true;
  }
});

// Frost (W) — slow aura
const frostDef = {
  title: 'Frost', hint: 'W', enabled: true,
  // base knobs
  radius: 140, cd: 12, cdLeft: 0,
  duration: 5.0, slow: 0.35,
  sfx: { cast: 'ability/frost/cast' },

  // state
  zones: [],

  // effective w/ permanents
  _lvl() { return _AL('frost'); },
  _effectiveRadius() { return this.radius + 10 * this._lvl(); },
  _effectiveDuration() { return this.duration + 0.5 * this._lvl(); },
  _effectiveSlow() { return Math.min(0.75, this.slow + 0.03 * this._lvl()); }, // cap @ 75%
  _effectiveCd() { return _cooldown(this.cd, this._lvl()); },

  cast() {
    if (this.cdLeft > 0 || this.enabled === false) return false;
    const until = performance.now()/1000 + this._effectiveDuration();

    this.zones.length = 0;
    this.zones.push({ x: core.x(), y: core.y(), r: this._effectiveRadius(), until, slow: this._effectiveSlow() });

    this.cdLeft = this._effectiveCd();
    return true;
  },

  drawOverlay() {
    const z = this.zones[0]; if (!z) return;
    const now = performance.now()/1000;
    if (now >= z.until) { this.zones.length = 0; return; }

    const total = z.until - (now - (this._effectiveDuration() - (z.until - now))); // recompute total-ish
    const t = clamp((z.until - now) / (total || this._effectiveDuration()), 0, 1);

    ctx.fillStyle = `rgba(120,180,255,${0.15 * t + 0.1})`;
    ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = `rgba(120,180,255,${0.6 * t})`;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, Math.PI*2); ctx.stroke();
  }
};
Engine.registerAbility('frost', frostDef);

// Shockwave (E)
Engine.registerAbility('shockwave', {
  title: 'Shockwave', hint: 'E', enabled: true,
  // base knobs
  radius: 150, cd: 12, cdLeft: 0,
  damageBase: 20, coef: 0.8,
  sfx: { cast: 'ability/shock/cast' },

  // effective w/ permanents
  _lvl() { return _AL('shockwave'); },
  _effectiveRadius() { return this.radius + 12 * this._lvl(); },
  _effectiveCd() { return _cooldown(this.cd, this._lvl()); },
  _effectiveDamage() {
    const L = this._lvl();
    const base = this.damageBase + 10 * L;
    const coef = this.coef + 0.10 * L;
    return base + coef * core.damage;
  },

  cast() {
    if (this.cdLeft > 0 || this.enabled === false) return false;

    const rr  = this._effectiveRadius();
    const dmg = this._effectiveDamage();

    for (const e of enemies) {
      const p = e.pos;
      if (dist(core.x(), core.y(), p.x, p.y) <= rr) {
        e.hp -= dmg;
        e.dist += 12; // heavy knockback
      }
    }
    if (AbilityUtils?.makeRingEffect) {
      effects.push(AbilityUtils.makeRingEffect(core.x(), core.y(), rr + 16));
    }

    this.cdLeft = this._effectiveCd();
    return true;
  }
});

// Overdrive (R) — temporary DMG & ROF buff (snapshot-safe)
Engine.registerAbility('overdrive', {
  title: 'Overdrive', hint: 'R', enabled: true,
  // base knobs
  cd: 20, cdLeft: 0, duration: 6,
  dmgMul: 1.2, rofMul: 1.6,
  sfx: { cast: 'ability/drive/cast' },

  // effective w/ permanents
  _lvl() { return _AL('overdrive'); },
  _effectiveCd() { return _cooldown(this.cd, this._lvl()); },
  _effectiveDuration() { return this.duration + 0.8 * this._lvl(); },
  _effectiveDmgMul() { return this.dmgMul + 0.05 * this._lvl(); },
  _effectiveRofMul() { return this.rofMul + 0.10 * this._lvl(); },

  cast() {
    if (this.cdLeft > 0 || this.enabled === false) return false;

    const now = performance.now()/1000;

    // Snapshot the current (already-upgraded/permanent) stats so OD can only go UP
    core._driveUntil  = now + this._effectiveDuration();
    core._driveDMul   = this._effectiveDmgMul();
    core._driveRofMul = this._effectiveRofMul();
    core._driveBase = {
      damage:   Number(core.damage   ?? core.baseDamage   ?? 0),
      fireRate: Number(core.fireRate ?? core.baseFireRate ?? 0),
    };

    this.cdLeft = this._effectiveCd();
    return true;
  }
});

/* ─────────────────────────────────────────────────────────────
   MOD HOOKS (Frost slow + Overdrive tick)
----------------------------------------------------------------*/

// Frost slow application (uses zone.slow if present)
Engine.addEnemyModifier((enemy) => {
  const frost = Engine.registry?.abilities?.frost;
  if (!frost?.enabled) return null;
  const z = frost.zones?.[0]; if (!z) return null;
  const now = performance.now()/1000; if (now >= z.until) { frost.zones.length = 0; return null; }
  const p = enemy.pos; const dx = p.x - z.x, dy = p.y - z.y;
  if ((dx*dx + dy*dy) > (z.r*z.r)) return null;
  const s = Math.max(0, Math.min(0.95, z.slow ?? frost._effectiveSlow()));
  const slow = enemy.boss ? Math.min(s, 0.20) : s;
  return { speedMul: 1 - slow, atkMul: 1 / (1 - slow) };
});

// Draw frost overlay
Engine.addOverlayDrawer(() => { const frost = Engine.registry?.abilities?.frost; frost?.drawOverlay?.(); });

// Overdrive tickin — snapshot-safe, never reduces rate/damage
(function(){
  let lastT = performance.now()/1000;
  Engine.addOverlayDrawer(() => {
    const now = performance.now()/1000;
    const dt = Math.min(0.05, Math.max(0, now - lastT));
    lastT = now;

    if (core._driveUntil && core._driveUntil > now && core._driveBase) {
      const baseD = core._driveBase.damage;
      const baseR = core._driveBase.fireRate;

      const dmg = baseD * (core._driveDMul  || 1);
      const rof = baseR * (core._driveRofMul|| 1);

      core.damage   = Math.max(baseD, Math.round(dmg));
      core.fireRate = Math.max(baseR, rof);
    } else if (core._driveUntil && core._driveUntil <= now) {
      // Expired — clean up and restore normal computation
      delete core._driveUntil;
      delete core._driveDMul;
      delete core._driveRofMul;
      delete core._driveBase;

      try { core.applyUpgrades(); Engine.applyPermToCore(core); } catch {}
    }
  });
})();

// Barrier: refund a portion of damage taken (if a mod set core.dmgReduce)
Engine.on('core:hit', ({ amount }) => {
  const dr = Math.max(0, Math.min(core.dmgReduce||0, 0.6));
  if (dr <= 0) return;
  const refund = Math.floor(amount * dr);
  if (refund > 0 && core.hp > 0) {
    core.hp = Math.min(core.hpMax, core.hp + refund);
  }
});

// Greed: extra gold on kill
Engine.on('enemy:death', ({ enemy }) => {
  const mul = Math.max(1, core.goldBonusMul || 1);
  if (mul <= 1.0001) return;
  const base = Math.round(enemy.goldOnDeath * (core.goldMul || 1));
  const extra = Math.max(0, Math.round(base * (mul - 1)));
  if (extra > 0) Engine.addGold(extra);
});

// Reset cleanup
Engine.addResetHook(() => {
  const frost = Engine.registry?.abilities?.frost;
  if (frost) { frost.zones.length = 0; frost.cdLeft = 0; }
  const nova = Engine.registry?.abilities?.nova;        if (nova)  nova.cdLeft = 0;
  const sh   = Engine.registry?.abilities?.shockwave;   if (sh)    sh.cdLeft = 0;
  const drv  = Engine.registry?.abilities?.overdrive;   if (drv)   drv.cdLeft = 0;
});

/* ─────────────────────────────────────────────────────────────
   HOTKEYS
----------------------------------------------------------------*/
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'q') window.engine?.actions?.cast?.('nova');
  if (k === 'w') window.engine?.actions?.cast?.('frost');
  if (k === 'e') window.engine?.actions?.cast?.('shockwave');
  if (k === 'r') window.engine?.actions?.cast?.('overdrive');
});
