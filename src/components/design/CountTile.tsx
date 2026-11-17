import React, { memo } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { colors, radii, spacing, typography } from '../../constants/theme';

export const CountTile = memo(function CountTile({
  label,
  value,
  onPress,
  tone,
  testID,
}: {
  label: string;
  value: string | number;
  onPress?: () => void;
  tone?: 'amber' | 'rose' | 'teal';
  testID?: string;
}) {
  return (
    <Pressable onPress={onPress} style={styles.tile} testID={testID}>
      <Text
        style={[
          styles.value,
          tone === 'amber' && { color: colors.amber },
          tone === 'rose' && { color: colors.rose },
          tone === 'teal' && { color: colors.primary },
        ]}
      >
        {value}
      </Text>
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    gap: 2,
  },
  value: { ...typography.h1, fontSize: 22, lineHeight: 28, color: colors.ink },
  label: { ...typography.caption, color: colors.inkMuted },
});
