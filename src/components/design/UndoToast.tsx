import React, { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing, typography } from '../../constants/theme';

export const UndoToast = memo(function UndoToast({
  message,
  onUndo,
  visible,
}: {
  message: string;
  onUndo?: () => void;
  visible: boolean;
}) {
  if (!visible) return null;
  return (
    <View style={styles.wrap} testID="undo-toast">
      <Text style={styles.text} numberOfLines={2}>
        {message}
      </Text>
      {onUndo ? (
        <Pressable onPress={onUndo} hitSlop={8}>
          <Text style={styles.undo}>Undo</Text>
        </Pressable>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: 88,
    backgroundColor: colors.ink,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    zIndex: 50,
  },
  text: { ...typography.body, color: '#fff', flex: 1 },
  undo: { ...typography.bodyStrong, color: colors.primaryContainer },
});
