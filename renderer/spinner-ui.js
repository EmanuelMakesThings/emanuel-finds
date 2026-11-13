'use strict';
// "Fit Spinner": Visual Streetwear Mannequin & Silhouette Outfit Generator.
// Large human-proportioned garment canvas head-to-toe with jacket + tee layering.

const MANNEQUIN_SLOTS = [
  { id: 'hat', name: 'HEADWEAR', category: 'Hats', icon: '🧢', defaultEnabled: true },
  { id: 'acc', name: 'ACCESSORY', category: 'Accessories', icon: '🕶️', defaultEnabled: false },
  { id: 'outerwear', name: 'JACKET / HOODIE', category: ['Hoodies & Sweats', 'Jackets'], icon: '🧥', defaultEnabled: true },
  { id: 'shirt', name: 'TOP / TEE', category: 'Tees & Tops', icon: '👕', defaultEnabled: true },
  { id: 'bottom', name: 'BOTTOMS', category: 'Pants', icon: '👖', defaultEnabled: true, subtype: 'pants' },
  { id: 'shoes', name: 'KICKS', category: 'Footwear', icon: '👟', defaultEnabled: true },
];

const fitState = {
  globalSource: 'all', // 'all' | 'closet' | 'catalog' | 'sale'
  sfx: true,
  isSpinning: false,
  savedMsg: '',
  showStoreDrawer: false,
  showPriceDrawer: false,
  storeFilter: {
    mode: 'include', // 'include' | 'exclude'
    selected: new Set(),
    query: '',
  },
  priceFilter: {
    mode: 'none', // 'none' | 'total' | 'item'
    totalMin: null,
    totalMax: null,
    itemMin: null,
    itemMax: null,
  },
  slots: {
    hat: { enabled: true, locked: false, item: null, spinning: false },
    acc: { enabled: false, locked: false, item: null, spinning: false },
    outerwear: { enabled: true, locked: false, item: null, spinning: false },
    shirt: { enabled: true, locked: false, item: null, spinning: false },
    bottom: { enabled: true, locked: false, subtype: 'pants', item: null, spinning: false },
    shoes: { enabled: true, locked: false, item: null, spinning: false },
  },
};

// ---------------------------------------------------------------- Sound Effects (Web Audio API)
let fitAudioCtx = null;
function getFitAudioCtx() {
  if (!fitAudioCtx && (window.AudioContext || window.webkitAudioContext)) {
    fitAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (fitAudioCtx && fitAudioCtx.state === 'suspended') {
    fitAudioCtx.resume().catch(() => {});
  }
  return fitAudioCtx;
}

function playReelTick() {
  if (!fitState.sfx) return;
  try {
    const ctx = getFitAudioCtx();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(540, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(140, ctx.currentTime + 0.03);
    gain.gain.setValueAtTime(0.06, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.03);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.03);
  } catch (e) {}
}

function playLockSound(locked) {
  if (!fitState.sfx) return;
  try {
    const ctx = getFitAudioCtx();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(locked ? 659.25 : 329.63, ctx.currentTime);
    gain.gain.setValueAtTime(0.05, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.05);
  } catch (e) {}
}

function playJackpotSound() {
  if (!fitState.sfx) return;
  try {
    const ctx = getFitAudioCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.50];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(freq, now + idx * 0.065);
      gain.gain.setValueAtTime(0.06, now + idx * 0.065);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.065 + 0.1);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.065);
      osc.stop(now + idx * 0.065 + 0.1);
    });
  } catch (e) {}
}

function playDiscardSound() {
  if (!fitState.sfx) return;
  try {
    const ctx = getFitAudioCtx();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(340, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(90, ctx.currentTime + 0.08);
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.08);
  } catch (e) {}
}

// ---------------------------------------------------------------- Store & Price Filter Helpers
function isStoreAllowed(storeId) {
  const sf = fitState.storeFilter;
  if (!sf || !sf.selected || sf.selected.size === 0) return true;
  if (sf.mode === 'include') {
    return sf.selected.has(storeId);
  } else if (sf.mode === 'exclude') {
    return !sf.selected.has(storeId);
  }
  return true;
}

function isItemPriceAllowed(price) {
  const pf = fitState.priceFilter;
  if (!pf || pf.mode !== 'item') return true;
  if (price == null || !isFinite(price)) return true;
  if (pf.itemMin != null && price < pf.itemMin) return false;
  if (pf.itemMax != null && price > pf.itemMax) return false;
  return true;
}

function getStoreBtnText() {
  const sf = fitState.storeFilter;
  if (!sf || !sf.selected || sf.selected.size === 0) return '🏪 STORES: ALL ▾';
  if (sf.mode === 'exclude') {
    return `🏪 STORES: ${sf.selected.size} EXCLUDED ▾`;
  }
  return `🏪 STORES: ${sf.selected.size} INCLUDED ▾`;
}

function getStoreBtnClass() {
  const sf = fitState.storeFilter;
  if (!sf || !sf.selected || sf.selected.size === 0) return '';
  return sf.mode === 'exclude' ? ' active-exclude' : ' active';
}

function getPriceBtnText() {
  const pf = fitState.priceFilter;
  if (!pf || pf.mode === 'none') return '💰 BUDGET: ANY ▾';
  if (pf.mode === 'total') {
    if (pf.totalMin != null && pf.totalMax != null) return `💰 FIT: $${pf.totalMin}-$${pf.totalMax} ▾`;
    if (pf.totalMax != null) return `💰 FIT: <$${pf.totalMax} ▾`;
    if (pf.totalMin != null) return `💰 FIT: >$${pf.totalMin} ▾`;
    return '💰 FIT BUDGET ▾';
  }
  if (pf.mode === 'item') {
    if (pf.itemMin != null && pf.itemMax != null) return `💰 ITEM: $${pf.itemMin}-$${pf.itemMax} ▾`;
    if (pf.itemMax != null) return `💰 ITEM: <$${pf.itemMax} ▾`;
    if (pf.itemMin != null) return `💰 ITEM: >$${pf.itemMin} ▾`;
    return '💰 ITEM RANGE ▾';
  }
  return '💰 BUDGET ▾';
}

function getPriceBtnClass() {
  const pf = fitState.priceFilter;
  if (!pf || pf.mode === 'none') return '';
  if (pf.mode === 'total' && (pf.totalMin != null || pf.totalMax != null)) return ' active';
  if (pf.mode === 'item' && (pf.itemMin != null || pf.itemMax != null)) return ' active';
  return '';
}

