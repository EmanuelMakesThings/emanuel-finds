// Builds the phone's web bundle into ./www from the shared desktop interface.
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const root = path.join(__dirname, '..');
const www = path.join(__dirname, 'www');
fs.rmSync(www, { recursive: true, force: true });
fs.mkdirSync(path.join(www, 'fonts'), { recursive: true });

for (const f of ['style.css', 'app.js', 'closet-ui.js', 'jsqr.js']) fs.copyFileSync(path.join(root, 'renderer', f), path.join(www, f));
for (const f of fs.readdirSync(path.join(root, 'renderer', 'fonts'))) {
  fs.copyFileSync(path.join(root, 'renderer', 'fonts', f), path.join(www, 'fonts', f));
}

// Same page as the desktop, minus the desktop-only security header (the
// Android shell injects its own bridge script) and plus the phone API bundle.
let html = fs.readFileSync(path.join(root, 'renderer', 'index.html'), 'utf8');
html = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>\s*/, '');
html = html.replace('<script src="app.js"></script>', '<script src="api.js"></script>\n<script src="app.js"></script>');
if (!html.includes('api.js')) throw new Error('could not add api.js to index.html');
fs.writeFileSync(path.join(www, 'index.html'), html);

esbuild.buildSync({
  entryPoints: [path.join(__dirname, 'src', 'api.js')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome110',
  external: ['fs', 'path'],
  outfile: path.join(www, 'api.js'),
  logLevel: 'warning',
});
console.log('www built:', fs.readdirSync(www).join(', '));
