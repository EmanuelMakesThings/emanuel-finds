// Local cache: one JSON file in the app's data folder. Everything the UI shows
// comes from here, so the app works with no internet after a refresh.
const { DEFAULT_STORES } = require('./stores');

const HISTORY_MAX = 30;

// Desktop storage: a file on disk. The phone build passes its own `io`.
function fileIo(dir) {
  const fs = require('fs');
  const path = require('path');
  const file = path.join(dir, 'catalogue.json');
  return {
    read: () => fs.readFileSync(file, 'utf8'),
    write: (text) => {
      fs.writeFileSync(file + '.tmp', text);
      fs.renameSync(file + '.tmp', file);
    },
  };
}

class Db {
  // `target` is a folder path (desktop) or an { read, write } pair (phone).
  constructor(target) {
    this.io = typeof target === 'string' ? fileIo(target) : target;
    this.data = { version: 1, products: {}, stores: null, storeStatus: {}, favorites: [], closet: [], outfits: [], lastRefresh: null, refreshCount: 0, settings: {} };
    try {
      const loaded = JSON.parse(this.io.read());
      Object.assign(this.data, loaded);
    } catch (e) { /* first run */ }
    if (!Array.isArray(this.data.stores)) this.data.stores = DEFAULT_STORES.map((s) => ({ ...s }));
    // Version 1.0 shipped with this store's address misspelled; fix saved lists.
    const typo = this.data.stores.find((s) => s.id === 'cxiiapparel.com');
    if (typo) {
      const fixed = DEFAULT_STORES.find((s) => s.id === 'cxxiiapparel.com');
      if (this.data.stores.some((s) => s.id === fixed.id)) this.data.stores = this.data.stores.filter((s) => s !== typo);
      else Object.assign(typo, { ...fixed, enabled: typo.enabled });
      delete this.data.storeStatus['cxiiapparel.com'];
    }

    // Prune any legacy Champion non-menswear items
    const champStore = this.data.stores && this.data.stores.find((s) => s.id === 'www.champion.com' || s.id === 'champion.com');
    if (champStore) {
      champStore.domain = 'www.champion.com/collections/men';
      champStore.name = 'CHAMPION (MEN)';
    }
    if (this.data.products) {
      let pruned = false;
      for (const [k, p] of Object.entries(this.data.products)) {
        if ((p.storeId === 'www.champion.com' || p.storeId === 'champion.com') && p.gender !== 'men') {
          delete this.data.products[k];
          pruned = true;
        }
      }
      if (pruned) this.save();
    }
  }

  save() {
    this.io.write(JSON.stringify(this.data));
  }

  snapshot() {
    const d = this.data;
    return {
      products: Object.values(d.products),
      stores: d.stores,
      storeStatus: d.storeStatus,
      favorites: d.favorites,
      closet: d.closet || [],
      outfits: d.outfits || [],
      lastRefresh: d.lastRefresh,
      settings: d.settings,
    };
  }

  // Merge one store's fresh scrape into the cache, tracking price changes.
  mergeStore(store, scraped, now, isFirstEver) {
    const d = this.data;
    const favs = new Set(d.favorites);
    const seen = new Set();
    let added = 0;
    let drops = 0;
    const wishlistAlerts = [];

    for (const p of scraped.products) {
      const old = d.products[p.key];
      const isFav = favs.has(p.key);
      // From now on, do not download sold-out items unless they are already in the catalogue or favorited
      if (!old && !isFav && !p.available) continue;
      seen.add(p.key);

      if (old) {
        p.firstSeen = old.firstSeen;
        p.history = old.history || [{ t: old.firstSeen, price: old.price }];
        p.dropFrom = old.dropFrom || null;
        p.dropAt = old.dropAt || null;
        if (p.price !== old.price) {
          p.history.push({ t: now, price: p.price });
          if (p.history.length > HISTORY_MAX) p.history = p.history.slice(-HISTORY_MAX);
          if (p.price < old.price) {
            p.dropFrom = old.price;
            p.dropAt = now;
            drops++;
            if (isFav) {
              wishlistAlerts.push({
                type: 'price_drop',
                key: p.key,
                title: p.title,
                store: store.name,
                currency: p.currency || 'USD',
                oldPrice: old.price,
                newPrice: p.price,
                dropAmount: +(old.price - p.price).toFixed(2),
                url: p.url,
                message: `Price drop: ${p.title} dropped from $${old.price} to $${p.price}!`,
              });
            }
          } else {
            p.dropFrom = null;
            p.dropAt = null;
          }
        }

        // Restock alert for wishlist items
        if (isFav) {
          if (!old.available && p.available) {
            wishlistAlerts.push({
              type: 'restock',
              key: p.key,
              title: p.title,
              store: store.name,
              currency: p.currency || 'USD',
              price: p.price,
              url: p.url,
              message: `Back in stock: ${p.title} is now available!`,
            });
          } else if (Array.isArray(old.sizes) && Array.isArray(p.sizes)) {
            const oldIn = new Set(old.sizes.filter((s) => s.inStock).map((s) => s.name));
            const newIn = p.sizes.filter((s) => s.inStock && !oldIn.has(s.name)).map((s) => s.name);
            if (newIn.length > 0) {
              wishlistAlerts.push({
                type: 'restock',
                key: p.key,
                title: p.title,
                store: store.name,
                currency: p.currency || 'USD',
                price: p.price,
                sizes: newIn,
                url: p.url,
                message: `Restock: ${p.title} restocked in size ${newIn.join(', ')}!`,
              });
            }
          }
        }

        p.justIn = false;
      } else {
        p.firstSeen = now;
        p.history = [{ t: now, price: p.price }];
        p.dropFrom = null;
        p.dropAt = null;
        // Not on the very first load, when every item would count.
        p.justIn = !isFirstEver;
        if (p.justIn) added++;
      }
      p.gone = false;
      d.products[p.key] = p;
    }

    // Items the store no longer lists: drop them, but keep favourites visible.
    for (const key of Object.keys(d.products)) {
      const p = d.products[key];
      if (p.storeId !== store.id || seen.has(key)) continue;
      if (favs.has(key)) { p.gone = true; p.available = false; p.isNew = false; p.justIn = false; }
      else delete d.products[key];
    }

    d.storeStatus[store.id] = {
      ok: true, at: now, count: scraped.products.length, added, drops, currency: scraped.currency || 'USD', newSource: scraped.newSource, error: null,
    };
    return { added, drops, wishlistAlerts };
  }

