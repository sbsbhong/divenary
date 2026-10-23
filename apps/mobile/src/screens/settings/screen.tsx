import React from 'react';
import { AccessibilityInfo, Alert, AppState, Linking } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import packageJson from '../../../package.json';
import { Section, Row } from '../../components/ui/grouped-list';
import { InstrumentButton, ScreenBackButton } from '../../components/ui/instrument';
import { BellIcon, GlobeIcon, SunIcon, WatchIcon } from '../../components/ui/icon';
import { Pressable } from '../../components/ui/pressable';
import { ScreenHeader } from '../../components/ui/screen-header';
import { ScrollView } from '../../components/ui/scroll-view';
import { Text } from '../../components/ui/text';
import { VStack } from '../../components/ui/vstack';
import { useContentLoading } from '../../components/ui/skeleton-block';
import type { SupportedLanguage } from '../../i18n';
import type { SocialProvider } from '../../auth/native-social-auth';
import { WATCH_STATUS_BLINK } from '../../constants/motion';
import { defaultWatchLink } from '../../companion/default-watch-link';
import type { LinkedWatchInfo } from '../../companion/watch-link';
import {
  hasWatchSyncNotificationPermission as hasDefaultWatchSyncNotificationPermission,
  requestWatchSyncNotificationPermission as requestDefaultWatchSyncNotificationPermission,
} from '../../notifications/watch-sync-notification-service';
import { useAppPreferences, type ThemePreference } from '../../states/app-preferences';
import { useAuth, type AuthContextValue } from '../../states/auth';
import type { GuestClaimViewState } from '../../claim/guest-claim-types';
import {
  defaultWatchRejectedPayloadStore,
  type RejectedWatchPayload,
  type WatchRejectedPayloadStore,
} from '../../storage/watch-rejected-payload-store';

export type SettingsRoute = 'index' | 'account' | 'theme' | 'language' | 'devices';

type TranslationFunction = ReturnType<typeof useTranslation>['t'];

type SettingsScreenProps = {
  loadLinkedWatchInfo?: () => Promise<LinkedWatchInfo>;
  route?: SettingsRoute;
  onBack?: () => void;
  onOpenLogin?: () => void;
  onOpenRoute?: (route: Exclude<SettingsRoute, 'index'>) => void;
  requestWatchSyncNotificationPermission?: () => Promise<boolean>;
  hasWatchSyncNotificationPermission?: () => Promise<boolean>;
  openNotificationSettings?: () => Promise<void>;
  accountClaim?: {
    isOnline: boolean;
    eligible: { logCount: number; planCount: number };
    state: GuestClaimViewState;
  };
  onOpenAccountClaim?: () => void;
  rejectedWatchPayloadStore?: WatchRejectedPayloadStore;
  /** Counts account changes saved on this device that the cloud has not received yet. */
  loadPendingChangeCount?: () => Promise<number>;
  /** Sends waiting account changes now; the count is read again once this settles. */
  syncPendingChanges?: () => Promise<unknown>;
  /** True while account records are being downloaded from the cloud. */
  isCloudRefreshing?: boolean;
  appVersion?: string;
};

const themeOptions: ThemePreference[] = ['system', 'light', 'dark'];
const languageOptions: SupportedLanguage[] = ['ko', 'en'];

