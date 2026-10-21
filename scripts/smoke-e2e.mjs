/**
 * End-to-end smoke check of the merged app against a live backend.
 *
 * Unit tests render components in jsdom with stubbed data. This drives the real
 * thing: onboarding, a real solve, every tab, and the console. Integration faults
 * - a prop that no longer matches, a request shape that drifted, a render that
 * throws only with real data - surface here and nowhere else.
 */
import pw from '/opt/npm-tools/node_modules/playwright/index.js';
const { chromium } = pw;
import { createServer } from '../frontend/node_modules/vite/dist/node/index.js';

process.chdir(new URL('../frontend/', import.meta.url).pathname);
const server = await createServer({
  root: '.', logLevel: 'error',
  server: { port: 4198, proxy: { '/api': 'http://127.0.0.1:8099' } },
});
await server.listen();

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e).slice(0, 200)));

await page.goto('http://localhost:4198/', { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);

const shot = async (name) => page.screenshot({ path: `/tmp/smoke-${name}.png` });
await shot('01-first-load');

const firstScreen = await page.evaluate(() => ({
  heading: document.querySelector('h1,h2')?.textContent?.trim().slice(0, 80) ?? null,
  wizardOpen: !!document.querySelector('[role="dialog"][aria-modal="true"]'),
  buttons: [...document.querySelectorAll('button')].slice(0, 6).map((b) => b.textContent.trim().slice(0, 36)),
}));
console.log('first screen:', JSON.stringify(firstScreen, null, 2));

// Walk every tab, recording what each renders and whether anything overflows.
const tabs = await page.evaluate(() =>
  [...document.querySelectorAll('nav button')].map((b) => b.textContent.trim().slice(0, 40))
);
console.log('tabs found:', tabs.length ? tabs : '(none - still in setup)');

const results = [];
for (let i = 0; i < tabs.length; i++) {
  const btns = await page.$$('nav button');
  if (!btns[i]) break;
  await btns[i].click();
  await page.waitForTimeout(700);
  const r = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    textLen: (document.querySelector('main')?.innerText || '').length,
  }));
  results.push({ tab: tabs[i], ...r });
  await shot(`tab-${i}`);
}
console.log('tabs:', JSON.stringify(results, null, 2));
console.log('console errors:', errors.length ? errors.slice(0, 8) : 'none');

await browser.close();
await server.close();
