import React, { memo } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing, typography } from '../../constants/theme';
import { gmailPermalink } from '../../lib/sanitizeEmailHtml';

export const EmailPane = memo(function EmailPane({
  from,
  subject,
  date,
  snippet,
  attachmentName,
  messageId,
  onClose,
  sheet,
}: {
  from?: string;
  subject?: string;
  date?: string;
  snippet?: string;
  attachmentName?: string;
  messageId?: string;
  onClose?: () => void;
  sheet?: boolean;
}) {
  return (
    <View style={[styles.pane, sheet && styles.sheet]} testID="email-pane">
      <View style={styles.header}>
        <Text style={styles.overline}>Source email</Text>
        {onClose ? (
          <Pressable onPress={onClose}>
            <Text style={styles.close}>Close</Text>
          </Pressable>
        ) : null}
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.subject}>{subject || 'Untitled'}</Text>
        <Text style={styles.meta}>From {from || '—'}</Text>
        <Text style={styles.meta}>{date ? new Date(date).toLocaleString() : ''}</Text>
        {attachmentName ? (
          <View style={styles.att}>
            <Text style={styles.attText}>📎 {attachmentName}</Text>
          </View>
        ) : null}
        <Text style={styles.snippet}>{snippet || 'No preview available.'}</Text>
        {messageId ? (
          <Pressable onPress={() => void Linking.openURL(gmailPermalink(messageId))}>
            <Text style={styles.link}>Open in Gmail →</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
});

const styles = StyleSheet.create({
  pane: {
    flex: 1,
    backgroundColor: colors.surface,
    borderLeftWidth: 1,
    borderLeftColor: colors.border,
    minWidth: 320,
  },
  sheet: {
    borderLeftWidth: 0,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    maxHeight: '80%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.infoSoft,
  },
  overline: { ...typography.overline, color: colors.info },
  close: { ...typography.bodyStrong, color: colors.primary },
  body: { padding: spacing.lg, gap: spacing.sm },
  subject: { ...typography.h3, color: colors.ink },
  meta: { ...typography.caption, color: colors.inkMuted },
  att: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  attText: { ...typography.caption, color: colors.ink },
  snippet: { ...typography.body, color: colors.ink, marginTop: spacing.sm },
  link: { ...typography.bodyStrong, color: colors.info, marginTop: spacing.md },
});
