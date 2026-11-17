import React, { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router, usePathname } from 'expo-router';
import { colors, layout, radii, spacing, typography } from '../constants/theme';
import { useAuth } from '../context/AuthContext';
import { useVault } from '../context/VaultContext';
import { findExpiringSoon } from '../lib/versioning';

type NavItem = {
  id: string;
  label: string;
  href: string;
  badge?: number;
  badgeTone?: 'teal' | 'amber';
};

export const DesktopSidebar = memo(function DesktopSidebar() {
  const pathname = usePathname();
  const { session } = useAuth();
  const { reviewStats, documents } = useVault();
  const expiring = findExpiringSoon(documents, 60).length;
  const review = reviewStats?.toReview ?? 0;

  const items: NavItem[] = [
    { id: 'home', label: 'My documents', href: '/(tabs)' },
    { id: 'review', label: 'Review Queue', href: '/(tabs)/review', badge: review || undefined },
    { id: 'scan', label: 'Scan Gmail', href: '/(tabs)/scan' },
    {
      id: 'expiring',
      label: 'Expiring',
      href: '/(tabs)/expiring',
      badge: expiring || undefined,
      badgeTone: 'amber',
    },
    { id: 'vehicles', label: 'Vehicles', href: '/(tabs)/vehicles' },
    { id: 'settings', label: 'Settings', href: '/(tabs)/settings' },
  ];

  function active(href: string) {
    if (href === '/(tabs)') {
      return pathname === '/' || pathname === '/(tabs)' || pathname.endsWith('/index') || pathname === '';
    }
    return pathname.includes(href.replace('/(tabs)', '')) || pathname.includes(href);
  }

  return (
    <View style={styles.sidebar} testID="desktop-sidebar">
      <View style={styles.brandRow}>
        <View style={styles.mark}>
          <Text style={styles.markText}>K</Text>
        </View>
        <Text style={styles.brand}>Kadalas</Text>
        <View style={styles.ver}>
          <Text style={styles.verText}>v0.2</Text>
        </View>
      </View>

      <Pressable style={styles.primaryBtn} onPress={() => router.push('/add')}>
        <Text style={styles.primaryBtnText}>+ Add document</Text>
      </Pressable>
      <Pressable style={styles.secondaryBtn} onPress={() => router.push('/(tabs)/scan')}>
        <Text style={styles.secondaryBtnText}>Scan Gmail</Text>
      </Pressable>

      <View style={styles.nav}>
        {items.map((item) => {
          const isOn = active(item.href);
          return (
            <Pressable
              key={item.id}
              onPress={() => router.push(item.href as never)}
              style={[styles.navItem, isOn && styles.navItemOn]}
              testID={`nav-${item.id}`}
            >
              <Text style={[styles.navLabel, isOn && styles.navLabelOn]}>{item.label}</Text>
              {item.badge ? (
                <View
                  style={[
                    styles.badge,
                    item.badgeTone === 'amber' ? styles.badgeAmber : styles.badgeTeal,
                  ]}
                >
                  <Text style={styles.badgeText}>{item.badge}</Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>

      <View style={styles.account}>
        <Text style={styles.accountName} numberOfLines={1}>
          {session?.user.name || 'Signed in'}
        </Text>
        <Text style={styles.accountEmail} numberOfLines={1}>
          {session?.user.email || ''}
        </Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  sidebar: {
    width: layout.sidebarWidth,
    borderRightWidth: 1,
    borderRightColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  mark: {
    width: 32,
    height: 32,
    borderRadius: radii.sm,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markText: { ...typography.bodyStrong, color: colors.onPrimary },
  brand: { ...typography.brand, color: colors.primary, flex: 1 },
  ver: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radii.pill,
    backgroundColor: colors.border,
  },
  verText: { ...typography.caption, color: colors.inkMuted },
  primaryBtn: {
    backgroundColor: colors.primary,
    borderRadius: radii.sm,
    paddingVertical: 10,
    alignItems: 'center',
  },
  primaryBtnText: { ...typography.bodyStrong, color: colors.onPrimary },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radii.sm,
    paddingVertical: 10,
    alignItems: 'center',
  },
  secondaryBtnText: { ...typography.bodyStrong, color: colors.ink },
  nav: { marginTop: spacing.md, gap: 2, flex: 1 },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    borderRadius: radii.sm,
  },
  navItemOn: {
    backgroundColor: colors.primaryContainer,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
  },
  navLabel: { ...typography.body, color: colors.inkMuted },
  navLabelOn: { ...typography.bodyStrong, color: colors.onPrimaryContainer },
  badge: {
    minWidth: 22,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radii.pill,
    alignItems: 'center',
  },
  badgeTeal: { backgroundColor: colors.primaryContainer },
  badgeAmber: { backgroundColor: colors.amberSoft },
  badgeText: { ...typography.caption, color: colors.ink, fontFamily: 'Inter_600SemiBold' },
  account: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
    gap: 2,
  },
  accountName: { ...typography.bodyStrong, color: colors.ink },
  accountEmail: { ...typography.caption, color: colors.inkMuted },
});
