import { type ReactNode, useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { t } from '../i18n';
import { useColors } from '../theme';
import { EmptyState } from './EmptyState';

/** How long a page may load before it says so and offers Try again. */
export const LOAD_TIMEOUT_MS = 15_000;

/**
 * A page that loads: a spinner, then its content, or what went wrong with Try again. A load that
 * runs past the timeout counts as failed, so a page never spins without end.
 */
export function LoadState({
  loading,
  failed,
  onRetry,
  children,
}: {
  loading: boolean;
  /** What went wrong, once loading has ended without the content. */
  failed?: { title: string; body?: string | undefined } | null | false | undefined;
  onRetry?: (() => void) | undefined;
  children?: ReactNode;
}) {
  const colors = useColors();
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!loading) {
      setLate(false);
      return;
    }
    const timer = setTimeout(() => setLate(true), LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [loading]);

  const retry = onRetry && {
    label: t('Try again'),
    onPress: () => {
      setLate(false);
      onRetry();
    },
  };
  if (loading && late) {
    return (
      <View className="pt-16">
        <EmptyState
          title={t('This didn’t load')}
          body={t('Check the connection and try again.')}
          action={retry}
        />
      </View>
    );
  }
  if (loading) return <ActivityIndicator color={colors.amber} className="pt-24" />;
  if (failed) {
    return (
      <View className="pt-16">
        <EmptyState title={failed.title} body={failed.body} action={retry} />
      </View>
    );
  }
  return <>{children}</>;
}