export default function SettingsScreen({
  loadLinkedWatchInfo = defaultWatchLink.getLinkedWatchInfo,
  onBack,
  onOpenLogin,
  onOpenRoute,
  requestWatchSyncNotificationPermission = requestDefaultWatchSyncNotificationPermission,
  hasWatchSyncNotificationPermission = hasDefaultWatchSyncNotificationPermission,
  openNotificationSettings = Linking.openSettings,
  accountClaim,
  onOpenAccountClaim,
  rejectedWatchPayloadStore = defaultWatchRejectedPayloadStore,
  loadPendingChangeCount,
  syncPendingChanges,
  isCloudRefreshing = false,
  appVersion = packageJson.version,
  route: controlledRoute,
}: SettingsScreenProps): React.JSX.Element {
  const { t } = useTranslation();
  const auth = useAuth();
  const { language, setLanguage, setThemePreference, setWatchSyncNotificationsEnabled, themePreference, watchSyncNotificationsEnabled } =
    useAppPreferences();
  const [localRoute, setLocalRoute] = React.useState<SettingsRoute>('index');
  const [linkedWatchInfo, setLinkedWatchInfo] = React.useState<LinkedWatchInfo | undefined>();
  const [linkedWatchLookupFailed, setLinkedWatchLookupFailed] = React.useState(false);
  const [isRefreshingWatch, setIsRefreshingWatch] = React.useState(false);
  const [rejectedWatchPayloads, setRejectedWatchPayloads] = React.useState<RejectedWatchPayload[]>([]);
  const [isSigningOut, setIsSigningOut] = React.useState(false);
  const [pendingChangeCount, setPendingChangeCount] = React.useState<number | 'unknown'>();
  // The sign-out row is busy while the unsent count is read, before the warning can open.
  const [isReadingSignOutCount, setIsReadingSignOutCount] = React.useState(false);
  const [isRequestingNotificationPermission, setIsRequestingNotificationPermission] = React.useState(false);
  const awaitingNotificationSettings = React.useRef(false);
  const notificationToggleBusy = React.useRef(false);
  const signOutInFlight = React.useRef(false);
  const signOutCountInFlight = React.useRef(false);
  const loadPendingChangeCountRef = React.useRef(loadPendingChangeCount);
  loadPendingChangeCountRef.current = loadPendingChangeCount;
  const syncPendingChangesRef = React.useRef(syncPendingChanges);
  syncPendingChangesRef.current = syncPendingChanges;
  const route = controlledRoute ?? localRoute;
  const authStatus = auth.state.status;
  const isSignedIn = authStatus === 'authenticated' || authStatus === 'authenticatedOffline';

  React.useEffect(() => {
    const subscription = AppState.addEventListener('change', nextState => {
      if (nextState !== 'active') {
        return;
      }
      void hasWatchSyncNotificationPermission().then(async permitted => {
        if (awaitingNotificationSettings.current) {
          awaitingNotificationSettings.current = false;
          await setWatchSyncNotificationsEnabled(permitted);
        } else if (watchSyncNotificationsEnabled && !permitted) {
          await setWatchSyncNotificationsEnabled(false);
        }
      });
    });
    return () => subscription.remove();
  }, [hasWatchSyncNotificationPermission, setWatchSyncNotificationsEnabled, watchSyncNotificationsEnabled]);

  React.useEffect(() => {
    // The switch lives on the index, so a permission revoked elsewhere turns it off there.
    if (route !== 'index' || !watchSyncNotificationsEnabled) {
      return;
    }
    void hasWatchSyncNotificationPermission().then(async permitted => {
      if (!permitted) {
        await setWatchSyncNotificationsEnabled(false);
      }
    });
  }, [hasWatchSyncNotificationPermission, route, setWatchSyncNotificationsEnabled, watchSyncNotificationsEnabled]);

  const themeLabel = getThemeLabel(themePreference, t);
  const languageLabel = getLanguageLabel(language, t);
  const eligibleAccountClaimCount =
    (accountClaim?.eligible.logCount ?? 0) + (accountClaim?.eligible.planCount ?? 0);
  const showsAccountClaimRow = Boolean(isSignedIn && accountClaim && eligibleAccountClaimCount > 0 && onOpenAccountClaim);
  const openRoute = React.useCallback(
    (nextRoute: Exclude<SettingsRoute, 'index'>) => {
      if (onOpenRoute) {
        onOpenRoute(nextRoute);
        return;
      }

      setLocalRoute(nextRoute);
    },
    [onOpenRoute],
  );
  const closeRoute = React.useCallback(() => {
    if (onBack) {
      onBack();
      return;
    }

    setLocalRoute('index');
  }, [onBack]);

  const isMountedRef = React.useRef(true);
  React.useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const refreshLinkedWatchInfo = React.useCallback(async (): Promise<LinkedWatchInfo | undefined> => {
    try {
      const info = await loadLinkedWatchInfo();
      if (isMountedRef.current) {
        setLinkedWatchInfo(info);
        setLinkedWatchLookupFailed(false);
      }
      return info;
    } catch {
      // A failed lookup is not the same as a missing bridge; keep it retryable.
      if (isMountedRef.current) {
        setLinkedWatchLookupFailed(true);
      }
      return undefined;
    }
  }, [loadLinkedWatchInfo]);

  const watchStatusOpacity = useSharedValue(1);
  const watchStatusStyle = useAnimatedStyle(() => ({ opacity: watchStatusOpacity.value }));

  const refreshLinkedWatchInfoFromButton = React.useCallback(async () => {
    setIsRefreshingWatch(true);
    let info: LinkedWatchInfo | undefined;
    try {
      info = await refreshLinkedWatchInfo();
    } finally {
      if (isMountedRef.current) {
        setIsRefreshingWatch(false);
      }
    }
    if (!isMountedRef.current) {
      return;
    }
    // The check usually answers at once with the same status, so the row dims and returns to show it ran.
    watchStatusOpacity.value = withSequence(
      withTiming(WATCH_STATUS_BLINK.opacity, { duration: WATCH_STATUS_BLINK.dim }),
      withTiming(1, { duration: WATCH_STATUS_BLINK.back }),
    );
    AccessibilityInfo.announceForAccessibility(
      info ? getLinkedWatchStatusLabel(info, t) : t('settings.devices.status.lookupFailed'),
    );
  }, [refreshLinkedWatchInfo, t, watchStatusOpacity]);

  const isDevicesRoute = route === 'devices';
  React.useEffect(() => {
    // Read again on opening the device page: pairing may have finished since the first read.
    void refreshLinkedWatchInfo();
  }, [isDevicesRoute, refreshLinkedWatchInfo]);

  React.useEffect(() => {
    // The watch app can be installed or paired while Divenary is in the background.
    const subscription = AppState.addEventListener('change', nextState => {
      if (nextState === 'active') {
        void refreshLinkedWatchInfo();
      }
    });
    return () => subscription.remove();
  }, [refreshLinkedWatchInfo]);

  React.useEffect(() => {
    const loadRejectedPayloads = () => {
      void rejectedWatchPayloadStore
        .list()
        .then(rejections => {
          if (isMountedRef.current) {
            setRejectedWatchPayloads(rejections);
          }
        })
        .catch(() => undefined);
    };
    loadRejectedPayloads();
    return rejectedWatchPayloadStore.subscribe(loadRejectedPayloads);
  }, [rejectedWatchPayloadStore]);

  const readPendingChangeCount = React.useCallback(async (): Promise<number | 'unknown'> => {
    const load = loadPendingChangeCountRef.current;
    if (!load) {
      return 0;
    }
    try {
      return await load();
    } catch {
      return 'unknown';
    }
  }, []);

  React.useEffect(() => {
    if (route !== 'account' || !isSignedIn) {
      return;
    }
    let active = true;
    const showPendingChangeCount = () =>
      readPendingChangeCount().then(count => {
        if (active) {
          setPendingChangeCount(count);
        }
      });
    void showPendingChangeCount();
    // Waiting changes usually go out moments after this opens; count again once that pass settles.
    const sync = syncPendingChangesRef.current;
    if (sync && authStatus === 'authenticated' && !isCloudRefreshing) {
      void sync()
        .catch(() => undefined)
        .then(showPendingChangeCount);
    }
    return () => {
      active = false;
    };
  }, [authStatus, isCloudRefreshing, isSignedIn, readPendingChangeCount, route]);

  const watchStatusLoading = linkedWatchInfo === undefined && !linkedWatchLookupFailed;
  const showWatchStatusLoading = useContentLoading(watchStatusLoading, 'linked-watch');
  // A quick download keeps the last backup status; "loading" appears only after the shared delay.
  const showCloudRefreshing = useContentLoading(isCloudRefreshing, 'account-sync');
  // The count is unknown until the first read; a short placeholder line holds its place after the delay.
  const showPendingCountLoading = useContentLoading(pendingChangeCount === undefined, 'pending-change-count');
  const watchName = linkedWatchInfo?.name ?? t('settings.devices.appleWatch');
  // Nothing is shown for a fast lookup; "checking" appears only after the shared delay.
  const watchStatus = linkedWatchLookupFailed
    ? t('settings.devices.status.lookupFailed')
    : watchStatusLoading
      ? showWatchStatusLoading
        ? t('settings.devices.status.checking')
        : undefined
      : getLinkedWatchStatusLabel(linkedWatchInfo, t);

  const toggleWatchSyncNotifications = React.useCallback(async () => {
    if (notificationToggleBusy.current) {
      return;
    }
    notificationToggleBusy.current = true;
    try {
      if (watchSyncNotificationsEnabled) {
        await setWatchSyncNotificationsEnabled(false);
        return;
      }

      setIsRequestingNotificationPermission(true);
      let permitted: boolean;
      try {
        permitted = await requestWatchSyncNotificationPermission();
      } finally {
        if (isMountedRef.current) {
          setIsRequestingNotificationPermission(false);
        }
      }

      if (permitted) {
        await setWatchSyncNotificationsEnabled(true);
        return;
      }
      Alert.alert(t('settings.notifications.permissionRequired'), t('settings.notifications.openSettingsDescription'), [
        {
          text: t('common.cancel'),
          style: 'cancel',
        },
        {
          text: t('settings.notifications.openSettings'),
          onPress: () => {
            awaitingNotificationSettings.current = true;
            void openNotificationSettings();
          },
        },
      ]);
    } finally {
      notificationToggleBusy.current = false;
    }
  }, [
    openNotificationSettings,
    requestWatchSyncNotificationPermission,
    setWatchSyncNotificationsEnabled,
    t,
    watchSyncNotificationsEnabled,
  ]);

  const signOut = React.useCallback(async () => {
    if (signOutInFlight.current) {
      return;
    }
    signOutInFlight.current = true;
    setIsSigningOut(true);
    try {
      await auth.signOut();
    } finally {
      signOutInFlight.current = false;
      // Signing out swaps the data owner, which usually unmounts this screen first.
      if (isMountedRef.current) {
        setIsSigningOut(false);
      }
    }
  }, [auth]);

  const confirmSignOut = React.useCallback(async () => {
    if (signOutInFlight.current || signOutCountInFlight.current) {
      return;
    }
    // Read the outbox again so the warning matches what is waiting right now.
    signOutCountInFlight.current = true;
    setIsReadingSignOutCount(true);
    const count = await readPendingChangeCount();
    signOutCountInFlight.current = false;
    if (!isMountedRef.current) {
      return;
    }
    setIsReadingSignOutCount(false);
    setPendingChangeCount(count);
    const message = [
      t('settings.account.signOutMessage'),
      count === 'unknown'
        ? t('settings.account.signOutPendingUnknown')
        : count > 0
          ? t('settings.account.signOutPendingChanges', { count })
          : undefined,
    ]
      .filter(Boolean)
      .join('\n\n');

    Alert.alert(t('settings.account.signOutTitle'), message, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('settings.account.signOut'),
        style: 'destructive',
        onPress: () => {
          void signOut();
        },
      },
    ]);
  }, [readPendingChangeCount, signOut, t]);

  if (route === 'theme') {
    return (
      <SettingsScaffold>
        <DetailHeader title={t('settings.theme.title')} onBack={closeRoute} />
        <Section>
          {themeOptions.map((option, index) => (
            <Row
              key={option}
              testID={`settings-option-theme-${option}`}
              label={getThemeLabel(option, t)}
              accessory={{ kind: 'check', checked: themePreference === option }}
              onPress={() => setThemePreference(option)}
              separated={index > 0}
            />
          ))}
        </Section>
      </SettingsScaffold>
    );
  }

  if (route === 'language') {
    return (
      <SettingsScaffold>
        <DetailHeader title={t('settings.language.title')} onBack={closeRoute} />
        <Section>
          {languageOptions.map((option, index) => (
            <Row
              key={option}
              testID={`settings-option-language-${option}`}
              label={getLanguageLabel(option, t)}
              accessory={{ kind: 'check', checked: language === option }}
              onPress={() => setLanguage(option)}
              separated={index > 0}
            />
          ))}
        </Section>
      </SettingsScaffold>
    );
  }

  if (route === 'devices') {
    return (
      <SettingsScaffold>
        <DetailHeader title={t('settings.devices.title')} onBack={closeRoute} />
        <Animated.View style={watchStatusStyle}>
          <Section>
            <Row
              testID="settings-linked-watch"
              icon={WatchIcon}
              label={watchName}
              value={watchStatus}
              valueTestID="settings-linked-watch-status"
              separated={false}
            />
          </Section>
        </Animated.View>
        <InstrumentButton
          testID="settings-linked-watch-refresh"
          label={t('settings.devices.refresh')}
          pending={isRefreshingWatch}
          onPress={refreshLinkedWatchInfoFromButton}
        />
        {rejectedWatchPayloads.length > 0 ? (
          <VStack space="sm" className="rounded-2xl bg-card px-4 py-4">
            <Text testID="settings-rejected-watch-title" className="text-base font-semibold text-card-foreground">
              {t('settings.devices.rejected.title', { count: rejectedWatchPayloads.length })}
            </Text>
            <Text testID="settings-rejected-watch-guidance" size="sm" className="leading-5 text-muted-foreground">
              {t('settings.devices.rejected.guidance')}
            </Text>
            <Pressable
              testID="settings-rejected-watch-clear"
              accessibilityRole="button"
              accessibilityLabel={t('settings.devices.rejected.clear')}
              className="min-h-11 justify-center self-start"
              onPress={() => rejectedWatchPayloadStore.clear()}>
              <Text className="text-base text-primary">{t('settings.devices.rejected.clear')}</Text>
            </Pressable>
          </VStack>
        ) : null}
      </SettingsScaffold>
    );
  }

  if (route === 'account') {
    const isOffline = auth.state.status === 'authenticatedOffline';

    return (
      <SettingsScaffold>
        <DetailHeader title={t('settings.account.title')} onBack={closeRoute} />
        {isSignedIn ? (
          <>
            <Section>
              <Row
                testID="settings-account-identity"
                label={getSignedInLabel(auth.recentProvider, t)}
                separated={false}
              />
              <Row
                testID="settings-row-sync"
                label={t('settings.account.sync')}
                value={getSyncValue({ isOffline, isCloudRefreshing: showCloudRefreshing, pendingChangeCount }, t)}
                valueLoading={showPendingCountLoading}
                valueTestID="settings-account-sync-status"
                detail={isOffline ? t('settings.account.offlineDescription') : undefined}
              />
              {showsAccountClaimRow ? (
                <Row
                  testID="settings-row-account-claim"
                  label={t('accountClaim.settingsAction')}
                  value={t('accountClaim.settingsCount', { count: eligibleAccountClaimCount })}
                  valueTestID="settings-account-claim-count"
                  onPress={onOpenAccountClaim}
                />
              ) : null}
            </Section>
            <Section>
              {/* Busy and disabled at once while reading the unsent count or signing out; the spinner shows only after the shared delay. */}
              <Row
                testID="settings-account-sign-out"
                label={t('settings.account.signOut')}
                destructive
                pending={isSigningOut || isReadingSignOutCount}
                accessory={{ kind: 'none' }}
                onPress={confirmSignOut}
                separated={false}
              />
            </Section>
          </>
        ) : (
          <Section>
            <Row
              testID="settings-account-status"
              label={getAccountRow(auth, t).label}
              separated={false}
            />
          </Section>
        )}
      </SettingsScaffold>
    );
  }

  const accountRow = getAccountRow(auth, t);
  const accountRowAction =
    accountRow.action === 'login' ? onOpenLogin : accountRow.action === 'account' ? () => openRoute('account') : undefined;

  return (
    <SettingsScaffold>
      <ScreenHeader title={t('settings.title')} titleTestID="settings-screen-title" />

      <Section testID="settings-section-account" title={t('settings.account.title')}>
        <Row
          testID={accountRow.testID}
          label={accountRow.label}
          detail={accountRow.detail}
          value={accountRow.value}
          valueTestID="settings-account-value"
          onPress={accountRowAction}
          separated={false}
        />
      </Section>

      <Section title={t('settings.appearance')}>
        <Row
          testID="settings-row-theme"
          icon={SunIcon}
          label={t('settings.theme.title')}
          value={themeLabel}
          valueTestID="settings-current-theme"
          onPress={() => openRoute('theme')}
          separated={false}
        />
        <Row
          testID="settings-row-language"
          icon={GlobeIcon}
          label={t('settings.language.title')}
          value={languageLabel}
          valueTestID="settings-current-language"
          onPress={() => openRoute('language')}
        />
      </Section>

      <Section title={t('settings.notifications.title')}>
        <Row
          testID="settings-row-notifications"
          icon={BellIcon}
          label={t('settings.notifications.watchSyncTitle')}
          accessory={{
            kind: 'switch',
            value: watchSyncNotificationsEnabled,
            onValueChange: () => {
              void toggleWatchSyncNotifications();
            },
          }}
          // Busy and disabled while the permission request is open; the spinner waits for the shared delay.
          pending={isRequestingNotificationPermission}
          separated={false}
        />
      </Section>

      <Section testID="settings-section-devices" title={t('settings.devices.title')}>
        <Row
          testID="settings-row-devices"
          icon={WatchIcon}
          label={watchName}
          value={watchStatus}
          valueTestID="settings-linked-watch-status"
          onPress={() => openRoute('devices')}
          separated={false}
        />
      </Section>

      <Section testID="settings-section-about" title={t('settings.about.title')}>
        <Row
          testID="settings-row-version"
          label={t('settings.about.version')}
          value={appVersion}
          valueTestID="settings-app-version"
          separated={false}
        />
        <Row testID="settings-row-safety" label={t('settings.about.safetyTitle')} detail={t('settings.about.safetyNotice')} />
      </Section>
    </SettingsScaffold>
  );
}

