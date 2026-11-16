import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DriveSafetyNote } from '../../components/DriveSafetyNote';
import { ScanCtaCard } from '../../components/ScanCtaCard';
import { BrandMark, Button, Chip, EmptyState, Screen } from '../../components/ui';
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
import { findExpiringSoon } from '../../lib/versioning';
import { isAvailableOffline } from '../../services/offlineCache';
import { getCurrentVersion } from '../../lib/versioning';
import { VAULT_CATEGORIES, VaultCategory } from '../../types/document';

export default function VaultHomeScreen() {
  const { session, isMock } = useAuth();
  const {
    index,
    documents,
    loading,
    error,
    refresh,
    lastSyncedAt,
    vaultFolderUrl,
    scanJob,
    lastScanCandidates,
    scanEngineRunning,
    resumeMailboxScan,
    reviewStats,
  } = useVault();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<VaultCategory | 'all'>('all');

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
    // Keep index fresh when returning to Home after Approve
    void refresh();
  }, []);

  return (
    <Screen>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <BrandMark />
            <Pressable onPress={() => router.push('/add')} style={[styles.iconBtn, styles.iconBtnPrimary]}>
              <Text style={[styles.iconBtnText, { color: '#fff' }]}>Add</Text>
            </Pressable>
          </View>
          <Text style={styles.welcome}>
            {session?.user.name ? `${session.user.name}'s documents` : 'My documents'}
          </Text>
          <Text style={styles.meta}>
            {documents.length} kept
            {isMock ? ' · demo vault' : ' · from your mail & Drive'}
          </Text>

          <View style={styles.dashRow}>
            <DashCard
              label="Documents"
              value={String(documents.length)}
              onPress={() => setCategory('all')}
            />
            <DashCard
              label="To review"
              value={String(pendingReview)}
              tone={pendingReview ? 'amber' : undefined}
              onPress={() => router.push(pendingReview ? '/scan-review' : '/(tabs)/scan')}
            />
            <DashCard
              label="Expiring"
              value={String(expiring.length)}
              tone={expiring.length ? 'rose' : undefined}
              onPress={() => router.push('/(tabs)/expiring')}
            />
          </View>

          <DriveSafetyNote
            vaultFolderUrl={vaultFolderUrl}
            lastSyncedAt={lastSyncedAt}
            documentCount={documents.length}
            compact
          />
          <ScanCtaCard
            cta={scanCta}
            onResume={() => void resumeMailboxScan().catch(() => undefined)}
          />

          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search your documents"
            placeholderTextColor={colors.inkMuted}
            style={styles.search}
            testID="vault-search"
          />
          <View style={styles.chips}>
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
          </View>
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>

        {loading && !documents.length ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={colors.teal} />
        ) : !documents.length ? (
          <EmptyState
            title="No documents yet"
            body="Scan Gmail and approve what you want to keep."
          >
            <Button title="Scan Gmail" onPress={() => router.push('/(tabs)/scan')} />
          </EmptyState>
        ) : !items.length ? (
          <EmptyState title="No matches" body="Try another search or category filter." />
        ) : (
          <FlatList
            data={groups}
            keyExtractor={(g) => g.id}
            contentContainerStyle={styles.list}
            renderItem={({ item: group }) => (
              <View style={styles.group} testID={`vault-group-${group.id}`}>
                <Text style={styles.groupTitle}>
                  {group.label} · {group.count}
                </Text>
                {group.items.map((row) => (
                  <DocumentRow key={`${group.id}-${row.id}`} item={row} />
                ))}
              </View>
            )}
          />
        )}
      </SafeAreaView>
    </Screen>
  );
}

function DashCard({
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
    <Pressable onPress={onPress} style={styles.dashCard} testID={`dash-${label}`}>
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
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.rowTitle} numberOfLines={2}>
          {item.title}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {item.sender ? `${item.sender} · ` : ''}
          {new Date(item.date).toLocaleDateString()}
        </Text>
        <View style={styles.badgeRow}>
          {item.storageBadges.map((b) => (
            <View key={b} style={styles.badge}>
              <Text style={styles.badgeText}>{b}</Text>
            </View>
          ))}
          {item.expiryDate ? (
            <View style={[styles.badge, styles.badgeExpiry]}>
              <Text style={styles.badgeText}>Expires {item.expiryDate}</Text>
            </View>
          ) : null}
        </View>
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.sm },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  iconBtn: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.md,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  iconBtnPrimary: { backgroundColor: colors.teal, borderColor: colors.teal },
  iconBtnText: { ...typography.caption, color: colors.ink, fontWeight: '700' },
  welcome: { ...typography.h2, color: colors.ink },
  meta: { ...typography.caption, color: colors.inkMuted },
  error: { ...typography.caption, color: colors.rose },
  dashRow: { flexDirection: 'row', gap: 8 },
  dashCard: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.md,
    padding: spacing.sm,
    backgroundColor: colors.paperElevated,
  },
  dashValue: { ...typography.h3, color: colors.ink },
  dashLabel: { ...typography.caption, color: colors.inkMuted },
  search: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    ...typography.body,
    color: colors.ink,
    backgroundColor: colors.paperElevated,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  list: { padding: spacing.lg, paddingBottom: 96, gap: spacing.md },
  group: { marginBottom: spacing.md, gap: 6 },
  groupTitle: { ...typography.h3, color: colors.ink, marginBottom: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.md,
    padding: spacing.md,
    backgroundColor: colors.paperElevated,
    marginBottom: 6,
  },
  rowTitle: { ...typography.bodyStrong, color: colors.ink },
  rowMeta: { ...typography.caption, color: colors.inkMuted },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  badge: {
    backgroundColor: colors.tealSoft,
    borderRadius: radii.sm,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  badgeExpiry: { backgroundColor: colors.amberSoft },
  badgeText: { ...typography.caption, color: colors.ink, fontSize: 11 },
  chevron: { ...typography.h3, color: colors.inkMuted },
});
