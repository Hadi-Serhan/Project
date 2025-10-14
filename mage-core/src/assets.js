// src/assets.js
const cache = {};     // key -> Image | Image[]
let ready = false;

function loadImage(key, url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
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
      im.onload = () => resolve(im);
      im.onerror = reject;
      im.src = url;
    });
    frames.push(img);
  }
  cache[key] = frames;
}

export async function loadAssets(manifest) {
  // manifest value can be:
  // - string (single image path)
  // - { seq: { base, start, end, pad, ext } }
  // - { list: ['a.png','b.png', ...] }  // optional alternative
  const tasks = [];
  for (const [key, value] of Object.entries(manifest)) {
    if (typeof value === 'string') {
      tasks.push(loadImage(key, value));
    } else if (value && value.seq) {
      tasks.push(loadSequence(key, value.seq));
    } else if (value && Array.isArray(value.list)) {
      // Optional: explicit list of frame URLs
      tasks.push((async () => {
        const frames = [];
        for (const url of value.list) {
          const img = await new Promise((resolve, reject) => {
            const im = new Image();
            im.onload = () => resolve(im);
            im.onerror = reject;
            im.src = url;
          });
          frames.push(img);
        }
        cache[key] = frames;
      })());
    } else {
      console.warn('Unknown asset entry for', key, value);
    }
  }
  await Promise.all(tasks);
  ready = true;
}

export function getImage(key) {
  const v = cache[key];
  return Array.isArray(v) ? v[0] : v || null;
}
export function getFrames(key) {
  const v = cache[key];
  return Array.isArray(v) ? v : null;
}
export function assetsReady() { return ready; }
