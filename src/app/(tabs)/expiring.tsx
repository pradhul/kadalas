import React, { useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Chip, EmptyState, Screen, SectionTitle } from '../../components/ui';
import { colors, spacing, typography } from '../../constants/theme';
import { useVault } from '../../context/VaultContext';
import { findExpiringSoon } from '../../lib/versioning';

export default function ExpiringScreen() {
  const { documents } = useVault();
  const items = useMemo(() => findExpiringSoon(documents, 60), [documents]);

  return (
    <Screen>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <SectionTitle title="Expiring soon" subtitle="Renewals and expiries in the next 60 days." />
        </View>
        <FlatList
          data={items}
          keyExtractor={(item) => `${item.document.id}-${item.kind}-${item.date}`}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <EmptyState title="Nothing due soon" body="Documents with expiry or renewal dates will appear here." />
          }
          renderItem={({ item }) => (
            <Pressable style={styles.row} onPress={() => router.push(`/document/${item.document.id}`)}>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={styles.title}>{item.document.title}</Text>
                <Text style={styles.meta}>
                  {item.kind === 'expiry' ? 'Expires' : 'Renews'} {item.date}
                </Text>
              </View>
              <Chip
                label={item.daysLeft < 0 ? `${Math.abs(item.daysLeft)}d overdue` : `${item.daysLeft}d`}
                tone={item.daysLeft <= 14 ? 'rose' : 'amber'}
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
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  list: { padding: spacing.lg, paddingTop: 0, gap: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.paperElevated,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  title: { ...typography.bodyStrong, color: colors.ink },
  meta: { ...typography.caption, color: colors.inkMuted },
});
