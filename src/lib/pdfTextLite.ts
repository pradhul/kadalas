/**
 * Best-effort PDF text extraction without requiring pdf.js.
 * Pulls literal strings from uncompressed PDF content streams.
 */
function base64ToBinary(dataBase64: string): string {
  if (typeof atob === 'function') return atob(dataBase64);
  // Node/jest fallback without @types/node Buffer globals
  // eslint-disable-next-line no-undef
  const Buf = (globalThis as { Buffer?: { from: (s: string, enc: string) => { toString: (e: string) => string } } }).Buffer;
  if (Buf) return Buf.from(dataBase64, 'base64').toString('binary');
  return '';
}

export function extractPdfTextLite(dataBase64: string, maxChars = 6000): string {
  try {
    const binary = base64ToBinary(dataBase64);
    const chunks: string[] = [];
    const re = /\((?:\\.|[^\\)]){2,200}\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(binary))) {
      let s = m[0].slice(1, -1);
      s = s
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '')
        .replace(/\\t/g, ' ')
        .replace(/\\\(/g, '(')
        .replace(/\\\)/g, ')')
        .replace(/\\\\/g, '\\');
      if (/[A-Za-z0-9]/.test(s)) chunks.push(s);
      if (chunks.join(' ').length >= maxChars) break;
    }
    return chunks.join(' ').replace(/\s+/g, ' ').trim().slice(0, maxChars);
  } catch {
    return '';
  }
}

/** Prefer lite extractor; pdf.js is optional and loaded only when the module exists. */
export async function extractPdfText(dataBase64: string): Promise<string> {
  try {
    // Dynamic string keeps tsc from requiring pdfjs-dist types when absent
    const modName = 'pdfjs-dist';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdfjs: any = await (0, eval)(`import('${modName}')`).catch(() => null);
    if (pdfjs?.getDocument) {
      const binary = base64ToBinary(dataBase64);
      const data = Uint8Array.from(binary, (c) => c.charCodeAt(0));
      const doc = await pdfjs.getDocument({ data }).promise;
      const pages = Math.min(doc.numPages || 1, 2);
      const parts: string[] = [];
      for (let i = 1; i <= pages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        const text = (content.items || [])
          .map((it: { str?: string }) => it.str || '')
          .join(' ');
        parts.push(text);
      }
      const joined = parts.join('\n').replace(/\s+/g, ' ').trim();
      if (joined) return joined.slice(0, 8000);
    }
  } catch {
    /* fall through */
  }
  return extractPdfTextLite(dataBase64);
}
