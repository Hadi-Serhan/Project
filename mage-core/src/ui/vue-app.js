// mage-core/src/ui/vue-app.js
import Engine from '../engine.js';
import { cost } from '../state.js';
const { createApp, reactive, onMounted, onBeforeUnmount } = Vue;

// initial UI snapshot defaults
const initialState = {
  wave: 0,
  coreHP: 0,
  gold: 0,
  costs: { dmg: 0, rof: 0, range: 0 },
  cd: {},
  waveStatus: 'No wave',
  hasSave: false,
  lastSaved: null,
  lastSavedLabel: '—',
  paused: false,
  timeScale: 1,
  autoStart: false,
  upgradesList: [],
  abilitiesList: [],
};

function buildUpgradesList() {
  const reg = Engine.registry?.upgrades || {};
  const list = Object.entries(reg).map(([id, def]) => ({
    id,
    title: def.title || id,
    desc: def.desc || '',
    cost: cost(id),
  }));
  list.sort((a,b) => (a.title||'').localeCompare(b.title||'') || a.id.localeCompare(b.id));
  return list;
}

function buildAbilitiesList() {
  const reg = Engine.registry?.abilities || {};
  const list = Object.entries(reg).map(([id, def]) => ({
    id,
    title: def.title || (id.charAt(0).toUpperCase()+id.slice(1)),
    hint: def.hint || '',
    enabled: def.enabled !== false,
    cdLeft: Number(def.cdLeft || 0),
  }));
  // enabled first, then title
  list.sort((a,b) => (Number(b.enabled)-Number(a.enabled)) || a.title.localeCompare(b.title));
  return list;
}

createApp({
  setup() {
    const state = reactive({ ...initialState });
    let unsub = null;
    let rafId = 0;

    const refreshLists = () => {
      state.upgradesList  = buildUpgradesList();
      state.abilitiesList = buildAbilitiesList();
    };

    onMounted(() => {
      if (window.engine?.getSnapshot) {
        Object.assign(state, window.engine.getSnapshot());
        state.lastSavedLabel = state.lastSaved ? new Date(state.lastSaved).toLocaleTimeString() : '—';
      }
      if (window.engine?.subscribe) {
        unsub = window.engine.subscribe((snap) => {
          Object.assign(state, snap);
          state.lastSavedLabel = snap.lastSaved ? new Date(snap.lastSaved).toLocaleTimeString() : '—';
          // upgrade costs can change after purchase:
          refreshLists();
        });
      }

      // registry change listeners (mods can add/remove stuff)
      const offU1 = Engine.on('registry:upgrade', refreshLists);
      const offU2 = Engine.on('registry:upgrade:removed', refreshLists);
      const offA1 = Engine.on('registry:ability', refreshLists);
      const offA2 = Engine.on('registry:ability:removed', refreshLists);

      // initial lists
      refreshLists();

      // cooldown ticker mirrors Engine.registry ability cdLeft
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
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);

      // cleanup
      onBeforeUnmount(() => {
        if (rafId) cancelAnimationFrame(rafId);
        offU1 && offU1(); offU2 && offU2(); offA1 && offA1(); offA2 && offA2();
        unsub && unsub();
      });
    });

    // actions -> engine
    const startWave    = () => window.engine.actions.startWave();
    const reset        = () => window.engine.actions.reset();
    const buy          = (id) => window.engine.actions.buy(id);
    const cast         = (id) => (typeof Engine.castAbility === 'function') && Engine.castAbility(id);
    const togglePause  = () => window.engine.actions.togglePause();
    const setSpeed     = (n) => window.engine.actions.setSpeed(n);
    const setAutoStart = (v) => window.engine.actions.setAutoStart(v);
    const saveNow      = () => window.engine.actions.saveNow();
    const loadSave     = () => window.engine.actions.loadSave();
    const wipeSave     = () => window.engine.actions.wipeSave();

    return {
      ...Vue.toRefs(state),
      startWave, reset, buy, cast,
      togglePause, setSpeed, setAutoStart,
      saveNow, loadSave, wipeSave,
    };
  }
}).mount('#app');
