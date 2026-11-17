import React, { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, layout, radii, spacing, typography } from '../../constants/theme';
import { categoryIconName } from '../../lib/categoryIcons';
import { ExpiryBadge, StorageBadge } from './badges';

export type DocumentRowProps = {
  title: string;
  meta: string;
  categoryLabel?: string;
  storage?: Array<'Gmail' | 'Drive' | 'On device' | 'Added by you'>;
  expiryDate?: string;
  selected?: boolean;
  onPress?: () => void;
  testID?: string;
};

const CATEGORY_TINT: Record<string, string> = {
  Banking: '#E5ECF8',
  Tax: '#FCEFD9',
  Identity: '#DCEFEA',
  Travel: '#E5ECF8',
  Bills: '#F1EFE9',
  Warranties: '#F1EFE9',
  Other: '#F1EFE9',
  Insurance: '#E3F3EA',
};

export const DocumentRow = memo(function DocumentRow({
  title,
  meta,
  categoryLabel,
  storage = [],
  expiryDate,
  selected,
  onPress,
  testID,
}: DocumentRowProps) {
  const tintKey = categoryLabel?.startsWith('Insurance')
    ? 'Insurance'
    : categoryLabel || 'Other';
  const tint = CATEGORY_TINT[tintKey] || colors.primaryContainer;
  const icon = categoryIconName(categoryLabel);

  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.row,
        selected && styles.selected,
        pressed && styles.pressed,
      ]}
    >
      {selected ? <View style={styles.selectedBar} /> : null}
      <View style={[styles.icon, { backgroundColor: tint }]}>
        <Ionicons name={icon} size={18} color={colors.onPrimaryContainer} />
      </View>
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {meta}
        </Text>
      </View>
      <View style={styles.badges}>
        {storage.map((s) => (
          <StorageBadge key={s} kind={s} />
        ))}
        <ExpiryBadge expiryDate={expiryDate} />
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: {
    minHeight: layout.denseRowMobile,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    marginBottom: spacing.xs,
    overflow: 'hidden',
  },
  selected: { backgroundColor: colors.primaryContainer },
  selectedBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    backgroundColor: colors.primary,
  },
  pressed: { backgroundColor: colors.surfaceMuted },
  icon: {
    width: 36,
    height: 36,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, gap: 2 },
  title: { ...typography.h3, fontSize: 15, color: colors.ink },
  meta: { ...typography.caption, color: colors.inkMuted },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, maxWidth: 140, justifyContent: 'flex-end' },
});
