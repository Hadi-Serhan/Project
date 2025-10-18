// src/engine.js
// Tiny Engine shim: registries + event bus + mod hooks + helpers.

const listeners = new Map(); // event -> Set<fn>
function on(evt, fn) { if (!listeners.has(evt)) listeners.set(evt, new Set()); listeners.get(evt).add(fn); return () => off(evt, fn); }
function off(evt, fn) { const set = listeners.get(evt); if (set) set.delete(fn); }
function emit(evt, payload) {
  const set = listeners.get(evt);
  if (set) for (const fn of set) { try { fn(payload); } catch (e) { console.warn('[Engine emit error]', evt, e); } }
}

// Simple deterministic-ish RNG (mulberry32)
function makeRng(seed = 1337) {
  let t = seed >>> 0;
  return function rng() {
    t += 0x6D2B79F5;
    let x = t;
    x = Math.imul(x ^ x >>> 15, x | 1);
    x ^= x + Math.imul(x ^ x >>> 7, x | 61);
    return ((x ^ x >>> 14) >>> 0) / 4294967296;
  };
}
let _rng = makeRng(1337);

// Registries (data-first)
const registry = {
  enemies: Object.create(null),
  abilities: Object.create(null),
  upgrades: Object.create(null),
  waves: Object.create(null), // optional: named wave recipes
};

// Factories/sinks are provided by the game at boot (so engine stays decoupled)
let enemyFactory = null;           // (def, waveNum, overrides) => enemyInstance
let goldSink = null;               // (amount) => void
let coreMutator = null;            // (fn(core)) => void

// ---- Wave recipe plumbing ----
let _defaultWaveRecipe = null;             // function | null
let _currentWaveRecipe  = (w)=>[];         // active recipe the game uses
let _waveRecipeBridge   = null;            // function(fn) from content.js

// ---- Mod hooks ----
const enemyModifiers = new Set();  // f(enemy, dt, ctx) -> {speedMul?, atkMul?}
const overlayDrawers = new Set();  // f(ctx) -> void
const resetHooks     = new Set();  // f() -> void

// ---- Bridges that mods/content can set/use ----
let abilityBridge = { register(){}, remove(){}, cast(){ return false; } };
let assetsBridge  = async (_manifest) => {}; // set by assets.js

// ---- Live state accessor (read-only reference for mods) ----
let stateAccessor = null; // () => ({ core, enemies, effects, projectiles })

