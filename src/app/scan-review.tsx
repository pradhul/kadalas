import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View, ScrollView, Pressable } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Banner, Button, Screen, SectionTitle } from '../components/ui';
import { colors, radii, spacing, typography } from '../constants/theme';
import { useVault } from '../context/VaultContext';
import { formatCoverageType } from '../lib/coverageSlots';
import { buildGroupedReview, groupCandidatesBySubject } from '../lib/grouping';
import { MOCK_SCAN_CANDIDATES } from '../mocks/data';
import type { ScanCandidate } from '../types/document';

export default function ScanReviewScreen() {
  const {
    lastScanCandidates,
    approveCandidates,
    rejectCandidate,
    resolveAmbiguousSubject,
    seedScanCandidates,
  } = useVault();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const groups = useMemo(() => buildGroupedReview(lastScanCandidates), [lastScanCandidates]);
  const pending = lastScanCandidates.filter(
    (c) => c.status === 'pending' || c.status === 'needs_subject_confirm',
  );

  async function act(id: string, fn: () => Promise<void>) {
    setBusyId(id);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Screen>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()}>
            <Text style={styles.back}>← Back</Text>
          </Pressable>
          <SectionTitle
            title="Review scan results"
            subtitle={`${pending.length} pending · grouped by vehicle / subject when possible`}
          />
        </View>
        <ScrollView contentContainerStyle={styles.list}>
          {error ? <Banner tone="warn">{error}</Banner> : null}
          {!groups.length ? (
            <View style={{ gap: 8 }}>
              <Banner>
                No candidates yet. Start a mailbox scan — results appear here as they are classified.
              </Banner>
              {seedScanCandidates ? (
                <Button
                  title="Load demo review list"
                  variant="secondary"
                  onPress={() => {
                    const { flat } = groupCandidatesBySubject(
                      MOCK_SCAN_CANDIDATES.filter((c) => c.status !== 'skipped'),
                    );
                    seedScanCandidates(flat);
                  }}
                />
              ) : null}
            </View>
          ) : null}
          {groups.map((g) => (
            <View key={g.id} style={styles.group} testID={`review-group-${g.id}`}>
              <Text style={styles.groupTitle}>{g.title}</Text>
              {g.subtitle ? <Text style={styles.meta}>{g.subtitle}</Text> : null}
              {g.kind === 'ambiguous' ? (
                <Banner tone="warn">
                  Subject key unclear. Confirm registration / chassis before saving into a vehicle group.
                </Banner>
              ) : null}
              {g.candidates.map((c) => (
                <CandidateCard
                  key={c.id}
                  candidate={c}
                  busy={busyId === c.id}
                  onApprove={() => act(c.id, () => approveCandidates([c.id]))}
                  onReject={() => act(c.id, async () => rejectCandidate(c.id))}
                  onConfirmSubject={(key) =>
                    act(c.id, async () => {
                      resolveAmbiguousSubject?.(c.id, key);
                    })
                  }
                />
              ))}
            </View>
          ))}
        </ScrollView>
      </SafeAreaView>
    </Screen>
  );
}

function CandidateCard({
  candidate: c,
  busy,
  onApprove,
  onReject,
  onConfirmSubject,
}: {
  candidate: ScanCandidate;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
  onConfirmSubject: (key: string) => void;
}) {
  const m = c.classification?.metadata ?? {};
  const done = c.status === 'approved' || c.status === 'rejected' || c.status === 'duplicate';
  const possibleKeys = c.possibleSubjectKeys;
  return (
    <View style={[styles.card, done && styles.cardDone]}>
      <Text style={styles.cardTitle}>{c.fileName}</Text>
      <Text style={styles.meta}>
        {c.classification?.category ?? 'Unclassified'} · {m.issuer ?? 'Unknown insurer'} ·{' '}
        {formatCoverageType(m.coverageType)}
      </Text>
      {m.subjectKey ? (
        <Text style={styles.meta}>
          Subject: {m.subjectLabel || m.subjectKey}
          {m.coverageSlots ? ` · slots ${m.coverageSlots}` : ''}
        </Text>
      ) : null}
      {m.referenceNumber ? <Text style={styles.meta}>Policy #: {m.referenceNumber}</Text> : null}
      {m.expiryDate ? <Text style={styles.meta}>Covers until {m.expiryDate}</Text> : null}
      {c.isGroupLatest === false ? (
        <Text style={styles.hint}>Older version — will move to _versions when the current policy is approved</Text>
      ) : null}
      {c.status === 'needs_subject_confirm' && possibleKeys?.length ? (
        <View style={styles.subjectRow}>
          {possibleKeys.map((k) => (
            <Button key={k} title={k} variant="secondary" disabled={busy} onPress={() => onConfirmSubject(k)} />
          ))}
        </View>
      ) : null}
      {!done && c.status !== 'needs_subject_confirm' && c.isGroupLatest !== false ? (
        <View style={styles.actions}>
          <Button title="Approve" loading={busy} onPress={onApprove} />
          <Button title="Skip" variant="ghost" disabled={busy} onPress={onReject} />
        </View>
      ) : done ? (
        <Text style={styles.status}>{c.status}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  back: { ...typography.caption, color: colors.teal, marginBottom: spacing.sm },
  list: { padding: spacing.lg, gap: spacing.md, paddingBottom: 48 },
  group: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.lg,
    padding: spacing.md,
    backgroundColor: colors.paperElevated,
    gap: 8,
  },
  groupTitle: { ...typography.h3, color: colors.ink },
  meta: { ...typography.caption, color: colors.inkMuted },
  hint: { ...typography.caption, color: colors.teal, marginTop: 2 },
  card: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: spacing.sm,
    gap: 4,
  },
  cardDone: { opacity: 0.55 },
  cardTitle: { ...typography.bodyStrong, color: colors.ink },
  actions: { flexDirection: 'row', gap: 8, marginTop: 6 },
  subjectRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  status: { ...typography.caption, color: colors.inkMuted, textTransform: 'uppercase' },
});
