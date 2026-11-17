import React from 'react';
import { Text, useWindowDimensions, View } from 'react-native';
import { Tabs } from 'expo-router';
import { DesktopSidebar } from '../../components/DesktopSidebar';
import { RequireAuth } from '../../components/RequireAuth';
import { colors, layout, typography } from '../../constants/theme';
import { useVault } from '../../context/VaultContext';
import { findExpiringSoon } from '../../lib/versioning';

function TabIcon({ label, focused }: { label: string; focused: boolean }) {
  return (
    <Text style={{ fontSize: 15, opacity: focused ? 1 : 0.45, color: colors.ink }}>{label}</Text>
  );
}

export default function TabsLayout() {
  const { width } = useWindowDimensions();
  const desktop = width >= layout.desktopBreakpoint;
  const { reviewStats, documents } = useVault();
  const review = reviewStats?.toReview ?? 0;
  const expiring = findExpiringSoon(documents, 60).length;

  return (
    <RequireAuth>
      <View style={{ flex: 1, flexDirection: desktop ? 'row' : 'column', backgroundColor: colors.paper }}>
        {desktop ? <DesktopSidebar /> : null}
        <View style={{ flex: 1 }}>
          <Tabs
            screenOptions={{
              headerShown: false,
              tabBarActiveTintColor: colors.primary,
              tabBarInactiveTintColor: colors.inkMuted,
              tabBarLabelStyle: { ...typography.caption, fontFamily: 'Inter_600SemiBold' },
              tabBarStyle: desktop
                ? { display: 'none' }
                : {
                    backgroundColor: colors.surface,
                    borderTopColor: colors.border,
                    height: 64,
                    paddingBottom: 8,
                    paddingTop: 8,
                  },
            }}
          >
            <Tabs.Screen
              name="index"
              options={{
                title: 'Home',
                tabBarIcon: ({ focused }) => <TabIcon label="▣" focused={focused} />,
              }}
            />
            <Tabs.Screen
              name="review"
              options={{
                title: 'Review',
                tabBarBadge: review > 0 ? review : undefined,
                tabBarIcon: ({ focused }) => <TabIcon label="☰" focused={focused} />,
              }}
            />
            <Tabs.Screen
              name="scan"
              options={{
                title: 'Scan',
                tabBarIcon: ({ focused }) => <TabIcon label="✉" focused={focused} />,
              }}
            />
            <Tabs.Screen
              name="expiring"
              options={{
                title: 'Expiring',
                tabBarBadge: expiring > 0 ? expiring : undefined,
                tabBarIcon: ({ focused }) => <TabIcon label="⏱" focused={focused} />,
              }}
            />
            <Tabs.Screen
              name="vehicles"
              options={{
                title: 'Vehicles',
                href: desktop ? undefined : null,
                tabBarIcon: ({ focused }) => <TabIcon label="🚘" focused={focused} />,
              }}
            />
            <Tabs.Screen
              name="settings"
              options={{
                title: 'Settings',
                tabBarIcon: ({ focused }) => <TabIcon label="⚙" focused={focused} />,
              }}
            />
          </Tabs>
        </View>
      </View>
    </RequireAuth>
  );
}
