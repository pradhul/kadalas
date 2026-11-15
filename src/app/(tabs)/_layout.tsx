import React from 'react';
import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { colors, typography } from '../../constants/theme';

function TabIcon({ label, focused }: { label: string; focused: boolean }) {
  return (
    <Text style={{ fontSize: 16, opacity: focused ? 1 : 0.45, color: colors.ink }}>
      {label}
    </Text>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.teal,
        tabBarInactiveTintColor: colors.inkMuted,
        tabBarLabelStyle: { ...typography.caption, fontFamily: 'DMSans_600SemiBold' },
        tabBarStyle: {
          backgroundColor: colors.paperElevated,
          borderTopColor: colors.line,
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
          tabBarIcon: ({ focused }) => <TabIcon label="⏱" focused={focused} />,
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
  );
}
