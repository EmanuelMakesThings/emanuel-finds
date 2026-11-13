// Store scraper. Pure Node (no Electron) so it can be tested standalone.
//
// Most stores are plain Shopify and expose /products.json. Some run a custom
// ("headless") front-end on top of Shopify; for those we read the same public
// Storefront API the store's own website calls from every visitor's browser.

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

const MAX_PAGES = 60; // 60 x 250 = 15,000 products per store
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function request(url, opts = {}, tries = 3) {
  const fetchFn = (typeof globalThis.electronNetFetch === 'function')
    ? globalThis.electronNetFetch
    : (typeof net !== 'undefined' && typeof net.fetch === 'function')
      ? net.fetch
      : fetch;
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetchFn(url, {
        ...opts,
        headers: { 'User-Agent': UA, Accept: 'application/json,text/html,*/*', ...(opts.headers || {}) },
        signal: AbortSignal.timeout(30000),
        redirect: 'follow',
      });
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status}`);
        await sleep(1500 * (i + 1));
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e;
      await sleep(1000 * (i + 1));
    }
  }
  throw lastErr;
}

async function getJson(url) {
  const res = await request(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = res.headers.get('content-type') || '';
  if (!type.includes('json')) throw new Error('not a product feed');
  return res.json();
}

// ---------------------------------------------------------------- classify

const CATEGORY_RULES = [
  ['Footwear', /\b(shoes?|sneakers?|footwear|slides?|sandals?|boots?|cleats?|socks?)\b/i],
  ['Hats', /\b(hats?|caps?|beanies?|snapbacks?|truckers?|bucket|headwear|skull ?cap|durag|balaclava)\b/i],
  ['Hoodies & Sweats', /\b(hood(ie|y|ies|ed)|sweatshirts?|crewnecks?|crew neck|crew|pullovers?|quarter[- ]zip|half[- ]zip|zip[- ]up|(tech|full|1\/[24]) zip|sweaters?|fleece|knit)\b/i],
  ['Jackets', /\b(jackets?|coats?|varsity|bombers?|windbreakers?|puffers?|vests?|parkas?|outerwear|flannels?|shackets?)\b/i],
  ['Shorts', /\b(shorts)\b/i], // not "short": "short sleeve" is a tee
  ['Pants', /\b(pants?|joggers?|sweatpants?|sweats|jeans?|denim|trousers?|cargos?|bottoms?|leggings?|tights)\b/i],
  ['Tees & Tops', /\b(tees?|t-?shirts?|shirts?|tops?|tanks?|jerseys?|long ?sleeves?|polos?|henley|button[- ]up|compression)\b/i],
  ['Accessories', /\b(accessor(y|ies)|bags?|backpacks?|totes?|duffle|wallets?|necklaces?|chains?|bracelets?|rings?|jewel(ry|lery)|stickers?|keychains?|mugs?|bottles?|tumblers?|bibles?|books?|journals?|wristbands?|belts?|pins?|patch(es)?|posters?|towels?|blankets?|phone cases?|scarf|scarves|shawls?|bandanas?|blingdanas?|gloves?|sunglasses)\b/i],
  // Fit names with no garment word are almost always tees.
  ['Tees & Tops', /\b(classic fit|loose fit|relaxed fit|oversized fit|boxy|heavyweight)\b/i],
];

// Things stores list as "products" that are not clothes.
const RE_NOT_PRODUCT = /\b(returns?|package protection|shipping protection|shipping insurance|route protection|gift ?cards?|e-?gift|donation|tip jar|mystery fee|priority processing)\b/i;

function categorize(title, type, tags) {
  // Product type and title are the strongest signals; tags are a fallback.
  for (const text of [type, title, tags.join(' ')]) {
    if (!text) continue;
    for (const [cat, re] of CATEGORY_RULES) if (re.test(text)) return cat;
  }
  return 'Other';
}

const RE_WOMEN = /\b(wom[ae]n'?s?|ladies|lady|girls?|her|bras?|bralettes?|leggings|crop(ped)? ?tops?|dress(es)?|skirts?|baby ?tee)\b/i;
const RE_KIDS = /\b(youth|kids?|teens?|toddlers?|infants?|bab(y|ies)|onesies?|boys?|children'?s?|junior)\b/i;
const RE_MEN = /\b(m[ae]n'?s?|him|guys?|unisex)\b/i;

function genderOf(text, inMen, inWomen, inKids) {
  const men = inMen || RE_MEN.test(text);
  const women = inWomen || RE_WOMEN.test(text);
  const kids = inKids || RE_KIDS.test(text);
  if (men) return 'men'; // men's, or explicitly unisex / in both collections
  if (women) return 'women';
  if (kids) return 'kids';
  return 'unisex';
}

const SIZE_ALIASES = {
  XXS: '2XS', XXSMALL: '2XS', XSMALL: 'XS', 'X-SMALL': 'XS', SMALL: 'S', SM: 'S', MEDIUM: 'M', MED: 'M', MD: 'M',
  LARGE: 'L', LG: 'L', XLARGE: 'XL', 'X-LARGE': 'XL', XXL: '2XL', XXLARGE: '2XL', XXXL: '3XL', XXXXL: '4XL', XXXXXL: '5XL',
  '2X': '2XL', '3X': '3XL', '4X': '4XL', '5X': '5XL', OS: 'ONE SIZE', OSFA: 'ONE SIZE', 'ONE SIZE FITS ALL': 'ONE SIZE', 'ONE-SIZE': 'ONE SIZE', O_S: 'ONE SIZE',
};
const RE_SIZE = /^(2XS|XS|S|M|L|XL|[2-6]XL|ONE SIZE|\d{1,2}(\.5)?|\d{2}\s?[xX]\s?\d{2}|[SML]\/[MLX]L?|M \d.*)$/;

function normSize(raw) {
  let s = String(raw || '').trim().toUpperCase().replace(/\s+/g, ' ');
  // Dual shoe sizing ("M 9 / W 10.5") -> the men's size.
  const shoe = s.match(/^M ?(\d{1,2}(?:\.5)?) ?\/ ?W/);
  if (shoe) return shoe[1];
  s = s.replace(/^(\d)X[- ]?LARGE$/, '$1XL');
  return SIZE_ALIASES[s] || s;
}

function looksLikeSizes(values) {
  if (!values || !values.length) return false;
  const hits = values.filter((v) => RE_SIZE.test(normSize(v))).length;
  return hits / values.length >= 0.6;
}

// Which option position holds the size? Stores often mislabel it.
function sizeOptionIndex(options) {
  const byName = options.findIndex((o) => /size/i.test(o.name || ''));
  if (byName >= 0) return byName;
  return options.findIndex((o) => looksLikeSizes(o.values));
}

// ---------------------------------------------------------------- normalise

// `raw` is in the shape of Shopify's products.json; the Storefront reader
// converts into that shape first so everything funnels through here.
function normalize(store, raw, ctx) {
  const variants = raw.variants || [];
  const options = raw.options || [];
  const tags = Array.isArray(raw.tags) ? raw.tags : String(raw.tags || '').split(',').map((t) => t.trim()).filter(Boolean);

  let price = null;
  let compareAt = null;
  let available = false;
  for (const v of variants) {
    const p = parseFloat(v.price);
    if (!isFinite(p)) continue;
    if (v.available) available = true;
    if (price === null || p < price) {
      price = p;
      const c = parseFloat(v.compare_at_price);
      compareAt = isFinite(c) && c > p ? c : null;
    }
  }
  if (price === null) return null;
  if (RE_NOT_PRODUCT.test(raw.title || '') || /gift ?card/i.test(raw.product_type || '')) return null;

  const si = sizeOptionIndex(options);
  const sizes = [];
  if (si >= 0) {
    const seen = new Map();
    for (const v of variants) {
      const name = normSize(v['option' + (si + 1)]);
      if (!name) continue;
      seen.set(name, (seen.get(name) || false) || !!v.available);
    }
    for (const [name, inStock] of seen) sizes.push({ name, inStock });
  }

  const id = String(raw.id);
  const key = store.id + ':' + id;
  const isKnown = (ctx.existingKeys && ctx.existingKeys.has(key)) || (ctx.favs && ctx.favs.has(key));
  // From now on, do not download sold out items unless already downloaded or favorited
  if (!available && !isKnown) return null;

  const text = [raw.title, raw.product_type, tags.join(' ')].join(' ');
  const images = (raw.images || []).map((i) => i.src).filter(Boolean);
  const currency = raw.currency || ctx.currency || 'USD';

  return {
    key,
    storeId: store.id,
    id,
    title: String(raw.title || '').trim(),
    handle: raw.handle,
    url: ctx.productUrl(raw.handle),
    vendor: raw.vendor || '',
    rawType: raw.product_type || '',
    category: categorize(raw.title, raw.product_type, tags),
    gender: genderOf(text, ctx.men.has(id), ctx.women.has(id), ctx.kids.has(id)),
    tags: tags.slice(0, 25),
    price,
    compareAt,
    currency,
    onSale: compareAt !== null,
    discount: compareAt ? Math.round((1 - price / compareAt) * 100) : 0,
    available,
    sizes,
    image: images[0] || null,
    images: images.slice(0, 6),
    publishedAt: raw.published_at || raw.created_at || null,
    isNew: ctx.newIds.has(id),
  };
}

// ---------------------------------------------------------------- shopify

async function fetchAllProducts(base, onPage) {
  const all = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const j = await getJson(`${base}/products.json?limit=250&page=${page}`);
    const list = j.products || [];
    all.push(...list);
    onPage && onPage(all.length);
    if (list.length < 250) break;
    await sleep(250);
  }
  return all;
}

async function fetchCollectionProducts(base, handle, onPage) {
  const all = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const j = await getJson(`${base}/collections/${handle}/products.json?limit=250&page=${page}`);
    const list = j.products || [];
    all.push(...list);
    onPage && onPage(all.length);
    if (list.length < 250) break;
    await sleep(250);
  }
  return all;
}

async function fetchCollections(base) {
  const all = [];
  for (let page = 1; page <= 4; page++) {
    const j = await getJson(`${base}/collections.json?limit=250&page=${page}`);
    const list = j.collections || [];
    all.push(...list);
    if (list.length < 250) break;
  }
  return all;
}

async function fetchCollectionIds(base, handle) {
  const ids = [];
  for (let page = 1; page <= 8; page++) {
    const j = await getJson(`${base}/collections/${handle}/products.json?limit=250&page=${page}`);
    const list = j.products || [];
    ids.push(...list.map((p) => String(p.id)));
    if (list.length < 250) break;
    await sleep(200);
  }
  return ids;
}

// Preferred handles for a store's own "new arrivals" collection, best first.
const NEW_HANDLES = [
  /^new-arrivals?$/, /^new-releases?$/, /^new$/, /^new-in$/, /^whats-new$/, /^just-dropped$/, /^latest(-drop|-arrivals?|-releases?)?$/,
  /^new-(drops?|collection|products|items)$/, /^mens?-new(-arrivals?)?$/, /new-arrivals?/, /new-releases?/, /just-dropped|latest-drop|new-drop/,
];

function pickNewCollection(collections) {
  // Some stores reuse the "new-arrivals" address for a best-sellers list.
  const live = collections.filter((c) => c.products_count > 0 && !/best.?sell|sale|clearance/i.test(c.title || ''));
  for (const re of NEW_HANDLES) {
    const hit = live.find((c) => re.test(c.handle) && !/wom[ae]n|youth|kids|girls/.test(c.handle));
    if (hit) return hit;
  }
  return null;
}

const RE_H_WOMEN = /(^|-)(wom[ae]ns?|ladies|girls|her)(-|$)/;
const RE_H_KIDS = /(^|-)(youth|kids?|toddlers?|bab(y|ies)|boys|infants?)(-|$)/;
const RE_H_MEN = /(^|-)(m[ae]ns?|him|unisex)(-|$)/;

async function detectShopifyCurrency(base) {
  try {
    const res = await request(`${base}/cart.js`, {}, 1);
    if (res.ok) {
      const type = res.headers.get('content-type') || '';
      if (type.includes('json')) {
        const j = await res.json();
        if (j && j.currency && typeof j.currency === 'string') return j.currency.toUpperCase();
      }
    }
  } catch (e) { /* default to USD */ }
  return 'USD';
}

async function scrapeShopify(store, base, onProgress, collectionHandle = null, existingKeys = null) {
  onProgress(collectionHandle ? `reading ${collectionHandle} collection` : 'reading catalogue');
  const [rawProducts, currency] = await Promise.all([
    collectionHandle
      ? fetchCollectionProducts(base, collectionHandle, (n) => onProgress(`${n} items`))
      : fetchAllProducts(base, (n) => onProgress(`${n} items`)),
    detectShopifyCurrency(base),
  ]);

  const ctx = {
    men: new Set(), women: new Set(), kids: new Set(), newIds: new Set(),
    productUrl: (h) => `${base}/products/${h}`,
    currency,
    existingKeys,
  };
  let newSource = collectionHandle ? `${collectionHandle} collection` : 'recent';

  if (collectionHandle) {
    if (collectionHandle === 'men' || /(^|-)men(-|$)/.test(collectionHandle) || /saint-michael|saint-mxxxxxx/.test(collectionHandle)) {
      for (const r of rawProducts) ctx.men.add(String(r.id));
    }
  } else {
    try {
      onProgress('reading collections');
      const collections = await fetchCollections(base);

      const newColl = pickNewCollection(collections);
      if (newColl) {
        for (const id of await fetchCollectionIds(base, newColl.handle)) ctx.newIds.add(id);
        newSource = newColl.title || newColl.handle;
      }

      // Gendered collections tell us what is menswear far better than titles do.
      const groups = [
        [ctx.men, RE_H_MEN], [ctx.women, RE_H_WOMEN], [ctx.kids, RE_H_KIDS],
      ];
      for (const [set, re] of groups) {
        const matches = collections
          .filter((c) => c.products_count > 0 && re.test(c.handle))
          .filter((c) => set !== ctx.men || !(RE_H_WOMEN.test(c.handle) || RE_H_KIDS.test(c.handle)))
          .sort((a, b) => b.products_count - a.products_count)
          .slice(0, 4);
        for (const c of matches) {
          for (const id of await fetchCollectionIds(base, c.handle)) set.add(id);
        }
      }
    } catch (e) {
      // Collections are a nice-to-have; the catalogue itself already loaded.
    }
  }

  const products = rawProducts.map((r) => normalize(store, r, ctx)).filter(Boolean);
  return { products, currency, newSource, hasNewCollection: ctx.newIds.size > 0 };
}

// ---------------------------------------------------------------- headless

const SF_QUERY = `
query Products($cursor: String) {
  products(first: 100, after: $cursor, sortKey: CREATED_AT, reverse: true) {
    pageInfo { hasNextPage endCursor }
    edges { node {
      id title handle vendor productType tags publishedAt createdAt
      images(first: 6) { edges { node { url } } }
      options { name values }
      variants(first: 100) { edges { node {
        id availableForSale
        price { amount currencyCode } compareAtPrice { amount currencyCode }
        selectedOptions { name value }
      } } }
    } }
  }
}`;

// Find the Shopify backend a custom storefront talks to by reading the same
// script bundle the site ships to browsers. Nothing is hard-coded, so this
// keeps working if the store rotates its public storefront token.
async function discoverStorefront(base) {
  const res = await request(base + '/');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const scripts = [...new Set([...html.matchAll(/["'(]((?:https?:\/\/[^"'()\s]+|\/[^"'()\s]+)\.js)["')]/g)].map((m) => m[1]))]
    .map((s) => (s.startsWith('http') ? s : base + s))
    .filter((s) => s.startsWith(base))
    .slice(0, 40);

  const sources = [html];
  for (const src of scripts) {
    try {
      const r = await request(src, {}, 1);
      if (r.ok) sources.push(await r.text());
    } catch (e) { /* skip */ }
  }
  for (const js of sources) {
    const dm = js.match(/["'`]([a-z0-9][a-z0-9-]*\.myshopify\.com)["'`]/);
    if (!dm) continue;
    const near = js.slice(Math.max(0, dm.index - 600), dm.index + 600);
    const tm = near.match(/["'`]([a-f0-9]{32})["'`]/);
    if (!tm) continue;
    const vm = near.match(/["'`](20\d\d-\d\d)["'`]/);
    const route = js.match(/["'`](\/products?\/)\$[a-zA-Z]+["'`]/);
    return {
      endpoint: `https://${dm[1]}/api/${vm ? vm[1] : '2025-07'}/graphql.json`,
      token: tm[1],
      productPath: route ? route[1] : '/products/',
    };
  }
  throw new Error('could not find a product feed for this site');
}

async function scrapeHeadless(store, base, onProgress, existingKeys = null) {
  onProgress('locating product feed');
  const sf = await discoverStorefront(base);
  const raws = [];
  let cursor = null;
  let detectedCurrency = 'USD';
  for (let page = 0; page < 50; page++) {
    const res = await request(sf.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Storefront-Access-Token': sf.token },
      body: JSON.stringify({ query: SF_QUERY, variables: { cursor } }),
    });
    if (!res.ok) throw new Error(`feed HTTP ${res.status}`);
    const j = await res.json();
    if (j.errors) throw new Error(j.errors[0].message || 'feed error');
    const conn = j.data.products;
    for (const { node: n } of conn.edges) {
      const optNames = (n.options || []).map((o) => o.name);
      raws.push({
        id: n.id.split('/').pop(),
        title: n.title,
        handle: n.handle,
        vendor: n.vendor,
        product_type: n.productType,
        tags: n.tags,
        published_at: n.publishedAt || n.createdAt,
        images: n.images.edges.map((e) => ({ src: e.node.url })),
        options: n.options,
        variants: n.variants.edges.map(({ node: v }) => {
          if (v.price && v.price.currencyCode) detectedCurrency = v.price.currencyCode;
          const out = {
            available: v.availableForSale,
            price: v.price && v.price.amount,
            compare_at_price: v.compareAtPrice && v.compareAtPrice.amount,
            currency: (v.price && v.price.currencyCode) || detectedCurrency,
          };
          for (const so of v.selectedOptions || []) {
            const i = optNames.indexOf(so.name);
            if (i >= 0) out['option' + (i + 1)] = so.value;
          }
          return out;
        }),
      });
    }
    onProgress(`${raws.length} items`);
    if (!conn.pageInfo.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
  }
  const ctx = {
    men: new Set(), women: new Set(), kids: new Set(), newIds: new Set(),
    productUrl: (h) => `${base}${sf.productPath}${h}`,
    currency: detectedCurrency,
    existingKeys,
  };
  const products = raws.map((r) => normalize(store, r, ctx)).filter(Boolean);
  return { products, currency: detectedCurrency, newSource: 'recent', hasNewCollection: false };
}

async function scrapeHm(store, targetUrl, onProgress, existingKeys = null) {
  onProgress('connecting to H&M');
  const baseUrl = targetUrl.startsWith('http') ? targetUrl : `https://${targetUrl}`;
  const res1 = await request(baseUrl);
  if (!res1.ok) throw new Error(`H&M HTTP ${res1.status}`);
  const html1 = await res1.text();
  const m1 = html1.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m1) throw new Error('Could not find product feed on H&M page');
  const d1 = JSON.parse(m1[1]);
  const pld = d1.props?.pageProps?.plpProps?.productListingSectionProps?.productListingData;
  if (!pld || !pld.hits) throw new Error('H&M listing data not found');

  const totalPages = Math.min(pld.pagination?.totalPages || Math.ceil((pld.totalHits || 100) / 36), 5);
  const allHits = [...pld.hits];
  onProgress(`${allHits.length} items`);

  for (let p = 2; p <= totalPages; p++) {
    try {
      const sep = baseUrl.includes('?') ? '&' : '?';
      const resp = await request(`${baseUrl}${sep}page=${p}`);
      if (resp.ok) {
        const html = await resp.text();
        const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
        if (m) {
          const d = JSON.parse(m[1]);
          const hits = d.props?.pageProps?.plpProps?.productListingSectionProps?.productListingData?.hits || [];
          allHits.push(...hits);
          onProgress(`${allHits.length} items`);
        }
      }
    } catch (e) {
      // Continue with whatever pages we collected
    }
  }

  const products = [];
  for (const h of allHits) {
    const id = String(h.articleCode || h.id || '');
    if (!id) continue;
    const key = store.id + ':' + id;
    const isKnown = existingKeys ? existingKeys.has(key) : false;

    const sizes = Array.isArray(h.sizes) && h.sizes.length
      ? h.sizes.map((s) => ({ name: s.name, inStock: typeof s.stock === 'number' ? s.stock > 0 : true }))
      : [{ name: 'One Size', inStock: true }];

    const available = sizes.some((s) => s.inStock);
    if (!available && !isKnown) continue; // Don't download sold out items unless already downloaded

    const whitePrice = h.prices?.find((p) => p.priceType === 'whitePrice')?.price ||
      parseFloat(String(h.regularPrice || '').replace(/[^0-9.]/g, '')) || 0;
    const salePrice = h.prices?.find((p) => p.priceType === 'yellowPrice' || p.priceType === 'redPrice')?.price ||
      (h.yellowPrice ? parseFloat(String(h.yellowPrice).replace(/[^0-9.]/g, '')) : null) ||
      (h.redPrice ? parseFloat(String(h.redPrice).replace(/[^0-9.]/g, '')) : null);

    const hasSale = typeof salePrice === 'number' && isFinite(salePrice) && salePrice > 0 && whitePrice > salePrice;
    const price = hasSale ? salePrice : whitePrice;
    const compareAt = hasSale ? whitePrice : null;

    const mainImg = h.imageProductSrc || h.imageModelSrc || (h.galleryImages && h.galleryImages[0]?.url) || null;
    const images = [...new Set([h.imageProductSrc, h.imageModelSrc, ...(h.galleryImages || []).map((g) => g.url)])].filter(Boolean);

    products.push({
      key,
      storeId: store.id,
      id,
      title: String(h.title || '').trim(),
      handle: h.articleCode || id,
      url: h.pdpUrl ? (h.pdpUrl.startsWith('http') ? h.pdpUrl : `https://www2.hm.com${h.pdpUrl}`) : baseUrl,
      vendor: h.brandName || 'H&M',
      rawType: 'Graphic Tees',
      category: 'Tees & Tops',
      gender: 'men',
      tags: ['merch-graphics', 'graphic tees', 't-shirts', 'men'],
      price,
      compareAt,
      currency: 'USD',
      onSale: compareAt !== null,
      discount: compareAt ? Math.round((1 - price / compareAt) * 100) : 0,
      available,
      sizes,
      image: mainImg,
      images: images.slice(0, 6),
      publishedAt: null,
      isNew: false,
    });
  }

  return { products, currency: 'USD', newSource: 'HM Men Graphic Tees', hasNewCollection: false };
}

// ---------------------------------------------------------------- entry

const NEW_FALLBACK_DAYS = 45;
const NEW_FALLBACK_MIN = 8;

// When a store has no "new arrivals" collection, treat its most recently
// published items as new.
function applyNewFallback(products) {
  const sorted = [...products].sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));
  const cutoff = Date.now() - NEW_FALLBACK_DAYS * 864e5;
  sorted.forEach((p, i) => {
    const t = Date.parse(p.publishedAt);
    p.isNew = i < NEW_FALLBACK_MIN || (isFinite(t) && t >= cutoff && i < 60);
  });
}

function cleanDomain(input) {
  return String(input || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

async function scrapeStore(store, onProgress = () => {}, existingKeys = null) {
  const rawInput = cleanDomain(store.domain || store.id || '');
  const slashIdx = rawInput.indexOf('/');
  const domain = slashIdx >= 0 ? rawInput.slice(0, slashIdx) : rawInput;
  const path = slashIdx >= 0 ? rawInput.slice(slashIdx) : '';

  if (domain.includes('hm.com')) {
    const result = await scrapeHm(store, rawInput, onProgress, existingKeys);
    applyNewFallback(result.products);
    return result;
  }

  let base = `https://${domain}`;
  let collectionHandle = null;
  if (path.startsWith('/collections/')) {
    collectionHandle = path.replace('/collections/', '').split('/')[0].split('?')[0];
  } else if (domain.includes('champion.com')) {
    collectionHandle = 'men';
  }

  let result;
  try {
    // Follow redirects once (e.g. bare domain -> www) so later URLs are canonical.
    const probe = await request(`${base}/products.json?limit=1`);
    const type = probe.headers.get('content-type') || '';
    // Only adopt the final address if it is still this store (the phone build
    // reports an internal proxy address here, which must be ignored).
    try {
      const final = new URL(probe.url);
      const bare = domain.replace(/^www\./, '');
      if (final.protocol === 'https:' && (final.hostname === bare || final.hostname.endsWith('.' + bare))) base = final.origin;
    } catch (e) { /* keep */ }
    if (probe.ok && type.includes('json')) {
      result = await scrapeShopify(store, base, onProgress, collectionHandle, existingKeys);
    } else if (probe.status >= 500) {
      throw new Error(`store website is down (HTTP ${probe.status})`);
    } else {
      result = await scrapeHeadless(store, base, onProgress, existingKeys);
    }
  } catch (e) {
    const msg = e && e.name === 'TimeoutError' ? 'timed out' : (e && e.message) || String(e);
    throw new Error(/HTTP 5\d\d/.test(msg) && !/down/.test(msg) ? `store website is down (${msg})` : msg);
  }
  if (!result.hasNewCollection) applyNewFallback(result.products);
  return result;
}

module.exports = { scrapeStore, cleanDomain, UA, request, categorize };
