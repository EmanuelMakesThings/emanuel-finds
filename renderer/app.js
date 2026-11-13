'use strict';

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CURRENCY_SYMBOLS = {
  USD: '$',
  CAD: 'CA$',
  AUD: 'A$',
  GBP: '£',
  EUR: '€',
  JPY: '¥',
  NZD: 'NZ$',
};

const RATES_TO_USD = {
  USD: 1.0,
  CAD: 0.74,
  AUD: 0.66,
  GBP: 1.28,
  EUR: 1.08,
  NZD: 0.61,
  JPY: 0.0066,
};

function formatMoney(amount, sourceCurrency = 'USD') {
  if (amount == null || !isFinite(amount)) return '';
  const curr = (sourceCurrency || 'USD').toUpperCase();
  const target = (state.currency || 'auto').toUpperCase();

  if (target === 'AUTO' || target === curr) {
    const sym = CURRENCY_SYMBOLS[curr] || curr + ' ';
    return sym + (Number.isInteger(amount) ? amount : amount.toFixed(2));
  }

  const srcRate = RATES_TO_USD[curr] || 1.0;
  const tgtRate = RATES_TO_USD[target] || 1.0;
  const inUsd = amount * srcRate;
  const converted = inUsd / tgtRate;
  const tgtSym = CURRENCY_SYMBOLS[target] || target + ' ';
  const convertedStr = tgtSym + (Number.isInteger(converted) ? converted : converted.toFixed(2));
  return `${convertedStr} (~${CURRENCY_SYMBOLS[curr] || curr}${amount.toFixed(2)})`;
}

const money = (n, cur) => formatMoney(n, cur);
// Desktop serves photos through its cfimg:// cache; the phone build supplies its own.
const img = (url) => (window.api.img ? window.api.img(url) : 'cfimg://i/?u=' + encodeURIComponent(url));
const MOBILE = window.api.platform === 'android';
const PAGE = 36;

const TABS = [
  { id: 'catalog', label: 'CATALOG', title: 'THE CATALOG', sub: 'Everything from every store, all in one place.', sort: 'newest' },
  { id: 'new', label: 'NEW ARRIVALS', title: 'NEW ARRIVALS', sub: "Fresh drops from each store's new-arrivals shelf.", sort: 'newest' },
  { id: 'sale', label: 'ON SALE', title: 'ON SALE', sub: 'Every marked-down item, biggest discounts first.', sort: 'discount', hot: true },
  { id: 'drops', label: 'PRICE DROPS', title: 'PRICE DROPS', sub: 'Items that got cheaper since an earlier refresh.', sort: 'dropped', hot: true },
  { id: 'favs', label: '<span class="hrt">♥</span> FAVORITES', title: 'FAVORITES', sub: 'Your saved wishlist.', sort: 'newest' },
  { id: 'closet', label: 'MY CLOSET', title: 'MY CLOSET', sub: 'Clothes you own, and the outfits you build from them. Saved for good.' },
  { id: 'stores', label: 'STORES', title: 'STORES', sub: 'The shops this catalogue is built from.' },
];

const SIZE_ORDER = ['2XS', 'XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', '6XL', 'ONE SIZE'];
const CAT_ORDER = ['Tees & Tops', 'Hoodies & Sweats', 'Jackets', 'Pants', 'Shorts', 'Hats', 'Footwear', 'Accessories', 'Other'];

const state = {
  data: { products: [], stores: [], storeStatus: {}, favorites: [], lastRefresh: null, settings: {} },
  favs: new Set(),
  storeName: {},
  tab: 'catalog',
  q: '',
  sort: 'auto',
  currency: 'auto',
  mens: true,
  stock: false,
  min: null,
  max: null,
  cats: new Set(),
  sizes: new Set(),
  stores: new Set(), // empty = all
  shown: PAGE,
  list: [],
  crt: true,
  refreshing: false,
};

// ---------------------------------------------------------------- data

function setData(d) {
  d.closet = d.closet || [];
  d.outfits = d.outfits || [];
  state.data = d;
  state.favs = new Set(d.favorites);
  state.storeName = {};
  for (const s of d.stores) state.storeName[s.id] = s.name;
  for (const p of d.products) {
    p._text = (p.title + ' ' + (state.storeName[p.storeId] || '') + ' ' + p.rawType + ' ' + p.category + ' ' + p.tags.join(' ')).toLowerCase();
    p._t = Date.parse(p.publishedAt) || 0;
  }
}

// Everything the user could see, before tab and sidebar filters.
function base() {
  const enabled = new Set(state.data.stores.filter((s) => s.enabled).map((s) => s.id));
  return state.data.products.filter((p) => enabled.has(p.storeId) && (!state.mens || p.gender === 'men' || p.gender === 'unisex'));
}

const inTab = {
  catalog: (p) => !p.gone,
  new: (p) => (p.isNew || p.justIn) && !p.gone,
  sale: (p) => p.onSale && !p.gone,
  drops: (p) => !!p.dropAt && !p.gone,
  favs: (p) => state.favs.has(p.key),
  stores: () => false,
  closet: () => false,
};

function getProductPriceInTarget(p) {
  if (state.currency === 'auto' || !state.currency) return p.price;
  const src = (p.currency || 'USD').toUpperCase();
  const tgt = state.currency.toUpperCase();
  if (src === tgt) return p.price;
  const srcRate = RATES_TO_USD[src] || 1.0;
  const tgtRate = RATES_TO_USD[tgt] || 1.0;
  return (p.price * srcRate) / tgtRate;
}

