// The built-in store list. More can be added from the STORES tab in the app.
const DEFAULT_STORES = [
  { domain: 'weareunitus.com', name: 'Unitus' },
  { domain: 'cxxiiapparel.com', name: 'CXXII Apparel' },
  { domain: 'true-myth.com', name: 'True Myth' },
  { domain: 'almightyaboveall.com', name: 'Almighty Above All' },
  { domain: 'godskingdomclothing.com', name: "God's Kingdom" },
  { domain: '2819store.com', name: '2819' },
  { domain: 'scarybutbeautiful.com', name: 'Scary But Beautiful' },
  { domain: 'artofhomage.com', name: 'Art of Homage' },
  { domain: 'godthefatherapparel.com', name: 'God The Father' },
  { domain: 'notwrld.com', name: 'Not of the World' },
  { domain: 'faithbaseddistrict.com', name: 'Faith Based District' },
].map((s) => ({ id: s.domain, enabled: true, ...s }));

module.exports = { DEFAULT_STORES };
