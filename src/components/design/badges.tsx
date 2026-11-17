import React, { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radii, typography } from '../../constants/theme';

export const StorageBadge = memo(function StorageBadge({
  kind,
}: {
  kind: 'Gmail' | 'Drive' | 'On device' | 'Added by you';
}) {
  const tone =
    kind === 'Gmail' || kind === 'Added by you'
      ? 'info'
      : kind === 'On device'
        ? 'amber'
        : 'neutral';
  return (
    <View
      style={[
        styles.badge,
        tone === 'info' && styles.info,
        tone === 'amber' && styles.amber,
        tone === 'neutral' && styles.neutral,
      ]}
      testID={`storage-badge-${kind}`}
    >
      <Text style={styles.text}>{kind === 'Gmail' ? 'Gmail link' : kind}</Text>
    </View>
  );
});

export const ExpiryBadge = memo(function ExpiryBadge({
  expiryDate,
  now = Date.now(),
}: {
  expiryDate?: string;
  now?: number;
}) {
  if (!expiryDate) return null;
  const t = Date.parse(expiryDate);
  if (!Number.isFinite(t)) return null;
  const days = Math.ceil((t - now) / (24 * 60 * 60 * 1000));
  if (days < 0) {
    return (
      <View style={[styles.badge, styles.danger]}>
        <Text style={styles.text}>Expired</Text>
      </View>
    );
  }
  if (days <= 60) {
    return (
      <View style={[styles.badge, styles.amber]}>
        <Text style={styles.text}>Expires in {days}d</Text>
      </View>
    );
  }
  return (
    <View style={[styles.badge, styles.success]}>
      <Text style={styles.text}>Valid till {expiryDate}</Text>
    </View>
  );
});

export const ConfidenceBadge = memo(function ConfidenceBadge({
  band,
}: {
  band: 'high' | 'medium' | 'low';
}) {
  if (band === 'high') {
    return (
      <View style={[styles.badge, styles.success]}>
        <Text style={styles.text}>High</Text>
      </View>
    );
  }
  if (band === 'medium') {
    return (
      <View style={[styles.badge, styles.amber]}>
        <Text style={styles.text}>Medium</Text>
      </View>
    );
  }
  return (
    <View style={[styles.badge, styles.danger]}>
      <Text style={styles.text}>Not sure — check before approving</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  badge: {
    height: 20,
    paddingHorizontal: 8,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { ...typography.caption, color: colors.ink, fontSize: 11 },
  info: { backgroundColor: colors.infoSoft },
  amber: { backgroundColor: colors.amberSoft },
  success: { backgroundColor: colors.successSoft },
  danger: { backgroundColor: colors.roseSoft },
  neutral: { backgroundColor: colors.surfaceMuted },
});
