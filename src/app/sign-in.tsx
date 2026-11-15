import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Redirect, router } from 'expo-router';
import { LinearGradientFallback } from '../components/GradientBg';
import { Banner, BrandMark, Button, Screen } from '../components/ui';
import { colors, spacing, typography } from '../constants/theme';
import { useAuth } from '../context/AuthContext';
import { useMocks } from '../services/config';

export default function SignInScreen() {
  const { session, signIn, signInWithDemo, loading, error } = useAuth();
  const { width } = useWindowDimensions();
  const fade = useRef(new Animated.Value(0)).current;
  const rise = useRef(new Animated.Value(18)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 700, useNativeDriver: true }),
      Animated.timing(rise, { toValue: 0, duration: 700, useNativeDriver: true }),
    ]).start();
  }, [fade, rise]);

  if (session) return <Redirect href="/(tabs)" />;

  const desktop = width >= 900;
  const narrow = width < 420;
  const mocksOn = useMocks();

  return (
    <Screen>
      <LinearGradientFallback />
      <View style={[styles.wrap, desktop && styles.wrapDesktop, narrow && styles.wrapNarrow]}>
        <Animated.View
          style={[styles.hero, narrow && styles.heroNarrow, { opacity: fade, transform: [{ translateY: rise }] }]}
        >
          <BrandMark large />
          <Text style={[styles.headline, narrow && styles.headlineNarrow]}>Your papers,{'\n'}in your Drive.</Text>
          <Text style={styles.sub}>
            Sign in with Google. Documents stay in your account — the app never hosts your files or AI keys.
          </Text>

          {mocksOn ? (
            <Banner>
              Demo mode is on (EXPO_PUBLIC_USE_MOCKS). Sign-in uses a local mock session so you can explore every
              screen without Google credentials.
            </Banner>
          ) : null}

          {!mocksOn && typeof __DEV__ !== 'undefined' && __DEV__ ? (
            <Banner>
              Dev: web auth uses Google Identity Services (token client). Authorized JavaScript origin must include
              this host ({typeof window !== 'undefined' ? window.location.origin : 'window.location.origin'}).
            </Banner>
          ) : null}

          {error ? <Banner tone="warn">{error}</Banner> : null}

          <View style={styles.actions}>
            <Button
              title={mocksOn ? 'Continue with mock Google' : 'Continue with Google'}
              loading={loading}
              onPress={async () => {
                try {
                  await signIn();
                  router.replace('/(tabs)');
                } catch {
                  // error surfaced via context
                }
              }}
            />
            {!mocksOn ? (
              <Button
                title="Try demo data"
                variant="secondary"
                disabled={loading}
                onPress={async () => {
                  try {
                    await signInWithDemo();
                    router.replace('/(tabs)');
                  } catch {
                    // error surfaced via context
                  }
                }}
              />
            ) : null}
          </View>

          <Text style={styles.scopes}>
            Requests gmail.readonly + drive.file. Drive access is limited to files this app creates.
            {!mocksOn
              ? ' Use “Try demo data” to explore seeded vault content without connecting Google.'
              : ''}
          </Text>
        </Animated.View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    justifyContent: 'flex-end',
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  wrapNarrow: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xl,
  },
  wrapDesktop: {
    justifyContent: 'center',
    alignItems: 'flex-start',
    paddingHorizontal: 72,
    maxWidth: 720,
  },
  hero: {
    gap: spacing.md,
    maxWidth: 520,
    width: '100%',
  },
  heroNarrow: {
    maxWidth: '100%',
  },
  headline: {
    ...typography.brand,
    color: colors.ink,
    marginTop: spacing.sm,
  },
  headlineNarrow: {
    fontSize: 34,
    lineHeight: 40,
  },
  sub: {
    ...typography.body,
    color: colors.inkMuted,
    maxWidth: 420,
  },
  actions: {
    marginTop: spacing.sm,
    maxWidth: 360,
    width: '100%',
    gap: spacing.sm,
  },
  scopes: {
    ...typography.caption,
    color: colors.inkMuted,
    marginTop: spacing.sm,
  },
});
