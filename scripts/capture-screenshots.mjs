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
  await page.waitForTimeout(800);
  await page.screenshot({ path: file, fullPage: false });
  console.log('saved', file);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 });
await page.evaluate(() => localStorage.clear());
await page.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle', timeout: 60000 });
await waitForText(page, 'Continue with mock Google');
await shot(page, 'screenshot-signin.png');

await page.getByText('Continue with mock Google').click();
await waitForText(page, "Pradhul's vault", 30000);
await page.waitForTimeout(1200);
await shot(page, 'screenshot-vault.png');

// Vehicle cover view (KA-01-AB-1234 OD + TP)
await waitForText(page, 'KA-01-AB-1234', 20000);
await page.getByText('KA-01-AB-1234', { exact: false }).first().click();
await waitForText(page, 'Own Damage', 20000);
await waitForText(page, 'Third Party', 10000);
await shot(page, 'screenshot-vehicle-cover.png');

await page.goto(`${BASE}/(tabs)`, { waitUntil: 'networkidle' }).catch(() =>
  page.goto(BASE, { waitUntil: 'networkidle' }),
);
await page.waitForTimeout(800);

// Document sync on OD policy
await page.goto(BASE, { waitUntil: 'networkidle' });
await waitForText(page, 'Progressive Standalone OD', 20000);
await page.getByText('Progressive Standalone OD', { exact: false }).first().click();
await waitForText(page, 'Sync from Gmail', 20000);
await page.getByRole('button', { name: 'Sync' }).click();
await page.waitForTimeout(1500);
await shot(page, 'screenshot-document-sync.png');

// Scan tab — start full scan briefly for progress UI
await page.goto(`${BASE}/scan`, { waitUntil: 'networkidle' });
await waitForText(page, 'Scan Gmail', 20000);
const fullScan = page.getByText('Full mailbox scan', { exact: false });
if (await fullScan.count()) {
  // lastScanAt is set in mocks, so incremental UI may show instead
}
const again = page.getByText('Run full mailbox scan again', { exact: false });
if (await again.count()) {
  await again.first().click();
} else if (await fullScan.count()) {
  await fullScan.first().click();
}
await page.waitForTimeout(2500);
await shot(page, 'screenshot-scan-progress.png');

const pauseBtn = page.getByRole('button', { name: 'Pause' });
if (await pauseBtn.count()) {
  await pauseBtn.click();
  await page.waitForTimeout(600);
  await shot(page, 'screenshot-scan-paused.png');
} else {
  // Quota pause may already be visible
  await shot(page, 'screenshot-scan-paused.png');
}

// Grouped review
await page.goto(`${BASE}/scan-review`, { waitUntil: 'networkidle' });
const loadDemo = page.getByText('Load demo review list', { exact: false });
if (await loadDemo.count()) {
  await loadDemo.click();
  await page.waitForTimeout(800);
}
await waitForText(page, 'Approve', 25000).catch(() => null);
await shot(page, 'screenshot-scan-review.png');

await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
await waitForText(page, 'AI provider', 20000);
await shot(page, 'screenshot-settings.png');

await page.goto(`${BASE}/expiring`, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
await shot(page, 'screenshot-expiring.png');

await browser.close();
console.log('done');
