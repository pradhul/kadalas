import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.KADALAS_URL || 'http://127.0.0.1:43123';
const OUT = '/opt/cursor/artifacts';
mkdirSync(OUT, { recursive: true });

async function signIn(page) {
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 120_000 });
  const mock = page.getByRole('button', { name: /Continue with mock Google/i });
  if (await mock.isVisible({ timeout: 8000 }).catch(() => false)) await mock.click();
  await page.waitForTimeout(2000);
}

const browser = await chromium.launch({ headless: true });
for (const [label, size] of [
  ['desktop', { width: 1280, height: 800 }],
  ['mobile', { width: 390, height: 844 }],
]) {
  const page = await browser.newPage({
    viewport: size,
    deviceScaleFactor: label === 'mobile' ? 2 : 1,
  });
  await signIn(page);

  await page.goto(`${BASE}/(tabs)/scan`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT}/v0.2.2-${label}-scan.png`, fullPage: false });
  console.log('wrote', `${OUT}/v0.2.2-${label}-scan.png`);

  await page.goto(`${BASE}/(tabs)/review`, { waitUntil: 'networkidle' });
  const seed = page.getByRole('button', { name: /Load demo review list/i });
  if (await seed.isVisible({ timeout: 2000 }).catch(() => false)) await seed.click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT}/v0.2.2-${label}-review.png`, fullPage: false });
  console.log('wrote', `${OUT}/v0.2.2-${label}-review.png`);

  await page.close();
}
await browser.close();
