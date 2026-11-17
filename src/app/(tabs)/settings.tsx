import React, { useEffect, useMemo, useState } from 'react';
import {
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Banner, Button, Field, Screen, SectionTitle } from '../../components/ui';
import { colors, radii, spacing, typography } from '../../constants/theme';
import { useAuth } from '../../context/AuthContext';
import { AI_PROVIDER_OPTIONS, getAiService } from '../../services/ai';
import { useMocks } from '../../services/config';
import {
  clearAiApiKey,
  getAiApiKey,
  isWebStorageWarningNeeded,
  saveAiApiKey,
} from '../../services/secureStorage';
import { AiProviderId, AiUsageStats, VaultCategory } from '../../types/document';
import { categoryLabel } from '../../lib/folders';
import { openDocumentContent } from '../../lib/documentContent';
import {
  applyMoves,
  hasOrganizeUndo,
  proposeMoves,
  ProposedMove,
  undoLastOrganize,
} from '../../lib/organizeDrive';
import { getCurrentVersion } from '../../lib/versioning';
import { useVault } from '../../context/VaultContext';
import { getDriveService } from '../../services/drive';
import {
  formatBytes,
  listOfflineMeta,
  offlineStorageBytes,
  putOfflineBlob,
  removeOfflineBlob,
} from '../../services/offlineCache';
import { loadOrganizeUndo, saveOrganizeUndo } from '../../services/organizePersist';
import { StorageRadioCard } from '../../components/design';
import { loadDeviceSettings, saveDeviceSettings } from '../../services/settingsPersist';
import { StorageMode } from '../../types/settings';

async function openExternal(url: string) {
  if (Platform.OS === 'web') {
    await Linking.openURL(url);
    return;
  }
  await WebBrowser.openBrowserAsync(url);
}

