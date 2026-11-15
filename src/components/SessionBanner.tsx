import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { colors, spacing, typography } from '../constants/theme';
import { Button } from './ui';

/** Shown across the app when the web Google access token needs interactive reconnect. */
export function SessionBanner() {
  const { needsReconnect, reconnectGoogle, loading, session, isMock } = useAuth();

  if (!needsReconnect || !session || isMock) return null;

  return (
    <View style={styles.wrap} accessibilityRole="alert">
      <Text style={styles.text}>Session expired — tap to reconnect Google</Text>
      <Button title="Reconnect" loading={loading} onPress={() => void reconnectGoogle()} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.amberSoft,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  text: {
    ...typography.caption,
    color: colors.ink,
  },
});
