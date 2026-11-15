import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const BASE = process.env.APP_URL || 'http://127.0.0.1:43123';
const OUT = '/opt/cursor/artifacts';
fs.mkdirSync(OUT, { recursive: true });

async function waitForText(page, text, timeout = 25000) {
  await page.getByText(text, { exact: false }).first().waitFor({ timeout });
}

async function shot(page, name) {
  const file = path.join(OUT, name);
  await page.waitForTimeout(400);
  await page.screenshot({ path: file, fullPage: false });
  console.log('saved', file);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

await page.goto(`${BASE}/sign-in?t=${Date.now()}`, { waitUntil: 'networkidle', timeout: 60000 });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await waitForText(page, 'Continue with mock Google');
await shot(page, 'screenshot-signin.png');

await page.getByText('Continue with mock Google').click();
await waitForText(page, "Pradhul's Kadalas", 30000);
await page.waitForTimeout(800);
await shot(page, 'screenshot-vault.png');

// Full mailbox scan
await page.goto(`${BASE}/scan`, { waitUntil: 'networkidle' });
await waitForText(page, 'Scan Gmail', 20000);

const again = page.getByText('Run full mailbox scan again', { exact: false });
const full = page.getByText('Full mailbox scan', { exact: false });
if (await again.count()) await again.first().click();
else if (await full.count()) await full.first().click();

// Capture while running (Pause visible)
await page.getByRole('button', { name: 'Pause' }).waitFor({ timeout: 60000 });
await waitForText(page, 'Emails checked', 15000);
await shot(page, 'screenshot-scan-progress.png');

// Wait for quota pause — do not click Pause
const quotaHints = [
  'Paused — AI quota',
  'AI quota / rate limit',
  'free-tier quota',
  'Mock free-tier quota',
];
let paused = false;
const deadline = Date.now() + 120_000;
while (Date.now() < deadline && !paused) {
  const body = await page.locator('body').innerText();
  if (quotaHints.some((h) => body.includes(h)) && body.includes('Resume')) {
    paused = true;
    break;
  }
  // Still running?
  if (body.includes('Completed') || body.includes('Cancelled')) {
    console.log('scan ended without quota pause; body snippet:\n', body.slice(0, 800));
    break;
  }
  await page.waitForTimeout(500);
}
if (!paused) {
  // Force a diagnostic shot then fail
  await shot(page, 'screenshot-scan-paused-FAILED.png');
  throw new Error('Timed out waiting for quota pause UI');
}
await shot(page, 'screenshot-scan-paused.png');

// Grouped review
await page.goto(`${BASE}/scan-review`, { waitUntil: 'networkidle' });
const loadDemo = page.getByText('Load demo review list', { exact: false });
if (await loadDemo.count()) await loadDemo.click();
await waitForText(page, '4 versions found, keeping 2026-27 policy', 25000);
await shot(page, 'screenshot-scan-review.png');

await page.goto(BASE, { waitUntil: 'networkidle' });
await waitForText(page, 'KA-01-AB-1234', 20000);
await page.getByText('KA-01-AB-1234', { exact: false }).first().click();
await waitForText(page, 'Own Damage', 20000);
await shot(page, 'screenshot-vehicle-cover.png');

await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
await waitForText(page, 'AI provider', 20000);
await shot(page, 'screenshot-settings.png');

await page.goto(`${BASE}/expiring`, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await shot(page, 'screenshot-expiring.png');

await browser.close();
console.log('done');
