import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Linking,
  StyleSheet,
  Text,
  TextInput,
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
import { EmailViewer } from '../components/EmailViewer';
import { destinationFolderPath } from '../lib/approveFlow';
import { askAiForDetail } from '../lib/aiDetail';
import { DECORATION_SKIP_LABEL } from '../lib/attachmentFilter';
import { buildGroupedReview, groupCandidatesBySubject } from '../lib/grouping';
import {
  confidenceBand,
  confidenceLabel,
  reviewCardSubtitle,
} from '../lib/reviewLabels';
import { filterCandidatesByQuery, pendingApprovable } from '../lib/reviewSearch';
import {
  formatSubjectSuggestionLabel,
  isVehicleReviewFamily,
} from '../lib/subjectSuggestions';
import { MOCK_SCAN_CANDIDATES } from '../mocks/data';
import { useMocks } from '../services/config';
import type { ScanCandidate, VaultCategory, VaultDocument } from '../types/document';
import { VAULT_CATEGORIES } from '../types/document';

type ToastState =
  | { kind: 'skip'; id: string; fileName: string }
  | { kind: 'approve'; id: string; message: string; webViewLink?: string }
  | null;

type CardUi =
  | { state: 'idle' }
  | { state: 'saving' }
  | { state: 'saved'; message: string }
  | { state: 'skipping' }
  | { state: 'error'; message: string };

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
    patchScanCandidate,
    seedScanCandidates,
    reviewStats,
    lastSyncedAt,
    vaultFolderUrl,
    storageMode = 'gmail_index',
  } = vault;
  const [cardUi, setCardUi] = useState<Record<string, CardUi>>({});
  const inFlight = useRef<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Record<string, string | null>>({});
  const [showSkipped, setShowSkipped] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [emailFor, setEmailFor] = useState<ScanCandidate | null>(null);
  const [approveAll, setApproveAll] = useState<{ done: number; total: number } | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [skipBatch, setSkipBatch] = useState<string[] | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastAnim = useRef(new Animated.Value(0)).current;
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setSearchQuery(searchInput), 180);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [searchInput]);

  const localStats = useMemo(() => {
    const base = reviewStats || { toReview: 0, approved: 0, skipped: 0 };
    const saving = Object.values(cardUi).filter((u) => u.state === 'saving' || u.state === 'skipping').length;
    // Instant count feedback while optimistic ops run
    return {
      toReview: Math.max(0, base.toReview - saving),
      approved: base.approved + Object.values(cardUi).filter((u) => u.state === 'saved').length,
      skipped: base.skipped,
    };
  }, [reviewStats, cardUi]);

  const hydrating = authLoading || vaultLoading;

  const enrichOpts = useMemo(
    () => ({ vaultDocuments: documents, allowDemoPlates: useMocks() }),
    [documents],
  );

  const visibleCandidates = useMemo(() => {
    try {
      const base = showSkipped
        ? lastScanCandidates
        : lastScanCandidates.filter((c) => c && c.status !== 'rejected');
      return filterCandidatesByQuery(base, searchQuery);
    } catch {
      return [];
    }
  }, [lastScanCandidates, showSkipped, searchQuery]);

  const matchingPending = useMemo(
    () => pendingApprovable(visibleCandidates),
    [visibleCandidates],
  );

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

  const handleApprove = useCallback(
    async (c: ScanCandidate) => {
      if (inFlight.current.has(c.id)) return;
      inFlight.current.add(c.id);
      setCardUi((prev) => ({ ...prev, [c.id]: { state: 'saving' } }));
      setError(null);
      const selected = selectedKeys[c.id];
      try {
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
          const message =
            ok.message ||
            (storageMode === 'gmail_index' ? 'Saved to your vault' : `Saved to Drive › ${ok.folderPath}`);
          setCardUi((prev) => ({ ...prev, [c.id]: { state: 'saved', message } }));
          showToast({ kind: 'approve', id: c.id, message, webViewLink: ok.webViewLink });
          setTimeout(() => {
            setCardUi((prev) => {
              const next = { ...prev };
              delete next[c.id];
              return next;
            });
          }, 600);
        } else if (failed.length) {
          setCardUi((prev) => ({
            ...prev,
            [c.id]: { state: 'error', message: failed[0].reason },
          }));
        }
      } catch (e) {
        setCardUi((prev) => ({
          ...prev,
          [c.id]: { state: 'error', message: e instanceof Error ? e.message : String(e) },
        }));
      } finally {
        inFlight.current.delete(c.id);
      }
    },
    [approveCandidates, selectedKeys, storageMode],
  );

  const handleSkip = useCallback(
    async (c: ScanCandidate) => {
      if (inFlight.current.has(c.id)) return;
      inFlight.current.add(c.id);
      setCardUi((prev) => ({ ...prev, [c.id]: { state: 'skipping' } }));
      showToast({ kind: 'skip', id: c.id, fileName: c.fileName });
      try {
        await rejectCandidate(c.id);
        setTimeout(() => {
          setCardUi((prev) => {
            const next = { ...prev };
            delete next[c.id];
            return next;
          });
        }, 400);
      } catch (e) {
        setCardUi((prev) => ({
          ...prev,
          [c.id]: { state: 'error', message: e instanceof Error ? e.message : String(e) },
        }));
      } finally {
        inFlight.current.delete(c.id);
      }
    },
    [rejectCandidate],
  );

  const handleApproveAll = useCallback(async () => {
    const pending = matchingPending.filter((c) => !inFlight.current.has(c.id));
    if (!pending.length) return;
    setApproveAll({ done: 0, total: pending.length });
    let done = 0;
    for (const c of pending) {
      await handleApprove(c);
      done += 1;
      setApproveAll({ done, total: pending.length });
    }
    setTimeout(() => setApproveAll(null), 1200);
  }, [matchingPending, handleApprove]);

  const handleSkipAllMatching = useCallback(async () => {
    const pending = matchingPending.filter((c) => !inFlight.current.has(c.id));
    if (!pending.length) return;
    const ids = pending.map((c) => c.id);
    setSkipBatch(ids);
    for (const c of pending) {
      await handleSkip(c);
    }
  }, [matchingPending, handleSkip]);

  const handleUndoSkipBatch = useCallback(async () => {
    if (!skipBatch?.length) return;
    for (const id of skipBatch) {
      await restoreSkippedCandidate(id);
    }
    setSkipBatch(null);
  }, [skipBatch, restoreSkippedCandidate]);

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

  const reviewHeader = (
    <View style={styles.header} testID="review-list-header">
      <Pressable onPress={() => router.back()}>
        <Text style={styles.back}>← Back</Text>
      </Pressable>
      <SectionTitle
        title="Review scan results"
        subtitle={`${localStats.toReview} to review · ${localStats.approved} approved · ${localStats.skipped} skipped`}
      />
      <Banner>
        {storageMode === 'gmail_index'
          ? 'Approve indexes the Gmail attachment in your vault (no Drive upload). Opening it later fetches from Gmail. Skip ignores it and will not suggest it again.'
          : 'Approve copies the attachment into your Google Drive › Kadalas folder (by category) and adds it to your vault. Skip ignores it and will not suggest it again.'}
      </Banner>
      <DriveSafetyNote vaultFolderUrl={vaultFolderUrl} lastSyncedAt={lastSyncedAt} compact />
      <TextInput
        value={searchInput}
        onChangeText={setSearchInput}
        placeholder="Search filename, subject, sender, category…"
        placeholderTextColor={colors.inkMuted}
        style={styles.search}
        testID="review-search"
        autoCorrect={false}
        autoCapitalize="none"
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
      <View style={styles.batchRow}>
        <Button
          title={
            searchQuery.trim()
              ? `Approve all ${matchingPending.length} matching`
              : `Approve all ${matchingPending.length}`
          }
          variant="secondary"
          onPress={() => void handleApproveAll()}
          disabled={Boolean(approveAll) || matchingPending.length === 0}
        />
        <Button
          title={
            searchQuery.trim()
              ? `Skip all ${matchingPending.length} matching`
              : `Skip all ${matchingPending.length}`
          }
          variant="ghost"
          onPress={() => void handleSkipAllMatching()}
          disabled={Boolean(approveAll) || matchingPending.length === 0}
        />
      </View>
      {skipBatch?.length ? (
        <Button
          title={`Undo skip (${skipBatch.length})`}
          variant="ghost"
          onPress={() => void handleUndoSkipBatch()}
        />
      ) : null}
      {approveAll ? (
        <View style={styles.approveAllBar} testID="approve-all-progress">
          <Text style={styles.meta}>
            Approving {approveAll.done}/{approveAll.total}
          </Text>
          <View style={styles.barTrack}>
            <View
              style={[
                styles.barFill,
                { width: `${Math.round((approveAll.done / Math.max(approveAll.total, 1)) * 100)}%` },
              ]}
            />
          </View>
        </View>
      ) : null}
      {error || renderError ? <Banner tone="warn">{error || renderError}</Banner> : null}
    </View>
  );

  return (
    <Screen>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <FlatList
          style={styles.listFlex}
          data={groups}
          keyExtractor={(g) => g.id}
          contentContainerStyle={styles.list}
          ListHeaderComponent={reviewHeader}
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
                  ui={cardUi[c.id] || { state: 'idle' }}
                  selectedKey={selectedKeys[c.id] ?? null}
                  onToggleChip={(key) =>
                    setSelectedKeys((prev) => ({
                      ...prev,
                      [c.id]: prev[c.id] === key ? null : key,
                    }))
                  }
                  onApprove={() => void handleApprove(c)}
                  onReject={() => void handleSkip(c)}
                  onRestore={() => {
                    if (inFlight.current.has(c.id)) return;
                    void restoreSkippedCandidate(c.id);
                  }}
                  onViewEmail={() => setEmailFor(c)}
                  onAskAi={async () => {
                    try {
                      const detail = await askAiForDetail(c);
                      patchScanCandidate(c.id, { aiDetail: detail });
                    } catch (e) {
                      setCardUi((prev) => ({
                        ...prev,
                        [c.id]: {
                          state: 'error',
                          message: e instanceof Error ? e.message : 'Ask AI failed',
                        },
                      }));
                    }
                  }}
                  onCategory={(cat) =>
                    patchScanCandidate(c.id, {
                      categoryOverride: cat,
                      classification: c.classification
                        ? { ...c.classification, category: cat }
                        : c.classification,
                    })
                  }
                />
              ))}
            </View>
          )}
        />

        {emailFor ? (
          <EmailViewer
            visible
            messageId={emailFor.gmailMessageId}
            attachmentId={emailFor.gmailAttachmentId}
            fileName={emailFor.fileName}
            mimeType={emailFor.mimeType}
            onClose={() => setEmailFor(null)}
          />
        ) : null}

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
  ui,
  selectedKey,
  onToggleChip,
  onApprove,
  onReject,
  onRestore,
  onViewEmail,
  onAskAi,
  onCategory,
}: {
  candidate: ScanCandidate;
  vaultDocuments: VaultDocument[];
  storageMode: 'gmail_index' | 'drive_copies';
  ui: CardUi;
  selectedKey: string | null;
  onToggleChip: (key: string) => void;
  onApprove: () => void;
  onReject: () => void;
  onRestore: () => void;
  onViewEmail: () => void;
  onAskAi: () => Promise<void>;
  onCategory: (cat: VaultCategory) => void;
}) {
  const [why, setWhy] = useState(false);
  const [askBusy, setAskBusy] = useState(false);
  const m = c.classification?.metadata ?? {};
  const skipped = c.status === 'rejected' || ui.state === 'skipping';
  const approved = c.status === 'approved' || ui.state === 'saved';
  const busy = ui.state === 'saving' || ui.state === 'skipping';
  const done = approved || skipped || c.status === 'duplicate';
  const showCover = isVehicleReviewFamily(c.classification?.category, m.documentType);
  const possibleKeys =
    showCover && c.possibleSubjectKeys?.length ? c.possibleSubjectKeys : undefined;
  const dest =
    storageMode === 'gmail_index'
      ? 'Vault index (Gmail pointer)'
      : destinationFolderPath(c.classification?.category);
  const band = confidenceBand(c.classification?.confidence);
  const subtitle = reviewCardSubtitle(c);

  if (skipped && c.status === 'rejected') {
    return (
      <View style={[styles.card, styles.cardSkipped]} testID={`review-card-${c.id}`}>
        <View style={styles.skippedRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>{c.fileName}</Text>
            <Text style={styles.status}>{c.skipReason || 'Skipped'}</Text>
            {c.skipReason === DECORATION_SKIP_LABEL ? (
              <Text style={styles.meta}>Email decoration — restore if this was a real document</Text>
            ) : null}
          </View>
          <Button title="Restore" variant="secondary" disabled={busy} onPress={onRestore} />
        </View>
      </View>
    );
  }

  if (ui.state === 'skipping') {
    return (
      <View style={[styles.card, styles.cardSkipped]} testID={`review-card-${c.id}`}>
        <Text style={styles.meta}>Skipping…</Text>
      </View>
    );
  }

  return (
    <View
      style={[styles.card, approved && styles.cardApproved, c.status === 'duplicate' && styles.cardDone]}
      testID={`review-card-${c.id}`}
    >
      <Text style={styles.cardTitle}>{c.fileName}</Text>
      <Text style={styles.meta}>{subtitle}</Text>
      {band === 'low' && !done ? (
        <Text style={styles.lowBadge}>Not sure — check before approving</Text>
      ) : null}
      {!done ? (
        <Text style={styles.dest}>
          {storageMode === 'gmail_index' ? 'Will index: ' : 'Will save to: '}
          {dest}
        </Text>
      ) : null}
      {ui.state === 'error' || c.saveError ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{ui.state === 'error' ? ui.message : c.saveError}</Text>
        </View>
      ) : null}
      {ui.state === 'saving' ? (
        <View style={styles.actions}>
          <ActivityIndicator color={colors.teal} />
          <Text style={styles.meta}>Saving…</Text>
        </View>
      ) : null}
      {ui.state === 'saved' ? (
        <Text style={[styles.status, styles.statusApproved]}>✓ {ui.message}</Text>
      ) : null}

      <Pressable onPress={() => setWhy((v) => !v)}>
        <Text style={styles.whyToggle}>{why ? 'Hide details' : 'Why?'}</Text>
      </Pressable>
      {why ? (
        <View style={styles.whyBox} testID={`why-${c.id}`}>
          <Text style={styles.meta}>Subject: {c.subject || '—'}</Text>
          <Text style={styles.meta}>From: {c.from || '—'}</Text>
          <Text style={styles.meta}>Date: {c.date ? new Date(c.date).toLocaleString() : '—'}</Text>
          <Text style={styles.meta}>Snippet: {c.previewSnippet || '—'}</Text>
          <Text style={styles.meta}>
            Attachment: {c.mimeType} · {(c.sizeBytes || 0).toLocaleString()} bytes
          </Text>
          <Text style={styles.meta}>
            Confidence: {confidenceLabel(band)}
            {typeof c.classification?.confidence === 'number'
              ? ` (${Math.round(c.classification.confidence * 100)}%)`
              : ''}
          </Text>
          <Text style={styles.meta}>Reason: {c.classification?.reason || '—'}</Text>
          {c.classification?.signals?.length ? (
            <Text style={styles.meta}>Signals: {c.classification.signals.join(' · ')}</Text>
          ) : null}
          {c.aiDetail ? (
            <Text style={styles.meta}>AI detail: {c.aiDetail.summary}</Text>
          ) : null}
        </View>
      ) : null}

      {!done ? (
        <View style={styles.chipBlock}>
          <Text style={styles.helper}>Category before approve</Text>
          <View style={styles.subjectRow}>
            {VAULT_CATEGORIES.map((cat) => (
              <Pressable
                key={cat}
                disabled={busy}
                onPress={() => onCategory(cat)}
                style={[
                  styles.chip,
                  (c.categoryOverride || c.classification?.category) === cat && styles.chipActive,
                ]}
              >
                <Text
                  style={[
                    styles.chipText,
                    (c.categoryOverride || c.classification?.category) === cat && styles.chipTextActive,
                  ]}
                >
                  {cat.includes('/') ? cat.split('/')[1] : cat}
                </Text>
              </Pressable>
            ))}
          </View>
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

      {!done && c.isGroupLatest !== false && ui.state !== 'saving' ? (
        <View style={styles.actions}>
          <Button
            title={ui.state === 'error' || c.saveError ? 'Retry Approve' : 'Approve'}
            disabled={busy}
            onPress={onApprove}
          />
          <Button title="Skip" variant="ghost" disabled={busy} onPress={onReject} />
          <Button title="View email" variant="ghost" disabled={busy} onPress={onViewEmail} />
          <Button
            title="Ask AI"
            variant="ghost"
            loading={askBusy}
            disabled={busy}
            onPress={async () => {
              setAskBusy(true);
              try {
                await onAskAi();
                setWhy(true);
              } finally {
                setAskBusy(false);
              }
            }}
          />
        </View>
      ) : approved && ui.state !== 'saving' ? (
        <Text style={[styles.status, styles.statusApproved]}>
          {storageMode === 'gmail_index' ? 'Approved · saved to vault' : 'Approved · saved to Drive'}
        </Text>
      ) : done && !skipped ? (
        <Text style={styles.status}>{c.status}</Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  safe: { flex: 1 },
  listFlex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  header: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, gap: 6 },
  back: { ...typography.caption, color: colors.teal, marginBottom: 4 },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  toggleLabel: { ...typography.body, color: colors.ink },
  list: { paddingHorizontal: spacing.md, gap: spacing.sm, paddingBottom: 96, flexGrow: 1 },
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
  whyToggle: { ...typography.caption, color: colors.teal, fontWeight: '700', marginTop: 4 },
  whyBox: {
    backgroundColor: colors.paper,
    borderRadius: radii.sm,
    padding: spacing.sm,
    gap: 2,
    marginTop: 4,
  },
  lowBadge: {
    ...typography.caption,
    color: colors.amber,
    fontWeight: '700',
    marginTop: 2,
  },
  search: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    ...typography.body,
    color: colors.ink,
    backgroundColor: colors.paperElevated,
  },
  batchRow: { gap: 8 },
  approveAllBar: { gap: 6, marginTop: 4 },
  barTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.line,
    overflow: 'hidden',
  },
  barFill: { height: 8, backgroundColor: colors.teal },
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
