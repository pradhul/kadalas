/** Map provider test failures to short Settings copy. */
export function friendlyTestKeyMessage(err: unknown): string {
  const status = err && typeof err === 'object' ? (err as { status?: number }).status : undefined;
  const msg = err instanceof Error ? err.message : String(err ?? '');
  const lower = msg.toLowerCase();

  const looksLikeBadKey =
    lower.includes('api key not valid') ||
    lower.includes('api_key_invalid') ||
    lower.includes('invalid api key') ||
    lower.includes('incorrect api key') ||
    lower.includes('key not valid') ||
    (status === 400 && (lower.includes('api key') || lower.includes('api_key')));

  if (looksLikeBadKey) {
    return 'Key rejected — copy it again from AI Studio';
  }

  if (status === 404 || /\b404\b/.test(lower) || lower.includes('not_found') || lower.includes('is not found')) {
    return 'Model unavailable — update app';
  }

  if (
    status === 429 ||
    /\b429\b/.test(lower) ||
    lower.includes('resource_exhausted') ||
    lower.includes('rate limit') ||
    lower.includes('quota')
  ) {
    return 'Free quota used up, try later';
  }

  if (msg.length > 160) return `${msg.slice(0, 157)}…`;
  return msg || 'Key test failed';
}
