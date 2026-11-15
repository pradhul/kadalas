import React, { useMemo, useRef, useEffect } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Link, router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BrandMark, Button, Chip, EmptyState, Screen } from '../../components/ui';
import { colors, radii, spacing, typography } from '../../constants/theme';
import { useAuth } from '../../context/AuthContext';
import { useVault } from '../../context/VaultContext';
import { buildFolderTree } from '../../lib/folders';
import { buildVehicleCoverViews } from '../../lib/grouping';
import { VAULT_CATEGORIES, VaultCategory } from '../../types/document';

export default function VaultHomeScreen() {
  const { session, isMock } = useAuth();
  const { documents, loading, error, refresh } = useVault();
  const { width } = useWindowDimensions();
  const columns = width >= 900 ? 3 : width >= 600 ? 2 : 1;
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fade, { toValue: 1, duration: 450, useNativeDriver: true }).start();
  }, [fade]);

  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const cat of VAULT_CATEGORIES) map[cat] = 0;
    for (const doc of documents) map[doc.category] = (map[doc.category] || 0) + 1;
    return map;
  }, [documents]);

  const vehicles = useMemo(() => buildVehicleCoverViews(documents), [documents]);

  const topFolders = buildFolderTree().children;

  return (
    <Screen>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <Animated.View style={[styles.header, { opacity: fade }]}>
          <View style={styles.headerTop}>
            <BrandMark />
            <View style={styles.headerActions}>
              <Pressable onPress={() => router.push('/search')} style={styles.iconBtn}>
                <Text style={styles.iconBtnText}>Search</Text>
              </Pressable>
              <Pressable onPress={() => router.push('/add')} style={[styles.iconBtn, styles.iconBtnPrimary]}>
                <Text style={[styles.iconBtnText, { color: '#fff' }]}>Add</Text>
              </Pressable>
            </View>
          </View>
          <Text style={styles.welcome}>
            {session?.user.name ? `${session.user.name}'s vault` : 'Your vault'}
          </Text>
          <Text style={styles.meta}>
            {documents.length} documents
            {isMock ? ' · mock Drive' : ' · Google Drive'}
          </Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </Animated.View>

        {loading && !documents.length ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={colors.teal} />
        ) : !documents.length ? (
          <EmptyState
            title="Vault is empty"
            body="Add a PDF or scan Gmail to start filing documents into your Drive folders."
          />
        ) : (
          <FlatList
            data={topFolders}
            key={columns}
            numColumns={columns}
            keyExtractor={(item) => item.path || item.name}
            contentContainerStyle={styles.list}
            columnWrapperStyle={columns > 1 ? styles.row : undefined}
            refreshing={loading}
            onRefresh={refresh}
            ListHeaderComponent={
              <View style={styles.recentBlock}>
                {vehicles.length ? (
                  <View style={{ marginBottom: spacing.lg }}>
                    <Text style={styles.sectionLabel}>Vehicles</Text>
                    {vehicles.map((v) => (
                      <Pressable
                        key={v.subjectKey}
                        style={styles.vehicleRow}
                        testID={`vehicle-row-${v.subjectKey}`}
                        onPress={() => router.push(`/vehicle/${encodeURIComponent(v.subjectKey)}`)}
                      >
                        <Text style={styles.recentTitle}>{v.subjectLabel}</Text>
                        <Text style={styles.recentMeta}>{v.summary}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
                <Text style={styles.sectionLabel}>Recent</Text>
                {documents
                  .slice()
                  .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
                  .slice(0, 4)
                  .map((doc) => (
                    <Link key={doc.id} href={`/document/${doc.id}`} asChild>
                      <Pressable style={styles.recentRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.recentTitle}>{doc.title}</Text>
                          <Text style={styles.recentMeta}>
                            {doc.category.replace('/', ' · ')}
                            {doc.metadata.issuer ? ` · ${doc.metadata.issuer}` : ''}
                          </Text>
                        </View>
                        <Chip label={doc.metadata.documentType || 'Doc'} tone="teal" />
                      </Pressable>
                    </Link>
                  ))}
                <Text style={[styles.sectionLabel, { marginTop: spacing.lg }]}>Folders</Text>
              </View>
            }
            renderItem={({ item, index }) => {
              const childCats = item.children.length
                ? item.children.map((c) => c.path as VaultCategory)
                : [item.path as VaultCategory];
              const total = childCats.reduce((sum, c) => sum + (counts[c] || 0), 0);
              return (
                <Animated.View
                  style={{
                    flex: columns > 1 ? 1 : undefined,
                    opacity: fade,
                    transform: [
                      {
                        translateY: fade.interpolate({
                          inputRange: [0, 1],
                          outputRange: [12 + index * 4, 0],
                        }),
                      },
                    ],
                  }}
                >
                  <Pressable
                    style={styles.folderCard}
                    onPress={() => router.push(`/folder/${item.path}`)}
                  >
                    <Text style={styles.folderName}>{item.name}</Text>
                    <Text style={styles.folderCount}>
                      {total} {total === 1 ? 'document' : 'documents'}
                    </Text>
                    {item.children.length ? (
                      <Text style={styles.folderKids}>
                        {item.children.map((c) => c.name).join(' · ')}
                      </Text>
                    ) : null}
                  </Pressable>
                </Animated.View>
              );
            }}
          />
        )}

        {!documents.length ? (
          <View style={styles.footerCta}>
            <Button title="Scan Gmail" onPress={() => router.push('/(tabs)/scan')} />
          </View>
        ) : null}
      </SafeAreaView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    gap: 4,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  headerActions: { flexDirection: 'row', gap: 8 },
  iconBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radii.sm,
    backgroundColor: colors.paperElevated,
    borderWidth: 1,
    borderColor: colors.line,
  },
  iconBtnPrimary: { backgroundColor: colors.teal, borderColor: colors.teal },
  iconBtnText: { ...typography.caption, color: colors.ink, fontFamily: 'DMSans_600SemiBold' },
  welcome: { ...typography.h1, color: colors.ink },
  meta: { ...typography.caption, color: colors.inkMuted },
  error: { ...typography.caption, color: colors.rose, marginTop: 4 },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  row: { gap: spacing.md },
  recentBlock: { marginBottom: spacing.sm },
  sectionLabel: {
    ...typography.label,
    color: colors.inkMuted,
    marginBottom: spacing.sm,
  },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  recentTitle: { ...typography.bodyStrong, color: colors.ink },
  recentMeta: { ...typography.caption, color: colors.inkMuted, marginTop: 2 },
  vehicleRow: {
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
    gap: 4,
  },
  folderCard: {
    backgroundColor: colors.paperElevated,
    borderRadius: radii.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.line,
    minHeight: 110,
    justifyContent: 'center',
    gap: 4,
  },
  folderName: { ...typography.h2, color: colors.ink, fontSize: 18 },
  folderCount: { ...typography.caption, color: colors.teal },
  folderKids: { ...typography.caption, color: colors.inkMuted },
  footerCta: { padding: spacing.lg },
});
