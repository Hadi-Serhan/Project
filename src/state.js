// Shared state, canvas, core, economy, utilities

export const canvas = document.getElementById('game');
export const ctx = canvas.getContext('2d');

function resize(){ canvas.width = canvas.clientWidth; canvas.height = canvas.clientHeight; }
window.addEventListener('resize', resize); resize();

export const cx = () => canvas.width / 2;
export const cy = () => canvas.height / 2;

export function dist(ax, ay, bx, by){ const dx=ax-bx, dy=ay-by; return Math.hypot(dx, dy); }
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Economy / upgrades
export let gold = 0;
export const upgrades = { dmg: 0, rof: 0, range: 0 };
const baseCosts = { dmg: 20, rof: 20, range: 20 };
const costScale = 1.5;
export function cost(line){ return Math.floor(baseCosts[line] * Math.pow(costScale, upgrades[line])); }

// Core (tower)
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

// Game-wide arrays/flags
export const enemies = [];
export const projectiles = [];
export const effects = [];

export let wave = 0;
export let waveRunning = false;
export let defeated = false;
export const activeSpawners = new Set();

export function setDefeated() {
  defeated = true;
  waveRunning = false;
  activeSpawners.clear();
}

// UI refs (kept central so modules can update UI cleanly)
export const ui = {
  enemyCountEl: document.getElementById('enemyCount'),
  waveNumEl:    document.getElementById('waveNum'),
  waveStatusEl: document.getElementById('waveStatus'),
  coreHPEl:     document.getElementById('coreHP'),
  goldAmtEl:    document.getElementById('goldAmt'),
  costDmgEl:    document.getElementById('costDmg'),
  costRofEl:    document.getElementById('costRof'),
  costRangeEl:  document.getElementById('costRange'),
  buyDmgBtn:    document.getElementById('buyDmg'),
  buyRofBtn:    document.getElementById('buyRof'),
  buyRangeBtn:  document.getElementById('buyRange'),
  spawnLeftBtn: document.getElementById('spawnLeft'),
  spawnRightBtn:document.getElementById('spawnRight'),
  startWaveBtn: document.getElementById('startWave'),
  resetBtn:     document.getElementById('resetRun'),
  castNovaBtn:  document.getElementById('castNova'),
  novaCDEl:     document.getElementById('novaCD'),
  castFrostBtn: document.getElementById('castFrost'),
  frostCDEl:    document.getElementById('frostCD'),
};

export function setWaveStatus(t){ ui.waveStatusEl.textContent = t; }
export function refreshEconomyUI() {
  ui.enemyCountEl.textContent = enemies.length;
  ui.coreHPEl.textContent = Math.ceil(core.hp);
  ui.goldAmtEl.textContent = gold;
  ui.buyDmgBtn.disabled   = gold < cost('dmg');
  ui.buyRofBtn.disabled   = gold < cost('rof');
  ui.buyRangeBtn.disabled = gold < cost('range');
  ui.costDmgEl.textContent   = cost('dmg');
  ui.costRofEl.textContent   = cost('rof');
  ui.costRangeEl.textContent = cost('range');
}