function applyFilters(list) {
  const words = state.q.toLowerCase().split(/\s+/).filter(Boolean);
  return list.filter((p) => {
    if (state.stores.size && !state.stores.has(p.storeId)) return false;
    if (state.cats.size && !state.cats.has(p.category)) return false;
    if (state.stock && !p.available) return false;
    const effPrice = getProductPriceInTarget(p);
    if (state.min !== null && effPrice < state.min) return false;
    if (state.max !== null && effPrice > state.max) return false;
    if (state.sizes.size && !p.sizes.some((s) => s.inStock && state.sizes.has(s.name))) return false;
    for (const w of words) if (!p._text.includes(w)) return false;
    return true;
  });
}

const SORTS = {
  newest: (a, b) => (b.justIn - a.justIn) || (b._t - a._t),
  'price-asc': (a, b) => getProductPriceInTarget(a) - getProductPriceInTarget(b),
  'price-desc': (a, b) => getProductPriceInTarget(b) - getProductPriceInTarget(a),
  discount: (a, b) => (b.discount - a.discount) || (b._t - a._t),
  az: (a, b) => a.title.localeCompare(b.title),
  store: (a, b) => (state.storeName[a.storeId] || '').localeCompare(state.storeName[b.storeId] || '') || (b._t - a._t),
  dropped: (a, b) => String(b.dropAt).localeCompare(String(a.dropAt)) || (a.price / a.dropFrom - b.price / b.dropFrom),
};

function compute() {
  const tab = TABS.find((t) => t.id === state.tab);
  const list = applyFilters(base().filter(inTab[state.tab]));
  const sortId = state.sort === 'auto' ? tab.sort : state.sort;
  list.sort(SORTS[sortId] || SORTS.newest);
  // Sold-out items sink to the bottom so the top of every tab is buyable.
  if (state.tab !== 'favs') list.sort((a, b) => b.available - a.available);
  state.list = list;
}

// ---------------------------------------------------------------- render

function renderTabs() {
  const b = base();
  $('#tabs').innerHTML = TABS.map((t) => {
    const n = t.id === 'stores' ? state.data.stores.length : t.id === 'closet' ? state.data.closet.length : b.filter(inTab[t.id]).length;
    return `<button class="tab${t.id === state.tab ? ' active' : ''}${t.hot && n ? ' hot' : ''}" role="tab" data-tab="${t.id}">${t.label}<span class="n">${n}</span></button>`;
  }).join('');
}

