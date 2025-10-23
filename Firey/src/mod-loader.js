// Firey/src/mod-loader.js
// Ensure Engine + ability bridge before mods (do this once)
if (!window.__mc_bridge_ready) {
  await import('./engine.js');
  await import('./abilities.js'); // installs ability bridge + tick system
  window.__mc_bridge_ready = true;
}

// Keep a single, stable list (avoid path variations)
const MODS = [
  new URL('../mods/vanilla-pack.js', import.meta.url).href, // your base game content
  new URL('../mods/sample-mod.js', import.meta.url).href,   // example mod (can comment out)
];

// Idempotent guard so double imports won't double-load mods
let __modsLoaded = false;

export async function loadAllMods() {
  if (__modsLoaded) return;
  __modsLoaded = true;

  for (const url of MODS) {
    try {
      await import(url);
      // Run per-ability init hooks if provided by mods
      const abilities = Engine.registry?.abilities || {};
      for (const [, ability] of Object.entries(abilities)) {
        if (typeof ability.init === 'function' && !ability.__inited) {
          try { ability.init(); ability.__inited = true; } catch (e) { console.warn('[ability init]', e); }
        }
      }
      console.log('[mod-loader] loaded', url);
    } catch (e) {
      console.warn('[mod-loader] failed', url, e);
    }
  }
}
