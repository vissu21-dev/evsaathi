import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer-core';

const OUT = '/cursor/stores/bc-01a1b20d-3cc3-7c16-9ef1-866685d5c2bf/media/phase-3';
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

async function clickText(page, text) {
  await page.evaluate((t) => {
    const nodes = Array.from(document.querySelectorAll('*'));
    const el = nodes.find((n) => n.childNodes.length && n.textContent?.trim() === t);
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }, text);
}

async function main() {
  const otp = await api('/auth/otp/request', {
    method: 'POST',
    body: { phone_e164: '+919876543210' },
  });
  const auth = await api('/auth/otp/verify', {
    method: 'POST',
    body: { request_id: otp.request_id, code: '123456', device_id: 'phase3-shot-bot' },
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

  const adapters = await api('/integrations/adapters');
  await api('/integrations/consents', {
    method: 'POST',
    token,
    body: {
      adapter_id: adapters.defaults.oem,
      vehicle_id: vehicleId,
      purpose: 'oem_readonly_telemetry',
      granted: true,
    },
  });
  await api('/integrations/consents', {
    method: 'POST',
    token,
    body: {
      adapter_id: adapters.defaults.operator,
      vehicle_id: vehicleId,
      purpose: 'operator_session_sync',
      granted: true,
    },
  });
  await api(`/vehicles/${vehicleId}/integrations/oem/sync`, { method: 'POST', token, body: {} });
  try {
    await api(`/vehicles/${vehicleId}/integrations/sessions/import-demo`, {
      method: 'POST',
      token,
      body: {},
    });
  } catch {
    /* optional */
  }

  // AI deny sample for audit
  await api('/ai/assistant', {
    method: 'POST',
    token,
    body: { message: 'Please remote start my charger and unlock the car', vehicle_id: vehicleId },
  });

  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=420,900'],
    defaultViewport: { width: 390, height: 844, deviceScaleFactor: 2 },
  });
  const page = await browser.newPage();
  await loginViaStorage(page, token, auth.user, vehicleId);

  await page.goto(`${BASE}/(tabs)/home`, { waitUntil: 'networkidle0', timeout: 120000 }).catch(() =>
    page.goto(`${BASE}/home`, { waitUntil: 'networkidle0', timeout: 120000 }),
  );
  await new Promise((r) => setTimeout(r, 1500));
  await shot(page, '01-home-freshness-synced.png');

  await page.goto(`${BASE}/integrations`, { waitUntil: 'networkidle0', timeout: 120000 });
  await new Promise((r) => setTimeout(r, 1500));
  await shot(page, '02-integrations-consent.png');
  await page.evaluate(() => window.scrollBy(0, 500));
  await new Promise((r) => setTimeout(r, 400));
  await shot(page, '03-integrations-session-intel.png');

  await page.goto(`${BASE}/assistant`, { waitUntil: 'networkidle0', timeout: 120000 });
  await new Promise((r) => setTimeout(r, 1000));
  await clickText(page, 'Please remote start my charger');
  await new Promise((r) => setTimeout(r, 2000));
  await shot(page, '04-ai-actuator-denied.png');
  await page.evaluate(() => window.scrollBy(0, 400));
  await new Promise((r) => setTimeout(r, 400));
  await shot(page, '05-ai-citations.png');

  await page.goto(`${BASE}/analytics`, { waitUntil: 'networkidle0', timeout: 120000 });
  await new Promise((r) => setTimeout(r, 1200));
  await page.evaluate(() => window.scrollBy(0, 900));
  await new Promise((r) => setTimeout(r, 500));
  await shot(page, '06-advanced-analytics.png');

  await page.goto(`${BASE}/profile`, { waitUntil: 'networkidle0', timeout: 120000 });
  await new Promise((r) => setTimeout(r, 1000));
  await shot(page, '07-profile-phase3.png');

  // Admin integrations HTML
  const adminOtp = await api('/auth/otp/request', {
    method: 'POST',
    body: { phone_e164: '+919900000099' },
  });
  const adminAuth = await api('/auth/otp/verify', {
    method: 'POST',
    body: { request_id: adminOtp.request_id, code: '123456', device_id: 'phase3-admin-bot' },
  });
  await page.setExtraHTTPHeaders({ Authorization: `Bearer ${adminAuth.access_token}` });
  await page.goto('http://127.0.0.1:4000/v1/admin/integrations', {
    waitUntil: 'networkidle0',
    timeout: 60000,
  });
  await new Promise((r) => setTimeout(r, 800));
  await shot(page, '08-admin-integrations-health.png');

  await browser.close();
  console.log('done');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
