// src/ui/vue-app.js
const { createApp, reactive, onMounted, onBeforeUnmount, toRefs } = Vue;

const App = {
  setup() {
    const s = reactive({
      wave: 0, waveRunning: false, defeated: false,
      coreHP: 0, gold: 0,
      costs: { dmg:0, rof:0, range:0 },
      cd: { nova:0, frost:0 },
      waveStatus: 'No wave',
    });

    let unsubscribe = null;

    onMounted(() => {
      // initial snapshot
      Object.assign(s, window.engine.getSnapshot());
      // subscribe to engine ticks
      unsubscribe = window.engine.subscribe((snap) => Object.assign(s, snap));
    });
    onBeforeUnmount(() => { if (unsubscribe) unsubscribe(); });

    const startWave = () => window.engine.actions.startWave();
    const reset     = () => window.engine.actions.reset();
    const buy       = (line) => window.engine.actions.buy(line);
    const cast      = (which) => window.engine.actions.cast(which);

    return { ...toRefs(s), startWave, reset, buy, cast };
  }
};

createApp(App).mount('#app');
