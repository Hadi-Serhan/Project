// mage-core/src/engine.js

// Event Bus
const listeners = new Map(); // event -> Set<fn>
function on(evt, fn) { if (!listeners.has(evt)) listeners.set(evt, new Set()); listeners.get(evt).add(fn); return () => off(evt, fn); }
function off(evt, fn) { const set = listeners.get(evt); if (set) set.delete(fn); }
function emit(evt, payload) {
  const set = listeners.get(evt);
  if (set) for (const fn of set) { try { fn(payload); } catch (e) { console.warn('[Engine emit error]', evt, e); } }
}

// RNG (mulberry32)
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

// Registries 
const registry = {
  enemies: Object.create(null),
  abilities: Object.create(null),
  upgrades: Object.create(null),
  waves: Object.create(null),
  animProfiles: Object.create(null),
};

// --- Permanent upgrade price resolver (mods can override per item) ---
function _permCostFallback(level){
  return 5 + Math.floor(Math.pow(1.35, level|0));
}

function _getPermanentPrice(kind, id, level = 0, ctx = {}) {
  // kind: "upgrade" | "ability"
  if (kind === 'upgrade') {
    const def = registry.upgrades[id];
    if (def && typeof def.permanentCost === 'function') {
      try { return Math.max(0, def.permanentCost(level|0, ctx)|0); } catch {}
    }
  } else if (kind === 'ability') {
    const ab = registry.abilities[id];
    if (ab && typeof ab.permanentCost === 'function') {
      try { return Math.max(0, ab.permanentCost(level|0, ctx)|0); } catch {}
    }
  }
  return _permCostFallback(level|0);
}

// Factories / sinks (provided by main game)
let enemyFactory = null;     // (def, waveNum, overrides) => enemyInstance
let goldSink = null;         // (amount) => void
let coreMutator = null;      // (fn(core)) => void

// queue modifyCore calls until coreMutator is installed
const _pendingCoreMods = [];

// Wave recipe plumbing
let _defaultWaveRecipe = null;
let _currentWaveRecipe  = (w)=>[];
let _waveRecipeBridge   = null;

// Mod hooks
const enemyModifiers = new Set();  // f(enemy, dt, ctx) -> {speedMul?, atkMul?}
const overlayDrawers = new Set();  // f(ctx) -> void
const resetHooks     = new Set();  // f() -> void

// Bridges
let abilityBridge = { register(){}, remove(){}, cast(){ return false; } };
let assetsBridge  = async (_manifest) => {};

// Live state accessor
let stateAccessor = null; // () => ({ core, enemies, effects, projectiles, upgrades, gold, prestige })

// Permanent Upgrades
let _permLevels = Object.create(null); // id -> level (numbers)
let _abilityCdMul = 1;                 // global CD mul 
const _prestigeRules = new Set();      // (evt) => non-negative integer

// Readout formatting bridge 
let _readoutFormatter = null; // (core, def) => string

// Helper
const _num = (n, d=0) => Number.isFinite(n) ? n : d;

