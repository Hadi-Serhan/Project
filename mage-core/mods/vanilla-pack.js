// mage-core/mods/vanilla-pack.js
import Engine from '../src/engine.js';
import { Audio } from '../src/audio.js';
import { core, enemies, effects, dist, clamp, ctx } from '../src/state.js';

Audio.load({
  'ability/nova/cast':  new URL('../assets/sfx/fire_ring.wav',  import.meta.url).href,
  'ability/frost/cast': new URL('../assets/sfx/snow_storm.wav', import.meta.url).href,
});

/* ─────────────────────────────────────────────────────────────
   Core tuning (vanilla defaults)
----------------------------------------------------------------*/
Engine.modifyCore((c) => {
  c.baseDamage   = 35;
  c.baseFireRate = 1.2;
  c.baseRange    = 600;
  c.hpMax        = 1000;
  c.hp = c.hpMax;

  // important: re-derive from scratch
  c.applyUpgrades();
  Engine.applyPermToCore(c);
});

/* ─────────────────────────────────────────────────────────────
   Upgrades: Offense
----------------------------------------------------------------*/
Engine.registerUpgrade('dmg', {
  category: 'Offense',
  title: 'Damage',
  desc: 'Increase core damage (+5 per level).',
  cost(level){ const base=20,k=1.5; return Math.floor(base*Math.pow(k, level)); },
  apply(c, level){ if (level) c.damage = c.baseDamage + 5 * level; }
});

Engine.registerUpgrade('rof', {
  category: 'Offense',
  title: 'Fire Rate',
  desc: 'Increase attack speed (+0.2 per level).',
  cost(level){ const base=20,k=1.5; return Math.floor(base*Math.pow(k, level)); },
  apply(c, level){ if (level) c.fireRate = c.baseFireRate + 0.2 * level; }
});

Engine.registerUpgrade('aura', {
  category: 'Offense',
  title: 'Inferno Aura',
  desc: 'Passive damage to nearby enemies (bigger radius per level).',
  cost(level){ const base=35,k=1.6; return Math.floor(base*Math.pow(k, level)); },
  apply(c, lvl){
    if (!lvl) return;          // level 0 = off
    c.auraDps    = 3 + 2 * lvl;       // keep modest so it’s not OP at L1
    c.auraRadius = 80 + 18 * lvl;
  },
  permanentApply(c, lvl){
    if (!lvl) return;
    c.auraDps    = (c.auraDps||0) + (1.5 * lvl);
    c.auraRadius = Math.round((c.auraRadius||0) + 6 * lvl);
  }
});

/* ─────────────────────────────────────────────────────────────
   Upgrades: Defense
----------------------------------------------------------------*/
Engine.registerUpgrade('hpmax', {
  category: 'Defense',
  title: 'Core Vitality',
  desc: 'Max HP +60 per level.',
  cost(level){ const base=25,k=1.55; return Math.floor(base*Math.pow(k, level)); },
  apply(c, lvl){
    if (!lvl) return;
    const prevMax = c.hpMax|0;
    c.hpMax = 1000 + 60 * lvl;
    c.hp = Math.min(c.hp + (c.hpMax - prevMax), c.hpMax); // heal newly added capacity
  }
});

Engine.registerUpgrade('armor', {
  category: 'Defense',
  title: 'Arcane Plating',
  desc: 'Flat damage reduction (−1 per hit per level).',
  cost(level){ const base=28,k=1.6; return Math.floor(base*Math.pow(k, level)); },
  apply(c, lvl){ if (lvl) c.armor = 1 * lvl; }
});

Engine.registerUpgrade('regen', {
  category: 'Defense',
  title: 'Reconstitution',
  desc: 'Regenerate HP over time (+0.8 HP/s per level).',
  cost(level){ const base=30,k=1.55; return Math.floor(base*Math.pow(k, level)); },
  apply(c, lvl){ if (lvl) c.hpRegen = 0.8 * lvl; }
});

/* ─────────────────────────────────────────────────────────────
   Upgrades: Utility
----------------------------------------------------------------*/
Engine.registerUpgrade('range', {
  category: 'Utility',
  title: 'Range',
  desc: 'Increase attack range (+12 per level).',
  cost(level){ const base=20,k=1.5; return Math.floor(base*Math.pow(k, level)); },
  apply(c, level){ if (level) c.range = c.baseRange + 12 * level; }
});

