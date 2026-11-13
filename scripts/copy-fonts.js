// Copies the pixel fonts out of node_modules so the app is fully offline.
const fs = require('fs');
const path = require('path');

const out = path.join(__dirname, '..', 'renderer', 'fonts');
fs.mkdirSync(out, { recursive: true });

const fonts = [
  ['@fontsource/vt323/files/vt323-latin-400-normal.woff2', 'vt323.woff2'],
  ['@fontsource/press-start-2p/files/press-start-2p-latin-400-normal.woff2', 'press-start-2p.woff2'],
];

for (const [src, dest] of fonts) {
  const from = path.join(__dirname, '..', 'node_modules', src);
  fs.copyFileSync(from, path.join(out, dest));
  console.log('copied', dest);
}
