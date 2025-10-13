// Tiny Engine shim: registries + event bus + helpers.
// Mods will talk to THIS instead of internals.

const listeners = new Map(); // event -> Set<fn>

function on(evt, fn) {
  if (!listeners.has(evt)) listeners.set(evt, new Set());
  listeners.get(evt).add(fn);
  return () => off(evt, fn);
}
function off(evt, fn) {
  const set = listeners.get(evt);
  if (set) set.delete(fn);
}
function emit(evt, payload) {
  const set = listeners.get(evt);
  if (set) for (const fn of set) { try { fn(payload); } catch {} }
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
  waves: Object.create(null),
};

// Factories/sinks are provided by the game at boot (so engine stays decoupled)
let enemyFactory = null;           // (def, waveNum, overrides) => enemyInstance
let goldSink = null;               // (amount) => void
let coreMutator = null;            // (fn) => void

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

  // Registration API (mods/content packs will call these)
  registerEnemyType(id, def) { registry.enemies[id] = def; },
  registerAbility(id, def)   { registry.abilities[id] = def; },
  registerUpgrade(id, def)   { registry.upgrades[id] = def; },
  registerWaveRecipe(id, def){ registry.waves[id] = def; },

  // Runtime helpers
  spawnEnemy(id, waveNum = 1, overrides = {}) {
    const def = registry.enemies[id];
    if (!def) throw new Error(`Unknown enemy type: ${id}`);
    if (!enemyFactory) throw new Error('Enemy factory not set');
    return enemyFactory(def, waveNum, overrides);
  },
  addGold(amount) { if (goldSink) goldSink(amount|0); },
  modifyCore(fn)  { if (coreMutator) coreMutator(fn); },
};

// For mods that may want global access later
window.Engine = Engine;

export default Engine;
