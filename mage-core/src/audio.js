// src/audio.js
// Lightweight SFX helper with gesture gating + simple spatial volume.
// + Music manager with crossfaded looping, visibility auto-pause, and unload stop.
// Exports: { Audio, installSoundHooks }

const _state = {
  ready: false,              // set true after user gesture (call Audio.init())
  master: 0.8,               // overall volume
  groups: { sfx: 1, music: 1 },
  manifest: new Map(),       // SFX: key -> array of srcs (strings)
  lastPlayAt: new Map(),     // throttle map: key -> timestamp
  minGapMs: 40,              // simple de-dupe on spammy events
};

// queued playback state (per-key)
const _playBusy = new Map();   // key -> boolean (currently playing via queue)
const _playQueue = new Map();  // key -> string[] (src queue)

function _now() { return performance.now(); }

function _pick(arr) {
  if (!arr || !arr.length) return null;
  return arr[(Math.random() * arr.length) | 0];
}

function _spawnAudioEl(src) {
  const el = new window.Audio();
  el.src = src;
  el.preload = 'auto';
  el.crossOrigin = 'anonymous';
  return el;
}

function _applyVolume(el, vol) {
  el.volume = Math.max(0, Math.min(1, vol));
}

function _spatialVol(opts) {
  // opts: { x, y, center: { cx, cy, width } }
  if (!opts || !opts.center) return 1;
  try {
    const cx = opts.center.cx(), cy = opts.center.cy();
    const w  = Math.max(1, opts.center.width?.() || 1);
    const dx = Math.abs((opts.x ?? cx) - cx);
    const dy = Math.abs((opts.y ?? cy) - cy);
    const d  = Math.hypot(dx, dy);
    // roll off with distance: at center => 1, near edge => ~0.35
    const falloff = Math.max(0.35, 1 - d / (w * 0.6));
    return falloff;
  } catch { return 1; }
}

export const Audio = {
  /** Must be called once on a user gesture (e.g., PLAY click) */
  init() { _state.ready = true; },

  /** Load a manifest: { key: string | string[] } */
  load(manifest) {
    for (const [key, src] of Object.entries(manifest || {})) {
      const list = Array.isArray(src) ? src.slice() : [src];
      // Warm cache
      for (const s of list) {
        try { _spawnAudioEl(s).load?.(); } catch {}
      }
      _state.manifest.set(key, list);
    }
  },

/** Play a sound by key. opts: { group, volume, x, y, center, throttleMs, queue, maxQueue } */
  play(key, opts = {}) {
    if (!_state.ready) return; // obey gesture gating
    const srcs = _state.manifest.get(key);
    if (!srcs || !srcs.length) return;

    // If using queue mode, we don't throttle; we serialize instead.
    const wantQueue = !!opts.queue;

    if (!wantQueue) {
        // Throttle spammy keys a bit (fire-and-forget mode)
        const gap = Math.max(0, opts.throttleMs ?? _state.minGapMs);
        const last = _state.lastPlayAt.get(key) || 0;
        const now  = _now();
        if (now - last < gap) return;
        _state.lastPlayAt.set(key, now);
    }

    const src = _pick(srcs);
    const group = opts.group || 'sfx';
    const gVol  = _state.groups[group] ?? 1;
    const spatial = _spatialVol(opts);
    const vol = (_state.master * gVol * spatial * (opts.volume ?? 1));

    if (!wantQueue) {
        // Fire-and-forget (existing behavior)
        const el = _spawnAudioEl(src);
        _applyVolume(el, vol);
        el.currentTime = 0;
        el.play?.().catch(() => {});
        el.onended = () => { try { el.src = ''; } catch {} };
        return;
    }

    // ---------- Queue mode (serialize plays for this key) ----------
    const maxQueue = Math.max(0, opts.maxQueue ?? 8);
    const q = _playQueue.get(key) || [];
    if (!_playBusy.get(key)) {
        // start immediately
        _playBusy.set(key, true);
        _playQueue.set(key, q);
        const el = _spawnAudioEl(src);
        _applyVolume(el, vol);
        el.currentTime = 0;
        el.play?.().catch(() => {});

        el.onended = () => {
        // shift next and play; when empty, mark not busy
        const next = q.shift();
        if (!next) { _playBusy.set(key, false); return; }
        const el2 = _spawnAudioEl(next);
        _applyVolume(el2, vol);
        el2.currentTime = 0;
        el2.play?.().catch(()=>{});
        el2.onended = el.onended; // reuse same handler
        // help GC
        try { el.src = ''; } catch {}
        };
    } else {
        // enqueue, respecting maxQueue
        if (q.length < maxQueue) q.push(src);
        _playQueue.set(key, q);
    }
  },


  /** Set volume for a group ('sfx' | 'music') in [0..1] */
  setGroupVolume(group, value) {
    _state.groups[group] = Math.max(0, Math.min(1, Number(value) || 0));
    // keep music decks in sync too (handled below)
    _applyMusicVolume();
  },

  /** Set master volume [0..1] */
  setMasterVolume(value) {
    _state.master = Math.max(0, Math.min(1, Number(value) || 0));
    _applyMusicVolume();
  },

  /** Quick mute/unmute */
  mute(isMuted = true) {
    _state.master = isMuted ? 0 : 0.8;
    _applyMusicVolume();
  },

  isReady() { return _state.ready; }
};

