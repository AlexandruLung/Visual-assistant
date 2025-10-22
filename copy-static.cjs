// Simple copy script to move static assets into dist for loading the extension
// Usage: node copy-static.cjs
const fs = require('fs');
const path = require('path');

const root = __dirname;
const src = path.join(root, 'src');
const dist = path.join(root, 'dist');

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function copyFile(rel) {
  const from = path.join(src, rel);
  const to = path.join(dist, rel);
  ensureDir(path.dirname(to));
  fs.copyFileSync(from, to);
}

function copyDir(rel) {
  const from = path.join(src, rel);
  const to = path.join(dist, rel);
  ensureDir(to);
  for (const entry of fs.readdirSync(from)) {
    const s = path.join(rel, entry);
    const stat = fs.statSync(path.join(src, s));
    if (stat.isDirectory()) copyDir(s);
    else copyFile(s);
  }
}

ensureDir(dist);
copyFile('manifest.json');
copyFile('popup.html');
copyDir('ui');
console.log('Copied static assets to dist');

