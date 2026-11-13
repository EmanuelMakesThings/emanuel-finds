const { app, BrowserWindow, ipcMain, shell, protocol, net, Notification } = require('electron');
globalThis.electronNetFetch = (url, opts) => net.fetch(url, opts);
const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const QRCode = require('qrcode');
const { Db } = require('./src/db');
const { scrapeStore, cleanDomain, UA } = require('./src/scraper');
const { makeCloset } = require('./src/closet');

// Product photos are served through cfimg:// so they come from the local
// cache when offline and are fetched (then cached) when online.
protocol.registerSchemesAsPrivileged([
  { scheme: 'cfimg', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

let win;
let db;
let imgDir;
let closetDir;
let closet;
let refreshing = false;

// Photos are downloaded with the app's built-in browser engine under its own
// identity. Image hosts reject requests that pretend to be a different browser.
async function fetchImage(url) {
  if (!/^https:\/\//.test(url)) throw new Error('not a secure link');
  const res = await net.fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  if (!(res.headers.get('content-type') || '').startsWith('image/')) throw new Error('not an image');
  return res;
}

// Closet photos are kept for good, in their own folder, apart from the
// catalogue's photo cache (which only mirrors what stores currently list).
const closetFiles = {
  name: () => crypto.randomBytes(8).toString('hex') + '.img',
  async saveFromUrl(url) {
    const res = await fetchImage(url);
    const name = this.name();
    await fs.promises.writeFile(path.join(closetDir, name), Buffer.from(await res.arrayBuffer()));
    return name;
  },
  async saveFromData(dataUrl) {
    const m = /^data:image\/[a-z0-9.+-]+;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl));
    if (!m) throw new Error('not an image');
    const name = this.name();
    await fs.promises.writeFile(path.join(closetDir, name), Buffer.from(m[1], 'base64'));
    return name;
  },
  async remove(name) {
    if (/^[a-f0-9]+\.img$/.test(name)) await fs.promises.unlink(path.join(closetDir, name));
  },
};

// ---------------------------------------------------------------- images

function thumbUrl(url) {
  try {
    const u = new URL(url);
    if (u.hostname === 'cdn.shopify.com' || u.pathname.includes('/cdn/shop/')) u.searchParams.set('width', '480');
    return u.toString();
  } catch (e) {
    return url;
  }
}

function imgName(url) {
  return crypto.createHash('sha1').update(url).digest('hex') + '.img';
}

function imgPath(url) {
  return path.join(imgDir, imgName(url));
}

const cachedImages = new Set();
try {
  if (fs.existsSync(imgDir)) {
    for (const f of fs.readdirSync(imgDir)) {
      if (f.endsWith('.img')) cachedImages.add(f);
    }
  }
} catch (e) {}

function hasCachedImage(url) {
  const name = imgName(url);
  if (cachedImages.has(name)) return true;
  if (fs.existsSync(path.join(imgDir, name))) {
    cachedImages.add(name);
    return true;
  }
  return false;
}

const inflight = new Map();

async function cacheImage(url) {
  const name = imgName(url);
  const file = path.join(imgDir, name);
  if (cachedImages.has(name)) return file;
  if (fs.existsSync(file)) {
    cachedImages.add(name);
    return file;
  }
  if (inflight.has(url)) return inflight.get(url);
  const job = (async () => {
    const res = await fetchImage(thumbUrl(url));
    const buf = Buffer.from(await res.arrayBuffer());
    await fs.promises.writeFile(file + '.tmp', buf);
    await fs.promises.rename(file + '.tmp', file);
    cachedImages.add(name);
    return file;
  })().finally(() => inflight.delete(url));
  inflight.set(url, job);
  return job;
}

function registerImageProtocol() {
  protocol.handle('cfimg', async (request) => {
    try {
      const parsed = new URL(request.url);
      if (parsed.hostname === 'closet') {
        const name = parsed.searchParams.get('f') || '';
        if (!/^[a-f0-9]+\.img$/.test(name)) return new Response('', { status: 400 });
        return net.fetch(pathToFileURL(path.join(closetDir, name)).toString());
      }
      const url = parsed.searchParams.get('u');
      if (!url || !/^https:\/\//.test(url)) return new Response('', { status: 400 });
      const file = await cacheImage(url);
      return net.fetch(pathToFileURL(file).toString());
    } catch (e) {
      return new Response('', { status: 404 });
    }
  });
}

async function pool(items, size, worker) {
  let i = 0;
  const run = async () => {
    while (i < items.length) {
      const item = items[i++];
      await worker(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, run));
}

// ---------------------------------------------------------------- refresh

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

async function refresh() {
  if (refreshing) return { busy: true };
  refreshing = true;
  const now = new Date().toISOString();
  const stores = db.data.stores.filter((s) => s.enabled);
  const isFirstEver = Object.keys(db.data.products).length === 0;
  const state = {};
  for (const s of stores) state[s.id] = { name: s.name, state: 'waiting', msg: '' };
  const push = (extra = {}) => send('refresh:progress', { phase: 'stores', stores: state, ...extra });
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
        db.markStoreFailed(store, e.message, now);
        summary.failed.push({ name: store.name, error: e.message });
        state[store.id] = { name: store.name, state: 'fail', msg: e.message };
      }
      push();
    });

    if (summary.ok > 0) {
      db.data.lastRefresh = now;
      db.data.refreshCount = (db.data.refreshCount || 0) + 1;
    }
    db.save();
    // Show the catalogue now; photos keep downloading behind it.
    send('data:changed', db.snapshot());

    // Send notifications for wishlist items
    if (allWishlistAlerts.length > 0) {
      send('wishlist:alerts', allWishlistAlerts);
      for (const alert of allWishlistAlerts) {
        try {
          if (Notification.isSupported()) {
            new Notification({
              title: alert.type === 'price_drop' ? 'PRICE DROP (WISHLIST)' : 'RESTOCK (WISHLIST)',
              body: alert.message,
            }).show();
          }
        } catch (e) { /* ignore */ }
      }
    }

    const urls = [...new Set(Object.values(db.data.products).map((p) => p.image).filter(Boolean))]
      .filter((u) => !hasCachedImage(u));
    let done = 0;
    let failedImgs = 0;
    send('refresh:progress', { phase: 'images', stores: state, done, total: urls.length });
    await pool(urls, 8, async (u) => {
      try { await cacheImage(u); } catch (e) { failedImgs++; }
      done++;
      if (done % 5 === 0 || done === urls.length) {
        send('refresh:progress', { phase: 'images', stores: state, done, total: urls.length });
      }
    });
    summary.images = urls.length - failedImgs;
    summary.imagesFailed = failedImgs;
    send('refresh:progress', { phase: 'done', stores: state, summary });
    return { summary };
  } catch (e) {
    send('refresh:progress', { phase: 'done', stores: state, summary, error: e.message });
    return { error: e.message };
  } finally {
    refreshing = false;
  }
}

