import { VAULT_CATEGORIES, VAULT_ROOT_FOLDER, VaultCategory } from '../types/document';

export interface FolderNode {
  name: string;
  path: string;
  children: FolderNode[];
}

/** Build a tree of category folders under the Kadalas Drive root. */
export function buildFolderTree(): FolderNode {
  const root: FolderNode = { name: VAULT_ROOT_FOLDER, path: '', children: [] };
  const byPath = new Map<string, FolderNode>([['', root]]);

  for (const category of VAULT_CATEGORIES) {
    const parts = category.split('/');
    let parentPath = '';
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const path = parts.slice(0, i + 1).join('/');
      if (!byPath.has(path)) {
        const node: FolderNode = { name, path, children: [] };
        byPath.get(parentPath)!.children.push(node);
        byPath.set(path, node);
      }
      parentPath = path;
    }
  }

  return root;
}

export function isValidCategory(value: string): value is VaultCategory {
  return (VAULT_CATEGORIES as string[]).includes(value);
}

export function categoryLabel(category: VaultCategory): string {
  return category.replace(/\//g, ' · ');
}

export function parentCategory(category: VaultCategory): string | null {
  const parts = category.split('/');
  if (parts.length < 2) return null;
  return parts[0];
}

/** Heuristic: map free-text AI output to a known category. */
export function normalizeCategory(raw: string | undefined | null): VaultCategory {
  if (!raw) return 'Other';
  const cleaned = raw.trim().replace(/\\/g, '/');
  if (isValidCategory(cleaned)) return cleaned;

  const lower = cleaned.toLowerCase();

  const rules: Array<{ test: RegExp; category: VaultCategory }> = [
    // Vehicle — include Indian OD/TP wording before generic "insurance"
    {
      test: /vehicle|motor|car\s*insur|two.?wheeler|rc\s*book|puc\b|\bod\b|\btp\b|third\s*party|own\s*damage|chassis|registration\s*certificate/i,
      category: 'Insurance/Vehicle',
    },
    {
      test: /bajaj\s*allianz|hdfc\s*ergo|icici\s*lombard|acko|digit\s*insur|go\s*digit|new\s*india|national\s*insur/i,
      category: 'Insurance/Vehicle',
    },
    { test: /mediassist|health\s*insur|cashless|hospitalization|mediclaim/, category: 'Insurance/Health' },
    { test: /prescription|lab\s*report|discharge\s*summary|diagnostic|pathology|radiology/, category: 'Insurance/Health' },
    { test: /health|medical|dental|hospital/, category: 'Insurance/Health' },
    { test: /home.?owner|home.?insur|property.?insur|contents|house\s*insur/, category: 'Insurance/Home' },
    { test: /life.?insur|term\s*plan|term\s*life|lic\s*policy/, category: 'Insurance/Life' },
    { test: /insur/, category: 'Insurance/Health' },
  // Banking & credit
  {
    test: /bank\s*of\s*baroda|\bbob\b|hdfc|state\s*bank|\bsbi\b|icici|axis\s*bank|kotak|yes\s*bank|indusind|canara\s*bank|punjab\s*national|\bpnb\b/,
    category: 'Banking',
  },
    { test: /bank\s*statement|account\s*statement|passbook|loan\s*statement|neft|imps|upi\s*statement/, category: 'Banking' },
    { test: /credit\s*card|mastercard|visa\s*card|rupay|amex/, category: 'Bills' },
    { test: /bank|statement|account|iban|routing|fixed\s*deposit|\bfd\b/, category: 'Banking' },
  // Tax & salary
    { test: /form\s*16|form\s*16a|itr-?\d|26as|\bais\b|tds\s*certificate|income\s*tax|gst\s*return/, category: 'Tax' },
    { test: /salary\s*slip|payslip|pay\s*slip|ctc\s*letter|compensation\s*letter/, category: 'Tax' },
    { test: /tax|irs|hmrc|w-?2|1099|vat/, category: 'Tax' },
  // Identity
    {
      test: /aadhaar|aadhar|\bpan\b|passport|driving\s*licen|driver'?s\s*licen|\bdl\b|voter\s*id|election\s*card|voter\s*card/,
      category: 'Identity',
    },
    { test: /license|licence|id.?card|identity|ssn/, category: 'Identity' },
  // Bills & utilities
    {
      test: /electricity|bescom|mseb|tangedco|water\s*bill|gas\s*bill|broadband|dth|jio|airtel|vi\s*postpaid|utility\s*bill/,
      category: 'Bills',
    },
    { test: /bill|utility|electric|water|gas|internet|phone/, category: 'Bills' },
  // Receipts, invoices, warranties
    { test: /invoice|tax\s*invoice|e-?invoice|proforma/, category: 'Warranties' },
    { test: /warrant|guarantee|receipt|purchase\s*proof/, category: 'Warranties' },
  // Travel & tickets
    { test: /irctc|boarding\s*pass|pnr\b|flight\s*ticket|train\s*ticket|makemytrip|cleartrip|goibibo|hotel\s*confirm/, category: 'Travel' },
    { test: /travel|flight|hotel|itinerary|visa/, category: 'Travel' },
  ];

  for (const rule of rules) {
    if (rule.test.test(lower)) return rule.category;
  }
  return 'Other';
}
