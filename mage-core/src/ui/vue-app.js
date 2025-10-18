// src/ui/vue-app.js
import Engine from '../engine.js';
import { cost } from '../state.js'; // uses dynamic defs in Engine.registry
const { createApp, reactive, onMounted, onBeforeUnmount } = Vue;

// Small helper to build dynamic UI slices from the engine registry
function buildUpgradesList() {
  const list = [];
  const reg = Engine.registry?.upgrades || {};
  for (const [id, def] of Object.entries(reg)) {
    list.push({
      id,
      title: def.title || id,
      desc: def.desc || '',
      cost: cost(id),
    });
  }
  // stable order: by title then id
  list.sort((a,b) => (a.title||'').localeCompare(b.title||'') || a.id.localeCompare(b.id));
  return list;
}

function buildAbilitiesList() {
  const list = [];
  const reg = Engine.registry?.abilities || {};
  for (const [id, def] of Object.entries(reg)) {
    list.push({
      id,
      title: def.title || (id.charAt(0).toUpperCase()+id.slice(1)),
      hint: def.hint || (id === 'nova' ? 'Q' : id === 'frost' ? 'W' : ''), // optional hints
      enabled: def.enabled !== false,
      cdLeft: Number(def.cdLeft || 0),
    });
  }
  // Sort with enabled first, then title
  list.sort((a,b) => (Number(b.enabled)-Number(a.enabled)) || a.title.localeCompare(b.title));
  return list;
}

createApp({
  setup() {
    const state = reactive({
      // snapshot fields from window.engine (kept as-is)
      wave: 0,
      coreHP: 0,
      gold: 0,
      costs: { dmg: 0, rof: 0, range: 0 }, // legacy for older parts of UI
      cd: { nova: 0, frost: 0 },
      waveStatus: 'No wave',
      hasSave: false,
      lastSaved: null,
      lastSavedLabel: '—',
      paused: false,
      timeScale: 1,
      autoStart: false,

      // NEW dynamic UI lists
      upgradesList: [],
      abilitiesList: [],
    });

    // read snapshot via the exposed engine API
    const unsub = window.engine?.subscribe?.((snap) => {
      state.wave        = snap.wave;
      state.coreHP      = snap.coreHP;
      state.gold        = snap.gold;
      state.costs       = snap.costs;
      state.cd          = snap.cd;
      state.waveStatus  = snap.waveStatus;
      state.hasSave     = snap.hasSave;
      state.lastSaved   = snap.lastSaved;
      state.paused      = snap.paused;
      state.timeScale   = snap.timeScale;
      state.autoStart   = snap.autoStart;

      // labels
      state.lastSavedLabel = snap.lastSaved ? new Date(snap.lastSaved).toLocaleTimeString() : '—';

      // refresh lists when snapshot changes (prices can change as levels go up)
      state.upgradesList  = buildUpgradesList();
      // keep abilities order & names stable, but update cdLeft from registry live below
    });

    // Listen to registry changes so UI updates when mods add/remove items
    const offU1 = Engine.on('registry:upgrade', () => {
      state.upgradesList = buildUpgradesList();
    });
    const offU2 = Engine.on('registry:upgrade:removed', () => {
      state.upgradesList = buildUpgradesList();
    });
    const offA1 = Engine.on('registry:ability', () => {
      state.abilitiesList = buildAbilitiesList();
    });
    const offA2 = Engine.on('registry:ability:removed', () => {
      state.abilitiesList = buildAbilitiesList();
    });

    // Initial lists
    state.upgradesList  = buildUpgradesList();
    state.abilitiesList = buildAbilitiesList();

    // Lightweight ticker to refresh ability cooldowns from Engine.registry
    let rafId = 0;
    const tick = () => {
      const reg = Engine.registry?.abilities || {};
      let changed = false;
      for (const item of state.abilitiesList) {
        const def = reg[item.id];
        if (!def) continue;
        const next = Number(def.cdLeft || 0);
        const nextEnabled = def.enabled !== false;
        if (next !== item.cdLeft || nextEnabled !== item.enabled) {
          item.cdLeft = next;
          item.enabled = nextEnabled;
          changed = true;
        }
      }
      // re-request even if nothing changed; tiny cost
      rafId = requestAnimationFrame(tick);
    };

    onMounted(() => { rafId = requestAnimationFrame(tick); });
    onBeforeUnmount(() => {
      if (rafId) cancelAnimationFrame(rafId);
      offU1 && offU1(); offU2 && offU2(); offA1 && offA1(); offA2 && offA2();
      unsub && unsub();
    });

    // Actions (proxy to engine)
    const startWave   = () => window.engine.actions.startWave();
    const reset       = () => window.engine.actions.reset();
    const buy         = (id) => window.engine.actions.buy(id);
    const cast        = (id) => {
      // prefer engine.castAbility when available; fallback to specific actions
      if (typeof Engine.castAbility === 'function') Engine.castAbility(id);
      else if (id === 'nova') window.engine.actions.cast('nova');
      else if (id === 'frost') window.engine.actions.cast('frost');
    };
    const togglePause = () => window.engine.actions.togglePause();
    const setSpeed    = (n) => window.engine.actions.setSpeed(n);
    const setAutoStart= (v) => window.engine.actions.setAutoStart(v);
    const saveNow     = () => window.engine.actions.saveNow();
    const loadSave    = () => window.engine.actions.loadSave();
    const wipeSave    = () => window.engine.actions.wipeSave();

    return {
      ...Vue.toRefs(state),
      startWave, reset, buy, cast,
      togglePause, setSpeed, setAutoStart,
      saveNow, loadSave, wipeSave,
    };
  }
}).mount('#app');
