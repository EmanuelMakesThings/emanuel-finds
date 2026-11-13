'use strict';
// "Fit Spinner": Retro slot-machine outfit generator.
// Allows rolling, locking, and mixing pieces across My Closet and Store Drops.

const SPINNER_SLOTS = [
  { id: 'hat', name: 'HAT / CAP', category: 'Hats', icon: '🧢', defaultEnabled: true },
  { id: 'shirt', name: 'TOP / SHIRT', category: 'Tees & Tops', icon: '👕', defaultEnabled: true },
  { id: 'outerwear', name: 'HOODIE / JACKET', category: ['Hoodies & Sweats', 'Jackets'], icon: '🧥', defaultEnabled: true },
  { id: 'pants', name: 'PANTS', category: 'Pants', icon: '👖', defaultEnabled: true },
  { id: 'shorts', name: 'SHORTS', category: 'Shorts', icon: '🩳', defaultEnabled: false },
  { id: 'socks', name: 'SOCKS', category: 'Socks', icon: '🧦', defaultEnabled: false },
  { id: 'shoes', name: 'FOOTWEAR', category: 'Footwear', icon: '👟', defaultEnabled: true },
  { id: 'acc', name: 'ACCESSORIES', category: 'Accessories', icon: '🕶️', defaultEnabled: true },
];

const spinnerState = {
  globalSource: 'all', // 'all' | 'closet' | 'catalog' | 'sale'
  sfx: true,
  isSpinning: false,
  savedMsg: '',
  slots: {},
};

// Initialize slot states
for (const s of SPINNER_SLOTS) {
  spinnerState.slots[s.id] = {
    enabled: s.defaultEnabled,
    locked: false,
    source: 'global',
    item: null,
    spinning: false,
  };
}

// ---------------------------------------------------------------- Sound Effects (Web Audio API)
let spinnerAudioCtx = null;
function getSpinnerAudioCtx() {
  if (!spinnerAudioCtx && (window.AudioContext || window.webkitAudioContext)) {
    spinnerAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (spinnerAudioCtx && spinnerAudioCtx.state === 'suspended') {
    spinnerAudioCtx.resume().catch(() => {});
  }
  return spinnerAudioCtx;
}

function playSpinnerTick() {
  if (!spinnerState.sfx) return;
  try {
    const ctx = getSpinnerAudioCtx();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(520, ctx.currentTime);
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
  if (!spinnerState.sfx) return;
  try {
    const ctx = getSpinnerAudioCtx();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(locked ? 620 : 310, ctx.currentTime);
    gain.gain.setValueAtTime(0.05, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.05);
  } catch (e) {}
}

function playJackpotSound() {
  if (!spinnerState.sfx) return;
  try {
    const ctx = getSpinnerAudioCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
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

// ---------------------------------------------------------------- Item Pooling
function getSlotItemPool(slotDef, slotSourceOverride) {
  const slotSource = slotSourceOverride || (spinnerState.slots[slotDef.id].source === 'global' ? spinnerState.globalSource : spinnerState.slots[slotDef.id].source);
  const pool = [];

  const matchCategory = (cat, title, tags) => {
    const t = (title + ' ' + (tags || []).join(' ')).toLowerCase();
    if (slotDef.id === 'socks') {
      return t.includes('sock');
    }
    if (slotDef.id === 'acc') {
      if (t.includes('sock')) return false;
      return cat === 'Accessories' || cat === 'Other';
    }
    if (Array.isArray(slotDef.category)) {
      return slotDef.category.includes(cat);
    }
    return cat === slotDef.category;
  };

  // 1. My Closet
  if (slotSource === 'all' || slotSource === 'closet') {
    for (const c of (state.data.closet || [])) {
      if (matchCategory(c.category, c.title, [])) {
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
          available: true,
        });
      }
    }
  }

  // 2. Store Catalogue
  if (slotSource === 'all' || slotSource === 'catalog' || slotSource === 'sale') {
    const enabledStores = new Set((state.data.stores || []).filter((s) => s.enabled).map((s) => s.id));
    for (const p of (state.data.products || [])) {
      if (p.gone || !p.available) continue;
      if (!enabledStores.has(p.storeId)) continue;
      if (state.mens && p.gender !== 'men' && p.gender !== 'unisex') continue;
      if (slotSource === 'sale' && !p.onSale) continue;
      if (matchCategory(p.category, p.title, p.tags)) {
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
          available: p.available,
          onSale: p.onSale,
        });
      }
    }
  }

  return pool;
}

