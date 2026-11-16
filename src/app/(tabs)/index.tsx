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
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Banner, BrandMark, Button, Chip, EmptyState, Screen } from '../../components/ui';
import { colors, radii, spacing, typography } from '../../constants/theme';
import { useAuth } from '../../context/AuthContext';
import { useVault } from '../../context/VaultContext';
import { getActiveStageLabel } from '../../lib/scanPipeline';
import { buildScanCta } from '../../lib/scanCta';
import {
  buildVaultList,
  groupVaultList,
  VaultListItem,
} from '../../lib/vaultList';
import { findExpiringSoon, getCurrentVersion } from '../../lib/versioning';
import { isAvailableOffline } from '../../services/offlineCache';
import { VAULT_CATEGORIES, VaultCategory } from '../../types/document';

const ROW_MIN = 64;

export default function VaultHomeScreen() {
  const { session, isMock } = useAuth();
  const {
    index,
    documents,
    loading,
    error,
    indexSaveError,
    refresh,
    lastSyncedAt,
    scanJob,
    lastScanCandidates,
    scanEngineRunning,
    resumeMailboxScan,
    reviewStats,
  } = useVault();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<VaultCategory | 'all'>('all');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

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

  const scanCta = useMemo(
    () =>
      buildScanCta({
        scanJob,
        scanEngineRunning,
        candidates: lastScanCandidates,
        stageLabel: scanJob
          ? getActiveStageLabel(scanJob.stage, {
              authPause: scanJob.quotaPause?.httpStatus === 401,
            })
          : undefined,
      }),
    [scanJob, scanEngineRunning, lastScanCandidates],
  );

  useEffect(() => {
    void refresh();
  }, []);

  const toggleSection = useCallback((id: string) => {
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const onScanCta = useCallback(() => {
    if (scanCta.kind === 'resume') {
      void resumeMailboxScan().catch(() => undefined);
      return;
    }
    if (scanCta.kind === 'review') {
      router.push('/scan-review');
      return;
    }
    router.push('/(tabs)/scan');
  }, [scanCta.kind, resumeMailboxScan]);

  /** Fixed compact chrome — keeps ≥6 dense rows in the first viewport on ~390px phones. */
  const topChrome = (
    <View style={styles.topChrome} testID="home-top-chrome">
      <View style={styles.headerTop}>
        <BrandMark />
        <View style={styles.headerActions}>
          <Pressable onPress={onScanCta} style={styles.linkBtn} testID="home-scan-link">
            <Text style={styles.linkBtnText}>{scanCta.title}</Text>
          </Pressable>
          <Pressable
            onPress={() => router.push('/add')}
            style={[styles.iconBtn, styles.iconBtnPrimary]}
          >
            <Text style={[styles.iconBtnText, { color: '#fff' }]}>Add</Text>
          </Pressable>
        </View>
      </View>

      <Text style={styles.welcome} numberOfLines={1}>
        {session?.user.name ? `${session.user.name}'s documents` : 'My documents'}
        <Text style={styles.metaInline}>
          {' '}
          · {documents.length}
          {isMock ? ' demo' : ''}
        </Text>
      </Text>

      <View style={styles.dashRow} testID="home-dash-row">
        <DashChip label="Docs" value={String(documents.length)} onPress={() => setCategory('all')} />
        <DashChip
          label="Review"
          value={String(pendingReview)}
          tone={pendingReview ? 'amber' : undefined}
          onPress={() => router.push(pendingReview ? '/scan-review' : '/(tabs)/scan')}
        />
        <DashChip
          label="Expiring"
          value={String(expiring.length)}
          tone={expiring.length ? 'rose' : undefined}
          onPress={() => router.push('/(tabs)/expiring')}
        />
      </View>

      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search your documents"
        placeholderTextColor={colors.inkMuted}
        style={styles.search}
        testID="vault-search"
      />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipsScroll}
        testID="home-category-chips"
      >
        <Chip
          label="All"
          tone={category === 'all' ? 'teal' : undefined}
          onPress={() => setCategory('all')}
        />
        {VAULT_CATEGORIES.map((c) => (
          <Chip
            key={c}
            label={c.includes('/') ? c.split('/')[1] : c}
            tone={category === c ? 'teal' : undefined}
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
      <SafeAreaView style={styles.safe} edges={['top']}>
        {topChrome}
        {loading && !documents.length ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={colors.teal} />
        ) : !documents.length ? (
          <EmptyState
            title="No documents yet"
            body="Scan Gmail and approve what you want to keep."
          >
            <Button title="Scan Gmail" onPress={() => router.push('/(tabs)/scan')} />
          </EmptyState>
        ) : (
          <SectionList
            style={styles.listFlex}
            sections={sections}
            keyExtractor={(item, index) => `${item.id}-${index}`}
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
            renderItem={({ item }) => <DocumentRow item={item} />}
            initialNumToRender={14}
            windowSize={10}
          />
        )}
      </SafeAreaView>
    </Screen>
  );
}

function DashChip({
  label,
  value,
  onPress,
  tone,
}: {
  label: string;
  value: string;
  onPress: () => void;
  tone?: 'amber' | 'rose';
}) {
  return (
    <Pressable onPress={onPress} style={styles.dashChip} testID={`dash-${label}`}>
      <Text
        style={[
          styles.dashValue,
          tone === 'amber' && { color: colors.amber },
          tone === 'rose' && { color: colors.rose },
        ]}
      >
        {value}
      </Text>
      <Text style={styles.dashLabel}>{label}</Text>
    </Pressable>
  );
}

function DocumentRow({ item }: { item: VaultListItem }) {
  return (
    <Pressable
      style={styles.row}
      onPress={() => router.push(`/document/${item.id}`)}
      testID={`vault-doc-${item.id}`}
    >
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {item.title}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {item.sender ? `${item.sender} · ` : ''}
          {new Date(item.date).toLocaleDateString()}
          {item.storageBadges.length ? ` · ${item.storageBadges.join(' · ')}` : ''}
          {item.expiryDate ? ` · exp ${item.expiryDate}` : ''}
        </Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  listFlex: { flex: 1 },
  topChrome: {
    paddingHorizontal: spacing.md,
    paddingTop: 4,
    paddingBottom: 4,
    gap: 6,
    backgroundColor: colors.paper,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  linkBtn: { paddingVertical: 4, paddingHorizontal: 4 },
  linkBtnText: { ...typography.caption, color: colors.teal, fontWeight: '700' },
  iconBtn: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.md,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  iconBtnPrimary: { backgroundColor: colors.teal, borderColor: colors.teal },
  iconBtnText: { ...typography.caption, color: colors.ink, fontWeight: '700' },
  welcome: { ...typography.bodyStrong, color: colors.ink, fontSize: 16 },
  metaInline: { ...typography.caption, color: colors.inkMuted, fontWeight: '400' },
  error: { ...typography.caption, color: colors.rose },
  retry: {
    ...typography.caption,
    color: colors.rose,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  dashRow: { flexDirection: 'row', gap: 6 },
  dashChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.sm,
    paddingVertical: 5,
    paddingHorizontal: 4,
    backgroundColor: colors.paperElevated,
  },
  dashValue: { ...typography.bodyStrong, color: colors.ink, fontSize: 13 },
  dashLabel: { ...typography.caption, color: colors.inkMuted, fontSize: 11 },
  search: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.md,
    paddingHorizontal: 10,
    paddingVertical: 7,
    ...typography.body,
    fontSize: 14,
    color: colors.ink,
    backgroundColor: colors.paperElevated,
  },
  chipsScroll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingRight: spacing.md,
  },
  syncLine: { ...typography.caption, color: colors.inkMuted, fontSize: 11 },
  listContent: {
    paddingBottom: 88,
    flexGrow: 1,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: 8,
    paddingBottom: 4,
    backgroundColor: colors.paper,
  },
  sectionTitle: { ...typography.bodyStrong, color: colors.ink, fontSize: 13 },
  sectionChevron: { ...typography.caption, color: colors.inkMuted },
  row: {
    minHeight: ROW_MIN,
    maxHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: spacing.md,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    backgroundColor: colors.paperElevated,
  },
  rowBody: { flex: 1, gap: 2, justifyContent: 'center' },
  rowTitle: { ...typography.bodyStrong, color: colors.ink, fontSize: 14 },
  rowMeta: { ...typography.caption, color: colors.inkMuted, fontSize: 11 },
  chevron: { ...typography.h3, color: colors.inkMuted, fontSize: 18 },
});
