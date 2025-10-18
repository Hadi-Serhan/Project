// src/mod-loader.js
// Ensure Engine and the ability bridge are ready before content packs
await import('./engine.js');
await import('./abilities.js'); // installs bridge + facades

const MODS = [
  new URL('../mods/vanilla-pack.js', import.meta.url).href, // your default content
  new URL('../mods/sample-mod.js', import.meta.url).href,   // user/example mod (Meteor + Haste+)
];

export async function loadAllMods() {
  for (const url of MODS) {
    try {
      await import(url);
      // Initialize any abilities that have init methods
      const abilities = Engine.registry?.abilities || {};
      for (const [name, ability] of Object.entries(abilities)) {
        if (typeof ability.init === 'function') {
          ability.init();
        }
      }
      console.log('[mod-loader] loaded', url);
    } catch (e) {
      console.warn('[mod-loader] failed', url, e);
    }
  }
}
