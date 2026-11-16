import { VaultDocument, VaultIndex } from '../types/document';
import { applySubjectToMetadata, resolveSubjectKey } from './subjectKey';
import {
  DEMO_VEHICLE_SUBJECT_KEYS,
  isDemoVehiclePlate,
  isDemoVehicleSubjectKey,
} from './subjectSuggestions';

/**
 * Re-key vault index docs that were approved with fake demo plates
 * (KA01AB1234 / MH12XY9876 / …) when this is not a mock vault.
 * Overwrites index metadata only — never deletes Drive files.
 */
export function rekeyDemoVehicleSubjects(
  index: VaultIndex,
  isMockVault: boolean,
): { index: VaultIndex; changed: boolean; rekeyedIds: string[] } {
  if (isMockVault) {
    return { index, changed: false, rekeyedIds: [] };
  }

  const rekeyedIds: string[] = [];
  const documents = index.documents.map((doc) => {
    const next = rekeyOneDocument(doc);
    if (next !== doc) rekeyedIds.push(doc.id);
    return next;
  });

  if (!rekeyedIds.length) {
    return { index, changed: false, rekeyedIds };
  }

  return {
    index: {
      ...index,
      documents,
      updatedAt: new Date().toISOString(),
    },
    changed: true,
    rekeyedIds,
  };
}

function rekeyOneDocument(doc: VaultDocument): VaultDocument {
  const meta = doc.metadata;
  const contaminated =
    isDemoVehicleSubjectKey(meta.subjectKey) ||
    isDemoVehiclePlate(meta.registrationNumber) ||
    (DEMO_VEHICLE_SUBJECT_KEYS as readonly string[]).includes(meta.subjectKey || '');

  if (!contaminated) return doc;

  const cleaned = { ...meta };
  if (isDemoVehiclePlate(cleaned.registrationNumber)) {
    delete cleaned.registrationNumber;
  }
  if (isDemoVehicleSubjectKey(cleaned.subjectKey)) {
    delete cleaned.subjectKey;
    delete cleaned.subjectLabel;
    delete cleaned.subjectConfidence;
  }
  // Strip vehicle-only coverage fields when the doc is not vehicle insurance
  const isVehicleCat =
    doc.category.startsWith('Insurance/Vehicle') ||
    /vehicle|motor/i.test(cleaned.documentType ?? '');
  if (!isVehicleCat) {
    delete cleaned.coverageType;
    delete cleaned.coverageSlots;
    delete cleaned.chassisNumber;
    delete cleaned.engineNumber;
    delete cleaned.vehicleMakeModel;
  }

  const resolution = resolveSubjectKey({
    category: doc.category,
    metadata: cleaned,
    title: doc.title,
  });
  const nextMeta = applySubjectToMetadata(cleaned, resolution);

  return {
    ...doc,
    metadata: nextMeta,
    updatedAt: new Date().toISOString(),
  };
}
