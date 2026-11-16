import {
  INDEX_FILENAME,
  LEGACY_VAULT_ROOT_FOLDER,
  VAULT_CATEGORIES,
  VAULT_ROOT_FOLDER,
  VERSIONS_FOLDER,
  VaultCategory,
  VaultDocument,
  VaultIndex,
} from '../../types/document';
import { fetchWithTimeout } from '../../lib/fetchWithTimeout';
import { ORGANIZE_UNDO_FILENAME } from '../../types/organize';
import { ReviewState } from '../../types/review';
import { REVIEW_STATE_FILENAME } from '../../types/review';
import { SCAN_STATE_FILENAME, ScanJobState } from '../../types/scan';
import { getAuthService } from '../auth';
import { DriveFileRef, DriveService, UploadInput } from './types';

const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

async function authHeaders(): Promise<HeadersInit> {
  const token = await getAuthService().getValidAccessToken();
  return { Authorization: `Bearer ${token}` };
}

async function driveFetch(url: string, init: RequestInit = {}) {
  const headers = { ...(await authHeaders()), ...(init.headers || {}) };
  const res = await fetchWithTimeout(url, { ...init, headers });
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`Drive API ${res.status}: ${text}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  return res;
}

async function findFolder(name: string, parentId?: string): Promise<string | null> {
  const q = [
    `name = '${name.replace(/'/g, "\\'")}'`,
    `mimeType = 'application/vnd.google-apps.folder'`,
    'trashed = false',
    parentId ? `'${parentId}' in parents` : undefined,
  ]
    .filter(Boolean)
    .join(' and ');

  const res = await driveFetch(`${DRIVE}/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=5`);
  const data = (await res.json()) as { files?: Array<{ id: string }> };
  return data.files?.[0]?.id ?? null;
}

