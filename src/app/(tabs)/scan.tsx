import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Banner, Button, Field, Screen, SectionTitle } from '../../components/ui';
import { colors, spacing, typography } from '../../constants/theme';
import { useVault } from '../../context/VaultContext';

export default function ScanScreen() {
  const { index, runScan, scanProgress, lastScanCandidates } = useVault();
  const [lookback, setLookback] = useState('90');
  const [error, setError] = useState<string | null>(null);

  const hasPriorScan = Boolean(index?.lastScanAt);

  return (
    <Screen>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.content}>
          <SectionTitle
            title="Scan Gmail"
            subtitle="Find important attachments, classify them, then approve what to keep in Drive."
          />

          <Banner>
            Cheap filters run first (attachment type, promo heuristics). AI is only called on survivors, queued with
            backoff for free-tier limits.
          </Banner>

          {hasPriorScan ? (
            <Text style={styles.meta}>
              Last scan: {new Date(index!.lastScanAt!).toLocaleString()} — next run searches since then.
            </Text>
          ) : (
            <Field
              label="First-run lookback (days)"
              value={lookback}
              onChangeText={setLookback}
              placeholder="90"
            />
          )}

          {scanProgress ? (
            <View style={styles.progress}>
              <Text style={styles.progressTitle}>{scanProgress.message}</Text>
              <Text style={styles.meta}>
                {scanProgress.current}/{scanProgress.total}
              </Text>
              <View style={styles.barTrack}>
                <View
                  style={[
                    styles.barFill,
                    {
                      width: `${Math.max(
                        8,
                        (scanProgress.current / Math.max(scanProgress.total, 1)) * 100,
                      )}%`,
                    },
                  ]}
                />
              </View>
            </View>
          ) : null}

          {error ? <Banner tone="warn">{error}</Banner> : null}

          <Button
            title="Scan for new documents"
            loading={Boolean(scanProgress)}
            onPress={async () => {
              setError(null);
              try {
                const days = Number(lookback) || 90;
                const candidates = await runScan(hasPriorScan ? undefined : days);
                router.push('/scan-review');
                if (!candidates.length) {
                  setError('No new document candidates found in this window.');
                }
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              }
            }}
          />

          {lastScanCandidates.length ? (
            <View style={{ marginTop: spacing.md }}>
              <Button
                title={`Review last scan (${lastScanCandidates.filter((c) => c.status === 'pending').length} pending)`}
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
  meta: { ...typography.caption, color: colors.inkMuted, marginBottom: spacing.md },
  progress: {
    backgroundColor: colors.paperElevated,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: 6,
  },
  progressTitle: { ...typography.bodyStrong, color: colors.ink },
  barTrack: {
    height: 8,
    borderRadius: 999,
    backgroundColor: colors.line,
    overflow: 'hidden',
    marginTop: 4,
  },
  barFill: {
    height: '100%',
    backgroundColor: colors.teal,
  },
});