function renderSidebar() {
  const b = base().filter((p) => !p.gone);

  const catCount = {};
  for (const p of b) catCount[p.category] = (catCount[p.category] || 0) + 1;
  $('#f-cats').innerHTML = CAT_ORDER.filter((c) => catCount[c]).map((c) =>
    `<button class="chip${state.cats.has(c) ? ' on' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('');

  const sizeCount = {};
  for (const p of b) for (const s of p.sizes) sizeCount[s.name] = (sizeCount[s.name] || 0) + 1;
  const letters = SIZE_ORDER.filter((s) => sizeCount[s]);
  const numbers = Object.keys(sizeCount).filter((s) => /^\d{1,2}(\.5)?$/.test(s) && sizeCount[s] >= 2).sort((x, y) => x - y);
  for (const s of state.sizes) if (!letters.includes(s) && !numbers.includes(s)) letters.push(s);
  $('#f-sizes').innerHTML = [...letters, ...numbers].map((s) =>
    `<button class="chip${state.sizes.has(s) ? ' on' : ''}" data-size="${esc(s)}">${esc(s)}</button>`).join('');

  const perStore = {};
  for (const p of b) perStore[p.storeId] = (perStore[p.storeId] || 0) + 1;
  $('#f-stores').innerHTML = state.data.stores.filter((s) => s.enabled).map((s) =>
    `<label class="check"><input type="checkbox" data-store="${esc(s.id)}"${state.stores.has(s.id) ? ' checked' : ''}><span>${esc(s.name)}</span><span class="cnt">${perStore[s.id] || 0}</span></label>`).join('');

  $('#f-mens').checked = state.mens;
  $('#f-stock').checked = state.stock;
}

function badges(p) {
  const out = [];
  if (p.gone) out.push('<span class="badge out">NO LONGER LISTED</span>');
  else if (!p.available) out.push('<span class="badge out">SOLD OUT</span>');
  if (p.justIn) out.push('<span class="badge just">JUST IN</span>');
  else if (p.isNew) out.push('<span class="badge new">NEW</span>');
  if (p.onSale) out.push(`<span class="badge sale">-${p.discount}%</span>`);
  if (p.dropAt) out.push('<span class="badge drop">PRICE DROP</span>');
  return out.join('');
}

function priceHtml(p) {
  const was = p.onSale ? p.compareAt : (p.dropAt ? p.dropFrom : null);
  return `<span>${money(p.price, p.currency)}</span>${was ? `<s>${money(was, p.currency)}</s>` : ''}`;
}

function cardHtml(p) {
  const fav = state.favs.has(p.key);
  return `<div class="card${p.available ? '' : ' sold'}" tabindex="0" role="button" data-key="${esc(p.key)}">
    <div class="pic">${p.image ? `<img loading="lazy" decoding="async" alt="" src="${esc(img(p.image))}">` : '<div class="noimg">NO<br>IMAGE</div>'}</div>
    <div class="badges">${badges(p)}</div>
    <button class="heart${fav ? ' on' : ''}" data-fav="${esc(p.key)}" title="${fav ? 'Remove from favorites' : 'Add to favorites'}" aria-label="Favorite">♥</button>
    <div class="info">
      <div class="store">${esc(state.storeName[p.storeId] || p.storeId)}</div>
      <div class="title">${esc(p.title)}</div>
      <div class="price">${priceHtml(p)}</div>
    </div>
  </div>`;
}

function saleBar() {
  // Which stores are running a sale right now, and how big.
  const per = {};
  const total = {};
  for (const p of base()) {
    if (p.gone) continue;
    total[p.storeId] = (total[p.storeId] || 0) + 1;
    if (!p.onSale) continue;
    const s = per[p.storeId] || (per[p.storeId] = { n: 0, max: 0 });
    s.n++;
    s.max = Math.max(s.max, p.discount);
  }
  const ids = Object.keys(per).sort((a, b) => per[b].n - per[a].n);
  if (!ids.length) return '';
  return '<div class="salebar">' + ids.map((id) => {
    const s = per[id];
    const sitewide = s.n / total[id] >= 0.8 && s.n >= 5;
    return `<button class="salechip${state.stores.has(id) ? ' on' : ''}${sitewide ? ' sitewide' : ''}" data-salestore="${esc(id)}">
      <b>${esc(state.storeName[id] || id)}${sitewide ? ' ★ STOREWIDE' : ''}</b>${s.n} item${s.n === 1 ? '' : 's'} · <em>up to ${s.max}% off</em></button>`;
  }).join('') + '</div>';
}

function emptyHtml() {
  if (!state.data.products.length) {
    return '<div class="empty"><h2>NO CATALOGUE LOADED</h2><p>Press REFRESH STORES (bottom right) while online to download everything.<br>After that it all works offline.</p></div>';
  }
  const msg = {
    favs: 'Nothing saved yet. Hit the ♥ on anything you like.',
    drops: 'No price drops yet. Prices are compared every time you refresh, so check back after the next one.',
    sale: 'Nothing on sale matches right now.',
    new: 'No new arrivals match right now.',
  }[state.tab] || 'Nothing matches those filters.';
  return `<div class="empty"><h2>0 ITEMS FOUND</h2><p>${msg}</p></div>`;
}

function renderMain() {
  const tab = TABS.find((t) => t.id === state.tab);
  const isStores = state.tab === 'stores';
  const isCloset = state.tab === 'closet';
  $('#grid').hidden = isStores || isCloset;
  $('#more').hidden = isStores || isCloset;
  $('#storesview').hidden = !isStores;
  $('#closetview').hidden = !isCloset;
  document.body.classList.toggle('nofilters', isStores || isCloset);
  $('#banner').innerHTML = `<h1>${tab.title}</h1><p class="sub">${tab.sub}</p>` + (state.tab === 'sale' ? saleBar() : '');

  if (isStores) {
    renderStores();
    $('#st-count').textContent = `${state.data.stores.length} STORES`;
    return;
  }
  if (isCloset) {
    renderCloset();
    $('#st-count').textContent = `${state.data.closet.length} OWNED · ${state.data.outfits.length} OUTFIT${state.data.outfits.length === 1 ? '' : 'S'}`;
    return;
  }
  compute();
  const list = state.list;
  $('#grid').innerHTML = list.length ? list.slice(0, state.shown).map(cardHtml).join('') : emptyHtml();
  $('#more').textContent = list.length > state.shown ? `SHOWING ${state.shown} OF ${list.length} - SCROLL FOR MORE` : (list.length ? '- END OF LIST -' : '');
  $('#st-count').textContent = `${list.length} ITEM${list.length === 1 ? '' : 'S'}`;
  $('#filters-done').textContent = `SHOW ${list.length} ITEM${list.length === 1 ? '' : 'S'}`;
  $('#filters-open').classList.toggle('on', activeFilters() > 0);
  $('#filters-open').textContent = activeFilters() ? `FILTERS (${activeFilters()})` : 'FILTERS';
}

// How many sidebar filters are narrowing the list (shown on the phone's button).
function activeFilters() {
  return (state.q ? 1 : 0) + (state.stock ? 1 : 0) + (state.min !== null || state.max !== null ? 1 : 0) +
    state.cats.size + state.sizes.size + state.stores.size;
}

let isAppendingMore = false;
function showMore() {
  if (state.tab === 'stores' || state.tab === 'closet' || state.shown >= state.list.length || isAppendingMore) return;
  isAppendingMore = true;
  requestAnimationFrame(() => {
    try {
      const next = state.list.slice(state.shown, state.shown + PAGE);
      if (!next.length) return;
      state.shown += next.length;
      $('#grid').insertAdjacentHTML('beforeend', next.map(cardHtml).join(''));
      $('#more').textContent = state.list.length > state.shown ? `SHOWING ${state.shown} OF ${state.list.length} - SCROLL FOR MORE` : '- END OF LIST -';
    } finally {
      isAppendingMore = false;
    }
  });
}

function fmtDate(iso) {
  if (!iso) return 'NEVER';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).toUpperCase() + ' ' +
    d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function getNextScanString() {
  const now = new Date();
  const hours = [2, 8, 14, 20];
  for (const h of hours) {
    const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, 0, 0, 0);
    if (target > now) {
      return `NEXT: ${target.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    }
  }
  return 'NEXT: 2:00 AM';
}

function renderStatus() {
  const failed = state.data.stores.filter((s) => s.enabled && state.data.storeStatus[s.id] && state.data.storeStatus[s.id].ok === false);
  const el = $('#st-refresh');
  const scanSchedule = `[6H SCAN: 8AM/2PM/8PM/2AM · ${getNextScanString()}]`;
  el.textContent = 'LAST: ' + fmtDate(state.data.lastRefresh) + '  ' + scanSchedule +
    (failed.length ? `  ·  ${failed.length} STORE${failed.length === 1 ? '' : 'S'} UNREACHABLE` : '');
  el.classList.toggle('warn', failed.length > 0);
  $('#crt-toggle').textContent = 'CRT: ' + (state.crt ? 'ON' : 'OFF');
  document.body.classList.toggle('crt', state.crt);
}

function render(resetScroll) {
  if (resetScroll) { state.shown = PAGE; $('#main').scrollTop = 0; }
  renderTabs();
  renderSidebar();
  renderMain();
  renderStatus();
}

