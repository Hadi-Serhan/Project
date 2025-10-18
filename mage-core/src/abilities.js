// src/abilities.js
// Ability system bridge + dynamic facades (no built-in abilities here).

import Engine from './engine.js';
import { ctx, clamp } from './state.js';

// --------- tiny visual helper mods can import ----------
function makeRingEffect(x, y, r){
  return {
    t: 0, dur: 0.35, x, y, r,
    draw(dt){
      this.t += dt;
      const k = clamp(this.t/this.dur, 0, 1);
      ctx.strokeStyle = `rgba(255,150,80,${1-k})`;
      ctx.lineWidth = 6*(1-k) + 1;
      ctx.beginPath(); ctx.arc(this.x, this.y, this.r*(0.8 + 0.3*k), 0, Math.PI*2); ctx.stroke();
      return this.t < this.dur;
    }
  };
}
export const utils = { makeRingEffect };

// --------- Engine ability bridge ----------
function abilityCast(id, args = {}) {
  const ab = Engine.registry?.abilities?.[id];
  if (!ab || ab.enabled === false) return false;
  if (typeof ab.cdLeft === 'number' && ab.cdLeft > 0) return false;
  if (typeof ab.cast !== 'function') return false;

  // IMPORTANT: bind `this` to the ability object
  const ok = !!ab.cast.call(ab, args);
  if (ok && typeof ab.cd === 'number' && ab.cd > 0) ab.cdLeft = ab.cd;
  return ok;
}
Engine.setAbilityBridge({
  register(){ /* Engine.registry already holds the def */ },
  remove(){},
  cast: abilityCast,
});

// --------- global cooldown ticker for ALL abilities ----------
(function tickCooldowns(){
  let last = performance.now()/1000;
  function loop(){
    const now = performance.now()/1000, dt = now - last; last = now;
    const reg = Engine.registry?.abilities || {};
    for (const [, ab] of Object.entries(reg)) {
      if (typeof ab.cdLeft === 'number' && ab.cdLeft > 0) {
        ab.cdLeft = Math.max(0, ab.cdLeft - dt);
      }
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();

// --------- dynamic facades so main.js can keep importing { nova, frost } ----------
function abilityFacade(id){
  const proxy = {};
  const defaults = { title:'', hint:'', enabled:true, cd:0, cdLeft:0 };

  // standard fields (get/set straight to the registry object)
  for (const k of Object.keys(defaults)) {
    Object.defineProperty(proxy, k, {
      get(){ return Engine.registry?.abilities?.[id]?.[k] ?? defaults[k]; },
      set(v){ const ab = Engine.registry?.abilities?.[id]; if (ab) ab[k] = v; },
      enumerable: true,
    });
  }

  // expose `zones` so resetGame() can do frost.zones.length = 0 safely
  Object.defineProperty(proxy, 'zones', {
    get(){
      const ab = Engine.registry?.abilities?.[id];
      // always return an array (never undefined)
      return ab?.zones ?? (ab ? (ab.zones = []) : []);
    },
    set(v){
      const ab = Engine.registry?.abilities?.[id];
      if (ab) ab.zones = Array.isArray(v) ? v : [];
    },
    enumerable: true,
  });

  // cast via engine so cooldown is applied centrally (bind happens inside abilityCast)
  proxy.cast = (args) => Engine.castAbility?.(id, args) ?? false;

  // call helpers with proper `this` binding
  proxy.isIn = (x,y) => {
    const ab = Engine.registry?.abilities?.[id];
    const fn = ab?.isIn;
    return typeof fn === 'function' ? !!fn.call(ab, x, y) : false;
  };
  proxy.drawOverlay = () => {
    const ab = Engine.registry?.abilities?.[id];
    const fn = ab?.drawOverlay;
    if (typeof fn === 'function') return fn.call(ab);
  };

  return proxy;
}

export const nova  = abilityFacade('nova');   // if a content pack defines 'nova'
export const frost = abilityFacade('frost');  // if a content pack defines 'frost'
