import React, { type ErrorInfo, type PropsWithChildren } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing, typography } from '@/constants/theme';

import { PrimaryButton } from './PrimaryButton';

interface Props extends PropsWithChildren {
  onReturnHome(): void;
}

interface State {
  error: Error | null;
  componentStack: string | null;
}

export class AppErrorBoundary extends React.Component<Props, State> {
  override state: State = { error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): State {
    return { error, componentStack: null };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ error, componentStack: info.componentStack ?? null });
    if (__DEV__) console.error('[AppErrorBoundary]', error, info.componentStack);
  }

  private retry = () => this.setState({ error: null, componentStack: null });

  private returnHome = () => {
    this.setState({ error: null, componentStack: null });
    this.props.onReturnHome();
  };

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <View style={styles.container}>
        <Text style={styles.title}>SOMETHING WENT WRONG</Text>
        <Text style={styles.body}>PushPVP hit an unexpected screen error.</Text>
        {__DEV__ ? (
          <Text selectable style={styles.diagnostic}>
            {this.state.error.message}
            {this.state.componentStack ?? ''}
          </Text>
        ) : null}
        <PrimaryButton label="TRY AGAIN" onPress={this.retry} style={styles.button} />
        <PrimaryButton
          label="RETURN HOME"
          onPress={this.returnHome}
          style={styles.button}
          variant="secondary"
        />
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'stretch',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  title: { ...typography.heading, color: colors.text, textAlign: 'center' },
  body: { ...typography.body, color: colors.textMuted, textAlign: 'center', marginTop: spacing.sm },
  diagnostic: {
    color: colors.warning,
    fontFamily: 'monospace',
    fontSize: 11,
    marginTop: spacing.md,
    maxHeight: 180,
  },
  button: { marginTop: spacing.md },
});
