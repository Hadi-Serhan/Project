// mage-core/src/ui/overlay.js
// Unified, framework-free overlays (menu, pause, defeat) + HUD menu button.

import Engine from '../engine.js';
import { Audio } from '../audio.js';

function el(tag, css, html){
  const n = document.createElement(tag);
  if (css) n.style.cssText = css;
  if (html != null) n.innerHTML = html;
  return n;
}

// --- universal click SFX (with ability override) ---
function attachClickSfx(root, { abilitySelector = '[data-ability], .ability-btn' } = {}) {
  root.addEventListener('click', (e) => {
    if (e._sfxPlayed) return;
    const btn = e.target.closest('button,[role="button"]');
    if (!btn || !root.contains(btn)) return;
    if (btn.dataset.noSfx === '1') return;
    const isAbility = btn.matches(abilitySelector);
    Audio.play(isAbility ? 'ui/ability' : 'ui/click');
    e._sfxPlayed = true;
  });
}
function attachChangeSfx(root) {
  root.addEventListener('change', (e) => {
    const input = e.target?.closest('input[type="checkbox"], input[type="radio"]');
    if (!input || !root.contains(input)) return;
    if (input.dataset.noSfx === '1') return;
    Audio.play(input.dataset.sfx || 'ui/switch');
  });
}
export function installGlobalUiClickSfx() {
  if (window.__uiClickSfxInstalled) return;
  window.__uiClickSfxInstalled = true;
  attachClickSfx(document.body);
  attachChangeSfx(document.body);
  ensureAudioFloatingButton(); // make sure the audio button exists globally
}

// ---------- floating audio settings ----------
function ensureAudioFloatingButton(){
  if (document.getElementById('audio-btn')) return;

  const btn = el('button', `
    position:fixed; right:12px; bottom:12px; z-index:1400;
    width:42px; height:42px; border-radius:50%;
    background:#1f2937; color:#fff; border:1px solid rgba(255,255,255,.15);
    display:flex; align-items:center; justify-content:center; cursor:pointer; box-shadow:0 6px 16px rgba(0,0,0,.35);`);
  btn.id = 'audio-btn';
  btn.title = 'Audio';
  btn.textContent = '🔊';
  btn.addEventListener('click', () => {
    Audio.play('ui/click');
    const panel = document.getElementById('audio-panel');
    panel.style.display = (panel.style.display === 'none' || !panel.style.display) ? 'block' : 'none';
  });

  const panel = el('div', `
    position:fixed; right:12px; bottom:62px; z-index:1400;
    width:260px; padding:12px; border-radius:12px;
    background:rgba(17,24,39,.95); color:#fff; border:1px solid rgba(255,255,255,.1);
    box-shadow:0 8px 20px rgba(0,0,0,.45); display:none;`);
  panel.id = 'audio-panel';
  panel.innerHTML = `
    <div style="font-weight:700; margin-bottom:8px">Audio</div>
    <label style="display:flex; align-items:center; gap:8px; margin:6px 0">
      <span style="width:70px; opacity:.85">Music</span>
      <input id="vol-music" type="range" min="0" max="1" step="0.01" style="flex:1">
      <span id="vol-music-val" style="width:34px; text-align:right; opacity:.8">100%</span>
    </label>
    <label style="display:flex; align-items:center; gap:8px; margin:6px 0">
      <span style="width:70px; opacity:.85">SFX</span>
      <input id="vol-sfx" type="range" min="0" max="1" step="0.01" style="flex:1">
      <span id="vol-sfx-val" style="width:34px; text-align:right; opacity:.8">100%</span>
    </label>
    <label style="display:flex; align-items:center; gap:8px; margin-top:8px">
      <input id="mute-all" type="checkbox">
      <span>Mute all</span>
    </label>
  `;

  document.body.appendChild(btn);
  document.body.appendChild(panel);

  // init slider values
  const mus = panel.querySelector('#vol-music');
  const sfx = panel.querySelector('#vol-sfx');
  const musVal = panel.querySelector('#vol-music-val');
  const sfxVal = panel.querySelector('#vol-sfx-val');
  const mute = panel.querySelector('#mute-all');

  // read from current state
  mus.value = String(_getGroup('music'));
  sfx.value = String(_getGroup('sfx'));
  musVal.textContent = Math.round(_getGroup('music')*100) + '%';
  sfxVal.textContent = Math.round(_getGroup('sfx')*100) + '%';
  mute.checked = (_getMaster() === 0);

  mus.addEventListener('input', () => {
    Audio.setGroupVolume('music', Number(mus.value));
    Audio.setMusicVolume(Number(mus.value)); // optional: tie music track base to slider
    musVal.textContent = Math.round(Number(mus.value)*100) + '%';
    Audio.play('ui/switch', { throttleMs: 120 });
  });
  sfx.addEventListener('input', () => {
    Audio.setGroupVolume('sfx', Number(sfx.value));
    sfxVal.textContent = Math.round(Number(sfx.value)*100) + '%';
    Audio.play('ui/switch', { throttleMs: 120 });
  });
  mute.addEventListener('change', () => {
    if (mute.checked) Audio.setMasterVolume(0);
    else Audio.setMasterVolume(0.8);
  });

  // click-away closes the panel
  document.addEventListener('click', (e) => {
    if (!panel.contains(e.target) && e.target !== btn) panel.style.display = 'none';
  }, true);

  function _getGroup(name){ try { return _state?.groups?.[name] ?? 1; } catch { return 1; } }
  function _getMaster(){ try { return _state?.master ?? 0.8; } catch { return 0.8; } }
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
  btn.addEventListener('click', () => Audio.play('ui/click'));
  btn.onclick = () => openCb?.();
  document.body.appendChild(btn);
  ensureAudioFloatingButton();
}
export function removeHudMenuButton(){
  document.getElementById('hud-menu-btn')?.remove();
}

