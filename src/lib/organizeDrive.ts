import { classifyWithRules } from './categorisation';
import { getCurrentVersion } from './versioning';
import { VAULT_CATEGORIES, VaultCategory, VaultDocument, VaultIndex } from '../types/document';
import {
  emptyOrganizeUndo,
  OrganizeUndoMove,
  OrganizeUndoState,
} from '../types/organize';
import { DriveService } from '../services/drive/types';

export interface VaultDriveFile {
  docId: string;
  driveFileId: string;
  fileName: string;
  fromPath: string;
  category: VaultCategory;
}

export interface ProposedMove {
  docId: string;
  fromPath: string;
  toCategory: VaultCategory;
  reason: string;
  driveFileId: string;
}

export function listVaultDriveFiles(documents: VaultDocument[]): VaultDriveFile[] {
  const out: VaultDriveFile[] = [];
  for (const doc of documents) {
    const ver = getCurrentVersion(doc);
    if (!ver?.driveFileId) continue;
    out.push({
      docId: doc.id,
      driveFileId: ver.driveFileId,
      fileName: ver.fileName,
      fromPath: doc.driveFolderPath,
      category: doc.category,
    });
  }
  return out;
}

function resolveTargetCategory(doc: VaultDocument): { category: VaultCategory; reason?: string } {
  const ver = getCurrentVersion(doc);
  const rules = classifyWithRules({
    subject: doc.title,
    fileName: ver?.fileName,
    textExcerpt: [
      doc.title,
      doc.metadata.documentType,
      doc.metadata.issuer,
      doc.metadata.referenceNumber,
    ]
      .filter(Boolean)
      .join('\n'),
  });

  if (doc.category !== 'Other' && rules.category === 'Other') {
    return { category: doc.category };
  }
  if (rules.category !== 'Other' && (doc.category === 'Other' || rules.category !== doc.category)) {
    return {
      category: rules.category,
      reason: rules.reason ?? 'Rule-based reclassification',
    };
  }
  return { category: doc.category };
}

/** Propose Drive folder moves when files sit outside their target category folder. */
export function proposeMoves(documents: VaultDocument[]): ProposedMove[] {
  const moves: ProposedMove[] = [];
  for (const doc of documents) {
    const ver = getCurrentVersion(doc);
    if (!ver?.driveFileId) continue;

    const { category: toCategory, reason: reclassReason } = resolveTargetCategory(doc);
    const fromPath = doc.driveFolderPath;
    if (fromPath === toCategory) continue;

    const reason =
      reclassReason && doc.category !== toCategory
        ? `${reclassReason}; move from ${fromPath} → ${toCategory}`
        : `Indexed in ${toCategory} but Drive folder is ${fromPath}`;

    moves.push({
      docId: doc.id,
      fromPath,
      toCategory,
      reason,
      driveFileId: ver.driveFileId,
    });
  }
  return moves;
}

export interface ApplyMovesResult {
  applied: number;
  index: VaultIndex;
  undo: OrganizeUndoState;
}

/** Move files via Drive addParents/removeParents only; update vault index; store undo blob. */
export async function applyMoves(
  drive: DriveService,
  index: VaultIndex,
  moves: ProposedMove[],
): Promise<ApplyMovesResult> {
  const undoMoves: OrganizeUndoMove[] = [];
  const nextIndex = structuredClone(index);

  for (const move of moves) {
    const toParentId = await drive.getFolderIdForCategory(move.toCategory);
    const fromParentId =
      (await drive.getFileParentId(move.driveFileId)) ??
      (isCategoryPath(move.fromPath) ? await drive.getFolderIdForCategory(move.fromPath) : undefined);

    await drive.moveFile(move.driveFileId, toParentId, fromParentId);

    const docIdx = nextIndex.documents.findIndex((d) => d.id === move.docId);
    if (docIdx >= 0) {
      nextIndex.documents[docIdx] = {
        ...nextIndex.documents[docIdx],
        category: move.toCategory,
        driveFolderPath: move.toCategory,
        updatedAt: new Date().toISOString(),
      };
    }

    undoMoves.push({
      docId: move.docId,
      driveFileId: move.driveFileId,
      fromParentId: fromParentId ?? toParentId,
      toParentId,
      fromPath: move.fromPath,
      toCategory: move.toCategory,
    });
  }

  nextIndex.updatedAt = new Date().toISOString();
  await drive.saveIndex(nextIndex);

  const undo: OrganizeUndoState = {
    version: 1,
    moves: undoMoves,
    appliedAt: new Date().toISOString(),
  };
  await drive.saveOrganizeUndo(undo);

  return { applied: undoMoves.length, index: nextIndex, undo };
}

function isCategoryPath(path: string): path is VaultCategory {
  return (VAULT_CATEGORIES as string[]).includes(path);
}

export async function undoLastOrganize(
  drive: DriveService,
  index: VaultIndex,
): Promise<{ restored: number; index: VaultIndex }> {
  const undo = (await drive.loadOrganizeUndo()) ?? emptyOrganizeUndo();
  if (!undo.moves.length) {
    return { restored: 0, index };
  }

  const nextIndex = structuredClone(index);
  for (const move of undo.moves) {
    await drive.moveFile(move.driveFileId, move.fromParentId, move.toParentId);
    const docIdx = nextIndex.documents.findIndex((d) => d.id === move.docId);
    if (docIdx >= 0) {
      const priorCategory = isCategoryPath(move.fromPath)
        ? move.fromPath
        : nextIndex.documents[docIdx].category;
      nextIndex.documents[docIdx] = {
        ...nextIndex.documents[docIdx],
        driveFolderPath: move.fromPath,
        category: priorCategory,
        updatedAt: new Date().toISOString(),
      };
    }
  }
  nextIndex.updatedAt = new Date().toISOString();
  await drive.saveIndex(nextIndex);
  await drive.saveOrganizeUndo(emptyOrganizeUndo());

  return { restored: undo.moves.length, index: nextIndex };
}

export async function hasOrganizeUndo(drive: DriveService): Promise<boolean> {
  const undo = (await drive.loadOrganizeUndo()) ?? emptyOrganizeUndo();
  return undo.moves.length > 0;
}