import React, { useLayoutEffect, useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { Chip, EmptyState, Screen } from '../../components/ui';
import { colors, spacing, typography } from '../../constants/theme';
import { useVault } from '../../context/VaultContext';
import { VaultCategory } from '../../types/document';

export default function FolderScreen() {
  const { path } = useLocalSearchParams<{ path: string | string[] }>();
  const navigation = useNavigation();
  const { documents } = useVault();

  const folderPath = Array.isArray(path) ? path.join('/') : path || '';

  useLayoutEffect(() => {
    navigation.setOptions({ title: folderPath.replace('/', ' · ') || 'Folder' });
  }, [navigation, folderPath]);

  const docs = useMemo(
    () =>
      documents.filter(
        (d) => d.category === folderPath || d.category.startsWith(`${folderPath}/`),
      ),
    [documents, folderPath],
  );

  const childFolders = useMemo(() => {
    const set = new Set<string>();
    for (const d of documents) {
      if (!d.category.startsWith(`${folderPath}/`)) continue;
      const rest = d.category.slice(folderPath.length + 1);
      const child = rest.split('/')[0];
      if (child) set.add(`${folderPath}/${child}`);
    }
    return [...set];
  }, [documents, folderPath]);

  return (
    <Screen>
      <FlatList
        style={styles.listFlex}
        data={docs}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          childFolders.length ? (
            <View style={styles.children}>
              {childFolders.map((child) => (
                <Pressable key={child} style={styles.child} onPress={() => router.push(`/folder/${child}`)}>
                  <Text style={styles.childText}>{child.split('/').pop()}</Text>
                </Pressable>
              ))}
            </View>
          ) : (
            <View />
          )
        }
        ListEmptyComponent={<EmptyState title="No documents here" body="Add or scan documents into this folder." />}
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => router.push(`/document/${item.id}`)}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title} numberOfLines={1}>
                {item.title}
              </Text>
              <Text style={styles.meta} numberOfLines={1}>
                {(item.category as VaultCategory).replace('/', ' · ')}
                {item.metadata.referenceNumber ? ` · ${item.metadata.referenceNumber}` : ''}
              </Text>
            </View>
            <Chip label={item.metadata.issuer || 'File'} tone="teal" />
          </Pressable>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  listFlex: { flex: 1 },
  list: { padding: spacing.lg, paddingBottom: spacing.xxl, flexGrow: 1 },
  children: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: spacing.lg },
  child: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: colors.tealSoft,
  },
  childText: { ...typography.caption, color: colors.teal, fontFamily: 'DMSans_600SemiBold' },
  row: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  title: { ...typography.bodyStrong, color: colors.ink },
  meta: { ...typography.caption, color: colors.inkMuted, marginTop: 2 },
});
