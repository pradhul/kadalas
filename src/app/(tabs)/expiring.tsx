import React, { useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Chip, EmptyState, Screen, SectionTitle } from '../../components/ui';
import { colors, spacing, typography } from '../../constants/theme';
import { useVault } from '../../context/VaultContext';
import { collectCoverageExpiryAlerts } from '../../lib/coverageSlots';
import { buildVehicleCoverViews } from '../../lib/grouping';
import { findExpiringSoon } from '../../lib/versioning';

type Row =
  | {
      kind: 'slot';
      id: string;
      title: string;
      meta: string;
      daysLeft: number | null;
      href: string;
      tone: 'rose' | 'amber';
    }
  | {
      kind: 'doc';
      id: string;
      title: string;
      meta: string;
      daysLeft: number;
      href: string;
      tone: 'rose' | 'amber';
    };

export default function ExpiringScreen() {
  const { documents } = useVault();

  const items = useMemo(() => {
    const rows: Row[] = [];
    const vehicleViews = buildVehicleCoverViews(documents);
    const slotAlerts = collectCoverageExpiryAlerts(vehicleViews, 60);
    for (const a of slotAlerts) {
      rows.push({
        kind: 'slot',
        id: `slot-${a.subjectKey}-${a.slotId}-${a.kind}`,
        title: `${a.subjectLabel} · ${a.slotLabel}`,
        meta:
          a.kind === 'gap'
            ? `Coverage gap${a.insurer ? ` (last: ${a.insurer})` : ''}`
            : `${a.insurer ?? 'Policy'} expires ${a.date ?? ''}`.trim(),
        daysLeft: a.daysLeft,
        href: `/vehicle/${encodeURIComponent(a.subjectKey)}`,
        tone: a.kind === 'gap' || (a.daysLeft != null && a.daysLeft <= 14) ? 'rose' : 'amber',
      });
    }

    const vehicleIds = new Set(
      documents
        .filter((d) => d.category.startsWith('Insurance/Vehicle') && d.metadata.subjectKey)
        .map((d) => d.id),
    );
    for (const item of findExpiringSoon(documents, 60)) {
      if (vehicleIds.has(item.document.id)) continue; // already covered via slots
      rows.push({
        kind: 'doc',
        id: `doc-${item.document.id}-${item.kind}`,
        title: item.document.title,
        meta: `${item.kind === 'expiry' ? 'Expires' : 'Renews'} ${item.date}`,
        daysLeft: item.daysLeft,
        href: `/document/${item.document.id}`,
        tone: item.daysLeft <= 14 ? 'rose' : 'amber',
      });
    }

    return rows.sort((a, b) => (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999));
  }, [documents]);

  return (
    <Screen>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <FlatList
          style={styles.listFlex}
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <View style={styles.header}>
              <SectionTitle
                title="Expiring soon"
                subtitle="Per-slot vehicle gaps/expiries plus other renewals in the next 60 days."
              />
            </View>
          }
          ListEmptyComponent={
            <EmptyState
              title="Nothing due soon"
              body="Vehicle OD/TP gaps and documents with expiry dates will appear here."
            />
          }
          renderItem={({ item }) => (
            <Pressable style={styles.row} onPress={() => router.push(item.href as never)}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.title} numberOfLines={1}>
                  {item.title}
                </Text>
                <Text style={styles.meta} numberOfLines={1}>
                  {item.meta}
                </Text>
              </View>
              <Chip
                label={
                  item.daysLeft == null
                    ? 'Gap'
                    : item.daysLeft < 0
                      ? `${Math.abs(item.daysLeft)}d overdue`
                      : `${item.daysLeft}d`
                }
                tone={item.tone}
              />
            </Pressable>
          )}
        />
      </SafeAreaView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  listFlex: { flex: 1 },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  list: { padding: spacing.lg, paddingTop: 0, gap: spacing.sm, flexGrow: 1 },
  row: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.paperElevated,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    marginBottom: spacing.sm,
  },
  title: { ...typography.bodyStrong, color: colors.ink },
  meta: { ...typography.caption, color: colors.inkMuted },
});
