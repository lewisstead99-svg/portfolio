// Renders the gallery plates (portrait, transparent) from the live scene: node tools/gallery-plates.mjs
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
async function loadPlaywright() {
  for (const c of ['playwright', process.env.PLAYWRIGHT_PATH, '/opt/node22/lib/node_modules/playwright/index.mjs'].filter(Boolean)) { try { return await import(c); } catch {} }
  throw new Error('playwright not found; set PLAYWRIGHT_PATH');
}
const freePort = () => new Promise(r => { const s = createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
const port = await freePort();
const server = spawn('python3', ['-m', 'http.server', String(port), '--directory', repoRoot], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 600));
const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const PLATES = [ // name, override (null = scroll keyframe), progress
  ['quarter', null, 0.40], ['under', 'flip', 0.5], ['side', 'side', 0.5], ['top', 'top', 0.5], ['detail', 'detail', 0.5], ['lip', 'lip', 0.5],
];
const out = path.join(repoRoot, 'assets/img/plates'); mkdirSync(out, { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 1200 }, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${port}/tools/plate.html?transparent`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 60000 });
  for (const [name, view, p] of PLATES) {
    await page.evaluate(([view, p]) => { window.__scene.setViewOverride(view); window.__scene.setProgress(p); window.__scene.render(); }, [view, p]);
    await page.waitForTimeout(250);
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    await page.evaluate(() => window.__scene.render());
    await page.screenshot({ path: path.join(out, `${name}.png`), omitBackground: true });
    console.log('plate', name);
  }
} finally { await browser.close(); server.kill(); }
