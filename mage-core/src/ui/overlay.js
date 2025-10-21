// mage-core/src/ui/overlay.js
// Unified, framework-free overlays (menu, pause, defeat) + HUD menu button.

import Engine from '../engine.js';

function el(tag, css, html){
  const n = document.createElement(tag);
  if (css) n.style.cssText = css;
  if (html != null) n.innerHTML = html;
  return n;
}

// ---------- HUD "☰ Menu" button ----------
export function ensureHudMenuButton(openCb){
  if (document.getElementById('hud-menu-btn')) return;
  const btn = el('button', `
    position:absolute; top:10px; left:10px; z-index:900;
    background:rgba(17,24,39,.85); color:#fff; border:1px solid rgba(255,255,255,.15);
    border-radius:10px; padding:8px 10px; cursor:pointer;`);
  btn.id = 'hud-menu-btn';
  btn.textContent = '☰ Menu';
  btn.onclick = () => openCb?.();
  document.body.appendChild(btn);
}
export function removeHudMenuButton(){
  document.getElementById('hud-menu-btn')?.remove();
}

// ---------- Pre-game main menu ----------
export function initMenuUI({ onPlay, onBuyPermanent } = {}) {
  // Root overlay
  const root = el('div', `
    position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
    pointer-events:auto; font-family:system-ui,Segoe UI,Roboto,sans-serif; color:#fff; z-index:1000;`);
  root.id = 'menu-root';

  // Dim
  const dim = el('div','position:absolute; inset:0; background:rgba(0,0,0,.5)');
  root.appendChild(dim);

  // Top prestige counter
  const top = el('div',
    'position:absolute; top:16px; left:0; right:0; text-align:center; font-weight:700; font-size:18px; text-shadow:0 2px 4px rgba(0,0,0,.5)');
  root.appendChild(top);

  // Middle PLAY
  const play = el('button', `
    position:relative; z-index:1; padding:16px 28px; font-weight:800; font-size:22px; letter-spacing:1px;
    background:#ffcc33; color:#402; border:none; border-radius:14px; box-shadow:0 8px 20px rgba(0,0,0,.35); cursor:pointer;
    transform:translateY(0); transition:transform .05s ease;`, 'PLAY');
  play.onmousedown = () => (play.style.transform = 'translateY(2px)');
  play.onmouseup   = () => (play.style.transform = 'translateY(0)');
  play.onclick = () => { root.remove(); onPlay?.(); };
  root.appendChild(play);

  // Bottom bar
  const bottom = el('div','position:absolute; left:0; right:0; bottom:10px; display:flex; gap:10px; justify-content:center;');
  const mkBtn = (t)=>el('button','padding:10px 14px; background:#334155; border:none; color:#fff; border-radius:10px; cursor:pointer',t);
  const btnAbilities = mkBtn('Abilities');
  const btnUpgrades  = mkBtn('Upgrades');
  const btnHardReset = el('button', `
  padding:10px 14px; border:none; border-radius:10px;
  background:#ef4444; color:#fff; cursor:pointer;`, 'Hard Reset');

    btnHardReset.onclick = () => {
    if (confirm('This will erase ALL progress (prestige, permanents, and saves). Continue?')) {
        window.engine?.actions?.hardReset?.();
        // stay on main menu; just refresh the top prestige label
        refreshTop?.();
    }
};


  bottom.append(btnAbilities, btnUpgrades, btnHardReset);
  root.appendChild(bottom);

  // Panel
  const panel = el('div', `
    position:absolute; left:50%; bottom:70px; transform:translateX(-50%);
    width:min(760px, 92vw); max-height:50vh; overflow:auto; padding:14px;
    background:rgba(17,24,39,.9); border:1px solid rgba(255,255,255,.1); border-radius:14px; display:none;`);
  root.appendChild(panel);

  // Renderers
  function renderAbilities() {
    const snap = window.engine?.getSnapshot?.() || {};
    const list = (snap.abilities || []).slice().sort((a,b)=> (a.title||'').localeCompare(b.title||''));
    panel.innerHTML = '<div style="font-weight:700;margin-bottom:8px">Abilities</div>';
    for (const a of list) {
      const row = el('div',
        'display:flex; align-items:center; justify-content:space-between; gap:10px; padding:8px 0; border-bottom:1px solid rgba(255,255,255,.08)');
      const price = a.permPrice ?? (5 + Math.floor(Math.pow(1.35, (a.permLevel|0))));
      row.innerHTML = `
        <div>
          <div style="font-weight:700">${a.title}</div>
          <div style="opacity:.8; font-size:12px">${a.hint||''} · CD: ${Number(a.cd||0).toFixed(1)}s</div>
          <div style="opacity:.85; font-size:12px">Permanent Level: ${a.permLevel|0}</div>
        </div>
        <button data-id="ability:${a.id}" style="padding:8px 12px; border:none; border-radius:10px; background:#7c3aed; color:#fff; cursor:pointer">
          Buy +1 (${price} ⚜)
        </button>
      `;
      panel.appendChild(row);
    }
    panel.querySelectorAll('button[data-id]').forEach(b=>{
      b.onclick = () => { onBuyPermanent?.(b.dataset.id); refreshTop(); renderAbilities(); };
    });
  }

  function renderUpgrades(){
    const snap = window.engine?.getSnapshot?.() || {};
    const rows = (snap.permanent || []).filter(r=>r.kind==='upgrade');
    panel.innerHTML = '<div style="font-weight:700;margin-bottom:8px">Permanent Upgrades (Prestige)</div>';
    for (const m of rows) {
      const row = el('div',
        'display:flex; align-items:center; justify-content:space-between; gap:10px; padding:8px 0; border-bottom:1px solid rgba(255,255,255,.08)');
      row.innerHTML = `
        <div>
          <div style="font-weight:700">${m.title}</div>
          <div style="opacity:.85;font-size:12px">Permanent Level: ${m.level|0}</div>
        </div>
        <button data-id="${m.id}" style="padding:8px 12px; border:none; border-radius:10px; background:#7c3aed; color:#fff; cursor:pointer">
          Buy +1 (${m.price} ⚜)
        </button>
      `;
      panel.appendChild(row);
    }
    panel.querySelectorAll('button[data-id]').forEach(b=>{
      b.onclick = () => { onBuyPermanent?.(b.dataset.id); refreshTop(); renderUpgrades(); };
    });
  }

  // Top label
  const refreshTop = () => {
    const snap = window.engine?.getSnapshot?.() || {};
    top.textContent = `Prestige: ${snap.prestige|0} ⚜`;
  };

  // Wire
  btnAbilities.onclick = () => { renderAbilities(); panel.style.display='block'; refreshTop(); };
  btnUpgrades.onclick  = () => { renderUpgrades();  panel.style.display='block'; refreshTop(); };

  // Live prestige label while open
  const unsub = window.engine?.subscribe?.(() => refreshTop());
  const offA1 = Engine.on?.('registry:ability',  () => { if (panel.style.display==='block') renderAbilities(); refreshTop(); });
  const offA2 = Engine.on?.('registry:ability:removed', () => { if (panel.style.display==='block') renderAbilities(); refreshTop(); });
  const offU1 = Engine.on?.('registry:upgrade',  () => { if (panel.style.display==='block') renderUpgrades();  refreshTop(); });
  const offU2 = Engine.on?.('registry:upgrade:removed', () => { if (panel.style.display==='block') renderUpgrades();  refreshTop(); });
  const offMeta = Engine.on?.('meta:buy', refreshTop);

  // Mount
  document.body.appendChild(root);
  refreshTop();

  // Cleanup if needed (menu is usually removed by clicking PLAY)
  return () => {
    root.remove();
    unsub && unsub();
    offA1 && offA1(); offA2 && offA2(); offU1 && offU1(); offU2 && offU2(); offMeta && offMeta();
  };
}