// ---------------------------------------------------------------- ipc

function registerIpc() {
  ipcMain.handle('data:get', () => db.snapshot());
  ipcMain.handle('refresh', () => refresh());
  ipcMain.handle('fav:toggle', (_e, key) => db.toggleFavorite(String(key)));

  ipcMain.handle('open', (_e, url) => {
    if (typeof url === 'string' && /^https:\/\//.test(url)) shell.openExternal(url);
  });

  ipcMain.handle('settings:set', (_e, patch) => {
    Object.assign(db.data.settings, patch || {});
    db.save();
  });

  ipcMain.handle('stores:add', (_e, input) => {
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
  });

  ipcMain.handle('stores:remove', (_e, id) => {
    db.removeStore(String(id));
    return db.snapshot();
  });

  ipcMain.handle('stores:toggle', (_e, id) => {
    const s = db.data.stores.find((x) => x.id === id);
    if (s) { s.enabled = !s.enabled; db.save(); }
    return db.snapshot();
  });

  ipcMain.handle('closet:addUrl', (_e, url) => closet.addUrl(url));
  ipcMain.handle('closet:addProduct', (_e, key) => {
    const p = db.data.products[key];
    const store = p && db.data.stores.find((s) => s.id === p.storeId);
    return closet.addProduct(String(key), store && store.name);
  });
  ipcMain.handle('closet:save', (_e, fields) => closet.save(fields));
  ipcMain.handle('closet:remove', (_e, id) => closet.remove(String(id)));
  ipcMain.handle('outfit:save', (_e, outfit) => closet.outfitSave(outfit));
  ipcMain.handle('outfit:remove', (_e, id) => closet.outfitRemove(String(id)));

  ipcMain.handle('sync:start', () => startSyncServer());
  ipcMain.handle('sync:stop', () => stopSyncServer());
  ipcMain.handle('sync:export', async () => exportSyncBundle());
  ipcMain.handle('sync:import', async (_e, raw) => importSyncBundle(raw));

  ipcMain.on('win', (_e, action) => {
    if (!win) return;
    if (action === 'min') win.minimize();
    else if (action === 'max') (win.isMaximized() ? win.unmaximize() : win.maximize());
    else if (action === 'close') win.close();
  });
}

// ---------------------------------------------------------------- sync server

let syncServer = null;
let syncInfo = null;

function getLocalIp() {
  const ifaces = os.networkInterfaces();
  const candidates = [];
  for (const name of Object.keys(ifaces)) {
    const isVpn = /tailscale|docker|wsl|vethernet|hyper-v|tap|tun/i.test(name);
    for (const net of ifaces[name] || []) {
      if (net.family === 'IPv4' && !net.internal && !net.address.startsWith('127.') && !net.address.startsWith('169.254.')) {
        candidates.push({ address: net.address, isVpn, name });
      }
    }
  }
  const best = candidates.find((c) => !c.isVpn && (/^192\.168\./.test(c.address) || /^10\./.test(c.address) || /^172\.(1[6-9]|2[0-9]|3[01])\./.test(c.address)));
  if (best) return best.address;
  if (candidates.length) return candidates[0].address;
  return '127.0.0.1';
}

async function startSyncServer() {
  if (syncServer && syncInfo) return syncInfo;
  const port = 8765;
  const token = crypto.randomBytes(8).toString('hex');
  const ip = getLocalIp();
  const syncUrl = `http://${ip}:${port}/sync?token=${token}`;

  try {
    require('child_process').exec('adb reverse tcp:8765 tcp:8765', () => {});
  } catch (e) {}

  return new Promise((resolve, reject) => {
    syncServer = http.createServer(async (req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        return res.end();
      }

      const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      if (parsedUrl.searchParams.get('token') !== token) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'invalid sync token' }));
      }

      if (req.method === 'GET' && parsedUrl.pathname === '/sync') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: true, name: 'Emanuel Finds Desktop', status: 'ready' }));
      }

      if (req.method === 'POST' && parsedUrl.pathname === '/sync') {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', async () => {
          try {
            const payload = JSON.parse(body || '{}');
            const incomingPhotos = payload.photos || {};

            for (const [name, b64] of Object.entries(incomingPhotos)) {
              if (/^[a-f0-9]+\.img$/.test(name)) {
                try {
                  const targetPath = path.join(closetDir, name);
                  if (!fs.existsSync(targetPath)) {
                    await fs.promises.writeFile(targetPath, Buffer.from(b64, 'base64'));
                  }
                } catch (e) { /* keep going */ }
              }
            }

            const mergeResult = db.mergeSync(payload.data || {});

            const phoneKnownPhotos = new Set(Object.keys(incomingPhotos));
            if (Array.isArray(payload.knownPhotoNames)) {
              payload.knownPhotoNames.forEach((n) => phoneKnownPhotos.add(n));
            }

            const outgoingPhotos = {};
            for (const item of db.data.closet || []) {
              if (item.photo && !phoneKnownPhotos.has(item.photo)) {
                try {
                  const pFile = path.join(closetDir, item.photo);
                  if (fs.existsSync(pFile)) {
                    outgoingPhotos[item.photo] = (await fs.promises.readFile(pFile)).toString('base64');
                  }
                } catch (e) { /* ignore */ }
              }
            }

            send('sync:complete', { source: 'phone', added: mergeResult.added });
            send('data:changed', db.snapshot());

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              ok: true,
              data: db.snapshot(),
              photos: outgoingPhotos,
              added: mergeResult.added,
            }));
          } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: e.message }));
          }
        });
        return;
      }

      res.writeHead(404);
      res.end();
    });

    syncServer.on('error', (err) => {
      syncServer = null;
      syncInfo = null;
      reject(err);
    });

    syncServer.listen(port, async () => {
      const qrDataUrl = await QRCode.toDataURL(syncUrl, { margin: 1, width: 280, color: { dark: '#00ff88', light: '#05010d' } });
      syncInfo = { qrDataUrl, syncUrl, ip, port, token };
      resolve(syncInfo);
    });
  });
}

