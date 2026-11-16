/** Strip scripts, event handlers, and remote images from Gmail HTML for safe preview. */
export function sanitizeEmailHtml(html: string): string {
  if (!html) return '';
  let out = html;
  // Remove script/style/iframe/object
  out = out.replace(/<\/?(script|iframe|object|embed|link|meta)[^>]*>/gi, '');
  out = out.replace(/<style[\s\S]*?<\/style>/gi, '');
  // Neutralize on* handlers
  out = out.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  // Block remote images — keep cid: and data: only
  out = out.replace(
    /<img\b([^>]*?)>/gi,
    (_full, attrs: string) => {
      const srcMatch = /\bsrc\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
      const src = (srcMatch?.[2] || srcMatch?.[3] || srcMatch?.[4] || '').trim();
      if (/^(cid:|data:)/i.test(src)) {
        return `<img ${attrs}>`;
      }
      return `<span data-blocked-image="1" style="display:inline-block;padding:4px 8px;background:#eee;color:#666;font-size:12px">[image blocked]</span>`;
    },
  );
  // javascript: URLs
  out = out.replace(/\shref\s*=\s*("|')\s*javascript:[^"']*\1/gi, ' href="#"');
  return out;
}

export function gmailPermalink(messageId: string): string {
  return `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(messageId)}`;
}