/* ─────────────────────────────────────────────────────────────
   Passive Aura Tick (uses core.auraDps/auraRadius if present)
----------------------------------------------------------------*/
(function(){
  let lastT = performance.now()/1000;

  Engine.addOverlayDrawer(() => {
    // dt tied to wall clock; clamp to avoid huge steps
    const now = performance.now()/1000;
    const dt = Math.min(0.05, Math.max(0, now - lastT));
    lastT = now;

    // regen tick
    if ((core.hpRegen||0) > 0 && core.hp > 0 && core.hp < core.hpMax) {
      core.hp = Math.min(core.hpMax, core.hp + core.hpRegen * dt);
    }

    // passive AoE
    const dps = core.auraDps||0, rr = core.auraRadius||0;
    if (dps > 0 && rr > 0) {
      const r2 = rr*rr, cx = core.x(), cy = core.y();
      for (const e of enemies) {
        const p = e.pos, dx = p.x - cx, dy = p.y - cy;
        if (dx*dx + dy*dy <= r2) e.hp -= dps * dt;
      }
      // subtle ring (kept, but feel free to hide)
      ctx.save();
      ctx.strokeStyle = 'rgba(255,140,60,0.2)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI*2); ctx.stroke();
      ctx.restore();
    }
  });

  // ensure the local clock resets after hardReset / reset
  Engine.addResetHook(() => { lastT = performance.now()/1000; });
})();
// ─────────────────────────────────────────────────────────────
// ABILITIES
// ─────────────────────────────────────────────────────────────

// Nova (existing)
Engine.registerAbility('nova', {
  title: 'Nova', hint: 'Q', enabled: true,
  radius: 110, cd: 10, cdLeft: 0,
  damageBase: 35, damageCoef: 0.6,
  sfx: { cast: 'ability/nova/cast' },
  cast() {
    if (this.cdLeft > 0 || this.enabled === false) return false;
    const dmg = this.damageBase + this.damageCoef * core.damage;
    for (const e of enemies) {
      const p = e.pos;
      if (dist(core.x(), core.y(), p.x, p.y) <= this.radius) {
        e.hp -= dmg;
        if (e.state === 'attacking') e.dist += 6;
      }
    }
    effects.push(makeNovaFireRing(core.x(), core.y(), {
      radius: this.radius + 10, thickness: 16, flameFreq: 12, flameAmp: 5, flameSpeed: 0.07, hueSpeed: 2.5, dur: 0.65
    }));
    effects.push(makeNovaFireRing(core.x(), core.y(), {
      radius: this.radius + 26, thickness: 6, flameFreq: 6, flameAmp: 2, flameSpeed: 0.05, hueSpeed: 1.5, dur: 0.5
    }));
    return true;
  }
});

// Frost (existing slow aura)
const frostDef = {
  title: 'Frost', hint: 'W', enabled: true,
  radius: 140, cd: 12, cdLeft: 0,
  sfx: { cast: 'ability/frost/cast' },
  zones: [], duration: 5.0, slow: 0.35,
  cast() {
    if (this.cdLeft > 0 || this.enabled === false) return false;
    const until = performance.now()/1000 + this.duration;
    this.zones.length = 0;
    this.zones.push({ x: core.x(), y: core.y(), r: this.radius, until });
    return true;
  },
  drawOverlay() {
    const z = this.zones[0]; if (!z) return;
    const now = performance.now()/1000;
    if (now >= z.until) { this.zones.length = 0; return; }
    const t = clamp((z.until - now) / this.duration, 0, 1);
    ctx.fillStyle = `rgba(120,180,255,${0.15 * t + 0.1})`;
    ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = `rgba(120,180,255,${0.6 * t})`;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, Math.PI*2); ctx.stroke();
  }
};
Engine.registerAbility('frost', frostDef);

// NEW: Shockwave — stronger nova with big knockback (E)
Engine.registerAbility('shockwave', {
  title: 'Shockwave', hint: 'E', enabled: true,
  radius: 150, cd: 12, cdLeft: 0,
  damageBase: 20, coef: 0.8,
  sfx: { cast: 'ability/shock/cast' },
  cast() {
    if (this.cdLeft > 0 || this.enabled === false) return false;
    const dmg = this.damageBase + this.coef * core.damage;
    for (const e of enemies) {
      const p = e.pos;
      if (dist(core.x(), core.y(), p.x, p.y) <= this.radius) {
        e.hp -= dmg;
        e.dist += 12; // heavy knockback
      }
    }
    effects.push(makeNovaFireRing(core.x(), core.y(), {
      radius: this.radius + 16, thickness: 18, flameFreq: 10, flameAmp: 6, flameSpeed: 0.08, hueSpeed: 2.2, dur: 0.5
    }));
    return true;
  }
});

