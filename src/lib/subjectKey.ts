import { DocumentMetadata, VaultCategory, VaultDocument } from '../types/document';

const SUBJECT_CONFIDENCE_THRESHOLD = 0.7;

export type SubjectKind =
  | 'vehicle'
  | 'policy_account'
  | 'person'
  | 'property'
  | 'device'
  | 'unknown';

export interface SubjectResolution {
  subjectKey: string | null;
  subjectLabel: string | null;
  kind: SubjectKind;
  confidence: number;
  ambiguous: boolean;
  /** Human-readable reasons for matching / ambiguity */
  reasons: string[];
}

/** Normalize registration plates / IDs for stable keys. */
export function normalizeIdentifier(value?: string | null): string {
  return (value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

export function normalizeRegistration(value?: string | null): string {
  return normalizeIdentifier(value);
}

/**
 * Build a stable subject key from extracted metadata.
 * Prefer durable entity ids (vehicle reg, chassis, property, serial)
 * over policy/account numbers that change on renewal / insurer switch.
 */
export function resolveSubjectKey(input: {
  category?: VaultCategory | string;
  metadata?: DocumentMetadata;
  title?: string;
}): SubjectResolution {
  const meta = input.metadata ?? {};
  const category = input.category ?? '';
  const reasons: string[] = [];

  const reg = normalizeRegistration(meta.registrationNumber);
  const chassis = normalizeIdentifier(meta.chassisNumber);
  const engine = normalizeIdentifier(meta.engineNumber);
  const makeModel = (meta.vehicleMakeModel ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  const property = (meta.propertyAddress ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  const serial = normalizeIdentifier(meta.deviceSerial);
  const holder = (meta.holderName ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  const ref = normalizeIdentifier(meta.referenceNumber);
  const docType = normalizeDocType(meta.documentType, category);

  // Category / document type must indicate vehicle — never treat a
  // hallucinated registration alone as proof this is a vehicle document.
  const isVehicle =
    category.startsWith('Insurance/Vehicle') ||
    /vehicle|motor|car|auto|rc\b|registration certificate|puc|pollution/i.test(
      `${meta.documentType ?? ''} ${input.title ?? ''}`,
    );

  if (isVehicle) {
    if (reg) {
      reasons.push('Vehicle registration');
      return {
        subjectKey: `vehicle:reg:${reg}`,
        subjectLabel: formatRegLabel(meta.registrationNumber!) || reg,
        kind: 'vehicle',
        confidence: 0.95,
        ambiguous: false,
        reasons,
      };
    }
    if (chassis) {
      reasons.push('Chassis / VIN fallback');
      return {
        subjectKey: `vehicle:chassis:${chassis}`,
        subjectLabel: `Chassis ${meta.chassisNumber}`,
        kind: 'vehicle',
        confidence: 0.85,
        ambiguous: false,
        reasons,
      };
    }
    if (engine && makeModel) {
      reasons.push('Engine + make/model fallback');
      return {
        subjectKey: `vehicle:engine_mm:${engine}:${normalizeIdentifier(makeModel)}`,
        subjectLabel: `${meta.vehicleMakeModel} (${meta.engineNumber})`,
        kind: 'vehicle',
        confidence: 0.72,
        ambiguous: false,
        reasons,
      };
    }
    if (makeModel && holder) {
      reasons.push('Make/model + holder — ambiguous without registration');
      return {
        subjectKey: `vehicle:weak:${normalizeIdentifier(makeModel)}:${normalizeIdentifier(holder)}`,
        subjectLabel: `${meta.vehicleMakeModel} · ${meta.holderName}`,
        kind: 'vehicle',
        confidence: 0.45,
        ambiguous: true,
        reasons,
      };
    }
    reasons.push('Vehicle document without durable subject identifiers');
    return {
      subjectKey: null,
      subjectLabel: null,
      kind: 'vehicle',
      confidence: 0.2,
      ambiguous: true,
      reasons,
    };
  }

  if (property && /home|property|rent|lease/i.test(`${category} ${meta.documentType ?? ''}`)) {
    reasons.push('Property address');
    return {
      subjectKey: `property:${normalizeIdentifier(property)}`,
      subjectLabel: meta.propertyAddress!,
      kind: 'property',
      confidence: 0.88,
      ambiguous: false,
      reasons,
    };
  }

  if (serial && /warrant|device|serial/i.test(`${category} ${meta.documentType ?? ''}`)) {
    reasons.push('Device serial');
    return {
      subjectKey: `device:${serial}`,
      subjectLabel: meta.deviceSerial!,
      kind: 'device',
      confidence: 0.9,
      ambiguous: false,
      reasons,
    };
  }

  // Health / identity / tax often keyed by person + doc type
  if (holder && (category === 'Insurance/Health' || category === 'Identity' || category === 'Tax')) {
    reasons.push('Holder + document type');
    return {
      subjectKey: `person:${normalizeIdentifier(holder)}:${docType}`,
      subjectLabel: `${meta.holderName} · ${meta.documentType || category}`,
      kind: 'person',
      confidence: 0.8,
      ambiguous: false,
      reasons,
    };
  }

  // Banking / bills / generic: account/reference is acceptable as subject
  // (unlike vehicle insurance where policy # churns)
  if (ref) {
    const issuer = normalizeIdentifier(meta.issuer);
    reasons.push('Account / reference number');
    return {
      subjectKey: `account:${issuer || 'unk'}:${ref}:${docType}`,
      subjectLabel: meta.referenceNumber!,
      kind: 'policy_account',
      confidence: issuer ? 0.78 : 0.65,
      ambiguous: !issuer,
      reasons,
    };
  }

  if (holder && meta.issuer) {
    reasons.push('Issuer + holder — weak subject');
    return {
      subjectKey: `weak:${normalizeIdentifier(meta.issuer)}:${normalizeIdentifier(holder)}:${docType}`,
      subjectLabel: `${meta.issuer} · ${meta.holderName}`,
      kind: 'unknown',
      confidence: 0.4,
      ambiguous: true,
      reasons,
    };
  }

  return {
    subjectKey: null,
    subjectLabel: null,
    kind: 'unknown',
    confidence: 0,
    ambiguous: true,
    reasons: ['Could not determine a stable subject key'],
  };
}

export function applySubjectToMetadata(
  metadata: DocumentMetadata,
  resolution: SubjectResolution,
): DocumentMetadata {
  return {
    ...metadata,
    subjectKey: resolution.subjectKey ?? undefined,
    subjectLabel: resolution.subjectLabel ?? undefined,
    subjectConfidence: String(resolution.confidence),
  };
}

export function isConfidentSubject(resolution: SubjectResolution): boolean {
  return Boolean(resolution.subjectKey) && !resolution.ambiguous && resolution.confidence >= SUBJECT_CONFIDENCE_THRESHOLD;
}

/** Group id = document-type family + subject key (not policy number alone). */
export function buildGroupId(docTypeFamily: string, subjectKey: string): string {
  return `${normalizeDocType(docTypeFamily)}::${subjectKey}`;
}

export function documentTypeFamily(category?: string, documentType?: string): string {
  if (category?.startsWith('Insurance/Vehicle') || /vehicle|motor/i.test(documentType ?? '')) {
    return 'vehicle_insurance';
  }
  if (category?.startsWith('Insurance/Health') || /health/i.test(documentType ?? '')) {
    return 'health_insurance';
  }
  if (category?.startsWith('Insurance/Home')) return 'home_insurance';
  if (category?.startsWith('Insurance/Life')) return 'life_insurance';
  if (category === 'Banking') return 'banking';
  if (category === 'Tax') return 'tax';
  if (category === 'Identity') return 'identity';
  if (category === 'Bills') return 'bills';
  if (category === 'Warranties') return 'warranties';
  if (category === 'Travel') return 'travel';
  return normalizeDocType(documentType, category);
}

export function subjectsMatch(
  a: { metadata?: DocumentMetadata; category?: string },
  b: { metadata?: DocumentMetadata; category?: string },
): boolean {
  const ra = resolveSubjectKey(a);
  const rb = resolveSubjectKey(b);
  if (!ra.subjectKey || !rb.subjectKey) return false;
  if (ra.subjectKey !== rb.subjectKey) return false;
  const fa = documentTypeFamily(a.category, a.metadata?.documentType);
  const fb = documentTypeFamily(b.category, b.metadata?.documentType);
  return fa === fb;
}

/** Find an existing vault document that shares the same entity subject (not merely policy #). */
export function findVaultDocumentBySubject(
  documents: VaultDocument[],
  candidate: { metadata?: DocumentMetadata; category?: string },
): VaultDocument | undefined {
  const resolved = resolveSubjectKey(candidate);
  if (!resolved.subjectKey || resolved.ambiguous) return undefined;
  const family = documentTypeFamily(candidate.category, candidate.metadata?.documentType);

  return documents.find((doc) => {
    const existingKey =
      doc.metadata.subjectKey ||
      resolveSubjectKey({ category: doc.category, metadata: doc.metadata }).subjectKey;
    if (!existingKey || existingKey !== resolved.subjectKey) return false;
    return documentTypeFamily(doc.category, doc.metadata.documentType) === family;
  });
}

function normalizeDocType(documentType?: string, category?: string): string {
  const raw = (documentType || category || 'document').toLowerCase();
  return raw.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'document';
}

function formatRegLabel(value: string): string {
  // Preserve dashes if present; otherwise return compact form with light spacing hints
  if (/[-\s]/.test(value)) return value.toUpperCase().replace(/\s+/g, '-');
  return value.toUpperCase();
}

export { SUBJECT_CONFIDENCE_THRESHOLD };
