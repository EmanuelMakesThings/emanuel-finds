'use strict';
// "My Closet" screens: owned items and outfits. Loaded before app.js and uses
// its helpers ($, esc, state, CAT_ORDER, money) at call time.

const closetUi = { sub: 'items', msg: '', busy: false, editing: null, outfit: null };

const closetImg = (name) => (window.api.closetImg ? window.api.closetImg(name) : 'cfimg://closet/?f=' + encodeURIComponent(name));
const closetPic = (item) => (item && item.photo
  ? `<img loading="lazy" decoding="async" alt="" src="${esc(closetImg(item.photo))}">`
  : '<div class="noimg">NO<br>PHOTO</div>');

function applyCloset(res) {
  if (res && res.closet) { state.data.closet = res.closet; state.data.outfits = res.outfits; }
  return res || {};
}

// ---------------------------------------------------------------- main view

function renderCloset() {
  const items = state.data.closet;
  const outfits = state.data.outfits;
  const byId = new Map(items.map((c) => [c.id, c]));
  let body;

  if (closetUi.sub === 'items') {
    const grid = items.length
      ? '<div class="cgrid">' + items.map((c) => `<div class="card" tabindex="0" role="button" data-citem="${esc(c.id)}">
          <div class="pic">${closetPic(c)}</div>
          <div class="info"><div class="store">${esc(c.brand || 'MY CLOSET')}</div><div class="title">${esc(c.title)}</div><div class="ccat">${esc(c.category)}</div></div>
        </div>`).join('') + '</div>'
      : '<div class="empty"><h2>CLOSET IS EMPTY</h2><p>Paste a product link above, add something by hand,<br>or open any item in the catalogue and press ADD TO CLOSET.</p></div>';
    body = `
      <div class="addrow">
        <input id="c-url" type="text" placeholder="paste a product link (any shop)" spellcheck="false" autocomplete="off">
        <button id="c-add-url" class="btn primary"${closetUi.busy ? ' disabled' : ''}>${closetUi.busy ? 'READING...' : 'ADD FROM LINK'}</button>
        <button id="c-add-manual" class="btn">ADD BY HAND</button>
      </div>
      <p id="c-msg">${esc(closetUi.msg)}</p>
      ${grid}`;
  } else {
    const grid = outfits.length
      ? '<div class="cgrid">' + outfits.map((o) => {
        const pieces = o.itemIds.map((id) => byId.get(id)).filter(Boolean);
        const cells = pieces.slice(0, 4).map((c) => `<div>${closetPic(c)}</div>`).join('');
        return `<div class="card" tabindex="0" role="button" data-outfit="${esc(o.id)}">
          <div class="pic collage n${Math.min(pieces.length, 4)}">${cells || '<div class="noimg">EMPTY</div>'}</div>
          <div class="info"><div class="store">OUTFIT</div><div class="title">${esc(o.name)}</div><div class="ccat">${pieces.length} piece${pieces.length === 1 ? '' : 's'}</div></div>
        </div>`;
      }).join('') + '</div>'
      : `<div class="empty"><h2>NO OUTFITS YET</h2><p>${items.length ? 'Press NEW OUTFIT and pick pieces from your closet.' : 'Add some clothes to your closet first, then build outfits from them.'}</p></div>`;
    body = `<div class="addrow"><button id="o-new" class="btn primary"${items.length ? '' : ' disabled'}>+ NEW OUTFIT</button></div><p id="c-msg">${esc(closetUi.msg)}</p>${grid}`;
  }

  $('#closetview').innerHTML = `
    <div class="subtabs">
      <button class="btn${closetUi.sub === 'items' ? ' on' : ''}" data-sub="items">ITEMS (${items.length})</button>
      <button class="btn${closetUi.sub === 'outfits' ? ' on' : ''}" data-sub="outfits">OUTFITS (${outfits.length})</button>
    </div>${body}`;
}

function closetRefresh(msg) {
  closetUi.msg = msg || '';
  renderTabs();
  if (state.tab === 'closet') renderCloset();
}

// ---------------------------------------------------------------- photos

// Shrink a picked photo so a 12-megapixel camera shot is not stored whole.
function readPhoto(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(1, 1000 / Math.max(image.width, image.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(image.width * scale);
      canvas.height = Math.round(image.height * scale);
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.86));
    };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not a picture.')); };
    image.src = url;
  });
}

// ---------------------------------------------------------------- item form

