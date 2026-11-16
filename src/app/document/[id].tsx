import React, { useEffect, useLayoutEffect, useState } from 'react';
import { Linking, Platform, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useNavigation } from 'expo-router';
import { EmailViewer } from '../../components/EmailViewer';
import { Banner, Button, Chip, Field, Screen } from '../../components/ui';
import { colors, radii, spacing, typography } from '../../constants/theme';
import { useVault } from '../../context/VaultContext';
import { askAiForDetail } from '../../lib/aiDetail';
import { isGmailIndexVersion, openDocumentContent } from '../../lib/documentContent';
import { gmailPermalink } from '../../lib/sanitizeEmailHtml';
import { documentDisplayTitle, documentStorageBadges } from '../../lib/vaultList';
import { getCurrentVersion, listVersionHistory } from '../../lib/versioning';
import {
  isAvailableOffline,
  putOfflineBlob,
  removeOfflineBlob,
} from '../../services/offlineCache';
import { loadDeviceSettings } from '../../services/settingsPersist';
import { SyncSuggestion, VAULT_CATEGORIES, VaultCategory } from '../../types/document';

export default function DocumentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { getDocument, updateDocument, syncDocument, confirmSync } = useVault();
  const navigation = useNavigation();
  const doc = getDocument(id);

  const [title, setTitle] = useState(doc?.title || '');
  const [category, setCategory] = useState<VaultCategory>(doc?.category || 'Other');
  const [issuer, setIssuer] = useState(doc?.metadata.issuer || '');
  const [documentType, setDocumentType] = useState(doc?.metadata.documentType || '');
  const [referenceNumber, setReferenceNumber] = useState(doc?.metadata.referenceNumber || '');
  const [holderName, setHolderName] = useState(doc?.metadata.holderName || '');
  const [issueDate, setIssueDate] = useState(doc?.metadata.issueDate || '');
  const [expiryDate, setExpiryDate] = useState(doc?.metadata.expiryDate || '');
  const [syncing, setSyncing] = useState(false);
  const [suggestion, setSuggestion] = useState<SyncSuggestion | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [keepOffline, setKeepOffline] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [offlineBusy, setOfflineBusy] = useState(false);

  useLayoutEffect(() => {
    navigation.setOptions({ title: doc ? documentDisplayTitle(doc) : 'Document' });
  }, [navigation, doc]);

  useEffect(() => {
    if (!doc) return;
    const ver = getCurrentVersion(doc);
    setOffline(ver ? isAvailableOffline(doc.id, ver.id) : false);
    void loadDeviceSettings().then((s) => setKeepOffline(s.keepDocumentsOnDevice));
  }, [doc]);

  if (!doc) {
    return (
      <Screen>
        <View style={styles.pad}>
          <Text style={styles.missing}>Document not found in your vault index.</Text>
        </View>
      </Screen>
    );
  }

  const current = getCurrentVersion(doc);
  const history = listVersionHistory(doc);
  const badges = documentStorageBadges(doc, { offline });

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.pad}>
        <View style={styles.headerRow}>
          <Chip label={category.replace('/', ' · ')} tone="teal" />
          {badges.map((b) => (
            <Chip key={b} label={b} tone={b === 'On device' ? 'amber' : 'neutral'} />
          ))}
          {doc.metadata.expiryDate ? (
            <Chip label={`Expires ${doc.metadata.expiryDate}`} tone="amber" />
          ) : null}
        </View>

        <Field label="Title" value={title} onChangeText={setTitle} />
        <Text style={styles.hint}>Category</Text>
        <View style={styles.chipWrap}>
          {VAULT_CATEGORIES.map((c) => (
            <Chip
              key={c}
              label={c.includes('/') ? c.split('/')[1] : c}
              tone={category === c ? 'teal' : 'neutral'}
              onPress={() => setCategory(c)}
            />
          ))}
        </View>
        <Field label="Issuer" value={issuer} onChangeText={setIssuer} />
        <Field label="Document type" value={documentType} onChangeText={setDocumentType} />
        <Field label="Reference / policy #" value={referenceNumber} onChangeText={setReferenceNumber} />
        <Field label="Holder" value={holderName} onChangeText={setHolderName} />
        <Field label="Issue date" value={issueDate} onChangeText={setIssueDate} placeholder="YYYY-MM-DD" />
        <Field label="Expiry / renewal" value={expiryDate} onChangeText={setExpiryDate} placeholder="YYYY-MM-DD" />

        <Button
          title="Save metadata"
          onPress={async () => {
            await updateDocument({
              ...doc,
              title,
              category,
              metadata: {
                ...doc.metadata,
                issuer,
                documentType,
                referenceNumber,
                holderName,
                issueDate,
                expiryDate,
              },
              updatedAt: new Date().toISOString(),
            });
            setStatus('Saved to Kadalas index');
          }}
        />

        <View style={styles.block}>
          <Text style={styles.blockTitle}>Current file</Text>
          <Text style={styles.meta}>{current?.fileName}</Text>
          <Text style={styles.meta}>
            {current?.mimeType} · {(current?.sizeBytes || 0).toLocaleString()} bytes
          </Text>
          <Text style={styles.meta}>
            {isGmailIndexVersion(current)
              ? 'Stored as Gmail index (opens live from email)'
              : current?.driveFileId
                ? 'Stored as Drive copy'
                : 'Storage unknown'}
            {offline ? ' · available offline' : ''}
          </Text>
          <View style={styles.row}>
            <Button
              title="Preview / download"
              variant="secondary"
              onPress={async () => {
                setStatus(null);
                const result = await openDocumentContent(doc, { cacheOffline: keepOffline || offline });
                if (!result.ok) {
                  setStatus(result.error);
                  return;
                }
                if (result.openUrl) {
                  if (result.openUrl.startsWith('mock://')) {
                    setStatus('Mock file — no remote preview URL.');
                    return;
                  }
                  await Linking.openURL(result.openUrl);
                  setStatus(`Opened from ${result.source}`);
                  return;
                }
                if (result.dataBase64 && Platform.OS === 'web' && typeof document !== 'undefined') {
                  const binary = atob(result.dataBase64);
                  const bytes = new Uint8Array(binary.length);
                  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                  const blob = new Blob([bytes], { type: result.mimeType || 'application/octet-stream' });
                  const url = URL.createObjectURL(blob);
                  await Linking.openURL(url);
                  setStatus(`Opened from ${result.source}`);
                  if (current) setOffline(isAvailableOffline(doc.id, current.id) || keepOffline);
                  return;
                }
                setStatus(`Loaded from ${result.source} (${result.fileName})`);
              }}
            />
            <Button
              title="Share"
              variant="ghost"
              onPress={async () => {
                const message = `${documentDisplayTitle(doc)}\n${doc.category}\nRef: ${doc.metadata.referenceNumber || '—'}`;
                if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.share) {
                  await navigator.share({ title: doc.title, text: message });
                } else {
                  await Share.share({ message });
                }
              }}
            />
          </View>
          <View style={styles.row}>
            {current?.gmailMessageId ? (
              <>
                <Button title="View email" variant="secondary" onPress={() => setEmailOpen(true)} />
                <Button
                  title="Open in Gmail"
                  variant="ghost"
                  onPress={() => void Linking.openURL(gmailPermalink(current.gmailMessageId!))}
                />
              </>
            ) : null}
          </View>
          <Button
            title={offline ? 'Remove offline copy' : 'Make available offline'}
            variant="ghost"
            loading={offlineBusy}
            onPress={async () => {
              if (!current) return;
              setOfflineBusy(true);
              setStatus(null);
              try {
                if (offline) {
                  await removeOfflineBlob(doc.id, current.id);
                  setOffline(false);
                  setStatus('Removed local copy only (Gmail/Drive untouched).');
                } else {
                  const result = await openDocumentContent(doc, { cacheOffline: true });
                  if (!result.ok || !result.dataBase64) {
                    // For Drive-only, try fetching via open then fail gracefully
                    setStatus(result.ok ? 'Opened Drive file — download bytes unavailable to cache.' : result.error);
                    return;
                  }
                  await putOfflineBlob({
                    docId: doc.id,
                    versionId: current.id,
                    fileName: current.fileName,
                    mimeType: current.mimeType,
                    sizeBytes: current.sizeBytes,
                    dataBase64: result.dataBase64,
                  });
                  setOffline(true);
                  setStatus('Saved on this device for offline viewing.');
                }
              } catch (e) {
                setStatus(e instanceof Error ? e.message : 'Offline cache failed');
              } finally {
                setOfflineBusy(false);
              }
            }}
          />
        </View>

        <View style={styles.block}>
          <Text style={styles.blockTitle}>Ask AI</Text>
          <Text style={styles.meta}>
            Uses your BYOK key to summarize this document (subject, sender, snippet, PDF text when available).
          </Text>
          <Button
            title="Ask AI for more detail"
            loading={aiBusy}
            onPress={async () => {
              setAiBusy(true);
              setStatus(null);
              try {
                const detail = await askAiForDetail({
                  id: doc.id,
                  gmailMessageId: current?.gmailMessageId || '',
                  gmailAttachmentId: current?.gmailAttachmentId || '',
                  subject: current?.gmailSubject || doc.title,
                  from: current?.gmailFrom || '',
                  date: current?.gmailDate || doc.createdAt,
                  fileName: current?.fileName || 'document',
                  mimeType: current?.mimeType || 'application/pdf',
                  sizeBytes: current?.sizeBytes || 0,
                  status: 'approved',
                  previewSnippet: current?.gmailSubject,
                  classification: {
                    category: doc.category,
                    title: doc.title,
                    metadata: doc.metadata,
                    confidence: 0.5,
                    isImportantDocument: true,
                  },
                });
                setAiSummary(
                  [
                    detail.summary,
                    detail.issuer ? `Issuer: ${detail.issuer}` : null,
                    detail.documentType ? `Type: ${detail.documentType}` : null,
                    detail.referenceMasked ? `Ref: ${detail.referenceMasked}` : null,
                    detail.holderName ? `Holder: ${detail.holderName}` : null,
                    detail.registrationNumber ? `Reg: ${detail.registrationNumber}` : null,
                    detail.issueDate || detail.expiryDate
                      ? `Dates: ${detail.issueDate || '—'} → ${detail.expiryDate || '—'}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join('\n'),
                );
              } catch (e) {
                setStatus(e instanceof Error ? e.message : 'Ask AI failed');
              } finally {
                setAiBusy(false);
              }
            }}
          />
          {aiSummary ? <Banner>{aiSummary}</Banner> : null}
        </View>

        <View style={styles.block}>
          <Text style={styles.blockTitle}>Sync from Gmail</Text>
          <Text style={styles.meta}>
            Search for a newer version of this policy/account using issuer, reference, and keywords.
          </Text>
          <Button
            title="Sync"
            loading={syncing}
            onPress={async () => {
              setSyncing(true);
              setSuggestion(null);
              setStatus(null);
              try {
                const result = await syncDocument(doc.id);
                if (!result) {
                  setStatus('No newer matching version found.');
                } else {
                  setSuggestion(result);
                }
              } catch (e) {
                setStatus(e instanceof Error ? e.message : String(e));
              } finally {
                setSyncing(false);
              }
            }}
          />
          {suggestion ? (
            <View style={{ gap: 8, marginTop: 8 }}>
              <Banner>
                Found candidate: {suggestion.candidate.fileName} — {suggestion.reason}
              </Banner>
              <Button
                title="Confirm as newer version"
                onPress={async () => {
                  await confirmSync(suggestion);
                  setSuggestion(null);
                  setStatus('Version updated in vault index');
                }}
              />
            </View>
          ) : null}
        </View>

        {history.length > 1 ? (
          <View style={styles.block}>
            <Text style={styles.blockTitle}>Versions</Text>
            {history.map((v) => (
              <Text key={v.id} style={styles.meta}>
                {v.fileName} · {new Date(v.createdAt).toLocaleDateString()} · {v.source}
              </Text>
            ))}
          </View>
        ) : null}

        {status ? <Banner tone="info">{status}</Banner> : null}
      </ScrollView>

      {current?.gmailMessageId ? (
        <EmailViewer
          visible={emailOpen}
          messageId={current.gmailMessageId}
          attachmentId={current.gmailAttachmentId}
          fileName={current.fileName}
          mimeType={current.mimeType}
          onClose={() => setEmailOpen(false)}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  pad: { padding: spacing.lg, gap: spacing.sm, paddingBottom: 96 },
  missing: { ...typography.body, color: colors.inkMuted, padding: spacing.lg },
  headerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: spacing.sm },
  hint: { ...typography.caption, color: colors.inkMuted },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: spacing.sm },
  block: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: 6,
    backgroundColor: colors.paperElevated,
    marginTop: spacing.sm,
  },
  blockTitle: { ...typography.h3, color: colors.ink },
  meta: { ...typography.caption, color: colors.inkMuted },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
});
