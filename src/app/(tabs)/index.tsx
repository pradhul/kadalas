import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CategoryChip, CountTile, DocumentRow } from '../../components/design';
import { Banner, BrandMark, Button, EmptyState, Screen } from '../../components/ui';
import { colors, layout, radii, spacing, typography } from '../../constants/theme';
import { useAuth } from '../../context/AuthContext';
import { useVault } from '../../context/VaultContext';
import {
  buildVaultList,
  groupVaultList,
  VaultListItem,
} from '../../lib/vaultList';
import { findExpiringSoon, getCurrentVersion } from '../../lib/versioning';
import { isAvailableOffline } from '../../services/offlineCache';
import { VAULT_CATEGORIES, VaultCategory } from '../../types/document';

export default function VaultHomeScreen() {
  const { width } = useWindowDimensions();
  const desktop = width >= layout.desktopBreakpoint;
  const { session, isMock } = useAuth();
  const {
    index,
    documents,
    loading,
    error,
    indexSaveError,
    refresh,
    lastSyncedAt,
    reviewStats,
  } = useVault();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<VaultCategory | 'all'>('all');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const offlineIds = useMemo(() => {
    const set = new Set<string>();
    for (const doc of documents) {
      const ver = getCurrentVersion(doc);
      if (ver && isAvailableOffline(doc.id, ver.id)) set.add(doc.id);
    }
    return set;
  }, [documents]);

  const items = useMemo(
    () => buildVaultList(index, { query, category, offlineIds }),
    [index, query, category, offlineIds],
  );
  const groups = useMemo(() => groupVaultList(items), [items]);
  const sections = useMemo(
    () =>
      groups.map((g) => ({
        id: g.id,
        title: g.label,
        count: g.count,
        data: collapsed[g.id] ? ([] as VaultListItem[]) : g.items,
      })),
    [groups, collapsed],
  );

  const pendingReview = reviewStats?.toReview ?? 0;
  const expiring = useMemo(() => findExpiringSoon(documents, 60), [documents]);

  useEffect(() => {
    void refresh();
  }, []);

  const toggleSection = useCallback((id: string) => {
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const topChrome = (
    <View style={styles.topChrome} testID="home-top-chrome">
      {!desktop ? (
        <View style={styles.headerTop}>
          <BrandMark />
          <Pressable
            onPress={() => router.push('/add')}
            style={styles.addBtn}
            testID="home-add"
          >
            <Text style={styles.addBtnText}>+ Add</Text>
          </Pressable>
        </View>
      ) : null}
      <Text style={styles.welcome} numberOfLines={1}>
        {session?.user.name ? `${session.user.name}'s documents` : 'My documents'}
        <Text style={styles.metaInline}>
          {' '}
          · {documents.length}
          {isMock ? ' demo' : ''}
        </Text>
      </Text>

      <View style={styles.dashRow} testID="home-dash-row">
        <CountTile
          label="Docs"
          value={documents.length}
          onPress={() => setCategory('all')}
          testID="dash-Docs"
        />
        <CountTile
          label="To review"
          value={pendingReview}
          tone={pendingReview ? 'amber' : undefined}
          onPress={() => router.push(pendingReview ? '/(tabs)/review' : '/(tabs)/scan')}
          testID="dash-Review"
        />
        <CountTile
          label="Expiring"
          value={expiring.length}
          tone={expiring.length ? 'rose' : undefined}
          onPress={() => router.push('/(tabs)/expiring')}
          testID="dash-Expiring"
        />
      </View>

      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search your documents"
        placeholderTextColor={colors.inkTertiary}
        style={styles.search}
        testID="vault-search"
      />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipsScroll}
        testID="home-category-chips"
      >
        <CategoryChip
          label="All"
          selected={category === 'all'}
          onPress={() => setCategory('all')}
        />
        {VAULT_CATEGORIES.map((c) => (
          <CategoryChip
            key={c}
            label={c.includes('/') ? c.split('/')[1] : c}
            selected={category === c}
            onPress={() => setCategory(c)}
          />
        ))}
      </ScrollView>

      {lastSyncedAt ? (
        <Text style={styles.syncLine} numberOfLines={1}>
          Synced {new Date(lastSyncedAt).toLocaleString()}
          {isMock ? ' · demo vault' : ' · Drive / Gmail'}
        </Text>
      ) : null}
      {indexSaveError ? (
        <Banner tone="danger">
          {indexSaveError}
          {'\n'}
          <Text style={styles.retry} onPress={() => void refresh()}>
            Retry
          </Text>
        </Banner>
      ) : null}
      {error && !indexSaveError ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );

  return (
    <Screen>
      <SafeAreaView style={styles.safe} edges={desktop ? [] : ['top']}>
        {topChrome}
        {loading && !documents.length ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />
        ) : !documents.length ? (
          <EmptyState
            title="No documents yet"
            body="Scan Gmail and approve what you want to keep — or email a file to yourself with kadalas in the subject."
          >
            <Button title="Scan Gmail" onPress={() => router.push('/(tabs)/scan')} />
            <Button title="Add document" variant="secondary" onPress={() => router.push('/add')} />
          </EmptyState>
        ) : (
          <SectionList
            style={styles.listFlex}
            sections={sections}
            keyExtractor={(item, i) => `${item.id}-${i}`}
            stickySectionHeadersEnabled
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={
              <EmptyState title="No matches" body="Try another search or category filter." />
            }
            renderSectionHeader={({ section }) => (
              <Pressable
                style={styles.sectionHeader}
                onPress={() => toggleSection(section.id)}
                testID={`vault-group-${section.id}`}
              >
                <Text style={styles.sectionTitle}>
                  {section.title} · {section.count}
                </Text>
                <Text style={styles.sectionChevron}>{collapsed[section.id] ? '▸' : '▾'}</Text>
              </Pressable>
            )}
            renderItem={({ item }) => (
              <View style={styles.rowPad}>
                <DocumentRow
                  title={item.title}
                  meta={[
                    item.sender,
                    new Date(item.date).toLocaleDateString(),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  categoryLabel={item.categoryLabel}
                  storage={item.storageBadges}
                  expiryDate={item.expiryDate}
                  selected={selectedId === item.id}
                  testID={`vault-doc-${item.id}`}
                  onPress={() => {
                    setSelectedId(item.id);
                    router.push(`/document/${item.id}`);
                  }}
                />
              </View>
            )}
            initialNumToRender={14}
            windowSize={10}
          />
        )}
      </SafeAreaView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  listFlex: { flex: 1 },
  topChrome: {
    paddingHorizontal: spacing.pageMobile,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
    backgroundColor: colors.paper,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  addBtn: {
    backgroundColor: colors.primary,
    borderRadius: radii.sm,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  addBtnText: { ...typography.bodyStrong, color: colors.onPrimary },
  welcome: { ...typography.h2, color: colors.ink, fontSize: 18 },
  metaInline: { ...typography.caption, color: colors.inkMuted, fontWeight: '400' },
  dashRow: { flexDirection: 'row', gap: spacing.sm },
  search: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingHorizontal: 12,
    paddingVertical: 8,
    ...typography.body,
    color: colors.ink,
    backgroundColor: colors.surface,
  },
  chipsScroll: { flexDirection: 'row', gap: 6, paddingRight: spacing.md },
  syncLine: { ...typography.caption, color: colors.inkTertiary },
  error: { ...typography.caption, color: colors.rose },
  retry: {
    ...typography.caption,
    color: colors.rose,
    fontFamily: 'Inter_600SemiBold',
    textDecorationLine: 'underline',
  },
  listContent: { paddingBottom: 96, flexGrow: 1 },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.pageMobile,
    paddingTop: 10,
    paddingBottom: 4,
    backgroundColor: colors.paper,
  },
  sectionTitle: { ...typography.bodyStrong, color: colors.ink },
  sectionChevron: { ...typography.caption, color: colors.inkMuted },
  rowPad: { paddingHorizontal: spacing.pageMobile },
});
