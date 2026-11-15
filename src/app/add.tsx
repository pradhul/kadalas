import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { router } from 'expo-router';
import { Banner, Button, Field, Screen } from '../components/ui';
import { colors, spacing, typography } from '../constants/theme';
import { useVault } from '../context/VaultContext';
import { classifyWithRules } from '../lib/categorisation';
import { getAiService } from '../services/ai';
import { ClassificationResult, VAULT_CATEGORIES } from '../types/document';

export default function AddDocumentScreen() {
  const { addDocument } = useVault();
  const [fileName, setFileName] = useState('');
  const [mimeType, setMimeType] = useState('application/pdf');
  const [contentBase64, setContentBase64] = useState('');
  const [classification, setClassification] = useState<ClassificationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

    let base64 = '';
    if (asset.uri.startsWith('data:')) {
      base64 = asset.uri.split(',')[1] || '';
    } else if (typeof fetch === 'function') {
      try {
        const res = await fetch(asset.uri);
        const buf = await res.arrayBuffer();
        base64 = arrayBufferToBase64(buf);
      } catch {
        base64 = btoaCompat(`local-file:${asset.name}:${asset.size || 0}`);
      }
    } else {
      base64 = btoaCompat(`local-file:${asset.name}`);
    }
    setContentBase64(base64);

    setBusy(true);
    try {
      const ai = getAiService();
      const hasKey = await ai.hasApiKey();
      const classified = hasKey
        ? await ai.classifyDocument({
            fileName: asset.name,
            mimeType: asset.mimeType || 'application/pdf',
            dataBase64: base64,
          })
        : classifyWithRules({ fileName: asset.name, mimeType: asset.mimeType || 'application/pdf' });
      setClassification(classified);
    } catch (e) {
      const fallback = classifyWithRules({ fileName: asset.name, mimeType: asset.mimeType || 'application/pdf' });
      setClassification(fallback);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.pad}>
        <Text style={styles.lead}>
          Pick a PDF or image. AI (or rules) suggest a category and metadata — edit anything before saving to Drive.
        </Text>

        <Button title="Choose file" onPress={pickFile} loading={busy} />

        {!fileName ? (
          <View style={{ marginTop: spacing.md }}>
            <Button
              title="Use demo sample PDF"
              variant="secondary"
              onPress={async () => {
                const name = 'sample-vehicle-policy.pdf';
                const sample = btoaCompat('DEMO POLICY POL-DEMO-001 GEICO vehicle insurance renewal 2026-12-01');
                setFileName(name);
                setMimeType('application/pdf');
                setContentBase64(sample);
                const classified = classifyWithRules({
                  fileName: name,
                  textExcerpt: 'GEICO vehicle insurance policy POL-DEMO-001 renewal expiry 2026-12-01',
                  subject: 'GEICO policy',
                });
                setClassification(classified);
              }}
            />
          </View>
        ) : null}

        {fileName ? <Text style={styles.file}>{fileName}</Text> : null}
        {error ? <Banner tone="warn">{error}</Banner> : null}

        {classification ? (
          <View style={{ marginTop: spacing.md }}>
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
              label="Document type"
              value={classification.metadata.documentType || ''}
              onChangeText={(documentType) =>
                setClassification({
                  ...classification,
                  metadata: { ...classification.metadata, documentType },
                })
              }
            />
            <Field
              label="Reference number"
              value={classification.metadata.referenceNumber || ''}
              onChangeText={(referenceNumber) =>
                setClassification({
                  ...classification,
                  metadata: { ...classification.metadata, referenceNumber },
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
              title="Save to Drive vault"
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
  pad: { padding: spacing.lg, paddingBottom: spacing.xxl },
  lead: { ...typography.body, color: colors.inkMuted, marginBottom: spacing.lg },
  file: { ...typography.bodyStrong, color: colors.ink, marginTop: spacing.md },
  hint: { ...typography.caption, color: colors.inkMuted, marginBottom: spacing.md },
});