// NEW: Overdrive — temporary DMG & ROF buff (R)
Engine.registerAbility('overdrive', {
  title: 'Overdrive', hint: 'R', enabled: true,
  cd: 20, cdLeft: 0, duration: 6,
  dmgMul: 1.2, rofMul: 1.6,
  sfx: { cast: 'ability/drive/cast' },
  cast() {
    if (this.cdLeft > 0 || this.enabled === false) return false;
    const now = performance.now()/1000;
    core._driveUntil = now + this.duration;
    core._driveDMul  = this.dmgMul;
    core._driveRofMul= this.rofMul;
    return true;
  }
});

// ─────────────────────────────────────────────────────────────
// MOD HOOKS
// ─────────────────────────────────────────────────────────────

// Frost slow (existing)
Engine.addEnemyModifier((enemy) => {
  const frost = Engine.registry?.abilities?.frost;
  if (!frost?.enabled) return null;
  const z = frost.zones?.[0]; if (!z) return null;
  const now = performance.now()/1000; if (now >= z.until) { frost.zones.length = 0; return null; }
  const p = enemy.pos; const dx = p.x - z.x, dy = p.y - z.y;
  if ((dx*dx + dy*dy) > (z.r*z.r)) return null;
  const s = Math.max(0, Math.min(0.95, frost.slow ?? 0));
  const slow = enemy.boss ? Math.min(s, 0.20) : s;
  return { speedMul: 1 - slow, atkMul: 1 / (1 - slow) };
});

// Draw frost overlay
Engine.addOverlayDrawer(() => { const frost = Engine.registry?.abilities?.frost; frost?.drawOverlay?.(); });

// NEW: Aura DoT + Overdrive ticking + Regen (we piggyback on overlay drawer to get a dt)
(function(){
  let lastT = performance.now()/1000;
  Engine.addOverlayDrawer(() => {
    const now = performance.now()/1000;
    const dt = Math.min(0.05, Math.max(0, now - lastT));
    lastT = now;

    // Regeneration
    if ((core.regenPerSec||0) > 0 && core.hp > 0) {
      core.hp = Math.min(core.hpMax, core.hp + core.regenPerSec * dt);
    }

    // Overdrive: apply multipliers while active (non-destructive)
    if (core._driveUntil > now) {
      // Recompute from base to avoid compounding
      const baseDmg = core.baseDamage + 5 * (Engine.state?.upgrades?.dmg||0);
      const baseRof = core.baseFireRate + 0.2 * (Engine.state?.upgrades?.rof||0);
      core.damage   = Math.round(baseDmg * (core.perm?.dmgMul || 1) * core._driveDMul);
      core.fireRate = (baseRof * (core.perm?.rofMul || 1) * core._driveRofMul);
    }

    // Aura DoT
    const dps = core.auraDps||0, rr = core.auraRadius||0;
    if (dps > 0 && rr > 0) {
      const r2 = rr*rr;
      const cx = core.x(), cy = core.y();
      for (const e of enemies) {
        const p = e.pos, dx = p.x - cx, dy = p.y - cy;
        if (dx*dx + dy*dy <= r2) {
          e.hp -= dps * dt;
        }
      }
      // faint visual ring
      ctx.save();
      ctx.strokeStyle = 'rgba(255,140,60,0.2)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI*2); ctx.stroke();
      ctx.restore();
    }
  });
})();

// NEW: Barrier damage reduction by refunding a portion on hit
Engine.on('core:hit', ({ amount }) => {
  const dr = Math.max(0, Math.min(core.dmgReduce||0, 0.6));
  if (dr <= 0) return;
  const refund = Math.floor(amount * dr);
  if (refund > 0 && core.hp > 0) {
    core.hp = Math.min(core.hpMax, core.hp + refund);
  }
});

// NEW: Greed extra gold — apply on kill
Engine.on('enemy:death', ({ enemy }) => {
  const mul = Math.max(1, core.goldBonusMul || 1);
  if (mul <= 1.0001) return;
  const base = Math.round(enemy.goldOnDeath * (core.goldMul || 1));
  const extra = Math.max(0, Math.round(base * (mul - 1)));
  if (extra > 0) Engine.addGold(extra);
});

// Clean up on reset
Engine.addResetHook(() => {
  const frost = Engine.registry?.abilities?.frost;
  if (frost) { frost.zones.length = 0; frost.cdLeft = 0; }
  const nova = Engine.registry?.abilities?.nova;   if (nova)  nova.cdLeft = 0;
  const sh   = Engine.registry?.abilities?.shockwave; if (sh) sh.cdLeft = 0;
  const drv  = Engine.registry?.abilities?.overdrive; if (drv) drv.cdLeft = 0;
});

// Optional hotkeys: Q/W/E/R
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'q') window.engine?.actions?.cast?.('nova');
  if (k === 'w') window.engine?.actions?.cast?.('frost');
  if (k === 'e') window.engine?.actions?.cast?.('shockwave');
  if (k === 'r') window.engine?.actions?.cast?.('overdrive');
});
