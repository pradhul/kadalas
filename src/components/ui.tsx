import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  ViewStyle,
  TextStyle,
  StyleProp,
} from 'react-native';
import { colors, radii, spacing, typography } from '../constants/theme';

export function Screen({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.screen, style]}>{children}</View>;
}

export function BrandMark({ large }: { large?: boolean }) {
  return (
    <View style={styles.brandRow}>
      <View style={[styles.brandMark, large && styles.brandMarkLarge]} />
      <Text style={[styles.brandText, large && styles.brandTextLarge]}>Kadalas</Text>
    </View>
  );
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  loading,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.btn,
        variant === 'primary' && styles.btnPrimary,
        variant === 'secondary' && styles.btnSecondary,
        variant === 'ghost' && styles.btnGhost,
        variant === 'danger' && styles.btnDanger,
        (disabled || loading) && styles.btnDisabled,
        pressed && !disabled && styles.btnPressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'secondary' || variant === 'ghost' ? colors.ink : '#fff'} />
      ) : (
        <Text
          style={[
            styles.btnText,
            (variant === 'secondary' || variant === 'ghost') && styles.btnTextDark,
            variant === 'danger' && styles.btnTextLight,
          ]}
        >
          {title}
        </Text>
      )}
    </Pressable>
  );
}

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
  multiline,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  multiline?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.inkMuted}
        secureTextEntry={secureTextEntry}
        multiline={multiline}
        style={[styles.input, multiline && styles.inputMultiline]}
        autoCapitalize="none"
        autoCorrect={false}
      />
    </View>
  );
}

export function Chip({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'teal' | 'amber' | 'rose' }) {
  return (
    <View
      style={[
        styles.chip,
        tone === 'teal' && styles.chipTeal,
        tone === 'amber' && styles.chipAmber,
        tone === 'rose' && styles.chipRose,
      ]}
    >
      <Text
        style={[
          styles.chipText,
          tone === 'teal' && { color: colors.teal },
          tone === 'amber' && { color: colors.amber },
          tone === 'rose' && { color: colors.rose },
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

export function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={styles.sectionTitle}>
      <Text style={styles.h2}>{title}</Text>
      {subtitle ? <Text style={styles.caption}>{subtitle}</Text> : null}
    </View>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.h3}>{title}</Text>
      <Text style={styles.caption}>{body}</Text>
    </View>
  );
}

export function Banner({ children, tone = 'info' }: { children: React.ReactNode; tone?: 'info' | 'warn' }) {
  return (
    <View style={[styles.banner, tone === 'warn' && styles.bannerWarn]}>
      <Text style={[styles.caption, { color: tone === 'warn' ? colors.amber : colors.inkMuted }]}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  brandMark: {
    width: 14,
    height: 14,
    borderRadius: 4,
    backgroundColor: colors.teal,
  },
  brandMarkLarge: {
    width: 22,
    height: 22,
    borderRadius: 6,
  },
  brandText: {
    ...typography.h3,
    color: colors.ink,
  },
  brandTextLarge: {
    ...typography.brand,
    fontSize: 30,
    color: colors.ink,
  },
  btn: {
    minHeight: 48,
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimary: { backgroundColor: colors.teal },
  btnSecondary: {
    backgroundColor: colors.paperElevated,
    borderWidth: 1,
    borderColor: colors.line,
  },
  btnGhost: { backgroundColor: 'transparent' },
  btnDanger: { backgroundColor: colors.rose },
  btnDisabled: { opacity: 0.5 },
  btnPressed: { opacity: 0.88, transform: [{ scale: 0.99 }] },
  btnText: { ...typography.bodyStrong, color: '#fff' },
  btnTextDark: { color: colors.ink },
  btnTextLight: { color: '#fff' },
  field: { gap: spacing.xs, marginBottom: spacing.md },
  fieldLabel: { ...typography.label, color: colors.inkMuted },
  input: {
    ...typography.body,
    color: colors.ink,
    backgroundColor: colors.paperElevated,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  inputMultiline: { minHeight: 88, textAlignVertical: 'top' },
  chip: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radii.sm,
    backgroundColor: colors.line,
  },
  chipTeal: { backgroundColor: colors.tealSoft },
  chipAmber: { backgroundColor: colors.amberSoft },
  chipRose: { backgroundColor: colors.roseSoft },
  chipText: { ...typography.caption, color: colors.inkMuted, fontFamily: 'DMSans_600SemiBold' },
  sectionTitle: { gap: 4, marginBottom: spacing.md },
  h2: { ...typography.h2, color: colors.ink },
  h3: { ...typography.h3, color: colors.ink },
  caption: { ...typography.caption, color: colors.inkMuted },
  empty: {
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.sm,
  },
  banner: {
    backgroundColor: colors.tealSoft,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  bannerWarn: { backgroundColor: colors.amberSoft },
});

export type { TextStyle, ViewStyle };