function stopSyncServer() {
  if (syncServer) {
    try { syncServer.close(); } catch (e) {}
    syncServer = null;
    syncInfo = null;
  }
  return { ok: true };
}

async function exportSyncBundle() {
  const photos = {};
  for (const item of db.data.closet || []) {
    if (item.photo) {
      try {
        const p = path.join(closetDir, item.photo);
        if (fs.existsSync(p)) photos[item.photo] = (await fs.promises.readFile(p)).toString('base64');
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
        const target = path.join(closetDir, name);
        if (!fs.existsSync(target)) await fs.promises.writeFile(target, Buffer.from(b64, 'base64'));
      }
    }
    const r = db.mergeSync(bundle.data || {});
    send('data:changed', db.snapshot());
    return { ok: true, added: r.added };
  } catch (e) {
    return { ok: false, error: e.message };
  }
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
      try {
        await refresh();
      } catch (e) { /* ignore */ }
      scheduleNext();
    }, delay);
  };
  scheduleNext();

  // On app launch: scan after a brief startup pause if not refreshed recently (last 15m)
  setTimeout(() => {
    const last = db && db.data.lastRefresh ? Date.parse(db.data.lastRefresh) : 0;
    if (Date.now() - last > 15 * 60 * 1000) {
      refresh();
    }
  }, 3000);
}

