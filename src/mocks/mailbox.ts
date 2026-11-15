import { GmailAttachmentMeta } from '../services/gmail/types';

export interface MockMailboxMessage extends GmailAttachmentMeta {
  /** Extra text embedded in mock PDF for classification */
  bodyText: string;
  kind: 'important' | 'promo' | 'newsletter' | 'noise' | 'logo';
}

const INSURERS = ['GEICO', 'State Farm', 'Progressive', 'Allstate'] as const;
const BANKS = ['Chase', 'Bank of America', 'Wells Fargo'] as const;

/**
 * Deterministic large mock mailbox (~2500 attachment rows) for full-scan demos.
 * Includes multi-year vehicle policies for two cars (reg change / insurer switch cases),
 * promos, newsletters, and tiny logo images.
 */
export function buildLargeMockMailbox(totalImportantApprox = 80): MockMailboxMessage[] {
  const rows: MockMailboxMessage[] = [];
  const now = Date.UTC(2026, 10, 15); // 2026-11-15

  // Vehicle A — KA-01-AB-1234:
  // 2023-24 comprehensive GEICO → 2025 split: long-term TP (Digit, 5y) + annual OD (Progressive) renewals
  rows.push(
    makeDoc({
      id: 'veh_a_2023_comp',
      from: 'GEICO <docs@geico.com>',
      subject: 'GEICO Package Policy 2023 — KA-01-AB-1234',
      filename: 'geico-package-ka01ab1234-2023.pdf',
      date: new Date(Date.UTC(2023, 1, 10)).toISOString(),
      bodyText:
        'Package Policy comprehensive vehicle insurance registration KA-01-AB-1234 chassis CHASSIS-A99 make Honda City policy POL-100-A holder Pradhul Dev issue 2023-02-10 expiry 2024-02-09',
      kind: 'important',
    }),
    makeDoc({
      id: 'veh_a_2024_comp',
      from: 'GEICO <docs@geico.com>',
      subject: 'GEICO Bundled motor policy 2024 — KA-01-AB-1234',
      filename: 'geico-bundled-ka01ab1234-2024.pdf',
      date: new Date(Date.UTC(2024, 1, 12)).toISOString(),
      bodyText:
        'Bundled comprehensive vehicle insurance registration KA-01-AB-1234 chassis CHASSIS-A99 make Honda City policy POL-200-A holder Pradhul Dev issue 2024-02-12 expiry 2025-02-11',
      kind: 'important',
    }),
    // Long-term TP from new insurer (does not get displaced by later OD-only)
    makeDoc({
      id: 'veh_a_2025_tp',
      from: 'Go Digit <motor@godigit.com>',
      subject: 'Digit 5-year Third Party liability — KA-01-AB-1234',
      filename: 'digit-tp-5yr-ka01ab1234.pdf',
      date: new Date(Date.UTC(2025, 1, 15)).toISOString(),
      bodyText:
        'Standalone TP Liability Only Act Only third party vehicle insurance registration KA-01-AB-1234 chassis CHASSIS-A99 policy DIG-TP-9001 holder Pradhul Dev issue 2025-02-15 expiry 2030-02-14',
      kind: 'important',
    }),
    makeDoc({
      id: 'veh_a_2025_od',
      from: 'Progressive <docs@progressive.com>',
      subject: 'Progressive Standalone OD 2025 — KA-01-AB-1234',
      filename: 'progressive-od-ka01ab1234-2025.pdf',
      date: new Date(Date.UTC(2025, 1, 16)).toISOString(),
      bodyText:
        'Standalone OD Own Damage only vehicle insurance registration KA-01-AB-1234 chassis CHASSIS-A99 policy PRG-5501 holder Pradhul Dev issue 2025-02-16 expiry 2026-02-15',
      kind: 'important',
    }),
    makeDoc({
      id: 'veh_a_2026_od',
      from: 'Progressive <docs@progressive.com>',
      subject: 'Progressive Standalone OD renewal 2026 — KA-01-AB-1234',
      filename: 'progressive-od-ka01ab1234-2026.pdf',
      date: new Date(Date.UTC(2026, 1, 18)).toISOString(),
      bodyText:
        'Standalone OD Own Damage only vehicle insurance registration KA-01-AB-1234 chassis CHASSIS-A99 policy PRG-7788 holder Pradhul Dev issue 2026-02-18 expiry 2027-02-17',
      kind: 'important',
    }),
  );

  // Vehicle B — different registration; insurer switch on comprehensive
  rows.push(
    makeDoc({
      id: 'veh_b_2025_comp',
      from: 'State Farm <policy@statefarm.com>',
      subject: 'State Farm Package Policy 2025 MH-12-XY-9876',
      filename: 'statefarm-package-mh12xy9876-2025.pdf',
      date: new Date(Date.UTC(2025, 4, 5)).toISOString(),
      bodyText:
        'Package Policy comprehensive vehicle insurance registration MH-12-XY-9876 chassis CHASSIS-B42 make Hyundai Creta policy SF-2025-42 holder Pradhul Dev issue 2025-05-05 expiry 2026-05-04',
      kind: 'important',
    }),
    makeDoc({
      id: 'veh_b_2026_comp',
      from: 'Allstate <motor@allstate.com>',
      subject: 'Allstate comprehensive motor cover 2026 MH-12-XY-9876',
      filename: 'allstate-comp-mh12xy9876-2026.pdf',
      date: new Date(Date.UTC(2026, 4, 6)).toISOString(),
      bodyText:
        'Comprehensive Package Policy vehicle insurance registration MH-12-XY-9876 chassis CHASSIS-B42 make Hyundai Creta policy AS-2026-99 holder Pradhul Dev issue 2026-05-06 expiry 2027-05-05',
      kind: 'important',
    }),
  );

  // Health, tax, banking, bills samples
  for (let y = 2022; y <= 2026; y++) {
    rows.push(
      makeDoc({
        id: `health_${y}`,
        from: 'Aetna <noreply@aetna.com>',
        subject: `Aetna health card ${y}`,
        filename: `aetna-card-${y}.pdf`,
        date: new Date(Date.UTC(y, 5, 1)).toISOString(),
        bodyText: `Health insurance card member MEM-99210 holder Pradhul Dev issue ${y}-06-01`,
        kind: 'important',
      }),
    );
    rows.push(
      makeDoc({
        id: `w2_${y}`,
        from: 'Acme Payroll <hr@acme.example>',
        subject: `Your ${y} W-2 is ready`,
        filename: `w2-${y}.pdf`,
        date: new Date(Date.UTC(y + 1, 0, 20)).toISOString(),
        bodyText: `Tax document W-2 year ${y} employee Pradhul Dev`,
        kind: 'important',
      }),
    );
  }

  for (let i = 0; i < 12; i++) {
    const bank = BANKS[i % BANKS.length];
    const d = new Date(now - i * 30 * 86400000);
    rows.push(
      makeDoc({
        id: `bank_${i}`,
        from: `${bank} <statements@${bank.split(' ')[0].toLowerCase()}.com>`,
        subject: `${bank} statement ready`,
        filename: `${bank.split(' ')[0].toLowerCase()}-stmt-${d.toISOString().slice(0, 7)}.pdf`,
        date: d.toISOString(),
        bodyText: `Bank account statement account CHK-441029 issuer ${bank} holder Pradhul Dev`,
        kind: 'important',
      }),
    );
  }

  // Pad important set lightly
  while (rows.filter((r) => r.kind === 'important').length < totalImportantApprox) {
    const n = rows.length;
    const insurer = INSURERS[n % INSURERS.length];
    rows.push(
      makeDoc({
        id: `extra_imp_${n}`,
        from: `${insurer} <mail@example.com>`,
        subject: `${insurer} document packet ${n}`,
        filename: `doc-${n}.pdf`,
        date: new Date(now - (n % 800) * 86400000).toISOString(),
        bodyText: `Insurance document policy REF-${1000 + n} holder Pradhul Dev`,
        kind: 'important',
      }),
    );
  }

  // Noise: promos, newsletters, logos (~2400)
  const target = 2500;
  let i = 0;
  while (rows.length < target) {
    i += 1;
    const d = new Date(now - (i % 2000) * 86400000).toISOString();
    if (i % 5 === 0) {
      rows.push(
        makeDoc({
          id: `promo_${i}`,
          from: 'Deals <deals@shop.example>',
          subject: `${(i % 70) + 10}% off spring sale — unsubscribe`,
          filename: `flyer-${i}.jpg`,
          date: d,
          size: 120_000,
          mimeType: 'image/jpeg',
          bodyText: 'Limited time offer newsletter marketing',
          kind: 'promo',
        }),
      );
    } else if (i % 5 === 1) {
      rows.push(
        makeDoc({
          id: `news_${i}`,
          from: 'Digest <news@newsletter.example>',
          subject: 'Weekly newsletter — top stories',
          filename: `newsletter-${i}.pdf`,
          date: d,
          bodyText: 'unsubscribe from this newsletter',
          kind: 'newsletter',
        }),
      );
    } else if (i % 5 === 2) {
      rows.push(
        makeDoc({
          id: `logo_${i}`,
          from: 'Brand <noreply@brand.example>',
          subject: 'Thanks for shopping',
          filename: `logo-${i}.png`,
          date: d,
          size: 2_400,
          mimeType: 'image/png',
          bodyText: 'logo',
          kind: 'logo',
        }),
      );
    } else {
      rows.push(
        makeDoc({
          id: `noise_${i}`,
          from: 'Random <photo@example.com>',
          subject: `Photo ${i}`,
          filename: `IMG_${i}.jpg`,
          date: d,
          size: 40_000 + (i % 20) * 1000,
          mimeType: 'image/jpeg',
          bodyText: 'vacation photo',
          kind: 'noise',
        }),
      );
    }
  }

  return rows;
}

function makeDoc(input: {
  id: string;
  from: string;
  subject: string;
  filename: string;
  date: string;
  bodyText: string;
  kind: MockMailboxMessage['kind'];
  size?: number;
  mimeType?: string;
}): MockMailboxMessage {
  return {
    messageId: `msg_${input.id}`,
    attachmentId: `att_${input.id}`,
    filename: input.filename,
    mimeType: input.mimeType || 'application/pdf',
    size: input.size ?? 180_000,
    subject: input.subject,
    from: input.from,
    date: input.date,
    snippet: input.bodyText.slice(0, 140),
    bodyText: input.bodyText,
    kind: input.kind,
  };
}

let cachedMailbox: MockMailboxMessage[] | null = null;

export function getLargeMockMailbox(): MockMailboxMessage[] {
  if (!cachedMailbox) cachedMailbox = buildLargeMockMailbox();
  return cachedMailbox;
}

/** After this many AI-like calls, mock provider throws 429 once per pause cycle. */
export const MOCK_QUOTA_EVERY_N_AI_CALLS = 8;
