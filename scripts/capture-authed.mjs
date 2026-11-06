import fs from 'fs';
import puppeteer from 'puppeteer-core';

const OUT = '/cursor/stores/bc-01a1b20d-3cc3-7c16-9ef1-866685d5c2bf/media/phase-1';
const API = 'http://127.0.0.1:4000/v1';
const APP = 'http://localhost:8081';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: {
      'content-type': 'application/json',
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.headers || {}),
    },
  });
  const json = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(json));
  return json;
}

const otp = await api('/auth/otp/request', {
  method: 'POST',
  body: JSON.stringify({ phone_e164: '+919900112233' }),
});
const auth = await api('/auth/otp/verify', {
  method: 'POST',
  body: JSON.stringify({
    request_id: otp.request_id,
    code: '123456',
    device_id: 'puppeteer-demo',
  }),
});
const token = auth.access_token;
const specs = await api('/vehicle-specs');
const xev = specs.data.find((s) => s.model.includes('XEV 9S'));
const veh = await api('/vehicles', {
  method: 'POST',
  token,
  body: JSON.stringify({
    vehicle_spec_id: xev.id,
    nickname: 'Demo Family 9S',
    is_primary: true,
  }),
});
await api(`/vehicles/${veh.id}/telemetry`, {
  method: 'POST',
  token,
  body: JSON.stringify({ soc_percent: 68, odometer_km: 12450, source: 'manual' }),
});
const st = await api('/stations/search?lat=19.07&lng=72.87');
await api('/sessions', {
  method: 'POST',
  token,
  body: JSON.stringify({
    vehicle_id: veh.id,
    station_id: st.data[0].id,
    soc_start: 25,
    soc_end: 70,
    energy_kwh: 32,
  }),
});
await api(`/vehicles/${veh.id}/telemetry`, {
  method: 'POST',
  token,
  body: JSON.stringify({ soc_percent: 70, odometer_km: 12610, source: 'manual' }),
});

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome-stable',
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--window-size=390,844'],
  defaultViewport: { width: 390, height: 844 },
});
const page = await browser.newPage();
await page.goto(APP, { waitUntil: 'domcontentloaded' });
await page.evaluate(
  ({ token, user, vehicleId }) => {
    localStorage.setItem('evsaathi_access_token', token);
    localStorage.setItem('evsaathi_user', JSON.stringify(user));
    localStorage.setItem('evsaathi_vehicle_id', vehicleId);
  },
  { token, user: auth.user, vehicleId: veh.id },
);
await page.goto(APP + '/home', { waitUntil: 'networkidle0', timeout: 90000 });
await sleep(2500);
await page.screenshot({ path: `${OUT}/03-home-dashboard.png` });
console.log('home');

await page.goto(APP + '/charging', { waitUntil: 'networkidle0', timeout: 90000 });
await sleep(2000);
await page.screenshot({ path: `${OUT}/04-charging-stations.png` });

await page.goto(APP + `/stations/${st.data[0].id}`, {
  waitUntil: 'networkidle0',
  timeout: 90000,
});
await sleep(1500);
await page.screenshot({ path: `${OUT}/05-station-detail.png` });

await page.goto(APP + '/trips', { waitUntil: 'networkidle0', timeout: 90000 });
await sleep(1500);
await page.evaluate(() => {
  const nodes = Array.from(document.querySelectorAll('div,span,button'));
  const el = nodes.find((n) => n.textContent?.trim() === 'Plan trip');
  el?.click();
});
await sleep(2500);
await page.screenshot({ path: `${OUT}/06-trip-planner.png` });

await page.goto(APP + '/analytics', { waitUntil: 'networkidle0', timeout: 90000 });
await sleep(2000);
await page.screenshot({ path: `${OUT}/07-analytics.png` });

await page.goto(APP + '/range', { waitUntil: 'networkidle0', timeout: 90000 });
await sleep(1000);
await page.evaluate(() => {
  const nodes = Array.from(document.querySelectorAll('div,span,button'));
  nodes.find((n) => n.textContent?.trim() === 'Calculate')?.click();
});
await sleep(1500);
await page.screenshot({ path: `${OUT}/08-range-calculator.png` });

await browser.close();
console.log('done', OUT);
