import React, { useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { EmptyState, Screen } from '../../components/ui';
import { colors, radii, spacing, typography } from '../../constants/theme';
import { useVault } from '../../context/VaultContext';
import { buildVehicleCoverViews } from '../../lib/grouping';

export default function VehiclesScreen() {
  const { documents } = useVault();
  const vehicles = useMemo(() => buildVehicleCoverViews(documents), [documents]);

  return (
    <Screen>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <FlatList
          style={{ flex: 1 }}
          data={vehicles}
          keyExtractor={(v) => v.subjectKey}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <View style={styles.header}>
              <Text style={styles.title}>Vehicles</Text>
              <Text style={styles.sub}>Coverage by registration / chassis subject key.</Text>
            </View>
          }
          ListEmptyComponent={
            <EmptyState
              title="No vehicles yet"
              body="Approve motor insurance from Scan review to see OD/TP coverage here."
            />
          }
          renderItem={({ item }) => (
            <Pressable
              style={styles.row}
              onPress={() => router.push(`/vehicle/${encodeURIComponent(item.subjectKey)}`)}
              testID={`vehicle-${item.subjectKey}`}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.rowTitle}>{item.subjectLabel || item.subjectKey}</Text>
                <Text style={styles.rowMeta}>
                  {(item.slots || []).length} coverage slot
                  {(item.slots || []).length === 1 ? '' : 's'}
                </Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          )}
        />
      </SafeAreaView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { paddingBottom: spacing.md, gap: 4 },
  title: { ...typography.h1, color: colors.ink },
  sub: { ...typography.caption, color: colors.inkMuted },
  list: { padding: spacing.pageMobile, paddingBottom: 96, flexGrow: 1 },
  row: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  rowTitle: { ...typography.h3, color: colors.ink },
  rowMeta: { ...typography.caption, color: colors.inkMuted },
  chevron: { ...typography.h2, color: colors.inkTertiary },
});
