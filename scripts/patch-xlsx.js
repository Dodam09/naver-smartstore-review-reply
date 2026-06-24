const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'lib', 'xlsx.full.min.js');
let source = fs.readFileSync(target, 'utf8');

const oldFn =
  'function Ie(e,r){if(e){if(typeof console!=="undefined")console.error(r)}else throw new Error(r)}';
const newFn =
  'function Ie(e,r){var m=r&&String(r);if(m&&m.indexOf("Bad uncompressed size")>=0)return;if(m&&m.indexOf("Bad compressed size")>=0)return;if(e){if(typeof console!=="undefined")console.error(r)}else throw new Error(r)}';

if (!source.includes(oldFn)) {
  console.error('SheetJS Ie() pattern not found — already patched or library changed.');
  process.exit(1);
}

source = source.replace(oldFn, newFn);
fs.writeFileSync(target, source);
console.log('Patched SheetJS zip warning reporter.');
