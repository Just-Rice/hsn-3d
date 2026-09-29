// Packages the game for a Claude Artifact: the artifact host supplies the document
// skeleton (doctype/html/head/body + charset/viewport), so those are stripped here.
// Usage: node tools/build-artifact.mjs <outDir>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.argv[2] || path.join(root, 'dist/artifact'));
fs.mkdirSync(path.join(out, 'src'), { recursive: true });

let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
html = html
  .replace(/<!doctype html>\s*/i, '')
  .replace(/<html[^>]*>\s*/i, '')
  .replace(/<\/html>\s*/i, '')
  .replace(/<head>\s*/i, '')
  .replace(/<\/head>\s*/i, '')
  .replace(/<body>\s*/i, '')
  .replace(/<\/body>\s*/i, '')
  .replace(/<meta charset[^>]*>\s*/i, '')
  .replace(/<meta name="viewport"[^>]*>\s*/i, '');
fs.writeFileSync(path.join(out, 'index.html'), html);
for (const f of fs.readdirSync(path.join(root, 'src'))) fs.copyFileSync(path.join(root, 'src', f), path.join(out, 'src', f));
const lm = path.join(root, 'lightmaps');
if (fs.existsSync(lm)) {
  fs.mkdirSync(path.join(out, 'lightmaps'), { recursive: true });
  for (const f of fs.readdirSync(lm)) fs.copyFileSync(path.join(lm, f), path.join(out, 'lightmaps', f));
}
console.log('wrote', out);