// ---------------------------------------------------------------- stores tab

function renderStores() {
  const counts = {};
  for (const p of state.data.products) if (!p.gone) counts[p.storeId] = (counts[p.storeId] || 0) + 1;
  const rows = state.data.stores.map((s) => {
    const st = state.data.storeStatus[s.id];
    let status = '<span class="dom">Not downloaded yet</span>';
    if (st && st.ok) status = `<span class="ok">OK</span> · ${fmtDate(st.at)}`;
    else if (st) status = `<span class="bad">FAILED: ${esc(st.error)}</span>${st.at ? ` · showing saved copy from ${fmtDate(st.at)}` : ''}`;
    return `<tr>
      <td><input type="checkbox" data-toggle="${esc(s.id)}"${s.enabled ? ' checked' : ''} aria-label="Include ${esc(s.name)}"></td>
      <td>${esc(s.name)}<br><span class="dom">${esc(s.domain)}</span></td>
      <td>${counts[s.id] || 0}</td>
      <td>${status}</td>
      <td><button class="btn small" data-visit="${esc(s.domain)}">VISIT</button> <button class="btn small danger" data-remove="${esc(s.id)}">REMOVE</button></td>
    </tr>`;
  }).join('');
  $('#storesview').innerHTML = `
    <table class="st-table">
      <thead><tr><th>ON</th><th>STORE</th><th>ITEMS</th><th>STATUS</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="addrow">
      <input id="add-domain" type="text" placeholder="add a store, e.g. somebrand.com" spellcheck="false">
      <button id="add-btn" class="btn primary">ADD STORE</button>
    </div>
    <p id="add-msg"></p>
    <p class="sub">Works with most online clothing shops built on Shopify. New stores are downloaded on the next refresh.</p>`;
}

// ---------------------------------------------------------------- detail

let detailKey = null;

function openDetail(key) {
  const p = state.data.products.find((x) => x.key === key);
  if (!p) return;
  detailKey = key;
  const fav = state.favs.has(key);
  const pics = p.images && p.images.length ? p.images : (p.image ? [p.image] : []);
  const sizes = p.sizes.length
    ? '<div class="sizes">' + p.sizes.map((s) => `<span class="size${s.inStock ? '' : ' out'}${s.inStock && state.sizes.has(s.name) ? ' mine' : ''}">${esc(s.name)}</span>`).join('') + '</div>'
    : '<div>One size / no size options</div>';
  const hist = (p.history || []).map((h, i, a) => {
    const prev = i ? a[i - 1].price : null;
    const cls = prev === null ? '' : (h.price < prev ? 'down' : 'up');
    const arrow = prev === null ? 'first seen' : (h.price < prev ? '▼ dropped' : '▲ went up');
    return `<li class="${cls}">${fmtDate(h.t).split(' ').slice(0, 3).join(' ')} · ${money(h.price, p.currency)} · ${arrow}</li>`;
  }).reverse().join('');
  const was = p.onSale ? p.compareAt : null;

  $('#m-title').textContent = (state.storeName[p.storeId] || p.storeId).toUpperCase();
  $('#m-body').innerHTML = `<div class="detail">
    <div>
      <div class="d-pic">${pics.length ? `<img id="d-img" alt="" src="${esc(img(pics[0]))}">` : '<div class="noimg">NO<br>IMAGE</div>'}</div>
      ${pics.length > 1 ? '<div class="d-thumbs">' + pics.map((u, i) => `<button data-pic="${esc(u)}" class="${i ? '' : 'on'}" aria-label="Photo ${i + 1}"><img alt="" loading="lazy" src="${esc(img(u))}"></button>`).join('') + '</div>' : ''}
    </div>
    <div class="d-info">
      <h2>${esc(p.title)}</h2>
      <div class="d-store">${esc(state.storeName[p.storeId] || p.storeId)} · ${esc(p.category)}</div>
      <div class="badges-inline">${badges(p)}</div>
      <div class="d-price"><span>${money(p.price, p.currency)}</span>${was ? `<s>${money(was, p.currency)}</s><span class="off">${p.discount}% OFF</span>` : ''}</div>
      ${p.dropAt ? `<div class="note">Price dropped from ${money(p.dropFrom, p.currency)} to ${money(p.price, p.currency)} on ${fmtDate(p.dropAt).split(' ').slice(0, 3).join(' ')}.</div>` : ''}
      ${p.gone ? '<div class="note">This item is no longer listed by the store. Kept here because it is in your favorites.</div>' : ''}
      <div class="d-sec">SIZES</div>${sizes}
      <div class="d-sec">PRICE HISTORY</div><ul class="hist">${hist}</ul>
      <div class="d-sec">ADDED TO STORE</div><div>${p.publishedAt ? fmtDate(p.publishedAt).split(' ').slice(0, 3).join(' ') : 'Unknown'}</div>
      <div class="d-actions">
        <button class="btn primary" id="d-open">OPEN STORE PAGE</button>
        <button class="btn" id="d-fav">${fav ? '♥ REMOVE FAVORITE' : '♡ ADD TO FAVORITES'}</button>
        ${state.data.closet.some((c) => c.sourceKey === key)
          ? '<button class="btn" id="d-closet" disabled>✓ IN YOUR CLOSET</button>'
          : '<button class="btn" id="d-closet">I OWN THIS: ADD TO CLOSET</button>'}
      </div>
    </div>
  </div>`;
  $('#modal').hidden = false;
  $('#d-open').focus();
}

function closeDetail() {
  $('#modal').hidden = true;
  detailKey = null;
}

// ---------------------------------------------------------------- actions