// ---------- Pre-game main menu ----------
export function initMenuUI({ onPlay, onBuyPermanent } = {}) {
  // Stop gameplay music and start menu music (no fades)
  Audio.stopMusic();
  if (!Audio.isReady()) Audio.init();
  Audio.playMusic('music/menu', { volume: 0.5, loop: true });

  // Root overlay
  const root = el('div', `
    position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
    pointer-events:auto; font-family:system-ui,Segoe UI,Roboto,sans-serif; color:#fff; z-index:1000;`);
  root.id = 'menu-root';

  attachClickSfx(root);

  const dim = el('div','position:absolute; inset:0; background:rgba(0,0,0,.5)');
  root.appendChild(dim);

  const top = el('div',
    'position:absolute; top:16px; left:0; right:0; text-align:center; font-weight:700; font-size:18px; text-shadow:0 2px 4px rgba(0,0,0,.5)');
  root.appendChild(top);

  const play = el('button', `
    position:relative; z-index:1; padding:16px 28px; font-weight:800; font-size:22px; letter-spacing:1px;
    background:#ffcc33; color:#402; border:none; border-radius:14px; box-shadow:0 8px 20px rgba(0,0,0,.35); cursor:pointer;
    transform:translateY(0); transition:transform .05s ease;`, 'PLAY');
  play.onmousedown = () => (play.style.transform = 'translateY(2px)');
  play.onmouseup   = () => (play.style.transform = 'translateY(0)');
  play.onclick = () => {
    Audio.init();
    // switch menu -> gameplay music
    Audio.stopMusic();
    Audio.playMusic('music/wave', { volume: 0.55, loop: true });
    root.remove();
    onPlay?.();
  };
  root.appendChild(play);

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

  const refreshTop = () => {
    const snap = window.engine?.getSnapshot?.() || {};
    top.textContent = `Prestige: ${snap.prestige|0} ⚜`;
  };

  btnAbilities.onclick = () => { renderAbilities(); panel.style.display='block'; refreshTop(); };
  btnUpgrades.onclick  = () => { renderUpgrades();  panel.style.display='block'; refreshTop(); };

  const unsub   = window.engine?.subscribe?.(() => refreshTop());
  const offA1   = Engine.on?.('registry:ability',         () => { if (panel.style.display==='block') renderAbilities(); refreshTop(); });
  const offA2   = Engine.on?.('registry:ability:removed', () => { if (panel.style.display==='block') renderAbilities(); refreshTop(); });
  const offU1   = Engine.on?.('registry:upgrade',         () => { if (panel.style.display==='block') renderUpgrades();  refreshTop(); });
  const offU2   = Engine.on?.('registry:upgrade:removed', () => { if (panel.style.display==='block') renderUpgrades();  refreshTop(); });
  const offMeta = Engine.on?.('meta:buy', refreshTop);

  document.body.appendChild(root);
  refreshTop();
  ensureAudioFloatingButton();

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
  attachClickSfx(root);
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
  panel.querySelector('#pm-main').onclick      = () => {
    Audio.stopMusic();
    Audio.playMusic('music/menu', { volume: 0.5, loop: true });
    root.remove(); onMainMenu?.();
  };

  document.body.appendChild(root);
  ensureAudioFloatingButton();
}

// ---------- Defeat menu ----------
export function showDefeatMenu({ wave, prestige, onTryAgain, onMainMenu } = {}) {
  if (document.getElementById('defeat-root')) return;

  const root = el('div', `
    position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
    pointer-events:auto; font-family:system-ui,Segoe UI,Roboto,sans-serif; color:#fff; z-index:1200;`);
  root.id = 'defeat-root';
  attachClickSfx(root);

  const dim = el('div','position:absolute; inset:0; background:rgba(0,0,0,.6)');
  root.appendChild(dim);

  const panel = el('div', `
    position:relative; padding:20px; width:min(420px, 92vw);
    background:rgba(17,24,39,.95); border:1px solid rgba(255,255,255,.12); border-radius:16px; text-align:center;`);
  const prestigeText = Number(prestige||0) > 0 ? ('+' + Number(prestige) + ' ⚜ earned') : 'No prestige';
  panel.innerHTML = `
    <div style="font-weight:900; font-size:22px; margin-bottom:6px">Defeated</div>
    <div style="opacity:.9; margin-bottom:14px">Wave ${Number(wave||0)} · ${prestigeText}</div>
    <div style="display:flex; gap:10px; justify-content:center">
      <button id="df-try"  style="padding:10px 14px; border:none; border-radius:10px; background:#22c55e; color:#102a12; cursor:pointer">Try Again</button>
      <button id="df-menu" style="padding:10px 14px; border:none; border-radius:10px; background:#64748b; color:#0b1220; cursor:pointer">Main Menu</button>
    </div>
  `;
  root.appendChild(panel);

  panel.querySelector('#df-try').onclick  = () => { root.remove(); onTryAgain?.(); };
  panel.querySelector('#df-menu').onclick = () => {
    Audio.stopMusic();
    Audio.playMusic('music/menu', { volume: 0.5, loop: true });
    root.remove(); onMainMenu?.();
  };

  document.body.appendChild(root);
  ensureAudioFloatingButton();
}
