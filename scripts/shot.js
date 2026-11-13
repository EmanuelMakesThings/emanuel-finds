// Dev-only smoke test: run with CF_SHOT=<output dir>. Drives the real app
// through each tab and saves screenshots. Not included in the packaged exe.
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

module.exports = (win) => {
  const out = process.env.CF_SHOT;
  fs.mkdirSync(out, { recursive: true });
  const wc = win.webContents;
  const js = (code) => wc.executeJavaScript(code, true);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = async (name) => {
    const image = await wc.capturePage();
    fs.writeFileSync(path.join(out, name + '.png'), image.toPNG());
  };
  const logs = [];
  wc.on('console-message', (_e, level, message, line, source) => {
    if (level >= 2) logs.push(`[${level}] ${message} (${source}:${line})`);
  });

  wc.once('did-finish-load', async () => {
    try {
      await wait(700);
      await shot('00-boot');
      // First run refreshes automatically; wait for the OK button.
      for (let i = 0; i < 400; i++) {
        await wait(1000);
        const st = await js(`({ prog: !document.querySelector('#progress').hidden, ok: !document.querySelector('#pg-ok').hidden, boot: !document.querySelector('#boot').hidden })`);
        if (i === 6 && st.prog) await shot('01-progress');
        if (!st.boot && (!st.prog || st.ok)) break;
      }
      await shot('02-done');
      const summary = await js(`document.querySelector('#pg-text').textContent`);
      await js(`document.querySelector('#pg-ok').click()`);
      for (const tab of ['catalog', 'new', 'sale', 'drops', 'favs', 'stores']) {
        await js(`document.querySelector('[data-tab="${tab}"]').click()`);
        await wait(2500);
        await shot('10-' + tab);
      }
      await js(`document.querySelector('[data-tab="catalog"]').click()`);
      await wait(500);
      await js(`document.querySelector('.heart').click()`);
      await js(`document.querySelector('.card').click()`);
      await wait(2500);
      await shot('20-detail');
      const info = await js(`({
        tabs: [...document.querySelectorAll('.tab')].map(t => t.textContent),
        cards: document.querySelectorAll('.card').length,
        broken: document.querySelectorAll('#grid .noimg').length,
        status: document.querySelector('#st-refresh').textContent,
        hscroll: document.documentElement.scrollWidth > innerWidth,
      })`);
      fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ summary, info, logs }, null, 2));
    } catch (e) {
      fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ error: String(e && e.stack || e), logs }, null, 2));
    }
    app.quit();
  });
};
