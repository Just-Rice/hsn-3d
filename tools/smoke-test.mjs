// Loads the game at a phone and a desktop viewport, walks in, opens each panel, and fails
// on any console error or page error. Also fails if the page scrolls sideways or a touch
// control is smaller than 44px.
// Usage: npm i --no-save playwright && node tools/smoke-test.mjs
// Offline (no CDN access): THREE_DIR=path/to/node_modules/three serves three.js locally and
// skips the Google Fonts stylesheet.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.bin': 'application/octet-stream', '.hdr': 'application/octet-stream', '.ktx2': 'image/ktx2' };
const server = http.createServer((req, res) => {
  let f = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (f.endsWith('/')) f += 'index.html';
  if (!f.startsWith(root) || !fs.existsSync(f)) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

const VIEWPORTS = {
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1366, height: 800 } },
};
let failed = false;
for (const [name, opts] of Object.entries(VIEWPORTS)) {
  // A fresh browser per viewport: software WebGL is slow and contexts compete for it.
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext(opts);
  if (process.env.THREE_DIR) {
    await ctx.route(/cdn\.jsdelivr\.net\/npm\/three@[^/]+\/(.*)$/, (route) => {
      const f = path.join(process.env.THREE_DIR, route.request().url().match(/three@[^/]+\/(.*)$/)[1]);
      route.fulfill(fs.existsSync(f) ? { contentType: 'text/javascript', body: fs.readFileSync(f) } : { status: 404 });
    });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.fulfill({ contentType: 'text/css', body: '' }));
  }
  const page = await ctx.newPage();
  page.setDefaultTimeout(180000);
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  await page.waitForFunction(() => !document.querySelector('#go').disabled, null, { polling: 500 });
  // Clicks are dispatched directly: Playwright's click waits for a rendered frame, and a
  // software-rendered frame of the full scene can take longer than its timeout.
  await page.dispatchEvent('#go', 'click');
  await page.waitForTimeout(2000);
  for (const act of ['find', 'tp', 'char', 'map']) {
    await page.dispatchEvent(`#tools [data-act=${act}]`, 'click');
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
  }
  const problems = await page.evaluate((touch) => {
    const out = [];
    if (document.documentElement.scrollWidth > innerWidth) out.push(`page scrolls sideways (${document.documentElement.scrollWidth}px > ${innerWidth}px)`);
    if (touch) {
      for (const el of document.querySelectorAll('#tools .btn, #tbtns button')) {
        const r = el.getBoundingClientRect();
        if (r.width < 44 || r.height < 44) out.push(`${el.getAttribute('aria-label') || el.textContent.trim()} is ${Math.round(r.width)}x${Math.round(r.height)}px`);
      }
    }
    return out;
  }, !!opts.hasTouch);
  const bad = [...errors.map((e) => 'console: ' + e), ...problems];
  console.log(`${name}: ${bad.length ? 'FAIL' : 'ok'}`);
  for (const b of bad) console.log('  ' + b);
  failed ||= bad.length > 0;
  await browser.close();
}
server.close();
process.exit(failed ? 1 : 0);
