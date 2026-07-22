import { useNavigation, usePreventRemove } from '@react-navigation/native';
import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Box } from '../../components/ui/box';
import { Button, ButtonText } from '../../components/ui/button';
import { ArrowUpIcon, Icon } from '../../components/ui/icon';
import { SafeAreaView } from '../../components/ui/safe-area-view';
import { Text } from '../../components/ui/text';
import { HStack } from '../../components/ui/hstack';
import { Spinner } from '../../components/ui/spinner';
import { VStack } from '../../components/ui/vstack';
import { useAccountData } from '../../states/account-data';
import { DepthTraceProgress } from './depth-trace-progress';

type ClaimAction = 'start' | 'retry' | 'keep';

export default function AccountClaimScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const {claim, isOnline = true} = useAccountData();
  const [busyAction, setBusyAction] = React.useState<ClaimAction>();
  const announcedCompletion = React.useRef(false);
  const requestedRefresh = React.useRef(false);
  const isRunning =
    claim.state.status === 'running' ||
    busyAction === 'start' ||
    busyAction === 'retry';
  const isPreparing =
    (busyAction === 'start' || busyAction === 'retry') &&
    claim.state.status !== 'running';

  usePreventRemove(isRunning, () => undefined);

  React.useEffect(() => {
    if (
      claim.state.status !== 'hidden' ||
      requestedRefresh.current
    ) {
      return;
    }
    requestedRefresh.current = true;
    void claim.refresh().catch(() => undefined);
  }, [claim]);

  React.useEffect(() => {
    if (claim.state.status !== 'complete' || announcedCompletion.current) {
      return;
    }

    announcedCompletion.current = true;
    AccessibilityInfo.announceForAccessibility(
      t('accountClaim.completeAnnouncement', {
        count: claim.state.imported,
      }),
    );
    navigation.goBack();
  }, [claim.state, navigation, t]);

  const runAction = React.useCallback(
    async (action: ClaimAction) => {
      if (busyAction !== undefined) {
        return;
      }

      setBusyAction(action);
      try {
        if (action === 'start') {
          await claim.start();
        } else if (action === 'retry') {
          await claim.retry();
        } else {
          await claim.keepOnDevice();
          navigation.goBack();
        }
      } catch {
        await claim.refresh().catch(() => undefined);
      } finally {
        setBusyAction(undefined);
      }
    },
    [busyAction, claim, navigation],
  );

  return (
    <SafeAreaView edges={['bottom']} className="flex-1 bg-background">
      <VStack
        testID="account-claim-screen"
        space="xl"
        className="px-6 pb-5 pt-5"
      >
        {(claim.state.status === 'choice' || claim.state.status === 'deferred') &&
        !isPreparing ? (
          <ChoiceContent
            logCount={claim.state.logCount}
            planCount={claim.state.planCount}
            busyAction={busyAction}
            onImport={() =>
              runAction(claim.state.status === 'deferred' ? 'retry' : 'start')
            }
            onKeep={() => runAction('keep')}
            isOnline={isOnline}
          />
        ) : null}

        {claim.state.status === 'hidden' || isPreparing ? (
          <PreparingContent />
        ) : null}

        {claim.state.status === 'running' ? (
          <ProgressContent
            title={t(
              claim.state.phase === 'finalizing'
                ? 'accountClaim.finalizingTitle'
                : claim.state.phase === 'cleanup'
                  ? 'accountClaim.cleanupTitle'
                  : 'accountClaim.progressTitle',
            )}
            completed={claim.state.completed}
            total={claim.state.total}
            currentLabel={claim.state.currentLabel}
          />
        ) : null}

        {claim.state.status === 'failed' && !isPreparing ? (
          <FailureContent
            completed={claim.state.completed}
            total={claim.state.total}
            failure={claim.state.failure}
            busyAction={busyAction}
            onRetry={() => runAction('retry')}
            onKeep={() => runAction('keep')}
          />
        ) : null}
      </VStack>
    </SafeAreaView>
  );
}

