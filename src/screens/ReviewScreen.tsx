import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ConfidenceBadge } from '../components/design/badges';
import { EmailPane } from '../components/design/EmailPane';
import { UndoToast } from '../components/design/UndoToast';
import { Banner, Button, Screen } from '../components/ui';
import { colors, layout, radii, spacing, typography } from '../constants/theme';
import { useVault } from '../context/VaultContext';
import { askAiForDetail } from '../lib/aiDetail';
import { DECORATION_SKIP_LABEL } from '../lib/attachmentFilter';
import { groupCandidatesBySubject } from '../lib/grouping';
import { confidenceBand } from '../lib/reviewLabels';
import { filterCandidatesByQuery, pendingApprovable } from '../lib/reviewSearch';
import { approveExplainer, toastApprovedMessage } from '../lib/storageCopy';
import { categoryLabel } from '../lib/folders';
import { MOCK_SCAN_CANDIDATES } from '../mocks/data';
import { isDemoEntryAllowed } from '../services/config';
import type { ScanCandidate, VaultCategory } from '../types/document';
import { VAULT_CATEGORIES } from '../types/document';

type ToastState =
  | { kind: 'skip'; id: string; fileName: string }
  | { kind: 'approve'; id: string; message: string }
  | null;

type ConfFilter = 'all' | 'high' | 'medium' | 'low';

