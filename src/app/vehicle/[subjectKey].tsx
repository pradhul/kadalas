import React, { useMemo } from 'react';
import { StyleSheet, Text, View, ScrollView, Pressable } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Banner, Screen, SectionTitle } from '../../components/ui';
import { colors, radii, spacing, typography } from '../../constants/theme';
import { useVault } from '../../context/VaultContext';
import {
  collectCoverageExpiryAlerts,
  formatCoverageType,
  resolveSubjectCoverage,
  VEHICLE_COVERAGE_SCHEMA,
  VEHICLE_SLOTS,
} from '../../lib/coverageSlots';
import { resolveSubjectKey } from '../../lib/subjectKey';
import { listVersionHistory } from '../../lib/versioning';

export default function VehicleCoverScreen() {
  const { subjectKey: raw } = useLocalSearchParams<{ subjectKey: string }>();
  const subjectKey = decodeURIComponent(raw ?? '');
  const { documents } = useVault();

  const docs = useMemo(() => {
    return documents.filter((d) => {
      if (!d.category.startsWith('Insurance/Vehicle')) return false;
      const key =
        d.metadata.subjectKey ||
        resolveSubjectKey({ category: d.category, metadata: d.metadata }).subjectKey;
      return key === subjectKey;
    });
  }, [documents, subjectKey]);

  const view = useMemo(() => {
    const label = docs[0]?.metadata.subjectLabel || subjectKey;
    return resolveSubjectCoverage({
      subjectKey,
      subjectLabel: label,
      schema: VEHICLE_COVERAGE_SCHEMA,
      documents: docs,
      expiringWithinDays: 45,
    });
  }, [docs, subjectKey]);

  const alerts = useMemo(
    () => collectCoverageExpiryAlerts([view], 45),
    [view],
  );

  const history = useMemo(() => {
    return docs.flatMap((d) =>
      listVersionHistory(d)
        .slice(1)
        .map((v) => ({
          id: v.id,
          label: `${d.metadata.coverageType ?? d.metadata.documentType ?? 'policy'} · ${d.metadata.issuer ?? ''} · ${v.fileName}`,
        })),
    );
  }, [docs]);

  return (
    <Screen>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()}>
            <Text style={styles.back}>← Back</Text>
          </Pressable>
          <SectionTitle
            title={view.subjectLabel || subjectKey || 'Vehicle'}
            subtitle="Coverage slots — Own Damage and Third Party can be separate policies"
          />
        </View>
        <ScrollView contentContainerStyle={styles.body} testID="vehicle-cover-view">
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLine}>{view.summary}</Text>
          </View>

          {alerts.length ? (
            <Banner tone="warn">{alerts.map((a) => `${a.slotLabel}: ${a.kind === 'gap' ? 'coverage gap' : `expires in ${a.daysLeft}d`}`).join('\n')}</Banner>
          ) : (
            <Banner>Both coverage slots look healthy for the next 45 days.</Banner>
          )}

          {VEHICLE_SLOTS.map((slotDef) => {
            const filled = view.slots.find((s) => s.slot.id === slotDef.id);
            const current = filled?.current;
            const doc = current?.document;
            const vaultDoc = doc && 'versions' in doc ? doc : null;
            return (
              <View key={slotDef.id} style={styles.slotCard} testID={`slot-${slotDef.id}`}>
                <Text style={styles.slotLabel}>{slotDef.label}</Text>
                {current && vaultDoc ? (
                  <>
                    <Text style={styles.slotValue}>
                      Covered by {current.insurer ?? 'Unknown'} until {current.periodEnd ?? '—'}
                    </Text>
                    <Text style={styles.meta}>
                      {formatCoverageType(current.coverageType)} ·{' '}
                      {vaultDoc.metadata.referenceNumber ?? vaultDoc.title}
                    </Text>
                    <Pressable onPress={() => router.push(`/document/${vaultDoc.id}`)}>
                      <Text style={styles.link}>Open current document →</Text>
                    </Pressable>
                  </>
                ) : (
                  <Text style={styles.gap}>No policy covering this slot — gap</Text>
                )}
              </View>
            );
          })}

          {history.length ? (
            <View style={styles.history}>
              <Text style={styles.historyTitle}>Version history</Text>
              {history.map((h) => (
                <Text key={h.id} style={styles.meta}>
                  {h.label}
                </Text>
              ))}
            </View>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  back: { ...typography.caption, color: colors.teal, marginBottom: spacing.sm },
  body: { padding: spacing.lg, gap: spacing.md, paddingBottom: 48 },
  summaryCard: {
    backgroundColor: colors.tealSoft,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: 6,
  },
  summaryLine: { ...typography.h3, color: colors.ink },
  meta: { ...typography.caption, color: colors.inkMuted },
  slotCard: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.lg,
    padding: spacing.md,
    backgroundColor: colors.paperElevated,
    gap: 4,
  },
  slotLabel: {
    ...typography.caption,
    color: colors.teal,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  slotValue: { ...typography.bodyStrong, color: colors.ink },
  gap: { ...typography.body, color: colors.amber },
  link: { ...typography.caption, color: colors.teal, marginTop: 4 },
  history: { gap: 4, marginTop: spacing.sm },
  historyTitle: { ...typography.bodyStrong, color: colors.ink, marginBottom: 4 },
});