function ChoiceContent({
  logCount,
  planCount,
  busyAction,
  onImport,
  onKeep,
  isOnline,
}: {
  logCount: number;
  planCount: number;
  busyAction?: ClaimAction;
  onImport(): void;
  onKeep(): void;
  isOnline: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  const disabled = busyAction !== undefined;
  const importDisabled = disabled || !isOnline;

  return (
    <>
      <VStack space="md" className="items-center">
        <Box className="h-12 w-12 items-center justify-center rounded-full bg-primary/10">
          <Icon as={ArrowUpIcon} size="xl" className="text-primary" />
        </Box>
        <Text
          testID="account-claim-title"
          accessibilityRole="header"
          maxFontSizeMultiplier={1.5}
          className="text-center text-2xl font-semibold leading-8 text-foreground"
        >
          {t('accountClaim.choiceTitle')}
        </Text>
      </VStack>

      <HStack className="items-center">
        <Text
          testID="account-claim-log-count"
          maxFontSizeMultiplier={1.5}
          className="flex-1 text-center text-base font-semibold text-foreground"
        >
          {String(logCount)} {t('accountClaim.logCount')}
        </Text>
        <Box className="h-5 w-px bg-border" />
        <Text
          testID="account-claim-plan-count"
          maxFontSizeMultiplier={1.5}
          className="flex-1 text-center text-base font-semibold text-foreground"
        >
          {String(planCount)} {t('accountClaim.planCount')}
        </Text>
      </HStack>

      <VStack space="sm">
        <Button
          testID="account-claim-import"
          accessibilityLabel={t('accountClaim.importAction')}
          accessibilityRole="button"
          accessibilityState={{disabled: importDisabled, busy: busyAction === 'start'}}
          className="min-h-12 w-full rounded-lg"
          disabled={importDisabled}
          onPress={onImport}
          size="lg"
        >
          <ButtonText className="text-base font-semibold">
            {t('accountClaim.importAction')}
          </ButtonText>
        </Button>
        <Button
          testID="account-claim-keep"
          accessibilityLabel={t('accountClaim.keepAction')}
          accessibilityRole="button"
          accessibilityState={{ disabled, busy: busyAction === 'keep' }}
          className="min-h-11 w-full"
          disabled={disabled}
          onPress={onKeep}
          variant="link"
        >
          <ButtonText className="text-base font-semibold">
            {t('accountClaim.keepAction')}
          </ButtonText>
        </Button>
      </VStack>
    </>
  );
}

function PreparingContent(): React.JSX.Element {
  const {t} = useTranslation();

  return (
    <VStack
      testID="account-claim-preparing"
      space="lg"
      className="items-center py-8">
      <Spinner size="large" className="text-primary" />
      <VStack space="xs" className="items-center">
        <Text
          accessibilityRole="header"
          size="xl"
          bold
          className="text-center text-foreground">
          {t('accountClaim.preparingTitle')}
        </Text>
        <Text size="sm" className="text-center text-muted-foreground">
          {t('accountClaim.preparingDescription')}
        </Text>
      </VStack>
    </VStack>
  );
}

function ProgressContent({
  title,
  completed,
  total,
  currentLabel,
}: {
  title: string;
  completed: number;
  total: number;
  currentLabel?: string;
}): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <VStack space="lg" className="py-2">
      <VStack space="xs">
        <Text
          testID="account-claim-title"
          accessibilityRole="header"
          maxFontSizeMultiplier={1.5}
          className="text-xl font-semibold leading-7 text-foreground"
        >
          {title}
        </Text>
        {currentLabel ? (
          <Text
            testID="account-claim-current-label"
            isTruncated
            maxFontSizeMultiplier={1.5}
            className="text-sm text-muted-foreground"
          >
            {currentLabel}
          </Text>
        ) : null}
      </VStack>
      <Text
        testID="account-claim-progress-count"
        accessibilityLabel={t('accountClaim.progressCount', {
          completed,
          total,
        })}
        maxFontSizeMultiplier={1.5}
        className="text-3xl font-semibold leading-10 text-foreground tabular-nums"
        style={{ fontVariant: ['tabular-nums'] }}
      >
        {String(completed)}
        {' / '}
        {String(total)}
      </Text>
      <DepthTraceProgress completed={completed} total={total} />
    </VStack>
  );
}

function FailureContent({
  completed,
  total,
  failure,
  busyAction,
  onRetry,
  onKeep,
}: {
  completed: number;
  total: number;
  failure?: import('../../claim/guest-claim-types').GuestClaimFailureDetail;
  busyAction?: ClaimAction;
  onRetry(): void;
  onKeep(): void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const disabled = busyAction !== undefined;

  return (
    <>
      <ProgressContent
        title={t('accountClaim.failureTitle')}
        completed={completed}
        total={total}
      />
      <Text
        testID="account-claim-failure-detail"
        size="sm"
        className="leading-5 text-muted-foreground">
        {failure?.label
          ? t('accountClaim.failureItemDescription', {label: failure.label})
          : t('accountClaim.failureDescription')}
      </Text>
      <VStack space="sm">
        <Button
          testID="account-claim-retry"
          accessibilityLabel={t('accountClaim.retryAction')}
          accessibilityRole="button"
          accessibilityState={{ disabled, busy: busyAction === 'retry' }}
          className="min-h-12 w-full rounded-lg"
          disabled={disabled}
          onPress={onRetry}
          size="lg"
        >
          <ButtonText className="text-base font-semibold">
            {t('accountClaim.retryAction')}
          </ButtonText>
        </Button>
        <Button
          testID="account-claim-keep"
          accessibilityLabel={t('accountClaim.keepAction')}
          accessibilityRole="button"
          accessibilityState={{ disabled, busy: busyAction === 'keep' }}
          className="min-h-11 w-full"
          disabled={disabled}
          onPress={onKeep}
          variant="link"
        >
          <ButtonText className="text-base font-semibold">
            {t('accountClaim.keepAction')}
          </ButtonText>
        </Button>
      </VStack>
    </>
  );
}
