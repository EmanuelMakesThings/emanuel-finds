// Phone implementation of the `window.api` the interface talks to. On the PC
// this job is done by Electron (main.js); here it runs inside the app itself,
// using Android storage and native networking through Capacitor.
const { Capacitor } = require('@capacitor/core');
const { Filesystem, Directory, Encoding } = require('@capacitor/filesystem');
const { App } = require('@capacitor/app');
const { Browser } = require('@capacitor/browser');
const { LocalNotifications } = require('@capacitor/local-notifications');
const { Db } = require('../../src/db');
const { scrapeStore, cleanDomain } = require('../../src/scraper');
const { makeCloset } = require('../../src/closet');

const CLOSET_DIR = 'closet';
let closet;
let closetBase = '';

// Closet photos are kept for good, apart from the catalogue's photo cache.
const closetFiles = {
  name: () => Date.now().toString(16) + Math.random().toString(16).slice(2, 10) + '.img',
  async saveFromUrl(url) {
    const name = this.name();
    await Filesystem.downloadFile({ url, path: CLOSET_DIR + '/' + name, directory: Directory.Data });
    return name;
  },
  async saveFromData(dataUrl) {
    const m = /^data:image\/[a-z0-9.+-]+;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl));
    if (!m) throw new Error('not an image');
    const name = this.name();
    await Filesystem.writeFile({ path: CLOSET_DIR + '/' + name, directory: Directory.Data, data: m[1] });
    return name;
  },
  async remove(name) {
    if (/^[a-f0-9]+\.img$/.test(name)) await Filesystem.deleteFile({ path: CLOSET_DIR + '/' + name, directory: Directory.Data });
  },
};

const DB_FILE = 'catalogue.json';
const IMG_DIR = 'images';
const DIR = Directory.Data;

let db;
let imgBase = ''; // WebView-readable URL prefix of the photo folder
const cached = new Set(); // photo file names already saved on the phone
const inflight = new Map();
let refreshing = false;
const listeners = { progress: [], data: [], wishlistAlerts: [], syncComplete: [] };
const emit = (type, payload) => listeners[type].forEach((fn) => fn(payload));

// ---------------------------------------------------------------- photos

// Small, fast, synchronous hash: the interface needs a file name instantly.
function hashName(url) {
  let a = 0x811c9dc5;
  let b = 5381;
  for (let i = 0; i < url.length; i++) {
    const c = url.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = (Math.imul(b, 33) + c) | 0;
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0') + url.length.toString(16) + '.img';
}

function thumbUrl(url) {
  try {
    const u = new URL(url);
    if (u.hostname === 'cdn.shopify.com' || u.pathname.includes('/cdn/shop/')) u.searchParams.set('width', '480');
    return u.toString();
  } catch (e) {
    return url;
  }
}

// Saved copy if we have one, otherwise straight from the store (when online).
function img(url) {
  const name = hashName(url);
  return cached.has(name) ? imgBase + '/' + name : thumbUrl(url);
}

function cacheImage(url) {
  const name = hashName(url);
  if (cached.has(name)) return Promise.resolve();
  if (inflight.has(name)) return inflight.get(name);
  const job = Filesystem.downloadFile({ url: thumbUrl(url), path: IMG_DIR + '/' + name, directory: DIR })
    .then(() => { cached.add(name); })
    .finally(() => inflight.delete(name));
  inflight.set(name, job);
  return job;
}

async function pool(items, size, worker) {
  let i = 0;
  const run = async () => {
    while (i < items.length) await worker(items[i++]);
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, run));
}

// ---------------------------------------------------------------- storage

// Saves are queued so two quick changes can never interleave on disk.
let writeChain = Promise.resolve();
function writeDb(text) {
  writeChain = writeChain
    .then(() => Filesystem.writeFile({ path: DB_FILE + '.tmp', directory: DIR, encoding: Encoding.UTF8, data: text }))
    .then(() => Filesystem.rename({ from: DB_FILE + '.tmp', to: DB_FILE, directory: DIR }))
    .catch((e) => console.error('save failed', e));
  return writeChain;
}

