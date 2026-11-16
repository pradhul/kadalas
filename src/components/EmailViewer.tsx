import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { colors, radii, spacing, typography } from '../constants/theme';
import { gmailPermalink } from '../lib/sanitizeEmailHtml';
import { getGmailService } from '../services/gmail';
import { GmailMessageView } from '../services/gmail/types';
import { Button } from './ui';

type Props = {
  messageId: string;
  fileName?: string;
  mimeType?: string;
  attachmentId?: string;
  visible: boolean;
  onClose: () => void;
};

export function EmailViewer({
  messageId,
  fileName,
  mimeType,
  attachmentId,
  visible,
  onClose,
}: Props) {
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<GmailMessageView | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPreviewUrl(null);
    void (async () => {
      try {
        const gmail = getGmailService();
        if (!gmail.getMessageView) {
          throw new Error('Email preview is unavailable in this build');
        }
        const msg = await gmail.getMessageView(messageId);
        if (cancelled) return;
        setView(msg);

        if (attachmentId && (mimeType?.includes('pdf') || mimeType?.startsWith('image/'))) {
          try {
            const att = await gmail.getAttachment(messageId, attachmentId, {
              filename: fileName,
              mimeType,
            });
            if (cancelled) return;
            if (Platform.OS === 'web' && typeof document !== 'undefined') {
              const binary = atob(att.dataBase64);
              const bytes = new Uint8Array(binary.length);
              for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
              const blob = new Blob([bytes], { type: mimeType || 'application/octet-stream' });
              setPreviewUrl(URL.createObjectURL(blob));
            }
          } catch {
            /* preview optional */
          }
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load email');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, messageId, attachmentId, fileName, mimeType]);

  const body = (
    <View style={[styles.panel, wide && styles.panelWide]} testID="email-viewer">
      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={2}>
          {view?.subject || 'Email'}
        </Text>
        <Pressable onPress={onClose} hitSlop={12}>
          <Text style={styles.close}>Close</Text>
        </Pressable>
      </View>
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.teal} />
        </View>
      ) : error ? (
        <Text style={styles.error}>{error}</Text>
      ) : view ? (
        <ScrollView contentContainerStyle={styles.body}>
          <Text style={styles.meta}>From: {view.from}</Text>
          <Text style={styles.meta}>Date: {new Date(view.date).toLocaleString()}</Text>
          <Button
            title="Open in Gmail"
            variant="secondary"
            onPress={() => void Linking.openURL(gmailPermalink(messageId))}
          />
          {Platform.OS === 'web' && view.htmlBody ? (
            // eslint-disable-next-line react/no-danger
            <div
              style={{
                marginTop: 12,
                padding: 12,
                background: '#fff',
                border: '1px solid #e5e5e5',
                borderRadius: 8,
                maxHeight: 360,
                overflow: 'auto',
              }}
              // Remote images already stripped by sanitizeEmailHtml
              dangerouslySetInnerHTML={{ __html: view.htmlBody }}
            />
          ) : (
            <Text style={styles.textBody}>{view.textBody || view.snippet}</Text>
          )}
          {previewUrl && Platform.OS === 'web' ? (
            <View style={styles.preview}>
              <Text style={styles.previewLabel}>Attachment: {fileName}</Text>
              {mimeType?.startsWith('image/') ? (
                // eslint-disable-next-line jsx-a11y/alt-text
                <img src={previewUrl} style={{ maxWidth: '100%', borderRadius: 8 }} />
              ) : (
                <iframe
                  title={fileName || 'attachment'}
                  src={previewUrl}
                  style={{ width: '100%', height: 420, border: '1px solid #ddd', borderRadius: 8 }}
                />
              )}
            </View>
          ) : null}
        </ScrollView>
      ) : null}
    </View>
  );

  if (wide && Platform.OS === 'web') {
    if (!visible) return null;
    return <View style={styles.sideDock}>{body}</View>;
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheet}>{body}</View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sideDock: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    width: 420,
    backgroundColor: colors.paperElevated,
    borderLeftWidth: 1,
    borderLeftColor: colors.line,
    zIndex: 40,
  },
  sheet: { flex: 1, backgroundColor: colors.paper },
  panel: { flex: 1 },
  panelWide: {},
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    gap: 12,
  },
  title: { ...typography.h3, color: colors.ink, flex: 1 },
  close: { ...typography.caption, color: colors.teal, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { padding: spacing.md, gap: 8, paddingBottom: 48 },
  meta: { ...typography.caption, color: colors.inkMuted },
  textBody: { ...typography.body, color: colors.ink, marginTop: 8 },
  error: { ...typography.body, color: colors.rose, padding: spacing.md },
  preview: { marginTop: spacing.md, gap: 8 },
  previewLabel: { ...typography.caption, color: colors.inkMuted },
});