export default function ReviewScreen() {
  const { width } = useWindowDimensions();
  const desktop = width >= layout.desktopBreakpoint;
  const {
    lastScanCandidates = [],
    documents = [],
    loading: vaultLoading,
    approveCandidates,
    rejectCandidate,
    restoreSkippedCandidate,
    patchScanCandidate,
    seedScanCandidates,
    reviewStats,
    storageMode = 'gmail_index',
  } = useVault();

  const [showSkipped, setShowSkipped] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [confFilter, setConfFilter] = useState<ConfFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const [emailSheet, setEmailSheet] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef<Set<string>>(new Set());

  useEffect(() => {
    const t = setTimeout(() => setSearchQuery(searchInput), 180);
    return () => clearTimeout(t);
  }, [searchInput]);

  const visible = useMemo(() => {
    const base = showSkipped
      ? lastScanCandidates
      : lastScanCandidates.filter((c) => c && c.status !== 'rejected');
    let list = filterCandidatesByQuery(base, searchQuery);
    if (confFilter !== 'all') {
      list = list.filter((c) => confidenceBand(c.classification?.confidence) === confFilter);
    }
    // Prefer higher reviewPriority (self-sent)
    return [...list].sort((a, b) => (b.reviewPriority || 0) - (a.reviewPriority || 0));
  }, [lastScanCandidates, showSkipped, searchQuery, confFilter]);

  const matchingPending = useMemo(() => pendingApprovable(visible), [visible]);

  useEffect(() => {
    if (!selectedId && matchingPending[0]) setSelectedId(matchingPending[0].id);
    if (selectedId && !visible.some((c) => c.id === selectedId)) {
      setSelectedId(matchingPending[0]?.id ?? visible[0]?.id ?? null);
    }
  }, [visible, matchingPending, selectedId]);

  const selected = visible.find((c) => c.id === selectedId) || null;

  const confCounts = useMemo(() => {
    const base = showSkipped
      ? lastScanCandidates
      : lastScanCandidates.filter((c) => c.status !== 'rejected');
    const pending = pendingApprovable(filterCandidatesByQuery(base, searchQuery));
    return {
      all: pending.length,
      high: pending.filter((c) => confidenceBand(c.classification?.confidence) === 'high').length,
      medium: pending.filter((c) => confidenceBand(c.classification?.confidence) === 'medium').length,
      low: pending.filter((c) => confidenceBand(c.classification?.confidence) === 'low').length,
    };
  }, [lastScanCandidates, showSkipped, searchQuery]);

  function showToast(next: ToastState) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(next);
    toastTimer.current = setTimeout(() => setToast(null), 5000);
  }

  const handleApprove = useCallback(
    async (c: ScanCandidate) => {
      if (inFlight.current.has(c.id)) return;
      inFlight.current.add(c.id);
      setBusyId(c.id);
      try {
        const { saved, failed } = await approveCandidates([c.id]);
        if (saved.length) {
          const title = c.classification?.title || c.fileName;
          showToast({
            kind: 'approve',
            id: c.id,
            message: toastApprovedMessage(storageMode, title),
          });
        } else if (failed.length) {
          showToast({ kind: 'approve', id: c.id, message: failed[0].reason });
        }
      } finally {
        inFlight.current.delete(c.id);
        setBusyId(null);
      }
    },
    [approveCandidates, storageMode],
  );

  const handleSkip = useCallback(
    async (c: ScanCandidate) => {
      if (inFlight.current.has(c.id)) return;
      inFlight.current.add(c.id);
      setBusyId(c.id);
      showToast({ kind: 'skip', id: c.id, fileName: c.fileName });
      try {
        await rejectCandidate(c.id);
      } finally {
        inFlight.current.delete(c.id);
        setBusyId(null);
      }
    },
    [rejectCandidate],
  );

  // Keyboard shortcuts (web)
  useEffect(() => {
    if (Platform.OS !== 'web' || !desktop) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const idx = visible.findIndex((c) => c.id === selectedId);
      if (e.key === 'j' || e.key === 'J') {
        e.preventDefault();
        const next = visible[Math.min(visible.length - 1, idx + 1)];
        if (next) setSelectedId(next.id);
      } else if (e.key === 'k' || e.key === 'K') {
        e.preventDefault();
        const prev = visible[Math.max(0, idx - 1)];
        if (prev) setSelectedId(prev.id);
      } else if ((e.key === 'a' || e.key === 'A') && selected) {
        e.preventDefault();
        void handleApprove(selected);
      } else if ((e.key === 's' || e.key === 'S') && selected) {
        e.preventDefault();
        void handleSkip(selected);
      } else if (e.key === 'e' || e.key === 'E') {
        e.preventDefault();
        setEmailSheet(true);
      } else if ((e.key === 'u' || e.key === 'U') && toast?.kind === 'skip') {
        e.preventDefault();
        void restoreSkippedCandidate(toast.id);
        setToast(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [desktop, visible, selectedId, selected, handleApprove, handleSkip, toast, restoreSkippedCandidate]);

  const stats = reviewStats || { toReview: 0, approved: 0, skipped: 0 };

  if (vaultLoading && !lastScanCandidates.length) {
    return (
      <Screen>
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <SafeAreaView style={styles.safe} edges={desktop ? [] : ['top']}>
        <View style={[styles.shell, desktop && styles.shellDesktop]}>
          <View style={styles.mainCol}>
            <View style={styles.header}>
              <Text style={styles.title}>Review found documents</Text>
              <Text style={styles.sub}>
                {stats.toReview} to review · {stats.approved} approved · {stats.skipped} skipped
              </Text>
              <View style={styles.explainer} testID="review-explainer">
                <Text style={styles.explainerText}>{approveExplainer(storageMode)}</Text>
              </View>

              <View style={styles.searchRow}>
                <TextInput
                  value={searchInput}
                  onChangeText={setSearchInput}
                  placeholder="Filter by sender, filename, category…"
                  placeholderTextColor={colors.inkTertiary}
                  style={styles.search}
                  testID="review-search"
                  autoCorrect={false}
                  autoCapitalize="none"
                />
                <Pressable
                  style={styles.checkRow}
                  onPress={() => setShowSkipped((v) => !v)}
                  testID="show-skipped-toggle"
                >
                  <View style={[styles.checkbox, showSkipped && styles.checkboxOn]} />
                  <Text style={styles.checkLabel}>Show skipped</Text>
                </Pressable>
              </View>

              <View style={styles.filterRow}>
                {(
                  [
                    ['all', 'All', confCounts.all],
                    ['high', 'High', confCounts.high],
                    ['medium', 'Medium', confCounts.medium],
                    ['low', 'Not sure', confCounts.low],
                  ] as const
                ).map(([id, label, n]) => (
                  <Pressable
                    key={id}
                    onPress={() => setConfFilter(id)}
                    style={[styles.confChip, confFilter === id && styles.confChipOn]}
                  >
                    <Text style={[styles.confChipText, confFilter === id && styles.confChipTextOn]}>
                      {label} ({n})
                    </Text>
                  </Pressable>
                ))}
                <Pressable
                  onPress={() => {
                    void (async () => {
                      for (const c of matchingPending) await handleApprove(c);
                    })();
                  }}
                  disabled={!matchingPending.length}
                >
                  <Text style={styles.textAction}>
                    Approve all matching ({matchingPending.length})
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    void (async () => {
                      for (const c of matchingPending) await handleSkip(c);
                    })();
                  }}
                  disabled={!matchingPending.length}
                >
                  <Text style={styles.textActionMuted}>Skip all matching</Text>
                </Pressable>
              </View>
            </View>

            <FlatList
              style={{ flex: 1 }}
              data={visible}
              keyExtractor={(c) => c.id}
              contentContainerStyle={styles.list}
              ListEmptyComponent={
                <View style={{ gap: 8, padding: spacing.lg }}>
                  <Banner>Nothing to review yet — run a scan, then come back here.</Banner>
                  {isDemoEntryAllowed() && seedScanCandidates ? (
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
                  <Button title="Go to Scan" variant="ghost" onPress={() => router.replace('/(tabs)/scan')} />
                </View>
              }
              renderItem={({ item: c }) => {
                const expanded = c.id === selectedId;
                const skipped = c.status === 'rejected';
                const band = confidenceBand(c.classification?.confidence);
                if (!expanded) {
                  return (
                    <Pressable
                      style={styles.row}
                      onPress={() => setSelectedId(c.id)}
                      testID={`review-card-${c.id}`}
                    >
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={styles.rowFile} numberOfLines={1}>
                          {c.fileName}
                        </Text>
                        <Text style={styles.rowTitle} numberOfLines={1}>
                          {c.classification?.title || c.subject || c.fileName}
                        </Text>
                      </View>
                      <ConfidenceBadge band={band} />
                      {!skipped && c.status !== 'approved' ? (
                        <View style={styles.rowActions}>
                          <Pressable onPress={() => void handleApprove(c)}>
                            <Text style={styles.miniApprove}>Approve</Text>
                          </Pressable>
                          <Pressable onPress={() => void handleSkip(c)}>
                            <Text style={styles.miniSkip}>Skip</Text>
                          </Pressable>
                        </View>
                      ) : (
                        <Text style={styles.meta}>{skipped ? 'Skipped' : 'Approved'}</Text>
                      )}
                    </Pressable>
                  );
                }

                const cat = c.categoryOverride || c.classification?.category || 'Other';
                const signals =
                  c.classification?.signals?.length
                    ? c.classification.signals
                    : [c.classification?.reason].filter(Boolean) as string[];

                return (
                  <View style={styles.card} testID={`review-card-${c.id}`}>
                    <View style={styles.cardTop}>
                      <Text style={styles.mono} numberOfLines={1}>
                        {c.fileName}
                      </Text>
                      <ConfidenceBadge band={band} />
                    </View>
                    <Text style={styles.cardTitle}>
                      {c.classification?.title || c.subject || c.fileName}
                    </Text>

                    <Pressable
                      style={styles.catSelect}
                      onPress={() => setCategoryOpen((v) => !v)}
                    >
                      <Text style={styles.catSelectText}>{categoryLabel(cat)}</Text>
                      <Text style={styles.meta}>▾</Text>
                    </Pressable>
                    {categoryOpen ? (
                      <View style={styles.catMenu}>
                        {VAULT_CATEGORIES.map((opt) => (
                          <Pressable
                            key={opt}
                            onPress={() => {
                              patchScanCandidate(c.id, {
                                categoryOverride: opt,
                                classification: c.classification
                                  ? { ...c.classification, category: opt }
                                  : c.classification,
                              });
                              setCategoryOpen(false);
                            }}
                            style={styles.catOpt}
                          >
                            <Text style={styles.catOptText}>{categoryLabel(opt)}</Text>
                          </Pressable>
                        ))}
                      </View>
                    ) : null}

                    {signals.length ? (
                      <View style={styles.whyRow}>
                        <Text style={styles.whyLabel}>WHY?</Text>
                        {signals.slice(0, 4).map((s) => (
                          <View key={s} style={styles.signal}>
                            <Text style={styles.signalText}>{s}</Text>
                          </View>
                        ))}
                      </View>
                    ) : null}

                    {(c.aiDetail?.summary || c.previewSnippet) && (
                      <View style={styles.aiBox}>
                        <Text style={styles.aiText}>
                          {c.aiDetail?.summary || c.previewSnippet}
                        </Text>
                      </View>
                    )}

                    {skipped ? (
                      <Button
                        title="Restore"
                        variant="secondary"
                        onPress={() => void restoreSkippedCandidate(c.id)}
                      />
                    ) : (
                      <View style={styles.cardActions}>
                        <Button
                          title={desktop ? 'Approve [A]' : 'Approve'}
                          loading={busyId === c.id}
                          onPress={() => void handleApprove(c)}
                        />
                        <Button
                          title={desktop ? 'Skip [S]' : 'Skip'}
                          variant="secondary"
                          onPress={() => void handleSkip(c)}
                        />
                        <Button
                          title="Ask AI"
                          variant="ghost"
                          onPress={async () => {
                            try {
                              const detail = await askAiForDetail(c);
                              patchScanCandidate(c.id, { aiDetail: detail });
                            } catch {
                              /* ignore */
                            }
                          }}
                        />
                        {!desktop ? (
                          <Button
                            title="View email"
                            variant="ghost"
                            onPress={() => setEmailSheet(true)}
                          />
                        ) : null}
                      </View>
                    )}
                    {c.skipReason === DECORATION_SKIP_LABEL ? (
                      <Text style={styles.meta}>Email decoration — restore if this was a real document</Text>
                    ) : null}
                  </View>
                );
              }}
            />

            {!desktop && selected && selected.status !== 'rejected' && selected.status !== 'approved' ? (
              <View style={styles.thumbBar} testID="review-thumb-bar">
                <Button title="Skip" variant="secondary" onPress={() => void handleSkip(selected)} />
                <Button title="Approve" onPress={() => void handleApprove(selected)} />
              </View>
            ) : null}

            {desktop ? (
              <View style={styles.kbdBar} testID="review-kbd-bar">
                <Text style={styles.kbdText}>J/K next · A approve · S skip · E email · U undo</Text>
              </View>
            ) : null}
          </View>

          {desktop ? (
            <View style={styles.emailCol}>
              {selected ? (
                <EmailPane
                  from={selected.from}
                  subject={selected.subject}
                  date={selected.date}
                  snippet={selected.previewSnippet}
                  attachmentName={selected.fileName}
                  messageId={selected.gmailMessageId}
                />
              ) : (
                <View style={styles.emailEmpty}>
                  <Text style={styles.meta}>Select a document to see its source email</Text>
                </View>
              )}
            </View>
          ) : null}
        </View>

        {!desktop && emailSheet && selected ? (
          <View style={styles.sheetOverlay}>
            <Pressable style={styles.sheetBackdrop} onPress={() => setEmailSheet(false)} />
            <EmailPane
              sheet
              from={selected.from}
              subject={selected.subject}
              date={selected.date}
              snippet={selected.previewSnippet}
              attachmentName={selected.fileName}
              messageId={selected.gmailMessageId}
              onClose={() => setEmailSheet(false)}
            />
          </View>
        ) : null}

        <UndoToast
          visible={Boolean(toast)}
          message={
            toast?.kind === 'skip'
              ? `Skipped ${toast.fileName}`
              : toast?.message || ''
          }
          onUndo={
            toast?.kind === 'skip'
              ? () => {
                  void restoreSkippedCandidate(toast.id);
                  setToast(null);
                }
              : undefined
          }
        />
      </SafeAreaView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  shell: { flex: 1 },
  shellDesktop: { flexDirection: 'row' },
  mainCol: { flex: 1, minWidth: 0 },
  emailCol: {
    width: layout.detailPaneMin,
    maxWidth: layout.detailPaneMax,
    borderLeftWidth: 1,
    borderLeftColor: colors.border,
    backgroundColor: colors.surface,
  },
  emailEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  header: {
    paddingHorizontal: spacing.pageMobile,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.paper,
  },
  title: { ...typography.h1, color: colors.ink },
  sub: { ...typography.caption, color: colors.inkMuted },
  explainer: {
    backgroundColor: colors.infoSoft,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  explainerText: { ...typography.caption, color: colors.info },
  searchRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  search: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingHorizontal: 12,
    paddingVertical: 8,
    ...typography.body,
    color: colors.ink,
    backgroundColor: colors.surface,
  },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  checkbox: {
    width: 16,
    height: 16,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  checkboxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkLabel: { ...typography.caption, color: colors.inkMuted },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  confChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  confChipOn: { backgroundColor: colors.primaryContainer, borderColor: colors.primaryContainer },
  confChipText: { ...typography.caption, color: colors.inkMuted },
  confChipTextOn: { color: colors.onPrimaryContainer, fontFamily: 'Inter_600SemiBold' },
  textAction: { ...typography.caption, color: colors.primary, fontFamily: 'Inter_600SemiBold' },
  textActionMuted: { ...typography.caption, color: colors.inkMuted },
  list: { padding: spacing.pageMobile, paddingBottom: 120, gap: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 56,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    marginBottom: 6,
  },
  rowFile: { ...typography.caption, fontFamily: Platform.OS === 'web' ? 'ui-monospace, monospace' : undefined, color: colors.inkTertiary },
  rowTitle: { ...typography.bodyStrong, color: colors.ink },
  rowActions: { flexDirection: 'row', gap: 8 },
  miniApprove: { ...typography.caption, color: colors.primary, fontFamily: 'Inter_600SemiBold' },
  miniSkip: { ...typography.caption, color: colors.inkMuted },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radii.md,
    padding: spacing.lg,
    gap: spacing.sm,
    marginBottom: 8,
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, alignItems: 'center' },
  mono: {
    ...typography.caption,
    flex: 1,
    fontFamily: Platform.OS === 'web' ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : undefined,
    color: colors.inkTertiary,
  },
  cardTitle: { ...typography.h3, color: colors.ink },
  catSelect: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    backgroundColor: colors.surfaceMuted,
  },
  catSelectText: { ...typography.bodyStrong, color: colors.ink },
  catMenu: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    backgroundColor: colors.surface,
    maxHeight: 200,
  },
  catOpt: { paddingHorizontal: spacing.md, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  catOptText: { ...typography.body, color: colors.ink },
  whyRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  whyLabel: { ...typography.overline, color: colors.inkMuted },
  signal: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceMuted,
  },
  signalText: { ...typography.caption, color: colors.inkMuted },
  aiBox: {
    backgroundColor: colors.primaryContainer,
    borderRadius: radii.sm,
    padding: spacing.md,
  },
  aiText: { ...typography.body, color: colors.onPrimaryContainer },
  cardActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  meta: { ...typography.caption, color: colors.inkMuted },
  thumbBar: {
    flexDirection: 'row',
    gap: 8,
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  kbdBar: {
    paddingVertical: 8,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.ink,
  },
  kbdText: { ...typography.caption, color: '#fff', textAlign: 'center' },
  sheetOverlay: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'flex-end',
    zIndex: 40,
  },
  sheetBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.overlay,
  },
});
