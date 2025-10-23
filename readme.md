
# Firey — Mechanics & Modding Guide

This README focuses on **how the game works** (mechanics) and **how to extend it** (modding).

---

## 1) What kind of game is this?

A small **arena defense** on an HTML5 canvas:

- You are a **Core** at the center; enemies spawn in rings and path inward.
- The Core auto-fires projectiles at the nearest valid target in range.
- You clear waves, earn **gold** (run currency) and **prestige** (meta currency).
- You buy **run upgrades** (reset each run) and **permanent upgrades**/**ability levels** (meta).

---

## 2) Core gameplay loop (runtime)

1. **Spawn:** A wave recipe schedules batches of enemies with a cadence that scales by wave number.
2. **Advance/Attack:** Enemies move radially toward the Core; on contact they enter an attack loop (periodic damage).
3. **Targeting:** The Core constantly picks the **closest enemy in range** whose effective HP isn’t already “reserved” by incoming projectiles (prevents overkill and time waste).
4. **Firing:** When the Core’s internal cooldown reaches 0, it throws a projectile along a short arc to the target and resets cooldown to `1 / fireRate`.
5. **Hit & Death:** On impact, damage is applied; if HP ≤ 0, the enemy dies and drops gold (and prestige by rules).
6. **Wave end:** When all spawners are empty and all enemies are dead, the wave is cleared. Optionally **auto-start** next wave.
7. **Defeat:** If Core HP hits 0, defeat triggers prestige awards based on progress.

**Key places in the codebase**

- Loop & actions: `src/main.js`
- Canonical state & recomputation: `src/state.js`
- Enemy content & wave recipes: `src/content.js`
- Default mod pack (upgrades/abilities): `mods/vanilla-pack.js`

---

## 3) Important mechanics

### 3.1 Targeting
Picks the **nearest** enemy in range with **effective HP > 0** after subtracting reserved damage.  
This reduces multi-projectile overkill and stabilizes DPS feel.

### 3.2 Projectile timing
The Core uses `_fireTimer`; each frame: `_fireTimer -= dt`.  
When ≤ 0 and a target exists → fire and set `_fireTimer = 1 / fireRate`.

### 3.3 Enemy AI (simple state machine)
- `advancing` → decrease radial distance by `speed * dt`.
- Switch to `attacking` when inside Core radius; tick `attackTimer`, damage Core per `attackPeriod`.

### 3.4 Damage reservation
On throw, expected damage is **reserved** on the target so other projectiles look for non-overkilled targets.

### 3.5 Stats recomputation (very important)
**Schema-driven Core** in `state.js`:

1. Start from **schema base** (e.g., `baseDamage`, `baseFireRate`, `hpMax`, etc.).  
2. Apply **run upgrades** (`def.apply(core, runLevel)`).  
3. Apply **permanent levels** (`def.permanentApply(core, permLevel)` + ability perm levels).  
4. Clamp HP to new `hpMax`.

This keeps upgrades **data-first** and prevents stat drift.

### 3.6 Overdrive snapshot (R)
Overdrive **never reduces** your current DPS if you already stacked upgrades.  
On cast, it **snapshots** current `damage` and `fireRate` (already upgraded & permanent-applied), then applies multipliers while active. When it ends, it **recomputes** from schema + upgrades + perms.

### 3.7 Frost slow (W)
Applies a movement **slow** within a zone; bosses get a **clamped/lesser slow** (anti-cheese cap).  
Enemy modifiers are composable—any mod can return a `{ speedMul, atkMul }` adjustment.

---

## 4) Progression systems

- **Run upgrades** (gold): Reset when the run resets, applied via each upgrade’s `apply(core, runLevel)`.
- **Permanent meta** (prestige): Persist across runs; applied via `permanentApply(core, permLevel)` for **both upgrades and abilities**.
- **Prestige rules:** Event-driven (enemy death, boss kill, wave clear, defeat) and defined as composable rules.

---

## 5) Persistence & reset semantics

- **Save key:** `localStorage["Firey:v1"]`  
  Autosaves frequently and on major actions (buy/cast/reset).

- **Load:** Restores run state (gold/wave/HP/run upgrades/toggles) and permanent levels; clears arena before resuming.

- **Wipe:** Deletes only the saved JSON blob. The **current** in-memory run continues until you reset.

- **Reset (Run reset):** Clears enemies/effects/spawns, sets wave/gold to 0, **wipes run upgrades**, keeps prestige & permanents, and **recomputes** stats.

- **Hard Reset:** All of the above **plus** prestige = 0 and **permanent levels cleared**, and removes save key.

**Debug/UI actions**
```js
window.engine.actions.saveNow()
window.engine.actions.loadSave()
window.engine.actions.wipeSave()
window.engine.actions.reset()      // run-only
window.engine.actions.hardReset()  // full wipe
```

---

## 6) How to mod 

 The default bundle is `mods/vanilla-pack.js`.

### 6.1 Add a run/permanent upgrade
```js
Engine.registerUpgrade('dmg', {
  category: 'Offense',
  title: 'Damage',
  desc: 'Increase core damage (+5 per level).',
  readoutKeys: ['damage'],
  cost(level){ const base=20,k=1.5; return Math.floor(base*Math.pow(k, level)); },

  // Run-time effect (resets each run)
  apply(core, runLevel){
    if (!runLevel) return;
    core.damage = (core.baseDamage ?? core.damage ?? 0) + 5 * runLevel;
  },

  // Permanent meta effect (persists across runs)
  permanentApply(core, permLevel){
    if (!permLevel) return;
    core.damage = (core.damage ?? core.baseDamage ?? 0) + 2 * permLevel;
  }
});
```

> **Notes**
> - `apply` and `permanentApply` are **both optional**. Define what you need.
> - Costs are functions of the **current run level** to support exponential scaling.
> - The final value users see is after **schema → apply (run) → permanentApply (meta)**.

### 6.2 Add an ability (with optional permanent scaling)
```js
Engine.registerAbility('nova', {
  title: 'Nova',
  hint: 'Q',
  enabled: true,
  radius: 110,
  cd: 10,
  cdLeft: 0,
  damageBase: 35,
  damageCoef: 0.6,
  sfx: { cast: 'ability/nova/cast' },

  cast() {
    if (this.cdLeft > 0 || this.enabled === false) return false;

    // Scale by ability permanent level at cast time
    const permLvl = Engine.getAbilityPermLevel?.('nova') || 0;
    const radius  = this.radius + 6 * permLvl;

    const dmg = this.damageBase + this.damageCoef * core.damage;
    for (const e of enemies) {
      const p = e.pos;
      if (dist(core.x(), core.y(), p.x, p.y) <= radius) e.hp -= dmg;
    }
    return true;
  },

  // Optional passive permanent effect
  permanentApply(core, permLevel){
    if (!permLevel) return;
    core.damage = (core.damage ?? core.baseDamage ?? 0) + 0.5 * permLevel;
  }
});
```

Two paths to use ability perms:

1) **At cast-time** → read `Engine.getAbilityPermLevel(id)` and scale the effect.  
2) **Passively** → implement `permanentApply(core, permLevel)` on the ability.

### 6.3 Add enemies & waves
`src/content.js` registers types and returns recipes:

```js
export const ENEMY_TYPES = {
  grunt: { hp: 30, speed: 44, radius: 18, baseGold: 6, coreDamage: 12, attackPeriod: 1.2 },
  tank:  { hp: 120, speed: 26, radius: 22, baseGold: 12, coreDamage: 20, attackPeriod: 1.4 },
  boss:  { hp: 1200, speed: 18, radius: 26, baseGold: 60, coreDamage: 35, attackPeriod: 1.8, boss: true },
};

export function waveRecipe(wave){
  const packs = [];
  // push { type, count, cadenceMul? } arrays
  if (wave % 5 === 0) packs.push({ type:'boss', count:1, cadenceMul:1.5 });
  else packs.push({ type:'grunt', count: 8 + wave, cadenceMul: 1.0 });
  return packs;
}
```

The engine scales HP and cadence per wave. You can add new types and reference them in recipes.

### 6.4 Enemy modifiers (status effects)
Add a **global modifier** that can tweak enemies each frame:

```js
Engine.addEnemyModifier((enemy, dt, ctx) => {
  // Example: 20% slow in a specific ring area
  const cx = core.x(), cy = core.y();
  const p  = enemy.pos;
  const r  = Math.hypot(p.x - cx, p.y - cy);
  if (r > 200 && r < 260) return { speedMul: 0.8, atkMul: 1.0 };
  return null;
});
```
Return `{ speedMul, atkMul }` **multipliers** (1.0 = no change). Return `null` for no effect.

### 6.5 Overlay drawing (VFX/HUD without DOM)
```js
Engine.addOverlayDrawer((ctx) => {
  // Draw a subtle ring at range
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.beginPath();
  ctx.arc(core.x(), core.y(), core.range, 0, Math.PI*2);
  ctx.stroke();
  ctx.restore();
});
```

Drawers run during the game’s canvas render, after the map and core but before enemies/effects cleanup.

### 6.6 Extending the Stats panel
For consistent UI readouts, register new stats:

```js
Stats.register('crit', {
  label: 'Crit',
  get: c => `${Math.round((c.critChance||0)*100)}% ×${(c.critMult||1).toFixed(2)}`,
  format: c => `Crit: ${Math.round((c.critChance||0)*100)}% • x${(c.critMult||1).toFixed(2)}`
});
```
Then in an upgrade, reference it via `readoutKeys: ['crit']`.

### 6.7 Extending the Core schema
If your mod adds new core fields, register derived defaults:

```js
CoreSchema.registerDerived('critChance', 0);
CoreSchema.registerDerived('critMult',   1);

// in your upgrade.apply:
core.critChance = Math.min(0.8, (core.critChance||0) + 0.05*lvl);
```
---

## 7) Engine API: what the modder uses

- **Registering content**
  - `Engine.registerUpgrade(id, def)`
  - `Engine.registerAbility(id, def)`
  - `Engine.registerEnemyType(id, def)` (via `content.js` during boot)

- **Hooks**
  - `Engine.addEnemyModifier(fn)` → `{ speedMul, atkMul } | null`
  - `Engine.addOverlayDrawer(fn)` → canvas draws each frame
  - `Engine.addResetHook(fn)` → clean timers, zones, etc.
  - `Engine.on(event, handler)` → `'enemy:death' | 'core:hit' | 'wave:start' | 'wave:end' | 'registry:upgrade' ...`

- **Core & state access**
  - `Engine.setStateAccessor(() => ({ core, enemies, ... }))`
  - `Engine.modifyCore(fn)` → set base values before recomputation
  - `Engine.applyPermToCore(core)` → apply all permanent levels
  - `Engine.getPermLevels()` / `Engine.setPermLevels(levels)`
  - `Engine.getAbilityPermLevel(id)`

- **Prestige**
  - `Engine.addPrestigeRule(fn)` → `(evt) => number`, evt kinds include `enemyKill`, `bossKill`, `defeat`, `waveClear`

---

## 8) Debugging & teacher-friendly inspection

- **Live dump:** `__dumpCore()`  
  ```js
  {
    runUpgrades: {...},                 // per-run levels
    permLevels:  {...},                 // meta levels (upgrades + ability:<id>)
    coreStats:   { damage, fireRate, range, hpMax, armor, hpRegen, auraDps, auraRadius }
  }
  ```

- **Useful actions:**  
  `window.engine.actions.startWave()`, `reset()`, `hardReset()`, `saveNow()`, `loadSave()`, `wipeSave()`, `setSpeed(3)`, `setAutoStart(true)`

- **Hotkeys:** `Q` (Nova), `W` (Frost), `E` (Shockwave), `R` (Overdrive), **Esc** (pause).

---

## 9) Balancing knobs (examples)

- Enemy HP scale ≈ `hp * (1 + wave * 0.18)`  
- Spawn cadence base ≈ `max(0.25, 0.55 - wave * 0.02)`  
- Gold on death scales with wave; boss drops more.  
- Prestige awards are rule-based and additive; see rules in `src/main.js`.

---

## 10) Why this architecture?

- **Data-first** registries isolate content from the engine.
- **Schema → apply → permanentApply** ensures deterministic recomputation and avoids stat drift.
- **Snapshot-based buffs** (Overdrive) avoid inadvertent DPS loss when stacking effects.
- Hooks (`addEnemyModifier`, `addOverlayDrawer`, events) create a safe surface for **future mods** without touching the core loop.

---


##thanks!
