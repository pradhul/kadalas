import React, { useEffect, useMemo, useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
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
import { AiProviderId, AiUsageStats } from '../../types/document';

async function openExternal(url: string) {
  if (Platform.OS === 'web') {
    await Linking.openURL(url);
    return;
  }
  await WebBrowser.openBrowserAsync(url);
}

export default function SettingsScreen() {
  const { session, signOut, isMock } = useAuth();
  const { width } = useWindowDimensions();
  const [provider, setProvider] = useState<AiProviderId>('gemini');
  const [apiKey, setApiKey] = useState('');
  const [saved, setSaved] = useState(false);
  const [usage, setUsage] = useState<AiUsageStats | null>(null);
  const [hasKey, setHasKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

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
    })();
    return unsub;
  }, []);

  return (
    <Screen>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView contentContainerStyle={[styles.content, compact && styles.contentCompact]}>
          <SectionTitle title="Settings" subtitle="Account, AI providers, and storage mode." />

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
});