async function init() {
  let saved = null;
  try {
    saved = (await Filesystem.readFile({ path: DB_FILE, directory: DIR, encoding: Encoding.UTF8 })).data;
  } catch (e) { /* first run */ }
  db = new Db({ read: () => { if (saved === null) throw new Error('empty'); return saved; }, write: writeDb });

  try { await Filesystem.mkdir({ path: IMG_DIR, directory: DIR, recursive: true }); } catch (e) { /* exists */ }
  const { uri } = await Filesystem.getUri({ path: IMG_DIR, directory: DIR });
  imgBase = Capacitor.convertFileSrc(uri).replace(/\/$/, '');
  try { await Filesystem.mkdir({ path: CLOSET_DIR, directory: DIR, recursive: true }); } catch (e) { /* exists */ }
  closetBase = Capacitor.convertFileSrc((await Filesystem.getUri({ path: CLOSET_DIR, directory: DIR })).uri).replace(/\/$/, '');
  closet = makeCloset(db, closetFiles);
  try {
    const { files } = await Filesystem.readdir({ path: IMG_DIR, directory: DIR });
    for (const f of files) cached.add(f.name);
  } catch (e) { /* none yet */ }

  try {
    await LocalNotifications.requestPermissions();
  } catch (e) { /* ignore */ }

  initScheduler();
}

// ---------------------------------------------------------------- scheduler (6h, starting 8am + launch)

function getNextScheduleDelay(hours = [2, 8, 14, 20]) {
  const now = new Date();
  for (const h of hours) {
    const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, 0, 0, 0);
    if (target > now) return target.getTime() - now.getTime();
  }
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, hours[0], 0, 0, 0);
  return tomorrow.getTime() - now.getTime();
}

function initScheduler() {
  const scheduleNext = () => {
    const delay = getNextScheduleDelay();
    setTimeout(async () => {
      try { await refresh(); } catch (e) {}
      scheduleNext();
    }, delay);
  };
  scheduleNext();

  setTimeout(async () => {
    const last = db && db.data.lastRefresh ? Date.parse(db.data.lastRefresh) : 0;
    if (Date.now() - last > 15 * 60 * 1000) {
      refresh();
    }
  }, 3000);
}

// ---------------------------------------------------------------- refresh

