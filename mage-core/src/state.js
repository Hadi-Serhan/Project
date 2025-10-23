// mage-core/src/state.js
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

/* ─────────────────────────────────────────────────────────────
   STAT REGISTRY (for UI readouts; mods add entries here)
----------------------------------------------------------------*/
export const Stats = {
  _reg: Object.create(null),
  register(key, meta) { this._reg[key] = meta; },
  format(core, key) {
    const m = this._reg[key];
    if (!m) return '';
    if (typeof m.format === 'function') return m.format(core);
    const v = m.get ? m.get(core) : undefined;
    return `${m.label}: ${v ?? ''}`;
  },
  formatMany(core, keys, sep = ' • ') {
    return keys.map(k => this.format(core, k)).filter(Boolean).join(sep);
  },
};

/* ─────────────────────────────────────────────────────────────
   CORE SCHEMA (base & derived defaults; mods can extend)
----------------------------------------------------------------*/
export const CoreSchema = {
  _base: new Map(),     // key -> defaultValue | (core)=>value
  _derived: new Map(),  // key -> defaultValue | (core)=>value

  registerBase(key, def){ this._base.set(key, def); },
  registerDerived(key, def){ this._derived.set(key, def); },

  // Internals: per-core, one-shot “force reset” sets
  _ensureSets(c){
    if (!c.__forceBaseReset)    c.__forceBaseReset = new Set();
    if (!c.__forceDerivedReset) c.__forceDerivedReset = new Set();
  },
  // Public helpers: ask schema to re-seed specific keys on next reset
  forceBase(c, ...keys){ this._ensureSets(c); keys.forEach(k => c.__forceBaseReset.add(k)); },
  forceDerived(c, ...keys){ this._ensureSets(c); keys.forEach(k => c.__forceDerivedReset.add(k)); },

  // Reset/seed the core using schema (idempotent; no upgrade logic here)
  _resetCore(c){
    this._ensureSets(c);

    // Base: only fill if unset … unless forced for this reset
    for (const [k, def] of this._base) {
      if (c[k] === undefined || c.__forceBaseReset.has(k)) {
        c[k] = (typeof def === 'function') ? def(c) : def;
      }
    }

    // Derived: always recompute … or use force flag if you later need per-key control
    for (const [k, def] of this._derived) {
      if (c.__forceDerivedReset.size === 0 || c.__forceDerivedReset.has(k)) {
        c[k] = (typeof def === 'function') ? def(c) : def;
      }
    }

    // clear one-shot force flags after use
    c.__forceBaseReset.clear();
    c.__forceDerivedReset.clear();

    // HP clamp / init
    if (Number.isFinite(c.hpMax)) {
      const hp = (c.hp == null) ? c.hpMax : c.hp;
      c.hp = Math.min(Math.max(0, hp), c.hpMax|0);
    }
  }
};

// Seed vanilla schema — mods can extend this freely without touching the engine
CoreSchema.registerBase('baseDamage',   35);
CoreSchema.registerBase('baseFireRate', 1.2);
CoreSchema.registerBase('baseRange',    600);
CoreSchema.registerBase('hpMax',        1000);

// These derive from the base values each recompute
CoreSchema.registerDerived('damage',     (c) => c.baseDamage);
CoreSchema.registerDerived('fireRate',   (c) => c.baseFireRate);
CoreSchema.registerDerived('range',      (c) => c.baseRange);

// Common extension points (mods can add more via CoreSchema.registerDerived)
CoreSchema.registerDerived('armor',      0);
CoreSchema.registerDerived('hpRegen',    0);
CoreSchema.registerDerived('auraDps',    0);
CoreSchema.registerDerived('auraRadius', 0);
CoreSchema.registerDerived('critChance', 0);
CoreSchema.registerDerived('critMult',   1);
CoreSchema.registerDerived('goldMul',    1);
CoreSchema.registerDerived('dmgReduce',  0);
CoreSchema.registerDerived('goldBonusMul', 1);

/* ─────────────────────────────────────────────────────────────
   CANONICAL GAME STATE
----------------------------------------------------------------*/
export let gold = 0;
export let prestige = 0;
export let wave = 0;
export let waveRunning = false;
export let defeated = false;

export const lifetime = {
  bestWave: 0,
  timeAlived: 0, // seconds
};

export let waveStatus = 'No wave';

// Engine flags
export let paused = false;
export let timeScale = 1.0;
export let autoStart = false;

// Setters
export function setPaused(v){ paused = !!v; notifySubscribers(); }
export function setTimeScale(v){ timeScale = Math.max(0, v|0); notifySubscribers(); }
export function setAutoStart(v){ autoStart = !!v; notifySubscribers(); }