// Monte-Carlo budget solver for assembling whole outfits within budget
function pickBudgetFitCombinations(toSpinSlotIds) {
  if (fitState.priceFilter.mode !== 'total') return null;
  const { totalMin, totalMax } = fitState.priceFilter;
  if (totalMin == null && totalMax == null) return null;

  const slotOrder = ['hat', 'acc', 'outerwear', 'shirt', 'bottom', 'shoes'];
  let lockedCost = 0;
  for (const id of slotOrder) {
    if (!toSpinSlotIds.includes(id) && fitState.slots[id] && fitState.slots[id].enabled && fitState.slots[id].item) {
      const item = fitState.slots[id].item;
      if (!item.isCloset && item.price != null && isFinite(item.price)) {
        lockedCost += item.price;
      }
    }
  }

  const pools = {};
  for (const id of toSpinSlotIds) {
    pools[id] = getMannequinPool(id);
    if (!pools[id].length) return null;
  }

  const effectiveMax = totalMax != null ? totalMax - lockedCost : Infinity;
  const effectiveMin = totalMin != null ? Math.max(0, totalMin - lockedCost) : 0;

  let bestPick = null;
  let bestUnderDiff = Infinity;
  let closestOver = null;
  let minOverCost = Infinity;

  // Sample combinations across the available garments
  for (let trial = 0; trial < 150; trial++) {
    const candidate = {};
    let candidateCost = 0;
    for (const id of toSpinSlotIds) {
      const pick = pools[id][Math.floor(Math.random() * pools[id].length)];
      candidate[id] = pick;
      if (!pick.isCloset && pick.price != null && isFinite(pick.price)) {
        candidateCost += pick.price;
      }
    }

    if (candidateCost >= effectiveMin && candidateCost <= effectiveMax) {
      return candidate; // Perfect fit found!
    }

    if (candidateCost <= effectiveMax) {
      const diff = effectiveMax - candidateCost;
      if (diff < bestUnderDiff) {
        bestUnderDiff = diff;
        bestPick = candidate;
      }
    } else if (candidateCost < minOverCost) {
      minOverCost = candidateCost;
      closestOver = candidate;
    }
  }

  return bestPick || closestOver;
}

// ---------------------------------------------------------------- Item Pooling
function getMannequinPool(slotId, options = {}) {
  const slotDef = MANNEQUIN_SLOTS.find((s) => s.id === slotId);
  const slot = fitState.slots[slotId];
  if (!slotDef || !slot) return [];

  const source = fitState.globalSource;
  const pool = [];

  const matchCategory = (cat, title) => {
    if (slotId === 'acc') {
      return cat === 'Accessories' || cat === 'Other';
    }
    if (slotId === 'bottom') {
      return slot.subtype === 'shorts' ? cat === 'Shorts' : cat === 'Pants';
    }
    if (Array.isArray(slotDef.category)) {
      return slotDef.category.includes(cat);
    }
    return cat === slotDef.category;
  };

  const maxPriceCap = options.maxPrice != null ? options.maxPrice : null;
  const minPriceFloor = options.minPrice != null ? options.minPrice : null;

  // 1. My Closet
  if (source === 'all' || source === 'closet') {
    for (const c of (state.data.closet || [])) {
      if (matchCategory(c.category, c.title)) {
        if (!isItemPriceAllowed(c.price)) continue;
        if (maxPriceCap != null && c.price != null && c.price > maxPriceCap) continue;
        if (minPriceFloor != null && c.price != null && c.price < minPriceFloor) continue;

        pool.push({
          id: c.id,
          isCloset: true,
          title: c.title,
          brand: c.brand || 'MY CLOSET',
          price: c.price,
          currency: c.currency || 'USD',
          image: c.photo ? closetImg(c.photo) : null,
          url: c.url || null,
          closetId: c.id,
          sourceKey: c.sourceKey || null,
        });
      }
    }
  }

  // 2. Store Catalogue
  if (source === 'all' || source === 'catalog' || source === 'sale') {
    const enabledStores = new Set((state.data.stores || []).filter((s) => s.enabled).map((s) => s.id));
    for (const p of (state.data.products || [])) {
      if (p.gone || !p.available) continue;
      if (!enabledStores.has(p.storeId)) continue;
      if (!isStoreAllowed(p.storeId)) continue;
      if (state.mens && p.gender !== 'men' && p.gender !== 'unisex') continue;
      if (source === 'sale' && !p.onSale) continue;
      if (!matchCategory(p.category, p.title)) continue;

      if (!isItemPriceAllowed(p.price)) continue;
      if (maxPriceCap != null && p.price != null && p.price > maxPriceCap) continue;
      if (minPriceFloor != null && p.price != null && p.price < minPriceFloor) continue;

      pool.push({
        id: p.key,
        isCloset: false,
        title: p.title,
        brand: state.storeName[p.storeId] || p.vendor || p.storeId,
        price: p.price,
        currency: p.currency || 'USD',
        image: p.image ? img(p.image) : null,
        url: p.url,
        closetId: null,
        sourceKey: p.key,
        onSale: p.onSale,
      });
    }
  }

  return pool;
}

// ---------------------------------------------------------------- Roll Logic
function rollMannequinSlot(slotId) {
  const slot = fitState.slots[slotId];
  if (!slot || !slot.enabled || slot.locked || slot.spinning) return;

  let poolOptions = {};
  if (fitState.priceFilter.mode === 'total' && fitState.priceFilter.totalMax != null) {
    const slotOrder = ['hat', 'acc', 'outerwear', 'shirt', 'bottom', 'shoes'];
    let otherCost = 0;
    for (const id of slotOrder) {
      if (id !== slotId && fitState.slots[id] && fitState.slots[id].enabled && fitState.slots[id].item) {
        const item = fitState.slots[id].item;
        if (!item.isCloset && item.price != null && isFinite(item.price)) {
          otherCost += item.price;
        }
      }
    }
    const maxForSlot = Math.max(0, fitState.priceFilter.totalMax - otherCost);
    poolOptions.maxPrice = maxForSlot;
  }

  let pool = getMannequinPool(slotId, poolOptions);
  if (!pool.length && poolOptions.maxPrice != null) {
    pool = getMannequinPool(slotId);
  }

  if (!pool.length) {
    slot.item = null;
    renderSlotDisplay(slotId);
    updateFitSummary();
    return;
  }

  slot.spinning = true;
  const target = pool[Math.floor(Math.random() * pool.length)];
  const frameEl = $(`#frame-${slotId}`);
  if (frameEl) frameEl.classList.add('spinning');

  let ticks = 0;
  const maxTicks = 8;
  const interval = setInterval(() => {
    ticks++;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    renderSlotPreview(slotId, pick);
    playReelTick();

    if (ticks >= maxTicks) {
      clearInterval(interval);
      slot.item = target;
      slot.spinning = false;
      if (frameEl) frameEl.classList.remove('spinning');
      renderSlotDisplay(slotId);
      updateFitSummary();
    }
  }, 65);
}

