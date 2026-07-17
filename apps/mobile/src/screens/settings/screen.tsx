import React from 'react';
import { Alert, AppState, Linking } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Box } from '../../components/ui/box';
import { Button, ButtonIcon, ButtonText } from '../../components/ui/button';
import { HStack } from '../../components/ui/hstack';
import { InstrumentButton } from '../../components/ui/instrument';
import { BellIcon, ChevronLeftIcon, ChevronRightIcon, CircleIcon, GlobeIcon, Icon, SunIcon, WatchIcon } from '../../components/ui/icon';
import { Pressable } from '../../components/ui/pressable';
import { Radio, RadioGroup, RadioIcon, RadioIndicator, RadioLabel } from '../../components/ui/radio';
import { ScrollView } from '../../components/ui/scroll-view';
import { Switch } from '../../components/ui/switch';
import { Text } from '../../components/ui/text';
import { VStack } from '../../components/ui/vstack';
import type { SupportedLanguage } from '../../i18n';
import { getLinkedWatchInfo, type LinkedWatchInfo } from '../../native/watch-connectivity';
import {
  hasWatchSyncNotificationPermission as hasDefaultWatchSyncNotificationPermission,
  requestWatchSyncNotificationPermission as requestDefaultWatchSyncNotificationPermission,
} from '../../notifications/watch-sync-notification-service';
import { useAppPreferences, type ThemePreference } from '../../states/app-preferences';
import { useAuth, type AuthState } from '../../states/auth';

export type SettingsRoute = 'index' | 'theme' | 'language' | 'notifications' | 'devices';

type SettingRowProps = {
  icon: React.ElementType;
  label: string;
  rowTestID: string;
  valueTestID: string;
  value: string;
  onPress: () => void;
};

type OptionRowProps = {
  label: string;
  rowTestID: string;
  selected: boolean;
  onPress: () => void | Promise<void>;
  value: string;
};

type SettingsScreenProps = {
  loadLinkedWatchInfo?: () => Promise<LinkedWatchInfo>;
  route?: SettingsRoute;
  onBack?: () => void;
  onOpenLogin?: () => void;
  onOpenRoute?: (route: Exclude<SettingsRoute, 'index'>) => void;
  requestWatchSyncNotificationPermission?: () => Promise<boolean>;
  hasWatchSyncNotificationPermission?: () => Promise<boolean>;
  openNotificationSettings?: () => Promise<void>;
};

const themeOptions: ThemePreference[] = ['system', 'light', 'dark'];
const languageOptions: SupportedLanguage[] = ['ko', 'en'];

