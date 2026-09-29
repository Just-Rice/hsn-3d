// Loads the game in headless Chromium and writes the static scene for baking:
//   node tools/bake/export.mjs [outDir]            (default tools/bake/out)
// Needs Playwright (npm i -D playwright). Set THREE_DIR to a local three@0.169.0 package
// folder to run without network access to the CDN.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.resolve(process.argv[2] || path.join(root, 'tools/bake/out'));
fs.mkdirSync(out, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const f = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const url = `http://127.0.0.1:${server.address().port}/index.html`;

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
// keep the export independent of any existing bake and of saved settings
await page.addInitScript(() => localStorage.setItem('wwpn3d:quality', '"low"'));
await page.route('**/lightmaps/**', (r) => r.fulfill({ status: 404, body: '' }));
if (process.env.THREE_DIR) {
  await page.route('https://cdn.jsdelivr.net/npm/three@0.169.0/**', (r) => {
    const rel = new URL(r.request().url()).pathname.replace('/npm/three@0.169.0/', '');
    r.fulfill({ body: fs.readFileSync(path.join(process.env.THREE_DIR, rel)), contentType: 'text/javascript' });
  });
}
page.on('pageerror', (e) => console.error('page error:', e.message));
await page.goto(url);
await page.waitForFunction(() => !document.querySelector('#go').disabled, null, { timeout: 300000 });
const res = await page.evaluate(`(${fs.readFileSync(path.join(root, 'tools/bake/export-scene.js'), 'utf8')})()`);
fs.writeFileSync(path.join(out, 'scene.bin'), Buffer.from(res.bin, 'base64'));
fs.writeFileSync(path.join(out, 'scene.json'), JSON.stringify(res.meta));
const m = res.meta;
console.log(`exported ${m.meshes.length} meshes, ${m.meshes.reduce((s, x) => s + x.tris, 0)} triangles, ${m.fixtures.length} fixtures; lightmap ${m.lightmap.pages} pages, hash ${m.lightmap.hash}`);
await browser.close();
server.close();
