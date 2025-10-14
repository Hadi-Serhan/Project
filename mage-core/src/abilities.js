import { cx, cy, ctx, core, enemies, effects, clamp } from './state.js';
import { dist } from './state.js';

export const nova = {
  radius: 110,
  cd: 10, cdLeft: 0,
  damageBase: 35, damageCoef: 0.6,
  cast() {
    if (this.cdLeft > 0) return false;
    const dmg = this.damageBase + this.damageCoef * core.damage;
    for (const e of enemies) {
      const p = e.pos;
      if (dist(core.x(), core.y(), p.x, p.y) <= this.radius) {
        e.hp -= dmg;
        if (e.state === 'attacking') e.dist += 6;
      }
    }
    effects.push(makeRingEffect(core.x(), core.y(), this.radius));
    this.cdLeft = this.cd;
    return true;
  }
};

export const frost = {
  radius: 140,
  cd: 12, cdLeft: 0,
  slow: 0.35, duration: 5.0,
  zones: [], // {x,y,r,until}
  cast() {
    if (this.cdLeft > 0) return false;
    this.zones.length = 0;
    this.zones.push({ x: core.x(), y: core.y(), r: this.radius, until: performance.now()/1000 + this.duration });
    this.cdLeft = this.cd;
    return true;
  },
  isIn(x, y) {
    const now = performance.now()/1000;
    for (let i=this.zones.length-1; i>=0; i--) if (this.zones[i].until <= now) this.zones.splice(i,1);
    if (!this.zones.length) return false;
    const z = this.zones[0];
    const dx = x - z.x, dy = y - z.y;
    return (dx*dx + dy*dy) <= (z.r*z.r);
  },
  drawOverlay() {
    if (!this.zones.length) return;
    const z = this.zones[0];
    const now = performance.now()/1000;
    const t = clamp((z.until - now) / this.duration, 0, 1);
    ctx.fillStyle = `rgba(120,180,255,${0.15 * t + 0.1})`;
    ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = `rgba(120,180,255,${0.6 * t})`;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, Math.PI*2); ctx.stroke();
  }
};

// simple visual ring effect for Nova
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