async function toggleFav(key) {
  const on = await window.api.toggleFavorite(key);
  if (on) state.favs.add(key); else state.favs.delete(key);
  state.data.favorites = [...state.favs];
  document.querySelectorAll(`.heart[data-fav="${CSS.escape(key)}"]`).forEach((h) => h.classList.toggle('on', on));
  renderTabs();
  if (state.tab === 'favs' && !on) renderMain();
  if (detailKey === key) $('#d-fav').textContent = on ? '♥ REMOVE FAVORITE' : '♡ ADD TO FAVORITES';
}

function saveSettings() {
  window.api.setSettings({ mens: state.mens, sizes: [...state.sizes], crt: state.crt, currency: state.currency });
}

function showProgress(p) {
  const rows = Object.values(p.stores || {}).map((s) => {
    const label = { waiting: 'WAITING', working: (s.msg || 'CONNECTING').toUpperCase(), ok: 'OK  ' + s.msg.toUpperCase(), fail: 'FAILED - ' + s.msg }[s.state];
    return `<div class="pg-row ${s.state}"><span class="nm">&gt; ${esc(s.name)}</span><span class="st">${esc(label)}</span></div>`;
  }).join('');
  $('#pg-list').innerHTML = rows;
  const all = Object.values(p.stores || {});
  const doneStores = all.filter((s) => s.state === 'ok' || s.state === 'fail').length;
  let pct = all.length ? (doneStores / all.length) * 50 : 0;
  let text = `Reading stores... ${doneStores} of ${all.length}`;
  if (p.phase === 'images') {
    pct = 50 + (p.total ? (p.done / p.total) * 50 : 50);
    text = p.total ? `Saving photos for offline use... ${p.done} of ${p.total}` : 'Photos already saved.';
  }
  if (p.phase === 'done') {
    pct = 100;
    const s = p.summary || {};
    const failed = s.failed || [];
    if (p.error) text = 'Something went wrong: ' + p.error;
    else if (!s.ok) text = 'Could not reach any store. Are you offline?\nYour saved catalogue is still here.';
    else {
      text = `Done. ${s.ok} store${s.ok === 1 ? '' : 's'} updated · ${s.added} new item${s.added === 1 ? '' : 's'} · ${s.drops} price drop${s.drops === 1 ? '' : 's'}.`;
      if (failed.length) text += `\nCould not reach: ${failed.map((f) => f.name).join(', ')}.`;
      if (s.imagesFailed) text += `\n${s.imagesFailed} photo${s.imagesFailed === 1 ? '' : 's'} could not be saved.`;
    }
    $('#pg-ok').hidden = false;
    $('#pg-ok').focus();
  }
  $('#pg-bar').style.width = pct.toFixed(1) + '%';
  $('#pg-text').textContent = text;
}

async function doRefresh() {
  if (state.refreshing) return;
  state.refreshing = true;
  $('#refresh').disabled = true;
  $('#pg-ok').hidden = true;
  $('#pg-list').innerHTML = '';
  $('#pg-bar').style.width = '0%';
  $('#pg-text').textContent = 'Connecting...';
  $('#progress').hidden = false;
  try {
    await window.api.refresh();
    setData(await window.api.getData());
  } finally {
    state.refreshing = false;
    $('#refresh').disabled = false;
    render(false);
  }
}

// ---------------------------------------------------------------- events

