// Headless screenshot harness for the HOLM site.
//
//   node tools/screenshot.mjs --url /index.html --out shots --mode page --at 0,0.25,0.5,0.75,1
//   node tools/screenshot.mjs --url /_panel/scene-a/test.html --out _panel/scene-a/shots --mode scene --at 0,0.24,0.4,0.6,0.8,1
//
// --mode page  : scrolls the document to each fraction of its scrollable height, waits, screenshots.
// --mode scene : waits for window.__sceneReady, calls window.__scene.setProgress(p) for each fraction,
//                renders, screenshots. The test page must expose window.__scene (see SCENE-CONTRACT.md).
// --width/--height (default 1440x900), --dpr (default 1), --root (server root, default repo root).
// Serves the repo over a throwaway local HTTP server so ES modules and import maps work.

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : 'true'] : []).filter(Boolean));
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = args.root ? path.resolve(args.root) : repoRoot;
const url = args.url || '/index.html';
const out = path.resolve(args.out || 'shots');
const mode = args.mode || 'page';
const at = (args.at || '0,0.5,1').split(',').map(Number);
const width = Number(args.width || 1440), height = Number(args.height || 900), dpr = Number(args.dpr || 1);
mkdirSync(out, { recursive: true });

async function loadPlaywright() {
  for (const c of ['playwright', process.env.PLAYWRIGHT_PATH, '/opt/node22/lib/node_modules/playwright/index.mjs'].filter(Boolean)) {
    try { return await import(c); } catch {}
  }
  throw new Error('playwright not found; set PLAYWRIGHT_PATH');
}
const freePort = () => new Promise(r => { const s = createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });

const port = await freePort();
const server = spawn('python3', ['-m', 'http.server', String(port), '--directory', root], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 600));
const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: dpr });
const errors = [];
page.on('console', m => { if (['error', 'warning'].includes(m.type())) errors.push(`[console.${m.type()}] ${m.text()}`); });
page.on('pageerror', e => errors.push(`[pageerror] ${e.message}`));
page.on('requestfailed', r => errors.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`));
page.on('response', r => { if (r.status() >= 400) errors.push(`[http ${r.status()}] ${r.url()}`); });
try {
  await page.goto(`http://127.0.0.1:${port}${url}`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts?.ready);
  const frames = async (n = 3) => page.evaluate(n => new Promise(r => { let i = 0; const f = () => (++i >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
  if (mode === 'scene') {
    await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 30000 });
    for (const p of at) {
      await page.evaluate(p => window.__scene.setProgress(p), p);
      await page.waitForTimeout(250); await frames(4);
      await page.evaluate(() => window.__scene.render && window.__scene.render());
      await page.screenshot({ path: path.join(out, `p${String(p).replace('.', '_')}.png`) });
    }
  } else {
    await page.waitForTimeout(1800); await frames(4);
    for (const p of at) {
      await page.evaluate(p => window.scrollTo(0, (document.documentElement.scrollHeight - window.innerHeight) * p), p);
      await page.waitForTimeout(900); await frames(6);
      await page.screenshot({ path: path.join(out, `s${String(p).replace('.', '_')}.png`) });
    }
  }
  console.log(`ok: ${at.length} screenshots -> ${out}`);
} finally {
  await browser.close(); server.kill();
}
if (errors.length) { console.log('PAGE ISSUES:'); errors.forEach(e => console.log('  ' + e)); process.exitCode = 2; } else console.log('no console errors, no failed requests');