/* ─────────────────────────────────────────────────────────────
   UPGRADES (levels only; behavior & cost live in registry)
----------------------------------------------------------------*/
export const upgrades = {}; // id -> level (number)
function levelOf(id){ return upgrades[id] ?? 0; }
function setLevel(id, lvl){ upgrades[id] = Math.max(0, lvl|0); }

export function cost(id){
  const def = (Engine.registry?.upgrades || {})[id];
  const lvl = levelOf(id);
  if (def && typeof def.cost === 'function') {
    try { return Math.max(0, def.cost(lvl)|0); } catch {}
  }
  const base = 20, scale = 1.5;
  return Math.floor(base * Math.pow(scale, lvl));
}

/* ─────────────────────────────────────────────────────────────
   PUB/SUB for UI (Vue)
----------------------------------------------------------------*/
const subscribers = new Set();
export function subscribe(cb){ subscribers.add(cb); return () => subscribers.delete(cb); }

export function notifySubscribers(snapshot){
  const snap = snapshot ?? {
    wave, waveRunning, defeated,
    coreHP: core.hp,
    gold,
    costs: { dmg: cost('dmg'), rof: cost('rof'), range: cost('range') }, // back-compat
    costsAll: _computeUpgradeCosts(),  // dynamic
    cd: {},                            // UI can mirror abilities directly
    waveStatus,
    paused, timeScale, autoStart,
    readouts: _computeUpgradeReadouts(), // dynamic per upgrade using Stats
  };
  subscribers.forEach(fn => fn(snap));
}

function _computeUpgradeCosts(){
  const out = {};
  const reg = Engine.registry?.upgrades || {};
  for (const id of Object.keys(reg)) out[id] = cost(id);
  return out;
}

function _computeUpgradeReadouts(){
  const out = {};
  const reg = Engine.registry?.upgrades || {};
  for (const [id, def] of Object.entries(reg)) {
    let text = '';
    try {
      if (typeof def.readout === 'function') {
        text = def.readout(core, { Stats, upgrades });
      } else if (Array.isArray(def.readoutKeys) && def.readoutKeys.length) {
        text = Stats.formatMany(core, def.readoutKeys);
      }
    } catch (e) { console.warn('readout failed', id, e); }
    if (text) out[id] = text;
  }
  return out;
}

/* ─────────────────────────────────────────────────────────────
   CORE (tower) — schema-driven
----------------------------------------------------------------*/
export const core = {
  x: cx, y: cy, radius: 24,
  hp: undefined,
  _fireTimer: 0,

  applyUpgrades() {
    // If any upgrade touches a *base* key, force it to re-seed this reset.
    // Your hpmax upgrade writes to hpMax (a base field).
    CoreSchema.forceBase(this, 'hpMax');

    // 1) Reset all base/derived fields from schema
    CoreSchema._resetCore(this);

    // 2) Apply every registered upgrade dynamically
    const reg = Engine.registry?.upgrades || {};
    const ctx = { levelOf, clamp, canvas };
    for (const [id, def] of Object.entries(reg)) {
      const lvl = (typeof ctx.levelOf === 'function') ? ctx.levelOf(id) : 0;
      if (!lvl) continue;
      if (typeof def.apply === 'function') {
        try { def.apply(this, lvl, ctx); }
        catch (e) { console.warn('upgrade apply() failed', id, e); }
      }
    }

    // 3) Clamp HP after hpMax changes
    if (Number.isFinite(this.hpMax)) {
      this.hp = Math.min(this.hp ?? this.hpMax, this.hpMax|0);
    }
  },

  draw() {
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(this.x(), this.y(), Math.min(canvas.width, canvas.height)*0.32, 0, Math.PI*2); ctx.stroke();

    ctx.fillStyle = '#7cf';
    ctx.beginPath(); ctx.arc(this.x(), this.y(), this.radius, 0, Math.PI*2); ctx.fill();

    ctx.strokeStyle = 'rgba(124,252,255,0.2)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(this.x(), this.y(), this.range || 0, 0, Math.PI*2); ctx.stroke();
  }
};

// Allow mods to mutate the core safely (and persist their changes to base fields)
Engine.setCoreMutator((fn) => {
  try { fn(core); } catch (e) { console.warn('[Engine.setCoreMutator]', e); }
});

/* ─────────────────────────────────────────────────────────────
   CORE DEFAULTS FROM ENGINE (optional hook)
----------------------------------------------------------------*/
function _applyCoreDefaultsFromEngine() {
  const defs = (typeof Engine.getCoreDefaults === 'function')
    ? Engine.getCoreDefaults()
    : { damage: 25, fireRate: 1.2, range: 180, hpMax: 100 };

  // These are *base* values — keep using the schema
  if (Number.isFinite(defs.damage))   core.baseDamage   = defs.damage;
  if (Number.isFinite(defs.fireRate)) core.baseFireRate = defs.fireRate;
  if (Number.isFinite(defs.range))    core.baseRange    = defs.range;

  if (Number.isFinite(defs.hpMax) && defs.hpMax > 0) {
    core.hpMax = defs.hpMax|0;
    core.hp = Math.min(core.hp ?? core.hpMax, core.hpMax);
  }
}

