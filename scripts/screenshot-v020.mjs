/**
 * Capture redesigned screens at 1280x800 and 390x844 with mock data.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.KADALAS_URL || 'http://127.0.0.1:43123';
const OUT = '/opt/cursor/artifacts';
mkdirSync(OUT, { recursive: true });

async function signIn(page) {
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 120_000 });
  const mock = page.getByRole('button', { name: /Continue with mock Google/i });
  const demo = page.getByRole('button', { name: /Try demo data/i });
  if (await mock.isVisible({ timeout: 5000 }).catch(() => false)) {
    await mock.click();
  } else if (await demo.isVisible().catch(() => false)) {
    await demo.click();
  }
  await page.waitForTimeout(2000);
}

async function shot(page, name) {
  const path = `${OUT}/v0.2.1-${name}.png`;
  await page.screenshot({ path, fullPage: false });
  console.log('wrote', path);
  return path;
}

async function go(page, path) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 90_000 });
  await page.waitForTimeout(1200);
}

const browser = await chromium.launch({ headless: true });
const paths = [];

for (const [label, size] of [
  ['desktop', { width: 1280, height: 800 }],
  ['mobile', { width: 390, height: 844 }],
]) {
  const page = await browser.newPage({ viewport: size, deviceScaleFactor: label === 'mobile' ? 2 : 1 });
  await signIn(page);
  await shot(page, `${label}-01-home`);

  // Review — seed demo list if empty (tab shell)
  await go(page, '/(tabs)/review');
  const seed = page.getByRole('button', { name: /Load demo review list/i });
  if (await seed.isVisible({ timeout: 2000 }).catch(() => false)) await seed.click();
  await page.waitForTimeout(800);
  await shot(page, `${label}-02-review`);

  await go(page, '/(tabs)/scan');
  await shot(page, `${label}-03-scan`);

  await go(page, '/(tabs)/expiring');
  await shot(page, `${label}-04-expiring`);

  await go(page, '/(tabs)/vehicles');
  await shot(page, `${label}-05-vehicles`);

  await go(page, '/(tabs)/settings');
  await shot(page, `${label}-06-settings`);

  await go(page, '/add');
  await shot(page, `${label}-07-add`);

  // Document detail — open first vault doc if present
  await go(page, '/(tabs)');
  const row = page.locator('[data-testid^="vault-doc-"]').first();
  if (await row.isVisible({ timeout: 5000 }).catch(() => false)) {
    await row.click();
    await page.waitForTimeout(800);
    if (label === 'mobile') {
      // mobile navigates to detail route
      await page.waitForTimeout(400);
    }
    await shot(page, `${label}-08-document-detail`);
  }

  // Sign-in (fresh context) — production-like: no demo button when mocks off;
  // with mocks on we still capture the onboarding frame after clear.
  await page.evaluate(() => {
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
  });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await shot(page, `${label}-00-onboarding`);

  await page.close();
}

await browser.close();
console.log(JSON.stringify({ ok: true, out: OUT }, null, 2));