function spinFullFit() {
  if (fitState.isSpinning) return;
  fitState.savedMsg = '';

  const slotOrder = ['hat', 'acc', 'outerwear', 'shirt', 'bottom', 'shoes'];
  const toSpin = slotOrder.filter((id) => {
    const s = fitState.slots[id];
    return s && s.enabled && !s.locked;
  });

  if (!toSpin.length) return;
  fitState.isSpinning = true;
  const rollBtn = $('#roll-full-btn');
  if (rollBtn) rollBtn.disabled = true;

  const budgetPlan = pickBudgetFitCombinations(toSpin);

  let completed = 0;
  toSpin.forEach((id, idx) => {
    const slot = fitState.slots[id];
    const pool = getMannequinPool(id);
    if (!pool.length) {
      slot.item = null;
      renderSlotDisplay(id);
      completed++;
      if (completed >= toSpin.length) finishSpinFullFit();
      return;
    }

    slot.spinning = true;
    const target = (budgetPlan && budgetPlan[id]) || pool[Math.floor(Math.random() * pool.length)];
    const frameEl = $(`#frame-${id}`);
    if (frameEl) frameEl.classList.add('spinning');

    let ticks = 0;
    const maxTicks = 6 + idx * 3;
    const interval = setInterval(() => {
      ticks++;
      const pick = pool[Math.floor(Math.random() * pool.length)];
      renderSlotPreview(id, pick);
      playReelTick();

      if (ticks >= maxTicks) {
        clearInterval(interval);
        slot.item = target;
        slot.spinning = false;
        if (frameEl) frameEl.classList.remove('spinning');
        renderSlotDisplay(id);
        completed++;
        if (completed >= toSpin.length) finishSpinFullFit();
      }
    }, 65);
  });
}

function finishSpinFullFit() {
  fitState.isSpinning = false;
  const rollBtn = $('#roll-full-btn');
  if (rollBtn) rollBtn.disabled = false;
  playJackpotSound();
  updateFitSummary();
}

// ---------------------------------------------------------------- Rendering
function renderSlotPreview(slotId, item) {
  const imgBox = $(`#imgbox-${slotId}`);
  if (!imgBox) return;
  imgBox.innerHTML = item && item.image
    ? `<img alt="" src="${esc(item.image)}">`
    : '<div class="noimg">SPINNING...</div>';
}

function renderSlotDisplay(slotId) {
  const slotDef = MANNEQUIN_SLOTS.find((s) => s.id === slotId);
  const slot = fitState.slots[slotId];
  const frameEl = $(`#frame-${slotId}`);
  if (!slotDef || !slot || !frameEl) return;

  frameEl.classList.toggle('locked', slot.locked);
  frameEl.classList.toggle('disabled', !slot.enabled);

  const lockBtn = $(`#lock-${slotId}`);
  if (lockBtn) {
    lockBtn.innerHTML = slot.locked ? '🔒' : '🔓';
    lockBtn.classList.toggle('on', slot.locked);
    lockBtn.title = slot.locked ? 'Locked (will not re-roll)' : 'Click to lock';
  }

  const clearBtn = $(`#clear-${slotId}`);
  if (clearBtn) {
    clearBtn.style.display = (slot.enabled && slot.item) ? 'flex' : 'none';
  }

  const imgBox = $(`#imgbox-${slotId}`);
  const tagBox = $(`#tag-${slotId}`);
  const metaBox = $(`#meta-${slotId}`);

  const item = slot.item;
  if (!slot.enabled) {
    if (imgBox) imgBox.innerHTML = `<div class="mannequin-sil-empty"><span class="m-icon">${slotDef.icon}</span><span class="m-hint">OFF</span></div>`;
    if (tagBox) tagBox.innerHTML = '';
    if (metaBox) metaBox.innerHTML = `<div class="m-meta-empty">${slotDef.name} (OFF)</div>`;
    return;
  }

  if (!item) {
    if (imgBox) imgBox.innerHTML = `<div class="mannequin-sil-empty"><span class="m-icon">${slotDef.icon}</span><span class="m-hint">CLICK TO ROLL</span></div>`;
    if (tagBox) tagBox.innerHTML = '';
    if (metaBox) metaBox.innerHTML = `<div class="m-meta-empty">${slotDef.name}</div>`;
    return;
  }

  if (imgBox) {
    imgBox.innerHTML = item.image
      ? `<img alt="" src="${esc(item.image)}">`
      : '<div class="noimg">NO PHOTO</div>';
  }

  if (tagBox) {
    tagBox.innerHTML = item.isCloset
      ? '<span class="sil-badge owned">★ OWNED</span>'
      : (item.onSale ? '<span class="sil-badge sale">SALE</span>' : '<span class="sil-badge store">STORE</span>');
  }

  const priceStr = item.price != null ? money(item.price, item.currency) : '';

  if (metaBox) {
    metaBox.innerHTML = `
      <div class="m-meta-brand">${esc(item.brand)}</div>
      <div class="m-meta-title" title="${esc(item.title)}">${esc(item.title)}</div>
      <div class="m-meta-price">${esc(priceStr)}</div>
    `;
  }
}