// Initial load + recompute
_applyCoreDefaultsFromEngine();
core.applyUpgrades();

// React to future default changes (mods can call Engine.setCoreDefaults)
Engine.on('core:defaults', () => {
  _applyCoreDefaultsFromEngine();
  core.applyUpgrades();
  notifySubscribers();
});

/* ─────────────────────────────────────────────────────────────
   Collections
----------------------------------------------------------------*/
export const enemies = [];
export const projectiles = [];
export const effects = [];
export const activeSpawners = new Set();

export function setDefeated(){
  setDefeatedFlag(true);
  setWaveRunning(false);
  activeSpawners.clear();
}

/* ─────────────────────────────────────────────────────────────
   Engine bridges for mods
----------------------------------------------------------------*/
Engine.setStateApi({
  get core(){ return core; },
  get enemies(){ return enemies; },
  get projectiles(){ return projectiles; },
  get effects(){ return effects; },
  get upgrades(){ return upgrades; },
  get wave(){ return wave; },
  get timeScale(){ return timeScale; },
});

// Re-apply effects and notify UI as registry changes
Engine.on('registry:upgrade', () => { core.applyUpgrades(); notifySubscribers(); });
Engine.on('registry:upgrade:removed', () => { core.applyUpgrades(); notifySubscribers(); });

/* ─────────────────────────────────────────────────────────────
   Setters / convenience
----------------------------------------------------------------*/
export function setGold(v){ gold = v; }
export function setPrestige(v){ prestige = Math.max(0, v|0); }
export function setWave(v){ wave = v; }
export function setWaveRunning(v){ waveRunning = v; }
export function setDefeatedFlag(v){ defeated = v; }
export function setWaveStatus(text){ waveStatus = text; notifySubscribers(); }

export function getUpgradeLevel(id){ return upgrades[id] ?? 0; }
export function setUpgradeLevel(id, lvl){ setLevel(id, lvl); core.applyUpgrades(); notifySubscribers(); }

/* ─────────────────────────────────────────────────────────────
   RESETS
----------------------------------------------------------------*/

// ---- Run reset (wipe *run* upgrades, keep permanents) ----
export function resetRun() {
  // wipe run economy & flags
  gold = 0;
  wave = 0;
  waveRunning = false;
  defeated = false;
  waveStatus = 'No wave';

  // wipe run-only upgrade levels (belt & suspenders)
  const regU = (Engine.registry && Engine.registry.upgrades) || {};
  for (const k of Object.keys(upgrades)) delete upgrades[k];
  for (const id of Object.keys(regU)) delete upgrades[id];

  // clear battlefield
  enemies.length = 0;
  effects.length = 0;
  projectiles.length = 0;
  activeSpawners.clear();

  // recompute core from schema + (now-empty) run upgrades + permanents
  CoreSchema._resetCore(core);   // force schema defaults
  core.applyUpgrades();          // apply (now-empty) run upgrades
  try { Engine.applyPermToCore(core); } catch {}
  core.hp = core.hpMax;

  // let mods clean their own transient state
  try { Engine.runResetHooks(); } catch {}

  notifySubscribers();
}

// ---- Full wipe (permanents + prestige) used by “Hard Reset” ----
export function hardReset() {
  // Start from a clean run reset
  resetRun();

  // clear all permanent levels + prestige
  prestige = 0;
  try { Engine.setPermLevels({}); } catch {}
  try { Engine.emit('meta:levels', { levels: {} }); } catch {}

  // recompute core again with no permanents
  CoreSchema._resetCore(core);
  core.applyUpgrades();
  core.hp = core.hpMax;

  notifySubscribers();
}

/* ─────────────────────────────────────────────────────────────
   DEV HELPERS
----------------------------------------------------------------*/
window.__dumpCore = () => ({
  runUpgrades: { ...upgrades },
  permLevels:  (typeof Engine.getPermLevels === 'function') ? { ...Engine.getPermLevels() } : {},
  coreStats: {
    damage: core.damage, fireRate: core.fireRate, range: core.range,
    hpMax: core.hpMax, armor: core.armor, hpRegen: core.hpRegen,
    auraDps: core.auraDps, auraRadius: core.auraRadius
  }
});
console.log('[state] __dumpCore() ready — run this in DevTools to inspect.');

// Expose reset actions (harmless if also wired from main.js)
window.engine = window.engine || {};
window.engine.actions = Object.assign(window.engine.actions || {}, {
  reset: resetRun,
  hardReset,
});
