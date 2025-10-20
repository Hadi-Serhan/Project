// mage-core/mods/sample-mod.js
(() => {
  const G = window.Engine;
  if (!G) { console.warn('[sample-mod] Engine not found'); return; }

  // -------- Upgrade: Haste+ --------
  G.registerUpgrade('haste_plus', {
    title: 'Haste+',
    desc: 'Increase fire rate further (+0.35 per level).',
    cost(level){ const base=18,k=1.55; return Math.floor(base*Math.pow(k, level)); },
    apply(core, level){ if (level) core.fireRate = core.fireRate + 0.35*level; }
  });

  // -------- Ability: Meteor --------
  // NOTE: use `cd`, not `cooldown`. Do NOT manually tick cdLeft; the engine bridge does that.
  function ringEffect(x,y,r){
    return {
      t:0, dur:0.35, x,y,r,
      draw(dt){
        this.t += dt;
        const k = Math.max(0, Math.min(1, this.t/this.dur));
        const canvas = document.getElementById('game'); if(!canvas) return this.t < this.dur;
        const ctx = canvas.getContext('2d');
        ctx.strokeStyle = `rgba(250,120,60,${1-k})`;
        ctx.lineWidth = 6*(1-k) + 1;
        ctx.beginPath(); ctx.arc(this.x, this.y, this.r*(0.85 + 0.35*k), 0, Math.PI*2); ctx.stroke();
        return this.t < this.dur;
      }
    };
  }

  G.registerAbility('meteor', {
    title: 'Meteor',
    hint: 'E',
    enabled: true,
    cd: 8,          // <-- important: `cd`
    cdLeft: 0,

    radius: 160,
    baseDamage: 26,
    scale: 0.65,

    cast() {
      // `this` is bound by the bridge; DO NOT set cdLeft here—bridge will do it if we return true
      if (!this.enabled || this.cdLeft > 0) return false;

      const S = G.state; if (!S?.core || !S?.enemies) return false;
      const cx = S.core.x(), cy = S.core.y();
      const r2 = this.radius*this.radius;
      const dmg = Math.round(this.baseDamage + this.scale * S.core.damage);

      let hits = 0;
      for (const e of S.enemies) {
        const p = e.pos, dx = p.x - cx, dy = p.y - cy;
        if (dx*dx + dy*dy <= r2) {
          e.hp -= dmg;
          if (e.state === 'attacking') e.dist += 8;
          hits++;
        }
      }

      // Visual feedback even if 0 hits
      S.effects?.push(ringEffect(cx, cy, this.radius));
      console.log('[meteor] cast', { hits, dmg });

      return true; // bridge sets cdLeft = cd
    }
  });

  // Hotkey: E (calls the bridge; button click calls same path)
  window.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'e') {
      const ok = G.castAbility('meteor');
      if (!ok) {
        const a = G.registry?.abilities?.meteor;
        if (a?.cdLeft > 0) console.log(`[meteor] cooldown: ${a.cdLeft.toFixed(2)}s`);
        else console.log('[meteor] cast failed (cooldown/disabled?)');
      }
    }
  });

  console.log('[sample-mod] Haste+ upgrade and Meteor ability registered. Press "E" to cast.');
})();