// ---------------------------------------------------------------- Roll Logic
function rollSlot(slotId) {
  const slotDef = SPINNER_SLOTS.find((s) => s.id === slotId);
  const slot = spinnerState.slots[slotId];
  if (!slotDef || !slot || !slot.enabled || slot.locked || slot.spinning) return;

  const pool = getSlotItemPool(slotDef);
  if (!pool.length) {
    slot.item = null;
    renderSlotItem(slotId);
    return;
  }

  slot.spinning = true;
  const target = pool[Math.floor(Math.random() * pool.length)];
  const reelEl = $(`#reel-${slotId}`);
  if (reelEl) reelEl.classList.add('spinning');

  let tickCount = 0;
  const maxTicks = 10;
  const interval = setInterval(() => {
    tickCount++;
    const randomPick = pool[Math.floor(Math.random() * pool.length)];
    renderReelPreview(slotId, randomPick);
    playSpinnerTick();

    if (tickCount >= maxTicks) {
      clearInterval(interval);
      slot.item = target;
      slot.spinning = false;
      if (reelEl) reelEl.classList.remove('spinning');
      renderSlotItem(slotId);
      updateSpinnerSummary();
    }
  }, 65);
}

function spinAllSlots() {
  if (spinnerState.isSpinning) return;
  spinnerState.savedMsg = '';
  const toSpin = SPINNER_SLOTS.filter((s) => {
    const slot = spinnerState.slots[s.id];
    return slot.enabled && !slot.locked;
  });

  if (!toSpin.length) return;
  spinnerState.isSpinning = true;
  $('#spin-all-btn').disabled = true;

  let completed = 0;
  toSpin.forEach((s, idx) => {
    const slot = spinnerState.slots[s.id];
    const pool = getSlotItemPool(s);
    if (!pool.length) {
      slot.item = null;
      renderSlotItem(s.id);
      completed++;
      if (completed >= toSpin.length) finishSpinAll();
      return;
    }

    slot.spinning = true;
    const target = pool[Math.floor(Math.random() * pool.length)];
    const reelEl = $(`#reel-${s.id}`);
    if (reelEl) reelEl.classList.add('spinning');

    let tickCount = 0;
    // Stagger stops so each slot reel stops in sequence
    const maxTicks = 8 + idx * 3;
    const interval = setInterval(() => {
      tickCount++;
      const randomPick = pool[Math.floor(Math.random() * pool.length)];
      renderReelPreview(s.id, randomPick);
      playSpinnerTick();

      if (tickCount >= maxTicks) {
        clearInterval(interval);
        slot.item = target;
        slot.spinning = false;
        if (reelEl) reelEl.classList.remove('spinning');
        renderSlotItem(s.id);
        completed++;
        if (completed >= toSpin.length) finishSpinAll();
      }
    }, 65);
  });
}

function finishSpinAll() {
  spinnerState.isSpinning = false;
  const btn = $('#spin-all-btn');
  if (btn) btn.disabled = false;
  playJackpotSound();
  updateSpinnerSummary();
}

// ---------------------------------------------------------------- Rendering
function renderReelPreview(slotId, item) {
  const previewEl = $(`#slot-preview-${slotId}`);
  if (!previewEl) return;
  previewEl.innerHTML = item && item.image
    ? `<img alt="" src="${esc(item.image)}">`
    : '<div class="noimg">SPINNING...</div>';
}