// `item` = existing closet item to edit, or null to add; `prefill` seeds a new one.
function openClosetForm(item, prefill, note) {
  const v = item || prefill || {};
  closetUi.editing = { id: item ? item.id : null, imageData: null };
  const outfits = item ? state.data.outfits.filter((o) => o.itemIds.includes(item.id)) : [];
  const cats = CAT_ORDER.map((c) => `<option${(v.category || 'Other') === c ? ' selected' : ''}>${esc(c)}</option>`).join('');
  $('#m-title').textContent = item ? 'CLOSET ITEM' : 'ADD TO CLOSET';
  $('#m-body').innerHTML = `<div class="detail">
    <div>
      <div class="d-pic" id="cf-pic">${item ? closetPic(item) : (v.image ? `<img alt="" src="${esc(img(v.image))}">` : '<div class="noimg">NO<br>PHOTO</div>')}</div>
      <div class="d-sec">PHOTO</div>
      <input id="cf-file" type="file" accept="image/*">
      <input id="cf-imgurl" type="text" placeholder="...or paste a picture's web address" spellcheck="false" value="${esc(!item && v.image ? v.image : '')}">
    </div>
    <div class="d-info form">
      ${note ? `<div class="note">${esc(note)}</div>` : ''}
      <label>NAME<input id="cf-title" type="text" maxlength="200" value="${esc(v.title || '')}"></label>
      <label>BRAND / STORE<input id="cf-brand" type="text" maxlength="80" value="${esc(v.brand || '')}"></label>
      <label>CATEGORY<select id="cf-cat">${cats}</select></label>
      <label>LINK (OPTIONAL)<input id="cf-url" type="text" spellcheck="false" value="${esc(v.url || '')}"></label>
      <label>NOTES<textarea id="cf-notes" maxlength="1000" rows="3" placeholder="size, fit, where you wear it...">${esc(v.notes || '')}</textarea></label>
      ${item ? `<div class="d-sec">SAVED ${esc(fmtDate(item.addedAt).split(' ').slice(0, 3).join(' '))}${item.price ? ' · ' + money(item.price, item.currency) + ' AT THE TIME' : ''}</div>` : ''}
      ${outfits.length ? `<div class="d-sec">IN OUTFITS</div><div>${outfits.map((o) => esc(o.name)).join(', ')}</div>` : ''}
      <p id="cf-msg" class="formmsg"></p>
      <div class="d-actions">
        <button class="btn primary" id="cf-save">${item ? 'SAVE CHANGES' : 'ADD TO CLOSET'}</button>
        ${item && item.url ? '<button class="btn" id="cf-open">OPEN LINK</button>' : ''}
        ${item ? '<button class="btn danger" id="cf-remove">REMOVE</button>' : ''}
      </div>
    </div>
  </div>`;
  $('#modal').hidden = false;
  if (!item) $('#cf-title').focus();
}

async function saveClosetForm() {
  const e = closetUi.editing;
  const btn = $('#cf-save');
  btn.disabled = true;
  btn.textContent = 'SAVING...';
  const res = applyCloset(await window.api.closetSave({
    id: e.id,
    title: $('#cf-title').value,
    brand: $('#cf-brand').value,
    category: $('#cf-cat').value,
    url: $('#cf-url').value.trim(),
    notes: $('#cf-notes').value,
    imageData: e.imageData,
    imageUrl: e.imageData ? '' : $('#cf-imgurl').value.trim(),
  }));
  if (res.error) {
    $('#cf-msg').textContent = res.error;
    btn.disabled = false;
    btn.textContent = e.id ? 'SAVE CHANGES' : 'ADD TO CLOSET';
    return;
  }
  closeDetail();
  closetUi.sub = 'items';
  closetRefresh(res.noPhoto ? 'Saved, but the photo could not be downloaded. Open the item to add one.' : 'Saved to your closet.');
}

// ---------------------------------------------------------------- outfit builder

function openOutfit(outfit) {
  closetUi.outfit = { id: outfit ? outfit.id : null, picked: new Set(outfit ? outfit.itemIds : []) };
  const items = [...state.data.closet].sort((a, b) => CAT_ORDER.indexOf(a.category) - CAT_ORDER.indexOf(b.category));
  $('#m-title').textContent = outfit ? 'EDIT OUTFIT' : 'NEW OUTFIT';
  $('#m-body').innerHTML = `<div class="form outfitform">
    <label>OUTFIT NAME<input id="of-name" type="text" maxlength="80" placeholder="Sunday fit, gym, date night..." value="${esc(outfit ? outfit.name : '')}"></label>
    <label>NOTES<textarea id="of-notes" maxlength="1000" rows="2" placeholder="optional">${esc(outfit ? outfit.notes : '')}</textarea></label>
    <div class="d-sec" id="of-count"></div>
    <div class="pickgrid">${items.map((c) => `<button class="pick${closetUi.outfit.picked.has(c.id) ? ' on' : ''}" data-pick="${esc(c.id)}" title="${esc(c.title)}">
      <span class="pic">${closetPic(c)}</span><span class="pname">${esc(c.title)}</span></button>`).join('')}</div>
    <p id="of-msg" class="formmsg"></p>
    <div class="d-actions">
      <button class="btn primary" id="of-save">SAVE OUTFIT</button>
      ${outfit ? '<button class="btn danger" id="of-remove">DELETE OUTFIT</button>' : ''}
    </div>
  </div>`;
  outfitCount();
  $('#modal').hidden = false;
  if (!outfit) $('#of-name').focus();
}

