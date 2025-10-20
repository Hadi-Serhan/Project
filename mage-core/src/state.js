//mage-core/src/state.js
import Engine from './engine.js';

// ===== Canvas / basics =====
export const canvas = document.getElementById('game');
export const ctx = canvas.getContext('2d');

function resize(){ canvas.width = canvas.clientWidth; canvas.height = canvas.clientHeight; }
window.addEventListener('resize', resize); resize();

export const cx = () => canvas.width / 2;
export const cy = () => canvas.height / 2;

export function dist(ax, ay, bx, by){ const dx=ax-bx, dy=ay-by; return Math.hypot(dx, dy); }
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ===== Canonical game state =====
export let gold = 0;
export let wave = 0;
export let waveRunning = false;
export let defeated = false;

export let waveStatus = 'No wave';

// Engine flags
export let paused = false;
export let timeScale = 1.0;
export let autoStart = false;

// Setters
export function setPaused(v){ paused = !!v; notifySubscribers(); }
export function setTimeScale(v){ timeScale = Math.max(0, v|0); notifySubscribers(); }
export function setAutoStart(v){ autoStart = !!v; notifySubscribers(); }

// ===== Upgrades (levels only; behavior & cost live in Engine.registry.upgrades) =====
export const upgrades = {}; // id -> level (number)

function levelOf(id){ return upgrades[id] ?? 0; }
function setLevel(id, lvl){ upgrades[id] = Math.max(0, lvl|0); }

// Pricing uses the upgrade’s def.cost(level) if provided; can be anything (nonlinear, etc.)
export function cost(id){
  const def = Engine.registry.upgrades[id];
  const lvl = levelOf(id);
  if (def && typeof def.cost === 'function') {
    try { return Math.max(0, def.cost(lvl)|0); } catch { /* fall through */ }
  }
  // sensible fallback if a mod forgets cost():
  const base = 20, scale = 1.5;
  return Math.floor(base * Math.pow(scale, lvl));
}

// ===== Pub/Sub for UI (Vue) =====
const subscribers = new Set();
export function subscribe(cb){ subscribers.add(cb); return () => subscribers.delete(cb); }
export function notifySubscribers(snapshot){
  const snap = snapshot ?? {
    wave, waveRunning, defeated,
    coreHP: core.hp,
    gold,
    // expose dynamic costs for known base upgrades; UI can also iterate Engine.registry.upgrades
    costs: { dmg: cost('dmg'), rof: cost('rof'), range: cost('range') },
    cd: { nova: 0, frost: 0 }, // main.js will send real values
    waveStatus,
    paused, timeScale, autoStart,
  };
  subscribers.forEach(fn => fn(snap));
}

// ===== Core (tower) =====
export const core = {
  x: cx, y: cy, radius: 24,

  // base stats
  baseDamage: 25,
  baseFireRate: 1.2,
  baseRange: 180,

  // live stats (computed)
  damage: 25,
  fireRate: 1.2,
  range: 180,

  hpMax: 100, hp: 100,
  _fireTimer: 0,

  // recompute from scratch each time using upgrade defs
  applyUpgrades() {
    // reset to base
    this.damage   = this.baseDamage;
    this.fireRate = this.baseFireRate;
    this.range    = this.baseRange;

    const ctx = {
      // useful helpers for mods
      levelOf,
      clamp,
      canvas,
    };

    // iterate all registered upgrades in the engine and apply their effects
    for (const [id, def] of Object.entries(Engine.registry.upgrades)) {
      const lvl = levelOf(id);
      if (!lvl) continue;
      if (def && typeof def.apply === 'function') {
        try { def.apply(this, lvl, ctx); } catch (e) { console.warn('upgrade apply() failed', id, e); }
      }
    }
  },

  draw() {
    // ground ring
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(this.x(), this.y(), Math.min(canvas.width, canvas.height)*0.32, 0, Math.PI*2); ctx.stroke();
    // body
    ctx.fillStyle = '#7cf';
    ctx.beginPath(); ctx.arc(this.x(), this.y(), this.radius, 0, Math.PI*2); ctx.fill();
    // range
    ctx.strokeStyle = 'rgba(124,252,255,0.2)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(this.x(), this.y(), this.range, 0, Math.PI*2); ctx.stroke();
  }
};
core.applyUpgrades();

// ===== Collections =====
export const enemies = [];
export const projectiles = [];
export const effects = [];
export const activeSpawners = new Set();

// Defeat helper
export function setDefeated(){
  setDefeatedFlag(true);
  setWaveRunning(false);
  activeSpawners.clear();
}

// ===== Engine bridges for mods =====

// Expose a read-only state surface (shallow) for mods if they need to inspect
Engine.setStateApi({
  get core(){ return core; },
  get enemies(){ return enemies; },
  get projectiles(){ return projectiles; },
  get effects(){ return effects; },
  get upgrades(){ return upgrades; },
  get wave(){ return wave; },
  get timeScale(){ return timeScale; },
});

// When upgrades are (re)registered/removed, you might want to recompute costs or stats.
// (We don’t auto-change levels; we just re-apply effects.)
Engine.on('registry:upgrade', () => { core.applyUpgrades(); notifySubscribers(); });
Engine.on('registry:upgrade:removed', ({ id }) => {
  // keep the level to avoid save-breaking; effect disappears because def is gone
  core.applyUpgrades(); notifySubscribers();
});

// Export setters used by other modules / UI
export function setGold(v){ gold = v; }
export function setWave(v){ wave = v; }
export function setWaveRunning(v){ waveRunning = v; }
export function setDefeatedFlag(v){ defeated = v; }
export function setWaveStatus(text){ waveStatus = text; notifySubscribers(); }

// convenience for other modules
export function getUpgradeLevel(id){ return levelOf(id); }
export function setUpgradeLevel(id, lvl){ setLevel(id, lvl); core.applyUpgrades(); notifySubscribers(); }
