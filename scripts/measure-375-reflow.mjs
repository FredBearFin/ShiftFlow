/**
 * Measures real 375px reflow in a browser, which jsdom cannot do.
 *
 * The unit suite has a 375px test, but jsdom performs no layout, so it checks class
 * names as a proxy. That proxy passed while every tab actually overflowed to 400px:
 * the Header's labour tab only overflows once a solve has landed and payroll carries
 * real digits, and in planning mode it reads $0.00 and fits. This script renders the
 * app, puts loaded-state text into that button, and measures the document.
 *
 * Needs Playwright, which is not a frontend dependency, so it is run on demand:
 *   node scripts/measure-375-reflow.mjs
 * Expect scrollWidth === clientWidth === 375 and an empty overflowing list.
 */
import pw from '/opt/npm-tools/node_modules/playwright/index.js';
const { chromium } = pw;
import { createServer } from '../frontend/node_modules/vite/dist/node/index.js';

// Run with frontend/ as the working directory: Tailwind resolves its content globs
// relative to cwd, and an unstyled render measures narrower than the real page.
process.chdir(new URL('../frontend/', import.meta.url).pathname);
const server = await createServer({ root: '.', server: { port: 4199 }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 375, height: 800 } });

// Stub the API so a real solved schedule with real payroll digits renders.
await page.route('**/api/**', async (route) => {
  const u = route.request().url();
  if (u.includes('/auth/status'))
    return route.fulfill({ json: { login_required: false, logged_in: true, email: null, signup_allowed: false } });
  return route.fulfill({ status: 404, json: { detail: 'stub' } });
});

await page.goto('http://localhost:4199/', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

// Put the loaded-state text into the very same nav button, with the same classes,
// so this measures the real element rather than a planning-mode placeholder.
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('nav button')]
    .find((b) => (b.textContent || '').includes('Labor'));
  window.__probe = { found: !!btn, html: btn ? btn.outerHTML.slice(0, 400) : null };
  if (btn) {
    const badge = btn.querySelector('span:last-of-type');
    window.__probe.badgeBefore = badge ? badge.textContent : '(no span)';
    if (badge) badge.textContent = '$4,970.40 \u00b7 6/6 priced';
    window.__probe.widthAfter = Math.round(btn.getBoundingClientRect().width);
  }
});
await page.waitForTimeout(200);

const r = await page.evaluate(() => {
  const d = document.documentElement;
  const over = [...document.querySelectorAll('*')]
    .filter((e) => e.getBoundingClientRect().right > 375.5)
    .map((e) => ({
      tag: e.tagName,
      cls: (e.className || '').toString().slice(0, 60),
      right: Math.round(e.getBoundingClientRect().right),
      text: (e.textContent || '').trim().slice(0, 60),
    }));
  return { scrollWidth: d.scrollWidth, clientWidth: d.clientWidth, overflowing: over.slice(0, 6), probe: window.__probe };
});
console.log(JSON.stringify(r, null, 2));
await browser.close();
await server.close();
