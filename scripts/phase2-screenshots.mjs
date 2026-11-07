import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer-core';

const OUT = '/cursor/stores/bc-01a1b20d-3cc3-7c16-9ef1-866685d5c2bf/media/phase-2';
const BASE = process.env.EXPO_URL || 'http://127.0.0.1:8081';
const API = process.env.API_URL || 'http://127.0.0.1:4000/v1';

fs.mkdirSync(OUT, { recursive: true });

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome-stable',
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error('Chrome not found');
}

async function api(pathname, opts = {}) {
  const res = await fetch(`${API}${pathname}`, {
    ...opts,
    headers: {
      'content-type': 'application/json',
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.headers || {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(json));
  return json;
}

async function loginViaStorage(page, token, user, vehicleId) {
  await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 120000 });
  await page.evaluate(
    async ({ token, user, vehicleId }) => {
      localStorage.setItem('evsaathi_access_token', token);
      localStorage.setItem('evsaathi_user', JSON.stringify(user));
      localStorage.setItem('evsaathi_vehicle_id', vehicleId);
    },
    { token, user, vehicleId },
  );
  await page.reload({ waitUntil: 'networkidle0', timeout: 120000 });
  await new Promise((r) => setTimeout(r, 1500));
}

async function shot(page, name) {
  const file = path.join(OUT, name);
  await page.screenshot({ path: file, fullPage: false });
  console.log('wrote', file);
}

async function main() {
  const otp = await api('/auth/otp/request', {
    method: 'POST',
    body: { phone_e164: '+919876543210' },
  });
  const auth = await api('/auth/otp/verify', {
    method: 'POST',
    body: { request_id: otp.request_id, code: '123456', device_id: 'screenshot-bot' },
  });
  const token = auth.access_token;
  let vehicles = await api('/vehicles', { token });
  let vehicleId = vehicles.data[0]?.id;
  if (!vehicleId) {
    const specs = await api('/vehicle-specs');
    const xev = specs.data.find((s) => s.model.includes('XEV'));
    const created = await api('/vehicles', {
      method: 'POST',
      token,
      body: { vehicle_spec_id: xev.id, nickname: 'XEV 9S Pack 3' },
    });
    vehicleId = created.id;
  }
  const stations = await api('/stations/search?lat=19.076&lng=72.877&radius_m=800000');
  const lonavala = stations.data.find((s) => s.name.includes('Lonavala')) || stations.data[0];

  // seed a notification
  await api('/notifications/demo', { method: 'POST', token, body: { type: 'station_failure' } });

  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=420,900'],
    defaultViewport: { width: 390, height: 844, deviceScaleFactor: 2 },
  });
  const page = await browser.newPage();
  await loginViaStorage(page, token, auth.user, vehicleId);

  await page.goto(`${BASE}/charging`, { waitUntil: 'networkidle0', timeout: 120000 });
  await new Promise((r) => setTimeout(r, 1200));
  await shot(page, '01-charging-list-reliability.png');

  await page.goto(`${BASE}/stations/${lonavala.id}`, { waitUntil: 'networkidle0', timeout: 120000 });
  await new Promise((r) => setTimeout(r, 1500));
  await shot(page, '02-station-reliability-detail.png');
  await page.evaluate(() => window.scrollBy(0, 500));
  await new Promise((r) => setTimeout(r, 400));
  await shot(page, '03-station-reports-form.png');
  await page.evaluate(() => window.scrollBy(0, 700));
  await new Promise((r) => setTimeout(r, 400));
  await shot(page, '04-station-alternatives.png');

  await page.goto(`${BASE}/trips`, { waitUntil: 'networkidle0', timeout: 120000 });
  await new Promise((r) => setTimeout(r, 1000));
  // tap Most reliable then Plan
  const buttons = await page.$$('div[role="button"], button, [class*="btn"]');
  // Use text click via evaluate
  await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('*'));
    const most = nodes.find((n) => n.childNodes.length === 1 && n.textContent?.trim() === 'Most reliable');
    most?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 400));
  await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('*'));
    const plan = nodes.find((n) => n.childNodes.length === 1 && n.textContent?.trim() === 'Plan trip');
    plan?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 2500));
  await shot(page, '05-trip-most-reliable.png');

  await page.goto(`${BASE}/range`, { waitUntil: 'networkidle0', timeout: 120000 });
  await new Promise((r) => setTimeout(r, 800));
  await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('*'));
    const calc = nodes.find((n) => n.childNodes.length === 1 && n.textContent?.trim() === 'Calculate');
    calc?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 1500));
  await shot(page, '06-range-history-weighted.png');

  await page.goto(`${BASE}/notifications`, { waitUntil: 'networkidle0', timeout: 120000 });
  await new Promise((r) => setTimeout(r, 1200));
  await shot(page, '07-notifications-inbox.png');

  await page.goto(`${BASE}/analytics`, { waitUntil: 'networkidle0', timeout: 120000 });
  await new Promise((r) => setTimeout(r, 1200));
  await page.evaluate(() => window.scrollBy(0, 600));
  await new Promise((r) => setTimeout(r, 400));
  await shot(page, '08-session-analytics.png');

  await browser.close();
  console.log('done');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
