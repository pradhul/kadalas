import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Linking,
  StyleSheet,
  Text,
  View,
  Pressable,
  Switch,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DriveSafetyNote } from '../components/DriveSafetyNote';
import { Banner, Button, Screen, SectionTitle } from '../components/ui';
import { colors, radii, spacing, typography } from '../constants/theme';
import { useAuth } from '../context/AuthContext';
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
import type { ScanCandidate, VaultDocument } from '../types/document';

type ToastState =
  | { kind: 'skip'; id: string; fileName: string }
  | { kind: 'approve'; id: string; message: string; webViewLink?: string }
  | null;

type ReviewRow = {
  id: string;
  title: string;
  subtitle?: string;
  kind: 'subject' | 'ambiguous' | 'ungrouped';
  candidates: ScanCandidate[];
};

export default function ScanReviewScreen() {
  const { loading: authLoading } = useAuth();
  const vault = useVault();
  const {
    lastScanCandidates = [],
    documents = [],
    loading: vaultLoading,
    approveCandidates,
    rejectCandidate,
    restoreSkippedCandidate,
    seedScanCandidates,
    reviewStats,
    lastSyncedAt,
    vaultFolderUrl,
    storageMode = 'gmail_index',
  } = vault;
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Record<string, string | null>>({});
  const [showSkipped, setShowSkipped] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastAnim = useRef(new Animated.Value(0)).current;

  const hydrating = authLoading || vaultLoading;

  const enrichOpts = useMemo(
    () => ({ vaultDocuments: documents, allowDemoPlates: useMocks() }),
    [documents],
  );

  const visibleCandidates = useMemo(() => {
    try {
      if (showSkipped) return lastScanCandidates;
      return lastScanCandidates.filter((c) => c && c.status !== 'rejected');
    } catch {
      return [];
    }
  }, [lastScanCandidates, showSkipped]);

  const groups: ReviewRow[] = useMemo(() => {
    try {
      return buildGroupedReview(visibleCandidates, enrichOpts);
    } catch {
      return [];
    }
  }, [visibleCandidates, enrichOpts]);

  useEffect(() => {
    try {
      buildGroupedReview(visibleCandidates, enrichOpts);
      setRenderError(null);
    } catch (e) {
      setRenderError(e instanceof Error ? e.message : String(e));
    }
  }, [visibleCandidates, enrichOpts]);

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

  const handleApprove = useCallback(
    async (c: ScanCandidate) => {
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
          message: ok.message || (storageMode === 'gmail_index' ? 'Saved to your vault' : `Saved to Drive › ${ok.folderPath}`),
          webViewLink: ok.webViewLink,
        });
      }
      if (failed.length && !saved.length) {
        setError(
          storageMode === 'gmail_index'
            ? `Couldn't save to vault: ${failed[0].reason}`
            : `Couldn't save to Drive: ${failed[0].reason}`,
        );
      }
    },
    [approveCandidates, selectedKeys],
  );

  if (hydrating && !lastScanCandidates.length) {
    return (
      <Screen>
        <SafeAreaView style={styles.safe} edges={['top']}>
          <View style={styles.center}>
            <ActivityIndicator color={colors.teal} />
            <Text style={styles.meta}>Loading your vault…</Text>
          </View>
        </SafeAreaView>
      </Screen>
    );
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
            subtitle={`${reviewStats?.toReview ?? 0} to review · ${reviewStats?.approved ?? 0} approved · ${reviewStats?.skipped ?? 0} skipped`}
          />
          <Banner>
            {storageMode === 'gmail_index'
              ? 'Approve indexes the Gmail attachment in your vault (no Drive upload). Opening it later fetches from Gmail. Skip ignores it and will not suggest it again.'
              : 'Approve copies the attachment into your Google Drive › Kadalas folder (by category) and adds it to your vault. Skip ignores it and will not suggest it again.'}
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

        {error || renderError ? <Banner tone="warn">{error || renderError}</Banner> : null}

        <FlatList
          data={groups}
          keyExtractor={(g) => g.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={{ gap: 8 }}>
              <Banner>
                Nothing to review yet — run a scan from the Scan tab, then come back here.
              </Banner>
              {seedScanCandidates ? (
                <Button
                  title="Load demo review list"
                  variant="secondary"
                  onPress={() => {
                    try {
                      const { flat } = groupCandidatesBySubject(
                        MOCK_SCAN_CANDIDATES.filter((c) => c.status !== 'skipped'),
                        { allowDemoPlates: true, vaultDocuments: documents },
                      );
                      seedScanCandidates(flat);
                    } catch (e) {
                      setError(e instanceof Error ? e.message : String(e));
                    }
                  }}
                />
              ) : null}
              <Button title="Go to Scan" variant="ghost" onPress={() => router.replace('/(tabs)/scan')} />
            </View>
          }
          renderItem={({ item: g }) => (
            <View style={styles.group} testID={`review-group-${g.id}`}>
              <Text style={styles.groupTitle}>{g.title}</Text>
              {g.subtitle ? <Text style={styles.meta}>{g.subtitle}</Text> : null}
              {g.candidates.map((c) => (
                <CandidateCard
                  key={c.id}
                  candidate={c}
                  vaultDocuments={documents}
                  storageMode={storageMode}
                  busy={busyId === c.id}
                  selectedKey={selectedKeys[c.id] ?? null}
                  onToggleChip={(key) =>
                    setSelectedKeys((prev) => ({
                      ...prev,
                      [c.id]: prev[c.id] === key ? null : key,
                    }))
                  }
                  onApprove={() => act(c.id, () => handleApprove(c))}
                  onReject={() =>
                    act(c.id, async () => {
                      await rejectCandidate(c.id);
                      showToast({ kind: 'skip', id: c.id, fileName: c.fileName });
                    })
                  }
                  onRestore={() => act(c.id, () => restoreSkippedCandidate(c.id))}
                />
              ))}
            </View>
          )}
        />

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
                <Pressable
                  onPress={() => {
                    const id = toast.id;
                    if (toastTimer.current) clearTimeout(toastTimer.current);
                    setToast(null);
                    void restoreSkippedCandidate(id);
                  }}
                  testID="undo-skip"
                >
                  <Text style={styles.toastAction}>Undo</Text>
                </Pressable>
              </View>
            ) : (
              <View style={styles.toastRow}>
                <Text style={styles.toastText}>{toast.message}</Text>
                {toast.webViewLink ? (
                  <Pressable onPress={() => void Linking.openURL(toast.webViewLink!)}>
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

const CandidateCard = memo(function CandidateCard({
  candidate: c,
  vaultDocuments,
  storageMode,
  busy,
  selectedKey,
  onToggleChip,
  onApprove,
  onReject,
  onRestore,
}: {
  candidate: ScanCandidate;
  vaultDocuments: VaultDocument[];
  storageMode: 'gmail_index' | 'drive_copies';
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
  const dest =
    storageMode === 'gmail_index'
      ? 'Vault index (Gmail pointer)'
      : destinationFolderPath(c.classification?.category);

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
      {!done ? (
        <Text style={styles.dest}>
          {storageMode === 'gmail_index' ? 'Will index: ' : 'Will save to: '}
          {dest}
        </Text>
      ) : null}
      {subjectDisplay ? <Text style={styles.meta}>Subject: {subjectDisplay}</Text> : null}
      {c.saveError ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>Couldn&apos;t save to Drive: {c.saveError}</Text>
        </View>
      ) : null}
      {!done && possibleKeys?.length && c.isGroupLatest !== false ? (
        <View style={styles.chipBlock}>
          <Text style={styles.helper}>Group this with:</Text>
          <View style={styles.subjectRow}>
            {possibleKeys.map((k) => (
              <Pressable
                key={k}
                disabled={busy}
                onPress={() => onToggleChip(k)}
                style={[styles.chip, selectedKey === k && styles.chipActive]}
              >
                <Text style={[styles.chipText, selectedKey === k && styles.chipTextActive]}>
                  {formatSubjectSuggestionLabel(k, vaultDocuments)}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
      {!done && c.isGroupLatest !== false ? (
        <View style={styles.actions}>
          <Button title={c.saveError ? 'Retry Approve' : 'Approve'} loading={busy} onPress={onApprove} />
          <Button title="Skip" variant="ghost" disabled={busy} onPress={onReject} />
        </View>
      ) : approved ? (
        <Text style={[styles.status, styles.statusApproved]}>
          {storageMode === 'gmail_index' ? 'Approved · saved to vault' : 'Approved · saved to Drive'}
        </Text>
      ) : done ? (
        <Text style={styles.status}>{c.status}</Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  safe: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
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
    marginBottom: spacing.md,
  },
  groupTitle: { ...typography.h3, color: colors.ink },
  meta: { ...typography.caption, color: colors.inkMuted },
  dest: { ...typography.caption, color: colors.teal, fontWeight: '600' },
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
    paddingVertical: spacing.sm,
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
  chipActive: { borderColor: colors.teal, backgroundColor: colors.tealSoft },
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