const Engine = {
  registry,

  // Events
  on, off, emit,

  // RNG
  rng: () => _rng(),
  setSeed(seed) { _rng = makeRng(seed|0); },

  getPermanentPrice(kind, id, level = 0, ctx = {}) { return _getPermanentPrice(kind, id, level, ctx); },

  // Factories / sinks
  setEnemyFactory(fn) { enemyFactory = fn; },
  setGoldSink(fn)     { goldSink = fn; },
  setCoreMutator(fn)  {
    coreMutator = fn;
    if (_pendingCoreMods.length) {
      try {
        for (const modFn of _pendingCoreMods.splice(0)) {
          try { coreMutator(modFn); } catch (e) { console.warn('[Engine.setCoreMutator pending core mod error]', e); }
        }
      } finally { /* no-op */ }
    }
  },

  // Registration
  registerEnemyType(id, def) { registry.enemies[id] = def; },
  registerAbility(id, def)   { registry.abilities[id] = def; emit('registry:ability', { id, def }); },
  removeAbility(id)          { delete registry.abilities[id]; emit('registry:ability:removed', { id }); },
  registerUpgrade(id, def)   { registry.upgrades[id] = def; emit('registry:upgrade', { id, def }); },
  registerWaveRecipe(id, fn) { registry.waves[id] = fn; },

  // Waves
  setDefaultWaveRecipe(fn) {
    _defaultWaveRecipe = (typeof fn === 'function') ? fn : null;
    _currentWaveRecipe = _defaultWaveRecipe || ((w)=>[]);
  },
  setWaveRecipeBridge(bridgeFn) {
    _waveRecipeBridge = (typeof bridgeFn === 'function') ? bridgeFn : null;
    if (_waveRecipeBridge) {
      try { _waveRecipeBridge(_currentWaveRecipe); } catch (e) { console.warn('[Engine.setWaveRecipeBridge]', e); }
    }
  },
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
  waveRecipe(w) { return Engine.getWaveRecipe(w); },
  get defaultWaveRecipe() { return _defaultWaveRecipe; },

  // Runtime helpers
  spawnEnemy(id, waveNum = 1, overrides = {}) {
    const def = registry.enemies[id];
    if (!def) throw new Error(`Unknown enemy type: ${id}`);
    if (!enemyFactory) throw new Error('Enemy factory not set');
    return enemyFactory(def, waveNum, overrides);
  },
  addGold(amount) { if (goldSink) goldSink(amount|0); },

  // Allow mods/packs to change core safely at any time
  modifyCore(fn) {
    if (typeof fn !== 'function') return;
    if (coreMutator) {
      try { coreMutator(fn); } catch (e) { console.warn('[Engine.modifyCore error]', e); }
    } else {
      _pendingCoreMods.push(fn);
    }
  },

  // Ability bridge
  setAbilityBridge(bridge) {
    abilityBridge = Object.assign({ register(){}, remove(){}, cast(){ return false; } }, bridge || {});
  },
  castAbility(id, args={}) {
    try { return !!abilityBridge.cast(id, args); } catch (e) { console.warn('[Engine.castAbility]', e); return false; }
  },
  getAbilityCooldownMul(){ return _abilityCdMul; },
  setAbilityCooldownMul(m){ _abilityCdMul = _num(m,1) > 0 ? m : 1; },

  // Asset bridge
  setAssetsBridge(fn) { assetsBridge = fn || assetsBridge; },
  async setAssets(manifest = {}) { try { await assetsBridge(manifest); } catch (e) { console.warn('[Engine.setAssets]', e); } },

  // Animation profiles
  setAnimProfile(typeOrKey, profile) {
    const cur = registry.animProfiles[typeOrKey] || {};
    registry.animProfiles[typeOrKey] = { ...cur, ...profile };
    emit('anim:profile', { id: typeOrKey, profile: registry.animProfiles[typeOrKey] });
  },
  resolveAnimProfile(typeId, isBoss, fallbackProfile, defAnimOverride) {
    const fromReg = registry.animProfiles[typeId]
                 || (isBoss ? registry.animProfiles.boss : registry.animProfiles.default)
                 || {};
    return { ...fallbackProfile, ...fromReg, ...(defAnimOverride || {}) };
  },

  // State accessor
  setStateApi(objOrFn) {
    // Accept a function OR a plain object
    if (typeof objOrFn === 'function') {
      stateAccessor = objOrFn;
    } else {
      const snapshot = objOrFn || {};
      stateAccessor = () => snapshot;
    }
  },
  setStateAccessor(fn) { // back-compat
    stateAccessor = (typeof fn === 'function') ? fn : () => (fn || {});
  },
  get state() {
    try { return stateAccessor ? stateAccessor() : null; }
    catch { return null; }
  },

  // Enemy modifiers & overlays
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
  addOverlayDrawer(fn) { if (typeof fn === 'function') overlayDrawers.add(fn); return () => overlayDrawers.delete(fn); },
  drawOverlays(ctx) { for (const fn of overlayDrawers) { try { fn(ctx); } catch (e) { console.warn('[Engine overlay error]', e); } } },
  addResetHook(fn) { if (typeof fn === 'function') resetHooks.add(fn); return () => resetHooks.delete(fn); },
  runResetHooks() { for (const fn of resetHooks) { try { fn(); } catch (e) { console.warn('[Engine reset hook error]', e); } } },

  ///////////////////////
  // Prestige & Permanent Upgrades
  ///////////////////////

  getPermLevels() { return { ..._permLevels }; },
  setPermLevels(levels = {}) {
    _permLevels = Object.create(null);
    for (const [k, v] of Object.entries(levels || {})) _permLevels[k] = v|0;
    emit('meta:levels', { levels: Engine.getPermLevels() });
  },
  serializePerm() { return Engine.getPermLevels(); },

  // Optional helper for mods: get level for a specific ability id
  getAbilityPermLevel(id){ return _permLevels[`ability:${id}`]|0; },

  applyPermToCore(core) {
    if (!core) return;

    // multipliers (used by other systems)
    let dmgMul = 1.0, rofMul = 1.0, goldMul = 1.0, cdMul = 1.0;

    // ---- Upgrades: check per-upgrade id perms ----
    for (const [id, def] of Object.entries(registry.upgrades)) {
      const lvl = _permLevels[id] | 0;
      if (lvl <= 0) continue;

      if (typeof def.permanentApply === 'function') {
        try { def.permanentApply(core, lvl, { id, def, levels: _permLevels }); }
        catch (e) { console.warn('[Engine permanentApply error]', id, e); }
        continue;
      }

      const key = id.toLowerCase();
      if (key.includes('dmg') || key.includes('damage')) {
        dmgMul *= Math.pow(1.05, lvl);
      } else if (key.includes('rof') || key.includes('speed') || key.includes('firerate') || key.includes('rate')) {
        rofMul *= Math.pow(1.03, lvl);
      } else if (key.includes('range')) {
        if (Number.isFinite(core.range)) core.range = Math.round(core.range * Math.pow(1.02, lvl));
      } else if (key.includes('gold') || key.includes('loot')) {
        goldMul *= Math.pow(1.05, lvl);
      } else if (key.includes('ability') || key.includes('cooldown') || key.includes('cd')) {
        cdMul *= Math.pow(0.96, lvl);
      }
    }

    // Stamp multipliers & apply common ones
    core.perm = { dmgMul, rofMul, goldMul, cdMul };
    if (Number.isFinite(core.damage))   core.damage   = Math.round(core.damage * dmgMul);
    if (Number.isFinite(core.fireRate)) core.fireRate = core.fireRate * rofMul;
    core.goldMul = goldMul;
    Engine.setAbilityCooldownMul(cdMul);

    // ---- Abilities: support per-ability permanent levels ----
    for (const [abId, ab] of Object.entries(registry.abilities)) {
      const lvl = _permLevels[`ability:${abId}`] | 0;
      if (lvl <= 0) continue;

      if (typeof ab.permanentApply === 'function') {
        try { ab.permanentApply(lvl, { id: abId, ability: ab, core, levels: _permLevels }); }
        catch (e) { console.warn('[Engine ability permanentApply error]', abId, e); }
        continue;
      }

      // Generic heuristics
      if (Number.isFinite(ab.cd)) {
        ab.cd = Math.max(0.5, ab.cd * Math.pow(0.97, lvl));
      }
      if (Number.isFinite(ab.damageBase)) {
        ab.damageBase = Math.round(ab.damageBase * Math.pow(1.02, lvl));
      }
      if (Number.isFinite(ab.radius)) {
        ab.radius = Math.round(ab.radius * Math.pow(1.015, lvl));
      }
    }

    emit('meta:apply', { levels: Engine.getPermLevels() });
  },

  addPrestigeRule(fn){ if (typeof fn === 'function') _prestigeRules.add(fn); return () => _prestigeRules.delete(fn); },
  calcPrestigeAward(evt){
    let sum = 0;
    for (const fn of _prestigeRules) {
      let v = 0;
      try { v = fn(evt)|0; } catch(e){ v = 0; console.warn('[Engine prestige rule error]', e); }
      if (v > 0) sum += v;
    }
    return sum|0;
  },

  resetPrestigeRules() {
    _prestigeRules.clear();
  },
  setPrestigeRules(rules = []) {
    _prestigeRules.clear();
    for (const fn of rules) if (typeof fn === 'function') _prestigeRules.add(fn);
  },

  // --------- Readout formatter bridge (set by state.js) ----------
  setReadoutFormatter(fn){ _readoutFormatter = (typeof fn === 'function') ? fn : null; },

  // --------- Snapshot for menus / overlay ----------
  getSnapshot(){
    const S = Engine.state || {};
    const regU = registry.upgrades || {};
    const regA = registry.abilities || {};
    const core = S.core;

    // permanent upgrades for menu
    const permanent = Object.entries(regU).map(([id, def]) => {
      const level = (Engine.getPermLevels()?.[id] | 0) || 0;
      const price = _getPermanentPrice('upgrade', id, level, { core, levels: Engine.getPermLevels() });
      return {
        kind: 'upgrade',
        id: 'upgrade:' + id, // overlay returns this id on buy
        title: def.title || id,
        level,
        price
      };
    });

    // abilities (optional permanent levels)
    const abilities = Object.entries(regA).map(([id, def]) => {
      const pl = (Engine.getPermLevels()?.['ability:'+id] | 0) || 0;
      const price = _getPermanentPrice('ability', id, pl, { core, levels: Engine.getPermLevels() });
      return {
        id,
        title: def.title || id,
        hint: def.hint || '',
        cd: Number(def.cd || 0),
        permLevel: pl,
        permPrice: price
      };
    });

    // readouts (id + "upgrade:id")
    const readouts = {};
    if (core) {
      for (const [id, def] of Object.entries(regU)) {
        let line = '';
        try {
          if (_readoutFormatter) line = _readoutFormatter(core, def) || '';
          else if (typeof def.readout === 'function') line = def.readout(core, { levels: Engine.getPermLevels() }) || '';
        } catch (e) { /* ignore */ }
        if (line) { readouts[id] = line; readouts['upgrade:'+id] = line; }
      }
    }

    return {
      gold: S.gold|0,
      prestige: S.prestige|0,
      lastSaved: Engine._lastSaved || null,
      permanent,
      abilities,
      readouts,
    };
  },
};

window.Engine = Engine;

// After a permanent buy, re-apply perms and upgrades immediately so readouts change
Engine.on('meta:buy', () => {
  try {
    const S = Engine.state || {};
    if (!S.core) return;
    Engine.applyPermToCore(S.core);
    S.core.applyUpgrades?.();
  } catch (e) {
    console.warn('[Engine meta:buy reapply]', e);
  }
});

export default Engine;