export default function SettingsScreen() {
  const { session, signOut, isMock } = useAuth();
  const { documents, index, refresh, storageMode, setStorageMode } = useVault();
  const { width } = useWindowDimensions();
  const [provider, setProvider] = useState<AiProviderId>('gemini');
  const [apiKey, setApiKey] = useState('');
  const [saved, setSaved] = useState(false);
  const [usage, setUsage] = useState<AiUsageStats | null>(null);
  const [hasKey, setHasKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [organizePreview, setOrganizePreview] = useState<ProposedMove[] | null>(null);
  const [organizeBusy, setOrganizeBusy] = useState(false);
  const [organizeMessage, setOrganizeMessage] = useState<string | null>(null);
  const [canUndoOrganize, setCanUndoOrganize] = useState(false);
  const [keepOffline, setKeepOffline] = useState(false);
  const [treatSelfSent, setTreatSelfSent] = useState(false);
  const [offlineBytes, setOfflineBytes] = useState(0);
  const [offlineBusy, setOfflineBusy] = useState(false);
  const [storageMessage, setStorageMessage] = useState<string | null>(null);

  const selected = useMemo(
    () => AI_PROVIDER_OPTIONS.find((o) => o.id === provider) ?? AI_PROVIDER_OPTIONS[0],
    [provider],
  );

  const compact = width < 420;

  useEffect(() => {
    const ai = getAiService();
    setProvider(ai.getProviderId());
    const unsub = ai.subscribeUsage(setUsage);
    void (async () => {
      setHasKey(await ai.hasApiKey());
      const existing = await getAiApiKey(ai.getProviderId());
      if (existing) setApiKey(existing);
      const drive = getDriveService();
      const undoLocal = await loadOrganizeUndo();
      setCanUndoOrganize(undoLocal.moves.length > 0 || (await hasOrganizeUndo(drive)));
      const device = await loadDeviceSettings();
      setKeepOffline(device.keepDocumentsOnDevice);
      setTreatSelfSent(device.treatSelfSentAttachmentsAsDocuments);
      setOfflineBytes(offlineStorageBytes());
    })();
    return unsub;
  }, []);

  async function applyStorageMode(mode: StorageMode) {
    setStorageMessage(null);
    try {
      await setStorageMode(mode);
      setStorageMessage(
        mode === 'gmail_index'
          ? 'New approvals will index Gmail only (no Drive upload). Existing Drive copies stay.'
          : 'New approvals will copy files into Google Drive. Existing Drive copies stay.',
      );
    } catch (e) {
      setStorageMessage(e instanceof Error ? e.message : 'Could not save storage mode');
    }
  }

  async function toggleKeepOffline(next: boolean) {
    setKeepOffline(next);
    const prev = await loadDeviceSettings();
    await saveDeviceSettings({ ...prev, keepDocumentsOnDevice: next });
    setOfflineBusy(true);
    setStorageMessage(null);
    try {
      if (next) {
        let cached = 0;
        for (const doc of documents) {
          const ver = getCurrentVersion(doc);
          if (!ver) continue;
          const result = await openDocumentContent(doc, { cacheOffline: true });
          if (result.ok && result.dataBase64) {
            await putOfflineBlob({
              docId: doc.id,
              versionId: ver.id,
              fileName: ver.fileName,
              mimeType: ver.mimeType,
              sizeBytes: ver.sizeBytes,
              dataBase64: result.dataBase64,
            });
            cached += 1;
          }
        }
        setStorageMessage(
          cached
            ? `Kept ${cached} document(s) on this device for offline viewing.`
            : 'Offline toggle on — documents will cache as you open them.',
        );
      } else {
        for (const meta of listOfflineMeta()) {
          await removeOfflineBlob(meta.docId, meta.versionId);
        }
        setStorageMessage('Cleared local copies on this device only (Gmail/Drive untouched).');
      }
      setOfflineBytes(offlineStorageBytes());
    } catch (e) {
      setStorageMessage(e instanceof Error ? e.message : 'Offline sync failed');
    } finally {
      setOfflineBusy(false);
    }
  }

  return (
    <Screen>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView contentContainerStyle={[styles.content, compact && styles.contentCompact]}>
          <SectionTitle title="Settings" subtitle="Account, AI providers, and storage mode." />

          <View style={styles.card}>
            <Text style={styles.label}>Storage</Text>
            <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
              <StorageRadioCard
                title="Gmail index (default)"
                body="Approve saves a tiny pointer — nothing copied into Drive. Opening fetches live from Gmail."
                selected={storageMode === 'gmail_index'}
                onPress={() => void applyStorageMode('gmail_index')}
                testID="storage-gmail-index"
              />
              <StorageRadioCard
                title="Drive copies"
                body="Approve uploads into Kadalas/. Existing Drive files keep working. Switching never deletes."
                selected={storageMode === 'drive_copies'}
                onPress={() => void applyStorageMode('drive_copies')}
                testID="storage-drive-copies"
              />
            </View>
            <View style={styles.toggleRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.value}>Keep documents on this device</Text>
                <Text style={styles.meta}>
                  Offline viewing via local cache
                  {Platform.OS === 'web' ? ' (IndexedDB)' : ' (device storage)'}. Clearing this only removes the
                  device copy.
                </Text>
                <Text style={styles.meta}>Storage used: {formatBytes(offlineBytes)}</Text>
              </View>
              <Switch
                value={keepOffline}
                disabled={offlineBusy}
                onValueChange={(v) => void toggleKeepOffline(v)}
                trackColor={{ true: colors.teal, false: colors.line }}
                testID="keep-offline-toggle"
              />
            </View>
            <View style={styles.toggleRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.value}>Treat self-sent attachments as documents</Text>
                <Text style={styles.meta}>
                  Any email you send to yourself with an attachment goes to Review (top priority). Default off —
                  kadalas-tagged subjects still auto-add.
                </Text>
              </View>
              <Switch
                value={treatSelfSent}
                onValueChange={(v) => {
                  setTreatSelfSent(v);
                  void loadDeviceSettings().then((prev) =>
                    saveDeviceSettings({ ...prev, treatSelfSentAttachmentsAsDocuments: v }),
                  );
                }}
                trackColor={{ true: colors.teal, false: colors.line }}
                testID="treat-self-sent-toggle"
              />
            </View>
            {storageMessage ? <Banner tone="info">{storageMessage}</Banner> : null}
          </View>

          <View style={styles.card}>
            <Text style={styles.label}>Signed in</Text>
            <Text style={styles.value} numberOfLines={2}>
              {session?.user.email}
            </Text>
            <Text style={styles.meta}>{isMock || useMocks() ? 'Mock Google session' : 'Google OAuth'}</Text>
            <View style={{ marginTop: spacing.md }}>
              <Button
                title="Sign out"
                variant="secondary"
                onPress={async () => {
                  await signOut();
                  router.replace('/sign-in');
                }}
              />
            </View>
          </View>

          <Text style={styles.section}>AI provider (bring your own key)</Text>
          {isWebStorageWarningNeeded() ? (
            <Banner tone="warn">
              On web, API keys are stored in localStorage in this browser. Prefer a private device. Native builds use
              expo-secure-store.
            </Banner>
          ) : (
            <Banner>Keys stay on-device via expo-secure-store. Requests go directly to the provider.</Banner>
          )}

          <View style={styles.providerList}>
            {AI_PROVIDER_OPTIONS.map((opt) => (
              <Pressable
                key={opt.id}
                onPress={async () => {
                  setProvider(opt.id);
                  await getAiService().setProvider(opt.id);
                  const existing = await getAiApiKey(opt.id);
                  setApiKey(existing || '');
                  setHasKey(await getAiService().hasApiKey());
                  setSaved(false);
                  setTestResult(null);
                }}
                style={[styles.provider, provider === opt.id && styles.providerActive]}
              >
                <View style={styles.providerHeader}>
                  <Text style={styles.providerTitle}>{opt.label}</Text>
                  {opt.tier === 'paid' ? (
                    <Text style={styles.paidBadge}>paid</Text>
                  ) : opt.tier === 'free' ? (
                    <Text style={styles.freeBadge}>free</Text>
                  ) : null}
                </View>
                <Text style={styles.meta}>{opt.hint}</Text>
              </Pressable>
            ))}
          </View>

          {provider !== 'mock' ? (
            <View style={styles.keyBlock}>
              <Text style={styles.instructions}>{selected.instructions}</Text>
              {selected.getKeyUrl ? (
                <Pressable
                  accessibilityRole="link"
                  onPress={() => void openExternal(selected.getKeyUrl!)}
                  style={styles.linkRow}
                >
                  <Text style={styles.link}>{selected.getKeyCta ?? 'Get a free key'}</Text>
                  <Text style={styles.linkHint} numberOfLines={1}>
                    {selected.getKeyUrl.replace(/^https?:\/\//, '')}
                  </Text>
                </Pressable>
              ) : null}

              <Field
                label={`${selected.label} API key`}
                value={apiKey}
                onChangeText={(v) => {
                  setApiKey(v);
                  setSaved(false);
                  setTestResult(null);
                }}
                placeholder="Paste key"
                secureTextEntry
                showToggle
              />
              <View style={[styles.row, compact && styles.rowWrap]}>
                <Button
                  title={saved ? 'Saved' : 'Save key'}
                  onPress={async () => {
                    await saveAiApiKey(provider, apiKey);
                    await getAiService().setProvider(provider);
                    setHasKey(await getAiService().hasApiKey());
                    setSaved(true);
                    setTestResult(null);
                  }}
                />
                <Button
                  title="Test key"
                  variant="secondary"
                  loading={testing}
                  onPress={async () => {
                    setTesting(true);
                    setTestResult(null);
                    try {
                      if (apiKey.trim()) {
                        await saveAiApiKey(provider, apiKey);
                        await getAiService().setProvider(provider);
                        setSaved(true);
                      }
                      const result = await getAiService().testKey();
                      setTestResult(result);
                      setHasKey(await getAiService().hasApiKey());
                    } finally {
                      setTesting(false);
                    }
                  }}
                />
                <Button
                  title="Clear"
                  variant="ghost"
                  onPress={async () => {
                    await clearAiApiKey(provider);
                    setApiKey('');
                    setHasKey(false);
                    setSaved(false);
                    setTestResult(null);
                  }}
                />
              </View>
              {testResult ? (
                <Banner tone={testResult.ok ? 'info' : 'warn'}>{testResult.message}</Banner>
              ) : null}
            </View>
          ) : (
            <Banner>{selected.instructions}</Banner>
          )}

          <View style={styles.card}>
            <Text style={styles.label}>Usage</Text>
            <Text style={styles.meta}>
              {hasKey || provider === 'mock'
                ? 'AI classification enabled'
                : 'No key — rule-based categorisation only'}
            </Text>
            <Text style={styles.meta}>Requests today: {usage?.requestsToday ?? 0}</Text>
            <Text style={styles.meta}>Queue depth: {usage?.queueDepth ?? 0}</Text>
            {usage?.rateLimitedUntil ? (
              <Text style={[styles.meta, { color: colors.amber }]}>
                Backing off until {new Date(usage.rateLimitedUntil).toLocaleTimeString()}
              </Text>
            ) : null}
            {usage?.lastError ? (
              <Text style={[styles.meta, { color: colors.rose }]}>Last error: {usage.lastError}</Text>
            ) : null}
          </View>

          <View style={styles.card}>
            <Text style={styles.label}>Organize Drive</Text>
            <Text style={styles.meta}>
              Move vault files into the correct Kadalas category folders (add/remove parents only — files are never
              deleted). Preview first, then confirm.
            </Text>
            <View style={[styles.row, compact && styles.rowWrap, { marginTop: spacing.sm }]}>
              <Button
                title={organizeBusy ? 'Working…' : 'Organize Drive'}
                variant="secondary"
                loading={organizeBusy}
                onPress={() => {
                  setOrganizeMessage(null);
                  const moves = proposeMoves(documents);
                  setOrganizePreview(moves);
                  if (!moves.length) {
                    setOrganizeMessage('All vault files already match their category folders.');
                  }
                }}
              />
              <Button
                title="Undo last organize"
                variant="ghost"
                disabled={!canUndoOrganize || organizeBusy || !index}
                onPress={async () => {
                  if (!index) return;
                  setOrganizeBusy(true);
                  setOrganizeMessage(null);
                  try {
                    const drive = getDriveService();
                    const { restored } = await undoLastOrganize(drive, index);
                    await refresh();
                    setOrganizePreview(null);
                    setCanUndoOrganize(
                      (await loadOrganizeUndo()).moves.length > 0 ||
                        (await hasOrganizeUndo(drive)),
                    );
                    setOrganizeMessage(
                      restored ? `Restored ${restored} file(s) to their prior folders.` : 'Nothing to undo.',
                    );
                  } catch (e) {
                    setOrganizeMessage(e instanceof Error ? e.message : 'Undo failed');
                  } finally {
                    setOrganizeBusy(false);
                  }
                }}
              />
            </View>
            {organizeMessage ? <Banner tone="info">{organizeMessage}</Banner> : null}
            {organizePreview && organizePreview.length > 0 ? (
              <View style={styles.previewBlock}>
                <Text style={styles.meta}>
                  {organizePreview.length} file{organizePreview.length === 1 ? '' : 's'} to move
                </Text>
                {organizePreview.map((m) => (
                  <View key={m.docId} style={styles.previewRow}>
                    <Text style={styles.previewTitle} numberOfLines={1}>
                      {documents.find((d) => d.id === m.docId)?.title ?? m.docId}
                    </Text>
                    <Text style={styles.meta} numberOfLines={2}>
                      {m.fromPath} → {categoryLabel(m.toCategory as VaultCategory)} — {m.reason}
                    </Text>
                  </View>
                ))}
                <Button
                  title="Confirm organize"
                  loading={organizeBusy}
                  onPress={async () => {
                    if (!index || !organizePreview.length) return;
                    setOrganizeBusy(true);
                    setOrganizeMessage(null);
                    try {
                      const drive = getDriveService();
                      const { applied, undo } = await applyMoves(drive, index, organizePreview);
                      await saveOrganizeUndo(undo);
                      await refresh();
                      setOrganizePreview(null);
                      setCanUndoOrganize(true);
                      setOrganizeMessage(`Moved ${applied} file(s). You can undo once from here.`);
                    } catch (e) {
                      setOrganizeMessage(e instanceof Error ? e.message : 'Organize failed');
                    } finally {
                      setOrganizeBusy(false);
                    }
                  }}
                />
                <Button
                  title="Cancel preview"
                  variant="ghost"
                  onPress={() => setOrganizePreview(null)}
                />
              </View>
            ) : null}
          </View>

          <View style={styles.card}>
            <Text style={styles.label}>Scopes & privacy</Text>
            <Text style={styles.meta}>
              gmail.readonly (restricted — Google verification required before public OAuth). drive.file (app-created
              files only). No app backend; the Kadalas index lives in your Drive.
            </Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, maxWidth: 720, width: '100%', alignSelf: 'center' },
  contentCompact: { paddingHorizontal: spacing.md },
  card: {
    backgroundColor: colors.paperElevated,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    gap: 4,
  },
  label: { ...typography.label, color: colors.inkMuted },
  value: { ...typography.h3, color: colors.ink },
  meta: { ...typography.caption, color: colors.inkMuted },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  section: { ...typography.h3, color: colors.ink, marginBottom: spacing.sm },
  providerList: { gap: spacing.sm, marginBottom: spacing.md },
  provider: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.md,
    padding: spacing.md,
    backgroundColor: colors.paperElevated,
  },
  providerActive: {
    borderColor: colors.teal,
    backgroundColor: colors.tealSoft,
  },
  providerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: 2,
  },
  providerTitle: { ...typography.bodyStrong, color: colors.ink, flexShrink: 1 },
  freeBadge: {
    ...typography.caption,
    color: colors.teal,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  paidBadge: {
    ...typography.caption,
    color: colors.amber,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  keyBlock: { marginBottom: spacing.lg },
  instructions: { ...typography.caption, color: colors.inkMuted, marginBottom: spacing.sm },
  linkRow: { marginBottom: spacing.md, gap: 2 },
  link: { ...typography.bodyStrong, color: colors.teal },
  linkHint: { ...typography.caption, color: colors.inkMuted },
  row: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center', marginBottom: spacing.md, flexWrap: 'wrap' },
  rowWrap: { flexDirection: 'column', alignItems: 'stretch' },
  previewBlock: { marginTop: spacing.md, gap: spacing.sm },
  previewRow: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: spacing.sm,
    gap: 2,
  },
  previewTitle: { ...typography.caption, color: colors.ink, fontWeight: '600' },
});
