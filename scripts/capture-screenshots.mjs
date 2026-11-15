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
await page.waitForTimeout(1000);
await shot(page, 'screenshot-vault.png');

await page.getByText('GEICO Vehicle Policy').first().click();
await waitForText(page, 'Sync from Gmail', 20000);
await page.getByRole('button', { name: 'Sync' }).click();
await waitForText(page, 'Make current version', 20000);
await shot(page, 'screenshot-document-sync.png');

await page.goto(`${BASE}/scan-review`, { waitUntil: 'networkidle' });
await waitForText(page, 'Approve', 25000);
await shot(page, 'screenshot-scan-review.png');

await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
await waitForText(page, 'AI provider', 20000);
await shot(page, 'screenshot-settings.png');

await browser.close();
console.log('done');