function renderSlotItem(slotId) {
  const slotDef = SPINNER_SLOTS.find((s) => s.id === slotId);
  const slot = spinnerState.slots[slotId];
  const reelEl = $(`#reel-${slotId}`);
  if (!reelEl || !slotDef || !slot) return;

  reelEl.classList.toggle('disabled', !slot.enabled);
  reelEl.classList.toggle('locked', slot.locked);

  const previewEl = $(`#slot-preview-${slotId}`);
  const detailsEl = $(`#slot-details-${slotId}`);
  const lockBtn = $(`#slot-lock-${slotId}`);

  if (lockBtn) {
    lockBtn.innerHTML = slot.locked ? '🔒 LOCKED' : '🔓 LOCK';
    lockBtn.classList.toggle('on', slot.locked);
  }

  const item = slot.item;
  if (!slot.enabled) {
    if (previewEl) previewEl.innerHTML = '<div class="noimg">SLOT<br>OFF</div>';
    if (detailsEl) detailsEl.innerHTML = '<div class="slot-title">SLOT DISABLED</div><div class="slot-meta">Toggle [X] above to enable</div>';
    return;
  }

  if (!item) {
    if (previewEl) previewEl.innerHTML = '<div class="noimg">PRESS<br>ROLL</div>';
    if (detailsEl) detailsEl.innerHTML = '<div class="slot-title">NO ITEM ROLLED</div><div class="slot-meta">Hit Roll or Spin Fit</div>';
    return;
  }

  if (previewEl) {
    previewEl.innerHTML = item.image
      ? `<img alt="" src="${esc(item.image)}">`
      : '<div class="noimg">NO<br>PHOTO</div>';
  }

  const tagBadge = item.isCloset
    ? '<span class="slot-badge owned">★ IN CLOSET</span>'
    : (item.onSale ? '<span class="slot-badge sale">SALE DROP</span>' : '<span class="slot-badge store">STORE DROP</span>');

  const priceText = item.price != null ? money(item.price, item.currency) : '';

  if (detailsEl) {
    detailsEl.innerHTML = `
      <div class="slot-badge-row">${tagBadge}</div>
      <div class="slot-brand">${esc(item.brand)}</div>
      <div class="slot-title" title="${esc(item.title)}">${esc(item.title)}</div>
      <div class="slot-price">${esc(priceText)}</div>
    `;
  }
}

function updateSpinnerSummary() {
  const summaryEl = $('#spinner-summary');
  if (!summaryEl) return;

  const activeItems = SPINNER_SLOTS
    .map((s) => ({ def: s, slot: spinnerState.slots[s.id], item: spinnerState.slots[s.id].item }))
    .filter((x) => x.slot.enabled && x.item);

  if (!activeItems.length) {
    summaryEl.innerHTML = '<div class="spinner-empty-state">Roll the reels to build your fit combination!</div>';
    return;
  }

  let totalCost = 0;
  let ownedCount = 0;
  let storeCount = 0;
  const storeLinks = [];

  for (const { item } of activeItems) {
    if (item.isCloset) {
      ownedCount++;
    } else {
      storeCount++;
      if (item.price != null && isFinite(item.price)) totalCost += item.price;
      if (item.url) storeLinks.push({ title: item.title, brand: item.brand, url: item.url, price: item.price, currency: item.currency });
    }
  }

  const collageHtml = activeItems.map(({ item }) => `
    <div class="summary-thumb" title="${esc(item.brand)}: ${esc(item.title)}">
      ${item.image ? `<img src="${esc(item.image)}" alt="">` : '<div class="noimg">NO PIC</div>'}
      <span class="summary-thumb-tag">${item.isCloset ? 'OWNED' : 'COP'}</span>
    </div>
  `).join('');

  summaryEl.innerHTML = `
    <div class="spinner-summary-box">
      <div class="summary-fit-header">
        <div class="summary-fit-title">CURRENT FIT ROSTER (${activeItems.length} PIECES)</div>
        <div class="summary-fit-cost">
          <span class="cost-stat"><b>${ownedCount}</b> OWNED</span>
          <span class="cost-stat"><b>${storeCount}</b> TO COP</span>
          ${storeCount ? `<span class="cost-stat total">TOTAL TO COP: <b>${formatMoney(totalCost, 'USD')}</b></span>` : ''}
        </div>
      </div>
      <div class="summary-thumbs-row">${collageHtml}</div>
      <div class="summary-actions-row">
        <button id="save-fit-btn" class="btn primary">💾 SAVE OUTFIT TO CLOSET</button>
        ${storeLinks.length ? `<button id="buy-fit-btn" class="btn">🛒 VIEW / BUY STORE PIECES (${storeLinks.length})</button>` : ''}
      </div>
      ${spinnerState.savedMsg ? `<div class="spinner-save-alert">${esc(spinnerState.savedMsg)}</div>` : ''}
    </div>
  `;
}

