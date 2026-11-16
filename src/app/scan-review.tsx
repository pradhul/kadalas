import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View, ScrollView, Pressable } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Banner, Button, Screen, SectionTitle } from '../components/ui';
import { colors, radii, spacing, typography } from '../constants/theme';
import { useVault } from '../context/VaultContext';
import { formatCoverageType } from '../lib/coverageSlots';
import { buildGroupedReview, groupCandidatesBySubject } from '../lib/grouping';
import {
  formatSubjectSuggestionLabel,
  isVehicleReviewFamily,
} from '../lib/subjectSuggestions';
import { MOCK_SCAN_CANDIDATES } from '../mocks/data';
import { useMocks } from '../services/config';
import type { ScanCandidate } from '../types/document';

export default function ScanReviewScreen() {
  const {
    lastScanCandidates,
    documents,
    approveCandidates,
    rejectCandidate,
    seedScanCandidates,
  } = useVault();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Optional subject-chip toggle per candidate — never replaces Approve/Skip. */
  const [selectedKeys, setSelectedKeys] = useState<Record<string, string | null>>({});

  const enrichOpts = useMemo(
    () => ({ vaultDocuments: documents, allowDemoPlates: useMocks() }),
    [documents],
  );

  const groups = useMemo(
    () => buildGroupedReview(lastScanCandidates, enrichOpts),
    [lastScanCandidates, enrichOpts],
  );
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

  function toggleChip(candidateId: string, key: string) {
    setSelectedKeys((prev) => ({
      ...prev,
      [candidateId]: prev[candidateId] === key ? null : key,
    }));
  }

  async function handleApprove(c: ScanCandidate) {
    const selected = selectedKeys[c.id];
    await approveCandidates(
      [c.id],
      selected ? { [c.id]: selected } : undefined,
    );
    setSelectedKeys((prev) => {
      const next = { ...prev };
      delete next[c.id];
      return next;
    });
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
                      { allowDemoPlates: true, vaultDocuments: documents },
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
              {g.candidates.map((c) => (
                <CandidateCard
                  key={c.id}
                  candidate={c}
                  vaultDocuments={documents}
                  busy={busyId === c.id}
                  selectedKey={selectedKeys[c.id] ?? null}
                  onToggleChip={(key) => toggleChip(c.id, key)}
                  onApprove={() => act(c.id, () => handleApprove(c))}
                  onReject={() => act(c.id, async () => rejectCandidate(c.id))}
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
  vaultDocuments,
  busy,
  selectedKey,
  onToggleChip,
  onApprove,
  onReject,
}: {
  candidate: ScanCandidate;
  vaultDocuments: import('../types/document').VaultDocument[];
  busy: boolean;
  selectedKey: string | null;
  onToggleChip: (key: string) => void;
  onApprove: () => void;
  onReject: () => void;
}) {
  const m = c.classification?.metadata ?? {};
  const done = c.status === 'approved' || c.status === 'rejected' || c.status === 'duplicate';
  const showCover = isVehicleReviewFamily(c.classification?.category, m.documentType);
  const possibleKeys =
    showCover && c.possibleSubjectKeys?.length ? c.possibleSubjectKeys : undefined;

  const subjectDisplay =
    m.subjectLabel && !String(m.subjectLabel).includes(':')
      ? m.subjectLabel
      : m.subjectKey
        ? formatSubjectSuggestionLabel(m.subjectKey, vaultDocuments)
        : null;

  return (
    <View style={[styles.card, done && styles.cardDone]} testID={`review-card-${c.id}`}>
      <Text style={styles.cardTitle}>{c.fileName}</Text>
      <Text style={styles.meta}>
        {c.classification?.category ?? 'Unclassified'} · {m.issuer ?? 'Unknown issuer'}
        {showCover ? ` · ${formatCoverageType(m.coverageType)}` : ''}
      </Text>
      {subjectDisplay ? (
        <Text style={styles.meta}>
          Subject: {subjectDisplay}
          {showCover && m.coverageSlots ? ` · slots ${m.coverageSlots}` : ''}
        </Text>
      ) : null}
      {m.referenceNumber ? <Text style={styles.meta}>Policy #: {m.referenceNumber}</Text> : null}
      {m.expiryDate ? <Text style={styles.meta}>Covers until {m.expiryDate}</Text> : null}
      {c.isGroupLatest === false ? (
        <Text style={styles.hint}>
          Older version — will move to _versions when the current policy is approved
        </Text>
      ) : null}

      {!done && possibleKeys?.length && c.isGroupLatest !== false ? (
        <View style={styles.chipBlock}>
          <Text style={styles.helper}>Group this with:</Text>
          <View style={styles.subjectRow}>
            {possibleKeys.map((k) => {
              const active = selectedKey === k;
              return (
                <Pressable
                  key={k}
                  disabled={busy}
                  onPress={() => onToggleChip(k)}
                  style={[styles.chip, active && styles.chipActive]}
                  testID={`subject-chip-${k}`}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {formatSubjectSuggestionLabel(k, vaultDocuments)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}

      {!done && c.isGroupLatest !== false ? (
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
  chipBlock: { marginTop: 6, gap: 4 },
  helper: { ...typography.caption, color: colors.inkMuted },
  subjectRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.md,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: colors.paper,
  },
  chipActive: {
    borderColor: colors.teal,
    backgroundColor: colors.tealSoft,
  },
  chipText: { ...typography.caption, color: colors.ink },
  chipTextActive: { color: colors.teal, fontWeight: '600' },
  status: { ...typography.caption, color: colors.inkMuted, textTransform: 'uppercase' },
});