function updateFitSummary() {
  const summaryEl = $('#mannequin-summary');
  if (!summaryEl) return;

  const slotOrder = ['hat', 'acc', 'outerwear', 'shirt', 'bottom', 'shoes'];
  const pieces = slotOrder
    .filter((id) => fitState.slots[id] && fitState.slots[id].enabled && fitState.slots[id].item)
    .map((id) => ({ id, item: fitState.slots[id].item }));

  if (!pieces.length) {
    summaryEl.innerHTML = `
      <div class="fit-summary-card empty">
        <div class="summary-title">DRIP CANVAS EMPTY</div>
        <p class="summary-sub">Click any piece on the silhouette or press ROLL FULL DRIP to generate your look!</p>
      </div>`;
    return;
  }

  let totalCost = 0;
  let ownedCount = 0;
  let storeCount = 0;
  const storeItems = [];

  for (const { item } of pieces) {
    if (item.isCloset) {
      ownedCount++;
    } else {
      storeCount++;
      if (item.price != null && isFinite(item.price)) totalCost += item.price;
      if (item.url) storeItems.push(item);
    }
  }

  const rowsHtml = pieces.map(({ id, item }) => {
    const slotDef = MANNEQUIN_SLOTS.find((s) => s.id === id);
    return `
      <div class="summary-piece-row">
        <span class="p-icon">${slotDef.icon}</span>
        <span class="p-title">${esc(item.title)}</span>
        <span class="p-badge ${item.isCloset ? 'owned' : 'cop'}">${item.isCloset ? 'OWNED' : 'COP'}</span>
        <span class="p-price">${item.price != null ? money(item.price, item.currency) : ''}</span>
      </div>
    `;
  }).join('');

  const pf = fitState.priceFilter;
  const sf = fitState.storeFilter;
  let budgetPillHtml = '';

  if (storeCount) {
    if (pf.mode === 'total' && pf.totalMax != null) {
      const under = totalCost <= pf.totalMax;
      const diff = Math.abs(totalCost - pf.totalMax);
      budgetPillHtml = `
        <div class="count-pill total budget-pill">
          COP VALUE: <b>${formatMoney(totalCost, 'USD')}</b>
          <span class="budget-status-tag ${under ? 'good' : 'warn'}">
            ${under ? `✓ WITHIN $${pf.totalMax} CAP` : `⚠️ +$${diff} OVER $${pf.totalMax}`}
          </span>
        </div>
      `;
    } else {
      budgetPillHtml = `<div class="count-pill total">COP VALUE: <b>${formatMoney(totalCost, 'USD')}</b></div>`;
    }
  }

  let filterBadges = [];
  if (sf.selected && sf.selected.size > 0) {
    filterBadges.push(`<span class="summary-filter-badge">🏪 ${sf.selected.size} STORES ${sf.mode === 'exclude' ? 'EXCLUDED' : 'SELECTED'}</span>`);
  }
  if (pf.mode === 'item' && (pf.itemMin != null || pf.itemMax != null)) {
    filterBadges.push(`<span class="summary-filter-badge">💰 ITEM: ${pf.itemMax != null ? `<$${pf.itemMax}` : ''}</span>`);
  }

  summaryEl.innerHTML = `
    <div class="fit-summary-card">
      <div class="summary-title">CURRENT FIT (${pieces.length} PIECES)</div>
      
      <div class="summary-counts">
        <div class="count-pill"><b>${ownedCount}</b> IN CLOSET</div>
        <div class="count-pill"><b>${storeCount}</b> TO COP</div>
        ${budgetPillHtml}
        ${filterBadges.length ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:2px;">${filterBadges.join('')}</div>` : ''}
      </div>

      <div class="summary-list">${rowsHtml}</div>

      <div class="summary-btns">
        <button id="save-fit-btn" class="btn primary wide">💾 SAVE OUTFIT TO CLOSET</button>
        <button id="reset-fit-btn" class="btn wide" title="Discard pieces and revert cards to silhouette emojis">↺ REVERT ALL TO SILHOUETTES</button>
        ${storeItems.length ? `<button id="buy-fit-btn" class="btn wide">🛒 VIEW STORE PIECES (${storeItems.length})</button>` : ''}
      </div>

      ${fitState.savedMsg ? `<div class="fit-saved-toast">${esc(fitState.savedMsg)}</div>` : ''}
    </div>
  `;
}

// ---------------------------------------------------------------- Store & Price Drawers
function renderStoreDrawerHtml() {
  const sf = fitState.storeFilter;
  const stores = state.data.stores || [];
  const query = (sf.query || '').trim().toLowerCase();
  const counts = {};
  for (const p of (state.data.products || [])) {
    if (!p.gone) counts[p.storeId] = (counts[p.storeId] || 0) + 1;
  }

  const isExclude = sf.mode === 'exclude';
  const filteredStores = stores.filter((s) => {
    if (!query) return true;
    return s.name.toLowerCase().includes(query) || (s.domain || '').toLowerCase().includes(query);
  });

  const chipsHtml = filteredStores.map((s) => {
    const isSelected = sf.selected.has(s.id);
    let stateClass = '';
    let checkIcon = '○';
    if (isSelected) {
      if (isExclude) {
        stateClass = ' excluded';
        checkIcon = '✕';
      } else {
        stateClass = ' included';
        checkIcon = '✓';
      }
    }
    return `
      <div class="store-chip-item${stateClass}" data-store-chip="${esc(s.id)}" title="${isExclude ? (isSelected ? 'Excluded: click to re-include' : 'Click to exclude') : (isSelected ? 'Included: click to remove' : 'Click to include')}">
        <span class="chip-check">${checkIcon}</span>
        <span class="chip-name">${esc(s.name)}</span>
        <span class="chip-cnt">${counts[s.id] || 0}</span>
      </div>
    `;
  }).join('');

  return `
    <div class="studio-filter-drawer store-drawer" id="store-filter-drawer">
      <div class="drawer-header">
        <div class="drawer-title">
          <span class="drawer-icon">🏪</span>
          <b>STORE FILTER</b>
          <span class="drawer-hint">Select specific stores to include or exclude from spins</span>
        </div>

        <div class="drawer-mode-toggle">
          <span class="mode-label">MODE:</span>
          <button class="mode-pill${!isExclude ? ' on' : ''}" data-store-mode="include" title="Only roll pieces from checked stores">
            INCLUDE SELECTED
          </button>
          <button class="mode-pill${isExclude ? ' on' : ''}" data-store-mode="exclude" title="Roll all stores EXCEPT checked stores">
            EXCLUDE SELECTED
          </button>
        </div>

        <div class="drawer-actions">
          <button class="btn small" id="stores-select-all-btn">${isExclude ? 'EXCLUDE ALL' : 'SELECT ALL'}</button>
          <button class="btn small" id="stores-clear-btn">CLEAR</button>
          <button class="drawer-close-btn" id="close-store-drawer-btn" title="Close Drawer">✕</button>
        </div>
      </div>

      <div class="drawer-body">
        <div class="drawer-search-bar">
          <input type="text" id="store-filter-search" placeholder="Type to filter brand name (e.g. God's Kingdom, CXXII, Feature)..." spellcheck="false" value="${esc(sf.query || '')}">
          <span class="search-count-hint">${filteredStores.length} of ${stores.length} stores (${sf.selected.size} ${isExclude ? 'excluded' : 'selected'})</span>
        </div>

        <div class="stores-chip-grid">
          ${chipsHtml || '<div class="no-matches">NO MATCHING STORES FOUND</div>'}
        </div>
      </div>
    </div>
  `;
}

function renderPriceDrawerHtml() {
  const pf = fitState.priceFilter;
  const isTotal = pf.mode === 'total';
  const isItem = pf.mode === 'item';
  const isNone = pf.mode === 'none';

  return `
    <div class="studio-filter-drawer price-drawer" id="price-filter-drawer">
      <div class="drawer-header">
        <div class="drawer-title">
          <span class="drawer-icon">💰</span>
          <b>PRICE & BUDGET LIMITS</b>
          <span class="drawer-hint">Set price limits for the entire fit or per individual garment</span>
        </div>

        <div class="drawer-mode-toggle">
          <span class="mode-label">LIMIT BY:</span>
          <button class="mode-pill${isNone ? ' on' : ''}" data-price-mode="none">
            ANY PRICE (NO CAP)
          </button>
          <button class="mode-pill${isTotal ? ' on' : ''}" data-price-mode="total" title="Control the total price of all store pieces combined">
            TOTAL FIT BUDGET
          </button>
          <button class="mode-pill${isItem ? ' on' : ''}" data-price-mode="item" title="Cap individual pieces by price bracket">
            PER ITEM RANGE
          </button>
        </div>

        <div class="drawer-actions">
          <button class="btn small" id="price-clear-btn">RESET</button>
          <button class="drawer-close-btn" id="close-price-drawer-btn" title="Close Drawer">✕</button>
        </div>
      </div>

      <div class="drawer-body">
        ${isTotal ? `
          <div class="budget-config-row">
            <div class="budget-desc">
              <b>TOTAL FIT BUDGET:</b> The slot machine will intelligently assemble full outfits whose combined cop cost stays within your budget. (Closet items = $0 cop cost).
            </div>
            <div class="budget-inputs">
              <label>MIN TOTAL: $<input type="number" id="fit-min-total" min="0" step="10" placeholder="0" value="${pf.totalMin != null ? pf.totalMin : ''}"></label>
              <label>MAX TOTAL: $<input type="number" id="fit-max-total" min="0" step="10" placeholder="e.g. 200" value="${pf.totalMax != null ? pf.totalMax : ''}"></label>
              <button class="btn primary small" id="apply-budget-btn">APPLY BUDGET</button>
            </div>
            <div class="budget-presets">
              <span class="preset-label">QUICK TOTAL CAPS:</span>
              <button class="preset-pill${pf.totalMax === 100 ? ' on' : ''}" data-fit-cap="100">UNDER $100</button>
              <button class="preset-pill${pf.totalMax === 150 ? ' on' : ''}" data-fit-cap="150">UNDER $150</button>
              <button class="preset-pill${pf.totalMax === 200 ? ' on' : ''}" data-fit-cap="200">UNDER $200</button>
              <button class="preset-pill${pf.totalMax === 300 ? ' on' : ''}" data-fit-cap="300">UNDER $300</button>
              <button class="preset-pill${pf.totalMax === 500 ? ' on' : ''}" data-fit-cap="500">UNDER $500</button>
            </div>
          </div>
        ` : ''}

        ${isItem ? `
          <div class="budget-config-row">
            <div class="budget-desc">
              <b>PER ITEM RANGE:</b> Every individual piece rolled must fall within this price bracket.
            </div>
            <div class="budget-inputs">
              <label>MIN / PIECE: $<input type="number" id="item-min-price" min="0" step="5" placeholder="0" value="${pf.itemMin != null ? pf.itemMin : ''}"></label>
              <label>MAX / PIECE: $<input type="number" id="item-max-price" min="0" step="5" placeholder="e.g. 60" value="${pf.itemMax != null ? pf.itemMax : ''}"></label>
              <button class="btn primary small" id="apply-budget-btn">APPLY RANGE</button>
            </div>
            <div class="budget-presets">
              <span class="preset-label">QUICK PIECE CAPS:</span>
              <button class="preset-pill${pf.itemMax === 30 ? ' on' : ''}" data-item-cap="30">UNDER $30</button>
              <button class="preset-pill${pf.itemMax === 50 ? ' on' : ''}" data-item-cap="50">UNDER $50</button>
              <button class="preset-pill${pf.itemMax === 75 ? ' on' : ''}" data-item-cap="75">UNDER $75</button>
              <button class="preset-pill${pf.itemMax === 100 ? ' on' : ''}" data-item-cap="100">UNDER $100</button>
              <button class="preset-pill${pf.itemMax === 150 ? ' on' : ''}" data-item-cap="150">UNDER $150</button>
            </div>
          </div>
        ` : ''}

        ${isNone ? `
          <div class="budget-desc dimmed">
            No price limits currently applied. Items of any price will be rolled. Click <b>TOTAL FIT BUDGET</b> or <b>PER ITEM RANGE</b> above to activate a budget.
          </div>
        ` : ''}
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------- Main Tab Render
function renderSpinner() {
  const container = $('#spinnerview');
  if (!container) return;

  const isShorts = fitState.slots.bottom.subtype === 'shorts';

  container.innerHTML = `
    <div class="streetwear-studio">
      
      <!-- Top Control Header -->
      <div class="studio-header-deck">
        <div class="studio-branding">
          <div class="studio-title">🎰 FIT GENERATOR</div>
          <div class="studio-sub">CLICK ANY GARMENT ON THE MANNEQUIN TO ROLL · SPACEBAR TO ROLL FULL DRIP</div>
        </div>

        <button id="roll-full-btn" class="btn primary roll-lever-btn">
          🎲 ROLL FULL DRIP [SPACE]
        </button>

        <div class="deck-controls">
          <!-- Eye-friendly dark cyberpunk segmented source pills -->
          <div class="deck-source-pills">
            <span class="deck-label">POOL FROM:</span>
            <button class="source-pill${fitState.globalSource === 'all' ? ' on' : ''}" data-source-pill="all">ALL</button>
            <button class="source-pill${fitState.globalSource === 'closet' ? ' on' : ''}" data-source-pill="closet">MY CLOSET</button>
            <button class="source-pill${fitState.globalSource === 'catalog' ? ' on' : ''}" data-source-pill="catalog">STORE DROPS</button>
            <button class="source-pill${fitState.globalSource === 'sale' ? ' on' : ''}" data-source-pill="sale">ON SALE</button>
          </div>

          <!-- Store Selection / Exclusion -->
          <button id="toggle-store-filter-btn" class="filter-pill-btn${getStoreBtnClass()}" title="Include or exclude specific stores">
            ${getStoreBtnText()}
          </button>

          <!-- Entire Fit or Per-Item Price Range -->
          <button id="toggle-price-filter-btn" class="filter-pill-btn${getPriceBtnClass()}" title="Set whole fit budget or per-item price range">
            ${getPriceBtnText()}
          </button>

          <button id="reset-fit-btn" class="btn small" title="Revert pieces back to silhouette emoji cards">↺ RESET FIT</button>
          <button id="lock-all-btn" class="btn small" title="Lock all slots">🔒 LOCK ALL</button>
          <button id="unlock-all-btn" class="btn small" title="Unlock all slots">🔓 UNLOCK ALL</button>
          <button id="sfx-toggle-btn" class="btn small">${fitState.sfx ? '🔊 SFX: ON' : '🔈 SFX: OFF'}</button>
        </div>
      </div>

      <!-- Store Filter Drawer (collapsible) -->
      ${fitState.showStoreDrawer ? renderStoreDrawerHtml() : ''}

      <!-- Price Filter Drawer (collapsible) -->
      ${fitState.showPriceDrawer ? renderPriceDrawerHtml() : ''}

      <!-- Main Stage: Center Silhouette + Side Summary -->
      <div class="studio-stage">
        
        <!-- Center Column: The Visual Mannequin Silhouette -->
        <div class="mannequin-stage">
          <div class="mannequin-silhouette-body">
            
            <!-- 1. HEAD (Hat) -->
            <div class="garment-slot-wrapper slot-zone-head">
              <div class="garment-slot-frame frame-head" id="frame-hat" data-roll-slot="hat" title="Click to roll Hat">
                <div class="garment-pic-box" id="imgbox-hat"></div>
                <div class="garment-tag-anchor" id="tag-hat"></div>
                <button class="garment-clear-anchor" id="clear-hat" data-clear-slot="hat" title="Discard piece / Revert to silhouette" style="${fitState.slots.hat.item ? '' : 'display:none;'}">✕</button>
                <button class="garment-lock-anchor" id="lock-hat" data-lock-slot="hat" title="Lock/Unlock Hat">🔓</button>
              </div>
              <div class="garment-meta-anchor" id="meta-hat"></div>
            </div>

            <!-- 2. ACCESSORIES / CHAIN (Toggleable) -->
            <div class="garment-slot-wrapper slot-zone-acc">
              <div class="slot-toggle-bar">
                <label class="slot-check-label">
                  <input type="checkbox" id="check-acc" ${fitState.slots.acc.enabled ? 'checked' : ''}>
                  <span>🕶️ ACCESSORIES / CHAIN</span>
                </label>
              </div>
              ${fitState.slots.acc.enabled ? `
                <div class="garment-slot-frame frame-acc" id="frame-acc" data-roll-slot="acc" title="Click to roll Accessory">
                  <div class="garment-pic-box" id="imgbox-acc"></div>
                  <div class="garment-tag-anchor" id="tag-acc"></div>
                  <button class="garment-clear-anchor" id="clear-acc" data-clear-slot="acc" title="Discard piece / Revert to silhouette" style="${fitState.slots.acc.item ? '' : 'display:none;'}">✕</button>
                  <button class="garment-lock-anchor" id="lock-acc" data-lock-slot="acc" title="Lock/Unlock Accessory">🔓</button>
                </div>
                <div class="garment-meta-anchor" id="meta-acc"></div>
              ` : ''}
            </div>

            <!-- 3. CHEST & UPPER BODY: JACKET/HOODIE + TEE/TOP (LAYERING) -->
            <div class="garment-slot-wrapper slot-zone-torso-layered">
              <div class="slot-toggle-bar torso-layer-header">
                <label class="slot-check-label" title="Toggle jacket/hoodie outer layer">
                  <input type="checkbox" id="check-outerwear" ${fitState.slots.outerwear.enabled ? 'checked' : ''}>
                  <span>🧥 JACKET / HOODIE (LAYER)</span>
                </label>
                <span class="layer-plus-sign">+</span>
                <span class="slot-section-title">👕 TEE / TOP</span>
              </div>

              <div class="torso-layer-grid ${fitState.slots.outerwear.enabled ? 'dual' : 'solo'}">
                ${fitState.slots.outerwear.enabled ? `
                  <div class="torso-col col-outerwear">
                    <div class="garment-slot-frame frame-outerwear" id="frame-outerwear" data-roll-slot="outerwear" title="Click to roll Jacket/Hoodie">
                      <div class="garment-pic-box" id="imgbox-outerwear"></div>
                      <div class="garment-tag-anchor" id="tag-outerwear"></div>
                      <button class="garment-clear-anchor" id="clear-outerwear" data-clear-slot="outerwear" title="Discard piece / Revert to silhouette" style="${fitState.slots.outerwear.item ? '' : 'display:none;'}">✕</button>
                      <button class="garment-lock-anchor" id="lock-outerwear" data-lock-slot="outerwear" title="Lock/Unlock Jacket">🔓</button>
                    </div>
                    <div class="garment-meta-anchor" id="meta-outerwear"></div>
                  </div>
                ` : ''}

                <div class="torso-col col-shirt">
                  <div class="garment-slot-frame frame-torso" id="frame-shirt" data-roll-slot="shirt" title="Click to roll Tee/Top">
                    <div class="garment-pic-box" id="imgbox-shirt"></div>
                    <div class="garment-tag-anchor" id="tag-shirt"></div>
                    <button class="garment-clear-anchor" id="clear-shirt" data-clear-slot="shirt" title="Discard piece / Revert to silhouette" style="${fitState.slots.shirt.item ? '' : 'display:none;'}">✕</button>
                    <button class="garment-lock-anchor" id="lock-shirt" data-lock-slot="shirt" title="Lock/Unlock Tee">🔓</button>
                  </div>
                  <div class="garment-meta-anchor" id="meta-shirt"></div>
                </div>
              </div>
            </div>

            <!-- 5. LEGS (Bottoms: Pants vs Shorts Switcher) -->
            <div class="garment-slot-wrapper slot-zone-legs">
              <div class="slot-toggle-bar">
                <div class="slot-switch-pills">
                  <button class="switch-pill${!isShorts ? ' on' : ''}" data-bottom-type="pants">👖 PANTS</button>
                  <button class="switch-pill${isShorts ? ' on' : ''}" data-bottom-type="shorts">🩳 SHORTS</button>
                </div>
              </div>

              <div class="garment-slot-frame frame-legs" id="frame-bottom" data-roll-slot="bottom" title="Click to roll ${isShorts ? 'Shorts' : 'Pants'}">
                <div class="garment-pic-box" id="imgbox-bottom"></div>
                <div class="garment-tag-anchor" id="tag-bottom"></div>
                <button class="garment-clear-anchor" id="clear-bottom" data-clear-slot="bottom" title="Discard piece / Revert to silhouette" style="${fitState.slots.bottom.item ? '' : 'display:none;'}">✕</button>
                <button class="garment-lock-anchor" id="lock-bottom" data-lock-slot="bottom" title="Lock/Unlock Bottoms">🔓</button>
              </div>
              <div class="garment-meta-anchor" id="meta-bottom"></div>
            </div>

            <!-- 6. FEET (Kicks) -->
            <div class="garment-slot-wrapper slot-zone-feet">
              <div class="slot-toggle-bar">
                <span class="slot-section-title">👟 FOOTWEAR</span>
              </div>
              
              <div class="garment-slot-frame frame-feet" id="frame-shoes" data-roll-slot="shoes" title="Click to roll Kicks">
                <div class="garment-pic-box" id="imgbox-shoes"></div>
                <div class="garment-tag-anchor" id="tag-shoes"></div>
                <button class="garment-clear-anchor" id="clear-shoes" data-clear-slot="shoes" title="Discard piece / Revert to silhouette" style="${fitState.slots.shoes.item ? '' : 'display:none;'}">✕</button>
                <button class="garment-lock-anchor" id="lock-shoes" data-lock-slot="shoes" title="Lock/Unlock Kicks">🔓</button>
              </div>
              <div class="garment-meta-anchor" id="meta-shoes"></div>
            </div>

          </div>
        </div>

        <!-- Right Column: Fit Summary Roster -->
        <aside class="studio-summary-aside" id="mannequin-summary"></aside>

      </div>

    </div>
  `;

  // Render slot displays
  renderSlotDisplay('hat');
  if (fitState.slots.acc.enabled) renderSlotDisplay('acc');
  if (fitState.slots.outerwear.enabled) renderSlotDisplay('outerwear');
  renderSlotDisplay('shirt');
  renderSlotDisplay('bottom');
  renderSlotDisplay('shoes');
  updateFitSummary();
}