// ---------------------------------------------------------------- Main Tab Render
function renderSpinner() {
  const container = $('#spinnerview');
  if (!container) return;

  const slotsGridHtml = SPINNER_SLOTS.map((s) => {
    const slot = spinnerState.slots[s.id];
    return `
      <div class="reel-box${slot.enabled ? '' : ' disabled'}${slot.locked ? ' locked' : ''}" id="reel-${s.id}">
        <div class="reel-header">
          <label class="reel-toggle" title="Toggle slot on/off">
            <input type="checkbox" data-slot-toggle="${s.id}" ${slot.enabled ? 'checked' : ''}>
            <span class="reel-icon">${s.icon}</span>
            <span class="reel-name">${s.name}</span>
          </label>
          <select class="reel-source-select" data-slot-source="${s.id}" title="Item source for this reel">
            <option value="global" ${slot.source === 'global' ? 'selected' : ''}>DEFAULT</option>
            <option value="all" ${slot.source === 'all' ? 'selected' : ''}>CLOSET + STORE</option>
            <option value="closet" ${slot.source === 'closet' ? 'selected' : ''}>MY CLOSET</option>
            <option value="catalog" ${slot.source === 'catalog' ? 'selected' : ''}>STORE DROPS</option>
            <option value="sale" ${slot.source === 'sale' ? 'selected' : ''}>ON SALE</option>
          </select>
        </div>
        <div class="reel-viewport" data-reel-click="${s.id}">
          <div class="reel-preview" id="slot-preview-${s.id}"></div>
          <div class="reel-glass-reflection"></div>
        </div>
        <div class="reel-details" id="slot-details-${s.id}"></div>
        <div class="reel-footer">
          <button class="btn small reel-lock-btn${slot.locked ? ' on' : ''}" id="slot-lock-${s.id}" data-slot-lock="${s.id}">
            ${slot.locked ? '🔒 LOCKED' : '🔓 LOCK'}
          </button>
          <button class="btn small primary reel-roll-btn" data-slot-roll="${s.id}" ${slot.locked || !slot.enabled ? 'disabled' : ''}>
            🎲 ROLL
          </button>
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = `
    <div class="spinner-container">
      <div class="spinner-marquee">
        <div class="marquee-title">🎰 FIT SPINNER 3000</div>
        <div class="marquee-sub">RETRO WIN95 FIT RANDOMIZER · SPIN, LOCK REELS &amp; BUILD FRESH ROTATIONS</div>
      </div>

      <div class="spinner-control-panel">
        <button id="spin-all-btn" class="btn primary spin-all-btn">
          🎲 SPIN FIT [SPACE]
        </button>

        <div class="panel-group">
          <label class="panel-label">POOL FROM:</label>
          <select id="global-source-select" class="panel-select">
            <option value="all" ${spinnerState.globalSource === 'all' ? 'selected' : ''}>EVERYWHERE (CLOSET + STORES)</option>
            <option value="closet" ${spinnerState.globalSource === 'closet' ? 'selected' : ''}>MY CLOSET ONLY</option>
            <option value="catalog" ${spinnerState.globalSource === 'catalog' ? 'selected' : ''}>STORE DROPS ONLY</option>
            <option value="sale" ${spinnerState.globalSource === 'sale' ? 'selected' : ''}>ON SALE ONLY</option>
          </select>
        </div>

        <div class="panel-btn-group">
          <button id="lock-all-btn" class="btn small">🔒 LOCK ALL</button>
          <button id="unlock-all-btn" class="btn small">🔓 UNLOCK ALL</button>
          <button id="sfx-toggle-btn" class="btn small">${spinnerState.sfx ? '🔊 SFX: ON' : '🔈 SFX: OFF'}</button>
        </div>
      </div>

      <div class="spinner-reels-grid">${slotsGridHtml}</div>

      <div id="spinner-summary" class="spinner-summary-container"></div>
    </div>
  `;

  // Populate slot previews
  for (const s of SPINNER_SLOTS) {
    renderSlotItem(s.id);
  }
  updateSpinnerSummary();
}

// ---------------------------------------------------------------- Save Outfit Action
async function saveSpinnerOutfit() {
  const activePieces = SPINNER_SLOTS
    .map((s) => ({ def: s, item: spinnerState.slots[s.id].item, enabled: spinnerState.slots[s.id].enabled }))
    .filter((x) => x.enabled && x.item);

  if (!activePieces.length) {
    spinnerState.savedMsg = 'No pieces rolled to save! Hit Spin Fit first.';
    updateSpinnerSummary();
    return;
  }

  const saveBtn = $('#save-fit-btn');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'SAVING FIT...'; }

  try {
    const finalItemIds = [];
    for (const { item } of activePieces) {
      if (item.isCloset && item.closetId) {
        finalItemIds.push(item.closetId);
      } else if (item.sourceKey) {
        // Check if item is already in closet snapshots
        const existing = (state.data.closet || []).find((c) => c.sourceKey === item.sourceKey);
        if (existing) {
          finalItemIds.push(existing.id);
        } else {
          // Add to closet snapshot permanently
          const addRes = await window.api.closetAddProduct(item.sourceKey, item.brand);
          if (addRes && addRes.added) {
            applyCloset(addRes);
            finalItemIds.push(addRes.added);
          }
        }
      }
    }

    const outfitName = 'FIT ROLL ' + new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).toUpperCase();
    const outfitRes = await window.api.outfitSave({ name: outfitName, itemIds: finalItemIds });
    applyCloset(outfitRes);
    spinnerState.savedMsg = `★ OUTFIT SAVED AS "${outfitName}" IN MY CLOSET! ★`;
    playJackpotSound();
  } catch (e) {
    spinnerState.savedMsg = 'Error saving outfit: ' + (e.message || e);
  } finally {
    updateSpinnerSummary();
  }
}

// ---------------------------------------------------------------- Buy/View Store Modal
function showBuyPiecesModal() {
  const storeItems = SPINNER_SLOTS
    .map((s) => spinnerState.slots[s.id].item)
    .filter((item) => item && !item.isCloset && item.url);

  if (!storeItems.length) return;

  const modal = $('#modal');
  $('#m-title').textContent = 'STORE PIECES IN THIS FIT';
  $('#m-body').innerHTML = `
    <div class="buy-modal-content">
      <p class="sub">Direct links to buy or view the store pieces rolled in your fit:</p>
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
function bindSpinnerEvents() {
  const container = $('#main');
  if (!container) return;

  container.addEventListener('click', (e) => {
    // 1. Spin All
    if (e.target.closest('#spin-all-btn')) {
      spinAllSlots();
      return;
    }

    // 2. Individual Slot Roll
    const rollBtn = e.target.closest('[data-slot-roll]');
    if (rollBtn) {
      rollSlot(rollBtn.dataset.slotRoll);
      return;
    }

    // 3. Individual Slot Lock
    const lockBtn = e.target.closest('[data-slot-lock]');
    if (lockBtn) {
      const slotId = lockBtn.dataset.slotLock;
      const slot = spinnerState.slots[slotId];
      if (slot) {
        slot.locked = !slot.locked;
        playLockSound(slot.locked);
        renderSlotItem(slotId);
      }
      return;
    }

    // 4. Lock All / Unlock All
    if (e.target.closest('#lock-all-btn')) {
      for (const s of SPINNER_SLOTS) spinnerState.slots[s.id].locked = true;
      playLockSound(true);
      for (const s of SPINNER_SLOTS) renderSlotItem(s.id);
      return;
    }
    if (e.target.closest('#unlock-all-btn')) {
      for (const s of SPINNER_SLOTS) spinnerState.slots[s.id].locked = false;
      playLockSound(false);
      for (const s of SPINNER_SLOTS) renderSlotItem(s.id);
      return;
    }

    // 5. SFX Toggle
    const sfxBtn = e.target.closest('#sfx-toggle-btn');
    if (sfxBtn) {
      spinnerState.sfx = !spinnerState.sfx;
      sfxBtn.textContent = spinnerState.sfx ? '🔊 SFX: ON' : '🔈 SFX: OFF';
      return;
    }

    // 6. Save Outfit
    if (e.target.closest('#save-fit-btn')) {
      saveSpinnerOutfit();
      return;
    }

    // 7. Buy Store Pieces
    if (e.target.closest('#buy-fit-btn')) {
      showBuyPiecesModal();
      return;
    }

    // 8. Open Buy Link from Modal
    const buyLinkBtn = e.target.closest('[data-buy-url]');
    if (buyLinkBtn) {
      window.api.open(buyLinkBtn.dataset.buyUrl);
      return;
    }

    // 9. Clicking reel viewport re-rolls that slot if not locked
    const reelClick = e.target.closest('[data-reel-click]');
    if (reelClick && !e.target.closest('.reel-footer') && !e.target.closest('.reel-header')) {
      const slotId = reelClick.dataset.reelClick;
      const slot = spinnerState.slots[slotId];
      if (slot && slot.enabled && !slot.locked) {
        rollSlot(slotId);
      }
    }
  });

  // Checkbox & Select Change Handlers
  container.addEventListener('change', (e) => {
    // Slot Enabled Toggle
    const toggle = e.target.closest('[data-slot-toggle]');
    if (toggle) {
      const slotId = toggle.dataset.slotToggle;
      const slot = spinnerState.slots[slotId];
      if (slot) {
        slot.enabled = toggle.checked;
        renderSlotItem(slotId);
        updateSpinnerSummary();
      }
      return;
    }

    // Slot-Specific Source
    const slotSource = e.target.closest('[data-slot-source]');
    if (slotSource) {
      const slotId = slotSource.dataset.slotSource;
      const slot = spinnerState.slots[slotId];
      if (slot) {
        slot.source = slotSource.value;
      }
      return;
    }

    // Global Source
    if (e.target.id === 'global-source-select') {
      spinnerState.globalSource = e.target.value;
    }
  });

  // Spacebar triggers Spin All when spinner tab is active
  window.addEventListener('keydown', (e) => {
    if (state.tab === 'spinner' && e.code === 'Space' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'SELECT' && e.target.tagName !== 'TEXTAREA') {
      e.preventDefault();
      spinAllSlots();
    }
  });
}

// Auto-bind once script loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bindSpinnerEvents);
} else {
  bindSpinnerEvents();
}
