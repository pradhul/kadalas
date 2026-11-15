#!/usr/bin/env node
/**
 * After `expo export --platform web`, ensure Netlify (and similar) SPA fallback
 * so client-side routes resolve to index.html.
 */
import { mkdirSync, writeFileSync, existsSync, cpSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const dist = join(root, 'dist');

if (!existsSync(dist)) {
  console.error('dist/ missing — run expo export --platform web first');
  process.exit(1);
}

const redirects = '/*    /index.html   200\n';
writeFileSync(join(dist, '_redirects'), redirects, 'utf8');

// Also drop a copy under public/ so future exports that merge public/ keep it.
const publicDir = join(root, 'public');
mkdirSync(publicDir, { recursive: true });
writeFileSync(join(publicDir, '_redirects'), redirects, 'utf8');

const listing = readdirSync(dist).slice(0, 20).join(', ');
console.log(`Prepared web dist with SPA fallback (_redirects). Entries: ${listing}`);