/* ================================
   MUSIC MANAGER (crossfaded loop)
   ================================ */

const _music = {
  manifest: new Map(),     // key -> src (string)
  el: null,                // HTMLAudioElement
  key: null,
  baseVol: 0.6,            // pre-master/group volume
  wantPauseOnHide: true,
  hiddenPaused: false,
};

function _ensureMusicEl() {
  if (_music.el) return _music.el;
  const el = new window.Audio();
  el.preload = 'auto';
  el.crossOrigin = 'anonymous';
  el.loop = true;         // IMPORTANT: let the browser loop it
  el.volume = 0;
  _music.el = el;
  return el;
}

function _applyMusicVolume() {
  if (!_music.el) return;
  const gVol = _state.groups.music ?? 1;
  const vol  = Math.max(0, Math.min(1, _music.baseVol * _state.master * gVol));
  _music.el.volume = vol;
}

Audio.loadMusic = function(manifest = {}) {
  for (const [key, src] of Object.entries(manifest)) {
    const val = Array.isArray(src) ? src[0] : src;
    _music.manifest.set(key, val);
  }
};

Audio.playMusic = function(key, { loop = true, volume = 0.6 } = {}) {
  if (!_state.ready) return;              // gesture gate
  const src = _music.manifest.get(key);
  if (!src) return;

  const el = _ensureMusicEl();

  // if same track already playing, just ensure settings & return
  if (_music.key === key && !el.paused) {
    el.loop = !!loop;
    _music.baseVol = Math.max(0, Math.min(1, volume));
    _applyMusicVolume();
    return;
  }

  // (re)start track
  _music.key = key;
  _music.baseVol = Math.max(0, Math.min(1, volume));
  el.loop = !!loop;
  el.src = src;
  try { el.currentTime = 0; } catch {}
  _applyMusicVolume();
  el.play?.().catch(() => {});
};

Audio.stopMusic = function() {
  const el = _music.el;
  _music.key = null;
  _music.hiddenPaused = false;
  if (!el) return;
  try { el.pause(); } catch {}
  try { el.src = ''; } catch {}
};

Audio.isMusicPlaying = function() {
  return !!(_music.el && _music.key && !_music.el.paused);
};

Audio.setMusicVolume = function(v) {
  _music.baseVol = Math.max(0, Math.min(1, Number(v) || 0));
  _applyMusicVolume();
};

// keep music volume in sync with master/group changes
const _origSetMaster = Audio.setMasterVolume;
Audio.setMasterVolume = function(v) {
  _origSetMaster.call(Audio, v);
  _applyMusicVolume();
};
const _origSetGroup = Audio.setGroupVolume;
Audio.setGroupVolume = function(group, v) {
  _origSetGroup.call(Audio, group, v);
  if (group === 'music') _applyMusicVolume();
};

// pause on tab hide, resume on show
if (!window.__audioHooksInstalled) {
  window.__audioHooksInstalled = true;

  document.addEventListener('visibilitychange', () => {
    if (!_music.wantPauseOnHide || !_music.el) return;

    if (document.hidden) {
      // pause only if we were playing
      _music.hiddenPaused = !_music.el.paused;
      if (_music.hiddenPaused) {
        try { _music.el.pause(); } catch {}
      }
    }
    // on visible: do nothing (wait for real focus)
  });

  window.addEventListener('focus', () => {
    if (!_music.wantPauseOnHide || !_music.el) return;
    if (!_music.hiddenPaused) return;     // only resume if we paused due to hide
    if (document.hidden) return;          // paranoid guard
    _music.el.play?.().catch(() => {});
    _music.hiddenPaused = false;
  });
}
// resume only when the page actually regains focus
window.addEventListener('focus', () => {
  if (!_music.wantPauseOnHide || !_music.el) return;
  if (!_music.hiddenPaused) return;          // we weren’t paused by hide
  if (document.hidden) return;               // paranoid guard

  _music.el.play?.().catch(() => {});
  _music.hiddenPaused = false;
});

// stop on navigate away (same tab)
window.addEventListener('beforeunload', () => {
  try { Audio.stopMusic(); } catch {}
});


/* =========================
   Engine sound hook helpers
   ========================= */

export function installSoundHooks(Engine, helpers = {}) {
  // Example mappings — change keys to match your manifest if you want.
  Engine.on?.('wave:start', () => Audio.play('wave/start', { group: 'music', throttleMs: 250 }));
  Engine.on?.('core:hit',   ({ by }) => {
    const p = by?.pos || { x: helpers.cx?.(), y: helpers.cy?.() };
    Audio.play('core/hurt', { x: p.x, y: p.y, center: helpers, group: 'sfx', throttleMs: 80 });
  });
  Engine.on?.('enemy:death', ({ enemy }) => {
    const p = enemy?.pos || { x: helpers.cx?.(), y: helpers.cy?.() };
    Audio.play('hit/enemy', { x: p.x, y: p.y, center: helpers, group: 'sfx', throttleMs: 30 });
  });
  Engine.on?.('upgrade:buy', () => {
  Audio.play('ui/purchase/confirm', { group: 'sfx' });
});

}
