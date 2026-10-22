import React from 'react';
import {useColorScheme} from 'nativewind';
import {useTranslation} from 'react-i18next';

import {Box} from '../../components/ui/box';
import {AlertCircleIcon, Icon} from '../../components/ui/icon';
import {Image} from '../../components/ui/image';
import {InstrumentButton} from '../../components/ui/instrument';
import {SafeAreaView} from '../../components/ui/safe-area-view';
import {Spinner} from '../../components/ui/spinner';
import {Text} from '../../components/ui/text';
import {VStack} from '../../components/ui/vstack';
import {useLoadingFeedback} from '../../hooks/use-loading-feedback';

type RecoveryScreenProps = {
  kind: 'loading' | 'accountData' | 'unexpected';
  onRetry?: () => void;
  /**
   * Loading only: when the current wait began (epoch ms). The delays count from here, so a retry
   * that starts a new wait also restarts them.
   */
  startedAt?: number;
};

export default function RecoveryScreen({
  kind,
  onRetry,
  startedAt,
}: RecoveryScreenProps): React.JSX.Element {
  if (kind === 'loading') {
    return <StartShell onRetry={onRetry} startedAt={startedAt} />;
  }
  return <RecoveryMessage kind={kind} onRetry={onRetry} />;
}

// The launch screen's mark, drawn the same size at the same place so the hand-off from the native
// splash does not jump. The app theme (not the system) picks the artwork, like the background.
const shellLogoSources = {
  light: require('../../assets/brand/app-logo-light.png'),
  dark: require('../../assets/brand/app-logo-dark.png'),
} as const;

/**
 * The themed app shell shown while this device's records are being prepared. Background and mark
 * appear at once; an indicator follows after 1 s, a short line after 4 s and, from 10 s, a note
 * that it is taking long with one retry action. There is no minimum display time.
 */
function StartShell({
  onRetry,
  startedAt,
}: Pick<RecoveryScreenProps, 'onRetry' | 'startedAt'>): React.JSX.Element {
  const {t} = useTranslation();
  const {colorScheme} = useColorScheme();
  const feedback = useLoadingFeedback(true, {startedAt});

  return (
    <Box
      testID="account-data-loading-screen"
      accessibilityState={{busy: true}}
      className="flex-1 items-center justify-center bg-background">
      <Box className="w-full items-center">
        <Image
          testID="account-data-loading-brand-mark"
          source={shellLogoSources[colorScheme === 'dark' ? 'dark' : 'light']}
          resizeMode="contain"
          alt=""
          size="none"
          className="h-24 w-24 rounded-[22px]"
          accessible={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
        {/* Hangs below the mark so the mark never moves when these lines appear. */}
        <VStack
          space="md"
          className="absolute left-0 right-0 top-full items-center px-8 pt-8">
          {feedback.showIndicator ? (
            <Spinner
              testID="account-data-loading-indicator"
              accessibilityLabel={t('recovery.loading.indicatorLabel')}
              className="text-muted-foreground"
            />
          ) : null}
          {feedback.showExtendedFeedback ? (
            <Text
              testID="account-data-loading-message"
              className="text-center text-base font-semibold text-foreground">
              {t('recovery.loading.title')}
            </Text>
          ) : null}
          {feedback.isLongRunning ? (
            <Text
              testID="account-data-loading-long-running"
              className="text-center text-sm leading-5 text-muted-foreground">
              {t('recovery.loading.longRunning')}
            </Text>
          ) : null}
          {feedback.isLongRunning && onRetry ? (
            <InstrumentButton
              testID="recovery-retry"
              label={t('common.retry')}
              onPress={onRetry}
            />
          ) : null}
        </VStack>
      </Box>
    </Box>
  );
}

function RecoveryMessage({
  kind,
  onRetry,
}: {
  kind: 'accountData' | 'unexpected';
  onRetry?: () => void;
}): React.JSX.Element {
  const {t} = useTranslation();
  const testID =
    kind === 'accountData'
      ? 'account-data-recovery-screen'
      : 'app-error-recovery-screen';

  return (
    <SafeAreaView className="flex-1 bg-background">
      <Box className="flex-1 items-center justify-center px-8 py-10">
        <VStack testID={testID} space="xl" className="w-full max-w-md items-center">
          <Box className="h-12 w-12 items-center justify-center rounded-full bg-card">
            <Icon as={AlertCircleIcon} size="xl" className="text-muted-foreground" />
          </Box>
          <VStack space="sm" className="items-center">
            <Text
              accessibilityRole="header"
              className="text-center text-xl font-semibold text-foreground">
              {t(`recovery.${kind}.title`)}
            </Text>
            <Text className="text-center text-sm leading-5 text-muted-foreground">
              {t(`recovery.${kind}.description`)}
            </Text>
          </VStack>
          {onRetry ? (
            <InstrumentButton
              testID="recovery-retry"
              variant="primary"
              label={t('common.retry')}
              onPress={onRetry}
              className="w-full"
            />
          ) : null}
        </VStack>
      </Box>
    </SafeAreaView>
  );
}
