import React, { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing, typography } from '../../constants/theme';

export const SCAN_STEPS = [
  'Connect',
  'Search Gmail',
  'Read attachments',
  'Classify with AI',
  'Ready to review',
] as const;

export const ScanStepper = memo(function ScanStepper({
  activeIndex,
  paused,
}: {
  activeIndex: number;
  paused?: boolean;
}) {
  return (
    <View style={styles.wrap} testID="scan-stepper">
      {SCAN_STEPS.map((label, i) => {
        const done = i < activeIndex;
        const active = i === activeIndex;
        return (
          <View key={label} style={styles.step}>
            <View
              style={[
                styles.dot,
                done && styles.dotDone,
                active && (paused ? styles.dotPaused : styles.dotActive),
              ]}
            >
              <Text style={styles.dotText}>{done ? '✓' : i + 1}</Text>
            </View>
            <Text
              style={[
                styles.label,
                (done || active) && styles.labelActive,
                active && paused && { color: colors.amber },
              ]}
              numberOfLines={2}
            >
              {label}
            </Text>
            {i < SCAN_STEPS.length - 1 ? <View style={styles.line} /> : null}
          </View>
        );
      })}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'flex-start', gap: 4 },
  step: { flex: 1, alignItems: 'center', gap: 6, position: 'relative' },
  dot: {
    width: 28,
    height: 28,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotDone: { backgroundColor: colors.primary, borderColor: colors.primary },
  dotActive: { backgroundColor: colors.primaryContainer, borderColor: colors.primary },
  dotPaused: { backgroundColor: colors.amberSoft, borderColor: colors.amber },
  dotText: { ...typography.caption, color: colors.ink, fontSize: 11 },
  label: { ...typography.caption, color: colors.inkTertiary, textAlign: 'center' },
  labelActive: { color: colors.ink, fontFamily: 'Inter_600SemiBold' },
  line: {
    position: 'absolute',
    top: 14,
    left: '60%',
    right: '-60%',
    height: 1,
    backgroundColor: colors.border,
    zIndex: -1,
  },
});