// ---------------------------------------------------------------- Save Outfit Action
async function saveMannequinOutfit() {
  const activeIds = ['hat', 'shirt', 'bottom', 'shoes'];
  if (fitState.slots.outerwear.enabled) activeIds.push('outerwear');
  if (fitState.slots.acc.enabled) activeIds.push('acc');

  const activePieces = activeIds
    .map((id) => fitState.slots[id].item)
    .filter(Boolean);

  if (!activePieces.length) {
    fitState.savedMsg = 'No pieces rolled! Click pieces or roll full drip first.';
    updateFitSummary();
    return;
  }

  const saveBtn = $('#save-fit-btn');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'SAVING FIT...'; }

  try {
    const finalItemIds = [];
    for (const item of activePieces) {
      if (item.isCloset && item.closetId) {
        finalItemIds.push(item.closetId);
      } else if (item.sourceKey) {
        const existing = (state.data.closet || []).find((c) => c.sourceKey === item.sourceKey);
        if (existing) {
          finalItemIds.push(existing.id);
        } else {
          const addRes = await window.api.closetAddProduct(item.sourceKey, item.brand);
          if (addRes && addRes.added) {
            applyCloset(addRes);
            finalItemIds.push(addRes.added);
          }
        }
      }
    }

    const outfitName = 'FIT ' + new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).toUpperCase();
    const outfitRes = await window.api.outfitSave({ name: outfitName, itemIds: finalItemIds });
    applyCloset(outfitRes);
    fitState.savedMsg = `★ SAVED AS "${outfitName}" IN MY CLOSET! ★`;
    playJackpotSound();
  } catch (e) {
    fitState.savedMsg = 'Error saving outfit: ' + (e.message || e);
  } finally {
    updateFitSummary();
  }
}

