// mage-core/src/ui/vue-app.js
import Engine from '../engine.js';
import { cost } from '../state.js';
const { createApp, reactive, computed, onMounted, onBeforeUnmount, toRefs } = Vue;

// --- helpers ---
function buildUpgradesList(readouts, costsAll) {
  const reg = Engine.registry?.upgrades || {};
  const list = Object.entries(reg).map(([id, def]) => ({
    id,
    category: def.category || 'General',
    title: def.title || id,
    desc: def.desc || '',
    // prefer dynamic cost from snapshot if present, fallback to cost()
    cost: (costsAll && Number.isFinite(costsAll[id])) ? costsAll[id] : cost(id),
    // NEW: show modular, live readout from snapshot (computed in state.js)
    readout: readouts?.[id] || '',
  }));
  list.sort((a,b) =>
    (a.category||'').localeCompare(b.category||'') ||
    (a.title||'').localeCompare(b.title||'') ||
    a.id.localeCompare(b.id)
  );
  return list;
}
function buildAbilitiesList() {
  const reg = Engine.registry?.abilities || {};
  const list = Object.entries(reg).map(([id, def]) => ({
    id,
    category: def.category || 'General',
    title: def.title || (id.charAt(0).toUpperCase()+id.slice(1)),
    hint: def.hint || '',
    enabled: def.enabled !== false,
    cdLeft: Number(def.cdLeft || 0),
  }));
  list.sort((a,b) =>
    (a.category||'').localeCompare(b.category||'') ||
    (Number(b.enabled)-Number(a.enabled)) ||
    a.title.localeCompare(b.title)
  );
  return list;
}
function uniqueCats(items) {
  const set = new Set(items.map(i => i.category || 'General'));
  return Array.from(set);
}

createApp({
  setup() {
    const state = reactive({
      // snapshot fields
      wave: 0, coreHP: 0, gold: 0,
      costs: { dmg:0, rof:0, range:0 },
      // NEW: dynamic map for all upgrade costs + modular readouts
      costsAll: {},
      readouts: {},

      cd: {}, waveStatus:'No wave', hasSave:false,
      lastSaved:null, lastSavedLabel:'—',
      paused:false, timeScale:1, autoStart:false,

      // data for tabs
      upgradesList: [],
      upgradeTabs: [],
      selectedUpgradeTab: 'All',   // “All” shows everything

      abilitiesList: [],
      abilityTabs: [],
      selectedAbilityTab: 'All',
    });

    // filtered views
    const filteredUpgrades = computed(() =>
      state.selectedUpgradeTab === 'All'
        ? state.upgradesList
        : state.upgradesList.filter(u => u.category === state.selectedUpgradeTab)
    );
    const filteredAbilities = computed(() =>
      state.selectedAbilityTab === 'All'
        ? state.abilitiesList
        : state.abilitiesList.filter(a => a.category === state.selectedAbilityTab)
    );

    const refreshLists = () => {
      state.upgradesList = buildUpgradesList(state.readouts, state.costsAll);
      const uCats = uniqueCats(state.upgradesList);
      state.upgradeTabs = ['All', ...uCats];
      if (!state.upgradeTabs.includes(state.selectedUpgradeTab)) state.selectedUpgradeTab = 'All';

      state.abilitiesList = buildAbilitiesList();
      const aCats = uniqueCats(state.abilitiesList);
      state.abilityTabs = ['All', ...aCats];
      if (!state.abilityTabs.includes(state.selectedAbilityTab)) state.selectedAbilityTab = 'All';
    };

    let unsub = null, rafId = 0;

    onMounted(() => {
      if (window.engine?.getSnapshot) {
        Object.assign(state, window.engine.getSnapshot());
        state.lastSavedLabel = state.lastSaved ? new Date(state.lastSaved).toLocaleTimeString() : '—';
      }
      if (window.engine?.subscribe) {
        unsub = window.engine.subscribe((snap) => {
          // bring in readouts & costsAll from state.js snapshot
          Object.assign(state, snap);
          state.lastSavedLabel = snap.lastSaved ? new Date(snap.lastSaved).toLocaleTimeString() : '—';
          refreshLists();
        });
      }

      const offU1 = Engine.on('registry:upgrade', refreshLists);
      const offU2 = Engine.on('registry:upgrade:removed', refreshLists);
      const offA1 = Engine.on('registry:ability', refreshLists);
      const offA2 = Engine.on('registry:ability:removed', refreshLists);

      refreshLists();

      // mirror cdLeft & enabled smoothly
      const tick = () => {
        const reg = Engine.registry?.abilities || {};
        for (const item of state.abilitiesList) {
          const def = reg[item.id];
          if (!def) continue;
          item.cdLeft  = Number(def.cdLeft || 0);
          item.enabled = def.enabled !== false;
        }
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);

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
    const cast         = (id) => Engine.castAbility?.(id);
    const togglePause  = () => window.engine.actions.togglePause();
    const setSpeed     = (n) => window.engine.actions.setSpeed(n);
    const setAutoStart = (v) => window.engine.actions.setAutoStart(v);
    const saveNow      = () => window.engine.actions.saveNow();
    const loadSave     = () => window.engine.actions.loadSave();
    const wipeSave     = () => window.engine.actions.wipeSave();

    // tab switches
    const selectUpgradeTab  = (tab) => state.selectedUpgradeTab  = tab;
    const selectAbilityTab  = (tab) => state.selectedAbilityTab  = tab;

    return {
      ...toRefs(state),
      filteredUpgrades, filteredAbilities,
      startWave, reset, buy, cast,
      togglePause, setSpeed, setAutoStart,
      saveNow, loadSave, wipeSave,
      selectUpgradeTab, selectAbilityTab,
      Number // for toLocaleString in template
    };
  }
}).mount('#app');
