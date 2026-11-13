// "My Closet": clothes the user owns, and outfits built from them.
//
// Closet items are permanent snapshots. Details and the photo are copied into
// the app's own storage when an item is added, so they survive the product
// being taken down, a store being removed, or the catalogue being refreshed.
// Shared by the desktop and phone builds; each passes its own `files` adapter.

const { request, categorize } = require('./scraper');

// ---------------------------------------------------------------- page reading

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '-', mdash: '-', rsquo: "'", lsquo: "'", reg: '', trade: '' };
function decode(s) {
  return String(s == null ? '' : s)
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(+d))
    .replace(/&([a-z]+);/gi, (m, n) => (n.toLowerCase() in ENTITIES ? ENTITIES[n.toLowerCase()] : m))
    .replace(/\s+/g, ' ')
    .trim();
}

function metaTags(html) {
  const out = {};
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const attr = (n) => {
      const m = tag.match(new RegExp('\\b' + n + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\')', 'i'));
      return m ? (m[1] !== undefined ? m[1] : m[2]) : null;
    };
    const key = (attr('property') || attr('name') || attr('itemprop') || '').toLowerCase();
    const content = attr('content');
    if (key && content && !(key in out)) out[key] = decode(content);
  }
  return out;
}

// Structured product data most shops embed for search engines.
function jsonLdProduct(html) {
  const blocks = html.match(/<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || [];
  const found = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    const type = [].concat(node['@type'] || []).map(String);
    if (type.some((t) => /^(Product|ProductGroup)$/i.test(t))) found.push(node);
    if (node['@graph']) walk(node['@graph']);
    if (node.mainEntity) walk(node.mainEntity);
  };
  for (const b of blocks) {
    try { walk(JSON.parse(b.replace(/^<script[^>]*>/i, '').replace(/<\/script>$/i, '').trim())); } catch (e) { /* malformed */ }
  }
  const p = found[0];
  if (!p) return {};
  const first = (v) => (Array.isArray(v) ? v[0] : v);
  let image = first(p.image);
  if (image && typeof image === 'object') image = image.url || image.contentUrl;
  let offer = first(p.offers);
  if (offer && offer.offers) offer = first(offer.offers);
  const brand = first(p.brand);
  const price = offer && (offer.price || offer.lowPrice || (offer.priceSpecification && first(offer.priceSpecification).price));
  const currency = (offer && (offer.priceCurrency || offer.currency)) || (p.offers && p.offers.priceCurrency) || null;
  return {
    title: decode(p.name),
    image: typeof image === 'string' ? image : null,
    brand: decode(brand && typeof brand === 'object' ? brand.name : brand),
    price: price != null ? parseFloat(price) : null,
    currency: currency ? String(currency).toUpperCase() : null,
  };
}

function amazonBits(html) {
  const pick = (re) => { const m = html.match(re); return m ? decode(m[1]) : ''; };
  const byline = pick(/id="bylineInfo"[^>]*>([^<]+)</);
  return {
    title: pick(/id="productTitle"[^>]*>([^<]+)</),
    image: pick(/"hiRes"\s*:\s*"(https:[^"]+)"/) || pick(/data-old-hires="(https:[^"]+)"/) || pick(/id="landingImage"[^>]*\bsrc="(https:[^"]+)"/) || pick(/"large"\s*:\s*"(https:[^"]+)"/),
    brand: byline.replace(/^Visit the\s+/i, '').replace(/\s+Store$/i, '').replace(/^Brand:\s*/i, ''),
    price: parseFloat(pick(/class="a-offscreen">\s*\$([\d,]+\.\d{2})</).replace(/,/g, '')) || null,
  };
}

function siteName(host) {
  const parts = host.replace(/^(www|m|shop|store)\./, '').split('.');
  const name = parts.length > 1 ? parts[parts.length - 2] : parts[0];
  return name.charAt(0).toUpperCase() + name.slice(1);
}