async function refresh() {
  if (refreshing) return { busy: true };
  refreshing = true;
  const now = new Date().toISOString();
  const stores = db.data.stores.filter((s) => s.enabled);
  const isFirstEver = Object.keys(db.data.products).length === 0;
  const state = {};
  for (const s of stores) state[s.id] = { name: s.name, state: 'waiting', msg: '' };
  const push = () => emit('progress', { phase: 'stores', stores: state });
  const summary = { added: 0, drops: 0, failed: [], ok: 0 };
  const allWishlistAlerts = [];

  try {
    push();
    await pool(stores, 4, async (store) => {
      state[store.id].state = 'working';
      push();
      try {
        const existingKeys = new Set(Object.keys(db.data.products));
        const scraped = await scrapeStore(store, (msg) => { state[store.id].msg = msg; push(); }, existingKeys);
        const r = db.mergeStore(store, scraped, now, isFirstEver);
        summary.added += r.added;
        summary.drops += r.drops;
        summary.ok++;
        if (r.wishlistAlerts && r.wishlistAlerts.length) allWishlistAlerts.push(...r.wishlistAlerts);
        state[store.id] = { name: store.name, state: 'ok', msg: `${scraped.products.length} items` };
      } catch (e) {
        const msg = (e && e.message) || String(e);
        db.markStoreFailed(store, msg, now);
        summary.failed.push({ name: store.name, error: msg });
        state[store.id] = { name: store.name, state: 'fail', msg };
      }
      push();
    });

    if (summary.ok > 0) {
      db.data.lastRefresh = now;
      db.data.refreshCount = (db.data.refreshCount || 0) + 1;
    }
    db.save();
    emit('data', db.snapshot());

    if (allWishlistAlerts.length > 0) {
      emit('wishlistAlerts', allWishlistAlerts);
      try {
        const notifs = allWishlistAlerts.slice(0, 10).map((a, idx) => ({
          id: (Date.now() % 100000) + idx,
          title: a.type === 'price_drop' ? 'PRICE DROP (WISHLIST)' : 'RESTOCK (WISHLIST)',
          body: a.message,
          schedule: { at: new Date(Date.now() + 500) },
        }));
        await LocalNotifications.schedule({ notifications: notifs });
      } catch (e) { /* ignore */ }
    }

    const urls = [...new Set(Object.values(db.data.products).map((p) => p.image).filter(Boolean))]
      .filter((u) => !cached.has(hashName(u)));
    let done = 0;
    let failedImgs = 0;
    emit('progress', { phase: 'images', stores: state, done, total: urls.length });
    await pool(urls, 6, async (u) => {
      try { await cacheImage(u); } catch (e) { failedImgs++; }
      done++;
      if (done % 5 === 0 || done === urls.length) emit('progress', { phase: 'images', stores: state, done, total: urls.length });
    });
    summary.images = urls.length - failedImgs;
    summary.imagesFailed = failedImgs;
    emit('progress', { phase: 'done', stores: state, summary });
    return { summary };
  } catch (e) {
    emit('progress', { phase: 'done', stores: state, summary, error: (e && e.message) || String(e) });
    return { error: String(e) };
  } finally {
    refreshing = false;
  }
}

async function exportSyncBundle() {
  const photos = {};
  for (const item of db.data.closet || []) {
    if (item.photo) {
      try {
        const f = await Filesystem.readFile({ path: CLOSET_DIR + '/' + item.photo, directory: DIR });
        if (f && f.data) photos[item.photo] = f.data;
      } catch (e) {}
    }
  }
  return JSON.stringify({
    version: 1,
    createdAt: new Date().toISOString(),
    data: db.snapshot(),
    photos,
  });
}

