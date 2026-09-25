// Renders the gallery's turntable plate from the live scene: 96 frames of one full turn, encoded to WebM + MP4,
// plus a poster frame.   node tools/turntable.mjs
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FF = process.env.FFMPEG || ['/usr/local/lib/python3.11/dist-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2', 'ffmpeg'].find(p => p === 'ffmpeg' || existsSync(p));
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
const frames = path.join(repoRoot, '_panel', 'turntable'); mkdirSync(frames, { recursive: true });
const out = path.join(repoRoot, 'assets/img/plates');
const N = 96, W = 720, H = 960;
try {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${port}/tools/plate.html`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 60000 });
  await page.evaluate(() => { window.__scene.setViewOverride('spinPlate', false); window.__scene.setProgress(0.5); window.__scene.render(); });
  await page.waitForTimeout(400);
  for (let i = 0; i < N; i++) {
    await page.evaluate(deg => { window.__scene.setYawOffset(deg); window.__scene.render(); }, i * 360 / N);
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    await page.evaluate(() => window.__scene.render());
    await page.screenshot({ path: path.join(frames, `f${String(i).padStart(3, '0')}.png`) });
    if (i % 16 === 0) console.log('frame', i);
  }
  await page.close();
} finally { await browser.close(); server.kill(); }
const run = (args) => { const r = spawnSync(FF, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' }); if (r.status !== 0) throw new Error('ffmpeg failed: ' + args.join(' ')); };
run(['-framerate', '24', '-i', path.join(frames, 'f%03d.png'), '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '34', '-pix_fmt', 'yuv420p', '-an', path.join(out, 'turn.webm')]);
run(['-framerate', '24', '-i', path.join(frames, 'f%03d.png'), '-c:v', 'libx264', '-crf', '24', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', path.join(out, 'turn.mp4')]);
run(['-i', path.join(frames, 'f000.png'), '-q:v', '4', path.join(out, 'turn.jpg')]);
console.log('wrote turn.webm, turn.mp4, turn.jpg to assets/img/plates');