// ---------------------------------------------------------------- Buy/View Store Modal
function showBuyPiecesModal() {
  const activeIds = ['hat', 'shirt', 'bottom', 'shoes'];
  if (fitState.slots.outerwear.enabled) activeIds.push('outerwear');
  if (fitState.slots.acc.enabled) activeIds.push('acc');

  const storeItems = activeIds
    .map((id) => fitState.slots[id].item)
    .filter((item) => item && !item.isCloset && item.url);

  if (!storeItems.length) return;

  const modal = $('#modal');
  $('#m-title').textContent = 'STORE PIECES IN THIS FIT';
  $('#m-body').innerHTML = `
    <div class="buy-modal-content">
      <p class="sub">Direct links to buy or view the store pieces rolled on your mannequin:</p>
      <div class="buy-items-list">
        ${storeItems.map((p) => `
          <div class="buy-item-row">
            <div class="buy-item-pic">
              ${p.image ? `<img src="${esc(p.image)}" alt="">` : '<div class="noimg">NO PIC</div>'}
            </div>
            <div class="buy-item-info">
              <div class="buy-item-store">${esc(p.brand)}</div>
              <div class="buy-item-title">${esc(p.title)}</div>
              <div class="buy-item-price">${p.price != null ? money(p.price, p.currency) : ''}</div>
            </div>
            <button class="btn primary small buy-link-btn" data-buy-url="${esc(p.url)}">BUY / OPEN STORE &rarr;</button>
          </div>
        `).join('')}
      </div>
    </div>
  `;
  modal.hidden = false;
}

