import React from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing, typography } from '../constants/theme';

function formatSyncedAt(iso: string | null | undefined): string {
  if (!iso) return 'Not synced yet';
  try {
    const d = new Date(iso);
    return `Last synced ${d.toLocaleString()}`;
  } catch {
    return 'Last synced recently';
  }
}

export function DriveSafetyNote({
  vaultFolderUrl,
  lastSyncedAt,
  compact,
}: {
  vaultFolderUrl: string | null;
  lastSyncedAt: string | null;
  compact?: boolean;
}) {
  return (
    <View style={[styles.box, compact && styles.boxCompact]} testID="drive-safety-note">
      <Text style={styles.text}>
        Everything you approve is saved in your Google Drive (Kadalas folder). Closing the app is safe.
      </Text>
      <Text style={styles.meta}>{formatSyncedAt(lastSyncedAt)}</Text>
      {vaultFolderUrl ? (
        <Pressable
          onPress={() => void Linking.openURL(vaultFolderUrl)}
          accessibilityRole="link"
          testID="open-drive-folder"
        >
          <Text style={styles.link}>Open Kadalas in Google Drive →</Text>
        </Pressable>
      ) : (
        <Text style={styles.meta}>Demo mode keeps files in this browser only.</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.md,
    backgroundColor: colors.tealSoft,
    padding: spacing.md,
    gap: 4,
  },
  boxCompact: {
    padding: spacing.sm,
  },
  text: {
    ...typography.caption,
    color: colors.ink,
    lineHeight: 18,
  },
  meta: {
    ...typography.caption,
    color: colors.inkMuted,
    fontSize: 12,
  },
  link: {
    ...typography.caption,
    color: colors.teal,
    fontWeight: '600',
    marginTop: 2,
  },
});
