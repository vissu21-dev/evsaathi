import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer-core';

const OUT = '/cursor/stores/bc-01a1b20d-3cc3-7c16-9ef1-866685d5c2bf/media/phase-4';
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
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${pathname} ${res.status} ${JSON.stringify(json)}`);
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
    body: { request_id: otp.request_id, code: '123456', device_id: 'phase4-shot-bot' },
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

  // Seed a tip so feed is non-empty for this user view
  await api('/community/posts', {
    method: 'POST',
    token,
    body: {
      space_slug: 'general',
      post_type: 'tip',
      title: 'Screenshot tip — Phase 4',
      body: 'Owner tip for demo screenshots. Crowdsource ≠ LIVE availability.',
    },
  }).catch(() => {});

  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=420,900'],
    defaultViewport: { width: 390, height: 844, deviceScaleFactor: 2 },
  });
  const page = await browser.newPage();
  await loginViaStorage(page, token, auth.user, vehicleId);

  await page.goto(`${BASE}/community`, { waitUntil: 'networkidle0', timeout: 120000 });
  await new Promise((r) => setTimeout(r, 1500));
  await shot(page, '01-community-hub.png');
  await page.evaluate(() => window.scrollBy(0, 500));
  await new Promise((r) => setTimeout(r, 400));
  await shot(page, '02-community-feed.png');

  await page.goto(`${BASE}/garage`, { waitUntil: 'networkidle0', timeout: 120000 });
  await new Promise((r) => setTimeout(r, 1200));
  await shot(page, '03-multi-brand-garage.png');

  await page.goto(`${BASE}/analytics`, { waitUntil: 'networkidle0', timeout: 120000 });
  await new Promise((r) => setTimeout(r, 1200));
  await page.evaluate(() => window.scrollBy(0, 1100));
  await new Promise((r) => setTimeout(r, 500));
  await shot(page, '04-battery-health-gates.png');

  await page.goto(`${BASE}/subscription`, { waitUntil: 'networkidle0', timeout: 120000 });
  await new Promise((r) => setTimeout(r, 1200));
  await shot(page, '05-subscriptions-stub.png');

  // Fleet visible for admin seed membership — switch to admin
  const adminOtp = await api('/auth/otp/request', {
    method: 'POST',
    body: { phone_e164: '+919900000099' },
  });
  const adminAuth = await api('/auth/otp/verify', {
    method: 'POST',
    body: { request_id: adminOtp.request_id, code: '123456', device_id: 'phase4-admin-bot' },
  });
  await loginViaStorage(page, adminAuth.access_token, adminAuth.user, vehicleId);

  await page.goto(`${BASE}/fleet`, { waitUntil: 'networkidle0', timeout: 120000 });
  await new Promise((r) => setTimeout(r, 1500));
  await shot(page, '06-fleet-stub.png');

  await page.goto(`${BASE}/profile`, { waitUntil: 'networkidle0', timeout: 120000 });
  await new Promise((r) => setTimeout(r, 1000));
  await shot(page, '07-profile-phase4.png');

  await page.setExtraHTTPHeaders({ Authorization: `Bearer ${adminAuth.access_token}` });
  await page.goto('http://127.0.0.1:4000/v1/admin/community', {
    waitUntil: 'networkidle0',
    timeout: 60000,
  });
  await new Promise((r) => setTimeout(r, 800));
  await shot(page, '08-admin-community.png');

  await browser.close();
  console.log('done');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