function bind() {
  document.querySelectorAll('[data-win]').forEach((b) => b.addEventListener('click', () => window.api.win(b.dataset.win)));

  $('#tabs').addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab]');
    if (!t) return;
    state.tab = t.dataset.tab;
    render(true);
  });

  let qTimer;
  $('#q').addEventListener('input', (e) => {
    clearTimeout(qTimer);
    qTimer = setTimeout(() => { state.q = e.target.value; state.shown = PAGE; $('#main').scrollTop = 0; renderMain(); }, 140);
  });
  $('#sort').addEventListener('change', (e) => { state.sort = e.target.value; render(true); });
  $('#f-mens').addEventListener('change', (e) => { state.mens = e.target.checked; saveSettings(); render(true); });
  $('#f-stock').addEventListener('change', (e) => { state.stock = e.target.checked; render(true); });
  const num = (v) => (v === '' || isNaN(+v) ? null : +v);
  $('#p-min').addEventListener('input', (e) => { state.min = num(e.target.value); state.shown = PAGE; renderMain(); });
  $('#p-max').addEventListener('input', (e) => { state.max = num(e.target.value); state.shown = PAGE; renderMain(); });

  $('#f-cats').addEventListener('click', (e) => {
    const c = e.target.closest('[data-cat]');
    if (!c) return;
    const v = c.dataset.cat;
    if (state.cats.has(v)) state.cats.delete(v); else state.cats.add(v);
    render(true);
  });
  $('#f-sizes').addEventListener('click', (e) => {
    const c = e.target.closest('[data-size]');
    if (!c) return;
    const v = c.dataset.size;
    if (state.sizes.has(v)) state.sizes.delete(v); else state.sizes.add(v);
    saveSettings();
    render(true);
  });
  $('#f-stores').addEventListener('change', (e) => {
    const id = e.target.dataset.store;
    if (!id) return;
    if (e.target.checked) state.stores.add(id); else state.stores.delete(id);
    render(true);
  });
  $('#reset').addEventListener('click', () => {
    state.q = ''; state.sort = 'auto'; state.stock = false; state.min = null; state.max = null;
    state.cats.clear(); state.sizes.clear(); state.stores.clear();
    $('#q').value = ''; $('#sort').value = 'auto'; $('#p-min').value = ''; $('#p-max').value = '';
    saveSettings();
    render(true);
  });

  $('#banner').addEventListener('click', (e) => {
    const c = e.target.closest('[data-salestore]');
    if (!c) return;
    const id = c.dataset.salestore;
    const only = state.stores.size === 1 && state.stores.has(id);
    state.stores.clear();
    if (!only) state.stores.add(id);
    render(true);
  });

  const grid = $('#grid');
  grid.addEventListener('click', (e) => {
    const h = e.target.closest('[data-fav]');
    if (h) { e.stopPropagation(); toggleFav(h.dataset.fav); return; }
    const c = e.target.closest('.card');
    if (c) openDetail(c.dataset.key);
  });
  grid.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('card')) { e.preventDefault(); openDetail(e.target.dataset.key); }
  });
  // A photo that is not cached and cannot be fetched (offline) gets a placeholder.
  document.addEventListener('error', (e) => {
    const el = e.target;
    if (el.tagName !== 'IMG' || !el.parentElement) return;
    const ph = document.createElement('div');
    ph.className = 'noimg';
    ph.innerHTML = 'PHOTO NOT<br>SAVED YET';
    el.replaceWith(ph);
  }, true);

  new IntersectionObserver((entries) => { if (entries[0].isIntersecting) showMore(); }, { root: $('#main'), rootMargin: '1000px' }).observe($('#more'));

  $('#m-close').addEventListener('click', closeDetail);
  $('#modal').addEventListener('click', (e) => {
    if (e.target.id === 'modal') return closeDetail();
    const pic = e.target.closest('[data-pic]');
    if (pic) {
      const big = $('#d-img');
      if (big) big.src = img(pic.dataset.pic);
      document.querySelectorAll('.d-thumbs button').forEach((b) => b.classList.toggle('on', b === pic));
      return;
    }
    if (e.target.id === 'd-fav') return toggleFav(detailKey);
    if (e.target.id === 'd-open') {
      const p = state.data.products.find((x) => x.key === detailKey);
      if (p) window.api.open(p.url);
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#modal').hidden) closeDetail();
    if (e.key === '/' && document.activeElement.tagName !== 'INPUT') { e.preventDefault(); $('#q').focus(); }
  });

  $('#storesview').addEventListener('click', async (e) => {
    const t = e.target;
    if (t.dataset.visit) return window.api.open('https://' + t.dataset.visit);
    if (t.dataset.remove) {
      // Two-step confirm: removing a store also deletes its saved items.
      if (t.dataset.armed) { setData(await window.api.removeStore(t.dataset.remove)); state.stores.delete(t.dataset.remove); return render(false); }
      t.dataset.armed = '1';
      t.textContent = 'SURE? CLICK AGAIN';
      return;
    }
    if (t.id === 'add-btn') addStore();
  });
  $('#storesview').addEventListener('change', async (e) => {
    if (!e.target.dataset.toggle) return;
    setData(await window.api.toggleStore(e.target.dataset.toggle));
    render(false);
  });
  $('#storesview').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'add-domain') addStore(); });

  $('#refresh').addEventListener('click', doRefresh);
  $('#pg-ok').addEventListener('click', () => { $('#progress').hidden = true; });
  $('#crt-toggle').addEventListener('click', () => { state.crt = !state.crt; saveSettings(); renderStatus(); });

  const curSelect = $('#currency');
  if (curSelect) {
    curSelect.addEventListener('change', (e) => {
      state.currency = e.target.value;
      saveSettings();
      render(true);
    });
  }

  const syncBtn = $('#sync-open');
  if (syncBtn) syncBtn.addEventListener('click', openSyncModal);
  const syncClose = $('#sync-close');
  if (syncClose) syncClose.addEventListener('click', closeSyncModal);
  const syncMod = $('#sync-modal');
  if (syncMod) {
    syncMod.addEventListener('click', (e) => {
      if (e.target.id === 'sync-modal') closeSyncModal();
    });
  }

  const alertClose = $('#alert-close');
  if (alertClose) {
    alertClose.addEventListener('click', () => { $('#alert-banner').hidden = true; });
  }

  if (window.api.onWishlistAlerts) {
    window.api.onWishlistAlerts(handleWishlistAlerts);
  }

  if (window.api.onSyncComplete) {
    window.api.onSyncComplete((res) => {
      playChime(880, 0.25);
      const st = $('#sync-status');
      if (st) {
        const added = res.added || {};
        st.textContent = `SYNC COMPLETE! +${added.closet || 0} CLOSET ITEMS, +${added.outfits || 0} OUTFITS, +${added.favs || 0} WISHLIST.`;
        st.className = 'sync-status-msg ok';
      }
    });
  }

  bindCloset();

  // Phone: filters live in a slide-out panel.
  const setFilters = (open) => document.body.classList.toggle('filters-open', open);
  $('#filters-open').addEventListener('click', () => setFilters(true));
  $('#filters-done').addEventListener('click', () => setFilters(false));
  $('#tabs').addEventListener('click', () => setFilters(false));
  if (window.api.onBack) {
    // Back closes whatever is on top; returns false when there is nothing left.
    window.api.onBack(() => {
      if (!$('#sync-modal').hidden) { closeSyncModal(); return true; }
      if (!$('#modal').hidden) { closeDetail(); return true; }
      if (document.body.classList.contains('filters-open')) { setFilters(false); return true; }
      if (!$('#progress').hidden && !$('#pg-ok').hidden) { $('#progress').hidden = true; return true; }
      if (state.tab !== 'catalog') { state.tab = 'catalog'; render(true); return true; }
      return false;
    });
  }

  window.api.onProgress(showProgress);
  window.api.onData((d) => { setData(d); render(false); });
}

// ---------------------------------------------------------------- wishlist alerts & sounds

function playChime(freq = 587.33, duration = 0.15) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch (e) {}
}

function handleWishlistAlerts(alerts) {
  if (!alerts || !alerts.length) return;
  playChime(659.25, 0.2);
  setTimeout(() => playChime(880, 0.25), 120);
  const banner = $('#alert-banner');
  const text = $('#alert-text');
  if (banner && text) {
    text.innerHTML = `WISHLIST UPDATE: <b>${esc(alerts[0].message)}</b>` + (alerts.length > 1 ? ` (+${alerts.length - 1} more)` : '');
    banner.hidden = false;
  }
}

