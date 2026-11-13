// Dev-only end-to-end test of My Closet: run with CF_SHOT=<dir> CF_SHOT_MODE=closet.
// Adds items every way the app supports, builds an outfit, then removes a
// store to prove closet items outlive the catalogue. Use a scratch data folder.
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

module.exports = (win) => {
  const out = process.env.CF_SHOT;
  fs.mkdirSync(out, { recursive: true });
  const wc = win.webContents;
  const js = (code) => wc.executeJavaScript(code, true);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = async (name) => fs.writeFileSync(path.join(out, name + '.png'), (await wc.capturePage()).toPNG());
  const until = async (code, secs = 60) => { for (let i = 0; i < secs * 4; i++) { if (await js(code)) return true; await wait(250); } return false; };
  const logs = [];
  const checks = {};
  wc.on('console-message', (_e, level, message, line, source) => { if (level >= 2) logs.push(`[${level}] ${message} (${source}:${line})`); });

  const addLink = async (url) => {
    await js(`document.querySelector('#c-url').value = ${JSON.stringify(url)}; document.querySelector('#c-add-url').click()`);
    await wait(300);
    await until(`!closetUi.busy`, 60);
    await wait(400);
    return js(`({ msg: closetUi.msg, form: !document.querySelector('#modal').hidden, n: state.data.closet.length })`);
  };

  wc.once('did-finish-load', async () => {
    try {
      await until(`document.querySelector('#boot').hidden`, 20);
      await wait(1500);
      // A fresh data folder refreshes itself first.
      if (await js(`!document.querySelector('#progress').hidden`)) {
        await until(`!document.querySelector('#pg-ok').hidden`, 400);
        await js(`document.querySelector('#pg-ok').click()`);
      }
      await js(`document.querySelector('[data-tab="closet"]').click()`);
      await wait(600);
      await shot('c0-empty');

      checks.shopifyLink = await addLink('https://2819store.com/products/preach-the-word-1-2-zip-pine-cream?utm_source=test');
      checks.genericLink = await addLink('https://www.uniqlo.com/us/en/products/E455365-000/00');
      checks.duplicate = await addLink('https://2819store.com/products/preach-the-word-1-2-zip-pine-cream');
      checks.amazonLink = await addLink('https://www.amazon.com/Hanes-EcoSmart-Hooded-Sweatshirt-Black/dp/B00JUM4CT4/ref=sr_1_1');
      await shot('c1-amazon-form');
      if (checks.amazonLink.form) {
        // Finish the blocked-site form by pasting a picture address.
        await js(`document.querySelector('#cf-imgurl').value = 'https://cdn.shopify.com/s/files/1/0370/8203/8412/files/ptw_halfzip_42.jpg?v=1761587519'; document.querySelector('#cf-save').click()`);
        await until(`document.querySelector('#modal').hidden`, 40);
      }

      // A photo straight from the device (tiny generated picture stands in).
      checks.byHand = await js(`(async () => {
        const c = document.createElement('canvas'); c.width = 300; c.height = 380;
        const g = c.getContext('2d'); g.fillStyle = '#2255aa'; g.fillRect(0, 0, 300, 380); g.fillStyle = '#fff'; g.font = '28px sans-serif'; g.fillText('MY OWN TEE', 50, 190);
        const r = applyCloset(await window.api.closetSave({ title: 'Old band tee (no link)', brand: 'Thrifted', category: 'Tees & Tops', notes: 'size L', imageData: c.toDataURL('image/jpeg', .8) }));
        closetRefresh(''); return { error: r.error || null, noPhoto: !!r.noPhoto, n: state.data.closet.length };
      })()`);

      // From the catalogue.
      await js(`document.querySelector('[data-tab="catalog"]').click()`);
      await wait(800);
      await js(`document.querySelector('#grid .card').click()`);
      await wait(800);
      await js(`document.querySelector('#d-closet').click()`);
      await until(`/CLOSET/.test(document.querySelector('#d-closet').textContent) && document.querySelector('#d-closet').disabled`, 40);
      checks.fromCatalogue = await js(`({ label: document.querySelector('#d-closet').textContent, n: state.data.closet.length })`);
      await shot('c2-catalogue-detail');
      await js(`closeDetail(); document.querySelector('[data-tab="closet"]').click()`);
      await wait(2500);
      await shot('c3-items');

      await js(`document.querySelector('[data-citem]').click()`);
      await wait(1200);
      await shot('c4-item-form');
      await js(`closeDetail()`);

      // Build an outfit from three pieces.
      await js(`document.querySelector('[data-sub="outfits"]').click()`);
      await wait(300);
      await js(`document.querySelector('#o-new').click()`);
      await wait(500);
      await js(`document.querySelector('#of-name').value = 'Sunday fit'; [...document.querySelectorAll('[data-pick]')].slice(0, 3).forEach((b) => b.click())`);
      await wait(1200);
      await shot('c5-outfit-builder');
      await js(`document.querySelector('#of-save').click()`);
      await until(`document.querySelector('#modal').hidden`, 10);
      await wait(1500);
      await shot('c6-outfits');
      checks.outfit = await js(`({ outfits: state.data.outfits.length, pieces: state.data.outfits[0] && state.data.outfits[0].itemIds.length })`);

      // The point of the feature: remove the store the catalogue item came
      // from. Its products vanish from the catalogue; the closet copy must not.
      checks.survivesRemoval = await js(`(async () => {
        const owned = state.data.closet.find((c) => c.sourceKey);
        const storeId = owned.sourceKey.split(':')[0];
        const before = state.data.products.filter((p) => p.storeId === storeId).length;
        setData(await window.api.removeStore(storeId));
        render(false);
        const still = state.data.closet.find((c) => c.id === owned.id);
        return { storeRemoved: storeId, catalogueBefore: before, catalogueAfter: state.data.products.filter((p) => p.storeId === storeId).length,
          closetItemKept: !!still, hasPhotoFile: !!(still && still.photo), outfitStillHasIt: state.data.outfits[0].itemIds.includes(owned.id) };
      })()`);
      await js(`document.querySelector('[data-sub="items"]').click()`);
      await wait(2000);
      checks.photosRender = await js(`(() => { const imgs = [...document.querySelectorAll('#closetview .card img')]; return { cards: document.querySelectorAll('#closetview .card').length, imgs: imgs.length, loaded: imgs.filter((i) => i.complete && i.naturalWidth > 0).length }; })()`);
      checks.photoFilesOnDisk = fs.readdirSync(path.join(process.env.CLOTHESFINDER_DATA, 'closet')).length;

      // Phone layout check (emulated): narrow window + the phone's style class.
      win.setMinimumSize(300, 300);
      win.setSize(430, 900);
      await js(`document.body.classList.add('mobile')`);
      await wait(1200);
      await shot('c7-phone-items');
      await js(`document.querySelector('[data-sub="outfits"]').click()`);
      await wait(600);
      await js(`document.querySelector('[data-outfit]').click()`);
      await wait(1000);
      await shot('c8-phone-outfit');

      fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ checks, logs }, null, 2));
    } catch (e) {
      fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ error: String((e && e.stack) || e), checks, logs }, null, 2));
    }
    app.quit();
  });
};
