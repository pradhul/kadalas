import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View, Pressable } from 'react-native';
import { router } from 'expo-router';
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

export default function SettingsScreen() {
  const { session, signOut, isMock } = useAuth();
  const [provider, setProvider] = useState<AiProviderId>('gemini');
  const [apiKey, setApiKey] = useState('');
  const [saved, setSaved] = useState(false);
  const [usage, setUsage] = useState<AiUsageStats | null>(null);
  const [hasKey, setHasKey] = useState(false);

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
        <ScrollView contentContainerStyle={styles.content}>
          <SectionTitle title="Settings" subtitle="Account, AI providers, and storage mode." />

          <View style={styles.card}>
            <Text style={styles.label}>Signed in</Text>
            <Text style={styles.value}>{session?.user.email}</Text>
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
                }}
                style={[styles.provider, provider === opt.id && styles.providerActive]}
              >
                <Text style={styles.providerTitle}>{opt.label}</Text>
                <Text style={styles.meta}>{opt.hint}</Text>
              </Pressable>
            ))}
          </View>

          {provider !== 'mock' ? (
            <>
              <Field
                label={`${provider} API key`}
                value={apiKey}
                onChangeText={(v) => {
                  setApiKey(v);
                  setSaved(false);
                }}
                placeholder="Paste key"
                secureTextEntry
              />
              <View style={styles.row}>
                <Button
                  title={saved ? 'Saved' : 'Save key'}
                  onPress={async () => {
                    await saveAiApiKey(provider, apiKey);
                    await getAiService().setProvider(provider);
                    setHasKey(await getAiService().hasApiKey());
                    setSaved(true);
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
                  }}
                />
              </View>
            </>
          ) : null}

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
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
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
  providerTitle: { ...typography.bodyStrong, color: colors.ink },
  row: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center', marginBottom: spacing.lg },
});