  markStoreFailed(store, message, now) {
    const prev = this.data.storeStatus[store.id] || {};
    this.data.storeStatus[store.id] = { ...prev, ok: false, error: message, failedAt: now };
  }

  toggleFavorite(key) {
    const i = this.data.favorites.indexOf(key);
    if (i >= 0) this.data.favorites.splice(i, 1);
    else this.data.favorites.push(key);
    this.save();
    return i < 0;
  }

  removeStore(id) {
    const d = this.data;
    d.stores = d.stores.filter((s) => s.id !== id);
    delete d.storeStatus[id];
    for (const key of Object.keys(d.products)) if (d.products[key].storeId === id) delete d.products[key];
    d.favorites = d.favorites.filter((k) => !k.startsWith(id + ':'));
    this.save();
  }

  mergeSync(incoming) {
    if (!incoming || typeof incoming !== 'object') return { snapshot: this.snapshot(), added: { favs: 0, closet: 0, outfits: 0, stores: 0 } };
    const d = this.data;
    d.closet = d.closet || [];
    d.outfits = d.outfits || [];
    d.stores = d.stores || [];
    d.favorites = d.favorites || [];
    d.settings = d.settings || {};

    let addedFavs = 0;
    let addedCloset = 0;
    let addedOutfits = 0;
    let addedStores = 0;

    // 1. Merge Favorites
    if (Array.isArray(incoming.favorites)) {
      const favSet = new Set(d.favorites);
      for (const k of incoming.favorites) {
        if (!favSet.has(k)) {
          favSet.add(k);
          d.favorites.push(k);
          addedFavs++;
        }
      }
    }

    // 2. Merge Stores
    if (Array.isArray(incoming.stores)) {
      for (const s of incoming.stores) {
        const existing = d.stores.find((x) => x.id === s.id || x.domain === s.domain);
        if (!existing) {
          d.stores.push({ ...s });
          addedStores++;
        }
      }
    }

    // 3. Merge Closet items
    if (Array.isArray(incoming.closet)) {
      for (const item of incoming.closet) {
        if (!item || !item.id) continue;
        const idx = d.closet.findIndex((c) => c.id === item.id || (item.url && c.url === item.url) || (item.sourceKey && c.sourceKey === item.sourceKey));
        if (idx >= 0) {
          const local = d.closet[idx];
          if (!local.photo && item.photo) local.photo = item.photo;
          if (!local.notes && item.notes) local.notes = item.notes;
          if (!local.price && item.price) local.price = item.price;
          if (!local.currency && item.currency) local.currency = item.currency;
        } else {
          d.closet.unshift({ ...item });
          addedCloset++;
        }
      }
    }

    // 4. Merge Outfits
    if (Array.isArray(incoming.outfits)) {
      for (const o of incoming.outfits) {
        if (!o || !o.id) continue;
        const existing = d.outfits.find((x) => x.id === o.id || (x.name === o.name && JSON.stringify(x.itemIds) === JSON.stringify(o.itemIds)));
        if (!existing) {
          d.outfits.unshift({ ...o });
          addedOutfits++;
        }
      }
    }

    // 5. Merge Settings
    if (incoming.settings && typeof incoming.settings === 'object') {
      Object.assign(d.settings, incoming.settings);
    }

    this.save();
    return {
      snapshot: this.snapshot(),
      added: { favs: addedFavs, closet: addedCloset, outfits: addedOutfits, stores: addedStores },
    };
  }
}

module.exports = { Db };
