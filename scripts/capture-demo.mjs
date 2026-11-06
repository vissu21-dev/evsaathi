import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer-core';

const OUT = '/cursor/stores/bc-01a1b20d-3cc3-7c16-9ef1-866685d5c2bf/media/phase-1';
const BASE = 'http://localhost:8081';
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(page, name) {
  const file = path.join(OUT, name);
  await page.screenshot({ path: file, fullPage: false });
  console.log('wrote', file);
}

async function clickText(page, text) {
  await page.evaluate((t) => {
    const nodes = Array.from(document.querySelectorAll('div,span,button,a,p'));
    const el = nodes.find((n) => n.childNodes.length && n.textContent?.trim() === t);
    if (!el) throw new Error('Not found: ' + t);
    el.click();
  }, text);
  await sleep(800);
}

async function fillNearLabel(page, label, value) {
  await page.evaluate(
    ({ label, value }) => {
      const labels = Array.from(document.querySelectorAll('div,span,p,label'));
      const lab = labels.find((n) => n.textContent?.trim() === label);
      if (!lab) throw new Error('Label missing: ' + label);
      let root = lab.parentElement;
      const input = root?.querySelector('input') || document.querySelector('input');
      if (!input) throw new Error('Input missing for ' + label);
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    },
    { label, value },
  );
}

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome-stable',
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--window-size=390,844'],
  defaultViewport: { width: 390, height: 844 },
});

const page = await browser.newPage();
page.on('console', (m) => console.log('BROWSER', m.type(), m.text()));
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));

await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 120000 });
await sleep(2500);
await shot(page, '01-login.png');

await clickText(page, 'Send OTP');
await sleep(1500);
await shot(page, '01a-otp-entry.png');

await clickText(page, 'Verify & continue');
await sleep(3000);
await shot(page, '02-onboarding-vehicle.png');

// Save vehicle if onboarding visible
try {
  await clickText(page, 'Save vehicle & open dashboard');
  await sleep(3500);
} catch (e) {
  console.log('save vehicle skip', e.message);
}
await shot(page, '03-home-dashboard.png');

// Update SOC if empty
try {
  await clickText(page, 'Update SOC');
  await sleep(1500);
  await fillNearLabel(page, 'SOC %', '68');
  await fillNearLabel(page, 'Odometer km (optional, improves consumption)', '12500');
  await clickText(page, 'Save SOC');
  await sleep(2500);
  await shot(page, '03-home-dashboard.png');
} catch (e) {
  console.log('soc skip', e.message);
}

// Charging tab via URL
await page.goto(BASE + '/charging', { waitUntil: 'networkidle0', timeout: 60000 });
await sleep(2000);
await shot(page, '04-charging-stations.png');

const stationHref = await page.evaluate(() => {
  const a = Array.from(document.querySelectorAll('*')).find((n) =>
    n.textContent?.includes('Demo ·'),
  );
  // click first demo station card
  a?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return location.href;
});
console.log('after station click', stationHref);
await sleep(500);
// navigate to first station via API
const st = await fetch('http://localhost:4000/v1/stations/search?lat=19.07&lng=72.87').then((r) =>
  r.json(),
);
const sid = st.data[0].id;
await page.goto(BASE + `/stations/${sid}`, { waitUntil: 'networkidle0', timeout: 60000 });
await sleep(1500);
await shot(page, '05-station-detail.png');

await page.goto(BASE + '/trips', { waitUntil: 'networkidle0', timeout: 60000 });
await sleep(1500);
try {
  await clickText(page, 'Plan trip');
  await sleep(2500);
} catch (e) {
  console.log('plan skip', e.message);
}
await shot(page, '06-trip-planner.png');

await page.goto(BASE + '/analytics', { waitUntil: 'networkidle0', timeout: 60000 });
await sleep(2000);
await shot(page, '07-analytics.png');

await browser.close();
console.log('done');
