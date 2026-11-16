import React, { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { colors, radii, spacing, typography } from '../constants/theme';
import { ScanCta } from '../lib/scanCta';
import { Button } from './ui';

type Props = {
  cta: ScanCta;
  onScan?: () => void;
  onResume?: () => void;
  busy?: boolean;
};

export const ScanCtaCard = memo(function ScanCtaCard({ cta, onScan, onResume, busy }: Props) {
  if (cta.kind === 'progress') {
    return (
      <View style={styles.card} testID="scan-cta-progress">
        <Text style={styles.title}>Scan in progress</Text>
        {cta.subtitle ? <Text style={styles.sub}>{cta.subtitle}</Text> : null}
        <View style={styles.barTrack}>
          <View style={[styles.barFill, { width: `${cta.percent ?? 0}%` }]} />
        </View>
        <Button title={cta.title} variant="secondary" onPress={() => router.push('/(tabs)/scan')} />
      </View>
    );
  }

  if (cta.kind === 'resume') {
    return (
      <View style={styles.card} testID="scan-cta-resume">
        <Text style={styles.title}>{cta.title}</Text>
        {cta.subtitle ? <Text style={styles.sub}>{cta.subtitle}</Text> : null}
        <Button title="Resume scan" loading={busy} onPress={() => onResume?.()} />
      </View>
    );
  }

  if (cta.kind === 'review') {
    return (
      <View style={styles.card} testID="scan-cta-review">
        <Text style={styles.title}>{cta.title}</Text>
        {cta.subtitle ? <Text style={styles.sub}>{cta.subtitle}</Text> : null}
        <Button title={cta.title} onPress={() => router.push('/scan-review')} />
      </View>
    );
  }

  return (
    <View style={styles.card} testID="scan-cta-scan">
      <Text style={styles.title}>{cta.title}</Text>
      {cta.subtitle ? <Text style={styles.sub}>{cta.subtitle}</Text> : null}
      <Button
        title="Scan Gmail"
        loading={busy}
        onPress={() => {
          if (onScan) onScan();
          else router.push('/(tabs)/scan');
        }}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.lg,
    backgroundColor: colors.paperElevated,
    padding: spacing.md,
    gap: 8,
    marginBottom: spacing.md,
  },
  title: { ...typography.h3, color: colors.ink },
  sub: { ...typography.caption, color: colors.inkMuted },
  barTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.line,
    overflow: 'hidden',
  },
  barFill: {
    height: 8,
    backgroundColor: colors.teal,
  },
});
