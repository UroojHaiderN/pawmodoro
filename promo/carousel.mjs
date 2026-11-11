// Renders promo/carousel.html into 7 TikTok photo slides (1080x1920 PNG) in promo/carousel/.
// Run from the project folder:  node promo/carousel.mjs
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const OUT = join(ROOT, 'promo', 'carousel');
const SLIDES = 7, SITE_PORT = 8812, CDP_PORT = 9342;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

const server = spawn('python3', ['-m', 'http.server', String(SITE_PORT), '--bind', '127.0.0.1', '--directory', ROOT], { stdio: 'ignore' });
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'pawslides-'))}`,
  '--hide-scrollbars', '--mute-audio', '--no-first-run', '--no-default-browser-check', '--force-color-profile=srgb', 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch {} try { server.kill(); } catch {} });

let wsUrl;
for (let i = 0; i < 50 && !wsUrl; i++) {
  try { wsUrl = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()).find((t) => t.type === 'page')?.webSocketDebuggerUrl; } catch {}
  if (!wsUrl) await sleep(200);
}
const ws = new WebSocket(wsUrl);
await new Promise((ok) => ws.addEventListener('open', ok, { once: true }));
let nextId = 1; const pending = new Map(); const waiters = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const { ok, fail } = pending.get(m.id); pending.delete(m.id); m.error ? fail(new Error(m.error.message)) : ok(m.result); }
  else if (m.method && waiters.has(m.method)) { const l = waiters.get(m.method); waiters.delete(m.method); l.forEach((f) => f(m.params)); }
});
const send = (method, params = {}) => new Promise((ok, fail) => { const id = nextId++; pending.set(id, { ok, fail }); ws.send(JSON.stringify({ id, method, params })); });
const once = (method) => new Promise((ok) => { const l = waiters.get(method) || []; l.push(ok); waiters.set(method, l); });

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 540, height: 960, deviceScaleFactor: 2, mobile: false });
for (let n = 1; n <= SLIDES; n++) {
  const loaded = once('Page.loadEventFired');
  await send('Page.navigate', { url: `http://127.0.0.1:${SITE_PORT}/promo/carousel.html?n=${n}` });
  await loaded;
  await send('Runtime.evaluate', { expression: 'window.slideReady', awaitPromise: true });
  await sleep(400);
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  const file = join(OUT, `pawmodoro-carousel-${n}.png`);
  writeFileSync(file, Buffer.from(data, 'base64'));
  console.log(`saved ${file}`);
}
ws.close();
process.exit(0);
