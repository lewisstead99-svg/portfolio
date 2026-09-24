// Renders the static fallback plates and the social image from the live scene.
//   node tools/plates.mjs
// Outputs: assets/img/plate-hero.jpg (no-WebGL hero), assets/img/plate-void.png (transparent object for void sections),
//          assets/img/og.jpg (1200x630 social card, shot from the real page).
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
async function loadPlaywright() {
  for (const c of ['playwright', process.env.PLAYWRIGHT_PATH, '/opt/node22/lib/node_modules/playwright/index.mjs'].filter(Boolean)) {
    try { return await import(c); } catch {}
  }
  throw new Error('playwright not found; set PLAYWRIGHT_PATH');
}
const freePort = () => new Promise(r => { const s = createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
const port = await freePort();
const server = spawn('python3', ['-m', 'http.server', String(port), '--directory', repoRoot], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 600));
const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const frames = (page, n = 3) => page.evaluate(n => new Promise(r => { let i = 0; const f = () => (++i >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const out = f => path.join(repoRoot, 'assets/img', f);
try {
  // Hero plate — the top-down "photograph".
  let page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${port}/tools/plate.html`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 60000 });
  await page.evaluate(() => { window.__scene.setProgress(0); window.__scene.render(); });
  await page.waitForTimeout(300); await frames(page, 3);
  await page.screenshot({ path: out('plate-hero.jpg'), type: 'jpeg', quality: 84 });
  await page.close();

  // Void plate — the object alone on a transparent canvas.
  page = await browser.newPage({ viewport: { width: 1200, height: 1200 }, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${port}/tools/plate.html?transparent`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 60000 });
  await page.evaluate(() => { window.__scene.setProgress(0.4); window.__scene.render(); });
  await page.waitForTimeout(300); await frames(page, 3);
  await page.screenshot({ path: out('plate-void.png'), omitBackground: true });
  await page.close();

  // Social card — the real hero.
  page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts?.ready);
  await page.waitForTimeout(1500); await frames(page, 6);
  await page.screenshot({ path: out('og.jpg'), type: 'jpeg', quality: 84 });
  await page.close();
  console.log('plates written to assets/img/: plate-hero.jpg, plate-void.png, og.jpg');
} finally {
  await browser.close(); server.kill();
}
