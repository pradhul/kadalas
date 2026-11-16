import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Linking,
  StyleSheet,
  Text,
  View,
  ScrollView,
  Pressable,
  Switch,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DriveSafetyNote } from '../components/DriveSafetyNote';
import { Banner, Button, Screen, SectionTitle } from '../components/ui';
import { colors, radii, spacing, typography } from '../constants/theme';
import { useVault } from '../context/VaultContext';
import { destinationFolderPath } from '../lib/approveFlow';
import { formatCoverageType } from '../lib/coverageSlots';
import { buildGroupedReview, groupCandidatesBySubject } from '../lib/grouping';
import {
  formatSubjectSuggestionLabel,
  isVehicleReviewFamily,
} from '../lib/subjectSuggestions';
import { MOCK_SCAN_CANDIDATES } from '../mocks/data';
import { useMocks } from '../services/config';
import type { ScanCandidate } from '../types/document';

type ToastState =
  | { kind: 'skip'; id: string; fileName: string }
  | { kind: 'approve'; id: string; message: string; webViewLink?: string }
  | null;

export default function ScanReviewScreen() {
  const {
    lastScanCandidates,
    documents,
    approveCandidates,
    rejectCandidate,
    restoreSkippedCandidate,
    seedScanCandidates,
    reviewStats,
    lastSyncedAt,
    vaultFolderUrl,
  } = useVault();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Record<string, string | null>>({});
  const [showSkipped, setShowSkipped] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastAnim = useRef(new Animated.Value(0)).current;

  const enrichOpts = useMemo(
    () => ({ vaultDocuments: documents, allowDemoPlates: useMocks() }),
    [documents],
  );

  const visibleCandidates = useMemo(() => {
    if (showSkipped) return lastScanCandidates;
    return lastScanCandidates.filter((c) => c.status !== 'rejected');
  }, [lastScanCandidates, showSkipped]);

  const groups = useMemo(
    () => buildGroupedReview(visibleCandidates, enrichOpts),
    [visibleCandidates, enrichOpts],
  );

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  function showToast(next: ToastState) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(next);
    toastAnim.setValue(0);
    Animated.timing(toastAnim, { toValue: 1, duration: 220, useNativeDriver: true }).start();
    toastTimer.current = setTimeout(() => {
      Animated.timing(toastAnim, { toValue: 0, duration: 200, useNativeDriver: true }).start(
        () => setToast(null),
      );
    }, 5000);
  }

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
    const { saved, failed } = await approveCandidates(
      [c.id],
      selected ? { [c.id]: selected } : undefined,
    );
    setSelectedKeys((prev) => {
      const next = { ...prev };
      delete next[c.id];
      return next;
    });

    if (saved.length) {
      const ok = saved[0];
      showToast({
        kind: 'approve',
        id: c.id,
        message: `Saved to your Google Drive › ${ok.folderPath}`,
        webViewLink: ok.webViewLink,
      });
    }
    if (failed.length && !saved.length) {
      // Card shows saveError; also surface at top
      setError(`Couldn't save to Drive: ${failed[0].reason}`);
    }
  }

  async function handleSkip(c: ScanCandidate) {
    await rejectCandidate(c.id);
    showToast({ kind: 'skip', id: c.id, fileName: c.fileName });
  }

  async function handleUndoSkip() {
    if (!toast || toast.kind !== 'skip') return;
    const id = toast.id;
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(null);
    await restoreSkippedCandidate(id);
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
            subtitle={`${reviewStats.toReview} to review · ${reviewStats.approved} approved · ${reviewStats.skipped} skipped`}
          />
          <Banner>
            Approve copies the attachment into your Google Drive › Kadalas folder (by category) and
            adds it to your vault. Skip ignores it and will not suggest it again.
          </Banner>
          <DriveSafetyNote
            vaultFolderUrl={vaultFolderUrl}
            lastSyncedAt={lastSyncedAt}
            compact
          />
          <View style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>Show skipped</Text>
            <Switch
              value={showSkipped}
              onValueChange={setShowSkipped}
              trackColor={{ true: colors.teal, false: colors.line }}
              testID="show-skipped-toggle"
            />
          </View>
        </View>
        <ScrollView contentContainerStyle={styles.list}>
          {error ? <Banner tone="warn">{error}</Banner> : null}
          {!groups.length ? (
            <View style={{ gap: 8 }}>
              <Banner>
                {reviewStats.skipped && !showSkipped
                  ? 'No items left to review. Turn on “Show skipped” to restore any you skipped.'
                  : 'No candidates yet. Start a mailbox scan — results appear here as they are classified.'}
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
                  onReject={() => act(c.id, () => handleSkip(c))}
                  onRestore={() => act(c.id, () => restoreSkippedCandidate(c.id))}
                />
              ))}
            </View>
          ))}
        </ScrollView>

        {toast ? (
          <Animated.View
            style={[
              styles.toast,
              {
                opacity: toastAnim,
                transform: [
                  {
                    translateY: toastAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [24, 0],
                    }),
                  },
                ],
              },
            ]}
            testID="review-toast"
          >
            {toast.kind === 'skip' ? (
              <View style={styles.toastRow}>
                <Text style={styles.toastText} numberOfLines={2}>
                  Skipped {toast.fileName}
                </Text>
                <Pressable onPress={() => void handleUndoSkip()} testID="undo-skip">
                  <Text style={styles.toastAction}>Undo</Text>
                </Pressable>
              </View>
            ) : (
              <View style={styles.toastRow}>
                <Text style={styles.toastText}>{toast.message}</Text>
                {toast.webViewLink ? (
                  <Pressable
                    onPress={() => void Linking.openURL(toast.webViewLink!)}
                    testID="open-drive-file"
                  >
                    <Text style={styles.toastAction}>Open in Drive</Text>
                  </Pressable>
                ) : null}
              </View>
            )}
          </Animated.View>
        ) : null}
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
  onRestore,
}: {
  candidate: ScanCandidate;
  vaultDocuments: import('../types/document').VaultDocument[];
  busy: boolean;
  selectedKey: string | null;
  onToggleChip: (key: string) => void;
  onApprove: () => void;
  onReject: () => void;
  onRestore: () => void;
}) {
  const m = c.classification?.metadata ?? {};
  const skipped = c.status === 'rejected';
  const approved = c.status === 'approved';
  const done = approved || skipped || c.status === 'duplicate';
  const showCover = isVehicleReviewFamily(c.classification?.category, m.documentType);
  const possibleKeys =
    showCover && c.possibleSubjectKeys?.length ? c.possibleSubjectKeys : undefined;
  const dest = destinationFolderPath(c.classification?.category);

  const subjectDisplay =
    m.subjectLabel && !String(m.subjectLabel).includes(':')
      ? m.subjectLabel
      : m.subjectKey
        ? formatSubjectSuggestionLabel(m.subjectKey, vaultDocuments)
        : null;

  if (skipped) {
    return (
      <View style={[styles.card, styles.cardSkipped]} testID={`review-card-${c.id}`}>
        <View style={styles.skippedRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>{c.fileName}</Text>
            <Text style={styles.status}>Skipped</Text>
          </View>
          <Button title="Restore" variant="secondary" disabled={busy} onPress={onRestore} />
        </View>
      </View>
    );
  }

  return (
    <View
      style={[styles.card, approved && styles.cardApproved, c.status === 'duplicate' && styles.cardDone]}
      testID={`review-card-${c.id}`}
    >
      <Text style={styles.cardTitle}>{c.fileName}</Text>
      <Text style={styles.meta}>
        {c.classification?.category ?? 'Unclassified'} · {m.issuer ?? 'Unknown issuer'}
        {showCover ? ` · ${formatCoverageType(m.coverageType)}` : ''}
      </Text>
      {!done ? <Text style={styles.dest}>Will save to: {dest}</Text> : null}
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

      {c.saveError ? (
        <View style={styles.errorBox} testID={`save-error-${c.id}`}>
          <Text style={styles.errorText}>Couldn&apos;t save to Drive: {c.saveError}</Text>
        </View>
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
          <Button
            title={c.saveError ? 'Retry Approve' : 'Approve'}
            loading={busy}
            onPress={onApprove}
          />
          <Button title="Skip" variant="ghost" disabled={busy} onPress={onReject} />
        </View>
      ) : approved ? (
        <View style={{ gap: 4 }}>
          <Text style={[styles.status, styles.statusApproved]}>Approved · saved to Drive</Text>
          {c.driveWebViewLink ? (
            <Pressable onPress={() => void Linking.openURL(c.driveWebViewLink!)}>
              <Text style={styles.link}>Open in Drive →</Text>
            </Pressable>
          ) : null}
        </View>
      ) : done ? (
        <Text style={styles.status}>{c.status}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.sm },
  back: { ...typography.caption, color: colors.teal, marginBottom: spacing.sm },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  toggleLabel: { ...typography.body, color: colors.ink },
  list: { padding: spacing.lg, gap: spacing.md, paddingBottom: 96 },
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
  dest: { ...typography.caption, color: colors.teal, fontWeight: '600' },
  hint: { ...typography.caption, color: colors.teal, marginTop: 2 },
  link: { ...typography.caption, color: colors.teal, fontWeight: '600' },
  errorBox: {
    backgroundColor: colors.roseSoft,
    borderRadius: radii.sm,
    padding: spacing.sm,
    marginTop: 4,
  },
  errorText: { ...typography.caption, color: colors.rose },
  card: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: spacing.sm,
    gap: 4,
  },
  cardDone: { opacity: 0.55 },
  cardApproved: {
    backgroundColor: colors.successSoft,
    marginHorizontal: -spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.sm,
    borderTopWidth: 0,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  cardSkipped: {
    opacity: 0.85,
    backgroundColor: colors.paper,
    marginHorizontal: -spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.sm,
    borderTopWidth: 0,
    paddingVertical: spacing.sm,
  },
  skippedRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
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
  statusApproved: { color: colors.success, textTransform: 'none' },
  toast: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.lg,
    backgroundColor: colors.ink,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  toastRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  toastText: { ...typography.caption, color: '#fff', flex: 1 },
  toastAction: { ...typography.caption, color: colors.tealSoft, fontWeight: '700' },
});
