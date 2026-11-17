import React, { useState } from 'react';
import {
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { RequireAuth } from '../components/RequireAuth';
import { Banner, Button, Field, Screen } from '../components/ui';
import { colors, radii, spacing, typography } from '../constants/theme';
import { useAuth } from '../context/AuthContext';
import { useVault } from '../context/VaultContext';
import { classifyWithRules } from '../lib/categorisation';
import { mailtoKadalasCompose } from '../lib/selfSentMail';
import { getAiService } from '../services/ai';
import { ClassificationResult, VAULT_CATEGORIES } from '../types/document';

export default function AddDocumentScreen() {
  return (
    <RequireAuth>
      <AddDocumentBody />
    </RequireAuth>
  );
}

function AddDocumentBody() {
  const { session } = useAuth();
  const { addDocument, storageMode, checkSelfSentDocuments } = useVault();
  const ownEmail = session?.user.email || '';
  const [fileName, setFileName] = useState('');
  const [mimeType, setMimeType] = useState('application/pdf');
  const [contentBase64, setContentBase64] = useState('');
  const [classification, setClassification] = useState<ClassificationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [checkBusy, setCheckBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkMsg, setCheckMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function classifyFile(name: string, mime: string, base64: string) {
    setBusy(true);
    try {
      const ai = getAiService();
      const hasKey = await ai.hasApiKey();
      const classified = hasKey
        ? await ai.classifyDocument({ fileName: name, mimeType: mime, dataBase64: base64 })
        : classifyWithRules({ fileName: name, mimeType: mime });
      setClassification(classified);
    } catch (e) {
      setClassification(classifyWithRules({ fileName: name, mimeType: mime }));
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function pickFile() {
    setError(null);
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'image/*'],
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    setFileName(asset.name);
    setMimeType(asset.mimeType || 'application/pdf');
    const base64 = await readUriBase64(asset.uri, asset.name, asset.size);
    setContentBase64(base64);
    await classifyFile(asset.name, asset.mimeType || 'application/pdf', base64);
  }

  async function takePhoto() {
    setError(null);
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      setError('Camera permission is required to take a photo.');
      return;
    }
    const shot = await ImagePicker.launchCameraAsync({
      quality: 0.85,
      base64: true,
    });
    if (shot.canceled || !shot.assets?.[0]) return;
    const asset = shot.assets[0];
    const name = `photo-${Date.now()}.jpg`;
    const mime = asset.mimeType || 'image/jpeg';
    const base64 = asset.base64 || '';
    setFileName(name);
    setMimeType(mime);
    setContentBase64(base64);
    await classifyFile(name, mime, base64);
  }

  async function copyEmail() {
    try {
      if (Platform.OS === 'web' && navigator.clipboard) {
        await navigator.clipboard.writeText(ownEmail);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      setError('Could not copy — select the address manually.');
    }
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.pad}>
        <Text style={styles.h2}>Email it to yourself</Text>
        <Text style={styles.lead}>
          Send any PDF or photo to your own address with <Text style={styles.em}>kadalas</Text> in
          the subject (or #kadalas in the body). On the next check we auto-add it — nothing in Gmail
          is deleted or modified.
        </Text>
        <View style={styles.emailBox}>
          <Text style={styles.email}>{ownEmail}</Text>
          <Button title={copied ? 'Copied' : 'Copy'} variant="secondary" onPress={() => void copyEmail()} />
        </View>
        <Text style={styles.hint}>Subject format: kadalas: car RC</Text>
        <Button
          title="Open Gmail to compose"
          variant="secondary"
          onPress={() => void Linking.openURL(mailtoKadalasCompose(ownEmail))}
        />
        <Button
          title="Check now"
          loading={checkBusy}
          onPress={async () => {
            setCheckBusy(true);
            setCheckMsg(null);
            try {
              const r = await checkSelfSentDocuments();
              setCheckMsg(
                `Found ${r.found} · auto-added ${r.autoApproved} · review ${r.queuedForReview} · already kept ${r.skippedDuplicate}`,
              );
            } catch (e) {
              setCheckMsg(e instanceof Error ? e.message : String(e));
            } finally {
              setCheckBusy(false);
            }
          }}
        />
        {checkMsg ? <Banner>{checkMsg}</Banner> : null}

        <View style={styles.divider} />

        <Text style={styles.h2}>Upload in the app</Text>
        {storageMode === 'gmail_index' ? (
          <Banner>
            Uploads are saved to Google Drive › Kadalas (Gmail can’t be written with our scopes). Prefer
            emailing yourself if you want a Gmail pointer instead.
          </Banner>
        ) : null}

        <View style={styles.row}>
          <Button title="Choose file" onPress={() => void pickFile()} loading={busy} />
          {Platform.OS !== 'web' ? (
            <Button title="Take photo" variant="secondary" onPress={() => void takePhoto()} />
          ) : null}
        </View>

        {!fileName ? (
          <Button
            title="Use demo sample PDF"
            variant="ghost"
            onPress={async () => {
              const name = 'sample-vehicle-policy.pdf';
              const sample = btoaCompat('DEMO POLICY POL-DEMO-001 GEICO vehicle insurance renewal 2026-12-01');
              setFileName(name);
              setMimeType('application/pdf');
              setContentBase64(sample);
              setClassification(
                classifyWithRules({
                  fileName: name,
                  textExcerpt: 'GEICO vehicle insurance policy POL-DEMO-001 renewal expiry 2026-12-01',
                  subject: 'GEICO policy',
                }),
              );
            }}
          />
        ) : null}

        {fileName ? <Text style={styles.file}>{fileName}</Text> : null}
        {error ? <Banner tone="warn">{error}</Banner> : null}

        {classification ? (
          <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
            <Field
              label="Title"
              value={classification.title}
              onChangeText={(title) => setClassification({ ...classification, title })}
            />
            <Field
              label="Category"
              value={classification.category}
              onChangeText={(category) =>
                setClassification({
                  ...classification,
                  category: category as ClassificationResult['category'],
                })
              }
            />
            <Text style={styles.hint}>{VAULT_CATEGORIES.join(' · ')}</Text>
            <Field
              label="Issuer"
              value={classification.metadata.issuer || ''}
              onChangeText={(issuer) =>
                setClassification({
                  ...classification,
                  metadata: { ...classification.metadata, issuer },
                })
              }
            />
            <Field
              label="Expiry date"
              value={classification.metadata.expiryDate || ''}
              onChangeText={(expiryDate) =>
                setClassification({
                  ...classification,
                  metadata: { ...classification.metadata, expiryDate },
                })
              }
            />
            <Button
              title="Save to Kadalas (Drive)"
              loading={busy}
              onPress={async () => {
                if (!classification || !contentBase64) return;
                setBusy(true);
                try {
                  const doc = await addDocument({
                    fileName,
                    mimeType,
                    contentBase64,
                    classification,
                  });
                  router.replace(`/document/${doc.id}`);
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                } finally {
                  setBusy(false);
                }
              }}
            />
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

async function readUriBase64(uri: string, name: string, size?: number | null): Promise<string> {
  if (uri.startsWith('data:')) return uri.split(',')[1] || '';
  if (typeof fetch === 'function') {
    try {
      const res = await fetch(uri);
      const buf = await res.arrayBuffer();
      return arrayBufferToBase64(buf);
    } catch {
      return btoaCompat(`local-file:${name}:${size || 0}`);
    }
  }
  return btoaCompat(`local-file:${name}`);
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoaCompat(binary);
}

function btoaCompat(value: string): string {
  if (typeof globalThis.btoa === 'function') return globalThis.btoa(value);
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  let output = '';
  for (let i = 0; i < value.length; i += 3) {
    const a = value.charCodeAt(i);
    const b = i + 1 < value.length ? value.charCodeAt(i + 1) : NaN;
    const c = i + 2 < value.length ? value.charCodeAt(i + 2) : NaN;
    const bitmap = (a << 16) | ((Number.isNaN(b) ? 0 : b) << 8) | (Number.isNaN(c) ? 0 : c);
    output += chars.charAt((bitmap >> 18) & 63);
    output += chars.charAt((bitmap >> 12) & 63);
    output += Number.isNaN(b) ? '=' : chars.charAt((bitmap >> 6) & 63);
    output += Number.isNaN(c) ? '=' : chars.charAt(bitmap & 63);
  }
  return output;
}

const styles = StyleSheet.create({
  pad: { padding: spacing.pageMobile, paddingBottom: spacing.huge, gap: spacing.sm },
  h2: { ...typography.h2, color: colors.ink, marginTop: spacing.sm },
  lead: { ...typography.body, color: colors.inkMuted },
  em: { fontFamily: 'Inter_600SemiBold', color: colors.primary },
  emailBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    padding: spacing.md,
  },
  email: { ...typography.bodyStrong, color: colors.ink, flex: 1 },
  hint: { ...typography.caption, color: colors.inkMuted },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.md },
  row: { gap: spacing.sm },
  file: { ...typography.bodyStrong, color: colors.ink },
});