type AccountRowContent = {
  testID: string;
  label: string;
  detail?: string;
  value?: string;
  action?: 'login' | 'account';
};

function getAccountRow(
  auth: Pick<AuthContextValue, 'state' | 'isConfigured' | 'availableProviders' | 'isDevelopmentSignInAvailable' | 'recentProvider'>,
  t: TranslationFunction,
): AccountRowContent {
  const localOnly = { testID: 'settings-account-status', label: t('settings.account.localOnlyStatus') };
  // A build without a usable sign-in has nothing to offer; it only says where records live.
  const canSignIn = auth.isConfigured && (auth.availableProviders.length > 0 || auth.isDevelopmentSignInAvailable);

  if (!auth.isConfigured) {
    return localOnly;
  }

  switch (auth.state.status) {
    case 'guest':
      return canSignIn
        ? {
            testID: 'settings-account-action',
            label: t('settings.account.login'),
            detail: t('settings.account.loginBenefit'),
            action: 'login',
          }
        : localOnly;
    case 'pendingOnboarding':
      return { testID: 'settings-account-status', label: t('settings.account.pendingStatus') };
    case 'authenticated':
      return { testID: 'settings-row-account', label: getSignedInLabel(auth.recentProvider, t), action: 'account' };
    case 'authenticatedOffline':
      return {
        testID: 'settings-row-account',
        label: getSignedInLabel(auth.recentProvider, t),
        value: t('settings.account.offlineValue'),
        action: 'account',
      };
    case 'bootstrapping':
    case 'authenticating':
      return { testID: 'settings-account-status', label: t('settings.account.signingInStatus') };
  }
}

