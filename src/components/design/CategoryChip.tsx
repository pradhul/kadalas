import React, { memo } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { colors, radii, spacing, typography } from '../../constants/theme';

export const CategoryChip = memo(function CategoryChip({
  label,
  count,
  selected,
  onPress,
}: {
  label: string;
  count?: number;
  selected?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, selected ? styles.selected : styles.outlined]}
    >
      <Text style={[styles.text, selected && styles.textSelected]}>
        {label}
        {typeof count === 'number' ? ` · ${count}` : ''}
      </Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  chip: {
    height: 32,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  outlined: { backgroundColor: colors.surface, borderColor: colors.borderStrong },
  selected: {
    backgroundColor: colors.primaryContainer,
    borderColor: colors.primaryContainer,
  },
  text: { ...typography.label, color: colors.inkMuted },
  textSelected: { color: colors.onPrimaryContainer, fontFamily: 'Inter_600SemiBold' },
});
