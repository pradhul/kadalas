import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View, Pressable } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Banner, Button, Field, Screen, SectionTitle } from '../../components/ui';
import { colors, radii, spacing, typography } from '../../constants/theme';
import { useAuth } from '../../context/AuthContext';
import { useVault } from '../../context/VaultContext';
import { estimateRemaining, getActiveStageLabel, isAuthPause } from '../../lib/scanPipeline';
import { useMocks } from '../../services/config';

export default function ScanScreen() {
  const {
    index,
    scanJob,
    lastScanCandidates,
    startMailboxScan,
    resumeMailboxScan,
    pauseMailboxScan,
    cancelMailboxScan,
  } = useVault();
  const { reconnectGoogle, loading: authLoading, needsReconnect } = useAuth();
  const [lookback, setLookback] = useState('90');
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const hasPriorScan = Boolean(index?.lastScanAt);
  const active =
    scanJob &&
    !['idle', 'completed', 'cancelled'].includes(scanJob.stage) &&
    scanJob.stage !== undefined;
  const pausedQuota = scanJob?.stage === 'paused_quota';
  const pausedAuth = isAuthPause(scanJob) || (pausedQuota && needsReconnect);
  const pausedUser = scanJob?.stage === 'paused_user';
  const running =
    active && !pausedQuota && !pausedUser && scanJob!.stage !== 'completed';

  const est = useMemo(() => (scanJob ? estimateRemaining(scanJob) : null), [scanJob]);
  const pendingReview = lastScanCandidates.filter(
    (c) => c.status === 'pending' || c.status === 'needs_subject_confirm',
  ).length;

  return (
    <Screen>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.content}>
          <SectionTitle
            title="Scan Gmail"
            subtitle="Staged pipeline: search → rules → cheap AI triage → full classify → entity grouping."
          />

          <Banner>
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
              style={[styles.progress, pausedQuota && styles.progressPaused]}
              testID="scan-progress-panel"
            >
              <Text style={styles.progressTitle}>
                {getActiveStageLabel(scanJob.stage, { authPause: pausedAuth })}
              </Text>
              {pausedAuth ? (
                <Banner tone="warn">
                  Session expired — tap to reconnect Google, then Resume to continue the scan where it left off.
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
                {(pausedQuota && !pausedAuth) || pausedUser ? (
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

          {error ? <Banner tone="warn">{error}</Banner> : null}

          {!hasPriorScan ? (
            <View style={styles.choice}>
              <Pressable
                style={styles.choiceCard}
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
                <Text style={styles.choiceTitle}>Full mailbox scan</Text>
                <Text style={styles.meta}>All-time attachments · resumable · best first run</Text>
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
                <Text style={styles.choiceTitle}>Lookback ({lookback || '90'} days)</Text>
                <Text style={styles.meta}>Smaller first pass if you prefer</Text>
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
            <View style={{ marginTop: spacing.md }}>
              <Button
                title={`Open review list (${pendingReview} pending)`}
                variant="secondary"
                onPress={() => router.push('/scan-review')}
              />
            </View>
          ) : null}
        </View>
      </SafeAreaView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.sm },
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
  choiceTitle: { ...typography.h3, color: colors.ink },
});
