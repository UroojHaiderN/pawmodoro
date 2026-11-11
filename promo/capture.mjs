// Records promo/reel.html into a 1080x1920, 30 fps MP4 (promo/pawmodoro-reel.mp4).
// It drives a hidden Chrome and advances the page's clock one frame at a time, so every frame is exact.
// Run from the project folder:  node promo/capture.mjs
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const OUT = join(ROOT, 'promo', 'out', 'frames');
const MP4 = join(ROOT, 'promo', 'pawmodoro-reel.mp4');
const FPS = 30, SITE_PORT = 8811, CDP_PORT = 9341;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

rmSync(join(ROOT, 'promo', 'out'), { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const server = spawn('python3', ['-m', 'http.server', String(SITE_PORT), '--bind', '127.0.0.1', '--directory', ROOT], { stdio: 'ignore' });
const profile = mkdtempSync(join(tmpdir(), 'pawreel-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
  '--hide-scrollbars', '--mute-audio', '--no-first-run', '--no-default-browser-check', '--force-color-profile=srgb', 'about:blank'], { stdio: 'ignore' });
const cleanup = () => { try { chrome.kill(); } catch {} try { server.kill(); } catch {} };
process.on('exit', cleanup);

async function target() {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(200);
  }
  throw new Error('Chrome did not start');
}

const ws = new WebSocket(await target());
await new Promise((ok) => ws.addEventListener('open', ok, { once: true }));
let nextId = 1; const pending = new Map(); const waiters = new Map();
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { const { ok, fail } = pending.get(msg.id); pending.delete(msg.id); msg.error ? fail(new Error(msg.error.message)) : ok(msg.result); }
  else if (msg.method && waiters.has(msg.method)) { const list = waiters.get(msg.method); waiters.delete(msg.method); list.forEach((f) => f(msg.params)); }
});
const send = (method, params = {}) => new Promise((ok, fail) => { const id = nextId++; pending.set(id, { ok, fail }); ws.send(JSON.stringify({ id, method, params })); });
const once = (method) => new Promise((ok) => { const list = waiters.get(method) || []; list.push(ok); waiters.set(method, list); });
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.value;

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 540, height: 960, deviceScaleFactor: 2, mobile: false });
await sleep(400);
const loaded = once('Page.loadEventFired');
await send('Page.navigate', { url: `http://127.0.0.1:${SITE_PORT}/promo/reel.html` });
await loaded;
await evaluate('window.reelReady');
await sleep(1500); // let the greeting bubble from page load clear
const totalMs = await evaluate('window.REEL_MS');
const frames = Math.round(totalMs / 1000 * FPS);

await send('Emulation.setVirtualTimePolicy', { policy: 'pause' });
await evaluate('window.startReel(), true');
const t0 = Date.now();
for (let f = 0; f < frames; f++) {
  const expired = once('Emulation.virtualTimeBudgetExpired');
  await send('Emulation.setVirtualTimePolicy', { policy: 'advance', budget: 1000 / FPS });
  await expired;
  const { data } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 94 });
  writeFileSync(join(OUT, String(f).padStart(4, '0') + '.jpg'), Buffer.from(data, 'base64'));
  if (f % 90 === 0) console.log(`frame ${f}/${frames}  (${Math.round((Date.now() - t0) / 1000)}s)`);
}
ws.close();
cleanup();

execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', join(OUT, '%04d.jpg'),
  '-vf', 'scale=1080:1920:flags=lanczos', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p',
  '-movflags', '+faststart', MP4], { stdio: 'inherit' });
console.log(`saved ${MP4}`);