// Drop tracking junk so the saved link is clean and short.
function tidyUrl(u) {
  const asin = /amazon\.|amzn\./.test(u.hostname) && u.pathname.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})/);
  if (asin) return `${u.origin}/dp/${asin[1]}`;
  for (const k of [...u.searchParams.keys()]) {
    if (/^(utm_|fbclid|gclid|mc_|ref_?$|srsltid|_pos|_sid|_ss|pf_rd|pd_rd|irclickid|cjevent)/i.test(k)) u.searchParams.delete(k);
  }
  u.hash = '';
  return u.toString();
}

// Best-effort name from the link itself ("/Hanes-Hooded-Sweatshirt/dp/..."),
// used to pre-fill the form when a site will not let the app read the page.
function slugTitle(u) {
  const skip = /^(dp|gp|product|products|p|t|pd|shop|item|us|en|[a-z]{2}[-_][a-z]{2}|ref=.*|[A-Z0-9]{10}|[\d.]+)$/i;
  const parts = decodeURIComponent(u.pathname).split('/').filter((s) => s && !skip.test(s) && /[-_ ]/.test(s) && /[a-z]{3}/i.test(s));
  if (!parts.length) return '';
  const best = parts.sort((a, b) => b.length - a.length)[0];
  return best.replace(/\.html?$/i, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
}

// Pages that are a bot check or error rather than the product.
const RE_WALL = /api-services-support@amazon|Click the button below to continue shopping|Enter the characters you see below|cf-challenge|Attention Required|Pardon Our Interruption|px-captcha/i;

const HTML_HEADERS = { Accept: 'text/html,application/xhtml+xml,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.9' };

// Read a product page from any shop. Returns { ok, info } on success, or
// { ok: false, info } with whatever could be worked out (at least the link),
// so the user can fill in the rest by hand.
async function lookupUrl(input) {
  let u;
  try {
    u = new URL(/^https?:\/\//i.test(String(input).trim()) ? String(input).trim() : 'https://' + String(input).trim());
  } catch (e) {
    return { ok: false, reason: 'That does not look like a web link.', info: null };
  }
  if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.')) return { ok: false, reason: 'That does not look like a web link.', info: null };

  const guess = slugTitle(u);
  const info = { url: tidyUrl(u), title: '', brand: siteName(u.hostname), price: null, currency: 'USD', image: null };

  // Shopify shops (most small brands) have a clean data feed per product.
  const handle = u.pathname.match(/\/products\/([^/?#]+)/);
  if (handle) {
    try {
      const res = await request(`${u.origin}/products/${handle[1]}.json`, {}, 1);
      if (res.ok && (res.headers.get('content-type') || '').includes('json')) {
        const p = (await res.json()).product;
        if (p && p.title) {
          info.title = decode(p.title);
          info.image = (p.image && p.image.src) || (p.images && p.images[0] && p.images[0].src) || null;
          info.price = parseFloat(p.variants && p.variants[0] && p.variants[0].price) || null;
          info.rawType = p.product_type || '';
        }
      }
    } catch (e) { /* fall through to reading the page */ }
  }

  if (!info.title || !info.image) {
    let html = '';
    let finalUrl = info.url;
    try {
      const res = await request(u.toString(), { headers: HTML_HEADERS }, 2);
      if (res.ok) html = await res.text();
      // Short links (a.co, amzn.to...) redirect; keep the real address.
      try { const f = new URL(res.url); if (f.protocol === 'https:' && f.hostname !== 'localhost' && f.hostname !== u.hostname) { finalUrl = tidyUrl(f); info.brand = siteName(f.hostname); } } catch (e) { /* keep */ }
    } catch (e) { /* offline or blocked */ }
    info.url = finalUrl;

    if (html && !RE_WALL.test(html)) {
      const ld = jsonLdProduct(html);
      const meta = metaTags(html);
      const amz = /amazon\./.test(new URL(finalUrl).hostname) ? amazonBits(html) : {};
      const pageTitle = decode((html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1]);
      const blocked = /robot check|captcha|access denied|just a moment|are you a human|page not found/i.test(pageTitle);

      info.title = info.title || amz.title || ld.title || meta['og:title'] || meta['twitter:title'] || (blocked ? '' : pageTitle);
      info.image = info.image || amz.image || ld.image || meta['og:image:secure_url'] || meta['og:image'] || meta['twitter:image'] || meta['twitter:image:src'] || null;
      info.brand = amz.brand || ld.brand || meta['og:site_name'] || meta['product:brand'] || info.brand;
      if (info.price === null) {
        const price = amz.price || ld.price || parseFloat(meta['product:price:amount'] || meta['og:price:amount'] || '');
        info.price = isFinite(price) && price > 0 ? price : null;
      }
      info.currency = ld.currency || meta['product:price:currency'] || meta['og:price:currency'] || (/amazon\.co\.uk/i.test(finalUrl) ? 'GBP' : /amazon\.ca/i.test(finalUrl) ? 'CAD' : 'USD');
      // Shops often append " | Store Name" to page titles.
      if (info.title && info.brand) {
        const tail = new RegExp('\\s*[|\\-\\u2013\\u2014:]\\s*' + info.brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\s+[A-Za-z.]{2,12}){0,2}\\s*$', 'i');
        info.title = info.title.replace(tail, '').replace(/^Amazon\.com\s*:\s*/i, '').trim();
      }
    }
  }

  if (info.image) {
    try { info.image = new URL(info.image.replace(/^\/\//, 'https://'), info.url).toString(); } catch (e) { info.image = null; }
  }
  info.category = categorize(info.title, info.rawType || '', []);
  delete info.rawType;
  // A "title" that is just the site's own name means we did not get the product.
  const bare = (s) => String(s).toLowerCase().replace(/\.(com|net|org|co|us|uk)\b/g, '').replace(/[^a-z0-9]/g, '');
  if (info.title && [info.brand, siteName(new URL(info.url).hostname)].some((n) => bare(n) === bare(info.title))) info.title = '';
  if (!info.title) {
    info.title = guess;
    info.category = categorize(guess, '', []);
    return { ok: false, reason: 'blocked', info };
  }
  return { ok: true, info };
}

// ---------------------------------------------------------------- closet

const newId = (prefix) => prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const clean = (s, max) => String(s == null ? '' : s).trim().slice(0, max);

function bigger(url) {
  try {
    const u = new URL(url);
    if (u.hostname === 'cdn.shopify.com' || u.pathname.includes('/cdn/shop/')) u.searchParams.set('width', '900');
    return u.toString();
  } catch (e) {
    return url;
  }
}

// `files` stores photos permanently: { saveFromUrl(url), saveFromData(dataUrl), remove(name) }.
function makeCloset(db, files) {
  const d = db.data;
  if (!Array.isArray(d.closet)) d.closet = [];
  if (!Array.isArray(d.outfits)) d.outfits = [];
  const state = () => ({ closet: d.closet, outfits: d.outfits });

  async function grabPhoto(url) {
    if (!url) return null;
    try { return await files.saveFromUrl(bigger(url)); } catch (e) { return null; }
  }

  async function create(fields, photoUrl, photoData) {
    let photo = null;
    if (photoData) { try { photo = await files.saveFromData(photoData); } catch (e) { photo = null; } }
    if (!photo) photo = await grabPhoto(photoUrl);
    const item = {
      id: newId('c'),
      title: clean(fields.title, 200) || 'Untitled item',
      brand: clean(fields.brand, 80),
      category: clean(fields.category, 40) || 'Other',
      url: /^https?:\/\//.test(fields.url || '') ? fields.url : '',
      price: typeof fields.price === 'number' && isFinite(fields.price) ? fields.price : null,
      currency: clean(fields.currency, 10).toUpperCase() || 'USD',
      notes: clean(fields.notes, 1000),
      photo,
      sourceKey: fields.sourceKey || null,
      addedAt: new Date().toISOString(),
    };
    d.closet.unshift(item);
    db.save();
    return item;
  }

  return {
    state,

    // Paste-a-link. On failure nothing is saved; the caller shows a form.
    async addUrl(input) {
      const res = await lookupUrl(input);
      if (!res.info) return { ...state(), error: res.reason };
      // One of the user's own stores? Use its proper name as the brand.
      try {
        const host = new URL(res.info.url).hostname.replace(/^www\./, '');
        const known = d.stores.find((s) => s.domain.replace(/^www\./, '') === host);
        if (known) res.info.brand = known.name;
      } catch (e) { /* keep */ }
      if (d.closet.some((c) => c.url && c.url === res.info.url)) return { ...state(), error: 'That item is already in your closet.' };
      if (!res.ok) return { ...state(), needsDetails: true, prefill: res.info };
      const item = await create(res.info, res.info.image, null);
      return { ...state(), added: item.id, noPhoto: !item.photo };
    },

    // Copy an item out of the store catalogue.
    async addProduct(key, storeName) {
      const p = d.products[key];
      if (!p) return { ...state(), error: 'That item is no longer in the catalogue.' };
      if (d.closet.some((c) => c.sourceKey === key)) return { ...state(), error: 'Already in your closet.' };
      const item = await create({ title: p.title, brand: storeName || p.vendor, category: p.category, url: p.url, price: p.price, currency: p.currency, sourceKey: key }, p.image, null);
      return { ...state(), added: item.id, noPhoto: !item.photo };
    },

    // Create (no id) or edit (id) from the form.
    async save(f) {
      f = f || {};
      if (!f.id) {
        if (!clean(f.title, 200)) return { ...state(), error: 'Give it a name first.' };
        const item = await create(f, f.imageUrl, f.imageData);
        return { ...state(), added: item.id, noPhoto: !item.photo && !!(f.imageUrl || f.imageData) };
      }
      const item = d.closet.find((c) => c.id === f.id);
      if (!item) return { ...state(), error: 'That item no longer exists.' };
      if (!clean(f.title, 200)) return { ...state(), error: 'Give it a name first.' };
      item.title = clean(f.title, 200);
      item.brand = clean(f.brand, 80);
      item.category = clean(f.category, 40) || 'Other';
      item.notes = clean(f.notes, 1000);
      if (f.currency) item.currency = clean(f.currency, 10).toUpperCase();
      if (typeof f.url === 'string') item.url = /^https?:\/\//.test(f.url) ? f.url : '';
      let photo = null;
      if (f.imageData) { try { photo = await files.saveFromData(f.imageData); } catch (e) { photo = null; } }
      else if (f.imageUrl) photo = await grabPhoto(f.imageUrl);
      if (photo) {
        const old = item.photo;
        item.photo = photo;
        if (old) files.remove(old).catch(() => {});
      }
      db.save();
      return { ...state(), noPhoto: !photo && !!(f.imageUrl || f.imageData) };
    },

    async remove(id) {
      const item = d.closet.find((c) => c.id === id);
      if (!item) return state();
      d.closet = d.closet.filter((c) => c.id !== id);
      for (const o of d.outfits) o.itemIds = o.itemIds.filter((x) => x !== id);
      if (item.photo) files.remove(item.photo).catch(() => {});
      db.save();
      return state();
    },

    outfitSave(o) {
      o = o || {};
      const valid = new Set(d.closet.map((c) => c.id));
      const itemIds = [...new Set((o.itemIds || []).filter((x) => valid.has(x)))];
      const name = clean(o.name, 80);
      if (!name) return { ...state(), error: 'Give the outfit a name first.' };
      if (!itemIds.length) return { ...state(), error: 'Pick at least one piece.' };
      const existing = o.id && d.outfits.find((x) => x.id === o.id);
      if (existing) Object.assign(existing, { name, itemIds, notes: clean(o.notes, 1000) });
      else d.outfits.unshift({ id: newId('o'), name, itemIds, notes: clean(o.notes, 1000), createdAt: new Date().toISOString() });
      db.save();
      return state();
    },

    outfitRemove(id) {
      d.outfits = d.outfits.filter((o) => o.id !== id);
      db.save();
      return state();
    },
  };
}

module.exports = { makeCloset, lookupUrl };