async function createFolder(name: string, parentId?: string): Promise<string> {
  const body: Record<string, unknown> = {
    name,
    mimeType: 'application/vnd.google-apps.folder',
  };
  if (parentId) body.parents = [parentId];

  const res = await driveFetch(`${DRIVE}/files?fields=id,name`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as { id: string };
  return data.id;
}

async function ensureFolder(name: string, parentId?: string): Promise<string> {
  const existing = await findFolder(name, parentId);
  if (existing) return existing;
  return createFolder(name, parentId);
}

export function createGoogleDriveService(): DriveService {
  let cache: { vaultFolderId: string; folderIdsByPath: Record<string, string>; indexFileId?: string } | null =
    null;

  async function ensureRootFolder(): Promise<string> {
    // Prefer existing "Kadalas"; fall back to legacy "Document Vault" for upgrades
    const modern = await findFolder(VAULT_ROOT_FOLDER);
    if (modern) return modern;
    const legacy = await findFolder(LEGACY_VAULT_ROOT_FOLDER);
    if (legacy) return legacy;
    return createFolder(VAULT_ROOT_FOLDER);
  }

  async function ensureStructure() {
    if (cache) return cache;
    const vaultFolderId = await ensureRootFolder();
    const folderIdsByPath: Record<string, string> = { '': vaultFolderId };

    for (const category of VAULT_CATEGORIES) {
      const parts = category.split('/');
      let parentId = vaultFolderId;
      let path = '';
      for (const part of parts) {
        path = path ? `${path}/${part}` : part;
        if (!folderIdsByPath[path]) {
          const id = await ensureFolder(part, parentId);
          folderIdsByPath[path] = id;
          parentId = id;
        } else {
          parentId = folderIdsByPath[path];
        }
      }
    }

    folderIdsByPath[VERSIONS_FOLDER] = await ensureFolder(VERSIONS_FOLDER, vaultFolderId);
    cache = { vaultFolderId, folderIdsByPath };
    return cache;
  }

  async function findIndexFile(vaultFolderId: string): Promise<string | null> {
    const q = `name = '${INDEX_FILENAME}' and '${vaultFolderId}' in parents and trashed = false`;
    const res = await driveFetch(`${DRIVE}/files?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1`);
    const data = (await res.json()) as { files?: Array<{ id: string }> };
    return data.files?.[0]?.id ?? null;
  }

  return {
    async ensureVaultStructure() {
      const s = await ensureStructure();
      return { vaultFolderId: s.vaultFolderId, folderIdsByPath: s.folderIdsByPath };
    },

    async loadIndex() {
      const s = await ensureStructure();
      const indexFileId = s.indexFileId || (await findIndexFile(s.vaultFolderId));
      if (!indexFileId) {
        const empty: VaultIndex = {
          version: 1,
          vaultFolderId: s.vaultFolderId,
          lastScanAt: null,
          documents: [],
          updatedAt: new Date().toISOString(),
        };
        return empty;
      }
      s.indexFileId = indexFileId;
      const res = await driveFetch(`${DRIVE}/files/${indexFileId}?alt=media`);
      return (await res.json()) as VaultIndex;
    },

    async saveIndex(index: VaultIndex) {
      const s = await ensureStructure();
      const body = JSON.stringify(index, null, 2);
      let indexFileId = s.indexFileId || (await findIndexFile(s.vaultFolderId));

      if (!indexFileId) {
        const metadata = {
          name: INDEX_FILENAME,
          parents: [s.vaultFolderId],
          mimeType: 'application/json',
        };
        const form = buildMultipart(metadata, body, 'application/json');
        const res = await driveFetch(`${UPLOAD}/files?uploadType=multipart&fields=id`, {
          method: 'POST',
          headers: { 'Content-Type': `multipart/related; boundary=${form.boundary}` },
          body: form.body,
        });
        const data = (await res.json()) as { id: string };
        s.indexFileId = data.id;
        return;
      }

      const res = await driveFetch(`${UPLOAD}/files/${indexFileId}?uploadType=media`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      await res.json();
    },

    async uploadFile(input: UploadInput) {
      const metadata = {
        name: input.name,
        parents: [input.parentFolderId],
        mimeType: input.mimeType,
      };
      // Binary-safe multipart: decode base64 to bytes (Gmail uses base64url → already
      // normalized to standard base64 by googleGmail.getAttachment).
      let boundary: string;
      let bodyInit: BodyInit;
      if (input.contentText != null) {
        const form = buildMultipart(metadata, input.contentText, input.mimeType);
        boundary = form.boundary;
        bodyInit = form.body;
      } else {
        const form = buildMultipartBinary(
          metadata,
          input.contentBase64 ? base64ToBytes(input.contentBase64) : new Uint8Array(0),
          input.mimeType,
        );
        boundary = form.boundary;
        // Copy into a plain ArrayBuffer so BlobPart typing accepts it.
        const copy = new ArrayBuffer(form.body.byteLength);
        new Uint8Array(copy).set(form.body);
        bodyInit = new Blob([copy]);
      }
      const res = await driveFetch(
        `${UPLOAD}/files?uploadType=multipart&fields=id,name,mimeType,webViewLink,size`,
        {
          method: 'POST',
          headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
          body: bodyInit,
        },
      );
      const uploaded = (await res.json()) as DriveFileRef;
      if (!uploaded?.id) {
        throw new Error('Drive upload returned no file id');
      }
      return uploaded;
    },

    async getFileParentId(fileId) {
      const meta = await driveFetch(`${DRIVE}/files/${fileId}?fields=parents`);
      const data = (await meta.json()) as { parents?: string[] };
      return data.parents?.[0];
    },

    async moveFile(fileId, newParentId, oldParentId) {
      let remove = oldParentId;
      if (!remove) {
        remove = await this.getFileParentId(fileId);
      }
      const params = new URLSearchParams({ addParents: newParentId, fields: 'id,parents' });
      if (remove) params.set('removeParents', remove);
      await driveFetch(`${DRIVE}/files/${fileId}?${params.toString()}`, { method: 'PATCH' });
    },

    async renameFile(fileId, newName) {
      await driveFetch(`${DRIVE}/files/${fileId}?fields=id,name`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName }),
      });
    },

    async getDownloadUrl(fileId) {
      return `${DRIVE}/files/${fileId}?alt=media`;
    },

    async getFolderIdForCategory(category: VaultCategory) {
      const s = await ensureStructure();
      return s.folderIdsByPath[category] || s.vaultFolderId;
    },

    async archiveToVersions(fileId, versionsFolderId) {
      await this.moveFile(fileId, versionsFolderId);
      const res = await driveFetch(`${DRIVE}/files/${fileId}?fields=id,name,mimeType,webViewLink`);
      return (await res.json()) as DriveFileRef;
    },

    async upsertDocument(doc: VaultDocument) {
      const index = await this.loadIndex();
      const idx = index.documents.findIndex((d) => d.id === doc.id);
      if (idx >= 0) index.documents[idx] = doc;
      else index.documents.push(doc);
      index.updatedAt = new Date().toISOString();
      await this.saveIndex(index);
      return index;
    },

    async saveScanState(state: ScanJobState | null) {
      const s = await ensureStructure();
      const existingId = await findNamedFile(s.vaultFolderId, SCAN_STATE_FILENAME);
      // Never trash/delete Drive files — overwrite scan-state.json with null or the new body.
      const body = state == null ? 'null' : JSON.stringify(state);
      if (!existingId) {
        if (state == null) return;
        const form = buildMultipart(
          { name: SCAN_STATE_FILENAME, parents: [s.vaultFolderId], mimeType: 'application/json' },
          body,
          'application/json',
        );
        await driveFetch(`${UPLOAD}/files?uploadType=multipart&fields=id`, {
          method: 'POST',
          headers: { 'Content-Type': `multipart/related; boundary=${form.boundary}` },
          body: form.body,
        });
        return;
      }
      await driveFetch(`${UPLOAD}/files/${existingId}?uploadType=media`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
    },

    async loadScanState() {
      const s = await ensureStructure();
      const id = await findNamedFile(s.vaultFolderId, SCAN_STATE_FILENAME);
      if (!id) return null;
      const res = await driveFetch(`${DRIVE}/files/${id}?alt=media`);
      const parsed: unknown = await res.json();
      if (parsed == null) return null;
      return parsed as ScanJobState;
    },

    async saveReviewState(state) {
      const s = await ensureStructure();
      const existingId = await findNamedFile(s.vaultFolderId, REVIEW_STATE_FILENAME);
      const body = JSON.stringify(state);
      // Never trash/delete — create once, then overwrite in place.
      if (!existingId) {
        const form = buildMultipart(
          { name: REVIEW_STATE_FILENAME, parents: [s.vaultFolderId], mimeType: 'application/json' },
          body,
          'application/json',
        );
        await driveFetch(`${UPLOAD}/files?uploadType=multipart&fields=id`, {
          method: 'POST',
          headers: { 'Content-Type': `multipart/related; boundary=${form.boundary}` },
          body: form.body,
        });
        return;
      }
      await driveFetch(`${UPLOAD}/files/${existingId}?uploadType=media`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
    },

    async loadReviewState() {
      const s = await ensureStructure();
      const id = await findNamedFile(s.vaultFolderId, REVIEW_STATE_FILENAME);
      if (!id) return null;
      const res = await driveFetch(`${DRIVE}/files/${id}?alt=media`);
      const parsed: unknown = await res.json();
      if (parsed == null) return null;
      return parsed as ReviewState;
    },

    async saveOrganizeUndo(state) {
      const s = await ensureStructure();
      const existingId = await findNamedFile(s.vaultFolderId, ORGANIZE_UNDO_FILENAME);
      const body = JSON.stringify(state);
      if (!existingId) {
        const form = buildMultipart(
          { name: ORGANIZE_UNDO_FILENAME, parents: [s.vaultFolderId], mimeType: 'application/json' },
          body,
          'application/json',
        );
        await driveFetch(`${UPLOAD}/files?uploadType=multipart&fields=id`, {
          method: 'POST',
          headers: { 'Content-Type': `multipart/related; boundary=${form.boundary}` },
          body: form.body,
        });
        return;
      }
      await driveFetch(`${UPLOAD}/files/${existingId}?uploadType=media`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
    },

    async loadOrganizeUndo() {
      const s = await ensureStructure();
      const id = await findNamedFile(s.vaultFolderId, ORGANIZE_UNDO_FILENAME);
      if (!id) return null;
      const res = await driveFetch(`${DRIVE}/files/${id}?alt=media`);
      const parsed: unknown = await res.json();
      if (parsed == null) return null;
      return parsed as import('../../types/organize').OrganizeUndoState;
    },
  };
}

async function findNamedFile(vaultFolderId: string, name: string): Promise<string | null> {
  const q = `name = '${name.replace(/'/g, "\\'")}' and '${vaultFolderId}' in parents and trashed = false`;
  const res = await driveFetch(`${DRIVE}/files?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1`);
  const data = (await res.json()) as { files?: Array<{ id: string }> };
  return data.files?.[0]?.id ?? null;
}

function buildMultipart(
  metadata: Record<string, unknown>,
  content: string,
  contentType: string,
): { boundary: string; body: string } {
  const boundary = `dv_boundary_${Date.now()}`;
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${contentType}\r\n\r\n` +
    `${content}\r\n` +
    `--${boundary}--`;
  return { boundary, body };
}

/** Binary-safe multipart body so PDF/image bytes are not corrupted by JS strings. */
function buildMultipartBinary(
  metadata: Record<string, unknown>,
  bytes: Uint8Array,
  contentType: string,
): { boundary: string; body: Uint8Array } {
  const boundary = `dv_boundary_${Date.now()}`;
  const encoder = new TextEncoder();
  const preamble = encoder.encode(
    `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`,
  );
  const ending = encoder.encode(`\r\n--${boundary}--`);
  const body = new Uint8Array(preamble.length + bytes.length + ending.length);
  body.set(preamble, 0);
  body.set(bytes, preamble.length);
  body.set(ending, preamble.length + bytes.length);
  return { boundary, body };
}

function base64ToBytes(b64: string): Uint8Array {
  const normalized = b64.replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, '');
  const bin = atobCompat(normalized);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 0xff;
  return out;
}

function atobCompat(b64: string): string {
  if (typeof globalThis.atob === 'function') return globalThis.atob(b64);
  // minimal polyfill for environments without atob
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  let str = '';
  let i = 0;
  const input = b64.replace(/=+$/, '');
  while (i < input.length) {
    const enc1 = chars.indexOf(input.charAt(i++));
    const enc2 = chars.indexOf(input.charAt(i++));
    const enc3 = chars.indexOf(input.charAt(i++));
    const enc4 = chars.indexOf(input.charAt(i++));
    const bitmap = (enc1 << 18) | (enc2 << 12) | (enc3 << 6) | enc4;
    str += String.fromCharCode((bitmap >> 16) & 255);
    if (enc3 !== 64) str += String.fromCharCode((bitmap >> 8) & 255);
    if (enc4 !== 64) str += String.fromCharCode(bitmap & 255);
  }
  return str;
}
