/**
 * Capture Home / My documents at phone viewport (390x844).
 * Asserts at least 6 document rows are visible with mock sample data.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const URL = process.env.KADALAS_URL || 'http://127.0.0.1:43123';
const OUT = process.env.SCREENSHOT_OUT || '/opt/cursor/artifacts/home-my-documents-390x844.png';

mkdirSync(dirname(OUT), { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
});

await page.goto(URL, { waitUntil: 'networkidle', timeout: 120_000 });

// Sign in if needed (mock or demo)
const continueBtn = page.getByRole('button', { name: /Continue with mock Google|Try demo data|Continue with Google/i });
if (await continueBtn.first().isVisible({ timeout: 8000 }).catch(() => false)) {
  const mock = page.getByRole('button', { name: /Continue with mock Google/i });
  const demo = page.getByRole('button', { name: /Try demo data/i });
  if (await mock.isVisible().catch(() => false)) await mock.click();
  else if (await demo.isVisible().catch(() => false)) await demo.click();
  await page.waitForTimeout(1500);
}

// Land on Home tab
await page.getByText(/My documents|documents/i).first().waitFor({ timeout: 30_000 });

// Wait for document rows
await page.waitForSelector('[data-testid^="vault-doc-doc_"]', { timeout: 30_000 });

const rows = page.locator('[data-testid^="vault-doc-doc_"]');
await page.screenshot({ path: OUT, fullPage: false });

const viewportRows = [];
const n = await rows.count();
for (let i = 0; i < n; i++) {
  const b = await rows.nth(i).boundingBox();
  // Leave room for the tab bar (~64px)
  if (b && b.y >= 0 && b.y + b.height <= 844 - 60) viewportRows.push(i);
}

console.log(
  JSON.stringify(
    {
      out: OUT,
      testIdRowCount: n,
      visibleInViewport: viewportRows.length,
      ok: viewportRows.length >= 6,
    },
    null,
    2,
  ),
);

if (viewportRows.length < 6) {
  console.error('FAIL: fewer than 6 document rows visible in 390x844 viewport');
  await browser.close();
  process.exit(1);
}

await browser.close();