export default function SettingsScreen({
  loadLinkedWatchInfo = getLinkedWatchInfo,
  onBack,
  onOpenLogin,
  onOpenRoute,
  requestWatchSyncNotificationPermission = requestDefaultWatchSyncNotificationPermission,
  hasWatchSyncNotificationPermission = hasDefaultWatchSyncNotificationPermission,
  openNotificationSettings = Linking.openSettings,
  route: controlledRoute,
}: SettingsScreenProps): React.JSX.Element {
  const { t } = useTranslation();
  const auth = useAuth();
  const { language, setLanguage, setThemePreference, setWatchSyncNotificationsEnabled, themePreference, watchSyncNotificationsEnabled } =
    useAppPreferences();
  const [localRoute, setLocalRoute] = React.useState<SettingsRoute>('index');
  const [linkedWatchInfo, setLinkedWatchInfo] = React.useState<LinkedWatchInfo | undefined>();
  const [accountActionBusy, setAccountActionBusy] = React.useState(false);
  const awaitingNotificationSettings = React.useRef(false);
  const notificationToggleBusy = React.useRef(false);
  const route = controlledRoute ?? localRoute;

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
    if (route !== 'notifications' || !watchSyncNotificationsEnabled) {
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
  const watchSyncNotificationLabel = watchSyncNotificationsEnabled ? t('settings.notifications.on') : t('settings.notifications.off');
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

  React.useEffect(() => {
    let isMounted = true;

    loadLinkedWatchInfo()
      .then(info => {
        if (isMounted) {
          setLinkedWatchInfo(info);
        }
      })
      .catch(() => {
        if (isMounted) {
          setLinkedWatchInfo({
            nativeBridgeAvailable: false,
            isSupported: false,
            isPaired: false,
            isWatchAppInstalled: false,
            isReachable: false,
          });
        }
      });

    return () => {
      isMounted = false;
    };
  }, [loadLinkedWatchInfo]);

  if (route === 'theme') {
    return (
      <SettingsScaffold>
        <DetailHeader title={t('settings.theme.title')} onBack={closeRoute} />

        <OptionGroup value={themePreference} onChange={nextValue => setThemePreference(nextValue as ThemePreference)}>
          {themeOptions.map(option => (
            <OptionRow
              key={option}
              rowTestID={`settings-option-theme-${option}`}
              label={getThemeLabel(option, t)}
              selected={themePreference === option}
              onPress={() => setThemePreference(option)}
              value={option}
            />
          ))}
        </OptionGroup>
      </SettingsScaffold>
    );
  }

  if (route === 'language') {
    return (
      <SettingsScaffold>
        <DetailHeader title={t('settings.language.title')} onBack={closeRoute} />

        <OptionGroup
          value={language}
          onChange={nextValue => {
            setLanguage(nextValue as SupportedLanguage);
          }}>
          {languageOptions.map(option => (
            <OptionRow
              key={option}
              rowTestID={`settings-option-language-${option}`}
              label={getLanguageLabel(option, t)}
              selected={language === option}
              onPress={() => setLanguage(option)}
              value={option}
            />
          ))}
        </OptionGroup>
      </SettingsScaffold>
    );
  }

  if (route === 'devices') {
    return (
      <SettingsScaffold>
        <DetailHeader title={t('settings.devices.title')} onBack={closeRoute} />
        <LinkedWatchCard linkedWatchInfo={linkedWatchInfo} />
      </SettingsScaffold>
    );
  }

  if (route === 'notifications') {
    return (
      <SettingsScaffold>
        <DetailHeader title={t('settings.notifications.title')} onBack={closeRoute} />

        <VStack className="overflow-hidden rounded-2xl bg-card">
          <ToggleRow
            rowTestID="settings-option-watch-sync-notifications"
            label={t('settings.notifications.watchSyncTitle')}
            selected={watchSyncNotificationsEnabled}
            onPress={async () => {
              if (notificationToggleBusy.current) {
                return;
              }
              notificationToggleBusy.current = true;
              try {
                if (watchSyncNotificationsEnabled) {
                  await setWatchSyncNotificationsEnabled(false);
                  return;
                }

                const permitted = await requestWatchSyncNotificationPermission();

                if (permitted) {
                  await setWatchSyncNotificationsEnabled(true);
                  return;
                }
                Alert.alert(
                  t('settings.notifications.permissionRequired', {
                    defaultValue: '알림 권한이 필요합니다',
                  }),
                  t('settings.notifications.openSettingsDescription', {
                    defaultValue: 'iPhone 설정에서 이 앱의 알림을 허용한 뒤 돌아오면 자동으로 켜집니다.',
                  }),
                  [
                    {
                      text: t('common.cancel', { defaultValue: '취소' }),
                      style: 'cancel',
                    },
                    {
                      text: t('settings.notifications.openSettings', {
                        defaultValue: '설정 열기',
                      }),
                      onPress: () => {
                        awaitingNotificationSettings.current = true;
                        void openNotificationSettings();
                      },
                    },
                  ],
                );
              } finally {
                notificationToggleBusy.current = false;
              }
            }}
          />
        </VStack>
      </SettingsScaffold>
    );
  }

  return (
    <SettingsScaffold>
      <Text testID="settings-screen-title" size="3xl" className="font-semibold text-foreground">
        {t('settings.title')}
      </Text>

      <VStack space="sm">
        <Text testID="settings-section-account" size="xs" bold className="uppercase text-muted-foreground">
          {t('settings.account.title')}
        </Text>
        <AccountCard
          authState={auth.state}
          isConfigured={auth.isConfigured}
          isBusy={accountActionBusy}
          onLogin={onOpenLogin}
          onSignOut={async () => {
            if (accountActionBusy) {
              return;
            }

            setAccountActionBusy(true);
            try {
              await auth.signOut();
            } finally {
              setAccountActionBusy(false);
            }
          }}
        />
      </VStack>

      <VStack space="sm">
        <Text size="xs" className="font-semibold uppercase text-muted-foreground">
          {t('settings.appearance')}
        </Text>
        <VStack className="overflow-hidden rounded-2xl bg-card">
          <SettingRow
            rowTestID="settings-row-theme"
            icon={SunIcon}
            label={t('settings.theme.title')}
            value={themeLabel}
            valueTestID="settings-current-theme"
            onPress={() => openRoute('theme')}
          />
          <Box className="h-px bg-border" />
          <SettingRow
            rowTestID="settings-row-language"
            icon={GlobeIcon}
            label={t('settings.language.title')}
            value={languageLabel}
            valueTestID="settings-current-language"
            onPress={() => openRoute('language')}
          />
        </VStack>
      </VStack>

      <VStack space="sm">
        <Text size="xs" className="font-semibold uppercase text-muted-foreground">
          {t('settings.notifications.title')}
        </Text>
        <VStack className="overflow-hidden rounded-2xl bg-card">
          <SettingRow
            rowTestID="settings-row-notifications"
            icon={BellIcon}
            label={t('settings.notifications.watchSyncTitle')}
            value={watchSyncNotificationLabel}
            valueTestID="settings-current-watch-sync-notifications"
            onPress={() => openRoute('notifications')}
          />
        </VStack>
      </VStack>

      <VStack space="sm">
        <Text testID="settings-section-devices" size="xs" className="font-semibold uppercase text-muted-foreground">
          {t('settings.devices.title')}
        </Text>
        <Pressable
          testID="settings-row-devices"
          onPress={() => openRoute('devices')}
          style={({ pressed }) => [{ transform: [{ scale: pressed ? 0.99 : 1 }] }]}>
          <LinkedWatchCard linkedWatchInfo={linkedWatchInfo} showsDisclosure />
        </Pressable>
      </VStack>
    </SettingsScaffold>
  );
}

function AccountCard(props: {
  authState: AuthState;
  isConfigured: boolean;
  isBusy: boolean;
  onLogin?: () => void;
  onSignOut: () => Promise<void>;
}): React.JSX.Element {
  const { t } = useTranslation();
  const content = getAccountCardContent(props.authState, props.isConfigured, t);
  const canLogin = content.action === 'login' && props.onLogin !== undefined;
  const canSignOut = content.action === 'signOut';

  return (
    <VStack space="lg" className="rounded-2xl bg-card px-4 py-4">
      <VStack space="xs">
        <Text testID="settings-account-status" size="lg" bold className="text-card-foreground">
          {content.status}
        </Text>
        {content.description ? (
          <Text testID="settings-account-description" size="sm" className="leading-5 text-muted-foreground">
            {content.description}
          </Text>
        ) : null}
      </VStack>
      {canLogin ? (
        <InstrumentButton
          testID="settings-account-action"
          accessibilityLabel={t('settings.account.login')}
          label={t('settings.account.login')}
          variant="primary"
          isDisabled={props.isBusy}
          onPress={props.onLogin}
        />
      ) : null}
      {canSignOut ? (
        <InstrumentButton
          testID="settings-account-action"
          accessibilityLabel={t('settings.account.signOut')}
          label={t('settings.account.signOut')}
          variant="danger"
          isDisabled={props.isBusy}
          onPress={props.onSignOut}
        />
      ) : null}
    </VStack>
  );
}

function getAccountCardContent(
  authState: AuthState,
  isConfigured: boolean,
  t: ReturnType<typeof useTranslation>['t'],
): { status: string; description?: string; action?: 'login' | 'signOut' } {
  if (!isConfigured) {
    return {
      status: t('settings.account.unconfiguredStatus'),
      description: t('settings.account.unconfiguredDescription'),
    };
  }

  switch (authState.status) {
    case 'guest':
      return {
        status: t('settings.account.guestStatus'),
        action: 'login',
      };
    case 'pendingOnboarding':
      return {
        status: t('settings.account.pendingStatus'),
      };
    case 'authenticated':
      return {
        status: t('settings.account.authenticatedStatus'),
        action: 'signOut',
      };
    case 'authenticatedOffline':
      return {
        status: t('settings.account.offlineStatus'),
        description: t('settings.account.offlineDescription'),
        action: 'signOut',
      };
    case 'bootstrapping':
    case 'authenticating':
      return {
        status: t('settings.account.signingInStatus'),
      };
  }
}

function SettingsScaffold(props: { children: React.ReactNode }): React.JSX.Element {
  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="px-5 pb-8 pt-5" contentInsetAdjustmentBehavior="automatic">
      <VStack space="xl">{props.children}</VStack>
    </ScrollView>
  );
}

