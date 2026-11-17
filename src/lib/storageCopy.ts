import { StorageMode } from '../types/settings';

/** User-facing copy that must match the active storage mode. */
export function approveExplainer(mode: StorageMode): string {
  if (mode === 'gmail_index') {
    return 'Approve = add to your vault as a link to the Gmail attachment. Nothing is copied or deleted. Skip = hide it; restore anytime.';
  }
  return 'Approve = copy the attachment into Google Drive › Kadalas (by category). Nothing in Gmail is deleted. Skip = hide it; restore anytime.';
}

export function approveExplainerShort(mode: StorageMode): string {
  if (mode === 'gmail_index') {
    return 'Approve adds a Gmail link to your vault. Nothing is copied or deleted.';
  }
  return 'Approve copies the file into Drive › Kadalas. Nothing in Gmail is deleted.';
}

export function vaultSafetyLine(mode: StorageMode): string {
  if (mode === 'gmail_index') {
    return 'Approved documents are Gmail links in your vault index (tiny JSON in Drive). Closing the app is safe — nothing is deleted from Gmail.';
  }
  return 'Everything you approve is saved in your Google Drive (Kadalas folder). Closing the app is safe.';
}

export function toastApprovedMessage(mode: StorageMode, title: string): string {
  if (mode === 'gmail_index') {
    return `Approved · ${title} saved as Gmail link`;
  }
  return `Approved · ${title} saved to Drive`;
}

export function willSaveLabel(mode: StorageMode, folderPath?: string): string {
  if (mode === 'gmail_index') return 'Will index as Gmail link';
  return `Will save to Drive › Kadalas/${folderPath || 'Other'}`;
}
