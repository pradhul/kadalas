import { classifyWithRules, shouldConsiderAttachment } from '../../lib/categorisation';
import {
  applyCoverageMetadata,
  detectCoverageTypeFromText,
} from '../../lib/coverageSlots';
import { isNewerVersion, scoreDocumentMatch } from '../../lib/matching';
import { applySubjectToMetadata, resolveSubjectKey } from '../../lib/subjectKey';
import { documentTypeFamily } from '../../lib/subjectKey';
import { AiProvider, TriageItemInput, TriageItemResult } from './types';

const REG_RE =
  /\b([A-Z]{2}[-\s]?\d{1,2}[-\s]?[A-Z]{1,3}[-\s]?\d{1,4})\b/i;
const CHASSIS_RE = /chassis(?:\s*(?:no\.?|number|#|:))?\s*([A-Z0-9-]{6,})/i;
const ENGINE_RE = /engine(?:\s*(?:no\.?|number|#|:))?\s*([A-Z0-9-]{5,})/i;
const MAKE_RE = /make\s+([A-Za-z0-9]+(?:\s+[A-Za-z0-9]+)?)/i;

function enrichFromText(
  base: ReturnType<typeof classifyWithRules>,
  text: string,
): ReturnType<typeof classifyWithRules> {
  const metadata = { ...base.metadata };
  const reg = REG_RE.exec(text);
  if (reg) metadata.registrationNumber = reg[1].toUpperCase().replace(/\s+/g, '-');
  const chassis = CHASSIS_RE.exec(text);
  if (chassis) metadata.chassisNumber = chassis[1].toUpperCase();
  const engine = ENGINE_RE.exec(text);
  if (engine) metadata.engineNumber = engine[1].toUpperCase();
  const make = MAKE_RE.exec(text);
  if (make) metadata.vehicleMakeModel = make[1];

  // Pull expiry/issue if present as ISO in text
  const dates = [...text.matchAll(/\b(20\d{2}-\d{2}-\d{2})\b/g)].map((m) => m[1]);
  if (dates[0] && !metadata.issueDate) metadata.issueDate = dates[0];
  if (/expir/i.test(text) && dates.length) metadata.expiryDate = dates[dates.length - 1];

  if (documentTypeFamily(base.category, metadata.documentType) === 'vehicle_insurance') {
    const cov = detectCoverageTypeFromText(text);
    Object.assign(metadata, applyCoverageMetadata(metadata, cov === 'unknown' ? 'comprehensive' : cov));
  }

  const resolution = resolveSubjectKey({
    category: base.category,
    metadata,
    title: base.title,
  });
  const withSubject = applySubjectToMetadata(metadata, resolution);

  const covLabel =
    withSubject.coverageType === 'od_only'
      ? 'OD'
      : withSubject.coverageType === 'tp_only'
        ? 'TP'
        : withSubject.coverageType === 'comprehensive'
          ? 'Package'
          : 'policy';

  return {
    ...base,
    metadata: withSubject,
    title:
      resolution.subjectLabel && base.category.startsWith('Insurance/Vehicle')
        ? `${withSubject.issuer || 'Vehicle'} ${covLabel} · ${resolution.subjectLabel}`
        : base.title,
  };
}

export function createMockAiProvider(): AiProvider {
  return {
    id: 'mock',
    displayName: 'Mock AI (offline)',

    async classifyDocument(input) {
      const text = [input.subject, input.from, input.fileName, input.textExcerpt].filter(Boolean).join(' ');
      // Decode mock PDF payload hints when present
      let excerpt = input.textExcerpt || '';
      if (input.dataBase64) {
        try {
          const raw =
            typeof globalThis.atob === 'function'
              ? globalThis.atob(input.dataBase64)
              : input.dataBase64;
          excerpt = `${excerpt} ${raw}`;
        } catch {
          // ignore
        }
      }
      const result = classifyWithRules({
        subject: input.subject,
        from: input.from,
        fileName: input.fileName,
        mimeType: input.mimeType,
        textExcerpt: excerpt || text,
      });
      const enriched = enrichFromText(result, `${text} ${excerpt}`);
      return { ...enriched, confidence: Math.max(enriched.confidence, 0.75) };
    },

    async confirmVersion({ existing, candidate }) {
      const classification = await this.classifyDocument({
        fileName: candidate.fileName || 'attachment.pdf',
        mimeType: 'application/pdf',
        textExcerpt: candidate.textExcerpt,
        subject: candidate.title,
      });
      const match = scoreDocumentMatch(existing, {
        title: candidate.title || classification.title,
        metadata: candidate.metadata || classification.metadata,
        category: classification.category,
      });
      const currentDate =
        existing.metadata.issueDate || existing.metadata.expiryDate || new Date(0).toISOString();
      const candidateDate = candidate.emailDate || candidate.metadata?.issueDate || new Date().toISOString();
      return {
        isSamePolicy: match.isLikelySame,
        isNewer: isNewerVersion(currentDate, candidateDate),
        confidence: match.score,
        reason: match.reasons.join('; ') || 'Mock comparison',
        classification,
      };
    },

    async triageBatch(items: TriageItemInput[]): Promise<TriageItemResult[]> {
      return items.map((item) => {
        const att = item.attachment;
        const keep = shouldConsiderAttachment({
          subject: att.subject,
          from: att.from,
          fileName: att.filename,
          mimeType: att.mimeType,
          snippet: att.snippet,
        });
        const hay = `${att.subject} ${att.from} ${att.filename} ${att.snippet}`;
        const strong =
          /policy|statement|invoice|tax|passport|warranty|insurance|registration|w-?2|renewal/i.test(
            hay,
          );
        const isLikelyImportant = keep && strong;
        return {
          id: item.id,
          isLikelyImportant,
          confidence: isLikelyImportant ? 0.82 : 0.2,
          reason: isLikelyImportant ? 'Document keywords in metadata' : 'Looks like promo/noise',
        };
      });
    },
  };
}