const Engine = {
  registry,

  // Events
  on, off, emit,

  // RNG
  rng: () => _rng(),
  setSeed(seed) { _rng = makeRng(seed|0); },

  // Factories/sinks (set by main game)
  setEnemyFactory(fn) { enemyFactory = fn; },
  setGoldSink(fn)     { goldSink = fn; },
  setCoreMutator(fn)  { coreMutator = fn; },

  // Registration API (mods/content packs)
  registerEnemyType(id, def) { registry.enemies[id] = def; },
  registerAbility(id, def)   { registry.abilities[id] = def; },
  removeAbility(id)          { delete registry.abilities[id]; },
  registerUpgrade(id, def)   { registry.upgrades[id] = def; },
  registerWaveRecipe(id, def){ registry.waves[id] = def; },

  // ---- Wave recipe API used by content.js and mods ----
  setDefaultWaveRecipe(fn) {
    _defaultWaveRecipe = (typeof fn === 'function') ? fn : null;
    _currentWaveRecipe = _defaultWaveRecipe || ((w)=>[]);
  },
  // content.js calls this to give the engine a setter into its module scope
  setWaveRecipeBridge(bridgeFn) {
    _waveRecipeBridge = (typeof bridgeFn === 'function') ? bridgeFn : null;
    // keep content in sync with whatever recipe is active right now
    if (_waveRecipeBridge) {
      try { _waveRecipeBridge(_currentWaveRecipe); } catch (e) { console.warn('[Engine.setWaveRecipeBridge]', e); }
    }
  },
  // mods call this to activate a new recipe; engine forwards to content via the bridge
  setWaveRecipe(fn) {
    const next = (typeof fn === 'function') ? fn : (_defaultWaveRecipe || ((w)=>[]));
    _currentWaveRecipe = next;
    if (_waveRecipeBridge) {
      try { _waveRecipeBridge(next); } catch (e) { console.warn('[Engine.setWaveRecipe bridge]', e); }
    }
  },
  getWaveRecipe(waveNum) {
    try { return _currentWaveRecipe ? (_currentWaveRecipe(waveNum) || []) : []; }
    catch (e) { console.warn('[Engine.getWaveRecipe]', e); return []; }
  },
  // convenience alias for older code
  waveRecipe(w) { return Engine.getWaveRecipe(w); },
  // expose the default so content/mods can revert
  get defaultWaveRecipe() { return _defaultWaveRecipe; },

  // Runtime helpers
  spawnEnemy(id, waveNum = 1, overrides = {}) {
    const def = registry.enemies[id];
    if (!def) throw new Error(`Unknown enemy type: ${id}`);
    if (!enemyFactory) throw new Error('Enemy factory not set');
    return enemyFactory(def, waveNum, overrides);
  },
  addGold(amount) { if (goldSink) goldSink(amount|0); },
  modifyCore(fn)  { if (coreMutator) coreMutator(fn); },

  // ----- Ability bridge (pluggable by abilities.js or mods) -----
  setAbilityBridge(bridge) {
    abilityBridge = Object.assign({ register(){}, remove(){}, cast(){ return false; } }, bridge || {});
  },
  castAbility(id, args={}) {
    try { return !!abilityBridge.cast(id, args); } catch (e) { console.warn('[Engine.castAbility]', e); return false; }
  },

  // ----- Asset bridge (so mods can add/override art at runtime) -----
  setAssetsBridge(fn) { assetsBridge = fn || assetsBridge; },
  async setAssets(manifest = {}) { try { await assetsBridge(manifest); } catch (e) { console.warn('[Engine.setAssets]', e); } },

  // ----- State accessor for mods -----
  setStateAccessor(fn) { stateAccessor = fn; },
  // Back-compat alias (your earlier code used setStateApi):
  setStateApi(fn) { stateAccessor = fn; },
  get state() { return stateAccessor ? stateAccessor() : null; },

  // ----- Enemy modifier hook chain -----
  addEnemyModifier(fn) { if (typeof fn === 'function') enemyModifiers.add(fn); return () => enemyModifiers.delete(fn); },
  applyEnemyModifiers(enemy, dt, ctx) {
    let speedMul = 1.0, atkMul = 1.0;
    for (const fn of enemyModifiers) {
      try {
        const out = fn(enemy, dt, ctx) || {};
        if (Number.isFinite(out.speedMul)) speedMul *= out.speedMul;
        if (Number.isFinite(out.atkMul))   atkMul   *= out.atkMul;
      } catch (e) { console.warn('[Engine enemyModifier error]', e); }
    }
    if (!Number.isFinite(speedMul)) speedMul = 1.0;
    if (!Number.isFinite(atkMul))   atkMul   = 1.0;
    speedMul = Math.max(0, speedMul);
    atkMul   = Math.max(0.1, atkMul);
    return { speedMul, atkMul };
  },

  // ----- Overlay drawers (auras, fields, debug visuals) -----
  addOverlayDrawer(fn) { if (typeof fn === 'function') overlayDrawers.add(fn); return () => overlayDrawers.delete(fn); },
  drawOverlays(ctx) { for (const fn of overlayDrawers) { try { fn(ctx); } catch (e) { console.warn('[Engine overlay error]', e); } } },

  // ----- Reset hooks (mods clear their state on reset) -----
  addResetHook(fn) { if (typeof fn === 'function') resetHooks.add(fn); return () => resetHooks.delete(fn); },
  runResetHooks() { for (const fn of resetHooks) { try { fn(); } catch (e) { console.warn('[Engine reset hook error]', e); } } },
};

// For mods that may want global access later
window.Engine = Engine;

export default Engine;
