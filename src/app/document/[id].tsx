import React, { useEffect, useLayoutEffect, useState } from 'react';
import { Alert, Linking, Platform, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useNavigation } from 'expo-router';
import { Banner, Button, Chip, Field, Screen } from '../../components/ui';
import { colors, radii, spacing, typography } from '../../constants/theme';
import { useVault } from '../../context/VaultContext';
import { isGmailIndexVersion, openDocumentContent } from '../../lib/documentContent';
import { getCurrentVersion, listVersionHistory } from '../../lib/versioning';
import { isAvailableOffline, removeOfflineBlob } from '../../services/offlineCache';
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

  useLayoutEffect(() => {
    navigation.setOptions({ title: doc?.title || 'Document' });
  }, [navigation, doc?.title]);

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
          <Text style={styles.missing}>Document not found.</Text>
        </View>
      </Screen>
    );
  }

  const current = getCurrentVersion(doc);
  const history = listVersionHistory(doc);

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.pad}>
        <View style={styles.headerRow}>
          <Chip label={category.replace('/', ' · ')} tone="teal" />
          {doc.metadata.expiryDate ? <Chip label={`Expires ${doc.metadata.expiryDate}`} tone="amber" /> : null}
        </View>

        <Field label="Title" value={title} onChangeText={setTitle} />
        <Field label="Category (exact path)" value={category} onChangeText={(v) => setCategory(v as VaultCategory)} />
        <Text style={styles.hint}>Known: {VAULT_CATEGORIES.join(', ')}</Text>
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
          <Text style={styles.meta}>{current?.mimeType} · {(current?.sizeBytes || 0).toLocaleString()} bytes</Text>
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
                const result = await openDocumentContent(doc, { cacheOffline: keepOffline });
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
                if (current) setOffline(isAvailableOffline(doc.id, current.id) || keepOffline);
              }}
            />
            <Button
              title="Share"
              variant="ghost"
              onPress={async () => {
                const message = `${doc.title}\n${doc.category}\nRef: ${doc.metadata.referenceNumber || '—'}`;
                if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.share) {
                  await navigator.share({ title: doc.title, text: message });
                } else {
                  await Share.share({ message });
                }
              }}
            />
          </View>
          {offline && current ? (
            <Button
              title="Remove offline copy"
              variant="ghost"
              onPress={async () => {
                await removeOfflineBlob(doc.id, current.id);
                setOffline(false);
                setStatus('Removed local copy only (Gmail/Drive untouched).');
              }}
            />
          ) : null}
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
            <View style={styles.suggestion}>
              <Banner>
                Found: {suggestion.candidate.fileName} — {suggestion.reason} (confidence{' '}
                {Math.round(suggestion.confidence * 100)}%)
              </Banner>
              <Text style={styles.meta}>{suggestion.candidate.subject}</Text>
              <Text style={styles.meta}>From {suggestion.candidate.from}</Text>
              <Text style={styles.meta}>{new Date(suggestion.candidate.date).toLocaleString()}</Text>
              <View style={styles.row}>
                <Button
                  title="Make current version"
                  onPress={async () => {
                    await confirmSync(suggestion);
                    setSuggestion(null);
                    setStatus('New version saved; previous kept in history.');
                    if (Platform.OS !== 'web') {
                      Alert.alert('Synced', 'Document updated from Gmail.');
                    }
                  }}
                />
                <Button title="Dismiss" variant="ghost" onPress={() => setSuggestion(null)} />
              </View>
            </View>
          ) : null}
        </View>

        <View style={styles.block}>
          <Text style={styles.blockTitle}>Version history</Text>
          {history.map((v) => (
            <View key={v.id} style={styles.versionRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.metaStrong}>
                  {v.fileName}
                  {v.id === doc.currentVersionId ? ' · current' : ''}
                </Text>
                <Text style={styles.meta}>
                  {new Date(v.createdAt).toLocaleString()} · {v.source}
                </Text>
              </View>
            </View>
          ))}
        </View>

        {status ? <Banner>{status}</Banner> : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  pad: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: 4 },
  headerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: spacing.md },
  hint: { ...typography.caption, color: colors.inkMuted, marginBottom: spacing.md },
  block: {
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.paperElevated,
    gap: 8,
  },
  blockTitle: { ...typography.h3, color: colors.ink },
  meta: { ...typography.caption, color: colors.inkMuted },
  metaStrong: { ...typography.bodyStrong, color: colors.ink },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  suggestion: { marginTop: 8, gap: 6 },
  versionRow: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  missing: { ...typography.body, color: colors.inkMuted, padding: spacing.lg },
});