// ---------------------------------------------------------------- sync ui

let scannerStream = null;
let scannerInterval = null;

function stopScanner() {
  if (scannerInterval) {
    clearInterval(scannerInterval);
    scannerInterval = null;
  }
  if (scannerStream) {
    try { scannerStream.getTracks().forEach((t) => t.stop()); } catch (e) {}
    scannerStream = null;
  }
}

async function openSyncModal() {
  const modal = $('#sync-modal');
  const body = $('#sync-body');
  modal.hidden = false;
  body.innerHTML = '<div class="sync-container"><p class="sync-status-msg busy">INITIALIZING SYNC...</p></div>';

  if (!MOBILE && window.api.startSyncServer) {
    try {
      const info = await window.api.startSyncServer();
      body.innerHTML = `
        <div class="sync-container">
          <p class="sub">Scan this code with Emanuel Finds on your phone to cross-sync Wishlist, My Closet, Outfits, and custom stores.</p>
          <div class="sync-qr-box">
            <img src="${esc(info.qrDataUrl)}" alt="Sync QR Code">
          </div>
          <div class="sync-url-text">${esc(info.syncUrl)}</div>
          <p class="hint">Ensure phone and PC are connected to the same Wi-Fi network.</p>
          <div id="sync-status" class="sync-status-msg">WAITING FOR PHONE TO CONNECT...</div>
          <div class="sync-actions">
            <button class="btn small" id="sync-copy-code">COPY OFFLINE SYNC CODE</button>
            <button class="btn small" id="sync-paste-code">PASTE OFFLINE SYNC CODE</button>
          </div>
        </div>`;
      bindDesktopSyncActions();
    } catch (e) {
      body.innerHTML = `<div class="sync-container"><p class="sync-status-msg err">COULD NOT START SYNC SERVER: ${esc(e.message)}</p></div>`;
    }
  } else {
    renderMobileSyncView('scan');
  }
}

function bindDesktopSyncActions() {
  const copyBtn = $('#sync-copy-code');
  const pasteBtn = $('#sync-paste-code');
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      try {
        const bundle = await window.api.exportSyncBundle();
        await navigator.clipboard.writeText(bundle);
        const st = $('#sync-status');
        if (st) { st.textContent = 'SYNC CODE COPIED TO CLIPBOARD!'; st.className = 'sync-status-msg ok'; }
      } catch (e) { alert('Could not copy sync code: ' + e.message); }
    });
  }
  if (pasteBtn) {
    pasteBtn.addEventListener('click', async () => {
      const code = prompt('Paste sync code JSON:');
      if (code) {
        const res = await window.api.importSyncBundle(code);
        const st = $('#sync-status');
        if (res.ok) {
          if (st) { st.textContent = 'SYNC IMPORT COMPLETE!'; st.className = 'sync-status-msg ok'; }
          setData(await window.api.getData());
          render(false);
        } else {
          if (st) { st.textContent = 'IMPORT FAILED: ' + (res.error || 'Invalid code'); st.className = 'sync-status-msg err'; }
        }
      }
    });
  }
}

function renderMobileSyncView(tab) {
  const body = $('#sync-body');
  stopScanner();

  if (tab === 'scan') {
    body.innerHTML = `
      <div class="sync-container">
        <p class="sub">Point your camera at the QR code displayed on your PC screen.</p>
        <div class="sync-scanner-box">
          <video id="sync-video" playsinline></video>
          <div class="sync-scan-reticle"></div>
        </div>
        <div id="sync-status" class="sync-status-msg">SCANNING FOR PC QR CODE...</div>
        <div class="sync-actions">
          <button class="btn small" id="sync-tab-manual">ENTER URL MANUALLY</button>
          <button class="btn small" id="sync-tab-code">OFFLINE CODE</button>
        </div>
      </div>`;
    startCameraScanner();
  } else if (tab === 'manual') {
    body.innerHTML = `
      <div class="sync-container">
        <p class="sub">Enter the sync address shown on your PC:</p>
        <input id="sync-manual-url" type="text" placeholder="http://192.168.x.x:8765/sync?token=..." style="width:100%;font-size:16px;padding:8px;">
        <button id="sync-connect-btn" class="btn primary">CONNECT &amp; SYNC</button>
        <div id="sync-status" class="sync-status-msg"></div>
        <div class="sync-actions">
          <button class="btn small" id="sync-tab-scan">BACK TO CAMERA</button>
        </div>
      </div>`;
  } else if (tab === 'code') {
    body.innerHTML = `
      <div class="sync-container">
        <p class="sub">Offline cross-sync via text code:</p>
        <button id="sync-copy-mobile" class="btn">COPY MY PHONE DATA CODE</button>
        <textarea id="sync-paste-input" placeholder="Paste PC code here..." style="width:100%;height:100px;font-size:12px;"></textarea>
        <button id="sync-import-btn" class="btn primary">IMPORT &amp; MERGE</button>
        <div id="sync-status" class="sync-status-msg"></div>
        <div class="sync-actions">
          <button class="btn small" id="sync-tab-scan">BACK TO CAMERA</button>
        </div>
      </div>`;
  }

  bindMobileSyncEvents();
}