/**
 * Auth keeps no provider for the session, so the last provider used on this device is a hint.
 * After a reinstall restores the session without that hint, the row stays neutral.
 */
function getSignedInLabel(recentProvider: SocialProvider | undefined, t: TranslationFunction): string {
  if (recentProvider === 'apple') {
    return t('settings.account.signedInWithApple');
  }
  if (recentProvider === 'google') {
    return t('settings.account.signedInWithGoogle');
  }
  return t('settings.account.authenticatedStatus');
}

function getSyncValue(
  status: { isOffline: boolean; isCloudRefreshing: boolean; pendingChangeCount: number | 'unknown' | undefined },
  t: TranslationFunction,
): string | undefined {
  if (status.isOffline) {
    return t('settings.account.offlineValue');
  }
  if (status.isCloudRefreshing) {
    return t('settings.account.syncDownloading');
  }
  if (status.pendingChangeCount === 'unknown') {
    return '--';
  }
  if (status.pendingChangeCount === undefined) {
    return undefined;
  }
  return status.pendingChangeCount > 0
    ? t('settings.account.syncPending', { count: status.pendingChangeCount })
    : t('settings.account.syncNothingPending');
}

function SettingsScaffold(props: { children: React.ReactNode }): React.JSX.Element {
  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="px-5 pb-6 pt-4" contentInsetAdjustmentBehavior="automatic">
      <VStack space="xl">{props.children}</VStack>
    </ScrollView>
  );
}

