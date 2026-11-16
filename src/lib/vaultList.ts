import {
  VAULT_CATEGORIES,
  VaultCategory,
  VaultDocument,
  VaultIndex,
} from '../types/document';
import { versionStorageKind } from './storageKind';
import { getCurrentVersion } from './versioning';
import { plainDisplayText } from './reviewLabels';
import { categoryLabel } from './folders';

export type StorageBadge = 'Gmail' | 'Drive' | 'On device';

export type VaultListItem = {
  id: string;
  title: string;
  category: VaultCategory;
  categoryLabel: string;
  date: string;
  sender?: string;
  storageBadges: StorageBadge[];
  expiryDate?: string;
  document: VaultDocument;
};

/** Soft match for Salary / Medical rows that live under Tax / Insurance / Other. */
function matchesSalary(item: VaultListItem): boolean {
  const hay = `${item.title} ${item.document.metadata.documentType || ''}`.toLowerCase();
  return /salary|payslip|pay\s*slip|wage/.test(hay);
}

function matchesMedical(item: VaultListItem): boolean {
  const hay = `${item.title} ${item.document.metadata.documentType || ''}`.toLowerCase();
  return /medical|hospital|lab\s*report|prescription|health\s*record/.test(hay);
}

/** Display group ids shown on My documents (Insurance nests Vehicle/Health/Life). */
export const DOCUMENT_LIST_GROUPS = [
  'Recent',
  'Banking',
  'Insurance',
  'IDs',
  'Tax',
  'Bills',
  'Travel',
  'Salary',
  'Medical',
  'Warranties',
  'Other',
] as const;

export function listDocumentsFromIndex(index: VaultIndex | null | undefined): VaultDocument[] {
  if (!index?.documents?.length) return [];
  // Include every index entry regardless of storage mode / empty driveFileId
  return [...index.documents];
}

export function documentDisplayTitle(doc: VaultDocument): string {
  const issuer = plainDisplayText(doc.metadata.issuer);
  const docType = plainDisplayText(doc.metadata.documentType);
  if (issuer && docType) return `${issuer} ${docType}`;
  if (plainDisplayText(doc.title)) return doc.title.trim();
  const ver = getCurrentVersion(doc);
  if (ver?.fileName) return ver.fileName.replace(/\.[^.]+$/, '');
  return 'Untitled document';
}

export function documentSender(doc: VaultDocument): string | undefined {
  const ver = getCurrentVersion(doc);
  return plainDisplayText(ver?.gmailFrom) || plainDisplayText(doc.metadata.issuer);
}

export function documentDate(doc: VaultDocument): string {
  const ver = getCurrentVersion(doc);
  return ver?.gmailDate || ver?.createdAt || doc.updatedAt || doc.createdAt;
}

export function documentStorageBadges(
  doc: VaultDocument,
  opts?: { offline?: boolean },
): StorageBadge[] {
  const ver = getCurrentVersion(doc);
  const badges: StorageBadge[] = [];
  const kind = versionStorageKind(ver);
  if (kind === 'gmail_index' || (ver?.gmailMessageId && !ver.driveFileId)) badges.push('Gmail');
  if (ver?.driveFileId) badges.push('Drive');
  if (opts?.offline) badges.push('On device');
  if (!badges.length) badges.push(kind === 'gmail_index' ? 'Gmail' : 'Drive');
  return badges;
}

export function toVaultListItem(
  doc: VaultDocument,
  opts?: { offline?: boolean },
): VaultListItem {
  return {
    id: doc.id,
    title: documentDisplayTitle(doc),
    category: doc.category,
    categoryLabel: categoryLabel(doc.category),
    date: documentDate(doc),
    sender: documentSender(doc),
    storageBadges: documentStorageBadges(doc, opts),
    expiryDate: doc.metadata.expiryDate || doc.metadata.renewalDate,
    document: doc,
  };
}

export function buildVaultList(
  index: VaultIndex | null | undefined,
  opts?: {
    query?: string;
    category?: VaultCategory | 'all';
    offlineIds?: Set<string>;
  },
): VaultListItem[] {
  const q = (opts?.query || '').trim().toLowerCase();
  const cat = opts?.category || 'all';
  let docs = listDocumentsFromIndex(index);
  if (cat !== 'all') docs = docs.filter((d) => d.category === cat);
  let items = docs.map((d) =>
    toVaultListItem(d, { offline: opts?.offlineIds?.has(d.id) }),
  );
  if (q) {
    items = items.filter((item) => {
      const hay = [
        item.title,
        item.sender,
        item.categoryLabel,
        item.document.metadata.referenceNumber,
        item.document.metadata.holderName,
        getCurrentVersion(item.document)?.fileName,
        getCurrentVersion(item.document)?.gmailSubject,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }
  return items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

export function groupVaultList(items: VaultListItem[]): Array<{
  id: string;
  label: string;
  count: number;
  items: VaultListItem[];
}> {
  const groups: Array<{ id: string; label: string; count: number; items: VaultListItem[] }> = [];
  const claimed = new Set<string>();
  const take = (id: string, label: string, pick: (i: VaultListItem) => boolean) => {
    const inGroup = items.filter((i) => !claimed.has(i.id) && pick(i));
    if (!inGroup.length) return;
    for (const i of inGroup) claimed.add(i.id);
    groups.push({ id, label, count: inGroup.length, items: inGroup });
  };

  // Recent is a short preview of newest docs; they still appear again under their category.
  const recent = items.slice(0, 6);
  if (recent.length) {
    groups.push({ id: 'recent', label: 'Recent', count: recent.length, items: recent });
  }

  // Soft groups first so Salary/Medical don't drown in Tax / Insurance
  take('Salary', 'Salary', matchesSalary);
  take('Medical', 'Medical', matchesMedical);
  take('Banking', 'Banking', (i) => i.category === 'Banking');
  take(
    'Insurance',
    'Insurance',
    (i) =>
      i.category === 'Insurance/Vehicle' ||
      i.category === 'Insurance/Health' ||
      i.category === 'Insurance/Home' ||
      i.category === 'Insurance/Life',
  );
  take('Identity', 'IDs', (i) => i.category === 'Identity');
  take('Tax', 'Tax', (i) => i.category === 'Tax');
  take('Bills', 'Bills', (i) => i.category === 'Bills');
  take('Travel', 'Travel', (i) => i.category === 'Travel');
  take('Warranties', 'Warranties', (i) => i.category === 'Warranties');
  take('Other', 'Other', (i) => i.category === 'Other' || !claimed.has(i.id));

  return groups;
}

export function categoryCounts(index: VaultIndex | null | undefined): Record<VaultCategory, number> {
  const map = {} as Record<VaultCategory, number>;
  for (const c of VAULT_CATEGORIES) map[c] = 0;
  for (const doc of listDocumentsFromIndex(index)) {
    map[doc.category] = (map[doc.category] || 0) + 1;
  }
  return map;
}