function bindMobileSyncEvents() {
  const toManual = $('#sync-tab-manual');
  const toScan = $('#sync-tab-scan');
  const toCode = $('#sync-tab-code');
  if (toManual) toManual.addEventListener('click', () => renderMobileSyncView('manual'));
  if (toScan) toScan.addEventListener('click', () => renderMobileSyncView('scan'));
  if (toCode) toCode.addEventListener('click', () => renderMobileSyncView('code'));

  const connBtn = $('#sync-connect-btn');
  if (connBtn) {
    connBtn.addEventListener('click', async () => {
      const url = ($('#sync-manual-url').value || '').trim();
      if (!url) return;
      await executeSync(url);
    });
  }

  const copyMobile = $('#sync-copy-mobile');
  if (copyMobile) {
    copyMobile.addEventListener('click', async () => {
      const bundle = await window.api.exportSyncBundle();
      await navigator.clipboard.writeText(bundle);
      const st = $('#sync-status');
      if (st) { st.textContent = 'COPIED TO CLIPBOARD!'; st.className = 'sync-status-msg ok'; }
    });
  }

  const importBtn = $('#sync-import-btn');
  if (importBtn) {
    importBtn.addEventListener('click', async () => {
      const code = ($('#sync-paste-input').value || '').trim();
      if (!code) return;
      const res = await window.api.importSyncBundle(code);
      const st = $('#sync-status');
      if (res.ok) {
        if (st) { st.textContent = 'SYNC MERGE SUCCESSFUL!'; st.className = 'sync-status-msg ok'; }
        setData(await window.api.getData());
        render(false);
      } else {
        if (st) { st.textContent = 'IMPORT FAILED: ' + (res.error || 'Invalid code'); st.className = 'sync-status-msg err'; }
      }
    });
  }
}

async function startCameraScanner() {
  const video = $('#sync-video');
  const statusEl = $('#sync-status');
  if (!video) return;

  try {
    scannerStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' }
    });
    video.srcObject = scannerStream;
    await video.play();

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    scannerInterval = setInterval(async () => {
      if (video.readyState !== video.HAVE_ENOUGH_DATA) return;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      if (window.jsQR) {
        const code = window.jsQR(imageData.data, imageData.width, imageData.height);
        if (code && code.data && /^https?:\/\//.test(code.data)) {
          stopScanner();
          playChime(880, 0.2);
          if (statusEl) {
            statusEl.textContent = 'QR CODE DETECTED! CONNECTING...';
            statusEl.className = 'sync-status-msg busy';
          }
          await executeSync(code.data);
        }
      }
    }, 150);
  } catch (err) {
    if (statusEl) {
      statusEl.innerHTML = `CAMERA: ${esc(err.name || err.message || 'DENIED')}<br><button class="btn small primary" id="sync-retry-cam" style="margin-top:8px;">GRANT &amp; RETRY CAMERA</button>`;
      statusEl.className = 'sync-status-msg err';
      const retryBtn = document.getElementById('sync-retry-cam');
      if (retryBtn) retryBtn.addEventListener('click', () => startCameraScanner());
    }
  }
}

async function executeSync(url) {
  const statusEl = $('#sync-status');
  if (statusEl) {
    statusEl.textContent = 'SYNCING DATA & CLOSET PHOTOS WITH PC...';
    statusEl.className = 'sync-status-msg busy';
  }
  try {
    const res = await window.api.syncConnect(url);
    if (res && res.ok) {
      playChime(880, 0.3);
      if (statusEl) {
        const added = res.added || {};
        statusEl.textContent = `SYNC COMPLETE! +${added.closet || 0} CLOSET ITEMS, +${added.outfits || 0} OUTFITS, +${added.favs || 0} WISHLIST.`;
        statusEl.className = 'sync-status-msg ok';
      }
      setData(await window.api.getData());
      render(false);
    } else {
      throw new Error(res.error || 'Sync failed');
    }
  } catch (e) {
    if (statusEl) {
      statusEl.textContent = 'SYNC ERROR: ' + e.message;
      statusEl.className = 'sync-status-msg err';
    }
  }
}

function closeSyncModal() {
  stopScanner();
  $('#sync-modal').hidden = true;
  if (!MOBILE && window.api.stopSyncServer) {
    window.api.stopSyncServer();
  }
}

async function addStore() {
  const input = $('#add-domain');
  const res = await window.api.addStore(input.value);
  if (res.error) { $('#add-msg').textContent = res.error; return; }
  setData(res.snapshot);
  render(false);
  $('#add-msg').textContent = 'Added. Press REFRESH STORES to download its catalogue.';
}

// ---------------------------------------------------------------- boot

function boot(hasData) {
  const lines = [
    'EMANUEL FINDS BIOS v1.0',
    'COPYRIGHT (C) 1996 FRESH FITS SYSTEMS',
    '',
    'MEMORY TEST ........ 640K OK',
    'WARDROBE DRIVE C: .. ' + (hasData ? state.data.products.length + ' ITEMS FOUND' : 'EMPTY'),
    'LOADING DRIP ....... OK',
    '',
    'STARTING EMANUELFINDS.EXE',
  ];
  const el = $('#boot-text');
  const bootEl = $('#boot');
  let i = 0;
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    bootEl.classList.add('off');
    setTimeout(() => { bootEl.hidden = true; if (!hasData) doRefresh(); }, 460);
  };
  const tick = () => {
    if (finished) return;
    if (i >= lines.length) return void setTimeout(finish, 350);
    el.textContent += lines[i++] + '\n';
    setTimeout(tick, 110);
  };
  bootEl.addEventListener('click', finish);
  tick();
}

(async function init() {
  setData(await window.api.getData());
  const s = state.data.settings || {};
  if (typeof s.mens === 'boolean') state.mens = s.mens;
  if (typeof s.crt === 'boolean') state.crt = s.crt;
  if (typeof s.currency === 'string') state.currency = s.currency;
  if ($('#currency')) $('#currency').value = state.currency;
  if (Array.isArray(s.sizes)) state.sizes = new Set(s.sizes);
  document.body.classList.toggle('mobile', MOBILE);
  bind();
  render(true);
  boot(state.data.products.length > 0);
})();
