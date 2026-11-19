/**
 * Gmail address normalization. Dots in the local part and +tags are ignored by Gmail
 * for @gmail.com / @googlemail.com — never require an exact To: match against the
 * signed-in address string.
 */

export function extractEmailAddress(value?: string | null): string | null {
  if (!value) return null;
  const m = value.match(/[\w.+-]+@[\w.-]+\.\w+/);
  return m ? m[0].toLowerCase() : null;
}

/** Strip +tag and dots from gmail/googlemail local parts. */
export function normalizeGmailAddress(value?: string | null): string | null {
  const email = extractEmailAddress(value);
  if (!email) return null;
  const [local, domainRaw] = email.split('@');
  if (!local || !domainRaw) return email;
  const domain = domainRaw.toLowerCase();
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    const withoutPlus = local.split('+')[0] || local;
    return `${withoutPlus.replace(/\./g, '')}@gmail.com`;
  }
  return email;
}

/** True when two addresses are the same mailbox (Gmail-dot-insensitive). */
export function gmailAddressesMatch(a?: string | null, b?: string | null): boolean {
  const left = normalizeGmailAddress(a);
  const right = normalizeGmailAddress(b);
  if (!left || !right) return false;
  return left === right;
}
