import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing, typography } from '../constants/theme';

type Props = {
  children: ReactNode;
  onGoHome?: () => void;
};

type State = {
  error: Error | null;
  copied: boolean;
};

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, copied: false };

  static getDerivedStateFromError(error: Error): State {
    return { error, copied: false };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Kadalas ErrorBoundary', error, info.componentStack);
  }

  copyError = async () => {
    const err = this.state.error;
    if (!err) return;
    const text = `${err.name}: ${err.message}\n\n${err.stack || ''}`;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else if (Platform.OS === 'web' && typeof document !== 'undefined') {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      this.setState({ copied: true });
    } catch {
      this.setState({ copied: false });
    }
  };

  render() {
    if (!this.state.error) return this.props.children;
    const message = this.state.error.message || 'Something went wrong';
    return (
      <View style={styles.wrap} testID="error-boundary">
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.body}>{message}</Text>
        <View style={styles.actions}>
          <Pressable style={styles.btn} onPress={() => void this.copyError()} testID="copy-error">
            <Text style={styles.btnText}>{this.state.copied ? 'Copied' : 'Copy error'}</Text>
          </Pressable>
          <Pressable
            style={[styles.btn, styles.btnPrimary]}
            onPress={() => {
              this.setState({ error: null, copied: false });
              this.props.onGoHome?.();
            }}
            testID="go-home"
          >
            <Text style={[styles.btnText, styles.btnTextLight]}>Go home</Text>
          </Pressable>
        </View>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: colors.paper,
    padding: spacing.lg,
    justifyContent: 'center',
    gap: spacing.md,
  },
  title: { ...typography.h2, color: colors.ink },
  body: { ...typography.body, color: colors.inkMuted },
  actions: { flexDirection: 'row', gap: 8, marginTop: spacing.sm },
  btn: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: colors.paperElevated,
  },
  btnPrimary: { backgroundColor: colors.teal, borderColor: colors.teal },
  btnText: { ...typography.caption, color: colors.ink, fontWeight: '600' },
  btnTextLight: { color: '#fff' },
});
