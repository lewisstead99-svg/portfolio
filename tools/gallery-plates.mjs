// Renders the gallery plates from the live scene: node tools/gallery-plates.mjs
// Transparent plates (object only) come out as PNG; full-frame "photographs" as JPEG.
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
const PLATES = [ // name, override (null = scroll keyframe), progress, transparent, [width, height]
  ['photo', null, 0, false], ['quarter', null, 0.40, true], ['under', 'flip', 0.5, true],
  ['macro', 'macro', 0.5, false, [1800, 1000]], ['top', 'top', 0.5, true], ['side', 'side', 0.5, true], ['lip', 'lip', 0.5, true],
];
const only = process.argv[2];
const out = path.join(repoRoot, 'assets/img/plates'); mkdirSync(out, { recursive: true });
async function shoot(transparent, list, size = [900, 1200]) {
  if (!list.length) return;
  const page = await browser.newPage({ viewport: { width: size[0], height: size[1] }, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${port}/tools/plate.html${transparent ? '?transparent' : ''}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 60000 });
  for (const [name, view, p] of list) {
    await page.evaluate(([view, p]) => { window.__scene.setViewOverride(view); window.__scene.setProgress(p); window.__scene.render(); }, [view, p]);
    await page.waitForTimeout(300);
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    await page.evaluate(() => window.__scene.render());
    if (transparent) await page.screenshot({ path: path.join(out, `${name}.png`), omitBackground: true });
    else await page.screenshot({ path: path.join(out, `${name}.jpg`), type: 'jpeg', quality: 86 });
    console.log('plate', name);
  }
  await page.close();
}
try {
  const want = PLATES.filter(p => !only || p[0] === only);
  await shoot(false, want.filter(p => !p[3] && !p[4]));
  await shoot(true, want.filter(p => p[3] && !p[4]));
  for (const p of want.filter(p => p[4])) await shoot(p[3], [p], p[4]);
} finally { await browser.close(); server.kill(); }
