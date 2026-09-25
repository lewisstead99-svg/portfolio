// Screenshot a section centred in the viewport:  node tools/section-shot.mjs <id> [width] [height] [out]
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [id = 'top', width = '1440', height = '900', out = '_panel/sections'] = process.argv.slice(2);
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
const page = await browser.newPage({ viewport: { width: +width, height: +height } });
const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
mkdirSync(path.join(repoRoot, out), { recursive: true });
try {
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.evaluate(id => document.getElementById(id).scrollIntoView({ block: 'center', behavior: 'instant' }), id);
  await page.waitForTimeout(4500);
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const file = path.join(repoRoot, out, `${id}-${width}x${height}.png`);
  await page.screenshot({ path: file, timeout: 180000 });
  console.log('wrote', file);
} finally { await browser.close(); server.kill(); }
console.log(errors.length ? 'ERRORS: ' + errors.join(' | ') : 'no console errors');