// ---------- Pause menu ----------
export function openPauseMenu({ onResume, onSurrender, onMainMenu } = {}) {
  if (document.getElementById('pause-root')) return;

  const root = el('div', `
    position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
    pointer-events:auto; font-family:system-ui,Segoe UI,Roboto,sans-serif; color:#fff; z-index:1100;`);
  root.id = 'pause-root';
  const dim = el('div','position:absolute; inset:0; background:rgba(0,0,0,.55)');
  root.appendChild(dim);

  const panel = el('div', `
    position:relative; padding:18px; width:320px;
    background:rgba(17,24,39,.95); border:1px solid rgba(255,255,255,.12); border-radius:14px; text-align:center;`);
  panel.innerHTML = `
    <div style="font-weight:800; font-size:20px; margin-bottom:12px">Game Menu</div>
    <div style="display:flex; flex-direction:column; gap:10px">
      <button id="pm-resume"   style="padding:10px; border:none; border-radius:10px; background:#22c55e; color:#102a12; cursor:pointer">Resume</button>
      <button id="pm-surrender"style="padding:10px; border:none; border-radius:10px; background:#f97316; color:#3b1a00; cursor:pointer">Surrender</button>
      <button id="pm-main"     style="padding:10px; border:none; border-radius:10px; background:#64748b; color:#0b1220; cursor:pointer">Main Menu</button>
    </div>
  `;
  root.appendChild(panel);

  panel.querySelector('#pm-resume').onclick    = () => { root.remove(); onResume?.(); };
  panel.querySelector('#pm-surrender').onclick = () => { root.remove(); onSurrender?.(); };
  panel.querySelector('#pm-main').onclick      = () => { root.remove(); onMainMenu?.(); };

  document.body.appendChild(root);
}

// ---------- Defeat menu ----------
export function showDefeatMenu({ wave, prestige, onTryAgain, onMainMenu } = {}) {
  if (document.getElementById('defeat-root')) return;

  const root = el('div', `
    position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
    pointer-events:auto; font-family:system-ui,Segoe UI,Roboto,sans-serif; color:#fff; z-index:1200;`);
  root.id = 'defeat-root';

  const dim = el('div','position:absolute; inset:0; background:rgba(0,0,0,.6)');
  root.appendChild(dim);

  const panel = el('div', `
    position:relative; padding:20px; width:min(420px, 92vw);
    background:rgba(17,24,39,.95); border:1px solid rgba(255,255,255,.12); border-radius:16px; text-align:center;`);
  panel.innerHTML = `
    <div style="font-weight:900; font-size:22px; margin-bottom:6px">Defeated</div>
    <div style="opacity:.9; margin-bottom:14px">Wave ${Number(wave||0)} · ${Number(prestige||0) > 0 ? `+${Number(prestige)} ⚜ earned` : 'No prestige'}</div>
    <div style="display:flex; gap:10px; justify-content:center">
      <button id="df-try"  style="padding:10px 14px; border:none; border-radius:10px; background:#22c55e; color:#102a12; cursor:pointer">Try Again</button>
      <button id="df-menu" style="padding:10px 14px; border:none; border-radius:10px; background:#64748b; color:#0b1220; cursor:pointer">Main Menu</button>
    </div>
  `;
  root.appendChild(panel);

  panel.querySelector('#df-try').onclick  = () => { root.remove(); onTryAgain?.(); };
  panel.querySelector('#df-menu').onclick = () => { root.remove(); onMainMenu?.(); };

  document.body.appendChild(root);
}
