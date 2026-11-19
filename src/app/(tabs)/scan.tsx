import React, { useEffect, useMemo, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View, Pressable } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScanStepper } from '../../components/design';
import { Banner, Button, Field, Screen, SectionTitle } from '../../components/ui';
import { colors, radii, spacing, typography } from '../../constants/theme';
import { useAuth } from '../../context/AuthContext';
import { useVault } from '../../context/VaultContext';
import { estimateRemaining, getActiveStageLabel, isAuthPause } from '../../lib/scanPipeline';
import { useMocks } from '../../services/config';
import { getAuthTokens } from '../../services/secureStorage';

function stageToStepperIndex(stage?: string): number {
  switch (stage) {
    case 'search':
      return 1;
    case 'filter':
      return 2;
    case 'triage':
    case 'classify':
      return 3;
    case 'dedupe':
    case 'completed':
      return 4;
    case 'paused_quota':
    case 'paused_user':
      return 3;
    default:
      return 0;
  }
}

async function copyText(text: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  throw new Error('Clipboard unavailable');
}

function confirmReset(): boolean {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return window.confirm('Reset this scan? Progress will be cleared (Drive file overwritten, not deleted).');
  }
  return true;
}

export default function ScanScreen() {
  const {
    index,
    scanJob,
    lastScanCandidates,
    startMailboxScan,
    resumeMailboxScan,
    pauseMailboxScan,
    cancelMailboxScan,
    resetMailboxScan,
    scanEngineRunning,
    lastSyncedAt,
    reviewStats,
  } = useVault();
  const { reconnectGoogle, loading: authLoading, needsReconnect, session } = useAuth();
  const [lookback, setLookback] = useState('90');
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [tokenExpiresIn, setTokenExpiresIn] = useState<string>('—');
  const [copied, setCopied] = useState(false);

  const hasPriorScan = Boolean(index?.lastScanAt);
  const active =
    scanJob &&
    !['idle', 'completed', 'cancelled'].includes(scanJob.stage) &&
    scanJob.stage !== undefined;
  const pausedQuota = scanJob?.stage === 'paused_quota';
  const pausedAuth = isAuthPause(scanJob) || (pausedQuota && needsReconnect);
  const pausedUser = scanJob?.stage === 'paused_user';
  const activeWorkingStages = ['search', 'filter', 'triage', 'classify', 'dedupe'];
  const stalled =
    Boolean(scanJob && activeWorkingStages.includes(scanJob.stage) && !scanEngineRunning);
  const running = scanEngineRunning;

  const est = useMemo(() => (scanJob ? estimateRemaining(scanJob) : null), [scanJob]);
  const pendingReview = lastScanCandidates.filter(
    (c) => c.status === 'pending' || c.status === 'needs_subject_confirm',
  ).length;

  const classifyDone = scanJob?.stats.classifyCalls ?? 0;
  const classifyRemaining = scanJob?.classifyQueue.length ?? 0;

  // Auto-resume stalled jobs when the Scan tab opens.
  useEffect(() => {
    if (!index || !stalled) return;
    void resumeMailboxScan().catch((e) => {
      setError(e instanceof Error ? e.message : String(e));
    });
  }, [index, stalled, resumeMailboxScan]);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (!session || session.isMock) {
        if (!cancelled) setTokenExpiresIn('mock');
        return;
      }
      const tokens = await getAuthTokens();
      if (cancelled) return;
      if (!tokens?.expiresAt) {
        setTokenExpiresIn('unknown');
        return;
      }
      const secs = Math.max(0, Math.round((tokens.expiresAt - Date.now()) / 1000));
      const m = Math.floor(secs / 60);
      const s = secs % 60;
      setTokenExpiresIn(`${m}m ${s}s`);
    };
    void tick();
    const t = setInterval(() => void tick(), 5000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [session]);

  return (
    <Screen>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView contentContainerStyle={styles.content}>
          <SectionTitle
            title="Scan Gmail"
            subtitle="Staged pipeline: search → rules → cheap AI triage → full classify → entity grouping."
          />

          <ScanStepper
            activeIndex={stageToStepperIndex(scanJob?.stage)}
            paused={pausedQuota || pausedAuth}
          />

          <Banner tone={pausedQuota ? 'warn' : 'info'}>
            Full mailbox scan is resumable and pauses on free-tier AI limits. Found documents appear in Review
            incrementally — you can approve while the scan continues.
          </Banner>

          {hasPriorScan ? (
            <Text style={styles.meta}>
              Last completed scan: {new Date(index!.lastScanAt!).toLocaleString()} — default next run is
              incremental.
            </Text>
          ) : (
            <Field
              label="Lookback window (days) if not doing full mailbox"
              value={lookback}
              onChangeText={setLookback}
              placeholder="90"
            />
          )}

          {scanJob && scanJob.stage !== 'idle' ? (
            <View
              style={[styles.progress, (pausedQuota || stalled) && styles.progressPaused]}
              testID="scan-progress-panel"
            >
              <Text style={styles.progressTitle}>
                {getActiveStageLabel(scanJob.stage, { authPause: pausedAuth })}
                {stalled ? ' (stalled)' : ''}
              </Text>
              {pausedAuth ? (
                <Banner tone="warn">
                  Session expired — tap to reconnect Google, then Resume to continue the scan where it left off.
                </Banner>
              ) : stalled ? (
                <Banner tone="warn">
                  Scan is not running. Tap Resume to continue from the saved page token.
                </Banner>
              ) : pausedQuota ? (
                <Banner tone="warn">
                  AI quota / rate limit hit. Resumes {new Date(scanJob.quotaPause!.resumeAfter).toLocaleString()}{' '}
                  automatically, or tap Resume.
                </Banner>
              ) : null}
              <Text style={styles.meta}>
                Emails checked: {scanJob.stats.emailsChecked}
                {scanJob.stats.emailsEstimatedTotal != null
                  ? ` / ~${scanJob.stats.emailsEstimatedTotal}`
                  : ''}
              </Text>
              <Text style={styles.meta}>
                Attachments: {scanJob.stats.attachmentsFound} · filtered {scanJob.stats.filteredOut} · triage
                kept {scanJob.stats.triageKept}
              </Text>
              <Text style={styles.meta}>
                Documents found: {scanJob.stats.documentsFound} · AI calls: {scanJob.stats.aiCallsUsed} ·{' '}
                {est?.label}
              </Text>
              <View style={styles.barTrack}>
                <View style={[styles.barFill, { width: `${Math.max(6, est?.percent ?? 6)}%` }]} />
              </View>

              <View style={styles.row}>
                {running ? (
                  <Button title="Pause" variant="secondary" onPress={() => void pauseMailboxScan()} />
                ) : null}
                {pausedAuth ? (
                  <Button
                    title="Reconnect Google"
                    loading={authLoading}
                    onPress={async () => {
                      setError(null);
                      try {
                        await reconnectGoogle();
                        await resumeMailboxScan();
                      } catch (e) {
                        setError(e instanceof Error ? e.message : 'Could not reconnect');
                      }
                    }}
                  />
                ) : null}
                {(pausedQuota && !pausedAuth) || pausedUser || stalled ? (
                  <Button title="Resume" onPress={() => void resumeMailboxScan()} />
                ) : null}
                {active && scanJob.stage !== 'completed' ? (
                  <Button title="Cancel" variant="ghost" onPress={() => void cancelMailboxScan()} />
                ) : null}
                {pendingReview > 0 ? (
                  <Button
                    title={`Review (${pendingReview})`}
                    variant="secondary"
                    onPress={() => router.push('/scan-review')}
                  />
                ) : null}
              </View>
            </View>
          ) : null}

          {scanJob ? (
            <View style={styles.debugCard} testID="scan-debug-card">
              <Text style={styles.debugTitle}>Scan status</Text>
              <Text style={styles.meta}>Stage: {scanJob.stage}</Text>
              <Text style={styles.meta}>Engine running: {scanEngineRunning ? 'yes' : 'no'}</Text>
              <Text style={styles.meta}>Pages fetched: {scanJob.stats.pagesFetched ?? 0}</Text>
              <Text style={styles.meta}>
                Attachments found: {scanJob.stats.attachmentsFound} · filtered: {scanJob.stats.filteredOut}
              </Text>
              <Text style={styles.meta}>
                Triage kept / skipped: {scanJob.stats.triageKept} / {scanJob.stats.triageSkipped}
              </Text>
              <Text style={styles.meta}>
                Classify done / remaining: {classifyDone} / {classifyRemaining}
              </Text>
              <Text style={styles.meta}>
                Last step: {scanJob.lastStepAt ? new Date(scanJob.lastStepAt).toLocaleTimeString() : '—'}
              </Text>
              <Text style={styles.meta}>
                Last API: {scanJob.lastApiCall
                  ? `${scanJob.lastApiCall.label} · ${scanJob.lastApiCall.status}`
                  : '—'}
              </Text>
              <Text style={styles.meta}>Token expires in: {tokenExpiresIn}</Text>
              <Text style={styles.meta}>Progress: {est?.percent ?? 0}% · {est?.label}</Text>

              <Text style={[styles.debugTitle, { marginTop: spacing.sm }]}>Event log</Text>
              {(scanJob.eventLog ?? []).slice(-20).map((e, i) => (
                <Text key={`${e.at}-${i}`} style={styles.logLine}>
                  {new Date(e.at).toLocaleTimeString()} — {e.message}
                </Text>
              ))}
              {(scanJob.eventLog ?? []).length === 0 ? (
                <Text style={styles.meta}>No events yet.</Text>
              ) : null}

              <View style={[styles.row, { marginTop: spacing.sm }]}>
                <Button
                  title={copied ? 'Copied' : 'Copy log'}
                  variant="secondary"
                  onPress={async () => {
                    const lines = (scanJob.eventLog ?? []).map(
                      (e) => `${e.at} ${e.message}`,
                    );
                    try {
                      await copyText(lines.join('\n') || '(empty)');
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    } catch (e) {
                      setError(e instanceof Error ? e.message : 'Copy failed');
                    }
                  }}
                />
                <Button
                  title="Reset scan"
                  variant="ghost"
                  onPress={async () => {
                    if (!confirmReset()) return;
                    setError(null);
                    try {
                      await resetMailboxScan();
                    } catch (e) {
                      setError(e instanceof Error ? e.message : String(e));
                    }
                  }}
                />
              </View>
            </View>
          ) : null}

          {scanJob?.lastWarning ? <Banner tone="warn">{scanJob.lastWarning}</Banner> : null}
          {error ? <Banner tone="warn">{error}</Banner> : null}

          {!hasPriorScan ? (
            <View style={styles.choice}>
              <Pressable
                style={[styles.choiceCard, styles.choiceCardPrimary]}
                onPress={async () => {
                  setError(null);
                  setStarting(true);
                  try {
                    await startMailboxScan({ mode: 'full', mockQuotaAfter: useMocks() ? 1 : undefined });
                  } catch (e) {
                    setError(e instanceof Error ? e.message : String(e));
                  } finally {
                    setStarting(false);
                  }
                }}
              >
                <Text style={styles.choiceTitle}>Full mailbox scan (recommended)</Text>
                <Text style={styles.meta}>
                  All folders (in:anywhere) · no date limit · paged & resumable. Finds older policies in Updates and
                  other tabs.
                </Text>
              </Pressable>
              <Pressable
                style={styles.choiceCard}
                onPress={async () => {
                  setError(null);
                  setStarting(true);
                  try {
                    await startMailboxScan({ mode: 'lookback', lookbackDays: Number(lookback) || 90 });
                  } catch (e) {
                    setError(e instanceof Error ? e.message : String(e));
                  } finally {
                    setStarting(false);
                  }
                }}
              >
                <Text style={styles.choiceTitle}>Last {lookback || '90'} days only</Text>
                <Text style={styles.meta}>Quicker first pass — may miss older policies</Text>
              </Pressable>
            </View>
          ) : (
            <Button
              title="Scan for new documents (since last scan)"
              loading={starting || Boolean(running)}
              onPress={async () => {
                setError(null);
                setStarting(true);
                try {
                  await startMailboxScan({ mode: 'incremental' });
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                } finally {
                  setStarting(false);
                }
              }}
            />
          )}

          {hasPriorScan ? (
            <View style={{ marginTop: spacing.md }}>
              <Button
                title="Run full mailbox scan again"
                variant="secondary"
                onPress={async () => {
                  setStarting(true);
                  try {
                    await startMailboxScan({ mode: 'full', mockQuotaAfter: useMocks() ? 1 : undefined });
                  } finally {
                    setStarting(false);
                  }
                }}
              />
            </View>
          ) : null}

          {lastScanCandidates.length ? (
            <View style={{ marginTop: spacing.md, gap: 6 }}>
              <Button
                title={`Open review list (${pendingReview} pending)`}
                variant="secondary"
                onPress={() => router.push('/scan-review')}
              />
              <Text style={styles.meta}>
                {reviewStats.toReview} to review · {reviewStats.approved} approved ·{' '}
                {reviewStats.skipped} skipped
                {lastSyncedAt
                  ? ` · review queue synced ${new Date(lastSyncedAt).toLocaleString()}`
                  : ''}
              </Text>
              <Text style={styles.meta}>
                Approvals update your vault index immediately. Skips and the review queue restore after
                you close the app.
              </Text>
            </View>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.sm, paddingBottom: spacing.xxl },
  meta: { ...typography.caption, color: colors.inkMuted, marginBottom: 4 },
  progress: {
    backgroundColor: colors.paperElevated,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: 6,
  },
  progressPaused: { borderColor: colors.amber, backgroundColor: colors.amberSoft },
  progressTitle: { ...typography.bodyStrong, color: colors.ink },
  barTrack: {
    height: 8,
    borderRadius: 999,
    backgroundColor: colors.line,
    overflow: 'hidden',
    marginTop: 4,
    marginBottom: 8,
  },
  barFill: { height: '100%', backgroundColor: colors.teal },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  choice: { gap: spacing.sm, marginTop: spacing.sm },
  choiceCard: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.lg,
    padding: spacing.lg,
    backgroundColor: colors.paperElevated,
    gap: 4,
  },
  choiceCardPrimary: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryContainer,
  },
  choiceTitle: { ...typography.h3, color: colors.ink },
  debugCard: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.lg,
    padding: spacing.md,
    backgroundColor: colors.paperElevated,
    gap: 2,
    marginBottom: spacing.md,
  },
  debugTitle: { ...typography.bodyStrong, color: colors.ink, marginBottom: 4 },
  logLine: { ...typography.caption, color: colors.inkMuted, fontFamily: Platform.OS === 'web' ? 'monospace' : undefined },
});