function DetailHeader(props: { title: string; onBack: () => void }): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <VStack space="md">
      <Button
        variant="ghost"
        size="icon"
        testID="settings-back"
        accessibilityLabel={t('settings.title')}
        onPress={props.onBack}
        className="h-10 w-10 self-start rounded-full bg-primary/10"
        style={({ pressed }) => [{ transform: [{ scale: pressed ? 0.98 : 1 }] }]}>
        <Box testID="settings-back-icon" className="items-center justify-center">
          <ButtonIcon as={ChevronLeftIcon} className="text-primary" />
        </Box>
      </Button>
      <Text testID="settings-detail-title" size="3xl" className="font-semibold text-foreground">
        {props.title}
      </Text>
    </VStack>
  );
}

function OptionGroup(props: { children: React.ReactNode; value: string; onChange: (value: string) => void }): React.JSX.Element {
  return (
    <RadioGroup value={props.value} onChange={props.onChange} className="overflow-hidden rounded-2xl bg-card gap-0">
      {props.children}
    </RadioGroup>
  );
}

function SettingRow(props: SettingRowProps): React.JSX.Element {
  return (
    <Button
      variant="ghost"
      testID={props.rowTestID}
      onPress={props.onPress}
      className="h-auto w-full rounded-none bg-card px-4 py-4"
      style={({ pressed }) => [{ transform: [{ scale: pressed ? 0.99 : 1 }] }]}>
      <HStack space="md" className="min-h-10 flex-1 items-center justify-between">
        <Box testID={`${props.rowTestID}-icon`} className="h-9 w-9 items-center justify-center rounded-full bg-primary/10">
          <ButtonIcon as={props.icon} className="text-primary" />
        </Box>
        <ButtonText className="flex-1 text-base font-semibold text-card-foreground">{props.label}</ButtonText>
        <HStack space="sm" className="shrink-0 items-center">
          <ButtonText testID={props.valueTestID} className="text-sm text-muted-foreground">
            {props.value}
          </ButtonText>
          <Box testID={`${props.rowTestID}-disclosure`} className="items-center justify-center">
            <ButtonIcon as={ChevronRightIcon} className="text-muted-foreground" />
          </Box>
        </HStack>
      </HStack>
    </Button>
  );
}

