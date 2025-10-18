// src/assets.js
import Engine from './engine.js';

const cache = {};     // key -> Image | Image[]
let ready = false;

// ---- simple event hub for assets (progress/ready) ----
const listeners = new Map(); // evt -> Set<fn>
function on(evt, fn){ if(!listeners.has(evt)) listeners.set(evt, new Set()); listeners.get(evt).add(fn); return () => listeners.get(evt).delete(fn); }
function emit(evt, payload){ const set = listeners.get(evt); if(set) for(const fn of set){ try{ fn(payload);}catch{} } }
export const assetsEvents = { on };

// Promise that resolves once initial loadAssets finishes
let _readyResolve;
export const whenReady = new Promise(res => (_readyResolve = res));

// -------------------- Low-level loaders --------------------
function loadImage(key, url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // allow CDN-hosted assets
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) img.crossOrigin = 'anonymous';
    img.onload = () => { cache[key] = img; resolve(); };
    img.onerror = (e) => { console.warn('Failed image', key, url, e); reject(e); };
    img.src = url;
  });
}

// Expand a sequence descriptor into frames and store as Image[]
async function loadSequence(key, seq) {
  const {
    base,          // 'assets/necromancer/walk_'
    start = 0,     // 0
    end,           // 7   (inclusive)
    pad = 0,       // 2   -> '00'
    ext = '.png'   // '.png'
  } = seq;

  const frames = [];
  for (let i = start; i <= end; i++) {
    const num = pad ? String(i).padStart(pad, '0') : String(i);
    const url = `${base}${num}${ext}`;
    const img = await new Promise((resolve, reject) => {
      const im = new Image();
      if (typeof url === 'string' && /^https?:\/\//i.test(url)) im.crossOrigin = 'anonymous';
      im.onload = () => resolve(im);
      im.onerror = (err) => {
        console.warn('Failed frame', key, url, err);
        reject(err);
      };
      im.src = url;
    });
    frames.push(img);
  }
  cache[key] = frames;
}

// Optional explicit list of frame URLs
async function loadList(key, list) {
  const frames = [];
  for (const url of list) {
    const img = await new Promise((resolve, reject) => {
      const im = new Image();
      if (typeof url === 'string' && /^https?:\/\//i.test(url)) im.crossOrigin = 'anonymous';
      im.onload = () => resolve(im);
      im.onerror = reject;
      im.src = url;
    });
    frames.push(img);
  }
  cache[key] = frames;
}

// -------------------- Public load APIs --------------------
// Original API (kept as-is). Use at boot for the base manifest.
export async function loadAssets(manifest) {
  await addAssets(manifest);
  ready = true;
  _readyResolve?.();
  emit('ready', { ready: true });
}

// New: can be called any time (e.g., by mods) to add/override assets.
export async function addAssets(manifest = {}) {
  const entries = Object.entries(manifest || {});
  const total = entries.length || 1;
  let done = 0;
  const tick = () => { done++; emit('progress', { done, total }); };

  const tasks = [];
  for (const [key, value] of entries) {
    // De-dupe: if the same key is already loaded and the value looks identical-type, skip.
    if (cache[key]) {
      if (value && typeof value === 'object' && ('alias' in value || 'replace' in value)) {
        // allow override paths below
      } else {
        const existing = cache[key];
        const isSeq = Array.isArray(existing);
        const wantsSeq = value && (value.seq || Array.isArray(value.list));
        if ((isSeq && wantsSeq) || (!isSeq && typeof value === 'string')) {
          tick(); // no-op but count toward progress
          continue;
        }
      }
    }

    // Handle aliasing (multiple keys sharing the same cached asset)
    if (value && typeof value === 'object' && value.alias) {
      const target = cache[value.alias];
      if (target) {
        cache[key] = target;
      } else {
        console.warn(`Alias target "${value.alias}" not found for key "${key}"`);
      }
      tick();
      continue;
    }

    // Handle explicit replace request
    if (value && typeof value === 'object' && value.replace) {
      delete cache[key];
    }

    // Dispatch loaders by shape
    if (typeof value === 'string') {
      tasks.push(loadImage(key, value).then(tick));
    } else if (value && value.seq) {
      tasks.push(loadSequence(key, value.seq).then(tick));
    } else if (value && Array.isArray(value.list)) {
      tasks.push(loadList(key, value.list).then(tick));
    } else {
      console.warn('Unknown asset entry for', key, value);
      tick();
    }
  }
  await Promise.all(tasks);
}

// -------------------- Queries --------------------
export function getImage(key) {
  const v = cache[key];
  return Array.isArray(v) ? v[0] : v || null;
}
export function getFrames(key) {
  const v = cache[key];
  return Array.isArray(v) ? v : null;
}
export function assetsReady() { return ready; }
export function hasAsset(key) { return key in cache; }
export function listAssets() { return Object.keys(cache); }
export function removeAssets(keys = []) { for (const k of keys) delete cache[k]; }

// -------------------- Engine bridge for mods --------------------
// Allows mods to call: Engine.setAssets({ ... })
Engine.setAssetsBridge(async (manifest) => {
  try {
    await addAssets(manifest);
  } catch (e) {
    console.warn('Engine.setAssetsBridge failed:', e);
  }
});
