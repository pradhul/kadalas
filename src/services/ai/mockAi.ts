import { classifyWithRules } from '../../lib/categorisation';
import { isNewerVersion, scoreDocumentMatch } from '../../lib/matching';
import { AiProvider } from './types';

export function createMockAiProvider(): AiProvider {
  return {
    id: 'mock',
    displayName: 'Mock AI (offline)',
    async classifyDocument(input) {
      const result = classifyWithRules({
        subject: input.subject,
        from: input.from,
        fileName: input.fileName,
        mimeType: input.mimeType,
        textExcerpt: input.textExcerpt,
      });
      return { ...result, confidence: Math.max(result.confidence, 0.7) };
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
  };
}