// ---------------------------------------------------------------- window

function createWindow() {
  win = new BrowserWindow({
    title: 'Emanuel Finds',
    width: 1400,
    height: 900,
    minWidth: 980,
    minHeight: 620,
    frame: false,
    icon: path.join(__dirname, 'build/icon.png'),
    backgroundColor: '#05010d',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // Store links always open in the real browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  // Dev-only screenshot run (see scripts/shot.js); never active in the exe.
  if (process.env.CF_SHOT && !app.isPackaged) require(process.env.CF_SHOT_MODE === 'closet' ? './scripts/shot-closet' : './scripts/shot')(win);
}

// Only one copy at a time: a second launch just brings the window forward.
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
});

app.whenReady().then(() => {
  let dataDir = process.env.EMANUEL_FINDS_DATA || process.env.CLOTHESFINDER_DATA;
  if (!dataDir) {
    const defaultDir = app.getPath('userData');
    const legacyDir = path.join(app.getPath('appData'), 'ClothesFinder');
    if (!fs.existsSync(path.join(defaultDir, 'catalogue.json')) && fs.existsSync(path.join(legacyDir, 'catalogue.json'))) {
      dataDir = legacyDir;
    } else {
      dataDir = defaultDir;
    }
  }
  imgDir = path.join(dataDir, 'images');
  fs.mkdirSync(imgDir, { recursive: true });
  closetDir = path.join(dataDir, 'closet');
  fs.mkdirSync(closetDir, { recursive: true });
  db = new Db(dataDir);
  closet = makeCloset(db, closetFiles);
  registerImageProtocol();
  registerIpc();
  createWindow();
  initScheduler();
});

app.on('window-all-closed', () => app.quit());