function outfitCount() {
  const n = closetUi.outfit.picked.size;
  $('#of-count').textContent = `TAP TO PICK PIECES · ${n} PICKED`;
}

// ---------------------------------------------------------------- events

// A destructive button must be pressed twice.
function armed(btn, label) {
  if (btn.dataset.armed) return true;
  btn.dataset.armed = '1';
  btn.textContent = label;
  return false;
}

async function closetAddFromLink() {
  const input = $('#c-url');
  const url = input.value.trim();
  if (!url || closetUi.busy) return;
  closetUi.busy = true;
  closetUi.msg = 'Reading that page...';
  renderCloset();
  $('#c-url').value = url;
  let res;
  try { res = applyCloset(await window.api.closetAddUrl(url)); } catch (err) { res = { error: 'Could not read that link. Are you offline?' }; }
  closetUi.busy = false;
  if (res.needsDetails) {
    closetRefresh('');
    return openClosetForm(null, res.prefill, 'This site would not let the app read the page (Amazon and some big shops block that). The link is saved below. Check the name and add a photo, then press ADD TO CLOSET.');
  }
  if (res.error) { closetRefresh(res.error); $('#c-url').value = url; return; }
  closetRefresh(res.noPhoto ? 'Added, but the photo could not be downloaded. Open the item to add one.' : 'Added to your closet. The details and photo are saved for good.');
}

function bindCloset() {
  const view = $('#closetview');
  view.addEventListener('click', (e) => {
    const t = e.target;
    const sub = t.closest('[data-sub]');
    if (sub) { closetUi.sub = sub.dataset.sub; closetUi.msg = ''; return renderCloset(); }
    if (t.id === 'c-add-url') return closetAddFromLink();
    if (t.id === 'c-add-manual') return openClosetForm(null, null);
    if (t.id === 'o-new') return openOutfit(null);
    const card = t.closest('[data-citem]');
    if (card) return openClosetForm(state.data.closet.find((c) => c.id === card.dataset.citem));
    const oc = t.closest('[data-outfit]');
    if (oc) return openOutfit(state.data.outfits.find((o) => o.id === oc.dataset.outfit));
  });
  view.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.id === 'c-url') return closetAddFromLink();
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('card')) { e.preventDefault(); e.target.click(); }
  });

  const modal = $('#modal');
  modal.addEventListener('change', async (e) => {
    if (e.target.id !== 'cf-file' || !e.target.files[0]) return;
    try {
      closetUi.editing.imageData = await readPhoto(e.target.files[0]);
      $('#cf-pic').innerHTML = `<img alt="" src="${closetUi.editing.imageData}">`;
      $('#cf-imgurl').value = '';
      $('#cf-msg').textContent = '';
    } catch (err) {
      $('#cf-msg').textContent = err.message;
    }
  });
  modal.addEventListener('click', async (e) => {
    const t = e.target;
    if (t.id === 'cf-save') return saveClosetForm();
    if (t.id === 'cf-open') {
      const item = state.data.closet.find((c) => c.id === closetUi.editing.id);
      if (item) window.api.open(item.url);
      return;
    }
    if (t.id === 'cf-remove') {
      if (!armed(t, 'SURE? PRESS AGAIN')) return;
      applyCloset(await window.api.closetRemove(closetUi.editing.id));
      closeDetail();
      return closetRefresh('Removed from your closet.');
    }
    const pick = t.closest('[data-pick]');
    if (pick) {
      const id = pick.dataset.pick;
      const set = closetUi.outfit.picked;
      if (set.has(id)) set.delete(id); else set.add(id);
      pick.classList.toggle('on', set.has(id));
      return outfitCount();
    }
    if (t.id === 'of-save') {
      const res = applyCloset(await window.api.outfitSave({
        id: closetUi.outfit.id, name: $('#of-name').value, notes: $('#of-notes').value, itemIds: [...closetUi.outfit.picked],
      }));
      if (res.error) { $('#of-msg').textContent = res.error; return; }
      closeDetail();
      closetUi.sub = 'outfits';
      return closetRefresh('Outfit saved.');
    }
    if (t.id === 'of-remove') {
      if (!armed(t, 'SURE? PRESS AGAIN')) return;
      applyCloset(await window.api.outfitRemove(closetUi.outfit.id));
      closeDetail();
      return closetRefresh('Outfit deleted.');
    }
    // "Add to closet" from a catalogue item's detail window.
    if (t.id === 'd-closet' && !t.disabled) {
      t.disabled = true;
      t.textContent = 'SAVING...';
      const res = applyCloset(await window.api.closetAddProduct(detailKey));
      t.textContent = res.error ? res.error.toUpperCase() : '✓ IN YOUR CLOSET';
      renderTabs();
    }
  });
}
