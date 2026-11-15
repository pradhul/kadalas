import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Chip, EmptyState, Field, Screen } from '../components/ui';
import { colors, spacing, typography } from '../constants/theme';
import { useVault } from '../context/VaultContext';

export default function SearchScreen() {
  const { search } = useVault();
  const [query, setQuery] = useState('');
  const results = useMemo(() => search(query), [search, query]);

  return (
    <Screen>
      <View style={styles.pad}>
        <Field label="Search" value={query} onChangeText={setQuery} placeholder="Title, issuer, reference…" />
      </View>
      <FlatList
        data={results}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          query ? (
            <EmptyState title="No matches" body="Try another issuer, reference number, or keyword." />
          ) : (
            <EmptyState title="Search the vault" body="Matches titles and metadata across all folders." />
          )
        }
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => router.push(`/document/${item.id}`)}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{item.title}</Text>
              <Text style={styles.meta}>
                {item.category.replace('/', ' · ')}
                {item.metadata.referenceNumber ? ` · ${item.metadata.referenceNumber}` : ''}
              </Text>
            </View>
            <Chip label={item.metadata.issuer || 'Doc'} tone="teal" />
          </Pressable>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  pad: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  list: { padding: spacing.lg, paddingTop: 0 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  title: { ...typography.bodyStrong, color: colors.ink },
  meta: { ...typography.caption, color: colors.inkMuted, marginTop: 2 },
});
