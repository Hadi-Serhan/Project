// mods/vanilla-pack.js
import Engine from '../src/engine.js';
import { core, enemies, effects, dist, clamp, ctx } from '../src/state.js';

// ----------- Nova fire ring (animated) -----------
function makeNovaFireRing(x, y, {
  radius = 120,
  thickness = 14,
  flameFreq = 10,      // how many waves around the ring
  flameAmp = 4,        // wave amplitude in px
  flameSpeed = 0.05,   // wave animation speed
  hueSpeed = 2,        // gradient rotation speed
  dur = 0.6            // seconds to fade out
} = {}) {
  return {
    t: 0,
    time: 0, // internal time if you want it to respect dt/timeScale
    draw(dt) {
      this.t += dt;
      this.time += dt;
      const k = Math.min(this.t / dur, 1);
      const alpha = 1 - k;
      if (alpha <= 0) return false;

      ctx.save();
      ctx.translate(x, y);
      ctx.globalAlpha = alpha;

      // Prefer a conic gradient; fall back to a solid color if unsupported
      let strokeStyle = '#ff7b00';
      const timeForHue = this.time * hueSpeed; // respects dt/timeScale
      if (typeof ctx.createConicGradient === 'function') {
        const grad = ctx.createConicGradient(timeForHue, 0, 0);
        grad.addColorStop(0.00, 'rgba(255,200,0,0.95)');
        grad.addColorStop(0.30, 'rgba(255,120,0,1.00)');
        grad.addColorStop(0.60, 'rgba(255,0,0,0.95)');
        grad.addColorStop(1.00, 'rgba(255,200,0,0.95)');
        strokeStyle = grad;
      }

      ctx.strokeStyle = strokeStyle;
      ctx.lineWidth = thickness;

      // Wavy ring
      ctx.beginPath();
      const step = Math.PI * 2 / 180; // ~2°
      const speedTerm = this.time / (1 / flameSpeed);
      for (let a = 0; a <= Math.PI * 2 + 1e-3; a += step) {
        const wave = Math.sin(a * flameFreq + speedTerm) * flameAmp;
        const r = radius + wave;
        const px = Math.cos(a) * r;
        const py = Math.sin(a) * r;
        if (a === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();

      ctx.restore();
      return true;
    }
  };
}

// (kept for reference; unused now, but harmless to keep)
// tiny visual for a simple expanding ring
function makeRingEffect(x, y, r){
  return {
    t: 0, dur: 0.35, x, y, r,
    draw(dt){
      this.t += dt;
      const k = clamp(this.t/this.dur, 0, 1);
      ctx.strokeStyle = `rgba(255,150,80,${1-k})`;
      ctx.lineWidth = 6*(1-k) + 1;
      ctx.beginPath(); ctx.arc(this.x, this.y, this.r*(0.8 + 0.3*k), 0, Math.PI*2); ctx.stroke();
      return this.t < this.dur;
    }
  };
}

// ================= Upgrades (dmg / rof / range) =================
Engine.registerUpgrade('dmg', {
  title: 'Damage',
  desc: 'Increase core damage (+5 per level).',
  cost(level) { const base=20, k=1.5; return Math.floor(base * Math.pow(k, level)); },
  apply(c, level) { if (level) c.damage = c.baseDamage + 5 * level; }
});

Engine.registerUpgrade('rof', {
  title: 'Fire Rate',
  desc: 'Increase core fire rate (+0.2 per level).',
  cost(level) { const base=20, k=1.5; return Math.floor(base * Math.pow(k, level)); },
  apply(c, level) { if (level) c.fireRate = c.baseFireRate + 0.2 * level; }
});

Engine.registerUpgrade('range', {
  title: 'Range',
  desc: 'Increase attack range (+12 per level).',
  cost(level) { const base=20, k=1.5; return Math.floor(base * Math.pow(k, level)); },
  apply(c, level) { if (level) c.range = c.baseRange + 12 * level; }
});

// ================= Ability: Nova =================
Engine.registerAbility('nova', {
  title: 'Nova',
  hint: 'Q',
  enabled: true,
  radius: 110,
  cd: 10,
  cdLeft: 0,
  damageBase: 35,
  damageCoef: 0.6,
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

    // animated nova ring
    effects.push(makeNovaFireRing(core.x(), core.y(), {
      radius: this.radius + 10,
      thickness: 16,
      flameFreq: 12,
      flameAmp: 5,
      flameSpeed: 0.07,
      hueSpeed: 2.5,
      dur: 0.65
    }));
    // optional outer shockwave for extra oomph
    effects.push(makeNovaFireRing(core.x(), core.y(), {
      radius: this.radius + 26,
      thickness: 6,
      flameFreq: 6,
      flameAmp: 2,
      flameSpeed: 0.05,
      hueSpeed: 1.5,
      dur: 0.5
    }));

    return true; // Engine’s ability bridge should apply cooldown
  }
});

// ================= Ability: Frost =================
// All slow logic is applied via Engine enemyModifier hook (no main.js coupling)
const frostDef = {
  title: 'Frost',
  hint: 'W',
  enabled: true,
  radius: 140,
  cd: 12,
  cdLeft: 0,

  // public state for visuals
  zones: [],            // [{ x, y, r, until }]
  duration: 5.0,
  slow: 0.35,           // 35% slow

  cast() {
    if (this.cdLeft > 0 || this.enabled === false) return false;
    const until = performance.now()/1000 + this.duration;
    this.zones.length = 0;
    this.zones.push({ x: core.x(), y: core.y(), r: this.radius, until });
    return true; // Engine’s ability bridge should apply cooldown
  },

  drawOverlay() {
    const z = this.zones[0];
    if (!z) return;
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

// ================= Hook: apply Frost slow (mod-only) =================
const removeFrostSlow = Engine.addEnemyModifier((enemy/*, dt*/) => {
  const frost = Engine.registry?.abilities?.frost;
  if (!frost?.enabled) return null;

  const z = frost.zones?.[0];
  if (!z) return null;

  const now = performance.now()/1000;
  if (now >= z.until) { frost.zones.length = 0; return null; }

  const p = enemy.pos;
  const dx = p.x - z.x, dy = p.y - z.y;
  if ((dx*dx + dy*dy) > (z.r*z.r)) return null;

  const s = Math.max(0, Math.min(0.95, frost.slow ?? 0));
  const slow = enemy.boss ? Math.min(s, 0.20) : s;
  return { speedMul: 1 - slow, atkMul: 1 / (1 - slow) };
});

// ================= Hook: draw frost overlay (mod-only) =================
const removeOverlay = Engine.addOverlayDrawer(() => {
  const frost = Engine.registry?.abilities?.frost;
  frost?.drawOverlay?.();
});

// ================= Hook: clean up on reset =================
const removeReset = Engine.addResetHook(() => {
  const frost = Engine.registry?.abilities?.frost;
  if (frost) { frost.zones.length = 0; frost.cdLeft = 0; }
  const nova = Engine.registry?.abilities?.nova;
  if (nova) nova.cdLeft = 0;
});

// ================= Optional hotkeys (Q/W) =================
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'q') Engine.castAbility?.('nova');
  if (k === 'w') Engine.castAbility?.('frost');
});