async function importSyncBundle(bundleStr) {
  try {
    const bundle = typeof bundleStr === 'string' ? JSON.parse(bundleStr) : bundleStr;
    const incomingPhotos = bundle.photos || {};
    for (const [name, b64] of Object.entries(incomingPhotos)) {
      if (/^[a-f0-9]+\.img$/.test(name)) {
        try {
          await Filesystem.writeFile({ path: CLOSET_DIR + '/' + name, directory: DIR, data: b64 });
        } catch (e) {}
      }
    }
    const r = db.mergeSync(bundle.data || {});
    emit('data', db.snapshot());
    return { ok: true, added: r.added };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function syncWithServer(url) {
  const photos = {};
  const known = [];
  for (const item of db.data.closet || []) {
    if (item.photo) {
      known.push(item.photo);
      try {
        const f = await Filesystem.readFile({ path: CLOSET_DIR + '/' + item.photo, directory: DIR });
        if (f && f.data) photos[item.photo] = f.data;
      } catch (e) {}
    }
  }

  const u = new URL(url);
  const token = u.searchParams.get('token') || '';
  const postUrl = `${u.origin}/sync?token=${encodeURIComponent(token)}`;

  const reqBody = JSON.stringify({
    token,
    data: db.snapshot(),
    photos,
    knownPhotoNames: known,
  });

  let res;
  try {
    res = await fetch(postUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: reqBody,
      signal: AbortSignal.timeout(12000),
    });
  } catch (err) {
    if (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost') {
      try {
        res = await fetch(`http://127.0.0.1:${u.port || 8765}/sync?token=${encodeURIComponent(token)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: reqBody,
          signal: AbortSignal.timeout(12000),
        });
      } catch (e2) {
        throw err;
      }
    } else {
      throw err;
    }
  }

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const reply = await res.json();
  if (reply.error) throw new Error(reply.error);

  const newPhotos = reply.photos || {};
  for (const [name, b64] of Object.entries(newPhotos)) {
    if (/^[a-f0-9]+\.img$/.test(name)) {
      try {
        await Filesystem.writeFile({ path: CLOSET_DIR + '/' + name, directory: DIR, data: b64 });
      } catch (e) {}
    }
  }

  const r = db.mergeSync(reply.data || {});
  emit('data', db.snapshot());
  emit('syncComplete', { source: 'desktop', added: r.added });
  return { ok: true, added: r.added };
}

// ---------------------------------------------------------------- api

const ready = init();
const whenReady = (fn) => async (...args) => { await ready; return fn(...args); };

window.api = {
  platform: 'android',
  img,
  getData: whenReady(() => db.snapshot()),
  refresh: whenReady(refresh),
  toggleFavorite: whenReady((key) => db.toggleFavorite(String(key))),
  open: (url) => { if (/^https:\/\//.test(url)) Browser.open({ url }); },
  setSettings: whenReady((patch) => { Object.assign(db.data.settings, patch || {}); db.save(); }),
  addStore: whenReady((input) => {
    const cleaned = cleanDomain(input);
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/.*)?$/i.test(cleaned)) return { error: 'That does not look like a website address.' };
    if (db.data.stores.some((s) => s.id === cleaned || s.domain === cleaned)) return { error: 'That store is already on the list.' };
    const domainOnly = cleaned.split('/')[0];
    let name = domainOnly.replace(/^www\./, '').split('.')[0].replace(/[-_]+/g, ' ').toUpperCase();
    if (cleaned.includes('hm.com')) name = 'H&M GRAPHIC TEES';
    else if (cleaned.includes('champion') && cleaned.includes('men')) name = 'CHAMPION (MEN)';
    else if (cleaned.includes('saint-michael') || cleaned.includes('saint-mxxxxxx')) name = `${name} (SAINT MXXXXXX)`;
    db.data.stores.push({ id: cleaned, domain: cleaned, name, enabled: true });
    db.save();
    return { snapshot: db.snapshot() };
  }),
  removeStore: whenReady((id) => { db.removeStore(String(id)); return db.snapshot(); }),
  toggleStore: whenReady((id) => {
    const s = db.data.stores.find((x) => x.id === id);
    if (s) { s.enabled = !s.enabled; db.save(); }
    return db.snapshot();
  }),
  closetImg: (name) => closetBase + '/' + name,
  closetAddUrl: whenReady((url) => closet.addUrl(url)),
  closetAddProduct: whenReady((key) => {
    const p = db.data.products[key];
    const store = p && db.data.stores.find((s) => s.id === p.storeId);
    return closet.addProduct(String(key), store && store.name);
  }),
  closetSave: whenReady((fields) => closet.save(fields)),
  closetRemove: whenReady((id) => closet.remove(String(id))),
  outfitSave: whenReady((outfit) => closet.outfitSave(outfit)),
  outfitRemove: whenReady((id) => closet.outfitRemove(String(id))),
  syncConnect: whenReady(syncWithServer),
  exportSyncBundle: whenReady(exportSyncBundle),
  importSyncBundle: whenReady(importSyncBundle),
  win: () => {},
  onProgress: (fn) => listeners.progress.push(fn),
  onData: (fn) => listeners.data.push(fn),
  onWishlistAlerts: (fn) => listeners.wishlistAlerts.push(fn),
  onSyncComplete: (fn) => listeners.syncComplete.push(fn),
  // The phone's back button/gesture: the interface decides what to close.
  onBack: (fn) => App.addListener('backButton', () => { if (!fn()) App.minimizeApp(); }),
};
