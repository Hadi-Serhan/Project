// ===== Canvas / basics =====
export const canvas = document.getElementById('game');
export const ctx = canvas.getContext('2d');

function resize(){ canvas.width = canvas.clientWidth; canvas.height = canvas.clientHeight; }
window.addEventListener('resize', resize); resize();

export const cx = () => canvas.width / 2;
export const cy = () => canvas.height / 2;

export function dist(ax, ay, bx, by){ const dx=ax-bx, dy=ay-by; return Math.hypot(dx, dy); }
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ===== Canonical game state (single source of truth) =====
export let gold = 0;
export let wave = 0;
export let waveRunning = false;
export let defeated = false;

export let waveStatus = 'No wave';

// Upgrades / economy
export const upgrades = { dmg: 0, rof: 0, range: 0 };
const baseCosts = { dmg: 20, rof: 20, range: 20 };
const costScale = 1.5;
export function cost(line){ return Math.floor(baseCosts[line] * Math.pow(costScale, upgrades[line])); }

// Setters so other modules can safely mutate state.js variables
export function setGold(v){ gold = v; }
export function setWave(v){ wave = v; }
export function setWaveRunning(v){ waveRunning = v; }
export function setDefeatedFlag(v){ defeated = v; }
export function setWaveStatus(text){ waveStatus = text; notifySubscribers(); }

// ===== Pub/Sub for UI (Vue) =====
const subscribers = new Set();
export function subscribe(cb){ subscribers.add(cb); return () => subscribers.delete(cb); }

// notifySubscribers can accept a prebuilt snapshot (preferred),
// or build a minimal one if none is provided.
export function notifySubscribers(snapshot){
  const snap = snapshot ?? {
    wave, waveRunning, defeated,
    coreHP: core.hp,
    gold,
    costs: { dmg: cost('dmg'), rof: cost('rof'), range: cost('range') },
    cd: { nova: 0, frost: 0 }, // main.js will send real values
    waveStatus,
  };
  subscribers.forEach(fn => fn(snap));
}

// ===== Core (tower) =====
export const core = {
  x: cx, y: cy, radius: 24,
  baseDamage: 25, baseFireRate: 1.2, baseRange: 180,
  damage: 25, fireRate: 1.2, range: 180,
  hpMax: 100, hp: 100,
  _fireTimer: 0,
  applyUpgrades() {
    this.damage   = this.baseDamage   + upgrades.dmg * 5;
    this.fireRate = this.baseFireRate + upgrades.rof * 0.2;
    this.range    = this.baseRange    + upgrades.range * 12;
  },
  draw() {
    // ground ring
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(this.x(), this.y(), Math.min(canvas.width, canvas.height)*0.32, 0, Math.PI*2); ctx.stroke();
    // body
    ctx.fillStyle = '#7cf';
    ctx.beginPath(); ctx.arc(this.x(), this.y(), this.radius, 0, Math.PI*2); ctx.fill();
    // range
    ctx.strokeStyle = 'rgba(124,252,255,0.2)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(this.x(), this.y(), this.range, 0, Math.PI*2); ctx.stroke();
  }
};
core.applyUpgrades();

// ===== Collections =====
export const enemies = [];
export const projectiles = [];
export const effects = [];
export const activeSpawners = new Set();

// Defeat helper
export function setDefeated(){
  setDefeatedFlag(true);
  setWaveRunning(false);
  activeSpawners.clear();
}
