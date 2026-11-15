import React, { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts, DMSans_400Regular, DMSans_500Medium, DMSans_600SemiBold, DMSans_700Bold } from '@expo-google-fonts/dm-sans';
import { LibreBaskerville_700Bold } from '@expo-google-fonts/libre-baskerville';
import * as SplashScreen from 'expo-splash-screen';
import { AuthProvider } from '../context/AuthContext';
import { VaultProvider } from '../context/VaultContext';
import { colors } from '../constants/theme';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_600SemiBold,
    DMSans_700Bold,
    LibreBaskerville_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync().catch(() => undefined);
  }, [fontsLoaded]);

  if (!fontsLoaded) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.paper }}>
        <ActivityIndicator color={colors.teal} />
      </View>
    );
  }

  return (
    <AuthProvider>
      <VaultProvider>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.paper } }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="sign-in" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="document/[id]" options={{ headerShown: true, title: 'Document', headerTintColor: colors.ink }} />
          <Stack.Screen name="folder/[...path]" options={{ headerShown: true, title: 'Folder', headerTintColor: colors.ink }} />
          <Stack.Screen name="add" options={{ headerShown: true, title: 'Add document', presentation: 'modal', headerTintColor: colors.ink }} />
          <Stack.Screen name="search" options={{ headerShown: true, title: 'Search', headerTintColor: colors.ink }} />
          <Stack.Screen name="scan-review" options={{ headerShown: true, title: 'Scan review', headerTintColor: colors.ink }} />
        </Stack>
      </VaultProvider>
    </AuthProvider>
  );
}
