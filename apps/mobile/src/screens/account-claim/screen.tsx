import { useNavigation } from '@react-navigation/native';
import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button, ButtonText } from '../../components/ui/button';
import { InstrumentButton } from '../../components/ui/instrument';
import { SafeAreaView } from '../../components/ui/safe-area-view';
import { Text } from '../../components/ui/text';
import { Spinner } from '../../components/ui/spinner';
import { VStack } from '../../components/ui/vstack';
import { useLoadingFeedback } from '../../hooks/use-loading-feedback';
import { useAccountData } from '../../states/account-data';
import { DepthTraceProgress } from './depth-trace-progress';
import type {GuestClaimRetainedItem} from '../../claim/guest-claim-types';

type ClaimAction = 'start' | 'retry' | 'recheck' | 'keep';

export default function AccountClaimScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const {claim, isOnline = true} = useAccountData();
  const [busyAction, setBusyAction] = React.useState<ClaimAction>();
  const [isMountRefreshPending, setIsMountRefreshPending] =
    React.useState(true);
  const [mountRefreshFailed, setMountRefreshFailed] = React.useState(false);
  const announcedCompletion = React.useRef(false);
  const isMounted = React.useRef(true);
  const claimRef = React.useRef(claim);
  const mountRefreshPromise = React.useRef<Promise<boolean> | undefined>(
    undefined,
  );
  claimRef.current = claim;
  const isPreparing =
    (busyAction === 'start' ||
      busyAction === 'retry' ||
      busyAction === 'recheck') &&
    claim.state.status !== 'running';
  const isRefreshingStaleActionState =
    isMountRefreshPending &&
    (claim.state.status === 'choice' ||
      claim.state.status === 'deferred' ||
      claim.state.status === 'failed' ||
      claim.state.status === 'retained' ||
      claim.state.status === 'complete');
  const showsMountRefreshFailure =
    mountRefreshFailed &&
    (isRefreshingStaleActionState || claim.state.status === 'hidden');

  React.useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  const runMountRefresh = React.useCallback((restart: boolean) => {
    if (restart) {
      mountRefreshPromise.current = undefined;
    }
    mountRefreshPromise.current ??= claimRef.current
      .refresh()
      .then(
        () => true,
        () => false,
      );
    return mountRefreshPromise.current;
  }, []);

  React.useEffect(() => {
    let isActive = true;
    void runMountRefresh(false).then(succeeded => {
      if (!isActive || !isMounted.current) {
        return;
      }
      if (succeeded) {
        setIsMountRefreshPending(false);
      } else {
        setMountRefreshFailed(true);
      }
    });
    return () => {
      isActive = false;
    };
  }, [runMountRefresh]);

  const retryMountRefresh = React.useCallback(() => {
    setMountRefreshFailed(false);
    void runMountRefresh(true).then(succeeded => {
      if (!isMounted.current) {
        return;
      }
      if (succeeded) {
        setIsMountRefreshPending(false);
      } else {
        setMountRefreshFailed(true);
      }
    });
  }, [runMountRefresh]);

  React.useEffect(() => {
    if (
      claim.state.status === 'hidden' &&
      claim.eligible.logCount + claim.eligible.planCount === 0 &&
      busyAction === undefined
    ) {
      navigation.goBack();
    }
  }, [busyAction, claim.eligible, claim.state.status, navigation]);

  React.useEffect(() => {
    if (
      isMountRefreshPending ||
      claim.state.status !== 'complete' ||
      announcedCompletion.current
    ) {
      return;
    }

    announcedCompletion.current = true;
    const retainedCount = claim.state.retainedItems.length;
    AccessibilityInfo.announceForAccessibility(
      retainedCount > 0
        ? t('accountClaim.partialCompleteAnnouncement', {
            imported: claim.state.imported,
            retained: retainedCount,
          })
        : t('accountClaim.completeAnnouncement', {
            count: claim.state.imported,
          }),
    );
    if (retainedCount === 0) {
      navigation.goBack();
    }
  }, [claim.state, isMountRefreshPending, navigation, t]);

  const runAction = React.useCallback(
    async (action: ClaimAction) => {
      if (busyAction !== undefined) {
        return;
      }

      if (action === 'keep') {
        navigation.goBack();
        void claim.keepOnDevice().catch(() => undefined);
        return;
      }

      setBusyAction(action);
      try {
        if (action === 'start') {
          await claim.start();
        } else if (action === 'retry') {
          await claim.retry();
        } else if (action === 'recheck') {
          await claim.recheckRetained();
        }
      } catch {
        await claim.refresh().catch(() => undefined);
      } finally {
        if (isMounted.current) {
          setBusyAction(undefined);
        }
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
        !isPreparing &&
        !isRefreshingStaleActionState ? (
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

        {showsMountRefreshFailure ? (
          <RefreshFailedContent
            onRetry={retryMountRefresh}
            onClose={() => navigation.goBack()}
          />
        ) : null}

        {!showsMountRefreshFailure &&
        (claim.state.status === 'hidden' ||
          isPreparing ||
          isRefreshingStaleActionState) ? (
          <PreparingContent onClose={() => navigation.goBack()} />
        ) : null}

        {claim.state.status === 'running' &&
        claim.state.phase === 'cleanup' ? (
          <CleanupContent onClose={() => navigation.goBack()} />
        ) : null}

        {claim.state.status === 'running' &&
        claim.state.phase !== 'cleanup' ? (
          <ProgressContent
            title={t(
              claim.state.phase === 'finalizing'
                ? 'accountClaim.finalizingTitle'
                : 'accountClaim.progressTitle',
            )}
            completed={claim.state.completed}
            total={claim.state.total}
            currentLabel={claim.state.currentLabel}
            onClose={() => navigation.goBack()}
          />
        ) : null}

        {claim.state.status === 'failed' &&
        !isPreparing &&
        !isRefreshingStaleActionState ? (
          <FailureContent
            completed={claim.state.completed}
            total={claim.state.total}
            failure={claim.state.failure}
            busyAction={busyAction}
            onRetry={() => runAction('retry')}
            onKeep={() => runAction('keep')}
          />
        ) : null}

        {claim.state.status === 'complete' &&
        claim.state.retainedItems.length > 0 &&
        !isPreparing &&
        !isRefreshingStaleActionState ? (
          <RetainedResultContent
            imported={claim.state.imported}
            retainedItems={claim.state.retainedItems}
            busyAction={busyAction}
            isOnline={isOnline}
            onDone={() => navigation.goBack()}
            onRecheck={() => runAction('recheck')}
          />
        ) : null}

        {claim.state.status === 'retained' &&
        !isPreparing &&
        !isRefreshingStaleActionState ? (
          <RetainedResultContent
            retainedItems={claim.state.retainedItems}
            busyAction={busyAction}
            isOnline={isOnline}
            onDone={() => navigation.goBack()}
            onRecheck={() => runAction('recheck')}
          />
        ) : null}
      </VStack>
    </SafeAreaView>
  );
}

function RetainedResultContent({
  imported,
  retainedItems,
  busyAction,
  isOnline,
  onDone,
  onRecheck,
}: {
  imported?: number;
  retainedItems: GuestClaimRetainedItem[];
  busyAction?: ClaimAction;
  isOnline: boolean;
  onDone(): void;
  onRecheck(): void;
}): React.JSX.Element {
  const {t} = useTranslation();
  const disabled = busyAction !== undefined;
  const recheckDisabled = disabled || !isOnline;
  const first = retainedItems[0];

  return (
    <>
      <VStack space="sm">
        <Text
          testID="account-claim-title"
          accessibilityRole="header"
          maxFontSizeMultiplier={1.5}
          className="text-xl font-semibold leading-7 text-foreground">
          {t(
            imported === undefined
              ? 'accountClaim.retainedTitle'
              : 'accountClaim.partialCompleteTitle',
          )}
        </Text>
        <Text
          testID="account-claim-result-summary"
          size="sm"
          className="leading-5 text-muted-foreground">
          {imported === undefined
            ? t('accountClaim.retainedDescription', {
                count: retainedItems.length,
              })
            : t('accountClaim.partialCompleteSummary', {count: imported})}
        </Text>
        {imported === undefined ? null : (
          <Text size="sm" className="leading-5 text-muted-foreground">
            {t('accountClaim.retainedNotice', {count: retainedItems.length})}
          </Text>
        )}
      </VStack>

      {first ? (
        <VStack space="xs" className="rounded-2xl bg-card px-4 py-3">
          <Text
            testID="account-claim-retained-item"
            maxFontSizeMultiplier={1.5}
            className="font-semibold text-foreground">
            {first.label ?? t('accountClaim.unknownRetainedItem')}
          </Text>
          <Text size="sm" className="leading-5 text-muted-foreground">
            {t(`accountClaim.retainedReasons.${first.reason}`)}
          </Text>
          {retainedItems.length > 1 ? (
            <Text size="xs" className="text-muted-foreground">
              {t('accountClaim.additionalRetainedItems', {
                count: retainedItems.length - 1,
              })}
            </Text>
          ) : null}
        </VStack>
      ) : null}

      <VStack space="sm">
        {isOnline ? null : <OfflineNote />}
        <InstrumentButton
          testID="account-claim-done"
          accessibilityLabel={t('accountClaim.doneAction')}
          className="w-full"
          disabled={disabled}
          label={t('accountClaim.doneAction')}
          onPress={onDone}
          variant="primary"
        />
        <Button
          testID="account-claim-recheck"
          accessibilityLabel={t('accountClaim.recheckAction')}
          accessibilityRole="button"
          accessibilityState={{
            disabled: recheckDisabled,
            busy: busyAction === 'recheck',
          }}
          className="min-h-11 w-full"
          disabled={recheckDisabled}
          onPress={onRecheck}
          variant="link">
          <ButtonText className="text-base font-semibold">
            {t('accountClaim.recheckAction')}
          </ButtonText>
        </Button>
      </VStack>
    </>
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
      <VStack space="sm">
        <Text
          testID="account-claim-title"
          accessibilityRole="header"
          maxFontSizeMultiplier={1.5}
          className="text-xl font-semibold leading-7 text-foreground"
        >
          {t('accountClaim.choiceTitle')}
        </Text>
        <Text
          testID="account-claim-import-explanation"
          size="sm"
          className="leading-5 text-muted-foreground">
          {t('accountClaim.importExplanation')}
        </Text>
        <Text
          testID="account-claim-keep-explanation"
          size="sm"
          className="leading-5 text-muted-foreground">
          {t('accountClaim.keepExplanation')}
        </Text>
      </VStack>

      <VStack space="xs" className="rounded-2xl bg-card px-4 py-3">
        <Text
          testID="account-claim-log-count"
          maxFontSizeMultiplier={1.5}
          className="text-base text-card-foreground"
        >
          {t('accountClaim.logCountValue', {count: logCount})}
        </Text>
        <Text
          testID="account-claim-plan-count"
          maxFontSizeMultiplier={1.5}
          className="text-base text-card-foreground"
        >
          {t('accountClaim.planCountValue', {count: planCount})}
        </Text>
      </VStack>

      <VStack space="sm">
        {isOnline ? null : <OfflineNote />}
        <InstrumentButton
          testID="account-claim-import"
          accessibilityLabel={t('accountClaim.importAction')}
          className="w-full"
          disabled={importDisabled}
          label={t('accountClaim.importAction')}
          onPress={onImport}
          pending={busyAction === 'start' || busyAction === 'retry'}
          variant="primary"
        />
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

function PreparingContent({
  onClose,
}: {
  onClose(): void;
}): React.JSX.Element {
  const {t} = useTranslation();
  // A quick check shows nothing: the status text waits for the shared delay with the spinner.
  const {showIndicator} = useLoadingFeedback(true);

  return (
    <VStack
      testID="account-claim-preparing"
      accessibilityState={{busy: true}}
      space="lg"
      className="items-center py-8">
      <ReservedSpinner
        label={t('accountClaim.preparingTitle')}
        visible={showIndicator}
      />
      <VStack
        testID="account-claim-preparing-text"
        accessibilityElementsHidden={!showIndicator}
        importantForAccessibility={
          showIndicator ? 'auto' : 'no-hide-descendants'
        }
        space="xs"
        className={
          showIndicator ? 'items-center opacity-100' : 'items-center opacity-0'
        }>
        <Text
          accessibilityRole="header"
          className="text-center text-xl font-semibold leading-7 text-foreground">
          {t('accountClaim.preparingTitle')}
        </Text>
        <Text size="sm" className="text-center text-muted-foreground">
          {t('accountClaim.preparingDescription')}
        </Text>
      </VStack>
      <CloseButton onPress={onClose} />
    </VStack>
  );
}

function RefreshFailedContent({
  onRetry,
  onClose,
}: {
  onRetry(): void;
  onClose(): void;
}): React.JSX.Element {
  const {t} = useTranslation();

  return (
    <VStack
      testID="account-claim-refresh-failed"
      space="lg"
      className="items-center py-8">
      <VStack space="xs" className="items-center">
        <Text
          accessibilityRole="header"
          className="text-center text-xl font-semibold leading-7 text-foreground">
          {t('accountClaim.refreshFailedTitle')}
        </Text>
        <Text size="sm" className="text-center text-muted-foreground">
          {t('accountClaim.refreshFailedDescription')}
        </Text>
      </VStack>
      <InstrumentButton
        testID="account-claim-refresh-retry"
        accessibilityLabel={t('common.retry')}
        className="w-full"
        label={t('common.retry')}
        onPress={onRetry}
        variant="primary"
      />
      <CloseButton onPress={onClose} />
    </VStack>
  );
}

function ProgressContent({
  title,
  completed,
  total,
  currentLabel,
  onClose,
}: {
  title: string;
  completed: number;
  total: number;
  currentLabel?: string;
  onClose?: () => void;
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
      {onClose ? <CloseButton onPress={onClose} /> : null}
    </VStack>
  );
}

function CleanupContent({
  onClose,
}: {
  onClose(): void;
}): React.JSX.Element {
  const {t} = useTranslation();
  const {showIndicator} = useLoadingFeedback(true);

  return (
    <VStack
      accessibilityState={{busy: true}}
      space="lg"
      className="items-center py-8">
      <ReservedSpinner
        testID="account-claim-cleanup-spinner"
        label={t('accountClaim.cleanupTitle')}
        visible={showIndicator}
      />
      <VStack space="xs" className="items-center">
        <Text
          testID="account-claim-title"
          accessibilityRole="header"
          maxFontSizeMultiplier={1.5}
          className="text-center text-xl font-semibold leading-7 text-foreground">
          {t('accountClaim.cleanupTitle')}
        </Text>
        <Text
          testID="account-claim-cleanup-description"
          size="sm"
          className="text-center text-muted-foreground">
          {t('accountClaim.cleanupDescription')}
        </Text>
      </VStack>
      <CloseButton onPress={onClose} />
    </VStack>
  );
}

/** A large spinner whose slot is reserved at once; the caller shows it after the shared 1 s delay. */
function ReservedSpinner({
  label,
  testID,
  visible,
}: {
  label: string;
  testID?: string;
  visible: boolean;
}): React.JSX.Element {
  return (
    <Spinner
      testID={testID}
      aria-label={label}
      size="large"
      className="text-muted-foreground"
      style={{opacity: visible ? 1 : 0}}
    />
  );
}

/** Why import or recheck is unavailable: the account cannot reach the cloud right now. */
function OfflineNote(): React.JSX.Element {
  const {t} = useTranslation();

  return (
    <Text
      testID="account-claim-offline-note"
      size="sm"
      className="text-center leading-5 text-muted-foreground">
      {t('accountClaim.offlineNote')}
    </Text>
  );
}

function CloseButton({onPress}: {onPress(): void}): React.JSX.Element {
  const {t} = useTranslation();

  return (
    <Button
      testID="account-claim-close"
      accessibilityLabel={t('accountClaim.closeAction')}
      accessibilityRole="button"
      className="min-h-11 w-full"
      onPress={onPress}
      variant="link">
      <ButtonText className="text-base font-semibold">
        {t('accountClaim.closeAction')}
      </ButtonText>
    </Button>
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
  const {t} = useTranslation();
  const disabled = busyAction !== undefined;
  const isCleanupFailure = failure?.phase === 'cleanup';

  return (
    <>
      {isCleanupFailure ? (
        <Text
          testID="account-claim-title"
          accessibilityRole="header"
          maxFontSizeMultiplier={1.5}
          className="text-xl font-semibold leading-7 text-foreground">
          {t('accountClaim.failureTitle')}
        </Text>
      ) : (
        <ProgressContent
          title={t('accountClaim.failureTitle')}
          completed={completed}
          total={total}
        />
      )}
      <Text
        testID="account-claim-failure-detail"
        size="sm"
        className="leading-5 text-muted-foreground">
        {isCleanupFailure
          ? t('accountClaim.cleanupFailureDescription')
          : failure?.label
          ? t('accountClaim.failureItemDescription', {label: failure.label})
          : t('accountClaim.failureDescription')}
      </Text>
      <VStack space="sm">
        <InstrumentButton
          testID="account-claim-retry"
          accessibilityLabel={t('accountClaim.retryAction')}
          className="w-full"
          disabled={disabled}
          label={t('accountClaim.retryAction')}
          onPress={onRetry}
          pending={busyAction === 'retry'}
          variant="primary"
        />
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