function OptionRow(props: OptionRowProps): React.JSX.Element {
  const labelClassName = props.selected ? 'font-semibold text-primary' : 'font-semibold text-card-foreground';

  return (
    <Radio
      testID={props.rowTestID}
      accessibilityState={{ selected: props.selected }}
      onPress={props.onPress}
      value={props.value}
      className={props.selected ? 'bg-primary/10 px-4 py-4' : 'bg-card px-4 py-4'}
      style={({ pressed }) => [{ transform: [{ scale: pressed ? 0.99 : 1 }] }]}>
      <HStack space="md" className="min-h-11 flex-1 items-center justify-between">
        <RadioLabel className={`${labelClassName} flex-1 pr-3`}>{props.label}</RadioLabel>
        <RadioIndicator>
          <RadioIcon as={CircleIcon} />
        </RadioIndicator>
      </HStack>
    </Radio>
  );
}

function ToggleRow(props: {
  label: string;
  rowTestID: string;
  selected: boolean;
  onPress: () => void | Promise<void>;
}): React.JSX.Element {
  return (
    <Pressable
      testID={props.rowTestID}
      accessibilityState={{ selected: props.selected }}
      onPress={props.onPress}
      className={props.selected ? 'bg-primary/10 px-4 py-4' : 'bg-card px-4 py-4'}
      style={({ pressed }) => [{ transform: [{ scale: pressed ? 0.99 : 1 }] }]}>
      <HStack space="md" className="min-h-11 flex-1 items-center justify-between">
        <Text className={`${props.selected ? 'font-semibold text-primary' : 'font-semibold text-card-foreground'} flex-1 pr-3`}>
          {props.label}
        </Text>
        <Switch
          testID={`${props.rowTestID}-switch`}
          value={props.selected}
          onValueChange={() => {
            void props.onPress();
          }}
        />
      </HStack>
    </Pressable>
  );
}

function LinkedWatchCard(props: { linkedWatchInfo?: LinkedWatchInfo; showsDisclosure?: boolean }): React.JSX.Element {
  const { t } = useTranslation();
  const watchName = props.linkedWatchInfo?.name ?? t('settings.devices.appleWatch');

  return (
    <HStack className="items-center rounded-2xl bg-card px-4 py-4" space="md">
      <Box testID="settings-linked-watch-icon" className="h-9 w-9 items-center justify-center rounded-full bg-primary/10">
        <Icon as={WatchIcon} size="sm" className="text-primary" />
      </Box>
      <VStack space="xs" className="flex-1">
        <Text testID="settings-linked-watch-name" className="text-base font-semibold text-card-foreground">
          {watchName}
        </Text>
        <Text testID="settings-linked-watch-status" size="sm" className="leading-5 text-muted-foreground">
          {getLinkedWatchStatusLabel(props.linkedWatchInfo, t)}
        </Text>
      </VStack>
      {props.showsDisclosure ? (
        <Box testID="settings-row-devices-disclosure" className="items-center justify-center">
          <Icon as={ChevronRightIcon} size="md" className="text-muted-foreground" />
        </Box>
      ) : null}
    </HStack>
  );
}

function getThemeLabel(themePreference: ThemePreference, t: ReturnType<typeof useTranslation>['t']): string {
  return t(`settings.theme.${themePreference}`);
}

function getLanguageLabel(language: SupportedLanguage, t: ReturnType<typeof useTranslation>['t']): string {
  return language === 'ko' ? t('settings.language.korean') : t('settings.language.english');
}

function getLinkedWatchStatusLabel(linkedWatchInfo: LinkedWatchInfo | undefined, t: ReturnType<typeof useTranslation>['t']): string {
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

  return linkedWatchInfo.isReachable ? t('settings.devices.status.connected') : t('settings.devices.status.linked');
}