function DetailHeader(props: { title: string; onBack: () => void }): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <VStack space="md">
      <ScreenBackButton testID="settings-back" accessibilityLabel={t('common.back')} onPress={props.onBack} />
      <ScreenHeader title={props.title} titleTestID="settings-detail-title" />
    </VStack>
  );
}

function getThemeLabel(themePreference: ThemePreference, t: TranslationFunction): string {
  return t(`settings.theme.${themePreference}`);
}

function getLanguageLabel(language: SupportedLanguage, t: TranslationFunction): string {
  return language === 'ko' ? t('settings.language.korean') : t('settings.language.english');
}

function getLinkedWatchStatusLabel(linkedWatchInfo: LinkedWatchInfo | undefined, t: TranslationFunction): string {
  if (!linkedWatchInfo) {
    return t('settings.devices.status.checking');
  }

  if (linkedWatchInfo.nativeBridgeAvailable === false) {
    return t('settings.devices.status.bridgeUnavailable');
  }

  if (!linkedWatchInfo.isSupported) {
    return t('settings.devices.status.unsupported');
  }

  if (!linkedWatchInfo.isPaired) {
    return t('settings.devices.status.notPaired');
  }

  if (!linkedWatchInfo.isWatchAppInstalled) {
    return t('settings.devices.status.appNotInstalled');
  }

  // Logs reach the phone in the background, so a paired watch with Divenary is connected even when its app is closed.
  return t('settings.devices.status.connected');
}
