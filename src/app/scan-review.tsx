import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Banner, Button, Chip, EmptyState, Screen } from '../components/ui';
import { colors, radii, spacing, typography } from '../constants/theme';
import { useVault } from '../context/VaultContext';

export default function ScanReviewScreen() {
  const { lastScanCandidates, approveCandidates, rejectCandidate } = useVault();
  const [busy, setBusy] = useState(false);

  const pending = useMemo(
    () => lastScanCandidates.filter((c) => c.status === 'pending'),
    [lastScanCandidates],
  );
  const others = useMemo(
    () => lastScanCandidates.filter((c) => c.status !== 'pending'),
    [lastScanCandidates],
  );

  return (
    <Screen>
      <FlatList
        data={[...pending, ...others]}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={{ marginBottom: spacing.md }}>
            <Banner>
              Approve important documents to save them into the matching Drive folder. Duplicates and promos are
              pre-marked.
            </Banner>
            {pending.length ? (
              <Button
                title={`Approve all pending (${pending.length})`}
                loading={busy}
                onPress={async () => {
                  setBusy(true);
                  try {
                    await approveCandidates(pending.map((p) => p.id));
                  } finally {
                    setBusy(false);
                  }
                }}
              />
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <EmptyState title="Nothing to review" body="Run a Gmail scan to populate this list." />
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.top}>
              <Text style={styles.title}>{item.classification?.title || item.fileName}</Text>
              <Chip
                label={item.status}
                tone={
                  item.status === 'pending'
                    ? 'teal'
                    : item.status === 'duplicate' || item.status === 'skipped'
                      ? 'amber'
                      : item.status === 'rejected'
                        ? 'rose'
                        : 'neutral'
                }
              />
            </View>
            <Text style={styles.meta}>{item.subject}</Text>
            <Text style={styles.meta}>
              {item.from} · {new Date(item.date).toLocaleDateString()}
            </Text>
            <Text style={styles.meta}>
              {(item.classification?.category || 'Other').replace('/', ' · ')} · confidence{' '}
              {Math.round((item.classification?.confidence || 0) * 100)}%
            </Text>
            {item.classification?.reason ? <Text style={styles.reason}>{item.classification.reason}</Text> : null}

            {item.status === 'pending' ? (
              <View style={styles.actions}>
                <Button
                  title="Approve"
                  onPress={async () => {
                    setBusy(true);
                    try {
                      await approveCandidates([item.id]);
                    } finally {
                      setBusy(false);
                    }
                  }}
                />
                <Pressable onPress={() => rejectCandidate(item.id)} style={styles.reject}>
                  <Text style={styles.rejectText}>Reject</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { padding: spacing.lg, paddingBottom: spacing.xxl },
  card: {
    backgroundColor: colors.paperElevated,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: 4,
  },
  top: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' },
  title: { ...typography.bodyStrong, color: colors.ink, flex: 1 },
  meta: { ...typography.caption, color: colors.inkMuted },
  reason: { ...typography.caption, color: colors.teal, marginTop: 4 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.sm },
  reject: { padding: 8 },
  rejectText: { ...typography.bodyStrong, color: colors.rose },
});
