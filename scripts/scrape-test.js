// Standalone check of the scraper: `npm run scrape-test [domain ...]`
const { scrapeStore } = require('../src/scraper');
const { DEFAULT_STORES } = require('../src/stores');

(async () => {
  const only = process.argv.slice(2);
  const stores = DEFAULT_STORES.filter((s) => !only.length || only.includes(s.domain));
  await Promise.all(stores.map(async (store) => {
    const t = Date.now();
    try {
      const { products, newSource } = await scrapeStore(store);
      const count = (f) => products.filter(f).length;
      const cats = {};
      const genders = {};
      for (const p of products) {
        cats[p.category] = (cats[p.category] || 0) + 1;
        genders[p.gender] = (genders[p.gender] || 0) + 1;
      }
      console.log(`\n== ${store.name}: ${products.length} items in ${((Date.now() - t) / 1000).toFixed(1)}s`);
      console.log(`   new: ${count((p) => p.isNew)} (via "${newSource}")  sale: ${count((p) => p.onSale)}  in stock: ${count((p) => p.available)}  with sizes: ${count((p) => p.sizes.length)}  no image: ${count((p) => !p.image)}`);
      console.log('   categories:', JSON.stringify(cats));
      console.log('   gender:', JSON.stringify(genders));
      const s = products[0];
      if (s) console.log('   sample:', s.title, '|', s.price, s.compareAt, '|', s.sizes.map((x) => x.name + (x.inStock ? '' : '-')).join(' '), '|', s.url);
      const other = products.filter((p) => p.category === 'Other').slice(0, 6).map((p) => `${p.title} [${p.rawType}]`);
      if (other.length) console.log('   uncategorised e.g.:', other.join(' ; '));
    } catch (e) {
      console.log(`\n== ${store.name}: FAILED - ${e.message}`);
    }
  }));
})();
