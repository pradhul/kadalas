/**
 * Pair v0.2.1 screenshots with Stitch PNGs for fidelity review.
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';

const OUT = '/opt/cursor/artifacts';
const STITCH = 'docs/design/stitch';
mkdirSync(OUT, { recursive: true });

const pairs = [
  ['web-05-review.png', 'v0.2.1-desktop-02-review.png', 'compare-desktop-review'],
  ['mobile-05-review.png', 'v0.2.1-mobile-02-review.png', 'compare-mobile-review'],
  ['web-02-home.png', 'v0.2.1-desktop-01-home.png', 'compare-desktop-home'],
  ['mobile-02-home.png', 'v0.2.1-mobile-01-home.png', 'compare-mobile-home'],
  ['web-04-scan.png', 'v0.2.1-desktop-03-scan.png', 'compare-desktop-scan'],
  ['web-08-settings.png', 'v0.2.1-desktop-06-settings.png', 'compare-desktop-settings'],
  ['web-01-onboarding.png', 'v0.2.1-desktop-00-onboarding.png', 'compare-desktop-onboarding'],
];

for (const [stitch, ours, name] of pairs) {
  const a = `${STITCH}/${stitch}`;
  const b = `${OUT}/${ours}`;
  if (!existsSync(a) || !existsSync(b)) {
    console.log('skip', name, !existsSync(a) ? 'missing stitch' : 'missing ours');
    continue;
  }
  const out = `${OUT}/v0.2.1-${name}.png`;
  try {
    execSync(
      `convert "${a}" "${b}" +append -resize 2560x\\> "${out}"`,
      { stdio: 'inherit' },
    );
    console.log('wrote', out);
  } catch {
    // fallback without ImageMagick: copy ours only with note
    console.log('convert failed for', name);
  }
}
