import { VAULT_CATEGORIES, VAULT_ROOT_FOLDER, VaultCategory } from '../types/document';

export interface FolderNode {
  name: string;
  path: string;
  children: FolderNode[];
}

/** Build a tree of category folders under Document Vault. */
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
    { test: /vehicle|car|auto|motor|garage/, category: 'Insurance/Vehicle' },
    { test: /health|medical|dental|hospital/, category: 'Insurance/Health' },
    { test: /home.?owner|home.?insur|property.?insur|contents/, category: 'Insurance/Home' },
    { test: /life.?insur|term.?life/, category: 'Insurance/Life' },
    { test: /insur/, category: 'Insurance/Health' },
    { test: /bank|statement|account|iban|routing/, category: 'Banking' },
    { test: /tax|irs|hmrc|w-?2|1099|vat/, category: 'Tax' },
    { test: /passport|license|licence|id.?card|identity|ssn|aadhaar/, category: 'Identity' },
    { test: /bill|utility|electric|water|gas|internet|phone/, category: 'Bills' },
    { test: /warrant|guarantee|receipt/, category: 'Warranties' },
    { test: /travel|flight|hotel|itinerary|visa/, category: 'Travel' },
  ];

  for (const rule of rules) {
    if (rule.test.test(lower)) return rule.category;
  }
  return 'Other';
}
