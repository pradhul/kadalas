import React from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing, typography } from '../constants/theme';
import { vaultSafetyLine } from '../lib/storageCopy';
import { StorageMode } from '../types/settings';

function formatSyncedAt(iso: string | null | undefined): string {
  if (!iso) return 'Not synced yet';
  try {
    return `Last synced ${new Date(iso).toLocaleString()}`;
  } catch {
    return 'Last synced recently';
  }
}

export function DriveSafetyNote({
  vaultFolderUrl,
  lastSyncedAt,
  compact,
  documentCount,
  storageMode = 'gmail_index',
}: {
  vaultFolderUrl: string | null;
  lastSyncedAt: string | null;
  compact?: boolean;
  documentCount?: number;
  storageMode?: StorageMode;
}) {
  return (
    <View style={[styles.box, compact && styles.boxCompact]} testID="drive-safety-note">
      <Text style={styles.text}>{vaultSafetyLine(storageMode)}</Text>
      {typeof documentCount === 'number' ? (
        <Text style={styles.meta} testID="vault-index-doc-count">
          {documentCount} document{documentCount === 1 ? '' : 's'} in your vault
        </Text>
      ) : null}
      <Text style={styles.meta}>{formatSyncedAt(lastSyncedAt)}</Text>
      {vaultFolderUrl ? (
        <Pressable
          onPress={() => void Linking.openURL(vaultFolderUrl)}
          accessibilityRole="link"
          testID="open-drive-folder"
        >
          <Text style={styles.link}>
            {storageMode === 'gmail_index'
              ? 'Open vault index folder in Drive →'
              : 'Open Kadalas folder in Drive →'}
          </Text>
        </Pressable>
      ) : (
        <Text style={styles.meta}>Demo mode keeps the vault index in this browser only.</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.primaryContainer,
    padding: spacing.lg,
    gap: 4,
  },
  boxCompact: { padding: spacing.sm },
  text: { ...typography.caption, color: colors.ink, lineHeight: 18 },
  meta: { ...typography.caption, color: colors.inkMuted, fontSize: 12 },
  link: {
    ...typography.caption,
    color: colors.primary,
    fontFamily: 'Inter_600SemiBold',
    marginTop: 2,
  },
});