// ---------------------------------------------------------------- Event Binding
function bindMannequinEvents() {
  const container = $('#main');
  if (!container) return;

  container.addEventListener('click', (e) => {
    // 1. Roll Full Drip
    if (e.target.closest('#roll-full-btn')) {
      spinFullFit();
      return;
    }

    // 2. Lock Button on Slot
    const lockBtn = e.target.closest('[data-lock-slot]');
    if (lockBtn) {
      e.stopPropagation();
      const slotId = lockBtn.dataset.lockSlot;
      const slot = fitState.slots[slotId];
      if (slot) {
        slot.locked = !slot.locked;
        playLockSound(slot.locked);
        renderSlotDisplay(slotId);
      }
      return;
    }

    // 2b. Discard / Revert Slot piece back to silhouette
    const clearSlotBtn = e.target.closest('[data-clear-slot]');
    if (clearSlotBtn) {
      e.stopPropagation();
      const slotId = clearSlotBtn.dataset.clearSlot;
      const slot = fitState.slots[slotId];
      if (slot) {
        slot.item = null;
        slot.locked = false;
        playDiscardSound();
        renderSlotDisplay(slotId);
        updateFitSummary();
      }
      return;
    }

    // 3. Click Slot directly to Roll that piece
    const rollSlotEl = e.target.closest('[data-roll-slot]');
    if (rollSlotEl && !e.target.closest('.garment-lock-anchor') && !e.target.closest('.garment-clear-anchor')) {
      rollMannequinSlot(rollSlotEl.dataset.rollSlot);
      return;
    }

    // 4. Source Segmented Pill Switch (All / Closet / Stores / Sale)
    const sourcePill = e.target.closest('[data-source-pill]');
    if (sourcePill) {
      fitState.globalSource = sourcePill.dataset.sourcePill;
      renderSpinner();
      return;
    }

    // 5. Bottoms Switcher (Pants vs Shorts)
    const bottomPill = e.target.closest('[data-bottom-type]');
    if (bottomPill) {
      const type = bottomPill.dataset.bottomType;
      if (fitState.slots.bottom.subtype !== type) {
        fitState.slots.bottom.subtype = type;
        renderSpinner();
        rollMannequinSlot('bottom');
      }
      return;
    }

    // 5b. Reset Entire Fit to Silhouette Cards
    if (e.target.closest('#reset-fit-btn')) {
      for (const k of Object.keys(fitState.slots)) {
        fitState.slots[k].item = null;
        fitState.slots[k].locked = false;
      }
      playDiscardSound();
      renderSpinner();
      return;
    }

    // 6. Lock All / Unlock All
    if (e.target.closest('#lock-all-btn')) {
      for (const k of Object.keys(fitState.slots)) fitState.slots[k].locked = true;
      playLockSound(true);
      renderSpinner();
      return;
    }
    if (e.target.closest('#unlock-all-btn')) {
      for (const k of Object.keys(fitState.slots)) fitState.slots[k].locked = false;
      playLockSound(false);
      renderSpinner();
      return;
    }

    // 7. SFX Toggle
    const sfxBtn = e.target.closest('#sfx-toggle-btn');
    if (sfxBtn) {
      fitState.sfx = !fitState.sfx;
      sfxBtn.textContent = fitState.sfx ? '🔊 SFX: ON' : '🔈 SFX: OFF';
      return;
    }

    // 8. Save Outfit
    if (e.target.closest('#save-fit-btn')) {
      saveMannequinOutfit();
      return;
    }

    // 9. Buy Store Pieces Modal
    if (e.target.closest('#buy-fit-btn')) {
      showBuyPiecesModal();
      return;
    }

    // 10. Open Buy Link from Modal
    const buyLinkBtn = e.target.closest('[data-buy-url]');
    if (buyLinkBtn) {
      window.api.open(buyLinkBtn.dataset.buyUrl);
      return;
    }

    // 11. Toggle Store Filter Drawer
    if (e.target.closest('#toggle-store-filter-btn')) {
      fitState.showStoreDrawer = !fitState.showStoreDrawer;
      fitState.showPriceDrawer = false;
      renderSpinner();
      return;
    }

    // 12. Toggle Price Filter Drawer
    if (e.target.closest('#toggle-price-filter-btn')) {
      fitState.showPriceDrawer = !fitState.showPriceDrawer;
      fitState.showStoreDrawer = false;
      renderSpinner();
      return;
    }

    // 13. Close Store Filter Drawer
    if (e.target.closest('#close-store-drawer-btn')) {
      fitState.showStoreDrawer = false;
      renderSpinner();
      return;
    }

    // 14. Close Price Filter Drawer
    if (e.target.closest('#close-price-drawer-btn')) {
      fitState.showPriceDrawer = false;
      renderSpinner();
      return;
    }

    // 15. Store Filter Mode Toggle (include vs exclude)
    const storeModeBtn = e.target.closest('[data-store-mode]');
    if (storeModeBtn) {
      fitState.storeFilter.mode = storeModeBtn.dataset.storeMode;
      renderSpinner();
      return;
    }

    // 16. Store Chip click
    const storeChip = e.target.closest('[data-store-chip]');
    if (storeChip) {
      const sid = storeChip.dataset.storeChip;
      if (fitState.storeFilter.selected.has(sid)) {
        fitState.storeFilter.selected.delete(sid);
      } else {
        fitState.storeFilter.selected.add(sid);
      }
      renderSpinner();
      return;
    }

    // 17. Store Select All
    if (e.target.closest('#stores-select-all-btn')) {
      for (const s of (state.data.stores || [])) {
        fitState.storeFilter.selected.add(s.id);
      }
      renderSpinner();
      return;
    }

    // 18. Store Clear
    if (e.target.closest('#stores-clear-btn')) {
      fitState.storeFilter.selected.clear();
      renderSpinner();
      return;
    }

    // 19. Price Mode Toggle (none, total, item)
    const priceModeBtn = e.target.closest('[data-price-mode]');
    if (priceModeBtn) {
      fitState.priceFilter.mode = priceModeBtn.dataset.priceMode;
      renderSpinner();
      return;
    }

    // 20. Fit Cap Preset
    const fitCapBtn = e.target.closest('[data-fit-cap]');
    if (fitCapBtn) {
      fitState.priceFilter.totalMax = Number(fitCapBtn.dataset.fitCap);
      fitState.priceFilter.mode = 'total';
      renderSpinner();
      return;
    }

    // 21. Item Cap Preset
    const itemCapBtn = e.target.closest('[data-item-cap]');
    if (itemCapBtn) {
      fitState.priceFilter.itemMax = Number(itemCapBtn.dataset.itemCap);
      fitState.priceFilter.mode = 'item';
      renderSpinner();
      return;
    }

    // 22. Apply Budget Button
    if (e.target.closest('#apply-budget-btn')) {
      if (fitState.priceFilter.mode === 'total') {
        const minEl = $('#fit-min-total');
        const maxEl = $('#fit-max-total');
        fitState.priceFilter.totalMin = minEl && minEl.value ? Number(minEl.value) : null;
        fitState.priceFilter.totalMax = maxEl && maxEl.value ? Number(maxEl.value) : null;
      } else if (fitState.priceFilter.mode === 'item') {
        const minEl = $('#item-min-price');
        const maxEl = $('#item-max-price');
        fitState.priceFilter.itemMin = minEl && minEl.value ? Number(minEl.value) : null;
        fitState.priceFilter.itemMax = maxEl && maxEl.value ? Number(maxEl.value) : null;
      }
      renderSpinner();
      return;
    }

    // 23. Price Clear / Reset
    if (e.target.closest('#price-clear-btn')) {
      fitState.priceFilter.mode = 'none';
      fitState.priceFilter.totalMin = null;
      fitState.priceFilter.totalMax = null;
      fitState.priceFilter.itemMin = null;
      fitState.priceFilter.itemMax = null;
      renderSpinner();
      return;
    }
  });

  // Live input filtering for store search
  container.addEventListener('input', (e) => {
    if (e.target.id === 'store-filter-search') {
      fitState.storeFilter.query = e.target.value;
      const query = e.target.value.trim().toLowerCase();
      const chips = container.querySelectorAll('[data-store-chip]');
      let visibleCount = 0;
      chips.forEach((c) => {
        const name = (c.querySelector('.chip-name') ? c.querySelector('.chip-name').textContent : '').toLowerCase();
        const matches = !query || name.includes(query);
        c.style.display = matches ? 'flex' : 'none';
        if (matches) visibleCount++;
      });
      const hint = container.querySelector('.search-count-hint');
      if (hint) {
        hint.textContent = `${visibleCount} of ${(state.data.stores || []).length} stores (${fitState.storeFilter.selected.size} ${fitState.storeFilter.mode === 'exclude' ? 'excluded' : 'selected'})`;
      }
    }
  });

  // Checkbox Handlers
  container.addEventListener('change', (e) => {
    // Accessories toggle
    if (e.target.id === 'check-acc') {
      fitState.slots.acc.enabled = e.target.checked;
      renderSpinner();
      if (e.target.checked && !fitState.slots.acc.item) rollMannequinSlot('acc');
      return;
    }

    // Outerwear (Jacket/Hoodie) toggle
    if (e.target.id === 'check-outerwear') {
      fitState.slots.outerwear.enabled = e.target.checked;
      renderSpinner();
      if (e.target.checked && !fitState.slots.outerwear.item) rollMannequinSlot('outerwear');
      return;
    }
  });

  // Spacebar triggers Roll Full Drip when spinner tab is active
  window.addEventListener('keydown', (e) => {
    if (state.tab === 'spinner' && e.code === 'Space' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'SELECT' && e.target.tagName !== 'TEXTAREA') {
      e.preventDefault();
      spinFullFit();
    }
  });
}

// Auto-bind once script loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bindMannequinEvents);
} else {
  bindMannequinEvents();
}
